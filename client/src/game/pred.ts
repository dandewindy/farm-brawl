import { CFG, radiusOf, type Species } from '@shared/constants';
import type { MapData } from '@shared/map';
import { wrapAngle } from '@shared/math';
import {
  type Body,
  collideHay,
  dashParams,
  stepMove,
  terrainAt,
} from '@shared/physics';
import type { Input } from '@shared/protocol';
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

  // Authoritative physical simulation state (simulated forward by client physics)
  simX = 0;
  simZ = 0;
  vx = 0;
  vz = 0;
  a = 0;
  mass: number = CFG.START_MASS;
  dashT = 0;
  flyT = 0;
  stunT = 0;
  stunned = false;
  plow = false;
  podShieldActive = true;

  // Visual render position (simulated position + smoothly decaying error offset)
  // Guarantees 100% butter-smooth rendering without jitter/wobble
  x = 0;
  z = 0;

  // Error offset vector (decays smoothly to 0 via exponential smoothing)
  errorX = 0;
  errorZ = 0;

  get ex(): number {
    return this.errorX;
  }
  get ez(): number {
    return this.errorZ;
  }

  // History buffer for time-accurate snapshot reconciliation
  readonly hist: PredSample[] = [];

  // Server state tracking
  sx = 0;
  sz = 0;
  sTick = -9;
  resets = 0;
  kicks = 0;

  // Dash grace window tracking (prevents pre-dash server snapshots from snapping the player backward)
  private lastDashLaunchTime = 0;

  reset(x = 0, z = 0): void {
    this.on = true;
    this.simX = x;
    this.simZ = z;
    this.x = x;
    this.z = z;
    this.errorX = 0;
    this.errorZ = 0;
    this.vx = 0;
    this.vz = 0;
    this.dashT = 0;
    this.flyT = 0;
    this.hist.length = 0;
    this.sx = x;
    this.sz = z;
    this.sTick = -9;
    this.stunned = false;
    this.stunT = 0;
    this.plow = false;
    this.lastDashLaunchTime = 0;
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
        const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
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
    serverX: number,
    serverZ: number,
    flags: number,
    snapTick: number,
    _clockOff: number | null,
    rtt: number
  ): void {
    if (!this.on) return;

    const now = performance.now();

    // 1. Dash Grace Window:
    // When the player launches a dash, the command is in flight across the network (1 RTT ~ 35-50ms)
    // plus server tick latency (~0-50ms). During this 140ms window, incoming server snapshots
    // represent state BEFORE the dash started. We must NOT let pre-dash snapshots pull the player backward!
    const timeSinceDash = now - this.lastDashLaunchTime;
    const serverIsDashing = (flags & 1) !== 0;
    if (timeSinceDash < 140 && !serverIsDashing && this.dashT > 0) {
      this.sx = serverX;
      this.sz = serverZ;
      this.sTick = snapTick;
      return;
    }

    // 2. Sample predicted history at the estimated time the server generated this tick:
    // Packet arrived at `now`, one-way transit time is ~rtt * 0.5.
    const oneWayLatency = Math.max(10, Math.min(150, (rtt > 0 ? rtt : 35) * 0.5));
    const targetTime = now - oneWayLatency;
    const then = this.predAt(targetTime);

    // 3. Huge discrepancy check (respawn, teleport, map warp, or > 6.0m):
    const currentDist = Math.hypot(serverX - this.simX, serverZ - this.simZ);
    if (!then || currentDist > 6.0) {
      this.resets++;
      this.reset(serverX, serverZ);
      return;
    }

    // 4. Calculate error against historical predicted position at that timestamp:
    const dx = serverX - then.x;
    const dz = serverZ - then.z;
    const errorDist = Math.hypot(dx, dz);

    // 5. Deadzone & Visual Error Smoothing (Glenn Fiedler / Gabriel Gambetta model):
    // If error is under 0.25m, it is pure sub-frame tick quantization between 20Hz server & 60/120Hz client.
    // Do not jerk the player!
    if (errorDist > 0.25 && errorDist <= 4.0) {
      // Soft adjustment: adjust simulation position by 50% of the discrepancy
      const adjustX = dx * 0.5;
      const adjustZ = dz * 0.5;
      this.simX += adjustX;
      this.simZ += adjustZ;

      // Crucial: offset visual error by the negative of adjustment so that
      // render position (simX + errorX) DOES NOT JUMP!
      this.errorX -= adjustX;
      this.errorZ -= adjustZ;

      // Adjust history so subsequent frames don't double-compensate
      for (const s of this.hist) {
        s.x += adjustX;
        s.z += adjustZ;
      }
    } else if (errorDist > 4.0) {
      // Larger discrepancy (e.g. violent knockback or explosion):
      // Snap simulation state, and smoothly blend visual render transition
      this.simX = serverX;
      this.simZ = serverZ;
      this.errorX = Math.max(-2, Math.min(2, then.x - serverX));
      this.errorZ = Math.max(-2, Math.min(2, then.z - serverZ));
      this.hist.length = 0;
    }

    // 6. Synchronize Stun & Knockback:
    const isServerStun = (flags & 8) !== 0;
    if (isServerStun) {
      if (!this.stunned) {
        this.setStun(1.5);
        if (this.sTick === snapTick - 1) {
          this.kicks++;
          this.vx = (serverX - this.sx) / 0.05;
          this.vz = (serverZ - this.sz) / 0.05;
          this.dashT = 0;
          this.flyT = 0;
        }
      }
    } else if (this.stunT <= 0) {
      this.stunned = false;
    }

    this.sx = serverX;
    this.sz = serverZ;
    this.sTick = snapTick;
  }

  predictDash(species: Species, held: number, aimA: number, map: MapData | null, isSuper = false): void {
    if (!this.on || this.stunned || this.stunT > 0) return;
    if (map) {
      const terrain = terrainAt(map, this.simX, this.simZ);
      if (terrain === 1) return; // Cannot dash in water
    }

    this.lastDashLaunchTime = performance.now();

    if (isSuper) {
      this.plow = true;
      this.vx = Math.cos(aimA) * 62;
      this.vz = Math.sin(aimA) * 62;
      this.a = aimA;
      this.dashT = 0.55;
      this.flyT = 0.55;
      return;
    }

    const terrain = map ? terrainAt(map, this.simX, this.simZ) : 0;
    const d = dashParams(species, held, terrain);
    this.vx = Math.cos(aimA) * d.speed;
    this.vz = Math.sin(aimA) * d.speed;
    this.a = aimA;
    this.dashT = d.time;
    this.plow = d.plow;
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
    _ents: Map<number, Ent>,
    _myId: number,
    _snapTick: number,
    _rtt: number,
    speedMult = 1.0
  ): void {
    if (!this.on || !map) return;

    this.mass = myMass;
    const stun = (flags & 8) !== 0 || this.stunned || this.stunT > 0;
    const charging = !stun && holding;
    const canMove = !stun && aimMove;

    // Substep simulation at 25ms max for rock-solid numerical stability matching server
    for (let left = dt; left > 1e-4;) {
      const h = Math.min(left, 0.025);
      left -= h;

      if (this.flyT > 0) this.flyT = Math.max(0, this.flyT - h);

      const terrain = terrainAt(map, this.simX, this.simZ);
      const body: Body = {
        x: this.simX,
        z: this.simZ,
        vx: this.vx,
        vz: this.vz,
        a: this.a,
        mass: myMass,
        dashT: this.dashT,
        stunT: this.stunT,
        charging,
      };

      const inputObj: Input = {
        a: aimA,
        mv: canMove,
        btn: holding,
      };

      // Exact 100% identical pure shared physics simulation
      stepMove(body, inputObj, h, species, terrain, speedMult);

      this.simX = body.x;
      this.simZ = body.z;
      this.vx = body.vx;
      this.vz = body.vz;
      this.a = body.a;
      this.dashT = body.dashT;
      this.stunT = body.stunT;

      // Smooth aim turning when stationary or charging
      if (!stun && this.dashT <= 0 && (!canMove || holding)) {
        this.a += wrapAngle(aimA - this.a) * Math.min(1, 12 * h);
        this.a = wrapAngle(this.a);
      }

      if (this.dashT <= 0) {
        this.plow = false;
      }
      if (this.stunT <= 0 && (flags & 8) === 0) {
        this.stunned = false;
      }

      // Hay collision (identical to server collideHay)
      const hayHit = collideHay(body, map.hay);
      if (hayHit) {
        this.simX = body.x;
        this.simZ = body.z;
        this.vx = body.vx;
        this.vz = body.vz;
        this.stunT = body.stunT;
        this.dashT = body.dashT;
        this.plow = false;
      }

      // Podium barrier collision
      if (this.podShieldActive && map.podium) {
        const [podX, podZ] = map.podium;
        const dx = this.simX - podX;
        const dz = this.simZ - podZ;
        const d = Math.hypot(dx, dz);
        const pr = radiusOf(myMass);
        const minD = CFG.PODIUM_R + 0.5 + pr;
        if (d < minD && d > 1e-6) {
          const nx = dx / d;
          const nz = dz / d;
          this.simX = podX + nx * minD;
          this.simZ = podZ + nz * minD;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= 1.4 * vn * nx;
            this.vz -= 1.4 * vn * nz;
          }
          if (this.dashT > 0) {
            this.dashT = 0;
            this.plow = false;
          }
        }
      }

      // Electric fence boundary clamp
      const distCenter = Math.hypot(this.simX, this.simZ);
      const pr = radiusOf(myMass);
      const limit = CFG.R - pr * 0.3 - 0.5;
      if (distCenter > limit && distCenter > 1e-6) {
        this.simX = (this.simX / distCenter) * limit;
        this.simZ = (this.simZ / distCenter) * limit;
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

    // Record sample in history buffer
    this.hist.push({ t: now, x: this.simX, z: this.simZ, vx: this.vx, vz: this.vz });
    if (this.hist.length > 2 && this.hist[0].t < now - 1500) {
      let cut = 0;
      while (cut < this.hist.length - 2 && this.hist[cut].t < now - 1500) cut++;
      if (cut > 0) this.hist.splice(0, cut);
    }

    // Exponential decay of visual error offset (smoothly converges over ~100ms without jitter)
    const decay = Math.exp(-12.0 * dt);
    this.errorX *= decay;
    this.errorZ *= decay;
    if (Math.abs(this.errorX) < 0.003) this.errorX = 0;
    if (Math.abs(this.errorZ) < 0.003) this.errorZ = 0;

    // Visual render coordinates = physics state + visual error offset
    this.x = this.simX + this.errorX;
    this.z = this.simZ + this.errorZ;
  }
}
