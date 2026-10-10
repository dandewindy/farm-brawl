// The authoritative farm simulation. Phase 1 runs it inside the page; phase 2 runs the very same class in a
// Cloudflare Durable Object. It knows nothing about rendering or networking: inputs in, snapshots out.
import { thinkBot, newBrain, SPECIES_BOT_NAMES, SPECIES_NAMES_VI, type BotBrain } from './bots';
import {
  CFG, DT, FOOD_KG, FOOD_WEIGHT, SKIN_COUNT, SPECIES, SUBSTEPS, TRAITS, radiusOf,
  type FoodKind, type Species,
} from '../constants';
import { generateMap, type MapData } from '../map';
import { clamp, insideBlob, mulberry32 } from '../math';
import { type Body, type Terrain, collideHay, dashParams, chargeLevel, outsideFence, stepMove, terrainAt } from '../physics';
import {
  FLAG, type DeathCause, type FoodWire, type GameEvent, type Input, type LeaderRow, type PlayerMeta,
  type PlayerWire, type ServerMsg, type Snapshot, type ToolKind,
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
  kills: number;
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
  team?: number;
  ai: BotBrain | null;
}

export interface ToolItem {
  id: number;
  kind: ToolKind;
  x: number;
  z: number;
}

export interface Food {
  id: number;
  x: number;
  z: number;
  k: FoodKind;
  v: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export class World {
  map: MapData;
  readonly players = new Map<number, Player>();
  readonly food = new Map<number, Food>();
  readonly tools = new Map<number, ToolItem>();
  tick = 0;
  time = 0;
  /** alive animals, heaviest first (refreshed every tick) */
  ranked: Player[] = [];

  private nextId = 1;
  private nextFood = 1;
  private nextTool = 1;
  private toolSpawnTimer = 3;
  private superCandyTimer = 25;
  private rnd: () => number;
  private events: GameEvent[] = [];
  private foodAdded: FoodWire[] = [];
  private foodRemoved: number[] = [];
  /** fill empty seats with bots */
  botsEnabled: boolean;

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
  hof: [string, Species, number][] = [
    ['Vua', 'pig', 35],
    ['Snowball', 'pig', 22],
    ['Boxer', 'horse', 16],
  ];
  tillTruck = {
    active: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    angle: 0,
    timer: 2.5,
  };
  teamScores: [number, number] = [0, 0];
  matchClock = 300;
  matchEnded = false;
  matchEndTimer = 0;

  constructor(seed: number = (Math.random() * 2 ** 31) | 0, opts: { bots?: boolean } = {}) {
    this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.map = generateMap(seed);
    this.botsEnabled = opts.bots ?? true;
    for (let i = 0; i < CFG.FOOD_TARGET; i++) this.spawnFood();
    for (let i = 0; i < 3; i++) this.spawnTool();
    this.flush();
  }

  rand(): number {
    return this.rnd();
  }

  // ------------------------------------------------------------------ players

  addPlayer(name: string, species: Species, bot = false, team?: number, skin?: number): number {
    const id = this.nextId++;
    const p: Player = {
      id, name: name.slice(0, 16), species,
      skin: skin !== undefined ? (skin % SKIN_COUNT) : Math.floor(this.rnd() * SKIN_COUNT),
      bot, alive: false,
      x: 0, z: 0, vx: 0, vz: 0, a: 0, mass: CFG.START_MASS, dashT: 0, stunT: 0, charging: false,
      input: { a: 0, mv: false, btn: false }, btnLatch: false, pressed: false, holdT: 0, cd: 0, plow: false, power: 1,
      terrain: 0, dashHit: new Set(), lastHitBy: 0, lastHitT: -99, kills: 0, streak: 0, bornT: 0, best: 0,
      respawnT: 0, inWaterT: 0, pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, lastEatT: 0, team, ai: bot ? newBrain(this.rnd) : null,
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

  removePlayer(id: number): void {
    if (!this.players.delete(id)) return;
    if (id === this.napoleonId) {
      this.napoleonId = 0;
      this.napoleonReign = 0;
      this.currentRule = '';
      this.kingChoice = null;
      this.podiumPhaseTimer = 30;
      this.podiumWarned5s = false;
      this.events.push({ k: 'napoleon', id: 0 });
    }
    this.events.push({ k: 'leave', id });
  }

  setInput(id: number, inp: Input): void {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    p.input.a = Number.isFinite(inp.a) ? inp.a : p.input.a;
    p.input.mv = !!inp.mv;
    p.input.btn = !!inp.btn;
    if (p.input.btn) p.btnLatch = true;
  }

  meta(p: Player): PlayerMeta {
    return { id: p.id, name: p.name, species: p.species, skin: p.skin, bot: p.bot, team: p.team };
  }

  private spawn(p: Player): void {
    const [x, z] = this.freeSpot();
    Object.assign(p, {
      alive: true, x, z, vx: 0, vz: 0, a: Math.atan2(-z, -x), mass: CFG.START_MASS, dashT: 0, stunT: 0,
      charging: false, pressed: false, holdT: 0, cd: 0, plow: false, power: 1, lastHitBy: 0, lastHitT: -99,
      kills: 0, streak: 0, bornT: this.time, best: CFG.START_MASS, btnLatch: false, inWaterT: 0,
      pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, lastEatT: this.time,
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
    if (!this.botsEnabled) return;
    if (this.players.size < CFG.BOT_FILL) {
      const sp = SPECIES[Math.floor(this.rnd() * SPECIES.length)];
      const used = new Set([...this.players.values()].map((p) => p.name));
      const pool = SPECIES_BOT_NAMES[sp] || [];
      const free = pool.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(this.rnd() * free.length)] : `${SPECIES_NAMES_VI[sp]} ${this.nextId}`;
      let botTeam: number | undefined;
      const hasTeams = [...this.players.values()].some((p) => p.team !== undefined);
      if (hasTeams) {
        let t0 = 0, t1 = 0;
        for (const p of this.players.values()) {
          if (p.team === 0) t0++;
          else if (p.team === 1) t1++;
        }
        botTeam = t0 <= t1 ? 0 : 1;
      }
      this.addPlayer(name, sp, true, botTeam);
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
    const hasTeams = [...this.players.values()].some((p) => p.team !== undefined);
    if (hasTeams) {
      if (!this.matchEnded) {
        this.matchClock = Math.max(0, this.matchClock - DT);
        if (this.napoleonId > 0) {
          const king = this.players.get(this.napoleonId);
          if (king && king.alive && king.team !== undefined) {
            this.teamScores[king.team] += DT * 1;
          }
        }
        if (this.matchClock <= 0) {
          this.matchEnded = true;
          this.matchEndTimer = 0;
          const winner = this.teamScores[0] > this.teamScores[1] ? 0 : this.teamScores[1] > this.teamScores[0] ? 1 : -1;
          this.events.push({ k: 'teamWin', winner, s0: Math.round(this.teamScores[0]), s1: Math.round(this.teamScores[1]) });
        }
      } else {
        // After 6s celebration, renew game with brand new map layout and items
        this.matchEndTimer += DT;
        if (this.matchEndTimer >= 6.0) {
          this.renewGame();
        }
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.bot && (p.respawnT -= DT) <= 0) this.spawn(p);
        continue;
      }
      if (p.ai) thinkBot(this, p, DT);
      this.handleButton(p);
    }

    const alive = [...this.players.values()].filter((p) => p.alive);
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
        stepMove(p, p.input, h, p.species, p.terrain);
        if (p.slowT > 0) {
          p.vx *= 0.85;
          p.vz *= 0.85;
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
      }
      this.collidePlayers(alive);
    }

    for (const p of alive) {
      if (p.dashT <= 0) p.plow = false;
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

      // 4. Pond drowning (ducks swim freely; other animals struggle for 1.5s before drowning)
      if (p.species !== 'duck') {
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

    // Tool & Super Candy spawning
    this.toolSpawnTimer -= DT;
    if (this.toolSpawnTimer <= 0) {
      this.toolSpawnTimer = 12 + this.rnd() * 8;
      if (this.tools.size < 3) {
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

    // Tool pickup & timer updates
    for (const p of alive) {
      if (!p.alive) continue;
      if (p.pitchforkT > 0) p.pitchforkT = Math.max(0, p.pitchforkT - DT);
      if (p.slowT > 0) p.slowT = Math.max(0, p.slowT - DT);
      if (p.superT > 0) p.superT = Math.max(0, p.superT - DT);
      if (p.flyT > 0) p.flyT = Math.max(0, p.flyT - DT);

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
      if (this.ruleTimer <= 0 && !this.kingChoice) {
        this.pickRule();
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

    // Rule: "equal" (All animals are equal, non-kings converge to 30kg, King boosted)
    if (this.currentRule === 'equal') {
      for (const p of alive) {
        if (p.id === this.napoleonId) {
          p.mass = Math.max(p.mass, 65);
        } else if (Math.abs(p.mass - 30) > 0.5) {
          p.mass += (30 - p.mass) * 0.05 * DT;
        }
      }
    }

    // Rule: "till" (Farmer Till returns in his tractor, sweeps across the farm)
    if (this.currentRule === 'till') {
      if (!this.tillTruck.active) {
        this.tillTruck.timer -= DT;
        if (this.tillTruck.timer <= 0) {
          // Spawn tractor at perimeter R = 52
          const enterA = this.rnd() * Math.PI * 2;
          const sx = Math.cos(enterA) * 52;
          const sz = Math.sin(enterA) * 52;
          const aimA = enterA + Math.PI + (this.rnd() - 0.5) * 0.5;
          const speed = 25;
          this.tillTruck.active = true;
          this.tillTruck.x = sx;
          this.tillTruck.z = sz;
          this.tillTruck.vx = Math.cos(aimA) * speed;
          this.tillTruck.vz = Math.sin(aimA) * speed;
          this.tillTruck.angle = aimA;
          this.events.push({ k: 'boom', id: 0, x: sx, z: sz });
        }
      } else {
        this.tillTruck.x += this.tillTruck.vx * DT;
        this.tillTruck.z += this.tillTruck.vz * DT;
        const tx = this.tillTruck.x;
        const tz = this.tillTruck.z;
        const cosA = Math.cos(-this.tillTruck.angle);
        const sinA = Math.sin(-this.tillTruck.angle);

        // Check ram collision with every alive player
        for (const p of alive) {
          const dx = p.x - tx;
          const dz = p.z - tz;
          const rx = dx * cosA - dz * sinA;
          const rz = dx * sinA + dz * cosA;
          const pr = radiusOf(p.mass);
          // Collision box: length 4.6 (rx: -2.3 to +2.3), width 2.8 (rz: -1.4 to +1.4)
          if (Math.abs(rx) < 2.3 + pr && Math.abs(rz) < 1.4 + pr) {
            // Massive tractor ram!
            p.vx = Math.cos(this.tillTruck.angle) * 32;
            p.vz = Math.sin(this.tillTruck.angle) * 32;
            const loss = Math.min(18, Math.max(6, p.mass * 0.22));
            p.mass = Math.max(CFG.MIN_MASS, p.mass - loss);
            p.stunT = 1.5;
            this.events.push({ k: 'hit', a: 0, v: p.id, x: p.x, z: p.z, s: 30, loss });
          }
        }

        // Check if tractor reached opposite perimeter
        if (Math.hypot(tx, tz) > 56) {
          this.tillTruck.active = false;
          this.tillTruck.timer = 3.5; // Next sweep in 3.5 seconds
        }
      }
    } else {
      this.tillTruck.active = false;
      this.tillTruck.timer = 2.0;
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

    for (let i = 0; i < CFG.FOOD_SPAWN_PER_TICK && this.food.size < CFG.FOOD_TARGET; i++) this.spawnFood();

    this.ranked = alive.filter((p) => p.alive).sort((a, b) => b.mass - a.mass);
  }

  /** hold to charge, release to ram */
  private handleButton(p: Player): void {
    if (p.slowT > 0 || p.terrain === 1 || p.stunT > 0) {
      p.pressed = false; p.holdT = 0; p.charging = false; p.btnLatch = false;
      return;
    }
    const cdRate = (this.currentRule === 'squealer' && p.id === this.napoleonId) ? 2 : 1;
    p.cd = Math.max(0, p.cd - DT * cdRate);
    const down = (p.input.btn || p.btnLatch) && p.stunT <= 0;
    p.btnLatch = false;
    if (down && p.input.btn) {
      if (p.cd > 0 || p.dashT > 0) {
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
    if ((p.pressed || down) && p.cd <= 0 && p.dashT <= 0 && p.stunT <= 0) this.dash(p);
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
      p.power = 2.5;
      p.cd = CFG.DASH_CD;
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
    p.cd = CFG.DASH_CD + (d.plow ? CFG.PLOW_CD : 0);
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

  startKingChoice(): void {
    const rules = ['twoleg', 'fourleg', 'corn', 'equal', 'sunday', 'tax', 'squealer', 'snowball', 'till'];
    const candidates = rules.filter((r) => r !== this.currentRule);
    const shuffled = [...candidates].sort(() => this.rnd() - 0.5);
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
    this.currentRule = ruleId;
    this.ruleTimer = 40;
    this.kingChoice = null;
    if (ruleId === 'equal') {
      for (const p of this.players.values()) {
        if (p.alive) {
          if (p.id === this.napoleonId) p.mass = Math.max(p.mass, 65);
          else p.mass = 30;
        }
      }
    } else if (ruleId === 'squealer') {
      const king = this.players.get(this.napoleonId);
      if (king && king.alive) {
        king.cd = 0;
        king.power = 1.35;
      }
    } else if (ruleId === 'till') {
      this.tillTruck.timer = 1.0; // Quick initial entrance for Till's tractor
    } else if (ruleId === 'corn') {
      const [podX, podZ] = this.map.podium;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        this.addFood(podX + Math.cos(ang) * 2.5, podZ + Math.sin(ang) * 2.5, 2, 6);
      }
    }
    this.events.push({ k: 'rule', id: ruleId });
  }

  private pickRule(): void {
    const rules = ['twoleg', 'fourleg', 'corn', 'equal', 'sunday', 'tax', 'squealer', 'snowball', 'till'];
    const candidates = rules.filter((r) => r !== this.currentRule);
    const pick = candidates[Math.floor(this.rnd() * candidates.length)] || 'twoleg';
    this.applyRule(pick);
  }

  private hit(att: Player, vic: Player, nx: number, nz: number, speed: number): void {
    const ma = att.mass, mv = vic.mass * TRAITS[vic.species].weight;
    const ramFactor = TRAITS[att.species].ram ?? 1.0;
    let k = clamp(speed * att.power * ramFactor * CFG.KNOCKBACK * Math.pow(ma / mv, 0.35), CFG.KNOCKBACK_MIN, CFG.KNOCKBACK_MAX * 1.3);

    // Rule: "twoleg" (Two legs bad - chickens and ducks fly twice as far when hit)
    if (this.currentRule === 'twoleg' && (vic.species === 'chicken' || vic.species === 'duck')) {
      k = Math.min(CFG.KNOCKBACK_MAX * 1.6, k * 2.0);
    }

    // Rule: "fourleg" (Four legs good - 4-legged animals ram 50% harder, King 80% harder)
    if (this.currentRule === 'fourleg') {
      const isFourLeg = att.species === 'sheep' || att.species === 'horse' || att.species === 'cow' || att.species === 'pig';
      if (att.id === this.napoleonId) {
        k = Math.min(CFG.KNOCKBACK_MAX * 1.8, k * 1.8);
      } else if (isFourLeg) {
        k = Math.min(CFG.KNOCKBACK_MAX * 1.5, k * 1.5);
      }
    }

    // Rule: "squealer" (Propaganda empowers King with 1.8x ram force)
    if (this.currentRule === 'squealer' && att.id === this.napoleonId) {
      k = Math.min(CFG.KNOCKBACK_MAX * 1.8, k * 1.8);
    }

    // Weapon: Pitchfork (1.35x knockback)
    if (att.pitchforkT > 0) {
      k = clamp(k * 1.35, CFG.KNOCKBACK_MIN, CFG.KNOCKBACK_MAX * 1.5);
    }

    // Weapon: Dynamite explosion
    if (att.hasDynamite) {
      att.hasDynamite = false;
      k = Math.max(k * 1.4, 25);
      const boomX = r2((att.x + vic.x) / 2);
      const boomZ = r2((att.z + vic.z) / 2);
      this.events.push({ k: 'boom', id: att.id, x: boomX, z: boomZ });
      const BOOM_R = 6.5;
      for (const bystander of this.players.values()) {
        if (!bystander.alive || bystander.id === att.id) continue;
        const bdx = bystander.x - boomX;
        const bdz = bystander.z - boomZ;
        const bdist = Math.hypot(bdx, bdz);
        if (bdist < BOOM_R && bdist > 0.01) {
          const bForce = clamp((1 - bdist / BOOM_R) * 28, 6, 26);
          bystander.vx += (bdx / bdist) * bForce;
          bystander.vz += (bdz / bdist) * bForce;
        }
      }
    }

    // Super Rainbow Dash: violent massive knockback launching victim far across the map!
    if (att.superT > 0) {
      k = Math.max(k * 3.2, 72);
    }

    vic.vx = nx * k + vic.vx * 0.15;
    vic.vz = nz * k + vic.vz * 0.15;
    vic.stunT = 0;
    vic.dashT = 0; vic.plow = false; vic.holdT = 0; vic.charging = false; vic.pressed = false;
    att.dashHit.add(vic.id);
    if (att.plow) { att.vx *= 0.75; att.vz *= 0.75; }
    else { att.dashT = 0; att.vx *= 0.25; att.vz *= 0.25; }

    let loss = Math.min(vic.mass - CFG.MIN_MASS, vic.mass * CFG.HIT_LOSS * att.power * clamp(ma / mv, 0.5, 1.5));
    // Pitchfork strips 3x weight off Napoleon
    if (att.pitchforkT > 0 && vic.id === this.napoleonId) {
      loss = Math.min(vic.mass - CFG.MIN_MASS, loss * 3);
    }
    if (loss > 0.5) {
      vic.mass -= loss;
      this.scatter(vic.x, vic.z, loss, radiusOf(vic.mass) + 0.8, nx, nz);
    }
    vic.lastHitBy = att.id;
    vic.lastHitT = this.time;
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
    p.superT = 0; p.flyT = 0;
    if (p.id === this.napoleonId) {
      const prevKing = this.players.get(this.napoleonId);
      const dur = Math.round(this.napoleonReign);
      if (dur >= 5 && prevKing) {
        this.hof.push([prevKing.name, prevKing.species, dur]);
        this.hof.sort((a, b) => b[2] - a[2]);
        this.hof = this.hof.slice(0, 3);
      }
      this.napoleonId = 0;
      this.napoleonReign = 0;
      this.currentRule = '';
      this.kingChoice = null;
      this.podiumPhaseTimer = 30;
      this.podiumWarned5s = false;
      this.events.push({ k: 'napoleon', id: 0 });
    }
    const credited = p.lastHitBy && this.time - p.lastHitT < CFG.CREDIT_TIME ? this.players.get(p.lastHitBy) : undefined;
    const killer = credited && credited.alive && credited !== p ? credited : undefined;
    let spoils = 0;
    if (killer) {
      const isKingKill = p.id === this.napoleonId;
      const isSnowballTraitor = this.currentRule === 'snowball' && this.ranked.length > 1 && p.id === (this.ranked[0]?.id === this.napoleonId ? this.ranked[1]?.id : this.ranked[0]?.id);
      const mult = isSnowballTraitor ? 3.0 : isKingKill ? 1.5 : 1.0;
      spoils = Math.round(p.mass * CFG.KILL_SPOILS * mult);
      killer.mass += spoils;
      killer.kills++;
      killer.streak++;
      if (killer.team !== undefined && p.team !== undefined && killer.team !== p.team) {
        this.teamScores[killer.team] += 5;
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
  }

  // ------------------------------------------------------------------ food

  private eat(list: Player[]): void {
    for (const p of list) {
      if (!p.alive) continue;
      const r = radiusOf(p.mass) + 0.4;
      for (const f of this.food.values()) {
        const dx = f.x - p.x, dz = f.z - p.z;
        if (dx > r || dx < -r || dz > r || dz < -r || dx * dx + dz * dz > r * r) continue;
        let gain = f.v;
        if (f.k === 6) {
          p.superT = 10;
          p.flyT = 0;
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
        p.lastEatT = this.time;
        this.food.delete(f.id);
        this.foodRemoved.push(f.id);
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
    for (let i = 0; i < 16; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * (CFG.R - 3);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 0.6)) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 1.8)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < fr + 1.8)) continue;
      break;
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
    const kinds: ToolKind[] = ['pitchfork', 'dynamite', 'song'];
    const kind = kinds[Math.floor(this.rnd() * kinds.length)];
    let bx = 0, bz = 0;
    for (let tries = 0; tries < 25; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 8 + Math.sqrt(this.rnd()) * (CFG.R - 20);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 3)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < fr + 3)) continue;
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 2)) continue;
      bx = x; bz = z;
      break;
    }
    const id = this.nextTool++;
    this.tools.set(id, { id, kind, x: r2(bx), z: r2(bz) });
  }

  private spawnSuperCandy(): void {
    let bx = 0, bz = 0;
    for (let tries = 0; tries < 25; tries++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 4 + Math.sqrt(this.rnd()) * (CFG.R - 12);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (terrainAt(this.map, x, z) === 1) continue;
      if (Math.hypot(x - this.map.podium[0], z - this.map.podium[1]) < CFG.PODIUM_R + 3) continue;
      if (this.map.well?.some(([wx, wz, wr]) => Math.hypot(x - wx, z - wz) < wr + 3)) continue;
      if (this.map.fire?.some(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) < fr + 3)) continue;
      if (this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 1.5)) continue;
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
        | (o.species !== 'duck' && o.inWaterT > 0 ? FLAG.DROWNING : 0)
        | (o.slowT > 0 ? FLAG.SONG : 0)
        | (o.pitchforkT > 0 ? FLAG.PITCHFORK : 0)
        | (o.hasDynamite ? FLAG.DYNAMITE : 0)
        | (traitorId > 0 && o.id === traitorId ? FLAG.TRAITOR : 0)
        | (o.superT > 0 ? FLAG.SUPER : 0)
        | (o.flyT > 0 ? FLAG.FLYING : 0);
      p.push([o.id, r2(o.x), r2(o.z), r2(o.a), Math.round(o.mass), flags, o.charging ? Math.round(chargeLevel(o.holdT) * 10) : 0]);
    }
    const snap: Snapshot = {
      t: 's',
      tick: this.tick,
      p,
      fa: this.foodAdded,
      fr: this.foodRemoved,
      ev: this.events,
      tl: [...this.tools.values()].map((t) => [t.id, t.kind, t.x, t.z]),
      pod: [this.podiumCaptor, Math.round(this.podiumProgress * 100) / 100, this.podiumContested],
      nap: this.napoleonId,
      rule: this.currentRule,
      reign: Math.round(this.napoleonReign),
      hof: this.hof,
      podShield: [this.podiumShield, Math.ceil(this.podiumPhaseTimer)],
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
    const hasTeams = [...this.players.values()].some((o) => o.team !== undefined);
    if (hasTeams) {
      let count0 = 0;
      let count1 = 0;
      for (const o of this.players.values()) {
        if (o.team === 0) count0++;
        else if (o.team === 1) count1++;
      }
      snap.team = [Math.round(this.teamScores[0]), Math.round(this.teamScores[1]), Math.ceil(this.matchClock), count0, count1];
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
    for (let i = 0; i < 3; i++) this.spawnTool();
    this.matchClock = 300;
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

    // Respawns bots at new free spots; human players respawn when clicking Continue on team victory modal
    for (const p of this.players.values()) {
      if (p.bot) {
        this.spawn(p);
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

  /** call once per tick after every recipient got its snapshot */
  flush(): void {
    this.events = [];
    this.foodAdded = [];
    this.foodRemoved = [];
  }
}
