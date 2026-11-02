import { KidsPlayManager, type KidsModeConfig, type KidsModeState } from '../features/kidsMode';
import { t } from '../i18n';

export class KidsUiController {
  private static instance: KidsUiController;
  private readonly mgr = KidsPlayManager.getInstance();

  // Elements
  private modalEl!: HTMLElement | null;
  private lockOverlayEl!: HTMLElement | null;
  private hudWidgetEl!: HTMLElement | null;
  private hudTimerEl!: HTMLElement | null;
  private hudLivesEl!: HTMLElement | null;

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

  private selectedMinutes = 20;
  private selectedLives = 5;
  private isPinVerifiedForSession = false;

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
  }

  private bindEvents(): void {
    // Open Modal Triggers across PC, Mobile, and iPad
    const openBtns = [
      document.getElementById('kidsModeBtn'),
      document.getElementById('startKidsModeBtn'),
      document.getElementById('pcKidsModeBtn'),
      document.getElementById('sbmKidsMode'),
      document.getElementById('drawerKidsBtn'),
    ];

    openBtns.forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openSettingsModal();
      });
    });

    // Modal Close
    document.getElementById('kidsCloseBtn')?.addEventListener('click', () => {
      this.closeSettingsModal();
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
      });
    });

    this.customMinutesInput?.addEventListener('input', () => {
      const val = parseInt(this.customMinutesInput?.value || '0', 10);
      if (val > 0) {
        this.timeChips.forEach((c) => c.classList.remove('on'));
        this.selectedMinutes = val;
      }
    });

    // Time Enabled Checkbox
    this.timeEnabledCheck?.addEventListener('change', () => {
      const on = this.timeEnabledCheck?.checked ?? true;
      if (this.timeOptionsBox) {
        this.timeOptionsBox.style.opacity = on ? '1' : '0.4';
        this.timeOptionsBox.style.pointerEvents = on ? 'auto' : 'none';
      }
    });

    // Lives Chips
    this.livesChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        this.livesChips.forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        const l = parseInt(chip.dataset.lives || '5', 10);
        this.selectedLives = l;
        if (this.customLivesInput) this.customLivesInput.value = '';
      });
    });

    this.customLivesInput?.addEventListener('input', () => {
      const val = parseInt(this.customLivesInput?.value || '0', 10);
      if (val > 0) {
        this.livesChips.forEach((c) => c.classList.remove('on'));
        this.selectedLives = val;
      }
    });

    // Lives Enabled Checkbox
    this.livesEnabledCheck?.addEventListener('change', () => {
      const on = this.livesEnabledCheck?.checked ?? false;
      if (this.livesOptionsBox) {
        this.livesOptionsBox.style.opacity = on ? '1' : '0.4';
        this.livesOptionsBox.style.pointerEvents = on ? 'auto' : 'none';
      }
    });

    // Master Toggle
    this.masterToggle?.addEventListener('change', () => {
      const on = this.masterToggle?.checked ?? false;
      const sections = document.getElementById('kidsConfigSections');
      if (sections) {
        sections.style.opacity = on ? '1' : '0.45';
        sections.style.pointerEvents = on ? 'auto' : 'none';
      }
    });

    // Save Button
    this.saveBtn?.addEventListener('click', () => {
      this.handleSaveSettings();
    });

    // Disable Button
    this.disableBtn?.addEventListener('click', () => {
      this.mgr.disableKidsMode(this.getCurrentPin());
      this.closeSettingsModal();
    });

    // Lock Screen: Parent zone toggle
    this.lockParentBtn?.addEventListener('click', () => {
      if (this.lockPinBox) {
        this.lockPinBox.hidden = !this.lockPinBox.hidden;
        if (!this.lockPinBox.hidden && this.lockPinInput) {
          this.lockPinInput.value = '';
          this.lockPinInput.focus();
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

    // Lock Screen: Extend buttons
    this.extend15Btn?.addEventListener('click', () => {
      const pin = this.lockPinInput?.value || '';
      if (this.mgr.extendTime(15, pin)) {
        this.hideLockOverlay();
      }
    });

    this.extend3LivesBtn?.addEventListener('click', () => {
      const pin = this.lockPinInput?.value || '';
      if (this.mgr.extendLives(3, pin)) {
        this.hideLockOverlay();
      }
    });

    this.unlockAllBtn?.addEventListener('click', () => {
      const pin = this.lockPinInput?.value || '';
      if (this.mgr.disableKidsMode(pin)) {
        this.hideLockOverlay();
      }
    });
  }

  private openSettingsModal(): void {
    if (!this.modalEl) return;
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
    if (!matchedTimeChip && this.customMinutesInput) {
      this.customMinutesInput.value = String(cfg.timeLimitMinutes);
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
    if (!matchedLivesChip && this.customLivesInput) {
      this.customLivesInput.value = String(cfg.livesLimit);
    }

    if (this.timeOptionsBox) {
      this.timeOptionsBox.style.opacity = cfg.timeLimitEnabled ? '1' : '0.4';
      this.timeOptionsBox.style.pointerEvents = cfg.timeLimitEnabled ? 'auto' : 'none';
    }
    if (this.livesOptionsBox) {
      this.livesOptionsBox.style.opacity = cfg.livesLimitEnabled ? '1' : '0.4';
      this.livesOptionsBox.style.pointerEvents = cfg.livesLimitEnabled ? 'auto' : 'none';
    }

    if (this.pinStatusDesc) {
      this.pinStatusDesc.textContent = this.mgr.hasPin()
        ? 'Đã cài mã PIN. Nhập 4 số mới nếu muốn đổi PIN.'
        : 'Chưa cài mã PIN. Hãy nhập 4 số để bảo vệ cài đặt.';
    }
    if (this.pinInput) this.pinInput.value = '';
    if (this.disableBtn) this.disableBtn.hidden = !cfg.enabled;
  }

  private getCurrentPin(): string {
    return this.pinDigits.map((d) => d.value).join('') || this.pinInput?.value || '';
  }

  private handleSaveSettings(): void {
    const isMaster = this.masterToggle?.checked ?? false;
    const isTime = this.timeEnabledCheck?.checked ?? true;
    const isLives = this.livesEnabledCheck?.checked ?? false;

    if (isMaster && !isTime && !isLives) {
      if (this.formError) {
        this.formError.textContent = 'Vui lòng chọn ít nhất giới hạn thời gian hoặc giới hạn số mạng!';
        this.formError.hidden = false;
      }
      return;
    }

    const pinVal = this.pinInput?.value?.trim() || '';
    if (isMaster && !this.mgr.hasPin() && pinVal.length !== 4) {
      if (this.formError) {
        this.formError.textContent = t('kids_pin_required');
        this.formError.hidden = false;
      }
      return;
    }

    this.mgr.updateLimits(isMaster, isTime, this.selectedMinutes, isLives, this.selectedLives, pinVal.length === 4 ? pinVal : undefined);
    this.closeSettingsModal();
  }

  private handleLockPinSubmit(): void {
    const pin = this.lockPinInput?.value?.trim() || '';
    if (this.mgr.verifyPin(pin)) {
      if (this.lockPinBox) this.lockPinBox.hidden = true;
      if (this.lockOptionsBox) this.lockOptionsBox.hidden = false;
    } else {
      if (this.lockPinError) {
        this.lockPinError.textContent = t('kids_pin_wrong');
        this.lockPinError.hidden = false;
      }
    }
  }

  private hideLockOverlay(): void {
    if (this.lockOverlayEl) this.lockOverlayEl.hidden = true;
    if (this.lockOptionsBox) this.lockOptionsBox.hidden = true;
    if (this.lockPinBox) this.lockPinBox.hidden = true;
  }

  private onStateChange(state: KidsModeState, config: KidsModeConfig): void {
    // 1. Update In-Game Floating Badge
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

    // 2. Update Top Bar / Menu Badges
    const statusText = config.enabled ? t('kids_status_active') : t('kids_status_off');
    const sbmKidsVal = document.getElementById('sbmKidsVal');
    if (sbmKidsVal) sbmKidsVal.textContent = statusText;

    const btns = [
      document.getElementById('kidsModeBtn'),
      document.getElementById('startKidsModeBtn'),
    ];
    btns.forEach((b) => b?.classList.toggle('active', config.enabled));

    // 3. Handle Lock State
    if (this.lockOverlayEl) {
      if (state.isLocked) {
        this.lockOverlayEl.hidden = false;
        if (this.lockHeadEl) {
          this.lockHeadEl.textContent = state.lockReason === 'lives' ? t('kids_lock_lives_head') : t('kids_lock_time_head');
        }
        if (this.lockMsgEl) {
          this.lockMsgEl.textContent = state.lockReason === 'lives' ? t('kids_lock_lives_msg') : t('kids_lock_time_msg');
        }
      } else {
        this.hideLockOverlay();
      }
    }
  }
}
