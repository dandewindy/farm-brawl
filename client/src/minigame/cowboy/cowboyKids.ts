import type { CowboyKidsConfig } from './cowboyTypes';

const KIDS_STORAGE_KEY = 'farm_brawl_cowboy_kids_v1';

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class CowboyKidsManager {
  private config: CowboyKidsConfig;
  private sessionStartTime: number = 0;
  private isLocked: boolean = false;

  constructor() {
    this.config = this.load();
    this.checkDayReset();
  }

  private load(): CowboyKidsConfig {
    try {
      const raw = localStorage.getItem(KIDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: Boolean(parsed.enabled),
          parentPin: typeof parsed.parentPin === 'string' && parsed.parentPin.length === 4 ? parsed.parentPin : '1234',
          timeLimitMinutes: [15, 30, 45, 60].includes(parsed.timeLimitMinutes) ? parsed.timeLimitMinutes : 30,
          maxDailyCredits: typeof parsed.maxDailyCredits === 'number' ? Math.min(20, Math.max(5, parsed.maxDailyCredits)) : 20,
          usedCreditsToday: typeof parsed.usedCreditsToday === 'number' ? Math.max(0, parsed.usedCreditsToday) : 0,
          lastPlayedDate: typeof parsed.lastPlayedDate === 'string' ? parsed.lastPlayedDate : getTodayStr(),
        };
      }
    } catch (_) {}

    return {
      enabled: false,
      parentPin: '1234',
      timeLimitMinutes: 30,
      maxDailyCredits: 20,
      usedCreditsToday: 0,
      lastPlayedDate: getTodayStr(),
    };
  }

  public save(): void {
    try {
      localStorage.setItem(KIDS_STORAGE_KEY, JSON.stringify(this.config));
    } catch (_) {}
  }

  private checkDayReset(): void {
    const today = getTodayStr();
    if (this.config.lastPlayedDate !== today) {
      this.config.lastPlayedDate = today;
      this.config.usedCreditsToday = 0;
      this.save();
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public getConfig(): CowboyKidsConfig {
    return { ...this.config };
  }

  public startSession(): void {
    this.sessionStartTime = Date.now();
    this.isLocked = false;
    this.checkDayReset();
  }

  /** Kiểm tra xem bé đã chơi quá thời lượng cho phép chưa */
  public isLockedOut(): boolean {
    return this.isLocked;
  }

  public checkTimeExpired(): boolean {
    if (!this.config.enabled) return false;
    if (this.sessionStartTime <= 0) return false;

    const playedMinutes = (Date.now() - this.sessionStartTime) / 60000;
    if (playedMinutes >= this.config.timeLimitMinutes) {
      this.isLocked = true;
      return true;
    }
    return false;
  }

  public getRemainingMinutes(): number {
    if (!this.config.enabled || this.sessionStartTime <= 0) return 999;
    const playedMinutes = (Date.now() - this.sessionStartTime) / 60000;
    return Math.max(0, Math.ceil(this.config.timeLimitMinutes - playedMinutes));
  }

  public verifyPin(pin: string): boolean {
    return this.config.parentPin === pin;
  }

  public updateSettings(pin: string, newConfig: Partial<CowboyKidsConfig>): { success: boolean; msg: string } {
    if (!this.verifyPin(pin)) {
      return { success: false, msg: 'Mã PIN phụ huynh không chính xác!' };
    }

    if (typeof newConfig.enabled === 'boolean') this.config.enabled = newConfig.enabled;
    if (typeof newConfig.parentPin === 'string' && newConfig.parentPin.length === 4) {
      this.config.parentPin = newConfig.parentPin;
    }
    if (typeof newConfig.timeLimitMinutes === 'number') {
      this.config.timeLimitMinutes = Math.max(15, Math.min(60, newConfig.timeLimitMinutes));
    }
    if (typeof newConfig.maxDailyCredits === 'number') {
      // Credit max không vượt quá giới hạn 20 của người chơi thường
      this.config.maxDailyCredits = Math.max(5, Math.min(20, newConfig.maxDailyCredits));
    }

    this.save();
    return { success: true, msg: 'Cập nhật thiết lập cho bé thành công!' };
  }

  public canUseCredit(amount: number): boolean {
    if (!this.config.enabled) return true;
    this.checkDayReset();
    return (this.config.usedCreditsToday + amount) <= this.config.maxDailyCredits;
  }

  public recordCreditUsed(amount: number): boolean {
    if (!this.config.enabled) return true;
    this.checkDayReset();
    if (amount > 0 && this.config.usedCreditsToday + amount > this.config.maxDailyCredits) {
      return false;
    }
    this.config.usedCreditsToday = Math.max(0, this.config.usedCreditsToday + amount);
    this.save();
    return true;
  }
}

export const cowboyKids = new CowboyKidsManager();
