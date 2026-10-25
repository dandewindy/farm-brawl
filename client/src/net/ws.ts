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

  // Khóa chống probe liên tục khi ISP cố định tuyến Anycast hoặc khi trạm hiện tại đã tối ưu
  private routeLockedUntil = 0;
  private endpointIdx = 0;
  private readonly endpoints: string[];

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
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void,
    altUrls: string[] = []
  ) {
    this.endpoints = [url, ...altUrls.filter((u) => u && u !== url)];
    try {
      this.sessionToken = sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) || sessionStorage.getItem('fb_session_token');
    } catch (_) {}
    this.connect();
  }

  private getActiveUrl(): string {
    return this.endpoints[this.endpointIdx % this.endpoints.length];
  }

  private nextEndpointUrl(): string {
    if (this.endpoints.length > 1) {
      this.endpointIdx = (this.endpointIdx + 1) % this.endpoints.length;
    }
    return this.getActiveUrl();
  }

  private getRoomKey(): string {
    try {
      const u = new URL(this.url);
      return u.searchParams.get('room') || 'pub-1';
    } catch {
      return 'pub-1';
    }
  }

  private connect(customUrl?: string): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.migrationRetryTimer ?? undefined);
      this.reconnectTimer = null;
    }
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(customUrl || this.getActiveUrl());
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
              const now = performance.now();

              if (onFastNode) {
                this.lobbySteerAttempts = 0;
              }

              // Bad ping streak:
              // Mạng Đông Nam Á (SIN/HKG) ping 40-110ms là hoàn toàn bình thường và ổn định
              // Chỉ coi là bất thường khi ping vượt quá 130ms liên tục
              if (onFastNode && this.rtt <= 110) {
                this.badPingStreak = 0;
              } else if (now < this.routeLockedUntil) {
                this.badPingStreak = 0;
              } else if (!onFastNode) {
                this.badPingStreak++;
              } else if (this.rtt > 130) {
                this.badPingStreak++;
              } else {
                this.badPingStreak = 0;
              }

              const targetDelay = (this.rtt > 120 || !onFastNode) && now >= this.routeLockedUntil ? 400 : 500;
              if (targetDelay !== this.currentPingDelay) {
                this.currentPingDelay = targetDelay;
                this.startPing();
              }

              // ── LOBBY STEER ──
              // Chỉ steer trong lobby khi node ngoài châu Á và ping > 150ms
              if (!this.inGame && !onFastNode && this.rtt > 150 && !this.closed && now >= this.routeLockedUntil) {
                if (this.rttWin.length >= 3 && this.lobbySteerAttempts < 2) {
                  if (now - this.lastLobbyReconnectTime > 5000) {
                    this.lastLobbyReconnectTime = now;
                    this.lobbySteerAttempts++;
                    this.nextEndpointUrl();
                    console.log(`[WS] Lobby steer: ${this.colo} ~${Math.round(this.rtt)}ms, attempt ${this.lobbySteerAttempts}/2`);
                    this.forceReconnect();
                  }
                } else if (this.lobbySteerAttempts >= 2) {
                  this.routeLockedUntil = now + 90000;
                }
              }

              // ── IN-GAME ZERO-DOWNTIME MIGRATION ──
              // Chỉ tự động dò khi có ít nhất 5 mẫu và 6 lần liên tục ping xấu (> 130ms hoặc ngoài châu Á)
              if (this.inGame && this.rttWin.length >= 5 && this.badPingStreak >= 6 && !this.closed && now >= this.routeLockedUntil) {
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
      if (ev.reason === 'Handover') return;
      if (this.isMigrating && this.migrationWs !== null) return;
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      if (this.isMigrating && this.migrationWs !== null) return;
      this.onStatus?.('error');
    };
  }

  private abortProbe(probeSocket: WebSocket, probeTimeout: number): void {
    clearTimeout(probeTimeout);
    if (this.migrationWs === probeSocket) {
      this.migrationWs = null;
      this.isMigrating = false;
    }
    try {
      probeSocket.onopen = null;
      probeSocket.onmessage = null;
      probeSocket.onclose = null;
      probeSocket.onerror = null;
      probeSocket.close();
    } catch (_) {}

    // Cứu hộ Deadlock: Nếu socket chính đã đóng trong lúc đang probe, phải kết nối lại ngay!
    if (!this.closed && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
      this.isReconnecting = true;
      this.scheduleReconnect();
    }
  }

  public triggerHotMigration(isManual = false): void {
    if (!this.inGame || this.closed) return;
    const now = performance.now();
    // Throttle: ít nhất 10 giây giữa các lần tự động probe
    if (this.migrationWs !== null || (!isManual && now - this.lastMigrationProbeTime < 10000)) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    if (isManual) {
      this.onMigrationStatus?.('probing', this.colo);
    }

    const baseTargetUrl = this.nextEndpointUrl();
    const probeUrl = baseTargetUrl + (baseTargetUrl.includes('?') ? '&' : '?') + `probe=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;
    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(probeUrl);
      this.migrationWs = probeSocket;
    } catch (e) {
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
      return;
    }

    const probeTimeout = window.setTimeout(() => {
      if (this.migrationWs === probeSocket) {
        this.probeAttempts++;
        this.abortProbe(probeSocket, probeTimeout);
        this.onMigrationStatus?.('failed', this.colo);
        if (this.probeAttempts >= 2) {
          this.probeAttempts = 0;
          this.badPingStreak = 0;
          this.routeLockedUntil = performance.now() + 120000; // Khóa 2 phút nếu probe thất bại
        }
      }
    }, 2500);

    let pendingInit: ServerMsg | null = null;
    let hadExistingSession = false;

    probeSocket.onopen = () => {
      if (this.migrationWs !== probeSocket || this.closed) {
        this.abortProbe(probeSocket, probeTimeout);
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

          const probeIsFast = isFastColo(probeColo);
          const currentIsFast = isFastColo(this.colo);
          let shouldSwitch = false;

          if (probeRtt > 0) {
            if (!currentIsFast && probeIsFast) {
              // Từ trạm ngoài châu Á chuyển về trạm châu Á: luôn chuyển!
              shouldSwitch = true;
            } else if (probeIsFast && currentIsFast) {
              // Cả 2 đều ở châu Á:
              // NẾU CÙNG POP (ví dụ SIN -> SIN): KHÔNG BAO GIỜ TỰ ĐỘNG CHUYỂN! Cùng POP thì cùng tuyến cáp, đổi socket chỉ gây nghẽn và gián đoạn.
              if (probeColo !== this.colo && probeRtt < this.rtt - 25 && probeRtt < this.rtt * 0.75) {
                // Khác POP (ví dụ HKG -> SIN hoặc ngược lại) VÀ nhanh hơn hẳn >= 25ms & > 25%: chuyển!
                shouldSwitch = true;
              } else if (isManual && probeRtt < this.rtt - 35) {
                // Chỉ cho phép cùng POP nếu người dùng chủ động bấm retune và probe nhanh hơn hẳn 35ms
                shouldSwitch = true;
              }
            } else if (!currentIsFast && !probeIsFast && probeColo !== this.colo && probeRtt < this.rtt - 45) {
              // Cả 2 đều ngoài châu Á: CHỈ chuyển nếu khác trạm và nhanh hơn hẳn 45ms (chặn loop FRA -> FRA)
              shouldSwitch = true;
            }
          }

          if (shouldSwitch && this.lastJoinMsg) {
            if (probeIsFast) this.probeAttempts = 0;
            hadExistingSession = !!this.sessionToken;
            probeSocket.send(JSON.stringify({
              ...this.lastJoinMsg,
              token: this.sessionToken || undefined,
            }));
          } else {
            this.probeAttempts++;
            this.abortProbe(probeSocket, probeTimeout);
            this.onMigrationStatus?.('failed', this.colo);
            if (this.probeAttempts >= 2) {
              this.probeAttempts = 0;
              this.badPingStreak = 0;
              this.routeLockedUntil = performance.now() + 120000; // Khóa 2 phút nếu probe không tìm thấy tuyến tốt hơn
            }
          }
        } else if (msg.t === 'init') {
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          clearTimeout(probeTimeout);
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

          if (!isFastColo(this.colo)) {
            this.routeLockedUntil = performance.now() + 90000;
          } else {
            this.probeAttempts = 0;
            this.routeLockedUntil = 0;
          }

          if (oldWs) {
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            try { oldWs.close(1000, 'Handover'); } catch (_) {}
          }

          this.bindActiveSocket(probeSocket);
          this.startPing();

          // Chỉ nạp init nếu chưa từng có session (không reset map khi đang chơi)
          if (pendingInit && !hadExistingSession) {
            this.onMsg(pendingInit);
          }
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
      if (this.migrationWs === probeSocket) {
        this.abortProbe(probeSocket, probeTimeout);
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
    this.routeLockedUntil = 0;
    this.badPingStreak = 6;
    this.probeAttempts = 0;
    if (this.inGame) {
      if (this.migrationWs) {
        try { this.migrationWs.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
      }
      this.lastMigrationProbeTime = 0;
      this.triggerHotMigration(true);
    } else {
      this.nextEndpointUrl();
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
