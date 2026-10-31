import * as THREE from 'three';
import { CFG, radiusOf, type Species } from '@shared/constants';
import { distToSegmentSq, insideBlob, wrapAngle } from '@shared/math';
import { FLAG, type GameEvent, type Snapshot } from '@shared/protocol';
import {
  chargeStop, chargeUpdate, repaint, setMood,
  sfxBoom, sfxBurn, sfxCrown, sfxDash, sfxDethrone, sfxDrown, sfxEat, sfxFall, sfxGorillaRoar, sfxMammothRoar, sfxHit, sfxPodBlast, sfxPodWarning, sfxReward, sfxSong, sfxSplash,
  sfxSuperFly, sfxSuperFood, sfxSuperUp, sfxZap,
  unlockAudio, yelp, setMuted,
  cycleAudioMode, getAudioMode, type AudioMode,
} from './audio/sfx';
import { ClientPredictor } from './game/pred';
import { GameState, type FoodItem } from './game/state';
import { applyTexts, getLanguage, t } from './i18n';
import { InputManager } from './input/controls';
import { LocalServer, type Transport } from './net/transport';
import { WsClient } from './net/ws';
import { registerFriendRoom } from './net/firebase';
import { AnimalRenderer, SPECIES_RING_COLOR } from './render/animals';
import { CorpseRenderer } from './render/corpses';
import { FoodAndParticleRenderer } from './render/food';
import { MinimapRenderer } from './render/minimap';
import { MinionRenderer } from './render/minions';
import { ToolRenderer } from './render/tools';
import { WorldRenderer } from './render/world';
import { BananaRenderer } from './render/bananas';
import { HudManager } from './ui/hud';
import { getArenaTheme, onThemeChange } from './theme';

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
const minions = new MinionRenderer(world.scene);
const bananas = new BananaRenderer(world.scene);
const minimap = new MinimapRenderer(minimapCanvas);
const input = new InputManager();

world.onTransitionScale = (sc: number) => {
  tools.setTransitionScale(sc);
  foodParts.setTransitionScale(sc);
};

onThemeChange((theme) => {
  world.setTheme(theme);
  animals.setTheme(theme);
  tools.setTheme(theme);
  foodParts.setTheme(theme);
  minions.clear();
  bananas.clear();
});

let transport: Transport | null = null;
let shake = 0;
let prevMass = 0;
let gainAcc = 0;
let gainTimer = 0;
let wasDashing = false;
let wasSuper = false;
let deathCamTarget: { x: number; z: number } | null = null;
let deathScreenTimer: number | null = null;
let isDeadAwaitingScreen = false;
let awaitingJoinAck = false;
let missingMeTicks = 0;
let localStunTimer = 0;
let lockedAimA = 0;
let wasStunnedLastFrame = false;
let wasInWater = false;
let lastUnder20Toast = 0;

const predictor = new ClientPredictor();
let inputSeq = 0;
let lastSentInput = { a: 0, mv: false, btn: false };
let lastSentTime = 0;

let prevPredX = 0;
let prevPredZ = 0;
let hasPrevPred = false;

interface OptimisticEatEntry {
  foodId: number;
  foodValue: number;
  eatenAtPerf: number;
}

const optimisticEatenMap = new Map<number, OptimisticEatEntry>();
const pendingEatHintsToSend: number[] = [];
const OPTIMISTIC_EAT_EXPIRY_MS = 750;

function runClientOptimisticFoodPass(
  now: number,
  prevX: number,
  prevZ: number,
  currX: number,
  currZ: number,
  currentMass: number,
  foodMap: Map<number, FoodItem>,
  onOptimisticEatVisual?: (foodId: number, x: number, z: number, value: number) => void
): number {
  for (const [fid, entry] of optimisticEatenMap.entries()) {
    if (now - entry.eatenAtPerf > OPTIMISTIC_EAT_EXPIRY_MS) {
      optimisticEatenMap.delete(fid);
    }
  }
  if (optimisticEatenMap.size > 200) {
    optimisticEatenMap.clear();
  }

  const baseR = radiusOf(currentMass) + 0.45;
  const baseRSq = baseR * baseR;
  const minX = Math.min(prevX, currX) - baseR;
  const maxX = Math.max(prevX, currX) + baseR;
  const minZ = Math.min(prevZ, currZ) - baseR;
  const maxZ = Math.max(prevZ, currZ) + baseR;

  let optimisticMassBoost = 0;

  for (const [fid, f] of foodMap.entries()) {
    if (optimisticEatenMap.has(fid)) {
      optimisticMassBoost += f.v;
      continue;
    }

    if (f.x < minX || f.x > maxX || f.z < minZ || f.z > maxZ) continue;

    const dSq = distToSegmentSq(f.x, f.z, prevX, prevZ, currX, currZ);
    if (dSq <= baseRSq) {
      optimisticEatenMap.set(fid, {
        foodId: fid,
        foodValue: f.v,
        eatenAtPerf: now,
      });
      optimisticMassBoost += f.v;

      if (!pendingEatHintsToSend.includes(fid)) {
        pendingEatHintsToSend.push(fid);
      }

      const fx = f.x;
      const fz = f.z;
      const fv = f.v;

      foodMap.delete(fid);
      onOptimisticEatVisual?.(fid, fx, fz, fv);
    }
  }

  return optimisticMassBoost;
}

input.onPressRam = () => {
  if (localStunTimer > 0) {
    input.cancelRam();
    return;
  }
  // Send btn: true immediately so server starts tracking hold time with 0 frame latency
  if (transport && gameState.alive && localStunTimer <= 0) {
    inputSeq += 1;
    predictor.currentSeq = inputSeq;
    const eatPayload = pendingEatHintsToSend.length > 0 ? pendingEatHintsToSend.splice(0, 6) : undefined;
    transport.send({ t: 'input', seq: inputSeq, a: input.aimA, mv: input.aimMove, btn: true, ...(eatPayload ? { eat: eatPayload } : {}) });
    lastSentInput = { a: input.aimA, mv: input.aimMove, btn: true };
    lastSentTime = performance.now();
  }
};

input.onReleaseRam = (held: number) => {
  chargeStop();
  const myMeta = gameState.metas.get(gameState.myId);
  const myEnt = gameState.ents.get(gameState.myId);
  const inWater = ((myEnt?.flags ?? 0) & FLAG.WATER) !== 0;
  if (inWater || localStunTimer > 0) return;
  const isSuper = (myEnt?.flags ?? 0) & 32768 ? true : false;
  const curX = predictor.on ? predictor.x : (myEnt?.x ?? 0);
  const curZ = predictor.on ? predictor.z : (myEnt?.z ?? 0);
  const curMass = myEnt?.mass ?? CFG.START_MASS;
  input.computeAim(world.camera, curX, curZ, curMass);

  const validHeld = curMass >= 20 ? held : 0;
  const canDash = myMeta && predictor.on && gameState.alive && gameState.me.cd <= 0.05 && predictor.dashT <= 0;

  inputSeq += 1;
  const triggeredDashSeq = canDash ? inputSeq : undefined;
  predictor.currentSeq = inputSeq;

  if (canDash) {
    predictor.predictDash(myMeta.species, validHeld, input.aimA, gameState.map, isSuper, triggeredDashSeq);
    // Locally set cooldown so player cannot spam dash
    const baseCd = myMeta.species === 'chicken' ? CFG.DASH_CD * 0.65 : CFG.DASH_CD;
    const isPlow = validHeld >= CFG.CHARGE_MIN;
    gameState.me.cd = baseCd + (isPlow ? CFG.PLOW_CD * (myMeta.species === 'chicken' ? 0.65 : 1) : 0);
  }
  // Send btn: false immediately; only include hold if canDash was valid
  if (transport && gameState.alive) {
    const eatPayload = pendingEatHintsToSend.length > 0 ? pendingEatHintsToSend.splice(0, 6) : undefined;
    if (canDash) {
      transport.send({ t: 'input', seq: inputSeq, dashSeq: triggeredDashSeq, a: input.aimA, mv: input.aimMove, btn: false, hold: validHeld, ...(eatPayload ? { eat: eatPayload } : {}) });
    } else {
      transport.send({ t: 'input', seq: inputSeq, a: input.aimA, mv: input.aimMove, btn: false, ...(eatPayload ? { eat: eatPayload } : {}) });
    }
    lastSentInput = { a: input.aimA, mv: input.aimMove, btn: false };
    lastSentTime = performance.now();
  }
};

// Detect device types & standalone WebApp mode
const isIPad = (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) || /iPad/.test(navigator.userAgent);
const isMobilePhone = /Android|iPhone|iPod/i.test(navigator.userAgent);
const isPC = !isIPad && !isMobilePhone;
const isTouchDevice = isIPad || isMobilePhone || navigator.maxTouchPoints > 0;

function isStandaloneApp(): boolean {
  return !!(
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  );
}

if (isIPad) {
  document.body.classList.add('ipad');
} else if (isMobilePhone) {
  document.body.classList.add('mobile-phone');
}
if (isPC) {
  document.body.classList.add('is-pc');
}

const hud = new HudManager((name: string, species: Species, mode: 'ffa' | 'team' | 'friend', skin: number, roomCode?: string) => {
  unlockAudio();
  firstSpawn = true;
  awaitingJoinAck = true;
  isSpectating = false;
  spectateTargetId = null;
  localStunTimer = 0;
  wasStunnedLastFrame = false;
  inputSeq = 0;
  input.aimMove = true;
  input.cancelRam();
  if (isTouchDevice) {
    lockLandscape();
  }
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
    const matchDuration = mode === 'friend' ? hud.getMatchDuration() : undefined;
    transport.send({ t: 'join', name, species, skin, team, matchDuration, theme: getArenaTheme() });
  }
});

hud.onSetMatchDuration = (dur: number) => {
  if (currentRoomName.startsWith('priv-') && transport) {
    transport.send({ t: 'set_match_duration', duration: dur });
  }
};

hud.onSelectMode = (mode) => {
  if (mode === 'team') {
    connectToRoom('team-1');
    if (transport) {
      transport.send({ t: 'team_select', team: hud.selectedTeam });
    }
  } else if (mode === 'ffa') {
    connectToRoom('pub-1');
  }
};

hud.onSelectTeam = (team) => {
  if (currentRoomName.startsWith('team-') && transport) {
    transport.send({ t: 'team_select', team });
  }
};

hud.onChangeLanguage = () => {
  syncAudioUi();
  syncBoardUi();
  syncStatsUi();
  syncShadowUi();
  world.updateBarnSign();
  hud.updateTeamCounts(hud.lastCount0, hud.lastCount1);
  hud.updateSpecPlayBtn();
  const kingMeta = gameState.metas.get(gameState.napoleonId);
  const kingName = kingMeta ? kingMeta.name : undefined;
  hud.updateBoard(gameState.rule, gameState.reign, kingName, gameState.napoleonId === gameState.myId);
  updateFsIcon();
  const curL = getLanguage();
  const sbmLangVal = document.getElementById('sbmLangVal');
  if (sbmLangVal) sbmLangVal.textContent = curL === 'vi' ? 'Tiếng Việt' : 'English';
};

hud.onReconnect = () => {
  hud.showToast(t('coloSwitchingToast'));
  if (transport?.manualRetune) {
    transport.manualRetune();
  } else if (transport?.triggerHotMigration) {
    transport.triggerHotMigration();
  } else if (transport?.forceReconnect) {
    transport.forceReconnect();
  }
};

hud.onExitLobby = () => {
  if (transport) {
    if (transport.leaveGame) {
      transport.leaveGame();
    } else {
      transport.inGame = false;
      try {
        transport.send({ t: 'leave' });
      } catch (_) {}
    }
  }
  predictor.on = false;
  gameState.alive = false;
  isDeadAwaitingScreen = false;
  if (deathScreenTimer !== null) {
    clearTimeout(deathScreenTimer);
    deathScreenTimer = null;
  }
  missingMeTicks = 0;
  deathCamTarget = null;
  localStunTimer = 0;
  animals.clear();
  tools.clear();
  corpses.clear();
  gameState.food.clear();
  hud.returnToLobby();
  hud.showToast(t('exitLobbyToast'));
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
      hud.updateSpectatorTarget(meta ? meta.name : t('playerDefault'), Math.round(ent.mass));
      world.snapCamera(ent.x, ent.z, ent.mass);
      return;
    }
    spectateTargetId = null;
    hud.updateSpectatorTarget(t('noPlayer'), 0);
    return;
  }
  const pool = living.filter(([id]) => id !== spectateTargetId);
  const candidates = pool.length > 0 ? pool : living;
  const [chosenId, ent] = candidates[Math.floor(Math.random() * candidates.length)];
  spectateTargetId = chosenId;
  const meta = gameState.metas.get(chosenId);
  hud.updateSpectatorTarget(meta ? meta.name : t('playerDefault'), Math.round(ent.mass));
  world.snapCamera(ent.x, ent.z, ent.mass);
}

hud.onStartSpectating = () => {
  isSpectating = true;
  hud.isSpectating = true;
  document.body.classList.add('spectating');
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.hidden = false;
  hud.updateSpecPlayBtn();
  input.cancelRam();
  chargeStop();
  pickRandomSpectateTarget();
};

hud.onNextSpectating = () => {
  pickRandomSpectateTarget();
};

hud.onSelectSpectateTarget = (id: number) => {
  if (id === gameState.myId) {
    if (isSpectating) {
      hud.onStopSpectating?.();
    }
    return;
  }
  isSpectating = true;
  spectateTargetId = id;
  hud.isSpectating = true;
  document.body.classList.add('spectating');
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.hidden = false;
  const specBar = document.getElementById('spectateBar');
  if (specBar) specBar.hidden = false;
  hud.updateSpecPlayBtn();
  const deathEl = document.getElementById('death');
  if (deathEl) deathEl.hidden = true;
  document.body.classList.remove('menu');
  input.cancelRam();
  chargeStop();
  const targetEnt = gameState.ents.get(id);
  const targetMeta = gameState.metas.get(id);
  const playerName = targetMeta ? targetMeta.name : t('playerDefault');
  const playerMass = targetEnt ? Math.round(targetEnt.mass) : 0;
  hud.updateSpectatorTarget(playerName, playerMass);
  if (targetEnt) {
    world.snapCamera(targetEnt.x, targetEnt.z, targetEnt.mass);
  }
};

hud.onStopSpectating = () => {
  isSpectating = false;
  spectateTargetId = null;
  hud.isSpectating = false;
  document.body.classList.remove('spectating');
  const specBar = document.getElementById('spectateBar');
  if (specBar) specBar.hidden = true;
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.hidden = false;
  if (hud.isPlayerAlive && gameState.alive) {
    const me = gameState.ents.get(gameState.myId);
    if (me) {
      predictor.reset(me.x, me.z);
      world.snapCamera(me.x, me.z, me.mass);
    }
  }
};

// Click on 3D animal or floating name in spectator mode to follow that player
window.addEventListener('pointerdown', (e) => {
  if (!isSpectating) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('#hud, #gameControls, #death, #start, #specBar, #lb, #drawer, button, input, #pcSettingsMenu')) {
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, world.camera);
  const ray = raycaster.ray;

  let bestId: number | null = null;
  let bestDist = Infinity;

  for (const [id, ent] of gameState.ents.entries()) {
    if (ent.mass < 1) continue;
    const sc = Math.pow(ent.mass / 20, 0.38);
    const animalY = 0.8 * sc;
    const labelY = animalY + sc * 1.8;

    const pCenter = new THREE.Vector3(ent.x, animalY, ent.z);
    const distCenter = ray.distanceToPoint(pCenter);

    const pLabel = new THREE.Vector3(ent.x, labelY, ent.z);
    const distLabel = ray.distanceToPoint(pLabel);

    const hitThreshold = Math.max(2.8, sc * 2.5);
    const minDist = Math.min(distCenter, distLabel);
    if (minDist <= hitThreshold && minDist < bestDist) {
      bestDist = minDist;
      bestId = id;
    }
  }

  if (bestId !== null) {
    hud.onSelectSpectateTarget?.(bestId);
  }
});

hud.onPickRule = (ruleId) => {
  transport?.send({ t: 'rule', id: ruleId });
};
// 3-State Audio Synchronization & 1-Second Notification Toast
let audioToastTimer: any = null;
function showAudioToast(mode: AudioMode): void {
  const ico = mode === 0 ? '🔊' : (mode === 1 ? '🔈' : '🔇');
  const txt = mode === 0 ? t('audio_all') : (mode === 1 ? t('audio_sfx') : t('audio_mute'));
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

  clearTimeout(audioToastTimer);
  audioToastTimer = setTimeout(() => {
    toast?.classList.remove('show');
    toast?.classList.add('fade-out');
  }, 1000);
}

function syncAudioUi(): void {
  const mode = getAudioMode();
  hud.setMuteState(mode);
  const ico = mode === 0 ? '🔊' : (mode === 1 ? '🔈' : '🔇');
  const txt = mode === 0 ? t('audio_all') : (mode === 1 ? t('audio_sfx') : t('audio_mute'));
  if (muteInGameBtn) {
    muteInGameBtn.textContent = ico;
    muteInGameBtn.title = txt;
  }
  const startMuteBtn = document.getElementById('mute');
  if (startMuteBtn) {
    startMuteBtn.innerHTML = `<span class="ico">${ico}</span>`;
    startMuteBtn.title = txt;
  }
  const sbmMuteIcon = document.getElementById('sbmMuteIcon');
  if (sbmMuteIcon) sbmMuteIcon.textContent = ico;
  const sbmMuteVal = document.getElementById('sbmMuteVal');
  if (sbmMuteVal) sbmMuteVal.textContent = txt;
}

function handleAudioToggle(): void {
  unlockAudio();
  const next = cycleAudioMode();
  syncAudioUi();
  showAudioToast(next);
}

hud.onToggleMute = handleAudioToggle;
window.addEventListener('pointerdown', () => unlockAudio(), { once: true, passive: true });
window.addEventListener('touchstart', () => unlockAudio(), { once: true, passive: true });

// Fullscreen & anti-zoom management for desktop, mobile & iPad Chrome/Safari
const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement | null;
const startFsBtn = document.getElementById('startFsBtn') as HTMLButtonElement | null;
const muteInGameBtn = document.getElementById('muteInGame') as HTMLButtonElement | null;
let isPseudoFs = false;

function getFullscreenElement(): Element | null {
  const doc = document as any;
  return (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.webkitCurrentFullScreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  );
}

function isNativeFsActive(): boolean {
  return getFullscreenElement() !== null;
}

function canNativeFullscreen(): boolean {
  const docEl = document.documentElement as any;
  const doc = document as any;
  return !!(
    doc.fullscreenEnabled ||
    doc.webkitFullscreenEnabled ||
    doc.mozFullScreenEnabled ||
    doc.msFullscreenEnabled ||
    docEl.requestFullscreen ||
    docEl.webkitRequestFullscreen ||
    docEl.webkitRequestFullScreen ||
    docEl.mozRequestFullScreen ||
    docEl.msRequestFullscreen
  );
}

function isFsActive(): boolean {
  if (isNativeFsActive()) return true;
  if (!canNativeFullscreen() || isStandaloneApp()) {
    return isPseudoFs;
  }
  return false;
}

function updateFsIcon(): void {
  const active = isFsActive();
  const enterTitle = t('fullscreen') || 'Toàn màn hình';
  const exitTitle = 'Thu nhỏ màn hình';
  [fsBtn, startFsBtn].forEach((btn) => {
    if (!btn) return;
    const enterEl = btn.querySelector('.fs-icon-enter') as HTMLElement | null;
    const exitEl = btn.querySelector('.fs-icon-exit') as HTMLElement | null;
    if (enterEl && exitEl) {
      enterEl.style.display = active ? 'none' : 'inline-flex';
      exitEl.style.display = active ? 'inline-flex' : 'none';
    } else {
      btn.textContent = active ? '⤢' : '⛶';
    }
    btn.title = active ? exitTitle : enterTitle;
  });
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

function lockLandscape(): void {
  try {
    const ori = (screen.orientation as any) || (screen as any).mozOrientation || (screen as any).msOrientation;
    if (ori && typeof ori.lock === 'function') {
      ori.lock('landscape').catch(() => {});
    }
  } catch (_e) {}
}

function unlockLandscape(): void {
  try {
    const ori = (screen.orientation as any) || (screen as any).mozOrientation || (screen as any).msOrientation;
    if (ori && typeof ori.unlock === 'function') {
      ori.unlock();
    }
  } catch (_e) {}
}

async function toggleFs(): Promise<void> {
  const active = isFsActive();

  if (!active) {
    enablePseudoFs();
    lockLandscape();

    const docEl = document.documentElement as any;
    const reqFn =
      docEl.requestFullscreen ||
      docEl.webkitRequestFullscreen ||
      docEl.webkitRequestFullScreen ||
      docEl.mozRequestFullScreen ||
      docEl.msRequestFullscreen;

    if (typeof reqFn === 'function') {
      try {
        const res = reqFn.call(docEl);
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (err) {
        console.warn('Fullscreen request failed or was blocked:', err);
      }
    }
  } else {
    const doc = document as any;
    const exitFn =
      doc.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.webkitCancelFullScreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;

    if (typeof exitFn === 'function' && isNativeFsActive()) {
      try {
        const res = exitFn.call(doc);
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (err) {
        console.warn('Native exitFullscreen error:', err);
      }
    }

    if (!isStandaloneApp()) {
      disablePseudoFs();
      unlockLandscape();
    }
  }
  setTimeout(updateFsIcon, 80);
}

function handleFsChange(): void {
  if (isNativeFsActive()) {
    enablePseudoFs();
    lockLandscape();
  } else {
    if (!isStandaloneApp()) {
      disablePseudoFs();
      unlockLandscape();
    }
  }
  updateFsIcon();
  window.dispatchEvent(new Event('resize'));
}

document.addEventListener('fullscreenchange', handleFsChange);
document.addEventListener('webkitfullscreenchange', handleFsChange);
document.addEventListener('mozfullscreenchange', handleFsChange);
document.addEventListener('MSFullscreenChange', handleFsChange);
updateFsIcon();

// Anti-Zoom & Touch Gesture Lock (iPad & Mobile Chrome/Safari)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

// Prevent double-tap zoom natively without swallowing button clicks
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// Lock downward swipe gesture on iOS/iPadOS to prevent exiting fullscreen or revealing browser bar
let touchStartClientY = 0;
window.addEventListener('touchstart', (e) => {
  if (e.touches.length > 0) {
    touchStartClientY = e.touches[0].clientY;
    const target = e.target as HTMLElement | null;
    const isInteractive = target?.closest('button, input, select, textarea, a, .drawer-modal, .card, #gameControls, #netPerf, #pwaModal, .center-modal-card');
    // If on touch device, cancel default touch in top edge zone (<75px) to prevent system swipe-down gesture
    if (!isInteractive && e.cancelable && isTouchDevice) {
      if (e.touches[0].clientY < 75) {
        e.preventDefault();
      }
    }
    // If during live game, ensure Safari URL bar collapses back to minimal UI
    if (transport && transport.inGame && (window.scrollY !== 0 || window.scrollX !== 0)) {
      try { window.scrollTo(0, 0); } catch (_) {}
    }
  }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 0) return;
  if (e.touches.length > 1) {
    if (e.cancelable) e.preventDefault();
    return;
  }

  const currentY = e.touches[0].clientY;
  const dy = currentY - touchStartClientY;

  const target = e.target as HTMLElement | null;
  const isScrollable = target?.closest('.drawer-cols, .sp-palette, .screen, .center-modal-card, .pwa-card');

  if (isScrollable) {
    const el = isScrollable as HTMLElement;
    const isAtTop = el.scrollTop <= 0;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((isAtTop && dy > 0) || (isAtBottom && dy < 0)) {
      if (e.cancelable) e.preventDefault();
    }
    return;
  }

  // Prevent default globally on touchmove to lock fullscreen and prevent swipe down
  if (e.cancelable) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent accidental scroll drifts on iPad Chrome
window.addEventListener('scroll', () => {
  if (window.scrollX !== 0 || window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
});

// Helper for fast, reliable single-tap on iPad (fixes iOS double-tap requirement)
function bindFastTap(el: HTMLElement | null, handler: (e: Event) => void): void {
  if (!el) return;
  let lastTouchTime = 0;
  el.addEventListener('touchend', (e) => {
    lastTouchTime = Date.now();
    e.preventDefault();
    e.stopPropagation();
    handler(e);
  }, { passive: false });

  el.addEventListener('click', (e) => {
    if (Date.now() - lastTouchTime < 400) return;
    e.stopPropagation();
    handler(e);
  });
}

if (fsBtn) {
  fsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFs();
  });
}
if (startFsBtn) {
  startFsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFs();
  });
}

// PWA Standalone & Install Modal Management
const pwaInstallBtn = document.getElementById('pwaInstallBtn') as HTMLButtonElement | null;
const pwaModal = document.getElementById('pwaModal') as HTMLElement | null;
const pwaCloseBtn = document.getElementById('pwaCloseBtn') as HTMLButtonElement | null;

let deferredInstallPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (pwaInstallBtn && !isStandaloneApp() && !isPC) {
    pwaInstallBtn.hidden = false;
  }
});

if (isStandaloneApp() || isPC) {
  if (isStandaloneApp()) enablePseudoFs();
  if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
} else if (pwaInstallBtn) {
  pwaInstallBtn.hidden = false;
  bindFastTap(pwaInstallBtn, async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        pwaInstallBtn.style.display = 'none';
      }
      deferredInstallPrompt = null;
    } else if (pwaModal) {
      pwaModal.hidden = false;
    }
  });
}

if (pwaCloseBtn && pwaModal) {
  bindFastTap(pwaCloseBtn, () => {
    pwaModal.hidden = true;
  });
  pwaModal.addEventListener('click', (e) => {
    if (e.target === pwaModal) {
      pwaModal.hidden = true;
    }
  });
}

// Lobby Burger Menu
const startBurgerBtn = document.getElementById('startBurgerBtn') as HTMLButtonElement | null;
const startBurgerMenu = document.getElementById('startBurgerMenu') as HTMLElement | null;
const startBurgerClose = document.getElementById('startBurgerClose') as HTMLButtonElement | null;
const sbmMute = document.getElementById('sbmMute') as HTMLButtonElement | null;
const sbmLang = document.getElementById('sbmLang') as HTMLButtonElement | null;
const sbmShadow = document.getElementById('sbmShadow') as HTMLButtonElement | null;
const sbmPwa = document.getElementById('sbmPwa') as HTMLButtonElement | null;
const sbmDisclaimer = document.getElementById('sbmDisclaimer') as HTMLButtonElement | null;
const sbmExit = document.getElementById('sbmExit') as HTMLButtonElement | null;

// Lobby Exit App Confirmation Modal
const appExitConfirmModal = document.getElementById('appExitConfirmModal') as HTMLElement | null;
const btnCancelAppExit = document.getElementById('btnCancelAppExit') as HTMLButtonElement | null;
const btnConfirmAppExit = document.getElementById('btnConfirmAppExit') as HTMLButtonElement | null;

const showAppExitModal = () => {
  if (startBurgerMenu) startBurgerMenu.hidden = true;
  if (appExitConfirmModal) appExitConfirmModal.hidden = false;
};

const hideAppExitModal = () => {
  if (appExitConfirmModal) appExitConfirmModal.hidden = true;
};

const closeGameWindow = () => {
  try { setMuted(true); } catch (_) {}
  try {
    if (transport && typeof (transport as any).close === 'function') {
      (transport as any).close();
    }
  } catch (_) {}
  window.close();
  setTimeout(() => {
    try {
      window.open('', '_self', '');
      window.close();
    } catch (_) {}
    setTimeout(() => {
      if (!window.closed) {
        try {
          window.location.href = 'about:blank';
        } catch (_) {}
      }
    }, 150);
  }, 100);
};

if (startBurgerBtn && startBurgerMenu) {
  const toggleStartBurger = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    startBurgerMenu.hidden = !startBurgerMenu.hidden;
    syncAudioUi();
    syncShadowUi();
    const curL = getLanguage();
    const sbmLangVal = document.getElementById('sbmLangVal');
    if (sbmLangVal) sbmLangVal.textContent = curL === 'vi' ? 'Tiếng Việt' : 'English';
  };
  startBurgerBtn.addEventListener('click', toggleStartBurger);
}

if (startBurgerClose && startBurgerMenu) {
  startBurgerClose.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startBurgerMenu.hidden = true;
  });
}

window.addEventListener('click', (e) => {
  if (startBurgerMenu && !startBurgerMenu.hidden) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('#startBurgerMenu') && !target?.closest('#startBurgerBtn')) {
      startBurgerMenu.hidden = true;
    }
  }
});

if (sbmMute) {
  sbmMute.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleAudioToggle();
  });
}

if (sbmLang) {
  sbmLang.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.click();
    }
  });
}

if (sbmShadow) {
  sbmShadow.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showShadows = !showShadows;
    try { localStorage.setItem('fb_shadows', showShadows ? '1' : '0'); } catch (_) {}
    syncShadowUi();
  });
}

if (sbmPwa) {
  sbmPwa.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (startBurgerMenu) startBurgerMenu.hidden = true;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choice: any) => {
        if (choice && choice.outcome === 'accepted') {
          if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
        }
        deferredInstallPrompt = null;
      });
    } else if (pwaModal) {
      pwaModal.hidden = false;
    }
  });
}

if (sbmDisclaimer) {
  sbmDisclaimer.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (startBurgerMenu) startBurgerMenu.hidden = true;
    hud.showDisclaimer();
  });
}

if (sbmExit) {
  sbmExit.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAppExitModal();
  });
}

if (btnCancelAppExit) {
  btnCancelAppExit.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideAppExitModal();
  });
}

if (btnConfirmAppExit) {
  btnConfirmAppExit.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideAppExitModal();
    closeGameWindow();
  });
}

if (appExitConfirmModal) {
  appExitConfirmModal.addEventListener('pointerdown', (e) => {
    const card = appExitConfirmModal.querySelector('.center-modal-card');
    if (card && !card.contains(e.target as Node)) {
      hideAppExitModal();
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (appExitConfirmModal && !appExitConfirmModal.hidden) {
      hideAppExitModal();
    }
    if (startBurgerMenu && !startBurgerMenu.hidden) {
      startBurgerMenu.hidden = true;
    }
  }
});

// Mobile & iPad Burger Drawer Modal
const burgerBtn = document.getElementById('burgerBtn');
const gameDrawerModal = document.getElementById('gameDrawerModal');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const drawerBoardToggle = document.getElementById('drawerBoardToggle');
const drawerStatsToggle = document.getElementById('drawerStatsToggle');
const drawerShadowToggle = document.getElementById('drawerShadowToggle');

// PC Settings Menu
const pcSettingsBtn = document.getElementById('pcSettingsBtn');
const pcSettingsMenu = document.getElementById('pcSettingsMenu');
const pcToggleBoard = document.getElementById('pcToggleBoard') as HTMLInputElement | null;
const pcToggleStats = document.getElementById('pcToggleStats') as HTMLInputElement | null;
const pcToggleLb = document.getElementById('pcToggleLb') as HTMLInputElement | null;
const pcToggleShadow = document.getElementById('pcToggleShadow') as HTMLInputElement | null;

let showBoard = localStorage.getItem('fb_show_board') !== '0';
let showStats = localStorage.getItem('fb_show_stats') !== '0';
let showLb = localStorage.getItem('fb_show_lb') !== '0';
let showShadows = localStorage.getItem('fb_shadows') !== '0';

function syncBoardUi(): void {
  hud.setBoardVisible(showBoard);
  if (drawerBoardToggle) {
    const lbl = drawerBoardToggle.querySelector('.lbl') || drawerBoardToggle;
    lbl.textContent = `${t('boardSetting')}: ${showBoard ? t('on') : t('off')}`;
    drawerBoardToggle.classList.toggle('off', !showBoard);
  }
  if (pcToggleBoard) pcToggleBoard.checked = showBoard;
}

function syncStatsUi(): void {
  hud.setStatsVisible(showStats);
  if (drawerStatsToggle) {
    const lbl = drawerStatsToggle.querySelector('.lbl') || drawerStatsToggle;
    lbl.textContent = `${t('statsSetting')}: ${showStats ? t('on') : t('off')}`;
    drawerStatsToggle.classList.toggle('off', !showStats);
  }
  if (pcToggleStats) pcToggleStats.checked = showStats;
}

function syncLbUi(): void {
  hud.setLbVisible(showLb);
  if (pcToggleLb) pcToggleLb.checked = showLb;
}

function syncShadowUi(): void {
  world.setShadowsEnabled(showShadows);

  // 1. Lobby Burger item:
  const sbmShadowVal = document.getElementById('sbmShadowVal');
  const sbmShadowIcon = document.getElementById('sbmShadowIcon');
  if (sbmShadowVal) {
    sbmShadowVal.textContent = showShadows ? t('shadow_on') : t('shadow_off');
  }
  if (sbmShadowIcon) {
    sbmShadowIcon.textContent = showShadows ? '🌗' : '☀️';
  }

  // 2. In-Game Drawer button (for touch / iPad / iPhone):
  if (drawerShadowToggle) {
    const lbl = drawerShadowToggle.querySelector('.lbl') || drawerShadowToggle;
    lbl.textContent = `${t('shadowSetting')}: ${showShadows ? t('on') : t('off')}`;
    drawerShadowToggle.classList.toggle('off', !showShadows);
  }

  // 3. PC Settings Checkbox:
  if (pcToggleShadow) {
    pcToggleShadow.checked = showShadows;
  }
}

if (burgerBtn && gameDrawerModal) {
  bindFastTap(burgerBtn, () => {
    gameDrawerModal.hidden = false;
    syncBoardUi();
    syncStatsUi();
    syncShadowUi();
  });
}

function closeDrawer(): void {
  if (gameDrawerModal) gameDrawerModal.hidden = true;
}

bindFastTap(drawerCloseBtn, closeDrawer);
bindFastTap(drawerBackdrop, closeDrawer);

bindFastTap(drawerBoardToggle, () => {
  showBoard = !showBoard;
  try { localStorage.setItem('fb_show_board', showBoard ? '1' : '0'); } catch (_) {}
  syncBoardUi();
});

bindFastTap(drawerStatsToggle, () => {
  showStats = !showStats;
  try { localStorage.setItem('fb_show_stats', showStats ? '1' : '0'); } catch (_) {}
  syncStatsUi();
});

bindFastTap(drawerShadowToggle, () => {
  showShadows = !showShadows;
  try { localStorage.setItem('fb_shadows', showShadows ? '1' : '0'); } catch (_) {}
  syncShadowUi();
});

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

if (pcToggleShadow) {
  pcToggleShadow.addEventListener('change', () => {
    showShadows = pcToggleShadow.checked;
    try { localStorage.setItem('fb_shadows', showShadows ? '1' : '0'); } catch (_) {}
    syncShadowUi();
  });
}

if (muteInGameBtn) {
  bindFastTap(muteInGameBtn, handleAudioToggle);
}

// Initialize audio and UI state
syncAudioUi();
syncBoardUi();
syncStatsUi();
syncShadowUi();
syncLbUi();

let firstSpawn = true;

const gameState = new GameState({
  onInit(map, isReconnecting) {
    if (!isReconnecting) {
      world.buildMap(map);
      corpses.setMap(map);
      minions.setMap(map);
      if (!gameState.alive) {
        animals.clear();
      }
      tools.clear();
      minions.clear();
    }
    tools.sync(gameState.tools ? Array.from(gameState.tools.values()) : []);
  },
  onJoined(_id, isReconnecting) {
    if (deathScreenTimer !== null) {
      clearTimeout(deathScreenTimer);
      deathScreenTimer = null;
    }
    isDeadAwaitingScreen = false;
    awaitingJoinAck = false;
    missingMeTicks = 0;
    deathCamTarget = null;
    isSpectating = false;
    spectateTargetId = null;
    localStunTimer = 0;
    wasStunnedLastFrame = false;
    inputSeq = 0;
    input.aimMove = true;
    input.cancelRam();
    hud.isPlayerAlive = true;
    hud.showInGame();
    if (!gameState.metas.has(gameState.myId)) {
      gameState.metas.set(gameState.myId, {
        id: gameState.myId,
        name: hud.getPlayerName(),
        species: hud.getSelectedSpecies(),
        skin: hud.getSelectedSkin(),
        bot: false,
        team: hud.selectedTeam,
      });
    }
    if (!isReconnecting) {
      hud.showBanner(t('welcome'), t('welcomeSub'));
      prevMass = CFG.START_MASS;
      gainAcc = 0;
      gainTimer = 0;
      firstSpawn = true;
      predictor.on = false;
      hasPrevPred = false;
      pendingEatHintsToSend.length = 0;
      optimisticEatenMap.clear();
    }
  },
  onEvent(ev: GameEvent) {
    handleGameEvent(ev);
  },
  onSnapshot(s: Snapshot) {
    tools.sync(s.tl || []);
    if (Array.isArray(s.fr)) {
      for (const id of s.fr) {
        optimisticEatenMap.delete(id);
      }
    }
    if (optimisticEatenMap.size > 0) {
      for (const fid of optimisticEatenMap.keys()) {
        gameState.food.delete(fid);
      }
    }
    let seenMe = false;
    for (const [id, x, z, _a, mass, flags, _charge] of s.p) {
      if (id === gameState.myId && gameState.alive) {
        seenMe = true;
        missingMeTicks = 0;
        if (firstSpawn || (!isSpectating && Math.hypot(x - world.camTarget.x, z - world.camTarget.z) > 40)) {
          firstSpawn = false;
          predictor.reset(x, z);
          world.snapCamera(x, z, mass);
        }
        const stableBaseRtt = (transport as any)?.rttMin ?? (transport ? transport.rtt : 48);
        predictor.onServerSnapshot(
          x,
          z,
          flags,
          gameState.snapTick,
          transport?.clockOffset ?? gameState.clockOff,
          stableBaseRtt,
          s.ackSeq ?? 0,
          s.ackDash ?? 0,
          s.st
        );

        const myEnt = gameState.ents.get(gameState.myId);
        if (myEnt && predictor.on) {
          (myEnt as any).serverX = x;
          (myEnt as any).serverZ = z;
          myEnt.x = predictor.x;
          myEnt.z = predictor.z;
          myEnt.a = predictor.a;
        }

        let unackedBoost = 0;
        const nowPerf = performance.now();
        const ackWindow = stableBaseRtt + 70;
        for (const entry of optimisticEatenMap.values()) {
          if (nowPerf - entry.eatenAtPerf < ackWindow) {
            unackedBoost += entry.foodValue;
          }
        }

        hud.updateStats(mass + unackedBoost, gameState.me.rank, gameState.total, gameState.me.kills);
        // Mass change tracking with accumulator matching original game
        if (gameState.alive && prevMass > 0 && mass !== prevMass) {
          gainAcc += mass - prevMass;
          if (mass > prevMass && mass - prevMass < 20) {
            if (optimisticEatenMap.size === 0) {
              sfxEat(mass - prevMass >= 5);
            }
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
      if (transport && transport.inGame && gameState.alive && gameState.myId > 0 && !isDeadAwaitingScreen && !hud.isDeathScreenVisible() && !hud.isLobbyVisible()) {
        missingMeTicks++;
        if (missingMeTicks >= 40) {
          missingMeTicks = 0;
          console.warn('[Watchdog] Character missing from server snapshots for >2s while in-game. Showing death screen...');
          isDeadAwaitingScreen = false;
          if (transport) transport.inGame = false;
          gameState.alive = false;
          hud.isPlayerAlive = false;
          isSpectating = false;
          spectateTargetId = null;
          hud.showDeath({
            k: 'die',
            id: gameState.myId,
            by: 0,
            cause: 'fence',
            x: world.camTarget.x,
            z: world.camTarget.z,
            mass: gameState.myMass || CFG.START_MASS,
            best: gameState.myMass || CFG.START_MASS,
            kills: gameState.me.kills || 0,
            alive: 0,
            spoils: 0,
            streak: 0,
          });
        }
      }
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
    hud.updateHof(gameState.hof);
    if (s.team) {
      hud.updateTeamBar(s.team[0], s.team[1], s.team[2], s.team[3], s.team[4]);
    }
    if (s.podShield) {
      predictor.podShieldActive = s.podShield[0];
      hud.updatePodiumTimerBadge(s.podShield[0], s.podShield[1], gameState.napoleonId > 0);
    }
    if (s.trees) {
      world.updateTrees(s.trees);
    }
  },
});

function handleGameEvent(ev: GameEvent): void {
  const myId = gameState.myId;
  switch (ev.k) {
    case 'hit': {
      if (ev.minion) {
        // Minion hit: render visual fluff/burst and sound at impact location,
        // but NEVER disturb player's position, predictor, camera, or velocity!
        sfxHit(ev.s, 0.35);
        foodParts.burst(ev.x, 1.4, ev.z, 0xfff3a0, 14, 6, 6, 0.5);
        const vm = gameState.metas.get(ev.v);
        if (vm) {
          if (ev.v !== myId) {
            animals.notifyHit(ev.v);
            yelp(vm.species, 0.4);
          }
          const FLUFF_COLORS: Record<Species, number> = {
            chicken: 0xfaf6ee, duck: 0xffd23f, sheep: 0xf3f1ea, pig: 0xf6a5b5, cow: 0xffffff, horse: 0x8b5a2b, dog: 0xd9822b, elephant: 0x828892, monkey: 0x8d5b38, gorilla: 0x3a3c42, mammoth: 0x5a3d28,
          };
          foodParts.fluff(ev.x, ev.z, FLUFF_COLORS[vm.species] ?? 0xffffff, 6);
        }
        if (ev.loss && ev.loss >= 1) {
          const lossNum = Math.round(ev.loss);
          const victimPos = animals.getPosition(ev.v);
          const initPos = victimPos ? { x: victimPos.x, z: victimPos.z, mass: 50 } : { x: ev.x, z: ev.z, mass: 50 };
          hud.floatText(`-${lossNum} kg`, 'loss', ev.v, initPos);
        }
        break;
      }

      const meEnt = gameState.ents.get(myId);
      const myRadius = radiusOf(meEnt ? meEnt.mass : CFG.START_MASS);
      const distToHit = Math.hypot(predictor.x - ev.x, predictor.z - ev.z);
      const isPhysicallyNearHit = distToHit <= myRadius + 3.2;

      const isMine = (ev.a === myId || ev.v === myId) && isPhysicallyNearHit;
      sfxHit(ev.s, isMine ? 1 : 0.4);
      animals.notifyHit(ev.v);
      const vm = gameState.metas.get(ev.v);
      if (vm) {
        yelp(vm.species, isMine ? 1 : 0.5);
      }
      const FLUFF_COLORS: Record<Species, number> = {
        chicken: 0xfaf6ee, duck: 0xffd23f, sheep: 0xf3f1ea, pig: 0xf6a5b5, cow: 0xffffff, horse: 0x8b5a2b, dog: 0xd9822b, elephant: 0x828892, monkey: 0x8d5b38, gorilla: 0x3a3c42, mammoth: 0x5a3d28,
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
      if (isMine) shake = Math.max(shake, 0.15);

      // Super Rainbow Candy sonic blast visual effect (clean visual, no cannon shaking or boom sound)
      if (ev.s >= 70) {
        foodParts.sonicWave(ev.x, 0.8, ev.z, 3.5);
      }

      // Attacker hit someone with normal (non-plow) dash: stop dash velocity immediately on impact!
      if (ev.a === myId && !predictor.plow && isPhysicallyNearHit) {
        predictor.dashT = 0;
        predictor.vx *= 0.25;
        predictor.vz *= 0.25;
        const toContactX = ev.x - predictor.x;
        const toContactZ = ev.z - predictor.z;
        const dot = toContactX * Math.cos(predictor.a) + toContactZ * Math.sin(predictor.a);
        if (dot < 0) {
          predictor.x = ev.x - Math.cos(predictor.a) * myRadius;
          predictor.z = ev.z - Math.sin(predictor.a) * myRadius;
        }
      }
      // Victim hit by someone: stop dash and charging immediately, apply knockback impulse
      if (ev.v === myId && ev.a !== 0 && isPhysicallyNearHit) {
        predictor.dashT = 0;
        predictor.plow = false;
        input.cancelRam();
        chargeStop();
        const hitDx = predictor.x - ev.x;
        const hitDz = predictor.z - ev.z;
        const hitD = Math.hypot(hitDx, hitDz);
        if (hitD > 0.01 && ev.s > 15) {
          const nx = hitDx / hitD;
          const nz = hitDz / hitD;
          predictor.vx = nx * ev.s;
          predictor.vz = nz * ev.s;
        }
      }

      // Stun lockout ONLY when hitting a post/obstacle ("trúng cọc" / "trúng bục", ev.a === 0)!
      // Normal ramming between animals does NOT cause stun!
      if (ev.v === myId && ev.a === 0 && isPhysicallyNearHit) {
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
    case 'treeHit': {
      world.onTreeHit(ev.id, ev.by, ev.x, ev.z, ev.size, ev.droppedBig, ev.droppedSmall);
      const isMine = ev.by === myId;
      sfxHit(3.5, isMine ? 1.0 : 0.4);
      if (isMine) {
        shake = Math.max(shake, 1.2);
        const myMeta = gameState.metas.get(myId);
        const isPrimate = myMeta?.species === 'monkey' || myMeta?.species === 'gorilla';
        if (!isPrimate) {
          // Stun for 1.5 seconds on successful ram (Monkey & Gorilla immune to tree stun)
          const stunDur = 1.5;
          localStunTimer = stunDur;
          lockedAimA = predictor.dashT > 0 ? predictor.a : input.aimA;
          predictor.setStun(stunDur);
          predictor.dashT = 0;
          predictor.plow = false;
          input.cancelRam();
          chargeStop();
        }

        const avgFruitKg = ev.size === 2 ? 100 : ev.size === 1 ? 35 : 7.5;
        const totalDroppedKg = (ev.droppedBig + ev.droppedSmall) * avgFruitKg;
        const myEnt = gameState.ents.get(myId);
        const rawPos = animals.getPosition(myId);
        const myPos = rawPos
          ? { x: rawPos.x, z: rawPos.z, mass: myEnt ? myEnt.mass : 100 }
          : myEnt
          ? { x: myEnt.x, z: myEnt.z, mass: myEnt.mass }
          : { x: ev.x, z: ev.z, mass: 100 };
        hud.floatText(`Rung rơi ${ev.droppedBig + ev.droppedSmall} quả (+${Math.round(totalDroppedKg)} kg)! 🍎`, 'spoil', myId, myPos);
      }
      const leafColor = getArenaTheme() === 'women_day' ? 0xff4081 : 0x4caf50;
      foodParts.burst(ev.x, 3.5, ev.z, leafColor, 24, 7, 6, 0.7);
      foodParts.burst(ev.x, 3.5, ev.z, 0xffeb3b, 14, 5, 5, 0.5);
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
      } else if (ev.cause === 'till' || ev.cause === 'crush') {
        foodParts.burst(ev.x, 0.4, ev.z, 0x795548, 22, 6, 6, 0.4);
        foodParts.puff(ev.x, 0.3, ev.z, 0x5d4037, 1.2, 1.0, 1.8);
        sfxZap(isMine ? 0.7 : 0.35);
      } else {
        foodParts.burst(ev.x, 1.6, ev.z, 0xfff35c, 18, 10, 9, 0.5);
        sfxZap(isMine ? 1 : 0.5);
      }

      if (ev.id === gameState.napoleonId && ev.id > 0) {
        sfxDethrone();
        if (!killerName) {
          hud.showBanner(t('napFell', { name: victimName }), t('overSub'));
        }
      }

      if (ev.id === myId) {
        localStunTimer = 0;
        wasStunnedLastFrame = false;
        predictor.on = false;
        hasPrevPred = false;
        pendingEatHintsToSend.length = 0;
        optimisticEatenMap.clear();
        missingMeTicks = 0;
        isDeadAwaitingScreen = true;
        isSpectating = false;
        spectateTargetId = null;
        gameState.alive = false;
        hud.isPlayerAlive = false;
        if (transport) transport.inGame = false;
        if (deathScreenTimer !== null) {
          clearTimeout(deathScreenTimer);
          deathScreenTimer = null;
        }
        // Delay death screen to show death animation first
        deathCamTarget = { x: ev.x, z: ev.z };
        deathScreenTimer = window.setTimeout(() => {
          deathScreenTimer = null;
          deathCamTarget = null;
          isDeadAwaitingScreen = false;
          hud.showDeath(ev, killerName);
        }, 1500);
      } else if (ev.by === myId) {
        sfxReward();
        const isMobile = document.body.classList.contains('mobile-phone') ||
          (!document.body.classList.contains('ipad') && !document.body.classList.contains('is-pc') && window.innerWidth <= 640);
        if (isMobile) {
          // Trên điện thoại: gộp thành 1 thông báo ngắn gọn tại cùng 1 vị trí, không đè nhiều lớp
          const spoilsText = ev.spoils > 0 ? ` (+${ev.spoils}kg)` : '';
          const streakText = ev.streak >= 2 ? ` 🔥 ${t((`streak${Math.min(5, ev.streak)}` as const))}` : '';
          hud.showToast(`${t('youKO', { name: victimName })}${spoilsText}${streakText}`, 1800);
        } else {
          hud.showToast(t('youKO', { name: victimName }));
          if (ev.spoils > 0) {
            hud.showToast(t('spoils', { kg: ev.spoils }));
          }
          if (ev.streak >= 2) {
            const sKey = `streak${Math.min(5, ev.streak)}` as const;
            hud.showToast(t(sKey));
          }
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
        if (ev.usurped) {
          hud.showBanner(t('youUsurped'), t('youUsurpedSub'));
        } else {
          hud.showBanner(t('youNap'), t('youNapSub'));
        }
        hud.updateBoard(gameState.rule, gameState.reign, gameState.metas.get(myId)?.name || 'BẠN', true);
      } else if (ev.id > 0) {
        sfxCrown();
        const king = gameState.metas.get(ev.id);
        const name = king ? king.name : 'Ai đó';
        if (ev.usurped) {
          hud.showBanner(t('napUsurped', { name }), t('napUsurpedSub'));
        } else {
          hud.showBanner(t('napNew', { name }), t('napSub'));
        }
        hud.updateBoard(gameState.rule, gameState.reign, name, false);
      } else {
        sfxDethrone();
        hud.showToast(t('overSub'));
        hud.updateBoard(undefined, 0, undefined, false);
      }
      break;
    }
    case 'rule': {
      gameState.rule = ev.id;
      repaint();
      hud.showRuleBanner(ev.id);
      const kingMeta = gameState.metas.get(gameState.napoleonId);
      hud.updateBoard(ev.id, gameState.reign, kingMeta?.name, gameState.napoleonId === gameState.myId);
      if (ev.id === 'sunday') {
        animals.triggerSundaySummon(1.5);
      }
      break;
    }
    case 'flowerBloom': {
      sfxReward();
      hud.showToast(t('flowerBloomToast'), 5000);
      hud.showBanner(t('r_womenday'), t('d_womenday'));
      setTimeout(() => {
        for (const f of gameState.food.values()) {
          if (f.k === 8) {
            foodParts.burst(f.x, 1.2, f.z, 0xff4081, 14, 8, 8, 1.2);
            foodParts.burst(f.x, 1.4, f.z, 0xffd700, 10, 6, 7, 0.9);
            foodParts.fluff(f.x, f.z, 0xff69b4, 8);
          }
        }
      }, 50);
      break;
    }
    case 'trickOrTreat': {
      sfxReward();
      hud.showToast(t('trickOrTreatToast'), 5000);
      hud.showBanner(t('r_halloween'), t('d_halloween'));
      setTimeout(() => {
        for (const f of gameState.food.values()) {
          if (f.k === 9) {
            foodParts.burst(f.x, 1.2, f.z, 0xff6d00, 18, 9, 9, 1.3);
            foodParts.burst(f.x, 1.4, f.z, 0x9c27b0, 12, 6, 7, 1.0);
            foodParts.fluff(f.x, f.z, 0x221133, 8);
          }
        }
      }, 50);
      break;
    }
    case 'tool': {
      const isMine = ev.id === myId;
      const toolColor = ev.kind === 'wheel' ? 0xd48834 : ev.kind === 'star' ? 0xffea00 : ev.kind === 'banana' ? 0xffeb3b : 0xe8b641;
      foodParts.burst(ev.x, 1, ev.z, toolColor, 18, 6, 6, 0.8);
      if (isMine) {
        sfxReward();
        if (ev.kind === 'wheel') {
          hud.showBanner(`🛞 ${t('wheel_head')}`, t('tk_wheel'));
        } else if (ev.kind === 'star') {
          hud.showBanner(`⭐ ${t('star_head')}`, t('tk_star'));
        } else if (ev.kind === 'banana') {
          hud.showBanner(`🍌 ${t('banana_head')}`, t('tk_banana'));
        } else {
          hud.showToast(t(`tk_${ev.kind}`));
        }
      } else {
        const pickerMeta = gameState.metas.get(ev.id);
        const pName = pickerMeta ? pickerMeta.name : 'Ai đó';
        if (ev.kind === 'wheel') {
          hud.showToast(t('wheel_other', { name: pName }));
        } else if (ev.kind === 'star') {
          hud.showToast(t('star_other', { name: pName }));
        } else if (ev.kind === 'banana') {
          hud.showToast(t('banana_other', { name: pName }));
        }
      }
      break;
    }
    case 'boom': {
      foodParts.burst(ev.x, 1.2, ev.z, 0xff3b14, 45, 16, 12, 1.0);
      foodParts.burst(ev.x, 1.5, ev.z, 0xffd23f, 35, 14, 10, 0.8);
      foodParts.burst(ev.x, 1.0, ev.z, 0x222222, 28, 8, 8, 1.4);
      foodParts.sonicWave(ev.x, 0.8, ev.z, 3.5);
      sfxBoom();
      const me = gameState.ents.get(myId);
      const distToBoom = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
      if (distToBoom < 35) {
        shake = Math.max(shake, 1.8 * (1 - distToBoom / 35));
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
        hud.addFeed(t('feedJoined', { name: ev.name, teamTag }), false);
      }
      break;
    }
    case 'leave': {
      animals.remove(ev.id);
      break;
    }
    case 'dice': {
      if (ev.id === myId) {
        hud.showDiceRoll(ev.roll);
        sfxReward();
      }
      const ent = gameState.ents.get(ev.id);
      const pos = animals.getPosition(ev.id);
      const mass = ent ? ent.mass : CFG.START_MASS;
      if (pos) {
        const bonusKg = ev.roll * 100;
        hud.floatText(`+${bonusKg} kg 🎲`, 'big', ev.id, { x: pos.x, z: pos.z, mass });
        foodParts.burst(pos.x, 1.0, pos.z, 0xffd700, 15, 12, 5, 0.8);
      }
      break;
    }
    case 'teamWin': {
      sfxReward();
      if (hud.selectedMode === 'friend' || currentRoomName.startsWith('priv-') || currentRoomName.startsWith('friend-')) {
        hud.showFriendResultModal(ev.ranks || gameState.lb, gameState.myId);
      } else {
        hud.showTeamWinModal(ev.winner, ev.s0, ev.s1, ev.mvp);
      }
      break;
    }
    case 'mapWarn': {
      hud.showToast(t('mapShiftCountdown', { s: ev.left }), 1200);
      sfxHit(0.5, 0.4);
      break;
    }
    case 'map': {
      if (ev.transition) {
        // Requirement 2: Smooth 5-minute map shift animation without resetting animals or player progress
        world.transitionToMap(ev.map, () => {
          corpses.setMap(ev.map);
          minions.setMap(ev.map);
          tools.clear();
        });
        hud.showToast(t('mapShifted'), 3000);
      } else {
        world.buildMap(ev.map);
        corpses.setMap(ev.map);
        minions.setMap(ev.map);
        animals.clear();
        tools.clear();
        bananas.clear();
        gameState.hof = [];
        hud.updateHof([]);
        hud.showToast(t('mapResetToast'));
      }
      break;
    }
    case 'podBlast': {
      sfxPodBlast();
      foodParts.burst(ev.x, 1.2, ev.z, 0x00e5ff, 45, 24, 6, 1.2);
      foodParts.burst(ev.x, 1.2, ev.z, 0xffffff, 25, 18, 5, 0.9);
      hud.showToast(t('podBlastToast'));
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
        hud.showToast(t('podCloseWarn', { s: ev.left }));
      } else {
        hud.showToast(t('podOpenWarn', { s: ev.left }));
      }
      break;
    }
    case 'bananaThrow': {
      animals.notifyThrow(ev.id);
      const tier = ev.tier ?? (ev.giant ? 2 : 0);
      const spd = tier === 2 ? 28 : tier === 1 ? 25 : 22;
      if (ev.count > 1) {
        for (let i = 0; i < ev.count; i++) {
          const offsetAng = ev.a + (i - (ev.count - 1) / 2) * 0.22;
          const vx = Math.cos(offsetAng) * spd;
          const vz = Math.sin(offsetAng) * spd;
          bananas.spawn(ev.x, ev.z, vx, vz, ev.giant, tier);
        }
      } else {
        const vx = Math.cos(ev.a) * spd;
        const vz = Math.sin(ev.a) * spd;
        bananas.spawn(ev.x, ev.z, vx, vz, ev.giant, tier);
      }
      sfxHit(tier === 2 ? 1.8 : 1.2, ev.id === myId ? 1.0 : 0.35);
      break;
    }
    case 'bananaHit': {
      const tier = ev.tier ?? (ev.giant ? 2 : 0);
      const partCount = tier === 2 ? 24 : tier === 1 ? 18 : 12;
      foodParts.burst(ev.x, 1.2, ev.z, 0xffeb3b, partCount, 6, 6, 0.6);
      foodParts.burst(ev.x, 1.4, ev.z, 0xff9800, Math.round(partCount * 0.7), 4, 4, 0.4);
      animals.notifyHit(ev.id);
      const vm = gameState.metas.get(ev.id);
      if (vm && ev.id !== myId) {
        yelp(vm.species, 0.45);
      }
      sfxHit(tier === 2 ? 2.8 : tier === 1 ? 2.4 : 2.0, ev.id === myId ? 1.0 : 0.4);
      break;
    }
    case 'monkeyLand': {
      if (ev.inWater) {
        // Water landing splash explosion
        for (let i = 0; i < 4; i++) {
          animals.spawnWaterRipple(ev.x, ev.z, 0.8 + i * 0.6, ev.r * (1.1 + i * 0.3), 1.2 + i * 0.2, 0xdef5ff);
        }
        foodParts.burst(ev.x, 0.4, ev.z, 0xdff5ff, 28, 8, 9, 0.85);
        foodParts.burst(ev.x, 0.8, ev.z, 0x4fc3f7, 20, 6, 8, 0.75);
        foodParts.burst(ev.x, 1.2, ev.z, 0xffffff, 16, 5, 7, 0.65);
        sfxSplash(ev.id === myId ? 1.0 : 0.6);
        const me = gameState.ents.get(myId);
        const dist = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
        if (dist < 28) {
          shake = Math.max(shake, 0.7 * ev.ratio * (1 - dist / 28));
        }
      } else if (ev.isGorilla) {
        // Gorilla ground slam: focused punchy fiery shockwaves and heavy earth dust
        animals.spawnShockwave(ev.x, 0.08, ev.z, ev.r * 0.70, 0xff5722);
        animals.spawnShockwave(ev.x, 0.12, ev.z, ev.r * 0.45, 0xffab00);
        // Ground cracks on heavy slam / max gồng (ratio >= 0.75)
        if (ev.ratio >= 0.75) {
          animals.spawnGroundCracks(ev.x, ev.z, ev.r * 1.15);
        }
        foodParts.burst(ev.x, 0.3, ev.z, 0x3e2723, 24, 8, 8, 0.75);
        foodParts.burst(ev.x, 0.3, ev.z, 0xff6f00, 18, 6, 6, 0.6);
        sfxHit(4.2, ev.id === myId ? 1.0 : 0.6);
        sfxGorillaRoar(ev.id === myId ? 1.0 : 0.5);
        const me = gameState.ents.get(myId);
        const dist = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
        if (dist < 35) {
          shake = Math.max(shake, 1.2 * ev.ratio * (1 - dist / 35));
        }
      } else {
        // Monkey leap land: tight visual ring and modest dust
        animals.spawnShockwave(ev.x, 0.08, ev.z, ev.r * 0.42, 0xffca28);
        foodParts.burst(ev.x, 0.2, ev.z, 0x8d5b38, 12, 5, 5, 0.4);
        foodParts.burst(ev.x, 0.2, ev.z, 0xd4a373, 8, 3, 3, 0.35);
        sfxHit(2.6, ev.id === myId ? 0.9 : 0.4);
        const me = gameState.ents.get(myId);
        const dist = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
        if (dist < 22) {
          shake = Math.max(shake, 0.6 * ev.ratio * (1 - dist / 22));
        }
      }
      break;
    }
    case 'mammothRoar': {
      const ringColor = ev.rainbow ? 0xffffff : 0x81d4fa;
      animals.spawnShockwave(ev.x, 0.08, ev.z, ev.r, ringColor);
      if (ev.rainbow) {
        animals.spawnShockwave(ev.x, 0.12, ev.z, ev.r * 0.7, 0xffeb3b);
        animals.spawnShockwave(ev.x, 0.16, ev.z, ev.r * 0.4, 0xff4081);
      }
      foodParts.burst(ev.x, 1.2, ev.z, ev.rainbow ? 0xffeb3b : 0x81d4fa, 24, 8, 8, 0.9);
      sfxMammothRoar(ev.id === myId ? 1.0 : 0.7);
      const me = gameState.ents.get(myId);
      const dist = me ? Math.hypot(me.x - ev.x, me.z - ev.z) : 99;
      if (ev.id === myId || dist <= ev.r) {
        shake = Math.max(shake, ev.rainbow ? 1.8 : 1.2);
      }
      break;
    }
    case 'morph': {
      const targetMeta = gameState.metas.get(ev.id);
      if (targetMeta) {
        targetMeta.species = ev.species;
      }
      const vis = animals.getVisual(ev.id, targetMeta);
      if (vis) {
        vis.morphTimer = 1.6;
      }
      if (ev.species === 'gorilla') {
        const ent = gameState.ents.get(ev.id);
        const mx = ent ? ent.x : 0;
        const mz = ent ? ent.z : 0;
        // Spectacular 3-stage evolution shockwave rings
        animals.spawnShockwave(mx, 0.08, mz, 5.0, 0xffd700);
        animals.spawnShockwave(mx, 0.12, mz, 3.5, 0xff6d00);
        animals.spawnShockwave(mx, 0.16, mz, 2.0, 0x4fc3f7);
        foodParts.burst(mx, 1.5, mz, 0xffd700, 36, 12, 12, 1.2);
        foodParts.burst(mx, 1.8, mz, 0xff6d00, 24, 10, 10, 0.9);
        sfxGorillaRoar(ev.id === myId ? 1.0 : 0.7);
        sfxReward();
        if (ev.id === myId) {
          shake = Math.max(shake, 1.8);
          hud.showBanner('🦍 ' + t('name_gorilla'), '🔥 TIẾN HOÁ THÀNH GORILLA KHỔNG LỒ! 🔥');
          const myPos = animals.getPosition(myId) || { x: mx, z: mz };
          hud.floatText('🔥 TIẾN HOÁ GORILLA! 🔥', 'big', myId, { x: myPos.x, z: myPos.z, mass: 3000 });
        } else {
          const m = gameState.metas.get(ev.id);
          hud.showToast(`🦍 ${m ? m.name : 'Ai đó'} đã tiến hoá thành Gorilla!`);
        }
      } else if (ev.species === 'mammoth') {
        const ent = gameState.ents.get(ev.id);
        const mx = ent ? ent.x : 0;
        const mz = ent ? ent.z : 0;
        // Spectacular 3-stage evolution shockwave rings
        animals.spawnShockwave(mx, 0.08, mz, 5.5, 0x8d6e63);
        animals.spawnShockwave(mx, 0.12, mz, 4.0, 0xd7ccc8);
        animals.spawnShockwave(mx, 0.16, mz, 2.5, 0xffd54f);
        foodParts.burst(mx, 1.5, mz, 0x8d6e63, 36, 12, 12, 1.2);
        foodParts.burst(mx, 1.8, mz, 0xffd54f, 24, 10, 10, 0.9);
        sfxMammothRoar(ev.id === myId ? 1.0 : 0.7);
        sfxReward();
        if (ev.id === myId) {
          shake = Math.max(shake, 1.8);
          hud.showBanner('🦣 ' + t('name_mammoth'), '✨ TIẾN HOÁ THÀNH VOI MA MÚT (MAMMOTH)! ✨');
          const myPos = animals.getPosition(myId) || { x: mx, z: mz };
          hud.floatText('🦣 TIẾN HOÁ MAMMOTH! 🦣', 'big', myId, { x: myPos.x, z: myPos.z, mass: 3000 });
        } else {
          const m = gameState.metas.get(ev.id);
          hud.showToast(`🦣 ${m ? m.name : 'Ai đó'} đã tiến hoá thành Voi Ma Mút!`);
        }
      } else if (ev.id === myId) {
        sfxReward();
        hud.showBanner(
          ev.species === 'monkey' ? '🐒 ' + t('name_monkey') : '🐘 ' + t('name_elephant'),
          ev.dur > 0 ? t('tk_banana') : t('sp_' + ev.species)
        );
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
  if (currentRoomName === targetRoom && transport && !transport.isAfk) {
    return;
  }

  if (transport && typeof (transport as any).close === 'function') {
    (transport as any).close();
  }

  currentRoomName = targetRoom;
  const isPrivate = targetRoom.startsWith('priv-') || targetRoom.startsWith('friend-');
  const isTeam = targetRoom.startsWith('team-');
  const displayCode = isPrivate ? targetRoom.replace(/^(priv|friend)-/, '').toUpperCase() : targetRoom.toUpperCase();
  const inviteUrl = isPrivate
    ? `${window.location.origin}${window.location.pathname}?room=priv-${displayCode}`
    : (isTeam ? `${window.location.origin}${window.location.pathname}?mode=team&room=${targetRoom}` : undefined);

  if (isTeam || isPrivate) {
    hud.setTeamRoomBadge(displayCode, inviteUrl);
    hud.setRoomTag(
      isPrivate ? `${displayCode} 📋` : t('roomTag', { code: displayCode }),
      inviteUrl
    );
  } else {
    hud.hideTeamRoomBadge();
    hud.setRoomTag(t('roomTag', { code: displayCode }), inviteUrl);
  }

  if (isExplicitOffline) {
    transport = new LocalServer((m) => {
      if ((m as any).t === 'match_duration') {
        const md = m as any;
        hud.setMatchDuration(md.duration, false);
        return;
      }
      gameState.handle(m);
    });
    return;
  }

function getClientId(): string {
  let cid = localStorage.getItem('fb_cid');
  if (!cid) {
    cid = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('fb_cid', cid); } catch (_) {}
  }
  return cid;
}

  const isViteDev = window.location.port === '5180';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let host = isViteDev ? 'localhost:8787' : window.location.host;
  const savedFastHost = sessionStorage.getItem('fb_fast_host');
  if (!isViteDev && savedFastHost && (savedFastHost === 'farm-brawl.windydande.workers.dev' || savedFastHost === 'brawl.get-go.site')) {
    host = savedFastHost;
  }
  const query = `/ws?room=${encodeURIComponent(targetRoom)}&cid=${encodeURIComponent(getClientId())}&theme=${encodeURIComponent(getArenaTheme())}`;
  const wsUrl = `${proto}//${host}${query}`;

  transport = new WsClient(
    wsUrl,
    (m) => {
      if ((m as any).t === 'team_counts') {
        const tc = m as any;
        hud.updateTeamCounts(tc.c0, tc.c1);
        return;
      }
      if ((m as any).t === 'match_duration') {
        const md = m as any;
        hud.setMatchDuration(md.duration, false);
        return;
      }
      gameState.handle(m);
    },
    (status) => {
      if (status === 'open') {
        missingMeTicks = 0;
        if (targetRoom.startsWith('team-')) {
          transport?.send({ t: 'team_select', team: hud.selectedTeam });
        }
        const msg = isPrivate
          ? t('joinedPrivRoom', { code: displayCode })
          : t('joinedPubRoom', { code: displayCode });
        hud.showToast(msg);
      } else if (status === 'reconnected') {
        missingMeTicks = 0;
        if (targetRoom.startsWith('team-')) {
          transport?.send({ t: 'team_select', team: hud.selectedTeam });
        }
        hud.showToast(t('reconnectedToast'));
      } else if (status === 'closed') {
        if (gameState.alive) {
          hud.showToast(t('disconnectedToast'));
        }
      } else if (status === 'error' && isViteDev && !fallbackLocal) {
        console.warn('Worker server not detected at port 8787. Falling back to LocalServer.');
        fallbackLocal = true;
        transport = new LocalServer((m) => {
          if ((m as any).t === 'match_duration') {
            const md = m as any;
            hud.setMatchDuration(md.duration, false);
            return;
          }
          gameState.handle(m);
        });
      }
    }
  );

  if (transport) {
    transport.onMigrationSuccess = (newColo) => {
      hud.showToast(t('migratedToast', { colo: newColo }), 3000);
    };
    transport.onMigrationStatus = (status, colo) => {
      if (status === 'migrated') {
        hud.showToast(t('migratedSinToast', { colo: colo || 'SIN' }), 3000);
      }
    };
  }
}

// Xuất hàm kiểm tra chẩn đoán mạng ra window để kiểm chứng trực tiếp trên DevTools Console
(window as any).__farmBrawlNetDiag = () => {
  if (transport && typeof (transport as any).getDiagnostics === 'function') {
    const diag = (transport as any).getDiagnostics();
    console.table(diag);
    return diag;
  }
  return { error: 'transport not ready or not WsClient' };
};

const modeParam = params.get('mode');
const roomParam = params.get('room') || params.get('code');
let initialRoom = 'pub-1';
if (modeParam === 'team' || roomParam?.startsWith('team-')) {
  initialRoom = roomParam || 'team-1';
} else if (roomParam) {
  if (roomParam.startsWith('priv-') || roomParam.startsWith('friend-')) {
    initialRoom = roomParam;
  } else if (roomParam.length >= 3 && roomParam !== 'pub-1') {
    initialRoom = `priv-${roomParam.toUpperCase()}`;
  } else {
    initialRoom = roomParam;
  }
}
connectToRoom(initialRoom);

// AFK Disconnect & Auto-Reconnect Manager (Tối ưu tiết kiệm pin, băng thông & tài nguyên server)
let lastUserActivityTime = Date.now();
let isAfkSleeping = false;
let tabHiddenStartTime = 0;
const afkModal = document.getElementById('afkModal') as HTMLElement | null;
const btnWakeUp = document.getElementById('btnWakeUp') as HTMLButtonElement | null;

function onUserActivity(): void {
  lastUserActivityTime = Date.now();
  if (isAfkSleeping) {
    wakeUpFromAfk();
  }
}

function enterAfkSleep(): void {
  if (isAfkSleeping) return;
  // Chỉ ngắt kết nối khi đang ở sảnh chờ (chưa vào trận) và không xem người khác chơi
  if (gameState.alive || (transport && transport.inGame) || isSpectating) {
    return;
  }
  isAfkSleeping = true;
  if (transport && typeof (transport as any).disconnectForAfk === 'function') {
    (transport as any).disconnectForAfk();
  }
  if (afkModal) {
    afkModal.hidden = false;
  }
}

function wakeUpFromAfk(): void {
  if (!isAfkSleeping) return;
  isAfkSleeping = false;
  lastUserActivityTime = Date.now();
  if (afkModal) {
    afkModal.hidden = true;
  }
  if (transport && typeof (transport as any).reconnectFromAfk === 'function') {
    (transport as any).reconnectFromAfk();
  } else {
    connectToRoom(currentRoomName);
  }
  hud.showToast(t('afkWakeToast'), 2000);
}

if (btnWakeUp) {
  btnWakeUp.addEventListener('click', (e) => {
    e.stopPropagation();
    wakeUpFromAfk();
  });
}
if (afkModal) {
  afkModal.addEventListener('click', () => wakeUpFromAfk());
}

// User activity listeners: chuột, chạm, bàn phím
window.addEventListener('pointerdown', onUserActivity, { passive: true });
window.addEventListener('keydown', onUserActivity, { passive: true });
window.addEventListener('touchstart', onUserActivity, { passive: true });
window.addEventListener('wheel', onUserActivity, { passive: true });

let lastMoveTrack = 0;
window.addEventListener('pointermove', () => {
  const now = Date.now();
  if (now - lastMoveTrack > 1000) {
    lastMoveTrack = now;
    onUserActivity();
  }
}, { passive: true });

// Theo dõi chuyển tab & tự động đánh thức / nghỉ
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    tabHiddenStartTime = Date.now();
  } else {
    lastUserActivityTime = Date.now();
    tabHiddenStartTime = 0;
    if (isAfkSleeping) {
      wakeUpFromAfk();
    }
  }
});

// Kiểm tra định kỳ trạng thái không hoạt động (mỗi 5 giây)
setInterval(() => {
  const now = Date.now();
  const idleMs = now - lastUserActivityTime;

  // 1. Ở sảnh chờ (Lobby): ngắt kết nối sau 120s không có thao tác
  if (!gameState.alive && (!transport || !transport.inGame) && !isSpectating && !isAfkSleeping) {
    if (idleMs >= 120_000) {
      enterAfkSleep();
      return;
    }
    // Nếu tab bị ẩn xuống nền quá 45s khi đang ở sảnh chờ: đưa vào chế độ ngủ
    if (document.hidden && tabHiddenStartTime > 0 && now - tabHiddenStartTime >= 45_000) {
      enterAfkSleep();
      return;
    }
  }

  // 2. Ở màn hình chết (Death Screen): nếu ngồi ngắm màn hình chết quá 90s không bấm chơi lại
  if (!gameState.alive && (deathCamTarget || isDeadAwaitingScreen || !document.getElementById('death')?.hidden)) {
    if (idleMs >= 90_000) {
      hud.onExitLobby?.();
      enterAfkSleep();
      return;
    }
  }
}, 5000);

// Optional Debug status bar (shows RTT, jitter, prediction error, and FPS)
const showDebug = params.has('debug') || window.location.hostname === 'localhost';
let debugEl: HTMLDivElement | null = null;
// FPS tracking & high-refresh display throttling
let fpsFrames = 0;
let lastFpsTime = performance.now();
let currentFps = 60;
let lastRenderTime = 0;
let lastPhysicsTime = 0;
let lowFpsStreakSeconds = 0;
let shownLpmHint = false;

if (showDebug) {
  debugEl = document.createElement('div');
  debugEl.style.cssText =
    'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:20;padding:2px 10px;font:12px/1.4 monospace;color:#f2ead7;background:rgba(0,0,0,0.65);border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(debugEl);
}

// Main Animation & Render Loop
function animate(now: number): void {
  requestAnimationFrame(animate);

  // Khi ẩn tab: bỏ qua 100% việc render Three.js để tiết kiệm GPU & pin
  if (document.hidden) {
    lastRenderTime = now;
    lastPhysicsTime = now;
    return;
  }

  if (lastRenderTime === 0) {
    lastRenderTime = now;
    lastPhysicsTime = now;
  }

  // Phase-aligned frame pacing with jitter tolerance (Gemini 4 Argon solution)
  // - PC: throttle above 144 FPS (elapsed < 6.8ms)
  // - Mobile & iPad (including 120Hz ProMotion): target rock-solid 60 FPS without dropping frames on 60Hz
  if (!isPC) {
    const rawElapsed = now - lastRenderTime;
    const targetInterval = 1000 / 60; // 16.6667ms (60 FPS target)
    const tolerance = 2.0; // 2.0ms tolerance absorbs 60Hz RAF jitter, blocks 8.33ms 120Hz pulses
    if (rawElapsed < targetInterval - tolerance) {
      return;
    }
    if (rawElapsed > targetInterval * 4) {
      lastRenderTime = now;
    } else {
      lastRenderTime = now - (rawElapsed % targetInterval);
    }
  } else {
    const elapsed = now - lastRenderTime;
    if (elapsed < 6.8) {
      return;
    }
    lastRenderTime = now;
  }

  const dt = Math.min(0.05, Math.max(0.001, (now - lastPhysicsTime) / 1000));
  lastPhysicsTime = now;

  fpsFrames++;
  if (now - lastFpsTime >= 500) {
    // Smoothly clamp HUD display to 60 FPS so it never displays runaway numbers
    currentFps = Math.min(60, Math.round((fpsFrames * 1000) / (now - lastFpsTime)));
    fpsFrames = 0;
    lastFpsTime = now;
    const currentPing = transport ? Math.round((transport as any).displayPing ?? (transport.rtt > 0 ? transport.rtt : transport.rttMin)) : 0;
    hud.updatePerf(currentFps, currentPing, (transport as any)?.displayColo ?? transport?.colo, transport?.isMigrating);
    if (debugEl && transport) {
      const predErr = Math.hypot(predictor.ex, predictor.ez).toFixed(2);
      debugEl.textContent = `RTT ${Math.round(transport.rtt)}ms (min ${Math.round(transport.rttMin)}) · buffer ${Math.round(gameState.interpDelay)}ms · late90 ${Math.round(gameState.lateAvg)}ms · err ${predErr}m · ${currentFps} fps`;
    }

    // Detect if iOS / iPadOS Low Power Mode is locking Safari to 30 FPS
    if ((isIPad || /iPhone|iPad|iPod/i.test(navigator.userAgent)) && !shownLpmHint && transport?.inGame) {
      if (currentFps <= 31) {
        lowFpsStreakSeconds += 0.5;
        if (lowFpsStreakSeconds >= 6.0) {
          shownLpmHint = true;
          hud.showToast(t('lowPowerModeHint'), 6000);
        }
      } else {
        lowFpsStreakSeconds = 0;
      }
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
    const myX = predictor.on ? predictor.x : (me ? me.x : world.camTarget.x);
    const myZ = predictor.on ? predictor.z : (me ? me.z : world.camTarget.z);

    // Decrement local cooldown smoothly every frame before prediction step
    if (gameState.me.cd > 0) {
      gameState.me.cd = Math.max(0, gameState.me.cd - dt);
    }
    if (gameState.me.cd > 0.05 || predictor.dashT > 0 || localStunTimer > 0) {
      input.resetHoldStart();
    }

    if (isStunned || isSpectating) {
      input.cancelRam();
    }

    // Precise 3D raycasted aiming from player animal
    input.computeAim(world.camera, myX, myZ, myMass);

    const isLocked = isStunned || (isSpectating && !awaitingJoinAck);
    const stepFlags = me ? (isLocked ? (me.flags | FLAG.STUN) : me.flags) : (isLocked ? FLAG.STUN : 0);
    const stepAimA = isStunned ? lockedAimA : ((isSpectating && !awaitingJoinAck) ? lastSentInput.a : input.aimA);
    const stepAimMove = isLocked ? false : input.aimMove;
    const stepHolding = isLocked ? false : input.holding;

    // 1. Prepare unified input state
    const inp = {
      a: stepAimA,
      mv: stepAimMove,
      btn: stepHolding,
    };

    // 2. Interpolate remote entities first so predictor.step has exact real-time positions of surrounding animals!
    gameState.interpolate(now);

    // 3. Authoritative client physics prediction step
    if (myMeta && me) {
      if (!hasPrevPred) {
        prevPredX = predictor.x;
        prevPredZ = predictor.z;
        hasPrevPred = true;
      }
      const tillSpeedMult = (gameState.truck !== undefined ? 1.5 : 1.0) * (myMeta.species === 'monkey' && (stepFlags & FLAG.SUPER) !== 0 ? 1.30 : 1.0);
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
        transport.rtt,
        tillSpeedMult,
        gameState.me.cd,
        gameState.metas
      );

      // 3. Swept segment-circle optimistic food eating (0ms Zero-Latency Eating)
      if (gameState.alive && gameState.food && gameState.food.size > 0) {
        const boostMass = runClientOptimisticFoodPass(
          now,
          prevPredX,
          prevPredZ,
          predictor.x,
          predictor.z,
          myMass,
          gameState.food,
          (_fid, fx, fz, val) => {
            sfxEat(val >= 5);
            foodParts.puff(fx, 0.4, fz, 0xffd54f, 0.6, 0.5, 1.2);
          }
        );

        if (boostMass > 0) {
          hud.updateStats(
            myMass + boostMass,
            gameState.me.rank,
            gameState.total,
            gameState.me.kills
          );
        }
      }

      prevPredX = predictor.x;
      prevPredZ = predictor.z;

      // Keep own entity in gameState.ents in perfect sync with predictor
      if (predictor.on && gameState.alive) {
        me.x = predictor.x;
        me.z = predictor.z;
        me.a = stepAimA;
      }
    }

    // 4. Send rate-limited input packet with optimistic eat hints
    const btnChanged = inp.btn !== lastSentInput.btn;
    const mvChanged = inp.mv !== lastSentInput.mv;
    const angleDiff = Math.abs(wrapAngle(inp.a - lastSentInput.a));
    const timeSinceLast = now - lastSentTime;
    const maxInterval = inp.mv ? 30 : 150;
    const shouldSendInput =
      btnChanged ||
      mvChanged ||
      pendingEatHintsToSend.length > 0 ||
      timeSinceLast >= maxInterval ||
      (timeSinceLast >= 20 && angleDiff > 0.006);

    const socketIsOpen = Boolean(
      transport && (!(transport as any).ws || (transport as any).ws.readyState === WebSocket.OPEN)
    );

    if (shouldSendInput && socketIsOpen) {
      inputSeq += 1;
      predictor.recordSentSeq(inputSeq, now);
      if (predictor.hist.length > 0) {
        predictor.hist[predictor.hist.length - 1].seq = inputSeq;
      }

      const eatPayload =
        pendingEatHintsToSend.length > 0
          ? pendingEatHintsToSend.splice(0, 6)
          : undefined;

      transport.send({
        t: 'input',
        seq: inputSeq,
        a: Number(inp.a.toFixed(4)),
        mv: inp.mv,
        btn: inp.btn,
        ...(eatPayload ? { eat: eatPayload } : {}),
      });

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
  animals.myId = gameState.myId;
  for (const ent of gameState.ents.values()) {
    let meta = gameState.metas.get(ent.id);
    if (!meta && ent.id === gameState.myId) {
      meta = {
        id: gameState.myId,
        name: hud.getPlayerName(),
        species: hud.getSelectedSpecies(),
        skin: hud.getSelectedSkin(),
        bot: false,
        team: hud.selectedTeam,
      };
      gameState.metas.set(gameState.myId, meta);
    }
    if (meta) {
      const isMe = ent.id === gameState.myId && predictor.on;
      const px = isMe ? predictor.x : ent.x;
      const pz = isMe ? predictor.z : ent.z;
      const pa = isMe ? (isStunned ? lockedAimA : predictor.a) : ent.a;
      let pFlags = (isMe && isStunned) ? (ent.flags | FLAG.STUN) : ent.flags;
      if (isMe && wasInWater) {
        pFlags |= FLAG.WATER;
        if (meta.species !== 'duck') pFlags |= FLAG.DROWNING;
      }
      if (isMe) {
        if (predictor.dashT > 0) {
          pFlags |= FLAG.DASH;
          if (predictor.plow) pFlags |= FLAG.PLOW;
        } else {
          pFlags &= ~FLAG.DASH;
          pFlags &= ~FLAG.PLOW;
        }
        if (predictor.flyT > 0) {
          pFlags |= FLAG.FLYING;
        } else {
          pFlags &= ~FLAG.FLYING;
        }
        if (input.holding && (now - input.holdStart) >= CFG.CHARGE_SLOW_AFTER * 1000) pFlags |= FLAG.CHARGING;
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
    if (deathCamTarget) {
      targetX = deathCamTarget.x;
      targetZ = deathCamTarget.z;
    } else if (me) {
      targetX = predictor.on ? predictor.x : me.x;
      targetZ = predictor.on ? predictor.z : me.z;
    } else if (gameState.alive && predictor.on) {
      targetX = predictor.x;
      targetZ = predictor.z;
    } else {
      // Hold camera position while awaiting spawn instead of jumping to podium (0, 0)
      targetX = world.camTarget.x !== 0 ? world.camTarget.x : 0;
      targetZ = world.camTarget.z !== 0 ? world.camTarget.z : 0;
    }
    targetMass = me ? me.mass : CFG.START_MASS;
  }
  world.updateCamera(targetX, targetZ, targetMass, dt, shake);
  shake = Math.max(0, shake - dt * 2.5);

  // Update dynamic food and particle effects
  foodParts.updateFood(gameState.food, now, gameState.map?.podium);
  foodParts.updateParticles(dt);
  bananas.update(dt, (x, y, z, c, s, l, vy) => foodParts.puff(x, y, z, c, s, l, vy));
  animals.updateShockwaves(dt);
  animals.updateWaterRipples(dt);
  animals.updateGroundCracks(dt);

  // Update animated world hazards (water ripples, pulsing coals, flames, electric fence arcs)
  const playerPos = me ? { x: predictor.on ? predictor.x : me.x, z: predictor.on ? predictor.z : me.z } : undefined;
  world.updateHazards(now, foodParts, playerPos);

    // Update podium capture tile glow
    const [capId, capProg, capContested] = gameState.pod;
    const capMeta = gameState.metas.get(capId);
    const capColor = capMeta
      ? (capMeta.team !== undefined
        ? (capMeta.team === 0 ? 0x4fc3f7 : 0xf44336)
        : (SPECIES_RING_COLOR[capMeta.species] ?? 0xffc928))
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

  // Update mini clone minions
  minions.sync(Array.from(gameState.minions.values()));
  minions.update(dt, now);

  // Dynamic Resolution Scaling (DRS) based on EMA FPS and movement speed
  const isMoving = Boolean(
    (predictor.on && (predictor.dashT > 0 || Math.hypot(predictor.vx, predictor.vz) > 1.2)) ||
    (input.aimMove && !isStunned)
  );
  world.drs.update(currentFps, isMoving, now);

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
    gameState.podShield[0],
    predictor.on ? { x: predictor.x, z: predictor.z } : undefined
  );
}

requestAnimationFrame(animate);
