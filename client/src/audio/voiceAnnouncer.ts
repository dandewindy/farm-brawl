/**
 * Voice Announcer Module (VieNeu-TTS Pre-baked Southern Female Voice)
 * -------------------------------------------------------------------
 * Tách biệt hoàn toàn (100% Decoupled).
 * Để tắt toàn bộ tính năng này (không hiện nút UI, không tải audio, không đọc):
 * Chỉ cần đổi `ENABLE_VOICE_ANNOUNCER = false` ở dòng dưới đây.
 */

import type { DeathCause, GameEvent, PlayerMeta } from '@shared/protocol';
import type { Species } from '@shared/constants';
import { isMuted } from './sfx';
import { KidsPlayManager } from '../features/kidsMode';

export const ENABLE_VOICE_ANNOUNCER = true;

function isVietnameseLang(): boolean {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('fb_lang') : 'vi') !== 'en';
  } catch (_) {
    return true;
  }
}

export type VoicePriority = 1 | 2 | 3 | 4;

const STORAGE_KEY = 'fb_voice_announcer';
const SAME_KEY_COOLDOWN_MS = 2500;

const RULE_VOICE_MAP: Record<string, string> = {
  poultry: 'rule_poultry',
  titan: 'rule_titan',
  equal: 'rule_equal',
  tax: 'rule_tax',
  sunday: 'rule_sunday',
  snowball: 'rule_snowball',
  till: 'rule_till',
  dice: 'rule_dice',
  womenday: 'rule_womenday',
  halloween: 'rule_halloween',
  corn: 'rule_corn',
  squealer: 'rule_squealer',
  twoleg: 'rule_twoleg',
  fourleg: 'rule_fourleg',
};

const VALID_SPECIES = new Set<string>([
  'chicken',
  'sheep',
  'horse',
  'cow',
  'duck',
  'pig',
  'dog',
  'elephant',
  'monkey',
  'gorilla',
  'mammoth',
  'wolf',
]);

const CAUSE_WITH_KILLER = new Set<DeathCause>([
  'fence',
  'drown',
  'well',
  'fire',
  'dynamite',
  'crush',
  'starve',
]);

export interface AnnouncerEventContext {
  myId: number;
  napoleonId: number;
  myTeam?: number;
  metas?: Map<number, PlayerMeta>;
}

class VoiceAnnouncerManager {
  private enabled: boolean = true;
  private audioCtx: AudioContext | null = null;
  private voiceGain: GainNode | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private lastPlayedAt = new Map<string, number>();

  private currentSource: AudioBufferSourceNode | null = null;
  private currentPriority: VoicePriority = 4;
  private isPlaying = false;
  private playToken = 0;
  private preloaded = false;
  private wasKidsLocked = false;

  // UI Elements injected dynamically
  private sbmValEl: HTMLElement | null = null;
  private sbmIconEl: HTMLElement | null = null;
  private drawerBtnEl: HTMLElement | null = null;
  private pcCheckEl: HTMLInputElement | null = null;

  constructor() {
    if (!ENABLE_VOICE_ANNOUNCER) {
      this.enabled = false;
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      this.enabled = saved !== '0';
    } catch (_) {
      this.enabled = true;
    }
  }

  public init(): void {
    if (!ENABLE_VOICE_ANNOUNCER) return;

    this.injectSettingsUI();
    this.syncUI();

    // Lắng nghe sự kiện khóa Giờ chơi của bé (Windy)
    try {
      const kidsMgr = KidsPlayManager.getInstance();
      this.wasKidsLocked = Boolean(kidsMgr.config.enabled && kidsMgr.state.isLocked);
      kidsMgr.subscribe((state, config) => {
        const nowLocked = Boolean(config.enabled && state.isLocked);
        if (nowLocked && !this.wasKidsLocked) {
          this.wasKidsLocked = true;
          this.play('kids_lock', 1);
        } else if (!nowLocked) {
          this.wasKidsLocked = false;
        }
      });
    } catch (_) {}

    const unlockAndPreload = () => {
      if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
      this.ensureAudioContext();
      this.preloadCoreVoices();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlockAndPreload, { once: true, passive: true });
      window.addEventListener('touchstart', unlockAndPreload, { once: true, passive: true });
    }
  }

  public isEnabled(): boolean {
    return ENABLE_VOICE_ANNOUNCER && this.enabled;
  }

  public setEnabled(val: boolean): void {
    if (!ENABLE_VOICE_ANNOUNCER) return;
    this.enabled = val;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, val ? '1' : '0');
      }
    } catch (_) {}

    if (!val) {
      this.stopCurrent();
    } else {
      this.ensureAudioContext();
      this.preloadCoreVoices();
    }
    this.syncUI();
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    this.showToggleToast();
    return this.enabled;
  }

  private showToggleToast(): void {
    if (typeof document === 'undefined') return;
    const isVi = isVietnameseLang();
    const ico = this.enabled ? '🗣️' : '😶';
    const txt = isVi
      ? (this.enabled ? 'Giọng thông báo (MC): BẬT' : 'Giọng thông báo (MC): TẮT')
      : (this.enabled ? 'Voice Announcer: ON' : 'Voice Announcer: OFF');
    let toast = document.getElementById('audioToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'audioToast';
      toast.className = 'audio-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = `${ico} ${txt}`;
    toast.classList.remove('fade-out');
    toast.classList.add('show');
    setTimeout(() => {
      toast?.classList.remove('show');
      toast?.classList.add('fade-out');
    }, 1200);
  }

  public syncUI(): void {
    if (!ENABLE_VOICE_ANNOUNCER) return;
    const isVi = isVietnameseLang();
    const onTxt = isVi ? 'BẬT' : 'ON';
    const offTxt = isVi ? 'TẮT' : 'OFF';
    const titleTxt = isVi ? 'Giọng MC' : 'Voice MC';

    if (this.sbmValEl) {
      this.sbmValEl.textContent = this.enabled ? onTxt : offTxt;
    }
    if (this.sbmIconEl) {
      this.sbmIconEl.textContent = this.enabled ? '🗣️' : '😶';
    }
    if (this.drawerBtnEl) {
      const lbl = this.drawerBtnEl.querySelector('.lbl') || this.drawerBtnEl;
      lbl.textContent = `${titleTxt}: ${this.enabled ? onTxt : offTxt}`;
      this.drawerBtnEl.classList.toggle('off', !this.enabled);
    }
    if (this.pcCheckEl) {
      this.pcCheckEl.checked = this.enabled;
    }
  }

  private injectSettingsUI(): void {
    if (typeof document === 'undefined') return;

    // 1. Lobby Burger Menu (#startBurgerMenu .sbm-list)
    const sbmMute = document.getElementById('sbmMute');
    if (sbmMute && sbmMute.parentElement && !document.getElementById('sbmVoiceMC')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'sbmVoiceMC';
      btn.className = 'sbm-item';
      btn.innerHTML = `
        <span class="sbm-icon" id="sbmVoiceMCIcon">🗣️</span>
        <div class="sbm-info">
          <span class="sbm-name">Giọng thông báo (MC)</span>
          <span class="sbm-val" id="sbmVoiceMCVal">BẬT</span>
        </div>
      `;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
      sbmMute.insertAdjacentElement('afterend', btn);
      this.sbmValEl = btn.querySelector('#sbmVoiceMCVal');
      this.sbmIconEl = btn.querySelector('#sbmVoiceMCIcon');
    }

    // 2. In-Game Drawer (#gameDrawerModal .drawer-actions)
    const drawerShadow = document.getElementById('drawerShadowToggle');
    if (drawerShadow && drawerShadow.parentElement && !document.getElementById('drawerVoiceMCToggle')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'drawerVoiceMCToggle';
      btn.className = 'drawer-btn';
      btn.innerHTML = `<span class="lbl">Giọng MC: BẬT</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
      drawerShadow.insertAdjacentElement('afterend', btn);
      this.drawerBtnEl = btn;
    }

    // 3. PC Settings Menu (#pcSettingsMenu)
    const pcSettingsMenu = document.getElementById('pcSettingsMenu');
    if (pcSettingsMenu && !document.getElementById('pcToggleVoiceMC')) {
      const lbl = document.createElement('label');
      lbl.className = 'settings-item';
      lbl.innerHTML = `
        <input type="checkbox" id="pcToggleVoiceMC" checked>
        <span>Giọng thông báo (MC)</span>
      `;
      const input = lbl.querySelector('input') as HTMLInputElement;
      input.addEventListener('change', () => {
        this.setEnabled(input.checked);
      });
      pcSettingsMenu.appendChild(lbl);
      this.pcCheckEl = input;
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.audioCtx = new AC();
      this.voiceGain = this.audioCtx.createGain();
      this.voiceGain.gain.value = 1.05;
      this.voiceGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private preloadCoreVoices(): void {
    if (this.preloaded || !ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
    this.preloaded = true;
    const coreKeys: string[] = [
      'welcome',
      'kids_lock',
      'king_you',
      'king_new',
      'king_fell',
      'item_speed',
      'item_dynamite',
      'item_shield',
      'item_pitchfork',
      'item_wheel',
      'item_star',
      'item_heart',
      'self_super',
      'self_revive',
      'die_self_fence',
      'die_self_drown',
    ];
    for (const k of coreKeys) {
      this.loadVoiceBuffer(k).catch(() => {});
    }
  }

  private loadVoiceBuffer(key: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(key)) {
      return Promise.resolve(this.bufferCache.get(key)!);
    }
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key)!;
    }
    const ctx = this.ensureAudioContext();
    if (!ctx) return Promise.resolve(null);

    const p = (async () => {
      try {
        const res = await fetch(`/voices/vi/${key}.mp3`);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        this.bufferCache.set(key, buf);
        return buf;
      } catch (_) {
        return null;
      } finally {
        this.loadingPromises.delete(key);
      }
    })();

    this.loadingPromises.set(key, p);
    return p;
  }

  public stopCurrent(): void {
    this.playToken++;
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (_) {}
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.currentPriority = 4;
  }

  /**
   * Cơ chế Cắt ngang & Ưu tiên (Preemptive Priority):
   * - Priority 1 (Cao nhất): Khóa giờ chơi Windy, Bản thân bị hạ gục, Hồi sinh, Thắng trận.
   * - Priority 2 (Quan trọng): Lên ngôi Vua, Đổi Điều răn, Hát phản loạn, Tiến hóa 3 tấn, Hoá siêu thú.
   * - Priority 3 (Chiến thuật): Chào mừng vào trận, Nhặt Item đặc biệt, Hạ gục đối thủ.
   * - Priority 4 (Cảnh báo phụ): Bục đóng/mở, Sắp đổi map, Kẹo cầu vồng rơi.
   *
   * Quy tắc:
   * - Nếu đang đọc câu có mức ưu tiên CAO HƠN (số nhỏ hơn, vd đang đọc Priority 1 hoặc 2 mà có sự kiện Priority 3/4):
   *   Giữ nguyên câu đang đọc, bỏ qua câu kém quan trọng hơn.
   * - Nếu sự kiện mới có mức ưu tiên CAO HƠN HOẶC NGANG BẰNG (`priority <= this.currentPriority`):
   *   Lập tức ngắt ngay âm thanh cũ (`stopCurrent()`) và đọc ngay câu mới nhất để không bao giờ bị chồng chéo hay trễ nhịp!
   */
  public play(key: string, priority: VoicePriority = 3): void {
    if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
    if (isMuted() && key !== 'kids_lock') return;
    if (!isVietnameseLang()) return;

    const now = performance.now();
    const last = this.lastPlayedAt.get(key);
    if (last !== undefined && now - last < SAME_KEY_COOLDOWN_MS && key !== 'kids_lock') return;

    // Nếu đang phát một câu QUAN TRỌNG HƠN (priority nhỏ hơn), bỏ qua câu kém quan trọng này
    if (this.isPlaying && priority > this.currentPriority) {
      return;
    }

    // Ngắt ngay âm thanh trước đó để không bao giờ bị chồng âm thanh
    this.stopCurrent();

    const myToken = this.playToken;
    this.isPlaying = true;
    this.currentPriority = priority;
    this.lastPlayedAt.set(key, now);

    this.loadVoiceBuffer(key).then((buf) => {
      // Nếu trong lúc tải đã có sự kiện khác mới hơn cắt ngang -> hủy bỏ ngay
      if (myToken !== this.playToken || !buf || !this.enabled || (isMuted() && key !== 'kids_lock')) {
        if (myToken === this.playToken) {
          this.isPlaying = false;
          this.currentPriority = 4;
        }
        return;
      }

      const ctx = this.ensureAudioContext();
      if (!ctx || !this.voiceGain) {
        this.isPlaying = false;
        this.currentPriority = 4;
        return;
      }

      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.voiceGain);
        this.currentSource = src;
        src.onended = () => {
          if (this.playToken === myToken) {
            this.currentSource = null;
            this.isPlaying = false;
            this.currentPriority = 4;
          }
        };
        src.start(0);
      } catch (_) {
        if (this.playToken === myToken) {
          this.currentSource = null;
          this.isPlaying = false;
          this.currentPriority = 4;
        }
      }
    });
  }

  /**
   * Phát lời chào mừng khi người chơi vừa bước vào nông trại
   */
  public onWelcome(): void {
    this.play('welcome', 3);
  }

  private resolveDeathVoiceKey(cause: DeathCause, killerSpecies?: Species): string {
    if (cause === 'till') {
      return 'die_self_till';
    }
    if (killerSpecies && VALID_SPECIES.has(killerSpecies) && CAUSE_WITH_KILLER.has(cause)) {
      return `die_${killerSpecies}_${cause}`;
    }
    return `die_self_${cause}`;
  }

  /**
   * Hook duy nhất nhận GameEvent từ main.ts.
   */
  public handleEvent(ev: GameEvent, ctx: AnnouncerEventContext): void {
    if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
    const { myId, metas } = ctx;

    switch (ev.k) {
      case 'die': {
        if (ev.id === myId) {
          // Bản thân bị hạ gục -> Priority 1 (Cao nhất: báo rõ con vật + nguyên nhân hoặc tự chết)
          const killerMeta = ev.by > 0 && ev.by !== myId ? metas?.get(ev.by) : undefined;
          const deathKey = this.resolveDeathVoiceKey(ev.cause, killerMeta?.species);
          this.play(deathKey, 1);
        } else if (ev.by === myId) {
          // Bản thân hạ gục đối thủ -> Priority 3
          if (ev.streak >= 3) {
            this.play('self_streak', 2);
          } else if (ev.streak === 2) {
            this.play('ko_double', 3);
          } else {
            const victimMeta = metas?.get(ev.id);
            const sp = victimMeta?.species;
            const koKey = sp && VALID_SPECIES.has(sp) ? `ko_${sp}` : 'ko_generic';
            this.play(koKey, 3);
          }
        } else if (ev.id === ctx.napoleonId && ev.id > 0) {
          // Vua nông trại bị người khác lật đổ
          this.play('king_fell', 2);
        }
        break;
      }

      case 'napoleon': {
        if (ev.id === myId) {
          this.play('king_you', 2);
        } else if (ev.id > 0) {
          this.play('king_new', 2);
        } else {
          this.play('king_fell', 3);
        }
        break;
      }

      case 'rule': {
        const ruleKey = RULE_VOICE_MAP[ev.id];
        if (ruleKey) {
          this.play(ruleKey, 2);
        }
        break;
      }

      case 'song': {
        if (ev.nap === myId) {
          this.play('song_you', 2);
        } else {
          this.play('song_all', 2);
        }
        break;
      }

      case 'tool': {
        if (ev.id === myId) {
          switch (ev.kind) {
            case 'speed':
              this.play('item_speed', 3);
              break;
            case 'dynamite':
              this.play('item_dynamite', 3);
              break;
            case 'shield':
              this.play('item_shield', 3);
              break;
            case 'pitchfork':
              this.play('item_pitchfork', 3);
              break;
            case 'wheel':
              this.play('item_wheel', 3);
              break;
            case 'star':
              this.play('item_star', 3);
              break;
            case 'heart':
              this.play('item_heart', 3);
              break;
          }
        }
        break;
      }

      case 'heartCollect': {
        if (ev.id === myId) {
          this.play('item_heart', 3);
        }
        break;
      }

      case 'heartRevive': {
        if (ev.id === myId) {
          this.play('self_revive', 1);
        }
        break;
      }

      case 'super': {
        if (ev.id === myId) {
          this.play('self_super', 2);
        }
        break;
      }

      case 'morph': {
        if (ev.id === myId) {
          if (ev.species === 'gorilla') {
            this.play('self_gorilla', 2);
          } else if (ev.species === 'mammoth') {
            this.play('self_mammoth', 2);
          } else if (ev.species === 'monkey') {
            this.play('item_banana_monkey', 3);
          } else if (ev.species === 'elephant') {
            this.play('item_banana_elephant', 3);
          }
        }
        break;
      }

      case 'podWarn': {
        if (ev.left === 5) {
          this.play(ev.willShield ? 'pod_lock' : 'pod_open', 4);
        }
        break;
      }

      case 'mapWarn': {
        if (ev.left === 5) {
          this.play('map_warn', 4);
        }
        break;
      }

      case 'map': {
        if (ev.transition) {
          this.play('map_shift', 4);
        }
        break;
      }

      case 'superFood': {
        this.play('super_spawn', 4);
        break;
      }

      case 'flowerBloom': {
        this.play('rule_womenday', 2);
        break;
      }

      case 'trickOrTreat': {
        this.play('rule_halloween', 2);
        break;
      }

      case 'teamWin': {
        if (ctx.myTeam !== undefined && ev.winner === ctx.myTeam) {
          this.play('match_win', 1);
        } else if (ev.ranks && ev.ranks.length > 0 && ev.ranks[0][0] === myId) {
          this.play('match_win', 1);
        }
        break;
      }
    }
  }
}

export const voiceAnnouncer = new VoiceAnnouncerManager();
