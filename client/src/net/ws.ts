import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export function isTier0Colo(colo?: string): boolean {
  if (!colo) return false;
  return /^(SIN|HKG|HAN|SGN|DAD|BKK|KUL|PNH|VTE)$/i.test(colo);
}

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
  public isAfk = false;
  public activeUrl: string;
  private reconnectTimer: number | null = null;
  private readonly rttRawSamples: number[] = [];
  private smoothedPing = 0;
  private lastPingUpdateTs = 0;
  private badPingStreak = 0;
  private currentPingDelay = 1000; // Cố định chu kỳ 1s (1000ms), tránh flooding socket
  private migrationLocked = false;
  private migrationLockTimer: number | null = null;

  public get displayColo(): string {
    // Luôn ưu tiên hiển thị trạm Edge POP thực tế (nơi người chơi kết nối vào)
    return this.colo || this.doColo || 'SIN';
  }

  public isColoHealthy(): boolean {
    if (!this.colo) return true;
    // Chỉ coi là khỏe khi đang ở trạm Tier 0 (SIN, HKG, SGN...) và ping ổn định
    if (!isTier0Colo(this.colo)) return false;
    if (this.rttMin <= 0) return true;
    return this.rttMin <= 95;
  }

  private lockMigration(durationMs = 6000): void {
    this.migrationLocked = true;
    if (this.migrationLockTimer !== null) clearTimeout(this.migrationLockTimer);
    this.migrationLockTimer = window.setTimeout(() => {
      this.migrationLocked = false;
      this.migrationLockTimer = null;
    }, durationMs);
  }

  // Zero-Downtime Parallel Multi-Probe Hot Migration (hoạt động cả ở Lobby lẫn trong trận)
  public isMigrating = false;
  private migrationSockets: WebSocket[] = [];
  private lastMigrationProbeTime = 0;
  private probeWaveCount = 0;
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

  private closeAllMigrationSockets(except?: WebSocket): void {
    for (const s of this.migrationSockets) {
      if (s !== except) {
        s.onopen = null;
        s.onmessage = null;
        s.onclose = null;
        s.onerror = null;
        try { s.close(); } catch (_) {}
      }
    }
    this.migrationSockets = except ? [except] : [];
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
      }, 30);

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

              // 5. Watchdog kiểm tra định tuyến SIN/HKG (Tier 0)
              const onTier0 = isTier0Colo(this.colo);
              const isOptimal = onTier0 && this.rttMin <= 90;
              const needsOptimization = !onTier0 || this.rttMin > 120;

              if (isOptimal) {
                this.probeWaveCount = 0;
                this.badPingStreak = 0;
              } else if (needsOptimization) {
                this.badPingStreak++;
              } else {
                this.badPingStreak = Math.max(0, this.badPingStreak - 1);
              }

              // Nếu không ở SIN/HKG (ví dụ rơi vào NRT, SJC, LAX, MRS, LHR) hoặc ping cao:
              // Kích hoạt ngay đua probe ngầm (cả ở sảnh chờ lẫn trong trận) để kéo về SIN/HKG không gây đứt kết nối!
              if (!this.closed && !this.migrationLocked && !this.isMigrating) {
                if (!onTier0 || this.badPingStreak >= 2) {
                  this.triggerHotMigration();
                }
              }
            }
          }
          return;
        }

        const msg = JSON.parse(raw) as ServerMsg;
        if ((msg as any).t === 'hello') {
          const h = msg as any;
          if (h.colo) this.colo = h.colo;
          if (h.doColo) this.doColo = h.doColo;
          // Phát hiện tức thì ngay ở gói hello đầu tiên (t=0ms): nếu chưa vào đúng SIN/HKG thì phóng probe ngầm ngay!
          if (this.colo && !isTier0Colo(this.colo) && !this.closed && !this.migrationLocked && !this.isMigrating) {
            this.triggerHotMigration();
          }
        }
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
      if (this.isAfk) {
        this.onStatus?.('closed');
        return;
      }
      if (this.isMigrating || this.migrationSockets.length > 0) {
        return;
      }
      if (ev.reason === 'Handover') {
        return;
      }
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      if (this.isMigrating || this.migrationSockets.length > 0) return;
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
      // Phóng song song 3 kết nối TCP/WebSocket độc lập (2 trên custom domain chính thức + 1 trên workers.dev)
      // để vượt qua ECMP load-balancing của nhà mạng và bắt trúng cổng SIN/HKG ngay lập tức
      urls.push(`wss://brawl.get-go.site/ws${search}`);
      urls.push(`wss://brawl.get-go.site/ws${search}`);
      urls.push(`wss://farm-brawl.windydande.workers.dev/ws${search}`);
    } catch (_) {
      urls.push(this.activeUrl);
    }
    return urls;
  }

  public steerToBestRoute(): void {
    this.triggerHotMigration(true);
  }

  public triggerHotMigration(force = false): void {
    if (this.closed || this.isAfk) return;
    if (!force && this.migrationLocked) return;
    // Strict Guard: Nếu đã ở Tier 0 (SIN, HKG...) với ping tốt (<= 80ms) thì giữ nguyên kết nối
    if (!force && isTier0Colo(this.colo) && (this.rttMin <= 0 || this.rttMin <= 80)) {
      this.isMigrating = false;
      this.badPingStreak = 0;
      return;
    }
    const now = performance.now();
    if (this.migrationSockets.length > 0 || (now - this.lastMigrationProbeTime < 2200 && !force)) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    this.probeWaveCount++;
    this.onMigrationStatus?.('probing', this.colo);

    const candidates = this.getCandidateUrls();
    const ts = Date.now();
    let winnerClaimed = false;
    let completedProbes = 0;

    console.log(`[WS Watchdog] Current node ${this.colo || 'unknown'} (~${Math.round(this.rttMin)}ms) is non-Tier0. Launching parallel SIN/HKG probe wave #${this.probeWaveCount}...`);

    const finishWaveIfAllFailed = () => {
      if (winnerClaimed) return;
      completedProbes++;
      if (completedProbes >= candidates.length) {
        this.closeAllMigrationSockets();
        this.isMigrating = false;
        this.onMigrationStatus?.('failed', this.colo);
        if (this.probeWaveCount >= 5) {
          this.probeWaveCount = 0;
          this.badPingStreak = 0;
          this.lockMigration(10000);
        } else {
          this.lockMigration(2500);
        }
      }
    };

    candidates.forEach((candidateUrl, idx) => {
      const probeUrl =
        candidateUrl +
        (candidateUrl.includes('?') ? '&' : '?') +
        `probe=${ts}_${idx}&_r=${Math.random().toString(36).slice(2)}`;

      let probeSocket: WebSocket;
      try {
        probeSocket = new WebSocket(probeUrl);
        this.migrationSockets.push(probeSocket);
      } catch (e) {
        finishWaveIfAllFailed();
        return;
      }

      const probeTimeout = window.setTimeout(() => {
        if (!winnerClaimed && this.migrationSockets.includes(probeSocket)) {
          try { probeSocket.close(); } catch (_) {}
          finishWaveIfAllFailed();
        }
      }, 2200);

      let pendingInit: ServerMsg | null = null;
      let isThisSocketWinner = false;

      const swapToProbeSocket = (newColo: string) => {
        clearTimeout(probeTimeout);
        this.probeWaveCount = 0;
        this.activeUrl = candidateUrl;
        console.log(`[WS Watchdog] Handover complete! Switched from ${this.colo || 'unknown'} to ${newColo} on ${new URL(candidateUrl).host}`);
        const oldWs = this.ws;
        this.ws = probeSocket;
        this.closeAllMigrationSockets();
        this.isMigrating = false;
        this.isReconnecting = false;
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (newColo) this.colo = newColo;
        this.rttRawSamples.length = 0;
        this.smoothedPing = 0;
        this.displayPing = 0;
        this.badPingStreak = 0;
        this.currentPingDelay = 1000;

        if (oldWs && oldWs !== probeSocket) {
          oldWs.onopen = null;
          oldWs.onmessage = null;
          oldWs.onclose = null;
          oldWs.onerror = null;
          try { oldWs.close(1000, 'Handover'); } catch (_) {}
        }

        this.bindActiveSocket(probeSocket);
        this.startPing();
        setTimeout(() => {
          if (!this.closed && this.ws === probeSocket && probeSocket.readyState === WebSocket.OPEN) {
            this.send({ t: 'ping', c: Math.round(performance.now()) });
          }
        }, 20);
        if (pendingInit) {
          this.onMsg(pendingInit);
        }
        this.onMigrationStatus?.('migrated', this.colo);
        this.onMigrationSuccess?.(this.colo);
      };

      probeSocket.onopen = () => {
        if (winnerClaimed || this.closed) {
          clearTimeout(probeTimeout);
          try { probeSocket.close(); } catch (_) {}
          return;
        }
        probeSocket.send(JSON.stringify({ t: 'ping', c: Math.round(performance.now()) }));
      };

      probeSocket.onmessage = (event) => {
        if (this.closed) return;
        if (winnerClaimed && !isThisSocketWinner) return;
        try {
          const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
          const msg = JSON.parse(raw) as ServerMsg;

          if (msg.t === 'pong' && !isThisSocketWinner) {
            const probeColo = msg.colo || '';
            const probeRtt = performance.now() - msg.c;
            const currentlyTier0 = isTier0Colo(this.colo);
            const isProbeTier0 = isTier0Colo(probeColo);
            const currentlyFast = isFastColo(this.colo);
            const isProbeFast = isFastColo(probeColo);

            console.log(`[WS Watchdog] Probe #${idx} (${new URL(candidateUrl).host}): colo=${probeColo}, rtt=${Math.round(probeRtt)}ms`);

            // Ưu tiên tuyệt đối:
            // 1. Hiện tại chưa ở Tier 0 (SIN/HKG) và probe vào trúng Tier 0 (SIN/HKG)
            // 2. Hoặc hiện tại ở ngoài châu Á (LAX/SJC/MRS/LHR) và probe vào châu Á (NRT/TPE...)
            // 3. Hoặc đang cùng Tier nhưng probe có RTT thấp hơn rõ rệt (< 75% RTT hiện tại)
            const isBetter =
              (!currentlyTier0 && isProbeTier0) ||
              (!currentlyFast && isProbeFast) ||
              (isProbeTier0 && this.rttMin > 90 && probeRtt > 0 && probeRtt < this.rttMin * 0.75);

            const triggerHandover = () => {
              if (winnerClaimed) return;
              winnerClaimed = true;
              isThisSocketWinner = true;
              // Đóng ngay các probe khác trong cùng đợt
              this.closeAllMigrationSockets(probeSocket);

              if (msg.doColo) this.doColo = msg.doColo;

              // Nếu đang ở sảnh chờ (chưa join trận): chuyển thẳng sang socket SIN/HKG ngay lập tức!
              if (!this.inGame || !this.lastJoinMsg) {
                swapToProbeSocket(probeColo || 'SIN');
              } else {
                // Đang trong trận: gửi lệnh join kèm sessionToken để server bàn giao nhân vật không mất trạng thái
                probeSocket.send(
                  JSON.stringify({
                    ...this.lastJoinMsg,
                    token: this.sessionToken || undefined,
                  })
                );
              }
            };

            if (!currentlyTier0 && isProbeTier0) {
              // Bắt trúng SIN/HKG -> Chốt ngay lập tức!
              triggerHandover();
            } else if (isBetter) {
              // Nếu chỉ là Tier 1 (như NRT tốt hơn LAX), chờ 180ms xem có probe nào trong đợt vào trúng SIN/HKG không
              setTimeout(() => {
                if (!winnerClaimed && !this.closed && probeSocket.readyState === WebSocket.OPEN) {
                  triggerHandover();
                }
              }, 180);
            } else {
              clearTimeout(probeTimeout);
              try { probeSocket.close(); } catch (_) {}
              finishWaveIfAllFailed();
            }
          } else if (msg.t === 'init' && isThisSocketWinner) {
            pendingInit = msg;
          } else if (msg.t === 'joined' && isThisSocketWinner) {
            if (msg.doColo) this.doColo = msg.doColo;
            if (msg.token) {
              this.sessionToken = msg.token;
              if (this.lastJoinMsg) this.lastJoinMsg.token = msg.token;
            }
            swapToProbeSocket(msg.colo || this.colo || 'SIN');
            this.onMsg(msg);
          } else if (this.ws === probeSocket) {
            this.onMsg(msg);
          }
        } catch (err) {
          console.error('[WS Watchdog] Error during hot migration:', err);
        }
      };

      const cleanupProbe = () => {
        clearTimeout(probeTimeout);
        if (!winnerClaimed || isThisSocketWinner) {
          finishWaveIfAllFailed();
        }
        if (!this.closed && (!this.ws || this.ws.readyState !== WebSocket.OPEN) && this.migrationSockets.length === 0) {
          this.isMigrating = false;
          this.scheduleReconnect();
        }
      };
      probeSocket.onclose = cleanupProbe;
      probeSocket.onerror = cleanupProbe;
    });
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
    if (this.closed || this.isAfk) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && !this.isAfk) this.connect();
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
        if (this.queue.length >= 10) {
          this.queue.shift(); // Drop oldest to prevent unbounded memory growth
        }
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
    this.closeAllMigrationSockets();
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
    this.probeWaveCount = 0;
    this.badPingStreak = 0;
    this.triggerHotMigration(true);
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.stopPing();
    this.probeWaveCount = 0;
    this.isMigrating = false;
    this.closeAllMigrationSockets();
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

  disconnectForAfk(): void {
    if (this.closed || this.isAfk) return;
    this.isAfk = true;
    this.stopPing();
    this.closeAllMigrationSockets();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close(1000, 'AFK');
      } catch (_) {}
    }
    this.onStatus?.('closed');
  }

  reconnectFromAfk(): void {
    if (!this.isAfk) return;
    this.isAfk = false;
    this.closed = false;
    this.isReconnecting = true;
    this.connect();
  }

  close(): void {
    this.closed = true;
    this.isMigrating = false;
    this.stopPing();
    this.closeAllMigrationSockets();
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
