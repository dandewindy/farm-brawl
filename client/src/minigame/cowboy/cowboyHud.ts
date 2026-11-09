import { t } from '../../i18n';
import { COWBOY_ITEMS_CATALOG, cowboyInventory } from './cowboyItems';
import { HORSE_COWBOY_SVG, isCowboyAdminName } from './cowboyTypes';

export class CowboyHud {
  public rootEl: HTMLElement;

  private creditValEl!: HTMLElement;
  private scoreValEl!: HTMLElement;
  private catchesValEl!: HTMLElement;
  private roundTimerBox!: HTMLElement;
  private roundTimerValEl!: HTMLElement;
  private autoCountdownValEl!: HTMLElement;
  private betButtons: HTMLButtonElement[] = [];
  private launchBtn!: HTMLButtonElement;

  public onOpenShop?: () => void;
  private adminShopBtn!: HTMLButtonElement;
  private backpackBtn!: HTMLButtonElement;
  private exitBtn!: HTMLButtonElement;
  private toastBox!: HTMLElement;
  private floatContainer!: HTMLElement;
  private quickItemsRow!: HTMLElement;
  private backpackModal!: HTMLElement;
  private backpackGrid!: HTMLElement;

  // Selected bet (1 to 5)
  private currentBet = 1;
  public isModalOpen = false;
  private isBusy = false;
  private activeTimeouts: any[] = [];

  // 3-Minute Round Timer
  private roundSecondsLeft = 180;
  private roundTimerInterval: any = null;
  private roundEndTimeout: any = null;

  // 10-Second Idle Auto Launch Timer
  private autoLaunchSecondsLeft = 10;
  private autoLaunchInterval: any = null;

  public onBetChange?: (bet: number) => void;
  public onChargeStart?: () => void;
  public onChargeRelease?: (durationMs: number) => void;
  public onLaunch?: (bet: number) => void;
  private isCharging = false;
  private chargeStartTime = 0;
  public onExit?: () => void;
  public onRoundEnd?: () => void;
  public onClaimRelief?: () => void;

  constructor(parent: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'cowboyArcadeHud';
    this.rootEl.className = 'cowboy-hud-container';
    parent.appendChild(this.rootEl);

    this.render();
    this.bindEvents();
    this.startAutoLaunchTimer();
    this.updateInventory();
  }

  private render(): void {
    this.rootEl.innerHTML = `
      <!-- Top Marquee Bar -->
      <div class="cowboy-top-bar">
        <div class="cowboy-title-box">
          <span class="cowboy-ico">${HORSE_COWBOY_SVG}</span>
          <div class="cowboy-title-group">
            <span class="cowboy-title" data-i18n="cb_title">CAO BỒI KÉO BÒ</span>
          </div>
        </div>

        <div class="cowboy-stats-bar">
          <div class="cowboy-stat-box round-timer" id="cbRoundTimerBox">
            <span class="c-lbl" data-i18n="cb_time">THỜI GIAN</span>
            <span class="c-val" id="cbRoundTimerVal">03:00</span>
          </div>
          <div class="cowboy-stat-box credit">
            <span class="c-lbl" data-i18n="cb_credits_lbl">CREDIT</span>
            <span class="c-val" id="cbCreditsVal">20</span>
          </div>
          <div class="cowboy-stat-box score">
            <span class="c-lbl" data-i18n="cb_score">ĐIỂM</span>
            <span class="c-val" id="cbScoreVal">0</span>
          </div>
          <div class="cowboy-stat-box catches">
            <span class="c-lbl" data-i18n="cb_catches">ĐÃ BẮT</span>
            <span class="c-val" id="cbCatchesVal">0</span>
          </div>
        </div>

        <div class="cowboy-top-actions">
          <button type="button" id="cbAdminShopBtn" class="cowboy-shop-btn admin-shop-btn" title="[Admin] Mở Cửa Hàng bất kỳ lúc nào" hidden>
            <span class="txt">CỬA HÀNG</span>
          </button>
          <button type="button" id="cbFsBtn" class="cowboy-top-icon-btn cb-fs-btn" title="Toàn màn hình / Fullscreen" aria-label="Toàn màn hình">
            <span class="fs-icon-enter">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </span>
            <span class="fs-icon-exit" style="display:none;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </span>
          </button>
          <button type="button" id="cbBackpackBtn" class="cowboy-backpack-btn" title="Kho vật phẩm trợ thủ">
            <span class="txt" data-i18n="cb_backpack_lbl">KHO ĐỒ</span>
          </button>
          <button type="button" id="cbExitBtn" class="cowboy-exit-btn" title="Thoát ra sảnh chính">
            <span class="txt" data-i18n="cb_exit">THOÁT</span>
          </button>
        </div>
      </div>

      <!-- Floating scores layer -->
      <div id="cbFloatContainer" class="cowboy-float-container"></div>

      <!-- Toast notifications -->
      <div id="cbToastBox" class="cowboy-toast-box"></div>

      <!-- Bottom Arcade Controls: 3 Cột Ngang Hàng (Trái: Item 3D, Giữa: Nút Quăng + Tự động sau, Phải: Chọn Số Dây) -->
      <div class="cowboy-bottom-bar">
        <div class="cowboy-controls-card">
          <!-- CỘT TRÁI: Kho vật phẩm 3D xoay vòng -->
          <div class="cb-ctrl-col cb-ctrl-left" id="cbQuickItemBar">
            <div class="cb-col-label">
              <span class="ico">🎒</span>
              <span data-i18n="cb_quick_items">VẬT PHẨM</span>
            </div>
            <div class="cb-quick-items-row" id="cbQuickItemsRow"></div>
          </div>

          <!-- CỘT GIỮA: Nút Quăng Dây Đỏ Tactile + Tự động sau -->
          <div class="cb-ctrl-col cb-ctrl-center">
            <button type="button" id="cbLaunchBtn" class="cowboy-red-button cb-launch-circle-btn" title="Nhấn nhanh để quăng ngay, hoặc nhấn giữ gồng để canh cự ly xa gần">
              <div class="btn-top">
                <span class="txt" data-i18n="cb_launch_btn">QUĂNG DÂY</span>
                <small class="key-hint" data-i18n="cb_space_hint">Space</small>
              </div>
            </button>
            <div id="cbAutoLaunchHint" class="cb-auto-launch-hint">
              <span data-i18n="cb_auto_throw_hint">Tự động sau:</span> <span id="cbAutoCountdown">10</span> s
            </div>
          </div>

          <!-- CỘT PHẢI: Chọn số dây (Credit) -->
          <div class="cb-ctrl-col cb-ctrl-right">
            <div class="cb-col-label">
              <span class="ico">🪙</span>
              <span data-i18n="cb_pick_ropes">SỐ DÂY (CREDIT)</span>
            </div>
            <div class="cowboy-bet-group">
              <button type="button" class="cb-bet-btn on" data-bet="1">1 DÂY <span>(1 C)</span></button>
              <button type="button" class="cb-bet-btn" data-bet="2">2 DÂY <span>(2 C)</span></button>
              <button type="button" class="cb-bet-btn" data-bet="3">3 DÂY <span>(3 C)</span></button>
              <button type="button" class="cb-bet-btn" data-bet="4">4 DÂY <span>(4 C)</span></button>
              <button type="button" class="cb-bet-btn" data-bet="5">5 DÂY <span>(5 C)</span></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Backpack Modal -->
      <div id="cbBackpackModal" class="cowboy-modal-wrap" hidden>
        <div class="cowboy-modal-card cb-backpack-modal-card">
          <div class="cm-icon">🎒</div>
          <h3 class="cm-title" data-i18n="cb_backpack_title">KHO ĐỒ VẬT PHẨM</h3>
          <p class="cm-desc" data-i18n="cb_backpack_sub">Các vật phẩm hỗ trợ bạn đang sở hữu</p>
          <div class="cb-backpack-grid" id="cbBackpackGrid"></div>
          <div class="cm-actions">
            <button type="button" id="cbCloseBackpackBtn" class="cb-btn-exit" data-i18n="cb_close">ĐÓNG</button>
          </div>
        </div>
      </div>

      <!-- Modal Cứu Trợ Credit -->
      <div id="cbReliefModal" class="cowboy-modal-wrap" hidden>
        <div class="cowboy-modal-card">
          <div class="cm-icon horse-ico">${HORSE_COWBOY_SVG}</div>
          <h3 class="cm-title">HẾT CREDIT RỒI CAO BỒI ƠI!</h3>
          <p id="cbReliefMsg" class="cm-desc">Đừng lo, ban tổ chức tặng bạn <b>5 Credit cứu trợ</b> để tiếp tục trổ tài kéo bò!</p>
          <div class="cm-actions">
            <button type="button" id="cbClaimReliefBtn" class="cb-btn-relief">NHẬN 5 CREDIT</button>
            <button type="button" id="cbReliefExitBtn" class="cb-btn-exit" data-i18n="cb_exit">VỀ SẢNH CHÍNH</button>
          </div>
        </div>
      </div>
    `;

    this.creditValEl = this.rootEl.querySelector('#cbCreditsVal')!;
    this.scoreValEl = this.rootEl.querySelector('#cbScoreVal')!;
    this.catchesValEl = this.rootEl.querySelector('#cbCatchesVal')!;
    this.roundTimerBox = this.rootEl.querySelector('#cbRoundTimerBox')!;
    this.roundTimerValEl = this.rootEl.querySelector('#cbRoundTimerVal')!;
    this.autoCountdownValEl = this.rootEl.querySelector('#cbAutoCountdown')!;
    this.launchBtn = this.rootEl.querySelector('#cbLaunchBtn')!;
    // Shop button removed from active gameplay HUD (opens automatically when round ends)
    this.adminShopBtn = this.rootEl.querySelector('#cbAdminShopBtn')!;
    this.backpackBtn = this.rootEl.querySelector('#cbBackpackBtn')!;
    this.exitBtn = this.rootEl.querySelector('#cbExitBtn')!;
    this.toastBox = this.rootEl.querySelector('#cbToastBox')!;
    this.floatContainer = this.rootEl.querySelector('#cbFloatContainer')!;
    this.quickItemsRow = this.rootEl.querySelector('#cbQuickItemsRow')!;
    this.backpackModal = this.rootEl.querySelector('#cbBackpackModal')!;
    this.backpackGrid = this.rootEl.querySelector('#cbBackpackGrid')!;

    this.betButtons = Array.from(this.rootEl.querySelectorAll('.cb-bet-btn'));
  }

  private startCharge(): void {
    if (this.isModalOpen || this.isBusy || this.isCharging) return;
    this.isCharging = true;
    this.chargeStartTime = performance.now();
    this.launchBtn.classList.add('is-charging');
    this.onChargeStart?.();
  }

  private releaseCharge(): void {
    if (!this.isCharging) return;
    this.isCharging = false;
    this.launchBtn.classList.remove('is-charging');
    const duration = performance.now() - this.chargeStartTime;
    this.resetAutoLaunchTimer();
    this.launchBtn.classList.add('is-pressed');
    const tid = setTimeout(() => this.launchBtn.classList.remove('is-pressed'), 120);
    this.activeTimeouts.push(tid);

    if (duration > 120) {
      this.onChargeRelease?.(duration);
    } else {
      this.onLaunch?.(this.currentBet);
    }
  }

  private bindEvents(): void {
    const isAdmin = isCowboyAdminName();
    if (this.adminShopBtn) {
      if (isAdmin) {
        this.adminShopBtn.hidden = false;
        this.adminShopBtn.style.display = 'inline-flex';
      } else {
        this.adminShopBtn.hidden = true;
        this.adminShopBtn.style.display = 'none';
      }

      this.adminShopBtn.addEventListener('click', () => {
        if (this.isBusy || this.isModalOpen) return;
        this.onOpenShop?.();
      });
    }


    // Nút chọn mức cược
    for (const btn of this.betButtons) {
      btn.addEventListener('click', () => {
        const bet = parseInt(btn.getAttribute('data-bet') || '1', 10);
        this.setBet(bet);
        this.resetAutoLaunchTimer();
      });
    }

    // Nút Quăng dây hỗ trợ nhấn nhanh & nhấn giữ gồng canh cự ly xa gần
    this.launchBtn.addEventListener('pointerdown', (e) => {
      if (this.isModalOpen || this.isBusy) return;
      e.preventDefault();
      this.startCharge();
    });

    window.addEventListener('pointerup', () => {
      if (this.isCharging) this.releaseCharge();
    });

    window.addEventListener('pointercancel', () => {
      if (this.isCharging) this.releaseCharge();
    });

    // Nút Kho Đồ
    const fsBtn = this.rootEl.querySelector('#cbFsBtn') as HTMLButtonElement | null;
    // Đồng bộ icon fullscreen ngay khi gắn HUD
    window.dispatchEvent(new Event('fullscreenchange'));

    fsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const trigger = document.getElementById('startFsBtn') || document.getElementById('fsBtn');
      trigger?.click();
    });

    this.backpackBtn.addEventListener('click', () => {
      this.openBackpackModal();
    });

    // Nút đóng Kho Đồ
    const closeBpBtn = this.rootEl.querySelector('#cbCloseBackpackBtn') as HTMLButtonElement;
    closeBpBtn?.addEventListener('click', () => {
      this.closeBackpackModal();
    });

    // Nút Thoát
    this.exitBtn.addEventListener('click', () => {
      this.onExit?.();
    });

    // Bấm phím Space để quăng dây
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Xử lý modal cứu trợ
    const claimBtn = this.rootEl.querySelector('#cbClaimReliefBtn') as HTMLButtonElement;
    claimBtn?.addEventListener('click', () => {
      this.onClaimRelief?.();
    });

    const reliefExitBtn = this.rootEl.querySelector('#cbReliefExitBtn') as HTMLButtonElement;
    reliefExitBtn?.addEventListener('click', () => {
      this.hideReliefModal();
      this.onExit?.();
    });
  }

  public updateInventory(): void {
    this.renderQuickItemBar();
    this.renderBackpackList();
  }

  private renderQuickItemBar(): void {
    if (!this.quickItemsRow) return;
    this.quickItemsRow.innerHTML = '';

    for (const item of COWBOY_ITEMS_CATALOG) {
      const count = cowboyInventory.getCount(item.kind);
      const isEquipped = cowboyInventory.isEquipped(item.kind);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cb-quick-3d-slot ${isEquipped ? 'active' : ''} ${count === 0 ? 'empty' : ''}`;
      btn.innerHTML = `
        <div class="cb-item-3d-wrap">
          <div class="cb-item-3d-spinner">
            <span class="cb-item-3d-ico">${item.icon}</span>
          </div>
          <span class="cb-item-3d-pedestal"></span>
        </div>
        <span class="cb-item-qty-tag ${count > 0 ? 'has-qty' : ''}">x${count}</span>

        <!-- Floating Tooltip on Hover -->
        <div class="cb-item-tooltip">
          <div class="tt-header">
            <span class="tt-name">${item.nameVi}</span>
            <span class="tt-status ${isEquipped ? 'equipped' : (count > 0 ? 'ready' : 'empty')}">
              ${isEquipped ? 'ĐANG DÙNG' : (count > 0 ? 'SẴN SÀNG' : 'HẾT')}
            </span>
          </div>
          <p class="tt-desc">${item.descVi}</p>
          <div class="tt-footer">
            <span class="tt-effect">⚡ ${item.effectLabel}</span>
            <small class="tt-action">${count > 0 ? (isEquipped ? 'Bấm để hủy' : 'Bấm để kích hoạt') : 'Mở Cửa Hàng để mua'}</small>
          </div>
        </div>
      `;

      btn.addEventListener('click', () => {
        if (count <= 0) {
          this.showToast(t('cb_backpack_empty'), 2200);
          return;
        }

        // Handle instant use or equip toggle
        if (item.kind === 'time_clock') {
          if (cowboyInventory.consume('time_clock')) {
            this.addRoundSeconds(60);
            this.showToast('⏱️ <b>Đã dùng Đồng Hồ Gia Hạn:</b> +60 Giây vào vòng chơi!', 2500);
            this.updateInventory();
          }
        } else if (item.kind === 'rainbow_net') {
          if (isEquipped) {
            cowboyInventory.unequipForRound('rainbow_net');
            this.showToast('🌈 Đã bỏ kích hoạt Lưới Cầu Vồng.', 1800);
          } else {
            cowboyInventory.equipForRound('rainbow_net');
            this.showToast('🌈 <b>Đã kích hoạt Lưới Cầu Vồng!</b> Lần quăng tới sẽ quét sạch màn hình!', 2800);
          }
          this.updateInventory();
        } else {
          // Toggle round active
          if (isEquipped) {
            cowboyInventory.unequipForRound(item.kind);
            this.showToast(`Bỏ trang bị ${item.nameVi}.`, 1600);
          } else {
            cowboyInventory.equipForRound(item.kind);
            this.showToast(`✨ Đã kích hoạt <b>${item.nameVi}</b> (${item.effectLabel})!`, 2200);
          }
          this.updateInventory();
        }
      });

      this.quickItemsRow.appendChild(btn);
    }
  }

  private renderBackpackList(): void {
    if (!this.backpackGrid) return;
    this.backpackGrid.innerHTML = '';

    let totalOwned = 0;
    for (const item of COWBOY_ITEMS_CATALOG) {
      const count = cowboyInventory.getCount(item.kind);
      if (count > 0) {
        totalOwned += count;
        const card = document.createElement('div');
        card.className = 'cb-backpack-item';
        card.innerHTML = `
          <span class="bp-ico">${item.icon}</span>
          <div class="bp-info">
            <h4 class="bp-name">${item.nameVi}</h4>
            <span class="bp-count">${t('cb_owned_label')} <b>${count}</b></span>
            <small style="display:block;color:#d1b899;font-size:10px;margin-top:2px;">${item.effectLabel}</small>
          </div>
        `;
        this.backpackGrid.appendChild(card);
      }
    }

    if (totalOwned === 0) {
      const empty = document.createElement('div');
      empty.className = 'cb-backpack-empty-msg';
      empty.textContent = t('cb_backpack_empty');
      this.backpackGrid.appendChild(empty);
    }
  }

  public openBackpackModal(): void {
    this.renderBackpackList();
    this.backpackModal.hidden = false;
    this.isModalOpen = true;
  }

  public closeBackpackModal(): void {
    this.backpackModal.hidden = true;
    this.isModalOpen = false;
  }

  public addRoundSeconds(seconds: number): void {
    this.roundSecondsLeft += seconds;
    this.updateRoundTimerDisplay();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.rootEl.hidden) return;
    if (e.code === 'Space') {
      if (e.repeat) return;
      if (this.isModalOpen || this.isBusy) return;
      e.preventDefault();
      this.startCharge();
    } else if (e.code === 'Escape') {
      if (this.isModalOpen) {
        this.closeBackpackModal();
        this.hideReliefModal();
      } else {
        this.onExit?.();
      }
    } else if (e.key >= '1' && e.key <= '5') {
      if (!this.isModalOpen && !this.isBusy) {
        this.setBet(parseInt(e.key, 10));
        this.resetAutoLaunchTimer();
      }
    } else if (isCowboyAdminName() && (e.key === 'b' || e.key === 'B' || e.key === 'F2')) {
      if (!this.isModalOpen && !this.isBusy) {
        e.preventDefault();
        this.onOpenShop?.();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.rootEl.hidden) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.isCharging) {
        this.releaseCharge();
      }
    }
  };

  public setBusy(busy: boolean): void {
    this.isBusy = busy;
    if (busy) {
      this.launchBtn.disabled = true;
      this.launchBtn.style.opacity = '0.7';
    } else {
      this.launchBtn.disabled = false;
      this.launchBtn.style.opacity = '1';
      this.resetAutoLaunchTimer();
    }
  }

  public setBet(bet: number): void {
    this.currentBet = Math.max(1, Math.min(5, bet));
    for (const btn of this.betButtons) {
      const b = parseInt(btn.getAttribute('data-bet') || '1', 10);
      if (b === this.currentBet) {
        btn.classList.add('on');
      } else {
        btn.classList.remove('on');
      }
    }
    this.onBetChange?.(this.currentBet);
  }

  public getBet(): number {
    return this.currentBet;
  }

  public updateStats(credits: number, score: number, catches: number): void {
    this.creditValEl.textContent = String(credits);
    this.scoreValEl.textContent = String(score);
    this.catchesValEl.textContent = String(catches);
  }

  /** Khởi động đếm ngược 3 phút (hoặc 4 phút nếu có Đồng Hồ Gia Hạn) */
  public startRoundTimer(seconds = 180): void {
    this.stopRoundTimer();
    this.roundSecondsLeft = seconds;
    this.updateRoundTimerDisplay();

    this.roundTimerInterval = setInterval(() => {
      this.roundSecondsLeft--;
      this.updateRoundTimerDisplay();

      if (this.roundSecondsLeft <= 0) {
        this.stopRoundTimer();
        this.showToast('⏰ <b>HẾT GIỜ VÒNG CHƠI!</b> Chuyển về Cửa Hàng trang bị vật phẩm...', 2800);
        this.roundEndTimeout = setTimeout(() => {
          this.roundEndTimeout = null;
          this.onRoundEnd?.();
        }, 1200);
      }
    }, 1000);
  }

  public pauseRoundTimer(): void {
    if (this.roundTimerInterval) {
      clearInterval(this.roundTimerInterval);
      this.roundTimerInterval = null;
    }
  }

  public resumeRoundTimer(): void {
    if (this.roundTimerInterval || this.roundSecondsLeft <= 0) return;
    this.roundTimerInterval = setInterval(() => {
      this.roundSecondsLeft--;
      this.updateRoundTimerDisplay();

      if (this.roundSecondsLeft <= 0) {
        this.stopRoundTimer();
        this.showToast('⏰ <b>HẾT GIỜ VÒNG CHƠI!</b> Chuyển về Cửa Hàng trang bị vật phẩm...', 2800);
        this.roundEndTimeout = setTimeout(() => {
          this.roundEndTimeout = null;
          this.onRoundEnd?.();
        }, 1200);
      }
    }, 1000);
  }

  public stopRoundTimer(): void {
    if (this.roundTimerInterval) {
      clearInterval(this.roundTimerInterval);
      this.roundTimerInterval = null;
    }
    if (this.roundEndTimeout) {
      clearTimeout(this.roundEndTimeout);
      this.roundEndTimeout = null;
    }
  }

  private updateRoundTimerDisplay(): void {
    const s = Math.max(0, this.roundSecondsLeft);
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    this.roundTimerValEl.textContent = `${mm}:${ss}`;

    if (s <= 30) {
      this.roundTimerBox.classList.add('danger');
    } else {
      this.roundTimerBox.classList.remove('danger');
    }
  }

  /** Đếm ngược 10s tự động phóng dây khi người chơi không thao tác */
  private startAutoLaunchTimer(): void {
    this.stopAutoLaunchTimer();
    this.autoLaunchSecondsLeft = 10;
    this.updateAutoLaunchDisplay();

    this.autoLaunchInterval = setInterval(() => {
      if (document.hidden || this.isBusy || this.isModalOpen || this.rootEl.hidden || this.isCharging) return;

      this.autoLaunchSecondsLeft--;
      this.updateAutoLaunchDisplay();

      if (this.autoLaunchSecondsLeft <= 0) {
        this.autoLaunchSecondsLeft = 10;
        this.updateAutoLaunchDisplay();
        this.onLaunch?.(this.currentBet);
      }
    }, 1000);
  }

  public resetAutoLaunchTimer(): void {
    this.autoLaunchSecondsLeft = 10;
    this.updateAutoLaunchDisplay();
  }

  private stopAutoLaunchTimer(): void {
    if (this.autoLaunchInterval) {
      clearInterval(this.autoLaunchInterval);
      this.autoLaunchInterval = null;
    }
  }

  private updateAutoLaunchDisplay(): void {
    if (this.autoCountdownValEl) {
      this.autoCountdownValEl.textContent = String(this.autoLaunchSecondsLeft);
    }
  }

  /** Hiển thị chữ nổi bay lên khi kéo dính hoặc tuột mất */
  public showFloatText(text: string, type: 'win' | 'miss' | 'jackpot', screenX: number, screenY: number): void {
    const el = document.createElement('div');
    el.className = `cb-float-item ${type}`;
    el.textContent = text;
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    this.floatContainer.appendChild(el);

    const tid = setTimeout(() => {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    }, 1300);
    this.activeTimeouts.push(tid);
  }

  /** Thông báo toast */
  public showToast(msg: string, duration = 2200): void {
    const el = document.createElement('div');
    el.className = 'cb-toast-item';
    el.innerHTML = msg;
    this.toastBox.appendChild(el);

    const tid = setTimeout(() => {
      el.classList.add('fade-out');
      const innerTid = setTimeout(() => {
        if (el.parentElement) el.parentElement.removeChild(el);
      }, 350);
      this.activeTimeouts.push(innerTid);
    }, duration);
    this.activeTimeouts.push(tid);
  }

  /** Hiển thị modal nhận cứu trợ */
  public showReliefModal(remainingToday: number): void {
    const modal = this.rootEl.querySelector('#cbReliefModal') as HTMLElement;
    const msgEl = this.rootEl.querySelector('#cbReliefMsg') as HTMLElement;
    const claimBtn = this.rootEl.querySelector('#cbClaimReliefBtn') as HTMLButtonElement;

    this.isModalOpen = true;

    if (remainingToday > 0) {
      msgEl.innerHTML = `Bạn đã hết credit! Nhận ngay <b>5 Credit cứu trợ</b> để chơi tiếp (Hôm nay còn ${remainingToday} lần).`;
      claimBtn.hidden = false;
    } else {
      msgEl.innerHTML = `Bạn đã dùng hết lượt cứu trợ hôm nay. Hãy quay lại vào ngày mai để nhận thêm <b>20 Credit miễn phí</b> nhé!`;
      claimBtn.hidden = true;
    }

    modal.hidden = false;
  }

  public hideReliefModal(): void {
    const modal = this.rootEl.querySelector('#cbReliefModal') as HTMLElement;
    modal.hidden = true;
    this.isModalOpen = false;
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.stopRoundTimer();
    this.stopAutoLaunchTimer();
    for (const tid of this.activeTimeouts) {
      clearTimeout(tid);
    }
    this.activeTimeouts = [];
    if (this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
  }
}
