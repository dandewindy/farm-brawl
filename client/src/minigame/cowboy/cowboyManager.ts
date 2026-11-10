import * as THREE from 'three';
import { CowboyWallet } from './cowboyWallet';
import { CowboyArena } from './cowboyArena';
import { CowboyHud } from './cowboyHud';
import { CowboyShop } from './cowboyShop';
import { cowboyKids } from './cowboyKids';
import { cowboyInventory } from './cowboyItems';
import { cowboyAudio } from './cowboyAudio';
import {
  isCowboyAdminName,
  getStageTargetScore,
  getCoopStageTargetScore,
  type ActiveCowboyAnimal,
  type CowboyThemeId,
} from './cowboyTypes';
import type { ClientMsg, CowboySubMode, ServerMsg } from '@shared/protocol';

export { getStageTargetScore, getCoopStageTargetScore } from './cowboyTypes';

export interface CowboyOpenOptions {
  subMode?: CowboySubMode;
  durationSec?: number;
  roomCode?: string;
  isJoiningGuest?: boolean;
}

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

  // Game Modes State: Solo Campaign vs 2-Player Hybrid (Same-Device + Online Room Handover)
  private isTwoPlayerMode = false;
  private subMode: CowboySubMode = 'versus';
  private matchDurationSec = 180;
  private roomCode = '';
  private roomSeed = 0;
  private mySlot: 0 | 1 = 0;
  private guestConnected = false;
  private p1Name = 'Người chơi 1';
  private p2Name = 'Người chơi 2';
  private roomWs: WebSocket | null = null;
  private timerSyncInterval: any = null;

  private rematchTimeout: number | null = null;
  private animalsSyncInterval: any = null;
  private currentStage = 1;
  private stageScore = 0;
  private stageTarget = 80;
  private p1Score = 0;
  private p2Score = 0;
  private p1Catches = 0;
  private p2Catches = 0;
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

  private getLocalPlayerName(): string {
    const input = document.getElementById('name') as HTMLInputElement | null;
    const raw = (input?.value || localStorage.getItem('fb_name') || '').trim();
    return raw.slice(0, 16) || 'Cao Bồi';
  }

  private onVisibilityChange = (): void => {
    if (!this.isOpened || !this.arena) return;
    if (document.hidden) {
      if (!this.isTwoPlayerMode) {
        this.arena.stop();
        this.hud?.pauseRoundTimer();
      }
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
      if (!this.isShopOpen && !this.hud?.isModalOpen) {
        this.hud?.resumeRoundTimer();
        this.arena.start();
      }
    }
  };

  public open(
    theme: CowboyThemeId = 'farm',
    mode: 'solo' | 'friends' = 'solo',
    options?: CowboyOpenOptions
  ): boolean {
    if (this.isOpened) return true;

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

    this.isTwoPlayerMode = mode === 'friends';
    this.subMode = options?.subMode || 'versus';
    this.matchDurationSec = this.isTwoPlayerMode
      ? (this.subMode === 'campaign' ? 180 : Math.max(30, options?.durationSec || 180))
      : 90;
    this.roomCode = this.isTwoPlayerMode
      ? (options?.roomCode || String(Math.floor(1000 + Math.random() * 9000)))
      : '';
    this.roomSeed = Math.floor(Math.random() * 899999 + 100000);
    this.mySlot = 0;
    this.guestConnected = false;
    this.p1Name = this.getLocalPlayerName();
    this.p2Name = 'Người chơi 2';

    this.arena = new CowboyArena(this.container);
    this.arena.setTheme(this.currentTheme);
    this.arena.setTwoPlayerMode(this.isTwoPlayerMode);
    if (this.isTwoPlayerMode) {
      this.arena.setRandomSeed(this.roomSeed);
      this.arena.setReplicaMode(false);
    }

    this.arena.onAnimalSpawn = (wire) => {
      if (this.isTwoPlayerMode && this.mySlot === 0) {
        this.sendRoomPacket({ t: 'cb_animal_spawn', animal: wire });
      }
    };

    this.arena.onAnimalDespawn = (animalId) => {
      if (this.isTwoPlayerMode && this.mySlot === 0) {
        this.sendRoomPacket({ t: 'cb_animal_despawn', animalId });
      }
    };

    this.hud = new CowboyHud(this.container);
    this.hud.setTwoPlayerMode(this.isTwoPlayerMode, this.subMode, this.roomCode);
    if (this.isTwoPlayerMode) {
      this.hud.set2PControlState(this.mySlot, this.guestConnected, this.p1Name, this.p2Name);
    }
    this.shop = new CowboyShop(this.container, this.wallet);

    const daily = this.wallet.checkDailyGrant();
    const acc = this.wallet.updateAccumulatedCredits();

    this.currentStage = 1;
    this.stageScore = 0;
    this.p1Score = 0;
    this.p2Score = 0;
    this.p1Catches = 0;
    this.p2Catches = 0;
    this.p1Credits = Math.max(20, this.wallet.getCredits());
    this.p2Credits = Math.max(20, this.wallet.getCredits());

    if (this.isTwoPlayerMode) {
      this.stageTarget = getCoopStageTargetScore(1);
      this.hud.update2PScores(0, 0);
      if (this.subMode === 'campaign') {
        this.hud.updateScore(0, this.stageTarget, 1);
      }
    } else {
      this.stageTarget = getStageTargetScore(1);
      this.hud.updateScore(0, this.stageTarget, 1);
    }

    this.syncStats();

    this.arena.setSelectedRopesCount(this.hud.getBet(0), 0);
    if (this.isTwoPlayerMode) {
      this.arena.setSelectedRopesCount(this.hud.getBet(1), 1);
    }

    this.hud.onBetChange = (bet) => {
      this.arena?.setSelectedRopesCount(bet, 0);
      this.sendRoomPacket({ t: 'cb_bet', slot: 0, count: bet });
    };

    this.hud.onP2BetChange = (bet) => {
      this.arena?.setSelectedRopesCount(bet, 1);
      this.sendRoomPacket({ t: 'cb_bet', slot: 1, count: bet });
    };

    this.hud.onItemChange = (items) => {
      if (this.isTwoPlayerMode) {
        this.sendRoomPacket({ t: 'cb_items', slot: this.mySlot, items });
      }
    };

    this.hud.onP2ChargeStart = () => {
      if (!this.isTwoPlayerMode || !this.arena?.canLaunch(1)) return;
      this.arena.startAimCharge(1);
      this.sendRoomPacket({ t: 'cb_aim', slot: 1, charging: true, aimZ: 1.0 });
    };

    this.hud.onP2Launch = (isAimCharge, _durationMs) => {
      if (!this.isTwoPlayerMode || !this.arena || !this.arena.canLaunch(1)) return;
      const bet = this.hud?.getBet(1) ?? 1;
      if (this.mySlot === 1) {
        // Guest machine uses its own wallet credits
        const cur = this.wallet.getCredits();
        if (cur < bet) {
          if (cur === 0) {
            const status = this.wallet.getReliefStatus();
            this.hud?.showReliefModal(status.remainingToday);
          } else {
            this.hud?.showToast(`⚠️ P2 còn ${cur} Credit, không đủ cược ${bet} dây!`);
          }
          this.arena.stopAimCharge(1);
          return;
        }
        this.wallet.deductBet(bet);
        this.syncStats();
      } else {
        if (this.p2Credits < bet) {
          this.p2Credits = Math.max(10, this.wallet.getCredits());
        }
        this.p2Credits = Math.max(0, this.p2Credits - bet);
      }

      const aimZ = isAimCharge ? this.arena.getCurrentAimZ(1) : -1.8;
      this.hud?.setBusy(true, 1);
      this.syncStats();
      this.arena.launchVolleyWithAim(bet, aimZ, 1);
      this.sendRoomPacket({ t: 'cb_throw', slot: 1, count: bet, aimZ });
    };

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

    let volleyCatches = 0;
    let volleyMisses = 0;

    const executeVolleyLaunch = (bet: number, isAimCharge: boolean) => {
      if (!this.arena || !this.arena.canLaunch(0)) {
        return;
      }

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
        this.arena.stopAimCharge(0);
        return;
      }

      volleyCatches = 0;
      volleyMisses = 0;

      if (this.wallet.deductBet(bet)) {
        if (cowboyKids.isEnabled()) {
          cowboyKids.recordCreditUsed(bet);
        }
        this.syncStats();
        this.hud?.setBusy(true, 0);

        const aimZ = isAimCharge ? this.arena.getCurrentAimZ(0) : -2.8;
        const launched = isAimCharge
          ? this.arena.launchVolleyWithAim(bet, aimZ, 0)
          : this.arena.launchVolley(bet, 0);

        if (!launched) {
          this.wallet.refundBet(bet);
          if (cowboyKids.isEnabled()) {
            cowboyKids.recordCreditUsed(-bet);
          }
          this.syncStats();
          this.hud?.setBusy(false, 0);
        } else {
          this.sendRoomPacket({ t: 'cb_throw', slot: 0, count: bet, aimZ });
        }
      }
    };

    this.hud.onChargeStart = () => {
      this.arena?.startAimCharge(0);
      this.sendRoomPacket({ t: 'cb_aim', slot: 0, charging: true, aimZ: 1.0 });
    };

    this.hud.onChargeRelease = (_durationMs) => {
      const bet = this.hud?.getBet(0) ?? 1;
      executeVolleyLaunch(bet, true);
    };

    this.hud.onLaunch = (bet) => {
      executeVolleyLaunch(bet, false);
    };

    this.arena.onCatch = (animal: ActiveCowboyAnimal, playerIndex = 0) => {
      volleyCatches++;
      const payout = animal.score;
      const slot: 0 | 1 = playerIndex === 1 ? 1 : 0;

      if (this.isTwoPlayerMode) {
        if (slot === 0) {
          this.p1Score += payout;
          this.p1Catches += 1;
          this.p1Credits += payout;
          if (this.mySlot === 0) {
            this.wallet.addWinnings(payout, 1);
            this.syncStats();
          }
          this.hud?.showToast(`🎯 <b>P1 (${this.p1Name})</b> bắt dính ${animal.config.nameVi} (+${payout} điểm)!`, 1800);
        } else {
          this.p2Score += payout;
          this.p2Catches += 1;
          this.p2Credits += payout;
          if (this.mySlot === 1 || !this.guestConnected) {
            this.wallet.addWinnings(payout, 1);
            this.syncStats();
          }
          this.hud?.showToast(`🎯 <b>P2 (${this.p2Name})</b> bắt dính ${animal.config.nameVi} (+${payout} điểm)!`, 1800);
        }

        this.stageScore = this.p1Score + this.p2Score;
        this.syncStats();
        if (this.subMode === 'campaign') {
          this.hud?.updateScore(this.stageScore, this.stageTarget, this.currentStage);
        }

        this.sendRoomPacket({
          t: 'cb_catch',
          slot,
          animalId: animal.id,
          score: payout,
          species: animal.species,
        });
      } else {
        this.stageScore += payout;
        this.wallet.addWinnings(payout, 1);
        this.syncStats();
        this.hud?.updateScore(this.stageScore, this.stageTarget, this.currentStage);
      }

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

    this.arena.onMiss = (animal: ActiveCowboyAnimal) => {
      volleyMisses++;
      const screenPos = this.toScreenPosition(animal.x, 1.2, animal.z);
      this.hud?.showFloatText('TUỘT MẤT!', 'miss', screenPos.x, screenPos.y);
    };

    this.arena.onVolleyFinish = (playerIndex = 0) => {
      if (playerIndex === 1) {
        this.hud?.setBusy(false, 1);
        return;
      }
      this.hud?.setBusy(false, 0);

      if (volleyCatches === 0 && volleyMisses > 0) {
        cowboyAudio.playVoice('cowboy_miss');
      }

      this.hud?.updateInventory();
      if (this.wallet.getCredits() === 0) {
        cowboyAudio.playVoice('cowboy_empty');
        const status = this.wallet.getReliefStatus();
        this.hud?.showReliefModal(status.remainingToday);
      }
    };

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

    this.hud.onOpenShop = () => {
      this.isShopOpen = true;
      this.isRoundFinished = false;
      this.arena?.stop();
      this.hud?.pauseRoundTimer();
      this.hud?.setBusy(true, 0);
      this.shop?.open(true);
    };

    // Hết giờ vòng đấu -> Xử lý Đối Kháng (Versus) hoặc Chinh Phục Màn (Solo / Co-op Campaign)
    this.hud.onRoundEnd = () => {
      this.arena?.stop();
      this.hud?.setBusy(true, 0);
      this.hud?.setBusy(true, 1);

      if (this.isTwoPlayerMode && this.subMode === 'versus') {
        cowboyAudio.playVoice('cowboy_welcome');
        this.hud?.showVersusResultModal(
          this.p1Score,
          this.p2Score,
          this.p1Catches,
          this.p2Catches,
          this.p1Name,
          this.p2Name
        );
      } else {
        // Solo Campaign OR 2P Co-op Campaign
        const effectiveScore = this.isTwoPlayerMode ? (this.p1Score + this.p2Score) : this.stageScore;
        this.stageScore = effectiveScore;

        if (this.stageScore >= this.stageTarget) {
          const surplus = Math.max(0, this.stageScore - this.stageTarget);
          const bonusCredit = Math.min(10, Math.floor(surplus / 20));
          if (bonusCredit > 0) {
            this.wallet.addCredits(bonusCredit);
            this.syncStats();
          }
          cowboyAudio.playVoice('cowboy_welcome');
          const bonusText = bonusCredit > 0 ? ` (Thưởng thêm +${bonusCredit} Credit dôi dư!)` : '';
          this.hud?.showToast(
            `🎉 <b>CHÚC MỪNG QUA MÀN ${this.currentStage}!</b> Đạt ${this.stageScore}/${this.stageTarget} điểm${bonusText}`,
            4500
          );

          this.currentStage++;
          this.isShopOpen = true;
          this.isRoundFinished = true;
          this.shop?.open();
        } else {
          cowboyAudio.playVoice('cowboy_miss');
          this.hud?.showDefeatModal(this.currentStage, this.stageScore, this.stageTarget);
        }
      }
    };

    this.hud.onVersusRematch = () => {
      this.roomSeed = Math.floor(Math.random() * 899999 + 100000);
      this.sendRoomPacket({
        t: 'cb_rematch',
        subMode: this.subMode,
        durationSec: this.matchDurationSec,
        seed: this.roomSeed,
      });
      this.startNewRound(this.matchDurationSec, this.roomSeed);
    };

    this.hud.onRetryFromStage1 = () => {
      this.currentStage = 1;
      this.stageScore = 0;
      this.p1Score = 0;
      this.p2Score = 0;
      this.p1Catches = 0;
      this.p2Catches = 0;
      this.stageTarget = this.isTwoPlayerMode
        ? getCoopStageTargetScore(1)
        : getStageTargetScore(1);
      this.hud?.updateScore(0, this.stageTarget, 1);
      this.hud?.update2PScores(0, 0);
      this.roomSeed = Math.floor(Math.random() * 899999 + 100000);
      if (this.isTwoPlayerMode) {
        this.sendRoomPacket({
          t: 'cb_rematch',
          subMode: this.subMode,
          durationSec: this.matchDurationSec,
          seed: this.roomSeed,
        });
      }
      this.startNewRound(this.isTwoPlayerMode ? 180 : 90, this.roomSeed);
    };

    this.shop.onResumeGame = () => {
      this.isShopOpen = false;
      this.hud?.setBusy(false, 0);
      this.hud?.setBusy(false, 1);
      this.hud?.updateInventory();
      if (this.isRoundFinished) {
        this.isRoundFinished = false;
        this.stageScore = 0;
        this.p1Score = 0;
        this.p2Score = 0;
        this.stageTarget = this.isTwoPlayerMode
          ? getCoopStageTargetScore(this.currentStage)
          : getStageTargetScore(this.currentStage);
        this.hud?.updateScore(0, this.stageTarget, this.currentStage);
        this.hud?.update2PScores(0, 0);
        this.roomSeed = Math.floor(Math.random() * 899999 + 100000);
        if (this.isTwoPlayerMode) {
          this.sendRoomPacket({
            t: 'cb_stage_next',
            stage: this.currentStage,
            seed: this.roomSeed,
          });
        }
        this.startNewRound(this.isTwoPlayerMode ? 180 : 90, this.roomSeed);
      } else {
        this.hud?.resumeRoundTimer();
        this.arena?.start();
      }
    };

    this.shop.onCreditChanged = () => {
      this.syncStats();
      this.hud?.updateInventory();
    };

    this.shop.onExit = () => {
      this.close();
    };

    this.hud.onExit = () => {
      this.close();
    };

    this.startNewRound(this.matchDurationSec, this.roomSeed);

    if (this.isTwoPlayerMode && this.roomCode) {
      this.connectTwoPlayerRoom();
    }

    return true;
  }

  private connectTwoPlayerRoom(): void {
    this.disconnectTwoPlayerRoom();
    if (!this.roomCode) return;

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const cid = localStorage.getItem('fb_cid') || String(Math.random()).slice(2, 10);
      const wsUrl = `${proto}//${window.location.host}/ws?room=cb-${encodeURIComponent(this.roomCode)}&cid=${encodeURIComponent(cid)}`;
      const ws = new WebSocket(wsUrl);
      this.roomWs = ws;

      ws.addEventListener('open', () => {
        if (this.roomWs !== ws) return;
        this.sendRoomPacket({
          t: 'cb_join',
          roomCode: this.roomCode,
          name: this.getLocalPlayerName(),
          subMode: this.subMode,
          durationSec: this.matchDurationSec,
          theme: this.currentTheme,
          roundRemainingSec: this.hud?.getRoundSeconds() ?? this.matchDurationSec,
          p1Score: this.p1Score,
          p2Score: this.p2Score,
          p1Catches: this.p1Catches,
          p2Catches: this.p2Catches,
          stage: this.currentStage,
          seed: this.roomSeed,
        });
      });

      ws.addEventListener('message', (ev) => {
        if (this.roomWs !== ws || typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data) as ServerMsg;
          this.handleRoomMessage(msg);
        } catch (_) {}
      });

      ws.addEventListener('close', () => {
        if (this.roomWs === ws) {
          this.roomWs = null;
        }
      });

      this.timerSyncInterval = setInterval(() => {
        if (this.isOpened && this.isTwoPlayerMode && this.mySlot === 0 && this.hud) {
          this.sendRoomPacket({
            t: 'cb_sync_timer',
            remainingSec: this.hud.getRoundSeconds(),
          });
        }
      }, 4000);

      if (this.animalsSyncInterval) clearInterval(this.animalsSyncInterval);
      this.animalsSyncInterval = setInterval(() => {
        if (this.isOpened && this.isTwoPlayerMode && this.mySlot === 0 && this.arena && this.guestConnected) {
          const syncList = this.arena.getAnimalsSyncData();
          if (syncList.length > 0) {
            this.sendRoomPacket({ t: 'cb_animals_sync', animals: syncList });
          }
        }
      }, 250);
    } catch (err) {
      console.warn('Cowboy 2P WS connection error:', err);
    }
  }

  private disconnectTwoPlayerRoom(): void {
    if (this.timerSyncInterval) {
      clearInterval(this.timerSyncInterval);
      this.timerSyncInterval = null;
    }
    if (this.animalsSyncInterval) {
      clearInterval(this.animalsSyncInterval);
      this.animalsSyncInterval = null;
    }
    if (this.roomWs) {
      try {
        this.roomWs.close();
      } catch (_) {}
      this.roomWs = null;
    }
  }

  private sendRoomPacket(msg: ClientMsg): void {
    if (this.roomWs && this.roomWs.readyState === WebSocket.OPEN) {
      try {
        this.roomWs.send(JSON.stringify(msg));
      } catch (_) {}
    }
  }

  private handleRoomMessage(msg: ServerMsg): void {
    if (!this.isOpened || !this.isTwoPlayerMode) return;

    if (msg.t === 'cb_room_full') {
      this.hud?.showToast('⚠️ Phòng này đã đủ 2 người chơi! Đang chuyển sang phòng mới.', 3200);
      return;
    }

    if (msg.t === 'cb_room_state') {
      const prevGuest = this.guestConnected;
      const prevSlot = this.mySlot;

      this.mySlot = msg.yourSlot;
      this.guestConnected = msg.guestConnected;
      this.p1Name = msg.p1Name || 'Người chơi 1';
      this.p2Name = msg.p2Name || 'Người chơi 2';
      this.subMode = msg.subMode;
      this.matchDurationSec = msg.durationSec;
      this.currentStage = msg.stage || 1;
      this.p1Score = msg.p1Score;
      this.p2Score = msg.p2Score;
      this.p1Catches = msg.p1Catches;
      this.p2Catches = msg.p2Catches;
      this.stageScore = this.p1Score + this.p2Score;
      this.stageTarget = getCoopStageTargetScore(this.currentStage);

      if (msg.theme && ['farm', 'prairie', 'ice'].includes(msg.theme) && msg.theme !== this.currentTheme) {
        this.currentTheme = msg.theme as CowboyThemeId;
        this.arena?.setTheme(this.currentTheme);
      }

      this.arena?.setReplicaMode(this.mySlot === 1);

      // Khi là máy 2 (Guest): load toàn bộ danh sách con vật đồng bộ ngay từ room state
      if (this.mySlot === 1 && Array.isArray(msg.activeAnimals) && msg.activeAnimals.length > 0) {
        this.arena?.setAllAnimalsFromWire(msg.activeAnimals);
      }

      // Khi là máy 1 (Host): lúc có người thứ 2 vào phòng, lập tức gửi danh sách con vật thực tế tức thì
      if (this.mySlot === 0 && !prevGuest && this.guestConnected && this.arena) {
        this.sendRoomPacket({
          t: 'cb_animals_init',
          animals: this.arena.getActiveAnimalsWire(),
        });
      }

      if (msg.seed && msg.seed !== this.roomSeed) {
        this.roomSeed = msg.seed;
        if (this.mySlot === 0) {
          this.arena?.setRandomSeed(this.roomSeed);
        }
      }

      this.hud?.setTwoPlayerMode(true, this.subMode, this.roomCode);
      this.hud?.set2PControlState(this.mySlot, this.guestConnected, this.p1Name, this.p2Name);
      this.hud?.setBet(msg.p1Bet || 1, 0, true);
      this.hud?.setBet(msg.p2Bet || 1, 1, true);
      this.arena?.setSelectedRopesCount(msg.p1Bet || 1, 0);
      this.arena?.setSelectedRopesCount(msg.p2Bet || 1, 1);
      this.syncStats();
      if (this.subMode === 'campaign') {
        this.hud?.updateScore(this.stageScore, this.stageTarget, this.currentStage);
      }
      if (msg.roundRemainingSec > 0) {
        this.hud?.setRoundSeconds(msg.roundRemainingSec);
      }

      if (this.mySlot === 0 && !prevGuest && this.guestConnected) {
        this.arena?.stopAimCharge(1);
        this.hud?.showToast(
          `🎮 <b>${this.p2Name}</b> đã vào phòng #${this.roomCode}! Quyền điều khiển <b>P2 (Bên phải)</b> đã tự động chuyển sang máy 2!`,
          3800
        );
      } else if (this.mySlot === 0 && prevGuest && !this.guestConnected) {
        this.hud?.showToast(
          `🔌 Máy 2 đã rời phòng. Quyền điều khiển <b>P2 (Bên phải)</b> đã chuyển lại về máy bạn!`,
          3400
        );
      } else if (this.mySlot === 1 && prevSlot !== 1) {
        this.hud?.showToast(
          `🎉 Đã vào phòng <b>#${this.roomCode}</b> cùng <b>${this.p1Name}</b>! Bạn điều khiển <b>P2 (Bên phải)</b>!`,
          3800
        );
      }
      return;
    }

    if (msg.t === 'cb_items_sync') {
      this.hud?.setTeammateItems(msg.slot, msg.items);
      return;
    }

    if (msg.t === 'cb_animal_spawn_sync') {
      if (this.mySlot === 1) {
        this.arena?.spawnAnimalFromWire(msg.animal);
      }
      return;
    }

    if (msg.t === 'cb_animals_sync') {
      if (this.mySlot === 1) {
        this.arena?.syncAnimalsPositions(msg.animals);
      }
      return;
    }

    if (msg.t === 'cb_animal_despawn_sync') {
      if (this.mySlot === 1) {
        this.arena?.retireAnimal(msg.animalId);
      }
      return;
    }

    if (msg.t === 'cb_animals_init_sync') {
      if (this.mySlot === 1) {
        this.arena?.setAllAnimalsFromWire(msg.animals);
      }
      return;
    }

    if (msg.t === 'cb_bet_sync') {
      this.hud?.setBet(msg.count, msg.slot, true);
      this.arena?.setSelectedRopesCount(msg.count, msg.slot);
      return;
    }

    if (msg.t === 'cb_aim_sync') {
      if (msg.charging) {
        this.arena?.startAimCharge(msg.slot);
      } else {
        this.arena?.stopAimCharge(msg.slot);
      }
      return;
    }

    if (msg.t === 'cb_throw_sync') {
      if (msg.slot === 0) {
        this.p1Credits = Math.max(0, this.p1Credits - msg.count);
      } else {
        this.p2Credits = Math.max(0, this.p2Credits - msg.count);
      }
      this.hud?.setBet(msg.count, msg.slot, true);
      this.syncStats();
      this.arena?.launchVolleyWithAim(msg.count, msg.aimZ, msg.slot);
      return;
    }

    if (msg.t === 'cb_catch_sync') {
      this.p1Score = msg.p1Score;
      this.p2Score = msg.p2Score;
      this.p1Catches = msg.p1Catches;
      this.p2Catches = msg.p2Catches;
      if (msg.slot === 0) {
        this.p1Credits += msg.score;
      } else {
        this.p2Credits += msg.score;
      }
      this.stageScore = this.p1Score + this.p2Score;
      this.arena?.remoteCatchAnimal(msg.animalId, msg.score);
      this.syncStats();
      if (this.subMode === 'campaign') {
        this.hud?.updateScore(this.stageScore, this.stageTarget, this.currentStage);
      }
      return;
    }

    if (msg.t === 'cb_stage_next_sync') {
      if (this.isShopOpen) {
        this.isShopOpen = false;
        this.shop?.close();
      }
      this.isRoundFinished = false;
      this.currentStage = msg.stage;
      this.stageScore = 0;
      this.p1Score = 0;
      this.p2Score = 0;
      this.stageTarget = getCoopStageTargetScore(this.currentStage);
      this.hud?.hideDefeatModal();
      this.hud?.updateScore(0, this.stageTarget, this.currentStage);
      this.hud?.update2PScores(0, 0);
      this.arena?.clearAnimals();
      this.startNewRound(msg.roundRemainingSec || 180, msg.seed);
      if (this.mySlot === 0 && this.arena) {
        setTimeout(() => {
          if (this.mySlot === 0 && this.arena) {
            this.sendRoomPacket({
              t: 'cb_animals_init',
              animals: this.arena.getActiveAnimalsWire(),
            });
          }
        }, 400);
      }
      return;
    }

    if (msg.t === 'cb_rematch_sync') {
      if (this.isShopOpen) {
        this.isShopOpen = false;
        this.shop?.close();
      }
      this.subMode = msg.subMode;
      this.matchDurationSec = msg.durationSec;
      this.currentStage = msg.stage || 1;
      this.stageScore = 0;
      this.p1Score = 0;
      this.p2Score = 0;
      this.p1Catches = 0;
      this.p2Catches = 0;
      this.stageTarget = getCoopStageTargetScore(this.currentStage);
      this.hud?.hideVersusResultModal();
      this.hud?.hideDefeatModal();
      this.hud?.update2PScores(0, 0);
      if (this.subMode === 'campaign') {
        this.hud?.updateScore(0, this.stageTarget, this.currentStage);
      }
      this.arena?.clearAnimals();
      this.startNewRound(this.subMode === 'campaign' ? 180 : this.matchDurationSec, msg.seed);
      if (this.mySlot === 0 && this.arena) {
        setTimeout(() => {
          if (this.mySlot === 0 && this.arena) {
            this.sendRoomPacket({
              t: 'cb_animals_init',
              animals: this.arena.getActiveAnimalsWire(),
            });
          }
        }, 400);
      }
      return;
    }
  }

  private startNewRound(duration = 90, seed?: number): void {
    if (this.rematchTimeout !== null) {
      clearTimeout(this.rematchTimeout);
      this.rematchTimeout = null;
    }
    if (this.isTwoPlayerMode) {
      this.p1Score = 0;
      this.p2Score = 0;
      this.stageScore = 0;
      this.hud?.update2PScores(0, 0);
      if (this.subMode === 'campaign') {
        this.hud?.updateScore(0, this.stageTarget, this.currentStage);
      }
      if (seed) {
        this.roomSeed = seed;
        this.arena?.clearAnimals();
        this.arena?.setRandomSeed(seed);
      }
    }
    const hasTimeClock = !this.isTwoPlayerMode && cowboyInventory.isEquipped('time_clock');
    if (hasTimeClock) {
      cowboyInventory.consume('time_clock');
    }
    const finalDuration = hasTimeClock ? duration + 60 : duration;
    this.hud?.setBusy(false, 0);
    this.hud?.setBusy(false, 1);
    this.hud?.startRoundTimer(finalDuration);
    this.arena?.syncReadyRopes();
    this.arena?.start();
    this.hud?.notifyItemChange();
  }

  private syncStats(): void {
    if (!this.hud) return;
    const myCredits = this.wallet.getCredits();
    this.hud.updateStats(
      myCredits,
      this.wallet.getTotalScore(),
      this.wallet.getTotalCatches()
    );
    if (this.isTwoPlayerMode) {
      const c1 = this.mySlot === 0 ? myCredits : this.p1Credits;
      const c2 = (this.mySlot === 1 || !this.guestConnected) ? myCredits : this.p2Credits;
      this.hud.update2PScores(
        this.p1Score,
        this.p2Score,
        this.p1Catches,
        this.p2Catches,
        c1,
        c2
      );
    }
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

    this.disconnectTwoPlayerRoom();

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
