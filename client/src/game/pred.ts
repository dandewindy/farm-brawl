import { CFG, radiusOf, TRAITS, type Species } from '@shared/constants';
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
import type { Input, PlayerMeta } from '@shared/protocol';
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
  private isCollidingWithEnts = false;

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

  private readonly seqSendTime = new Map<number, number>();
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
    this.seqSendTime.clear();
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

  recordSentSeq(seq: number, sentAtPerf: number): void {
    this.currentSeq = seq;
    this.seqSendTime.set(seq, sentAtPerf);
    if (this.seqSendTime.size > 120) {
      const oldestKey = this.seqSendTime.keys().next().value;
      if (oldestKey !== undefined) this.seqSendTime.delete(oldestKey);
    }
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
    reconciledTime: number,
    dampVelocity = false
  ): void {
    const corrX = dx * gain;
    const corrZ = dz * gain;

    // 1. Shift physical simulation state towards server
    this.simX += corrX;
    this.simZ += corrZ;

    // 2. Subtract from visual error offset so render position (x = simX + errorX) doesn't jump at frame 0
    this.errorX -= corrX;
    this.errorZ -= corrZ;

    const maxVisualOffset = 4.0;
    const errMag = Math.hypot(this.errorX, this.errorZ);
    if (errMag > maxVisualOffset) {
      const scale = maxVisualOffset / errMag;
      this.errorX *= scale;
      this.errorZ *= scale;
    }

    // 3. Ghost Velocity Damping:
    // If the server's correction vector opposes current velocity (e.g. server blocked/knocked us back),
    // damp the opposing velocity component to stop overshooting and rubberbanding
    const corrDist = Math.hypot(corrX, corrZ);
    if (dampVelocity && corrDist > 0.05) {
      const cnx = corrX / corrDist;
      const cnz = corrZ / corrDist;
      const vDot = this.vx * cnx + this.vz * cnz;
      if (vDot < 0) {
        const dampFactor = Math.min(0.65, gain * 1.1);
        this.vx -= vDot * cnx * dampFactor;
        this.vz -= vDot * cnz * dampFactor;
      }
    }

    this.x = this.simX + this.errorX;
    this.z = this.simZ + this.errorZ;

    // 4. Shift all samples from reconciledTime to current time
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
      } else if (this.isCollidingWithEnts) {
        this.vx = this.vx * 0.5 + svx * 0.5;
        this.vz = this.vz * 0.5 + svz * 0.5;
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
        this.applySmoothCorrection(dxStun, dzStun, 0.55, now, true);
      }
      return;
    } else if (this.stunT <= 0) {
      this.stunned = false;
    }

    // 3. Anti-Double-Dash Guard:
    const timeSinceLaunch = now - this.lastDashLaunchTime;
    const timeSinceEnd = now - this.lastDashEndTime;
    const effectiveRtt = rtt > 0 ? Math.min(rtt, 160) : 55;

    const serverHasAckedOurDash =
      serverIsDashing ||
      (this.lastDashSeq > 0 &&
        (ackDash >= this.lastDashSeq || ackSeq >= this.lastDashSeq));

    // Never allow pre-dash snapshots to roll back a locally launched dash
    if (
      this.lastDashSeq > 0 &&
      !serverHasAckedOurDash &&
      timeSinceLaunch < Math.max(320, effectiveRtt * 2.2 + 120)
    ) {
      return;
    }

    // 4. Historical sample lookup via causal priority:
    // PRIORITY 1: The exact sent time of the acked input sequence
    const physicalBaseRtt = rtt > 0 ? Math.min(rtt, 150) : 48;
    let targetTime = now - (physicalBaseRtt + 15);
    let foundValidTarget = false;

    if (ackSeq > 0 && this.seqSendTime.has(ackSeq)) {
      const sentAt = this.seqSendTime.get(ackSeq)!;
      const age = now - sentAt;
      if (age >= 10 && age <= 400) {
        targetTime = sentAt;
        foundValidTarget = true;
      }
    }

    // PRIORITY 2 (Fallback): Synchronized clock offset serverTime - clockOff
    if (!foundValidTarget && typeof serverTime === 'number' && clockOff !== null) {
      const fixedOneWayLead = physicalBaseRtt * 0.5 + 12;
      const exactClientTimeAtServerTick = serverTime - clockOff - fixedOneWayLead;
      const lookback = now - exactClientTimeAtServerTick;
      if (lookback >= 15 && lookback <= 400) {
        targetTime = exactClientTimeAtServerTick;
      }
    }

    const then = this.predAt(targetTime);
    if (!then) return;

    // 5. Calculate error vector
    const dx = serverX - then.x;
    const dz = serverZ - then.z;
    const errorDist = Math.hypot(dx, dz);

    // Hard-reset at 8.0m instead of 18.0m to prevent long runaway desync
    if (errorDist > 8.0) {
      this.resets++;
      this.reset(serverX, serverZ);
      return;
    }

    const inDashPhase = this.dashT > 0 || serverIsDashing || then.dashing || timeSinceEnd < 250;

    // Deadzone: slightly wider when colliding with crowd to absorb interpolation jitter
    const deadzone = inDashPhase ? 0.85 : (this.isCollidingWithEnts ? 0.22 : 0.06);
    if (errorDist <= deadzone) return;

    const excessError = errorDist - deadzone;
    const excessRatio = excessError / errorDist;
    const effDx = dx * excessRatio;
    const effDz = dz * excessRatio;

    // Smooth gain curve instead of sharp jump to 0.70
    let nudgeGain: number;
    if (inDashPhase) {
      nudgeGain = 0.22;
    } else if (this.isCollidingWithEnts) {
      const t = Math.min(1.0, excessError / 1.5);
      nudgeGain = 0.28 + t * 0.17;
    } else {
      const t = Math.min(1.0, excessError / 1.2);
      nudgeGain = 0.25 + t * 0.30;
    }

    const shouldDampVel = isServerStun || this.isCollidingWithEnts || excessError > 0.45;
    this.applySmoothCorrection(effDx, effDz, nudgeGain, then.t, shouldDampVel);
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
    ents: Map<number, Ent>,
    myId: number,
    _snapTick: number,
    _rtt: number,
    speedMult = 1.0,
    myCd = 0,
    metas?: Map<number, PlayerMeta>
  ): void {
    if (!this.on || !map) return;

    this.isCollidingWithEnts = false;
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

      // 1. VA CHẠM BỤC (PODIUM) - Khử thành phần vận tốc đâm xuyên để trượt mượt quanh viền:
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
            this.vx -= vn * nx;
            this.vz -= vn * nz;
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

      // 2. VA CHẠM MỀM VỚI CÁC CON VẬT KHÁC (SOFT REMOTE ENTITY COLLISION):
      // Vì các entity trong `ents` đang ở vị trí nội suy (trễ ~100ms) và đứng tĩnh trong substep,
      // dùng Soft Separation Damping thay vì Hard Positional Snap để triệt tiêu hoàn toàn rung lắc.
      if (ents && ents.size > 0) {
        const ra = radiusOf(myMass);
        const ma = myMass * (TRAITS[species]?.weight ?? 1.0);
        for (const [id, b] of ents) {
          if (id === myId || !b) continue;
          const dx = b.x - this.simX;
          const dz = b.z - this.simZ;
          const rb = radiusOf(b.mass);
          const minD = ra + rb;
          if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minD * minD || distSq < 1e-6) continue;

          this.isCollidingWithEnts = true;
          const d = Math.sqrt(distSq);
          const nx = dx / d;
          const nz = dz / d;
          const overlap = minD - d;

          const bMeta = metas?.get(b.id);
          const bSpecies = (bMeta?.species ?? (b as any).species) as Species | undefined;
          const bWeight = (bSpecies && TRAITS[bSpecies]?.weight) ? TRAITS[bSpecies].weight : 1.0;
          const mb = b.mass * bWeight;
          const wa = mb / (ma + mb);

          // Tách vị trí mềm (Soft Separation):
          // Giới hạn tốc độ đẩy tách theo bước thời gian h để không nhảy vị trí đột ngột
          const maxPushStep = Math.min(overlap * wa * 0.45, 12.0 * h);
          this.simX -= nx * maxPushStep;
          this.simZ -= nz * maxPushStep;

          // Giảm mềm thành phần vận tốc lao xuyên qua đối phương (Soft Velocity Damping)
          // chỉ khi chồng lấn sâu (> 15% bán kính), không tạo phản xạ đàn hồi giả
          const va = this.vx * nx + this.vz * nz;
          if (va > 0 && overlap > minD * 0.15) {
            const dampRatio = Math.min(1.0, (overlap / minD) * 1.5);
            const vReduction = va * wa * dampRatio * Math.min(1.0, h / 0.025) * 0.5;
            this.vx -= nx * vReduction;
            this.vz -= nz * vReduction;
          }
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

    // 3. TIÊU TAN SAI SỐ VISUAL (ADAPTIVE EXPONENTIAL SMOOTHING):
    // TUYỆT ĐỐI KHÔNG gán errorX = 0 khi (!canMove && speed < 0.1) để tránh giật nhảy (Snap Teleport)!
    const errDist = Math.hypot(this.errorX, this.errorZ);
    if (errDist > 0.0005) {
      const smoothRate = 14.0 + Math.min(8.0, errDist * 4.0);
      const decay = Math.exp(-smoothRate * dt);
      this.errorX *= decay;
      this.errorZ *= decay;
    } else {
      this.errorX = 0;
      this.errorZ = 0;
    }

    this.x = this.simX + this.errorX;
    this.z = this.simZ + this.errorZ;
  }
}

