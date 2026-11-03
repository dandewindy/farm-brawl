/**
 * Kids Mode (Parental Playtime & Lives Management)
 * Quản lý thời gian chơi và giới hạn số mạng cho trẻ em
 */

export interface KidsModeConfig {
  enabled: boolean;
  timeLimitEnabled: boolean;
  timeLimitMinutes: number; // Số phút quy định (vd: 20)
  livesLimitEnabled: boolean;
  livesLimit: number; // Số mạng tối đa (vd: 5)
  pinHash: string; // Mã PIN phụ huynh 4 số đã băm
}

export interface KidsModeState {
  timeRemainingSec: number;
  livesRemaining: number;
  isLocked: boolean;
  lockReason: 'time' | 'lives' | null;
  lastTickTs: number;
  lockedAtTs?: number; // Thời điểm bị khóa để tính tự động mở sau 1 tiếng
}

export const MAX_LOCK_DURATION_SEC = 3600; // Khóa tối đa 1 tiếng (60 phút) sau đó tự động mở lại

const STORAGE_KEY_CONFIG = 'fb_kids_config';
const STORAGE_KEY_STATE = 'fb_kids_state';
const SALT = 'fb_parental_salt_2026';

function simpleHash(pin: string): string {
  let h = 0x811c9dc5;
  const str = pin + SALT;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class KidsPlayManager {
  private static instance: KidsPlayManager;

  public config: KidsModeConfig = {
    enabled: false,
    timeLimitEnabled: true,
    timeLimitMinutes: 20,
    livesLimitEnabled: true,
    livesLimit: 5,
    pinHash: '',
  };

  public state: KidsModeState = {
    timeRemainingSec: 20 * 60,
    livesRemaining: 5,
    isLocked: false,
    lockReason: null,
    lastTickTs: Date.now(),
  };

  private listeners: Array<(state: KidsModeState, config: KidsModeConfig) => void> = [];
  private warningTriggered = false;
  private timerInterval: any = null;

  private constructor() {
    this.loadFromStorage();
    this.startBackgroundClock();
  }

  public static getInstance(): KidsPlayManager {
    if (!KidsPlayManager.instance) {
      KidsPlayManager.instance = new KidsPlayManager();
    }
    return KidsPlayManager.instance;
  }

  public startBackgroundClock(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    // Background interval: 1000ms wall-clock cadence
    this.timerInterval = setInterval(() => {
      this.tickWallClock();
    }, 1000);
  }

  public subscribe(fn: (state: KidsModeState, config: KidsModeConfig) => void): () => void {
    this.listeners.push(fn);
    fn(this.state, this.config);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public notify(): void {
    this.listeners.forEach((fn) => fn(this.state, this.config));
  }

  public hasPin(): boolean {
    return Boolean(this.config.pinHash && this.config.pinHash.length > 0);
  }

  public verifyPin(pin: string): boolean {
    if (!this.hasPin()) return true; // Chưa đặt PIN
    return simpleHash(pin.trim()) === this.config.pinHash;
  }

  public setPin(pin: string): void {
    this.config.pinHash = simpleHash(pin.trim());
    this.saveConfig();
  }

  public saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    } catch (_) {}
    this.notify();
  }

  public saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(this.state));
    } catch (_) {}
  }

  public loadFromStorage(): void {
    try {
      const cfgRaw = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (cfgRaw) {
        this.config = { ...this.config, ...JSON.parse(cfgRaw) };
      }
      const stRaw = localStorage.getItem(STORAGE_KEY_STATE);
      if (stRaw) {
        const parsed = JSON.parse(stRaw);
        this.state = { ...this.state, ...parsed };

        // Kiểm tra nếu đã bị khóa và đã qua 1 tiếng -> Tự động mở khóa!
        if (this.state.isLocked) {
          const now = Date.now();
          if (!this.state.lockedAtTs) {
            this.state.lockedAtTs = now;
          }
          if ((now - this.state.lockedAtTs) >= MAX_LOCK_DURATION_SEC * 1000) {
            this.resetSession();
            return;
          }
        }

        // Nếu chế độ đang bật và game bị reload: trừ thời gian trôi qua giữa 2 lần tick
        if (this.config.enabled && !this.state.isLocked && this.config.timeLimitEnabled) {
          const now = Date.now();
          const elapsedSec = Math.max(0, (now - (this.state.lastTickTs || now)) / 1000);
          if (elapsedSec > 0 && elapsedSec < 24 * 3600) {
            this.state.timeRemainingSec = Math.max(0, this.state.timeRemainingSec - elapsedSec);
          }
          this.state.lastTickTs = now;
          if (this.state.timeRemainingSec <= 0) {
            this.lock('time');
          }
        }
      } else {
        this.resetSession();
      }
    } catch (_) {
      this.resetSession();
    }
  }

  public updateLimits(
    enabled: boolean,
    timeLimitEnabled: boolean,
    timeLimitMinutes: number,
    livesLimitEnabled: boolean,
    livesLimit: number,
    newPin?: string,
    forceResetSession = false
  ): void {
    const wasEnabled = this.config.enabled;
    this.config.enabled = enabled;
    this.config.timeLimitEnabled = timeLimitEnabled;
    this.config.timeLimitMinutes = Math.max(1, Math.min(180, timeLimitMinutes));
    this.config.livesLimitEnabled = livesLimitEnabled;
    this.config.livesLimit = Math.max(1, Math.min(50, livesLimit));

    if (newPin && newPin.length === 4) {
      this.config.pinHash = simpleHash(newPin);
    }

    this.saveConfig();

    if ((!wasEnabled && enabled) || forceResetSession) {
      this.resetSession();
    } else if (enabled) {
      // Đang bật: đảm bảo thời gian và mạng còn lại không vượt quá trần cấu hình
      this.state.timeRemainingSec = Math.min(this.state.timeRemainingSec, this.config.timeLimitMinutes * 60);
      this.state.livesRemaining = Math.min(this.state.livesRemaining, this.config.livesLimit);
      this.saveState();
      this.notify();
    } else {
      this.state.isLocked = false;
      this.state.lockReason = null;
      this.state.lockedAtTs = undefined;
      this.saveState();
      this.notify();
    }
  }

  public clearPin(): void {
    this.config.pinHash = '';
    this.saveConfig();
  }

  public resetSession(): void {
    this.state.timeRemainingSec = this.config.timeLimitMinutes * 60;
    this.state.livesRemaining = this.config.livesLimit;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lockedAtTs = undefined;
    this.state.lastTickTs = Date.now();
    this.warningTriggered = false;
    this.saveState();
    this.notify();
  }

  public getAutoUnlockRemainingSec(): number {
    if (!this.state.isLocked) return 0;
    if (!this.state.lockedAtTs) {
      this.state.lockedAtTs = Date.now();
    }
    const elapsed = (Date.now() - this.state.lockedAtTs) / 1000;
    return Math.max(0, Math.floor(MAX_LOCK_DURATION_SEC - elapsed));
  }

  /**
   * Đồng hồ đếm ngược độc lập chạy mỗi giây (1000ms wall-clock).
   * Giúp đếm giờ chính xác không phụ thuộc vào FPS hay GPU rendering.
   */
  public tickWallClock(): void {
    if (!this.config.enabled) return;

    const now = Date.now();

    // 1. Khi đang bị khóa: tự động mở sau 1 tiếng (3600s), đếm ngược trực tiếp mỗi giây
    if (this.state.isLocked) {
      if (!this.state.lockedAtTs) {
        this.state.lockedAtTs = now;
      }
      const elapsed = (now - this.state.lockedAtTs) / 1000;
      if (elapsed >= MAX_LOCK_DURATION_SEC) {
        // Đã hết 1 tiếng -> Tự động mở khóa lượt mới cho bé!
        this.resetSession();
        return;
      }
      this.notify();
      return;
    }

    // 2. Khi đang chơi: đếm ngược thời gian chơi
    if (this.config.timeLimitEnabled) {
      const last = this.state.lastTickTs || now;
      const elapsedSec = Math.min(5, Math.max(0.5, (now - last) / 1000));
      this.state.lastTickTs = now;
      this.state.timeRemainingSec = Math.max(0, this.state.timeRemainingSec - elapsedSec);

      if (this.state.timeRemainingSec <= 120 && !this.warningTriggered) {
        this.warningTriggered = true;
      }

      if (this.state.timeRemainingSec <= 0) {
        this.lock('time');
        return;
      }

      if (Math.floor(this.state.timeRemainingSec) % 5 === 0) {
        this.saveState();
      }
    } else {
      this.state.lastTickTs = now;
    }

    this.notify();
  }

  public tick(dtSec: number): void {
    if (!this.config.enabled) return;

    // Nếu đang bị khóa: kiểm tra tự động mở khóa sau 1 tiếng (3600s)
    if (this.state.isLocked) {
      if (this.state.lockedAtTs && (Date.now() - this.state.lockedAtTs) >= MAX_LOCK_DURATION_SEC * 1000) {
        this.resetSession();
        return;
      }
      this.notify();
      return;
    }

    // Hỗ trợ vitest tests hoặc bước nhảy thời gian lớn dtSec >= 1s
    if (dtSec >= 1) {
      this.state.lastTickTs = Date.now();
      if (this.config.timeLimitEnabled) {
        this.state.timeRemainingSec = Math.max(0, this.state.timeRemainingSec - dtSec);

        if (this.state.timeRemainingSec <= 120 && !this.warningTriggered) {
          this.warningTriggered = true;
        }

        if (this.state.timeRemainingSec <= 0) {
          this.lock('time');
          return;
        }
      }
      this.notify();
    }
  }

  public consumeLife(): boolean {
    if (!this.config.enabled || this.state.isLocked || !this.config.livesLimitEnabled) return false;

    this.state.livesRemaining = Math.max(0, this.state.livesRemaining - 1);
    this.saveState();
    this.notify();

    if (this.state.livesRemaining <= 0) {
      this.lock('lives');
      return true;
    }
    return false;
  }

  public lock(reason: 'time' | 'lives'): void {
    this.state.isLocked = true;
    this.state.lockReason = reason;
    this.state.lockedAtTs = Date.now();
    this.saveState();
    this.notify();
  }

  public unlockAndReset(pin?: string): boolean {
    if (pin !== undefined && !this.verifyPin(pin)) return false;
    this.resetSession();
    return true;
  }

  public unlockWithPin(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lockedAtTs = undefined;
    this.saveState();
    this.notify();
    return true;
  }

  public extendTime(minutes: number, pin?: string): boolean {
    if (pin !== undefined && !this.verifyPin(pin)) return false;
    this.state.timeRemainingSec += minutes * 60;
    // Nếu trước đó bị khóa do hết mạng, cấp thêm ít nhất 3 mạng để bé tiếp tục chơi được
    if (this.config.livesLimitEnabled && this.state.livesRemaining <= 0) {
      this.state.livesRemaining = Math.max(3, this.config.livesLimit);
    }
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lockedAtTs = undefined;
    this.state.lastTickTs = Date.now();
    this.warningTriggered = false;
    this.saveState();
    this.notify();
    return true;
  }

  public extendLives(lives: number, pin?: string): boolean {
    if (pin !== undefined && !this.verifyPin(pin)) return false;
    this.state.livesRemaining += lives;
    // Nếu trước đó bị khóa do hết giờ, cấp thêm ít nhất 15 phút để bé tiếp tục chơi được
    if (this.config.timeLimitEnabled && this.state.timeRemainingSec <= 0) {
      this.state.timeRemainingSec = Math.max(15 * 60, this.config.timeLimitMinutes * 60);
    }
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lockedAtTs = undefined;
    this.state.lastTickTs = Date.now();
    this.saveState();
    this.notify();
    return true;
  }

  public disableKidsMode(pin?: string): boolean {
    if (pin !== undefined && !this.verifyPin(pin)) return false;
    this.config.enabled = false;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lockedAtTs = undefined;
    this.saveConfig();
    this.saveState();
    this.notify();
    return true;
  }
}
