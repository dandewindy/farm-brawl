import type { ClientMsg, ServerMsg, Snapshot } from '@shared/protocol';
import type { Handler, Transport } from './transport';

// ============================================================================
// HẰNG SỐ ĐIỀU KHIỂN ĐUA MẠNG & HOT MIGRATION (SUB-350MS EDGE ACQUISITION)
// ============================================================================
const PING_INTERVAL_MS = 350;              // Đo mỗi 350ms để phát hiện và phản ứng nhanh gấp đôi
export const HIGH_PING_THRESHOLD_MS = 90;  // Ngưỡng ping yêu cầu của người chơi
const SUSTAINED_HIGH_PING_SAMPLES = 3;     // 3 mẫu * 350ms = 1.05s (thay vì 4.0s như cũ)
export const LOAD_HANDICAP_MS = 12;        // Hệ số bù tải 20Hz chống bão Ping-Pong

// Cấu hình đua đa kết nối song song (Parallel ECMP Socket Spraying)
const INITIAL_RACE_CONCURRENCY = 4;        // Mở 4 socket đồng thời lúc mới vào game
const INITIAL_RACE_MAX_WAIT_MS = 420;      // Chốt kết quả đua khởi tạo tối đa trong 420ms
const LOBBY_SWEEP_INTERVAL_MS = 900;       // Chu kỳ quét tìm SIN/HKG ở sảnh chờ: 900ms
const LOBBY_SWEEP_CONCURRENCY = 3;         // Mỗi đợt quét sảnh bắn 3 socket song song

// Cấu hình Probe nhanh trong trận (In-Game Fast Parallel Probe)
const INGAME_PROBE_CONCURRENCY = 3;        // Mở 3 probe socket đồng thời để đổi 3 srcPort ECMP
const PROBE_WARMUP_PINGS = 1;              // Bỏ qua 1 mẫu đầu
const PROBE_MEASURE_PINGS = 3;             // Đo 3 mẫu nhanh (3 * 90ms = 270ms)
const PROBE_PING_SPACING_MS = 90;          // Khoảng cách giữa các ping khi probe: 90ms
const PROBE_OVERALL_TIMEOUT_MS = 1800;     // Timeout tối đa cho 1 đợt probe
const POST_SWITCH_GRACE_MS = 12_000;       // Thời gian ổn định sau khi vừa chuyển tuyến thành công

const PROBE_PAYLOAD_PADDING =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Phân tầng địa lý các trạm Cloudflare Edge POP cho người chơi tại Việt Nam & Đông Nam Á:
 * - Tier 0 (Mục tiêu tối ưu < 65ms): SIN (Singapore), HKG (Hồng Kông), SGN/HAN/DAD (Việt Nam), BKK, KUL
 * - Tier 1 (Châu Á lân cận 65ms - 125ms): TPE, MNL, CGK, CAN, SZX, NRT, HND, KIX, ICN
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
  jitter: number;
  samples: number;
}

export function computeRttStats(win: number[]): RttStats {
  if (win.length === 0) return { min: 48, median: 48, jitter: 0, samples: 0 };
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
  return {
    min: Math.round(min),
    median,
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
  // Ở sảnh chờ chưa có tải snapshot 20Hz mạnh như trong trận nên handicap thấp hơn
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
  // - Nếu cả 2 đều ở Tier 0 (Ví dụ: SIN vs HKG): Cả hai đều là trạm tối ưu nhất cho Việt Nam.
  //   NẾU active RTT <= 90ms: TUYỆT ĐỐI KHÔNG CHUYỂN! Tránh bão ping-pong nhảy qua lại giữa SIN và HKG.
  //   CHỈ chuyển khi active RTT thực sự bị nghẽn (> 90ms) VÀ trạm đối tác đạt RTT <= 65ms với mức cải thiện netGainMs >= 30ms!
  // - Nếu cùng Tier 1 (APAC) hoặc Tier 2 (ngoài khu vực): chuyển nếu netGainMs >= 20ms VÀ (probeRawMedian <= 90ms HOẶC probeEffectiveMedian <= activeMedian * 0.8)
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

interface CandidateResult {
  ws: WebSocket;
  url: string;
  colo: string;
  doColo: string;
  tier: ColoTier;
  rtts: number[];
  bestRtt: number;
  medianRtt: number;
  clockOffset: number | null;
  earlyMessages: (string | ArrayBuffer)[];
}

export class WsClient implements Transport {
  public ws: WebSocket | null = null;
  public rtt = 48;
  public rttMin = 48;
  public netRtt = 48;
  public jitter = 0;
  public clockOffset: number | null = null;
  public colo = '';
  public doColo = '';
  public inGame = false;
  public isMigrating = false;
  public sessionToken: string | null = null;
  public closed = false;

  private baseUrls: string[] = [];
  private urlCursor = 0;
  private readonly rttWin: number[] = [];

  private pingInterval: number | null = null;
  private lobbySweepTimer: number | null = null;
  private reconnectTimer: number | null = null;

  private lastPongRecvPerf = 0;
  private lastRawRtt = 48;
  private smoothedRtt = 48;

  // Quản lý trạng thái dò mạng & Hot Migration
  private probing = false;
  private activeProbeSockets: WebSocket[] = [];
  private consecutiveHighPing = 0;
  private consecutiveFailedProbes = 0;
  private nextProbeAllowedAt = 0;
  private outboundQueue: ClientMsg[] = [];
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;

  // Callbacks
  public onMigrationSuccess?: (newColo: string) => void;
  public onMigrationStatus?: (status: 'probing' | 'migrated' | 'failed', colo?: string) => void;

  constructor(
    primaryUrl: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void,
    altUrls: string[] = []
  ) {
    const dedup = new Set<string>([primaryUrl, ...altUrls.filter(Boolean)]);
    this.baseUrls = Array.from(dedup);

    try {
      this.sessionToken =
        sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) ||
        sessionStorage.getItem('fb_session_token');
    } catch (_) {}

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Khởi chạy ngay cuộc đua 4 luồng song song để bắt SIN/HKG trong < 350ms!
    this.startInitialParallelRace();
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && !document.hidden) {
      this.consecutiveHighPing = 0;
    }
  };

  private getRoomKey(): string {
    try {
      const u = new URL(this.baseUrls[0]);
      return u.searchParams.get('room') || 'pub-1';
    } catch {
      return 'pub-1';
    }
  }

  /**
   * Tạo URL kèm tham số ngẫu nhiên (_r) để tránh gom kết nối và đổi cổng nguồn ECMP
   */
  private buildRaceUrl(slotIndex: number): string {
    const base =
      this.baseUrls[(this.urlCursor + slotIndex) % this.baseUrls.length];
    const sep = base.includes('?') ? '&' : '?';
    const nonce = `${Date.now().toString(36)}_${slotIndex}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    return `${base}${sep}_r=${nonce}`;
  }

  /**
   * GIAI ĐOẠN 1: Đua 4 kết nối WebSocket song song ngay khi vào trang web.
   * Giữ cả 4 socket mở đồng thời trong quá trình bắt tay để OS cấp 4 srcPort khác nhau,
   * ép router BGP/ECMP của VNPT/Viettel/FPT thử 4 nhánh cáp quốc tế cùng lúc!
   */
  private startInitialParallelRace(): void {
    if (this.closed) return;
    this.onStatus?.('connecting');

    const concurrency = Math.max(INITIAL_RACE_CONCURRENCY, this.baseUrls.length);
    const candidates: CandidateResult[] = [];
    const rawSockets: WebSocket[] = [];
    let settled = false;

    const finalizeWinner = (winner: CandidateResult) => {
      if (settled || this.closed) return;
      settled = true;
      this.urlCursor = (this.urlCursor + 1) % this.baseUrls.length;

      // Đóng ngay lập tức toàn bộ các socket thua cuộc
      for (const s of rawSockets) {
        if (s !== winner.ws) {
          s.onopen = null;
          s.onmessage = null;
          s.onerror = null;
          s.onclose = null;
          try {
            s.close(1000, 'RaceLoser');
          } catch {}
        }
      }

      // Thiết lập socket thắng cuộc làm kết nối chính
      this.promoteSocketToPrimary(winner, false);
    };

    const evaluateCurrentCandidates = () => {
      if (settled || candidates.length === 0) return;

      candidates.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return a.bestRtt - b.bestRtt;
      });

      const best = candidates[0];
      // Nếu đã bắt được trạm chuẩn Đông Nam Á (SIN/HKG - Tier 0) với RTT <= 85ms:
      // Chốt thắng cuộc NGAY LẬP TỨC không cần đợi hết 420ms!
      if (best.tier === 0 && best.bestRtt <= 85) {
        finalizeWinner(best);
      }
    };

    // Đặt đồng hồ chốt kết quả sau tối đa 420ms
    const raceDeadline = window.setTimeout(() => {
      if (settled || this.closed) return;
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (a.tier !== b.tier) return a.tier - b.tier;
          return a.bestRtt - b.bestRtt;
        });
        finalizeWinner(candidates[0]);
      }
    }, INITIAL_RACE_MAX_WAIT_MS);

    for (let i = 0; i < concurrency; i++) {
      const url = this.buildRaceUrl(i);
      let sock: WebSocket;
      try {
        sock = new WebSocket(url);
      } catch {
        continue;
      }
      rawSockets.push(sock);

      const cand: CandidateResult = {
        ws: sock,
        url,
        colo: '',
        doColo: '',
        tier: 2,
        rtts: [],
        bestRtt: 9999,
        medianRtt: 9999,
        clockOffset: null,
        earlyMessages: [],
      };

      const connectStartPerf = performance.now();

      sock.onopen = () => {
        if (settled || this.closed) {
          try {
            sock.close(1000, 'LateOpen');
          } catch {}
          return;
        }
        // Bắn ngay lập tức gói ping ở 0ms (không đợi 500ms như code cũ!)
        try {
          sock.send(`{"t":"ping","c":${Math.round(performance.now())}}`);
        } catch {}
      };

      sock.onmessage = (ev: MessageEvent) => {
        if (settled || this.closed) return;
        const recvPerf = performance.now();
        const text =
          typeof ev.data === 'string'
            ? ev.data
            : new TextDecoder().decode(ev.data as ArrayBuffer);

        // Xử lý gói hello (0ms) hoặc pong từ Server
        if (text.startsWith('{"t":"hello"') || text.startsWith('{"t":"pong"')) {
          try {
            const msg = JSON.parse(text) as {
              t: 'hello' | 'pong';
              c?: number;
              s?: number;
              colo?: string;
              doColo?: string;
            };
            if (msg.colo) {
              cand.colo = msg.colo.toUpperCase();
              cand.tier = getColoTier(cand.colo);
            }
            if (msg.doColo) {
              cand.doColo = msg.doColo.toUpperCase();
            }

            const rtt =
              typeof msg.c === 'number'
                ? Math.max(1, recvPerf - msg.c)
                : Math.max(5, (recvPerf - connectStartPerf) * 0.5);

            cand.rtts.push(rtt);
            cand.bestRtt = Math.min(cand.bestRtt, rtt);
            cand.medianRtt = computeRttStats(cand.rtts).median;

            if (typeof msg.s === 'number') {
              cand.clockOffset = msg.s - (recvPerf - rtt * 0.5);
            }

            if (!candidates.includes(cand)) {
              candidates.push(cand);
            }

            if (msg.t === 'hello') {
              try {
                sock.send(`{"t":"ping","c":${Math.round(performance.now())}}`);
              } catch {}
            } else {
              evaluateCurrentCandidates();
            }

            // Nếu tất cả các socket đã báo kết quả về, chốt người thắng ngay
            if (candidates.length >= rawSockets.length && msg.t === 'pong') {
              clearTimeout(raceDeadline);
              candidates.sort((a, b) => {
                if (a.tier !== b.tier) return a.tier - b.tier;
                return a.bestRtt - b.bestRtt;
              });
              finalizeWinner(candidates[0]);
            }
          } catch {}
          return;
        }

        // Lưu lại các bản tin khởi tạo phòng gửi về sớm để phát lại khi socket thắng cuộc
        cand.earlyMessages.push(ev.data);
        if (!candidates.includes(cand)) {
          cand.bestRtt = Math.max(10, (recvPerf - connectStartPerf) * 0.5);
          cand.medianRtt = cand.bestRtt;
          candidates.push(cand);
        }
      };

      sock.onerror = () => {};
    }

    // Bảo vệ trường hợp mạng chập chờn chưa socket nào kịp trả lời trong 420ms
    window.setTimeout(() => {
      if (!settled && !this.closed) {
        if (candidates.length > 0) {
          candidates.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return a.bestRtt - b.bestRtt;
          });
          finalizeWinner(candidates[0]);
        } else {
          const openSock = rawSockets.find(
            (s) => s.readyState === WebSocket.OPEN
          );
          if (openSock) {
            finalizeWinner({
              ws: openSock,
              url: this.baseUrls[0],
              colo: this.colo || 'SIN',
              doColo: this.doColo || 'SIN',
              tier: getColoTier(this.colo),
              rtts: [60],
              bestRtt: 60,
              medianRtt: 60,
              clockOffset: null,
              earlyMessages: [],
            });
          } else {
            this.reconnectTimer = window.setTimeout(
              () => this.startInitialParallelRace(),
              800
            );
          }
        }
      }
    }, INITIAL_RACE_MAX_WAIT_MS + 600);
  }

  /**
   * Đưa ứng viên thắng cuộc lên làm Socket chính thức (dùng cho cả lúc khởi tạo và khi Hot-Swap)
   */
  private promoteSocketToPrimary(
    winner: CandidateResult,
    isHotSwap: boolean
  ): void {
    const oldWs = this.ws;
    if (oldWs && oldWs !== winner.ws) {
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try {
        oldWs.close(1000, 'SwappedToFasterRoute');
      } catch {}
    }

    this.ws = winner.ws;
    if (winner.colo) this.colo = winner.colo;
    if (winner.doColo) this.doColo = winner.doColo;
    if (winner.clockOffset !== null) this.clockOffset = winner.clockOffset;

    const handicap = isHotSwap && this.inGame ? LOAD_HANDICAP_MS : 0;
    const seededRtts =
      winner.rtts.length > 0
        ? winner.rtts.map((r) => Math.round(r + handicap))
        : [50];

    this.rttWin.length = 0;
    for (const r of seededRtts) {
      this.rttWin.push(r);
    }

    const stats = computeRttStats(this.rttWin);
    this.rttMin = stats.min;
    this.rtt = stats.median;
    this.netRtt = stats.min + Math.min(20, Math.round(stats.jitter * 0.5));
    this.smoothedRtt = stats.median;
    this.jitter = stats.jitter;

    this.consecutiveHighPing = 0;
    this.consecutiveFailedProbes = 0;
    if (isHotSwap) {
      this.nextProbeAllowedAt = performance.now() + POST_SWITCH_GRACE_MS;
      this.onMigrationStatus?.('migrated', this.colo);
      this.onMigrationSuccess?.(this.colo);
    }

    const activeSock = winner.ws;
    activeSock.onmessage = (ev: MessageEvent) => {
      if (this.ws !== activeSock || this.closed) return;
      this.handlePrimaryMessage(ev.data);
    };

    activeSock.onclose = (ev) => {
      if (this.ws !== activeSock || this.closed) return;
      this.stopPing();
      if (ev.reason === 'Handover') return;
      this.onStatus?.('closed');
      this.reconnectTimer = window.setTimeout(() => {
        if (!this.closed) this.startInitialParallelRace();
      }, 600);
    };

    activeSock.onerror = () => {
      if (this.ws !== activeSock || this.closed) return;
      this.onStatus?.('error');
    };

    // Xả các gói tin đang chờ trong hàng đợi
    while (
      this.outboundQueue.length > 0 &&
      activeSock.readyState === WebSocket.OPEN
    ) {
      const pkt = this.outboundQueue.shift()!;
      activeSock.send(JSON.stringify(pkt));
    }

    // Phát lại các gói tin đến sớm trong lúc đua
    for (const earlyMsg of winner.earlyMessages) {
      this.handlePrimaryMessage(earlyMsg);
    }

    this.onStatus?.(isHotSwap ? 'reconnected' : 'open');
    this.startPing();
    this.startLobbyBackgroundSweep();
  }

  /**
   * GIAI ĐOẠN 2: Dò mạng ngầm liên tục ở Sảnh chờ (Non-Disruptive Lobby Sweep).
   * Nếu khi ở sảnh mà chưa vào được trạm Tier 0 (SIN/HKG) hoặc ping > 88ms,
   * cứ mỗi 900ms bắn 3 socket ngầm song song để săn bằng được tuyến SIN/HKG
   * mà KHÔNG ngắt kết nối hiện tại và KHÔNG dừng lại sau 3 lần thử!
   */
  private startLobbyBackgroundSweep(): void {
    this.stopLobbyBackgroundSweep();
    this.lobbySweepTimer = window.setInterval(() => {
      if (this.closed || this.inGame || this.probing) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const currentTier = getColoTier(this.colo);
      // Nếu đã ở đúng SIN/HKG (Tier 0) và ping <= 85ms thì hoàn toàn mãn nguyện, không cần quét thêm
      if (currentTier === 0 && this.rtt <= 85) return;

      this.triggerParallelProbeAndSwap(false);
    }, LOBBY_SWEEP_INTERVAL_MS);
  }

  private stopLobbyBackgroundSweep(): void {
    if (this.lobbySweepTimer !== null) {
      clearInterval(this.lobbySweepTimer);
      this.lobbySweepTimer = null;
    }
  }

  public send(m: ClientMsg): void {
    if (m.t === 'join') {
      this.lastJoinMsg = { ...m };
      this.inGame = true;
      if (this.sessionToken) {
        m.token = this.sessionToken;
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
    } else {
      if (this.outboundQueue.length < 32) {
        this.outboundQueue.push(m);
      }
    }
  }

  public startPing(): void {
    this.stopPing();
    // Bắn ngay 1 ping đầu tiên không chờ đợi
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ t: 'ping', c: Math.round(performance.now()) });
    }
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
        this.send({ t: 'ping', c: now });
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

    if (text.startsWith('{"t":"pong"') || text.startsWith('{"t":"hello"')) {
      try {
        const msg = JSON.parse(text) as {
          t: 'pong' | 'hello';
          c?: number;
          s?: number;
          colo?: string;
          doColo?: string;
        };
        if (msg.colo) this.colo = msg.colo.toUpperCase();
        if (msg.doColo) this.doColo = msg.doColo.toUpperCase();
        if (typeof document !== 'undefined' && document.hidden) return;

        if (typeof msg.c === 'number') {
          const rawRtt = recvNow - msg.c;
          if (rawRtt >= 0 && rawRtt < 2500) {
            this.processRttSample(rawRtt, recvNow, msg.s);
          }
        }
      } catch {}
      return;
    }

    try {
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
        const snap = parsed as Snapshot;
        if (typeof snap.st === 'number' && this.clockOffset !== null) {
          const transitEstimate = (this.rttMin || 48) * 0.5;
          const candidateOffset = snap.st - (recvNow - transitEstimate);
          if (candidateOffset > this.clockOffset) {
            this.clockOffset = candidateOffset;
          } else {
            this.clockOffset += (candidateOffset - this.clockOffset) * 0.02;
          }
        }
      }
      this.onMsg(parsed);
    } catch {}
  }

  private processRttSample(
    rawRtt: number,
    recvNow: number,
    serverTime?: number
  ): void {
    const interArrival =
      this.lastPongRecvPerf > 0
        ? recvNow - this.lastPongRecvPerf
        : PING_INTERVAL_MS;
    this.lastPongRecvPerf = recvNow;

    const isQueuedBurstTail = interArrival < 70 && rawRtt < this.lastRawRtt;
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
      const clamped =
        rawRtt > this.rttMin * 2.5 + 60
          ? Math.min(rawRtt, this.rttMin + 90)
          : rawRtt;
      this.rttWin.push(clamped);
      if (this.rttWin.length > 8) this.rttWin.shift();
    }

    const stats = computeRttStats(this.rttWin);
    this.rttMin = stats.min;
    this.jitter = stats.jitter;

    if (rawRtt <= this.smoothedRtt) {
      this.smoothedRtt += (rawRtt - this.smoothedRtt) * 0.45;
    } else {
      const cappedSpike = Math.min(rawRtt, this.smoothedRtt + 35);
      this.smoothedRtt += (cappedSpike - this.smoothedRtt) * 0.18;
    }

    this.rtt = Math.round(this.smoothedRtt);
    this.netRtt = Math.round(this.rttMin + Math.min(25, this.jitter * 0.5));

    if (typeof serverTime === 'number' && rawRtt <= this.rttMin + 15) {
      const bestOffset = serverTime - (recvNow - rawRtt * 0.5);
      if (this.clockOffset === null) {
        this.clockOffset = bestOffset;
      } else {
        this.clockOffset += (bestOffset - this.clockOffset) * 0.3;
      }
    }

    // Kiểm tra kích hoạt In-Game Hot Migration
    const currentTier = getColoTier(this.colo);
    if (this.rtt > HIGH_PING_THRESHOLD_MS || currentTier > 0) {
      this.consecutiveHighPing += 1;
    } else {
      this.consecutiveHighPing = 0;
    }

    this.checkInGameMigrationTrigger(currentTier);
  }

  private checkInGameMigrationTrigger(currentTier: ColoTier): void {
    if (!this.inGame || this.probing || this.closed) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const now = performance.now();
    if (now < this.nextProbeAllowedAt) return;

    // Nếu rơi sang Châu Âu / Mỹ (Tier 2): Kích hoạt ngay lập tức ở mẫu đầu tiên (350ms)!
    const isOutOfRegionEmergency = currentTier === 2 && this.rttWin.length >= 1;

    // Nếu ping > 90ms kéo dài 3 mẫu (3 * 350ms = 1.05s): Kích hoạt dò 3 luồng song song!
    const isSustainedAbove90ms =
      this.rtt > HIGH_PING_THRESHOLD_MS &&
      this.consecutiveHighPing >= SUSTAINED_HIGH_PING_SAMPLES;

    if (isOutOfRegionEmergency || isSustainedAbove90ms) {
      this.triggerParallelProbeAndSwap(true);
    }
  }

  /**
   * GIAI ĐOẠN 3: Bắn đồng thời 3 Probe Sockets song song (cả cho Lobby và In-Game Hot Migration).
   * Mỗi socket bắn 1 warmup + 3 measure pings cách nhau 90ms (chỉ mất 270ms-350ms!).
   * Socket nào tìm được tuyến SIN/HKG ngon nhất sẽ thực hiện Handover nguyên tử ngay lập tức.
   */
  private triggerParallelProbeAndSwap(isInGameHandover: boolean): void {
    if (this.probing || this.closed) return;
    this.probing = true;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);

    const concurrency = isInGameHandover
      ? INGAME_PROBE_CONCURRENCY
      : LOBBY_SWEEP_CONCURRENCY;

    const completedProbes: CandidateResult[] = [];
    const probeSockets: WebSocket[] = [];
    let finished = false;

    const cleanupAllExcept = (keepWs: WebSocket | null) => {
      for (const s of probeSockets) {
        if (s !== keepWs) {
          s.onopen = null;
          s.onmessage = null;
          s.onerror = null;
          s.onclose = null;
          try {
            if (
              s.readyState === WebSocket.OPEN ||
              s.readyState === WebSocket.CONNECTING
            ) {
              s.close(1000, 'ProbeCleanup');
            }
          } catch {}
        }
      }
      this.activeProbeSockets = [];
      this.probing = false;
      this.isMigrating = false;
    };

    const evaluateAndExecuteSwap = () => {
      if (finished || this.closed) return;
      finished = true;

      if (completedProbes.length === 0) {
        this.scheduleFastBackoff();
        cleanupAllExcept(null);
        this.onMigrationStatus?.('failed', this.colo);
        return;
      }

      // Chọn ứng viên tốt nhất trong 3 luồng probe song song
      completedProbes.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return a.medianRtt - b.medianRtt;
      });

      const minSamples = isInGameHandover ? 3 : 2;
      const decision = evaluateMigrationDecision(
        this.rttWin,
        this.colo,
        bestCandidate.rtts,
        bestCandidate.colo || this.colo,
        minSamples,
        isInGameHandover
      );

      if (!decision.shouldSwitch) {
        this.scheduleFastBackoff();
        cleanupAllExcept(null);
        this.onMigrationStatus?.('failed', this.colo);
        return;
      }

      console.log(
        `[Net] Fast Route Upgrade: ${this.colo} (~${decision.activeMedian}ms) -> ${bestCandidate.colo} (~${decision.probeRawMedian}ms) [${decision.reason}]`
      );

      // Nếu đang trong trận thì gửi kèm lệnh join handover trước khi tráo con trỏ socket
      if (isInGameHandover && this.lastJoinMsg) {
        try {
          bestCandidate.ws.send(
            JSON.stringify({
              ...this.lastJoinMsg,
              token: this.sessionToken || undefined,
            })
          );
        } catch {}
      }

      const winnerWs = bestCandidate.ws;
      cleanupAllExcept(winnerWs);
      this.promoteSocketToPrimary(bestCandidate, true);
    };

    const overallTimeout = window.setTimeout(() => {
      if (!finished) {
        evaluateAndExecuteSwap();
      }
    }, PROBE_OVERALL_TIMEOUT_MS);

    for (let i = 0; i < concurrency; i++) {
      const probeUrl = this.buildRaceUrl(i + 1);
      let pws: WebSocket;
      try {
        pws = new WebSocket(probeUrl);
      } catch {
        continue;
      }
      probeSockets.push(pws);
      this.activeProbeSockets.push(pws);

      const cand: CandidateResult = {
        ws: pws,
        url: probeUrl,
        colo: '',
        doColo: '',
        tier: 2,
        rtts: [],
        bestRtt: 9999,
        medianRtt: 9999,
        clockOffset: null,
        earlyMessages: [],
      };

      let pingsSent = 0;
      let pongsCount = 0;
      let pTimer: number | null = null;

      pws.onopen = () => {
        if (finished || this.closed) return;
        const fireProbePing = () => {
          if (pws.readyState !== WebSocket.OPEN) return;
          pingsSent += 1;
          try {
            pws.send(
              `{"t":"ping","c":${Math.round(
                performance.now()
              )},"pad":"${PROBE_PAYLOAD_PADDING}"}`
            );
          } catch {}
          if (
            pingsSent >= PROBE_WARMUP_PINGS + PROBE_MEASURE_PINGS &&
            pTimer !== null
          ) {
            clearInterval(pTimer);
            pTimer = null;
          }
        };
        fireProbePing();
        pTimer = window.setInterval(fireProbePing, PROBE_PING_SPACING_MS);
      };

      pws.onmessage = (ev: MessageEvent) => {
        if (finished || this.closed) return;
        const recvPerf = performance.now();
        const text =
          typeof ev.data === 'string'
            ? ev.data
            : new TextDecoder().decode(ev.data as ArrayBuffer);

        if (text.startsWith('{"t":"hello"') || text.startsWith('{"t":"pong"')) {
          try {
            const msg = JSON.parse(text) as {
              t: 'hello' | 'pong';
              c?: number;
              s?: number;
              colo?: string;
              doColo?: string;
            };
            if (msg.colo) {
              cand.colo = msg.colo.toUpperCase();
              cand.tier = getColoTier(cand.colo);
            }
            if (msg.doColo) {
              cand.doColo = msg.doColo.toUpperCase();
            }

            if (msg.t === 'pong' && typeof msg.c === 'number') {
              const rtt = Math.max(1, recvPerf - msg.c);
              pongsCount += 1;
              if (pongsCount > PROBE_WARMUP_PINGS) {
                cand.rtts.push(rtt);
                cand.bestRtt = Math.min(cand.bestRtt, rtt);
              }
              if (typeof msg.s === 'number' && rtt <= cand.bestRtt + 10) {
                cand.clockOffset = msg.s - (recvPerf - rtt * 0.5);
              }

              if (cand.rtts.length >= PROBE_MEASURE_PINGS) {
                if (pTimer !== null) {
                  clearInterval(pTimer);
                  pTimer = null;
                }
                cand.medianRtt = computeRttStats(cand.rtts).median;
                completedProbes.push(cand);

                // Nếu luồng probe này bắt trúng ngay SIN/HKG (Tier 0) với RTT <= 75ms
                // trong khi kết nối hiện tại đang ở Tier 1/2 -> Chuyển ngay lập tức không chờ các luồng khác!
                if (
                  cand.tier === 0 &&
                  cand.medianRtt <= 75 &&
                  getColoTier(this.colo) > 0
                ) {
                  clearTimeout(overallTimeout);
                  evaluateAndExecuteSwap();
                  return;
                }

                if (completedProbes.length >= probeSockets.length) {
                  clearTimeout(overallTimeout);
                  evaluateAndExecuteSwap();
                }
              }
            }
          } catch {}
          return;
        }

        cand.earlyMessages.push(ev.data);
      };
    }
  }

  /**
   * Cooldown ngắn & thông minh (2.5s - 8s) thay vì khóa cứng 15s - 120s như trước.
   * Nếu đang bị kẹt ở Châu Âu/Mỹ (Tier 2), thử lại chỉ sau 2.5 giây!
   */
  private scheduleFastBackoff(): void {
    this.consecutiveFailedProbes += 1;
    const currentTier = getColoTier(this.colo);

    if (currentTier === 2) {
      // Đang ở Châu Âu/Mỹ: chỉ nghỉ 2.5s rồi tiếp tục bắn 3 luồng dò SIN/HKG
      this.nextProbeAllowedAt = performance.now() + 2500;
      return;
    }

    const backoffMs = Math.min(
      8_000,
      2500 * Math.min(3, this.consecutiveFailedProbes)
    );
    this.nextProbeAllowedAt = performance.now() + backoffMs;
  }

  public triggerHotMigration(_isManual = false): void {
    this.triggerParallelProbeAndSwap(this.inGame);
  }

  public manualRetune(): void {
    this.nextProbeAllowedAt = 0;
    this.consecutiveHighPing = SUSTAINED_HIGH_PING_SAMPLES;
    this.consecutiveFailedProbes = 0;
    this.triggerParallelProbeAndSwap(this.inGame);
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.triggerParallelProbeAndSwap(this.inGame);
  }

  public leaveGame(): void {
    this.inGame = false;
    try {
      this.send({ t: 'leave' });
    } catch {}
  }

  public close(): void {
    this.closed = true;
    this.stopPing();
    this.stopLobbyBackgroundSweep();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const s of this.activeProbeSockets) {
      try {
        s.close(1000, 'ClientClosed');
      } catch {}
    }
    this.activeProbeSockets = [];
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close(1000, 'ClientClosed');
      } catch {}
      this.ws = null;
    }
  }
}
