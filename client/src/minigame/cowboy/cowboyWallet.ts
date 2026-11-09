import type { CowboyWalletData } from './cowboyTypes';

const STORAGE_KEY = 'farm_brawl_cowboy_wallet_v1';
const INITIAL_DAILY_CREDITS = 20;
const RELIEF_CREDITS = 5;
const MAX_DAILY_RELIEF = 2;

function getTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class CowboyWallet {
  private data: CowboyWalletData;

  constructor() {
    this.data = this.load();
    this.checkDailyGrant();
    // Persist immediately on first launch
    this.save();
  }

  private load(): CowboyWalletData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          typeof parsed.credits === 'number' &&
          Number.isFinite(parsed.credits) &&
          typeof parsed.lastClaimDate === 'string'
        ) {
          const dailyRelief = typeof parsed.dailyReliefCount === 'number' && Number.isFinite(parsed.dailyReliefCount)
            ? Math.max(0, Math.min(MAX_DAILY_RELIEF, Math.floor(parsed.dailyReliefCount)))
            : 0;

          const lastClaimTs = (typeof parsed.lastClaimTimestamp === 'number' && Number.isFinite(parsed.lastClaimTimestamp))
            ? parsed.lastClaimTimestamp
            : Date.now();
          const lastAccTs = (typeof parsed.lastAccumulateTimestamp === 'number' && Number.isFinite(parsed.lastAccumulateTimestamp))
            ? parsed.lastAccumulateTimestamp
            : lastClaimTs;

          return {
            credits: Math.max(0, Math.floor(parsed.credits)),
            lastClaimDate: parsed.lastClaimDate,
            lastClaimTimestamp: lastClaimTs,
            lastAccumulateTimestamp: lastAccTs,
            dailyReliefCount: dailyRelief,
            totalScore: (typeof parsed.totalScore === 'number' && Number.isFinite(parsed.totalScore)) ? Math.max(0, Math.floor(parsed.totalScore)) : 0,
            totalCatches: (typeof parsed.totalCatches === 'number' && Number.isFinite(parsed.totalCatches)) ? Math.max(0, Math.floor(parsed.totalCatches)) : 0,
            highestPayout: (typeof parsed.highestPayout === 'number' && Number.isFinite(parsed.highestPayout)) ? Math.max(0, Math.floor(parsed.highestPayout)) : 0,
          };
        }
      }
    } catch (_) {}

    const now = Date.now();
    return {
      credits: INITIAL_DAILY_CREDITS,
      lastClaimDate: getTodayStr(),
      lastClaimTimestamp: now,
      lastAccumulateTimestamp: now,
      dailyReliefCount: 0,
      totalScore: 0,
      totalCatches: 0,
      highestPayout: 0,
    };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (_) {}
  }

  /** Kiểm tra và cấp 20 credit hàng ngày nếu sang ngày mới */
  public checkDailyGrant(): { granted: boolean; amount: number } {
    const today = getTodayStr();
    const now = Date.now();

    // Điều kiện ngày mới: Khác ngày hôm nay VÀ thời gian hiện tại không bị lùi về quá khứ
    if (this.data.lastClaimDate !== today && now >= this.data.lastClaimTimestamp) {
      this.data.credits += INITIAL_DAILY_CREDITS;
      this.data.lastClaimDate = today;
      this.data.lastClaimTimestamp = now;
      this.data.lastAccumulateTimestamp = now;
      this.data.dailyReliefCount = 0;
      this.save();
      return { granted: true, amount: INITIAL_DAILY_CREDITS };
    }
    return { granted: false, amount: 0 };
  }

  /** Tự động tích lũy credit: sau mỗi 1 phút tăng 1 điểm nếu dưới mức giới hạn ngày (20). Tính cả thời gian offline/không chơi */
  public updateAccumulatedCredits(now: number = Date.now()): { added: number; currentCredits: number } {
    if (this.data.credits >= INITIAL_DAILY_CREDITS) {
      this.data.lastAccumulateTimestamp = now;
      this.save();
      return { added: 0, currentCredits: this.data.credits };
    }

    if (!this.data.lastAccumulateTimestamp || this.data.lastAccumulateTimestamp > now) {
      this.data.lastAccumulateTimestamp = now;
    }

    const elapsedMs = Math.max(0, now - this.data.lastAccumulateTimestamp);
    // Sau mỗi 1 phút (60,000ms) sẽ tăng 1 điểm credit
    const pointsToAdd = Math.floor(elapsedMs / 60000);

    if (pointsToAdd > 0) {
      const needed = INITIAL_DAILY_CREDITS - this.data.credits;
      const actualAdd = Math.min(pointsToAdd, needed);

      this.data.credits += actualAdd;
      this.data.lastAccumulateTimestamp += pointsToAdd * 60000;
      if (this.data.credits >= INITIAL_DAILY_CREDITS) {
        this.data.lastAccumulateTimestamp = now;
      }
      this.save();
      return { added: actualAdd, currentCredits: this.data.credits };
    }

    return { added: 0, currentCredits: this.data.credits };
  }

  public getCredits(now = Date.now()): number {
    this.updateAccumulatedCredits(now);
    return this.data.credits;
  }

  public getTotalScore(): number {
    return this.data.totalScore;
  }

  public getTotalCatches(): number {
    return this.data.totalCatches;
  }

  public getHighestPayout(): number {
    return this.data.highestPayout;
  }

  /** Trừ tiền cược */
  public deductBet(betAmount: number, now: number = Date.now()): boolean {
    this.updateAccumulatedCredits(now);
    if (!Number.isFinite(betAmount) || betAmount <= 0) return false;
    const cleanBet = Math.floor(betAmount);
    if (this.data.credits < cleanBet) return false;

    const hadFullCredits = this.data.credits >= INITIAL_DAILY_CREDITS;
    this.data.credits -= cleanBet;
    // Bắt đầu chu kỳ tích lũy 1 phút ngay khi tụt dưới trần 20 credit
    if (hadFullCredits && this.data.credits < INITIAL_DAILY_CREDITS) {
      this.data.lastAccumulateTimestamp = now;
    }
    this.save();
    return true;
  }

  /** Hoàn tiền cược nếu phát quăng dây bị từ chối */
  public refundBet(betAmount: number): void {
    if (!Number.isFinite(betAmount) || betAmount <= 0) return;
    this.data.credits += Math.floor(betAmount);
    this.save();
  }

  /** Cộng tiền thưởng khi bắt dính thú */
  public addCredits(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.data.credits += Math.floor(amount);
    this.save();
  }

  public addWinnings(winAmount: number, catchesCount = 1): void {
    if (!Number.isFinite(winAmount) || winAmount <= 0) return;
    const cleanWin = Math.floor(winAmount);
    const cleanCatches = Math.max(1, Math.floor(catchesCount || 1));

    this.data.credits += cleanWin;
    this.data.totalScore += cleanWin;
    this.data.totalCatches += cleanCatches;
    if (cleanWin > this.data.highestPayout) {
      this.data.highestPayout = cleanWin;
    }
    this.save();
  }

  /** Kiểm tra trạng thái cứu trợ mà KHÔNG làm biến đổi dữ liệu (Non-mutating query) */
  public getReliefStatus(): { canClaim: boolean; remainingToday: number } {
    const remainingToday = Math.max(0, MAX_DAILY_RELIEF - this.data.dailyReliefCount);
    const canClaim = this.data.credits === 0 && remainingToday > 0;
    return { canClaim, remainingToday };
  }

  /** Nhận credit cứu trợ khi cạn tiền */
  public claimRelief(): { success: boolean; amount: number; remainingToday: number } {
    const status = this.getReliefStatus();
    if (!status.canClaim) {
      return { success: false, amount: 0, remainingToday: status.remainingToday };
    }

    this.data.dailyReliefCount++;
    this.data.credits += RELIEF_CREDITS;
    this.save();
    return {
      success: true,
      amount: RELIEF_CREDITS,
      remainingToday: Math.max(0, MAX_DAILY_RELIEF - this.data.dailyReliefCount),
    };
  }
}
