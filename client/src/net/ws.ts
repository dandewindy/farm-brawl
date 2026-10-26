import type { ClientMsg, ServerMsg, Snapshot } from '@shared/protocol';
import type { Handler, Transport } from './transport';

// ============================================================================
// HẰNG SỐ ĐIỀU KHIỂN ĐUA MẠNG & HOT MIGRATION (TIER-0 PINNING & PIGGYBACKED RTT)
// ============================================================================
const PING_INTERVAL_MS = 1500;             // Giãn ping rời rạc lên 1500ms vì đã có Piggybacked RTT trong Snapshot 20Hz!
export const HIGH_PING_THRESHOLD_MS = 90;  // Ngưỡng ping yêu cầu của người chơi
export const LOAD_HANDICAP_MS = 12;        // Hệ số bù tải 20Hz chống bão Ping-Pong

// Ngưỡng kích hoạt dò tuyến trong trận:
// - Nếu đang ở Tier 0 (SIN/HKG): KHÓA CỨNG (Tier-0 Pinning), chỉ dò nếu ping treo > 260ms liên tục 6 giây!
// - Nếu đang ở Tier 1/2 VÀ có nhiều hơn 1 hostname khác dải IP: dò sau 3 giây.
const TIER_0_EMERGENCY_PING_MS = 260;
const TIER_0_EMERGENCY_SAMPLES = 4;        // 4 * 1.5s = 6.0s

/**
 * Phân tầng địa lý các trạm Cloudflare Edge POP cho người chơi tại Việt Nam & Đông Nam Á:
 * - Tier 0 (Mục tiêu tối ưu < 65ms): SIN (Singapore), HKG (Hồng Kông), SGN/HAN/DAD (Việt Nam), BKK, KUL, CGK, MNL
 * - Tier 1 (Châu Á lân cận 65ms - 125ms): TPE, KHH, NRT, HND, KIX, FUK, OKA, ICN, PUS, CAN, SZX, DPS, CEB, RGN, BNY
 * - Tier 2 (Lệch tuyến sang Châu Âu / Mỹ / Úc > 140ms): CDG, MRS, FRA, LHR, SJC, LAX, SYD...
 */
const TIER_0_SEA_COLOS = /^(SIN|HKG|HAN|SGN|DAD|BKK|KUL|PNH|VTE)$/i;
const TIER_1_APAC_COLOS =
  /^(TPE|KHH|MNL|CEB|CAN|SZX|MFN|CGK|DPS|RGN|BNY|NRT|HND|KIX|FUK|OKA|ICN|PUS)$/i;

export type ColoTier = 0 | 1 | 2;

export function getColoTier(colo?: string): ColoTier {
  if (!colo) return 2;
  const code = colo.trim().toUpperCase();
  if (TIER_0_SEA_COLOS.test(code)) return 0;
  if (TIER_1_APAC_COLOS.test(code)) return 1;
  return 2;
}

export function isFastColo(colo?: string): boolean {
  return getColoTier(colo) <= 1;
}

export function isOptimalSeaColo(colo?: string): boolean {
  return getColoTier(colo) === 0;
}

export interface RttStats {
  min: number;
  median: number;
  p95: number;
  jitter: number;
  samples: number;
}

export function computeRttStats(win: number[]): RttStats {
  if (win.length === 0) {
    return { min: 48, median: 48, p95: 48, jitter: 0, samples: 0 };
  }
  const sorted = [...win].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : Math.round(sorted[mid]);
  const q25 = sorted[Math.floor(n * 0.25)];
  const q75 = sorted[Math.floor(n * 0.75)];
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];

  return {
    min: Math.round(min),
    median,
    p95: Math.round(p95),
    jitter: Math.round(Math.max(0, q75 - q25)),
    samples: n,
  };
}

export interface MigrationDecision {
  shouldSwitch: boolean;
  reason: string;
  activeMedian: number;
  probeRawMedian: number;
  probeEffectiveMedian: number;
  activeColo: string;
  probeColo: string;
}

/**
 * Đánh giá xem nhánh mạng của Probe có thực sự tốt hơn nhánh hiện tại hay không.
 * Vẫn giữ đầy đủ Load Handicap (12ms) và Same-Colo Guard để chống lặp Ping-Pong,
 * nhưng ưu tiên chuyển ngay lập tức nếu nâng cấp được Tier (ví dụ từ FRA/NRT về SIN/HKG).
 */
export function evaluateMigrationDecision(
  activeWin: number[],
  activeColo: string,
  probeWin: number[],
  probeColo: string,
  minRequiredSamples = 4,
  isInGame = true
): MigrationDecision {
  const activeStats = computeRttStats(activeWin);
  const probeStats = computeRttStats(probeWin);

  const activeMedian = activeStats.median;
  const probeRawMedian = probeStats.median;
  const handicap = isInGame ? LOAD_HANDICAP_MS : 4;
  const probeEffectiveMedian = probeRawMedian + handicap;
  const netGainMs = activeMedian - probeEffectiveMedian;

  const activeTier = getColoTier(activeColo);
  const probeTier = getColoTier(probeColo);
  const sameColo =
    Boolean(activeColo) &&
    Boolean(probeColo) &&
    activeColo.toUpperCase() === probeColo.toUpperCase();

  const baseResult = {
    activeMedian,
    probeRawMedian,
    probeEffectiveMedian,
    activeColo,
    probeColo,
  };

  // 1. Chặn nếu không đủ mẫu đo tin cậy
  if (probeStats.samples < minRequiredSamples) {
    return { ...baseResult, shouldSwitch: false, reason: 'insufficient_probe_samples' };
  }

  // 2. Chặn nếu tuyến Probe bị suy thoái Tier địa lý (ví dụ đang ở Tier 0/1 mà probe rơi sang FRA Tier 2)
  if (probeTier > activeTier) {
    return {
      ...baseResult,
      shouldSwitch: false,
      reason: `tier_regression_${activeTier}_to_${probeTier}`,
    };
  }

  // 3. Chặn nếu tuyến Probe bị rớt gói / Jitter quá bất ổn (> 35ms và gấp 1.6 lần socket hiện tại)
  if (probeStats.jitter > 35 && probeStats.jitter > Math.max(20, activeStats.jitter * 1.6)) {
    return {
      ...baseResult,
      shouldSwitch: false,
      reason: `probe_jitter_unstable_${probeStats.jitter}ms`,
    };
  }

  // 4. TRƯỜNG HỢP A: Nâng cấp Tier địa lý (Ví dụ: Châu Âu Tier 2 -> APAC/SEA, hoặc Nhật Tier 1 -> SIN/SGN Tier 0)
  if (
    probeTier < activeTier &&
    (netGainMs >= 10 || (!isInGame && (netGainMs >= 5 || probeRawMedian <= 95)))
  ) {
    return {
      ...baseResult,
      shouldSwitch: true,
      reason: `tier_upgrade_${activeColo}(T${activeTier})_to_${probeColo}(T${probeTier})_gain_${netGainMs}ms`,
    };
  }

  // 5. TRƯỜNG HỢP B: Cùng trạm Edge POP (Same-Colo Guard)
  // Chỉ đổi khi kết nối TCP cũ thực sự bị nghẽn ECMP nặng (cải thiện thực tế >= 25ms và giảm ít nhất 22% RTT)
  if (sameColo) {
    if (netGainMs >= 25 && probeEffectiveMedian <= activeMedian * 0.78) {
      return {
        ...baseResult,
        shouldSwitch: true,
        reason: `same_colo_ecmp_recovery_${activeColo}_gain_${netGainMs}ms`,
      };
    }
    return {
      ...baseResult,
      shouldSwitch: false,
      reason: `same_colo_noise_filtered_${activeColo}_gain_${netGainMs}ms`,
    };
  }

  // 6. TRƯỜNG HỢP C: Khác trạm Edge POP nhưng cùng Tier
  if (!sameColo && probeTier === activeTier) {
    if (activeTier === 0) {
      if (
        activeMedian > HIGH_PING_THRESHOLD_MS &&
        netGainMs >= 30 &&
        probeRawMedian <= 65
      ) {
        return {
          ...baseResult,
          shouldSwitch: true,
          reason: `sea_core_congestion_relief_${activeColo}_to_${probeColo}_gain_${netGainMs}ms`,
        };
      }
      return {
        ...baseResult,
        shouldSwitch: false,
        reason: `sea_core_already_optimal_${activeColo}_probe_${probeColo}_gain_${netGainMs}ms`,
      };
    }

    if (
      netGainMs >= 20 &&
      (probeRawMedian <= HIGH_PING_THRESHOLD_MS ||
        probeEffectiveMedian <= activeMedian * 0.8)
    ) {
      return {
        ...baseResult,
        shouldSwitch: true,
        reason: `cross_colo_improvement_${activeColo}_to_${probeColo}_gain_${netGainMs}ms`,
      };
    }
  }

  return {
    ...baseResult,
    shouldSwitch: false,
    reason: `marginal_difference_gain_${netGainMs}ms`,
  };
}

export class WsClient implements Transport {
  public ws: WebSocket | null = null;
  public rtt = 48;                 // Ping nội bộ (đã lọc nhiễu mượt mà)
  public displayPing = 48;          // Ping hiển thị trên HUD (đứng yên ổn định)
  public rttMin = 48;              // Độ trễ vật lý tối thiểu (dùng làm mỏ neo cho ClientPredictor)
  public netRtt = 48;              // RTT hiệu dụng cho ClientPredictor
  public edgeToDoMs = 0;          // Độ trễ nội bộ giữa Cloudflare Edge POP và Durable Object
  public jitter = 0;
  public clockOffset: number | null = null;
  public colo = '';
  public doColo = '';
  public inGame = false;
  public isMigrating = false;
  public sessionToken: string | null = null;
  public closed = false;

  private lastProcessedEct = 0;
  private clockInitialized = false;
  private clockSampleCount = 0;
  private lastHudPingUpdateAt = 0;

  private candidateUrls: string[] = [];
  private distinctHostsCount = 1;
  private activeUrlIndex = 0;
  private currentShard = 0;

  private readonly rttWin: number[] = [];
  private readonly rawHistory: number[] = []; // Lưu 50 mẫu gần nhất cho benchmark P95/P99
  private smoothedRtt = 48;
  private lastSamplePerf = 0;
  private lastRawRtt = 48;

  private onMessageCb?: Handler;
  private onStatusCb?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void;

  private pingInterval: number | null = null;
  private reconnectTimer: number | null = null;
  private probing = false;
  private consecutiveHighSamples = 0;
  private sameColoProbeLocked = false; // Khóa không probe lặp lại nếu cùng IP vẫn ra cùng 1 colo
  private outboundQueue: ClientMsg[] = [];
  private lastJoinPayload: (ClientMsg & { t: 'join' }) | null = null;

  // Callbacks
  public onMigrationSuccess?: (newColo: string) => void;
  public onMigrationStatus?: (status: 'probing' | 'migrated' | 'failed', colo?: string) => void;

  constructor(
    primaryUrl: string,
    onMessage?: Handler,
    arg3?: ((status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void) | string[],
    arg4?: string[] | ((status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void),
    arg5?: string[]
  ) {
    this.onMessageCb = onMessage;

    let altUrls: string[] = [];
    if (Array.isArray(arg3)) {
      altUrls = arg3;
    } else {
      if (typeof arg3 === 'function') this.onStatusCb = arg3;
      if (Array.isArray(arg4)) {
        altUrls = arg4;
      } else if (typeof arg4 === 'function') {
        this.onStatusCb = arg4;
        if (Array.isArray(arg5)) altUrls = arg5;
      }
    }

    const allUrls = [primaryUrl, ...altUrls.filter(Boolean)];
    const uniqueUrlSet = new Set<string>(allUrls);
    this.candidateUrls = Array.from(uniqueUrlSet);

    const hostSet = new Set<string>();
    for (const u of this.candidateUrls) {
      try {
        hostSet.add(new URL(u, window.location.origin).host);
      } catch {}
    }
    this.distinctHostsCount = Math.max(1, hostSet.size);

    try {
      this.sessionToken =
        sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) ||
        sessionStorage.getItem('fb_session_token');
    } catch (_) {}

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Khởi động kết nối thông minh (< 150ms)
    this.bootSmartConnection();
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && !document.hidden) {
      this.consecutiveHighSamples = 0;
    }
  };

  private getRoomKey(): string {
    try {
      const u = new URL(this.candidateUrls[0], window.location.origin);
      return u.searchParams.get('room') || 'pub-1';
    } catch {
      return 'pub-1';
    }
  }

  /**
   * KHỞI ĐỘNG THÔNG MINH (< 150ms):
   * - Nếu chỉ có 1 hostname duy nhất (farm-brawl.farm-brawl.workers.dev):
   *   Mở kết nối WebSocket NGAY LẬP TỨC ở 0ms (không chờ đợi 420ms vô ích!).
   * - Nếu có nhiều hostname khác dải IP (workers.dev + pages.dev + custom domain):
   *   Bắn HTTP Pre-Flight `/api/edge-ping` song song với timeout 180ms để chọn hostname vào SIN/HKG nhanh nhất!
   */
  private async bootSmartConnection(): Promise<void> {
    if (this.closed) return;
    this.onStatusCb?.('connecting');

    if (this.distinctHostsCount > 1) {
      const bestIdx = await this.runFastHttpPreFlight(180);
      this.activeUrlIndex = bestIdx;
    }

    this.openPrimaryWebSocket(this.candidateUrls[this.activeUrlIndex]);
  }

  /**
   * Đua HTTP `/api/edge-ping` siêu nhẹ giữa các hostname khác nhau trong tối đa `timeoutMs` (180ms)
   */
  private async runFastHttpPreFlight(timeoutMs: number): Promise<number> {
    const hostMap = new Map<string, number>();
    for (let i = 0; i < this.candidateUrls.length; i++) {
      try {
        const parsed = new URL(this.candidateUrls[i], window.location.origin);
        if (!hostMap.has(parsed.host)) {
          hostMap.set(parsed.host, i);
        }
      } catch {}
    }

    if (hostMap.size <= 1) return 0;

    type ProbeHit = { index: number; tier: ColoTier; rtt: number; colo: string };
    const hits: ProbeHit[] = [];

    const tasks = Array.from(hostMap.entries()).map(async ([host, idx]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = performance.now();
      try {
        const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const resp = await fetch(`${proto}//${host}/api/edge-ping?_t=${Date.now()}`, {
          mode: 'cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.ok) {
          const data = (await resp.json()) as { colo?: string };
          const rtt = Math.max(1, performance.now() - t0);
          const colo = (data.colo || 'SIN').toUpperCase();
          hits.push({ index: idx, tier: getColoTier(colo), rtt, colo });
        }
      } catch {
        clearTimeout(timer);
      }
    });

    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);

    if (hits.length === 0) return 0;
    hits.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.rtt - b.rtt));
    return hits[0].index;
  }

  private buildFinalWsUrl(baseUrl: string): string {
    try {
      const u = new URL(baseUrl, window.location.origin);
      if (this.currentShard > 0) {
        u.searchParams.set('shard', String(this.currentShard));
      }
      u.searchParams.set('_c', Date.now().toString(36));
      return u.toString();
    } catch {
      return baseUrl;
    }
  }

  private openPrimaryWebSocket(rawUrl: string, isHandoverSwap = false): void {
    if (this.closed) return;

    const finalUrl = this.buildFinalWsUrl(rawUrl);
    let sock: WebSocket;
    try {
      sock = new WebSocket(finalUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    const oldWs = this.ws;
    this.ws = sock;

    sock.onopen = () => {
      if (this.ws !== sock || this.closed) {
        try {
          sock.close(1000, 'StaleSocket');
        } catch {}
        return;
      }

      // Nếu là chuyển mạch Handover hoặc di dời Shard, gửi lại lệnh join kèm cờ handover
      if (isHandoverSwap && this.lastJoinPayload) {
        try {
          sock.send(
            JSON.stringify({
              ...this.lastJoinPayload,
              token: this.sessionToken || undefined,
            })
          );
        } catch {}
      }

      // Đóng socket cũ an toàn sau khi socket mới đã mở thành công
      if (oldWs && oldWs !== sock) {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        try {
          oldWs.close(1000, 'HandoverComplete');
        } catch {}
      }

      // Xả hàng đợi gói tin chờ
      while (
        this.outboundQueue.length > 0 &&
        sock.readyState === WebSocket.OPEN
      ) {
        const item = this.outboundQueue.shift()!;
        sock.send(JSON.stringify(item));
      }

      this.onStatusCb?.(isHandoverSwap ? 'reconnected' : 'open');
      this.startPing();
    };

    sock.onmessage = (ev: MessageEvent) => {
      if (this.ws !== sock || this.closed) return;
      this.handlePrimaryMessage(ev.data);
    };

    sock.onclose = () => {
      if (this.ws !== sock || this.closed) return;
      this.stopPing();
      this.onStatusCb?.('closed');
      this.scheduleReconnect();
    };

    sock.onerror = () => {
      if (this.ws !== sock || this.closed) return;
      this.onStatusCb?.('error');
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.openPrimaryWebSocket(
          this.candidateUrls[this.activeUrlIndex],
          this.inGame
        );
      }
    }, 600);
  }

  public send(m: ClientMsg): void {
    if (m.t === 'join') {
      this.lastJoinPayload = { ...m, token: this.sessionToken || m.token };
      this.inGame = true;
    }

    // Tự động đính kèm ct (Client Timestamp) vào mọi gói input để đo RTT trực tiếp qua Snapshot 20Hz!
    if (m.t === 'input' && (m as any).ct === undefined) {
      (m as any).ct = Math.round(performance.now());
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
    } else if (this.outboundQueue.length < 32 && m.t !== 'input') {
      this.outboundQueue.push(m);
    }
  }

  public startPing(): void {
    this.stopPing();
    // Bắn ngay 1 gói ping ở 0ms khi mở socket để lấy mẫu RTT đầu tiên tức thì
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ t: 'ping', c: Math.round(performance.now()) });
    }
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ t: 'ping', c: Math.round(performance.now()) });
      }
    }, PING_INTERVAL_MS);
  }

  public stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handlePrimaryMessage(raw: string | ArrayBuffer): void {
    const recvNow = performance.now();
    const text =
      typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

    // 1. Xử lý gói hello (0ms) và pong
    if (text.startsWith('{"t":"pong"') || text.startsWith('{"t":"hello"')) {
      try {
        const msg = JSON.parse(text) as {
          t: 'pong' | 'hello';
          c?: number;
          s?: number;
          colo?: string;
          doColo?: string;
          e2d?: number;
        };
        if (msg.colo) this.colo = msg.colo.toUpperCase();
        if (msg.doColo) this.doColo = msg.doColo.toUpperCase();
        if (typeof msg.e2d === 'number') this.edgeToDoMs = msg.e2d;

        if (typeof document !== 'undefined' && document.hidden) return;

        if (typeof msg.c === 'number') {
          const rawRtt = recvNow - msg.c;
          if (rawRtt >= 1 && rawRtt < 2500) {
            this.recordRttSample(rawRtt, recvNow, msg.s);
          }
        } else if (msg.t === 'hello') {
          // Gửi ngay 1 ping xác nhận RTT ngay khi nhận được hello
          this.send({ t: 'ping', c: Math.round(performance.now()) });
        }
      } catch {}
      return;
    }

    // 2. Xử lý lệnh tự động di dời Shard nếu DO bị đặt nhầm ngoài Đông Nam Á
    if (text.startsWith('{"t":"relocate_shard"')) {
      try {
        const msg = JSON.parse(text) as { nextShard?: number; badDoColo?: string };
        if (typeof msg.nextShard === 'number' && msg.nextShard !== this.currentShard) {
          console.log(
            `[Net] Relocating DO from ${msg.badDoColo} to SEA Shard #${msg.nextShard}`
          );
          this.currentShard = msg.nextShard;
          this.openPrimaryWebSocket(
            this.candidateUrls[this.activeUrlIndex],
            true
          );
        }
      } catch {}
      return;
    }

    // 3. Xử lý bản tin Game Snapshot 20Hz & trích xuất Piggybacked RTT (ect / holdMs)
    try {
      const parsed = JSON.parse(text) as ServerMsg;
      if (parsed.t === 'joined' && parsed.token) {
        this.sessionToken = parsed.token;
        try {
          sessionStorage.setItem(`fb_tok_${this.getRoomKey()}`, parsed.token);
        } catch (_) {}
      }
      if ('colo' in parsed && typeof (parsed as any).colo === 'string') {
        this.colo = (parsed as any).colo.toUpperCase();
      }
      if ('doColo' in parsed && typeof (parsed as any).doColo === 'string') {
        this.doColo = (parsed as any).doColo.toUpperCase();
      }

      // Trích xuất RTT thuần túy ngay từ gói Snapshot 20Hz thông qua ect (Echo Client Timestamp)
      if (
        parsed.t === 's' &&
        typeof (parsed as Snapshot).ect === 'number' &&
        !(typeof document !== 'undefined' && document.hidden)
      ) {
        const snap = parsed as Snapshot;
        const ect = snap.ect!;
        const holdMs = typeof snap.holdMs === 'number' ? snap.holdMs : 0;
        if (ect > this.lastProcessedEct && holdMs >= 0 && holdMs <= 35) {
          this.lastProcessedEct = ect;
          const pureSnapRtt = recvNow - ect - holdMs;
          if (pureSnapRtt >= 2 && pureSnapRtt < 1000) {
            this.recordRttSample(pureSnapRtt, recvNow, snap.st);
          }
        }
      }

      this.onMessageCb?.(parsed);
    } catch {
      // Bỏ qua lỗi parse
    }
  }

  /**
   * Bộ lọc RTT Chống Nhảy Giật (Min-Anchored IQR + Outlier Rejection):
   * - Loại bỏ hoàn toàn hiện tượng ping nhảy từ 50ms -> 180ms do 1 gói TCP bị trễ HoL.
   * - Neo cứng clockOffset theo rttMin để ClientPredictor không bao giờ giật ngược data.
   */
  private recordRttSample(
    rawRtt: number,
    recvNow: number,
    serverTime?: number
  ): void {
    const interArrival =
      this.lastSamplePerf > 0 ? recvNow - this.lastSamplePerf : 500;
    this.lastSamplePerf = recvNow;

    this.rawHistory.push(Math.round(rawRtt));
    if (this.rawHistory.length > 50) this.rawHistory.shift();

    // Bỏ qua mẫu đuôi của đợt xả hàng đợi TCP (2 gói về dồn sát nhau < 40ms)
    const isHolTail = interArrival < 40 && rawRtt < this.lastRawRtt;
    this.lastRawRtt = rawRtt;
    if (isHolTail && this.rttWin.length >= 3) {
      return;
    }

    // 1. Chống gai đột biến (Spike rejection):
    const clampedSample =
      this.rtt > 0 && this.rttWin.length >= 5
        ? Math.min(rawRtt, this.rtt * 2.2 + 25)
        : rawRtt;

    this.rttWin.push(clampedSample);
    if (this.rttWin.length > 15) this.rttWin.shift();

    // 2. Lấy Phân vị thứ 30 (30th Percentile) làm baseline vật lý
    const sorted = [...this.rttWin].sort((a, b) => a - b);
    const p30Index = Math.floor((sorted.length - 1) * 0.3);
    const baselineRtt = sorted[p30Index];
    this.rttMin = Math.round(baselineRtt);

    // 3. Làm mượt RTT nội bộ bằng EWMA
    if (this.rtt === 0) {
      this.rtt = Math.round(baselineRtt);
      this.displayPing = Math.round(baselineRtt);
      this.smoothedRtt = baselineRtt;
    } else {
      const alpha = baselineRtt < this.smoothedRtt ? 0.20 : 0.08;
      this.smoothedRtt += (baselineRtt - this.smoothedRtt) * alpha;
      this.rtt = Math.round(this.smoothedRtt);
    }
    this.netRtt = Math.round(this.rttMin);

    // 4. Cập nhật số Ping trên HUD với Deadband (Hysteresis >= 2ms) & Chu kỳ 1000ms
    if (recvNow - this.lastHudPingUpdateAt >= 1000) {
      const candidatePing = Math.round(this.rtt);
      if (Math.abs(candidatePing - this.displayPing) >= 2 || this.clockSampleCount < 5) {
        this.displayPing = candidatePing;
        this.lastHudPingUpdateAt = recvNow;
      }
    }

    // 5. Cập nhật clockOff với bộ giới hạn tốc độ trượt (Slew-Rate Limiter)
    if (typeof serverTime === 'number' && serverTime > 0) {
      const candidateOffset = serverTime - (recvNow - baselineRtt * 0.5);
      this.clockSampleCount++;

      if (!this.clockInitialized || this.clockOffset === null) {
        this.clockOffset = candidateOffset;
        this.clockInitialized = true;
      } else if (this.clockSampleCount <= 8) {
        // Trong 8 mẫu đầu tiên (Warm-up): hội tụ nhanh
        this.clockOffset += (candidateOffset - this.clockOffset) * 0.25;
      } else {
        // Sau khi đã khóa (Locked): Chỉ cập nhật khi mẫu RTT hiện tại nằm gần đáy (ít nhiễu)
        if (rawRtt <= baselineRtt * 1.15) {
          const diff = candidateOffset - this.clockOffset;
          // KẸP CỨNG: Không bao giờ cho phép clockOff dịch chuyển quá 0.25ms mỗi lần!
          const maxStep = 0.25;
          const step = Math.max(-maxStep, Math.min(maxStep, diff * 0.05));
          this.clockOffset += step;
        }
      }
    }

    this.evaluateRouteHealth(rawRtt);
  }


  /**
   * KIỂM TRA SỨC KHỎE TUYẾN MẠNG (CHỐNG BÃO PROBE KHI ĐÃ Ở SIN/HKG):
   * - Nếu đã ở Tier 0 (SIN/HKG/SGN/HAN): KHÓA CỨNG kết nối! Không tự ý probe hay đổi socket.
   * - Nếu đang ở Tier 1/2: Chỉ thử đổi nếu còn hostname khác chưa thử hoặc chưa bị khóa sameColoProbeLocked.
   */
  private evaluateRouteHealth(latestRawRtt: number): void {
    if (this.probing || this.closed || this.sameColoProbeLocked) return;

    const currentTier = getColoTier(this.colo);

    // QUY TẮC VÀNG: Đã ở đúng cụm Đông Nam Á (SIN/HKG - Tier 0) -> Giữ nguyên kết nối!
    if (currentTier === 0) {
      if (latestRawRtt > TIER_0_EMERGENCY_PING_MS) {
        this.consecutiveHighSamples += 1;
      } else {
        this.consecutiveHighSamples = 0;
      }
      // Chỉ thử cứu hộ nếu mạng treo cứng > 260ms suốt 6 giây VÀ có nhiều hostname dự phòng
      if (
        this.consecutiveHighSamples >= TIER_0_EMERGENCY_SAMPLES &&
        this.distinctHostsCount > 1
      ) {
        this.consecutiveHighSamples = 0;
        this.tryAlternativeEndpointProbe();
      }
      return;
    }

    // Nếu đang bị rơi vào Tier 1 / Tier 2 (ví dụ NRT, FRA, SJC):
    this.consecutiveHighSamples += 1;
    if (this.consecutiveHighSamples >= 2) {
      this.consecutiveHighSamples = 0;
      this.tryAlternativeEndpointProbe();
    }
  }

  /**
   * Thử kiểm tra nhẹ bằng 1 kết nối phụ duy nhất.
   * Nếu kết nối phụ vẫn trả về ĐÚNG cùng mã `colo` cũ (do ISP định tuyến cứng),
   * lập tức bật cờ `sameColoProbeLocked = true` để KHÔNG BAO GIỜ mở socket quét lặp lại gây lag!
   */
  private tryAlternativeEndpointProbe(): void {
    if (this.probing || this.closed) return;
    this.probing = true;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);

    const nextIdx = (this.activeUrlIndex + 1) % this.candidateUrls.length;
    const probeUrl = this.buildFinalWsUrl(this.candidateUrls[nextIdx]);

    let probeWs: WebSocket;
    try {
      probeWs = new WebSocket(probeUrl);
    } catch {
      this.probing = false;
      this.isMigrating = false;
      return;
    }

    let done = false;
    const cleanup = (closeIt: boolean) => {
      done = true;
      this.probing = false;
      this.isMigrating = false;
      if (closeIt) {
        probeWs.onopen = null;
        probeWs.onmessage = null;
        probeWs.onerror = null;
        probeWs.onclose = null;
        try {
          probeWs.close(1000, 'ProbeDone');
        } catch {}
      }
    };

    const timer = window.setTimeout(() => {
      if (!done) {
        cleanup(true);
        this.onMigrationStatus?.('failed', this.colo);
      }
    }, 1200);

    probeWs.onopen = () => {
      if (done || this.closed) return;
      try {
        probeWs.send(`{"t":"ping","c":${Math.round(performance.now())}}`);
      } catch {}
    };

    probeWs.onmessage = (ev: MessageEvent) => {
      if (done || this.closed) return;
      const recvNow = performance.now();
      const text =
        typeof ev.data === 'string'
          ? ev.data
          : new TextDecoder().decode(ev.data as ArrayBuffer);

      if (text.startsWith('{"t":"hello"') || text.startsWith('{"t":"pong"')) {
        try {
          const msg = JSON.parse(text) as {
            t: 'hello' | 'pong';
            c?: number;
            colo?: string;
            doColo?: string;
          };
          const probeColo = (msg.colo || '').toUpperCase();
          if (!probeColo) return;

          // Nếu Probe trả về cùng 1 trạm với kết nối hiện tại và chỉ có 1 hostname:
          // Khóa lại ngay để không bao giờ tốn tài nguyên mở probe vô ích nữa!
          if (
            probeColo === this.colo &&
            this.distinctHostsCount <= 1
          ) {
            clearTimeout(timer);
            this.sameColoProbeLocked = true;
            cleanup(true);
            this.onMigrationStatus?.('failed', this.colo);
            return;
          }

          if (msg.t === 'hello') {
            probeWs.send(`{"t":"ping","c":${Math.round(performance.now())}}`);
            return;
          }

          if (msg.t === 'pong' && typeof msg.c === 'number') {
            clearTimeout(timer);
            const probeRtt = Math.max(1, recvNow - msg.c);
            const probeTier = getColoTier(probeColo);
            const currentTier = getColoTier(this.colo);

            // Chỉ chuyển nếu thực sự nâng cấp được Tier (ví dụ về được SIN/HKG)
            // hoặc giảm được ít nhất 25ms RTT
            if (
              probeTier < currentTier ||
              (probeTier === currentTier &&
                probeRtt + LOAD_HANDICAP_MS < this.rtt - 25)
            ) {
              this.activeUrlIndex = nextIdx;
              cleanup(true);
              this.onMigrationStatus?.('migrated', probeColo);
              this.onMigrationSuccess?.(probeColo);
              this.openPrimaryWebSocket(
                this.candidateUrls[this.activeUrlIndex],
                this.inGame
              );
            } else {
              if (this.distinctHostsCount <= 1) {
                this.sameColoProbeLocked = true;
              }
              cleanup(true);
              this.onMigrationStatus?.('failed', this.colo);
            }
          }
        } catch {
          clearTimeout(timer);
          cleanup(true);
          this.onMigrationStatus?.('failed', this.colo);
        }
      }
    };

    probeWs.onerror = () => {
      clearTimeout(timer);
      cleanup(true);
      this.onMigrationStatus?.('failed', this.colo);
    };
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.sameColoProbeLocked = false;
    this.activeUrlIndex = (this.activeUrlIndex + 1) % this.candidateUrls.length;
    this.openPrimaryWebSocket(
      this.candidateUrls[this.activeUrlIndex],
      this.inGame
    );
  }

  public manualRetune(): void {
    this.sameColoProbeLocked = false;
    this.consecutiveHighSamples = TIER_0_EMERGENCY_SAMPLES;
    this.forceReconnect();
  }

  public triggerHotMigration(_isManual = false): void {
    if (this.closed) return;
    this.tryAlternativeEndpointProbe();
  }

  public leaveGame(): void {
    this.inGame = false;
    try {
      this.send({ t: 'leave' });
    } catch {}
  }

  /**
   * Xuất dữ liệu chẩn đoán đầy đủ để kiểm chứng trên Console
   */
  public getDiagnostics(): Record<string, unknown> {
    const stats = computeRttStats(this.rawHistory);
    return {
      edgeColo: this.colo,
      edgeTier: getColoTier(this.colo),
      doColo: this.doColo,
      edgeToDoMs: this.edgeToDoMs,
      shard: this.currentShard,
      hudPingMs: this.rtt,
      netRttMs: this.netRtt,
      minRttMs: stats.min,
      medianRttMs: stats.median,
      p95RttMs: stats.p95,
      iqrJitterMs: stats.jitter,
      samplesCount: stats.samples,
      sameColoProbeLocked: this.sameColoProbeLocked,
    };
  }

  public close(): void {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close(1000, 'ClientClosed');
      } catch {}
      this.ws = null;
    }
  }
}
