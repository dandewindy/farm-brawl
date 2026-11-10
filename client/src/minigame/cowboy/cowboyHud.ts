import { t } from '../../i18n';
import { copyTextToClipboard } from '../../ui/hud';
import { COWBOY_ITEMS_CATALOG, cowboyInventory } from './cowboyItems';
import { HORSE_COWBOY_SVG, isCowboyAdminName } from './cowboyTypes';
import type { CowboySubMode } from '@shared/protocol';

export class CowboyHud {
  public rootEl: HTMLElement;

  private creditValEl!: HTMLElement;
  private scoreValEl!: HTMLElement;
  private catchesValEl!: HTMLElement;
  private roundTimerBox!: HTMLElement;
  private roundTimerValEl!: HTMLElement;
  private autoCountdownValEl!: HTMLElement;
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
  private isP2Busy = false;

  // Game Modes State: Campaign vs 2-Player Hybrid (Same-Device + Online Handover)
  private isTwoPlayerMode = false;
  private subMode: CowboySubMode = 'versus';
  private roomCode = '';
  private mySlot: 0 | 1 = 0;
  private guestConnected = false;
  private p1Name = 'Người chơi 1';
  private p2Name = 'Người chơi 2';
  private p1Bet = 1;
  private p2Bet = 1;

  public onP2ChargeStart?: () => void;
  public onP2Launch?: (isAimCharge: boolean, durationMs: number) => void;
  public onP2BetChange?: (bet: number) => void;
  public onRetryFromStage1?: () => void;
  public onVersusRematch?: () => void;
  private activeTimeouts: any[] = [];

  // Round Timer
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
  private isChargingP2 = false;
  private chargeStartTimeP2 = 0;
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
      <div class="cowboy-top-bar" id="cbTopBar">
        <div class="cowboy-title-box" id="cb1PTitleBox">
          <span class="cowboy-ico">${HORSE_COWBOY_SVG}</span>
          <div class="cowboy-title-group">
            <span class="cowboy-title" data-i18n="cb_title">CAO BỒI KÉO BÒ</span>
          </div>
        </div>

        <div class="cowboy-stats-bar" id="cbStatsBar">
          <div class="cowboy-stat-box room-code" id="cbRoomCodeBox" title="Bấm để sao chép mã phòng mời bạn bè" hidden>
            <span class="c-lbl">MÃ PHÒNG</span>
            <span class="c-val"><span id="cbHudRoomCodeVal">----</span> 📋</span>
          </div>
          <div class="cowboy-stat-box stage" id="cbStageBox">
            <span class="c-lbl" data-i18n="cb_stage">MÀN</span>
            <span class="c-val" id="cbStageVal">1</span>
          </div>
          <div class="cowboy-stat-box round-timer" id="cbRoundTimerBox">
            <span class="c-lbl" data-i18n="cb_time">THỜI GIAN</span>
            <span class="c-val" id="cbRoundTimerVal">01:30</span>
          </div>
          <div class="cowboy-stat-box credit" id="cbCreditBox" title="Credit kiếm được từ thú, dùng mua hàng và ném dây">
            <span class="c-lbl">CREDIT</span>
            <span class="c-val" id="cbCreditsVal">20</span>
          </div>
          <div class="cowboy-stat-box p1-score" id="cbP1ScoreBox" hidden>
            <span class="c-lbl" id="cbP1ScoreLbl">P1 - You</span>
            <span class="c-val" id="cbP1ScoreVal">0</span>
          </div>
          <div class="cowboy-stat-box p2-score" id="cbP2ScoreBox" hidden>
            <span class="c-lbl" id="cbP2ScoreLbl">P2 Đang đợi</span>
            <span class="c-val" id="cbP2ScoreVal">0</span>
          </div>
          <div class="cowboy-stat-box score" id="cbScoreBox">
            <span class="c-lbl" data-i18n="cb_score">MỤC TIÊU</span>
            <span class="c-val"><span id="cbScoreVal">0</span> / <span id="cbTargetVal">80</span></span>
            <div class="cb-score-progress-bar"><div class="cb-score-progress-fill" id="cbScoreFill" style="width: 0%;"></div></div>
          </div>
          <div class="cowboy-stat-box catches" id="cbCatchesBox">
            <span class="c-lbl" data-i18n="cb_catches">ĐÃ BẮT</span>
            <span class="c-val" id="cbCatchesVal">0</span>
          </div>
        </div>

        <!-- 2-PLAYER DEDICATED CLEAN TOP HUD: P1 Div (Left) | Open Shared Info (Center) | P2 Div (Right) -->
        <div class="cb-2p-top-hud" id="cb2PTopHud" hidden>
          <!-- Bên trái: 1 Div duy nhất cho Người chơi 1 -->
          <div class="cb-2p-player-card p1" id="cb2PPlayerCard1">
            <div class="cb-2p-card-head">
              <span class="p-dot p1"></span>
              <span class="p-title" id="cb2PP1Title">P1 - You</span>
            </div>
            <div class="cb-2p-card-metrics">
              <span>Điểm <b id="cb2PP1Score">0</b></span>
              <i class="sep">•</i>
              <span>Bắt <b id="cb2PP1Catches">0</b></span>
              <i class="sep">•</i>
              <span>🪙 <b id="cb2PP1Credits">20</b></span>
            </div>
          </div>

          <!-- Ở giữa: Nền trống thông thoáng, hiển thị Thời gian + Mã phòng (+ Mục tiêu nếu Chinh phục màn) -->
          <div class="cb-2p-top-center" id="cb2PTopCenter">
            <div class="cb-2p-open-timer" id="cb2PRoundTimerVal">01:30</div>
            <button type="button" class="cb-2p-open-room" id="cb2PRoomCodeBtn" title="Bấm để sao chép mã phòng">
              Phòng: <b id="cb2PRoomCodeVal">----</b> 📋
            </button>
            <div class="cb-2p-open-coop" id="cb2PCoopInfo" hidden>
              Màn <b id="cb2PStageVal">1</b> • Mục tiêu <b id="cb2PCoopScoreVal">0</b>/<b id="cb2PCoopTargetVal">120</b>
            </div>
          </div>

          <!-- Bên phải: 1 Div duy nhất cho Người chơi 2 -->
          <div class="cb-2p-player-card p2" id="cb2PPlayerCard2">
            <div class="cb-2p-card-head">
              <span class="p-dot p2"></span>
              <span class="p-title" id="cb2PP2Title">P2 Đang đợi</span>
            </div>
            <div class="cb-2p-card-metrics">
              <span>Điểm <b id="cb2PP2Score">0</b></span>
              <i class="sep">•</i>
              <span>Bắt <b id="cb2PP2Catches">0</b></span>
              <i class="sep">•</i>
              <span>🪙 <b id="cb2PP2Credits">20</b></span>
            </div>
          </div>
        </div>

        <div class="cowboy-top-actions" id="cbTopActions">
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

      <!-- Bottom Arcade Controls: 1P Card vs 2P Card (2 Bên Trái Phải) -->
      <div class="cowboy-bottom-bar">
        <!-- 1P CONTROLS CARD -->
        <div class="cowboy-controls-card" id="cb1PControlsCard">
          <!-- CỘT TRÁI: Kho vật phẩm 3D xoay vòng -->
          <div class="cb-ctrl-col cb-ctrl-left" id="cbQuickItemBar">
            <div class="cb-col-label">
              <span class="ico">🎒</span>
              <span data-i18n="cb_quick_items">VẬT PHẨM</span>
            </div>
            <div class="cb-quick-items-row" id="cbQuickItemsRow"></div>
          </div>

          <!-- CỘT GIỮA / PHẢI: Nút Phụ Vòng Tròn Đổi Dây + Nút Quăng Dây Đỏ Tròn -->
          <div class="cb-ctrl-col cb-ctrl-center cb-1p-action-cluster">
            <div class="cb-action-pair">
              <button type="button" id="cbCycleBetBtn" class="cb-rope-circle-btn active" title="Bấm để đổi số dây (1-5)">
                <span class="rope-num" id="cbCycleBetVal">1 DÂY</span>
                <small class="rope-sub" id="cbCycleBetCost">1 C</small>
              </button>
              <button type="button" id="cbLaunchBtn" class="cowboy-red-button cb-launch-circle-btn" title="Nhấn nhanh để quăng ngay, hoặc nhấn giữ gồng để canh cự ly xa gần">
                <div class="btn-top">
                  <span class="txt" data-i18n="cb_launch_btn">QUĂNG DÂY</span>
                </div>
              </button>
            </div>
            <div id="cbAutoLaunchHint" class="cb-auto-launch-hint">
              <span data-i18n="cb_auto_throw_hint">Tự động sau:</span> <span id="cbAutoCountdown">10</span> s
            </div>
          </div>
        </div>

        <!-- 2P CONTROLS CARD (2 bên Trái Phải gọn gàng: Nhãn P1 - You / P2 Đang đợi + Nút phụ vòng tròn đổi dây cạnh nút quăng dây) -->
        <div class="cowboy-controls-card mode-2p cb-card-hidden" id="cb2PControlsCard">
          <!-- P1 ZONE (BÊN TRÁI) -->
          <div class="cb-2p-player-zone p1-zone" id="cbP1Zone">
            <div class="cb-2p-status-badge local" id="cbP1StatusBadge">P1 - You</div>
            <div class="cb-2p-zone-controls" id="cbP1ControlsGroup">
              <button type="button" id="cbP1CycleBetBtn" class="cb-rope-circle-btn active" title="Bấm để đổi lần lượt số lượng dây (1-5)">
                <span class="rope-num" id="cbP1CycleVal">1 DÂY</span>
                <small class="rope-sub" id="cbP1CycleCost">1 C</small>
              </button>
              <button type="button" id="cbP1LaunchBtn" class="cowboy-red-button cb-launch-circle-btn" title="Nhấn hoặc giữ để quăng dây">
                <div class="btn-top">
                  <span class="txt">QUĂNG DÂY</span>
                </div>
              </button>
            </div>
          </div>

          <!-- P2 ZONE (BÊN PHẢI) -->
          <div class="cb-2p-player-zone p2-zone" id="cbP2Zone">
            <div class="cb-2p-status-badge waiting" id="cbP2StatusBadge">P2 Đang đợi</div>
            <div class="cb-2p-zone-controls" id="cbP2ControlsGroup">
              <button type="button" id="cbP2LaunchBtn" class="cowboy-red-button cb-launch-circle-btn" title="Nhấn hoặc giữ để quăng dây">
                <div class="btn-top">
                  <span class="txt">QUĂNG DÂY</span>
                </div>
              </button>
              <button type="button" id="cbP2CycleBetBtn" class="cb-rope-circle-btn active" title="Bấm để đổi lần lượt số lượng dây (1-5)">
                <span class="rope-num" id="cbP2CycleVal">1 DÂY</span>
                <small class="rope-sub" id="cbP2CycleCost">1 C</small>
              </button>
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

      <!-- Modal Thua Cuộc Chưa Đủ Điểm Qua Màn -->
      <div id="cbDefeatModal" class="cowboy-modal-wrap" hidden>
        <div class="cowboy-modal-card">
          <div class="cm-icon">⚠️</div>
          <h3 class="cm-title" style="color:#ff6b6b;">CHƯA ĐỦ ĐIỂM QUA MÀN!</h3>
          <p id="cbDefeatMsg" class="cm-desc">Bạn đạt <b>0 / 80 điểm</b> ở Màn 1. Cố lên, hãy thử lại để phục thù nào!</p>
          <div class="cm-actions">
            <button type="button" id="cbRetryBtn" class="cb-btn-relief">CHƠI LẠI TỪ MÀN 1</button>
            <button type="button" id="cbDefeatExitBtn" class="cb-btn-exit" data-i18n="cb_exit">VỀ SẢNH CHÍNH</button>
          </div>
        </div>
      </div>

      <!-- Modal Kết Quả Thi Đấu Đối Kháng 2 Người -->
      <div id="cbVersusResultModal" class="cowboy-modal-wrap" hidden>
        <div class="cowboy-modal-card cb-versus-modal-card">
          <div class="cm-icon" id="cbVersusIcon">🏆</div>
          <h3 class="cm-title" id="cbVersusTitle">P1 CHIẾN THẮNG!</h3>
          <p class="cm-desc" id="cbVersusDesc">Kết quả chung cuộc sau thời gian thi đấu đối kháng</p>
          <div class="cb-versus-cards">
            <div class="cb-v-card p1" id="cbVersusCardP1">
              <span class="cb-v-badge p1" id="cbVersusNameP1">🟦 P1 (TRÁI)</span>
              <div class="cb-v-score" id="cbVersusScoreP1">0</div>
              <span class="cb-v-unit">ĐIỂM</span>
              <span class="cb-v-catches" id="cbVersusCatchesP1">Đã bắt: 0 thú</span>
            </div>
            <div class="cb-v-vs">VS</div>
            <div class="cb-v-card p2" id="cbVersusCardP2">
              <span class="cb-v-badge p2" id="cbVersusNameP2">🟥 P2 (PHẢI)</span>
              <div class="cb-v-score" id="cbVersusScoreP2">0</div>
              <span class="cb-v-unit">ĐIỂM</span>
              <span class="cb-v-catches" id="cbVersusCatchesP2">Đã bắt: 0 thú</span>
            </div>
          </div>
          <div class="cm-actions">
            <button type="button" id="cbVersusRematchBtn" class="cb-btn-relief">🔄 ĐẤU LẠI VÁN MỚI</button>
            <button type="button" id="cbVersusExitBtn" class="cb-btn-exit">VỀ SẢNH CHÍNH</button>
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
    this.adminShopBtn = this.rootEl.querySelector('#cbAdminShopBtn')!;
    this.backpackBtn = this.rootEl.querySelector('#cbBackpackBtn')!;
    this.exitBtn = this.rootEl.querySelector('#cbExitBtn')!;
    this.toastBox = this.rootEl.querySelector('#cbToastBox')!;
    this.floatContainer = this.rootEl.querySelector('#cbFloatContainer')!;
    this.quickItemsRow = this.rootEl.querySelector('#cbQuickItemsRow')!;
    this.backpackModal = this.rootEl.querySelector('#cbBackpackModal')!;
    this.backpackGrid = this.rootEl.querySelector('#cbBackpackGrid')!;
  }

  private canControlSlotLocally(slot: 0 | 1): boolean {
    if (!this.isTwoPlayerMode) return slot === 0;
    if (this.mySlot === 1) return slot === 1;
    // Host (mySlot === 0): controls P1 always, and controls P2 only when Guest is not connected
    if (slot === 0) return true;
    return !this.guestConnected;
  }

  private startCharge(): void {
    if (this.isModalOpen || this.isBusy || this.isCharging) return;
    if (this.isTwoPlayerMode && !this.canControlSlotLocally(0)) return;
    this.isCharging = true;
    this.chargeStartTime = performance.now();
    this.launchBtn.classList.add('is-charging');
    const p1Btn = this.rootEl.querySelector('#cbP1LaunchBtn');
    p1Btn?.classList.add('is-charging');
    this.onChargeStart?.();
  }

  private releaseCharge(): void {
    if (!this.isCharging) return;
    this.isCharging = false;
    this.launchBtn.classList.remove('is-charging');
    const p1Btn = this.rootEl.querySelector('#cbP1LaunchBtn');
    p1Btn?.classList.remove('is-charging');
    const duration = performance.now() - this.chargeStartTime;
    this.resetAutoLaunchTimer();
    this.launchBtn.classList.add('is-pressed');
    p1Btn?.classList.add('is-pressed');
    const tid = setTimeout(() => {
      this.launchBtn.classList.remove('is-pressed');
      p1Btn?.classList.remove('is-pressed');
    }, 120);
    this.activeTimeouts.push(tid);

    if (duration > 120) {
      this.onChargeRelease?.(duration);
    } else {
      this.onLaunch?.(this.currentBet);
    }
  }

  private startChargeP2(): void {
    if (!this.isTwoPlayerMode || this.isModalOpen || this.isP2Busy || this.isChargingP2) return;
    if (!this.canControlSlotLocally(1)) return;
    this.isChargingP2 = true;
    this.chargeStartTimeP2 = performance.now();
    const p2Btn = this.rootEl.querySelector('#cbP2LaunchBtn');
    p2Btn?.classList.add('is-charging');
    this.onP2ChargeStart?.();
  }

  private releaseChargeP2(): void {
    if (!this.isChargingP2) return;
    this.isChargingP2 = false;
    const p2Btn = this.rootEl.querySelector('#cbP2LaunchBtn');
    p2Btn?.classList.remove('is-charging');
    const duration = performance.now() - this.chargeStartTimeP2;
    p2Btn?.classList.add('is-pressed');
    const tid = setTimeout(() => p2Btn?.classList.remove('is-pressed'), 120);
    this.activeTimeouts.push(tid);

    this.onP2Launch?.(duration > 120, duration);
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

    // Copy room code from top bar (both 1P/legacy box and 2P center button)
    const copyRoomAction = async () => {
      if (!this.roomCode) return;
      await copyTextToClipboard(this.roomCode);
      this.showToast(`📋 Đã sao chép mã phòng: <b>${this.roomCode}</b>`, 2000);
    };
    const roomCodeBox = this.rootEl.querySelector('#cbRoomCodeBox') as HTMLElement | null;
    roomCodeBox?.addEventListener('click', copyRoomAction);
    const roomCodeBtn2P = this.rootEl.querySelector('#cb2PRoomCodeBtn') as HTMLElement | null;
    roomCodeBtn2P?.addEventListener('click', copyRoomAction);

    // Nút chọn mức cược xoay vòng thu gọn (1P)
    const cycleBtn = this.rootEl.querySelector('#cbCycleBetBtn') as HTMLButtonElement | null;
    cycleBtn?.addEventListener('click', () => {
      if (this.isBusy || this.isModalOpen) return;
      this.cycleBet(0);
      this.resetAutoLaunchTimer();
    });

    // 2-Player controls bindings
    const p1CycleBtn = this.rootEl.querySelector('#cbP1CycleBetBtn') as HTMLButtonElement | null;
    p1CycleBtn?.addEventListener('click', () => {
      if (this.isBusy || this.isModalOpen || !this.canControlSlotLocally(0)) return;
      this.cycleBet(0);
    });

    const p2CycleBtn = this.rootEl.querySelector('#cbP2CycleBetBtn') as HTMLButtonElement | null;
    p2CycleBtn?.addEventListener('click', () => {
      if (this.isP2Busy || this.isModalOpen || !this.canControlSlotLocally(1)) return;
      this.cycleBet(1);
    });

    const p1LaunchBtn = this.rootEl.querySelector('#cbP1LaunchBtn') as HTMLButtonElement | null;
    p1LaunchBtn?.addEventListener('pointerdown', (e) => {
      if (!this.isTwoPlayerMode || this.isModalOpen || this.isBusy || !this.canControlSlotLocally(0)) return;
      e.preventDefault();
      this.startCharge();
    });

    const p2LaunchBtn = this.rootEl.querySelector('#cbP2LaunchBtn') as HTMLButtonElement | null;
    p2LaunchBtn?.addEventListener('pointerdown', (e) => {
      if (!this.isTwoPlayerMode || this.isModalOpen || this.isP2Busy || !this.canControlSlotLocally(1)) return;
      e.preventDefault();
      this.startChargeP2();
    });

    // Defeat modal buttons
    const retryBtn = this.rootEl.querySelector('#cbRetryBtn') as HTMLButtonElement | null;
    retryBtn?.addEventListener('click', () => {
      this.hideDefeatModal();
      this.onRetryFromStage1?.();
    });

    const defeatExitBtn = this.rootEl.querySelector('#cbDefeatExitBtn') as HTMLButtonElement | null;
    defeatExitBtn?.addEventListener('click', () => {
      this.hideDefeatModal();
      this.onExit?.();
    });

    // Versus result modal buttons
    const versusRematchBtn = this.rootEl.querySelector('#cbVersusRematchBtn') as HTMLButtonElement | null;
    versusRematchBtn?.addEventListener('click', () => {
      this.hideVersusResultModal();
      this.onVersusRematch?.();
    });

    const versusExitBtn = this.rootEl.querySelector('#cbVersusExitBtn') as HTMLButtonElement | null;
    versusExitBtn?.addEventListener('click', () => {
      this.hideVersusResultModal();
      this.onExit?.();
    });

    // Nút Quăng dây 1P
    this.launchBtn.addEventListener('pointerdown', (e) => {
      if (this.isTwoPlayerMode || this.isModalOpen || this.isBusy) return;
      e.preventDefault();
      this.startCharge();
    });

    window.addEventListener('pointerup', () => {
      if (this.isCharging) this.releaseCharge();
      if (this.isChargingP2) this.releaseChargeP2();
    });

    window.addEventListener('pointercancel', () => {
      if (this.isCharging) this.releaseCharge();
      if (this.isChargingP2) this.releaseChargeP2();
    });

    // Nút Fullscreen
    const fsBtn = this.rootEl.querySelector('#cbFsBtn') as HTMLButtonElement | null;
    window.dispatchEvent(new Event('fullscreenchange'));

    fsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const trigger = document.getElementById('startFsBtn') || document.getElementById('fsBtn');
      trigger?.click();
    });

    this.backpackBtn.addEventListener('click', () => {
      this.openBackpackModal();
    });

    const closeBpBtn = this.rootEl.querySelector('#cbCloseBackpackBtn') as HTMLButtonElement;
    closeBpBtn?.addEventListener('click', () => {
      this.closeBackpackModal();
    });

    this.exitBtn.addEventListener('click', () => {
      this.onExit?.();
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

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

  public setRoundSeconds(seconds: number): void {
    this.roundSecondsLeft = Math.max(0, Math.floor(seconds));
    this.updateRoundTimerDisplay();
  }

  public getRoundSeconds(): number {
    return this.roundSecondsLeft;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.rootEl.hidden) return;
    if (e.code === 'Space') {
      if (e.repeat) return;
      if (this.isModalOpen) return;
      e.preventDefault();
      if (this.isTwoPlayerMode && this.mySlot === 1) {
        this.startChargeP2();
      } else {
        this.startCharge();
      }
    } else if (e.code === 'KeyQ') {
      if (!this.isModalOpen) {
        if (this.isTwoPlayerMode && this.mySlot === 1) {
          if (!this.isP2Busy) this.cycleBet(1);
        } else if (!this.isBusy && this.canControlSlotLocally(0)) {
          this.cycleBet(0);
          this.resetAutoLaunchTimer();
        }
      }
    } else if (e.code === 'KeyP') {
      if (!this.isModalOpen && this.canControlSlotLocally(1) && !this.isP2Busy) {
        this.cycleBet(1);
      }
    } else if (e.code === 'Enter') {
      if (e.repeat) return;
      if (this.isTwoPlayerMode && !this.isModalOpen && this.canControlSlotLocally(1)) {
        e.preventDefault();
        this.startChargeP2();
      }
    } else if (e.code === 'Escape') {
      if (this.isModalOpen) {
        this.closeBackpackModal();
        this.hideReliefModal();
      } else {
        this.onExit?.();
      }
    } else if (e.key >= '1' && e.key <= '5') {
      if (!this.isModalOpen) {
        const targetSlot: 0 | 1 = (this.isTwoPlayerMode && this.mySlot === 1) ? 1 : 0;
        if (this.canControlSlotLocally(targetSlot)) {
          this.setBet(parseInt(e.key, 10), targetSlot);
          this.resetAutoLaunchTimer();
        }
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
      if (this.isCharging) this.releaseCharge();
      if (this.isChargingP2) this.releaseChargeP2();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      if (this.isChargingP2) this.releaseChargeP2();
    }
  };

  public setBusy(busy: boolean, playerIndex = 0): void {
    if (playerIndex === 1) {
      this.isP2Busy = busy;
      const p2Btn = this.rootEl.querySelector('#cbP2LaunchBtn') as HTMLButtonElement | null;
      if (p2Btn && this.canControlSlotLocally(1)) {
        p2Btn.disabled = busy;
        p2Btn.style.opacity = busy ? '0.7' : '1';
      }
      return;
    }
    this.isBusy = busy;
    const p1Btn = this.rootEl.querySelector('#cbP1LaunchBtn') as HTMLButtonElement | null;
    if (busy) {
      this.launchBtn.disabled = true;
      this.launchBtn.style.opacity = '0.7';
      if (p1Btn && this.canControlSlotLocally(0)) {
        p1Btn.disabled = true;
        p1Btn.style.opacity = '0.7';
      }
    } else {
      this.launchBtn.disabled = false;
      this.launchBtn.style.opacity = '1';
      if (p1Btn && this.canControlSlotLocally(0)) {
        p1Btn.disabled = false;
        p1Btn.style.opacity = '1';
      }
      this.resetAutoLaunchTimer();
    }
  }

  public cycleBet(playerIndex = 0): number {
    if (playerIndex === 0) {
      this.p1Bet = (this.p1Bet % 5) + 1;
      this.currentBet = this.p1Bet;
      this.updateCycleBetDisplay(0, this.p1Bet);
      this.onBetChange?.(this.p1Bet);
      return this.p1Bet;
    } else {
      this.p2Bet = (this.p2Bet % 5) + 1;
      this.updateCycleBetDisplay(1, this.p2Bet);
      this.onP2BetChange?.(this.p2Bet);
      return this.p2Bet;
    }
  }

  private updateCycleBetDisplay(playerIndex: number, bet: number): void {
    if (playerIndex === 0) {
      const valEl = this.rootEl.querySelector('#cbCycleBetVal');
      const costEl = this.rootEl.querySelector('#cbCycleBetCost');
      if (valEl) valEl.textContent = `${bet} DÂY`;
      if (costEl) costEl.textContent = `${bet} C`;
      const p1Val = this.rootEl.querySelector('#cbP1CycleVal');
      const p1Cost = this.rootEl.querySelector('#cbP1CycleCost');
      if (p1Val) p1Val.textContent = `${bet} DÂY`;
      if (p1Cost) p1Cost.textContent = `${bet} C`;
    } else {
      const p2Val = this.rootEl.querySelector('#cbP2CycleVal');
      const p2Cost = this.rootEl.querySelector('#cbP2CycleCost');
      if (p2Val) p2Val.textContent = `${bet} DÂY`;
      if (p2Cost) p2Cost.textContent = `${bet} C`;
    }
  }

  public setBet(bet: number, playerIndex = 0, silent = false): void {
    const clamped = Math.max(1, Math.min(5, bet));
    if (playerIndex === 0) {
      this.p1Bet = clamped;
      this.currentBet = clamped;
      this.updateCycleBetDisplay(0, clamped);
      if (!silent) this.onBetChange?.(clamped);
    } else {
      this.p2Bet = clamped;
      this.updateCycleBetDisplay(1, clamped);
      if (!silent) this.onP2BetChange?.(clamped);
    }
  }

  public getBet(playerIndex = 0): number {
    return playerIndex === 0 ? this.p1Bet : this.p2Bet;
  }

  public setTwoPlayerMode(enabled: boolean, subMode: CowboySubMode = 'versus', roomCode = ''): void {
    this.isTwoPlayerMode = enabled;
    this.subMode = subMode;
    this.roomCode = roomCode;

    const topBar = this.rootEl.querySelector('#cbTopBar') as HTMLElement | null;
    const titleBox1P = this.rootEl.querySelector('#cb1PTitleBox') as HTMLElement | null;
    const statsBar1P = this.rootEl.querySelector('#cbStatsBar') as HTMLElement | null;
    const topHud2P = this.rootEl.querySelector('#cb2PTopHud') as HTMLElement | null;
    const roomCodeVal2P = this.rootEl.querySelector('#cb2PRoomCodeVal') as HTMLElement | null;
    const coopInfo2P = this.rootEl.querySelector('#cb2PCoopInfo') as HTMLElement | null;

    const card1P = this.rootEl.querySelector('#cb1PControlsCard') as HTMLElement | null;
    const card2P = this.rootEl.querySelector('#cb2PControlsCard') as HTMLElement | null;
    const roomCodeBox = this.rootEl.querySelector('#cbRoomCodeBox') as HTMLElement | null;
    const roomCodeVal = this.rootEl.querySelector('#cbHudRoomCodeVal') as HTMLElement | null;
    const stageBox = this.rootEl.querySelector('#cbStageBox') as HTMLElement | null;
    const scoreBox = this.rootEl.querySelector('#cbScoreBox') as HTMLElement | null;
    const p1ScoreBox = this.rootEl.querySelector('#cbP1ScoreBox') as HTMLElement | null;
    const p2ScoreBox = this.rootEl.querySelector('#cbP2ScoreBox') as HTMLElement | null;

    topBar?.classList.toggle('mode-2p-top', enabled);
    if (titleBox1P) {
      titleBox1P.hidden = enabled;
      titleBox1P.style.setProperty('display', enabled ? 'none' : '', 'important');
    }
    if (statsBar1P) {
      statsBar1P.hidden = enabled;
      statsBar1P.style.setProperty('display', enabled ? 'none' : '', 'important');
    }
    if (topHud2P) {
      topHud2P.hidden = !enabled;
      topHud2P.style.setProperty('display', enabled ? 'grid' : 'none', 'important');
    }
    if (roomCodeVal2P) roomCodeVal2P.textContent = roomCode || '----';
    if (coopInfo2P) {
      coopInfo2P.hidden = !enabled || subMode !== 'campaign';
      coopInfo2P.style.setProperty('display', (!enabled || subMode !== 'campaign') ? 'none' : 'inline-block', 'important');
    }

    // In 2P mode, hide bulky mid-round Shop/Backpack buttons so top bar stays clean & uncluttered
    if (this.backpackBtn) {
      this.backpackBtn.hidden = enabled;
      this.backpackBtn.style.setProperty('display', enabled ? 'none' : '', 'important');
    }
    if (this.adminShopBtn) {
      const showAdmin = !enabled && isCowboyAdminName();
      this.adminShopBtn.hidden = !showAdmin;
      this.adminShopBtn.style.setProperty('display', showAdmin ? 'inline-flex' : 'none', 'important');
    }

    if (card1P) {
      card1P.classList.toggle('cb-card-hidden', enabled);
      card1P.hidden = enabled;
      card1P.style.setProperty('display', enabled ? 'none' : '', 'important');
    }
    if (card2P) {
      card2P.classList.toggle('cb-card-hidden', !enabled);
      card2P.hidden = !enabled;
      card2P.style.setProperty('display', !enabled ? 'none' : '', 'important');
      card2P.classList.toggle('slot-p1', this.mySlot === 0);
      card2P.classList.toggle('slot-p2', this.mySlot === 1);
    }

    if (roomCodeBox) {
      roomCodeBox.hidden = !enabled || !roomCode;
      if (roomCodeVal && roomCode) roomCodeVal.textContent = roomCode;
    }

    if (p1ScoreBox) p1ScoreBox.hidden = !enabled;
    if (p2ScoreBox) p2ScoreBox.hidden = !enabled;

    const showCampaignTarget = !enabled || subMode === 'campaign';
    if (stageBox) stageBox.hidden = !showCampaignTarget;
    if (scoreBox) scoreBox.hidden = !showCampaignTarget;
  }

  public set2PControlState(mySlot: 0 | 1, guestConnected: boolean, p1Name: string, p2Name: string): void {
    this.mySlot = mySlot;
    this.guestConnected = guestConnected;
    this.p1Name = p1Name || 'P1';
    this.p2Name = p2Name || 'P2';

    const card2P = this.rootEl.querySelector('#cb2PControlsCard') as HTMLElement | null;
    if (card2P) {
      card2P.classList.toggle('slot-p1', mySlot === 0);
      card2P.classList.toggle('slot-p2', mySlot === 1);
    }

    const p1Zone = this.rootEl.querySelector('#cbP1Zone') as HTMLElement | null;
    const p2Zone = this.rootEl.querySelector('#cbP2Zone') as HTMLElement | null;
    const p1CycleBtn = this.rootEl.querySelector('#cbP1CycleBetBtn') as HTMLButtonElement | null;
    const p1LaunchBtn = this.rootEl.querySelector('#cbP1LaunchBtn') as HTMLButtonElement | null;
    const p2CycleBtn = this.rootEl.querySelector('#cbP2CycleBetBtn') as HTMLButtonElement | null;
    const p2LaunchBtn = this.rootEl.querySelector('#cbP2LaunchBtn') as HTMLButtonElement | null;
    const p1Status = this.rootEl.querySelector('#cbP1StatusBadge') as HTMLElement | null;
    const p2Status = this.rootEl.querySelector('#cbP2StatusBadge') as HTMLElement | null;
    const p1TopTitle = this.rootEl.querySelector('#cb2PP1Title') as HTMLElement | null;
    const p2TopTitle = this.rootEl.querySelector('#cb2PP2Title') as HTMLElement | null;
    const p1Card = this.rootEl.querySelector('#cb2PPlayerCard1') as HTMLElement | null;
    const p2Card = this.rootEl.querySelector('#cb2PPlayerCard2') as HTMLElement | null;

    const p1Label = mySlot === 0 ? 'P1 - You' : `P1 - ${this.p1Name}`;
    const p2Label = mySlot === 1
      ? 'P2 - You'
      : (guestConnected ? `P2 - ${this.p2Name}` : 'P2 Đang đợi');

    if (p1TopTitle) p1TopTitle.textContent = p1Label;
    if (p2TopTitle) p2TopTitle.textContent = p2Label;
    p1Card?.classList.toggle('is-you', mySlot === 0);
    p2Card?.classList.toggle('is-you', mySlot === 1);
    p2Card?.classList.toggle('is-waiting', !guestConnected && mySlot === 0);

    const canP1 = this.canControlSlotLocally(0);
    const canP2 = this.canControlSlotLocally(1);

    p1Zone?.classList.toggle('remote-locked', !canP1);
    p2Zone?.classList.toggle('remote-locked', !canP2);

    if (p1CycleBtn) p1CycleBtn.disabled = !canP1;
    if (p1LaunchBtn) p1LaunchBtn.disabled = !canP1 || this.isBusy;
    if (p2CycleBtn) p2CycleBtn.disabled = !canP2;
    if (p2LaunchBtn) p2LaunchBtn.disabled = !canP2 || this.isP2Busy;

    if (p1Status) {
      p1Status.className = mySlot === 0 ? 'cb-2p-status-badge local' : 'cb-2p-status-badge remote';
      p1Status.textContent = p1Label;
    }

    if (p2Status) {
      if (mySlot === 1) {
        p2Status.className = 'cb-2p-status-badge local';
      } else if (guestConnected) {
        p2Status.className = 'cb-2p-status-badge remote';
      } else {
        p2Status.className = 'cb-2p-status-badge waiting';
      }
      p2Status.textContent = p2Label;
    }
  }

  public update2PScores(
    p1Score: number,
    p2Score: number,
    p1Catches?: number,
    p2Catches?: number,
    p1Credits?: number,
    p2Credits?: number
  ): void {
    const p1El = this.rootEl.querySelector('#cbP1ScoreVal');
    const p2El = this.rootEl.querySelector('#cbP2ScoreVal');
    if (p1El) p1El.textContent = String(p1Score);
    if (p2El) p2El.textContent = String(p2Score);

    const p1Score2P = this.rootEl.querySelector('#cb2PP1Score');
    const p2Score2P = this.rootEl.querySelector('#cb2PP2Score');
    if (p1Score2P) p1Score2P.textContent = String(p1Score);
    if (p2Score2P) p2Score2P.textContent = String(p2Score);

    if (p1Catches !== undefined) {
      const p1CatchesEl = this.rootEl.querySelector('#cb2PP1Catches');
      if (p1CatchesEl) p1CatchesEl.textContent = String(p1Catches);
    }
    if (p2Catches !== undefined) {
      const p2CatchesEl = this.rootEl.querySelector('#cb2PP2Catches');
      if (p2CatchesEl) p2CatchesEl.textContent = String(p2Catches);
    }
    if (p1Credits !== undefined) {
      const p1CreditsEl = this.rootEl.querySelector('#cb2PP1Credits');
      if (p1CreditsEl) p1CreditsEl.textContent = String(p1Credits);
    }
    if (p2Credits !== undefined) {
      const p2CreditsEl = this.rootEl.querySelector('#cb2PP2Credits');
      if (p2CreditsEl) p2CreditsEl.textContent = String(p2Credits);
    }
  }

  public updateScore(score: number, target: number, stage?: number): void {
    if (this.scoreValEl) this.scoreValEl.textContent = String(score);
    const targetValEl = this.rootEl.querySelector('#cbTargetVal');
    if (targetValEl) targetValEl.textContent = String(target);
    const coopScore2P = this.rootEl.querySelector('#cb2PCoopScoreVal');
    const coopTarget2P = this.rootEl.querySelector('#cb2PCoopTargetVal');
    if (coopScore2P) coopScore2P.textContent = String(score);
    if (coopTarget2P) coopTarget2P.textContent = String(target);
    const fillEl = this.rootEl.querySelector('#cbScoreFill') as HTMLElement | null;
    if (fillEl) {
      const pct = Math.min(100, Math.max(0, (score / Math.max(1, target)) * 100));
      fillEl.style.width = `${pct}%`;
      if (pct >= 100) {
        fillEl.style.background = 'linear-gradient(90deg, #ffd647, #00e676)';
      } else {
        fillEl.style.background = 'linear-gradient(90deg, #ffd647, #4caf50)';
      }
    }
    if (stage !== undefined) {
      const stageValEl = this.rootEl.querySelector('#cbStageVal');
      if (stageValEl) stageValEl.textContent = String(stage);
      const stageVal2P = this.rootEl.querySelector('#cb2PStageVal');
      if (stageVal2P) stageVal2P.textContent = String(stage);
    }
  }

  public showVersusResultModal(
    p1Score: number,
    p2Score: number,
    p1Catches: number,
    p2Catches: number,
    p1Name = 'Người chơi 1',
    p2Name = 'Người chơi 2'
  ): void {
    const modal = this.rootEl.querySelector('#cbVersusResultModal') as HTMLElement | null;
    if (!modal) return;

    const iconEl = this.rootEl.querySelector('#cbVersusIcon');
    const titleEl = this.rootEl.querySelector('#cbVersusTitle') as HTMLElement | null;
    const descEl = this.rootEl.querySelector('#cbVersusDesc');
    const cardP1 = this.rootEl.querySelector('#cbVersusCardP1');
    const cardP2 = this.rootEl.querySelector('#cbVersusCardP2');
    const nameP1El = this.rootEl.querySelector('#cbVersusNameP1');
    const nameP2El = this.rootEl.querySelector('#cbVersusNameP2');
    const scoreP1El = this.rootEl.querySelector('#cbVersusScoreP1');
    const scoreP2El = this.rootEl.querySelector('#cbVersusScoreP2');
    const catchesP1El = this.rootEl.querySelector('#cbVersusCatchesP1');
    const catchesP2El = this.rootEl.querySelector('#cbVersusCatchesP2');

    if (nameP1El) nameP1El.textContent = `🟦 P1 • ${p1Name}`;
    if (nameP2El) nameP2El.textContent = `🟥 P2 • ${p2Name}`;
    if (scoreP1El) scoreP1El.textContent = String(p1Score);
    if (scoreP2El) scoreP2El.textContent = String(p2Score);
    if (catchesP1El) catchesP1El.textContent = `Đã bắt: ${p1Catches} thú`;
    if (catchesP2El) catchesP2El.textContent = `Đã bắt: ${p2Catches} thú`;

    cardP1?.classList.remove('winner');
    cardP2?.classList.remove('winner');

    if (p1Score > p2Score) {
      if (iconEl) iconEl.textContent = '🏆';
      if (titleEl) {
        titleEl.textContent = `🏆 P1 (${p1Name}) CHIẾN THẮNG!`;
        titleEl.style.color = '#ffd647';
      }
      if (descEl) descEl.innerHTML = `P1 dẫn trước với cách biệt <b>+${p1Score - p2Score} điểm</b>!`;
      cardP1?.classList.add('winner');
    } else if (p2Score > p1Score) {
      if (iconEl) iconEl.textContent = '🏆';
      if (titleEl) {
        titleEl.textContent = `🏆 P2 (${p2Name}) CHIẾN THẮNG!`;
        titleEl.style.color = '#ffd647';
      }
      if (descEl) descEl.innerHTML = `P2 dẫn trước với cách biệt <b>+${p2Score - p1Score} điểm</b>!`;
      cardP2?.classList.add('winner');
    } else {
      if (iconEl) iconEl.textContent = '🤝';
      if (titleEl) {
        titleEl.textContent = '🤝 TRẬN ĐẤU HÒA KỊCH TÍNH!';
        titleEl.style.color = '#80d8ff';
      }
      if (descEl) descEl.innerHTML = `Hai cao bồi ngang tài ngang sức với <b>${p1Score} điểm</b>!`;
      cardP1?.classList.add('winner');
      cardP2?.classList.add('winner');
    }

    modal.hidden = false;
    this.isModalOpen = true;
  }

  public hideVersusResultModal(): void {
    const modal = this.rootEl.querySelector('#cbVersusResultModal') as HTMLElement | null;
    if (modal) modal.hidden = true;
    this.isModalOpen = false;
  }

  public showDefeatModal(stage: number, score: number, target: number): void {
    const modal = this.rootEl.querySelector('#cbDefeatModal') as HTMLElement | null;
    if (!modal) return;
    const msgEl = this.rootEl.querySelector('#cbDefeatMsg');
    if (msgEl) {
      const label = this.isTwoPlayerMode ? 'Tổng điểm 2 người đạt' : 'Bạn đạt';
      msgEl.innerHTML = `${label} <b>${score} / ${target} điểm</b> ở Màn ${stage}.<br>Chưa đủ mốc qua màn, hãy thử lại để phục thù nào!`;
    }
    modal.hidden = false;
    this.isModalOpen = true;
  }

  public hideDefeatModal(): void {
    const modal = this.rootEl.querySelector('#cbDefeatModal') as HTMLElement | null;
    if (modal) modal.hidden = true;
    this.isModalOpen = false;
  }

  public updateStats(credits: number, score: number, catches: number): void {
    this.creditValEl.textContent = String(credits);
    if (!this.isTwoPlayerMode) {
      this.scoreValEl.textContent = String(score);
    } else {
      const localCreditEl = this.rootEl.querySelector(this.mySlot === 1 ? '#cb2PP2Credits' : '#cb2PP1Credits');
      if (localCreditEl) localCreditEl.textContent = String(credits);
    }
    this.catchesValEl.textContent = String(catches);
  }

  public startRoundTimer(seconds = 180): void {
    this.stopRoundTimer();
    this.roundSecondsLeft = seconds;
    this.updateRoundTimerDisplay();

    this.roundTimerInterval = setInterval(() => {
      this.roundSecondsLeft--;
      this.updateRoundTimerDisplay();

      if (this.roundSecondsLeft <= 0) {
        this.stopRoundTimer();
        const msg = (this.isTwoPlayerMode && this.subMode === 'versus')
          ? '⏰ <b>HẾT GIỜ THI ĐẤU!</b> Đang tổng kết bảng điểm đối kháng...'
          : '⏰ <b>HẾT GIỜ VÒNG CHƠI!</b> Đang kiểm tra điểm mục tiêu...';
        this.showToast(msg, 2600);
        this.roundEndTimeout = setTimeout(() => {
          this.roundEndTimeout = null;
          this.onRoundEnd?.();
        }, 1000);
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
        this.roundEndTimeout = setTimeout(() => {
          this.roundEndTimeout = null;
          this.onRoundEnd?.();
        }, 1000);
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
    const txt = `${mm}:${ss}`;
    this.roundTimerValEl.textContent = txt;
    const timer2P = this.rootEl.querySelector('#cb2PRoundTimerVal') as HTMLElement | null;
    if (timer2P) {
      timer2P.textContent = txt;
      timer2P.classList.toggle('danger', s <= 30);
    }

    if (s <= 30) {
      this.roundTimerBox.classList.add('danger');
    } else {
      this.roundTimerBox.classList.remove('danger');
    }
  }

  private startAutoLaunchTimer(): void {
    this.stopAutoLaunchTimer();
    this.autoLaunchSecondsLeft = 10;
    this.updateAutoLaunchDisplay();

    this.autoLaunchInterval = setInterval(() => {
      if (this.isTwoPlayerMode || document.hidden || this.isBusy || this.isModalOpen || this.rootEl.hidden || this.isCharging) return;

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
