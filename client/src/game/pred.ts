import { CFG, TICK_MS, radiusOf, type Species } from '@shared/constants';
import type { MapData } from '@shared/map';
import { insideBlob, wrapAngle } from '@shared/math';
import type { Ent } from './state';

export interface PredSample {
  t: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export class ClientPredictor {
  on = false;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  a = 0;
  dashT = 0;
  flyT = 0;
  ex = 0;
  ez = 0;
  readonly hist: PredSample[] = [];
  sx = 0;
  sz = 0;
  sTick = -9;
  resets = 0;
  kicks = 0;
  stunned = false;
  stunT = 0;
  plow = false;

  reset(x = 0, z = 0): void {
    this.on = true;
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.dashT = 0;
    this.flyT = 0;
    this.ex = 0;
    this.ez = 0;
    this.hist.length = 0;
    this.sx = x;
    this.sz = z;
    this.sTick = -9;
    this.stunned = false;
    this.stunT = 0;
    this.plow = false;
  }

  setStun(duration = 1.5): void {
    this.stunned = true;
    this.stunT = Math.max(this.stunT, duration);
    this.dashT = 0;
    this.flyT = 0;
    this.plow = false;
  }

  predAt(t: number): { x: number; z: number; vx: number; vz: number } | null {
    const h = this.hist;
    if (!h.length) return null;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i], a = h[i - 1];
      if (a.t <= t) {
        const k = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 1;
        return {
          x: a.x + (b.x - a.x) * k,
          z: a.z + (b.z - a.z) * k,
          vx: a.vx + (b.vx - a.vx) * k,
          vz: a.vz + (b.vz - a.vz) * k,
        };
      }
    }
    return h[h.length - 1];
  }

  onServerSnapshot(
    x: number,
    z: number,
    flags: number,
    snapTick: number,
    clockOff: number | null,
    rtt: number
  ): void {
    const targetTime = clockOff !== null ? clockOff + snapTick * TICK_MS - (rtt * 0.75) : null;
    const then = this.on && targetTime !== null ? this.predAt(targetTime) : null;

    if (!then || Math.hypot(x - then.x, z - then.z) > 10) {
      if (this.on) this.resets++;
      this.reset(x, z);
      this.sx = x;
      this.sz = z;
      this.sTick = snapTick;
      return;
    }

    const rawEx = x - then.x;
    const rawEz = z - then.z;
    const dist = Math.hypot(rawEx, rawEz);

    // Deadzone: under 0.35m discrepancy is normal clock jitter, do not jerk the player!
    if (dist < 0.35) {
      this.ex *= 0.75;
      this.ez *= 0.75;
    } else {
      this.ex = rawEx * 0.65;
      this.ez = rawEz * 0.65;
    }

    const isServerStun = (flags & 8) !== 0;
    if (isServerStun) {
      if (!this.stunned) {
        this.setStun(1.5);
        if (this.sTick === snapTick - 1 && clockOff !== null) {
          const age = Math.max(0, performance.now() - (clockOff + snapTick * TICK_MS) + rtt / 2) / 1000;
          const decay = Math.exp(-3.5 * age);
          this.kicks++;
          this.vx = ((x - this.sx) / (TICK_MS / 1000)) * decay;
          this.vz = ((z - this.sz) / (TICK_MS / 1000)) * decay;
          this.dashT = 0;
          this.flyT = 0;
        }
      }
    } else {
      this.stunned = false;
      this.stunT = 0;
    }
    this.sx = x;
    this.sz = z;
    this.sTick = snapTick;
  }

  predictDash(species: Species, held: number, aimA: number, map: MapData | null, isSuper = false): void {
    if (!this.on || this.stunned || this.stunT > 0) return;
    const inWater = map ? map.pond.some((b) => insideBlob(b, this.x, this.z)) : false;
    if (inWater) return;
    if (isSuper) {
      this.plow = true;
      this.vx = Math.cos(aimA) * 62;
      this.vz = Math.sin(aimA) * 62;
      this.a = aimA;
      this.dashT = 0.55;
      this.flyT = 0.55;
      return;
    }
    const inMud = map ? map.mud.some((b) => insideBlob(b, this.x, this.z)) : false;
    const mud = inMud && species !== 'pig' ? 0.6 : 1;
    const DS = CFG.DASH_SPEED;
    const DT = CFG.DASH_TIME;
    const CMIN = CFG.CHARGE_MIN;
    const CMAX = CFG.CHARGE_MAX;

    let sp = DS * mud * (species === 'chicken' ? 1.1 : 1);
    let dashT = DT;

    this.plow = held >= CMIN;
    if (this.plow) {
      const c = Math.min(1, Math.max(0, (held - CMIN) / (CMAX - CMIN)));
      sp = DS * (1 + 0.45 * c) * mud;
      dashT = DT + 0.28 * c;
    }

    this.vx = Math.cos(aimA) * sp;
    this.vz = Math.sin(aimA) * sp;
    this.a = aimA;
    this.dashT = dashT;
  }

  private ramContact(myMass: number, rtt: number, ents: Map<number, Ent>, myId: number, snapTick: number): void {
    const r = radiusOf(myMass);
    const ahead = Math.min(0.6, rtt / 1000);
    for (const st of ents.values()) {
      if (st.id === myId || st.seen !== snapTick || (st.flags & 2) || !st.hist || st.hist.length < 2) continue;
      const h = st.hist;
      const a = h[h.length - 2];
      const b = h[h.length - 1];
      const k = (ahead * 1000) / TICK_MS / Math.max(1, b[0] - a[0]);
      const ox = b[1] + (b[1] - a[1]) * k;
      const oz = b[2] + (b[2] - a[2]) * k;
      if (Math.hypot(ox - this.x, oz - this.z) < r + radiusOf(st.mass)) {
        this.dashT = 0;
        this.vx *= 0.25;
        this.vz *= 0.25;
        return;
      }
    }
  }

  step(
    dt: number,
    now: number,
    species: Species,
    flags: number,
    myMass: number,
    holding: boolean,
    aimA: number,
    aimMove: boolean,
    map: MapData | null,
    ents: Map<number, Ent>,
    myId: number,
    snapTick: number,
    rtt: number
  ): void {
    if (!this.on || !map) return;
    const stun = (flags & 8) !== 0 || this.stunned || this.stunT > 0;
    const mm = Math.max(1, myMass);
    const charging = !stun && holding;
    const canMove = !stun && aimMove;
    const plowing = (flags & 2) !== 0 || this.plow;

    for (let left = dt; left > 1e-4;) {
      const h = Math.min(left, 0.025);
      left -= h;
      this.dashT = Math.max(0, this.dashT - h);
      this.flyT = Math.max(0, this.flyT - h);
      this.stunT = Math.max(0, this.stunT - h);
      if (this.stunT <= 0 && (flags & 8) === 0) {
        this.stunned = false;
      }

      const water = map.pond.some((b) => insideBlob(b, this.x, this.z));
      const mud = map.mud.some((b) => insideBlob(b, this.x, this.z));

      let terrain = water
        ? species === 'duck' ? 1.25 : 0.4
        : mud
        ? species === 'pig' ? 1.1 : 0.5
        : species === 'duck' ? 0.87 : 1;

      const maxSp = CFG.MOVE_SPEED * Math.pow(20 / mm, 0.15) * terrain * (charging ? 0.45 : 1);

      if (this.dashT > 0) {
        const d = Math.exp(-1.2 * h);
        this.vx *= d;
        this.vz *= d;
      } else if (stun || !canMove) {
        const d = Math.exp(-3.5 * h);
        this.vx *= d;
        this.vz *= d;
      } else {
        const k = Math.min(1, CFG.MOVE_ACCEL * Math.pow(20 / mm, 0.25) * terrain * h);
        this.vx += (Math.cos(aimA) * maxSp - this.vx) * k;
        this.vz += (Math.sin(aimA) * maxSp - this.vz) * k;
      }

      if (water && species !== 'duck' && this.dashT <= 0) {
        const d = Math.exp(-2 * h);
        this.vx *= d;
        this.vz *= d;
      }

      if (!stun && this.dashT <= 0) {
        this.a += wrapAngle(aimA - this.a) * Math.min(1, 24 * h);
      }

      this.x += this.vx * h;
      this.z += this.vz * h;

      if (this.dashT > 0 && !plowing) {
        this.ramContact(myMass, rtt, ents, myId, snapTick);
      }

      // Hay collision
      const r = radiusOf(myMass);
      for (const [hx, hz, hr] of map.hay) {
        const dx = this.x - hx, dz = this.z - hz;
        const d = Math.hypot(dx, dz);
        if (d < hr + r && d > 0) {
          const nx = dx / d, nz = dz / d;
          this.x = hx + nx * (hr + r);
          this.z = hz + nz * (hr + r);
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= 1.6 * vn * nx;
            this.vz -= 1.6 * vn * nz;
          }
          if (this.dashT > 0 || Math.hypot(this.vx, this.vz) > 5) {
            this.setStun(1.5);
          }
        }
      }

      // Fence clamp
      const distCenter = Math.hypot(this.x, this.z);
      const limit = CFG.R - radiusOf(myMass) * 0.3 - 0.5;
      if (distCenter > limit) {
        this.x = (this.x / distCenter) * limit;
        this.z = (this.z / distCenter) * limit;
        if (this.flyT > 0) {
          this.vx *= -0.2;
          this.vz *= -0.2;
          this.flyT = 0;
          this.dashT = 0;
        } else {
          this.vx *= 0.5;
          this.vz *= 0.5;
        }
      }
    }

    // Ease out remaining error smoothly (exponential decay with error scaling)
    const errorMag = Math.hypot(this.ex, this.ez);
    const k = 1 - Math.exp(-dt * (8 + 3 * errorMag));
    const cx = this.ex * k;
    const cz = this.ez * k;
    this.x += cx;
    this.z += cz;
    this.ex -= cx;
    this.ez -= cz;

    for (const s of this.hist) {
      s.x += cx;
      s.z += cz;
    }

    this.hist.push({ t: now, x: this.x, z: this.z, vx: this.vx, vz: this.vz });
    while (this.hist.length > 2 && this.hist[0].t < now - 1500) {
      this.hist.shift();
    }
  }
}
