// The authoritative farm simulation. Phase 1 runs it inside the page; phase 2 runs the very same class in a
// Cloudflare Durable Object. It knows nothing about rendering or networking: inputs in, snapshots out.
import { thinkBot, newBrain, SPECIES_BOT_NAMES, SPECIES_NAMES_VI, type BotBrain } from './bots';
import {
  CFG, DT, FOOD_KG, FOOD_WEIGHT, SKIN_COUNT, SUBSTEPS, TRAITS, radiusOf,
  type FoodKind, type Species,
} from '../constants';
import { generateMap, type MapData, type TreeData, type TreeSize } from '../map';
import { clamp, insideBlob, mulberry32, distToSegmentSq } from '../math';
export { distToSegmentSq } from '../math';
import { type Body, type Terrain, collideHay, dashParams, chargeLevel, outsideFence, stepMove, terrainAt } from '../physics';
import {
  FLAG, type DeathCause, type FoodWire, type GameEvent, type Input, type LeaderRow, type MinionWire, type PlayerMeta,
  type PlayerWire, type ServerMsg, type Snapshot, type ToolKind, type TreeSyncWire,
} from '../protocol';

export interface Player extends Body {
  id: number;
  name: string;
  species: Species;
  skin: number;
  bot: boolean;
  alive: boolean;
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
  hasDynamite: boolean;
  slowT: number;
  superT: number;
  flyT: number;
  lastEatT: number;
  squishT: number;
  wheelT: number;
  prevX?: number;
  prevZ?: number;
  pendingEatHints?: number[];
  lastInputSeq?: number;
  team?: number;
  origSpecies?: Species;
  ai: BotBrain | null;
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
  tick = 0;
  time = 0;
  /** alive animals, heaviest first (refreshed every tick) */
  ranked: Player[] = [];

  private nextId = 1;
  private nextFood = 1;
  private nextTool = 1;
  private nextMinionId = 1;
  minions = new Map<number, Minion>();
  private toolSpawnTimer = 3;
  private superCandyTimer = 25;
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
    for (let i = 0; i < 7; i++) this.spawnTool();
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
    const id = this.nextId++;
    const startMass = species === 'elephant' ? 1000 : species === 'cow' ? 100 : CFG.START_MASS;
    const p: Player = {
      id, name: name.slice(0, 16), species,
      skin: skin !== undefined ? (skin % SKIN_COUNT) : Math.floor(this.rnd() * SKIN_COUNT),
      bot, alive: false,
      x: 0, z: 0, vx: 0, vz: 0, a: 0, mass: startMass, dashT: 0, stunT: 0, charging: false,
      input: { a: 0, mv: false, btn: false }, btnLatch: false, releaseLatch: false, releaseAimA: 0, pressed: false, holdT: 0, cd: 0, plow: false, power: 1,
      terrain: 0, dashHit: new Set(), lastHitBy: 0, lastHitT: -99, lastAttackedId: 0, lastAttackedT: -99, kills: 0, totalKills: 0, score: 0, streak: 0, bornT: 0, best: 0,
      respawnT: 0, inWaterT: 0, pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, lastEatT: 0, squishT: 0, wheelT: 0, team, ai: bot ? newBrain(this.rnd) : null,
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
    if (species) p.species = species;
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
    let spawnMass = p.species === 'elephant' ? 1000 : p.species === 'cow' ? 100 : CFG.START_MASS;
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
      pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, lastEatT: this.time, squishT: 0, wheelT: 0,
    });
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

    const BOT_SPECIES: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig'];
    if (this.players.size < CFG.BOT_FILL) {
      const sp = BOT_SPECIES[Math.floor(this.rnd() * BOT_SPECIES.length)];
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

  // ------------------------------------------------------------------ tick

  step(): void {
    this.tick++;
    this.time += DT;
    this.fillBots();

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

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.bot && (p.respawnT -= DT) <= 0) this.spawn(p);
        continue;
      }
      if (p.ai && p.bot) thinkBot(this, p, DT);
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
        if (p.wheelT > 0) {
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
          const tillSpeedMult = (this.tillTruck.active && p.id === this.napoleonId) ? 1.5 : 1.0;
          stepMove(p, p.input, h, p.species, p.terrain, tillSpeedMult);
          if (p.slowT > 0) {
            p.vx *= 0.85;
            p.vz *= 0.85;
          }
        }
        const wasStunned = p.stunT >= 1.4;
        const hayHit = collideHay(p, this.map.hay);
        if (hayHit && !wasStunned) {
          p.plow = false;
          p.charging = false;
          p.holdT = 0;
          p.pressed = false;
          p.btnLatch = false;
          this.events.push({ k: 'hit', a: 0, v: p.id, x: r2(p.x), z: r2(p.z), s: 3 });
        }

        // Podium protective shield barrier: blocks all animals from entering the podium area
        if (this.podiumShield) {
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
        if (this.treeSims.length > 0) {
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
                  // Stun for 1.5s
                  p.stunT = 1.5;
                  p.dashT = 0;
                  p.vx = nx * 8;
                  p.vz = nz * 8;

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
                  p.dashT = 0;
                  p.stunT = Math.max(p.stunT, 0.8);
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
        p.flyT = 0;
      }
      if (!p.alive) continue;

      // 1. Electric fence
      if (outsideFence(p)) {
        if (p.flyT > 0) {
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

      // 4. Pond drowning (ducks & dogs swim freely; other animals struggle for 1.5s before drowning)
      if (p.species !== 'duck' && p.species !== 'dog') {
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

    // Tool & Super Candy spawning (special items spawn 2x faster, max 8 tools)
    this.toolSpawnTimer -= DT;
    if (this.toolSpawnTimer <= 0) {
      this.toolSpawnTimer = 6 + this.rnd() * 4;
      if (this.tools.size < 8) {
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
      if (p.pitchforkT > 0) p.pitchforkT = Math.max(0, p.pitchforkT - DT);
      if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - DT);
      if (p.superT > 0) p.superT = Math.max(0, p.superT - DT);
      if (p.flyT > 0) p.flyT = Math.max(0, p.flyT - DT);
      if (p.squishT > 0) p.squishT = Math.max(0, p.squishT - DT);
      if (p.wheelT > 0) p.wheelT = Math.max(0, p.wheelT - DT);

      const pr = radiusOf(p.mass) + 1.2;
      for (const t of this.tools.values()) {
        const dist = Math.hypot(t.x - p.x, t.z - p.z);
        if (dist <= pr) {
          this.tools.delete(t.id);
          this.events.push({ k: 'tool', id: p.id, kind: t.kind, x: t.x, z: t.z });
          if (t.kind === 'pitchfork') {
            p.pitchforkT = 10;
          } else if (t.kind === 'dynamite') {
            p.hasDynamite = true;
          } else if (t.kind === 'wheel') {
            p.wheelT = 10;
          } else if (t.kind === 'star') {
            let count = 0;
            for (const m of this.minions.values()) {
              if (m.ownerId === p.id && m.alive) count++;
            }
            // Requirement 3: Max 6 normally, 8 at 1000kg (1 ton), 10 at 3000kg (3 tons)
            const maxMinions = p.mass >= 3000 ? 10 : (p.mass >= 1000 ? 8 : 6);
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
    if (this.currentRule === 'sunday' && this.napoleonId > 0) {
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
          // Spawn tractor at perimeter R = 54 facing inward
          const enterA = this.rnd() * Math.PI * 2;
          const sx = Math.cos(enterA) * 54;
          const sz = Math.sin(enterA) * 54;
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

        // Check ram collision with every alive player: INSTANT ELIMINATION!
        for (const p of alive) {
          if (!p.alive) continue;
          const dx = p.x - this.tillTruck.x;
          const dz = p.z - this.tillTruck.z;
          const rx = dx * cosA - dz * sinA;
          const rz = dx * sinA + dz * cosA;
          const pr = radiusOf(p.mass);
          // Collision box matching giant 2.4x model: front cutter blades (7.0) to rear cab/tires (-4.2)
          if (rx >= -4.2 - pr && rx <= 7.0 + pr && Math.abs(rz) <= 3.3 + pr) {
            p.squishT = 2.8; // Squished flat pancake!
            p.stunT = 2.0;   // Stunned
            p.charging = false;
            p.dashT = 0;
            p.plow = false;

            // Instantly eliminate: squished flat and killed!
            this.kill(p, 'till');
          }
        }

        // Disappear deep in the surrounding forest outside the fence (CFG.R = 70)
        if (this.tillTruck.exiting && distFromCenter > 74) {
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

        if (Math.hypot(this.tillTruck.x, this.tillTruck.z) > 74) {
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

  private dash(p: Player): void {
    if (p.terrain === 1) return;
    if (p.superT > 0) {
      p.a = p.input.a;
      p.vx = Math.cos(p.a) * 62;
      p.vz = Math.sin(p.a) * 62;
      p.dashT = 0.55;
      p.flyT = 0.55;
      p.plow = true;
      p.power = 5.0;
      p.cd = p.species === 'chicken' ? CFG.DASH_CD * 0.65 : CFG.DASH_CD;
      p.dashHit.clear();
      this.events.push({ k: 'fly', id: p.id, x: r2(p.x), z: r2(p.z) });
      return;
    }
    const d = dashParams(p.species, p.holdT, p.terrain);
    p.a = p.input.a;
    p.vx = Math.cos(p.a) * d.speed;
    p.vz = Math.sin(p.a) * d.speed;
    p.dashT = d.time;
    p.plow = d.plow;
    p.power = d.power;
    const baseCd = p.species === 'chicken' ? CFG.DASH_CD * 0.65 : CFG.DASH_CD;
    p.cd = baseCd + (d.plow ? CFG.PLOW_CD * (p.species === 'chicken' ? 0.65 : 1) : 0);
    p.dashHit.clear();
  }

  private collidePlayers(list: Player[]): void {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const ra = radiusOf(a.mass), rb = radiusOf(b.mass), minD = ra + rb;
        if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue;
        let d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
        const nx = dx / d, nz = dz / d;
        const ma = a.mass * TRAITS[a.species].weight, mb = b.mass * TRAITS[b.species].weight;

        // separate, the lighter one moves more
        const overlap = minD - Math.min(d, minD), wa = mb / (ma + mb);
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
            a.vx -= (jImp / ma) * nx; a.vz -= (jImp / ma) * nz;
            b.vx += (jImp / mb) * nx; b.vz += (jImp / mb) * nz;
          }
        }
      }
    }
  }

  private wheelCrush(attacker: Player, victim: Player, nx: number, nz: number): void {
    victim.squishT = 3.0; // Flattened squished animation
    victim.stunT = 1.2;
    victim.lastHitBy = attacker.id;
    victim.lastHitT = this.time;
    attacker.lastAttackedId = victim.id;
    attacker.lastAttackedT = this.time;
    const launchSpeed = 34;
    victim.vx = nx * launchSpeed;
    victim.vz = nz * launchSpeed;

    if (victim.mass < 80) {
      this.kill(victim, 'crush');
    } else {
      const lostMass = Math.min(victim.mass - 20, Math.max(50, Math.round(victim.mass * 0.4)));
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
    for (const [mid, m] of this.minions) {
      const owner = this.players.get(m.ownerId);
      if (!owner || !owner.alive || m.mass <= 5) {
        this.minions.delete(mid);
        continue;
      }

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
        m.a = aimA;
        const chaseSpeed = 15;
        m.vx = Math.cos(aimA) * chaseSpeed;
        m.vz = Math.sin(aimA) * chaseSpeed;
        m.x += m.vx * dt;
        m.z += m.vz * dt;

        const hitDist = radiusOf(m.mass) + radiusOf(target.mass) + 0.4;
        if (dist < hitDist && m.cd <= 0) {
          m.cd = 0.8;
          target.vx += Math.cos(aimA) * 18;
          target.vz += Math.sin(aimA) * 18;
          target.stunT = 0.4;
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
      } else {
        // Orbit / follow bodyguard formation around owner
        m.orbitAngle = (m.orbitAngle + 1.8 * dt) % (Math.PI * 2);
        const orbitDist = 2.4 + (m.id % 3) * 0.7;
        const desiredX = owner.x + Math.cos(m.orbitAngle) * orbitDist;
        const desiredZ = owner.z + Math.sin(m.orbitAngle) * orbitDist;
        const toX = desiredX - m.x;
        const toZ = desiredZ - m.z;
        const dist = Math.hypot(toX, toZ);
        if (dist > 0.15) {
          m.a = Math.atan2(toZ, toX);
          const speed = Math.min(18, Math.max(8, dist * 6));
          m.vx = (toX / dist) * speed;
          m.vz = (toZ / dist) * speed;
          m.x += m.vx * dt;
          m.z += m.vz * dt;
        } else {
          m.vx = owner.vx;
          m.vz = owner.vz;
          m.a = owner.a;
        }
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
            this.minions.delete(mid);
            break;
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
      // 5. Họp ngày chủ nhật: summon & teleport all animals to podium except King
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
      }
      this.events.push({ k: 'podBlast', x: podX, z: podZ });
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
    const ma = att.mass, mv = vic.mass * TRAITS[vic.species].weight;
    const ramFactor = TRAITS[att.species].ram ?? 1.0;
    // Dynamic knockback ceiling based on mass ratio and charging power (gồng húc)
    const massAdvantage = Math.pow(ma / mv, 0.4);
    const chargeAdvantage = att.power > 1.0 ? (1 + (att.power - 1) * 0.45) : 1.0;
    const dynamicMax = clamp(CFG.KNOCKBACK_MAX * Math.max(0.65, Math.min(2.0, massAdvantage * chargeAdvantage)), CFG.KNOCKBACK_MIN + 10, 52);
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
    }

    vic.vx = nx * k + vic.vx * 0.15;
    vic.vz = nz * k + vic.vz * 0.15;
    vic.stunT = 0;
    vic.dashT = 0; vic.plow = false; vic.holdT = 0; vic.charging = false; vic.pressed = false;
    att.dashHit.add(vic.id);
    if (att.plow) { att.vx *= 0.75; att.vz *= 0.75; }
    else { att.dashT = 0; att.vx *= 0.25; att.vz *= 0.25; }

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

    if (isDynamite) {
      vic.lastHitBy = att.id;
      vic.lastHitT = this.time;
      att.lastAttackedId = vic.id;
      att.lastAttackedT = this.time;
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

    let loss = Math.min(vic.mass - CFG.MIN_MASS, vic.mass * CFG.HIT_LOSS * att.power * clamp(ma / mv, 0.5, 1.5));
    // Pitchfork heavily strips weight and grants mass to attacker (normal knockback, massive kg steal)
    if (att.pitchforkT > 0) {
      const isKing = vic.id === this.napoleonId;
      const forceScale = clamp((speed * att.power * ramFactor) / 6, 2.5, 4.0);
      loss = Math.min(vic.mass - CFG.MIN_MASS, loss * forceScale * (isKing ? 3.0 : 2.0));
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
    p.alive = false;
    p.dashT = 0; p.stunT = 0; p.charging = false; p.pressed = false; p.holdT = 0;
    p.superT = 0; p.flyT = 0; p.wheelT = 0;
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
      for (let i = 0; i < 16; i++) {
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * (CFG.R - 3);
        x = Math.cos(a) * d; z = Math.sin(a) * d;
        if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 0.6)) continue;
        if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 1.8)) continue;
        // Food is allowed on fire as a trap for greedy players
        break;
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

      // Avoid stone wells: push radially outside well rim so food never floats over the pit
      for (const [wx, wz, wr] of (this.map.well || [])) {
        const dist = Math.hypot(fx - wx, fz - wz);
        const safeR = wr + 1.8;
        if (dist < safeR) {
          const ang = dist > 0.01 ? Math.atan2(fz - wz, fx - wx) : a;
          fx = wx + Math.cos(ang) * safeR;
          fz = wz + Math.sin(ang) * safeR;
        }
      }

      // Keep within fence
      const fd = Math.hypot(fx, fz), lim = CFG.R - 2;
      if (fd > lim) { fx = (fx / fd) * lim; fz = (fz / fd) * lim; }

      // Extra check: ensure safe from wells even after fence clamp
      for (const [wx, wz, wr] of (this.map.well || [])) {
        const dist = Math.hypot(fx - wx, fz - wz);
        const safeR = wr + 1.5;
        if (dist < safeR) {
          const ang = dist > 0.01 ? Math.atan2(fz - wz, fx - wx) : a;
          fx = wx + Math.cos(ang) * safeR;
          fz = wz + Math.sin(ang) * safeR;
        }
      }

      this.addFood(fx, fz, k, v);
    }
  }

  private spawnTool(): void {
    const kinds: ToolKind[] = ['pitchfork', 'dynamite', 'dynamite', 'song', 'wheel', 'star', 'star', 'star'];
    const kind = kinds[Math.floor(this.rnd() * kinds.length)];
    let bx = 0, bz = 0;

    for (let tries = 0; tries < 40; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 8 + Math.sqrt(this.rnd()) * (CFG.R - 20);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 2.8)) continue;
      // Requirement 1: Special items avoid hay bales, trees, and strictly avoid campfire
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2.8)) continue;
      if (this.treeSims.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 2.8)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < (fr || 2.5) + 2.8)) continue;
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
      const d = 4 + Math.sqrt(this.rnd()) * (CFG.R - 12);
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
        | (o.species !== 'duck' && o.species !== 'dog' && o.inWaterT > 0 ? FLAG.DROWNING : 0)
        | (o.slowT > 0 ? FLAG.SONG : 0)
        | (o.pitchforkT > 0 ? FLAG.PITCHFORK : 0)
        | (o.hasDynamite ? FLAG.DYNAMITE : 0)
        | (traitorId > 0 && o.id === traitorId ? FLAG.TRAITOR : 0)
        | (o.squishT > 0 ? FLAG.SQUISHED : 0)
        | (o.superT > 0 ? FLAG.SUPER : 0)
        | (o.flyT > 0 ? FLAG.FLYING : 0)
        | (o.wheelT > 0 ? FLAG.WHEEL : 0);
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
    this.food.clear();
    this.tools.clear();
    for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < 6; i++) this.spawnTool();
    this.matchClock = this.mode === 'friend' ? this.matchDuration : 300;
    this.mapShiftTimer = 300;
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
    for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < 6; i++) this.spawnTool();

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

  /** call once per tick after every recipient got its snapshot */
  flush(): void {
    this.events = [];
    this.foodAdded = [];
    this.foodRemoved = [];
  }
}
