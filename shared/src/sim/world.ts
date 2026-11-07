// The authoritative farm simulation. Phase 1 runs it inside the page; phase 2 runs the very same class in a
// Cloudflare Durable Object. It knows nothing about rendering or networking: inputs in, snapshots out.
import { thinkBot, newBrain, SPECIES_BOT_NAMES, SPECIES_NAMES_VI, type BotBrain } from './bots';
import {
  CFG, DT, FOOD_KG, FOOD_WEIGHT, SKIN_COUNT, SUBSTEPS, TRAITS, radiusOf, pickRandomSpecies,
  EVOLVED_PAIRS, DEVOLVED_PAIRS, isEvolvedSpecies,
  type FoodKind, type Species,
} from '../constants';
import { generateMap, type Blob, type MapData, type TreeData, type TreeSize } from '../map';
import { clamp, insideBlob, mulberry32, distToSegmentSq, wrapAngle } from '../math';
export { distToSegmentSq } from '../math';
import { type Body, type Terrain, collideHay, dashParams, chargeLevel, outsideFence, stepMove, terrainAt } from '../physics';
import {
  FLAG, type AdminAction, type DeathCause, type FoodWire, type GameEvent, type Input, type LeaderRow, type MinionWire, type PlayerMeta,
  type PlayerWire, type ServerMsg, type Snapshot, type ToolKind, type TreeSyncWire,
} from '../protocol';

export interface Player extends Body {
  id: number;
  name: string;
  species: Species;
  skin: number;
  bot: boolean;
  alive: boolean;
  adminGod?: boolean;
  adminPermaRainbow?: boolean;
  adminSpeedMult?: number;
  input: Input;
  /** a press seen since the last tick (so taps shorter than a tick still count) */
  btnLatch: boolean;
  /** a release seen since the last tick (so button releases are never swallowed) */
  releaseLatch: boolean;
  releaseAimA: number;
  /** the button went down while a dash was available */
  pressed: boolean;
  holdT: number;
  cd: number;
  plow: boolean;
  power: number;
  terrain: Terrain;
  /** animals already hit by the current dash */
  dashHit: Set<number>;
  lastHitBy: number;
  lastHitT: number;
  lastAttackedId: number;
  lastAttackedT: number;
  kills: number;
  totalKills: number;
  score: number;
  streak: number;
  bornT: number;
  best: number;
  respawnT: number;
  inWaterT: number;
  pitchforkT: number;
  pitchforkHits?: number;
  hasDynamite: boolean;
  slowT: number;
  superT: number;
  flyT: number;
  speedT: number;
  shieldT: number;
  lastEatT: number;
  squishT: number;
  wheelT: number;
  prevX?: number;
  prevZ?: number;
  pendingEatHints?: number[];
  lastInputSeq?: number;
  team?: number;
  origSpecies?: Species;
  monkeyLeapT?: number;
  monkeyLeapDur?: number;
  monkeyLeapHeight?: number;
  monkeyLeapRatio?: number;
  monkeyBounced?: boolean;
  treeShakeT?: number;
  treeShakeTreeId?: number;
  treeShakeTimer?: number;
  treeShakeDropStage?: number;
  mammothRoarT?: number;
  mammothRoarCd?: number;
  wolfFrenzyT?: number;
  wolfLungeT?: number;
  wolfRatio?: number;
  wolfTargetId?: number;
  wolfBitesLeft?: number;
  wolfBiteTotal?: number;
  wolfBiteStep?: number;
  wolfBiteTimer?: number;
  wolfChainTargets?: number[];
  wolfChainRainbow?: boolean;
  wolfAnchorX?: number;
  wolfAnchorZ?: number;
  flightT?: number;
  burnT?: number;
  burnDmgTimer?: number;
  tossT?: number;
  pegasusCandyCount?: number;
  pegasusCandyTimer?: number;
  swanIceTimer?: number;
  morphT?: number;
  morphOrigSpecies?: Species;
  hasHeart?: boolean;
  heartReviving?: boolean;
  heartReviveTimer?: number;
  heartReviveMass?: number;
  heartDeathX?: number;
  heartDeathZ?: number;
  ai: BotBrain | null;
}

export interface BananaProjectile {
  id: number;
  ownerId: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  giant: boolean;
  tier: number;
  r: number;
}

export interface Minion {
  id: number;
  ownerId: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  a: number;
  mass: number;
  species: Species;
  skin: number;
  targetId: number;
  alive: boolean;
  cd: number;
  orbitAngle: number;
}

export interface ToolItem {
  id: number;
  kind: ToolKind;
  x: number;
  z: number;
  age?: number;
}

export interface Food {
  id: number;
  x: number;
  z: number;
  k: FoodKind;
  v: number;
  age?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FlowerBatch {
  timer: number;
  count: number;
  bigCount: number;
  smallCount: number;
}

export class TreeSimState {
  id: number;
  x: number;
  z: number;
  size: TreeSize;
  r: number;
  totalFruits: number;
  big: number;
  small: number;
  batches: FlowerBatch[] = [];
  cooldownHit = 0;

  constructor(data: TreeData) {
    this.id = data.id;
    this.x = data.x;
    this.z = data.z;
    this.size = data.size;
    this.r = data.r;
    this.totalFruits = data.totalFruits;
    this.big = 0;
    this.small = 0;
    // Initial 30s lifecycle:
    // 0..10s: flower buds
    // 10..20s: flowers bloom
    // 20..30s: small fruits appear
    // 30s+: big ripe fruits ready to ram!
    this.batches.push({
      timer: 0,
      count: data.totalFruits,
      bigCount: data.initBig,
      smallCount: data.initSmall,
    });
  }

  getStage(): number {
    if (this.big > 0) return 3;
    if (this.small > 0 || this.batches.some((b) => b.timer >= 20)) return 2;
    if (this.batches.some((b) => b.timer >= 10)) return 1;
    return 0;
  }

  getFlowerCount(): number {
    let sum = 0;
    for (const b of this.batches) {
      if (b.timer >= 10 && b.timer < 20) {
        sum += b.count;
      }
    }
    return sum;
  }

  step(dt: number): void {
    if (this.cooldownHit > 0) {
      this.cooldownHit = Math.max(0, this.cooldownHit - dt);
    }
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const b = this.batches[i];
      b.timer += dt;
      if (b.timer >= 30) {
        this.big += b.bigCount;
        this.small += b.smallCount;
        this.batches.splice(i, 1);
      }
    }
  }
}

export class World {
  map: MapData;
  readonly players = new Map<number, Player>();
  readonly food = new Map<number, Food>();
  readonly tools = new Map<number, ToolItem>();
  readonly treeSims: TreeSimState[] = [];
  readonly bananaProjectiles: BananaProjectile[] = [];
  tick = 0;
  time = 0;
  /** alive animals, heaviest first (refreshed every tick) */
  ranked: Player[] = [];

  private nextId = 1;
  private nextFood = 1;
  private nextTool = 1;
  private nextMinionId = 1;
  private nextBananaId = 1;
  minions = new Map<number, Minion>();
  private toolSpawnTimer = 3;
  private superCandyTimer = 25;
  private dolphinHeartTimer = 30;
  private dolphinDelivering = false;
  private dolphinDeliveryTimer = 0;
  private mapShiftTimer = 300;
  private rnd: () => number;
  private events: GameEvent[] = [];
  private foodAdded: FoodWire[] = [];
  private foodRemoved: number[] = [];
  /** fill empty seats with bots */
  botsEnabled: boolean;
  /** spawn ambient food */
  foodEnabled: boolean;
  /** game mode: ffa, team, or friend */
  mode: 'ffa' | 'team' | 'friend';
  /** arena theme: classic, women_day, etc. */
  theme: string = 'classic';

  /** Podium capture & protective shield system */
  podiumCaptor = 0;
  podiumProgress = 0;
  podiumContested = false;
  podiumShield = true;
  podiumPhaseTimer = 30;
  podiumWarned5s = false;
  napoleonId = 0;
  napoleonReign = 0;
  currentRule = '';
  ruleTimer = 0;
  sundayTeleportTimer = 0;
  kingChoice: { options: string[]; expireT: number } | null = null;
  hof: [string, Species, number][] = [];
  tillTruck = {
    active: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    angle: 0,
    timer: 2.5,
    sweepT: 0,
    exiting: false,
  };
  teamScores: [number, number] = [0, 0];
  matchClock = 300;
  matchDuration = 0;
  matchEnded = false;
  matchEndTimer = 0;

  constructor(seed: number = (Math.random() * 2 ** 31) | 0, opts: { bots?: boolean; food?: boolean; mode?: 'ffa' | 'team' | 'friend' } = {}) {
    this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.map = generateMap(seed);
    this.initTrees();
    this.mode = opts.mode ?? 'ffa';
    this.botsEnabled = opts.bots !== undefined ? opts.bots : (this.mode === 'ffa');
    if (this.mode === 'team' || this.mode === 'friend') {
      this.botsEnabled = false;
    }
    this.foodEnabled = opts.food ?? true;
    if (this.foodEnabled) {
      for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    }
    for (let i = 0; i < CFG.TOOL_TARGET; i++) this.spawnTool();
    this.flush();
  }

  initTrees(): void {
    this.treeSims.length = 0;
    if (this.map.trees) {
      for (const td of this.map.trees) {
        this.treeSims.push(new TreeSimState(td));
      }
    }
  }

  rand(): number {
    return this.rnd();
  }

  // ------------------------------------------------------------------ players

  addPlayer(name: string, species: Species, bot = false, team?: number, skin?: number): number {
    if ((species as string) === 'random') {
      species = pickRandomSpecies(name, this.rnd);
    }
    const id = this.nextId++;
    const startMass = (species === 'elephant' || species === 'mammoth') ? 1000 : (species === 'cow' || species === 'bull') ? 100 : (isEvolvedSpecies(species) ? 3000 : CFG.START_MASS);
    const p: Player = {
      id, name: name.slice(0, 16), species,
      skin: skin !== undefined ? (skin % SKIN_COUNT) : Math.floor(this.rnd() * SKIN_COUNT),
      bot, alive: false,
      x: 0, z: 0, vx: 0, vz: 0, a: 0, mass: startMass, dashT: 0, stunT: 0, charging: false,
      input: { a: 0, mv: false, btn: false }, btnLatch: false, releaseLatch: false, releaseAimA: 0, pressed: false, holdT: 0, cd: 0, plow: false, power: 1,
      terrain: 0, dashHit: new Set(), lastHitBy: 0, lastHitT: -99, lastAttackedId: 0, lastAttackedT: -99, kills: 0, totalKills: 0, score: 0, streak: 0, bornT: 0, best: 0,
      respawnT: 0, inWaterT: 0, pitchforkT: 0, pitchforkHits: undefined, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, speedT: 0, shieldT: 0, lastEatT: 0, squishT: 0, wheelT: 0, hasHeart: false, heartReviving: false, team, ai: bot ? newBrain(this.rnd) : null,
    };
    this.players.set(id, p);
    this.spawn(p);
    return id;
  }

  /** bring a (dead) animal back, optionally as a different species, skin, and team */
  respawn(id: number, name?: string, species?: Species, skin?: number, team?: number): void {
    const p = this.players.get(id);
    if (!p || p.alive) return;
    if (name !== undefined) p.name = name.slice(0, 16);
    if ((species as string) === 'random') {
      species = pickRandomSpecies(p.name, this.rnd);
    }
    if (species) p.species = species;
    else if (DEVOLVED_PAIRS[p.species]) p.species = DEVOLVED_PAIRS[p.species];
    if (skin !== undefined) p.skin = skin % SKIN_COUNT;
    if (team !== undefined) p.team = team;
    this.spawn(p);
  }

  clearRule(): void {
    if (this.currentRule === 'poultry') {
      for (const p of this.players.values()) {
        if (p.origSpecies) {
          p.species = p.origSpecies;
          delete p.origSpecies;
          this.events.push({ k: 'join', ...this.meta(p) });
        }
      }
    }
    this.currentRule = '';
    this.ruleTimer = 0;
    this.sundayTeleportTimer = 0;
  }

  removePlayer(id: number): void {
    if (!this.players.delete(id)) return;
    for (const [mid, m] of this.minions) {
      if (m.ownerId === id) this.minions.delete(mid);
    }
    if (id === this.napoleonId) {
      this.napoleonId = 0;
      this.napoleonReign = 0;
      this.clearRule();
      this.kingChoice = null;
      this.podiumPhaseTimer = 30;
      this.podiumWarned5s = false;
      this.events.push({ k: 'napoleon', id: 0 });
    }
    this.events.push({ k: 'leave', id });
  }

  setInput(
    id: number | string,
    inp: Input & { seq?: number; dashSeq?: number; eat?: number[] }
  ): void {
    const numericId = typeof id === 'number' ? id : Number(id);
    const p = this.players.get(numericId) ?? this.players.get(id as any);
    if (!p) return;

    // Human player connected via socket is definitely not a bot
    p.ai = null;
    p.bot = false;

    // Reject out-of-order sequence packets, with auto-recovery if client reset seq
    if (typeof inp.seq === 'number' && inp.seq > 0) {
      const lastSeq = p.lastInputSeq ?? 0;
      if (inp.seq < lastSeq && (lastSeq - inp.seq) < 150 && inp.seq > 60) {
        return;
      }
      p.lastInputSeq = inp.seq;
    }

    p.input.a = Number.isFinite(inp.a) ? inp.a : p.input.a;
    p.input.mv = !!inp.mv;
    p.input.btn = !!inp.btn;
    if (inp.hold !== undefined && Number.isFinite(inp.hold)) {
      p.holdT = p.mass >= 20 ? Math.min(CFG.CHARGE_MAX + 0.5, Math.max(0, inp.hold)) : 0;
      p.pressed = true;
      p.releaseLatch = true;
      p.releaseAimA = p.input.a;
    }
    if (p.input.btn) p.btnLatch = true;
    if (Array.isArray(inp.eat) && inp.eat.length > 0) {
      if (!p.pendingEatHints) p.pendingEatHints = [];
      for (let i = 0; i < Math.min(6, inp.eat.length); i++) {
        const fid = Number(inp.eat[i]);
        if (Number.isInteger(fid) && fid >= 0 && !p.pendingEatHints.includes(fid)) {
          p.pendingEatHints.push(fid);
        }
      }
    }
  }

  meta(p: Player): PlayerMeta {
    return { id: p.id, name: p.name, species: p.species, skin: p.skin, bot: p.bot, team: p.team };
  }

  private spawn(p: Player): void {
    const [x, z] = this.freeSpot();
    if (this.currentRule === 'poultry') {
      if (!p.origSpecies) p.origSpecies = p.species;
      p.species = this.rnd() < 0.5 ? 'chicken' : 'duck';
    }
    let spawnMass = (p.species === 'elephant' || p.species === 'mammoth') ? 1000 : (p.species === 'cow' || p.species === 'bull') ? 100 : (isEvolvedSpecies(p.species) ? 3000 : CFG.START_MASS);
    if (this.currentRule === 'titan') {
      spawnMass = 1000;
    } else if (this.currentRule === 'equal') {
      spawnMass = p.id === this.napoleonId ? 100 : 30;
    }
    Object.assign(p, {
      alive: true, x, z, vx: 0, vz: 0, a: Math.atan2(-z, -x), mass: spawnMass, dashT: 0, stunT: 0,
      charging: false, pressed: false, holdT: 0, cd: 0, plow: false, power: 1, lastHitBy: 0, lastHitT: -99,
      lastAttackedId: 0, lastAttackedT: -99,
      kills: p.kills || 0, totalKills: p.totalKills || 0, score: p.score || 0, streak: 0, bornT: this.time,
      best: Math.max(spawnMass, p.best || 0), btnLatch: false, releaseLatch: false, releaseAimA: 0, inWaterT: 0,
      pitchforkT: 0, pitchforkHits: undefined, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, speedT: 0, shieldT: 0, lastEatT: this.time, squishT: 0, wheelT: 0,
      hasHeart: false, heartReviving: false, heartReviveTimer: undefined,
      monkeyLeapT: 0, monkeyBounced: false, treeShakeT: 0, mammothRoarT: 0, mammothRoarCd: 0,
      wolfFrenzyT: 0, wolfLungeT: 0, wolfTargetId: undefined, wolfBitesLeft: 0, wolfChainTargets: undefined, wolfChainRainbow: false,
      flightT: 0, burnT: 0, burnDmgTimer: 0, tossT: 0, pegasusCandyCount: 0, pegasusCandyTimer: 0, swanIceTimer: 0,
    });
    delete p.morphOrigSpecies;
    delete p.morphT;
    p.input.btn = false;
    p.dashHit.clear();
    this.events.push({ k: 'join', ...this.meta(p) });
  }

  /** a spot away from the fence, hay, ponds and other animals */
  private freeSpot(): [number, number] {
    let bx = 0, bz = 0, bestGap = -1;
    for (let i = 0; i < 30; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * (CFG.R - 12);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 3)) continue;
      let gap = 99;
      for (const o of this.players.values()) if (o.alive) gap = Math.min(gap, Math.hypot(o.x - x, o.z - z));
      if (gap > 8) return [x, z];
      if (gap > bestGap) { bestGap = gap; bx = x; bz = z; }
    }
    return [bx, bz];
  }

  private fillBots(): void {
    if (!this.botsEnabled || this.mode === 'team' || this.mode === 'friend') return;
    const hasTeams = [...this.players.values()].some((p) => p.team !== undefined);
    if (hasTeams) return; // Team mode has no bots

    const BOT_SPECIES: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig', 'dog', 'elephant', 'monkey'];
    if (this.players.size < CFG.BOT_FILL) {
      const sp: Species = BOT_SPECIES[Math.floor(this.rnd() * BOT_SPECIES.length)];
      const used = new Set([...this.players.values()].map((p) => p.name));
      const pool = SPECIES_BOT_NAMES[sp] || [];
      const free = pool.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(this.rnd() * free.length)] : `${SPECIES_NAMES_VI[sp]} ${this.nextId}`;
      this.addPlayer(name, sp, true);
    } else if (this.players.size > CFG.BOT_FILL) {
      // a human joined a full room: retire a bot (a dead one if possible)
      let pick: Player | null = null;
      for (const p of this.players.values()) if (p.bot && (!pick || (!p.alive && pick.alive) || (p.alive === pick.alive && p.mass < pick.mass))) pick = p;
      if (pick) this.removePlayer(pick.id);
    }
  }

  collectGarbage(): void {
    // 1. Trim excess food if accumulated significantly above target
    if (this.food.size > CFG.FOOD_TARGET * 1.4) {
      const excess = this.food.size - CFG.FOOD_TARGET;
      let removed = 0;
      for (const [fid, f] of this.food.entries()) {
        if (removed >= excess) break;
        if (f.k === 6 || f.k === 8 || f.k === 9) continue;
        this.food.delete(fid);
        this.foodRemoved.push(fid);
        removed++;
      }
    }

    // 2. Orphaned minions cleanup (owner missing, dead, or dropped below min mass)
    for (const [mid, m] of this.minions.entries()) {
      const owner = this.players.get(m.ownerId);
      if (!owner || !owner.alive || m.mass <= 5) {
        this.minions.delete(mid);
      }
    }

    // 3. Projectile out-of-bounds or expired cleanup
    for (let i = this.bananaProjectiles.length - 1; i >= 0; i--) {
      const b = this.bananaProjectiles[i];
      if (b.life <= 0 || Math.hypot(b.x, b.z) > CFG.R + 10) {
        this.bananaProjectiles.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ tick

  step(): void {
    this.tick++;
    this.time += DT;
    this.fillBots();

    // Periodic entity garbage collection every 600 ticks (~30 seconds)
    if (this.tick % 600 === 0) {
      this.collectGarbage();
    }

    // Team mode match clock & scoring
    if (this.mode === 'team') {
      // Clean up any remaining bots in team mode
      for (const [id, p] of this.players.entries()) {
        if (p.bot) this.removePlayer(id);
      }

      let team0Count = 0;
      let team1Count = 0;
      for (const p of this.players.values()) {
        if (!p.bot) {
          if (p.team === 0) team0Count++;
          else if (p.team === 1) team1Count++;
        }
      }
      const canStartMatch = team0Count >= 1 && team1Count >= 1;

      if (!this.matchEnded) {
        if (canStartMatch) {
          this.matchClock = Math.max(0, this.matchClock - DT);
          if (this.napoleonId > 0) {
            const king = this.players.get(this.napoleonId);
            if (king && king.alive && king.team !== undefined) {
              this.teamScores[king.team] += DT * 1;
              king.score = (king.score || 0) + DT * 10;
            }
          }
        }
        if (this.matchClock <= 0) {
          this.matchEnded = true;
          this.matchEndTimer = 0;
          const winner = this.teamScores[0] > this.teamScores[1] ? 0 : this.teamScores[1] > this.teamScores[0] ? 1 : -1;

          // Determine match MVP
          let mvpPlayer: Player | null = null;
          let bestScore = -1;
          for (const p of this.players.values()) {
            if (p.bot) continue;
            const pScore = p.score || 0;
            if (pScore > bestScore || !mvpPlayer) {
              bestScore = pScore;
              mvpPlayer = p;
            }
          }
          const mvp = mvpPlayer ? {
            id: mvpPlayer.id,
            name: mvpPlayer.name,
            team: mvpPlayer.team ?? 0,
            species: mvpPlayer.species,
            skin: mvpPlayer.skin,
            score: Math.round(mvpPlayer.score || 0),
            kills: mvpPlayer.totalKills ?? mvpPlayer.kills,
            mass: Math.round(mvpPlayer.best ?? mvpPlayer.mass),
          } : undefined;

          this.events.push({
            k: 'teamWin',
            winner,
            s0: Math.round(this.teamScores[0]),
            s1: Math.round(this.teamScores[1]),
            mvp,
          });
        }
      } else {
        // After 6s celebration, renew game with brand new map layout and items
        this.matchEndTimer += DT;
        if (this.matchEndTimer >= 6.0) {
          this.renewGame();
        }
      }
    } else if (this.mode === 'friend' && this.matchDuration > 0) {
      const activePlayers = [...this.players.values()].filter((p) => !p.bot);
      const canStartMatch = activePlayers.length >= 1;

      if (!this.matchEnded) {
        if (canStartMatch) {
          this.matchClock = Math.max(0, this.matchClock - DT);
          if (this.napoleonId > 0) {
            const king = this.players.get(this.napoleonId);
            if (king && king.alive) {
              king.score = (king.score || 0) + DT * 10;
            }
          }
        }
        if (this.matchClock <= 0) {
          this.matchEnded = true;
          this.matchEndTimer = 0;

          // Determine winner & ranks in friend mode
          const activeHumans = [...this.players.values()].filter((p) => !p.bot);
          activeHumans.sort((a, b) => {
            const aVal = (a.score || 0) * 1000 + (a.mass || 0);
            const bVal = (b.score || 0) * 1000 + (b.mass || 0);
            return bVal - aVal;
          });
          const winnerPlayer = activeHumans[0] || null;
          const ranks = activeHumans.slice(0, 10).map((p): LeaderRow => [
            p.id,
            p.name,
            Math.round(p.best ?? p.mass),
            p.totalKills ?? p.kills,
            p.id === this.napoleonId ? Math.round(this.napoleonReign) : undefined,
          ]);

          const mvp = winnerPlayer
            ? {
                id: winnerPlayer.id,
                name: winnerPlayer.name,
                team: 0,
                species: winnerPlayer.species,
                skin: winnerPlayer.skin,
                score: Math.round(winnerPlayer.score || 0),
                kills: winnerPlayer.totalKills ?? winnerPlayer.kills,
                mass: Math.round(winnerPlayer.best ?? winnerPlayer.mass),
              }
            : undefined;

          this.events.push({
            k: 'teamWin',
            winner: winnerPlayer ? winnerPlayer.id : -1,
            s0: 0,
            s1: 0,
            mvp,
            ranks,
          });
        }
      } else {
        // After 6s celebration, renew game with brand new map layout and items
        this.matchEndTimer += DT;
        if (this.matchEndTimer >= 6.0) {
          this.renewGame();
        }
      }
    }

    // Requirement 2: Automatic map transformation every 5 minutes (300s) with 5s countdown
    if (!this.matchEnded) {
      const prevSec = Math.ceil(this.mapShiftTimer);
      this.mapShiftTimer -= DT;
      const currSec = Math.ceil(this.mapShiftTimer);
      if (currSec <= 5 && currSec > 0 && currSec !== prevSec) {
        this.events.push({ k: 'mapWarn', left: currSec });
      }
      if (this.mapShiftTimer <= 0) {
        this.mapShiftTimer = 300;
        this.shiftMap();
      }
    }

    for (const tree of this.treeSims) {
      tree.step(DT);
    }

    // Update Heart Reviving players
    for (const p of this.players.values()) {
      if (p.heartReviving) {
        p.heartReviveTimer = (p.heartReviveTimer ?? 3.0) - DT;
        if (p.heartReviveTimer <= 0) {
          p.heartReviving = false;
          p.alive = true;
          p.mass = p.heartReviveMass ?? p.mass;
          const [safeX, safeZ] = this.findSafeReviveSpot(p.heartDeathX ?? p.x, p.heartDeathZ ?? p.z);
          p.x = safeX;
          p.z = safeZ;
          p.vx = 0;
          p.vz = 0;
          p.shieldT = 3.0; // 3s immunity protection on revive!
          p.inWaterT = 0;
          p.stunT = 0;
          p.slowT = 0;
          p.squishT = 0;
          this.events.push({
            k: 'heartRevived',
            id: p.id,
            x: r2(p.x),
            z: r2(p.z),
            mass: Math.round(p.mass),
          });
        }
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (!p.heartReviving && p.bot && (p.respawnT -= DT) <= 0) this.spawn(p);
        continue;
      }
      if (p.ai && p.bot) thinkBot(this, p, DT);
      if (p.adminGod) {
        p.stunT = 0;
        p.slowT = 0;
        p.squishT = 0;
        p.inWaterT = 0;
      }
      if (p.adminPermaRainbow) {
        p.superT = 10;
      }
      this.handleButton(p);
    }

    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of alive) {
      p.prevX = p.x;
      p.prevZ = p.z;
    }
    const h = DT / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const p of alive) {
        p.terrain = terrainAt(this.map, p.x, p.z);
        if (p.terrain === 1) {
          p.charging = false;
          p.holdT = 0;
          p.pressed = false;
          p.btnLatch = false;
        }
        const isLeaping = (p.monkeyLeapT !== undefined && p.monkeyLeapT > 0);
        const isWolfFrenzyActive = (p.wolfFrenzyT !== undefined && p.wolfFrenzyT > 0) && (!p.wolfLungeT || p.wolfLungeT <= 0);
        if (isLeaping) {
          p.x += p.vx * h;
          p.z += p.vz * h;
          p.stunT = 0;
          p.charging = false;
          p.holdT = 0;
        } else if (isWolfFrenzyActive) {
          p.stunT = 0;
          p.charging = false;
          p.holdT = 0;
          p.vx = 0;
          p.vz = 0;
        } else if (p.wheelT > 0) {
          // Wheel vehicle mode: cannot stop! Continuous forward motion at speed 19
          p.a = p.input.a;
          const cartSpeed = 19;
          p.vx = Math.cos(p.a) * cartSpeed;
          p.vz = Math.sin(p.a) * cartSpeed;
          p.x += p.vx * h;
          p.z += p.vz * h;
          p.stunT = 0;
          p.charging = false;
          p.holdT = 0;
          // Boundary bounce to keep cart inside the farm
          const d = Math.hypot(p.x, p.z);
          const maxR = CFG.R - 3.5;
          if (d > maxR && d > 1e-5) {
            const nx = p.x / d, nz = p.z / d;
            p.x = nx * maxR;
            p.z = nz * maxR;
            const vn = p.vx * nx + p.vz * nz;
            if (vn > 0) {
              p.vx -= 1.8 * vn * nx;
              p.vz -= 1.8 * vn * nz;
              p.a = Math.atan2(p.vz, p.vx);
            }
          }
        } else {
          const isShielded = p.shieldT > 0;
          const speedBoost = p.speedT > 5 ? 3.0 : (p.speedT > 0 ? (1.0 + (p.speedT / 5.0) * 2.0) : 1.0);
          const slowMult = (p.slowT > 0 && !isShielded) ? Math.max(0.4, 1.0 - 0.6 * Math.min(1, p.slowT)) : 1.0;
          const effectiveTerrain = isShielded ? 0 : p.terrain;
          const adminSpeedMult = (p.adminSpeedMult && p.adminSpeedMult > 1) ? p.adminSpeedMult : 1.0;
          const tillSpeedMult = ((this.tillTruck.active && p.id === this.napoleonId) ? 1.5 : 1.0) * ((p.species === 'monkey' || p.species === 'gorilla') && p.superT > 0 ? 1.30 : 1.0) * slowMult * speedBoost * adminSpeedMult;
          stepMove(p, p.input, h, p.species, effectiveTerrain, tillSpeedMult);
        }
        if (!isLeaping) {
          const wasStunned = p.stunT >= 1.4;
          const hayHit = collideHay(p, this.map.hay);
          if (hayHit && !wasStunned && !(p.shieldT > 0)) {
            p.plow = false;
            p.charging = false;
            p.holdT = 0;
            p.pressed = false;
            p.btnLatch = false;
            this.events.push({ k: 'hit', a: 0, v: p.id, x: r2(p.x), z: r2(p.z), s: 3 });
          }
        }

        // Podium protective shield barrier: blocks all animals from entering the podium area
        if (!isLeaping && this.podiumShield) {
          const [podX, podZ] = this.map.podium;
          const dx = p.x - podX, dz = p.z - podZ;
          const d = Math.hypot(dx, dz);
          const pr = radiusOf(p.mass);
          const minD = CFG.PODIUM_R + 0.5 + pr;
          if (d < minD && d > 1e-6) {
            const nx = dx / d, nz = dz / d;
            p.x = podX + nx * minD;
            p.z = podZ + nz * minD;
            const vn = p.vx * nx + p.vz * nz;
            if (vn < 0) {
              p.vx -= 1.4 * vn * nx;
              p.vz -= 1.4 * vn * nz;
            }
            if (p.dashT > 0) {
              p.dashT = 0;
              p.plow = false;
              this.events.push({ k: 'hit', a: 0, v: p.id, x: r2(p.x), z: r2(p.z), s: 2 });
            }
          }
        }

        // 3 Fruit Trees: solid cylindrical obstacle collision + ramming shaking / fruit drop / 3s stun
        if (!isLeaping && this.treeSims.length > 0) {
          for (const tree of this.treeSims) {
            const dx = p.x - tree.x, dz = p.z - tree.z;
            const d = Math.hypot(dx, dz);
            const pr = radiusOf(p.mass);
            const minD = tree.r + pr;
            if (d < minD && d > 1e-6) {
              const nx = dx / d, nz = dz / d;
              p.x = tree.x + nx * minD;
              p.z = tree.z + nz * minD;
              const vn = p.vx * nx + p.vz * nz;
              if (vn < 0) {
                p.vx -= 1.6 * vn * nx;
                p.vz -= 1.6 * vn * nz;
              }

              // Ramming check: dashing into the tree
              if (p.dashT > 0 && tree.cooldownHit <= 0) {
                tree.cooldownHit = 0.5;
                p.plow = false;
                p.charging = false;
                p.holdT = 0;
                p.pressed = false;
                p.btnLatch = false;

                // Mass requirements: 1000kg (Large, size 2), 500kg (Medium, size 1), 100kg (Small, size 0)
                const reqMass = tree.size === 2 ? 1000 : tree.size === 1 ? 500 : 100;
                const hasBigFruits = tree.big > 0;

                if (hasBigFruits && p.mass >= reqMass) {
                  // SUCCESSFUL RAM!
                  // Stun for 1.5s (Monkey and Gorilla are immune to tree stun!)
                  const isPrimate = p.species === 'monkey' || p.species === 'gorilla';
                  p.stunT = isPrimate ? 0 : 1.5;
                  p.dashT = 0;
                  p.vx = isPrimate ? 0 : nx * 8;
                  p.vz = isPrimate ? 0 : nz * 8;

                  // Each ram drops 1/3 of the remaining fruits
                  const dropBig = Math.ceil(tree.big / 3);
                  const dropSmall = Math.ceil(tree.small / 3);
                  const totalDropped = dropBig + dropSmall;

                  tree.big = Math.max(0, tree.big - dropBig);
                  tree.small = Math.max(0, tree.small - dropSmall);

                  // Drop fruits onto the ground as edible food
                  // Correct order based on tree size:
                  // - Cây nhỏ (size 0): Quả nhỏ từ 5 đến 10 kg
                  // - Cây vừa (size 1): Quả vừa từ 20 đến 50 kg
                  // - Cây to (size 2): Quả to 100 kg
                  for (let i = 0; i < totalDropped; i++) {
                    const ang = this.rnd() * Math.PI * 2;
                    const dist = tree.r + 1.2 + this.rnd() * 3.5;
                    const fx = clamp(tree.x + Math.cos(ang) * dist, -(CFG.R - 2), CFG.R - 2);
                    const fz = clamp(tree.z + Math.sin(ang) * dist, -(CFG.R - 2), CFG.R - 2);
                    const fruitWeight = tree.size === 2
                      ? 100
                      : tree.size === 1
                      ? Math.round(20 + this.rnd() * 30)
                      : Math.round(5 + this.rnd() * 5);
                    this.addFood(fx, fz, 1, fruitWeight);
                  }

                  // Number of flowers born matches number of fruits dropped (starts 30s lifecycle)
                  tree.batches.push({
                    timer: 0,
                    count: totalDropped,
                    bigCount: dropBig,
                    smallCount: dropSmall,
                  });

                  this.events.push({
                    k: 'treeHit',
                    id: tree.id,
                    by: p.id,
                    x: r2(tree.x),
                    z: r2(tree.z),
                    size: tree.size,
                    droppedBig: dropBig,
                    droppedSmall: dropSmall,
                  });
                } else {
                  // Insufficient mass or no big fruits ready: bounce off trunk
                  const isPrimate = p.species === 'monkey' || p.species === 'gorilla';
                  p.dashT = 0;
                  p.stunT = isPrimate ? 0 : Math.max(p.stunT, 0.8);
                  p.vx = nx * 10;
                  p.vz = nz * 10;
                  this.events.push({ k: 'hit', a: 0, v: p.id, x: r2(p.x), z: r2(p.z), s: 2 });
                }
              }
            }
          }
        }
      }
      this.collidePlayers(alive);
    }

    for (const p of alive) {
      if (p.dashT <= 0) {
        p.plow = false;
        if (!p.flightT || p.flightT <= 0) p.flyT = 0;
      }
      if (!p.alive) continue;

      // 1. Electric fence
      if (outsideFence(p)) {
        if ((p.monkeyLeapT && p.monkeyLeapT > 0) || (p.wolfFrenzyT && p.wolfFrenzyT > 0) || p.flyT > 0 || p.shieldT > 0) {
          const d = Math.hypot(p.x, p.z), lim = CFG.R - radiusOf(p.mass) * 0.3 - 1;
          if (d > 0) {
            p.x = (p.x / d) * lim;
            p.z = (p.z / d) * lim;
          }
          p.vx *= -0.2;
          p.vz *= -0.2;
          p.flyT = 0;
          p.dashT = 0;
        } else {
          this.kill(p, 'fence');
          continue;
        }
      }

      // Flying, leaping, tossed in air, wolf frenzy, or shield immunity over terrain hazards (well, fire, water, etc.)
      if ((p.monkeyLeapT && p.monkeyLeapT > 0) || (p.wolfFrenzyT && p.wolfFrenzyT > 0) || p.shieldT > 0 || (p.flightT && p.flightT > 0) || (p.tossT && p.tossT > 0) || p.flyT > 0) {
        p.inWaterT = 0;
        continue;
      }

      // 2. Stone pit / Well
      for (const [wx, wz, wr] of (this.map.well || [])) {
        if (Math.hypot(p.x - wx, p.z - wz) < wr + radiusOf(p.mass) * 0.35) {
          this.kill(p, 'well');
          break;
        }
      }
      if (!p.alive) continue;

      // 3. Fire pit
      for (const [fx, fz, fr] of (this.map.fire || [])) {
        if (Math.hypot(p.x - fx, p.z - fz) < fr + radiusOf(p.mass) * 0.35) {
          this.kill(p, 'fire');
          break;
        }
      }
      if (!p.alive) continue;

      // 4. Pond drowning (ducks, swans, dogs, wolves & pegasus swim/fly freely; other animals struggle for 1.5s before drowning)
      if (p.species !== 'duck' && p.species !== 'swan' && p.species !== 'dog' && p.species !== 'wolf' && p.species !== 'pegasus') {
        let inPond = false;
        for (const b of (this.map.pond || [])) {
          if (insideBlob(b, p.x, p.z, -0.7)) {
            inPond = true;
            break;
          }
        }
        if (inPond && p.dashT <= 0) {
          p.inWaterT += DT;
          if (p.inWaterT >= CFG.DROWN_TIME) {
            this.kill(p, 'drown');
            continue;
          }
        } else {
          p.inWaterT = 0;
        }
      } else {
        p.inWaterT = 0;
      }
    }

    this.eat(alive);
    this.updateBananaProjectiles(DT);

    // Tool & Super Candy spawning (maintain TOOL_TARGET tools with balanced replenishment)
    this.toolSpawnTimer -= DT;
    if (this.toolSpawnTimer <= 0) {
      const deficit = CFG.TOOL_TARGET - this.tools.size;
      if (deficit >= 5) {
        this.toolSpawnTimer = 3.0 + this.rnd() * 2.0; // quick replenishment when many tools are taken
      } else {
        this.toolSpawnTimer = 5.0 + this.rnd() * 3.0; // steady 5..8s cadence, balanced density
      }
      if (this.tools.size < CFG.TOOL_TARGET) {
        this.spawnTool();
      }
    }

    this.superCandyTimer -= DT;
    if (this.superCandyTimer <= 0) {
      this.superCandyTimer = 35 + this.rnd() * 25;
      let hasSuper = false;
      for (const f of this.food.values()) {
        if (f.k === 6) { hasSuper = true; break; }
      }
      if (!hasSuper) {
        this.spawnSuperCandy();
      }
    }

    // Dolphin Heart Spawner:
    // Trái tim chỉ xuất hiện giữa hồ khi Cá heo đưa vào giữa.
    // Nếu đã có Trái tim ở trước đó thì cá heo sẽ chỉ bơi vòng quanh và thỉnh thoảng hiện lên thôi. Còn nếu chưa có thì cứ tiếp tục.
    const hasHeartTool = [...this.tools.values()].some((t) => t.kind === 'heart');
    if (!hasHeartTool) {
      if (this.dolphinDelivering) {
        this.dolphinDeliveryTimer -= DT;
        if (this.dolphinDeliveryTimer <= 0) {
          this.dolphinDelivering = false;
          this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
          this.spawnDolphinHeart();
        }
      } else {
        this.dolphinHeartTimer -= DT;
        if (this.dolphinHeartTimer <= 0) {
          const pond = this.getLargestPond();
          if (pond) {
            this.dolphinDelivering = true;
            this.dolphinDeliveryTimer = 2.0; // 2s for dolphin to swim into center and surface
            this.events.push({
              k: 'dolphinDeliver',
              x: r2(pond[0]),
              z: r2(pond[1]),
            });
          } else {
            this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
          }
        }
      }
    } else {
      this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
      this.dolphinDelivering = false;
    }

    // Requirement 4: Items despawn after 3 minutes (180s) without being picked up, and respawn at a new position
    for (const [id, t] of this.tools) {
      t.age = (t.age || 0) + DT;
      if (t.age >= 180) {
        this.tools.delete(id);
        this.spawnTool();
      }
    }
    for (const f of this.food.values()) {
      if (f.k === 6) {
        f.age = (f.age || 0) + DT;
        if (f.age >= 180) {
          this.food.delete(f.id);
          this.foodRemoved.push(f.id);
          this.spawnSuperCandy();
        }
      }
    }

    // Tool pickup & timer updates
    for (const p of alive) {
      if (!p.alive) continue;
      if (p.pitchforkT > 0) {
        p.pitchforkT = Math.max(0, p.pitchforkT - DT);
        if (p.pitchforkT <= 0) p.pitchforkHits = undefined;
      }
      if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - DT);
      if (p.superT > 0) {
        p.superT = Math.max(0, p.superT - DT);
        if (p.species === 'mammoth') {
          p.cd = 0;
          p.mammothRoarCd = 0;
        }
      }
      if (p.flyT > 0) p.flyT = Math.max(0, p.flyT - DT);
      if (p.flightT && p.flightT > 0) {
        p.flightT = Math.max(0, p.flightT - DT);
        p.flyT = p.flightT;
        p.inWaterT = 0;
        if (p.species === 'pegasus' && p.superT > 0 && (p.pegasusCandyCount ?? 0) < 5) {
          p.pegasusCandyTimer = (p.pegasusCandyTimer ?? 1.2) - DT;
          if (p.pegasusCandyTimer <= 0) {
            p.pegasusCandyTimer = 1.8;
            p.pegasusCandyCount = (p.pegasusCandyCount ?? 0) + 1;
            this.addFood(p.x, p.z, 6, 3);
            this.events.push({ k: 'superFood', x: r2(p.x), z: r2(p.z) });
          }
        }
        if (p.species === 'swan' && p.superT > 0) {
          p.swanIceTimer = (p.swanIceTimer ?? 1.2) - DT;
          if (p.swanIceTimer <= 0) {
            p.swanIceTimer = 1.6;
            const iceR = 6.0;
            for (const other of this.players.values()) {
              if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
              if (Math.hypot(other.x - p.x, other.z - p.z) <= iceR + radiusOf(other.mass)) {
                other.stunT = Math.max(other.stunT, 3.0);
                other.vx = 0;
                other.vz = 0;
              }
            }
            this.events.push({ k: 'swanIce', id: p.id, x: r2(p.x), z: r2(p.z), r: iceR, rainbow: true });
          }
        }
      }
      if (p.burnT && p.burnT > 0) {
        p.burnT = Math.max(0, p.burnT - DT);
        p.burnDmgTimer = (p.burnDmgTimer ?? 0.5) - DT;
        if (p.burnDmgTimer <= 0) {
          p.burnDmgTimer = 0.5;
          const loss = Math.max(2, Math.round(p.mass * 0.03));
          if (p.mass - loss >= 20) {
            p.mass -= loss;
            this.scatter(p.x, p.z, loss, radiusOf(p.mass) + 0.5);
          }
        }
      }
      if (p.tossT && p.tossT > 0) {
        p.tossT = Math.max(0, p.tossT - DT);
        if (p.tossT <= 0) {
          p.squishT = 3.0;
        }
      }
      if (p.squishT > 0) p.squishT = Math.max(0, p.squishT - DT);
      if (p.wheelT > 0) p.wheelT = Math.max(0, p.wheelT - DT);
      if (p.speedT > 0) p.speedT = Math.max(0, p.speedT - DT);
      if (p.shieldT > 0) {
        p.shieldT = Math.max(0, p.shieldT - DT);
        p.stunT = 0;
        p.slowT = 0;
        p.squishT = 0;
        p.inWaterT = 0;
      }
      if (p.treeShakeT && p.treeShakeT > 0) {
        p.treeShakeT = Math.max(0, p.treeShakeT - DT);
        // Gorilla continuous tree shaking progression (drops 1/3 every second, drops all at 3s)
        if (p.species === 'gorilla' && p.treeShakeTreeId !== undefined) {
          p.treeShakeTimer = (p.treeShakeTimer ?? p.treeShakeT) - DT;
          p.vx = 0;
          p.vz = 0;
          p.stunT = 0; // immune to stun while shaking tree
          const tree = this.treeSims.find(t => t.id === p.treeShakeTreeId);
          if (tree) {
            if (p.treeShakeDropStage === 1 && p.treeShakeTimer <= 2.0) {
              p.treeShakeDropStage = 2;
              const dropBig = Math.ceil(tree.big / 2);
              const dropSmall = Math.ceil(tree.small / 2);
              this.dropTreeFruits(tree, p.id, dropBig, dropSmall);
            } else if (p.treeShakeDropStage === 2 && p.treeShakeTimer <= 1.0) {
              p.treeShakeDropStage = 3;
              const dropBig = Math.ceil(tree.big / 2);
              const dropSmall = Math.ceil(tree.small / 2);
              this.dropTreeFruits(tree, p.id, dropBig, dropSmall);
            } else if (p.treeShakeDropStage === 3 && p.treeShakeTimer <= 0.05) {
              p.treeShakeDropStage = 4;
              const dropBig = tree.big;
              const dropSmall = tree.small;
              this.dropTreeFruits(tree, p.id, dropBig, dropSmall);
            }
          }
        }
      }

      if (p.mammothRoarT && p.mammothRoarT > 0) {
        p.mammothRoarT = Math.max(0, p.mammothRoarT - DT);
        p.vx = 0;
        p.vz = 0;
      }
      if (p.mammothRoarCd && p.mammothRoarCd > 0) {
        p.mammothRoarCd = Math.max(0, p.mammothRoarCd - DT);
      }

      if ((p.wolfFrenzyT && p.wolfFrenzyT > 0) || (p.wolfLungeT && p.wolfLungeT > 0)) {
        this.stepWolfFrenzy(p, DT);
      }

      // Monkey & Gorilla Leap landing check
      if (p.monkeyLeapT && p.monkeyLeapT > 0) {
        p.monkeyLeapT = Math.max(0, p.monkeyLeapT - DT);
        if (p.monkeyLeapT <= 0) {
          p.dashT = 0;
          const isGorilla = (p.species === 'gorilla');
          const ratio = p.monkeyLeapRatio ?? 0.5;
          const isMaxCharge = ratio >= 0.85;
          const isRainbowLanding = p.superT > 0;
          const bodyR = radiusOf(p.mass);
          // Gorilla has massive shockwave, monkey has focused shockwave; rainbow widens shockwave
          const shockwaveR = isRainbowLanding
            ? (isGorilla ? bodyR + 6.5 + ratio * 8.0 : bodyR + 4.5 + ratio * 6.5)
            : (isGorilla ? bodyR + 4.5 + ratio * 6.0 : bodyR + 2.5 + ratio * 3.5);

          // Water landing check: if landed in pond, splash water and initiate drowning
          const inWater = (this.map.pond || []).some((b) => insideBlob(b, p.x, p.z, -0.7));
          if (inWater) {
            p.inWaterT = 0.05;
          }
          let touchedAnimal = false;
          for (const other of this.players.values()) {
            if (!other.alive || other.id === p.id || (other.monkeyLeapT && other.monkeyLeapT > 0)) continue;
            const dx = other.x - p.x;
            const dz = other.z - p.z;
            const dist = Math.hypot(dx, dz);
            const otherR = radiusOf(other.mass);
            // Va chạm vật lý trực tiếp giữa 2 con vật (cho cú nảy quán tính)
            if (dist <= (bodyR + otherR) * 1.15) {
              touchedAnimal = true;
            }
            if (dist <= shockwaveR) {
              // Gorilla & Mammoth immunity: immune to shockwaves from leapers < 1 ton without rainbow!
              if ((other.species === 'gorilla' || other.species === 'mammoth') && p.mass < 1000 && !isRainbowLanding) {
                continue;
              }
              const pushAng = Math.atan2(dz, dx);

              // Shield Immunity: 100% immune to stun, squish, slow, knockback, flinch and kill; takes damage only!
              if (other.shieldT > 0) {
                const lossFraction = isGorilla
                  ? (isRainbowLanding ? (0.20 + ratio * 0.10) : 0.15)
                  : (isRainbowLanding ? (0.04 + ratio * 0.06) : (0.02 + ratio * 0.03));
                const massLoss = Math.max(isGorilla ? 10 : 1, Math.round(other.mass * lossFraction));
                other.mass = Math.max(10, other.mass - massLoss);
                this.scatter(other.x, other.z, massLoss, radiusOf(other.mass) + 1.5, Math.cos(pushAng), Math.sin(pushAng));
                other.lastHitBy = p.id;
                other.lastHitT = this.time;
                p.lastAttackedId = other.id;
                p.lastAttackedT = this.time;
                this.events.push({
                  k: 'hit',
                  a: p.id,
                  v: other.id,
                  x: r2(other.x),
                  z: r2(other.z),
                  s: isGorilla ? 14 : 10,
                  loss: massLoss,
                });
                continue;
              }

              if (isGorilla) {
                if (other.mass <= 50) {
                  // Đạp dẹp lép và LẬP TỨC KẾT LIỄU con vật <= 50kg!
                  other.squishT = 3.0;
                  other.lastHitBy = p.id;
                  other.lastHitT = this.time;
                  p.lastAttackedId = other.id;
                  p.lastAttackedT = this.time;
                  const stolenKg = other.mass;
                  p.mass += Math.round(stolenKg * 0.3);
                  this.events.push({
                    k: 'hit',
                    a: p.id,
                    v: other.id,
                    x: r2(other.x),
                    z: r2(other.z),
                    s: 30,
                    loss: Math.round(other.mass),
                  });
                  this.kill(other, 'crush');
                } else if (isRainbowLanding || (isMaxCharge && other.mass <= 500)) {
                  // Gorilla: làm dẹp lép con vật (kể cả khi gồng thường max thanh <= 500kg, hoặc khi có Rainbow)
                  other.squishT = isRainbowLanding ? 3.0 : 2.5;
                  other.stunT = Math.max(other.stunT, isRainbowLanding ? 1.0 : 0.5);
                  other.slowT = Math.max(other.slowT, isRainbowLanding ? 2.0 : 1.0);
                  other.vx = 0;
                  other.vz = 0;
                  other.dashT = 0;
                  other.plow = false;
                  other.lastHitBy = p.id;
                  other.lastHitT = this.time;
                  p.lastAttackedId = other.id;
                  p.lastAttackedT = this.time;
                  const lossFraction = isRainbowLanding ? (0.20 + ratio * 0.10) : 0.15;
                  const massLoss = Math.max(10, Math.round(other.mass * lossFraction));
                  other.mass = Math.max(10, other.mass - massLoss);
                  this.scatter(other.x, other.z, massLoss, radiusOf(other.mass) + 2.0, Math.cos(pushAng), Math.sin(pushAng));
                  this.events.push({
                    k: 'hit',
                    a: p.id,
                    v: other.id,
                    x: r2(other.x),
                    z: r2(other.z),
                    s: 20,
                    loss: massLoss,
                  });
                } else {
                  // > 500kg khi không có rainbow (hoặc gồng nhẹ không max thanh): Bị hất văng bởi sóng chấn động
                  const force = 24.0 + ratio * 32.0;
                  other.vx += Math.cos(pushAng) * force;
                  other.vz += Math.sin(pushAng) * force;
                  other.dashT = 0;
                  other.plow = false;
                  if (isMaxCharge) {
                    other.stunT = Math.max(other.stunT, 0.5);
                    other.slowT = Math.max(other.slowT, 1.0);
                  } else {
                    other.stunT = Math.max(other.stunT, 0.6);
                  }
                  other.lastHitBy = p.id;
                  other.lastHitT = this.time;
                  p.lastAttackedId = other.id;
                  p.lastAttackedT = this.time;
                  const massLoss = Math.max(10, Math.round(other.mass * (0.05 + ratio * 0.07)));
                  other.mass = Math.max(10, other.mass - massLoss);
                  this.scatter(other.x, other.z, massLoss, radiusOf(other.mass) + 2.0, Math.cos(pushAng), Math.sin(pushAng));
                  this.events.push({
                    k: 'hit',
                    a: p.id,
                    v: other.id,
                    x: r2(other.x),
                    z: r2(other.z),
                    s: Math.round(force),
                    loss: massLoss,
                  });
                }
              } else {
                // MONKEY:
                // KHÔNG làm dẹp lép! Chỉ hất văng mọi con vật ra xa (khoảng cách tỉ lệ với độ gồng)
                // Cầu vồng hất văng cực xa! (Giảm 1/2 uy lực đối với Gorilla và Voi Mammoth)
                let force = isRainbowLanding
                  ? (32.0 + ratio * 48.0)
                  : (14.0 + ratio * 20.0);
                if (isRainbowLanding && (other.species === 'gorilla' || other.species === 'mammoth')) {
                  force *= 0.5;
                }
                other.vx += Math.cos(pushAng) * force;
                other.vz += Math.sin(pushAng) * force;
                other.dashT = 0;
                other.plow = false;
                other.stunT = Math.max(other.stunT, isRainbowLanding ? (0.5 + ratio * 0.8) : 0.2);
                other.lastHitBy = p.id;
                other.lastHitT = this.time;
                p.lastAttackedId = other.id;
                p.lastAttackedT = this.time;
                const massLoss = Math.max(1, Math.round(other.mass * (isRainbowLanding ? (0.04 + ratio * 0.06) : (0.02 + ratio * 0.03))));
                other.mass = Math.max(10, other.mass - massLoss);
                this.scatter(other.x, other.z, massLoss, radiusOf(other.mass) + 1.5, Math.cos(pushAng), Math.sin(pushAng));
                this.events.push({
                  k: 'hit',
                  a: p.id,
                  v: other.id,
                  x: r2(other.x),
                  z: r2(other.z),
                  s: Math.round(force),
                  loss: massLoss,
                });
              }
            }
          }

          this.events.push({
            k: 'monkeyLand',
            id: p.id,
            x: r2(p.x),
            z: r2(p.z),
            r: r2(shockwaveR),
            ratio: r2(ratio),
            isGorilla,
            inWater,
            rainbow: isRainbowLanding,
          });

          // Cơ chế quán tính: Khỉ khi gồng max (isMaxCharge >= 0.85) nếu vừa rớt xuống CHẠM 1 con vật khác (touchedAnimal)
          // thì nhảy quán tính thêm 1 cái về phía trước! (Gorilla luôn chỉ nhảy 1 cái; Khỉ chỉ nảy 1 lần không lặp)
          if (!isGorilla && isMaxCharge && touchedAnimal && !p.monkeyBounced && !inWater) {
            p.monkeyBounced = true;
            const bounceDur = 0.38;
            const bounceDist = 7.5;
            const bounceHeight = 2.8;
            const bounceSpeed = bounceDist / bounceDur;
            p.monkeyLeapT = bounceDur;
            p.monkeyLeapDur = bounceDur;
            p.monkeyLeapHeight = bounceHeight;
            p.monkeyLeapRatio = 0.5;
            p.dashT = bounceDur;
            p.vx = Math.cos(p.a) * bounceSpeed;
            p.vz = Math.sin(p.a) * bounceSpeed;
            p.cd = Math.max(p.cd, 0.35);
            this.events.push({
              k: 'monkeyLeap',
              id: p.id,
              x: r2(p.x),
              z: r2(p.z),
              dur: r2(bounceDur),
              height: r2(bounceHeight),
              ratio: 0.5,
              rainbow: isRainbowLanding,
              bounce: true,
            });
          } else {
            p.monkeyBounced = false;
          }
        }
      }

      // Animal Evolution into Evolved form when reaching 3 tons (3000 kg)
      const evolvedTarget = EVOLVED_PAIRS[p.species];
      if (p.alive && evolvedTarget && p.mass >= 3000) {
        p.species = evolvedTarget;
        delete p.morphT; // Permanent evolution while alive
        delete p.morphOrigSpecies;
        this.events.push({
          k: 'morph',
          id: p.id,
          species: evolvedTarget,
          dur: 0,
        });
      }

      // Animal De-evolution into Base form when dropping below 1 ton (1000 kg)
      const devolvedTarget = DEVOLVED_PAIRS[p.species];
      if (p.alive && devolvedTarget && p.mass < 1000) {
        p.species = devolvedTarget;
        delete p.morphT;
        delete p.morphOrigSpecies;
        this.events.push({
          k: 'morph',
          id: p.id,
          species: devolvedTarget,
          dur: 0,
        });
      }

      // Morph 30s timer
      if (p.morphT && p.morphT > 0) {
        p.morphT = Math.max(0, p.morphT - DT);
        if (p.morphT <= 0) {
          const orig = p.morphOrigSpecies || 'pig';
          p.species = orig;
          delete p.morphOrigSpecies;
          delete p.morphT;
          this.events.push({ k: 'morph', id: p.id, species: orig, dur: 0 });
        }
      }

      const pr = radiusOf(p.mass) + 1.2;
      for (const t of this.tools.values()) {
        const dist = Math.hypot(t.x - p.x, t.z - p.z);
        if (dist <= pr) {
          this.tools.delete(t.id);
          this.events.push({ k: 'tool', id: p.id, kind: t.kind, x: t.x, z: t.z });
          if (t.kind === 'pitchfork') {
            p.pitchforkT = 10;
            p.pitchforkHits = 3;
          } else if (t.kind === 'dynamite') {
            p.hasDynamite = true;
          } else if (t.kind === 'wheel') {
            p.wheelT = 10;
          } else if (t.kind === 'star') {
            let count = 0;
            for (const m of this.minions.values()) {
              if (m.ownerId === p.id && m.alive) count++;
            }
            // Requirement 3: Max 6 normally, 8 at 1000kg (1 ton), 10 at 3000kg (3 tons) or King
            const maxMinions = p.id === this.napoleonId ? 10 : (p.mass >= 3000 ? 10 : (p.mass >= 1000 ? 8 : 6));
            const spawnCount = Math.min(2, Math.max(0, maxMinions - count));
            for (let i = 0; i < spawnCount; i++) {
              const mid = this.nextMinionId++;
              const offsetAng = (i * Math.PI) + (count * 1.05);
              const mx = p.x + Math.cos(offsetAng) * 2.2;
              const mz = p.z + Math.sin(offsetAng) * 2.2;
              this.minions.set(mid, {
                id: mid,
                ownerId: p.id,
                x: r2(mx),
                z: r2(mz),
                vx: 0,
                vz: 0,
                a: p.a,
                mass: 50,
                species: p.species,
                skin: p.skin,
                targetId: 0,
                alive: true,
                cd: 0,
                orbitAngle: offsetAng,
              });
            }
          } else if (t.kind === 'song') {
            if (this.napoleonId > 0) {
              const nap = this.players.get(this.napoleonId);
              if (nap && nap.alive) {
                nap.slowT = 6.0;
                this.events.push({ k: 'song', id: p.id, nap: this.napoleonId });
              }
            } else {
              this.events.push({ k: 'song', id: p.id, nap: 0 });
            }
          } else if (t.kind === 'banana') {
            if (!p.morphOrigSpecies) {
              p.morphOrigSpecies = p.species;
            }
            const targetSpecies: Species = this.rnd() < 0.5 ? 'monkey' : 'elephant';
            p.species = targetSpecies;
            p.morphT = 30;
            this.events.push({ k: 'morph', id: p.id, species: targetSpecies, dur: 30 });
          } else if (t.kind === 'speed') {
            p.speedT = 20;
          } else if (t.kind === 'shield') {
            p.shieldT = 10;
            p.stunT = 0;
            p.slowT = 0;
            p.squishT = 0;
            p.inWaterT = 0;
          } else if (t.kind === 'heart') {
            p.hasHeart = true;
            this.events.push({ k: 'heartCollect', id: p.id, name: p.name });
          }
          break;
        }
      }
    }

    this.updateMinions(DT, alive);

    // Podium shield & cyclical battle logic
    const [podX, podZ] = this.map.podium;
    const PR = CFG.PODIUM_R;

    if (this.podiumShield) {
      this.podiumContested = false;
      this.podiumProgress = 0;
      this.podiumCaptor = 0;
      this.podiumPhaseTimer = Math.max(0, this.podiumPhaseTimer - DT);
      if (this.podiumPhaseTimer <= 5 && !this.podiumWarned5s) {
        this.podiumWarned5s = true;
        this.events.push({ k: 'podWarn', willShield: false, left: 5 });
      }
      if (this.podiumPhaseTimer <= 0) {
        // 30s elapsed: shield opens! Animals can now enter and fight for King
        this.podiumShield = false;
        this.podiumPhaseTimer = 30;
        this.podiumWarned5s = false;
      }
    } else {
      // Shield is OPEN
      const onPodium = alive.filter((p) => Math.hypot(p.x - podX, p.z - podZ) <= PR);

      if (onPodium.length === 0) {
        this.podiumContested = false;
        this.podiumProgress = Math.max(0, this.podiumProgress - DT * 0.25);
        if (this.podiumProgress === 0) this.podiumCaptor = 0;
      } else if (onPodium.length === 1) {
        const c = onPodium[0];
        this.podiumContested = false;
        if (c.id === this.podiumCaptor) {
          const speed = Math.min(0.25, Math.max(0.08, 0.08 + c.mass / 600));
          this.podiumProgress = Math.min(1.0, this.podiumProgress + speed * DT);
          if (this.podiumProgress >= 1.0 && this.napoleonId !== c.id) {
            if (this.napoleonId > 0) {
              const prevKing = this.players.get(this.napoleonId);
              const dur = Math.round(this.napoleonReign);
              if (dur >= 5 && prevKing) {
                this.hof.push([prevKing.name, prevKing.species, dur]);
                this.hof.sort((a, b) => b[2] - a[2]);
                this.hof = this.hof.slice(0, 3);
              }
            }
            this.napoleonId = c.id;
            this.napoleonReign = 0;
            this.podiumPhaseTimer = 30;
            this.podiumWarned5s = false;
            this.summonKingGuards(c);
            // King capture bonus
            if (c.team !== undefined) {
              this.teamScores[c.team] += 5; // +5 points for team when becoming King
            }
            c.score = (c.score || 0) + 250; // +250 personal score
            this.events.push({ k: 'napoleon', id: c.id });
            this.startKingChoice();
          }
        } else {
          if (this.podiumProgress > 0) {
            this.podiumProgress = Math.max(0, this.podiumProgress - DT * 0.35);
          } else {
            this.podiumCaptor = c.id;
            this.podiumProgress = 0.01;
          }
        }
      } else {
        this.podiumContested = true;
      }

      // Check battle phase countdown if no King is currently crowned
      if (this.napoleonId === 0) {
        this.podiumPhaseTimer = Math.max(0, this.podiumPhaseTimer - DT);
        if (this.podiumPhaseTimer <= 5 && !this.podiumWarned5s) {
          this.podiumWarned5s = true;
          this.events.push({ k: 'podWarn', willShield: true, left: 5 });
        }
        if (this.podiumPhaseTimer <= 0) {
          // 30s elapsed with NO King: blast all animals out & reactivate protective shield
          const blastR = CFG.PODIUM_R + 3.5;
          for (const p of alive) {
            if (!p.alive) continue;
            const dx = p.x - podX, dz = p.z - podZ;
            const dist = Math.hypot(dx, dz);
            if (dist < blastR) {
              const nx = dist > 1e-4 ? dx / dist : Math.cos(this.rnd() * Math.PI * 2);
              const nz = dist > 1e-4 ? dz / dist : Math.sin(this.rnd() * Math.PI * 2);
              p.vx = nx * 38;
              p.vz = nz * 38;
              p.stunT = Math.max(p.stunT, 0.8);
              p.dashT = 0;
              p.plow = false;
              p.charging = false;
              p.holdT = 0;
            }
          }
          this.podiumProgress = 0;
          this.podiumCaptor = 0;
          this.podiumContested = false;
          this.podiumShield = true;
          this.podiumPhaseTimer = 30;
          this.podiumWarned5s = false;
          this.events.push({ k: 'podBlast', x: podX, z: podZ });
        }
      } else {
        // While there is a King, the throne remains open for rivals to challenge
        this.podiumPhaseTimer = 30;
        this.podiumWarned5s = false;
      }
    }

    // Sunday meeting rule: pull non-king animals gently towards podium
    if (this.currentRule === 'sunday' && this.napoleonId > 0 && this.sundayTeleportTimer <= 0) {
      for (const p of alive) {
        if (p.id !== this.napoleonId) {
          const dx = podX - p.x, dz = podZ - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > PR + 1) {
            p.vx += (dx / dist) * 3.5 * DT;
            p.vz += (dz / dist) * 3.5 * DT;
          }
        }
      }
    }

    // Sunday meeting rule: 1.5s freeze countdown with rising light ring, then teleport to podium
    if (this.sundayTeleportTimer > 0) {
      this.sundayTeleportTimer -= DT;
      for (const p of alive) {
        if (p.id !== this.napoleonId) {
          p.vx = 0;
          p.vz = 0;
          p.dashT = 0;
          p.charging = false;
        }
      }
      if (this.sundayTeleportTimer <= 0) {
        this.sundayTeleportTimer = 0;
        const [podX, podZ] = this.map.podium;
        const others = [...this.players.values()].filter((p) => p.alive && p.id !== this.napoleonId);
        const total = others.length;
        for (let i = 0; i < total; i++) {
          const p = others[i];
          const ang = (i / Math.max(1, total)) * Math.PI * 2;
          const dist = 1.8 + (i % 3) * 1.5;
          p.x = podX + Math.cos(ang) * dist;
          p.z = podZ + Math.sin(ang) * dist;
          p.vx = 0;
          p.vz = 0;
          p.dashT = 0;
          p.charging = false;
          p.stunT = 0; // unfreeze on arrival!
        }
        this.events.push({ k: 'podBlast', x: podX, z: podZ });
      }
    }

    // King reign & rule timers
    if (this.napoleonId > 0) {
      this.napoleonReign += DT;
      this.ruleTimer -= DT;
      if (this.ruleTimer <= 0) {
        if (this.currentRule === 'poultry') {
          for (const p of this.players.values()) {
            if (p.origSpecies) {
              p.species = p.origSpecies;
              delete p.origSpecies;
              this.events.push({ k: 'join', ...this.meta(p) });
            }
          }
        }
        if (!this.kingChoice) {
          this.startKingChoice();
        }
      }

      // King rule choice timer: bot king picks after 1.5s, or timeout
      if (this.kingChoice) {
        const king = this.players.get(this.napoleonId);
        const isBotKing = king?.bot ?? false;
        const left = this.kingChoice.expireT - this.time;
        if ((isBotKing && left <= 8.5) || left <= 0) {
          const pick = this.kingChoice.options[Math.floor(this.rnd() * this.kingChoice.options.length)];
          this.applyRule(pick);
        }
      }

      // Tax rule: 2% of weight to king every second (20 ticks)
      if (this.currentRule === 'tax' && this.tick % 20 === 0) {
        const king = this.players.get(this.napoleonId);
        if (king && king.alive) {
          let taxSum = 0;
          for (const p of alive) {
            if (p.id !== this.napoleonId && p.mass > CFG.MIN_MASS + 2) {
              const tax = Math.min(2, p.mass * 0.02);
              p.mass -= tax;
              taxSum += tax;
            }
          }
          king.mass += taxSum;
        }
      }
    }

    // Rule: "equal" (All animals are equal, non-kings converge to 30kg, King boosted to 100kg)
    if (this.currentRule === 'equal') {
      for (const p of alive) {
        if (p.id === this.napoleonId) {
          p.mass = Math.max(p.mass, 100);
        } else if (Math.abs(p.mass - 30) > 0.5) {
          p.mass += (30 - p.mass) * 0.05 * DT;
        }
      }
    }

    // Rule: "till" (Farmer Till returns in his giant tractor, sweeps & hunts, then exits straight into forest)
    if (this.currentRule === 'till') {
      if (!this.tillTruck.active) {
        this.tillTruck.timer -= DT;
        if (this.tillTruck.timer <= 0) {
          // Spawn tractor at perimeter facing inward
          const enterA = this.rnd() * Math.PI * 2;
          const sx = Math.cos(enterA) * (CFG.R - 22);
          const sz = Math.sin(enterA) * (CFG.R - 22);
          const aimA = enterA + Math.PI;
          const speed = 19;
          this.tillTruck.active = true;
          this.tillTruck.exiting = false;
          this.tillTruck.sweepT = 14.0;
          this.tillTruck.x = sx;
          this.tillTruck.z = sz;
          this.tillTruck.vx = Math.cos(aimA) * speed;
          this.tillTruck.vz = Math.sin(aimA) * speed;
          this.tillTruck.angle = aimA;
          this.events.push({ k: 'boom', id: 0, x: r2(sx), z: r2(sz) });
        }
      } else {
        const tx = this.tillTruck.x;
        const tz = this.tillTruck.z;
        const distFromCenter = Math.hypot(tx, tz);

        if (!this.tillTruck.exiting) {
          this.tillTruck.sweepT -= DT;
          if (this.tillTruck.sweepT <= 0) {
            // Sweeping complete! Switch to exiting straight out into the woods
            this.tillTruck.exiting = true;
          }
        }

        let desiredAngle = this.tillTruck.angle;
        let speed = 19;

        if (this.tillTruck.exiting) {
          // Drive straight out across fence into the surrounding forest!
          const exitA = Math.atan2(tz, tx);
          desiredAngle = exitA;
          speed = 24; // Fast exit
        } else {
          // Active sweeping & hunting phase:
          if (distFromCenter > 48) {
            // Near outer electric fence: steer strongly back toward center
            desiredAngle = Math.atan2(-tz, -tx);
          } else {
            // Actively hunt and chase nearest living animal: PRIORITIZE ENEMIES (non-King)
            let bestDist = Infinity;
            let targetP: Player | null = null;
            for (const p of alive) {
              if (p.id === this.napoleonId) continue;
              const d = Math.hypot(p.x - tx, p.z - tz);
              if (d < bestDist) {
                bestDist = d;
                targetP = p;
              }
            }
            if (!targetP) {
              for (const p of alive) {
                const d = Math.hypot(p.x - tx, p.z - tz);
                if (d < bestDist) {
                  bestDist = d;
                  targetP = p;
                }
              }
            }
            if (targetP) {
              desiredAngle = Math.atan2(targetP.z - tz, targetP.x - tx);
            } else {
              desiredAngle = this.tillTruck.angle + 0.4 * DT;
            }
          }
        }

        // Smooth steering with realistic turn rate limit
        let diff = desiredAngle - this.tillTruck.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = (this.tillTruck.exiting ? 2.8 : 2.4) * DT;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
        this.tillTruck.angle += turn;

        this.tillTruck.vx = Math.cos(this.tillTruck.angle) * speed;
        this.tillTruck.vz = Math.sin(this.tillTruck.angle) * speed;
        this.tillTruck.x += this.tillTruck.vx * DT;
        this.tillTruck.z += this.tillTruck.vz * DT;

        const cosA = Math.cos(-this.tillTruck.angle);
        const sinA = Math.sin(-this.tillTruck.angle);

        // Check ram collision with every alive player: INSTANT ELIMINATION (or damage only for shielded)!
        for (const p of alive) {
          if (!p.alive) continue;
          const dx = p.x - this.tillTruck.x;
          const dz = p.z - this.tillTruck.z;
          const rx = dx * cosA - dz * sinA;
          const rz = dx * sinA + dz * cosA;
          const pr = radiusOf(p.mass);
          // Collision box matching giant 2.4x model: front cutter blades (7.0) to rear cab/tires (-4.2)
          if (rx >= -4.2 - pr && rx <= 7.0 + pr && Math.abs(rz) <= 3.3 + pr) {
            if (p.shieldT > 0) {
              if (p.lastHitBy === -999 && (this.time - p.lastHitT) < 0.5) continue;
              p.lastHitBy = -999;
              p.lastHitT = this.time;
              const loss = Math.min(p.mass - 10, Math.max(10, Math.round(p.mass * 0.25)));
              p.mass = Math.max(10, p.mass - loss);
              this.scatter(p.x, p.z, loss, pr + 1.0);
              continue;
            }
            p.squishT = 2.8; // Squished flat pancake!
            p.stunT = 2.0;   // Stunned
            p.charging = false;
            p.dashT = 0;
            p.plow = false;

            // Instantly eliminate: squished flat and killed!
            this.kill(p, 'till');
          }
        }

        // Disappear deep in the surrounding forest outside the fence (CFG.R + 5)
        if (this.tillTruck.exiting && distFromCenter > CFG.R + 5) {
          this.tillTruck.active = false;
          this.tillTruck.exiting = false;
          this.clearRule();
        }
      }
    } else {
      // Rule ended: if tractor was active, drive straight out into forest
      if (this.tillTruck.active) {
        const tx = this.tillTruck.x;
        const tz = this.tillTruck.z;
        const exitA = Math.atan2(tz, tx);
        let diff = exitA - this.tillTruck.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.tillTruck.angle += Math.max(-2.8 * DT, Math.min(2.8 * DT, diff));
        const speed = 24;
        this.tillTruck.vx = Math.cos(this.tillTruck.angle) * speed;
        this.tillTruck.vz = Math.sin(this.tillTruck.angle) * speed;
        this.tillTruck.x += this.tillTruck.vx * DT;
        this.tillTruck.z += this.tillTruck.vz * DT;

        if (Math.hypot(this.tillTruck.x, this.tillTruck.z) > CFG.R + 5) {
          this.tillTruck.active = false;
          this.tillTruck.exiting = false;
        }
      } else {
        this.tillTruck.active = false;
        this.tillTruck.exiting = false;
      }
    }

    // King periodic reign harvest bonus (every 3 seconds)
    if (this.napoleonId > 0 && this.tick % 60 === 0) {
      const king = this.players.get(this.napoleonId);
      if (king && king.alive) {
        king.mass += 2;
        // Spawn golden corn directly on podium
        this.addFood(podX + (this.rnd() - 0.5) * 4, podZ + (this.rnd() - 0.5) * 4, 2, 6);
      }
    }

    for (const p of alive) {
      if (!p.alive) continue;
      // High mass melts slowly
      if (p.mass > CFG.DECAY_START) p.mass -= (p.mass - CFG.DECAY_START) * CFG.DECAY_RATE * DT;
      // Hunger decay: slowly lose kg over time if not eating (grace period 2.5s)
      if (this.time - p.lastEatT > 2.5) {
        p.mass -= 0.35 * DT;
      }
      // Starvation: dies if mass drops below 10kg
      if (p.mass < 10) {
        this.kill(p, 'starve');
        continue;
      }
      if (p.mass > p.best) p.best = p.mass;
    }

    if (this.foodEnabled) {
      for (let i = 0; i < CFG.FOOD_SPAWN_PER_TICK && this.food.size < CFG.FOOD_TARGET; i++) this.spawnFood();
    }

    this.ranked = alive.filter((p) => p.alive).sort((a, b) => b.mass - a.mass);
  }

  /** hold to charge, release to ram */
  private handleButton(p: Player): void {
    if (p.slowT > 0 || p.terrain === 1 || p.stunT > 0) {
      p.pressed = false; p.holdT = 0; p.charging = false; p.btnLatch = false; p.releaseLatch = false;
      return;
    }
    const cdRate = (this.currentRule === 'squealer' && p.id === this.napoleonId) ? 2 : 1;
    p.cd = Math.max(0, p.cd - DT * cdRate);

    // If a release with hold occurred between ticks, it has priority
    if (p.releaseLatch) {
      p.releaseLatch = false;
      p.btnLatch = false;
      if (p.cd <= 0.12 && p.dashT <= 0 && p.stunT <= 0) {
        const savedA = p.input.a;
        p.input.a = p.releaseAimA;
        this.dash(p);
        p.input.a = savedA;
      }
      p.pressed = false;
      p.holdT = 0;
      p.charging = false;
      return;
    }

    const down = (p.input.btn || p.btnLatch) && p.stunT <= 0;
    p.btnLatch = false;
    if (down && p.input.btn) {
      if (p.cd > 0.05 || p.dashT > 0) {
        p.pressed = false; p.holdT = 0; p.charging = false;
      } else {
        p.pressed = true;
        // Under 20kg: cannot charge up to ram
        if (p.mass >= 20) {
          p.holdT = Math.min(CFG.CHARGE_MAX + 0.5, p.holdT + DT);
          p.charging = p.holdT >= CFG.CHARGE_SLOW_AFTER;
        } else {
          p.holdT = 0;
          p.charging = false;
        }
      }
      return;
    }
    // released (or a tap that came and went between two ticks)
    if ((p.pressed || down) && p.cd <= 0.12 && p.dashT <= 0 && p.stunT <= 0) this.dash(p);
    p.pressed = false; p.holdT = 0; p.charging = false;
  }

  dropTreeFruits(tree: TreeSimState, byId: number, dropBig: number, dropSmall: number): void {
    const totalDropped = dropBig + dropSmall;
    if (totalDropped > 0) {
      tree.big = Math.max(0, tree.big - dropBig);
      tree.small = Math.max(0, tree.small - dropSmall);

      for (let i = 0; i < totalDropped; i++) {
        const ang = this.rnd() * Math.PI * 2;
        const dist = tree.r + 1.2 + this.rnd() * 3.5;
        let fx = clamp(tree.x + Math.cos(ang) * dist, -(CFG.R - 2), CFG.R - 2);
        let fz = clamp(tree.z + Math.sin(ang) * dist, -(CFG.R - 2), CFG.R - 2);
        [fx, fz] = this.pushOutsideObstacles(fx, fz, 1.4);
        const fruitWeight = tree.size === 2
          ? 100
          : tree.size === 1
          ? Math.round(20 + this.rnd() * 30)
          : Math.round(5 + this.rnd() * 5);
        this.addFood(fx, fz, 1, fruitWeight);
      }

      tree.batches.push({
        timer: 0,
        count: totalDropped,
        bigCount: dropBig,
        smallCount: dropSmall,
      });
    }

    this.events.push({
      k: 'treeHit',
      id: tree.id,
      by: byId,
      x: r2(tree.x),
      z: r2(tree.z),
      size: tree.size,
      droppedBig: dropBig,
      droppedSmall: dropSmall,
    });
  }

  private dash(p: Player): void {
    if (p.terrain === 1 && p.species !== 'swan' && p.species !== 'pegasus') return;
    if (p.superT > 0) {
      if (p.species === 'monkey' || p.species === 'gorilla') {
        if (p.holdT <= 0.15) {
          // Tap: Continuous cone of 5 giant bananas
          this.spawnBananaCone(p, 5, true);
          p.cd = 0.35;
          return;
        }
        // Charged Rainbow Leap (hold > 0.15s, 0.2s -> 1.2s)
        const isGorilla = (p.species === 'gorilla');
        const clampedHold = Math.max(0.2, Math.min(1.2, p.holdT));
        const ratio = (clampedHold - 0.2) / 1.0;
        const leapDist = isGorilla ? (12.0 + ratio * 20.0) : (10.0 + ratio * 18.0);
        const leapDur = 0.5 + ratio * 0.4;
        const peakHeight = isGorilla ? (5.0 + ratio * 7.5) : (4.5 + ratio * 6.5);

        p.monkeyLeapT = leapDur;
        p.monkeyLeapDur = leapDur;
        p.monkeyLeapHeight = peakHeight;
        p.monkeyLeapRatio = ratio;
      p.monkeyBounced = false;
        p.monkeyBounced = false;
        p.a = p.input.a;
        const leapSpeed = leapDist / leapDur;
        p.vx = Math.cos(p.a) * leapSpeed;
        p.vz = Math.sin(p.a) * leapSpeed;
        p.dashT = leapDur;
        p.cd = CFG.DASH_CD * 0.5;
        this.events.push({
          k: 'monkeyLeap',
          id: p.id,
          x: r2(p.x),
          z: r2(p.z),
          dur: r2(leapDur),
          height: r2(peakHeight),
          ratio: r2(ratio),
          rainbow: true,
          bounce: false,
        });
        return;
      }
      if (p.species === 'mammoth') {
        // Rainbow Mammoth: Bỏ toàn bộ hồi chiêu!
        p.cd = 0;
        p.mammothRoarCd = 0;
        if (p.holdT > 0.15) {
          this.executeMammothRoar(p, true);
          p.cd = 0;
          return;
        }
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 62;
        p.vz = Math.sin(p.a) * 62;
        p.dashT = 0.55;
        p.flyT = 0.55;
        p.plow = true;
        p.power = 5.0;
        p.cd = 0;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'wolf' && p.holdT > 0.15) {
        this.startWolfChargedSkill(p, true);
        return;
      }
      if (p.species === 'phoenix') {
        this.executePhoenixSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'pegasus') {
        this.executePegasusSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'swan') {
        this.executeSwanSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'ram') {
        this.executeRamSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'boar') {
        this.executeBoarSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'bull') {
        this.executeBullSkill(p, true, p.holdT >= 0.75);
        return;
      }
      if (p.species === 'chicken') {
        // Gà Cầu Vồng: Phóng như tên lửa siêu tốc, bay lướt xuyên thấu, cooldown cực nhanh 0.25s
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 74;
        p.vz = Math.sin(p.a) * 74;
        p.dashT = 0.65;
        p.flyT = 0.65;
        p.plow = true;
        p.power = 6.2;
        p.cd = 0.25;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'duck') {
        // Vịt Cầu Vồng: Lốc Xoáy Nước Cầu Vồng bán kính 16m đẩy lùi và quét sạch thức ăn
        const waveR = 16;
        for (const other of this.players.values()) {
          if (!other.alive || other.id === p.id) continue;
          if (Math.hypot(other.x - p.x, other.z - p.z) <= waveR + radiusOf(other.mass)) {
            const pushA = Math.atan2(other.z - p.z, other.x - p.x);
            other.vx += Math.cos(pushA) * 28;
            other.vz += Math.sin(pushA) * 28;
            if (other.shieldT <= 0) other.slowT = Math.max(other.slowT, 1.5);
          }
        }
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 68;
        p.vz = Math.sin(p.a) * 68;
        p.dashT = 0.65;
        p.plow = true;
        p.power = 6.5;
        p.cd = CFG.DASH_CD * 0.4;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'pig') {
        // Heo Cầu Vồng: Cỗ Máy Ủi Kim Cương Mini ủi xuyên qua mọi đối thủ và cướp 10% mass
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 68;
        p.vz = Math.sin(p.a) * 68;
        p.dashT = 0.65;
        p.flyT = 0.65;
        p.plow = true;
        p.power = 7.0;
        p.cd = CFG.DASH_CD * 0.45;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'sheep') {
        // Cừu Cầu Vồng: Sóng Xung Kích Bông Lông Vàng bán kính 14m choáng 1.0s
        const shockR = 14;
        for (const other of this.players.values()) {
          if (!other.alive || other.id === p.id) continue;
          if (Math.hypot(other.x - p.x, other.z - p.z) <= shockR + radiusOf(other.mass)) {
            const shockA = Math.atan2(other.z - p.z, other.x - p.x);
            other.vx += Math.cos(shockA) * 26;
            other.vz += Math.sin(shockA) * 26;
            if (other.shieldT <= 0) other.stunT = Math.max(other.stunT, 1.0);
          }
        }
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 68;
        p.vz = Math.sin(p.a) * 68;
        p.dashT = 0.62;
        p.flyT = 0.62;
        p.plow = true;
        p.power = 7.0;
        p.cd = CFG.DASH_CD * 0.5;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'horse') {
        // Ngựa Cầu Vồng: Chiến Mã Thần Tốc phi nước đại x2 cự ly, tốc độ 74 m/s
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 74;
        p.vz = Math.sin(p.a) * 74;
        p.dashT = 0.75;
        p.flyT = 0.75;
        p.plow = true;
        p.power = 7.0;
        p.cd = CFG.DASH_CD * 0.45;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      if (p.species === 'cow') {
        // Bò Cầu Vồng: Đại Địa Chấn bán kính 16m choáng 1.2s và hút 10% mass
        const stompR = 16;
        for (const other of this.players.values()) {
          if (!other.alive || other.id === p.id) continue;
          if (Math.hypot(other.x - p.x, other.z - p.z) <= stompR + radiusOf(other.mass)) {
            if (other.shieldT <= 0) {
              other.stunT = Math.max(other.stunT, 1.2);
              const siphon = Math.min(other.mass - 10, Math.round(other.mass * 0.10));
              if (siphon > 0) {
                other.mass -= siphon;
                p.mass += siphon;
              }
            }
          }
        }
        p.a = p.input.a;
        p.vx = Math.cos(p.a) * 68;
        p.vz = Math.sin(p.a) * 68;
        p.dashT = 0.65;
        p.flyT = 0.65;
        p.plow = true;
        p.power = 7.2;
        p.cd = CFG.DASH_CD * 0.5;
        p.dashHit.clear();
        this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
        return;
      }
      p.a = p.input.a;
      p.vx = Math.cos(p.a) * 62;
      p.vz = Math.sin(p.a) * 62;
      p.dashT = 0.55;
      p.flyT = 0.55;
      p.plow = true;
      p.power = 5.0;
      p.cd = CFG.DASH_CD;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
      return;
    }

    if (p.species === 'monkey' || p.species === 'gorilla') {
      // Tap ram (hold <= 0.15): tree shake if near tree, or throw banana
      if (p.holdT <= 0.15) {
        const bodyR = radiusOf(p.mass);
        let nearbyTree: TreeSimState | null = null;
        let minD = bodyR + 2.5;
        for (const t of this.treeSims) {
          const d = Math.hypot(p.x - t.x, p.z - t.z);
          if (d <= t.r + minD) {
            nearbyTree = t;
            minD = d - t.r;
          }
        }

        // Tree shaking requirements:
        // Cây nhỏ (size 0): 100 kg
        // Cây vừa (size 1): 500 kg
        // Cây to (size 2): 1000 kg
        // Gorilla (>= 3000 kg) luôn đủ điều kiện
        const reqMass = nearbyTree ? (nearbyTree.size === 2 ? 1000 : nearbyTree.size === 1 ? 500 : 100) : 0;
        const canShakeTree = nearbyTree && nearbyTree.big > 0 && (p.species === 'gorilla' || p.mass >= reqMass);

        if (canShakeTree && nearbyTree) {
          if (p.species === 'gorilla') {
            // Gorilla Tree Shake: Rung liên tục trong 3s, rớt toàn bộ trái cây (mỗi giây rớt 1/3, giây 3 rớt sạch)
            p.treeShakeT = 3.0;
            p.treeShakeTreeId = nearbyTree.id;
            p.treeShakeTimer = 3.0;
            p.treeShakeDropStage = 1; // Stage 1 drops 1/3 immediately
            p.a = Math.atan2(nearbyTree.z - p.z, nearbyTree.x - p.x);
            p.cd = 3.2;
            p.stunT = 0; // Immune to stun!
            nearbyTree.cooldownHit = 3.0;

            const dropBig = Math.ceil(nearbyTree.big / 3);
            const dropSmall = Math.ceil(nearbyTree.small / 3);
            this.dropTreeFruits(nearbyTree, p.id, dropBig, dropSmall);
            return;
          } else {
            // Monkey Tree Shake (2 hands grip and shake 1 time!)
            p.treeShakeT = 0.5;
            p.a = Math.atan2(nearbyTree.z - p.z, nearbyTree.x - p.x);
            p.cd = 0.6;
            p.stunT = 0; // Immune to stun!
            nearbyTree.cooldownHit = 0.5;

            const dropBig = Math.ceil(nearbyTree.big / 3);
            const dropSmall = Math.ceil(nearbyTree.small / 3);
            this.dropTreeFruits(nearbyTree, p.id, dropBig, dropSmall);
            return;
          }
        } else {
          // Throw 1 banana projectile (when not near tree, tree has no ripe fruits, or not enough mass)
          p.a = p.input.a;
          this.spawnBananaCone(p, 1, false);
          p.cd = 0.5;
          return;
        }
      }

      // Charged Leap (hold > 0.15s, 0.2s -> 1.2s)
      const isGorilla = (p.species === 'gorilla');
      const clampedHold = Math.max(0.2, Math.min(1.2, p.holdT));
      const ratio = (clampedHold - 0.2) / 1.0;
      const leapDist = isGorilla ? (10.0 + ratio * 16.0) : (8.0 + ratio * 14.0);
      const leapDur = 0.5 + ratio * 0.4;
      const peakHeight = isGorilla ? (4.0 + ratio * 6.5) : (3.5 + ratio * 5.5);

      p.monkeyLeapT = leapDur;
      p.monkeyLeapDur = leapDur;
      p.monkeyLeapHeight = peakHeight;
      p.monkeyLeapRatio = ratio;
      p.monkeyBounced = false;
      p.a = p.input.a;
      const leapSpeed = leapDist / leapDur;
      p.vx = Math.cos(p.a) * leapSpeed;
      p.vz = Math.sin(p.a) * leapSpeed;
      p.dashT = leapDur;
      p.cd = CFG.DASH_CD + ratio * 0.5;
      this.events.push({
        k: 'monkeyLeap',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        dur: r2(leapDur),
        height: r2(peakHeight),
        ratio: r2(ratio),
        bounce: false,
      });
      return;
    }

    if (p.species === 'mammoth') {
      // Mammoth:
      // Húc nhẹ (holdT <= 0.15s): lướt giống các con khác, gây dẹp lép và kill < 100kg trong this.hit
      // Gồng (holdT > 0.15s): sóng âm tại chỗ, khuếch tán 1/4 bản đồ (~35m), choáng 0.5s - 1.5s, hồi chiêu gồng 3s
      if (p.holdT > 0.15) {
        if (!p.mammothRoarCd || p.mammothRoarCd <= 0) {
          this.executeMammothRoar(p, false);
          return;
        }
      }
    }

    if (p.species === 'wolf' && p.holdT > 0.15) {
      this.startWolfChargedSkill(p, false);
      return;
    }

    if (p.species === 'phoenix' && p.holdT > 0.15) {
      this.executePhoenixSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'swan' && p.holdT > 0.15) {
      this.executeSwanSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'pegasus' && p.holdT > 0.15) {
      this.executePegasusSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'bull' && p.holdT > 0.15) {
      this.executeBullSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'ram' && p.holdT > 0.15) {
      this.executeRamSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'boar' && p.holdT > 0.15) {
      this.executeBoarSkill(p, false, p.holdT >= 0.75);
      return;
    }

    if (p.species === 'chicken' && p.holdT > 0.15) {
      // Gà Gồng: Vỗ Cánh Lướt Gió - Cooldown siêu ngắn 0.45x, lướt nhanh dứt khoát
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const flySpeed = 44 * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * flySpeed;
      p.vz = Math.sin(p.a) * flySpeed;
      p.dashT = 0.38 + 0.12 * c;
      p.flyT = p.dashT;
      p.plow = true;
      p.power = 2.4;
      p.cd = CFG.DASH_CD * 0.45;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
      return;
    }

    if (p.species === 'duck' && p.holdT > 0.15) {
      // Vịt Gồng: Lướt Sóng Nước - Tạo sóng đẩy lùi 8m và miễn nhiễm bùn
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const waveR = 8 + c * 4;
      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id) continue;
        const d = Math.hypot(other.x - p.x, other.z - p.z);
        if (d <= waveR + radiusOf(other.mass)) {
          const pushA = Math.atan2(other.z - p.z, other.x - p.x);
          other.vx += Math.cos(pushA) * 16;
          other.vz += Math.sin(pushA) * 16;
        }
      }
      const speed = 40 * (1 + 0.32 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.42 + 0.15 * c;
      p.plow = true;
      p.power = 2.6;
      p.cd = CFG.DASH_CD * 0.55;
      p.dashHit.clear();
      return;
    }

    if (p.species === 'pig' && p.holdT > 0.15) {
      // Heo Gồng: Heo Ủi Bùn Đất - Knockback cực nặng, cướp thêm thức ăn
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const speed = 40 * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.42 + 0.18 * c;
      p.plow = true;
      p.power = 3.6;
      p.cd = CFG.DASH_CD * 0.65;
      p.dashHit.clear();
      return;
    }

    if (p.species === 'sheep' && p.holdT > 0.15) {
      // Cừu Gồng: Thiết Đầu Công Lông Xù - Khiên phản chấn và hất văng
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const speed = 41 * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.40 + 0.18 * c;
      p.plow = true;
      p.power = 3.8;
      p.cd = CFG.DASH_CD * 0.60;
      p.dashHit.clear();
      return;
    }

    if (p.species === 'horse' && p.holdT > 0.15) {
      // Ngựa Gồng: Vó Ngựa Phi Nước Đại - Cự ly lướt dài hơn 35%, bứt tốc đạp văng đối thủ
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const speed = 44 * (1 + 0.40 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.52 + 0.20 * c;
      p.flyT = p.dashT * 0.6;
      p.plow = true;
      p.power = 3.2;
      p.cd = CFG.DASH_CD * 0.60;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
      return;
    }

    if (p.species === 'cow' && p.holdT > 0.15) {
      // Bò Gồng: Sừng Bò Hất Tung - Gây choáng nhẹ và hất văng
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      p.a = p.input.a;
      const speed = 41 * (1 + 0.38 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.42 + 0.18 * c;
      p.plow = true;
      p.power = 3.8;
      p.cd = CFG.DASH_CD * 0.70;
      p.dashHit.clear();
      return;
    }

    const d = dashParams(p.species, p.holdT, p.terrain);
    p.a = p.input.a;
    p.vx = Math.cos(p.a) * d.speed;
    p.vz = Math.sin(p.a) * d.speed;
    p.dashT = d.time;
    p.plow = d.plow;
    p.power = d.power;
    const isPhoenix = p.species === 'phoenix';
    const isChicken = p.species === 'chicken';
    const baseCd = isPhoenix ? CFG.DASH_CD * 0.5 : isChicken ? CFG.DASH_CD * 0.65 : CFG.DASH_CD;
    p.cd = baseCd + (d.plow ? CFG.PLOW_CD * (isPhoenix ? 0.5 : isChicken ? 0.65 : 1) : 0);
    p.dashHit.clear();
  }

  private executeMammothRoar(p: Player, isRainbow: boolean): void {
    const clampedHold = Math.max(0.2, Math.min(1.2, p.holdT));
    const ratio = (clampedHold - 0.2) / 1.0;
    p.vx = 0;
    p.vz = 0;
    p.dashT = 0;
    p.plow = false;
    p.mammothRoarT = 1.0;
    // Hồi chiêu gồng 3s nhưng chiêu húc nhẹ vẫn hồi nhanh bình thường (~0.8s); bỏ hồi chiêu khi có cầu vồng
    p.mammothRoarCd = isRainbow ? 0 : 3.0;
    p.cd = isRainbow ? 0 : CFG.DASH_CD;

    if (isRainbow) {
      // Siêu cầu vồng: toàn bộ bản đồ, choáng max 3s (1.0s đến 3.0s tuỳ thời gian gồng)
      const stunDur = 1.0 + ratio * 2.0;
      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0) continue;
        other.stunT = Math.max(other.stunT, stunDur);
        other.dashT = 0;
        other.charging = false;
        other.plow = false;
        if (other.monkeyLeapT) other.monkeyLeapT = 0;
        other.vx *= 0.2;
        other.vz *= 0.2;
      }
      this.events.push({
        k: 'mammothRoar',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        r: r2(CFG.R * 2),
        dur: r2(stunDur),
        rainbow: true,
      });
    } else {
      // Sóng âm thường: 1/4 bản đồ tính từ tâm (bán kính 35m), choáng 0.5s đến 1.5s
      const stunDur = 0.5 + ratio * 1.0;
      const roarR = 35.0;
      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0) continue;
        const d = Math.hypot(other.x - p.x, other.z - p.z);
        if (d <= roarR) {
          other.stunT = Math.max(other.stunT, stunDur);
          other.dashT = 0;
          other.charging = false;
          other.plow = false;
          if (other.monkeyLeapT) other.monkeyLeapT = 0;
          other.vx *= 0.2;
          other.vz *= 0.2;
        }
      }
      this.events.push({
        k: 'mammothRoar',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        r: r2(roarR),
        dur: r2(stunDur),
        rainbow: false,
      });
    }
  }

  private executePhoenixSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      const len = isRainbow ? 38 : 24;
      const w = isRainbow ? 14 : 8;
      p.flyT = 1.2;
      p.dashT = 0.8;
      p.plow = true;
      p.power = isRainbow ? 6.5 : 4.5;
      const flySpeed = isRainbow ? 60 : 48;
      p.vx = Math.cos(p.a) * flySpeed;
      p.vz = Math.sin(p.a) * flySpeed;
      p.cd = CFG.DASH_CD * 0.5;
      p.dashHit.clear();

      const cosA = Math.cos(p.a);
      const sinA = Math.sin(p.a);

      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const forwardDist = dx * cosA + dz * sinA;
        const lateralDist = Math.abs(-dx * sinA + dz * cosA);
        const rOther = radiusOf(other.mass);

        if (forwardDist >= -1 && forwardDist <= len + rOther && lateralDist <= w / 2 + rOther) {
          if (other.mass <= 100) {
            this.kill(other, 'fire');
          } else {
            other.burnT = 3.0;
            other.burnDmgTimer = 0.5;
            other.slowT = Math.max(other.slowT, 1.5);
            this.events.push({ k: 'burn', id: other.id, dur: 3.0 });
          }
        }
      }

      this.events.push({
        k: 'phoenixFire',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        a: r2(p.a),
        len,
        w,
        rainbow: isRainbow,
      });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const flySpeed = (isRainbow ? 72 : 46) * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * flySpeed;
      p.vz = Math.sin(p.a) * flySpeed;
      p.dashT = isRainbow ? 0.70 : 0.55;
      p.flyT = isRainbow ? 0.70 : 0.55;
      p.plow = true;
      p.power = isRainbow ? 7.5 : 3.6;
      p.cd = CFG.DASH_CD * 0.5;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
    }
  }

  private executeRamSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const speed = (isRainbow ? 76 : 52) * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = isRainbow ? 0.70 : 0.50;
      p.plow = true;
      p.power = isRainbow ? 9.5 : 6.0;
      p.cd = CFG.DASH_CD * 0.5;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const speed = (isRainbow ? 68 : 45) * (1 + 0.45 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.40 + 0.22 * c;
      p.plow = true;
      p.power = isRainbow ? 7.0 : 4.6;
      p.cd = CFG.DASH_CD * 0.6;
      p.dashHit.clear();
    }
  }

  private executeSwanSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      p.flightT = 10.0;
      p.flyT = 10.0;
      p.cd = 0.5;
      p.swanIceTimer = isRainbow ? 1.0 : 0;
      p.vx = Math.cos(p.a) * 36;
      p.vz = Math.sin(p.a) * 36;
      p.dashT = 0.6;
      p.plow = true;
      p.power = isRainbow ? 5.5 : 3.5;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const inWater = p.terrain === 1;
      const speed = (inWater ? 48 : 42) * (1 + 0.3 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.50;
      p.flyT = 0.50;
      p.plow = true;
      p.power = isRainbow ? 6.5 : 3.2;
      p.cd = CFG.DASH_CD * 0.5;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });

      // Swan tidal wave in front pushes and slows rivals
      const waveR = 12;
      const cosA = Math.cos(p.a);
      const sinA = Math.sin(p.a);
      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= waveR + radiusOf(other.mass)) {
          const forwardDist = dx * cosA + dz * sinA;
          if (forwardDist > 0) {
            other.vx += cosA * 18;
            other.vz += sinA * 18;
            other.slowT = Math.max(other.slowT, 1.5);
          }
        }
      }
    }
  }

  private executeBoarSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      const range = isRainbow ? 24 : 18;
      const boulderR = isRainbow ? 6.0 : 3.5;
      const cosA = Math.cos(p.a);
      const sinA = Math.sin(p.a);

      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const forwardDist = dx * cosA + dz * sinA;
        const lateralDist = Math.abs(-dx * sinA + dz * cosA);
        const rOther = radiusOf(other.mass);

        if (forwardDist >= 0 && forwardDist <= range + rOther && lateralDist <= boulderR + rOther) {
          if (isRainbow) {
            other.stunT = Math.max(other.stunT, 3.0);
            other.vx = 0;
            other.vz = 0;
            const loss = Math.min(other.mass - 10, Math.round(other.mass * 0.12));
            if (loss > 0) {
              other.mass -= loss;
              this.scatter(other.x, other.z, loss, rOther + 0.5);
            }
          } else {
            other.slowT = Math.max(other.slowT, 2.5);
            const loss = Math.min(other.mass - 10, Math.round(other.mass * 0.08));
            if (loss > 0) {
              other.mass -= loss;
              this.scatter(other.x, other.z, loss, rOther + 0.5);
            }
          }
        }
      }

      p.vx = Math.cos(p.a) * (isRainbow ? 55 : 42);
      p.vz = Math.sin(p.a) * (isRainbow ? 55 : 42);
      p.dashT = 0.45;
      p.plow = true;
      p.power = isRainbow ? 6.5 : 4.2;
      p.cd = CFG.DASH_CD * 0.6;
      p.dashHit.clear();

      this.events.push({
        k: 'boarMud',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        a: r2(p.a),
        r: boulderR,
        giant: isRainbow,
        rainbow: isRainbow,
      });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const speed = (isRainbow ? 65 : 44) * (1 + 0.4 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.42 + 0.2 * c;
      p.plow = true;
      p.power = isRainbow ? 7.0 : 4.2;
      p.cd = CFG.DASH_CD * 0.6;
      p.dashHit.clear();
    }
  }

  private executePegasusSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      p.flightT = 10.0;
      p.flyT = 10.0;
      p.cd = 0.5;
      p.pegasusCandyCount = 0;
      p.pegasusCandyTimer = isRainbow ? 1.0 : 0;
      p.vx = Math.cos(p.a) * 40;
      p.vz = Math.sin(p.a) * 40;
      p.dashT = 0.6;
      p.plow = true;
      p.power = isRainbow ? 6.0 : 3.8;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const flySpeed = (isRainbow ? 72 : 48) * (1 + 0.35 * c);
      p.vx = Math.cos(p.a) * flySpeed;
      p.vz = Math.sin(p.a) * flySpeed;
      p.dashT = 0.65;
      p.flyT = 0.65;
      p.plow = true;
      p.power = isRainbow ? 7.0 : 3.4;
      p.cd = CFG.DASH_CD * 0.5;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
    }
  }

  private executeBullSkill(p: Player, isRainbow: boolean, isMax: boolean): void {
    p.a = p.input.a;
    if (isMax) {
      const tossR = isRainbow ? 16 : 10;
      const tossAngleMax = isRainbow ? Math.PI * 0.55 : Math.PI * 0.28;
      const hitIds: number[] = [];

      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const dist = Math.hypot(dx, dz);
        const rOther = radiusOf(other.mass);
        if (dist <= tossR + rOther) {
          const angleToEnemy = Math.atan2(dz, dx);
          const angleDiff = Math.abs(wrapAngle(angleToEnemy - p.a));
          if (angleDiff <= tossAngleMax) {
            other.tossT = 1.2;
            other.stunT = Math.max(other.stunT, 1.8);
            other.vx = Math.cos(angleToEnemy) * (isRainbow ? 28 : 16);
            other.vz = Math.sin(angleToEnemy) * (isRainbow ? 28 : 16);
            hitIds.push(other.id);
            if (!isRainbow) break;
          }
        }
      }

      p.vx = Math.cos(p.a) * (isRainbow ? 60 : 45);
      p.vz = Math.sin(p.a) * (isRainbow ? 60 : 45);
      p.dashT = 0.50;
      p.plow = true;
      p.power = isRainbow ? 7.5 : 4.5;
      p.cd = CFG.DASH_CD * 0.6;
      p.dashHit.clear();

      this.events.push({
        k: 'bullToss',
        id: p.id,
        targetIds: hitIds,
        x: r2(p.x),
        z: r2(p.z),
        r: tossR,
        rainbow: isRainbow,
      });
    } else {
      const c = clamp((p.holdT - 0.2) / 1.0, 0, 1);
      const speed = (isRainbow ? 68 : 44) * (1 + 0.45 * c);
      p.vx = Math.cos(p.a) * speed;
      p.vz = Math.sin(p.a) * speed;
      p.dashT = 0.42 + 0.2 * c;
      p.plow = true;
      p.power = isRainbow ? 7.0 : 3.8;
      p.cd = CFG.DASH_CD + 0.2;
      p.dashHit.clear();

      // Bull ground stomp tremor in 10m radius: stuns and siphons mass
      const stompR = 10;
      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id || other.shieldT > 0 || other.adminGod) continue;
        if (Math.hypot(other.x - p.x, other.z - p.z) <= stompR + radiusOf(other.mass)) {
          other.stunT = Math.max(other.stunT, 1.0);
          const siphon = Math.min(other.mass - 10, Math.round(other.mass * 0.05));
          if (siphon > 0) {
            other.mass -= siphon;
            p.mass += siphon;
          }
        }
      }
    }
  }

  private clampSafeArenaPos(x: number, z: number, r: number): [number, number] {
    let nx = x;
    let nz = z;
    const maxR = CFG.R - r - 1.8;
    const d = Math.hypot(nx, nz);
    if (d > maxR && d > 1e-6) {
      nx = (nx / d) * maxR;
      nz = (nz / d) * maxR;
    }
    for (const [wx, wz, wr] of this.map.well || []) {
      const dw = Math.hypot(nx - wx, nz - wz);
      const minW = wr + r + 1.2;
      if (dw < minW) {
        const ang = dw > 1e-4 ? Math.atan2(nz - wz, nx - wx) : 0;
        nx = wx + Math.cos(ang) * minW;
        nz = wz + Math.sin(ang) * minW;
      }
    }
    for (const [fx, fz, fr] of this.map.fire || []) {
      const df = Math.hypot(nx - fx, nz - fz);
      const minF = fr + r + 1.2;
      if (df < minF) {
        const ang = df > 1e-4 ? Math.atan2(nz - fz, nx - fx) : 0;
        nx = fx + Math.cos(ang) * minF;
        nz = fz + Math.sin(ang) * minF;
      }
    }
    return [nx, nz];
  }

  private startWolfChargedSkill(p: Player, isRainbow: boolean): void {
    const clampedHold = Math.max(0.2, Math.min(1.2, p.holdT));
    const ratio = (clampedHold - 0.2) / 1.0;
    p.a = p.input.a;
    p.wolfRatio = ratio;
    p.dashHit.clear();
    const rWolf = radiusOf(p.mass);
    const cosA = Math.cos(p.a);
    const sinA = Math.sin(p.a);

    if (isRainbow) {
      // Rainbow Charged Skill:
      // Phải có ít nhất 1 mục tiêu nằm trong vùng húc phía trước (tính theo kích thước con vật) mới kích hoạt chuỗi tốc biến
      let primaryTarget: Player | null = null;
      let primaryScore = Infinity;

      for (const other of this.players.values()) {
        if (!other.alive || other.id === p.id) continue;
        if (p.team !== undefined && other.team !== undefined && p.team === other.team) continue;
        const rOther = radiusOf(other.mass);
        const rSum = rWolf + rOther;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const forward = dx * cosA + dz * sinA;
        const lateral = Math.abs(-dx * sinA + dz * cosA);
        const maxDist = rSum * 2.8 + ratio * (rSum * 2.0 + 6.0);
        const maxLateral = rSum * 1.05;
        const dist = Math.hypot(dx, dz);
        const inStrikeZone = (forward > 0 && forward <= maxDist && lateral <= maxLateral) || dist <= rSum * 1.35;
        if (inStrikeZone) {
          const score = dist + lateral * 2.5;
          if (score < primaryScore) {
            primaryScore = score;
            primaryTarget = other;
          }
        }
      }

      if (primaryTarget) {
        const anchorX = primaryTarget.x;
        const anchorZ = primaryTarget.z;
        p.wolfAnchorX = anchorX;
        p.wolfAnchorZ = anchorZ;

        // Vùng cắn giới hạn chuẩn xác 1/8 bản đồ tính từ tâm con vật đầu tiên (bản đồ đường kính 210, 1/8 = 26.25m)
        const ZONE_R = 30.0; // Bán kính 1/8 bản đồ quanh tâm con vật đầu tiên

        // Lọc tất cả mục tiêu hợp lệ nằm trong vùng bán kính 1/8 bản đồ quanh mục tiêu đầu tiên
        const inZoneTargets: Player[] = [];
        for (const other of this.players.values()) {
          if (!other.alive || other.id === p.id) continue;
          if (p.team !== undefined && other.team !== undefined && p.team === other.team) continue;
          const d = Math.hypot(other.x - anchorX, other.z - anchorZ);
          if (d <= ZONE_R) {
            inZoneTargets.push(other);
          }
        }
        if (!inZoneTargets.some((t) => t.id === primaryTarget!.id)) {
          inZoneTargets.unshift(primaryTarget);
        }
        // Sắp xếp các mục tiêu theo khoảng cách tới anchor
        inZoneTargets.sort((a, b) => Math.hypot(a.x - anchorX, a.z - anchorZ) - Math.hypot(b.x - anchorX, b.z - anchorZ));

        // Cắn liên tiếp 6 nhát: nếu không đủ 6 con hoặc mục tiêu quá xa thì cắn luân phiên các mục tiêu trong vùng
        const totalBites = 6;
        const targets: number[] = [];
        for (let i = 0; i < totalBites; i++) {
          targets.push(inZoneTargets[i % inZoneTargets.length].id);
        }

        p.wolfChainTargets = targets;
        p.wolfChainRainbow = true;
        p.wolfBiteTotal = targets.length;
        p.wolfBiteStep = 0;
        p.wolfFrenzyT = targets.length * 0.3;
        p.wolfBiteTimer = 0;
        p.wolfLungeT = 0;
        p.dashT = 0;
        p.cd = 0.6;
        this.stepWolfFrenzy(p, 0);
      } else {
        // Không có con vật nào trong vùng húc -> lướt nhanh về phía trước bình thường
        const lungeDur = 0.32 + ratio * 0.14;
        const lungeSpeed = 54;
        p.vx = cosA * lungeSpeed;
        p.vz = sinA * lungeSpeed;
        p.dashT = lungeDur;
        p.flyT = lungeDur;
        p.plow = true;
        p.power = 3.5;
        p.cd = 0.5;
      }
      return;
    }

    // Normal Charged Skill (không có cầu vồng):
    // Thu hẹp vùng đủ điều kiện kích hoạt: chỉ bắt mục tiêu khi nằm trong hướng húc phía trước,
    // phạm vi và độ lệch ngang tỷ lệ thuận chặt chẽ với kích thước của hai con vật!
    const totalBites = 3 + Math.round(ratio * 3); // 3 đến 6 nhát cắn liên hồi quanh mục tiêu
    let bestTarget: Player | null = null;
    let bestScore = Infinity;

    for (const other of this.players.values()) {
      if (!other.alive || other.id === p.id) continue;
      if (p.team !== undefined && other.team !== undefined && p.team === other.team) continue;
      const rOther = radiusOf(other.mass);
      const rSum = rWolf + rOther;
      const dx = other.x - p.x;
      const dz = other.z - p.z;
      const forward = dx * cosA + dz * sinA;
      const lateral = Math.abs(-dx * sinA + dz * cosA);
      const maxDist = rSum * 2.2 + ratio * (rSum * 1.8 + 4.0);
      const maxLateral = rSum * 0.92;
      const dist = Math.hypot(dx, dz);
      const inStrikeZone = (forward > 0 && forward <= maxDist && lateral <= maxLateral) || dist <= rSum * 1.25;

      if (inStrikeZone) {
        const score = dist + lateral * 3.0;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = other;
        }
      }
    }

    p.wolfChainRainbow = false;
    p.wolfChainTargets = undefined;
    p.wolfBitesLeft = totalBites;
    p.wolfBiteTotal = totalBites;
    p.wolfBiteStep = 0;

    if (bestTarget) {
      p.wolfTargetId = bestTarget.id;
      const gap = Math.hypot(bestTarget.x - p.x, bestTarget.z - p.z) - radiusOf(p.mass) - radiusOf(bestTarget.mass);
      if (gap > 2.0) {
        const lungeSpeed = 52;
        const lungeDur = clamp(gap / lungeSpeed, 0.05, 0.35);
        const aimA = Math.atan2(bestTarget.z - p.z, bestTarget.x - p.x);
        p.a = aimA;
        p.vx = Math.cos(aimA) * lungeSpeed;
        p.vz = Math.sin(aimA) * lungeSpeed;
        p.dashT = lungeDur;
        p.wolfLungeT = lungeDur;
        p.wolfFrenzyT = lungeDur + totalBites * 0.15;
        p.cd = CFG.DASH_CD + ratio * 0.4;
      } else {
        p.wolfLungeT = 0;
        p.dashT = 0;
        p.wolfFrenzyT = totalBites * 0.15;
        p.wolfBiteTimer = 0;
        p.cd = CFG.DASH_CD + ratio * 0.4;
        this.stepWolfFrenzy(p, 0);
      }
    } else {
      // Húc hụt hoặc không có con vật phía trước -> chỉ lướt thường, không tự động bám skill
      const lungeSpeed = 46 + ratio * 12;
      const lungeDur = 0.26 + ratio * 0.14;
      p.wolfTargetId = undefined;
      p.vx = cosA * lungeSpeed;
      p.vz = sinA * lungeSpeed;
      p.dashT = lungeDur;
      p.wolfLungeT = lungeDur;
      p.wolfFrenzyT = lungeDur;
      p.cd = CFG.DASH_CD + ratio * 0.4;
    }
  }

  private stepWolfFrenzy(p: Player, dt: number): void {
    if (!p.alive || p.species !== 'wolf') {
      p.wolfFrenzyT = 0;
      p.wolfLungeT = 0;
      p.wolfBitesLeft = 0;
      p.wolfTargetId = undefined;
      p.wolfChainTargets = undefined;
      return;
    }

    // Giai đoạn 1: Đang lướt nhanh tiếp cận mục tiêu
    if (p.wolfLungeT && p.wolfLungeT > 0) {
      p.wolfLungeT = Math.max(0, p.wolfLungeT - dt);
      const rWolf = radiusOf(p.mass);

      if (p.wolfTargetId) {
        const vic = this.players.get(p.wolfTargetId);
        if (vic && vic.alive) {
          const dx = vic.x - p.x;
          const dz = vic.z - p.z;
          const dist = Math.hypot(dx, dz);
          const aimA = Math.atan2(dz, dx);
          p.a = aimA;
          p.vx = Math.cos(aimA) * 52;
          p.vz = Math.sin(aimA) * 52;
          if (dist <= rWolf + radiusOf(vic.mass) + 2.4 || p.wolfLungeT <= 0) {
            p.wolfLungeT = 0;
            p.dashT = 0;
            p.wolfFrenzyT = (p.wolfBitesLeft || 3) * 0.15;
            p.wolfBiteTimer = 0;
          }
        } else {
          p.wolfTargetId = undefined;
        }
      }

      if (!p.wolfTargetId) {
        // Quét xem có chạm gần con vật nào trên đường lướt không
        for (const other of this.players.values()) {
          if (!other.alive || other.id === p.id) continue;
          if (p.team !== undefined && other.team !== undefined && p.team === other.team) continue;
          const d = Math.hypot(other.x - p.x, other.z - p.z);
          if (d <= rWolf + radiusOf(other.mass)) {
            p.wolfTargetId = other.id;
            p.wolfLungeT = 0;
            p.dashT = 0;
            p.wolfFrenzyT = (p.wolfBitesLeft || 3) * 0.15;
            p.wolfBiteTimer = 0;
            break;
          }
        }
      }

      if (p.wolfLungeT <= 0 && !p.wolfTargetId) {
        p.wolfBitesLeft = 0;
        p.wolfFrenzyT = 0;
        return;
      }
      if (p.wolfLungeT > 0) return;
    }

    // Giai đoạn 2: Thực thi chuỗi cắn
    if (dt > 0 && p.wolfFrenzyT && p.wolfFrenzyT > 0) {
      p.wolfFrenzyT = Math.max(0, p.wolfFrenzyT - dt);
    }
    p.wolfBiteTimer = (p.wolfBiteTimer ?? 0) - dt;
    if (p.wolfBiteTimer > 1e-6) return;

    // 2A. Tuyệt kỹ Cầu Vồng: Biến ảnh liên hoàn qua tối đa 6 con vật khác nhau (0.3s / con, max 1.8s)
    if (p.wolfChainRainbow && p.wolfChainTargets && p.wolfChainTargets.length > 0) {
      let vic: Player | undefined;
      while ((p.wolfBiteStep ?? 0) < p.wolfChainTargets.length) {
        const candId = p.wolfChainTargets[p.wolfBiteStep ?? 0];
        p.wolfBiteStep = (p.wolfBiteStep ?? 0) + 1;
        const cand = this.players.get(candId);
        if (cand && cand.alive) {
          vic = cand;
          break;
        }
      }

      if (!vic) {
        p.wolfChainTargets = undefined;
        p.wolfFrenzyT = 0;
        return;
      }

      p.wolfBiteTimer = 0.30; // Cắn mỗi con trong vòng 0.3s
      const fromX = p.x;
      const fromZ = p.z;
      const rWolf = radiusOf(p.mass);
      const rVic = radiusOf(vic.mass);
      const stepNum = p.wolfBiteStep ?? 1;
      const strikeAng = Math.atan2(fromZ - vic.z, fromX - vic.x) + (stepNum % 2 === 0 ? 0.85 : -0.85);
      const strikeDist = (rWolf + rVic) * 0.82;
      const [nx, nz] = this.clampSafeArenaPos(
        vic.x + Math.cos(strikeAng) * strikeDist,
        vic.z + Math.sin(strikeAng) * strikeDist,
        rWolf
      );

      p.x = nx;
      p.z = nz;
      p.vx = 0;
      p.vz = 0;
      p.a = Math.atan2(vic.z - p.z, vic.x - p.x);

      const loss = Math.min(vic.mass - CFG.MIN_MASS, Math.max(12, Math.round(vic.mass * 0.14)));
      const stolen = Math.max(8, Math.round(loss * 0.65));
      const dropped = Math.max(0, loss - stolen);
      if (loss > 0) {
        vic.mass = Math.max(CFG.MIN_MASS, vic.mass - loss);
        p.mass += stolen;
        p.best = Math.max(p.best, p.mass);
        if (dropped > 0) {
          this.scatter(vic.x, vic.z, dropped, rVic + 1.2, Math.cos(p.a), Math.sin(p.a));
        }
      }

      vic.lastHitBy = p.id;
      vic.lastHitT = this.time;
      p.lastAttackedId = vic.id;
      p.lastAttackedT = this.time;

      if (vic.shieldT <= 0) {
        vic.stunT = Math.max(vic.stunT, 0.75);
        vic.slowT = Math.max(vic.slowT, 1.2);
        vic.dashT = 0;
        vic.plow = false;
        vic.vx = Math.cos(p.a) * 16;
        vic.vz = Math.sin(p.a) * 16;
      }

      this.events.push({
        k: 'wolfBite',
        id: p.id,
        targetId: vic.id,
        x: r2(p.x),
        z: r2(p.z),
        fromX: r2(fromX),
        fromZ: r2(fromZ),
        anchorX: p.wolfAnchorX !== undefined ? r2(p.wolfAnchorX) : undefined,
        anchorZ: p.wolfAnchorZ !== undefined ? r2(p.wolfAnchorZ) : undefined,
        stolen,
        loss,
        rainbow: true,
        step: stepNum,
        total: p.wolfBiteTotal || 1,
      });
      this.events.push({
        k: 'hit',
        a: p.id,
        v: vic.id,
        x: r2(vic.x),
        z: r2(vic.z),
        s: 24,
        loss,
      });

      if ((p.wolfBiteStep ?? 0) >= p.wolfChainTargets.length) {
        // Sau khi hoàn thành 6 nhát cắn, Sói lập tức xuất hiện tại chính vị trí con vật đầu tiên bị cắn (anchor)
        if (p.wolfAnchorX !== undefined && p.wolfAnchorZ !== undefined) {
          const [fx, fz] = this.clampSafeArenaPos(p.wolfAnchorX, p.wolfAnchorZ, rWolf);
          p.x = fx;
          p.z = fz;
          p.vx = 0;
          p.vz = 0;
        }
        p.wolfChainTargets = undefined;
        p.wolfFrenzyT = 0;
      }
      return;
    }

    // 2B. Kỹ năng Gồng Thường: Cắn liên hồi vào 1 mục tiêu ở những vị trí khác nhau xung quanh nó
    if (!p.wolfChainRainbow && p.wolfTargetId && (p.wolfBitesLeft ?? 0) > 0) {
      const vic = this.players.get(p.wolfTargetId);
      if (!vic || !vic.alive) {
        p.wolfBitesLeft = 0;
        p.wolfFrenzyT = 0;
        p.wolfTargetId = undefined;
        return;
      }

      p.wolfBitesLeft!--;
      p.wolfBiteStep = (p.wolfBiteStep ?? 0) + 1;
      p.wolfBiteTimer = 0.15;

      const fromX = p.x;
      const fromZ = p.z;
      const rWolf = radiusOf(p.mass);
      const rVic = radiusOf(vic.mass);
      // Mỗi nhát cắn đổi sang 1 vị trí góc khác nhau quanh mục tiêu (+135 độ mỗi nhát)
      const baseAng = Math.atan2(fromZ - vic.z, fromX - vic.x);
      const biteAng = p.wolfBiteStep === 1 ? baseAng : baseAng + 2.35619;
      const strikeDist = (rWolf + rVic) * 0.85;
      const [nx, nz] = this.clampSafeArenaPos(
        vic.x + Math.cos(biteAng) * strikeDist,
        vic.z + Math.sin(biteAng) * strikeDist,
        rWolf
      );

      p.x = nx;
      p.z = nz;
      p.vx = 0;
      p.vz = 0;
      p.a = Math.atan2(vic.z - p.z, vic.x - p.x);

      const ratio = p.wolfRatio ?? 0.5;
      const loss = Math.min(vic.mass - CFG.MIN_MASS, Math.max(4, Math.round(vic.mass * (0.035 + ratio * 0.015))));
      const stolen = Math.max(2, Math.round(loss * 0.5));
      const dropped = Math.max(0, loss - stolen);
      if (loss > 0) {
        vic.mass = Math.max(CFG.MIN_MASS, vic.mass - loss);
        p.mass += stolen;
        p.best = Math.max(p.best, p.mass);
        if (dropped > 0) {
          this.scatter(vic.x, vic.z, dropped, rVic + 1.0, Math.cos(p.a), Math.sin(p.a));
        }
      }

      vic.lastHitBy = p.id;
      vic.lastHitT = this.time;
      p.lastAttackedId = vic.id;
      p.lastAttackedT = this.time;

      if (vic.shieldT <= 0) {
        vic.stunT = Math.max(vic.stunT, 0.22);
        vic.slowT = Math.max(vic.slowT, 0.6);
        vic.dashT = 0;
        vic.plow = false;
        vic.vx *= 0.25;
        vic.vz *= 0.25;
      }

      this.events.push({
        k: 'wolfBite',
        id: p.id,
        targetId: vic.id,
        x: r2(p.x),
        z: r2(p.z),
        fromX: r2(fromX),
        fromZ: r2(fromZ),
        stolen,
        loss,
        rainbow: false,
        step: p.wolfBiteStep,
        total: p.wolfBiteTotal || 3,
      });
      this.events.push({
        k: 'hit',
        a: p.id,
        v: vic.id,
        x: r2(vic.x),
        z: r2(vic.z),
        s: 16,
        loss,
      });

      if ((p.wolfBitesLeft ?? 0) <= 0) {
        p.wolfTargetId = undefined;
      }
    }
  }

  private spawnBananaCone(p: Player, count: number, giant: boolean): void {
    const isGorilla = p.species === 'gorilla';
    const tier = giant ? 2 : isGorilla ? 2 : (p.mass >= 1000 ? 1 : 0);
    const spreadAngle = count > 1 ? (Math.PI / 3.2) : 0;
    const speed = tier === 2 ? 28.0 : tier === 1 ? 25.0 : 22.0;
    const life = tier === 2 ? 0.95 : tier === 1 ? 0.85 : 0.75;
    const bodyR = radiusOf(p.mass);
    const startX = p.x + Math.cos(p.a) * (bodyR + 0.6);
    const startZ = p.z + Math.sin(p.a) * (bodyR + 0.6);
    const r = tier === 2 ? 1.3 : tier === 1 ? 0.85 : 0.5;

    // Gorilla khi ném chuối tiêu hao 0.5% kg của cơ thể
    if (isGorilla && !giant) {
      const penalty = Math.max(1, Math.round(p.mass * 0.005));
      p.mass = Math.max(10, p.mass - penalty);
      this.scatter(p.x, p.z, Math.round(penalty * 0.5), radiusOf(p.mass) + 1.5, Math.cos(p.a), Math.sin(p.a));
    }

    for (let i = 0; i < count; i++) {
      const offsetRatio = count > 1 ? (i / (count - 1)) - 0.5 : 0;
      const angle = p.a + offsetRatio * spreadAngle;
      this.bananaProjectiles.push({
        id: this.nextBananaId++,
        ownerId: p.id,
        x: startX,
        z: startZ,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        life,
        giant,
        tier,
        r,
      });
    }

    this.events.push({
      k: 'bananaThrow',
      id: p.id,
      x: r2(startX),
      z: r2(startZ),
      a: r2(p.a),
      count,
      giant,
      tier,
    });
  }

  private updateBananaProjectiles(dt: number): void {
    for (let i = this.bananaProjectiles.length - 1; i >= 0; i--) {
      const proj = this.bananaProjectiles[i];
      proj.x += proj.vx * dt;
      proj.z += proj.vz * dt;
      proj.life -= dt;

      let hit = false;
      for (const target of this.players.values()) {
        if (!target.alive || target.id === proj.ownerId || (target.monkeyLeapT && target.monkeyLeapT > 0)) continue;
        const tr = radiusOf(target.mass);
        const dist = Math.hypot(target.x - proj.x, target.z - proj.z);
        if (dist <= tr + proj.r) {
          hit = true;
          const att = this.players.get(proj.ownerId);

          // Shield immunity & Evolved passive immunity: immune to stun, flinch, knockback, and loss
          if (target.shieldT > 0 || (isEvolvedSpecies(target.species) && (!att || att.mass < 1000))) {
            this.events.push({
              k: 'bananaHit',
              id: target.id,
              x: r2(target.x),
              z: r2(target.z),
              giant: proj.giant,
              tier: proj.tier,
            });
            break;
          }

          const hitAngle = Math.atan2(proj.vz, proj.vx);

          // Item Effect 1: Dynamite explosion on banana hit
          if (att && att.hasDynamite) {
            att.hasDynamite = false;
            const boomX = r2(target.x);
            const boomZ = r2(target.z);
            this.events.push({ k: 'boom', id: att.id, x: boomX, z: boomZ });
            const BOOM_R = 9.0;
            for (const bystander of this.players.values()) {
              if (!bystander.alive || bystander.id === att.id) continue;
              const bdx = bystander.x - boomX;
              const bdz = bystander.z - boomZ;
              const bdist = Math.hypot(bdx, bdz);
              if (bdist < BOOM_R && bdist > 0.01) {
                const bForce = clamp((1 - bdist / BOOM_R) * 38, 10, 34);
                bystander.vx += (bdx / bdist) * bForce;
                bystander.vz += (bdz / bdist) * bForce;
              }
            }
            target.lastHitBy = att.id;
            target.lastHitT = this.time;
            att.lastAttackedId = target.id;
            att.lastAttackedT = this.time;
            if (target.mass < 100) {
              this.kill(target, 'dynamite');
            } else {
              const loss = Math.max(100, Math.round(target.mass * 0.25));
              target.mass -= loss;
              if (target.mass <= 10) {
                this.kill(target, 'dynamite');
              } else {
                this.scatter(boomX, boomZ, loss, radiusOf(target.mass) + 3.5, proj.vx, proj.vz);
                target.vx += Math.cos(hitAngle) * 50;
                target.vz += Math.sin(hitAngle) * 50;
                target.dashT = 0; target.plow = false; target.charging = false;
                this.events.push({
                  k: 'hit',
                  a: att.id,
                  v: target.id,
                  x: r2(target.x),
                  z: r2(target.z),
                  s: 50,
                  loss: Math.round(loss * 10) / 10,
                });
              }
            }
            break;
          }

          // Item Effect 2: Pitchfork on banana hit (10s duration, max 3 hits: hit 1 = 30%, hit 2 = 20%, hit 3 = 10%)
          if (att && att.pitchforkT > 0 && (att.pitchforkHits ?? 3) > 0) {
            const hitsLeft = att.pitchforkHits ?? 3;
            const pct = hitsLeft === 3 ? 0.30 : hitsLeft === 2 ? 0.20 : 0.10;
            const massLoss = Math.min(target.mass - CFG.MIN_MASS, Math.max(2, Math.round(target.mass * pct)));
            att.pitchforkHits = hitsLeft - 1;
            if (att.pitchforkHits <= 0) {
              att.pitchforkT = 0;
              att.pitchforkHits = 0;
            }
            target.mass -= massLoss;
            // Rớt kg (trái cây) tương tự húc, không tính kg vào khỉ mà cần nhặt mới tăng
            this.scatter(target.x, target.z, massLoss, radiusOf(target.mass) + 2.0, proj.vx, proj.vz);
            const knockback = 30.0;
            target.vx += Math.cos(hitAngle) * knockback;
            target.vz += Math.sin(hitAngle) * knockback;
            target.dashT = 0; target.plow = false; target.charging = false;
            target.lastHitBy = att.id;
            target.lastHitT = this.time;
            att.lastAttackedId = target.id;
            att.lastAttackedT = this.time;
            this.events.push({
              k: 'bananaHit',
              id: target.id,
              x: r2(target.x),
              z: r2(target.z),
              giant: proj.giant,
              tier: proj.tier,
            });
            this.events.push({
              k: 'hit',
              a: att.id,
              v: target.id,
              x: r2(target.x),
              z: r2(target.z),
              s: Math.round(knockback),
              loss: massLoss,
            });
            break;
          }

          // Item Effect 3: Wheel crush on banana hit
          if (att && att.wheelT > 0) {
            target.squishT = 3.0;
            target.stunT = 1.2;
            target.lastHitBy = att.id;
            target.lastHitT = this.time;
            att.lastAttackedId = target.id;
            att.lastAttackedT = this.time;
            const launchSpeed = 34;
            target.vx += Math.cos(hitAngle) * launchSpeed;
            target.vz += Math.sin(hitAngle) * launchSpeed;
            target.dashT = 0; target.plow = false; target.charging = false;
            if (target.mass < 80) {
              this.kill(target, 'crush');
            } else {
              const lostMass = Math.min(target.mass - 20, Math.max(50, Math.round(target.mass * 0.4)));
              target.mass = Math.max(20, target.mass - lostMass);
              this.scatter(target.x, target.z, lostMass, radiusOf(target.mass) + 2.0, proj.vx, proj.vz);
              this.events.push({
                k: 'hit',
                a: att.id,
                v: target.id,
                x: r2(target.x),
                z: r2(target.z),
                s: Math.round(launchSpeed),
                loss: lostMass,
              });
            }
            break;
          }

          // Default Banana Hit (Requirement 1):
          // Rớt kg (trái cây) tương tự húc, nhưng không tính kg vào khỉ mà cần phải nhặt mới tăng. Vẫn giữ hiệu ứng đẩy lùi.
          // Áp dụng tương tự với sức mạnh cầu vồng (proj.giant) bắn nhiều chuối.
          const lossPct = proj.giant ? 0.18 : proj.tier === 2 ? 0.15 : proj.tier === 1 ? 0.12 : 0.10;
          const minLoss = proj.giant ? 8 : proj.tier === 2 ? 6 : proj.tier === 1 ? 3 : 2;
          const massLoss = Math.min(target.mass - CFG.MIN_MASS, Math.max(minLoss, Math.round(target.mass * lossPct)));

          target.mass = Math.max(10, target.mass - massLoss);
          this.scatter(target.x, target.z, massLoss, radiusOf(target.mass) + 2.0, proj.vx, proj.vz);

          let knockback = proj.giant ? 44.0 : proj.tier === 2 ? 34.0 : proj.tier === 1 ? 26.0 : 18.0;
          if (proj.giant && isEvolvedSpecies(target.species)) {
            knockback *= 0.5;
          }
          target.vx += Math.cos(hitAngle) * knockback;
          target.vz += Math.sin(hitAngle) * knockback;
          target.dashT = 0;
          target.plow = false;
          target.charging = false;
          target.lastHitBy = proj.ownerId;
          target.lastHitT = this.time;
          if (att) {
            att.lastAttackedId = target.id;
            att.lastAttackedT = this.time;
          }

          this.events.push({
            k: 'bananaHit',
            id: target.id,
            x: r2(target.x),
            z: r2(target.z),
            giant: proj.giant,
            tier: proj.tier,
          });
          this.events.push({
            k: 'hit',
            a: proj.ownerId,
            v: target.id,
            x: r2(target.x),
            z: r2(target.z),
            s: Math.round(knockback),
            loss: massLoss,
          });
          break;
        }
      }

      if (hit || proj.life <= 0) {
        this.bananaProjectiles.splice(i, 1);
      }
    }
  }

  private collidePlayers(list: Player[]): void {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const aFlying = (a.monkeyLeapT !== undefined && a.monkeyLeapT > 0) || (a.flightT !== undefined && a.flightT > 0);
        const bFlying = (b.monkeyLeapT !== undefined && b.monkeyLeapT > 0) || (b.flightT !== undefined && b.flightT > 0);
        if (aFlying !== bFlying) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const ra = radiusOf(a.mass), rb = radiusOf(b.mass), minD = ra + rb;
        if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue;
        let d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
        const nx = dx / d, nz = dz / d;
        const ma = a.mass * TRAITS[a.species].weight, mb = b.mass * TRAITS[b.species].weight;

        // separate, the lighter one moves more; Evolved forms (Gorilla, Mammoth, Wolf, Phoenix, Swan, Ram, Boar, Pegasus, Bull) are unyielding against < 1 ton animals or animals they just slammed/squished; Shield is unyielding against all
        const aJustHitB = b.lastHitBy === a.id && (this.time - b.lastHitT) < 0.6;
        const bJustHitA = a.lastHitBy === b.id && (this.time - a.lastHitT) < 0.6;
        const aImmune = (isEvolvedSpecies(a.species) && (b.mass < 1000 || aJustHitB || b.squishT > 0)) || a.shieldT > 0 || (a.species === 'monkey' && aJustHitB);
        const bImmune = (isEvolvedSpecies(b.species) && (a.mass < 1000 || bJustHitA || a.squishT > 0)) || b.shieldT > 0 || (b.species === 'monkey' && bJustHitA);
        let wa = mb / (ma + mb);
        if (aImmune) wa = 0;
        else if (bImmune) wa = 1;
        const overlap = minD - Math.min(d, minD);
        a.x -= nx * overlap * wa; a.z -= nz * overlap * wa;
        b.x += nx * overlap * (1 - wa); b.z += nz * overlap * (1 - wa);

        const va = a.vx * nx + a.vz * nz; // a's speed towards b
        const vb = -(b.vx * nx + b.vz * nz); // b's speed towards a
        const sameTeam = a.team !== undefined && b.team !== undefined && a.team === b.team;
        const aWheel = a.wheelT > 0;
        const bWheel = b.wheelT > 0;
        if ((aWheel || bWheel) && !sameTeam) {
          if (aWheel && !bWheel) {
            this.wheelCrush(a, b, nx, nz);
          } else if (bWheel && !aWheel) {
            this.wheelCrush(b, a, -nx, -nz);
          } else {
            a.vx -= nx * 22; a.vz -= nz * 22;
            b.vx += nx * 22; b.vz += nz * 22;
            this.events.push({ k: 'hit', a: a.id, v: b.id, x: r2(b.x), z: r2(b.z), s: 22 });
          }
          continue;
        }

        const aHits = !sameTeam && a.dashT > 0 && va > CFG.HIT_MIN_SPEED && !a.dashHit.has(b.id);
        const bHits = !sameTeam && b.dashT > 0 && vb > CFG.HIT_MIN_SPEED && !b.dashHit.has(a.id);
        if (aHits && bHits) {
          // head-on: the bigger momentum wins (taking ram strength factor into account)
          const ramA = TRAITS[a.species].ram ?? 1.0;
          const ramB = TRAITS[b.species].ram ?? 1.0;
          if (va * ma * a.power * ramA >= vb * mb * b.power * ramB) this.hit(a, b, nx, nz, va);
          else this.hit(b, a, -nx, -nz, vb);
        } else if (aHits) this.hit(a, b, nx, nz, va);
        else if (bHits) this.hit(b, a, -nx, -nz, vb);
        else {
          const closing = va + vb;
          if (closing > 0) {
            const jImp = (1.2 * closing) / (1 / ma + 1 / mb);
            if (!aImmune) {
              a.vx -= (jImp / ma) * nx; a.vz -= (jImp / ma) * nz;
            }
            if (!bImmune) {
              b.vx += (jImp / mb) * nx; b.vz += (jImp / mb) * nz;
            }
          }
        }
      }
    }
  }

  private wheelCrush(attacker: Player, victim: Player, nx: number, nz: number): void {
    if (victim.lastHitBy === attacker.id && (this.time - victim.lastHitT) < 0.35) {
      return;
    }
    victim.lastHitBy = attacker.id;
    victim.lastHitT = this.time;
    attacker.lastAttackedId = victim.id;
    attacker.lastAttackedT = this.time;

    // Shielded: Takes damage only, NO squish, NO stun, NO knockback, NO kill!
    if (victim.shieldT > 0) {
      const rawLoss = Math.round(victim.mass * 0.4);
      const lostMass = Math.min(100, Math.min(victim.mass - 10, Math.max(10, rawLoss)));
      victim.mass = Math.max(10, victim.mass - lostMass);
      attacker.mass += Math.round(lostMass * 0.5);
      this.scatter(victim.x, victim.z, Math.round(lostMass * 0.5), 1.2);
      this.events.push({
        k: 'hit',
        a: attacker.id,
        v: victim.id,
        x: r2(victim.x),
        z: r2(victim.z),
        s: 14,
        loss: Math.round(lostMass),
      });
      attacker.vx *= 0.5;
      attacker.vz *= 0.5;
      return;
    }

    victim.squishT = 3.0; // Flattened squished animation
    victim.stunT = 1.2;
    const launchSpeed = 34;
    victim.vx = nx * launchSpeed;
    victim.vz = nz * launchSpeed;

    if (victim.mass < 80) {
      this.kill(victim, 'crush');
    } else {
      const rawLoss = Math.round(victim.mass * 0.4);
      const lostMass = Math.min(100, Math.min(victim.mass - 20, Math.max(20, rawLoss)));
      victim.mass = Math.max(20, victim.mass - lostMass);
      attacker.mass += Math.round(lostMass * 0.5);
      this.scatter(victim.x, victim.z, Math.round(lostMass * 0.5), 1.2);
      this.events.push({
        k: 'hit',
        a: attacker.id,
        v: victim.id,
        x: r2(victim.x),
        z: r2(victim.z),
        s: launchSpeed,
        loss: Math.round(lostMass),
      });
    }
  }

  private updateMinions(dt: number, alive: Player[]): void {
    const LEASH_R = 15;

    // Group active minions by owner to compute balanced, stable formation slots
    const byOwner = new Map<number, Minion[]>();
    for (const [mid, m] of this.minions) {
      const owner = this.players.get(m.ownerId);
      if (!owner || !owner.alive || m.mass <= 5) {
        this.minions.delete(mid);
        continue;
      }
      let arr = byOwner.get(m.ownerId);
      if (!arr) {
        arr = [];
        byOwner.set(m.ownerId, arr);
      }
      arr.push(m);
    }

    for (const [ownerId, squad] of byOwner) {
      const owner = this.players.get(ownerId)!;
      // Sort deterministically so minion slots are fixed and stable
      squad.sort((a, b) => a.id - b.id);
      const totalInSquad = squad.length;

      for (let slot = 0; slot < totalInSquad; slot++) {
        const m = squad[slot];
        m.cd = Math.max(0, m.cd - dt);
        const dxO = m.x - owner.x;
        const dzO = m.z - owner.z;
        const distToOwner = Math.hypot(dxO, dzO);

        // Leash limit: if too far from owner, abandon chase and return
        if (distToOwner > LEASH_R) {
          m.targetId = 0;
        }

        // Check current target: must still be alive, within leash of owner, and combat active (< 6s)
        let target: Player | undefined;
        if (m.targetId > 0) {
          target = this.players.get(m.targetId);
          const inLeash = target && target.alive && Math.hypot(target.x - owner.x, target.z - owner.z) <= LEASH_R && distToOwner <= LEASH_R;
          const isEnemyAttacker = target ? (owner.lastHitBy === target.id && this.time - owner.lastHitT < 6.0) : false;
          const isOwnerAttacked = target ? ((owner.lastAttackedId === target.id && this.time - owner.lastAttackedT < 6.0) || (target.lastHitBy === owner.id && this.time - target.lastHitT < 6.0)) : false;

          if (!inLeash || (!isEnemyAttacker && !isOwnerAttacked)) {
            m.targetId = 0;
            target = undefined;
          }
        }

        // Find new target if none: ONLY if candidate attacked owner OR owner attacked candidate
        if (!target) {
          // Condition A: enemy that recently hit owner within leash
          if (owner.lastHitBy > 0 && this.time - owner.lastHitT < 6.0) {
            const attacker = this.players.get(owner.lastHitBy);
            if (attacker && attacker.alive && attacker.id !== owner.id) {
              const sameT = owner.team !== undefined && attacker.team !== undefined && owner.team === attacker.team;
              if (!sameT && Math.hypot(attacker.x - owner.x, attacker.z - owner.z) <= LEASH_R) {
                m.targetId = attacker.id;
                target = attacker;
              }
            }
          }
        }

        if (!target) {
          // Condition B: enemy that owner recently attacked within leash
          const candidateId = owner.lastAttackedId;
          if (candidateId > 0 && this.time - owner.lastAttackedT < 6.0) {
            const victim = this.players.get(candidateId);
            if (victim && victim.alive && victim.id !== owner.id) {
              const sameT = owner.team !== undefined && victim.team !== undefined && owner.team === victim.team;
              if (!sameT && Math.hypot(victim.x - owner.x, victim.z - owner.z) <= LEASH_R) {
                m.targetId = victim.id;
                target = victim;
              }
            }
          }
        }

        if (target) {
          // Chase & ram target
          const toX = target.x - m.x;
          const toZ = target.z - m.z;
          const dist = Math.hypot(toX, toZ);
          const aimA = Math.atan2(toZ, toX);

          // Smooth turn when chasing
          let da = aimA - m.a;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          m.a += Math.sign(da) * Math.min(Math.abs(da), 8.0 * dt);

          const chaseSpeed = 15;
          m.vx = Math.cos(m.a) * chaseSpeed;
          m.vz = Math.sin(m.a) * chaseSpeed;
          m.x += m.vx * dt;
          m.z += m.vz * dt;

          const hitDist = radiusOf(m.mass) + radiusOf(target.mass) + 0.4;
          if (dist < hitDist && m.cd <= 0) {
            m.cd = 0.8;
            if (isEvolvedSpecies(target.species) || target.shieldT > 0) {
              // Evolved and Shielded targets: immune to minion stun and knockback (target moves freely!)
              m.vx = -Math.cos(aimA) * 12;
              m.vz = -Math.sin(aimA) * 12;
              const loss = target.shieldT > 0 ? Math.min(target.mass - 10, 8) : 0;
              if (loss > 0) {
                target.mass -= loss;
                owner.mass += loss;
              }
              this.events.push({
                k: 'hit',
                a: owner.id,
                v: target.id,
                x: r2(target.x),
                z: r2(target.z),
                s: 10,
                loss: Math.round(loss),
                minion: true,
              });
            } else {
              target.vx += Math.cos(aimA) * 18;
              target.vz += Math.sin(aimA) * 18;
              target.stunT = 0.2; // Minion stun reduced by 50% (from 0.4s to 0.2s)
              target.lastHitBy = owner.id;
              target.lastHitT = this.time;
              const loss = Math.min(target.mass - 10, 8);
              if (loss > 0) {
                target.mass -= loss;
                owner.mass += loss;
              }
              this.events.push({
                k: 'hit',
                a: owner.id,
                v: target.id,
                x: r2(target.x),
                z: r2(target.z),
                s: 18,
                loss: Math.round(loss),
                minion: true,
              });
              if (target.mass < 10) {
                this.kill(target, 'fence');
                m.targetId = 0;
                target = undefined;
              }
            }
          }
        } else {
          // Guarding owner: stable bodyguard formation around owner
          // Rotate formation gently (~0.6 rad/s) so it doesn't spin wildly
          m.orbitAngle = (this.time * 0.6) % (Math.PI * 2);
          const slotAngle = m.orbitAngle + (slot / totalInSquad) * Math.PI * 2;
          const baseR = radiusOf(owner.mass) + 0.95;
          // Stagger distance slightly for larger squads (8-10 minions) for clean concentric distribution
          const slotDist = baseR + (totalInSquad > 6 ? (slot % 2 === 0 ? 0 : 0.65) : (slot % 2 === 0 ? 0 : 0.35));
          const desiredX = owner.x + Math.cos(slotAngle) * slotDist;
          const desiredZ = owner.z + Math.sin(slotAngle) * slotDist;
          const toX = desiredX - m.x;
          const toZ = desiredZ - m.z;
          const dist = Math.hypot(toX, toZ);

          if (dist > 0.08) {
            const speed = Math.min(22, Math.max(6, dist * 8));
            m.vx = (toX / dist) * speed;
            m.vz = (toZ / dist) * speed;
            m.x += m.vx * dt;
            m.z += m.vz * dt;
          } else {
            m.vx = owner.vx;
            m.vz = owner.vz;
            m.x = desiredX;
            m.z = desiredZ;
          }

          // Smooth orientation without erratic spinning:
          // If owner is running fast, minions face movement heading.
          // If stationary/slow and guarding, face outward along slot direction.
          const ownerSpeed = Math.hypot(owner.vx, owner.vz);
          let targetFacing: number;
          if (ownerSpeed > 1.8) {
            targetFacing = owner.a;
          } else if (dist > 0.4) {
            targetFacing = Math.atan2(toZ, toX);
          } else {
            targetFacing = slotAngle;
          }

          let diff = targetFacing - m.a;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = 4.5 * dt;
          m.a += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
        }

        // Check if enemy dashes into minion: minion loses mass
        for (const enemy of alive) {
          if (enemy.id === owner.id) continue;
          const sameT = owner.team !== undefined && enemy.team !== undefined && owner.team === enemy.team;
          if (sameT) continue;
          const d = Math.hypot(enemy.x - m.x, enemy.z - m.z);
          const colDist = radiusOf(m.mass) + radiusOf(enemy.mass);
          if (d < colDist && enemy.dashT > 0) {
            m.mass -= 18;
            enemy.vx *= 0.5;
            enemy.vz *= 0.5;
            this.events.push({
              k: 'hit',
              a: enemy.id,
              v: owner.id,
              x: r2(m.x),
              z: r2(m.z),
              s: 14,
              loss: 18,
              minion: true,
            });
            if (m.mass <= 5) {
              m.alive = false;
              this.minions.delete(m.id);
              break;
            }
          }
        }
      }
    }

    // Soft separation between minions to keep them close but never clipping/overlapping
    const activeList = [...this.minions.values()];
    const MIN_MINION_DIST = 1.35;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < activeList.length; i++) {
        const m1 = activeList[i];
        for (let j = i + 1; j < activeList.length; j++) {
          const m2 = activeList[j];
          const dx = m1.x - m2.x;
          const dz = m1.z - m2.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < MIN_MINION_DIST * MIN_MINION_DIST && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const overlap = MIN_MINION_DIST - d;
            const push = overlap * 0.5;
            const nx = dx / d;
            const nz = dz / d;
            m1.x += nx * push;
            m1.z += nz * push;
            m2.x -= nx * push;
            m2.z -= nz * push;
          }
        }
        // Also ensure minion doesn't penetrate inside owner's body
        const owner = this.players.get(m1.ownerId);
        if (owner && owner.alive) {
          const minOwnerDist = radiusOf(owner.mass) + 0.65;
          const dxO = m1.x - owner.x;
          const dzO = m1.z - owner.z;
          const dO = Math.hypot(dxO, dzO);
          if (dO < minOwnerDist && dO > 0.0001) {
            const pushO = minOwnerDist - dO;
            m1.x += (dxO / dO) * pushO;
            m1.z += (dzO / dO) * pushO;
          }
        }
      }
    }
  }

  startKingChoice(): void {
    const baseRules = ['poultry', 'titan', 'corn', 'equal', 'sunday', 'tax', 'squealer', 'snowball', 'till', 'dice'];
    const candidates = baseRules.filter((r) => r !== this.currentRule);
    let shuffled = [...candidates].sort(() => this.rnd() - 0.5);

    // Event rule: 30% chance for "NGÀY PHỤ NỮ VIỆT NAM VUI VẺ" in women_day theme
    if (this.theme === 'women_day' && this.currentRule !== 'womenday' && this.rnd() < 0.30) {
      shuffled = ['womenday', ...shuffled.filter((r) => r !== 'womenday')];
    }
    // Event rule: 30% chance for "TRICK OR TREAT" in halloween theme
    if (this.theme === 'halloween' && this.currentRule !== 'halloween' && this.rnd() < 0.30) {
      shuffled = ['halloween', ...shuffled.filter((r) => r !== 'halloween')];
    }

    this.kingChoice = {
      options: shuffled.slice(0, 3),
      expireT: this.time + 10.0,
    };
  }

  chooseRule(playerId: number, ruleId: string): void {
    if (playerId === this.napoleonId && this.kingChoice && this.kingChoice.options.includes(ruleId)) {
      this.applyRule(ruleId);
    }
  }

  applyRule(ruleId: string): void {
    // Revert previous poultry rule if switching away
    if (this.currentRule === 'poultry' && ruleId !== 'poultry') {
      for (const p of this.players.values()) {
        if (p.origSpecies) {
          p.species = p.origSpecies;
          delete p.origSpecies;
          this.events.push({ k: 'join', ...this.meta(p) });
        }
      }
    }
    this.currentRule = ruleId;
    this.ruleTimer = 30;
    this.kingChoice = null;

    if (ruleId === 'poultry') {
      // 1. Thế giới gia cầm: all animals transform into chicken or duck
      for (const p of this.players.values()) {
        if (!p.origSpecies) p.origSpecies = p.species;
        p.species = this.rnd() < 0.5 ? 'chicken' : 'duck';
        this.events.push({ k: 'join', ...this.meta(p) });
      }
    } else if (ruleId === 'titan') {
      // 2. Titan đại chiến: all animals increase to 1000kg regardless of prior size
      for (const p of this.players.values()) {
        if (p.alive) {
          p.mass = 1000;
        }
      }
    } else if (ruleId === 'equal') {
      // 3. Chúng sinh bình đẳng: all animals 30kg, King 100kg
      for (const p of this.players.values()) {
        if (p.alive) {
          if (p.id === this.napoleonId) p.mass = 100;
          else p.mass = 30;
        }
      }
    } else if (ruleId === 'sunday') {
      // 5. Họp ngày chủ nhật: Tất cả con vật bị đứng yên 1.5s, xuất hiện vòng sáng teleport dưới chân lên đầu, rồi dịch chuyển về bục
      this.sundayTeleportTimer = 1.5;
      this.podiumShield = false;
      for (const p of this.players.values()) {
        if (p.alive && p.id !== this.napoleonId) {
          p.stunT = Math.max(p.stunT, 1.5);
          p.vx = 0;
          p.vz = 0;
          p.dashT = 0;
          p.charging = false;
          p.plow = false;
        }
      }
      this.events.push({ k: 'sundaySummon', dur: 1.5 });
    } else if (ruleId === 'squealer') {
      const king = this.players.get(this.napoleonId);
      if (king && king.alive) {
        king.cd = 0;
        king.power = 1.35;
      }
    } else if (ruleId === 'till') {
      this.tillTruck.timer = 1.0;
      this.tillTruck.active = false;
      this.tillTruck.exiting = false;
      this.tillTruck.sweepT = 14.0;
    } else if (ruleId === 'corn') {
      const [podX, podZ] = this.map.podium;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        this.addFood(podX + Math.cos(ang) * 2.5, podZ + Math.sin(ang) * 2.5, 2, 6);
      }
    } else if (ruleId === 'dice') {
      // 10. Đổ xúc sắc: roll 1..6 points, add roll * 100 kg to each player
      for (const p of this.players.values()) {
        if (p.alive) {
          const roll = Math.floor(this.rnd() * 6) + 1;
          p.mass += roll * 100;
          this.events.push({ k: 'dice', id: p.id, roll });
        }
      }
    } else if (ruleId === 'womenday') {
      // 11. Event rule: spawn many giant flowers (kind 8) simultaneously on open ground
      let spawned = 0;
      for (let attempt = 0; attempt < 150 && spawned < 40; attempt++) {
        const ang = this.rnd() * Math.PI * 2;
        const dist = 5 + this.rnd() * (CFG.R - 8);
        const fx = Math.cos(ang) * dist;
        const fz = Math.sin(ang) * dist;
        if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(fx - hx, fz - hz) < hr + 1.0)) continue;
        if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(fx - wx, fz - wz) < wr + 2.0)) continue;
        if (this.map.fire?.some(([cx, cz, cr]) => Math.hypot(fx - cx, fz - cz) < cr + 2.0)) continue;
        this.addFood(fx, fz, 8, FOOD_KG[8]);
        spawned++;
      }
      this.events.push({ k: 'flowerBloom' });
    } else if (ruleId === 'halloween') {
      // 12. Event rule: spawn many giant magic pumpkins (kind 9) simultaneously on open ground
      let spawned = 0;
      for (let attempt = 0; attempt < 150 && spawned < 40; attempt++) {
        const ang = this.rnd() * Math.PI * 2;
        const dist = 5 + this.rnd() * (CFG.R - 8);
        const fx = Math.cos(ang) * dist;
        const fz = Math.sin(ang) * dist;
        if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(fx - hx, fz - hz) < hr + 1.0)) continue;
        if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(fx - wx, fz - wz) < wr + 2.0)) continue;
        if (this.map.fire?.some(([cx, cz, cr]) => Math.hypot(fx - cx, fz - cz) < cr + 2.0)) continue;
        this.addFood(fx, fz, 9, FOOD_KG[9]);
        spawned++;
      }
      this.events.push({ k: 'trickOrTreat' });
    }
    this.events.push({ k: 'rule', id: ruleId });
  }

  private hit(att: Player, vic: Player, nx: number, nz: number, speed: number): void {
    // Shield immunity: immune to stun, knockback, flinch, squish & crowd control; takes damage (sát thương) only!
    if (vic.shieldT > 0) {
      att.dashHit.add(vic.id);
      att.dashT = 0;
      att.plow = false;
      att.vx = -nx * 14;
      att.vz = -nz * 14;

      const ma = att.mass, mv = vic.mass * TRAITS[vic.species].weight;
      let loss = 0;
      if (vic.adminGod) {
        // God mode: immune to damage
      } else if (att.hasDynamite) {
        att.hasDynamite = false;
        const boomX = r2((att.x + vic.x) / 2);
        const boomZ = r2((att.z + vic.z) / 2);
        this.events.push({ k: 'boom', id: att.id, x: boomX, z: boomZ });
        loss = Math.min(vic.mass - 10, Math.max(20, Math.round(vic.mass * 0.25)));
        vic.mass = Math.max(10, vic.mass - loss);
        this.scatter(boomX, boomZ, loss, radiusOf(vic.mass) + 2.0, nx, nz);
      } else if (att.pitchforkT > 0 && (att.pitchforkHits ?? 3) > 0) {
        const hitsLeft = att.pitchforkHits ?? 3;
        const pct = hitsLeft === 3 ? 0.30 : hitsLeft === 2 ? 0.20 : 0.10;
        loss = Math.min(vic.mass - CFG.MIN_MASS, Math.max(2, Math.round(vic.mass * pct)));
        att.pitchforkHits = hitsLeft - 1;
        if (att.pitchforkHits <= 0) {
          att.pitchforkT = 0;
          att.pitchforkHits = 0;
        }
        const steal = Math.round(loss * 0.5);
        if (steal > 0) {
          att.mass += steal;
          att.best = Math.max(att.best, att.mass);
        }
        vic.mass -= loss;
        this.scatter(vic.x, vic.z, loss, radiusOf(vic.mass) + 0.8, nx, nz);
      } else {
        const superMult = att.superT > 0 ? 2.0 : 1.0;
        loss = Math.min(vic.mass - CFG.MIN_MASS, Math.max(1, vic.mass * CFG.HIT_LOSS * att.power * superMult * clamp(ma / mv, 0.5, 1.5)));
        vic.mass -= loss;
        this.scatter(vic.x, vic.z, loss, radiusOf(vic.mass) + 0.8, nx, nz);
      }

      vic.lastHitBy = att.id;
      vic.lastHitT = this.time;
      att.lastAttackedId = vic.id;
      att.lastAttackedT = this.time;

      // ZERO knockback on vic (vic.vx & vic.vz completely untouched!)
      // ZERO stun, ZERO squish, ZERO flinch / interruption
      vic.stunT = 0;
      vic.squishT = 0;
      vic.slowT = 0;

      const rv = radiusOf(vic.mass);
      this.events.push({
        k: 'hit',
        a: att.id,
        v: vic.id,
        x: r2(vic.x - nx * rv),
        z: r2(vic.z - nz * rv),
        s: 12,
        loss: Math.round(loss * 10) / 10,
      });
      return;
    }

    // Evolved species immunity: immune to stun, flinch, knockback, and loss from animals < 1 ton (unless rainbow powered!)
    if (isEvolvedSpecies(vic.species) && att.mass < 1000 && !(att.superT > 0)) {
      att.vx = -nx * 18;
      att.vz = -nz * 18;
      att.dashT = 0;
      att.plow = false;
      att.stunT = Math.max(att.stunT, 0.4);
      att.dashHit.add(vic.id);
      this.events.push({ k: 'hit', a: att.id, v: vic.id, x: r2(vic.x), z: r2(vic.z), s: 18, loss: 0 });
      return;
    }

    const ma = att.mass, mv = vic.mass * TRAITS[vic.species].weight;
    const ramFactor = TRAITS[att.species].ram ?? 1.0;
    // Dynamic knockback ceiling based on mass ratio, charging power and speed
    const massAdvantage = Math.pow(ma / mv, 0.4);
    const chargeAdvantage = att.power > 1.0 ? (1 + (att.power - 1) * 0.45) : 1.0;
    const speedRatio = Math.max(1.0, speed / 10.0);
    const dynamicMax = clamp(CFG.KNOCKBACK_MAX * Math.max(0.65, Math.min(2.6, massAdvantage * chargeAdvantage * speedRatio)), CFG.KNOCKBACK_MIN + 10, 78);
    let k = clamp(speed * att.power * ramFactor * CFG.KNOCKBACK * Math.pow(ma / mv, 0.38), CFG.KNOCKBACK_MIN, dynamicMax);

    // Rule: "titan" (Titan clash - colossal impacts)
    if (this.currentRule === 'titan') {
      k = Math.min(CFG.KNOCKBACK_MAX * 1.5, k * 1.4);
    }

    // Rule: "squealer" (Propaganda empowers King with 1.8x ram force)
    if (this.currentRule === 'squealer' && att.id === this.napoleonId) {
      k = Math.min(CFG.KNOCKBACK_MAX * 1.6, k * 1.6);
    }

    // Weapon: Dynamite explosion
    const isDynamite = att.hasDynamite;
    let boomX = 0, boomZ = 0;
    if (att.hasDynamite) {
      att.hasDynamite = false;
      k = Math.max(k * 2.2, 50);
      boomX = r2((att.x + vic.x) / 2);
      boomZ = r2((att.z + vic.z) / 2);
      this.events.push({ k: 'boom', id: att.id, x: boomX, z: boomZ });
      const BOOM_R = 9.0;
      for (const bystander of this.players.values()) {
        if (!bystander.alive || bystander.id === att.id) continue;
        const bdx = bystander.x - boomX;
        const bdz = bystander.z - boomZ;
        const bdist = Math.hypot(bdx, bdz);
        if (bdist < BOOM_R && bdist > 0.01) {
          const bForce = clamp((1 - bdist / BOOM_R) * 38, 10, 34);
          bystander.vx += (bdx / bdist) * bForce;
          bystander.vz += (bdz / bdist) * bForce;
        }
      }
    }

    // Super Rainbow Dash: violent massive knockback launching victim across arena into fence (doubled power)
    if (att.superT > 0) {
      k = Math.max(k * 4.4, 150);
      // Giảm 1/2 uy lực bị húc văng bởi cầu vồng đối với các loài thú khổng lồ
      if (vic.species === 'gorilla' || vic.species === 'mammoth' || vic.species === 'bull' || vic.species === 'ram' || vic.species === 'boar') {
        k *= 0.5;
      }
    }

    vic.vx = nx * k + vic.vx * 0.15;
    vic.vz = nz * k + vic.vz * 0.15;
    vic.stunT = 0;
    vic.dashT = 0; vic.plow = false; vic.holdT = 0; vic.charging = false; vic.pressed = false;
    att.dashHit.add(vic.id);
    if (att.plow || (att.species === 'mammoth' && vic.mass < 100)) { att.vx *= 0.8; att.vz *= 0.8; }
    else { att.dashT = 0; att.vx *= 0.25; att.vz *= 0.25; }

    // Boar: mud blast slows target 50% for 2s, or 70% for 3.5s when rainbow powered
    if (att.species === 'boar' && (att.plow || att.superT > 0)) {
      vic.slowT = Math.max(vic.slowT, att.superT > 0 ? 3.5 : 2.0);
    }

    // Ram: battering ram stun & double knockback on max charge, rainbow slams into fence
    if (att.species === 'ram') {
      if (att.power >= 5.5) {
        k *= 2.2;
        vic.tossT = 1.0;
        vic.flyT = 1.0;
        vic.vx = nx * k + vic.vx * 0.15;
        vic.vz = nz * k + vic.vz * 0.15;
        this.events.push({ k: 'ramKnockback', id: att.id, targetId: vic.id, x: r2(vic.x), z: r2(vic.z), rainbow: att.superT > 0 });
      }
      if (att.superT > 0) {
        k = Math.max(k * 2.5, 260);
        vic.tossT = 1.8;
        vic.flyT = 1.8;
        vic.vx = nx * k;
        vic.vz = nz * k;
        const fenceDist = CFG.R - 1.5;
        const projX = vic.x + nx * (k * 0.25);
        const projZ = vic.z + nz * (k * 0.25);
        if (Math.hypot(projX, projZ) >= fenceDist) {
          vic.x = (projX / Math.hypot(projX, projZ)) * fenceDist;
          vic.z = (projZ / Math.hypot(projX, projZ)) * fenceDist;
          this.kill(vic, 'fence');
        }
      }
      const ramStun = att.superT > 0 ? 2.5 : 1.0;
      vic.stunT = Math.max(vic.stunT, ramStun);
    }

    // Bull: ferocious gore and mass siphon, plus toss & squish on max charge
    if (att.species === 'bull') {
      if (att.power >= 4.0) {
        vic.tossT = 1.2;
        vic.stunT = Math.max(vic.stunT, 1.8);
      } else {
        vic.stunT = Math.max(vic.stunT, att.superT > 0 ? 0.9 : 0.45);
      }
      const siphonPct = att.superT > 0 ? 0.12 : 0.05;
      const stolen = Math.min(vic.mass - 10, Math.round(vic.mass * siphonPct));
      if (stolen > 0) {
        vic.mass -= stolen;
        att.mass += stolen;
      }
    }

    // Swan: ice wave surges and slides victim (24 speed + 1.2s freeze stun with rainbow)
    if (att.species === 'swan') {
      const slideF = att.superT > 0 ? 24 : 12;
      vic.vx += nx * slideF;
      vic.vz += nz * slideF;
      if (att.superT > 0) {
        vic.stunT = Math.max(vic.stunT, 1.2);
      }
    }

    // Phoenix: fiery blaze singes victim and scatters food (18% with rainbow)
    if (att.species === 'phoenix') {
      const dropPct = att.superT > 0 ? 0.18 : 0.08;
      const burnDrop = Math.min(vic.mass - 10, Math.round(vic.mass * dropPct));
      if (burnDrop > 0) {
        vic.mass -= burnDrop;
        this.scatter(
          vic.x, vic.z, burnDrop,
          radiusOf(vic.mass) + (att.superT > 0 ? 2.5 : 1.5),
          nx * (att.superT > 0 ? 16 : 9),
          nz * (att.superT > 0 ? 16 : 9)
        );
        if (att.superT > 0) {
          vic.stunT = Math.max(vic.stunT, 0.8);
        }
      }
    }

    // Ram: Sừng kim cương phản chấn cực mạnh đối thủ lùi xa
    if (att.species === 'ram') {
      vic.vx += nx * (att.superT > 0 ? 32 : 18);
      vic.vz += nz * (att.superT > 0 ? 32 : 18);
      vic.stunT = Math.max(vic.stunT, att.superT > 0 ? 1.5 : 1.0);
    }

    // Boar: Nanh sắt cày ủi hất văng và rơi thêm thức ăn
    if (att.species === 'boar') {
      vic.vx += nx * (att.superT > 0 ? 28 : 16);
      vic.vz += nz * (att.superT > 0 ? 28 : 16);
      vic.stunT = Math.max(vic.stunT, att.superT > 0 ? 1.2 : 0.7);
      const boarDrop = Math.min(vic.mass - 10, Math.round(vic.mass * (att.superT > 0 ? 0.12 : 0.05)));
      if (boarDrop > 0) {
        vic.mass -= boarDrop;
        this.scatter(vic.x, vic.z, boarDrop, radiusOf(vic.mass) + 1.5, nx * 10, nz * 10);
      }
    }

    // Elephant passive: when mass >= 1000kg, ramming instantly squashes & kills rivals under 50kg (like Farmer Till's tractor)
    if (att.species === 'elephant' && att.mass >= 1000 && vic.mass < 50) {
      vic.squishT = 2.8;
      vic.stunT = 2.0;
      vic.charging = false;
      vic.dashT = 0;
      vic.plow = false;
      vic.lastHitBy = att.id;
      vic.lastHitT = this.time;
      att.lastAttackedId = vic.id;
      att.lastAttackedT = this.time;
      const rv = radiusOf(vic.mass);
      this.events.push({
        k: 'hit',
        a: att.id,
        v: vic.id,
        x: r2(vic.x - nx * rv),
        z: r2(vic.z - nz * rv),
        s: Math.round(k),
        loss: 0,
      });
      this.kill(vic, 'crush');
      return;
    }

    // Mammoth passive: ramming instantly squashes & kills rivals under 100kg!
    if (att.species === 'mammoth' && vic.mass < 100) {
      vic.squishT = 3.0;
      vic.stunT = 2.0;
      vic.charging = false;
      vic.dashT = 0;
      vic.plow = false;
      vic.lastHitBy = att.id;
      vic.lastHitT = this.time;
      att.lastAttackedId = vic.id;
      att.lastAttackedT = this.time;
      const rv = radiusOf(vic.mass);
      this.events.push({
        k: 'hit',
        a: att.id,
        v: vic.id,
        x: r2(vic.x - nx * rv),
        z: r2(vic.z - nz * rv),
        s: Math.round(k),
        loss: 0,
      });
      if (!vic.adminGod) {
        this.kill(vic, 'crush');
        return;
      }
    }

    if (isDynamite) {
      vic.lastHitBy = att.id;
      vic.lastHitT = this.time;
      att.lastAttackedId = vic.id;
      att.lastAttackedT = this.time;
      if (vic.adminGod) {
        // God mode: immune to dynamite damage
        return;
      }
      // Animals under 100kg immediately explode and die
      if (vic.mass < 100) {
        this.kill(vic, 'dynamite');
        return;
      }
      // Animals >= 100kg lose 25% of current mass, with at least 100kg lost
      const loss = Math.max(100, Math.round(vic.mass * 0.25));
      vic.mass -= loss;
      if (vic.mass <= 10) {
        this.kill(vic, 'dynamite');
        return;
      }
      if (loss > 0.5) {
        this.scatter(boomX, boomZ, loss, radiusOf(vic.mass) + 3.5, nx, nz);
      }
      const rv = radiusOf(vic.mass);
      this.events.push({
        k: 'hit',
        a: att.id,
        v: vic.id,
        x: r2(vic.x - nx * rv),
        z: r2(vic.z - nz * rv),
        s: Math.round(k),
        loss: Math.round(loss * 10) / 10,
      });
      return;
    }

    let loss = vic.adminGod ? 0 : Math.min(vic.mass - CFG.MIN_MASS, vic.mass * CFG.HIT_LOSS * att.power * clamp(ma / mv, 0.5, 1.5));
    // Pitchfork (10s duration, max 3 hits: hit 1 = 30%, hit 2 = 20%, hit 3 = 10%)
    if (att.pitchforkT > 0 && (att.pitchforkHits ?? 3) > 0) {
      const hitsLeft = att.pitchforkHits ?? 3;
      const pct = hitsLeft === 3 ? 0.30 : hitsLeft === 2 ? 0.20 : 0.10;
      loss = Math.min(vic.mass - CFG.MIN_MASS, Math.max(2, Math.round(vic.mass * pct)));
      att.pitchforkHits = hitsLeft - 1;
      if (att.pitchforkHits <= 0) {
        att.pitchforkT = 0;
        att.pitchforkHits = 0;
      }
      const steal = Math.round(loss * 0.5);
      if (steal > 0) {
        att.mass += steal;
        att.best = Math.max(att.best, att.mass);
      }
    }
    if (loss > 0.5) {
      vic.mass -= loss;
      this.scatter(vic.x, vic.z, loss, radiusOf(vic.mass) + 0.8, nx, nz);
    }
    vic.lastHitBy = att.id;
    vic.lastHitT = this.time;
    att.lastAttackedId = vic.id;
    att.lastAttackedT = this.time;
    const rv = radiusOf(vic.mass);
    this.events.push({
      k: 'hit',
      a: att.id,
      v: vic.id,
      x: r2(vic.x - nx * rv),
      z: r2(vic.z - nz * rv),
      s: Math.round(k),
      loss: loss > 0.5 ? Math.round(loss * 10) / 10 : 0,
    });
  }

  private kill(p: Player, cause: DeathCause): void {
    if (p.adminGod) return;
    if (p.hasHeart) {
      p.hasHeart = false;
      p.heartReviving = true;
      p.heartReviveTimer = 3.0;
      p.heartReviveMass = p.mass;
      p.heartDeathX = p.x;
      p.heartDeathZ = p.z;
      p.alive = false;
      p.dashT = 0; p.stunT = 0; p.charging = false; p.pressed = false; p.holdT = 0;
      p.superT = 0; p.flyT = 0; p.flightT = 0; p.burnT = 0; p.tossT = 0; p.wheelT = 0; p.speedT = 0; p.shieldT = 0;
      p.pitchforkT = 0; p.pitchforkHits = 0; p.hasDynamite = false;
      p.inWaterT = 0; p.slowT = 0; p.squishT = 0;
      p.monkeyLeapT = 0; p.monkeyBounced = false; p.treeShakeT = 0;
      p.treeShakeTreeId = undefined;
      p.treeShakeTimer = undefined;
      p.treeShakeDropStage = undefined;
      p.mammothRoarT = 0;
      p.wolfFrenzyT = 0;
      p.wolfLungeT = 0;
      p.wolfBitesLeft = 0;
      p.wolfTargetId = undefined;
      p.wolfChainTargets = undefined;
      // Hồi sinh bằng Trái Tim giữ nguyên hình dạng hiện tại (kể cả đang biến hình từ chuối, Gorilla/Mammoth)
      // vì client chỉ đồng bộ loài qua sự kiện 'morph' — đổi loài ngầm ở đây khiến hình là Voi nhưng kỹ năng lại là Khỉ.
      // Thời gian biến hình còn lại (morphT) tạm dừng trong 3s hồi sinh và tiếp tục đếm sau khi sống lại.
      for (const [mid, m] of this.minions) {
        if (m.ownerId === p.id) this.minions.delete(mid);
      }

      const wasKing = (p.id === this.napoleonId && this.napoleonId > 0);
      const credited = p.lastHitBy && this.time - p.lastHitT < CFG.CREDIT_TIME ? this.players.get(p.lastHitBy) : undefined;
      const killer = credited && credited.alive && credited !== p ? credited : undefined;
      if (killer) {
        const spoils = Math.round(p.mass * CFG.KILL_SPOILS);
        killer.mass += spoils;
        killer.kills++;
        killer.totalKills = (killer.totalKills || 0) + 1;
        killer.streak++;
        if (killer.team !== undefined && p.team !== undefined && killer.team !== p.team) {
          if (wasKing) {
            this.teamScores[killer.team] += 5;
            killer.score = (killer.score || 0) + 300;
          } else {
            this.teamScores[killer.team] += 1;
            killer.score = (killer.score || 0) + 100;
          }
        } else {
          killer.score = (killer.score || 0) + (wasKing ? 300 : 100);
        }
      }

      if (wasKing) {
        const prevKing = this.players.get(p.id);
        const dur = Math.round(this.napoleonReign);
        if (dur >= 5 && prevKing) {
          this.hof.push([prevKing.name, prevKing.species, dur]);
          this.hof.sort((a, b) => b[2] - a[2]);
          this.hof = this.hof.slice(0, 3);
        }

        if (killer) {
          this.napoleonId = killer.id;
          this.napoleonReign = 0;
          this.clearRule();
          this.podiumCaptor = killer.id;
          this.podiumProgress = 1.0;
          this.podiumPhaseTimer = 30;
          this.podiumWarned5s = false;
          this.summonKingGuards(killer);
          if (killer.team !== undefined) {
            this.teamScores[killer.team] += 5;
          }
          killer.score = (killer.score || 0) + 250;
          this.events.push({ k: 'napoleon', id: killer.id, usurped: true });
          this.startKingChoice();
        } else {
          this.napoleonId = 0;
          this.napoleonReign = 0;
          this.clearRule();
          this.kingChoice = null;
          this.podiumProgress = 0;
          this.podiumCaptor = 0;
          this.podiumPhaseTimer = 30;
          this.podiumWarned5s = false;
          this.events.push({ k: 'napoleon', id: 0 });
        }
      }

      this.events.push({
        k: 'heartRevive',
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        mass: Math.round(p.mass),
        dur: 3.0,
      });
      return;
    }

    p.alive = false;
    p.dashT = 0; p.stunT = 0; p.charging = false; p.pressed = false; p.holdT = 0;
    p.superT = 0; p.flyT = 0; p.flightT = 0; p.burnT = 0; p.tossT = 0; p.wheelT = 0; p.speedT = 0; p.shieldT = 0;
    p.pitchforkT = 0; p.pitchforkHits = 0; p.hasDynamite = false;
    p.monkeyLeapT = 0; p.monkeyBounced = false; p.treeShakeT = 0;
    p.treeShakeTreeId = undefined;
    p.treeShakeTimer = undefined;
    p.treeShakeDropStage = undefined;
    p.mammothRoarT = 0;
    p.wolfFrenzyT = 0;
    p.wolfLungeT = 0;
    p.wolfBitesLeft = 0;
    p.wolfTargetId = undefined;
    p.wolfChainTargets = undefined;
    if (DEVOLVED_PAIRS[p.species]) {
      p.species = DEVOLVED_PAIRS[p.species];
    }
    if (p.morphOrigSpecies) {
      p.species = p.morphOrigSpecies;
      delete p.morphOrigSpecies;
      delete p.morphT;
    }
    for (const [mid, m] of this.minions) {
      if (m.ownerId === p.id) this.minions.delete(mid);
    }

    const wasKing = (p.id === this.napoleonId && this.napoleonId > 0);
    const credited = p.lastHitBy && this.time - p.lastHitT < CFG.CREDIT_TIME ? this.players.get(p.lastHitBy) : undefined;
    const killer = credited && credited.alive && credited !== p ? credited : undefined;
    let spoils = 0;
    if (killer) {
      const isKingKill = wasKing;
      const isSnowballTraitor = this.currentRule === 'snowball' && this.ranked.length > 1 && p.id === (this.ranked[0]?.id === this.napoleonId ? this.ranked[1]?.id : this.ranked[0]?.id);
      const mult = isSnowballTraitor ? 3.0 : isKingKill ? 1.5 : 1.0;
      spoils = Math.round(p.mass * CFG.KILL_SPOILS * mult);
      killer.mass += spoils;
      killer.kills++;
      killer.totalKills = (killer.totalKills || 0) + 1;
      killer.streak++;
      if (killer.team !== undefined && p.team !== undefined && killer.team !== p.team) {
        if (isKingKill) {
          this.teamScores[killer.team] += 5; // +5 points for team when defeating enemy King
          killer.score = (killer.score || 0) + 300; // +300 personal score
        } else {
          this.teamScores[killer.team] += 1; // +1 point for regular enemy KO
          killer.score = (killer.score || 0) + 100; // +100 personal score
        }
      } else {
        killer.score = (killer.score || 0) + (isKingKill ? 300 : 100);
      }
    }
    // what's left of it falls back inside the fence
    const d = Math.hypot(p.x, p.z), lim = CFG.R - 4;
    const fx = d > lim ? (p.x / d) * lim : p.x, fz = d > lim ? (p.z / d) * lim : p.z;
    this.scatter(fx, fz, p.mass * CFG.DEATH_DROP, 1.2);
    this.events.push({
      k: 'die', id: p.id, by: killer ? killer.id : 0, cause, x: r2(p.x), z: r2(p.z), mass: Math.round(p.mass),
      best: Math.round(p.best), kills: p.kills, alive: Math.round(this.time - p.bornT), spoils,
      streak: killer ? killer.streak : 0,
    });
    p.streak = 0;
    if (p.bot) p.respawnT = CFG.BOT_RESPAWN;

    if (wasKing) {
      const prevKing = this.players.get(p.id);
      const dur = Math.round(this.napoleonReign);
      if (dur >= 5 && prevKing) {
        this.hof.push([prevKing.name, prevKing.species, dur]);
        this.hof.sort((a, b) => b[2] - a[2]);
        this.hof = this.hof.slice(0, 3);
      }

      if (killer) {
        // Killer slays the King and usurps the throne as the new King!
        this.napoleonId = killer.id;
        this.napoleonReign = 0;
        this.clearRule();
        this.podiumCaptor = killer.id;
        this.podiumProgress = 1.0;
        this.podiumPhaseTimer = 30;
        this.podiumWarned5s = false;
        this.summonKingGuards(killer);
        if (killer.team !== undefined) {
          this.teamScores[killer.team] += 5; // +5 points for team for crown usurpation
        }
        killer.score = (killer.score || 0) + 250;
        this.events.push({ k: 'napoleon', id: killer.id, usurped: true });
        this.startKingChoice();
      } else {
        // King fell to hazards/environment with no killer credited - throne becomes vacant
        this.napoleonId = 0;
        this.napoleonReign = 0;
        this.clearRule();
        this.kingChoice = null;
        this.podiumProgress = 0;
        this.podiumCaptor = 0;
        this.podiumPhaseTimer = 30;
        this.podiumWarned5s = false;
        this.events.push({ k: 'napoleon', id: 0 });
      }
    }
  }

  // ------------------------------------------------------------------ food

  private eat(list: Player[]): void {
    const consumeFood = (p: Player, f: Food) => {
      let gain = f.v;
      if (f.k === 6) {
        p.superT = 10;
        p.flyT = 0;
        p.score = (p.score || 0) + 150;
        if (p.team !== undefined) {
          this.teamScores[p.team] += 3;
        }
        this.events.push({ k: 'super', id: p.id });
      }
      // Rule: "corn" (Corn is for pigs and Napoleon: 3x value, 1/3 for others)
      if (this.currentRule === 'corn' && (f.k === 0 || f.k === 2)) {
        if (p.species === 'pig' || p.id === this.napoleonId) {
          gain *= 3;
        } else {
          gain = Math.max(0.5, gain / 3);
        }
      }
      p.mass += gain;
      p.best = Math.max(p.best, p.mass);
      p.score = (p.score || 0) + Math.round(gain * 2);
      p.lastEatT = this.time;
      this.food.delete(f.id);
      this.foodRemoved.push(f.id);
    };

    for (const p of list) {
      if (!p.alive) continue;
      // Cannot eat food for 0.3s right after being rammed (prevents instantly re-eating dropped food while flying)
      if (this.time - p.lastHitT < 0.3) continue;

      const baseR = radiusOf(p.mass) + 0.45;
      const baseRSq = baseR * baseR;
      const prevX = p.prevX ?? p.x;
      const prevZ = p.prevZ ?? p.z;

      // BƯỚC A: Xử lý Lag-Compensated Eat Hints từ Client (chống cắt góc khi bẻ lái)
      if (p.pendingEatHints && p.pendingEatHints.length > 0) {
        const lagCompR = baseR + 1.35;
        const lagCompRSq = lagCompR * lagCompR;

        for (const hintedId of p.pendingEatHints) {
          const f = this.food.get(hintedId);
          if (!f) continue;
          const dSq = distToSegmentSq(f.x, f.z, prevX, prevZ, p.x, p.z);
          if (dSq <= lagCompRSq) {
            consumeFood(p, f);
          }
        }
        p.pendingEatHints.length = 0;
      }

      // BƯỚC B: Quét va chạm đoạn thẳng (Swept Segment-Circle) chuẩn trên Server
      const minX = Math.min(prevX, p.x) - baseR;
      const maxX = Math.max(prevX, p.x) + baseR;
      const minZ = Math.min(prevZ, p.z) - baseR;
      const maxZ = Math.max(prevZ, p.z) + baseR;

      for (const f of this.food.values()) {
        if (f.x < minX || f.x > maxX || f.z < minZ || f.z > maxZ) continue;
        const dSq = distToSegmentSq(f.x, f.z, prevX, prevZ, p.x, p.z);
        if (dSq <= baseRSq) {
          consumeFood(p, f);
        }
      }
    }
  }

  private addFood(x: number, z: number, k: FoodKind, v: number): void {
    const f: Food = { id: this.nextFood++, x, z, k, v };
    this.food.set(f.id, f);
    this.foodAdded.push([f.id, r2(x), r2(z), k, Math.round(v * 10) / 10]);
  }

  /** Checks if (x, z) is blocked by hay bales, tree trunks, or wells with reachability safety margin */
  isBlockedByObstacle(x: number, z: number, margin = 1.4): boolean {
    if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + margin)) return true;
    if (this.treeSims.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + margin)) return true;
    if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + margin + 0.4)) return true;
    return false;
  }

  /** Pushes (x, z) safely radially outside any overlapping tree, hay bale, or well rim */
  pushOutsideObstacles(x: number, z: number, margin = 1.4): [number, number] {
    let curX = x, curZ = z;
    // Push out of trees
    for (const t of this.treeSims) {
      const dist = Math.hypot(curX - t.x, curZ - t.z);
      const safeR = t.r + margin;
      if (dist < safeR) {
        const ang = dist > 0.01 ? Math.atan2(curZ - t.z, curX - t.x) : Math.random() * Math.PI * 2;
        curX = t.x + Math.cos(ang) * safeR;
        curZ = t.z + Math.sin(ang) * safeR;
      }
    }
    // Push out of hay bales
    for (const [hx, hz, hr] of this.map.hay) {
      const dist = Math.hypot(curX - hx, curZ - hz);
      const safeR = hr + margin;
      if (dist < safeR) {
        const ang = dist > 0.01 ? Math.atan2(curZ - hz, curX - hx) : Math.random() * Math.PI * 2;
        curX = hx + Math.cos(ang) * safeR;
        curZ = hz + Math.sin(ang) * safeR;
      }
    }
    // Push out of wells
    for (const [wx, wz, wr] of (this.map.well || [])) {
      const dist = Math.hypot(curX - wx, curZ - wz);
      const safeR = wr + margin + 0.4;
      if (dist < safeR) {
        const ang = dist > 0.01 ? Math.atan2(curZ - wz, curX - wx) : Math.random() * Math.PI * 2;
        curX = wx + Math.cos(ang) * safeR;
        curZ = wz + Math.sin(ang) * safeR;
      }
    }
    // Keep within fence
    const d = Math.hypot(curX, curZ);
    const maxR = CFG.R - 2.0;
    if (d > maxR) {
      curX = (curX / d) * maxR;
      curZ = (curZ / d) * maxR;
    }
    return [curX, curZ];
  }

  private spawnFood(): void {
    let x = 0, z = 0;
    // Requirement 1: 8% chance to place food directly on campfire as a tempting trap for greedy players
    if (this.map.fire && this.map.fire.length > 0 && this.rnd() < 0.08) {
      const [fx, fz, fr] = this.map.fire[Math.floor(this.rnd() * this.map.fire.length)];
      const a = this.rnd() * Math.PI * 2;
      const d = this.rnd() * Math.max(0.6, (fr || 2.2) * 0.7);
      x = fx + Math.cos(a) * d;
      z = fz + Math.sin(a) * d;
    } else {
      let placed = false;
      for (let i = 0; i < 30; i++) {
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * (CFG.R - 4.5);
        const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
        if (this.isBlockedByObstacle(cx, cz, 1.4)) continue;
        x = cx; z = cz;
        placed = true;
        break;
      }
      if (!placed) {
        [x, z] = this.pushOutsideObstacles(x, z, 1.4);
      }
    }
    let roll = this.rnd() * (FOOD_WEIGHT as readonly number[]).reduce((s, w) => s + w, 0);
    let k = 0 as FoodKind;
    for (let i = 0; i < FOOD_WEIGHT.length; i++) {
      roll -= FOOD_WEIGHT[i];
      if (roll <= 0) { k = i as FoodKind; break; }
    }
    this.addFood(x, z, k, FOOD_KG[k]);
  }

  /** knock `kg` loose around (x, z) as a few food pieces, flung mostly along (dx, dz) if given */
  private scatter(x: number, z: number, kg: number, rad: number, dx = 0, dz = 0): void {
    const n = clamp(Math.ceil(kg / 2.5), 1, 14);
    const v = kg / n;
    const k: FoodKind = v >= 9 ? 7 : v >= 5 ? 4 : v >= 2 ? 1 : 0;
    const base = Math.atan2(dz, dx), aimed = dx !== 0 || dz !== 0;
    for (let i = 0; i < n; i++) {
      const a = aimed ? base + (this.rnd() - 0.5) * 2.4 : this.rnd() * Math.PI * 2;
      const d = rad + this.rnd() * 3;
      let fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;

      // Push safely outside trees, hay bales, and stone wells so food is never unreachable
      [fx, fz] = this.pushOutsideObstacles(fx, fz, 1.4);

      this.addFood(fx, fz, k, v);
    }
  }

  public summonKingGuards(king: Player): void {
    let currentMinions = 0;
    for (const m of this.minions.values()) {
      if (m.ownerId === king.id && m.alive) currentMinions++;
    }
    const needed = Math.max(0, 10 - currentMinions);
    const bodyR = radiusOf(king.mass);
    for (let i = 0; i < needed; i++) {
      const mid = this.nextMinionId++;
      const orbitAng = (i / 10) * Math.PI * 2;
      const spawnDist = bodyR + 2.0;
      const mx = king.x + Math.cos(orbitAng) * spawnDist;
      const mz = king.z + Math.sin(orbitAng) * spawnDist;
      this.minions.set(mid, {
        id: mid,
        ownerId: king.id,
        x: r2(mx),
        z: r2(mz),
        vx: 0,
        vz: 0,
        a: king.a,
        mass: 50,
        species: king.species,
        skin: king.skin,
        targetId: 0,
        alive: true,
        cd: 0,
        orbitAngle: orbitAng,
      });
    }
  }

  private spawnTool(): void {
    const hasKing = this.napoleonId > 0 && !!this.players.get(this.napoleonId)?.alive;
    const kinds: ToolKind[] = [
      'pitchfork', 'pitchfork',
      'dynamite', 'dynamite',
      'wheel', 'wheel',
      'star', 'star', 'star',
      'banana', 'banana', 'banana',
      'speed', 'speed', 'speed',
      'shield', 'shield', 'shield',
    ];
    // Requirement: Hát vang Tổng tấn công giảm 1 nửa tỉ lệ và CHỈ xuất hiện khi có Vua
    if (hasKing) {
      kinds.push('song');
    }
    const kind = kinds[Math.floor(this.rnd() * kinds.length)];
    let bx = 0, bz = 0;

    for (let tries = 0; tries < 50; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 8 + Math.sqrt(this.rnd()) * (CFG.R - 22);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 2.8)) continue;
      // Requirement 1: Special items avoid hay bales, trees, and strictly avoid campfire
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2.8)) continue;
      if (this.treeSims.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 2.8)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < (fr || 2.5) + 2.8)) continue;
      // Requirement 4: Distribute items evenly, avoid clustering right next to existing tools
      const minToolDist = tries < 25 ? 8.5 : 5.0;
      let tooClose = false;
      for (const t of this.tools.values()) {
        if (Math.hypot(x - t.x, z - t.z) < minToolDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      bx = x; bz = z;
      break;
    }
    const id = this.nextTool++;
    this.tools.set(id, { id, kind, x: r2(bx), z: r2(bz), age: 0 });
  }

  private spawnSuperCandy(): void {
    let bx = 0, bz = 0;
    for (let tries = 0; tries < 40; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 6 + Math.sqrt(this.rnd()) * (CFG.R - 18);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 2.8)) continue;
      // Requirement 1: Super Candy strictly avoids hay bales, trees, and campfire
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2.8)) continue;
      if (this.treeSims.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 2.8)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < (fr || 2.5) + 2.8)) continue;
      bx = x; bz = z;
      break;
    }
    this.addFood(bx, bz, 6, 3);
    this.events.push({ k: 'superFood', x: r2(bx), z: r2(bz) });
  }

  public getLargestPond(): Blob | null {
    if (!this.map.pond || this.map.pond.length === 0) return null;
    return this.map.pond.reduce((max, p) => (p[2] > max[2] ? p : max), this.map.pond[0]);
  }

  private spawnDolphinHeart(): void {
    const pond = this.getLargestPond();
    if (!pond) return;
    const cx = pond[0];
    const cz = pond[1];
    // Don't spawn duplicate heart if uncollected heart already exists near center
    for (const t of this.tools.values()) {
      if (t.kind === 'heart' && Math.hypot(t.x - cx, t.z - cz) < 3.0) {
        return;
      }
    }
    const id = this.nextTool++;
    this.tools.set(id, { id, kind: 'heart', x: r2(cx), z: r2(cz), age: 0 });
  }

  private findSafeReviveSpot(origX: number, origZ: number): [number, number] {
    const radii = [4, 7, 10, 14, 18, 22, 26];
    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
    for (const r of radii) {
      const aOffset = this.rnd() * Math.PI * 2;
      for (const a of angles) {
        const x = origX + Math.cos(a + aOffset) * r;
        const z = origZ + Math.sin(a + aOffset) * r;
        if (Math.hypot(x, z) > CFG.R - 4) continue;
        if (terrainAt(this.map, x, z) !== 0) continue;
        if (this.map.pond?.some((b) => insideBlob(b, x, z, 1.2))) continue;
        if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < (fr || 2.5) + 3.0)) continue;
        if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 3.0)) continue;
        if (this.treeSims.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 2.0)) continue;
        if (this.map.hay?.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2.0)) continue;
        if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3.0) continue;
        return [r2(x), r2(z)];
      }
    }
    return [0, 0];
  }

  // ------------------------------------------------------------------ output

  init(): ServerMsg {
    return {
      t: 'init', cfg: CFG, map: this.map, tick: this.tick,
      players: [...this.players.values()].filter((p) => p.alive).map((p) => this.meta(p)),
      food: [...this.food.values()].map((f) => [f.id, r2(f.x), r2(f.z), f.k, Math.round(f.v * 10) / 10]),
      tools: [...this.tools.values()].map((t) => [t.id, t.kind, t.x, t.z]),
      matchDuration: this.matchDuration,
    };
  }

  snapshotFor(id: number): Snapshot {
    const p: PlayerWire[] = [];
    const traitorId = this.currentRule === 'snowball' && this.ranked.length > 1
      ? (this.ranked[0]?.id === this.napoleonId ? this.ranked[1]?.id : this.ranked[0]?.id)
      : 0;

    for (const o of this.players.values()) {
      if (!o.alive) continue;
      const flags = (o.dashT > 0 ? FLAG.DASH : 0) | (o.plow ? FLAG.PLOW : 0) | (o.charging ? FLAG.CHARGING : 0)
        | (o.stunT > 0 ? FLAG.STUN : 0) | (o.terrain === 1 ? FLAG.WATER : 0) | (o.terrain === 2 ? FLAG.MUD : 0)
        | (o.species !== 'duck' && o.species !== 'swan' && o.species !== 'dog' && o.species !== 'wolf' && o.species !== 'pegasus' && o.inWaterT > 0 ? FLAG.DROWNING : 0)
        | (o.slowT > 0 ? FLAG.SONG : 0)
        | (o.pitchforkT > 0 ? FLAG.PITCHFORK : 0)
        | (o.hasDynamite ? FLAG.DYNAMITE : 0)
        | (traitorId > 0 && o.id === traitorId ? FLAG.TRAITOR : 0)
        | (o.squishT > 0 ? FLAG.SQUISHED : 0)
        | (o.speedT > 0 ? FLAG.SPEED_BOOST : 0)
        | (o.shieldT > 0 ? FLAG.IMMUNITY : 0)
        | (o.hasHeart ? FLAG.HEART : 0)
        | (o.superT > 0 ? FLAG.SUPER : 0)
        | ((o.flyT > 0 || (o.flightT && o.flightT > 0) || (o.tossT && o.tossT > 0)) ? FLAG.FLYING : 0)
        | (o.wheelT > 0 ? FLAG.WHEEL : 0)
        | (o.monkeyLeapT && o.monkeyLeapT > 0 ? FLAG.MONKEY_LEAP : 0)
        | (o.treeShakeT && o.treeShakeT > 0 ? FLAG.TREE_SHAKE : 0)
        | (o.mammothRoarT && o.mammothRoarT > 0 ? FLAG.MAMMOTH_ROAR : 0)
        | (o.wolfFrenzyT && o.wolfFrenzyT > 0 ? FLAG.WOLF_FRENZY : 0)
        | (o.tossT && o.tossT > 0 ? FLAG.TOSSED : 0)
        | (o.burnT && o.burnT > 0 ? FLAG.BURNING : 0);
      p.push([o.id, r2(o.x), r2(o.z), r2(o.a), Math.round(o.mass), flags, o.charging ? Math.round(chargeLevel(o.holdT) * 10) : 0]);
    }
    let hofList = this.hof;
    if (this.napoleonId) {
      const curKing = this.players.get(this.napoleonId);
      const curDur = Math.round(this.napoleonReign);
      if (curKing && curDur >= 5) {
        const copy: [string, Species, number][] = [...this.hof];
        const exIdx = copy.findIndex(([name]) => name === curKing.name);
        if (exIdx >= 0) {
          if (curDur > copy[exIdx][2]) {
            copy[exIdx] = [curKing.name, curKing.species, curDur];
          }
        } else {
          copy.push([curKing.name, curKing.species, curDur]);
        }
        copy.sort((a, b) => b[2] - a[2]);
        hofList = copy.slice(0, 3);
      }
    }
    const snap: Snapshot = {
      t: 's',
      tick: this.tick,
      p,
      fa: this.foodAdded,
      fr: this.foodRemoved,
      ev: this.events,
      tl: [...this.tools.values()].map((t) => [t.id, t.kind, t.x, t.z]),
      mn: [...this.minions.values()].map((m): MinionWire => [
        m.id,
        m.ownerId,
        r2(m.x),
        r2(m.z),
        r2(m.a),
        Math.round(m.mass),
        m.species,
        m.skin,
      ]),
      pod: [this.podiumCaptor, Math.round(this.podiumProgress * 100) / 100, this.podiumContested],
      nap: this.napoleonId,
      rule: this.currentRule,
      reign: Math.round(this.napoleonReign),
      hof: hofList,
      podShield: [this.podiumShield, Math.ceil(this.podiumPhaseTimer)],
      trees: this.treeSims.map((t): TreeSyncWire => [
        t.id,
        t.getStage(),
        t.big,
        t.small,
        t.getFlowerCount(),
      ]),
    };
    if (this.tillTruck.active) {
      snap.truck = [r2(this.tillTruck.x), r2(this.tillTruck.z), r2(this.tillTruck.angle)];
    }
    if (this.tick % 5 === 0) {
      snap.lb = this.ranked.slice(0, 10).map((o): LeaderRow => [
        o.id,
        o.name,
        Math.round(o.mass),
        o.kills,
        o.id === this.napoleonId ? Math.round(this.napoleonReign) : 0,
      ]);
      snap.total = this.ranked.length;
    }
    const me = this.players.get(id);
    if (me) {
      snap.me = {
        kills: me.kills,
        cd: r2(me.cd),
        rank: me.alive ? this.ranked.indexOf(me) + 1 : 0,
        choice: id === this.napoleonId && this.kingChoice
          ? {
              options: this.kingChoice.options,
              left: Math.max(0, Math.ceil(this.kingChoice.expireT - this.time)),
            }
          : null,
      };
    }
    if (this.mode === 'team') {
      let count0 = 0;
      let count1 = 0;
      for (const o of this.players.values()) {
        if (o.team === 0) count0++;
        else if (o.team === 1) count1++;
      }
      snap.team = [Math.round(this.teamScores[0]), Math.round(this.teamScores[1]), Math.ceil(this.matchClock), count0, count1];
    } else if (this.mode === 'friend' && this.matchDuration > 0) {
      snap.team = [0, 0, Math.ceil(this.matchClock), 0, 0];
    }
    return snap;
  }

  /** Renew entire game world: new map layout, newly placed items, reset scores & clock, respawn players */
  renewGame(newSeed?: number): void {
    const seed = newSeed ?? ((Math.random() * 2 ** 31) | 0);
    this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.map = generateMap(seed);
    this.initTrees();
    this.food.clear();
    this.tools.clear();
    this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
    for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < CFG.TOOL_TARGET; i++) this.spawnTool();
    this.matchClock = this.mode === 'friend' ? this.matchDuration : 300;
    this.mapShiftTimer = 300;
    this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
    this.teamScores = [0, 0];
    this.matchEnded = false;
    this.matchEndTimer = 0;
    this.napoleonId = 0;
    this.napoleonReign = 0;
    this.podiumProgress = 0;
    this.podiumCaptor = 0;
    this.podiumContested = false;
    this.podiumShield = true;
    this.podiumPhaseTimer = 30;
    this.podiumWarned5s = false;
    this.hof = [];

    // Respawns bots at new free spots (in FFA); in team/friend mode no bots exist
    if (this.mode === 'team' || this.mode === 'friend') {
      this.botsEnabled = false;
    }
    for (const [id, p] of [...this.players.entries()]) {
      p.score = 0;
      p.kills = 0;
      p.totalKills = 0;
      if (p.bot) {
        if (this.mode === 'team' || this.mode === 'friend') {
          this.removePlayer(id);
        } else {
          this.spawn(p);
        }
      } else {
        p.alive = false;
      }
    }

    // Broadcast map event to all clients so they rebuild 3D world and food/items
    this.events.push({
      k: 'map',
      map: this.map,
      food: [...this.food.values()].map((f) => [f.id, r2(f.x), r2(f.z), f.k, Math.round(f.v * 10) / 10]),
      tools: [...this.tools.values()].map((t) => [t.id, t.kind, t.x, t.z]),
    });
  }

  /** Requirement 3: Transform map layout every 5 minutes without disrupting active players */
  shiftMap(newSeed?: number): void {
    const seed = newSeed ?? ((Math.random() * 2 ** 31) | 0);
    this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.map = generateMap(seed);
    this.initTrees();
    this.food.clear();
    this.tools.clear();
    this.dolphinHeartTimer = 30;
    this.dolphinDelivering = false;
    this.dolphinDeliveryTimer = 0;
    for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < CFG.TOOL_TARGET; i++) this.spawnTool();

    // Nudge alive players safely if they overlap with newly spawned trees or hay
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const t of this.treeSims) {
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < t.r + 2.0) {
          const ang = d > 0.01 ? Math.atan2(p.z - t.z, p.x - t.x) : Math.random() * Math.PI * 2;
          p.x = t.x + Math.cos(ang) * (t.r + 2.2);
          p.z = t.z + Math.sin(ang) * (t.r + 2.2);
        }
      }
      for (const [hx, hz, hr] of this.map.hay) {
        const d = Math.hypot(p.x - hx, p.z - hz);
        if (d < hr + 1.8) {
          const ang = d > 0.01 ? Math.atan2(p.z - hz, p.x - hx) : Math.random() * Math.PI * 2;
          p.x = hx + Math.cos(ang) * (hr + 2.0);
          p.z = hz + Math.sin(ang) * (hr + 2.0);
        }
      }
    }

    // Broadcast map transition event with transition: true flag
    this.events.push({
      k: 'map',
      map: this.map,
      food: [...this.food.values()].map((f) => [f.id, r2(f.x), r2(f.z), f.k, Math.round(f.v * 10) / 10]),
      tools: [...this.tools.values()].map((t) => [t.id, t.kind, t.x, t.z]),
      transition: true,
    });
  }

  public executeAdminCommand(playerId: number, cmd: AdminAction): void {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    if (p.name !== 'Admin9112267') return;

    switch (cmd.act) {
      case 'mass': {
        const num = Number(cmd.val);
        if (!Number.isFinite(num)) return;
        p.mass = Math.max(50, Math.min(50000, Math.floor(num)));
        if (p.mass >= 3000 && EVOLVED_PAIRS[p.species]) {
          p.species = EVOLVED_PAIRS[p.species]!;
          this.events.push({ k: 'morph', id: p.id, species: p.species, dur: 0.8 });
        } else if (p.mass < 1000 && DEVOLVED_PAIRS[p.species]) {
          p.species = DEVOLVED_PAIRS[p.species]!;
          this.events.push({ k: 'morph', id: p.id, species: p.species, dur: 0.8 });
        }
        this.events.push({ k: 'superFood', x: r2(p.x), z: r2(p.z) });
        break;
      }
      case 'species': {
        const validSpecies: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig', 'dog', 'elephant', 'monkey'];
        if (validSpecies.includes(cmd.val)) {
          let targetSpecies = cmd.val;
          if (p.mass >= 3000 && EVOLVED_PAIRS[targetSpecies]) {
            targetSpecies = EVOLVED_PAIRS[targetSpecies]!;
          }
          p.species = targetSpecies;
          this.events.push({ k: 'morph', id: p.id, species: p.species, dur: 0.8 });
        }
        break;
      }
      case 'spawn': {
        const count = Math.max(1, Math.min(30, Math.floor(Number(cmd.count) || 1)));
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * i) / count + (this.rnd() - 0.5) * 0.4;
          const d = 2.5 + this.rnd() * 3.5;
          let [fx, fz] = [p.x + Math.cos(a) * d, p.z + Math.sin(a) * d];
          [fx, fz] = this.pushOutsideObstacles(fx, fz, 1.4);

          if (cmd.item === 'rainbow_candy') {
            this.addFood(fx, fz, 6, 3);
            this.events.push({ k: 'superFood', x: r2(fx), z: r2(fz) });
          } else if (cmd.item === 'apple') {
            this.addFood(fx, fz, 1, FOOD_KG[1]);
          } else if (cmd.item === 'carrot') {
            this.addFood(fx, fz, 3, FOOD_KG[3]);
          } else if (cmd.item === 'corn') {
            this.addFood(fx, fz, 0, FOOD_KG[0]);
          } else if (cmd.item === 'pumpkin') {
            this.addFood(fx, fz, 4, FOOD_KG[4]);
          } else if (cmd.item === 'watermelon') {
            this.addFood(fx, fz, 7, FOOD_KG[7]);
          } else if (['pitchfork', 'dynamite', 'wheel', 'star', 'banana', 'speed', 'shield', 'heart', 'song'].includes(cmd.item)) {
            const id = this.nextTool++;
            this.tools.set(id, { id, kind: cmd.item as ToolKind, x: r2(fx), z: r2(fz), age: 0 });
          }
        }
        break;
      }
      case 'god': {
        p.adminGod = Boolean(cmd.val);
        break;
      }
      case 'rainbow': {
        p.adminPermaRainbow = Boolean(cmd.val);
        if (p.adminPermaRainbow) p.superT = 10;
        else p.superT = 0;
        break;
      }
      case 'speed': {
        p.adminSpeedMult = Math.max(1, Math.min(3, Number(cmd.val) || 1));
        break;
      }
      case 'till': {
        this.applyRule('till');
        break;
      }
      case 'clear_bots': {
        for (const [id, pl] of this.players.entries()) {
          if (pl.bot) this.removePlayer(id);
        }
        break;
      }
      case 'clear_food': {
        this.food.clear();
        this.tools.clear();
        break;
      }
      case 'add_bots': {
        const count = Math.max(1, Math.min(10, Math.floor(Number(cmd.count) || 5)));
        const speciesList: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig', 'dog', 'elephant', 'monkey'];
        for (let i = 0; i < count; i++) {
          const sp = speciesList[Math.floor(this.rnd() * speciesList.length)];
          this.addPlayer('Bot_' + Math.floor(100 + this.rnd() * 900), sp, true);
        }
        break;
      }
    }
  }

  /** call once per tick after every recipient got its snapshot */
  flush(): void {
    this.events = [];
    this.foodAdded = [];
    this.foodRemoved = [];
  }
}
