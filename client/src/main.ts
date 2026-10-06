import { CFG, type Species } from '@shared/constants';
import type { GameEvent, Snapshot } from '@shared/protocol';
import { sfxDash, sfxEat, sfxHit, sfxReward, sfxZap, unlockAudio } from './audio/sfx';
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
let holdStartTime = 0;
let wasDashing = false;

const hud = new HudManager((name: string, species: Species) => {
  unlockAudio();
  if (transport) {
    transport.send({ t: 'join', name, species });
  }
});

const gameState = new GameState({
  onInit(map) {
    world.buildMap(map);
  },
  onJoined(_id) {
    hud.showInGame();
    hud.showBanner(t('welcome'), t('welcomeSub'));
    prevMass = CFG.START_MASS;
  },
  onEvent(ev: GameEvent) {
    handleGameEvent(ev);
  },
  onSnapshot(_s: Snapshot) {
    const me = gameState.ents.get(gameState.myId);
    if (me) {
      hud.updateStats(me.mass, gameState.me.rank, gameState.total, gameState.me.kills);
      // Floating text on mass gain
      if (me.mass > prevMass) {
        const gained = Math.round(me.mass - prevMass);
        if (gained >= 1) {
          hud.spawnFloat(`+${gained} kg`, window.innerWidth / 2, window.innerHeight / 2 - 40, gained >= 6);
          sfxEat(gained >= 5);
        }
        prevMass = me.mass;
      }
      const isDashing = (me.flags & 1) !== 0;
      if (isDashing && !wasDashing) sfxDash(1);
      wasDashing = isDashing;
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
      foodParts.burst(ev.x, 1, ev.z, 0xfff35c, 28, 12);
      sfxZap(ev.id === myId ? 1 : 0.5);
      const killer = gameState.metas.get(ev.by);
      const victim = gameState.metas.get(ev.id);
      const victimName = victim ? victim.name : '???';
      const killerName = killer ? killer.name : '';

      if (ev.id === myId) {
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

      const feedText = killerName
        ? `⚡ ${killerName} ➔ ${victimName}`
        : `⚡ ${t('c_fence')} ➔ ${victimName}`;
      hud.addFeed(feedText, ev.id === myId || ev.by === myId);
      break;
    }
    case 'napoleon': {
      if (ev.id === myId) {
        hud.showBanner('BẠN LÀ VUA NÔNG TRẠI!', 'Giữ vững vị trí trên bục vinh quang 👑');
        sfxReward();
      } else if (ev.id > 0) {
        const king = gameState.metas.get(ev.id);
        const name = king ? king.name : 'Ai đó';
        hud.showToast(`👑 ${name} đã lên ngôi Vua Nông Trại!`);
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

// Main Animation & Render Loop
function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  // Send input to transport
  if (transport && gameState.alive) {
    const inp = input.getInput();
    transport.send({ t: 'input', ...inp });

    // Track charging for HUD meter
    if (inp.btn) {
      if (!holdStartTime) holdStartTime = now;
    } else {
      holdStartTime = 0;
    }
    const held = holdStartTime > 0 ? (now - holdStartTime) / 1000 : 0;
    const isCharging = held >= CFG.CHARGE_MIN;
    const chargeLevel = Math.min(1, Math.max(0, (held - CFG.CHARGE_MIN) / (CFG.CHARGE_MAX - CFG.CHARGE_MIN)));
    hud.updateRamMeter(gameState.me.cd, isCharging, chargeLevel);
  }

  // Interpolate entity positions for smooth rendering
  gameState.interpolate(now);

  // Update 3D animal meshes
  for (const ent of gameState.ents.values()) {
    const meta = gameState.metas.get(ent.id);
    if (meta) {
      const isKing = ent.id === gameState.napoleonId;
      animals.update(ent.id, meta, ent.x, ent.z, ent.a, ent.mass, ent.flags, isKing);
    }
  }

  // Camera follow local animal (or arena center if dead)
  const me = gameState.ents.get(gameState.myId);
  const targetX = me ? me.x : 0;
  const targetZ = me ? me.z : 0;
  world.updateCamera(targetX, targetZ, dt);

  // Screen shake on hit
  if (shake > 0) {
    world.camera.position.x += (Math.random() - 0.5) * shake * 1.5;
    world.camera.position.z += (Math.random() - 0.5) * shake * 1.5;
    shake = Math.max(0, shake - dt * 2.5);
  }

  // Update dynamic food and particle effects
  foodParts.updateFood(gameState.food, now);
  foodParts.updateParticles(dt);

  // Update UI floating text animations
  hud.updateFloats();

  // 3D Render
  world.render();

  // 2D Minimap Render
  minimap.draw(gameState.map, gameState.ents, gameState.myId);
}

requestAnimationFrame(animate);
