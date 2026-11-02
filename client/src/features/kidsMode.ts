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
}

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
    livesLimitEnabled: false,
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

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): KidsPlayManager {
    if (!KidsPlayManager.instance) {
      KidsPlayManager.instance = new KidsPlayManager();
    }
    return KidsPlayManager.instance;
  }

  public subscribe(fn: (state: KidsModeState, config: KidsModeConfig) => void): () => void {
    this.listeners.push(fn);
    fn(this.state, this.config);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
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

        // Nếu chế độ đang bật và game bị reload: trừ thời gian trôi qua giữa 2 lần tick
        if (this.config.enabled && !this.state.isLocked && this.config.timeLimitEnabled) {
          const now = Date.now();
          const elapsedSec = Math.max(0, (now - (this.state.lastTickTs || now)) / 1000);
          // Giới hạn trừ tối đa thời gian trôi qua
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
    newPin?: string
  ): void {
    this.config.enabled = enabled;
    this.config.timeLimitEnabled = timeLimitEnabled;
    this.config.timeLimitMinutes = Math.max(1, Math.min(180, timeLimitMinutes));
    this.config.livesLimitEnabled = livesLimitEnabled;
    this.config.livesLimit = Math.max(1, Math.min(50, livesLimit));

    if (newPin && newPin.length === 4) {
      this.config.pinHash = simpleHash(newPin);
    }

    this.saveConfig();
    this.resetSession();
  }

  public resetSession(): void {
    this.state.timeRemainingSec = this.config.timeLimitMinutes * 60;
    this.state.livesRemaining = this.config.livesLimit;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lastTickTs = Date.now();
    this.warningTriggered = false;
    this.saveState();
    this.notify();
  }

  public tick(dtSec: number): void {
    if (!this.config.enabled || this.state.isLocked) return;

    this.state.lastTickTs = Date.now();

    if (this.config.timeLimitEnabled) {
      this.state.timeRemainingSec = Math.max(0, this.state.timeRemainingSec - dtSec);

      // Cảnh báo khi còn 2 phút
      if (this.state.timeRemainingSec <= 120 && !this.warningTriggered) {
        this.warningTriggered = true;
        this.notify();
      }

      if (this.state.timeRemainingSec <= 0) {
        this.lock('time');
        return;
      }
    }

    // Lưu định kỳ mỗi 5s
    if (Math.floor(this.state.timeRemainingSec) % 5 === 0) {
      this.saveState();
    }
    this.notify();
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
    this.saveState();
    this.notify();
  }

  public unlockWithPin(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.saveState();
    this.notify();
    return true;
  }

  public extendTime(minutes: number, pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.state.timeRemainingSec += minutes * 60;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.state.lastTickTs = Date.now();
    this.warningTriggered = false;
    this.saveState();
    this.notify();
    return true;
  }

  public extendLives(lives: number, pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.state.livesRemaining += lives;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.saveState();
    this.notify();
    return true;
  }

  public disableKidsMode(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.config.enabled = false;
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.saveConfig();
    this.saveState();
    this.notify();
    return true;
  }
}
