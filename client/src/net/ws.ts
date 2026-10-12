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

      if (this.lastJoinMsg) {
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
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          if (msg.colo) this.colo = msg.colo;
          if (typeof document !== 'undefined' && document.hidden) return;
          const s = performance.now() - msg.c;
          if (s >= 0 && s < 2000) {
            this.rttWin.push(s);
            if (this.rttWin.length > 5) this.rttWin.shift();
            const sorted = [...this.rttWin].sort((a, b) => a - b);
            this.rttMin = sorted[0];
            this.rtt = sorted[Math.floor(sorted.length / 2)];
          }
          // High latency detection: non-fast PoP or RTT > 120ms
          const isHighLatency = !isFastColo(this.colo) || this.rtt > 120;
          if (!this.inGame && isHighLatency && this.autoSteerAttempts < 10) {
            this.autoSteerAttempts++;
            console.log(`[WS] High latency edge node detected in lobby (${this.colo}, ${Math.round(this.rtt)}ms). Auto-steering to Singapore (attempt ${this.autoSteerAttempts}/10)...`);
            setTimeout(() => {
              if (!this.closed && !this.inGame && this.ws === socket) {
                this.forceReconnect();
              }
            }, 100);
          } else if (this.inGame && isHighLatency) {
            this.triggerHotMigration();
          }
        } else {
          if (msg.t === 'joined') {
            if (msg.colo) this.colo = msg.colo;
            if (msg.token) {
              this.sessionToken = msg.token;
              if (this.lastJoinMsg) {
                this.lastJoinMsg.token = msg.token;
              }
            }
            const isHighLatency = !isFastColo(this.colo) || this.rtt > 120;
            if (this.inGame && isHighLatency) {
              this.triggerHotMigration();
            }
          }
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return; // Stale socket guard: IGNORE if closed intentionally
      this.stopPing();
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
    // Throttle attempts: probe at most once every 400ms while searching for SIN/HKG
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 400) return;
    this.lastMigrationProbeTime = now;
    console.log(`[WS] In-game high latency node detected (${this.colo}). Starting zero-downtime hot migration probe...`);

    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(this.url);
      this.migrationWs = probeSocket;
    } catch (e) {
      console.warn('[WS] Failed to create hot migration socket:', e);
      return;
    }

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
            // Still not optimal, quietly close probe and quickly retry
            probeSocket.close();
            this.migrationWs = null;
            if (this.inGame && !isFastColo(this.colo)) {
              if (this.migrationRetryTimer !== null) clearTimeout(this.migrationRetryTimer);
              this.migrationRetryTimer = window.setTimeout(() => {
                this.triggerHotMigration();
              }, 400);
            }
          }
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
            try { oldWs.close(); } catch (_) {}
          }

          this.bindActiveSocket(probeSocket);
          this.startPing();
          this.onMsg(msg);
          this.onMigrationSuccess?.(this.colo);
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
    }, 1000);
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
    if (m.t === 'join') {
      this.lastJoinMsg = { ...m, token: this.sessionToken || m.token };
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (m.t !== 'input') {
        this.queue.push(m);
      }
      return;
    }
    if (m.t === 'input' && this.ws.bufferedAmount > 65536) {
      return;
    }
    this.ws.send(JSON.stringify(m));
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
