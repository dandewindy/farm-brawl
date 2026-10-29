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
  public displayPing = 0;
  public colo = '';
  public doColo = '';
  public inGame = false;
  public activeUrl: string;
  private reconnectTimer: number | null = null;
  private readonly rttRawSamples: number[] = [];
  private smoothedPing = 0;
  private lastPingUpdateTs = 0;
  private badPingStreak = 0;
  private lastLobbyReconnectTime = 0;
  private lobbySteerAttempts = 0;
  private currentPingDelay = 1000; // Cố định chu kỳ 1s (1000ms), tránh flooding socket
  private migrationLocked = false;
  private migrationLockTimer: number | null = null;

  public get displayColo(): string {
    // Luôn ưu tiên hiển thị trạm Edge POP thực tế (nơi người chơi kết nối vào)
    return this.colo || this.doColo || 'SIN';
  }

  public isColoHealthy(): boolean {
    // Kết nối chỉ khỏe khi độ trễ thực tế <= 160ms VÀ trạm biên thuộc châu Á
    if (this.rttMin <= 0) return true; // Chưa có mẫu ping
    if (this.rttMin > 160) return false;
    return isFastColo(this.colo) && this.rttMin <= 140;
  }

  private lockMigration(durationMs = 12000): void {
    this.migrationLocked = true;
    if (this.migrationLockTimer !== null) clearTimeout(this.migrationLockTimer);
    this.migrationLockTimer = window.setTimeout(() => {
      this.migrationLocked = false;
      this.migrationLockTimer = null;
    }, durationMs);
  }

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
    this.activeUrl = url;
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
      socket = new WebSocket(this.activeUrl);
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
            if (msg.doColo) this.doColo = msg.doColo;
            if (typeof document !== 'undefined' && document.hidden) return;
            const sample = performance.now() - msg.c;
            if (sample > 0 && sample < 1500) {
              // 1. Cập nhật cửa sổ mẫu (20 mẫu ~ 20s ổn định)
              this.rttRawSamples.push(sample);
              if (this.rttRawSamples.length > 20) {
                this.rttRawSamples.shift();
              }

              // 2. Spike Rejection & 25th Percentile Baseline
              const sorted = [...this.rttRawSamples].sort((a, b) => a - b);
              this.rttMin = sorted[0];
              const p25Index = Math.floor(sorted.length * 0.25);
              const baseRtt = sorted[p25Index];
              this.rtt = sorted[Math.floor(sorted.length / 2)];

              // 3. Asymmetric EWMA (Làm mượt bất đối xứng)
              if (this.smoothedPing === 0 || this.rttRawSamples.length <= 2) {
                this.smoothedPing = baseRtt;
              } else {
                // Giảm nhanh (alpha = 0.4) khi mạng tốt hơn, tăng điềm tĩnh (alpha = 0.1) khi có spike/jitter
                const alpha = baseRtt < this.smoothedPing ? 0.4 : 0.1;
                this.smoothedPing = alpha * baseRtt + (1 - alpha) * this.smoothedPing;
              }

              // 4. Deadband & Throttle cho HUD Display (cập nhật 1s/lần hoặc lệch >= 2ms)
              const now = performance.now();
              const candidatePing = Math.round(this.smoothedPing);
              if (now - this.lastPingUpdateTs >= 1000 || this.displayPing === 0) {
                if (Math.abs(candidatePing - this.displayPing) >= 2 || this.displayPing === 0) {
                  this.displayPing = candidatePing;
                }
                this.lastPingUpdateTs = now;
              }

              // 5. Watchdog kiểm tra định tuyến
              const isHealthy = this.isColoHealthy();
              const isOptimal = (this.colo === 'SIN' || this.colo === 'HKG') && this.rttMin <= 90;
              const isCriticalSlow = !isHealthy && (this.rttMin > 160 || !isFastColo(this.colo));

              if (isOptimal || (isHealthy && this.rttMin <= 120)) {
                this.lobbySteerAttempts = 0;
                this.badPingStreak = 0;
              } else if (isCriticalSlow) {
                this.badPingStreak++;
              } else {
                this.badPingStreak = Math.max(0, this.badPingStreak - 1);
              }

              // Silent Lobby Steer: khi ở sảnh nếu kết nối bị chậm (>160ms) hoặc ngoài châu Á
              if (!this.inGame && isCriticalSlow && !this.closed) {
                if (this.rttRawSamples.length >= 2 && this.lobbySteerAttempts < 3) {
                  if (now - this.lastLobbyReconnectTime > 3000) {
                    this.lastLobbyReconnectTime = now;
                    this.lobbySteerAttempts++;
                    console.log(`[WS Watchdog] Lobby on non-optimal node (${this.colo}, ~${Math.round(this.rttMin)}ms). Attempt ${this.lobbySteerAttempts}/3 switching route...`);
                    this.steerToBestRoute();
                  }
                }
              }

              // Hot migration trong trận: khi lag liên tục (streak >= 3, rttMin > 170ms hoặc ngoài châu Á)
              if (this.inGame && this.badPingStreak >= 3 && !this.migrationLocked && !this.closed) {
                this.triggerHotMigration();
              }
            }
          }
          return;
        }

        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'joined') {
          if (msg.colo) this.colo = msg.colo;
          if (msg.doColo) this.doColo = msg.doColo;
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

  private getCandidateUrls(): string[] {
    const urls: string[] = [];
    try {
      const u = new URL(this.activeUrl);
      const isDev = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (isDev) return [this.activeUrl];

      const search = u.search;
      const isCustom = u.hostname.includes('get-go.site');

      if (isCustom) {
        // Tên miền riêng bị ISP đưa qua châu Âu -> Thử ngay workers.dev cùng tài khoản và tài khoản 1
        urls.push(`wss://farm-brawl.windydande.workers.dev/ws${search}`);
        urls.push(`wss://farm-brawl.farm-brawl.workers.dev/ws${search}`);
        urls.push(this.activeUrl);
      } else if (u.hostname.includes('windydande.workers.dev')) {
        urls.push(`wss://brawl.get-go.site/ws${search}`);
        urls.push(`wss://farm-brawl.farm-brawl.workers.dev/ws${search}`);
        urls.push(this.activeUrl);
      } else {
        urls.push(`wss://farm-brawl.windydande.workers.dev/ws${search}`);
        urls.push(`wss://brawl.get-go.site/ws${search}`);
        urls.push(this.activeUrl);
      }
    } catch (_) {
      urls.push(this.activeUrl);
    }
    return urls;
  }

  public steerToBestRoute(): void {
    if (this.closed || this.inGame) return;
    const candidates = this.getCandidateUrls();
    const nextUrl = candidates[this.lobbySteerAttempts % candidates.length];
    this.activeUrl = nextUrl;
    try { sessionStorage.setItem('fb_fast_host', new URL(nextUrl).host); } catch (_) {}
    this.forceReconnect();
  }

  public triggerHotMigration(force = false): void {
    if (!this.inGame || this.closed) return;
    if (!force && this.migrationLocked) return;
    // Strict Guard: Nếu ping đang tốt (<= 120ms) và trạm châu Á thì không cần di dời
    if (!force && this.isColoHealthy() && this.rttMin <= 120) {
      this.isMigrating = false;
      this.badPingStreak = 0;
      return;
    }
    const now = performance.now();
    // Throttle attempts: probe cách nhau tối thiểu 2.5s
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 2500) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);

    const candidates = this.getCandidateUrls();
    const candidateUrl = candidates[this.probeAttempts % candidates.length];
    const probeUrl = candidateUrl + (candidateUrl.includes('?') ? '&' : '?') + `probe=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;

    console.log(`[WS Watchdog] High latency / non-APAC node detected (${this.colo}, ~${Math.round(this.rttMin)}ms). Starting hot migration probe on ${new URL(candidateUrl).host}...`);
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
        if (this.probeAttempts >= candidates.length) {
          this.probeAttempts = 0;
          this.badPingStreak = 0;
          this.lockMigration(12000);
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
          console.log(`[WS Watchdog] Hot migration probe response from ${new URL(candidateUrl).host}: colo=${probeColo}, rtt=${Math.round(probeRtt)}ms`);
          const currentlyFast = isFastColo(this.colo);
          const isProbeFast = isFastColo(probeColo);

          // Điều kiện chuyển tuyến ưu tiên:
          // 1. Trạm hiện tại ngoài châu Á (WAW/FRA/CDG/SJC) và trạm probe thuộc châu Á
          // 2. Hoặc trạm probe có độ trễ thấp hơn rõ rệt (< 85% rtt hiện tại)
          // 3. Hoặc trạm probe là SIN/HKG với ping <= 120ms và ping hiện tại > 130ms
          const isBetter = (!currentlyFast && isProbeFast)
            || (isProbeFast && probeRtt > 0 && probeRtt < this.rttMin * 0.85)
            || (probeRtt > 0 && probeRtt < this.rttMin * 0.65)
            || ((probeColo === 'SIN' || probeColo === 'HKG') && probeRtt <= 120 && this.rttMin > 130);

          if (isBetter) {
            this.probeAttempts = 0;
            this.activeUrl = candidateUrl;
            try { sessionStorage.setItem('fb_fast_host', new URL(candidateUrl).host); } catch (_) {}
            // Hand over existing session token
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
            console.log(`[WS Watchdog] Probe landed on ${probeColo} (~${Math.round(probeRtt)}ms), not optimal (attempt ${this.probeAttempts}/${candidates.length}).`);
            if (this.probeAttempts >= candidates.length) {
              this.probeAttempts = 0;
              this.badPingStreak = 0;
              this.lockMigration(12000);
            }
          }
        } else if (msg.t === 'init') {
          // Buffer init so it can be delivered right before joined
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          // Handover acknowledged by server! Seamlessly swap active socket
          clearTimeout(probeTimeout);
          this.probeAttempts = 0;
          this.activeUrl = candidateUrl;
          try { sessionStorage.setItem('fb_fast_host', new URL(candidateUrl).host); } catch (_) {}
          console.log(`[WS Watchdog] Hot migration handover complete! Switched from ${this.colo} to ${msg.colo || 'APAC'} on ${new URL(candidateUrl).host}`);
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
          if (msg.doColo) this.doColo = msg.doColo;
          if (msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) this.lastJoinMsg.token = msg.token;
          }
          this.rttRawSamples.length = 0;
          this.smoothedPing = 0;
          this.displayPing = 0;
          this.badPingStreak = 0;
          this.currentPingDelay = 1000;

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

  public manualRetune(): void {
    this.migrationLocked = false;
    this.probeAttempts = 0;
    this.badPingStreak = 0;
    if (this.inGame) {
      this.triggerHotMigration(true);
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
    this.rttRawSamples.length = 0;
    this.smoothedPing = 0;
    this.displayPing = 0;
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
