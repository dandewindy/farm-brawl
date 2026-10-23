import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export function isFastColo(colo?: string): boolean {
  if (!colo) return false;
  return /^(SIN|HKG|HAN|SGN|DAD|BKK|KUL|TPE|KHH|MNL|CEB|NRT|HND|KIX|FUK|OKA|ICN|PUS|CGK|DPS|PNH|VTE|BNY|RGN|CAN|SZX|APAC)$/i.test(colo);
}

export class WsClient implements Transport {
  private ws: WebSocket | null = null;
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private isReconnecting = false;
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;
  public sessionToken: string | null = null;
  private pingInterval: number | null = null;
  public rtt = 0;
  public rttMin = 0;
  public colo = '';
  public inGame = false;
  private reconnectTimer: number | null = null;
  private readonly rttWin: number[] = [];
  private badPingStreak = 0;
  private lastLobbyReconnectTime = 0;
  private lobbySteerAttempts = 0;
  private currentPingDelay = 500;

  // In-Game Zero-Downtime Hot Migration
  public isMigrating = false;
  private migrationWs: WebSocket | null = null;
  private lastMigrationProbeTime = 0;
  private probeAttempts = 0;
  private migrationRetryTimer: number | null = null;
  public onMigrationSuccess?: (newColo: string) => void;
  public onMigrationStatus?: (status: 'probing' | 'migrated' | 'failed', colo?: string) => void;

  constructor(
    private readonly url: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void
  ) {
    try {
      this.sessionToken = sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) || sessionStorage.getItem('fb_session_token');
    } catch (_) {}
    this.connect();
  }

  private getRoomKey(): string {
    try {
      const u = new URL(this.url);
      return u.searchParams.get('room') || 'pub-1';
    } catch {
      return 'pub-1';
    }
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
      const connectUrl = this.url + (this.url.includes('?') ? '&' : '?') + '_r=' + Date.now();
      socket = new WebSocket(connectUrl);
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
        // Fast-path: instant pong extraction
        if (raw.startsWith('{"t":"pong"')) {
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

              const isSin = this.colo === 'SIN';
              const onFastNode = isFastColo(this.colo);
              // A route is optimal if connected to Singapore (SIN) with good ping, or any node with <= 55ms ping
              const isOptimal = (isSin && this.rttMin <= 75) || this.rttMin <= 55;

              if (isOptimal) {
                this.lobbySteerAttempts = 0;
                this.badPingStreak = 0;
              } else if (!onFastNode || this.rttMin > 100) {
                this.badPingStreak = Math.min(6, this.badPingStreak + 1);
              } else {
                this.badPingStreak = Math.max(0, this.badPingStreak - 1);
              }

              // 1. Silent Lobby Steer (Max 3 attempts):
              // If in lobby and NOT on an optimal Singapore / low-ping route (e.g. landed on HKG with high ping > 65ms,
              // or landed on a distant overseas node):
              // Automatically steer (reconnect) to seek Singapore (SIN) where ping for Vietnam is ~30-40ms!
              if (!this.inGame && !isOptimal && !this.closed) {
                if (this.rttWin.length >= 2 && this.lobbySteerAttempts < 3) {
                  const now = performance.now();
                  if (now - this.lastLobbyReconnectTime > 3500) {
                    this.lastLobbyReconnectTime = now;
                    this.lobbySteerAttempts++;
                    console.log(`[WS Watchdog] Seeking Singapore (SIN) low-ping route (currently on ${this.colo}, ~${Math.round(this.rttMin)}ms). Attempt ${this.lobbySteerAttempts}/3...`);
                    this.forceReconnect();
                  }
                }
              }

              // 2. Active In-Game Hot Migration Watchdog:
              // During live gameplay: If ping is consistently poor (badPingStreak >= 4 and rttMin > 90) and NOT on optimal SIN,
              // probe zero-downtime hot migration in background to find a Singapore route!
              if (this.inGame && this.badPingStreak >= 4 && !isOptimal && !this.closed) {
                this.triggerHotMigration();
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
            try {
              sessionStorage.setItem(`fb_tok_${this.getRoomKey()}`, msg.token);
              sessionStorage.setItem('fb_session_token', msg.token);
            } catch (_) {}
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
      if (this.isMigrating || this.migrationWs !== null) {
        // Handover handled cleanly by migration probe; ignore close of old socket
        return;
      }
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
      if (this.isMigrating || this.migrationWs !== null) return;
      this.onStatus?.('error');
    };
  }

  public triggerHotMigration(): void {
    if (!this.inGame || this.closed) return;
    // Strict Guard: If currently on Singapore with optimal ping (<= 75ms), NEVER migrate!
    if (this.colo === 'SIN' && this.rttMin <= 75) {
      this.isMigrating = false;
      this.badPingStreak = 0;
      return;
    }
    const now = performance.now();
    // Throttle attempts: probe at most once every 3.0 seconds
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 3000) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);
    console.log(`[WS Watchdog] High latency / non-APAC node detected (${this.colo}, ~${Math.round(this.rttMin)}ms). Starting zero-downtime hot migration probe...`);

    const probeUrl = this.url + (this.url.includes('?') ? '&' : '?') + `probe=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;
    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(probeUrl);
      this.migrationWs = probeSocket;
    } catch (e) {
      console.warn('[WS Watchdog] Failed to create hot migration socket:', e);
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
      return;
    }

    // Auto-timeout probe socket if it hangs or takes longer than 2.0s
    const probeTimeout = window.setTimeout(() => {
      if (this.migrationWs === probeSocket) {
        console.warn('[WS Watchdog] Probe socket connection timed out.');
        try { probeSocket.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
        this.probeAttempts++;
        this.onMigrationStatus?.('failed', this.colo);
        if (this.probeAttempts >= 3) {
          this.probeAttempts = 0;
          this.badPingStreak = 0;
        }
      }
    }, 2000);

    let pendingInit: ServerMsg | null = null;

    probeSocket.onopen = () => {
      if (this.migrationWs !== probeSocket || this.closed) {
        clearTimeout(probeTimeout);
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
          const probeRtt = performance.now() - msg.c;
          console.log(`[WS Watchdog] Hot migration probe response colo: ${probeColo}, rtt: ${Math.round(probeRtt)}ms`);
          const currentlyFast = isFastColo(this.colo);
          // If already on a fast Asian node (SIN/HKG), ONLY switch if the probe is ALSO fast AND significantly better (at least 25% lower latency)
          // If on a slow/distant node (FRA/MAD/ORD...), switch if probe is a fast Asian node OR has at least 35% lower latency
          const isBetter = probeColo === 'SIN'
            ? (probeRtt > 0 && probeRtt < this.rttMin - 10)
            : currentlyFast
            ? (isFastColo(probeColo) && probeRtt > 0 && probeRtt < this.rttMin * 0.75)
            : (isFastColo(probeColo) || (probeRtt > 0 && probeRtt < this.rttMin * 0.65));

          if (isBetter) {
            this.probeAttempts = 0;
            // Optimal edge node found! Hand over existing session token
            if (this.lastJoinMsg) {
              probeSocket.send(JSON.stringify({
                ...this.lastJoinMsg,
                token: this.sessionToken || undefined,
              }));
            } else {
              clearTimeout(probeTimeout);
              probeSocket.close();
              this.migrationWs = null;
              this.isMigrating = false;
              this.onMigrationStatus?.('failed', this.colo);
            }
          } else {
            // Not optimal yet, quietly close probe
            clearTimeout(probeTimeout);
            probeSocket.close();
            this.migrationWs = null;
            this.isMigrating = false;
            this.probeAttempts++;
            this.onMigrationStatus?.('failed', this.colo);
            console.log(`[WS Watchdog] Probe landed on ${probeColo} (~${Math.round(probeRtt)}ms), not optimal (attempt ${this.probeAttempts}/3).`);
            if (this.probeAttempts >= 3) {
              this.probeAttempts = 0;
              this.badPingStreak = 0;
            }
          }
        } else if (msg.t === 'init') {
          // Buffer init so it can be delivered right before joined
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          // Handover acknowledged by server! Seamlessly swap active socket
          clearTimeout(probeTimeout);
          this.probeAttempts = 0;
          console.log(`[WS Watchdog] Hot migration handover complete! Switched from ${this.colo} to ${msg.colo || 'APAC'}`);
          const oldWs = this.ws;
          this.ws = probeSocket;
          this.migrationWs = null;
          this.isMigrating = false;
          this.isReconnecting = false;
          if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          if (msg.colo) this.colo = msg.colo;
          if (msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) this.lastJoinMsg.token = msg.token;
          }
          this.rttWin.length = 0;
          this.badPingStreak = 0;
          this.currentPingDelay = 500;

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
          this.onMigrationStatus?.('migrated', this.colo);
          this.onMigrationSuccess?.(this.colo);
        } else if (this.ws === probeSocket) {
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('[WS Watchdog] Error during hot migration:', err);
      }
    };

    const cleanupProbe = () => {
      clearTimeout(probeTimeout);
      if (this.migrationWs === probeSocket) {
        this.migrationWs = null;
        this.isMigrating = false;
        // If the main socket closed while probe was in progress, ensure we reconnect
        if (!this.closed && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
          this.scheduleReconnect();
        }
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
    }, this.currentPingDelay);
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
    this.isMigrating = false;
    this.sessionToken = null;
    this.lastJoinMsg = null;
    this.queue.length = 0;
    try {
      sessionStorage.removeItem(`fb_tok_${this.getRoomKey()}`);
      sessionStorage.removeItem('fb_session_token');
    } catch (_) {}
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
    this.stopPing();
    this.probeAttempts = 0;
    this.isMigrating = false;
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
    }, 80);
  }

  close(): void {
    this.closed = true;
    this.isMigrating = false;
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
