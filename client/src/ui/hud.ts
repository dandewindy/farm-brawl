import * as THREE from 'three';
import { radiusOf, SPECIES, type Species } from '@shared/constants';
import type { ChoiceWire, GameEvent, HofRow, LeaderRow } from '@shared/protocol';
import { t, getLanguage, toggleLanguage, formatTeamCount, type Lang } from '../i18n';
import { getArenaTheme, setArenaTheme, type ArenaTheme } from '../theme';
import { AnimalPreviewRenderer } from '../render/preview';
import type { AudioMode } from '../audio/sfx';
import { isFastColo } from '../net/ws';

export interface FloatingText {
  el: HTMLDivElement;
  born: number;
  id: number;
  ax?: number;
  az?: number;
  ah?: number;
}

const _projVec = new THREE.Vector3();

export const SELECTABLE_SPECIES: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig'];
export const TOTAL_CAROUSEL_ITEMS = SELECTABLE_SPECIES.length + 1; // 6 animals + 1 random '?' = 7

/**
 * Rock-solid clipboard copy function that works across desktop & mobile browsers.
 * Uses synchronous execCommand('copy') with textarea during the user gesture event,
 * and calls modern navigator.clipboard.writeText in parallel.
 */
export function copyTextToClipboard(text: string): boolean {
  if (!text) return false;
  let copied = false;

  // 1. Synchronous execCommand copy with temporary textarea
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
    document.body.removeChild(el);
  } catch (_) {
    copied = false;
  }

  // 2. Also invoke navigator.clipboard.writeText for modern browsers
  if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      copied = true;
    }).catch(() => {});
  }

  return copied;
}

export class HudManager {
  private readonly massEl: HTMLElement;
  private readonly rankTxt: HTMLElement;
  private readonly koTxt: HTMLElement;
  private readonly lbList: HTMLElement;
  private readonly drawerLbList: HTMLElement | null;
  private readonly hofList: HTMLElement | null;
  private readonly drawerHofList: HTMLElement | null;
  private readonly boardEl: HTMLElement | null;
  private readonly statsEl: HTMLElement | null;
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
  private readonly centerAlertEl: HTMLElement | null;
  private readonly caTextEl: HTMLElement | null;
  private centerAlertTimer: any = null;

  private readonly teamRoomBadgeEl: HTMLElement | null;
  private readonly trbCodeEl: HTMLElement | null;
  private readonly trbCopyBtnEl: HTMLButtonElement | null;
  private readonly drawerTeamRoomBadgeEl: HTMLElement | null;
  private readonly drawerTrbCodeEl: HTMLElement | null;
  private readonly drawerTrbCopyBtnEl: HTMLButtonElement | null;
  private readonly podiumBadgeEl: HTMLElement | null;
  private readonly ptIconEl: HTMLElement | null;
  private readonly ptTxtEl: HTMLElement | null;
  private readonly fpsVal: HTMLElement | null;
  private readonly pingVal: HTMLElement | null;
  private readonly fpsDot: HTMLElement | null;
  private readonly pingDot: HTMLElement | null;
  private readonly coloVal: HTMLElement | null;
  private readonly exitConfirmModal: HTMLElement | null;
  private readonly btnCancelExit: HTMLElement | null;
  private readonly btnConfirmExit: HTMLElement | null;

  public onPickRule?: (id: string) => void;
  public onToggleMute?: () => void;
  public onSelectMode?: (mode: 'ffa' | 'team' | 'friend') => void;
  public onSelectTeam?: (team: number) => void;
  public onChangeLanguage?: (lang: Lang) => void;
  public onReconnect?: () => void;
  public selectedMode: 'ffa' | 'team' | 'friend' = 'ffa';
  public selectedTeam: number = 0;
  public isSpectating = false;
  public isPlayerAlive = false;
  private activeSpecies: Species = 'pig';
  private activeSkin = 0;

  private readonly startTeamPickEl: HTMLElement | null;
  private readonly deathTeamPickEl: HTMLElement | null;
  private readonly startCount0El: HTMLElement | null;
  private readonly startCount1El: HTMLElement | null;
  private readonly deathCount0El: HTMLElement | null;
  private readonly deathCount1El: HTMLElement | null;
  private readonly tbCount0El: HTMLElement | null;
  private readonly tbCount1El: HTMLElement | null;

  private readonly spectateBtn: HTMLElement | null;
  private readonly spectateBarEl: HTMLElement | null;
  private readonly spectateNameEl: HTMLElement | null;
  private readonly specNextBtn: HTMLElement | null;
  private readonly specPlayBtn: HTMLElement | null;

  private readonly teamWinModalEl: HTMLElement | null;
  private readonly twTitleEl: HTMLElement | null;
  private readonly twScore0El: HTMLElement | null;
  private readonly twScore1El: HTMLElement | null;
  private readonly twCount0El: HTMLElement | null;
  private readonly twCount1El: HTMLElement | null;
  private readonly twContinueBtn: HTMLButtonElement | null;
  private readonly twCountdownEl: HTMLElement | null;
  private readonly twMvpBoxEl: HTMLElement | null;
  private readonly twMvpNameEl: HTMLElement | null;
  private readonly twMvpStatsEl: HTMLElement | null;
  private readonly deathCountdownEl: HTMLElement | null;
  public lastCount0 = 0;
  public lastCount1 = 0;

  public onStartSpectating?: () => void;
  public onNextSpectating?: () => void;
  public onSelectSpectateTarget?: (id: number) => void;
  public onStopSpectating?: () => void;
  public onExitLobby?: () => void;
  private deathCountdownTimer: any = null;
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
    dog: 0,
    elephant: 0,
    monkey: 0,
    gorilla: 0,
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
  private readonly btnMatchTime: HTMLButtonElement | null;
  private readonly matchTimeLabel: HTMLElement | null;
  private readonly matchTimeMenu: HTMLElement | null;
  private readonly customTimeInput: HTMLInputElement | null;
  private readonly btnApplyCustomTime: HTMLButtonElement | null;
  private matchDuration = 0;
  public onSetMatchDuration?: (dur: number) => void;

  private readonly friendResultModalEl: HTMLElement | null;
  private readonly friendExitBtn: HTMLButtonElement | null;
  private readonly frTitleEl: HTMLElement | null;
  private readonly frSubEl: HTMLElement | null;
  private readonly frListEl: HTMLElement | null;
  private readonly friendContinueBtn: HTMLButtonElement | null;
  private readonly friendSpectateBtn: HTMLButtonElement | null;
  private readonly friendChangeBtn: HTMLButtonElement | null;
  private readonly frCountdownEl: HTMLElement | null;
  private frCountdownTimer: any = null;

  private previewRenderer: AnimalPreviewRenderer | null = null;
  private readonly spPreviewTitle: HTMLElement | null;
  private readonly spPreviewSkinName: HTMLElement | null;
  private readonly spPreviewBadge: HTMLElement | null;
  private readonly spSkinPalette: HTMLElement | null;
  private readonly spSkinPrev: HTMLElement | null;
  private readonly spSkinNext: HTMLElement | null;
  private readonly spNavPrev: HTMLButtonElement | null;
  private readonly spNavNext: HTMLButtonElement | null;
  private readonly langToggle: HTMLButtonElement | null;
  private readonly disclaimerBtn: HTMLButtonElement | null;
  private readonly disclaimerModal: HTMLElement | null;
  private readonly btnAgreeDisclaimer: HTMLButtonElement | null;
  private readonly nameEditBtn: HTMLButtonElement | null;
  private readonly ffaPreviewBox: HTMLElement | null;
  private readonly arenaPickerEl: HTMLElement | null;
  private isRandomSelected = false;
  private carouselIndex = 0;
  private updateSpeciesUI?: () => void;

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
    this.drawerLbList = document.getElementById('drawerLbList');
    this.hofList = document.getElementById('hofList');
    this.drawerHofList = document.getElementById('drawerHofList');
    this.boardEl = document.getElementById('board');
    this.statsEl = document.getElementById('stats');
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
    this.centerAlertEl = document.getElementById('centerAlert');
    this.caTextEl = document.getElementById('caText');
    if (this.centerAlertEl) {
      this.centerAlertEl.addEventListener('pointerdown', (e) => {
        const caContent = this.centerAlertEl?.querySelector('.ca-content');
        if (caContent && !caContent.contains(e.target as Node)) {
          this.hideCenterAlert();
        }
      });
    }
    window.addEventListener('pointerdown', (e) => {
      if (this.centerAlertEl && !this.centerAlertEl.hidden) {
        const caContent = this.centerAlertEl.querySelector('.ca-content');
        if (caContent && !caContent.contains(e.target as Node)) {
          this.hideCenterAlert();
        }
      }
    }, true);
    this.teamRoomBadgeEl = document.getElementById('teamRoomBadge');
    this.trbCodeEl = document.getElementById('trbCode');
    this.trbCopyBtnEl = document.getElementById('trbCopyBtn') as HTMLButtonElement | null;
    this.drawerTeamRoomBadgeEl = document.getElementById('drawerTeamRoomBadge');
    this.drawerTrbCodeEl = document.getElementById('drawerTrbCode');
    this.drawerTrbCopyBtnEl = document.getElementById('drawerTrbCopyBtn') as HTMLButtonElement | null;
    this.podiumBadgeEl = document.getElementById('podiumTimerBadge');
    this.ptIconEl = document.getElementById('ptIcon');
    this.ptTxtEl = document.getElementById('ptTxt');
    this.fpsVal = document.getElementById('fpsVal');
    this.pingVal = document.getElementById('pingVal');
    this.fpsDot = document.getElementById('fpsDot');
    this.pingDot = document.getElementById('pingDot');
    this.coloVal = document.getElementById('coloVal');
    this.exitConfirmModal = document.getElementById('exitConfirmModal');
    this.btnCancelExit = document.getElementById('btnCancelExit');
    this.btnConfirmExit = document.getElementById('btnConfirmExit');

    const netPerfEl = document.getElementById('netPerf');
    if (netPerfEl) {
      netPerfEl.addEventListener('click', () => {
        this.onReconnect?.();
      });
    }

    this.friendPanel = document.getElementById('friendPanel');
    this.btnCreateRoom = document.getElementById('btnCreateRoom');
    this.createdRoomBox = document.getElementById('createdRoomBox');
    this.createdRoomCode = document.getElementById('createdRoomCode');
    this.btnCopyCode = document.getElementById('btnCopyCode');
    this.btnCopyLink = document.getElementById('btnCopyLink');
    this.btnMatchTime = document.getElementById('btnMatchTime') as HTMLButtonElement | null;
    this.matchTimeLabel = document.getElementById('matchTimeLabel');
    this.matchTimeMenu = document.getElementById('matchTimeMenu');
    this.joinRoomCode = document.getElementById('joinRoomCode') as HTMLInputElement | null;
    this.btnApplyCode = document.getElementById('btnApplyCode');
    this.roomStatusNotice = document.getElementById('roomStatusNotice');

    this.spPreviewTitle = document.getElementById('spPreviewTitle');
    this.spPreviewSkinName = document.getElementById('spPreviewSkinName');
    this.spPreviewBadge = document.getElementById('spPreviewBadge');
    this.spSkinPalette = document.getElementById('spSkinPalette');
    this.spSkinPrev = document.getElementById('spSkinPrev');
    this.spSkinNext = document.getElementById('spSkinNext');
    this.spNavPrev = document.getElementById('spNavPrev') as HTMLButtonElement | null;
    this.spNavNext = document.getElementById('spNavNext') as HTMLButtonElement | null;
    this.langToggle = document.getElementById('langToggle') as HTMLButtonElement | null;
    this.disclaimerBtn = document.getElementById('disclaimerBtn') as HTMLButtonElement | null;
    this.disclaimerModal = document.getElementById('disclaimerModal');
    this.btnAgreeDisclaimer = document.getElementById('btnAgreeDisclaimer') as HTMLButtonElement | null;
    this.nameEditBtn = document.getElementById('nameEditBtn') as HTMLButtonElement | null;
    this.ffaPreviewBox = document.getElementById('ffaPreviewBox');
    this.arenaPickerEl = document.getElementById('arenaPicker');

    const previewCanvas = document.getElementById('spPreviewCanvas') as HTMLCanvasElement | null;
    if (previewCanvas) {
      this.previewRenderer = new AnimalPreviewRenderer(previewCanvas);
      this.previewRenderer.start();
    }

    this.startTeamPickEl = document.getElementById('startTeamPick');
    this.deathTeamPickEl = document.getElementById('deathTeamPick');
    this.startCount0El = document.getElementById('startCount0');
    this.startCount1El = document.getElementById('startCount1');
    this.deathCount0El = document.getElementById('deathCount0');
    this.deathCount1El = document.getElementById('deathCount1');
    this.tbCount0El = document.getElementById('tbCount0');
    this.tbCount1El = document.getElementById('tbCount1');

    this.spectateBtn = document.getElementById('spectateBtn');
    this.spectateBarEl = document.getElementById('spectateBar');
    this.spectateNameEl = document.getElementById('spectateName');
    this.specNextBtn = document.getElementById('specNextBtn');
    this.specPlayBtn = document.getElementById('specPlayBtn');

    this.teamWinModalEl = document.getElementById('teamWinModal');
    this.twTitleEl = document.getElementById('twTitle');
    this.twScore0El = document.getElementById('twScore0');
    this.twScore1El = document.getElementById('twScore1');
    this.twCount0El = document.getElementById('twCount0');
    this.twCount1El = document.getElementById('twCount1');
    this.twContinueBtn = document.getElementById('twContinueBtn') as HTMLButtonElement | null;
    this.twCountdownEl = document.getElementById('twCountdown');
    this.twMvpBoxEl = document.getElementById('twMvpBox');
    this.twMvpNameEl = document.getElementById('twMvpName');
    this.twMvpStatsEl = document.getElementById('twMvpStats');
    this.deathCountdownEl = document.getElementById('deathCountdown');

    this.customTimeInput = document.getElementById('customTimeInput') as HTMLInputElement | null;
    this.btnApplyCustomTime = document.getElementById('btnApplyCustomTime') as HTMLButtonElement | null;

    this.friendResultModalEl = document.getElementById('friendResultModal');
    this.friendExitBtn = document.getElementById('friendExitBtn') as HTMLButtonElement | null;
    this.frTitleEl = document.getElementById('frTitle');
    this.frSubEl = document.getElementById('frSub');
    this.frListEl = document.getElementById('frList');
    this.friendContinueBtn = document.getElementById('friendContinueBtn') as HTMLButtonElement | null;
    this.friendSpectateBtn = document.getElementById('friendSpectateBtn') as HTMLButtonElement | null;
    this.friendChangeBtn = document.getElementById('friendChangeBtn') as HTMLButtonElement | null;
    this.frCountdownEl = document.getElementById('frCountdown');

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
      dog: [0xd9822b, 0x48505c, 0xc47b38, 0x242228],
      elephant: [0x828892, 0xf2ede4, 0x6d5e54, 0x607d8b],
      monkey: [0x6e472b, 0x362b28, 0xd4a373, 0x934b28],
      gorilla: [0x242528, 0x332822, 0x18191c, 0x4a4d52],
    };

    SPECIES.forEach((sp) => {
      const saved = localStorage.getItem(`fb_skin_${sp}`);
      if (saved !== null) {
        const val = parseInt(saved, 10);
        if (!isNaN(val)) this.mySkins[sp] = ((val % 4) + 4) % 4;
      }
    });

    window.addEventListener('resize', () => this.updateCarousel());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.updateCarousel(), 80);
      setTimeout(() => this.updateCarousel(), 250);
    });

    const updateAllButtons = () => {
      if (this.isRandomSelected) {
        this.speciesContainer.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('on', b.dataset.species === 'random');
        });

        if (this.speciesHint) this.speciesHint.textContent = t('randomHint');
        if (this.spPreviewTitle) this.spPreviewTitle.textContent = t('randomTitle');
        if (this.spPreviewSkinName) this.spPreviewSkinName.textContent = t('randomSkin');
        if (this.spPreviewBadge) this.spPreviewBadge.textContent = '?';
        if (this.previewRenderer) this.previewRenderer.setRandom();
        if (this.spSkinPalette) this.spSkinPalette.innerHTML = '';
        return;
      }

      const activeSkin = this.mySkins[this.selectedSpecies] ?? 0;

      // 1. Update 6 species buttons
      this.speciesContainer.querySelectorAll('button').forEach((b) => {
        const sp = b.dataset.species as Species;
        if (!sp || (sp as string) === 'random') {
          b.classList.remove('on');
          return;
        }
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
        const team = this.selectedMode === 'team' ? this.selectedTeam : undefined;
        this.previewRenderer.setAnimal(this.selectedSpecies, activeSkin, team);
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
            this.isRandomSelected = false;
            this.mySkins[this.selectedSpecies] = idx;
            localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(idx));
            updateAllButtons();
          });
          this.spSkinPalette!.appendChild(sw);
        });
      }
    };

    this.updateSpeciesUI = updateAllButtons;

    // Build the 6 species buttons
    this.speciesContainer.innerHTML = '';
    SELECTABLE_SPECIES.forEach((sp) => {
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
        this.isRandomSelected = false;
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

    // 7th item: Random '?' button placed at the end of the animal track
    const rndBtn = document.createElement('button');
    rndBtn.type = 'button';
    rndBtn.id = 'spItemRandom';
    rndBtn.className = 'sp-btn-item sp-btn-random';
    rndBtn.dataset.species = 'random';
    rndBtn.title = t('randomTitle');
    rndBtn.innerHTML = `<span class="sp-random-mark">?</span>`;
    rndBtn.addEventListener('click', () => {
      this.isRandomSelected = true;
      updateAllButtons();
    });
    this.speciesContainer.appendChild(rndBtn);

    // Wire up navigation arrows for skin switching
    if (this.spSkinPrev) {
      this.spSkinPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isRandomSelected) return;
        const cur = this.mySkins[this.selectedSpecies] ?? 0;
        this.mySkins[this.selectedSpecies] = (cur - 1 + 4) % 4;
        localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(this.mySkins[this.selectedSpecies]));
        updateAllButtons();
      });
    }
    if (this.spSkinNext) {
      this.spSkinNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isRandomSelected) return;
        const cur = this.mySkins[this.selectedSpecies] ?? 0;
        this.mySkins[this.selectedSpecies] = (cur + 1) % 4;
        localStorage.setItem(`fb_skin_${this.selectedSpecies}`, String(this.mySkins[this.selectedSpecies]));
        updateAllButtons();
      });
    }

    // Carousel navigation with loopable cyclic wrap-around
    if (this.spNavPrev) {
      this.spNavPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        const maxIndex = this.getMaxCarouselIndex();
        if (this.carouselIndex > 0) {
          this.carouselIndex--;
        } else {
          // Loop around to end (where Random '?' is)
          this.carouselIndex = maxIndex;
        }
        this.updateCarousel();
      });
    }
    if (this.spNavNext) {
      this.spNavNext.addEventListener('click', (e) => {
        e.stopPropagation();
        const maxIndex = this.getMaxCarouselIndex();
        if (this.carouselIndex < maxIndex) {
          this.carouselIndex++;
        } else {
          // Loop around to start (Pig)
          this.carouselIndex = 0;
        }
        this.updateCarousel();
      });
    }

    // Touch swipe gesture support on carousel viewport for iPhone / iPad
    const carouselViewport = this.speciesContainer.parentElement;
    if (carouselViewport) {
      let touchStartX = 0;
      let touchStartY = 0;
      carouselViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      carouselViewport.addEventListener('touchend', (e) => {
        if (e.changedTouches.length > 0) {
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy)) {
            const maxIndex = this.getMaxCarouselIndex();
            if (dx < 0) {
              if (this.carouselIndex < maxIndex) this.carouselIndex++;
              else this.carouselIndex = 0;
            } else {
              if (this.carouselIndex > 0) this.carouselIndex--;
              else this.carouselIndex = maxIndex;
            }
            this.updateCarousel();
          }
        }
      }, { passive: true });
    }

    // ResizeObserver for rock-solid reactive carousel layout updates
    if (typeof ResizeObserver !== 'undefined' && carouselViewport) {
      const ro = new ResizeObserver(() => {
        if (!this.startScreen.hidden) {
          this.updateCarousel();
        }
      });
      ro.observe(carouselViewport);
    }

    // Scroll carousel so selected species is initially visible
    const selIdx = SPECIES.indexOf(this.selectedSpecies);
    if (selIdx >= 0) {
      if (selIdx < this.carouselIndex) this.carouselIndex = selIdx;
      else if (selIdx >= this.carouselIndex + 5) this.carouselIndex = selIdx - 4;
    }
    this.updateCarousel();
    requestAnimationFrame(() => this.updateCarousel());

    updateAllButtons();

    // Name input & pencil
    this.nameInput.placeholder = t('namePh');
    const savedName = localStorage.getItem('fb_name') || '';
    if (savedName === 'Nông dân' || savedName === 'Farmer' || savedName === "mgm'y ngôk ngêk") {
      this.nameInput.value = '';
      try { localStorage.removeItem('fb_name'); } catch (_) {}
    } else {
      this.nameInput.value = savedName;
    }

    if (this.nameEditBtn) {
      this.nameEditBtn.addEventListener('click', () => {
        this.nameInput.focus();
        this.nameInput.select();
      });
    }

    // Language switcher
    const curLang = getLanguage();
    if (this.langToggle) {
      this.langToggle.textContent = curLang === 'vi' ? 'VI' : 'EN';
      this.langToggle.title = curLang === 'vi' ? 'Ngôn ngữ: Tiếng Việt' : 'Language: English';

      this.langToggle.addEventListener('click', () => {
        const nextLang = toggleLanguage();
        this.langToggle!.textContent = nextLang === 'vi' ? 'VI' : 'EN';
        this.langToggle!.title = nextLang === 'vi' ? 'Ngôn ngữ: Tiếng Việt' : 'Language: English';
        this.nameInput.placeholder = t('namePh');
        if (this.disclaimerBtn) {
          this.disclaimerBtn.title = t('disclaimerBtnTitle');
        }
        this.updateMatchTimeUI();
        updateAllButtons();
        this.updateTeamCounts(this.lastCount0, this.lastCount1);
        this.onChangeLanguage?.(nextLang);
        this.showToast(nextLang === 'vi' ? 'Đã chuyển sang Tiếng Việt' : 'Switched to English', 1000);
      });
    }

    // Disclaimer modal
    if (this.disclaimerBtn) {
      this.disclaimerBtn.title = t('disclaimerBtnTitle');
      this.disclaimerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDisclaimer();
      });
    }

    if (this.btnAgreeDisclaimer) {
      this.btnAgreeDisclaimer.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideDisclaimer();
      });
    }

    if (this.disclaimerModal) {
      this.disclaimerModal.addEventListener('pointerdown', (e) => {
        const card = this.disclaimerModal?.querySelector('.center-modal-card');
        if (card && !card.contains(e.target as Node)) {
          this.hideDisclaimer();
        }
      });
    }

    // Arena Theme Picker
    if (this.arenaPickerEl) {
      const curTheme = getArenaTheme();
      const arenaBtns = this.arenaPickerEl.querySelectorAll<HTMLButtonElement>('.btn-arena');
      const ffaImg = document.getElementById('ffaPreviewImg') as HTMLImageElement | null;
      const updateSnapshot = (theme: ArenaTheme) => {
        if (ffaImg) {
          ffaImg.src = theme === 'women_day' ? '/arena-womenday.jpg' : theme === 'halloween' ? '/arena-halloween.jpg' : '/arena-classic.jpg';
        }
      };
      updateSnapshot(curTheme);

      arenaBtns.forEach((btn) => {
        const arena = btn.getAttribute('data-arena') as ArenaTheme;
        btn.classList.toggle('on', arena === curTheme);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.classList.contains('on')) return;
          arenaBtns.forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');
          setArenaTheme(arena);
          this.previewRenderer?.updateTheme(arena);
          updateSnapshot(arena);
        });
      });
    }

    // Dynamic Combat Guide positioning:
    // On PC (desktop) & portrait: move #howBox to bottom of left column (.start-col-left)
    // On mobile landscape: keep #howBox in right column below play button
    const repositionHowBox = () => {
      const isLandscapeMobile = window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
      const leftCol = document.querySelector('.start-col-left');
      const rightCol = document.querySelector('.start-col-right');
      const howBox = document.getElementById('howBox');
      const bestLine = document.getElementById('bestLine');

      if (!howBox || !leftCol || !rightCol) return;

      if (isLandscapeMobile) {
        if (howBox.parentElement !== rightCol) {
          if (bestLine && bestLine.nextSibling) {
            rightCol.insertBefore(howBox, bestLine.nextSibling);
          } else {
            rightCol.appendChild(howBox);
          }
        }
      } else {
        if (howBox.parentElement !== leftCol) {
          leftCol.appendChild(howBox);
        }
      }
    };
    repositionHowBox();
    window.addEventListener('resize', repositionHowBox);
  }

  private initEvents(): void {
    const play = () => {
      const inputName = this.nameInput.value.trim();
      const name = inputName || t('defaultName');
      if (inputName) {
        try { localStorage.setItem('fb_name', inputName); } catch (_) {}
      } else {
        try { localStorage.removeItem('fb_name'); } catch (_) {}
      }
      let chosenSpecies = this.selectedSpecies;
      let chosenSkin = this.mySkins[this.selectedSpecies] ?? 0;
      if (this.isRandomSelected) {
        const roll = Math.random();
        if (roll < 0.10) {
          chosenSpecies = 'elephant';
        } else if (roll < 0.20) {
          chosenSpecies = 'monkey';
        } else if (roll < 0.45) {
          chosenSpecies = 'dog';
        } else {
          const normalSpecies: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig'];
          chosenSpecies = normalSpecies[Math.floor(Math.random() * normalSpecies.length)];
        }
        chosenSkin = Math.floor(Math.random() * 4);
      }
      this.activeSpecies = chosenSpecies;
      this.activeSkin = chosenSkin;
      if (this.selectedMode === 'friend') {
        const inputVal = (this.joinRoomCode?.value || '').trim().toUpperCase();
        if (inputVal.length >= 3) {
          this.currentFriendCode = inputVal;
          if (this.createdRoomCode) this.createdRoomCode.textContent = inputVal;
          if (this.createdRoomBox) this.createdRoomBox.hidden = false;
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
      this.onStartPlay(name, chosenSpecies, this.selectedMode, chosenSkin, this.currentFriendCode);
    };

    let playCountdownTimer: any = null;
    let playCountdownSec = 3;

    const stopPlayCountdown = () => {
      if (playCountdownTimer) {
        clearInterval(playCountdownTimer);
        playCountdownTimer = null;
      }
      if (this.playBtn) {
        this.playBtn.disabled = false;
        this.playBtn.innerHTML = t('play');
      }
    };

    const handlePlayClick = () => {
      if (this.selectedMode === 'team') {
        const myTeam = this.selectedTeam;
        const otherTeam = myTeam === 0 ? 1 : 0;
        const otherCount = otherTeam === 0 ? this.lastCount0 : this.lastCount1;
        if (otherCount < 1) {
          this.showCenterAlert(t('teamNeedPlayers'));
          return;
        }

        if (playCountdownTimer) return;
        playCountdownSec = 3;
        this.playBtn.disabled = true;
        this.playBtn.innerHTML = `${t('play')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${playCountdownSec}s</span>)`;

        playCountdownTimer = setInterval(() => {
          playCountdownSec--;
          if (this.playBtn) {
            this.playBtn.innerHTML = `${t('play')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${playCountdownSec}s</span>)`;
          }
          if (playCountdownSec <= 0) {
            stopPlayCountdown();
            play();
          }
        }, 1000);
        return;
      }

      play();
    };

    this.playBtn.addEventListener('click', handlePlayClick);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePlayClick();
    });

    let deathCountdownSec = 3;

    const stopDeathCountdown = () => {
      if (this.deathCountdownTimer) {
        clearInterval(this.deathCountdownTimer);
        this.deathCountdownTimer = null;
      }
      if (this.deathCountdownEl) this.deathCountdownEl.hidden = true;
      if (this.againBtn) {
        this.againBtn.disabled = false;
        this.againBtn.innerHTML = t('again');
        this.againBtn.style.opacity = '1';
      }
    };

    const startDeathCountdown = () => {
      if (this.deathCountdownTimer) return;
      if (this.selectedMode === 'team') {
        const myTeam = this.selectedTeam;
        const otherTeam = myTeam === 0 ? 1 : 0;
        const otherCount = otherTeam === 0 ? this.lastCount0 : this.lastCount1;
        if (otherCount < 1) {
          this.showCenterAlert(t('teamNeedPlayers'));
          return;
        }
      }

      deathCountdownSec = 3;
      if (this.deathCountdownEl) this.deathCountdownEl.hidden = true;
      this.againBtn.disabled = true;
      this.againBtn.innerHTML = `${t('again')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${deathCountdownSec}s</span>)`;

      this.deathCountdownTimer = setInterval(() => {
        deathCountdownSec--;
        if (this.againBtn) {
          this.againBtn.innerHTML = `${t('again')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${deathCountdownSec}s</span>)`;
        }
        if (deathCountdownSec <= 0) {
          stopDeathCountdown();
          this.deathScreen.hidden = true;
          play();
        }
      }, 1000);
    };

    this.againBtn.addEventListener('click', () => {
      if (this.selectedMode === 'team') {
        startDeathCountdown();
      } else {
        this.deathScreen.hidden = true;
        play();
      }
    });

    this.changeBtn.addEventListener('click', () => {
      stopDeathCountdown();
      this.returnToLobby();
    });

    const btnExitLobby = document.getElementById('btnExitLobby');
    const drawerExitBtn = document.getElementById('drawerExitBtn');

    const showExitPrompt = () => {
      const drawer = document.getElementById('gameDrawerModal');
      if (drawer) drawer.hidden = true;
      if (this.exitConfirmModal) {
        this.exitConfirmModal.hidden = false;
      } else {
        this.onExitLobby?.();
      }
    };

    const hideExitPrompt = () => {
      if (this.exitConfirmModal) {
        this.exitConfirmModal.hidden = true;
      }
    };

    if (btnExitLobby) {
      btnExitLobby.addEventListener('click', showExitPrompt);
    }
    if (drawerExitBtn) {
      drawerExitBtn.addEventListener('click', showExitPrompt);
    }
    const deathExitBtn = document.getElementById('deathExitBtn');
    if (deathExitBtn) {
      deathExitBtn.addEventListener('click', showExitPrompt);
    }
    if (this.friendExitBtn) {
      this.friendExitBtn.addEventListener('click', showExitPrompt);
    }
    if (this.btnCancelExit) {
      this.btnCancelExit.addEventListener('click', hideExitPrompt);
    }
    if (this.btnConfirmExit) {
      this.btnConfirmExit.addEventListener('click', () => {
        hideExitPrompt();
        this.onExitLobby?.();
      });
    }
    if (this.exitConfirmModal) {
      this.exitConfirmModal.addEventListener('pointerdown', (e) => {
        const card = this.exitConfirmModal?.querySelector('.center-modal-card');
        if (card && !card.contains(e.target as Node)) {
          hideExitPrompt();
        }
      });
    }

    if (this.spectateBtn) {
      this.spectateBtn.addEventListener('click', () => {
        stopDeathCountdown();
        this.deathScreen.hidden = true;
        document.body.classList.remove('menu');
        document.body.classList.add('spectating');
        this.hudEl.hidden = false;
        if (this.spectateBarEl) this.spectateBarEl.hidden = false;
        this.isSpectating = true;
        this.updateSpecPlayBtn();
        this.onStartSpectating?.();
      });
    }

    if (this.friendSpectateBtn) {
      this.friendSpectateBtn.addEventListener('click', () => {
        this.stopFrCountdown();
        if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
        document.body.classList.remove('menu');
        document.body.classList.add('spectating');
        this.hudEl.hidden = false;
        if (this.spectateBarEl) this.spectateBarEl.hidden = false;
        this.isSpectating = true;
        this.updateSpecPlayBtn();
        this.onStartSpectating?.();
      });
    }

    if (this.friendChangeBtn) {
      this.friendChangeBtn.addEventListener('click', () => {
        this.stopFrCountdown();
        if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
        this.returnToLobby();
      });
    }

    if (this.friendContinueBtn) {
      const continueBtn = this.friendContinueBtn;
      continueBtn.addEventListener('click', () => {
        let frCountdownSec = 3;
        continueBtn.disabled = true;
        continueBtn.innerHTML = `${t('continue')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${frCountdownSec}s</span>)`;

        this.frCountdownTimer = setInterval(() => {
          frCountdownSec--;
          continueBtn.innerHTML = `${t('continue')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${frCountdownSec}s</span>)`;
          if (frCountdownSec <= 0) {
            this.stopFrCountdown();
            continueBtn.disabled = false;
            continueBtn.innerHTML = t('continue');
            if (this.frCountdownEl) this.frCountdownEl.hidden = true;
            if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
            play();
          }
        }, 1000);
      });
    }

    if (this.specNextBtn) {
      this.specNextBtn.addEventListener('click', () => {
        this.onNextSpectating?.();
      });
    }

    if (this.specPlayBtn) {
      this.specPlayBtn.addEventListener('click', () => {
        this.isSpectating = false;
        document.body.classList.remove('spectating');
        if (this.spectateBarEl) this.spectateBarEl.hidden = true;
        this.onStopSpectating?.();
        if (this.isPlayerAlive) {
          this.deathScreen.hidden = true;
          this.hudEl.hidden = false;
          return;
        }
        if (this.selectedMode === 'team') {
          this.deathScreen.hidden = false;
          this.hudEl.hidden = true;
          document.body.classList.add('menu');
          startDeathCountdown();
        } else {
          this.deathScreen.hidden = true;
          play();
        }
      });
    }

    let twCountdownTimer: any = null;
    let twCountdownSec = 3;

    if (this.twContinueBtn) {
      const continueBtn = this.twContinueBtn;
      continueBtn.addEventListener('click', () => {
        if (this.selectedMode === 'team') {
          const myTeam = this.selectedTeam;
          const otherTeam = myTeam === 0 ? 1 : 0;
          const otherCount = otherTeam === 0 ? this.lastCount0 : this.lastCount1;
          if (otherCount < 1) {
            this.showCenterAlert(t('teamNeedPlayers'));
            return;
          }
        }

        twCountdownSec = 3;
        continueBtn.disabled = true;
        continueBtn.innerHTML = `${t('continue')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${twCountdownSec}s</span>)`;

        twCountdownTimer = setInterval(() => {
          twCountdownSec--;
          continueBtn.innerHTML = `${t('continue')} (<span style="color: #ffd700; font-weight: 800; font-size: 1.15em;">${twCountdownSec}s</span>)`;
          if (twCountdownSec <= 0) {
            clearInterval(twCountdownTimer);
            twCountdownTimer = null;
            continueBtn.disabled = false;
            continueBtn.innerHTML = t('continue');
            if (this.twCountdownEl) this.twCountdownEl.hidden = true;
            if (this.teamWinModalEl) this.teamWinModalEl.hidden = true;
            play();
          }
        }, 1000);
      });
    }

    document.querySelectorAll('.btn-team').forEach((btn) => {
      btn.addEventListener('click', () => {
        const team = parseInt((btn as HTMLElement).dataset.team ?? '0', 10);
        this.setSelectedTeam(team);
      });
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
          this.roomStatusNotice.textContent = t('createdRoomMsg', { res });
          this.roomStatusNotice.style.color = '#52c41a';
        }
        this.showToast(t('createdRoomToast', { res }));
      });
    }

    if (this.btnCopyCode) {
      this.btnCopyCode.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = this.currentFriendCode || this.createdRoomCode?.textContent?.trim() || this.joinRoomCode?.value.trim().toUpperCase() || '';
        if (code && code !== '------') {
          copyTextToClipboard(code);
          this.showToast(t('copiedRoomCodeToast', { code }));
        } else {
          this.showToast(getLanguage() === 'en' ? 'No room code to copy!' : 'Chưa có mã phòng để sao chép!');
        }
      });
    }

    if (this.btnCopyLink) {
      this.btnCopyLink.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = this.currentFriendCode || this.createdRoomCode?.textContent?.trim() || this.joinRoomCode?.value.trim().toUpperCase() || '';
        if (code && code !== '------') {
          const timeParam = this.matchDuration > 0 ? `&time=${this.matchDuration}` : '';
          const url = `${window.location.origin}${window.location.pathname}?room=priv-${code}${timeParam}`;
          copyTextToClipboard(url);
          this.showToast(t('copiedRoomLink'));
        } else {
          this.showToast(getLanguage() === 'en' ? 'No room code to create link!' : 'Chưa có mã phòng để tạo link!');
        }
      });
    }

    if (this.createdRoomCode) {
      this.createdRoomCode.style.cursor = 'pointer';
      this.createdRoomCode.title = getLanguage() === 'en' ? 'Click to copy room code' : 'Bấm để sao chép mã phòng';
      this.createdRoomCode.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = this.currentFriendCode || this.createdRoomCode?.textContent?.trim() || '';
        if (code && code !== '------') {
          copyTextToClipboard(code);
          this.showToast(`Đã sao chép mã phòng: ${code} 📋`);
        }
      });
    }

    if (this.btnMatchTime && this.matchTimeMenu) {
      this.updateMatchTimeUI();

      this.btnMatchTime.addEventListener('click', (e) => {
        e.stopPropagation();
        this.matchTimeMenu!.hidden = !this.matchTimeMenu!.hidden;
      });

      window.addEventListener('pointerdown', (e) => {
        if (!this.matchTimeMenu?.hidden) {
          const wrap = this.btnMatchTime?.closest('.time-picker-wrap');
          if (wrap && !wrap.contains(e.target as Node)) {
            this.matchTimeMenu!.hidden = true;
          }
        }
      });

      this.matchTimeMenu.querySelectorAll<HTMLButtonElement>('.time-opt').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const dur = parseInt(opt.getAttribute('data-time') || '0', 10);
          this.setMatchDuration(dur);
          this.matchTimeMenu!.hidden = true;
          this.onSetMatchDuration?.(dur);
        });
      });

      const applyCustomMinutes = () => {
        if (!this.customTimeInput) return;
        const val = parseInt(this.customTimeInput.value.trim(), 10);
        const dur = isNaN(val) || val <= 0 ? 0 : Math.min(120, val) * 60;
        this.setMatchDuration(dur);
        if (this.matchTimeMenu) this.matchTimeMenu.hidden = true;
        this.onSetMatchDuration?.(dur);
      };

      if (this.btnApplyCustomTime) {
        this.btnApplyCustomTime.addEventListener('click', (e) => {
          e.stopPropagation();
          applyCustomMinutes();
        });
      }

      if (this.customTimeInput) {
        this.customTimeInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            applyCustomMinutes();
          }
        });
        this.customTimeInput.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
        });
      }
    }

    const applyRoomCode = (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (code.length >= 3) {
        this.currentFriendCode = code;
        if (this.createdRoomCode) this.createdRoomCode.textContent = code;
        if (this.createdRoomBox) this.createdRoomBox.hidden = false;
        if (this.joinRoomCode) this.joinRoomCode.value = code;
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
    };

    if (this.joinRoomCode) {
      this.joinRoomCode.addEventListener('input', () => {
        if (this.joinRoomCode) {
          this.joinRoomCode.value = this.joinRoomCode.value.toUpperCase();
        }
      });
      this.joinRoomCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          applyRoomCode(this.joinRoomCode?.value || '');
        }
      });
    }

    if (this.btnApplyCode) {
      this.btnApplyCode.addEventListener('click', () => {
        applyRoomCode(this.joinRoomCode?.value || '');
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
            if (this.startTeamPickEl) {
              this.startTeamPickEl.hidden = mode !== 'team';
            }
            if (this.ffaPreviewBox) {
              this.ffaPreviewBox.hidden = mode !== 'ffa';
            }
            document.body.classList.toggle('mode-team', mode === 'team');
            document.body.classList.toggle('mode-friend', mode === 'friend');
            this.setSelectedTeam(this.selectedTeam);
            const startScreen = document.getElementById('start');
            if (startScreen && startScreen.scrollTop > 20) {
              startScreen.scrollTo({ top: 0, behavior: 'smooth' });
            }
            this.onSelectMode?.(mode);
          }
        });
      });
    }

    if (this.ffaPreviewBox) {
      this.ffaPreviewBox.hidden = this.selectedMode !== 'ffa';
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
      if (this.ffaPreviewBox) this.ffaPreviewBox.hidden = true;
      document.body.classList.toggle('mode-team', false);
      document.body.classList.toggle('mode-friend', true);
      if (this.joinRoomCode) this.joinRoomCode.value = cleanCode;
      if (this.createdRoomCode) this.createdRoomCode.textContent = cleanCode;
      if (this.createdRoomBox) this.createdRoomBox.hidden = false;
      if (this.roomStatusNotice) {
        this.roomStatusNotice.textContent = `Phòng từ link mời: ${cleanCode}`;
        this.roomStatusNotice.style.color = '#52c41a';
      }
    }

    const timeParam = urlParams.get('time');
    if (timeParam) {
      const dur = parseInt(timeParam, 10);
      if (!isNaN(dur) && dur >= 0) {
        this.setMatchDuration(dur, false);
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.matchTimeMenu && !this.matchTimeMenu.hidden) {
          this.matchTimeMenu.hidden = true;
          return;
        }
        if (this.disclaimerModal && !this.disclaimerModal.hidden) {
          this.hideDisclaimer();
          return;
        }
        if (this.exitConfirmModal && !this.exitConfirmModal.hidden) {
          this.exitConfirmModal.hidden = true;
          return;
        }
        if (this.isSpectating && this.isPlayerAlive) {
          this.isSpectating = false;
          document.body.classList.remove('spectating');
          if (this.spectateBarEl) this.spectateBarEl.hidden = true;
          this.onStopSpectating?.();
          this.deathScreen.hidden = true;
          this.hudEl.hidden = false;
          return;
        }
        if (this.friendResultModalEl && !this.friendResultModalEl.hidden) {
          showExitPrompt();
          return;
        }
      }
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

    const handleLbSelect = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const li = target?.closest('li') as HTMLElement | null;
      if (!li) return;
      const idStr = li.dataset.playerId || li.getAttribute('data-player-id');
      if (idStr) {
        const id = parseInt(idStr, 10);
        if (!isNaN(id)) {
          e.preventDefault();
          e.stopPropagation();
          this.onSelectSpectateTarget?.(id);
        }
      }
    };

    if (this.lbList) {
      this.lbList.addEventListener('pointerdown', handleLbSelect);
      this.lbList.addEventListener('click', handleLbSelect);
    }
    if (this.drawerLbList) {
      this.drawerLbList.addEventListener('pointerdown', handleLbSelect);
      this.drawerLbList.addEventListener('click', handleLbSelect);
    }
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

  public updateTeamBar(t0: number, t1: number, clockSec: number, count0?: number, count1?: number): void {
    if (this.teamBarEl) {
      this.teamBarEl.hidden = false;
      if (this.selectedMode === 'friend') {
        this.teamBarEl.classList.add('friend-timer-only');
        document.body.classList.remove('mode-team');
      } else {
        this.teamBarEl.classList.remove('friend-timer-only');
        document.body.classList.add('mode-team');
      }
    }
    if (this.ts0El) this.ts0El.textContent = String(t0);
    if (this.ts1El) this.ts1El.textContent = String(t1);
    if (this.tClockEl) {
      this.tClockEl.textContent = (this.selectedMode === 'friend' ? '⏱️ ' : '') + this.fmtTime(clockSec);
    }
    if (count0 !== undefined && count1 !== undefined) {
      this.updateTeamCounts(count0, count1);
    }
  }

  public getMatchDuration(): number {
    return this.matchDuration;
  }

  public getMatchDurationText(dur: number): string {
    if (dur <= 0) return t('time_none');
    if (dur >= 60) {
      const m = Math.floor(dur / 60);
      const s = dur % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return `${dur}s`;
  }

  public setMatchDuration(dur: number, notify = true): void {
    const prev = this.matchDuration;
    this.matchDuration = Math.max(0, Math.floor(dur));
    this.updateMatchTimeUI();
    if (notify && prev !== this.matchDuration && this.matchDuration > 0) {
      this.showToast(t('matchTimeToast', { t: this.getMatchDurationText(this.matchDuration) }));
    }
  }

  public updateMatchTimeUI(): void {
    const txt = this.matchDuration > 0 ? this.getMatchDurationText(this.matchDuration) : '-';
    if (this.matchTimeLabel) {
      this.matchTimeLabel.textContent = txt;
    }
    if (this.btnMatchTime) {
      this.btnMatchTime.title = `${t('matchTimeTitle')}: ${txt}`;
    }
    if (this.matchTimeMenu) {
      const header = this.matchTimeMenu.querySelector('.time-picker-header');
      if (header) header.textContent = t('matchTimeHeader');
      this.matchTimeMenu.querySelectorAll<HTMLButtonElement>('.time-opt').forEach((opt) => {
        const d = parseInt(opt.getAttribute('data-time') || '0', 10);
        opt.classList.toggle('on', d === this.matchDuration);
        const tText = opt.querySelector('.t-text');
        if (tText) {
          const key = d === 0 ? 'time_none' : `time_${Math.floor(d / 60)}m`;
          tText.textContent = t(key as any);
        }
      });
      if (this.customTimeInput) {
        this.customTimeInput.placeholder = t('time_custom_ph');
        const isPreset = [0, 120, 300, 600].includes(this.matchDuration);
        if (!isPreset && this.matchDuration > 0) {
          this.customTimeInput.value = String(Math.floor(this.matchDuration / 60));
        } else if (this.matchDuration === 0) {
          this.customTimeInput.value = '';
        }
      }
      if (this.btnApplyCustomTime) {
        this.btnApplyCustomTime.textContent = t('time_set');
      }
    }
  }

  public setRoomTag(name: string, inviteUrl?: string): void {
    if (this.roomTagEl) {
      this.roomTagEl.hidden = false;
      this.roomTagEl.textContent = name;
      if (inviteUrl) {
        this.roomTagEl.style.cursor = 'pointer';
        this.roomTagEl.title = `Bấm để sao chép link phòng: ${inviteUrl}`;
        this.roomTagEl.onclick = (e) => {
          e.stopPropagation();
          copyTextToClipboard(inviteUrl);
          this.showToast(t('copiedRoomLink'));
        };
      } else {
        this.roomTagEl.style.cursor = 'default';
        this.roomTagEl.onclick = null;
      }
    }
  }

  public hideRoomTag(): void {
    if (this.roomTagEl) this.roomTagEl.hidden = true;
  }

  public setTeamRoomBadge(code: string, inviteUrl?: string): void {
    if (this.teamRoomBadgeEl && this.trbCodeEl) {
      this.teamRoomBadgeEl.hidden = false;
      this.trbCodeEl.textContent = code;
      this.trbCodeEl.style.cursor = 'pointer';
      this.trbCodeEl.title = getLanguage() === 'en' ? 'Click to copy code' : 'Bấm để sao chép mã phòng';
      this.trbCodeEl.onclick = (e) => {
        e.stopPropagation();
        copyTextToClipboard(code);
        this.showToast(t('copiedRoomCode'));
      };
    }
    if (this.drawerTeamRoomBadgeEl && this.drawerTrbCodeEl) {
      this.drawerTeamRoomBadgeEl.hidden = false;
      this.drawerTrbCodeEl.textContent = code;
      this.drawerTrbCodeEl.style.cursor = 'pointer';
      this.drawerTrbCodeEl.title = getLanguage() === 'en' ? 'Click to copy code' : 'Bấm để sao chép mã phòng';
      this.drawerTrbCodeEl.onclick = (e) => {
        e.stopPropagation();
        copyTextToClipboard(code);
        this.showToast(t('copiedRoomCode'));
      };
    }
    const onCopy = (e?: Event) => {
      e?.stopPropagation();
      const textToCopy = inviteUrl || code;
      copyTextToClipboard(textToCopy);
      this.showToast(inviteUrl ? t('copiedRoomLink') : t('copiedRoomCode'));
      if (this.trbCopyBtnEl) {
        this.trbCopyBtnEl.classList.add('copied');
        setTimeout(() => this.trbCopyBtnEl?.classList.remove('copied'), 1000);
      }
      if (this.drawerTrbCopyBtnEl) {
        this.drawerTrbCopyBtnEl.classList.add('copied');
        setTimeout(() => this.drawerTrbCopyBtnEl?.classList.remove('copied'), 1000);
      }
    };
    if (this.trbCopyBtnEl) {
      this.trbCopyBtnEl.onclick = onCopy;
    }
    if (this.drawerTrbCopyBtnEl) {
      this.drawerTrbCopyBtnEl.onclick = onCopy;
    }
  }

  public hideTeamRoomBadge(): void {
    if (this.teamRoomBadgeEl) this.teamRoomBadgeEl.hidden = true;
    if (this.drawerTeamRoomBadgeEl) this.drawerTeamRoomBadgeEl.hidden = true;
  }

  public setMuteState(mutedOrMode: boolean | AudioMode): void {
    const mode: AudioMode = typeof mutedOrMode === 'number' ? mutedOrMode : (mutedOrMode ? 2 : 0);
    if (this.muteBtn) {
      const ico = mode === 0 ? '🔊' : (mode === 1 ? '🔈' : '🔇');
      this.muteBtn.innerHTML = `<span class="ico">${ico}</span>`;
      this.muteBtn.title = mode === 0 ? t('audio_all') : (mode === 1 ? t('audio_sfx') : t('audio_mute'));
    }
  }

  public setBoardVisible(visible: boolean): void {
    if (this.boardEl) {
      this.boardEl.style.display = visible ? '' : 'none';
    }
  }

  public setStatsVisible(visible: boolean): void {
    if (this.statsEl) {
      this.statsEl.classList.toggle('hidden', !visible);
    }
  }

  public setLbVisible(visible: boolean): void {
    const lb = document.getElementById('lb');
    if (lb) {
      lb.classList.toggle('hidden-by-setting', !visible);
      lb.style.display = visible ? '' : 'none';
      lb.hidden = !visible;
    }
  }

  showDisclaimer(): void {
    if (this.disclaimerModal) this.disclaimerModal.hidden = false;
  }

  hideDisclaimer(): void {
    if (this.disclaimerModal) this.disclaimerModal.hidden = true;
  }

  getPlayerName(): string {
    const inputName = this.nameInput ? this.nameInput.value.trim() : '';
    if (inputName) return inputName;
    try {
      const saved = localStorage.getItem('fb_name')?.trim();
      if (saved) return saved;
    } catch (_) {}
    return t('defaultName');
  }

  getSelectedSpecies(): Species {
    return this.activeSpecies || this.selectedSpecies;
  }

  getSelectedSkin(): number {
    return this.activeSkin ?? (this.mySkins[this.selectedSpecies] ?? 0);
  }

  public updateSpecPlayBtn(): void {
    if (!this.specPlayBtn) return;
    if (this.isPlayerAlive) {
      this.specPlayBtn.textContent = t('specReturn');
      this.specPlayBtn.title = getLanguage() === 'en' ? 'Return to your character' : 'Quay lại điều khiển con vật của bạn';
    } else {
      this.specPlayBtn.textContent = t('specPlay');
      this.specPlayBtn.title = getLanguage() === 'en' ? 'Join battle' : 'Tham gia trận đấu';
    }
  }

  isDeathScreenVisible(): boolean {
    return !this.deathScreen.hidden;
  }

  isLobbyVisible(): boolean {
    return !this.startScreen.hidden;
  }

  showInGame(): void {
    this.startScreen.hidden = true;
    this.deathScreen.hidden = true;
    if (this.disclaimerModal) this.disclaimerModal.hidden = true;
    if (this.teamWinModalEl) this.teamWinModalEl.hidden = true;
    if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
    this.stopFrCountdown();
    if (this.spectateBarEl) this.spectateBarEl.hidden = true;
    this.isSpectating = false;
    this.isPlayerAlive = true;
    document.body.classList.remove('spectating');
    if (this.selectedMode !== 'team' && !(this.selectedMode === 'friend' && this.matchDuration > 0)) {
      if (this.teamBarEl) {
        this.teamBarEl.hidden = true;
        this.teamBarEl.classList.remove('friend-timer-only');
      }
      document.body.classList.remove('mode-team');
    }
    this.hudEl.hidden = false;
    document.body.classList.remove('menu');
  }

  returnToLobby(): void {
    if (this.deathCountdownTimer) {
      clearInterval(this.deathCountdownTimer);
      this.deathCountdownTimer = null;
    }
    if (this.deathCountdownEl) this.deathCountdownEl.hidden = true;
    if (this.againBtn) {
      this.againBtn.disabled = false;
      this.againBtn.innerHTML = t('again');
      this.againBtn.style.opacity = '1';
    }
    this.hudEl.hidden = true;
    this.deathScreen.hidden = true;
    if (this.disclaimerModal) this.disclaimerModal.hidden = true;
    if (this.teamWinModalEl) this.teamWinModalEl.hidden = true;
    if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
    this.stopFrCountdown();
    if (this.teamBarEl) {
      this.teamBarEl.hidden = true;
      this.teamBarEl.classList.remove('friend-timer-only');
    }
    if (this.spectateBarEl) this.spectateBarEl.hidden = true;
    const gameDrawer = document.getElementById('gameDrawerModal');
    if (gameDrawer) gameDrawer.hidden = true;
    if (this.exitConfirmModal) this.exitConfirmModal.hidden = true;
    this.isSpectating = false;
    this.isPlayerAlive = false;
    document.body.classList.remove('spectating');
    document.body.classList.add('menu');
    document.body.classList.toggle('mode-team', this.selectedMode === 'team');
    document.body.classList.toggle('mode-friend', this.selectedMode === 'friend');
    this.startScreen.hidden = false;
    this.previewRenderer?.start();
    this.previewRenderer?.resize();
    this.updateHof([]);
    this.updateSpeciesUI?.();
    this.updateCarousel();
    requestAnimationFrame(() => this.updateCarousel());
  }

  showDeath(ev: Extract<GameEvent, { k: 'die' }>, killerName?: string): void {
    if ((this.teamWinModalEl && !this.teamWinModalEl.hidden) || (this.friendResultModalEl && !this.friendResultModalEl.hidden)) return;
    this.deathScreen.hidden = false;
    this.hudEl.hidden = true;
    if (this.spectateBarEl) this.spectateBarEl.hidden = true;
    this.isSpectating = false;
    this.isPlayerAlive = false;
    document.body.classList.remove('spectating');
    document.body.classList.add('menu');

    if (this.deathTeamPickEl) {
      this.deathTeamPickEl.hidden = this.selectedMode !== 'team';
    }
    if (this.deathCountdownEl) this.deathCountdownEl.hidden = true;
    if (this.againBtn) {
      this.againBtn.disabled = false;
      this.againBtn.innerHTML = t('again');
      this.againBtn.style.opacity = '1';
    }
    if (this.spectateBtn) {
      this.spectateBtn.textContent = t('spectate');
    }
    if (this.changeBtn) {
      this.changeBtn.textContent = t('change');
    }

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
    this.setSelectedTeam(this.selectedTeam);
  }

  public setSelectedTeam(team: number): void {
    this.selectedTeam = team;
    document.querySelectorAll('.btn-team').forEach((btn) => {
      const t = parseInt((btn as HTMLElement).dataset.team ?? '0', 10);
      btn.classList.toggle('on', t === team);
    });
    if (this.selectedMode === 'team' && this.previewRenderer) {
      this.previewRenderer.setAnimal(this.selectedSpecies, this.mySkins[this.selectedSpecies] ?? 0, team);
    }
    this.onSelectTeam?.(team);
  }

  public updateTeamCounts(count0: number, count1: number): void {
    this.lastCount0 = count0;
    this.lastCount1 = count1;
    const txt0 = formatTeamCount(count0);
    const txt1 = formatTeamCount(count1);
    if (this.startCount0El) this.startCount0El.textContent = txt0;
    if (this.startCount1El) this.startCount1El.textContent = txt1;
    if (this.deathCount0El) this.deathCount0El.textContent = txt0;
    if (this.deathCount1El) this.deathCount1El.textContent = txt1;
    if (this.twCount0El) this.twCount0El.textContent = txt0;
    if (this.twCount1El) this.twCount1El.textContent = txt1;
    if (this.tbCount0El) this.tbCount0El.textContent = `(${count0})`;
    if (this.tbCount1El) this.tbCount1El.textContent = `(${count1})`;
  }

  public updateSpectatorTarget(name: string, mass: number): void {
    if (this.spectateNameEl) {
      this.spectateNameEl.textContent = `${name} (${mass} kg)`;
    }
  }

  public showTeamWinModal(
    winner: number,
    s0: number,
    s1: number,
    mvp?: {
      id: number;
      name: string;
      team: number;
      species: Species;
      skin: number;
      score: number;
      kills: number;
      mass: number;
    }
  ): void {
    this.deathScreen.hidden = true;
    if (this.friendResultModalEl) this.friendResultModalEl.hidden = true;
    if (this.spectateBarEl) this.spectateBarEl.hidden = true;
    this.isSpectating = false;
    document.body.classList.remove('spectating');
    document.body.classList.add('menu');

    if (this.teamWinModalEl) this.teamWinModalEl.hidden = false;
    const scoreBox = this.teamWinModalEl?.querySelector('.tw-score-box') as HTMLElement | null;
    const nextSection = this.teamWinModalEl?.querySelector('.tw-next-section') as HTMLElement | null;
    const twSubEl = document.getElementById('twSub');
    const mvpHeaderEl = this.teamWinModalEl?.querySelector('.tw-mvp-header') as HTMLElement | null;

    if (scoreBox) scoreBox.hidden = false;
    if (nextSection) nextSection.hidden = false;

    if (this.twTitleEl) {
      if (winner === 0) {
        this.twTitleEl.textContent = t('team0WinTitle');
        this.twTitleEl.style.color = '#4fc3f7';
      } else if (winner === 1) {
        this.twTitleEl.textContent = t('team1WinTitle');
        this.twTitleEl.style.color = '#f44336';
      } else {
        this.twTitleEl.textContent = t('teamTieTitle');
        this.twTitleEl.style.color = 'var(--gold)';
      }
    }
    if (twSubEl) {
      twSubEl.textContent = t('teamDominanceSub');
    }
    if (this.twScore0El) this.twScore0El.textContent = String(s0);
    if (this.twScore1El) this.twScore1El.textContent = String(s1);

    if (this.twMvpBoxEl) {
      if (mvp) {
        this.twMvpBoxEl.hidden = false;
        if (mvpHeaderEl) mvpHeaderEl.textContent = t('mvpHeader');
        if (this.twMvpNameEl) {
          const teamLabel = mvp.team === 0 ? t('team0') : t('team1');
          this.twMvpNameEl.textContent = `${mvp.name} (${teamLabel})`;
          this.twMvpNameEl.style.color = mvp.team === 0 ? '#4fc3f7' : '#f44336';
        }
        if (this.twMvpStatsEl) {
          this.twMvpStatsEl.textContent = t('mvpStats', { score: mvp.score, kills: mvp.kills, mass: mvp.mass });
        }
      } else {
        this.twMvpBoxEl.hidden = true;
      }
    }

    if (this.twCountdownEl) this.twCountdownEl.hidden = true;
    if (this.twContinueBtn) {
      this.twContinueBtn.disabled = false;
      this.twContinueBtn.innerHTML = t('continue');
      this.twContinueBtn.style.opacity = '1';
    }
    this.setSelectedTeam(this.selectedTeam);
  }

  public showFriendResultModal(ranks: LeaderRow[], myId: number): void {
    this.deathScreen.hidden = true;
    if (this.teamWinModalEl) this.teamWinModalEl.hidden = true;
    if (this.spectateBarEl) this.spectateBarEl.hidden = true;
    this.isSpectating = false;
    document.body.classList.remove('spectating');
    document.body.classList.add('menu');

    if (this.frTitleEl) this.frTitleEl.textContent = t('friendResultTitle');
    if (this.frSubEl) this.frSubEl.textContent = t('friendResultSub');
    const thPlayer = this.friendResultModalEl?.querySelector('.fr-th-name');
    if (thPlayer) thPlayer.textContent = t('frThPlayer');
    const thStats = this.friendResultModalEl?.querySelector('.fr-th-stats');
    if (thStats) thStats.textContent = t('frThStats');
    if (this.friendSpectateBtn) this.friendSpectateBtn.textContent = t('spectate');
    if (this.friendChangeBtn) this.friendChangeBtn.textContent = t('changeAnimal');

    if (this.friendResultModalEl) {
      this.friendResultModalEl.hidden = false;
      this.renderFriendLeaderboard(ranks, myId);
    }
    if (this.frCountdownEl) this.frCountdownEl.hidden = true;
    if (this.friendContinueBtn) {
      this.friendContinueBtn.disabled = false;
      this.friendContinueBtn.innerHTML = t('continue');
      this.friendContinueBtn.style.opacity = '1';
    }
  }

  private renderFriendLeaderboard(ranks: LeaderRow[], myId: number): void {
    if (!this.frListEl) return;
    this.frListEl.innerHTML = '';
    if (!ranks || ranks.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'fr-item';
      emptyLi.style.justifyContent = 'center';
      emptyLi.textContent = getLanguage() === 'en' ? 'No players recorded' : 'Không có dữ liệu người chơi';
      this.frListEl.appendChild(emptyLi);
      return;
    }

    ranks.slice(0, 10).forEach(([id, name, mass, kills, reign], idx) => {
      const li = document.createElement('li');
      const isTop1 = idx === 0;
      const isMe = id === myId;
      li.className = `fr-item${isTop1 ? ' fr-top1' : ''}${isMe ? ' fr-me' : ''}`;

      let rankStr = `#${idx + 1}`;
      if (idx === 0) rankStr = '👑 1';
      else if (idx === 1) rankStr = '🥈 2';
      else if (idx === 2) rankStr = '🥉 3';

      const rankSpan = document.createElement('span');
      rankSpan.className = 'fr-rank';
      rankSpan.textContent = rankStr;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'fr-name';
      nameSpan.textContent = name;
      if (isMe) {
        const meTag = document.createElement('span');
        meTag.className = 'fr-me-tag';
        meTag.textContent = t('frYou');
        nameSpan.appendChild(meTag);
      }

      const statsSpan = document.createElement('span');
      statsSpan.className = 'fr-stats';
      const killsPart = kills > 0 ? ` · 💥 ${kills}` : '';
      const reignPart = (isTop1 && reign && reign > 0) ? `👑 ${this.fmtTime(reign)} · ` : '';
      statsSpan.textContent = `${reignPart}${mass} kg${killsPart}`;

      li.append(rankSpan, nameSpan, statsSpan);
      this.frListEl!.appendChild(li);
    });
  }

  public stopFrCountdown(): void {
    if (this.frCountdownTimer) {
      clearInterval(this.frCountdownTimer);
      this.frCountdownTimer = null;
    }
    if (this.frCountdownEl) this.frCountdownEl.hidden = true;
    if (this.friendContinueBtn) {
      this.friendContinueBtn.disabled = false;
      this.friendContinueBtn.innerHTML = t('continue');
      this.friendContinueBtn.style.opacity = '1';
    }
  }

  updateStats(mass: number, rank: number, total: number, kills: number): void {
    this.massEl.textContent = String(Math.round(mass));
    this.rankTxt.textContent = t('rank', { r: rank || '–', n: total || '–' });
    this.koTxt.textContent = t('kos', { k: kills });
  }

  updatePerf(fps: number, ping: number, colo?: string, isMigrating = false): void {
    if (this.fpsVal) {
      this.fpsVal.textContent = String(fps);
      if (this.fpsDot) {
        this.fpsDot.className = `perf-dot ${fps >= 55 ? 'good' : fps >= 30 ? 'warn' : 'bad'}`;
      }
    }
    if (this.pingVal) {
      this.pingVal.textContent = ping > 0 ? String(ping) : '--';
      if (this.pingDot) {
        this.pingDot.className = `perf-dot ${ping > 0 ? (ping <= 80 ? 'good' : ping <= 130 ? 'warn' : 'bad') : 'good'}`;
      }
    }
    if (this.coloVal && colo) {
      this.coloVal.hidden = false;
      const isSin = colo === 'SIN';
      const isFast = isFastColo(colo) || (ping > 0 && ping <= 130);
      if (isMigrating) {
        this.coloVal.textContent = `${colo} ⚡`;
        this.coloVal.className = 'perf-colo warn';
        this.coloVal.title = `Đang tự động dò tìm tuyến mạng tối ưu... Nhấp để dò lại`;
      } else if (!isFast) {
        this.coloVal.textContent = `${colo} 🔍`;
        this.coloVal.className = 'perf-colo warn';
        this.coloVal.title = `Trạm ${colo} (Xa) - Đang dò tìm tuyến gần hơn... Nhấp để dò ngay`;
      } else if (ping > 130) {
        this.coloVal.textContent = `${colo} ⚠️`;
        this.coloVal.className = ping > 180 ? 'perf-colo bad' : 'perf-colo warn';
        this.coloVal.title = `Trạm ${colo} có độ trễ cao (~${ping}ms). Nhấp vào đây để đổi sang tuyến tối ưu!`;
      } else {
        this.coloVal.textContent = colo;
        this.coloVal.className = 'perf-colo good';
        this.coloVal.title = isSin
          ? `Trạm Singapore (SIN) (~${ping > 0 ? ping : 35}ms). Nhấp để kiểm tra lại tuyến`
          : `Trạm ${colo} (~${ping > 0 ? ping : 50}ms). Nhấp để kiểm tra lại tuyến`;
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
      this.ptTxtEl.textContent = t('podLockTimer', { s: timerSec });
      if (timerSec <= 5) this.podiumBadgeEl.classList.add('warn');
    } else if (hasKing) {
      this.podiumBadgeEl.classList.add('has-king');
      this.ptIconEl.textContent = '👑';
      this.ptTxtEl.textContent = t('kingOnPodium');
    } else {
      this.podiumBadgeEl.classList.add('shield-off');
      this.ptIconEl.textContent = '⚔️';
      this.ptTxtEl.textContent = (getLanguage() === 'en' ? 'Claim King: ' : 'Tranh Vua: ') + `${timerSec}s`;
      if (timerSec <= 5) this.podiumBadgeEl.classList.add('warn');
    }
  }

  fmtTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  updateLeaderboard(lb: LeaderRow[], myId: number, napoleonId = 0): void {
    if (this.lbList) this.syncLbList(this.lbList, lb, myId, napoleonId);
    if (this.drawerLbList) this.syncLbList(this.drawerLbList, lb, myId, napoleonId);
  }

  private syncLbList(container: HTMLElement, lb: LeaderRow[], myId: number, napoleonId: number): void {
    const existing = container.children;
    while (existing.length > lb.length) {
      container.removeChild(container.lastElementChild!);
    }
    lb.forEach(([id, name, mass, kills, reign], idx) => {
      let li = existing[idx] as HTMLElement | undefined;
      let row: HTMLElement;
      let n: HTMLElement;
      let k: HTMLElement;
      let v: HTMLElement;
      if (!li) {
        li = document.createElement('li');
        row = document.createElement('div');
        row.className = 'r';
        n = document.createElement('span');
        n.className = 'n';
        k = document.createElement('span');
        k.className = 'k';
        v = document.createElement('span');
        v.className = 'v';
        row.append(n, k, v);
        li.appendChild(row);
        container.appendChild(li);
      } else {
        row = (li.querySelector('.r') as HTMLElement) || li;
        n = li.querySelector('.n') as HTMLElement;
        k = li.querySelector('.k') as HTMLElement;
        v = li.querySelector('.v') as HTMLElement;
      }
      li.dataset.playerId = String(id);
      li.setAttribute('data-player-id', String(id));
      li.style.cursor = 'pointer';
      li.title = id === myId
        ? (getLanguage() === 'en' ? 'Your animal (Click to return)' : 'Con vật của bạn (Bấm để quay lại)')
        : (getLanguage() === 'en' ? `Click to spectate ${name}` : `Bấm để xem góc nhìn của ${name}`);
      li.classList.toggle('me', id === myId);
      const isKing = id === napoleonId && id > 0;
      li.classList.toggle('nap', isKing);
      if (n && n.textContent !== name) n.textContent = name;
      const killText = kills > 0 ? `💥${kills}` : '';
      if (k && k.textContent !== killText) k.textContent = killText;
      const valText = (isKing && reign && reign > 0) ? `👑 ${this.fmtTime(reign)} · ${mass} kg` : `${mass} kg`;
      if (v && v.textContent !== valText) v.textContent = valText;
    });
  }

  updateHof(hof: HofRow[]): void {
    const emojis: Record<Species, string> = {
      chicken: '🐔', sheep: '🐑', horse: '🐴', cow: '🐄', duck: '🦆', pig: '🐷', dog: '🐶', elephant: '🐘', monkey: '🐒', gorilla: '🦍',
    };
    if (this.hofList) this.hofList.innerHTML = '';
    if (this.drawerHofList) this.drawerHofList.innerHTML = '';

    const hasRecords = Boolean(hof && hof.length > 0);
    const hofEl = document.getElementById('hof');
    if (hofEl) {
      hofEl.hidden = !hasRecords;
    }
    const drawerHofCol = document.getElementById('drawerHofCol') || (this.drawerHofList?.closest('.drawer-col') as HTMLElement | null);
    if (drawerHofCol) {
      drawerHofCol.hidden = !hasRecords;
    }

    if (!hasRecords) return;

    for (const [name, sp, dur] of hof) {
      const createHofRow = () => {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'r';

        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = `${emojis[sp] || ''} ${name}`;

        const v = document.createElement('span');
        v.className = 'v';
        v.textContent = this.fmtTime(dur);

        row.append(n, v);
        li.appendChild(row);
        return li;
      };

      if (this.hofList) this.hofList.appendChild(createHofRow());
      if (this.drawerHofList) this.drawerHofList.appendChild(createHofRow());
    }
  }

  addFeed(text: string, isMine = false): void {
    const div = document.createElement('div');
    if (isMine) div.classList.add('mine');
    div.textContent = text;
    this.feedEl.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  showToast(text: string, durationMs = 2600): void {
    const isMobile = document.body.classList.contains('mobile-phone') ||
      (!document.body.classList.contains('ipad') && !document.body.classList.contains('is-pc') && window.innerWidth <= 640);
    if (isMobile) {
      // Trên điện thoại: dọn bớt thông báo cũ, giữ tối đa 1-2 cái xếp chồng cùng 1 vị trí
      while (this.toastsEl.children.length >= 2) {
        this.toastsEl.firstElementChild?.remove();
      }
      durationMs = Math.min(durationMs, 1800);
    }
    const div = document.createElement('div');
    div.textContent = text;
    this.toastsEl.appendChild(div);
    setTimeout(() => div.remove(), durationMs);
  }

  hideCenterAlert(): void {
    if (this.centerAlertTimer) {
      clearTimeout(this.centerAlertTimer);
      this.centerAlertTimer = null;
    }
    if (this.centerAlertEl) {
      this.centerAlertEl.hidden = true;
    }
  }

  showCenterAlert(text: string, durationMs = 1600): void {
    if (!this.centerAlertEl || !this.caTextEl) {
      this.showToast(text, durationMs);
      return;
    }
    if (this.centerAlertTimer) {
      clearTimeout(this.centerAlertTimer);
      this.centerAlertTimer = null;
    }
    const cleanText = text.replace(/^⚠️\s*/, '');
    this.caTextEl.textContent = cleanText;
    this.centerAlertEl.hidden = false;
    this.centerAlertTimer = setTimeout(() => {
      this.hideCenterAlert();
    }, durationMs);
  }

  showRuleBanner(ruleId: string): void {
    if (!ruleId) return;
    const ruleTitle = t(`r_${ruleId}`);
    const ruleDesc = t(`d_${ruleId}`);
    this.showBanner(t('ruleNew', { rule: ruleTitle }), ruleDesc);
  }

  updateBoard(ruleId?: string, reignSec?: number, kingName?: string, isMe = false): void {
    if (this.boardEl) {
      const eyebrow = this.boardEl.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = t('boardEyebrow');
    }
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

  showDiceRoll(roll: number): void {
    const overlay = document.getElementById('diceOverlay');
    const cube = document.getElementById('diceCube');
    const resultWrap = document.getElementById('diceResult');
    const resultText = document.getElementById('diceResultText');
    if (!overlay || !cube) return;

    const faceAngles: Record<number, [number, number]> = {
      1: [0, 0],
      2: [0, -90],
      3: [0, -180],
      4: [0, 90],
      5: [-90, 0],
      6: [90, 0],
    };
    const [targetX, targetY] = faceAngles[roll] || [0, 0];
    const spinX = 720 * 2 + targetX;
    const spinY = 1080 * 2 + targetY;

    if (resultWrap) resultWrap.hidden = true;
    overlay.hidden = false;

    cube.style.transition = 'none';
    cube.style.transform = 'rotateX(45deg) rotateY(45deg) rotateZ(30deg) scale(0.6)';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cube.style.transition = 'transform 2.0s cubic-bezier(0.12, 0.85, 0.25, 1.0)';
        cube.style.transform = `rotateX(${spinX}deg) rotateY(${spinY}deg) rotateZ(360deg) scale(1.15)`;
      });
    });

    setTimeout(() => {
      if (resultWrap && resultText) {
        const kg = roll * 100;
        resultText.textContent = t('diceWon', { roll, kg });
        resultWrap.hidden = false;
      }
      setTimeout(() => {
        overlay.hidden = true;
        if (resultWrap) resultWrap.hidden = true;
      }, 2000);
    }, 2000);
  }

  public getMaxCarouselIndex(): number {
    const firstBtn = this.speciesContainer?.querySelector('button') as HTMLElement | null;
    const isLandscape = window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
    const defaultBtnWidth = isLandscape ? 42 : 52;
    const defaultGap = isLandscape ? 4 : 6;

    const measuredBtnWidth = firstBtn && firstBtn.offsetWidth > 20 ? firstBtn.offsetWidth : defaultBtnWidth;
    const style = this.speciesContainer ? window.getComputedStyle(this.speciesContainer) : null;
    const measuredGap = style ? (parseFloat(style.gap) || defaultGap) : defaultGap;
    const step = measuredBtnWidth + measuredGap;

    const parentWidth = this.speciesContainer?.parentElement?.clientWidth;
    const defaultViewport = isLandscape ? 226 : 284;
    const viewportWidth = parentWidth && parentWidth > 50 ? parentWidth : defaultViewport;

    const visibleCount = Math.max(1, Math.min(TOTAL_CAROUSEL_ITEMS - 1, Math.floor((viewportWidth + measuredGap) / step)));
    return Math.max(1, TOTAL_CAROUSEL_ITEMS - visibleCount);
  }

  public updateCarousel(): void {
    if (!this.speciesContainer) return;
    const maxIndex = this.getMaxCarouselIndex();
    this.carouselIndex = Math.max(0, Math.min(this.carouselIndex, maxIndex));

    const firstBtn = this.speciesContainer.querySelector('button') as HTMLElement | null;
    const isLandscape = window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
    const defaultBtnWidth = isLandscape ? 42 : 52;
    const defaultGap = isLandscape ? 4 : 6;
    const measuredBtnWidth = firstBtn && firstBtn.offsetWidth > 20 ? firstBtn.offsetWidth : defaultBtnWidth;
    const style = window.getComputedStyle(this.speciesContainer);
    const measuredGap = parseFloat(style.gap) || defaultGap;
    const step = measuredBtnWidth + measuredGap;

    this.speciesContainer.style.transform = `translateX(-${this.carouselIndex * step}px)`;

    // Keep arrows always clearly visible and interactive (loopable navigation)
    if (this.spNavPrev) {
      this.spNavPrev.disabled = false;
      this.spNavPrev.style.opacity = '1';
      this.spNavPrev.style.pointerEvents = 'auto';
    }
    if (this.spNavNext) {
      this.spNavNext.disabled = false;
      this.spNavNext.style.opacity = '1';
      this.spNavNext.style.pointerEvents = 'auto';
    }
  }
}

