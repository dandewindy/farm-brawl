// Movement rules shared by the authoritative simulation and (from phase 2) the client's own-animal prediction.
// Everything here is pure: same inputs, same outputs, on every machine.
import { CFG, TRAITS, radiusOf, type Species } from './constants';
import type { MapData } from './map';
import { type Circle, clamp, insideBlob, wrapAngle } from './math';
import type { Input } from './protocol';

/** 0 grass, 1 pond, 2 mud */
export type Terrain = 0 | 1 | 2;

export function terrainAt(map: MapData, x: number, z: number): Terrain {
  for (const b of map.pond) if (insideBlob(b, x, z)) return 1;
  for (const b of map.mud) if (insideBlob(b, x, z)) return 2;
  return 0;
}

/** the moving part of an animal */
export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  a: number;
  mass: number;
  /** seconds of dash left */
  dashT: number;
  /** seconds of stun left (knocked back, no control) */
  stunT: number;
  /** holding the ram button long enough to be slowed down */
  charging: boolean;
}

export function terrainFactor(sp: Species, t: Terrain): number {
  const tr = TRAITS[sp];
  if (t === 1) return tr.water;
  if (t === 2) return tr.mud;
  return sp === 'duck' ? 0.92 : 1;
}

export function maxSpeed(sp: Species, mass: number, t: Terrain, charging: boolean): number {
  return CFG.MOVE_SPEED * TRAITS[sp].speed * Math.pow(20 / Math.max(1, mass), 0.15) * terrainFactor(sp, t) * (charging ? 0.45 : 1);
}

/** advance one body by dt seconds */
export function stepMove(b: Body, inp: Input, dt: number, sp: Species, t: Terrain): void {
  const stunned = b.stunT > 0;
  if (b.dashT > 0) {
    const d = Math.exp(-1.2 * dt);
    b.vx *= d; b.vz *= d;
  } else if (stunned || !inp.mv) {
    const d = Math.exp(-3.5 * dt);
    b.vx *= d; b.vz *= d;
  } else {
    const ms = maxSpeed(sp, b.mass, t, b.charging);
    const k = Math.min(1, CFG.MOVE_ACCEL * Math.pow(20 / Math.max(1, b.mass), 0.25) * terrainFactor(sp, t) * dt);
    b.vx += (Math.cos(inp.a) * ms - b.vx) * k;
    b.vz += (Math.sin(inp.a) * ms - b.vz) * k;
  }
  // ponds drag everyone but ducks, even while knocked back
  if (t === 1 && sp !== 'duck' && b.dashT <= 0) {
    const d = Math.exp(-2 * dt);
    b.vx *= d; b.vz *= d;
  }
  if (!stunned && b.dashT <= 0 && inp.mv) b.a += wrapAngle(inp.a - b.a) * Math.min(1, 12 * dt);
  b.a = wrapAngle(b.a);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.dashT = Math.max(0, b.dashT - dt);
  b.stunT = Math.max(0, b.stunT - dt);
}

/** hay bales are solid: push out, bounce, and stun on ram */
export function collideHay(b: Body, hay: Circle[]): boolean {
  const r = radiusOf(b.mass);
  let hit = false;
  for (const [hx, hz, hr] of hay) {
    const dx = b.x - hx, dz = b.z - hz;
    const d = Math.hypot(dx, dz);
    if (d >= hr + r || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d;
    b.x = hx + nx * (hr + r);
    b.z = hz + nz * (hr + r);
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= 1.6 * vn * nx;
      b.vz -= 1.6 * vn * nz;
    }
    // Dashing or knocking into hay bale / post stuns for 1.5 seconds
    if (b.dashT > 0 || Math.hypot(b.vx, b.vz) > 5) {
      b.stunT = Math.max(b.stunT, 1.5);
      b.dashT = 0;
      hit = true;
    }
  }
  return hit;
}

/** touching the electric fence */
export const outsideFence = (b: Body): boolean => Math.hypot(b.x, b.z) + radiusOf(b.mass) * 0.3 > CFG.R;

export interface DashParams {
  speed: number;
  time: number;
  /** a charged ram ploughs through animals instead of stopping at the first one */
  plow: boolean;
  /** knockback multiplier, 1..2 */
  power: number;
}

/** what a release of the ram button does after holding it for `held` seconds */
export function dashParams(sp: Species, held: number, t: Terrain): DashParams {
  const mud = t === 2 && sp !== 'pig' ? 0.6 : 1;
  let speed = CFG.DASH_SPEED * TRAITS[sp].dash * mud;
  let time: number = CFG.DASH_TIME;
  let plow = false, power = 1;
  if (held >= CFG.CHARGE_MIN) {
    const c = clamp((held - CFG.CHARGE_MIN) / (CFG.CHARGE_MAX - CFG.CHARGE_MIN), 0, 1);
    speed *= 1 + 0.45 * c;
    time += 0.28 * c;
    plow = true;
    power = 1 + c;
  }
  return { speed, time, plow, power };
}

/** charge progress 0..1 for a hold of `held` seconds */
export const chargeLevel = (held: number): number => clamp((held - CFG.CHARGE_MIN) / (CFG.CHARGE_MAX - CFG.CHARGE_MIN), 0, 1);
