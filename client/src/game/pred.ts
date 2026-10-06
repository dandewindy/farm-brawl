import { CFG, TRAITS, type Species } from '@shared/constants';
import type { Input } from '@shared/protocol';

export class ClientPredictor {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  a = 0;
  ex = 0;
  ez = 0;
  initialized = false;

  reset(): void {
    this.initialized = false;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.a = 0;
    this.ex = 0;
    this.ez = 0;
  }

  onServerUpdate(srvX: number, srvZ: number, srvA: number, srvVx = 0, srvVz = 0): void {
    if (!this.initialized) {
      this.x = srvX;
      this.z = srvZ;
      this.a = srvA;
      this.vx = srvVx;
      this.vz = srvVz;
      this.ex = 0;
      this.ez = 0;
      this.initialized = true;
      return;
    }

    const dx = srvX - this.x;
    const dz = srvZ - this.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 8) {
      // Large discrepancy (e.g. big knockback or fence bounce): snap closer
      this.x = srvX;
      this.z = srvZ;
      this.ex = 0;
      this.ez = 0;
      this.vx = srvVx;
      this.vz = srvVz;
    } else {
      // Smooth error correction
      this.ex = dx;
      this.ez = dz;
    }
  }

  step(inp: Input, dt: number, species: Species, terrain: number, isDashing: boolean): void {
    if (!this.initialized) return;

    // Smoothly decay error offset
    const decayRate = 12;
    const decay = 1 - Math.exp(-decayRate * dt);
    const cx = this.ex * decay;
    const cz = this.ez * decay;
    this.x += cx;
    this.z += cz;
    this.ex -= cx;
    this.ez -= cz;

    // Aim angle tracks mouse input immediately
    this.a = inp.a;

    if (!isDashing) {
      if (inp.mv) {
        const trait = TRAITS[species] || TRAITS.pig;
        const tMul = terrain === 1 ? trait.water : terrain === 2 ? trait.mud : 1.0;
        const maxSpeed = CFG.MOVE_SPEED * trait.speed * tMul;
        const targetVx = Math.cos(inp.a) * maxSpeed;
        const targetVz = Math.sin(inp.a) * maxSpeed;
        const accel = CFG.MOVE_ACCEL * 1.5 * dt;
        this.vx += (targetVx - this.vx) * Math.min(1, accel);
        this.vz += (targetVz - this.vz) * Math.min(1, accel);
      } else {
        const friction = Math.max(0, 1 - 7 * dt);
        this.vx *= friction;
        this.vz *= friction;
      }
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Clamp inside arena fence
    const d = Math.hypot(this.x, this.z);
    const maxR = CFG.R - 1.2;
    if (d > maxR) {
      this.x = (this.x / d) * maxR;
      this.z = (this.z / d) * maxR;
      this.vx *= 0.5;
      this.vz *= 0.5;
    }
  }
}
