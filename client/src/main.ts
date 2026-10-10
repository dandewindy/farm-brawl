import { CFG, type Species } from '@shared/constants';
import { insideBlob, wrapAngle } from '@shared/math';
import { FLAG, type GameEvent, type Snapshot } from '@shared/protocol';
import {
  chargeStop, chargeUpdate, repaint, setMood,
  sfxBoom, sfxBurn, sfxCrown, sfxDash, sfxDethrone, sfxDrown, sfxEat, sfxFall, sfxHit, sfxPodBlast, sfxPodWarning, sfxReward, sfxSong, sfxSplash,
  sfxSuperFly, sfxSuperFood, sfxSuperUp, sfxZap,
  unlockAudio, yelp,
  cycleAudioMode, getAudioMode, type AudioMode,
} from './audio/sfx';
import { ClientPredictor } from './game/pred';
import { GameState } from './game/state';
import { applyTexts, t } from './i18n';
import { InputManager } from './input/controls';
import { LocalServer, type Transport } from './net/transport';
import { WsClient } from './net/ws';
import { registerFriendRoom } from './net/firebase';
import { AnimalRenderer } from './render/animals';
import { CorpseRenderer } from './render/corpses';
import { FoodAndParticleRenderer } from './render/food';
import { MinimapRenderer } from './render/minimap';
import { ToolRenderer } from './render/tools';
import { WorldRenderer } from './render/world';
import { HudManager } from './ui/hud';

// Apply translations to static HTML tags
applyTexts();

const canvas = document.getElementById('c') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;

const world = new WorldRenderer(canvas);
const animals = new AnimalRenderer(world.scene);
const corpses = new CorpseRenderer(world.scene);
const foodParts = new FoodAndParticleRenderer(world.scene);
animals.onPuff = (x, y, z, c, s, l, vy) => foodParts.puff(x, y, z, c, s, l, vy);
animals.onRainbowTrail = (x, y, z, a, r, isDash) => foodParts.rainbowTrail(x, y, z, a, r, isDash);
animals.onSonicWave = (x, y, z, r) => foodParts.sonicWave(x, y, z, r);
const tools = new ToolRenderer(world.scene);
const minimap = new MinimapRenderer(minimapCanvas);
const input = new InputManager();

let transport: Transport | null = null;
let shake = 0;
let prevMass = 0;
let gainAcc = 0;
let gainTimer = 0;
let wasDashing = false;
let wasSuper = false;
let deathCamTarget: { x: number; z: number } | null = null;
let localStunTimer = 0;
let lockedAimA = 0;
let wasStunnedLastFrame = false;
let wasInWater = false;
let lastUnder20Toast = 0;

const predictor = new ClientPredictor();
let lastSentInput = { a: 0, mv: false, btn: false };
let lastSentTime = 0;

input.onPressRam = () => {
  if (localStunTimer > 0) {
    input.cancelRam();
  }
};

input.onReleaseRam = (held: number) => {
  chargeStop();
  const myMeta = gameState.metas.get(gameState.myId);
  const myEnt = gameState.ents.get(gameState.myId);
  const inWater = ((myEnt?.flags ?? 0) & FLAG.WATER) !== 0;
  if (inWater || localStunTimer > 0) return;
  const isSuper = (myEnt?.flags ?? 0) & 32768 ? true : false;
  if (myMeta && predictor.on && gameState.alive && gameState.me.cd <= 0.05) {
    predictor.predictDash(myMeta.species, held, input.aimA, gameState.map, isSuper);
  }
};

const hud = new HudManager((name: string, species: Species, mode: 'ffa' | 'team' | 'friend', skin: number, roomCode?: string) => {
  unlockAudio();
  if (mode === 'friend') {
    const code = (roomCode || 'BRAWL').toUpperCase();
    const privRoom = `priv-${code}`;
    connectToRoom(privRoom);
    registerFriendRoom(code, name, 1);
  } else if (mode === 'team') {
    connectToRoom('team-1');
  } else {
    connectToRoom('pub-1');
  }
  if (transport) {
    transport.inGame = true;
    const team = mode === 'team' ? hud.selectedTeam : undefined;
    transport.send({ t: 'join', name, species, skin, team });
  }
});

hud.onSelectMode = (mode) => {
  if (mode === 'team') {
    connectToRoom('team-1');
  } else if (mode === 'ffa') {
    connectToRoom('pub-1');
  }
};

hud.onReconnect = () => {
  if (transport?.inGame) {
    if (transport?.colo === 'SIN') {
      hud.showToast('✅ Bạn đang ở trạm Singapore (SIN) tối ưu nhất (~35ms)!');
      return;
    }
    if (transport?.colo === 'HKG') {
      hud.showToast('✅ Bạn đang ở trạm Hồng Kông (HKG) nhanh và ổn định (~75ms)!');
      return;
    }
    hud.showToast('🔍 Đang dò tìm tuyến mạng Singapore/HKG tối ưu trong nền...');
    transport?.triggerHotMigration?.();
    return;
  }
  if (transport?.forceReconnect) {
    hud.showToast('🔄 Đang đổi sang tuyến mạng tối ưu (SIN/HKG)...');
    transport.forceReconnect();
  }
};

let isSpectating = false;
let spectateTargetId: number | null = null;

function pickRandomSpectateTarget(): void {
  const living = Array.from(gameState.ents.entries())
    .filter(([id, ent]) => id !== gameState.myId && ent.mass >= 10);
  if (living.length === 0) {
    const anyEnts = Array.from(gameState.ents.entries()).filter(([id]) => id !== gameState.myId);
    if (anyEnts.length > 0) {
      const [targetId, ent] = anyEnts[Math.floor(Math.random() * anyEnts.length)];
      spectateTargetId = targetId;
      const meta = gameState.metas.get(targetId);
      hud.updateSpectatorTarget(meta ? meta.name : 'Người chơi', Math.round(ent.mass));
      return;
    }
    spectateTargetId = null;
    hud.updateSpectatorTarget('Chưa có người chơi', 0);
    return;
  }
  const pool = living.filter(([id]) => id !== spectateTargetId);
  const candidates = pool.length > 0 ? pool : living;
  const [chosenId, ent] = candidates[Math.floor(Math.random() * candidates.length)];
  spectateTargetId = chosenId;
  const meta = gameState.metas.get(chosenId);
  hud.updateSpectatorTarget(meta ? meta.name : 'Người chơi', Math.round(ent.mass));
}

hud.onStartSpectating = () => {
  isSpectating = true;
  document.body.classList.add('spectating');
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.hidden = false;
  pickRandomSpectateTarget();
};

hud.onNextSpectating = () => {
  pickRandomSpectateTarget();
};

hud.onSelectSpectateTarget = (id: number) => {
  isSpectating = true;
  spectateTargetId = id;
  hud.isSpectating = true;
  document.body.classList.add('spectating');
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.hidden = false;
  const specBar = document.getElementById('spectateBar');
  if (specBar) specBar.hidden = false;
  const deathEl = document.getElementById('death');
  if (deathEl) deathEl.hidden = true;
  document.body.classList.remove('menu');
  const targetEnt = gameState.ents.get(id);
  const targetMeta = gameState.metas.get(id);
  if (targetEnt) {
    hud.updateSpectatorTarget(targetMeta ? targetMeta.name : 'Người chơi', Math.round(targetEnt.mass));
  }
};

hud.onStopSpectating = () => {
  isSpectating = false;
  spectateTargetId = null;
  document.body.classList.remove('spectating');
};

hud.onPickRule = (ruleId) => {
  transport?.send({ t: 'rule', id: ruleId });
};
// 3-State Audio Synchronization & 1-Second Notification Toast
let audioToastTimer: any = null;
function showAudioToast(mode: AudioMode): void {
  const titles: Record<AudioMode, string> = {
    0: '🔊 Âm thanh: Bật tất cả',
    1: '🔈 Âm thanh: Chỉ hiệu ứng (Tắt nhạc)',
    2: '🔇 Âm thanh: Tắt tất cả',
  };
  let toast = document.getElementById('audioToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'audioToast';
    toast.className = 'audio-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = titles[mode];
  toast.classList.remove('fade-out');
  toast.classList.add('show');

  clearTimeout(audioToastTimer);
  audioToastTimer = setTimeout(() => {
    toast?.classList.remove('show');
    toast?.classList.add('fade-out');
  }, 1000);
}

function syncAudioUi(): void {
  const mode = getAudioMode();
  hud.setMuteState(mode);
  if (muteInGameBtn) {
    muteInGameBtn.textContent = mode === 0 ? '🔊' : (mode === 1 ? '🔈' : '🔇');
    muteInGameBtn.title = mode === 0 ? 'Âm thanh: Bật tất cả' : (mode === 1 ? 'Âm thanh: Chỉ hiệu ứng (Tắt nhạc)' : 'Âm thanh: Tắt tất cả');
  }
  const startMuteBtn = document.getElementById('mute');
  if (startMuteBtn) {
    const ico = startMuteBtn.querySelector('.ico');
    if (ico) ico.textContent = mode === 0 ? '🔊' : (mode === 1 ? '🔈' : '🔇');
  }
}

function handleAudioToggle(): void {
  const next = cycleAudioMode();
  syncAudioUi();
  showAudioToast(next);
}

hud.onToggleMute = handleAudioToggle;

// Fullscreen & anti-zoom management for desktop, mobile & iPad Chrome/Safari
const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement | null;
const startFsBtn = document.getElementById('startFsBtn') as HTMLButtonElement | null;
const muteInGameBtn = document.getElementById('muteInGame') as HTMLButtonElement | null;
let isPseudoFs = false;

function isFsActive(): boolean {
  const doc = document as any;
  return isPseudoFs || !!(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  );
}

function updateFsIcon(): void {
  const active = isFsActive();
  if (fsBtn) {
    const enterEl = fsBtn.querySelector('.fs-icon-enter') as HTMLElement | null;
    const exitEl = fsBtn.querySelector('.fs-icon-exit') as HTMLElement | null;
    if (enterEl && exitEl) {
      enterEl.style.display = active ? 'none' : '';
      exitEl.style.display = active ? '' : 'none';
    } else {
      fsBtn.textContent = active ? '⤢' : '⛶';
    }
    fsBtn.title = active ? 'Thu nhỏ màn hình' : 'Toàn màn hình';
  }
  if (startFsBtn) {
    const ico = startFsBtn.querySelector('.ico');
    if (ico) ico.textContent = active ? '⤢' : '⛶';
    startFsBtn.title = active ? 'Thu nhỏ màn hình' : 'Toàn màn hình';
  }
}

function enablePseudoFs(): void {
  isPseudoFs = true;
  document.documentElement.classList.add('fullscreen-mode');
  document.body.classList.add('fullscreen-mode');
  try { window.scrollTo(0, 1); } catch (_) {}
  updateFsIcon();
  window.dispatchEvent(new Event('resize'));
}

function disablePseudoFs(): void {
  isPseudoFs = false;
  document.documentElement.classList.remove('fullscreen-mode');
  document.body.classList.remove('fullscreen-mode');
  updateFsIcon();
  window.dispatchEvent(new Event('resize'));
}

function toggleFs(): void {
  const doc = document as any;
  const docEl = document.documentElement as any;
  const active = isFsActive();

  if (!active) {
    const req = (docEl.requestFullscreen && docEl.requestFullscreen()) ||
                (docEl.webkitRequestFullscreen && docEl.webkitRequestFullscreen()) ||
                (docEl.mozRequestFullScreen && docEl.mozRequestFullScreen()) ||
                (docEl.msRequestFullscreen && docEl.msRequestFullscreen());
    if (req && typeof req.catch === 'function') {
      req.catch(() => {
        enablePseudoFs();
      });
    } else if (!req) {
      enablePseudoFs();
    }
  } else {
    if (isPseudoFs) {
      disablePseudoFs();
    }
    if (doc.exitFullscreen) {
      doc.exitFullscreen().catch(() => {});
    } else if (doc.webkitExitFullscreen) {
      doc.webkitExitFullscreen();
    } else if (doc.mozCancelFullScreen) {
      doc.mozCancelFullScreen();
    } else if (doc.msExitFullscreen) {
      doc.msExitFullscreen();
    }
  }
  setTimeout(updateFsIcon, 100);
}

if (fsBtn) fsBtn.addEventListener('click', toggleFs);
if (startFsBtn) startFsBtn.addEventListener('click', toggleFs);

document.addEventListener('fullscreenchange', () => {
  const doc = document as any;
  if (!doc.fullscreenElement) {
    isPseudoFs = false;
    document.documentElement.classList.remove('fullscreen-mode');
    document.body.classList.remove('fullscreen-mode');
  }
  updateFsIcon();
  window.dispatchEvent(new Event('resize'));
});
document.addEventListener('webkitfullscreenchange', () => {
  const doc = document as any;
  if (!doc.webkitFullscreenElement) {
    isPseudoFs = false;
    document.documentElement.classList.remove('fullscreen-mode');
    document.body.classList.remove('fullscreen-mode');
  }
  updateFsIcon();
  window.dispatchEvent(new Event('resize'));
});
updateFsIcon();

// Anti-Zoom & Touch Gesture Lock (iPad & Mobile Chrome/Safari)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

// Prevent double-tap zoom natively without swallowing button clicks
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// Prevent multi-touch pinch to zoom
window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent accidental scroll drifts on iPad Chrome
window.addEventListener('scroll', () => {
  if (window.scrollX !== 0 || window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
});

// Mobile & iPad Burger Drawer Modal
const burgerBtn = document.getElementById('burgerBtn');
const gameDrawerModal = document.getElementById('gameDrawerModal');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const drawerBoardToggle = document.getElementById('drawerBoardToggle');
const drawerStatsToggle = document.getElementById('drawerStatsToggle');

// PC Settings Menu
const pcSettingsBtn = document.getElementById('pcSettingsBtn');
const pcSettingsMenu = document.getElementById('pcSettingsMenu');
const pcToggleBoard = document.getElementById('pcToggleBoard') as HTMLInputElement | null;
const pcToggleStats = document.getElementById('pcToggleStats') as HTMLInputElement | null;
const pcToggleLb = document.getElementById('pcToggleLb') as HTMLInputElement | null;

let showBoard = localStorage.getItem('fb_show_board') !== '0';
let showStats = localStorage.getItem('fb_show_stats') !== '0';
let showLb = localStorage.getItem('fb_show_lb') !== '0';

function syncBoardUi(): void {
  hud.setBoardVisible(showBoard);
  if (drawerBoardToggle) {
    const lbl = drawerBoardToggle.querySelector('.lbl') || drawerBoardToggle;
    lbl.textContent = `Điều Răn: ${showBoard ? 'BẬT' : 'TẮT'}`;
    drawerBoardToggle.classList.toggle('off', !showBoard);
  }
  if (pcToggleBoard) pcToggleBoard.checked = showBoard;
}

function syncStatsUi(): void {
  hud.setStatsVisible(showStats);
  if (drawerStatsToggle) {
    const lbl = drawerStatsToggle.querySelector('.lbl') || drawerStatsToggle;
    lbl.textContent = `Chỉ số: ${showStats ? 'BẬT' : 'TẮT'}`;
    drawerStatsToggle.classList.toggle('off', !showStats);
  }
  if (pcToggleStats) pcToggleStats.checked = showStats;
}

function syncLbUi(): void {
  hud.setLbVisible(showLb);
  if (pcToggleLb) pcToggleLb.checked = showLb;
}

if (burgerBtn && gameDrawerModal) {
  burgerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    gameDrawerModal.hidden = false;
    syncBoardUi();
    syncStatsUi();
  });
}

function closeDrawer(): void {
  if (gameDrawerModal) gameDrawerModal.hidden = true;
}

if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

if (drawerBoardToggle) {
  drawerBoardToggle.addEventListener('click', () => {
    showBoard = !showBoard;
    try { localStorage.setItem('fb_show_board', showBoard ? '1' : '0'); } catch (_) {}
    syncBoardUi();
  });
}

if (drawerStatsToggle) {
  drawerStatsToggle.addEventListener('click', () => {
    showStats = !showStats;
    try { localStorage.setItem('fb_show_stats', showStats ? '1' : '0'); } catch (_) {}
    syncStatsUi();
  });
}

// PC Settings controls
if (pcSettingsBtn && pcSettingsMenu) {
  pcSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pcSettingsMenu.hidden = !pcSettingsMenu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!pcSettingsMenu.hidden && !pcSettingsMenu.contains(e.target as Node) && e.target !== pcSettingsBtn) {
      pcSettingsMenu.hidden = true;
    }
  });
}

if (pcToggleBoard) {
  pcToggleBoard.addEventListener('change', () => {
    showBoard = pcToggleBoard.checked;
    try { localStorage.setItem('fb_show_board', showBoard ? '1' : '0'); } catch (_) {}
    syncBoardUi();
  });
}

if (pcToggleStats) {
  pcToggleStats.addEventListener('change', () => {
    showStats = pcToggleStats.checked;
    try { localStorage.setItem('fb_show_stats', showStats ? '1' : '0'); } catch (_) {}
    syncStatsUi();
  });
}

if (pcToggleLb) {
  pcToggleLb.addEventListener('change', () => {
    showLb = pcToggleLb.checked;
    try { localStorage.setItem('fb_show_lb', showLb ? '1' : '0'); } catch (_) {}
    syncLbUi();
  });
}

if (muteInGameBtn) {
  muteInGameBtn.addEventListener('click', handleAudioToggle);
}

// Initialize audio and UI state
syncAudioUi();
syncBoardUi();
syncStatsUi();
syncLbUi();

let firstSpawn = true;

const gameState = new GameState({
  onInit(map) {
    world.buildMap(map);
    corpses.setMap(map);
    animals.clear();
    tools.clear();
  },
  onJoined(_id) {
    deathCamTarget = null;
    isSpectating = false;
    spectateTargetId = null;
    hud.showInGame();
    hud.showBanner(t('welcome'), t('welcomeSub'));
    prevMass = CFG.START_MASS;
    gainAcc = 0;
    gainTimer = 0;
    firstSpawn = true;
    predictor.on = false;
  },
  onEvent(ev: GameEvent) {
    handleGameEvent(ev);
  },
  onSnapshot(s: Snapshot) {
    tools.sync(s.tl || []);
    let seenMe = false;
    for (const [id, x, z, _a, mass, flags, _charge] of s.p) {
      if (id === gameState.myId && gameState.alive) {
        seenMe = true;
        if (firstSpawn) {
          firstSpawn = false;
          predictor.reset(x, z);
          world.camTarget.x = x;
          world.camTarget.z = z;
        }
        const currentRtt = transport ? transport.rtt : 0;
        predictor.onServerSnapshot(x, z, flags, gameState.snapTick, gameState.clockOff, currentRtt);

        hud.updateStats(mass, gameState.me.rank, gameState.total, gameState.me.kills);
        // Mass change tracking with accumulator matching original game
        if (gameState.alive && prevMass > 0 && mass !== prevMass) {
          gainAcc += mass - prevMass;
          if (mass > prevMass && mass - prevMass < 20) {
            sfxEat(mass - prevMass >= 5);
          }
        }
        prevMass = mass;

        const isDashing = (flags & 1) !== 0;
        if (isDashing && !wasDashing) sfxDash(1);
        wasDashing = isDashing;

        const inWater = (flags & FLAG.WATER) !== 0;
        if (inWater && !wasInWater && !predictor.on) sfxSplash(0.85);
        if (!predictor.on) wasInWater = inWater;

        const isSuper = (flags & 32768) !== 0;
        if (!isSuper && wasSuper) {
          hud.showToast(t('superEnd'));
        }
        wasSuper = isSuper;
      }
    }
    if (!seenMe) {
      predictor.on = false;
    }

    // King choice card options
    hud.showChoice(s.me?.choice);

    // Update podium capture UI
    const [capId, capProg, contested] = gameState.pod;
    const captorMeta = gameState.metas.get(capId);
    const captorName = captorMeta ? captorMeta.name : '';
    const isKing = gameState.napoleonId === capId && capProg >= 0.99;
    hud.updateCapture(capId, capProg, contested, gameState.myId, captorName, isKing);

    const kingMeta = gameState.metas.get(gameState.napoleonId);
    const kingName = kingMeta ? kingMeta.name : undefined;
    hud.updateBoard(gameState.rule, gameState.reign, kingName, gameState.napoleonId === gameState.myId);

    if (gameState.lb.length) {
      hud.updateLeaderboard(gameState.lb, gameState.myId, gameState.napoleonId);
    }
    if (gameState.hof.length) {
      hud.updateHof(gameState.hof);
    }
    if (s.team) {
      hud.updateTeamBar(s.team[0], s.team[1], s.team[2], s.team[3], s.team[4]);
    }
    if (s.podShield) {
      predictor.podShieldActive = s.podShield[0];
      hud.updatePodiumTimerBadge(s.podShield[0], s.podShield[1], gameState.napoleonId > 0);
    }
  },
});

function handleGameEvent(ev: GameEvent): void {
  const myId = gameState.myId;
  switch (ev.k) {
    case 'hit': {
      const isMine = ev.a === myId || ev.v === myId;
      sfxHit(ev.s, isMine ? 1 : 0.4);
      animals.notifyHit(ev.v);
      const vm = gameState.metas.get(ev.v);
      if (vm) {
        yelp(vm.species, isMine ? 1 : 0.5);
      }
      const FLUFF_COLORS: Record<Species, number> = {
        chicken: 0xfaf6ee, duck: 0xffd23f, sheep: 0xf3f1ea, pig: 0xf6a5b5, cow: 0xffffff, horse: 0x8b5a2b,
      };
      if (vm) {
        foodParts.fluff(ev.x, ev.z, FLUFF_COLORS[vm.species] ?? 0xffffff, 8);
      }
      foodParts.burst(ev.x, 1.4, ev.z, 0xfff3a0, 16, 7, 7, 0.6);
      foodParts.burst(ev.x, 1.4, ev.z, 0xffffff, 8, 5, 5, 0.5);
      if (ev.a === 0) {
        // Hay bale collision stun: burst of golden straw flying everywhere!
        foodParts.burst(ev.x, 1.4, ev.z, 0xe8c55a, 26, 9, 8, 0.85);
      }
      if (isMine) shake = Math.max(shake, 0.6);

      // Stun lockout ONLY when hitting a post/obstacle ("trúng cọc" / "trúng bục", ev.a === 0)!
      // Normal ramming between animals does NOT cause stun!
      if (ev.v === myId && ev.a === 0) {
        const stunDur = 1.5;
        localStunTimer = stunDur;
        lockedAimA = predictor.dashT > 0 ? predictor.a : input.aimA;
        predictor.setStun(stunDur);
        input.cancelRam();
        chargeStop();
      }

      // Floating loss text matching original game
      if (ev.loss && ev.loss >= 1) {
        const lossNum = Math.round(ev.loss);
        const victimEnt = gameState.ents.get(ev.v);
        const victimPos = animals.getPosition(ev.v);
        const victimMass = victimEnt ? victimEnt.mass : CFG.START_MASS;
        const initPos = victimPos ? { x: victimPos.x, z: victimPos.z, mass: victimMass } : { x: ev.x, z: ev.z, mass: victimMass };
        if (ev.a === myId) {
          hud.floatText(`-${lossNum} kg`, 'loss', ev.v, initPos);
        } else if (ev.v === gameState.napoleonId && ev.v !== myId) {
          hud.floatText(`-${lossNum} kg`, 'loss', ev.v, initPos);
        }
      }
      break;
    }
    case 'die': {
      const isMine = ev.id === myId;
      const killer = gameState.metas.get(ev.by);
      const victim = gameState.metas.get(ev.id);
      const victimName = victim ? victim.name : '???';
      const killerName = killer ? killer.name : '';

      corpses.spawn(ev, victim);
      animals.remove(ev.id);

      if (ev.cause === 'drown') {
        for (let i = 0; i < 20; i++) {
          foodParts.puff(ev.x + (Math.random() - 0.5) * 2, 0.15, ev.z + (Math.random() - 0.5) * 2, 0xbfe3ff, 1.2, 1.2, 3.5);
        }
        sfxDrown(isMine ? 1 : 0.6);
      } else if (ev.cause === 'well') {
        foodParts.burst(ev.x, 1.5, ev.z, 0x8f8a80, 14, 4, 5);
        sfxFall(isMine ? 1 : 0.5);
      } else if (ev.cause === 'fire') {
        foodParts.burst(ev.x, 1.2, ev.z, 0xff7043, 26, 10);
        sfxBurn(isMine ? 1 : 0.5);
      } else if (ev.cause === 'starve') {
        foodParts.puff(ev.x, 0.4, ev.z, 0xaaaaaa, 0.8, 1.0, 1.2);
      } else if (ev.cause === 'till') {
        foodParts.burst(ev.x, 0.4, ev.z, 0x795548, 22, 6, 6, 0.4);
        foodParts.puff(ev.x, 0.3, ev.z, 0x5d4037, 1.2, 1.0, 1.8);
        sfxZap(isMine ? 0.7 : 0.35);
      } else {
        foodParts.burst(ev.x, 1.6, ev.z, 0xfff35c, 18, 10, 9, 0.5);
        sfxZap(isMine ? 1 : 0.5);
      }

      if (ev.id === gameState.napoleonId && ev.id > 0) {
        sfxDethrone();
        hud.showBanner(killerName ? t('overthrown', { killer: killerName }) : t('napFell', { name: victimName }), killerName ? t('overSubCrown') : t('overSub'));
      }

      if (ev.id === myId) {
        localStunTimer = 0;
        wasStunnedLastFrame = false;
        predictor.on = false;
        // Delay death screen to show death animation first
        deathCamTarget = { x: ev.x, z: ev.z };
        setTimeout(() => {
          deathCamTarget = null;
          if (transport) transport.inGame = false;
          hud.showDeath(ev, killerName);
        }, 1500);
      } else if (ev.by === myId) {
        sfxReward();
        hud.showToast(t('youKO', { name: victimName }));
        if (ev.spoils > 0) {
          hud.showToast(t('spoils', { kg: ev.spoils }));
        }
        if (ev.streak >= 2) {
          const sKey = `streak${Math.min(5, ev.streak)}` as const;
          hud.showToast(t(sKey));
        }
      }

      const causeTag = t(`c_${ev.cause}`) || t('c_fence');
      const feedText = killerName
        ? `${killerName} ➔ ${victimName}`
        : `${causeTag} ➔ ${victimName}`;
      hud.addFeed(feedText, ev.id === myId || ev.by === myId);
      break;
    }
    case 'superFood': {
      sfxSuperFood();
      hud.showToast(t('superFood'));
      break;
    }
    case 'super': {
      if (ev.id === myId) {
        sfxSuperUp();
        hud.showBanner(`🌈 ${t('superHead')}`, t('superSub'));
      } else {
        sfxSuperFood(0.6);
        const m = gameState.metas.get(ev.id);
        hud.showToast(t('superOther', { name: m ? m.name : 'Ai đó' }));
      }
      break;
    }
    case 'fly': {
      sfxSuperFly(ev.id === myId ? 1 : 0.6);
      if (ev.id === myId) shake = Math.max(shake, 0.7);
      break;
    }
    case 'napoleon': {
      gameState.napoleonId = ev.id;
      setMood(ev.id === myId ? 'napoleon' : 'normal');
      if (ev.id === myId) {
        sfxCrown();
        hud.showBanner(t('youNap'), t('youNapSub'));
        hud.updateBoard(gameState.rule, gameState.reign, gameState.metas.get(myId)?.name || 'BẠN', true);
      } else if (ev.id > 0) {
        sfxCrown();
        const king = gameState.metas.get(ev.id);
        const name = king ? king.name : 'Ai đó';
        hud.showBanner(t('napNew', { name }), t('napSub'));
        hud.updateBoard(gameState.rule, gameState.reign, name, false);
      } else {
        sfxDethrone();
        hud.showToast('👑 Ngai vàng đã bị bỏ trống!');
        hud.updateBoard(undefined, 0, undefined, false);
      }
      break;
    }
    case 'rule': {
      repaint();
      hud.showRuleBanner(ev.id);
      hud.updateBoard(ev.id, gameState.reign);
      break;
    }
    case 'tool': {
      foodParts.burst(ev.x, 1, ev.z, 0xe8b641, 14, 5, 6, 0.7);
      if (ev.id === myId) {
        sfxReward();
        hud.showToast(t(`tk_${ev.kind}`));
      }
      break;
    }
    case 'boom': {
      foodParts.burst(ev.x, 1, ev.z, 0xff7a1a, 30, 12, 9, 0.8);
      foodParts.burst(ev.x, 1, ev.z, 0x333333, 16, 6, 6, 1.1);
      sfxBoom();
      const me = gameState.ents.get(myId);
      const distToBoom = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
      if (distToBoom < 25) {
        shake = Math.max(shake, 1.2 * (1 - distToBoom / 25));
      }
      break;
    }
    case 'song': {
      sfxSong();
      const singer = gameState.metas.get(ev.id);
      const singerName = singer ? singer.name : 'Ai đó';
      if (ev.nap === myId) {
        hud.showBanner(t('songYou'), t('songSub'));
      } else {
        hud.showBanner(t('songBanner', { name: singerName }), t('songSub'));
      }
      const napEnt = gameState.ents.get(ev.nap);
      if (napEnt) {
        for (let i = 0; i < 18; i++) {
          foodParts.puff(
            napEnt.x + (Math.random() - 0.5) * 2,
            2.5,
            napEnt.z + (Math.random() - 0.5) * 2,
            i % 2 === 0 ? 0xe8b641 : 0x1f1a17,
            0.6,
            0.8,
            1.5
          );
        }
      }
      break;
    }
    case 'join': {
      gameState.metas.set(ev.id, {
        id: ev.id,
        name: ev.name,
        species: ev.species,
        skin: ev.skin,
        bot: ev.bot,
        team: ev.team,
      });
      if (!ev.bot && ev.id !== myId) {
        const teamTag = ev.team !== undefined ? ` [${ev.team === 0 ? 'A12' : 'WFM'}]` : '';
        hud.addFeed(`👋 ${ev.name}${teamTag} đã vào nông trại!`, false);
      }
      break;
    }
    case 'leave': {
      animals.remove(ev.id);
      break;
    }
    case 'teamWin': {
      sfxReward();
      hud.showTeamWinModal(ev.winner, ev.s0, ev.s1, ev.mvp);
      break;
    }
    case 'map': {
      world.buildMap(ev.map);
      corpses.setMap(ev.map);
      animals.clear();
      tools.clear();
      hud.showToast('🌾 Trận đấu mới! Bản đồ & thức ăn đã được làm mới!');
      break;
    }
    case 'podBlast': {
      sfxPodBlast();
      foodParts.burst(ev.x, 1.2, ev.z, 0x00e5ff, 45, 24, 6, 1.2);
      foodParts.burst(ev.x, 1.2, ev.z, 0xffffff, 25, 18, 5, 0.9);
      hud.showToast('💥 Chưa có Vua! Bục phát sóng đẩy lùi mọi con vật!');
      const me = gameState.ents.get(myId);
      const dist = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
      if (dist < 32) {
        shake = Math.max(shake, 1.4 * (1 - dist / 32));
      }
      break;
    }
    case 'podWarn': {
      sfxPodWarning();
      if (ev.willShield) {
        hud.showToast(`⚠️ Bục tranh Vua sẽ đóng sau ${ev.left}s!`);
      } else {
        hud.showToast(`⚠️ Bục tranh Vua sẽ mở sau ${ev.left}s!`);
      }
      break;
    }
  }
}

// Transport setup: WebSocket to Cloudflare Durable Objects in prod/dev, LocalServer offline fallback
const params = new URLSearchParams(window.location.search);
const isExplicitOffline = params.get('offline') === '1' || params.get('mode') === 'offline';
let currentRoomName = '';
let fallbackLocal = false;

function connectToRoom(targetRoom: string): void {
  if (currentRoomName === targetRoom && transport) {
    return;
  }

  if (transport && typeof (transport as any).close === 'function') {
    (transport as any).close();
  }

  currentRoomName = targetRoom;
  const isPrivate = targetRoom.startsWith('priv-') || targetRoom.startsWith('friend-');
  const displayCode = isPrivate ? targetRoom.replace(/^(priv|friend)-/, '').toUpperCase() : targetRoom.toUpperCase();
  const inviteUrl = isPrivate ? `${window.location.origin}${window.location.pathname}?room=priv-${displayCode}` : undefined;

  hud.setRoomTag(
    isPrivate ? `👥 Mã: ${displayCode} (Sao chép link)` : `Phòng ${displayCode}`,
    inviteUrl
  );

  if (isExplicitOffline) {
    transport = new LocalServer((m) => {
      gameState.handle(m);
    });
    return;
  }

  const isViteDev = window.location.port === '5180';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = isViteDev ? 'localhost:8787' : window.location.host;
  const wsUrl = `${proto}//${host}/ws?room=${encodeURIComponent(targetRoom)}`;

  transport = new WsClient(
    wsUrl,
    (m) => {
      gameState.handle(m);
    },
    (status) => {
      if (status === 'open') {
        const msg = isPrivate
          ? `Đã vào phòng bạn bè: ${displayCode} (Không có bot) 👥`
          : `Đã vào phòng trực tuyến: ${displayCode} 🌐`;
        hud.showToast(msg);
      } else if (status === 'reconnected') {
        hud.showToast('⚡ Đã kết nối lại thành công!');
      } else if (status === 'closed') {
        if (gameState.alive) {
          hud.showToast('⚠️ Mất kết nối, đang tự động kết nối lại...');
        }
      } else if (status === 'error' && isViteDev && !fallbackLocal) {
        console.warn('Worker server not detected at port 8787. Falling back to LocalServer.');
        fallbackLocal = true;
        transport = new LocalServer((m) => gameState.handle(m));
      }
    }
  );
  transport.onMigrationSuccess = (newColo) => {
    hud.showToast(`🚀 Đã tự động chuyển mượt sang trạm ${newColo} (Ping thấp)!`);
  };
}

const roomParam = params.get('room') || params.get('code');
let initialRoom = 'pub-1';
if (roomParam) {
  if (roomParam.startsWith('priv-') || roomParam.startsWith('friend-')) {
    initialRoom = roomParam;
  } else if (roomParam.length >= 3 && roomParam !== 'pub-1') {
    initialRoom = `priv-${roomParam.toUpperCase()}`;
  } else {
    initialRoom = roomParam;
  }
}
connectToRoom(initialRoom);

// Optional Debug status bar (shows RTT, jitter, prediction error, and FPS)
const showDebug = params.has('debug') || window.location.hostname === 'localhost';
let debugEl: HTMLDivElement | null = null;
// FPS tracking & high-refresh display throttling
let fpsFrames = 0;
let lastFpsTime = performance.now();
let currentFps = 60;
let lastRenderTime = 0;

if (showDebug) {
  debugEl = document.createElement('div');
  debugEl.style.cssText =
    'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:20;padding:2px 10px;font:12px/1.4 monospace;color:#f2ead7;background:rgba(0,0,0,0.65);border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(debugEl);
}

// Main Animation & Render Loop
function animate(now: number): void {
  requestAnimationFrame(animate);

  if (lastRenderTime === 0) {
    lastRenderTime = now;
  }

  // High-refresh display throttling: prevent runaway 300+ FPS on 240Hz/360Hz displays
  // Using 11.0ms (~90 FPS cap) guarantees that standard 60Hz (16.6ms) and 75Hz (13.3ms) monitors NEVER drop a single frame,
  // while capping 144Hz/240Hz/360Hz monitors from wasting GPU cycles.
  const elapsed = now - lastRenderTime;
  if (elapsed < 11.0) {
    return;
  }

  const dt = Math.min(0.05, Math.max(0.001, elapsed / 1000));
  lastRenderTime = now;

  fpsFrames++;
  if (now - lastFpsTime >= 500) {
    // Smoothly clamp HUD display to 60 FPS so it never displays runaway numbers
    currentFps = Math.min(60, Math.round((fpsFrames * 1000) / (now - lastFpsTime)));
    fpsFrames = 0;
    lastFpsTime = now;
    const currentPing = transport ? Math.round(transport.rttMin > 0 ? transport.rttMin : transport.rtt) : 0;
    hud.updatePerf(currentFps, currentPing, transport?.colo);
    if (debugEl && transport) {
      const predErr = Math.hypot(predictor.ex, predictor.ez).toFixed(2);
      debugEl.textContent = `RTT ${Math.round(transport.rtt)}ms (min ${Math.round(transport.rttMin)}) · buffer ${Math.round(gameState.interpDelay)}ms · late90 ${Math.round(gameState.lateAvg)}ms · err ${predErr}m · ${currentFps} fps`;
    }
  }

  if (localStunTimer > 0) {
    localStunTimer = Math.max(0, localStunTimer - dt);
  }

  const me = gameState.ents.get(gameState.myId);
  const serverStun = me ? (me.flags & FLAG.STUN) !== 0 : false;
  if (serverStun && localStunTimer <= 0 && !wasStunnedLastFrame) {
    localStunTimer = 1.5;
    lockedAimA = predictor.dashT > 0 ? predictor.a : input.aimA;
    predictor.setStun(1.5);
  }

  const isStunned = localStunTimer > 0;
  if (!isStunned) {
    if (wasStunnedLastFrame) {
      // Just recovered from stun! Immediately point to mouse cursor
      predictor.stunned = false;
      predictor.stunT = 0;
      predictor.a = input.aimA;
      lockedAimA = input.aimA;
    } else if (predictor.on) {
      lockedAimA = input.aimA;
    }
  }
  wasStunnedLastFrame = isStunned;

  // Local animal input & prediction step
  if (transport && gameState.alive) {
    const myMeta = gameState.metas.get(gameState.myId);
    const myMass = me ? me.mass : CFG.START_MASS;
    const myX = predictor.on ? predictor.x : (me ? me.x : 0);
    const myZ = predictor.on ? predictor.z : (me ? me.z : 0);

    if (isStunned) {
      input.cancelRam();
    }

    // Precise 3D raycasted aiming
    input.computeAim(world.camera, myX, myZ, myMass);

    const stepFlags = me ? (isStunned ? (me.flags | FLAG.STUN) : me.flags) : (isStunned ? FLAG.STUN : 0);
    const stepAimA = isStunned ? lockedAimA : input.aimA;
    const stepAimMove = isStunned ? false : input.aimMove;
    const stepHolding = isStunned ? false : input.holding;

    // Authoritative client physics prediction step
    if (myMeta && me) {
      predictor.step(
        dt,
        now,
        myMeta.species,
        stepFlags,
        myMass,
        stepHolding,
        stepAimA,
        stepAimMove,
        gameState.map,
        gameState.ents,
        gameState.myId,
        gameState.snapTick,
        transport.rtt
      );
    }

    // Rate-limited input transmission (completely locked while stunned)
    let inp = input.getInput();
    if (isStunned) {
      inp = { a: lockedAimA, mv: false, btn: false };
    }
    const btnChanged = inp.btn !== lastSentInput.btn;
    const mvChanged = inp.mv !== lastSentInput.mv;
    const angleDiff = Math.abs(wrapAngle(inp.a - lastSentInput.a));
    const timeSinceLast = now - lastSentTime;

    if (btnChanged || (timeSinceLast >= 50 && (angleDiff > 0.008 || mvChanged))) {
      transport.send({ t: 'input', ...inp });
      lastSentInput = { a: inp.a, mv: inp.mv, btn: inp.btn };
      lastSentTime = now;
    }

    // Update charging meter in HUD and charge whine audio (disabled in water and while stunned)
    const inWater = me
      ? ((me.flags & FLAG.WATER) !== 0 || (gameState.map?.pond.some((b) => insideBlob(b, predictor.x, predictor.z)) ?? false))
      : false;
    if (inWater && !wasInWater) {
      sfxSplash(0.9);
    }
    wasInWater = inWater;

    const canCharge = myMass >= 20;

    const held = !isStunned && !inWater && input.holding ? (now - input.holdStart) / 1000 : 0;
    const isCharging = !isStunned && !inWater && canCharge && held >= CFG.CHARGE_MIN;
    const chargeLevel = isCharging ? Math.min(1, Math.max(0, (held - CFG.CHARGE_MIN) / (CFG.CHARGE_MAX - CFG.CHARGE_MIN))) : 0;
    hud.updateRamMeter(gameState.me.cd, isCharging, chargeLevel, canCharge);
    if (isCharging) {
      chargeUpdate(chargeLevel);
    } else {
      chargeStop();
    }

    // Warn user when trying to charge under 20kg
    if (input.holding && !canCharge && held > 0.25 && now - lastUnder20Toast > 3500) {
      lastUnder20Toast = now;
      hud.showToast(t('ramNeedMassToast'));
    }
  } else {
    chargeStop();
    predictor.on = false;
  }

  // Interpolate remote entity positions smoothly using dynamic timeline
  gameState.interpolate(now);

  // Update 3D animal visual poses
  for (const ent of gameState.ents.values()) {
    const meta = gameState.metas.get(ent.id);
    if (meta) {
      const isMe = ent.id === gameState.myId && predictor.on;
      const px = isMe ? predictor.x : ent.x;
      const pz = isMe ? predictor.z : ent.z;
      const pa = isMe ? (isStunned ? lockedAimA : (predictor.dashT > 0 ? predictor.a : input.aimA)) : ent.a;
      let pFlags = (isMe && isStunned) ? (ent.flags | FLAG.STUN) : ent.flags;
      if (isMe && wasInWater) {
        pFlags |= FLAG.WATER;
        if (meta.species !== 'duck') pFlags |= FLAG.DROWNING;
      }
      const isKing = ent.id === gameState.napoleonId;
      animals.update(
        ent.id,
        meta,
        px,
        pz,
        pa,
        ent.mass,
        pFlags,
        isKing,
        gameState.map?.podium,
        dt,
        now,
        ent.charge,
        gameState.rule
      );
    }
  }

  // Update hazard death corpses
  corpses.update(now, dt, foodParts);

  // Camera follow local animal (or spectated animal in spectator mode)
  let targetX = 0;
  let targetZ = 0;
  let targetMass: number = CFG.START_MASS;

  if (isSpectating && spectateTargetId !== null) {
    const targetEnt = gameState.ents.get(spectateTargetId);
    if (targetEnt) {
      targetX = targetEnt.x;
      targetZ = targetEnt.z;
      targetMass = targetEnt.mass;
      const targetMeta = gameState.metas.get(spectateTargetId);
      if (targetMeta) {
        hud.updateSpectatorTarget(targetMeta.name, Math.round(targetEnt.mass));
      }
    } else {
      pickRandomSpectateTarget();
      if (spectateTargetId !== null) {
        const nextEnt = gameState.ents.get(spectateTargetId);
        if (nextEnt) {
          targetX = nextEnt.x;
          targetZ = nextEnt.z;
          targetMass = nextEnt.mass;
        }
      }
    }
  } else {
    targetX = deathCamTarget ? deathCamTarget.x : me ? (predictor.on ? predictor.x : me.x) : 0;
    targetZ = deathCamTarget ? deathCamTarget.z : me ? (predictor.on ? predictor.z : me.z) : 0;
    targetMass = me ? me.mass : CFG.START_MASS;
  }
  world.updateCamera(targetX, targetZ, targetMass, dt, shake);
  shake = Math.max(0, shake - dt * 2.5);

  // Update dynamic food and particle effects
  foodParts.updateFood(gameState.food, now, gameState.map?.podium);
  foodParts.updateParticles(dt);
  animals.updateShockwaves(dt);

  // Update animated world hazards (water ripples, pulsing coals, flames)
  world.updateHazards(now);

    // Update podium capture tile glow
    const [capId, capProg, capContested] = gameState.pod;
    const capMeta = gameState.metas.get(capId);
    const capColor = capMeta
      ? (capMeta.team !== undefined
        ? (capMeta.team === 0 ? 0x4fc3f7 : 0xf44336)
        : (({ chicken: 0xffb74d, sheep: 0xf3f1ea, horse: 0x8b5a2b, cow: 0x4fc3f7, duck: 0xffd54f, pig: 0xf48fb1 } as Record<string, number>)[capMeta.species] ?? 0xffc928))
      : 0xffc928;
    world.updatePodiumRing(capProg, capContested, now, capColor);
    world.updatePodiumShield(gameState.podShield[0], gameState.podShield[1], now);
    world.updateTillTruck(gameState.truck, dt, now, foodParts);

  // Update player ground cooldown arc indicator
  if (me && gameState.alive) {
    const px = predictor.on ? predictor.x : me.x;
    const pz = predictor.on ? predictor.z : me.z;
    const onPod = gameState.map?.podium && Math.hypot(px - gameState.map.podium[0], pz - gameState.map.podium[1]) < CFG.PODIUM_R ? 0.53 : 0;
    world.updateCdArc(px, onPod, pz, me.mass, gameState.me.cd, true);
  } else {
    world.updateCdArc(0, 0, 0, CFG.START_MASS, 0, false);
  }

  // Accumulate mass gain/loss and spawn floating 3D text (matching original game)
  gainTimer -= dt;
  if (gainTimer <= 0) {
    gainTimer = 0.3;
    const g = Math.round(gainAcc);
    const myPos = me ? { x: predictor.on ? predictor.x : me.x, z: predictor.on ? predictor.z : me.z, mass: me.mass } : undefined;
    if (g >= 1) {
      hud.floatText(`+${g} kg`, g >= 10 ? 'big' : '', gameState.myId, myPos);
      gainAcc = 0;
    } else if (g <= -3) {
      hud.floatText(`${g} kg`, 'loss', gameState.myId, myPos);
      gainAcc = 0;
    } else if (gainAcc < 0) {
      gainAcc = 0;
    }
  }

  // Update UI floating text animations projected smoothly in 3D (60 FPS zero-jitter tracking)
  hud.updateFloats(world.camera, (id: number) => {
    if (id === gameState.myId && predictor.on) {
      return { x: predictor.x, z: predictor.z, mass: me ? me.mass : CFG.START_MASS };
    }
    const pos = animals.getPosition(id);
    const ent = gameState.ents.get(id);
    if (pos && ent) return { x: pos.x, z: pos.z, mass: ent.mass };
    if (ent) return { x: ent.x, z: ent.z, mass: ent.mass };
    return undefined;
  });

  // Update floating bonus tools on the farm
  tools.update(now);

  // 3D Render
  world.render();

  // 2D Minimap Render
  minimap.draw(
    gameState.map,
    gameState.ents,
    gameState.myId,
    gameState.tools,
    gameState.napoleonId,
    gameState.food,
    gameState.truck,
    gameState.podShield[0]
  );
}

requestAnimationFrame(animate);
