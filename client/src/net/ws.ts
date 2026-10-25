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
      if (this.ws !== socket) return;
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

              const onFastNode = isFastColo(this.colo);

              if (onFastNode) this.lobbySteerAttempts = 0;

              // Bad ping streak:
              // <= 90ms on fast node: excellent → reset
              // > 90ms on fast node: suboptimal → increment (seek better route)
              // Non-fast node: immediately alert
              if (onFastNode && this.rtt <= 85 && s <= 95) {
                this.badPingStreak = 0;
              } else if (!onFastNode) {
                this.badPingStreak = Math.max(3, this.badPingStreak + 1);
              } else {
                this.badPingStreak++;
              }

              // Ping faster when suboptimal (> 85ms) to accelerate route probing
              const targetDelay = this.rtt > 85 || !onFastNode ? 300 : 500;
              if (targetDelay !== this.currentPingDelay) {
                this.currentPingDelay = targetDelay;
                this.startPing();
              }

              // ── LOBBY STEER ──
              // When in lobby with elevated ping (> 100ms), actively reconnect to find a lower-latency route
              if (!this.inGame && this.rtt > 100 && !this.closed) {
                if (this.rttWin.length >= 2 && this.lobbySteerAttempts < 3) {
                  const now = performance.now();
                  if (now - this.lastLobbyReconnectTime > 3500) {
                    this.lastLobbyReconnectTime = now;
                    this.lobbySteerAttempts++;
                    console.log(`[WS] Lobby steer: ${this.colo} ~${Math.round(this.rtt)}ms, attempt ${this.lobbySteerAttempts}/3`);
                    this.forceReconnect();
                  }
                }
              }

              // ── IN-GAME ZERO-DOWNTIME MIGRATION ──
              // When ping > 90ms for 3+ consecutive pongs, silently probe for a faster route.
              // This NEVER interrupts gameplay — it opens a separate probe socket.
              // If the probe finds a faster route, it seamlessly swaps the socket (zero-downtime).
              // If not, nothing happens and the player keeps playing normally.
              if (this.inGame && this.badPingStreak >= 3 && !this.closed) {
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
      if (this.ws !== socket) return;
      this.stopPing();
      if (this.isMigrating || this.migrationWs !== null) return;
      if (ev.reason === 'Handover') return;
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
    const now = performance.now();
    // Throttle: probe at most once every 3s
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 3000) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);
    console.log(`[WS] Probe: current ${this.colo} ~${Math.round(this.rtt)}ms, seeking faster route...`);

    const probeUrl = this.url + (this.url.includes('?') ? '&' : '?') + `probe=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;
    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(probeUrl);
      this.migrationWs = probeSocket;
    } catch (e) {
      console.warn('[WS] Failed to create probe socket:', e);
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
      return;
    }

    const probeTimeout = window.setTimeout(() => {
      if (this.migrationWs === probeSocket) {
        try { probeSocket.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
        this.probeAttempts++;
        this.onMigrationStatus?.('failed', this.colo);
        // After 5 failed probes, accept current route (ISP won't change Anycast routing)
        if (this.probeAttempts >= 5) {
          this.probeAttempts = 0;
          this.badPingStreak = 0;
          console.log('[WS] Accepting current route after 5 failed probes.');
        }
      }
    }, 2500);

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
          console.log(`[WS] Probe: ${probeColo} ~${Math.round(probeRtt)}ms vs current ${this.colo} ~${Math.round(this.rtt)}ms`);

          const probeIsFast = isFastColo(probeColo);
          const currentIsFast = isFastColo(this.colo);
          let shouldSwitch = false;

          if (probeRtt > 0) {
            if (!currentIsFast && probeIsFast) {
              // Non-Asian → Asian: always switch
              shouldSwitch = true;
            } else if (probeColo !== this.colo && probeIsFast && probeRtt < this.rtt - 10) {
              // Different faster Asian POP (e.g. HKG ~85ms → SIN ~45ms)
              shouldSwitch = true;
            } else if (probeRtt < this.rtt - 20) {
              // Any route (including fresh connection to same POP) that is >= 20ms faster: switch!
              shouldSwitch = true;
            } else if (this.rtt > 85 && probeRtt < this.rtt * 0.8) {
              // At least 20% latency reduction when current ping is elevated: switch!
              shouldSwitch = true;
            }
          }

          if (shouldSwitch && this.lastJoinMsg) {
            this.probeAttempts = 0;
            console.log(`[WS] Switching: ${this.colo} ~${Math.round(this.rtt)}ms → ${probeColo} ~${Math.round(probeRtt)}ms`);
            probeSocket.send(JSON.stringify({
              ...this.lastJoinMsg,
              token: this.sessionToken || undefined,
            }));
          } else {
            clearTimeout(probeTimeout);
            try { probeSocket.close(); } catch (_) {}
            this.migrationWs = null;
            this.isMigrating = false;
            this.probeAttempts++;
            this.onMigrationStatus?.('failed', this.colo);
            if (this.probeAttempts >= 6) {
              this.probeAttempts = 0;
              this.badPingStreak = 0;
              console.log('[WS] Accepting current route after 6 failed probes.');
            }
          }
        } else if (msg.t === 'init') {
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          // Seamless handover complete! Swap sockets without disruption.
          clearTimeout(probeTimeout);
          this.probeAttempts = 0;
          console.log(`[WS] Migrated: ${this.colo} → ${msg.colo || 'unknown'} (zero-downtime, no respawn)`);
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
          if (pendingInit) this.onMsg(pendingInit);
          this.onMsg(msg);
          this.onMigrationStatus?.('migrated', this.colo);
          this.onMigrationSuccess?.(this.colo);
        } else if (this.ws === probeSocket) {
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('[WS] Error during migration:', err);
      }
    };

    const cleanupProbe = () => {
      clearTimeout(probeTimeout);
      if (this.migrationWs === probeSocket) {
        this.migrationWs = null;
        this.isMigrating = false;
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

  public manualRetune(): void {
    if (this.closed) return;
    this.badPingStreak = 3;
    this.probeAttempts = 0;
    if (this.inGame) {
      if (this.migrationWs) {
        try { this.migrationWs.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
      }
      this.lastMigrationProbeTime = 0;
      this.triggerHotMigration();
    } else {
      this.forceReconnect();
    }
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
