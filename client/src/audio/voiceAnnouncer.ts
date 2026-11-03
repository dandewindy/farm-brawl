/**
 * Voice Announcer Module (VieNeu-TTS Pre-baked Southern Female Voice)
 * -------------------------------------------------------------------
 * Tách biệt hoàn toàn (100% Decoupled).
 * Để tắt toàn bộ tính năng này (không hiện nút UI, không tải audio, không đọc):
 * Chỉ cần đổi `ENABLE_VOICE_ANNOUNCER = false` ở dòng dưới đây.
 */

import type { GameEvent } from '@shared/protocol';
import { isMuted } from './sfx';

export const ENABLE_VOICE_ANNOUNCER = true;

function isVietnameseLang(): boolean {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('fb_lang') : 'vi') !== 'en';
  } catch (_) {
    return true;
  }
}

export type VoiceKey =
  // Nhóm A: Vương quyền & Bục Vinh Quang
  | 'king_you'
  | 'king_new'
  | 'king_fell'
  | 'song_you'
  | 'song_all'
  | 'pod_lock'
  | 'pod_open'
  // Nhóm B: Điều răn của Vua (Commandment Rules)
  | 'rule_poultry'
  | 'rule_titan'
  | 'rule_equal'
  | 'rule_tax'
  | 'rule_sunday'
  | 'rule_snowball'
  | 'rule_till'
  | 'rule_dice'
  | 'rule_womenday'
  | 'rule_halloween'
  | 'rule_corn'
  | 'rule_squealer'
  | 'rule_twoleg'
  | 'rule_fourleg'
  // Nhóm C: Biến cố Bản đồ & Sự kiện Toàn trại
  | 'map_warn'
  | 'map_shift'
  | 'super_spawn'
  // Nhóm D: Đột phá & Sinh tử của Chính Người Chơi
  | 'self_super'
  | 'self_gorilla'
  | 'self_mammoth'
  | 'self_heart_get'
  | 'self_revive'
  | 'self_streak'
  | 'match_win';

interface QueuedVoice {
  key: VoiceKey;
  priority: 1 | 2;
  enqueuedAt: number;
}

const STORAGE_KEY = 'fb_voice_announcer';
const CLIP_COOLDOWN_MS = 4500;
const QUEUE_TTL_MS = 2800;

const RULE_VOICE_MAP: Record<string, VoiceKey> = {
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

export interface AnnouncerEventContext {
  myId: number;
  napoleonId: number;
  myTeam?: number;
}

class VoiceAnnouncerManager {
  private enabled: boolean = true;
  private audioCtx: AudioContext | null = null;
  private voiceGain: GainNode | null = null;
  private bufferCache = new Map<VoiceKey, AudioBuffer>();
  private loadingKeys = new Set<VoiceKey>();
  private lastPlayedAt = new Map<VoiceKey, number>();

  private queue: QueuedVoice[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private currentPriority: 1 | 2 = 2;
  private isPlaying = false;
  private preloaded = false;

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

    const unlockAndPreload = () => {
      if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
      this.ensureAudioContext();
      this.preloadCoreVoices();
    };

    window.addEventListener('pointerdown', unlockAndPreload, { once: true, passive: true });
    window.addEventListener('touchstart', unlockAndPreload, { once: true, passive: true });
  }

  public isEnabled(): boolean {
    return ENABLE_VOICE_ANNOUNCER && this.enabled;
  }

  public setEnabled(val: boolean): void {
    if (!ENABLE_VOICE_ANNOUNCER) return;
    this.enabled = val;
    try {
      localStorage.setItem(STORAGE_KEY, val ? '1' : '0');
    } catch (_) {}

    if (!val) {
      this.stopCurrent();
      this.queue.length = 0;
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
      this.voiceGain.gain.value = 1.0;
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
    const coreKeys: VoiceKey[] = [
      'king_you',
      'king_new',
      'king_fell',
      'song_you',
      'song_all',
      'super_spawn',
      'self_super',
      'self_revive',
    ];
    for (const k of coreKeys) {
      this.loadVoiceBuffer(k).catch(() => {});
    }
  }

  private async loadVoiceBuffer(key: VoiceKey): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(key)) {
      return this.bufferCache.get(key)!;
    }
    if (this.loadingKeys.has(key)) return null;
    const ctx = this.ensureAudioContext();
    if (!ctx) return null;

    this.loadingKeys.add(key);
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
      this.loadingKeys.delete(key);
    }
  }

  public play(key: VoiceKey, priority: 1 | 2 = 2): void {
    if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
    if (isMuted()) return;
    if (!isVietnameseLang()) return;

    const now = performance.now();
    const last = this.lastPlayedAt.get(key) ?? 0;
    if (now - last < CLIP_COOLDOWN_MS) return;

    // Nếu sự kiện ưu tiên 1 (Vua lên ngôi, Đổi điều răn, Hoá siêu thú, Hồi sinh) -> Cắt ngang câu ưu tiên 2 đang phát
    if (priority === 1 && this.isPlaying && this.currentPriority === 2) {
      this.stopCurrent();
      this.queue.unshift({ key, priority, enqueuedAt: now });
      this.processQueue();
      return;
    }

    // Tránh trùng lặp cùng key trong queue
    if (this.queue.some((q) => q.key === key)) return;

    if (priority === 1) {
      this.queue.unshift({ key, priority, enqueuedAt: now });
    } else {
      if (this.queue.length >= 2) return;
      this.queue.push({ key, priority, enqueuedAt: now });
    }

    if (!this.isPlaying) {
      this.processQueue();
    }
  }

  private stopCurrent(): void {
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch (_) {}
      this.currentSource = null;
    }
    this.isPlaying = false;
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || !ENABLE_VOICE_ANNOUNCER || !this.enabled || isMuted()) return;

    const now = performance.now();
    while (this.queue.length > 0 && now - this.queue[0].enqueuedAt > QUEUE_TTL_MS) {
      this.queue.shift();
    }

    const next = this.queue.shift();
    if (!next) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    this.currentPriority = next.priority;

    const buf = await this.loadVoiceBuffer(next.key);
    if (!buf || !this.enabled || isMuted()) {
      this.isPlaying = false;
      this.processQueue();
      return;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx || !this.voiceGain) {
      this.isPlaying = false;
      return;
    }

    this.lastPlayedAt.set(next.key, performance.now());

    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceGain);
      this.currentSource = src;
      src.onended = () => {
        this.currentSource = null;
        this.isPlaying = false;
        setTimeout(() => this.processQueue(), 220);
      };
      src.start(0);
    } catch (_) {
      this.currentSource = null;
      this.isPlaying = false;
    }
  }

  /**
   * Hook duy nhất nhận GameEvent từ main.ts.
   * Chỉ chọn lọc các sự kiện thực sự quan trọng, không đọc tên người chơi.
   */
  public handleEvent(ev: GameEvent, ctx: AnnouncerEventContext): void {
    if (!ENABLE_VOICE_ANNOUNCER || !this.enabled) return;
    const { myId } = ctx;

    switch (ev.k) {
      case 'napoleon': {
        if (ev.id === myId) {
          this.play('king_you', 1);
        } else if (ev.id > 0) {
          this.play('king_new', 1);
        } else {
          this.play('king_fell', 2);
        }
        break;
      }

      case 'rule': {
        const ruleKey = RULE_VOICE_MAP[ev.id];
        if (ruleKey) {
          this.play(ruleKey, 1);
        }
        break;
      }

      case 'song': {
        if (ev.nap === myId) {
          this.play('song_you', 1);
        } else {
          this.play('song_all', 1);
        }
        break;
      }

      case 'podWarn': {
        if (ev.left === 5) {
          this.play(ev.willShield ? 'pod_lock' : 'pod_open', 2);
        }
        break;
      }

      case 'mapWarn': {
        if (ev.left === 5) {
          this.play('map_warn', 2);
        }
        break;
      }

      case 'map': {
        if (ev.transition) {
          this.play('map_shift', 2);
        }
        break;
      }

      case 'superFood': {
        this.play('super_spawn', 2);
        break;
      }

      case 'super': {
        if (ev.id === myId) {
          this.play('self_super', 1);
        }
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

      case 'morph': {
        if (ev.id === myId) {
          if (ev.species === 'gorilla') {
            this.play('self_gorilla', 1);
          } else if (ev.species === 'mammoth') {
            this.play('self_mammoth', 1);
          }
        }
        break;
      }

      case 'tool': {
        if (ev.id === myId && ev.kind === 'heart') {
          this.play('self_heart_get', 1);
        }
        break;
      }

      case 'heartCollect': {
        if (ev.id === myId) {
          this.play('self_heart_get', 1);
        }
        break;
      }

      case 'heartRevive': {
        if (ev.id === myId) {
          this.play('self_revive', 1);
        }
        break;
      }

      case 'die': {
        if (ev.id === ctx.napoleonId && ev.id > 0) {
          this.play('king_fell', 2);
        } else if (ev.by === myId && ev.streak >= 3) {
          this.play('self_streak', 2);
        }
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
