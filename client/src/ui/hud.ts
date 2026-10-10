import * as THREE from 'three';
import { radiusOf, SPECIES, type Species } from '@shared/constants';
import type { ChoiceWire, GameEvent, HofRow, LeaderRow } from '@shared/protocol';
import { t } from '../i18n';
import { AnimalPreviewRenderer } from '../render/preview';

export interface FloatingText {
  el: HTMLDivElement;
  born: number;
  id: number;
  ax?: number;
  az?: number;
  ah?: number;
}

const _projVec = new THREE.Vector3();

export class HudManager {
  private readonly massEl: HTMLElement;
  private readonly rankTxt: HTMLElement;
  private readonly koTxt: HTMLElement;
  private readonly lbList: HTMLElement;
  private readonly hofList: HTMLElement | null;
  private readonly reignEl: HTMLElement | null;
  private readonly ruleNameEl: HTMLElement | null;
  private readonly ruleDescEl: HTMLElement | null;
  private readonly feedEl: HTMLElement;
  private readonly ramEl: HTMLElement;
  private readonly ramFill: HTMLElement;
  private readonly ramTxt: HTMLElement;
  private readonly captureEl: HTMLElement;
  private readonly capFillEl: HTMLElement;
  private readonly capTxtEl: HTMLElement;
  private readonly floatsEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private bannerTimer = 0;

  private readonly startScreen: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly hudEl: HTMLElement;

  private readonly nameInput: HTMLInputElement;
  private readonly speciesContainer: HTMLElement;
  private readonly speciesHint: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly againBtn: HTMLButtonElement;
  private readonly changeBtn: HTMLButtonElement;

  private readonly choiceEl: HTMLElement | null;
  private readonly choiceLeftEl: HTMLElement | null;
  private readonly choiceCardsEl: HTMLElement | null;
  private readonly teamBarEl: HTMLElement | null;
  private readonly ts0El: HTMLElement | null;
  private readonly ts1El: HTMLElement | null;
  private readonly tClockEl: HTMLElement | null;
  private readonly muteBtn: HTMLElement | null;
  private readonly modesContainer: HTMLElement | null;
  private readonly roomTagEl: HTMLElement | null;
  private readonly podiumBadgeEl: HTMLElement | null;
  private readonly ptIconEl: HTMLElement | null;
  private readonly ptTxtEl: HTMLElement | null;
  private readonly fpsVal: HTMLElement | null;
  private readonly pingVal: HTMLElement | null;
  private readonly fpsDot: HTMLElement | null;
  private readonly pingDot: HTMLElement | null;

  public onPickRule?: (id: string) => void;
  public onToggleMute?: () => void;
  public onSelectMode?: (mode: 'ffa' | 'team' | 'friend') => void;
  public selectedMode: 'ffa' | 'team' | 'friend' = 'ffa';
  private currentFriendCode = '';
  private currentChoiceOptions: string[] = [];
  private lastChoiceKey = '';

  private selectedSpecies: Species = 'pig';
  private floatingTexts: FloatingText[] = [];
  private mySkins: Record<Species, number> = {
    chicken: 0,
    sheep: 0,
    horse: 0,
    cow: 0,
    duck: 0,
    pig: 0,
  };

  private readonly friendPanel: HTMLElement | null;
  private readonly btnCreateRoom: HTMLElement | null;
  private readonly createdRoomBox: HTMLElement | null;
  private readonly createdRoomCode: HTMLElement | null;
  private readonly btnCopyCode: HTMLElement | null;
  private readonly btnCopyLink: HTMLElement | null;
  private readonly joinRoomCode: HTMLInputElement | null;
  private readonly btnApplyCode: HTMLElement | null;
  private readonly roomStatusNotice: HTMLElement | null;

  private previewRenderer: AnimalPreviewRenderer | null = null;
  private readonly spPreviewTitle: HTMLElement | null;
  private readonly spPreviewSkinName: HTMLElement | null;
  private readonly spPreviewBadge: HTMLElement | null;
  private readonly spSkinPalette: HTMLElement | null;
  private readonly spSkinPrev: HTMLElement | null;
  private readonly spSkinNext: HTMLElement | null;

  constructor(
    private readonly onStartPlay: (
      name: string,
      species: Species,
      mode: 'ffa' | 'team' | 'friend',
      skin: number,
      roomCode?: string
    ) => void
  ) {
    this.massEl = document.getElementById('mass')!;
    this.rankTxt = document.getElementById('rankTxt')!;
    this.koTxt = document.getElementById('koTxt')!;
    this.lbList = document.getElementById('lbList')!;
    this.hofList = document.getElementById('hofList');
    this.reignEl = document.getElementById('reign');
    this.ruleNameEl = document.getElementById('ruleName');
    this.ruleDescEl = document.getElementById('ruleDesc');
    this.feedEl = document.getElementById('feed')!;
    this.ramEl = document.getElementById('ram')!;
    this.ramFill = document.getElementById('ramFill')!;
    this.ramTxt = document.getElementById('ramTxt')!;
    this.captureEl = document.getElementById('capture')!;
    this.capFillEl = document.getElementById('capFill')!;
    this.capTxtEl = document.getElementById('capTxt')!;
    this.floatsEl = document.getElementById('floats')!;
    this.toastsEl = document.getElementById('toasts')!;
    this.bannerEl = document.getElementById('banner')!;

    this.startScreen = document.getElementById('start')!;
    this.deathScreen = document.getElementById('death')!;
    this.hudEl = document.getElementById('hud')!;

    this.nameInput = document.getElementById('name') as HTMLInputElement;
    this.speciesContainer = document.getElementById('species')!;
    this.speciesHint = document.getElementById('speciesHint')!;
    this.playBtn = document.getElementById('play') as HTMLButtonElement;
    this.againBtn = document.getElementById('again') as HTMLButtonElement;
    this.changeBtn = document.getElementById('change') as HTMLButtonElement;

    this.choiceEl = document.getElementById('choice');
    this.choiceLeftEl = document.getElementById('choiceLeft');
    this.choiceCardsEl = document.getElementById('choiceCards');
    this.teamBarEl = document.getElementById('teamBar');
    this.ts0El = document.getElementById('ts0');
    this.ts1El = document.getElementById('ts1');
    this.tClockEl = document.getElementById('tClock');
    this.muteBtn = document.getElementById('mute');
    this.modesContainer = document.getElementById('modes');
    this.roomTagEl = document.getElementById('roomTag');
    this.podiumBadgeEl = document.getElementById('podiumTimerBadge');
    this.ptIconEl = document.getElementById('ptIcon');
    this.ptTxtEl = document.getElementById('ptTxt');
    this.fpsVal = document.getElementById('fpsVal');
    this.pingVal = document.getElementById('pingVal');
    this.fpsDot = document.getElementById('fpsDot');
    this.pingDot = document.getElementById('pingDot');

    this.friendPanel = document.getElementById('friendPanel');
    this.btnCreateRoom = document.getElementById('btnCreateRoom');
    this.createdRoomBox = document.getElementById('createdRoomBox');
    this.createdRoomCode = document.getElementById('createdRoomCode');
    this.btnCopyCode = document.getElementById('btnCopyCode');
    this.btnCopyLink = document.getElementById('btnCopyLink');
    this.joinRoomCode = document.getElementById('joinRoomCode') as HTMLInputElement | null;
    this.btnApplyCode = document.getElementById('btnApplyCode');
    this.roomStatusNotice = document.getElementById('roomStatusNotice');

    this.spPreviewTitle = document.getElementById('spPreviewTitle');
    this.spPreviewSkinName = document.getElementById('spPreviewSkinName');
    this.spPreviewBadge = document.getElementById('spPreviewBadge');
    this.spSkinPalette = document.getElementById('spSkinPalette');
    this.spSkinPrev = document.getElementById('spSkinPrev');
    this.spSkinNext = document.getElementById('spSkinNext');

    const previewCanvas = document.getElementById('spPreviewCanvas') as HTMLCanvasElement | null;
    if (previewCanvas) {
      this.previewRenderer = new AnimalPreviewRenderer(previewCanvas);
      this.previewRenderer.start();
    }

    this.initSpeciesPicker();
    this.initEvents();
  }

  private initSpeciesPicker(): void {
    const SKIN_COLORS: Record<Species, number[]> = {
      chicken: [0xfaf6ee, 0xb5652b, 0x2e2c30, 0xd8c08a],
      sheep: [0xf3f1ea, 0x4a4442, 0xe6d6b0, 0xf8f6f0],
      horse: [0x8b5a2b, 0x2a2522, 0xd6d2ca, 0xd9a441],
      cow: [0xffffff, 0x7a4320, 0xb8814a, 0x2a2624],
      duck: [0xffd23f, 0xf7f4ec, 0x1f6b3a, 0x34343a],
      pig: [0xf6a5b5, 0x2f2a2c, 0xd2773a, 0x3a3335],
    };

    SPECIES.forEach((sp) => {
      const saved = localStorage.getItem(`fb_skin_${sp}`);
      if (saved !== null) {
        const val = parseInt(saved, 10);
        if (!isNaN(val)) this.mySkins[sp] = ((val % 4) + 4) % 4;
      }
    });

    const updateAllButtons = () => {
      const activeSkin = this.mySkins[this.selectedSpecies] ?? 0;

      // 1. Update 6 species buttons
      this.speciesContainer.querySelectorAll('button').forEach((b) => {
        const sp = b.dataset.species as Species;
        if (!sp) return;
        b.classList.toggle('on', sp === this.selectedSpecies);

        // Update 3D full-body thumbnail
        const img = b.querySelector('.sp-thumb') as HTMLImageElement | null;
        const currentSkin = this.mySkins[sp] ?? 0;
        if (img && this.previewRenderer) {
          img.src = this.previewRenderer.getThumbnail(sp, currentSkin);
        }

        const dots = b.querySelectorAll('.dot');
        dots.forEach((d, idx) => {
          d.classList.toggle('on', idx === currentSkin);
        });
      });

      // 2. Update hint text
      this.speciesHint.textContent = `${t(`sp_${this.selectedSpecies}`)}`;

      // 3. Update 3D Preview Showcase
      if (this.spPreviewTitle) {
        this.spPreviewTitle.textContent = t(`name_${this.selectedSpecies}`);
      }
      if (this.spPreviewSkinName) {
        this.spPreviewSkinName.textContent = t(`sk_${this.selectedSpecies}_${activeSkin}`);
      }
      if (this.spPreviewBadge) {
        this.spPreviewBadge.textContent = `Skin ${activeSkin + 1}/4`;
      }

      // 4. Update preview 3D model
      if (this.previewRenderer) {
        this.previewRenderer.setAnimal(this.selectedSpecies, activeSkin);
      }

      // 5. Update skin palette swatches
      if (this.spSkinPalette) {
        this.spSkinPalette.innerHTML = '';
        const colors = SKIN_COLORS[this.selectedSpecies] || [0xffffff, 0xcccccc, 0x888888, 0x333333];
        colors.forEach((col, idx) => {
          const sw = document.createElement('button');
          sw.type = 'button';
          sw.className = `sp-swatch${idx === activeSkin ? ' on' : ''}`;
          sw.style.backgroundColor = '#' + col.toString(16).padStart(6, '0');
          sw.title = `${t(`sk_${this.selectedSpecies}_${idx}`)}`;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            this.mySkins[this.selectedSpecies] = idx;
            localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(idx));
            updateAllButtons();
          });
          this.spSkinPalette!.appendChild(sw);
        });
      }
    };

    // Build the 6 species buttons
    this.speciesContainer.innerHTML = '';
    SPECIES.forEach((sp) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.species = sp;

      // 3D Full-Body Thumbnail (replaces inconsistent emojis)
      const thumb = document.createElement('img');
      thumb.className = 'sp-thumb';
      thumb.alt = sp;
      if (this.previewRenderer) {
        thumb.src = this.previewRenderer.getThumbnail(sp, this.mySkins[sp] ?? 0);
      }
      btn.appendChild(thumb);

      const dotsDiv = document.createElement('div');
      dotsDiv.className = 'dots';
      for (let i = 0; i < 4; i++) {
        const dot = document.createElement('i');
        dot.className = 'dot';
        dotsDiv.appendChild(dot);
      }
      btn.appendChild(dotsDiv);

      btn.addEventListener('click', () => {
        if (this.selectedSpecies === sp) {
          // Clicking active animal cycles its skin among the 4 skins!
          this.mySkins[sp] = ((this.mySkins[sp] ?? 0) + 1) % 4;
        } else {
          this.selectedSpecies = sp;
        }
        localStorage.setItem(`fb_skin_${sp}`, String(this.mySkins[sp]));
        updateAllButtons();
      });
      this.speciesContainer.appendChild(btn);
    });

    // Wire up navigation arrows for skin switching
    if (this.spSkinPrev) {
      this.spSkinPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = this.mySkins[this.selectedSpecies] ?? 0;
        this.mySkins[this.selectedSpecies] = (cur - 1 + 4) % 4;
        localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(this.mySkins[this.selectedSpecies]));
        updateAllButtons();
      });
    }
    if (this.spSkinNext) {
      this.spSkinNext.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = this.mySkins[this.selectedSpecies] ?? 0;
        this.mySkins[this.selectedSpecies] = (cur + 1) % 4;
        localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(this.mySkins[this.selectedSpecies]));
        updateAllButtons();
      });
    }

    updateAllButtons();
    this.nameInput.placeholder = t('namePh');
    this.nameInput.value = localStorage.getItem('fb_name') || '';
  }

  private initEvents(): void {
    const play = () => {
      const name = this.nameInput.value.trim() || t('defaultName');
      localStorage.setItem('fb_name', name);
      const skin = this.mySkins[this.selectedSpecies] ?? 0;
      if (this.selectedMode === 'friend') {
        const inputVal = (this.joinRoomCode?.value || '').trim().toUpperCase();
        if (inputVal.length >= 3) {
          this.currentFriendCode = inputVal;
        } else if (!this.currentFriendCode) {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let res = '';
          for (let i = 0; i < 6; i++) res += chars[Math.floor(Math.random() * chars.length)];
          this.currentFriendCode = res;
          if (this.createdRoomCode) this.createdRoomCode.textContent = res;
          if (this.createdRoomBox) this.createdRoomBox.hidden = false;
        }
      }
      this.previewRenderer?.stop();
      this.onStartPlay(name, this.selectedSpecies, this.selectedMode, skin, this.currentFriendCode);
    };

    this.playBtn.addEventListener('click', play);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') play();
    });

    this.againBtn.addEventListener('click', () => {
      this.deathScreen.hidden = true;
      play();
    });

    this.changeBtn.addEventListener('click', () => {
      this.deathScreen.hidden = true;
      this.startScreen.hidden = false;
      document.body.classList.add('menu');
      this.previewRenderer?.start();
      this.previewRenderer?.resize();
    });

    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', () => {
        this.onToggleMute?.();
      });
    }

    if (this.btnCreateRoom) {
      this.btnCreateRoom.addEventListener('click', () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let res = '';
        for (let i = 0; i < 6; i++) res += chars[Math.floor(Math.random() * chars.length)];
        this.currentFriendCode = res;
        if (this.createdRoomCode) this.createdRoomCode.textContent = res;
        if (this.createdRoomBox) this.createdRoomBox.hidden = false;
        if (this.joinRoomCode) this.joinRoomCode.value = res;
        if (this.roomStatusNotice) {
          this.roomStatusNotice.textContent = `Đã tạo phòng ${res}! Bấm Chơi để bắt đầu.`;
          this.roomStatusNotice.style.color = '#52c41a';
        }
        this.showToast(`Đã tạo phòng riêng: ${res}! 🎲`);
      });
    }

    if (this.btnCopyCode) {
      this.btnCopyCode.addEventListener('click', () => {
        if (this.currentFriendCode) {
          navigator.clipboard.writeText(this.currentFriendCode);
          this.showToast(`Đã chép mã phòng: ${this.currentFriendCode} 📋`);
        }
      });
    }

    if (this.btnCopyLink) {
      this.btnCopyLink.addEventListener('click', () => {
        if (this.currentFriendCode) {
          const url = `${window.location.origin}${window.location.pathname}?room=priv-${this.currentFriendCode}`;
          navigator.clipboard.writeText(url);
          this.showToast(`Đã chép link mời: ${url} 🔗`);
        }
      });
    }

    if (this.joinRoomCode) {
      this.joinRoomCode.addEventListener('input', () => {
        if (this.joinRoomCode) {
          this.joinRoomCode.value = this.joinRoomCode.value.toUpperCase();
        }
      });
      this.joinRoomCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const code = this.joinRoomCode?.value.trim().toUpperCase() || '';
          if (code.length >= 3) {
            this.currentFriendCode = code;
            if (this.roomStatusNotice) {
              this.roomStatusNotice.textContent = `Đã chọn phòng: ${code}`;
              this.roomStatusNotice.style.color = '#52c41a';
            }
            this.showToast(`Đã chọn phòng: ${code}`);
          }
        }
      });
    }

    if (this.btnApplyCode) {
      this.btnApplyCode.addEventListener('click', () => {
        const code = (this.joinRoomCode?.value || '').trim().toUpperCase();
        if (code.length >= 3) {
          this.currentFriendCode = code;
          if (this.roomStatusNotice) {
            this.roomStatusNotice.textContent = `Đã chọn phòng: ${code}`;
            this.roomStatusNotice.style.color = '#52c41a';
          }
          this.showToast(`Đã chọn phòng: ${code}`);
        } else {
          if (this.roomStatusNotice) {
            this.roomStatusNotice.textContent = `Mã phòng ít nhất 3 ký tự!`;
            this.roomStatusNotice.style.color = '#ff4d4f';
          }
        }
      });
    }

    if (this.modesContainer) {
      this.modesContainer.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode as 'ffa' | 'team' | 'friend';
          if (mode) {
            this.selectedMode = mode;
            this.modesContainer?.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
            btn.classList.add('on');
            if (this.friendPanel) {
              this.friendPanel.hidden = mode !== 'friend';
            }
            this.onSelectMode?.(mode);
          }
        });
      });
    }

    // Auto-detect invite link from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room') || urlParams.get('code');
    if (roomParam && (roomParam.startsWith('priv-') || roomParam.startsWith('friend-') || roomParam.length >= 3)) {
      const cleanCode = roomParam.replace(/^(priv|friend)-/, '').toUpperCase();
      this.currentFriendCode = cleanCode;
      this.selectedMode = 'friend';
      this.modesContainer?.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', b.dataset.mode === 'friend');
      });
      if (this.friendPanel) this.friendPanel.hidden = false;
      if (this.joinRoomCode) this.joinRoomCode.value = cleanCode;
      if (this.createdRoomCode) this.createdRoomCode.textContent = cleanCode;
      if (this.createdRoomBox) this.createdRoomBox.hidden = false;
      if (this.roomStatusNotice) {
        this.roomStatusNotice.textContent = `Phòng từ link mời: ${cleanCode}`;
        this.roomStatusNotice.style.color = '#52c41a';
      }
    }

    window.addEventListener('keydown', (e) => {
      if (this.choiceEl && !this.choiceEl.hidden && this.currentChoiceOptions.length) {
        if (e.key === '1' && this.currentChoiceOptions[0]) {
          this.pickChoice(this.currentChoiceOptions[0]);
        } else if (e.key === '2' && this.currentChoiceOptions[1]) {
          this.pickChoice(this.currentChoiceOptions[1]);
        } else if (e.key === '3' && this.currentChoiceOptions[2]) {
          this.pickChoice(this.currentChoiceOptions[2]);
        }
      }
    });
  }

  public pickChoice(id: string): void {
    this.onPickRule?.(id);
    if (this.choiceEl) this.choiceEl.hidden = true;
    this.currentChoiceOptions = [];
    this.lastChoiceKey = '';
  }

  public showChoice(c?: ChoiceWire | null): void {
    if (!c || !c.options || c.options.length === 0) {
      if (this.choiceEl) this.choiceEl.hidden = true;
      this.currentChoiceOptions = [];
      this.lastChoiceKey = '';
      return;
    }
    this.currentChoiceOptions = c.options;
    if (this.choiceLeftEl) {
      this.choiceLeftEl.textContent = t('choiceLeft', { s: c.left });
    }

    const key = c.options.join(',');
    if (this.lastChoiceKey === key) {
      // Options have not changed; avoid destroying DOM and losing click/focus
      if (this.choiceEl && this.choiceEl.hidden) this.choiceEl.hidden = false;
      return;
    }
    this.lastChoiceKey = key;

    if (this.choiceCardsEl) {
      this.choiceCardsEl.innerHTML = '';
      let firstBtn: HTMLButtonElement | null = null;
      c.options.forEach((ruleId, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = 0;
        b.className = 'plank';
        if (idx === 0) firstBtn = b;

        const kbd = document.createElement('kbd');
        kbd.textContent = String(idx + 1);
        const name = document.createElement('span');
        name.className = 'painted';
        name.textContent = t(`r_${ruleId}`);
        const desc = document.createElement('span');
        desc.className = 'd';
        desc.textContent = t(`d_${ruleId}`);
        b.append(kbd, name, desc);

        // Prevent pointer/touch events from leaking to canvas/movement
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('mousedown', (e) => e.stopPropagation());
        b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

        // Reliable selection handlers for mouse click, mobile touch tap, and keyboard Tab + Enter/Space
        const select = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          this.pickChoice(ruleId);
        };

        b.addEventListener('click', select);
        b.addEventListener('touchend', select);
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            select(e);
          }
        });

        this.choiceCardsEl!.appendChild(b);
      });
      if (this.choiceEl) {
        this.choiceEl.hidden = false;
        // Auto-focus first option once so user can immediately Tab through or press Enter
        setTimeout(() => firstBtn?.focus(), 50);
      }
    } else if (this.choiceEl) {
      this.choiceEl.hidden = false;
    }
  }

  public updateTeamBar(t0: number, t1: number, clockSec: number): void {
    if (this.teamBarEl) this.teamBarEl.hidden = false;
    if (this.ts0El) this.ts0El.textContent = String(t0);
    if (this.ts1El) this.ts1El.textContent = String(t1);
    if (this.tClockEl) this.tClockEl.textContent = this.fmtTime(clockSec);
  }

  public setRoomTag(name: string, inviteUrl?: string): void {
    if (this.roomTagEl) {
      this.roomTagEl.hidden = false;
      this.roomTagEl.textContent = name;
      if (inviteUrl) {
        this.roomTagEl.style.cursor = 'pointer';
        this.roomTagEl.title = 'Bấm để sao chép link mời bạn bè';
        this.roomTagEl.onclick = () => {
          navigator.clipboard.writeText(inviteUrl);
          this.showToast('Đã sao chép link mời phòng bạn bè! 🔗');
        };
      } else {
        this.roomTagEl.style.cursor = 'default';
        this.roomTagEl.onclick = null;
      }
    }
  }

  public setMuteState(muted: boolean): void {
    if (this.muteBtn) {
      this.muteBtn.innerHTML = muted
        ? `<span class="ico">🔇</span> <span>${t('sound')}</span>`
        : `<span class="ico">🔊</span> <span>${t('sound')}</span>`;
    }
  }

  showInGame(): void {
    this.startScreen.hidden = true;
    this.deathScreen.hidden = true;
    this.hudEl.hidden = false;
    document.body.classList.remove('menu');
  }

  showDeath(ev: Extract<GameEvent, { k: 'die' }>, killerName?: string): void {
    this.deathScreen.hidden = false;
    this.hudEl.hidden = true;
    document.body.classList.add('menu');

    const titleEl = document.getElementById('deathTitle')!;
    const causeEl = document.getElementById('deathCause')!;
    const dMass = document.getElementById('dMass')!;
    const dKills = document.getElementById('dKills')!;
    const dTime = document.getElementById('dTime')!;

    titleEl.textContent = t(`t_${ev.cause}`);
    causeEl.textContent = killerName ? t(`${ev.cause}By`, { killer: killerName }) : t(`${ev.cause}Self`);
    dMass.textContent = String(ev.best);
    dKills.textContent = String(ev.kills);
    const mins = Math.floor(ev.alive / 60);
    const secs = String(ev.alive % 60).padStart(2, '0');
    dTime.textContent = `${mins}:${secs}`;
  }

  updateStats(mass: number, rank: number, total: number, kills: number): void {
    this.massEl.textContent = String(Math.round(mass));
    this.rankTxt.textContent = t('rank', { r: rank || '–', n: total || '–' });
    this.koTxt.textContent = t('kos', { k: kills });
  }

  updatePerf(fps: number, ping: number): void {
    if (this.fpsVal) {
      this.fpsVal.textContent = String(fps);
      if (this.fpsDot) {
        this.fpsDot.className = `perf-dot ${fps >= 55 ? 'good' : fps >= 30 ? 'warn' : 'bad'}`;
      }
    }
    if (this.pingVal) {
      this.pingVal.textContent = ping > 0 ? String(ping) : (ping === 0 ? '<1' : '--');
      if (this.pingDot) {
        this.pingDot.className = `perf-dot ${ping <= 60 ? 'good' : ping <= 120 ? 'warn' : 'bad'}`;
      }
    }
  }

  updateRamMeter(cd: number, charging: boolean, chargeLevel: number, canCharge = true): void {
    if (cd > 0) {
      this.ramEl.className = 'cd';
      const pct = Math.max(0, 1 - cd / 1.3) * 100;
      this.ramFill.style.width = `${pct}%`;
      this.ramTxt.textContent = t('ramCd');
    } else if (!canCharge) {
      this.ramEl.className = 'no-charge';
      this.ramFill.style.width = '100%';
      this.ramTxt.textContent = t('ramNeedMass');
    } else if (charging) {
      this.ramEl.className = 'charging';
      this.ramFill.style.width = `${chargeLevel * 100}%`;
      this.ramTxt.textContent = t('ramCharge', { p: Math.round(chargeLevel * 100) });
    } else {
      this.ramEl.className = '';
      this.ramFill.style.width = '100%';
      this.ramTxt.textContent = t('ramReady');
    }
  }

  updateCapture(capId: number, progress: number, contested: boolean, myId: number, capName: string, isKing: boolean): void {
    const p = Math.round(progress * 100);
    if (contested) {
      this.captureEl.hidden = false;
      this.captureEl.classList.add('contested');
      this.capFillEl.style.width = '100%';
      this.capTxtEl.textContent = t('contested');
    } else if (capId > 0 && progress > 0.02) {
      this.captureEl.hidden = false;
      this.captureEl.classList.remove('contested');
      this.capFillEl.style.width = `${p}%`;
      if (capId === myId) {
        this.capTxtEl.textContent = isKing ? t('kingYou') : t('capYou', { p });
      } else {
        this.capTxtEl.textContent = isKing ? t('kingOther', { name: capName }) : t('capOther', { name: capName, p });
      }
    } else {
      this.captureEl.hidden = true;
    }
  }

  updatePodiumTimerBadge(shieldActive: boolean, timerSec: number, hasKing: boolean): void {
    if (!this.podiumBadgeEl || !this.ptIconEl || !this.ptTxtEl) return;
    this.podiumBadgeEl.classList.remove('shield-on', 'shield-off', 'has-king', 'warn');

    if (shieldActive) {
      this.podiumBadgeEl.classList.add('shield-on');
      this.ptIconEl.textContent = '🛡️';
      this.ptTxtEl.textContent = `Khóa: ${timerSec}s`;
      if (timerSec <= 5) this.podiumBadgeEl.classList.add('warn');
    } else if (hasKing) {
      this.podiumBadgeEl.classList.add('has-king');
      this.ptIconEl.textContent = '👑';
      this.ptTxtEl.textContent = 'Vua tại vị';
    } else {
      this.podiumBadgeEl.classList.add('shield-off');
      this.ptIconEl.textContent = '⚔️';
      this.ptTxtEl.textContent = `Tranh Vua: ${timerSec}s`;
      if (timerSec <= 5) this.podiumBadgeEl.classList.add('warn');
    }
  }

  fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  updateLeaderboard(lb: LeaderRow[], myId: number, napoleonId = 0): void {
    this.lbList.innerHTML = '';
    lb.forEach(([id, name, mass, kills, reign]) => {
      const li = document.createElement('li');
      if (id === myId) li.classList.add('me');
      const isKing = id === napoleonId && id > 0;
      if (isKing) li.classList.add('nap');

      const row = document.createElement('div');
      row.className = 'r';

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = name;

      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = kills > 0 ? `💥${kills}` : '';

      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = (isKing && reign && reign > 0) ? `👑 ${this.fmtTime(reign)} · ${mass} kg` : `${mass} kg`;

      row.append(n, k, v);
      li.appendChild(row);
      this.lbList.appendChild(li);
    });
  }

  updateHof(hof: HofRow[]): void {
    if (!this.hofList) return;
    const emojis: Record<Species, string> = {
      chicken: '🐔', sheep: '🐑', horse: '🐴', cow: '🐄', duck: '🦆', pig: '🐷',
    };
    this.hofList.innerHTML = '';
    for (const [name, sp, dur] of hof) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${emojis[sp] || ''} ${name}`;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = this.fmtTime(dur);
      li.append(n, v);
      this.hofList.appendChild(li);
    }
  }

  addFeed(text: string, isMine = false): void {
    const div = document.createElement('div');
    if (isMine) div.classList.add('mine');
    div.textContent = text;
    this.feedEl.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  showToast(text: string): void {
    const div = document.createElement('div');
    div.textContent = text;
    this.toastsEl.appendChild(div);
    setTimeout(() => div.remove(), 2600);
  }

  showRuleBanner(ruleId: string): void {
    const ruleTitle = t(`r_${ruleId}`);
    const ruleDesc = t(`d_${ruleId}`);
    this.showBanner(t('ruleNew', { rule: ruleTitle }), ruleDesc);
  }

  updateBoard(ruleId?: string, reignSec?: number, kingName?: string, isMe = false): void {
    if (this.ruleNameEl && this.ruleDescEl) {
      if (ruleId) {
        this.ruleNameEl.textContent = t(`r_${ruleId}`);
        this.ruleDescEl.textContent = t(`d_${ruleId}`);
      } else if (kingName) {
        this.ruleNameEl.textContent = t('r_equal');
        this.ruleDescEl.textContent = t('d_equal');
      } else {
        this.ruleNameEl.textContent = t('noNap');
        this.ruleDescEl.textContent = t('noNapDesc');
      }
    }
    if (this.reignEl) {
      if (kingName && reignSec !== undefined) {
        this.reignEl.hidden = false;
        const text = isMe
          ? t('reignYou', { t: this.fmtTime(reignSec) })
          : t('reignOther', { name: kingName, t: this.fmtTime(reignSec) });
        this.reignEl.textContent = `👑 ${text}`;
      } else {
        this.reignEl.hidden = true;
      }
    }
  }

  showBanner(head: string, sub: string): void {
    this.bannerEl.innerHTML = '';
    const h = document.createElement('span');
    h.className = 'head';
    h.textContent = head;
    this.bannerEl.appendChild(h);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = sub;
      this.bannerEl.appendChild(s);
    }
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 3500);
  }

  floatText(text: string, cls = '', id = 0, initialPos?: { x: number; z: number; mass: number }): void {
    const el = document.createElement('div');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    this.floatsEl.appendChild(el);
    const item: FloatingText = {
      el,
      born: performance.now(),
      id,
    };
    if (initialPos) {
      item.ax = initialPos.x;
      item.az = initialPos.z;
      item.ah = radiusOf(initialPos.mass) * 3.4 + 1.2;
    }
    this.floatingTexts.push(item);
  }

  spawnFloat(text: string, _screenX: number, _screenY: number, isBig = false, isLoss = false): void {
    this.floatText(text, isLoss ? 'loss' : isBig ? 'big' : '', 0);
  }

  updateFloats(
    camera?: THREE.Camera,
    posResolver?: ((id: number) => { x: number; z: number; mass: number } | undefined) | Map<number, { x: number; z: number; mass: number }>
  ): void {
    const now = performance.now();
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      const age = (now - f.born) / 1000;
      if (age > 1.1) {
        f.el.remove();
        this.floatingTexts.splice(i, 1);
        continue;
      }

      if (posResolver && f.id) {
        const st = typeof posResolver === 'function' ? posResolver(f.id) : posResolver.get(f.id);
        if (st) {
          f.ax = st.x;
          f.az = st.z;
          f.ah = radiusOf(st.mass) * 3.4 + 1.2;
        }
      }

      const scale = age < 0.12 ? (0.6 + age * 3.3).toFixed(2) : '1';
      const opacity = age > 0.7 ? ((1.1 - age) / 0.4).toFixed(2) : '1';

      if (camera && f.ax !== undefined && f.az !== undefined && f.ah !== undefined) {
        _projVec.set(f.ax, f.ah, f.az).project(camera);
        if (_projVec.z > 1) {
          f.el.style.display = 'none';
          continue;
        }
        f.el.style.display = '';
        const sx = (_projVec.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-_projVec.y * 0.5 + 0.5) * window.innerHeight;
        f.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy - age * 60).toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale})`;
        f.el.style.opacity = opacity;
      } else {
        const sx = window.innerWidth / 2;
        const sy = window.innerHeight / 2 - 40;
        f.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy - age * 60).toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale})`;
        f.el.style.opacity = opacity;
      }
    }
  }
}
