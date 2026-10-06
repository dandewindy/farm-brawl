// High-IQ farmyard AI:
// - Proactively avoids hazards: electric fence, stone wells, fire incinerators, and ponds (for non-ducks)
// - Emergency escape: frantically swims to land if caught in water to avoid drowning within 3s
// - Aggressively contests the podium to become Napoleon
// - Defends the podium when King by charging challengers off the hill
// - Hunts Napoleon when another animal rules
// - Tactically rams rivals into nearby hazards (fence, wells, fire, water)
import { CFG, radiusOf } from '../constants';
import { insideBlob, wrapAngle } from '../math';
import type { Player, World } from './world';

export interface BotBrain {
  /** seconds until the next tactical decision */
  think: number;
  /** seconds left to keep the ram button held */
  press: number;
  /** id of the animal being targeted / rammed */
  target: number;
  /** wandering heading when no primary goal */
  wander: number;
  /** 0..1: aggressiveness factor */
  aggro: number;
}

export const BOT_NAMES = [
  'Ủn Ỉn', 'Bé Mập', 'Gà Mờ', 'Bò Sữa', 'Vịt Bầu', 'Cừu Non', 'Ngựa Ô', 'Heo Hồng', 'Tí Nị', 'Lợn Lì',
  'Bò Tót', 'Gà Chiến', 'Vịt Xiêm', 'Cừu Bông', 'Ngựa Vằn', 'Mập Ú', 'Boxer', 'Clover', 'Muriel', 'Benjamin',
];

export function newBrain(rnd: () => number): BotBrain {
  return {
    think: rnd() * 0.25,
    press: 0,
    target: 0,
    wander: rnd() * Math.PI * 2,
    aggro: 0.5 + rnd() * 0.5,
  };
}

const aimAt = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toZ - fromZ, toX - fromX);

export function thinkBot(w: World, p: Player, dt: number): void {
  const b = p.ai!;
  const r = radiusOf(p.mass);
  const [podX, podZ] = w.map.podium;
  const distToPod = Math.hypot(podX - p.x, podZ - p.z);
  const isKing = p.id === w.napoleonId;

  // 1. If currently charging a ram, hold button and aim at target
  if (b.press > 0) {
    b.press -= dt;
    p.input.btn = b.press > 0;
    const t = w.players.get(b.target);
    if (t && t.alive) {
      p.input.a = aimAt(p.x, p.z, t.x + t.vx * 0.15, t.z + t.vz * 0.15);
    }
    return;
  }
  p.input.btn = false;

  // Decision rate limit
  if ((b.think -= dt) > 0) return;
  b.think = 0.08 + w.rand() * 0.12;
  p.input.mv = true;

  // 2. CRITICAL SURVIVAL: Emergency water escape for non-ducks
  if (p.species !== 'duck' && p.inWaterT > 0) {
    // Find nearest shore by looking away from the center of current pond
    let bestLandAngle = Math.atan2(-p.z, -p.x);
    for (const bnd of w.map.pond || []) {
      if (insideBlob(bnd, p.x, p.z, 0)) {
        // Point outward from pond center
        bestLandAngle = Math.atan2(p.z - bnd[1], p.x - bnd[0]);
        break;
      }
    }
    p.input.a = bestLandAngle;
    // Dash immediately to escape water if available
    if (p.cd <= 0 && w.rand() < 0.8) {
      b.press = 0.05;
      p.input.btn = true;
    }
    return;
  }

  // 3. KING BEHAVIOR: Defend the throne
  if (isKing) {
    // If stepped off podium, immediately return to center
    if (distToPod > CFG.PODIUM_R * 0.75) {
      p.input.a = aimAt(p.x, p.z, podX, podZ);
      return;
    }

    // On podium: guard perimeter and charge approaching challengers
    let closestChallenger: Player | null = null;
    let closestDist = 18;
    for (const o of w.players.values()) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - podX, o.z - podZ);
      if (d < closestDist) {
        closestDist = d;
        closestChallenger = o;
      }
    }

    if (closestChallenger && closestDist < 16) {
      p.input.a = aimAt(p.x, p.z, closestChallenger.x, closestChallenger.z);
      if (p.cd <= 0 && closestDist < 12) {
        b.target = closestChallenger.id;
        b.press = closestDist > 6 ? 0.6 + w.rand() * 0.4 : 0.08;
        p.input.btn = true;
      }
      return;
    }

    // Idle patrol in a tight circle on top of podium
    b.wander += 0.8 * dt;
    p.input.a = b.wander;
    return;
  }

  // 4. OVERTHROW / CONTEST PODIUM:
  // If Napoleon is crowned, prioritize hunting Napoleon if bot is big enough or close enough
  const napoleon = w.napoleonId > 0 ? w.players.get(w.napoleonId) : null;
  if (napoleon && napoleon.alive && napoleon.id !== p.id) {
    const distToNap = Math.hypot(napoleon.x - p.x, napoleon.z - p.z);
    if ((p.mass >= 22 || distToNap < 18) && w.rand() < b.aggro * 0.9) {
      p.input.a = aimAt(p.x, p.z, napoleon.x, napoleon.z);
      if (distToNap < 10 && p.cd <= 0) {
        b.target = napoleon.id;
        b.press = distToNap > 4.5 ? 0.7 + w.rand() * 0.4 : 0.08;
        p.input.btn = true;
      }
      return;
    }
  }

  // If podium is uncaptured or contested, healthy bots (mass >= 20) charge in to capture it
  if (w.napoleonId === 0 || w.podiumContested) {
    if (p.mass >= 20 && distToPod < 38 && w.rand() < 0.6) {
      p.input.a = aimAt(p.x, p.z, podX, podZ);
      return;
    }
  }

  // 5. TACTICAL COMBAT: Find prey, favoring opponents near hazards
  let bestPrey: Player | null = null;
  let bestPreyScore = 0;
  let bestPreyHazardMult = 1;

  for (const o of w.players.values()) {
    if (o === p || !o.alive) continue;
    const gap = Math.hypot(o.x - p.x, o.z - p.z) - r - radiusOf(o.mass);
    if (gap > 11 || o.mass > p.mass * 1.6) continue;

    let hazardBonus = 1;
    // Check if target is between us and fence
    const edgeDist = CFG.R - Math.hypot(o.x, o.z);
    if (edgeDist < 8) hazardBonus += 1.2;

    // Check if target is near a well
    for (const [wx, wz, wr] of w.map.well || []) {
      if (Math.hypot(o.x - wx, o.z - wz) < wr + 5) {
        hazardBonus += 1.5;
        break;
      }
    }

    // Check if target is near fire
    for (const [fx, fz, fr] of w.map.fire || []) {
      if (Math.hypot(o.x - fx, o.z - fz) < fr + 5) {
        hazardBonus += 1.5;
        break;
      }
    }

    // Check if non-duck target is near pond
    if (o.species !== 'duck') {
      for (const [px, pz, pr] of w.map.pond || []) {
        if (Math.hypot(o.x - px, o.z - pz) < pr + 5) {
          hazardBonus += 1.3;
          break;
        }
      }
    }

    const score = (1 - gap / 11) * hazardBonus * (o.stunT > 0 ? 1.8 : 1) * (o.mass < p.mass ? 1.3 : 0.8);
    if (score > bestPreyScore) {
      bestPreyScore = score;
      bestPrey = o;
      bestPreyHazardMult = hazardBonus;
    }
  }

  if (bestPrey && p.cd <= 0 && w.rand() < b.aggro * bestPreyScore * 0.85) {
    const gap = Math.hypot(bestPrey.x - p.x, bestPrey.z - p.z);
    b.target = bestPrey.id;
    // Charge harder if pushing toward a hazard
    b.press = (bestPreyHazardMult > 1.4 || gap > 4.5) ? 0.6 + w.rand() * 0.5 : 0.08;
    p.input.a = aimAt(p.x, p.z, bestPrey.x, bestPrey.z);
    p.input.btn = true;
    return;
  }

  // 6. GRAZING (Fallback when safe)
  let fx = 0, fz = 0, bestFoodScore = 0;
  for (const f of w.food.values()) {
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d > 28) continue;
    const s = f.v / (d + 2.5);
    if (s > bestFoodScore) {
      bestFoodScore = s;
      fx = f.x;
      fz = f.z;
    }
  }

  if (bestFoodScore > 0) {
    p.input.a = aimAt(p.x, p.z, fx, fz);
  } else {
    b.wander += (w.rand() - 0.5) * 1.0;
    p.input.a = b.wander;
  }

  // 7. COMPREHENSIVE HAZARD STEERING AVOIDANCE
  // Avoid electric fence: strong inward vector
  const distFromCenter = Math.hypot(p.x, p.z);
  if (distFromCenter > CFG.R - 8.5 - r) {
    const inward = Math.atan2(-p.z, -p.x);
    p.input.a = inward + (w.rand() - 0.5) * 0.4;
  }

  // Avoid stone wells
  for (const [wx, wz, wr] of w.map.well || []) {
    const d = Math.hypot(wx - p.x, wz - p.z);
    if (d < wr + r + 4.5) {
      const awayAng = Math.atan2(p.z - wz, p.x - wx);
      p.input.a = awayAng + (w.rand() - 0.5) * 0.5;
    }
  }

  // Avoid incinerator / fire pits
  for (const [fx2, fz2, fr2] of w.map.fire || []) {
    const d = Math.hypot(fx2 - p.x, fz2 - p.z);
    if (d < fr2 + r + 4.5) {
      const awayAng = Math.atan2(p.z - fz2, p.x - fx2);
      p.input.a = awayAng + (w.rand() - 0.5) * 0.5;
    }
  }

  // Avoid ponds for non-ducks
  if (p.species !== 'duck') {
    for (const [px, pz, pr] of w.map.pond || []) {
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < pr * 1.35 + r + 4.0) {
        const awayAng = Math.atan2(p.z - pz, p.x - px);
        p.input.a = awayAng + (w.rand() - 0.5) * 0.5;
      }
    }
  }

  // Avoid hay bales
  for (const [hx, hz, hr] of w.map.hay || []) {
    const d = Math.hypot(hx - p.x, hz - p.z);
    if (d > hr + r + 2.5) continue;
    const ang = aimAt(p.x, p.z, hx, hz);
    const off = wrapAngle(ang - p.input.a);
    if (Math.abs(off) < 1.1) p.input.a = ang - Math.sign(off || 1) * 1.4;
  }
}
