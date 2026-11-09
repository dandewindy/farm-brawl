import * as THREE from 'three';
import { CowboyWallet } from './cowboyWallet';
import { CowboyArena } from './cowboyArena';
import { CowboyHud } from './cowboyHud';
import { CowboyShop } from './cowboyShop';
import { cowboyKids } from './cowboyKids';
import { cowboyInventory } from './cowboyItems';
import { cowboyAudio } from './cowboyAudio';
import { isCowboyAdminName, getStageTargetScore, type ActiveCowboyAnimal, type CowboyThemeId } from './cowboyTypes';

export { getStageTargetScore } from './cowboyTypes';

export class CowboyManager {
  private container: HTMLElement;
  private wallet: CowboyWallet;
  private arena: CowboyArena | null = null;
  private hud: CowboyHud | null = null;
  private shop: CowboyShop | null = null;
  private isOpened = false;
  private accumulateTimer: any = null;
  private currentTheme: CowboyThemeId = 'farm';
  private isShopOpen = false;
  private isRoundFinished = false;

  // Game Modes State: Campaign Progression vs 2-Player Shared Screen
  private isTwoPlayerMode = false;
  private rematchTimeout: number | null = null;
  private currentStage = 1;
  private stageScore = 0;
  private stageTarget = 80;
  private p1Score = 0;
  private p2Score = 0;
  private p1Credits = 20;
  private p2Credits = 20;

  public onClose?: () => void;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'cowboyArcadeRoot';
    this.container.className = 'cowboy-arcade-root';
    this.container.hidden = true;
    document.body.appendChild(this.container);

    this.wallet = new CowboyWallet();

    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onVisibilityChange = (): void => {
    if (!this.isOpened || !this.arena) return;
    if (document.hidden) {
      this.arena.stop();
      this.hud?.pauseRoundTimer();
    } else {
      const daily = this.wallet.checkDailyGrant();
      const acc = this.wallet.updateAccumulatedCredits();
      if (daily.granted || acc.added > 0) {
        this.syncStats();
        if (daily.granted) {
          this.hud?.showToast(`🎁 Ngày mới đã đến! Tặng bạn <b>+${daily.amount} Credit</b> hôm nay!`, 3200);
        } else if (acc.added > 0) {
          this.hud?.showToast(`⏱️ Tích lũy thời gian: <b>+${acc.added} Credit</b> (+1/phút)!`, 2500);
        }
      }
      if (!this.isShopOpen) {
        this.hud?.resumeRoundTimer();
        this.arena.start();
      }
    }
  };

  public open(theme: CowboyThemeId = 'farm', mode: 'solo' | 'friends' = 'solo'): boolean {
    if (this.isOpened) return true;

    // Kiểm tra Chế độ Trẻ Em (Thời lượng phiên)
    if (cowboyKids.isEnabled()) {
      if (cowboyKids.checkTimeExpired()) {
        alert('⏰ Đã hết giờ chơi hôm nay của bé! Hãy nhờ ba mẹ nhập mã PIN để mở khóa.');
        return false;
      }
      cowboyKids.startSession();
    }

    this.isOpened = true;
    this.currentTheme = theme;
    this.container.hidden = false;

    // Khởi tạo Arena 3D & HUD & Shop
    this.isTwoPlayerMode = (mode === 'friends');
    this.arena = new CowboyArena(this.container);
    this.arena.setTheme(this.currentTheme);
    this.arena.setTwoPlayerMode(this.isTwoPlayerMode);

    this.hud = new CowboyHud(this.container);
    this.hud.setTwoPlayerMode(this.isTwoPlayerMode);
    this.shop = new CowboyShop(this.container, this.wallet);

    // Kiểm tra quà tặng hàng ngày & tích lũy thời gian offline/không chơi
    const daily = this.wallet.checkDailyGrant();
    const acc = this.wallet.updateAccumulatedCredits();

    if (this.isTwoPlayerMode) {
      this.p1Score = 0;
      this.p2Score = 0;
      this.p1Credits = this.wallet.getCredits();
      this.p2Credits = this.wallet.getCredits();
    } else {
      this.currentStage = 1;
      this.stageScore = 0;
      this.stageTarget = getStageTargetScore(1);
      this.hud.updateScore(0, this.stageTarget, 1);
    }

    this.syncStats();

    // Đồng bộ số lượng dây thòng lọng chờ sẵn đan chéo với mức cược HUD
    this.arena.setSelectedRopesCount(this.hud.getBet());
    this.hud.onBetChange = (bet) => {
      this.arena?.setSelectedRopesCount(bet, 0);
    };

    this.hud.onP2BetChange = (bet) => {
      this.arena?.setSelectedRopesCount(bet, 1);
    };

    this.hud.onP2Launch = (_isAimCharge, _aimZ) => {
      if (!this.isTwoPlayerMode) return;
      const bet = this.hud?.getBet(1) ?? 1;
      if (!this.arena || !this.arena.canLaunch(1)) return;
      if (this.p2Credits < bet) {
        this.hud?.showToast(`⚠️ P2 còn ${this.p2Credits} Credit, không đủ cược ${bet} dây!`);
        return;
      }
      this.p2Credits -= bet;
      this.arena.launchVolleyWithAim(bet, -2.8, 1);
    };

    // Bắt đầu vòng lặp tích lũy 1 phút +1 credit khi online
    if (this.accumulateTimer) clearInterval(this.accumulateTimer);
    this.accumulateTimer = setInterval(() => {
      const res = this.wallet.updateAccumulatedCredits();
      if (res.added > 0) {
        this.syncStats();
        this.hud?.showToast(`⏱️ Đã tích lũy: <b>+${res.added} Credit</b> (Tự động +1/phút)!`, 2500);
      }
    }, 2500);

    if (daily.granted) {
      this.hud.showToast(`🎁 Chào mừng cao bồi trở lại! Tặng bạn <b>+${daily.amount} Credit</b> hôm nay!`, 3200);
      cowboyAudio.playVoice('cowboy_welcome');
    } else if (acc.added > 0) {
      this.hud.showToast(`⏱️ Chào mừng trở lại! Tích lũy được <b>+${acc.added} Credit</b> khi vắng mặt!`, 3000);
      cowboyAudio.playVoice('cowboy_welcome');
    } else {
      cowboyAudio.playVoice('cowboy_welcome');
    }

    if (isCowboyAdminName()) {
      this.hud.showToast('👑 <b>CHẾ ĐỘ ADMIN:</b> Cho phép mở Cửa Hàng bất kỳ lúc nào (bấm nút CỬA HÀNG hoặc phím B)!', 4000);
    }

    // Biến theo dõi kết quả loạt quăng dây
    let volleyCatches = 0;
    let volleyMisses = 0;

    // Hàm thực thi quăng dây (hỗ trợ cả quăng nhanh và quăng sau khi gồng canh cự ly)
    const executeVolleyLaunch = (bet: number, isAimCharge: boolean) => {
      if (!this.arena || !this.arena.canLaunch()) {
        return; // Guard against rapid clicks while ropes are in-flight!
      }

      // Kiểm tra trẻ em (chỉ kiểm tra hợp lệ, chưa trừ hạn mức vội)
      if (cowboyKids.isEnabled()) {
        if (cowboyKids.checkTimeExpired()) {
          this.hud?.showToast('⏰ Đã hết giờ chơi hôm nay của bé! Vui lòng nhờ ba mẹ mở khóa.', 3500);
          this.close();
          return;
        }
        if (!cowboyKids.canUseCredit(bet)) {
          this.hud?.showToast('⚠️ Bé đã đạt hạn mức Credit tối đa hôm nay! Nhờ ba mẹ tăng hạn mức nhé.', 3500);
          return;
        }
      }

      const currentCredits = this.wallet.getCredits();
      if (currentCredits < bet) {
        if (currentCredits === 0) {
          cowboyAudio.playVoice('cowboy_empty');
          const status = this.wallet.getReliefStatus();
          this.hud?.showReliefModal(status.remainingToday);
        } else {
          this.hud?.showToast(`⚠️ Bạn còn ${currentCredits} Credit, không đủ cược ${bet} dây! Hãy giảm số dây xuống.`);
        }
        return;
      }

      // Đặt lại bộ đếm lượt quăng
      volleyCatches = 0;
      volleyMisses = 0;

      // Trừ tiền cược an toàn và phóng volley
      if (this.wallet.deductBet(bet)) {
        if (cowboyKids.isEnabled()) {
          cowboyKids.recordCreditUsed(bet);
        }
        this.syncStats();
        this.hud?.setBusy(true);

        const launched = isAimCharge
          ? this.arena.launchVolleyWithAim(bet, this.arena.getCurrentAimZ())
          : this.arena.launchVolley(bet);

        if (!launched) {
          this.wallet.refundBet(bet);
          if (cowboyKids.isEnabled()) {
            cowboyKids.recordCreditUsed(-bet);
          }
          this.syncStats();
          this.hud?.setBusy(false);
        }
      }
    };

    // Kết nối sự kiện Gồng Dây & Quăng Dây
    this.hud.onChargeStart = () => {
      this.arena?.startAimCharge();
    };

    this.hud.onChargeRelease = (_durationMs) => {
      const bet = this.hud?.getBet() ?? 1;
      executeVolleyLaunch(bet, true);
    };

    this.hud.onLaunch = (bet) => {
      executeVolleyLaunch(bet, false);
    };

    // Bắt dính thú (hỗ trợ cả Chơi Đơn Campaign & Chơi 2 Người Đối Kháng)
    this.arena.onCatch = (animal: ActiveCowboyAnimal, playerIndex = 0) => {
      volleyCatches++;
      const payout = animal.score;

      if (this.isTwoPlayerMode) {
        if (playerIndex === 0) {
          this.p1Score += payout;
          this.p1Credits += payout;
          this.wallet.addWinnings(payout, 1);
          this.syncStats();
          this.hud?.showToast(`🎯 <b>P1</b> bắt dính ${animal.config.nameVi} (+${payout})!`, 1800);
        } else {
          this.p2Score += payout;
          this.p2Credits += payout;
          this.hud?.showToast(`🎯 <b>P2</b> bắt dính ${animal.config.nameVi} (+${payout})!`, 1800);
        }
      } else {
        // Solo Campaign mode: tích lũy điểm mốc màn và credit ví
        this.stageScore += payout;
        this.wallet.addWinnings(payout, 1);
        this.syncStats();
        this.hud?.updateScore(this.stageScore, this.stageTarget, this.currentStage);
      }

      // Hiển thị chữ nổi
      const screenPos = this.toScreenPosition(animal.x, 1.2, animal.z);

      if (animal.isSparkleX2) {
        this.hud?.showFloatText(
          `✨ X2 ĐIỂM! +${payout} CREDIT!`,
          'jackpot',
          screenPos.x,
          screenPos.y
        );
        cowboyAudio.playVoice('cowboy_hit_sparkle');
        this.hud?.showToast(`✨ <b>LẤP LÁNH X2!</b> Bắt dính ${animal.config.nameVi} (+${payout} Credit)!`, 2600);
      } else if (animal.isRainbow) {
        this.hud?.showFloatText(
          `🌈 CẦU VỒNG! +${payout} CREDIT!`,
          'jackpot',
          screenPos.x,
          screenPos.y
        );
        cowboyAudio.playVoice('cowboy_jackpot');
        this.hud?.showToast(`🔥 <b>TRÚNG LỚN!</b> Bắt dính ${animal.config.nameVi} (+${payout} Credit)!`, 2500);
      } else {
        this.hud?.showFloatText(
          `+${payout} CREDIT!`,
          animal.score >= 20 ? 'jackpot' : 'win',
          screenPos.x,
          screenPos.y
        );

        // Kiểm tra xem thú có audio thông báo điểm cao riêng không
        const highPointSpecies = [
          'swan', 'ram', 'wolf', 'boar', 'gorilla', 'bull', 'pegasus', 'phoenix', 'mammoth'
        ];
        if (highPointSpecies.includes(animal.species)) {
          cowboyAudio.playVoice(`cowboy_hit_${animal.species}`);
          this.hud?.showToast(`🔥 <b>THẦN THÚ!</b> Bắt dính ${animal.config.nameVi} (+${payout} Credit)!`, 2500);
        } else {
          cowboyAudio.playVoice('cowboy_catch');
        }
      }
    };

    // Tuột mất thú
    this.arena.onMiss = (animal: ActiveCowboyAnimal) => {
      volleyMisses++;
      const screenPos = this.toScreenPosition(animal.x, 1.2, animal.z);
      this.hud?.showFloatText('TUỘT MẤT!', 'miss', screenPos.x, screenPos.y);
    };

    // Loạt dây hoàn thành thu về
    this.arena.onVolleyFinish = (playerIndex = 0) => {
      if (playerIndex === 0) {
        this.hud?.setBusy(false);
      }

      // Nếu quăng 1 lần có trúng có trật thì chỉ cần báo trúng. Nếu trật hết thì mới báo trật!
      if (playerIndex === 0) {
        if (volleyCatches === 0 && volleyMisses > 0) {
          cowboyAudio.playVoice('cowboy_miss');
        }

        this.hud?.updateInventory();
        if (this.wallet.getCredits() === 0) {
          cowboyAudio.playVoice('cowboy_empty');
          const status = this.wallet.getReliefStatus();
          this.hud?.showReliefModal(status.remainingToday);
        }
      }
    };

    // Nhận trợ cấp khi cạn credit
    this.hud.onClaimRelief = () => {
      const relief = this.wallet.claimRelief();
      if (relief.success) {
        this.syncStats();
        this.hud?.hideReliefModal();
        this.hud?.showToast(`🎁 Nhận thành công <b>+5 Credit cứu trợ</b>! Tiếp tục trổ tài nào!`);
      } else {
        this.hud?.showToast(`Bạn đã hết lượt nhận cứu trợ hôm nay. Hãy quay lại vào ngày mai nhé!`);
      }
    };

    // Mở Cửa Hàng từ HUD khi đang chơi (tạm dừng vòng chơi hiện tại)
    this.hud.onOpenShop = () => {
      this.isShopOpen = true;
      this.isRoundFinished = false;
      this.arena?.stop();
      this.hud?.pauseRoundTimer();
      this.hud?.setBusy(true);
      this.shop?.open(true);
    };

    // Hết giờ vòng đấu -> Đánh giá Thắng/Thua theo mốc điểm hoặc kết quả đối kháng
    this.hud.onRoundEnd = () => {
      this.arena?.stop();
      this.hud?.setBusy(true);

      if (this.isTwoPlayerMode) {
        let resultMsg = '';
        if (this.p1Score > this.p2Score) {
          resultMsg = `🏆 <b>P1 CHIẾN THẮNG!</b> (${this.p1Score} vs ${this.p2Score} điểm)`;
          cowboyAudio.playVoice('cowboy_welcome');
        } else if (this.p2Score > this.p1Score) {
          resultMsg = `🏆 <b>P2 CHIẾN THẮNG!</b> (${this.p2Score} vs ${this.p1Score} điểm)`;
          cowboyAudio.playVoice('cowboy_welcome');
        } else {
          resultMsg = `🤝 <b>TRẬN ĐẤU HÒA!</b> (${this.p1Score} đều)`;
        }
        this.hud?.showToast(resultMsg, 5000);
        if (this.rematchTimeout !== null) {
          clearTimeout(this.rematchTimeout);
        }
        this.rematchTimeout = window.setTimeout(() => {
          this.rematchTimeout = null;
          this.startNewRound(90);
        }, 2500);
      } else {
        // Xét điều kiện qua màn Campaign
        if (this.stageScore >= this.stageTarget) {
          // QUA MÀN!
          const surplus = Math.max(0, this.stageScore - this.stageTarget);
          const bonusCredit = Math.min(10, Math.floor(surplus / 20));
          if (bonusCredit > 0) {
            this.wallet.addCredits(bonusCredit);
            this.syncStats();
          }
          cowboyAudio.playVoice('cowboy_welcome');
          const bonusText = bonusCredit > 0 ? ` (Thưởng thêm +${bonusCredit} Credit dôi dư!)` : '';
          this.hud?.showToast(`🎉 <b>CHÚC MỪNG QUA MÀN ${this.currentStage}!</b> Đạt ${this.stageScore}/${this.stageTarget} điểm${bonusText}`, 4500);

          this.currentStage++;
          this.isShopOpen = true;
          this.isRoundFinished = true;
          this.shop?.open();
        } else {
          // THUA CUỘC CHƯA ĐỦ ĐIỂM
          cowboyAudio.playVoice('cowboy_miss');
          this.hud?.showDefeatModal(this.currentStage, this.stageScore, this.stageTarget);
        }
      }
    };

    // Khi người chơi ấn chơi lại từ Màn 1 sau khi thua
    this.hud.onRetryFromStage1 = () => {
      this.currentStage = 1;
      this.stageScore = 0;
      this.stageTarget = getStageTargetScore(1);
      this.hud?.updateScore(0, this.stageTarget, 1);
      this.startNewRound(90);
    };

    // Khi người chơi ấn "QUAY TRỞ LẠI GAME" từ Cửa Hàng
    this.shop.onResumeGame = () => {
      this.isShopOpen = false;
      this.hud?.setBusy(false);
      this.hud?.updateInventory();
      if (this.isRoundFinished) {
        this.isRoundFinished = false;
        this.stageScore = 0;
        this.stageTarget = getStageTargetScore(this.currentStage);
        this.hud?.updateScore(0, this.stageTarget, this.currentStage);
        this.startNewRound(90);
      } else {
        this.hud?.resumeRoundTimer();
        this.arena?.start();
      }
    };

    this.shop.onCreditChanged = () => {
      this.syncStats();
      this.hud?.updateInventory();
    };

    // Thoát trò chơi từ Cửa Hàng
    this.shop.onExit = () => {
      this.close();
    };

    // Thoát ra Lobby
    this.hud.onExit = () => {
      this.close();
    };

    // Bắt đầu vòng 3 phút đầu tiên
    this.startNewRound();
    return true;
  }

  private startNewRound(duration = 90): void {
    if (this.rematchTimeout !== null) {
      clearTimeout(this.rematchTimeout);
      this.rematchTimeout = null;
    }
    if (this.isTwoPlayerMode) {
      this.p1Score = 0;
      this.p2Score = 0;
      this.hud?.updateScore(0, 0);
    }
    const hasTimeClock = !this.isTwoPlayerMode && cowboyInventory.isEquipped('time_clock');
    if (hasTimeClock) {
      cowboyInventory.consume('time_clock');
    }
    const finalDuration = hasTimeClock ? duration + 60 : duration;
    this.hud?.startRoundTimer(finalDuration);
    this.arena?.syncReadyRopes();
    this.arena?.start();
  }

  private syncStats(): void {
    if (!this.hud) return;
    this.hud.updateStats(
      this.wallet.getCredits(),
      this.wallet.getTotalScore(),
      this.wallet.getTotalCatches()
    );
  }

  private toScreenPosition(x: number, y: number, z: number): { x: number; y: number } {
    if (!this.arena) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    const vec = new THREE.Vector3(x, y, z);
    vec.project(this.arena.camera);

    const screenX = (vec.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-vec.y * 0.5 + 0.5) * window.innerHeight;

    return {
      x: Math.max(30, Math.min(window.innerWidth - 80, screenX)),
      y: Math.max(80, Math.min(window.innerHeight - 150, screenY)),
    };
  }

  public getWallet(): CowboyWallet {
    return this.wallet;
  }

  public close(): void {
    if (!this.isOpened) return;
    this.isOpened = false;

    if (this.arena) {
      this.arena.destroy();
      this.arena = null;
    }

    if (this.accumulateTimer) {
      clearInterval(this.accumulateTimer);
      this.accumulateTimer = null;
    }
    cowboyAudio.stopCurrentVoice();

    if (this.hud) {
      this.hud.destroy();
      this.hud = null;
    }

    if (this.shop) {
      this.shop.destroy();
      this.shop = null;
    }

    this.container.hidden = true;
    this.onClose?.();
  }

  public destroy(): void {
    this.close();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
