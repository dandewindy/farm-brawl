import { CFG, radiusOf, type Species } from '@shared/constants';
import type { MapData } from '@shared/map';
import { wrapAngle } from '@shared/math';
import {
  type Body,
  collideHay,
  collideTreeTrunks,
  dashParams,
  stepMove,
  terrainAt,
} from '@shared/physics';
import type { Input } from '@shared/protocol';
import type { Ent } from './state';

export interface PredSample {
  t: number;
  seq: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  dashing: boolean;
  dashT?: number;
}

export class ClientPredictor {
  on = false;

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
  holdT = 0;
  podShieldActive = true;
  aimMove = false;

  x = 0;
  z = 0;

  errorX = 0;
  errorZ = 0;

  get ex(): number {
    return this.errorX;
  }
  get ez(): number {
    return this.errorZ;
  }

  readonly hist: PredSample[] = [];

  sx = 0;
  sz = 0;
  sTick = -9;
  resets = 0;
  kicks = 0;

  currentSeq = 0;
  lastDashSeq = 0;
  lastReconciledSeq = 0;
  lastServerTick = -1;

  private lastDashLaunchTime = 0;
  private lastDashEndTime = 0;

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
    this.holdT = 0;
    this.lastDashLaunchTime = 0;
    this.lastDashEndTime = 0;
  }

  setStun(duration = 1.5): void {
    this.stunned = true;
    this.stunT = Math.max(this.stunT, duration);
    this.dashT = 0;
    this.flyT = 0;
    this.plow = false;
    this.holdT = 0;
  }

  predAtSeq(targetSeq: number): PredSample | null {
    if (this.hist.length === 0) return null;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (this.hist[i].seq <= targetSeq) {
        return this.hist[i];
      }
    }
    return null;
  }

  predAt(t: number): PredSample | null {
    const h = this.hist;
    if (!h.length) return null;
    if (t <= h[0].t) return h[0];
    if (t >= h[h.length - 1].t) return h[h.length - 1];
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i], a = h[i - 1];
      if (a.t <= t && t <= b.t) {
        const span = b.t - a.t;
        const k = span > 0.0001 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
        return {
          t,
          seq: k >= 0.5 ? b.seq : a.seq,
          x: a.x + (b.x - a.x) * k,
          z: a.z + (b.z - a.z) * k,
          vx: a.vx + (b.vx - a.vx) * k,
          vz: a.vz + (b.vz - a.vz) * k,
          dashing: a.dashing || b.dashing,
          dashT: (a.dashT ?? 0) + ((b.dashT ?? 0) - (a.dashT ?? 0)) * k,
        };
      }
    }
    return h[h.length - 1];
  }

  private applySmoothCorrection(
    dx: number,
    dz: number,
    gain: number,
    reconciledTime: number
  ): void {
    const corrX = dx * gain;
    const corrZ = dz * gain;

    // 1. Shift physical simulation state
    this.simX += corrX;
    this.simZ += corrZ;

    // 2. Subtract from visual error offset so render position (x = simX + errorX) doesn't jump at frame 0
    this.errorX -= corrX;
    this.errorZ -= corrZ;

    const maxVisualOffset = 3.5;
    const errMag = Math.hypot(this.errorX, this.errorZ);
    if (errMag > maxVisualOffset) {
      const scale = maxVisualOffset / errMag;
      this.errorX *= scale;
      this.errorZ *= scale;
    }

    this.x = this.simX + this.errorX;
    this.z = this.simZ + this.errorZ;

    // 3. Shift all samples from reconciledTime to current time
    for (let i = 0; i < this.hist.length; i++) {
      if (this.hist[i].t >= reconciledTime) {
        this.hist[i].x += corrX;
        this.hist[i].z += corrZ;
      }
    }
  }

  onServerSnapshot(
    serverX: number,
    serverZ: number,
    flags: number,
    snapTick: number,
    clockOff: number | null,
    rtt: number,
    ackSeq = 0,
    ackDash = 0,
    serverTime?: number
  ): void {
    if (!this.on) {
      this.reset(serverX, serverZ);
      return;
    }

    // 1. Skip late/out-of-order snapshots
    if (snapTick > 0 && snapTick <= this.lastServerTick) {
      return;
    }
    this.lastServerTick = snapTick;

    const now = performance.now();
    const isServerStun = (flags & 8) !== 0;
    const serverIsDashing = (flags & 1) !== 0;

    // 0. Update velocity if server transmitted a heavy force impulse
    if (this.sTick === snapTick - 1) {
      const svx = (serverX - this.sx) / 0.05;
      const svz = (serverZ - this.sz) / 0.05;
      const svSpeed = Math.hypot(svx, svz);
      if (isServerStun || svSpeed > 15) {
        this.kicks++;
        this.vx = svx;
        this.vz = svz;
      }
    }

    this.sx = serverX;
    this.sz = serverZ;
    this.sTick = snapTick;

    // 2. Stun handling
    if (isServerStun) {
      this.dashT = 0;
      this.flyT = 0;
      this.plow = false;
      if (!this.stunned) this.setStun(1.5);
      const dxStun = serverX - this.simX;
      const dzStun = serverZ - this.simZ;
      if (Math.hypot(dxStun, dzStun) > 12.0) {
        this.resets++;
        this.reset(serverX, serverZ);
      } else {
        this.applySmoothCorrection(dxStun, dzStun, 0.55, now);
      }
      return;
    } else if (this.stunT <= 0) {
      this.stunned = false;
    }

    // 3. Anti-Double-Dash Guard:
    const timeSinceLaunch = now - this.lastDashLaunchTime;
    const timeSinceEnd = now - this.lastDashEndTime;
    const effectiveRtt = rtt > 0 ? Math.min(rtt, 140) : 48;

    const serverHasAckedOurDash =
      serverIsDashing ||
      (this.lastDashSeq > 0 &&
        (ackDash >= this.lastDashSeq || ackSeq >= this.lastDashSeq));

    // Never allow pre-dash snapshots to roll back a locally launched dash
    if (
      this.lastDashSeq > 0 &&
      !serverHasAckedOurDash &&
      timeSinceLaunch < Math.max(380, effectiveRtt * 2.5 + 180)
    ) {
      return;
    }

    // 4. Historical sample lookup via precise clock synchronization (avoids window-end bias of predAtSeq)
    const minLookbackMs = Math.max(25, effectiveRtt * 0.55);
    const maxLookbackMs = Math.min(260, effectiveRtt * 1.45 + 45);
    const defaultLookbackMs = effectiveRtt * 0.85 + 18;

    let targetTime = now - defaultLookbackMs;

    if (typeof serverTime === 'number' && clockOff !== null) {
      const serverSentPerfTime = serverTime - clockOff;
      const estimatedClientSimTime = serverSentPerfTime - (effectiveRtt * 0.45 + 12);
      const lookback = now - estimatedClientSimTime;

      if (lookback >= minLookbackMs && lookback <= maxLookbackMs) {
        targetTime = estimatedClientSimTime;
      } else {
        targetTime = now - Math.max(minLookbackMs, Math.min(maxLookbackMs, defaultLookbackMs));
      }
    }

    const then = this.predAt(targetTime);
    if (!then) return;

    // 5. Calculate error vector
    const dx = serverX - then.x;
    const dz = serverZ - then.z;
    const errorDist = Math.hypot(dx, dz);

    if (errorDist > 18.0) {
      this.resets++;
      this.reset(serverX, serverZ);
      return;
    }

    const inDashPhase = this.dashT > 0 || serverIsDashing || then.dashing || timeSinceEnd < 250;

    // 6. Longitudinal Tolerance Filter:
    // When moving steadily, longitudinal error along (vx, vz) is predominantly network jitter.
    // Filter out longitudinal jitter under 0.65m if lateral error is small (< 0.22m)
    // to completely eliminate systematic backward jerking!
    const speed = Math.hypot(then.vx, then.vz);
    let deadzone = inDashPhase ? 1.35 : 0.25;

    if (!inDashPhase && speed > 1.0) {
      const dirX = then.vx / speed;
      const dirZ = then.vz / speed;
      const longitudinalErr = dx * dirX + dz * dirZ;
      const lateralErr = Math.hypot(dx - longitudinalErr * dirX, dz - longitudinalErr * dirZ);

      if (lateralErr < 0.22 && Math.abs(longitudinalErr) < 0.65) {
        return;
      }
      deadzone = 0.40;
    }

    if (errorDist <= deadzone) return;

    const excessRatio = (errorDist - deadzone) / errorDist;
    const effDx = dx * excessRatio;
    const effDz = dz * excessRatio;
    const nudgeGain = inDashPhase ? 0.16 : 0.24;

    this.applySmoothCorrection(effDx, effDz, nudgeGain, then.t);
    if (ackSeq > this.lastReconciledSeq) {
      this.lastReconciledSeq = ackSeq;
    }
  }

  predictDash(species: Species, held: number, aimA: number, map: MapData | null, isSuper = false, dashSeq?: number): void {
    if (!this.on || this.stunned || this.stunT > 0 || this.dashT > 0) return;
    if (map) {
      const terrain = terrainAt(map, this.simX, this.simZ);
      if (terrain === 1) return; // Cannot dash in water
    }

    const now = performance.now();
    this.lastDashLaunchTime = now;
    this.lastDashSeq = dashSeq !== undefined ? dashSeq : this.currentSeq;

    if (isSuper) {
      this.plow = true;
      this.vx = Math.cos(aimA) * 62;
      this.vz = Math.sin(aimA) * 62;
      this.a = aimA;
      this.dashT = 0.55;
      this.flyT = 0.55;
      this.holdT = 0;
      this.lastDashEndTime = now + 550;
      return;
    }

    const effectiveHeld = this.mass >= 20 ? held : 0;
    const terrain = map ? terrainAt(map, this.simX, this.simZ) : 0;
    const d = dashParams(species, effectiveHeld, terrain);
    this.vx = Math.cos(aimA) * d.speed;
    this.vz = Math.sin(aimA) * d.speed;
    this.a = aimA;
    this.dashT = d.time;
    this.plow = d.plow;
    this.holdT = 0;
    this.lastDashEndTime = now + d.time * 1000;
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
    speedMult = 1.0,
    myCd = 0
  ): void {
    if (!this.on || !map) return;

    this.mass = myMass;
    const stun = (flags & 8) !== 0 || this.stunned || this.stunT > 0;

    // Đồng bộ 100% với handleButton() trên Server: không tích lực và không làm chậm khi đang cooldown hoặc đang dash!
    const canCharge = !stun && this.dashT <= 0 && myCd <= 0.05 && myMass >= 20;
    if (holding && canCharge) {
      this.holdT = Math.min(CFG.CHARGE_MAX + 0.5, this.holdT + dt);
    } else {
      this.holdT = 0;
    }
    const charging = canCharge && holding && this.holdT >= CFG.CHARGE_SLOW_AFTER;
    const canMove = !stun && aimMove;
    this.aimMove = canMove;

    const wasDashing = this.dashT > 0;

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

      // stepMove đã bao gồm cả xoay hướng khi di chuyển lẫn khi đứng gồng/ngắm
      stepMove(body, inputObj, h, species, terrain, speedMult);

      this.simX = body.x;
      this.simZ = body.z;
      this.vx = body.vx;
      this.vz = body.vz;
      this.a = body.a;
      this.dashT = body.dashT;
      this.stunT = body.stunT;

      // Chỉ xoay thêm khi đứng yên ngắm chuột mà không giữ nút (vì charging đã được xoay trong stepMove)
      if (!stun && this.dashT <= 0 && !canMove && !charging) {
        const turnK = 1 - Math.exp(-18 * h);
        this.a = wrapAngle(this.a + wrapAngle(aimA - this.a) * turnK);
      }

      if (this.dashT <= 0) {
        this.plow = false;
      }
      if (this.stunT <= 0 && (flags & 8) === 0) {
        this.stunned = false;
      }

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

      const treeHit = collideTreeTrunks(body, map.trees);
      if (treeHit) {
        this.simX = body.x;
        this.simZ = body.z;
        this.vx = body.vx;
        this.vz = body.vz;
      }

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

    if (wasDashing && this.dashT <= 0) {
      this.lastDashEndTime = now;
    }

    this.hist.push({
      t: now,
      seq: this.currentSeq,
      x: this.simX,
      z: this.simZ,
      vx: this.vx,
      vz: this.vz,
      dashing: this.dashT > 0,
      dashT: this.dashT,
    });
    if (this.hist.length > 2 && this.hist[0].t < now - 1500) {
      let cut = 0;
      while (cut < this.hist.length - 2 && this.hist[cut].t < now - 1500) cut++;
      if (cut > 0) this.hist.splice(0, cut);
    }

    const decay = Math.exp(-14.0 * dt);
    this.errorX *= decay;
    this.errorZ *= decay;
    if (Math.abs(this.errorX) < 0.002 || (!canMove && Math.hypot(this.vx, this.vz) < 0.1)) this.errorX = 0;
    if (Math.abs(this.errorZ) < 0.002 || (!canMove && Math.hypot(this.vx, this.vz) < 0.1)) this.errorZ = 0;

    this.x = this.simX + this.errorX;
    this.z = this.simZ + this.errorZ;
  }
}
