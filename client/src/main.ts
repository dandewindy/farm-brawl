import { CFG, type Species } from '@shared/constants';
import { wrapAngle } from '@shared/math';
import type { GameEvent, Snapshot } from '@shared/protocol';
import {
  sfxBurn, sfxDash, sfxDethrone, sfxEat, sfxFall, sfxHit, sfxReward, sfxSplash, sfxVictory, sfxZap, unlockAudio,
} from './audio/sfx';
import { ClientPredictor } from './game/pred';
import { GameState } from './game/state';
import { applyTexts, t } from './i18n';
import { InputManager } from './input/controls';
import { LocalServer, type Transport } from './net/transport';
import { WsClient } from './net/ws';
import { AnimalRenderer } from './render/animals';
import { FoodAndParticleRenderer } from './render/food';
import { MinimapRenderer } from './render/minimap';
import { WorldRenderer } from './render/world';
import { HudManager } from './ui/hud';

// Apply translations to static HTML tags
applyTexts();

const canvas = document.getElementById('c') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;

const world = new WorldRenderer(canvas);
const animals = new AnimalRenderer(world.scene);
const foodParts = new FoodAndParticleRenderer(world.scene);
const minimap = new MinimapRenderer(minimapCanvas);
const input = new InputManager();

let transport: Transport | null = null;
let lastTime = performance.now();
let shake = 0;
let prevMass = 0;
let wasDashing = false;

const predictor = new ClientPredictor();
let lastSentInput = { a: 0, mv: false, btn: false };
let lastSentTime = 0;

input.onReleaseRam = (held: number) => {
  const myMeta = gameState.metas.get(gameState.myId);
  if (myMeta && predictor.on && gameState.alive && gameState.me.cd <= 0.05) {
    predictor.predictDash(myMeta.species, held, input.aimA, gameState.map);
  }
};

const hud = new HudManager((name: string, species: Species) => {
  unlockAudio();
  if (transport) {
    transport.send({ t: 'join', name, species });
  }
});

let firstSpawn = true;

const gameState = new GameState({
  onInit(map) {
    world.buildMap(map);
  },
  onJoined(_id) {
    hud.showInGame();
    hud.showBanner(t('welcome'), t('welcomeSub'));
    prevMass = CFG.START_MASS;
    firstSpawn = true;
    predictor.on = false;
  },
  onEvent(ev: GameEvent) {
    handleGameEvent(ev);
  },
  onSnapshot(s: Snapshot) {
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
        const rttMin = transport ? transport.rttMin : 0;
        predictor.onServerSnapshot(x, z, flags, gameState.snapTick, gameState.clockOff, rttMin);

        hud.updateStats(mass, gameState.me.rank, gameState.total, gameState.me.kills);
        // Floating text on mass gain
        if (mass > prevMass) {
          const gained = Math.round(mass - prevMass);
          if (gained >= 1) {
            hud.spawnFloat(`+${gained} kg`, window.innerWidth / 2, window.innerHeight / 2 - 40, gained >= 6);
            sfxEat(gained >= 5);
          }
          prevMass = mass;
        }
        const isDashing = (flags & 1) !== 0;
        if (isDashing && !wasDashing) sfxDash(1);
        wasDashing = isDashing;
      }
    }
    if (!seenMe) {
      predictor.on = false;
    }

    // Update podium capture UI
    const [capId, capProg, contested] = gameState.pod;
    const captorMeta = gameState.metas.get(capId);
    const captorName = captorMeta ? captorMeta.name : '';
    const isKing = gameState.napoleonId === capId && capProg >= 0.99;
    hud.updateCapture(capId, capProg, contested, gameState.myId, captorName, isKing);

    if (gameState.lb.length) {
      hud.updateLeaderboard(gameState.lb, gameState.myId);
    }
  },
});

function handleGameEvent(ev: GameEvent): void {
  const myId = gameState.myId;
  switch (ev.k) {
    case 'hit': {
      const isMine = ev.a === myId || ev.v === myId;
      sfxHit(ev.s, isMine ? 1 : 0.4);
      foodParts.burst(ev.x, 1, ev.z, 0xfff3a0, 18, 9);
      if (isMine) shake = Math.max(shake, 0.6);
      break;
    }
    case 'die': {
      const isMine = ev.id === myId;
      const killer = gameState.metas.get(ev.by);
      const victim = gameState.metas.get(ev.id);
      const victimName = victim ? victim.name : '???';
      const killerName = killer ? killer.name : '';

      if (ev.cause === 'drown') {
        foodParts.burst(ev.x, 0.4, ev.z, 0x64b5f6, 24, 7);
        sfxSplash(isMine ? 1 : 0.5);
      } else if (ev.cause === 'well') {
        foodParts.burst(ev.x, 0.8, ev.z, 0x8d6e63, 20, 6);
        sfxFall(isMine ? 1 : 0.5);
      } else if (ev.cause === 'fire') {
        foodParts.burst(ev.x, 1.2, ev.z, 0xff7043, 26, 10);
        sfxBurn(isMine ? 1 : 0.5);
      } else {
        foodParts.burst(ev.x, 1.5, ev.z, 0xfff35c, 28, 12);
        sfxZap(isMine ? 1 : 0.5);
      }

      if (ev.id === myId) {
        predictor.on = false;
        hud.showDeath(ev, killerName);
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
    case 'napoleon': {
      if (ev.id === myId) {
        hud.showBanner('BẠN LÀ VUA NÔNG TRẠI!', 'Giữ vững vị trí trên bục vinh quang 👑');
        sfxVictory();
      } else if (ev.id > 0) {
        const king = gameState.metas.get(ev.id);
        const name = king ? king.name : 'Ai đó';
        hud.showToast(`👑 ${name} đã lên ngôi Vua Nông Trại!`);
      } else {
        sfxDethrone();
        hud.showToast('👑 Ngai vàng đã bị bỏ trống!');
      }
      break;
    }
    case 'leave': {
      animals.remove(ev.id);
      break;
    }
  }
}

// Transport setup: WebSocket to Cloudflare Durable Objects in prod/dev, LocalServer offline fallback
const params = new URLSearchParams(window.location.search);
const isExplicitOffline = params.get('offline') === '1' || params.get('mode') === 'offline';
const roomName = params.get('room') || 'pub-1';
let fallbackLocal = false;

if (isExplicitOffline) {
  transport = new LocalServer((m) => {
    gameState.handle(m);
  });
} else {
  const isViteDev = window.location.port === '5180';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = isViteDev ? 'localhost:8787' : window.location.host;
  const wsUrl = `${proto}//${host}/ws?room=${encodeURIComponent(roomName)}`;

  transport = new WsClient(
    wsUrl,
    (m) => {
      gameState.handle(m);
    },
    (status) => {
      if (status === 'open') {
        hud.showToast(`Đã vào phòng trực tuyến: ${roomName} 🌐`);
      } else if (status === 'error' && isViteDev && !fallbackLocal) {
        console.warn('Worker server not detected at port 8787. Falling back to LocalServer.');
        fallbackLocal = true;
        transport = new LocalServer((m) => gameState.handle(m));
      }
    }
  );
}

// Optional Debug status bar (shows RTT, jitter, prediction error, and FPS)
const showDebug = params.has('debug') || window.location.hostname === 'localhost';
let debugEl: HTMLDivElement | null = null;
let fpsFrames = 0;
let lastFpsTime = performance.now();
let currentFps = 60;

if (showDebug) {
  debugEl = document.createElement('div');
  debugEl.style.cssText =
    'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:20;padding:2px 10px;font:12px/1.4 monospace;color:#f2ead7;background:rgba(0,0,0,0.65);border-radius:4px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(debugEl);
}

// Main Animation & Render Loop
function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  fpsFrames++;
  if (now - lastFpsTime >= 500) {
    currentFps = Math.round((fpsFrames * 1000) / (now - lastFpsTime));
    fpsFrames = 0;
    lastFpsTime = now;
    if (debugEl && transport) {
      const predErr = Math.hypot(predictor.ex, predictor.ez).toFixed(2);
      debugEl.textContent = `RTT ${Math.round(transport.rtt)}ms (min ${Math.round(transport.rttMin)}) · buffer ${Math.round(gameState.interpDelay)}ms · late90 ${Math.round(gameState.lateAvg)}ms · err ${predErr}m · ${currentFps} fps`;
    }
  }

  // Local animal input & prediction step
  if (transport && gameState.alive) {
    const me = gameState.ents.get(gameState.myId);
    const myMeta = gameState.metas.get(gameState.myId);
    const myMass = me ? me.mass : CFG.START_MASS;
    const myX = predictor.on ? predictor.x : (me ? me.x : 0);
    const myZ = predictor.on ? predictor.z : (me ? me.z : 0);

    // Precise 3D raycasted aiming
    input.computeAim(world.camera, myX, myZ, myMass);

    // Authoritative client physics prediction step
    if (myMeta && me) {
      predictor.step(
        dt,
        now,
        myMeta.species,
        me.flags,
        myMass,
        input.holding,
        input.aimA,
        input.aimMove,
        gameState.map,
        gameState.ents,
        gameState.myId,
        gameState.snapTick,
        transport.rtt
      );
    }

    // Rate-limited input transmission
    const inp = input.getInput();
    const btnChanged = inp.btn !== lastSentInput.btn;
    const mvChanged = inp.mv !== lastSentInput.mv;
    const angleDiff = Math.abs(wrapAngle(inp.a - lastSentInput.a));
    const timeSinceLast = now - lastSentTime;

    if (btnChanged || (timeSinceLast >= 50 && (angleDiff > 0.01 || mvChanged))) {
      transport.send({ t: 'input', ...inp });
      lastSentInput = { a: inp.a, mv: inp.mv, btn: inp.btn };
      lastSentTime = now;
    }

    // Update charging meter in HUD
    const held = input.holding ? (now - input.holdStart) / 1000 : 0;
    const isCharging = held >= CFG.CHARGE_MIN;
    const chargeLevel = Math.min(1, Math.max(0, (held - CFG.CHARGE_MIN) / (CFG.CHARGE_MAX - CFG.CHARGE_MIN)));
    hud.updateRamMeter(gameState.me.cd, isCharging, chargeLevel);
  } else {
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
      const pa = isMe ? predictor.a : ent.a;
      const isKing = ent.id === gameState.napoleonId;
      animals.update(ent.id, meta, px, pz, pa, ent.mass, ent.flags, isKing, gameState.map?.podium);
    }
  }

  // Camera follow local animal with zero latency & exponential smoothing
  const me = gameState.ents.get(gameState.myId);
  const targetX = me ? (predictor.on ? predictor.x : me.x) : 0;
  const targetZ = me ? (predictor.on ? predictor.z : me.z) : 0;
  const targetMass = me ? me.mass : CFG.START_MASS;
  world.updateCamera(targetX, targetZ, targetMass, dt, shake);
  shake = Math.max(0, shake - dt * 2.5);

  // Update dynamic food and particle effects
  foodParts.updateFood(gameState.food, now, gameState.map?.podium);
  foodParts.updateParticles(dt);

  // Update UI floating text animations
  hud.updateFloats();

  // 3D Render
  world.render();

  // 2D Minimap Render
  minimap.draw(gameState.map, gameState.ents, gameState.myId);
}

requestAnimationFrame(animate);
