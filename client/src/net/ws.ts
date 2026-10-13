import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export function isFastColo(colo?: string): boolean {
  if (!colo) return false;
  return colo === 'SIN' || colo === 'HKG' || colo === 'HAN' || colo === 'SGN' || colo === 'BKK';
}

export class WsClient implements Transport {
  private ws: WebSocket | null = null;
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private isReconnecting = false;
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;
  private sessionToken: string | null = null;
  private pingInterval: number | null = null;
  public rtt = 0;
  public rttMin = 0;
  public colo = '';
  public inGame = false;
  private autoSteerAttempts = 0;
  private reconnectTimer: number | null = null;
  private readonly rttWin: number[] = [];
  private badPingStreak = 0;

  // In-Game Zero-Downtime Hot Migration
  private migrationWs: WebSocket | null = null;
  private lastMigrationProbeTime = 0;
  private migrationRetryTimer: number | null = null;
  public onMigrationSuccess?: (newColo: string) => void;

  constructor(
    private readonly url: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
      this.ws = socket;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.onStatus?.('error');
      this.scheduleReconnect();
      return;
    }

    this.bindActiveSocket(socket);
  }

  private bindActiveSocket(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.ws !== socket) return; // Stale socket guard
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = false;
      this.onStatus?.(wasReconnecting ? 'reconnected' : 'open');

      const hasQueuedJoin = this.queue.some((m) => m.t === 'join');
      if (this.lastJoinMsg && this.inGame && !hasQueuedJoin) {
        this.send({
          ...this.lastJoinMsg,
          token: this.sessionToken || undefined,
        });
      }

      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        this.send(msg);
      }

      setTimeout(() => {
        if (!this.closed && this.ws === socket && socket.readyState === WebSocket.OPEN) {
          const now = Math.round(performance.now());
          this.send({ t: 'ping', c: now });
        }
      }, 50);

      this.startPing();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        // Fast-path: instant pong extraction before heavy game state JSON decoding
        if (raw.charCodeAt(7) === 112 && raw.startsWith('{"t":"pong"')) {
          const msg = JSON.parse(raw) as ServerMsg;
          if (msg.t === 'pong') {
            if (msg.colo) this.colo = msg.colo;
            if (typeof document !== 'undefined' && document.hidden) return;
            const s = performance.now() - msg.c;
            if (s >= 0 && s < 2000) {
              this.rttWin.push(s);
              if (this.rttWin.length > 8) this.rttWin.shift();
              const sorted = [...this.rttWin].sort((a, b) => a - b);
              this.rttMin = sorted[0];
              this.rtt = sorted[Math.floor(sorted.length / 2)];

              // Auto background hot migration check:
              // If connected to non-fast node (e.g. MAD, CDG) or ping > 150ms for 3 consecutive pings,
              // automatically trigger background hot migration to silently reconnect to SIN/HKG!
              if (this.inGame && (!isFastColo(this.colo) || this.rttMin > 150)) {
                this.badPingStreak++;
                if (this.badPingStreak >= 3) {
                  this.triggerHotMigration();
                }
              } else {
                this.badPingStreak = 0;
              }
            }
          }
          return;
        }

        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'joined') {
          if (msg.colo) this.colo = msg.colo;
          if (msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) {
              this.lastJoinMsg.token = msg.token;
            }
          }
        }
        this.onMsg(msg);
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    socket.onclose = (ev) => {
      if (this.ws !== socket) return; // Stale socket guard: IGNORE if closed intentionally
      this.stopPing();
      if (ev.reason === 'Handover') {
        // Handover handled cleanly by probeSocket
        return;
      }
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.onStatus?.('error');
    };
  }

  public triggerHotMigration(): void {
    if (!this.inGame || isFastColo(this.colo) || this.closed || !this.sessionToken) return;
    const now = performance.now();
    // Throttle attempts: probe at most once every 6 seconds
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 6000) return;
    this.lastMigrationProbeTime = now;
    console.log(`[WS] High latency / non-APAC node detected (${this.colo}, ~${Math.round(this.rttMin)}ms). Starting zero-downtime hot migration probe...`);

    const probeUrl = this.url + (this.url.includes('?') ? '&' : '?') + `probe=${Date.now()}`;
    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(probeUrl);
      this.migrationWs = probeSocket;
    } catch (e) {
      console.warn('[WS] Failed to create hot migration socket:', e);
      return;
    }

    let pendingInit: ServerMsg | null = null;

    probeSocket.onopen = () => {
      if (this.migrationWs !== probeSocket || this.closed) {
        probeSocket.close();
        return;
      }
      probeSocket.send(JSON.stringify({ t: 'ping', c: Math.round(performance.now()) }));
    };

    probeSocket.onmessage = (event) => {
      if (this.migrationWs !== probeSocket || this.closed) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          const probeColo = msg.colo;
          console.log(`[WS] Hot migration probe response colo: ${probeColo}`);
          if (isFastColo(probeColo)) {
            // Optimal edge node found! Hand over existing session token
            if (this.lastJoinMsg && this.sessionToken) {
              probeSocket.send(JSON.stringify({
                ...this.lastJoinMsg,
                token: this.sessionToken,
              }));
            } else {
              probeSocket.close();
              this.migrationWs = null;
            }
          } else {
            // Not optimal, quietly close probe
            probeSocket.close();
            this.migrationWs = null;
          }
        } else if (msg.t === 'init') {
          // Buffer init so it can be delivered right before joined
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          // Handover acknowledged by server! Seamlessly swap active socket
          console.log(`[WS] Hot migration handover complete! Switched from ${this.colo} to ${msg.colo || 'APAC'}`);
          const oldWs = this.ws;
          this.ws = probeSocket;
          this.migrationWs = null;
          if (msg.colo) this.colo = msg.colo;
          if (msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) this.lastJoinMsg.token = msg.token;
          }
          this.rttWin.length = 0;

          if (oldWs) {
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            try { oldWs.close(1000, 'Handover'); } catch (_) {}
          }

          this.bindActiveSocket(probeSocket);
          this.startPing();
          if (pendingInit) {
            this.onMsg(pendingInit);
          }
          this.onMsg(msg);
          this.onMigrationSuccess?.(this.colo);
        } else if (this.ws === probeSocket) {
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('[WS] Error during hot migration:', err);
      }
    };

    const cleanupProbe = () => {
      if (this.migrationWs === probeSocket) {
        this.migrationWs = null;
      }
    };
    probeSocket.onclose = cleanupProbe;
    probeSocket.onerror = cleanupProbe;
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
        this.send({ t: 'ping', c: now });
      }
    }, 500);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, 800);
  }

  send(m: ClientMsg): void {
    let toSend = m;
    if (m.t === 'join') {
      toSend = { ...m, token: this.sessionToken || m.token };
      this.lastJoinMsg = toSend;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (m.t !== 'input') {
        this.queue.push(toSend);
      }
      return;
    }
    if (m.t === 'input' && this.ws.bufferedAmount > 65536) {
      return;
    }
    this.ws.send(JSON.stringify(toSend));
  }

  leaveGame(): void {
    this.inGame = false;
    this.sessionToken = null;
    this.lastJoinMsg = null;
    this.queue.length = 0;
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.migrationRetryTimer !== null) {
      clearTimeout(this.migrationRetryTimer);
      this.migrationRetryTimer = null;
    }
    try {
      this.send({ t: 'leave' });
    } catch (_) {}
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.autoSteerAttempts = 0;
    this.stopPing();
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rttWin.length = 0;
    this.isReconnecting = true;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
    setTimeout(() => {
      if (!this.closed) {
        this.connect();
      }
    }, 100);
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastJoinMsg = null;
    this.sessionToken = null;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
  }
}
