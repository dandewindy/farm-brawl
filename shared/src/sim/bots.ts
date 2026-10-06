// Simple farmyard AI so a room is fun even when you're alone: graze, avoid the fence, ram whoever is
// small enough and close to the fence.
import { CFG, radiusOf } from '../constants';
import { wrapAngle } from '../math';
import type { Player, World } from './world';

export interface BotBrain {
  /** seconds until the next decision */
  think: number;
  /** seconds left to keep the ram button held */
  press: number;
  /** id of the animal being rammed */
  target: number;
  /** wandering heading when there's nothing to eat */
  wander: number;
  /** 0..1: how eager it is to pick fights */
  aggro: number;
}

export const BOT_NAMES = [
  'Ủn Ỉn', 'Bé Mập', 'Gà Mờ', 'Bò Sữa', 'Vịt Bầu', 'Cừu Non', 'Ngựa Ô', 'Heo Hồng', 'Tí Nị', 'Lợn Lì',
  'Bò Tót', 'Gà Chiến', 'Vịt Xiêm', 'Cừu Bông', 'Ngựa Vằn', 'Mập Ú', 'Boxer', 'Clover', 'Muriel', 'Benjamin',
];

export function newBrain(rnd: () => number): BotBrain {
  return { think: rnd() * 0.3, press: 0, target: 0, wander: rnd() * Math.PI * 2, aggro: 0.35 + rnd() * 0.65 };
}

const aimAt = (p: Player, x: number, z: number) => Math.atan2(z - p.z, x - p.x);

export function thinkBot(w: World, p: Player, dt: number): void {
  const b = p.ai!;
  // the ram button: held for `press` seconds, then released
  if (b.press > 0) {
    b.press -= dt;
    p.input.btn = b.press > 0;
    const t = w.players.get(b.target);
    if (t && t.alive) p.input.a = aimAt(p, t.x + t.vx * 0.12, t.z + t.vz * 0.12);
    return;
  }
  p.input.btn = false;
  if ((b.think -= dt) > 0) return;
  b.think = 0.12 + w.rand() * 0.18;

  const r = radiusOf(p.mass);
  p.input.mv = true;

  // never wander into the fence
  if (Math.hypot(p.x, p.z) > CFG.R - 7 - r) {
    p.input.a = Math.atan2(-p.z, -p.x) + (w.rand() - 0.5) * 0.6;
    return;
  }

  // prey: smaller-ish, close, and ideally near the fence or already stunned
  let prey: Player | null = null, preyScore = 0;
  for (const o of w.players.values()) {
    if (o === p || !o.alive) continue;
    const gap = Math.hypot(o.x - p.x, o.z - p.z) - r - radiusOf(o.mass);
    if (gap > 9 || o.mass > p.mass * 1.8) continue;
    const edge = Math.hypot(o.x, o.z) / CFG.R;
    const s = (1 - gap / 9) * (0.4 + edge) * (o.stunT > 0 ? 1.6 : 1);
    if (s > preyScore) { preyScore = s; prey = o; }
  }
  if (prey && p.cd <= 0 && w.rand() < b.aggro * preyScore * 0.9) {
    const gap = Math.hypot(prey.x - p.x, prey.z - p.z);
    b.target = prey.id;
    b.press = gap > 5 && w.rand() < 0.35 ? 0.5 + w.rand() * 0.6 : 0.06; // sometimes a charged ram
    p.input.a = aimAt(p, prey.x, prey.z);
    p.input.btn = true;
    return;
  }

  // graze: best kg per distance
  let fx = 0, fz = 0, best = 0;
  for (const f of w.food.values()) {
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d > 26) continue;
    const s = f.v / (d + 3);
    if (s > best) { best = s; fx = f.x; fz = f.z; }
  }
  if (best > 0) p.input.a = aimAt(p, fx, fz);
  else {
    b.wander += (w.rand() - 0.5) * 1.2;
    p.input.a = b.wander;
  }

  // steer around hay bales, and keep non-ducks out of ponds
  for (const [hx, hz, hr] of w.map.hay) {
    const d = Math.hypot(hx - p.x, hz - p.z);
    if (d > hr + r + 2.5) continue;
    const ang = aimAt(p, hx, hz), off = wrapAngle(ang - p.input.a);
    if (Math.abs(off) < 1.1) p.input.a = ang - Math.sign(off || 1) * 1.4;
  }
  if (p.species !== 'duck') {
    for (const [px, pz, pr] of w.map.pond) {
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d > pr * 1.3 + r + 2) continue;
      const ang = aimAt(p, px, pz), off = wrapAngle(ang - p.input.a);
      if (Math.abs(off) < 1.2) p.input.a = ang - Math.sign(off || 1) * 1.5;
    }
  }
}
