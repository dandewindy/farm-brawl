import { KidsPlayManager, type KidsModeConfig, type KidsModeState } from '../features/kidsMode';
import { t } from '../i18n';
import { voiceAnnouncer } from '../audio/voiceAnnouncer';
import { sfxCountdownTick } from '../audio/sfx';

export class KidsUiController {
  private static instance: KidsUiController;
  private readonly mgr = KidsPlayManager.getInstance();

  // Elements
  private modalEl!: HTMLElement | null;
  private lockOverlayEl!: HTMLElement | null;
  private hudWidgetEl!: HTMLElement | null;
  private hudTimerEl!: HTMLElement | null;
  private hudLivesEl!: HTMLElement | null;
  private topTimerEl!: HTMLElement | null;
  private topTimerValEl!: HTMLElement | null;
  private countdown3DEl!: HTMLElement | null;
  private countdownNumEl!: HTMLElement | null;
  private autoUnlockTextEl!: HTMLElement | null;

  // Countdown voice & beep tracking
  private announced1min = false;
  private announced30s = false;
  private announced10s = false;
  private lastTickedSec = -1;

  // PIN Verify View
  private pinVerifyView!: HTMLElement | null;
  private pinDigits: HTMLInputElement[] = [];
  private pinVerifyError!: HTMLElement | null;

  // Settings Form View
  private settingsFormView!: HTMLElement | null;
  private masterToggle!: HTMLInputElement | null;
  private timeEnabledCheck!: HTMLInputElement | null;
  private timeOptionsBox!: HTMLElement | null;
  private timeChips: HTMLElement[] = [];
  private customMinutesInput!: HTMLInputElement | null;
  private livesEnabledCheck!: HTMLInputElement | null;
  private livesOptionsBox!: HTMLElement | null;
  private livesChips: HTMLElement[] = [];
  private customLivesInput!: HTMLInputElement | null;
  private pinInput!: HTMLInputElement | null;
  private clearPinBtn!: HTMLElement | null;
  private pinStatusDesc!: HTMLElement | null;
  private formError!: HTMLElement | null;
  private saveBtn!: HTMLElement | null;
  private disableBtn!: HTMLElement | null;

  // Lock Screen elements
  private lockHeadEl!: HTMLElement | null;
  private lockMsgEl!: HTMLElement | null;
  private lockParentBtn!: HTMLElement | null;
  private lockPinBox!: HTMLElement | null;
  private lockPinInput!: HTMLInputElement | null;
  private lockPinSubmit!: HTMLElement | null;
  private lockPinError!: HTMLElement | null;
  private lockOptionsBox!: HTMLElement | null;
  private extend15Btn!: HTMLElement | null;
  private extend3LivesBtn!: HTMLElement | null;
  private unlockAllBtn!: HTMLElement | null;
  private lockDisableBtn!: HTMLElement | null;

  private selectedMinutes = 20;
  private selectedLives = 5;
  private isPinVerifiedForSession = false;
  private isParentUnlocked = false;

  private constructor() {
    this.initDOMElements();
    this.bindEvents();
    this.mgr.subscribe((state, config) => this.onStateChange(state, config));
  }

  public static init(): KidsUiController {
    if (!KidsUiController.instance) {
      KidsUiController.instance = new KidsUiController();
    }
    return KidsUiController.instance;
  }

  private initDOMElements(): void {
    this.modalEl = document.getElementById('kidsModeModal');
    this.lockOverlayEl = document.getElementById('kidsLockOverlay');
    this.hudWidgetEl = document.getElementById('hudKidsWidget');
    this.hudTimerEl = document.getElementById('hudKidsTimerText');
    this.hudLivesEl = document.getElementById('hudKidsLivesText');
    this.topTimerEl = document.getElementById('kidsTopTimer');
    this.topTimerValEl = document.getElementById('kidsTopTimerVal');
    this.countdown3DEl = document.getElementById('kidsCountdown3D');
    this.countdownNumEl = document.getElementById('kidsCountdownNum');
    this.autoUnlockTextEl = document.getElementById('kidsAutoUnlockText');

    this.pinVerifyView = document.getElementById('kidsPinVerifyView');
    this.pinDigits = Array.from(document.querySelectorAll('.kids-pin-inputs .pin-digit')) as HTMLInputElement[];
    this.pinVerifyError = document.getElementById('kidsPinVerifyError');

    this.settingsFormView = document.getElementById('kidsSettingsFormView');
    this.masterToggle = document.getElementById('kidsMasterToggle') as HTMLInputElement | null;
    this.timeEnabledCheck = document.getElementById('kidsTimeEnabled') as HTMLInputElement | null;
    this.timeOptionsBox = document.getElementById('kidsTimeOptions');
    this.timeChips = Array.from(document.querySelectorAll('#kidsTimeChips .kids-chip'));
    this.customMinutesInput = document.getElementById('kidsCustomMinutes') as HTMLInputElement | null;

    this.livesEnabledCheck = document.getElementById('kidsLivesEnabled') as HTMLInputElement | null;
    this.livesOptionsBox = document.getElementById('kidsLivesOptions');
    this.livesChips = Array.from(document.querySelectorAll('#kidsLivesChips .kids-chip'));
    this.customLivesInput = document.getElementById('kidsCustomLives') as HTMLInputElement | null;

    this.pinInput = document.getElementById('kidsPinInput') as HTMLInputElement | null;
    this.clearPinBtn = document.getElementById('kidsClearPinBtn');
    this.pinStatusDesc = document.getElementById('kidsPinStatusDesc');
    this.formError = document.getElementById('kidsFormError');
    this.saveBtn = document.getElementById('kidsSaveBtn');
    this.disableBtn = document.getElementById('kidsDisableBtn');

    this.lockHeadEl = document.getElementById('kidsLockHead');
    this.lockMsgEl = document.getElementById('kidsLockMsg');
    this.lockParentBtn = document.getElementById('kidsLockParentBtn');
    this.lockPinBox = document.getElementById('kidsLockPinBox');
    this.lockPinInput = document.getElementById('kidsLockPinInput') as HTMLInputElement | null;
    this.lockPinSubmit = document.getElementById('kidsLockPinSubmit');
    this.lockPinError = document.getElementById('kidsLockPinError');
    this.lockOptionsBox = document.getElementById('kidsLockOptionsBox');
    this.extend15Btn = document.getElementById('kidsExtend15Btn');
    this.extend3LivesBtn = document.getElementById('kidsExtend3LivesBtn');
    this.unlockAllBtn = document.getElementById('kidsUnlockAllBtn');
    this.lockDisableBtn = document.getElementById('kidsLockDisableBtn');
  }

  private bindEvents(): void {
    // Open Modal Triggers across PC, Mobile, and iPad
    const openBtns = [
      document.getElementById('kidsModeBtn'),
      document.getElementById('startKidsModeBtn'),
      document.getElementById('pcKidsModeBtn'),
      document.getElementById('sbmKidsMode'),
      document.getElementById('drawerKidsBtn'),
      this.hudWidgetEl,
    ];

    openBtns.forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openSettingsModal();
      });
    });

    // Modal Close via X button - ALWAYS auto-save on close!
    document.getElementById('kidsCloseBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.saveFormState(false);
      this.closeSettingsModal();
    });

    // Close via Backdrop click
    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.saveFormState(false);
        this.closeSettingsModal();
      }
    });

    // Close via Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalEl && !this.modalEl.hidden) {
        this.saveFormState(false);
        this.closeSettingsModal();
      }
    });

    // PIN Digits Auto-tabbing
    this.pinDigits.forEach((input, idx) => {
      input.addEventListener('input', () => {
        if (input.value.length === 1 && idx < this.pinDigits.length - 1) {
          this.pinDigits[idx + 1].focus();
        }
        this.checkPinVerification();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value.length === 0 && idx > 0) {
          this.pinDigits[idx - 1].focus();
        }
      });
    });

    // Time Chips
    this.timeChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        this.timeChips.forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        const m = parseInt(chip.dataset.minutes || '20', 10);
        this.selectedMinutes = m;
        if (this.customMinutesInput) this.customMinutesInput.value = '';
        this.saveFormState(false);
      });
    });

    this.customMinutesInput?.addEventListener('input', () => {
      const val = parseInt(this.customMinutesInput?.value || '0', 10);
      if (val > 0) {
        this.timeChips.forEach((c) => c.classList.remove('on'));
        this.selectedMinutes = Math.min(180, val);
        this.saveFormState(false);
      }
    });

    // Time Enabled Checkbox
    this.timeEnabledCheck?.addEventListener('change', () => {
      this.updateSectionsVisibility();
      this.saveFormState(false);
    });

    // Lives Chips
    this.livesChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        this.livesChips.forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        const l = parseInt(chip.dataset.lives || '5', 10);
        this.selectedLives = l;
        if (this.customLivesInput) this.customLivesInput.value = '';
        this.saveFormState(false);
      });
    });

    this.customLivesInput?.addEventListener('input', () => {
      const val = parseInt(this.customLivesInput?.value || '0', 10);
      if (val > 0) {
        this.livesChips.forEach((c) => c.classList.remove('on'));
        this.selectedLives = Math.min(50, val);
        this.saveFormState(false);
      }
    });

    // Lives Enabled Checkbox
    this.livesEnabledCheck?.addEventListener('change', () => {
      this.updateSectionsVisibility();
      this.saveFormState(false);
    });

    // Master Toggle
    this.masterToggle?.addEventListener('change', () => {
      this.updateSectionsVisibility();
      this.saveFormState(false);
    });

    // PIN input changes
    this.pinInput?.addEventListener('input', () => {
      const val = this.pinInput?.value?.trim() || '';
      if (val.length === 4) {
        this.saveFormState(false);
        this.updatePinSection();
      }
    });

    // Clear PIN button
    this.clearPinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.mgr.clearPin();
      if (this.pinInput) this.pinInput.value = '';
      this.updatePinSection();
      this.showFeedbackToast('🔑 Đã xóa mã PIN ba mẹ!');
    });

    // Save Button
    this.saveBtn?.addEventListener('click', () => {
      this.handleSaveSettings();
    });

    // Disable Button
    this.disableBtn?.addEventListener('click', () => {
      this.mgr.disableKidsMode(this.getCurrentPin());
      this.showFeedbackToast('👶 Đã tắt chế độ Giờ chơi của bé.');
      this.closeSettingsModal();
    });

    // Lock Screen: Parent zone toggle
    this.lockParentBtn?.addEventListener('click', () => {
      if (!this.mgr.hasPin()) {
        // Chưa cài PIN -> Mở trực tiếp các tùy chọn gia hạn cho Ba Mẹ
        this.isParentUnlocked = true;
        if (this.lockPinBox) this.lockPinBox.hidden = true;
        if (this.lockOptionsBox) {
          this.lockOptionsBox.hidden = !this.lockOptionsBox.hidden;
        }
      } else {
        // Đã cài PIN -> Nếu đã unlock thì toggle Options, nếu chưa thì toggle PIN
        if (this.isParentUnlocked) {
          if (this.lockOptionsBox) {
            this.lockOptionsBox.hidden = !this.lockOptionsBox.hidden;
          }
        } else {
          if (this.lockPinBox) {
            this.lockPinBox.hidden = !this.lockPinBox.hidden;
            if (!this.lockPinBox.hidden && this.lockPinInput) {
              this.lockPinInput.value = '';
              this.lockPinInput.focus();
            }
          }
        }
      }
    });

    // Lock Screen: PIN Submit
    this.lockPinSubmit?.addEventListener('click', () => {
      this.handleLockPinSubmit();
    });
    this.lockPinInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleLockPinSubmit();
    });

    // Lock Screen: Action buttons
    this.extend15Btn?.addEventListener('click', () => {
      this.mgr.extendTime(15);
      this.hideLockOverlay();
      this.showFeedbackToast('👶 Đã thêm +15 phút chơi cho bé! ✨');
    });

    this.extend3LivesBtn?.addEventListener('click', () => {
      this.mgr.extendLives(3);
      this.hideLockOverlay();
      this.showFeedbackToast('👶 Đã thêm +3 mạng chơi cho bé! ✨');
    });

    this.unlockAllBtn?.addEventListener('click', () => {
      this.mgr.unlockAndReset();
      this.hideLockOverlay();
      this.showFeedbackToast('👶 Đã mở khóa lượt chơi mới cho bé! ✨');
    });

    this.lockDisableBtn?.addEventListener('click', () => {
      this.mgr.disableKidsMode();
      this.hideLockOverlay();
      this.showFeedbackToast('👶 Đã tắt chế độ Giờ chơi của bé.');
    });
  }

  private updateSectionsVisibility(): void {
    const isMaster = this.masterToggle?.checked ?? false;
    ['kidsTimeSectionCard', 'kidsLivesSectionCard', 'kidsPinSectionCard'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.opacity = isMaster ? '1' : '0.45';
        el.style.pointerEvents = isMaster ? 'auto' : 'none';
      }
    });

    const isTime = this.timeEnabledCheck?.checked ?? true;
    if (this.timeOptionsBox) {
      this.timeOptionsBox.style.opacity = isMaster && isTime ? '1' : '0.4';
      this.timeOptionsBox.style.pointerEvents = isMaster && isTime ? 'auto' : 'none';
    }

    const isLives = this.livesEnabledCheck?.checked ?? true;
    if (this.livesOptionsBox) {
      this.livesOptionsBox.style.opacity = isMaster && isLives ? '1' : '0.4';
      this.livesOptionsBox.style.pointerEvents = isMaster && isLives ? 'auto' : 'none';
    }
  }

  private updatePinSection(): void {
    const hasPin = this.mgr.hasPin();
    if (this.pinStatusDesc) {
      this.pinStatusDesc.textContent = hasPin
        ? 'Đã cài mã PIN. Nhập 4 số mới nếu muốn đổi, hoặc bấm ✕ để xóa PIN.'
        : 'Chưa cài mã PIN (Tùy chọn). Nhập 4 số nếu muốn khóa cài đặt.';
    }
    if (this.clearPinBtn) {
      this.clearPinBtn.hidden = !hasPin;
    }
  }

  private openSettingsModal(): void {
    if (!this.modalEl) return;
    const pcMenu = document.getElementById('pcSettingsMenu');
    if (pcMenu) pcMenu.hidden = true;
    const drawer = document.getElementById('gameDrawerModal');
    if (drawer) drawer.hidden = true;
    this.modalEl.hidden = false;

    // Reset errors
    if (this.formError) this.formError.hidden = true;
    if (this.pinVerifyError) this.pinVerifyError.hidden = true;

    // Check if PIN is required to access settings
    if (this.mgr.hasPin() && !this.isPinVerifiedForSession) {
      if (this.pinVerifyView) this.pinVerifyView.hidden = false;
      if (this.settingsFormView) this.settingsFormView.hidden = true;
      this.pinDigits.forEach((d) => (d.value = ''));
      setTimeout(() => this.pinDigits[0]?.focus(), 100);
    } else {
      this.showSettingsForm();
    }
  }

  private closeSettingsModal(): void {
    if (this.modalEl) this.modalEl.hidden = true;
  }

  private checkPinVerification(): void {
    const entered = this.pinDigits.map((d) => d.value).join('');
    if (entered.length === 4) {
      if (this.mgr.verifyPin(entered)) {
        this.isPinVerifiedForSession = true;
        this.showSettingsForm();
      } else {
        if (this.pinVerifyError) {
          this.pinVerifyError.textContent = t('kids_pin_wrong');
          this.pinVerifyError.hidden = false;
        }
        this.pinDigits.forEach((d) => (d.value = ''));
        this.pinDigits[0]?.focus();
      }
    }
  }

  private showSettingsForm(): void {
    if (this.pinVerifyView) this.pinVerifyView.hidden = true;
    if (this.settingsFormView) this.settingsFormView.hidden = false;

    const cfg = this.mgr.config;
    if (this.masterToggle) this.masterToggle.checked = cfg.enabled;
    if (this.timeEnabledCheck) this.timeEnabledCheck.checked = cfg.timeLimitEnabled;
    if (this.livesEnabledCheck) this.livesEnabledCheck.checked = cfg.livesLimitEnabled;

    this.selectedMinutes = cfg.timeLimitMinutes;
    this.selectedLives = cfg.livesLimit;

    // Select time chip or custom
    let matchedTimeChip = false;
    this.timeChips.forEach((chip) => {
      const m = parseInt(chip.dataset.minutes || '0', 10);
      if (m === cfg.timeLimitMinutes) {
        chip.classList.add('on');
        matchedTimeChip = true;
      } else {
        chip.classList.remove('on');
      }
    });
    if (this.customMinutesInput) {
      this.customMinutesInput.value = matchedTimeChip ? '' : String(cfg.timeLimitMinutes);
    }

    // Select lives chip or custom
    let matchedLivesChip = false;
    this.livesChips.forEach((chip) => {
      const l = parseInt(chip.dataset.lives || '0', 10);
      if (l === cfg.livesLimit) {
        chip.classList.add('on');
        matchedLivesChip = true;
      } else {
        chip.classList.remove('on');
      }
    });
    if (this.customLivesInput) {
      this.customLivesInput.value = matchedLivesChip ? '' : String(cfg.livesLimit);
    }

    this.updateSectionsVisibility();
    this.updatePinSection();

    if (this.pinInput) this.pinInput.value = '';
    if (this.disableBtn) this.disableBtn.hidden = !cfg.enabled;
  }

  private getCurrentPin(): string {
    return this.pinDigits.map((d) => d.value).join('') || this.pinInput?.value || '';
  }

  private saveFormState(forceReset = false): boolean {
    const isMaster = this.masterToggle?.checked ?? false;
    const isTime = this.timeEnabledCheck?.checked ?? true;
    const isLives = this.livesEnabledCheck?.checked ?? true;

    // Custom or selected minutes
    let minutes = this.selectedMinutes;
    const customMin = parseInt(this.customMinutesInput?.value || '0', 10);
    if (customMin > 0) {
      minutes = Math.max(1, Math.min(180, customMin));
      this.selectedMinutes = minutes;
    }

    // Custom or selected lives
    let lives = this.selectedLives;
    const customLiv = parseInt(this.customLivesInput?.value || '0', 10);
    if (customLiv > 0) {
      lives = Math.max(1, Math.min(50, customLiv));
      this.selectedLives = lives;
    }

    const pinVal = this.pinInput?.value?.trim() || '';
    if (pinVal.length > 0 && pinVal.length < 4) {
      if (this.formError) {
        this.formError.textContent = t('kids_pin_required');
        this.formError.hidden = false;
      }
      return false;
    }

    if (this.formError) this.formError.hidden = true;

    this.mgr.updateLimits(
      isMaster,
      isTime,
      minutes,
      isLives,
      lives,
      pinVal.length === 4 ? pinVal : undefined,
      forceReset
    );

    return true;
  }

  private handleSaveSettings(): void {
    if (this.masterToggle) {
      this.masterToggle.checked = true;
    }

    // If both limits are turned off, turn both on by default
    if (this.timeEnabledCheck && this.livesEnabledCheck) {
      if (!this.timeEnabledCheck.checked && !this.livesEnabledCheck.checked) {
        this.timeEnabledCheck.checked = true;
        this.livesEnabledCheck.checked = true;
      }
    }

    const ok = this.saveFormState(true);
    if (ok) {
      this.showFeedbackToast(t('kids_saved_toast') || '👶 Đã lưu & kích hoạt Giờ chơi cho bé! ✨');
      this.closeSettingsModal();
    }
  }

  private showFeedbackToast(msg: string): void {
    let toast = document.getElementById('kidsToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kidsToast';
      toast.className = 'kids-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove('fade-out');
    toast.classList.add('show');
    setTimeout(() => {
      toast?.classList.remove('show');
      toast?.classList.add('fade-out');
    }, 2800);
  }

  private handleLockPinSubmit(): void {
    const pin = this.lockPinInput?.value?.trim() || '';
    if (this.mgr.verifyPin(pin)) {
      this.isParentUnlocked = true;
      if (this.lockPinBox) this.lockPinBox.hidden = true;
      if (this.lockOptionsBox) this.lockOptionsBox.hidden = false;
      if (this.lockPinError) this.lockPinError.hidden = true;
    } else {
      if (this.lockPinError) {
        this.lockPinError.textContent = t('kids_pin_wrong');
        this.lockPinError.hidden = false;
      }
      if (this.lockPinInput) {
        this.lockPinInput.value = '';
        this.lockPinInput.focus();
      }
    }
  }

  private hideLockOverlay(): void {
    if (this.lockOverlayEl) {
      this.lockOverlayEl.hidden = true;
      this.lockOverlayEl.style.setProperty('display', 'none', 'important');
    }
    if (this.lockOptionsBox) this.lockOptionsBox.hidden = true;
    if (this.lockPinBox) this.lockPinBox.hidden = true;
    this.isParentUnlocked = false;
  }

  private updateLockParentZone(): void {
    if (!this.mgr.hasPin() || this.isParentUnlocked) {
      if (this.lockPinBox) this.lockPinBox.hidden = true;
      if (this.lockOptionsBox) {
        this.lockOptionsBox.hidden = false;
        this.lockOptionsBox.style.removeProperty('display');
      }
    } else {
      if (this.lockPinBox) {
        this.lockPinBox.hidden = false;
        this.lockPinBox.style.removeProperty('display');
        if (this.lockPinError) this.lockPinError.hidden = true;
      }
      if (this.lockOptionsBox) this.lockOptionsBox.hidden = true;
    }
  }

  private onStateChange(state: KidsModeState, config: KidsModeConfig): void {
    const isPlayingWithTimer = config.enabled && config.timeLimitEnabled && !state.isLocked;

    // 1. Update Top Bar Timer Widget (Chỉ hiện thời gian, highlight khi còn <= 30s)
    if (this.topTimerEl) {
      this.topTimerEl.hidden = !isPlayingWithTimer;
      if (isPlayingWithTimer && this.topTimerValEl) {
        const mins = Math.floor(state.timeRemainingSec / 60);
        const secs = Math.floor(state.timeRemainingSec % 60);
        this.topTimerValEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        // Highlight đỏ cam nhấp nháy khi còn 30 giây
        this.topTimerEl.classList.toggle('urgent', state.timeRemainingSec <= 30);
      }
    }

    // 1b. Big 3D Countdown Banner & Voice Announcements (Còn 1 phút, Còn 30s, Còn 10s + Beep)
    if (isPlayingWithTimer) {
      if (state.timeRemainingSec > 65) this.announced1min = false;
      if (state.timeRemainingSec > 35) this.announced30s = false;
      if (state.timeRemainingSec > 12) {
        this.announced10s = false;
        this.lastTickedSec = -1;
      }

      // Thông báo âm thanh Còn 1 phút
      if (state.timeRemainingSec <= 60 && state.timeRemainingSec > 50 && !this.announced1min) {
        this.announced1min = true;
        voiceAnnouncer.play('time_1min', 1);
      }

      // Thông báo âm thanh Còn 30 giây
      if (state.timeRemainingSec <= 30 && state.timeRemainingSec > 20 && !this.announced30s) {
        this.announced30s = true;
        voiceAnnouncer.play('time_30s', 1);
      }

      // Còn <= 10s: Hiện countdown 3D to đẹp giữa màn hình + Âm thanh cảnh báo + Tiếng tích tắc mỗi giây
      if (state.timeRemainingSec <= 10 && state.timeRemainingSec > 0) {
        if (!this.announced10s) {
          this.announced10s = true;
          voiceAnnouncer.play('time_10s', 1);
        }
        const curSec = Math.max(1, Math.ceil(state.timeRemainingSec));
        if (curSec !== this.lastTickedSec && curSec <= 10) {
          this.lastTickedSec = curSec;
          sfxCountdownTick(curSec);
        }
        if (this.countdown3DEl) {
          this.countdown3DEl.hidden = false;
          if (this.countdownNumEl) {
            this.countdownNumEl.textContent = String(curSec);
          }
        }
      } else {
        if (this.countdown3DEl) this.countdown3DEl.hidden = true;
      }
    } else {
      this.announced1min = false;
      this.announced30s = false;
      this.announced10s = false;
      this.lastTickedSec = -1;
      if (this.countdown3DEl) this.countdown3DEl.hidden = true;
    }

    // 2. Update In-Game Floating Badge
    if (this.hudWidgetEl) {
      this.hudWidgetEl.hidden = !config.enabled;
      if (config.enabled) {
        // Timer display
        if (config.timeLimitEnabled && this.hudTimerEl) {
          this.hudTimerEl.hidden = false;
          const mins = Math.floor(state.timeRemainingSec / 60);
          const secs = Math.floor(state.timeRemainingSec % 60);
          this.hudTimerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else if (this.hudTimerEl) {
          this.hudTimerEl.hidden = true;
        }

        // Lives display
        if (config.livesLimitEnabled && this.hudLivesEl) {
          this.hudLivesEl.hidden = false;
          this.hudLivesEl.textContent = `❤️ x${state.livesRemaining}`;
        } else if (this.hudLivesEl) {
          this.hudLivesEl.hidden = true;
        }

        // Warning animation if < 2 mins or <= 1 life
        const isWarning =
          (config.timeLimitEnabled && state.timeRemainingSec <= 120) ||
          (config.livesLimitEnabled && state.livesRemaining <= 1);
        this.hudWidgetEl.classList.toggle('warning', isWarning);
      }
    }

    // 3. Update Top Bar / Menu Badges
    const statusText = config.enabled ? t('kids_status_active') : t('kids_status_off');
    const sbmKidsVal = document.getElementById('sbmKidsVal');
    if (sbmKidsVal) sbmKidsVal.textContent = statusText;

    const btns = [
      document.getElementById('kidsModeBtn'),
      document.getElementById('startKidsModeBtn'),
      document.getElementById('pcKidsModeBtn'),
    ];
    btns.forEach((b) => b?.classList.toggle('active', config.enabled));

    // 4. Handle Lock State & Auto-unlock countdown
    if (this.lockOverlayEl) {
      if (state.isLocked && config.enabled) {
        this.lockOverlayEl.hidden = false;
        this.lockOverlayEl.style.removeProperty('display');
        if (this.lockHeadEl) {
          this.lockHeadEl.textContent = state.lockReason === 'lives' ? t('kids_lock_lives_head') : t('kids_lock_time_head');
        }
        if (this.lockMsgEl) {
          this.lockMsgEl.textContent = state.lockReason === 'lives' ? t('kids_lock_lives_msg') : t('kids_lock_time_msg');
        }

        // Luôn hiển thị sẵn khu vực cài đặt mở rộng của ba mẹ (không ẩn sau nút bấm)
        this.updateLockParentZone();

        // Cập nhật đồng hồ đếm ngược tự động mở lại sau tối đa 1 tiếng
        if (this.autoUnlockTextEl) {
          const remSec = this.mgr.getAutoUnlockRemainingSec();
          const uMins = Math.floor(remSec / 60);
          const uSecs = Math.floor(remSec % 60);
          this.autoUnlockTextEl.innerHTML = `Tự động mở lại sau: <b>${String(uMins).padStart(2, '0')}:${String(uSecs).padStart(2, '0')}</b>`;
        }
      } else {
        this.hideLockOverlay();
      }
    }
  }
}
