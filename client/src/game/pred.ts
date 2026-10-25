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
  x: number;
  z: number;
  vx: number;
  vz: number;
  dashing: boolean;
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

  predAt(t: number): { x: number; z: number; vx: number; vz: number; dashing: boolean } | null {
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
          dashing: a.dashing || b.dashing,
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
    const isServerStun = (flags & 8) !== 0;

    // 0. Cập nhật vận tốc khi server truyền xung lực cực mạnh (knockback do húc, nổ bom, hoặc choáng)
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

    if (isServerStun && !this.stunned) {
      this.setStun(1.5);
    } else if (!isServerStun && this.stunT <= 0) {
      this.stunned = false;
    }

    // 1. Cửa sổ bảo vệ pha Húc (Dash Phase Windows):
    const timeSinceLaunch = now - this.lastDashLaunchTime;
    const timeSinceEnd = now - this.lastDashEndTime;
    const serverIsDashing = (flags & 1) !== 0;
    const effectiveRtt = rtt > 0 ? rtt : 40;
    const preDashWindow = Math.max(180, effectiveRtt + 100);

    // Pha 1 (Pre-dash): Client vừa phóng đi nhưng gói tin chưa kịp xử lý trên Server
    if (!isServerStun && this.dashT > 0 && !serverIsDashing) {
      if (timeSinceLaunch < preDashWindow) {
        this.sx = serverX;
        this.sz = serverZ;
        this.sTick = snapTick;
        return; // Không can thiệp hoặc hủy dash trong giai đoạn gói tin đang bay!
      } else {
        // Hết thời gian chờ mà Server vẫn chưa dash -> kết thúc dash nhẹ nhàng
        this.dashT = 0;
        this.plow = false;
        this.vx *= 0.25;
        this.vz *= 0.25;
      }
    }

    // Pha 3 (Post-dash): Client vừa kết thúc cú húc nhưng snapshot trả về vẫn thuộc cuối cú húc trên Server
    const postDashWindow = Math.max(150, effectiveRtt + 90);
    if (!isServerStun && this.dashT <= 0 && serverIsDashing && timeSinceEnd < postDashWindow) {
      this.sx = serverX;
      this.sz = serverZ;
      this.sTick = snapTick;
      return;
    }

    // 2. Lấy mẫu lịch sử dự đoán tại đúng thời điểm quá khứ tương ứng với Snapshot:
    // Snapshot ở Server được tính từ input gửi lúc: now - (RTT/2 + 25ms tick + RTT/2) = now - (RTT + 35ms)
    const transitDelay = Math.max(35, Math.min(220, effectiveRtt + 35));
    const targetTime = now - transitDelay;
    const then = this.predAt(targetTime);

    if (!then) {
      this.sx = serverX;
      this.sz = serverZ;
      this.sTick = snapTick;
      return;
    }

    // 3. Tính sai số thực tế tại cùng một mốc thời gian lịch sử
    const dx = serverX - then.x;
    const dz = serverZ - then.z;
    const errorDist = Math.hypot(dx, dz);

    // Hard reset CHỈ xảy ra khi sai số cực lớn (hồi sinh, dịch chuyển tức thời, teleport > 10m):
    if (errorDist > 10.0) {
      this.resets++;
      this.reset(serverX, serverZ);
      return;
    }

    // 4. Hòa giải mượt (Smooth Reconciliation):
    const inDashWindow = this.dashT > 0 || serverIsDashing || then.dashing || timeSinceEnd < 250;
    const deadzone = inDashWindow ? 2.5 : 0.35;

    if (errorDist > deadzone) {
      // Khi chênh lệch vượt deadzone, bù trừ mượt mà qua errorX/errorZ và nhích nhẹ simX/simZ
      const nudgeGain = inDashWindow ? 0.08 : 0.20;
      const adjustX = dx * nudgeGain;
      const adjustZ = dz * nudgeGain;

      this.simX += adjustX;
      this.simZ += adjustZ;

      // Đưa phần sai lệch còn lại vào errorX/errorZ để được làm mờ (decay) êm ái
      this.errorX += dx * (1 - nudgeGain);
      this.errorZ += dz * (1 - nudgeGain);
      this.errorX = Math.max(-2.0, Math.min(2.0, this.errorX));
      this.errorZ = Math.max(-2.0, Math.min(2.0, this.errorZ));

      for (const s of this.hist) {
        s.x += adjustX;
        s.z += adjustZ;
      }
    }

    this.sx = serverX;
    this.sz = serverZ;
    this.sTick = snapTick;
  }

  predictDash(species: Species, held: number, aimA: number, map: MapData | null, isSuper = false): void {
    if (!this.on || this.stunned || this.stunT > 0 || this.dashT > 0) return;
    if (map) {
      const terrain = terrainAt(map, this.simX, this.simZ);
      if (terrain === 1) return; // Cannot dash in water
    }

    const now = performance.now();
    this.lastDashLaunchTime = now;

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
      x: this.simX,
      z: this.simZ,
      vx: this.vx,
      vz: this.vz,
      dashing: this.dashT > 0,
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
