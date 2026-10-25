import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

/**
 * Phân tầng địa lý các trạm Cloudflare Edge POP cho người chơi tại Việt Nam & Đông Nam Á:
 * - Tier 0 (SEA / VN Core): Trạm nội địa VN hoặc trục chính Singapore / Hồng Kông / Bangkok / KL (Kỳ vọng: 15ms - 60ms)
 * - Tier 1 (East Asia / APAC): Đài Loan, Philippines, Nam Trung Quốc, Nhật Bản, Hàn Quốc, Indonesia (Kỳ vọng: 60ms - 115ms)
 * - Tier 2 (Out-of-Region Detour): Châu Âu (CDG, MRS, FRA...), Mỹ, Úc (Định tuyến lỗi BGP > 140ms)
 */
const TIER_0_SEA_COLOS = /^(SIN|HKG|HAN|SGN|DAD|BKK|KUL|PNH|VTE)$/i;
const TIER_1_APAC_COLOS = /^(TPE|KHH|MNL|CEB|CAN|SZX|MFN|CGK|DPS|RGN|BNY|NRT|HND|KIX|FUK|OKA|ICN|PUS)$/i;

export type ColoTier = 0 | 1 | 2;

export function getColoTier(colo?: string): ColoTier {
  if (!colo) return 2;
  const normalized = colo.trim().toUpperCase();
  if (TIER_0_SEA_COLOS.test(normalized)) return 0;
  if (TIER_1_APAC_COLOS.test(normalized)) return 1;
  return 2;
}

/**
 * Giữ tương thích ngược với hàm isFastColo hiện tại của dự án:
 * Trả về true cho Tier 0 (SEA/VN) hoặc Tier 1 (APAC).
 */
export function isFastColo(colo?: string): boolean {
  return getColoTier(colo) <= 1;
}

export function isOptimalSeaColo(colo?: string): boolean {
  return getColoTier(colo) === 0;
}

// ============================================================================
// HẰNG SỐ ĐIỀU KHIỂN HOT MIGRATION (ĐÃ TINH CHỈNH CHỐNG PING-PONG LOOP)
// ============================================================================
const RTT_WINDOW_SIZE = 8;
const PING_INTERVAL_MS = 500;

/** Ngưỡng ping người chơi yêu cầu: trên 90ms sẽ kích hoạt dò tuyến mới */
export const HIGH_PING_THRESHOLD_MS = 90;

/** Số mẫu ping liên tiếp > 90ms cần thiết để kích hoạt Probe (8 mẫu * 500ms = 4.0s) */
const SUSTAINED_HIGH_PING_SAMPLES = 8;

/**
 * Hệ số bù tải (Load Handicap): Socket đang nhận snapshot 20Hz chịu độ trễ hàng đợi
 * cao hơn socket rỗng (probeSocket) khoảng 12ms. Cộng 12ms vào probe để so sánh công bằng.
 */
export const LOAD_HANDICAP_MS = 12;

/** Cấu hình lấy mẫu trên probeSocket */
const PROBE_WARMUP_PINGS = 1;       // Bỏ qua 1 mẫu đầu tiên (khởi tạo TLS/Edge)
const PROBE_MEASURE_PINGS = 6;      // Thu thập 6 mẫu thực tế
const PROBE_PING_SPACING_MS = 250;  // Khoảng cách giữa các mẫu probe (tổng ~1.75s)
const PROBE_TIMEOUT_MS = 4500;      // Timeout tối đa cho toàn bộ quá trình probe
const HANDOVER_ACK_TIMEOUT_MS = 3000;

/** Chuỗi đệm 96 bytes giả lập kích thước gói input thực tế khi bắn ping thử tải */
const PROBE_PAYLOAD_PADDING = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Thời gian khóa Probe sau khi vừa chuyển mạng thành công (25 giây) */
const POST_SWITCH_GRACE_MS = 25_000;

/** Thời gian Cooldown thích ứng khi Probe không tìm được đường tốt hơn (15s -> 30s -> 60s -> 120s) */
const BASE_PROBE_COOLDOWN_MS = 15_000;
const MAX_PROBE_COOLDOWN_MS = 120_000;

export interface RttStats {
  min: number;
  median: number;
  jitter: number;
  samples: number;
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
 * Tính toán thống kê RTT: Min, Median (Trung vị) và Jitter (Khoảng tứ phân vị IQR)
 */
export function computeRttStats(window: number[]): RttStats {
  if (window.length === 0) {
    return { min: 0, median: 0, jitter: 0, samples: 0 };
  }
  const sorted = [...window].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];

  const q25 = sorted[Math.floor(n * 0.25)];
  const q75 = sorted[Math.floor(n * 0.75)];
  const jitter = Math.max(0, q75 - q25);

  return { min, median, jitter, samples: n };
}

/**
 * Hàm toán học quyết định có chuyển sang probeSocket hay không.
 * Đảm bảo chuyển dứt khoát khi có đường tốt hơn nhưng tuyệt đối không lặp Ping-Pong.
 */
export function evaluateMigrationDecision(
  activeWin: number[],
  activeColo: string,
  probeWin: number[],
  probeColo: string
): MigrationDecision {
  const activeStats = computeRttStats(activeWin);
  const probeStats = computeRttStats(probeWin);

  const activeMedian = activeStats.median;
  const probeRawMedian = probeStats.median;
  // Cộng hệ số bù tải 20Hz vào kết quả của probeSocket
  const probeEffectiveMedian = probeRawMedian + LOAD_HANDICAP_MS;
  const netGainMs = activeMedian - probeEffectiveMedian;

  const activeTier = getColoTier(activeColo);
  const probeTier = getColoTier(probeColo);
  const sameColo = activeColo.toUpperCase() === probeColo.toUpperCase();

  const baseResult = {
    activeMedian,
    probeRawMedian,
    probeEffectiveMedian,
    activeColo,
    probeColo,
  };

  // 1. Chặn nếu không đủ mẫu đo tin cậy
  if (probeStats.samples < 4) {
    return { ...baseResult, shouldSwitch: false, reason: 'insufficient_probe_samples' };
  }

  // 2. Chặn nếu tuyến Probe bị suy thoái Tier địa lý (ví dụ đang ở NRT Tier 1 mà probe rơi sang FRA Tier 2)
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
  if (probeTier < activeTier && netGainMs >= 10) {
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
  // - Nếu cả 2 đều ở Tier 0 (Ví dụ: SIN vs HKG): Cả hai đều là trạm tối ưu nhất cho Việt Nam.
  //   NẾU active RTT <= 90ms: TUYỆT ĐỐI KHÔNG CHUYỂN! Tránh bão ping-pong nhảy qua lại giữa SIN và HKG.
  //   CHỈ chuyển khi active RTT thực sự bị nghẽn (> 90ms) VÀ trạm đối tác đạt RTT <= 65ms với mức cải thiện netGainMs >= 30ms!
  // - Nếu cùng Tier 1 (APAC) hoặc Tier 2 (ngoài khu vực): chuyển nếu netGainMs >= 20ms VÀ (probeRawMedian <= 90ms HOẶC probeEffectiveMedian <= activeMedian * 0.80)
  if (!sameColo && probeTier === activeTier) {
    if (activeTier === 0) {
      if (activeMedian > HIGH_PING_THRESHOLD_MS && netGainMs >= 30 && probeRawMedian <= 65) {
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
      (probeRawMedian <= HIGH_PING_THRESHOLD_MS || probeEffectiveMedian <= activeMedian * 0.80)
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
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private isReconnecting = false;
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;
  public sessionToken: string | null = null;
  private pingInterval: number | null = null;
  public rtt = 0;
  public rttMin = 0;
  public netRtt = 48;
  public rttJitter = 0;
  public clockOffset: number | null = null;
  public colo = '';
  public doColo = '';
  public inGame = false;
  private reconnectTimer: number | null = null;
  private readonly rttWin: number[] = [];
  private lastPongRecvPerf = 0;
  private lastRawRtt = 48;
  private smoothedRtt = 48;

  // Quản lý endpoint và xoay vòng ECMP
  private endpointIdx = 0;
  private readonly endpoints: string[];

  // Điều khiển Probe & Hot Migration chống bão
  public isMigrating = false;
  private probeWs: WebSocket | null = null;
  private probing = false;
  private consecutiveHighPing = 0;
  private consecutiveFailedProbes = 0;
  private nextProbeAllowedAt = 0;
  private baselineMedianAtLastFailure = 0;

  // Lobby steering
  private lastLobbyReconnectTime = 0;
  private lobbySteerAttempts = 0;

  // Callbacks
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
      this.sessionToken =
        sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) ||
        sessionStorage.getItem('fb_session_token');
    } catch (_) {}

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.connect();
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && !document.hidden) {
      // Khi người chơi quay lại tab, reset đếm spike ảo do trình duyệt bóp timer
      this.consecutiveHighPing = 0;
    }
  };

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

  /**
   * Tạo URL kết nối WebSocket có hỗ trợ cache-busting / nonce cho Probe
   */
  private buildEndpointUrl(isProbe: boolean): string {
    const base = isProbe ? this.nextEndpointUrl() : this.getActiveUrl();
    const url = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
    if (isProbe) {
      const nonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      url.searchParams.set('_probe', nonce);
      url.searchParams.set('_t', Date.now().toString());
    }
    return url.toString();
  }

  private connect(customUrl?: string): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(customUrl || this.buildEndpointUrl(false));
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
      this.handlePrimaryMessage(event.data);
    };

    socket.onclose = (ev) => {
      if (this.ws !== socket) return;
      this.stopPing();
      if (ev.reason === 'Handover') return;
      if (this.isMigrating && this.probeWs !== null) return;
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      if (this.isMigrating && this.probeWs !== null) return;
      this.onStatus?.('error');
    };
  }

  private handlePrimaryMessage(raw: string | ArrayBuffer): void {
    try {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

      // Fast-path xử lý pong
      if (text.startsWith('{"t":"pong"')) {
        const msg = JSON.parse(text) as ServerMsg;
        if (msg.t === 'pong') {
          if (msg.colo) this.colo = msg.colo.toUpperCase();
          if (msg.doColo) this.doColo = msg.doColo.toUpperCase();

          // Tránh ghi nhận RTT sai lệch khi tab đang bị ẩn
          if (typeof document !== 'undefined' && document.hidden) return;

          const now = performance.now();
          const s = now - msg.c;
          if (s >= 0 && s < 2500) {
            this.recordPrimaryRtt(s, now, msg.s);
          }
        }
        return;
      }

      const parsed = JSON.parse(text) as ServerMsg;
      if (parsed.t === 'joined') {
        if (parsed.colo) this.colo = parsed.colo.toUpperCase();
        if (parsed.doColo) this.doColo = parsed.doColo.toUpperCase();
        if (parsed.token) {
          this.sessionToken = parsed.token;
          try {
            sessionStorage.setItem(`fb_tok_${this.getRoomKey()}`, parsed.token);
            sessionStorage.setItem('fb_session_token', parsed.token);
          } catch (_) {}
          if (this.lastJoinMsg) {
            this.lastJoinMsg.token = parsed.token;
          }
        }
      } else if (parsed.t === 's') {
        const snap = parsed as import('@shared/protocol').Snapshot;
        if (typeof snap.st === 'number' && this.clockOffset !== null) {
          const transitEstimate = (this.rttMin || 48) * 0.5;
          const candidateOffset = snap.st - (performance.now() - transitEstimate);
          if (candidateOffset > this.clockOffset) {
            this.clockOffset = candidateOffset;
          } else {
            this.clockOffset += (candidateOffset - this.clockOffset) * 0.02;
          }
        }
      }

      this.onMsg(parsed);
    } catch (err) {
      console.error('Failed to parse primary server message:', err);
    }
  }

  private recordPrimaryRtt(rawRtt: number, recvNow = performance.now(), serverTime?: number): void {
    const interArrival = this.lastPongRecvPerf > 0 ? recvNow - this.lastPongRecvPerf : PING_INTERVAL_MS;
    this.lastPongRecvPerf = recvNow;

    const isQueuedBurstTail = interArrival < 80 && rawRtt < this.lastRawRtt;
    this.lastRawRtt = rawRtt;

    if (this.rttWin.length === 0) {
      this.rttWin.push(rawRtt);
      this.rttMin = Math.round(rawRtt);
      this.smoothedRtt = rawRtt;
      this.rtt = Math.round(rawRtt);
      this.netRtt = Math.round(rawRtt);
      if (typeof serverTime === 'number') {
        this.clockOffset = serverTime - (recvNow - rawRtt * 0.5);
      }
      return;
    }

    if (!isQueuedBurstTail) {
      const clampedForWindow =
        rawRtt > this.rttMin * 2.5 + 60
          ? Math.min(rawRtt, this.rttMin + 90)
          : rawRtt;

      this.rttWin.push(clampedForWindow);
      if (this.rttWin.length > RTT_WINDOW_SIZE) {
        this.rttWin.shift();
      }
    }

    const stats = computeRttStats(this.rttWin);
    this.rttMin = stats.min;
    this.rttJitter = stats.jitter;

    if (rawRtt <= this.smoothedRtt) {
      this.smoothedRtt += (rawRtt - this.smoothedRtt) * 0.45;
    } else {
      const cappedSpike = Math.min(rawRtt, this.smoothedRtt + 35);
      this.smoothedRtt += (cappedSpike - this.smoothedRtt) * 0.15;
    }

    this.rtt = Math.round(this.smoothedRtt);
    this.netRtt = Math.round(this.rttMin + Math.min(25, this.rttJitter * 0.5));

    if (typeof serverTime === 'number' && rawRtt <= this.rttMin + 15) {
      const bestOffset = serverTime - (recvNow - rawRtt * 0.5);
      if (this.clockOffset === null) {
        this.clockOffset = bestOffset;
      } else {
        this.clockOffset += (bestOffset - this.clockOffset) * 0.3;
      }
    }

    const currentTier = getColoTier(this.colo);

    // Đếm số mẫu liên tiếp vượt ngưỡng 90ms
    if (this.rtt > HIGH_PING_THRESHOLD_MS) {
      this.consecutiveHighPing += 1;
    } else {
      this.consecutiveHighPing = 0;
    }

    // Nếu mạng bất ngờ vọt lên thêm > 35ms hoặc rớt sang Tier 2 (Châu Âu/Mỹ),
    // xóa Cooldown để dò tuyến khẩn cấp ngay
    if (
      this.consecutiveFailedProbes > 0 &&
      (this.rtt > this.baselineMedianAtLastFailure + 35 || currentTier === 2)
    ) {
      this.consecutiveFailedProbes = 0;
      this.nextProbeAllowedAt = 0;
    }

    // LOBBY STEER: Nếu ở sảnh chờ mà dính Tier 2 hoặc ping > 90ms kéo dài
    if (!this.inGame && !this.closed) {
      const now = performance.now();
      if ((currentTier === 2 || this.rtt > HIGH_PING_THRESHOLD_MS) && now - this.lastLobbyReconnectTime > 3500 && this.lobbySteerAttempts < 3) {
        this.lastLobbyReconnectTime = now;
        this.lobbySteerAttempts++;
        console.log(`[WS] Lobby steer attempt ${this.lobbySteerAttempts}/3: currently ${this.colo} ~${Math.round(this.rtt)}ms`);
        this.forceReconnect();
        return;
      }
    }

    // IN-GAME HOT MIGRATION: Tự động đổi nếu ping > 90ms
    this.checkAndTriggerHotMigration(currentTier);
  }

  private checkAndTriggerHotMigration(currentTier: ColoTier): void {
    if (!this.inGame || this.probing || this.closed || !this.sessionToken) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const now = Date.now();
    if (now < this.nextProbeAllowedAt) return;

    // Điều kiện 1: Bị định tuyến nhầm ra ngoài khu vực (Tier 2 Châu Âu/Mỹ) -> dò ngay khi có >= 2 mẫu
    const isOutOfRegionDetour = currentTier === 2 && this.rttWin.length >= 2;

    // Điều kiện 2: Ping trung vị > 90ms duy trì liên tục (3 chu kỳ)
    const isSustainedAbove90ms =
      this.rttWin.length >= 4 &&
      this.rtt > HIGH_PING_THRESHOLD_MS &&
      this.consecutiveHighPing >= SUSTAINED_HIGH_PING_SAMPLES;

    if (isOutOfRegionDetour || isSustainedAbove90ms) {
      this.triggerHotMigration(false);
    }
  }

  /**
   * Kích hoạt Hot Migration song song:
   * Mở probeSocket chạy ngầm, bắn ping có đệm tải để đo RTT thực tế,
   * đánh giá qua hàm toán học evaluateMigrationDecision.
   * Nếu đạt chuẩn: gửi join(handover) -> nhận joined -> tráo socket nguyên tử!
   */
  public triggerHotMigration(isManual = false): void {
    if (!this.inGame || this.closed || this.probing) return;
    this.probing = true;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);

    const probeUrl = this.buildEndpointUrl(true);
    let candidateWs: WebSocket;
    try {
      candidateWs = new WebSocket(probeUrl);
      this.probeWs = candidateWs;
    } catch (e) {
      this.probing = false;
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
      return;
    }

    const probeSamples: number[] = [];
    let probeColo = '';
    let probeDoColo = '';
    let pingsSent = 0;
    let pongsReceived = 0;
    let probeInterval: number | null = null;
    let handoverTimer: number | null = null;
    let awaitingHandoverAck = false;
    const bufferedMessagesDuringHandover: (string | ArrayBuffer)[] = [];

    const cleanupProbe = (closeSocket: boolean) => {
      if (probeInterval !== null) {
        clearInterval(probeInterval);
        probeInterval = null;
      }
      if (handoverTimer !== null) {
        clearTimeout(handoverTimer);
        handoverTimer = null;
      }
      if (closeSocket && candidateWs) {
        candidateWs.onopen = null;
        candidateWs.onmessage = null;
        candidateWs.onerror = null;
        candidateWs.onclose = null;
        try {
          if (candidateWs.readyState === WebSocket.OPEN || candidateWs.readyState === WebSocket.CONNECTING) {
            candidateWs.close(1000, 'ProbeAborted');
          }
        } catch (_) {}
      }
      if (this.probeWs === candidateWs) {
        this.probeWs = null;
      }
      this.probing = false;
    };

    // Timeout tổng lực 4.5s cho toàn bộ chu trình Probe
    const overallTimeout = window.setTimeout(() => {
      if (!awaitingHandoverAck) {
        this.scheduleAdaptiveBackoff();
        cleanupProbe(true);
        this.isMigrating = false;
        this.onMigrationStatus?.('failed', this.colo);
      }
    }, PROBE_TIMEOUT_MS);

    candidateWs.onopen = () => {
      if (this.closed || this.probeWs !== candidateWs) {
        clearTimeout(overallTimeout);
        cleanupProbe(true);
        return;
      }

      const sendProbePing = () => {
        if (candidateWs.readyState !== WebSocket.OPEN) return;
        pingsSent += 1;
        candidateWs.send(
          JSON.stringify({
            t: 'ping',
            c: Math.round(performance.now()),
            pad: PROBE_PAYLOAD_PADDING,
          })
        );
        if (pingsSent >= PROBE_WARMUP_PINGS + PROBE_MEASURE_PINGS && probeInterval !== null) {
          clearInterval(probeInterval);
          probeInterval = null;
        }
      };

      sendProbePing();
      probeInterval = window.setInterval(sendProbePing, PROBE_PING_SPACING_MS);
    };

    candidateWs.onmessage = (ev: MessageEvent) => {
      if (this.closed || this.probeWs !== candidateWs) {
        clearTimeout(overallTimeout);
        cleanupProbe(true);
        return;
      }

      // GIAI ĐOẠN 1: Thu thập mẫu Ping trên probeSocket
      if (!awaitingHandoverAck) {
        try {
          const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
          if (text.startsWith('{"t":"pong"')) {
            const msg = JSON.parse(text) as ServerMsg;
            if (msg.t === 'pong') {
              const rtt = Math.max(1, performance.now() - msg.c);
              if (msg.colo) probeColo = msg.colo.toUpperCase();
              if (msg.doColo) probeDoColo = msg.doColo.toUpperCase();

              pongsReceived += 1;
              // Bỏ qua mẫu đầu tiên (Warmup)
              if (pongsReceived > PROBE_WARMUP_PINGS) {
                probeSamples.push(rtt);
              }

              if (probeSamples.length >= PROBE_MEASURE_PINGS) {
                clearTimeout(overallTimeout);
                if (probeInterval !== null) {
                  clearInterval(probeInterval);
                  probeInterval = null;
                }

                const decision = evaluateMigrationDecision(
                  this.rttWin,
                  this.colo,
                  probeSamples,
                  probeColo || this.colo
                );

                console.log(`[WS Hot Migration] Decision: switch=${decision.shouldSwitch}, reason=${decision.reason}, active=${decision.activeMedian}ms(${this.colo}), probeEff=${decision.probeEffectiveMedian}ms(${probeColo})`);

                if (!decision.shouldSwitch && !isManual) {
                  // Không tìm thấy tuyến tốt hơn -> ngắt probe êm ái và giãn Cooldown
                  this.scheduleAdaptiveBackoff();
                  cleanupProbe(true);
                  this.isMigrating = false;
                  this.onMigrationStatus?.('failed', this.colo);
                  return;
                }

                // GIAI ĐOẠN 2: Tuyến mới tốt hơn thực sự -> Gửi lệnh join(handover)
                awaitingHandoverAck = true;
                if (this.lastJoinMsg) {
                  candidateWs.send(
                    JSON.stringify({
                      ...this.lastJoinMsg,
                      token: this.sessionToken || undefined,
                    })
                  );
                }

                handoverTimer = window.setTimeout(() => {
                  this.scheduleAdaptiveBackoff();
                  cleanupProbe(true);
                  this.isMigrating = false;
                  this.onMigrationStatus?.('failed', this.colo);
                }, HANDOVER_ACK_TIMEOUT_MS);
              }
            }
          }
        } catch (_) {
          cleanupProbe(true);
        }
        return;
      }

      // GIAI ĐOẠN 2: Đang chờ xác nhận 'joined' từ DO
      if (awaitingHandoverAck) {
        try {
          const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
          const parsed = JSON.parse(text) as ServerMsg;
          if (parsed.t === 'joined') {
            // HOÀN TẤT HANDOVER: Tráo socket nguyên tử trong 1 tick!
            clearTimeout(overallTimeout);
            this.completeAtomicSocketSwap(
              candidateWs,
              probeSamples,
              probeColo || parsed.colo || this.colo,
              probeDoColo || parsed.doColo || this.doColo,
              parsed,
              bufferedMessagesDuringHandover
            );
            cleanupProbe(false); // Không đóng candidateWs vì nó đã là this.ws!
            return;
          }
          if (parsed.t === 'init') {
            // TUYỆT ĐỐI bỏ qua init khi đang hot handover vì GameState đã có sẵn map và clock!
            // Nếu xử lý init sẽ gọi resetClock() và xóa toàn bộ lịch sử nội suy nhân vật.
            return;
          }
        } catch (_) {
          // Bỏ qua nếu tin nhắn không phải JSON
        }
        // Đệm các snapshot 20Hz đến sát thời điểm handover
        if (typeof ev.data === 'string' && ev.data.startsWith('{"t":"s"')) {
          bufferedMessagesDuringHandover.push(ev.data);
        }
      }
    };

    candidateWs.onerror = () => {
      clearTimeout(overallTimeout);
      this.scheduleAdaptiveBackoff();
      cleanupProbe(true);
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
    };

    candidateWs.onclose = () => {
      if (this.probing && this.probeWs === candidateWs) {
        clearTimeout(overallTimeout);
        this.scheduleAdaptiveBackoff();
        cleanupProbe(false);
        this.isMigrating = false;
        this.onMigrationStatus?.('failed', this.colo);
      }
    };
  }

  /**
   * Tráo con trỏ socket chính sang candidateWs ngay khi nhận được xác nhận 'joined':
   * - Hủy listener trên socket cũ và đóng an toàn với mã 'Handover'
   * - Khởi tạo cửa sổ RTT mới với hệ số bù tải
   * - Đặt thời gian ân hạn POST_SWITCH_GRACE_MS (25s)
   */
  private completeAtomicSocketSwap(
    newWs: WebSocket,
    probeSamples: number[],
    newColo: string,
    newDoColo: string,
    joinedMsg: ServerMsg,
    bufferedMessages: (string | ArrayBuffer)[]
  ): void {
    const oldWs = this.ws;

    // 1. Gỡ bỏ listener của socket cũ trước khi close() để không kích hoạt reconnect loop
    if (oldWs) {
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try {
        oldWs.close(1000, 'Handover');
      } catch (_) {}
    }

    // 2. Gán socket mới làm socket chính
    this.ws = newWs;
    this.colo = newColo.toUpperCase();
    this.doColo = newDoColo.toUpperCase();

    // 3. Khởi tạo cửa sổ RTT mới (đã cộng bù tải 12ms)
    this.rttWin.length = 0;
    for (const s of probeSamples) {
      this.rttWin.push(s + LOAD_HANDICAP_MS);
    }
    const stats = computeRttStats(this.rttWin);
    this.rttMin = stats.min;
    this.rtt = stats.median;
    this.rttJitter = stats.jitter;

    // 4. Reset bộ đếm chống bão và khóa probe trong thời gian ân hạn 25s
    this.consecutiveHighPing = 0;
    this.consecutiveFailedProbes = 0;
    this.nextProbeAllowedAt = Date.now() + POST_SWITCH_GRACE_MS;
    this.isMigrating = false;

    // 5. Gắn listener hoạt động chính thức cho newWs
    newWs.onmessage = (ev: MessageEvent) => {
      if (this.ws !== newWs) return;
      this.handlePrimaryMessage(ev.data);
    };

    newWs.onclose = (ev) => {
      if (this.ws !== newWs || this.closed) return;
      this.stopPing();
      if (ev.reason === 'Handover') return;
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    newWs.onerror = () => {
      if (this.ws !== newWs || this.closed) return;
      this.onStatus?.('error');
    };

    // 6. Thông báo thành công ra HUD và chuyển tin nhắn 'joined' cho GameState
    this.onMigrationStatus?.('migrated', this.colo);
    this.onMigrationSuccess?.(this.colo);
    this.onMsg(joinedMsg);

    for (const bufMsg of bufferedMessages) {
      this.handlePrimaryMessage(bufMsg);
    }
  }

  /**
   * Tăng thời gian nghỉ theo cấp số nhân (15s -> 30s -> 60s -> 120s)
   * khi mạng của ISP không có bất kỳ tuyến nào dưới 90ms.
   */
  private scheduleAdaptiveBackoff(): void {
    this.consecutiveFailedProbes += 1;
    this.baselineMedianAtLastFailure = this.rtt;
    const backoffMs = Math.min(
      MAX_PROBE_COOLDOWN_MS,
      BASE_PROBE_COOLDOWN_MS * Math.pow(2, this.consecutiveFailedProbes - 1)
    );
    this.nextProbeAllowedAt = Date.now() + backoffMs;
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
        this.send({ t: 'ping', c: now });
      }
    }, PING_INTERVAL_MS);
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

  public send(m: ClientMsg): void {
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

  public leaveGame(): void {
    this.inGame = false;
    this.isMigrating = false;
    this.sessionToken = null;
    this.lastJoinMsg = null;
    this.queue.length = 0;
    try {
      sessionStorage.removeItem(`fb_tok_${this.getRoomKey()}`);
      sessionStorage.removeItem('fb_session_token');
    } catch (_) {}
    if (this.probeWs) {
      try {
        this.probeWs.close();
      } catch (_) {}
      this.probeWs = null;
    }
    try {
      this.send({ t: 'leave' });
    } catch (_) {}
  }

  public manualRetune(): void {
    if (this.closed) return;
    this.nextProbeAllowedAt = 0;
    this.consecutiveHighPing = SUSTAINED_HIGH_PING_SAMPLES;
    this.consecutiveFailedProbes = 0;
    if (this.inGame) {
      if (this.probeWs) {
        try {
          this.probeWs.close();
        } catch (_) {}
        this.probeWs = null;
        this.probing = false;
        this.isMigrating = false;
      }
      this.triggerHotMigration(true);
    } else {
      this.nextEndpointUrl();
      this.forceReconnect();
    }
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.stopPing();
    this.probing = false;
    this.isMigrating = false;
    if (this.probeWs) {
      try {
        this.probeWs.close();
      } catch (_) {}
      this.probeWs = null;
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

  public close(): void {
    this.closed = true;
    this.probing = false;
    this.isMigrating = false;
    this.stopPing();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.probeWs) {
      try {
        this.probeWs.close();
      } catch (_) {}
      this.probeWs = null;
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
