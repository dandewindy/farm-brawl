// What the client knows about the farm, rebuilt from server messages. Other animals are drawn slightly in the
// past and interpolated between snapshots, so the picture stays smooth even when packets arrive unevenly.
import { TICK_MS, type Cfg, type FoodKind } from '@shared/constants';
import type { MapData } from '@shared/map';
import { wrapAngle } from '@shared/math';
import type { GameEvent, HofRow, LeaderRow, PlayerMeta, ServerMsg, Snapshot, ToolWire } from '@shared/protocol';

/** [tick, x, z, angle] */
type Sample = [number, number, number, number];

export interface Ent {
  id: number;
  hist: Sample[];
  mass: number;
  flags: number;
  charge: number;
  /** last snapshot tick that contained this animal */
  seen: number;
  /** interpolated pose for this frame */
  x: number;
  z: number;
  a: number;
}

export interface FoodItem {
  id: number;
  x: number;
  z: number;
  k: FoodKind;
  v: number;
  born: number;
}

export interface GameHooks {
  onInit(map: MapData): void;
  onJoined(id: number): void;
  onEvent(ev: GameEvent): void;
  onSnapshot(s: Snapshot): void;
}

export class GameState {
  cfg: Cfg | null = null;
  map: MapData | null = null;
  readonly metas = new Map<number, PlayerMeta>();
  readonly ents = new Map<number, Ent>();
  readonly food = new Map<number, FoodItem>();
  myId = 0;
  alive = false;
  tick = 0;
  lb: LeaderRow[] = [];
  total = 0;
  me = { kills: 0, cd: 0, rank: 0 };
  myMass = 0;
  pod: [number, number, boolean] = [0, 0, false];
  podShield: [boolean, number] = [true, 30];
  tools = new Map<number, ToolWire>();
  napoleonId = 0;
  rule = '';
  reign = 0;
  hof: HofRow[] = [];
  truck?: [number, number, number];

  snapTick = 0;
  readonly clockWin: number[] = [];
  clockOff: number | null = null;
  lateAvg = 0;
  interpDelay = 100;

  constructor(private readonly hooks: GameHooks) {}

  resetClock(): void {
    this.snapTick = 0;
    this.clockWin.length = 0;
    this.clockOff = null;
    this.lateAvg = 0;
    this.interpDelay = 100;
  }

  handle(m: ServerMsg): void {
    if (m.t === 'init') {
      this.resetClock();
      this.cfg = m.cfg;
      this.map = m.map;
      this.tick = m.tick;
      this.metas.clear(); this.ents.clear(); this.food.clear(); this.tools.clear();
      for (const p of m.players) this.metas.set(p.id, p);
      for (const f of m.food) this.addFood(f, true);
      if (m.tools) for (const t of m.tools) this.tools.set(t[0], t);
      this.hooks.onInit(m.map);
    } else if (m.t === 'joined') {
      this.myId = m.id;
      this.alive = true;
      this.hooks.onJoined(m.id);
    } else if (m.t === 's') {
      this.onSnapshot(m);
    }
  }

  private addFood([id, x, z, k, v]: [number, number, number, FoodKind, number], old = false): void {
    this.food.set(id, { id, x, z, k, v, born: old ? 0 : performance.now() });
  }

  private onSnapshot(s: Snapshot): void {
    this.snapTick++;
    this.tick = s.tick;
    const now = performance.now();
    this.stampSnapshot(now);

    for (const ev of s.ev) {
      if (ev.k === 'join') {
        this.metas.set(ev.id, { id: ev.id, name: ev.name, species: ev.species, skin: ev.skin, bot: ev.bot, team: ev.team });
        this.ents.delete(ev.id); // a fresh body: don't slide from where it died
      } else if (ev.k === 'leave') {
        this.metas.delete(ev.id);
        this.ents.delete(ev.id);
      } else if (ev.k === 'die') {
        this.ents.delete(ev.id);
        if (ev.id === this.myId) this.alive = false;
      } else if (ev.k === 'map') {
        this.map = ev.map;
        this.food.clear();
        for (const f of ev.food) this.addFood(f);
      }
      this.hooks.onEvent(ev);
    }
    for (const f of s.fa) this.addFood(f);
    for (const id of s.fr) this.food.delete(id);

    for (const [id, x, z, a, mass, flags, charge] of s.p) {
      let e = this.ents.get(id);
      if (!e) {
        e = { id, hist: [], mass, flags, charge, seen: this.snapTick, x, z, a };
        this.ents.set(id, e);
      }
      e.mass = mass; e.flags = flags; e.charge = charge; e.seen = this.snapTick;
      const last = e.hist[e.hist.length - 1];
      if (last && Math.hypot(last[1] - x, last[2] - z) > 15) {
        e.hist.length = 0; // teleport
        e.x = x; e.z = z; e.a = a;
      }
      e.hist.push([this.snapTick, x, z, a]);
      if (e.hist.length > 12) e.hist.shift();
      if (id === this.myId) {
        this.myMass = mass;
        e.x = x;
        e.z = z;
        e.a = a;
      }
    }
    // anyone missing from this snapshot is gone
    for (const [id, e] of this.ents) if (e.seen !== this.snapTick) this.ents.delete(id);

    if (s.tl) {
      this.tools.clear();
      for (const t of s.tl) this.tools.set(t[0], t);
    }
    if (s.lb) this.lb = s.lb;
    if (s.total) this.total = s.total;
    if (s.me) this.me = s.me;
    if (s.pod) this.pod = s.pod;
    if (s.nap !== undefined) this.napoleonId = s.nap;
    if (s.rule !== undefined) this.rule = s.rule;
    if (s.reign !== undefined) this.reign = s.reign;
    if (s.hof) this.hof = s.hof;
    if (s.podShield) this.podShield = s.podShield;
    this.truck = s.truck;
    this.hooks.onSnapshot(s);
  }

  stampSnapshot(now: number): void {
    const sample = now - this.snapTick * TICK_MS;
    this.clockWin.push(sample);
    if (this.clockWin.length > 16) this.clockWin.shift();
    const lo = Math.min(...this.clockWin);
    this.clockOff = this.clockOff === null ? lo : this.clockOff + (lo - this.clockOff) * 0.15;
    const late = this.clockWin.map((v) => v - lo).sort((a, b) => a - b);
    this.lateAvg = late[Math.floor(late.length * 0.85)] || 0;
    // Tight interpolation delay: 52ms to 85ms (enough to absorb 1 tick of jitter, zero perceptable lag)
    const want = Math.min(85, Math.max(52, TICK_MS + 4 + Math.min(22, this.lateAvg * 0.35)));
    this.interpDelay += (want - this.interpDelay) * (want > this.interpDelay ? 0.35 : 0.15);
  }

  /** fractional tick to draw at this moment */
  renderTick(now: number): number {
    return this.clockOff === null ? this.snapTick : (now - this.clockOff - this.interpDelay) / TICK_MS;
  }

  /** move every animal to its interpolated pose for `now` */
  interpolate(now: number): void {
    const rt = this.renderTick(now);
    for (const e of this.ents.values()) {
      if (e.id !== this.myId) {
        sample(e, rt);
      }
    }
  }
}

function sample(e: Ent, rt: number): void {
  const h = e.hist, n = h.length;
  if (!n) return;
  const last = h[n - 1];
  if (rt >= last[0] || n === 1) {
    // late packet: coast a little along the last movement
    if (n >= 2 && rt > last[0]) {
      const p = h[n - 2], k = Math.min(rt - last[0], 1.5) / (last[0] - p[0]);
      e.x = last[1] + (last[1] - p[1]) * k;
      e.z = last[2] + (last[2] - p[2]) * k;
    } else { e.x = last[1]; e.z = last[2]; }
    e.a = last[3];
    return;
  }
  for (let i = n - 2; i >= 0; i--) {
    const a = h[i];
    if (a[0] <= rt) {
      const b = h[i + 1], k = (rt - a[0]) / (b[0] - a[0]);
      e.x = a[1] + (b[1] - a[1]) * k;
      e.z = a[2] + (b[2] - a[2]) * k;
      e.a = a[3] + wrapAngle(b[3] - a[3]) * k;
      return;
    }
  }
  e.x = h[0][1]; e.z = h[0][2]; e.a = h[0][3];
}
