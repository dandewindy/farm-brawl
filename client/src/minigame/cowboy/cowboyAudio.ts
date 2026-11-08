import { voiceAnnouncer } from '../../audio/voiceAnnouncer';
import { playSpeciesCry, sfxReward, isMuted } from '../../audio/sfx';
import type { Species } from '@shared/constants';

class CowboyAudioManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;

  // Cache buffer âm thanh để phát tức thì 0ms trễ
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();

  // Quản lý kênh voice độc quyền: Không bao giờ bị chồng chéo âm thanh
  private currentVoiceSource: AudioBufferSourceNode | null = null;
  private currentVoicePriority = 4;
  private playToken = 0;

  // Debounce tránh spam SFX khi nhiều dây kích hoạt cùng frame
  private lastAnimalCryTime = 0;
  private lastTugTime = 0;
  private lastSnapTime = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.ctx.destination);

      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 1.35;
      this.voiceGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Tải và cache AudioBuffer */
  private async loadBuffer(key: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(key)) {
      return this.bufferCache.get(key)!;
    }
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key)!;
    }

    const promise = (async () => {
      try {
        const ctx = this.ensureContext();
        if (!ctx) return null;
        const res = await fetch(`/voices/vi/${key}.mp3`);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        this.bufferCache.set(key, decoded);
        return decoded;
      } catch (_) {
        return null;
      } finally {
        this.loadingPromises.delete(key);
      }
    })();

    this.loadingPromises.set(key, promise);
    return promise;
  }

  /** Dừng ngay âm thanh voice đang phát để không bị nói đè/chồng chéo */
  public stopCurrentVoice(): void {
    if (this.currentVoiceSource) {
      try {
        this.currentVoiceSource.stop();
        this.currentVoiceSource.disconnect();
      } catch (_) {}
      this.currentVoiceSource = null;
    }
    this.currentVoicePriority = 4;
    this.playToken++;
  }

  /**
   * Phát Voice thông báo không bao giờ chồng chéo (Cơ chế giống game chính)
   * Priority:
   * 1: Thú thần thoại / Thú lấp lánh x2 / Thú cầu vồng
   * 2: Thú tiến hóa điểm cao
   * 3: Bắt dính thú thường
   * 4: Hụt / Hết credit / Chào mừng
   */
  public playVoice(
    key:
      | 'cowboy_welcome'
      | 'cowboy_catch'
      | 'cowboy_miss'
      | 'cowboy_jackpot'
      | 'cowboy_empty'
      | 'cowboy_hit_swan'
      | 'cowboy_hit_ram'
      | 'cowboy_hit_wolf'
      | 'cowboy_hit_boar'
      | 'cowboy_hit_gorilla'
      | 'cowboy_hit_bull'
      | 'cowboy_hit_pegasus'
      | 'cowboy_hit_phoenix'
      | 'cowboy_hit_mammoth'
      | 'cowboy_hit_sparkle'
      | string,
    priority?: number
  ): void {
    if (isMuted()) return;

    // Tự động gán mức ưu tiên nếu không truyền vào
    let prio = priority;
    if (prio === undefined) {
      if (key === 'cowboy_hit_sparkle' || key === 'cowboy_jackpot' || key === 'cowboy_hit_mammoth' || key === 'cowboy_hit_phoenix' || key === 'cowboy_hit_pegasus') {
        prio = 1;
      } else if (key.startsWith('cowboy_hit_')) {
        prio = 2;
      } else if (key === 'cowboy_catch') {
        prio = 3;
      } else {
        prio = 4;
      }
    }

    // Nếu câu nói hiện tại hoặc câu đang đợi tải buffer có độ ưu tiên cao hơn -> bỏ qua câu thấp hơn
    if (this.currentVoicePriority < prio) {
      return;
    }

    // Lập tức ngắt câu nói cũ trước khi phát câu mới
    this.stopCurrentVoice();
    voiceAnnouncer.stopCurrent();

    this.playToken++;
    const token = this.playToken;
    this.currentVoicePriority = prio;

    this.loadBuffer(key).then((buf) => {
      if (!buf || token !== this.playToken || isMuted()) {
        if (this.playToken === token) {
          this.currentVoicePriority = 4;
        }
        return;
      }
      const ctx = this.ensureContext();
      if (!ctx || !this.voiceGain) {
        if (this.playToken === token) {
          this.currentVoicePriority = 4;
        }
        return;
      }

      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.voiceGain);
        this.currentVoiceSource = src;

        src.onended = () => {
          if (this.playToken === token) {
            this.currentVoiceSource = null;
            this.currentVoicePriority = 4;
          }
        };

        src.start(0);
      } catch (_) {
        if (this.playToken === token) {
          this.currentVoiceSource = null;
          this.currentVoicePriority = 4;
        }
      }
    });
  }

  /** Âm thanh quăng dây vút qua không trung */
  public playLassoThrow(): void {
    if (isMuted()) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const t = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
      osc.frequency.exponentialRampToValueAtTime(450, t + 0.38);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, t);
      filter.Q.value = 3.0;

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(t);
      osc.stop(t + 0.40);
    } catch (_) {}
  }

  /** Âm thanh dây thắt chặt giằng co (Tug-of-war twang) */
  public playLassoTug(): void {
    if (isMuted()) return;
    const now = performance.now();
    if (now - this.lastTugTime < 180) return; // Debounce tránh nổ đúp âm thanh
    this.lastTugTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const t = ctx.currentTime;
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.25);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

      osc.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(t);
      osc.stop(t + 0.28);
    } catch (_) {}
  }

  /** Âm thanh dây đứt phựt khi thú giật mất (Snap) */
  public playLassoSnap(): void {
    if (isMuted()) return;
    const now = performance.now();
    if (now - this.lastSnapTime < 180) return; // Debounce
    this.lastSnapTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const t = ctx.currentTime;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.14);

      gain.gain.setValueAtTime(0.40, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(t);
      osc.stop(t + 0.16);
    } catch (_) {}
  }

  /** Kêu tiếng động vật khi bị bắt (Có debounce 350ms để không đè nhau nếu bắt nhiều con cùng lúc) */
  public playAnimalCry(species: Species): void {
    if (isMuted()) return;
    const now = performance.now();
    if (now - this.lastAnimalCryTime < 350) return;
    this.lastAnimalCryTime = now;

    try {
      playSpeciesCry(species, 1.2);
    } catch (_) {}
  }

  /** Chuông thưởng nổ vàng */
  public playReward(): void {
    if (isMuted()) return;
    try {
      sfxReward();
    } catch (_) {}
  }
}

export const cowboyAudio = new CowboyAudioManager();
