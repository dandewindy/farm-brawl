// The authoritative farm simulation. Phase 1 runs it inside the page; phase 2 runs the very same class in a
// Cloudflare Durable Object. It knows nothing about rendering or networking: inputs in, snapshots out.
import { thinkBot, newBrain, BOT_NAMES, type BotBrain } from './bots';
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
  readonly map: MapData;
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
  private readonly rnd: () => number;
  private events: GameEvent[] = [];
  private foodAdded: FoodWire[] = [];
  private foodRemoved: number[] = [];
  /** fill empty seats with bots */
  botsEnabled: boolean;

  /** Podium capture system */
  podiumCaptor = 0;
  podiumProgress = 0;
  podiumContested = false;
  napoleonId = 0;
  napoleonReign = 0;
  currentRule = '';
  ruleTimer = 0;
  kingChoice: { options: string[]; expireT: number } | null = null;
  hof: [string, Species, number][] = [
    ['Napoleon', 'pig', 35],
    ['Snowball', 'pig', 22],
    ['Boxer', 'horse', 16],
  ];

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
      respawnT: 0, inWaterT: 0, pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0, team, ai: bot ? newBrain(this.rnd) : null,
    };
    this.players.set(id, p);
    this.spawn(p);
    return id;
  }

  /** bring a (dead) animal back, optionally as a different species and skin */
  respawn(id: number, name?: string, species?: Species, skin?: number): void {
    const p = this.players.get(id);
    if (!p || p.alive) return;
    if (name !== undefined) p.name = name.slice(0, 16);
    if (species) p.species = species;
    if (skin !== undefined) p.skin = skin % SKIN_COUNT;
    this.spawn(p);
  }

  removePlayer(id: number): void {
    if (!this.players.delete(id)) return;
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
      pitchforkT: 0, hasDynamite: false, slowT: 0, superT: 0, flyT: 0,
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
      const used = new Set([...this.players.values()].map((p) => p.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(this.rnd() * free.length)] : `Bot ${this.nextId}`;
      this.addPlayer(name, SPECIES[Math.floor(this.rnd() * SPECIES.length)], true);
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
          if (p.inWaterT >= 1.5) {
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

    // Podium capture logic
    const [podX, podZ] = this.map.podium;
    const PR = CFG.PODIUM_R;
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
          king.mass = Math.min(CFG.MAX_MASS, king.mass + taxSum);
        }
      }
    }

    // King periodic reign harvest bonus (every 3 seconds)
    if (this.napoleonId > 0 && this.tick % 60 === 0) {
      const king = this.players.get(this.napoleonId);
      if (king && king.alive) {
        king.mass = Math.min(CFG.MAX_MASS, king.mass + 2);
        // Spawn golden corn directly on podium
        this.addFood(podX + (this.rnd() - 0.5) * 4, podZ + (this.rnd() - 0.5) * 4, 2, 6);
      }
    }

    for (const p of alive) {
      if (!p.alive) continue;
      if (p.mass > CFG.DECAY_START) p.mass -= (p.mass - CFG.DECAY_START) * CFG.DECAY_RATE * DT;
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
    p.cd = Math.max(0, p.cd - DT);
    const down = (p.input.btn || p.btnLatch) && p.stunT <= 0;
    p.btnLatch = false;
    if (down && p.input.btn) {
      if (p.cd > 0 || p.dashT > 0) {
        p.pressed = false; p.holdT = 0; p.charging = false;
      } else {
        p.pressed = true;
        p.holdT = Math.min(CFG.CHARGE_MAX + 0.5, p.holdT + DT);
        p.charging = p.holdT >= CFG.CHARGE_SLOW_AFTER;
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
        const aHits = a.dashT > 0 && va > CFG.HIT_MIN_SPEED && !a.dashHit.has(b.id);
        const bHits = b.dashT > 0 && vb > CFG.HIT_MIN_SPEED && !b.dashHit.has(a.id);
        if (aHits && bHits) {
          // head-on: the bigger momentum wins
          if (va * ma * a.power >= vb * mb * b.power) this.hit(a, b, nx, nz, va);
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
    const rules = ['twoleg', 'fourleg', 'corn', 'sunday', 'tax', 'squealer', 'snowball'];
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
    this.events.push({ k: 'rule', id: ruleId });
  }

  private pickRule(): void {
    const rules = ['twoleg', 'fourleg', 'corn', 'equal', 'sunday', 'tax', 'squealer', 'snowball'];
    const candidates = rules.filter((r) => r !== this.currentRule);
    const pick = candidates[Math.floor(this.rnd() * candidates.length)] || 'twoleg';
    this.applyRule(pick);
  }

  private hit(att: Player, vic: Player, nx: number, nz: number, speed: number): void {
    const ma = att.mass, mv = vic.mass * TRAITS[vic.species].weight;
    let k = clamp(speed * att.power * CFG.KNOCKBACK * Math.pow(ma / mv, 0.35), CFG.KNOCKBACK_MIN, CFG.KNOCKBACK_MAX);

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
      killer.mass = Math.min(CFG.MAX_MASS, killer.mass + spoils);
      killer.kills++;
      killer.streak++;
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
        p.mass = Math.min(CFG.MAX_MASS, p.mass + gain);
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
    for (let i = 0; i < 8; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * (CFG.R - 3);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (!this.map.hay.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + 0.6)) break;
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
    const k: FoodKind = v >= 5 ? 4 : v >= 2 ? 1 : 0;
    const base = Math.atan2(dz, dx), aimed = dx !== 0 || dz !== 0;
    for (let i = 0; i < n; i++) {
      const a = aimed ? base + (this.rnd() - 0.5) * 2.4 : this.rnd() * Math.PI * 2;
      const d = rad + this.rnd() * 3;
      let fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      const fd = Math.hypot(fx, fz), lim = CFG.R - 2;
      if (fd > lim) { fx = (fx / fd) * lim; fz = (fz / fd) * lim; }
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
    };
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
    return snap;
  }

  /** call once per tick after every recipient got its snapshot */
  flush(): void {
    this.events = [];
    this.foodAdded = [];
    this.foodRemoved = [];
  }
}
