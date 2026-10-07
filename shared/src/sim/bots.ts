// High-IQ farmyard AI:
// - Proactively avoids hazards: electric fence, stone wells, fire incinerators, and ponds (for non-ducks)
// - Filters out any food in or near hazards so bots never chase food into death traps
// - Wide-range exploration waypoints across the full 70m farm arena so bots roam globally instead of lingering in small pockets
// - Emergency escape: frantically swims to land if caught in water to avoid drowning within 1.5s
// - Aggressively contests the podium to become Napoleon
// - Defends the podium when King by charging challengers off the hill
// - Hunts Napoleon when another animal rules
// - Tactically rams rivals into nearby hazards safely without launching themselves into traps
import { CFG, radiusOf, type Species } from '../constants';
import type { MapData } from '../map';
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
  /** Long-range exploration destination (x, z) */
  gx: number;
  gz: number;
  /** Seconds remaining until choosing a new long-range waypoint */
  goalT: number;
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
    gx: 0,
    gz: 0,
    goalT: 0,
  };
}

const aimAt = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toZ - fromZ, toX - fromX);

/** Is (x, z) dangerously close to or inside any hazard? */
export function isHazardAt(map: MapData, x: number, z: number, species: Species, margin = 4.0): boolean {
  // 1. Electric fence
  if (Math.hypot(x, z) >= CFG.R - margin - 3.5) return true;

  // 2. Stone wells
  for (const [wx, wz, wr] of map.well || []) {
    if (Math.hypot(x - wx, z - wz) < wr + margin + 1.2) return true;
  }

  // 3. Fire pit
  for (const [fx, fz, fr] of map.fire || []) {
    if (Math.hypot(x - fx, z - fz) < fr + margin + 1.2) return true;
  }

  // 4. Pond (dangerous for non-ducks)
  if (species !== 'duck') {
    for (const b of map.pond || []) {
      if (insideBlob(b, x, z, margin * 0.6)) return true;
      if (Math.hypot(x - b[0], z - b[1]) < b[2] * 1.4 + margin + 1.5) return true;
    }
  }

  return false;
}

/** Check if the straight-line segment from (x1, z1) to (x2, z2) passes through hazard circles or close to fence */
function rayCrossesHazard(map: MapData, x1: number, z1: number, x2: number, z2: number, species: Species): boolean {
  const dx = x2 - x1, dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-3) return false;

  const hits = (cx: number, cz: number, r: number): boolean => {
    const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cz - z1) * dz) / lenSq));
    const px = x1 + t * dx, pz = z1 + t * dz;
    return Math.hypot(px - cx, pz - cz) < r;
  };

  // Electric fence ray check
  const midX = (x1 + x2) * 0.5, midZ = (z1 + z2) * 0.5;
  if (Math.hypot(midX, midZ) > CFG.R - 4.5 || Math.hypot(x2, z2) > CFG.R - 4.5) return true;

  for (const [wx, wz, wr] of map.well || []) {
    if (hits(wx, wz, wr + 3.2)) return true;
  }
  for (const [fx, fz, fr] of map.fire || []) {
    if (hits(fx, fz, fr + 3.2)) return true;
  }
  if (species !== 'duck') {
    for (const b of map.pond || []) {
      if (hits(b[0], b[1], b[2] * 1.35 + 3.0)) return true;
    }
  }
  return false;
}

/** Pick a long-range exploration waypoint across the wide farm arena */
function pickNewWaypoint(w: World, p: Player): [number, number] {
  const [podX, podZ] = w.map.podium;
  // If mass >= 20, 30% chance to wander towards podium area
  if (p.mass >= 20 && w.rand() < 0.3) {
    return [podX + (w.rand() - 0.5) * 10, podZ + (w.rand() - 0.5) * 10];
  }

  // Pick across the whole farm (18m to 52m from center, favoring crossing the map)
  const currentAng = Math.atan2(p.z, p.x);
  for (let tries = 0; tries < 25; tries++) {
    const ang = currentAng + Math.PI * 0.5 + w.rand() * Math.PI;
    const dist = 18 + w.rand() * (CFG.R - 26);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (!isHazardAt(w.map, x, z, p.species, 5.5)) {
      return [x, z];
    }
  }
  return [0, 0];
}

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

  // Update long-range exploration goal timer
  b.goalT -= dt;
  const distToGoal = Math.hypot(b.gx - p.x, b.gz - p.z);
  if (b.goalT <= 0 || distToGoal < 6.0 || (b.gx === 0 && b.gz === 0)) {
    const [nx, nz] = pickNewWaypoint(w, p);
    b.gx = nx;
    b.gz = nz;
    b.goalT = 8.0 + w.rand() * 8.0; // Roam towards this waypoint for 8-16 seconds across the map
  }

  // 2. CRITICAL SURVIVAL: Emergency water escape for non-ducks
  if (p.species !== 'duck' && p.inWaterT > 0) {
    let bestLandAngle = Math.atan2(-p.z, -p.x);
    for (const bnd of w.map.pond || []) {
      if (insideBlob(bnd, p.x, p.z, 0)) {
        bestLandAngle = Math.atan2(p.z - bnd[1], p.x - bnd[0]);
        break;
      }
    }
    p.input.a = bestLandAngle;
    if (p.cd <= 0 && w.rand() < 0.8) {
      b.press = 0.05;
      p.input.btn = true;
    }
    return;
  }

  // 3. KING BEHAVIOR: Defend the throne
  if (isKing) {
    if (distToPod > CFG.PODIUM_R * 0.75) {
      p.input.a = aimAt(p.x, p.z, podX, podZ);
      return;
    }

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

    b.wander += 0.8 * dt;
    p.input.a = b.wander;
    return;
  }

  // 4. OVERTHROW / CONTEST PODIUM:
  const napoleon = w.napoleonId > 0 ? w.players.get(w.napoleonId) : null;
  if (napoleon && napoleon.alive && napoleon.id !== p.id) {
    const distToNap = Math.hypot(napoleon.x - p.x, napoleon.z - p.z);
    if ((p.mass >= 22 || distToNap < 20) && w.rand() < b.aggro * 0.9) {
      p.input.a = aimAt(p.x, p.z, napoleon.x, napoleon.z);
      if (distToNap < 10 && p.cd <= 0) {
        b.target = napoleon.id;
        b.press = distToNap > 4.5 ? 0.7 + w.rand() * 0.4 : 0.08;
        p.input.btn = true;
      }
      return;
    }
  }

  if (w.napoleonId === 0 || w.podiumContested) {
    if (p.mass >= 20 && distToPod < 42 && w.rand() < 0.65) {
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
    if (gap > 12 || o.mass > p.mass * 1.5) continue;

    let hazardBonus = 1;
    const edgeDist = CFG.R - Math.hypot(o.x, o.z);
    if (edgeDist < 8) hazardBonus += 1.2;

    for (const [wx, wz, wr] of w.map.well || []) {
      if (Math.hypot(o.x - wx, o.z - wz) < wr + 5) {
        hazardBonus += 1.5;
        break;
      }
    }
    for (const [fx, fz, fr] of w.map.fire || []) {
      if (Math.hypot(o.x - fx, o.z - fz) < fr + 5) {
        hazardBonus += 1.5;
        break;
      }
    }
    if (o.species !== 'duck') {
      for (const [px, pz, pr] of w.map.pond || []) {
        if (Math.hypot(o.x - px, o.z - pz) < pr + 5) {
          hazardBonus += 1.3;
          break;
        }
      }
    }

    const score = (1 - gap / 12) * hazardBonus * (o.stunT > 0 ? 1.8 : 1) * (o.mass < p.mass ? 1.3 : 0.8);
    if (score > bestPreyScore) {
      bestPreyScore = score;
      bestPrey = o;
      bestPreyHazardMult = hazardBonus;
    }
  }

  if (bestPrey && p.cd <= 0 && w.rand() < b.aggro * bestPreyScore * 0.85) {
    const aimAng = aimAt(p.x, p.z, bestPrey.x, bestPrey.z);
    // Project where the dash will end
    const projectedDist = Math.min(12, Math.hypot(bestPrey.x - p.x, bestPrey.z - p.z) + 3.0);
    const projX = p.x + Math.cos(aimAng) * projectedDist;
    const projZ = p.z + Math.sin(aimAng) * projectedDist;

    // Only dash if we won't launch ourselves straight into a hazard!
    if (!isHazardAt(w.map, projX, projZ, p.species, 4.5) && !rayCrossesHazard(w.map, p.x, p.z, projX, projZ, p.species)) {
      const gap = Math.hypot(bestPrey.x - p.x, bestPrey.z - p.z);
      b.target = bestPrey.id;
      b.press = (bestPreyHazardMult > 1.4 || gap > 4.5) ? 0.6 + w.rand() * 0.5 : 0.08;
      p.input.a = aimAng;
      p.input.btn = true;
      return;
    }
  }

  // 6. WIDE-RANGE ROAMING & SAFE GRAZING
  let fx = 0, fz = 0, bestFoodScore = 0;
  const toGoalAng = aimAt(p.x, p.z, b.gx, b.gz);

  for (const f of w.food.values()) {
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    const maxLookDist = f.k === 6 ? 40 : f.v >= 5 ? 24 : 14;
    if (d > maxLookDist) continue;

    // DISQUALIFY: food inside or near any hazard!
    if (isHazardAt(w.map, f.x, f.z, p.species, 4.5)) continue;

    // DISQUALIFY: straight line to food intersects hazard!
    if (rayCrossesHazard(w.map, p.x, p.z, f.x, f.z, p.species)) continue;

    // Bonus for food lying in our general travel direction
    const toFoodAng = aimAt(p.x, p.z, f.x, f.z);
    const align = Math.cos(toFoodAng - toGoalAng);
    if (align < -0.2 && f.v < 4 && d > 6) continue;

    const alignBonus = 1 + align * 0.5;
    const score = ((f.k === 6 ? 45 : f.v) * alignBonus) / (d + 6);
    if (score > bestFoodScore) {
      bestFoodScore = score;
      fx = f.x;
      fz = f.z;
    }
  }

  // Consider nearby bonus tools (pitchfork, dynamite, song)
  for (const t of w.tools.values()) {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d > 35) continue;
    if (isHazardAt(w.map, t.x, t.z, p.species, 4.0)) continue;
    if (rayCrossesHazard(w.map, p.x, p.z, t.x, t.z, p.species)) continue;
    if (t.kind === 'song' && w.napoleonId === 0) continue;
    if (t.kind === 'dynamite' && p.hasDynamite) continue;
    if (t.kind === 'pitchfork' && p.pitchforkT > 3) continue;
    const toolScore = 18 / (d + 4);
    if (toolScore > bestFoodScore) {
      bestFoodScore = toolScore;
      fx = t.x;
      fz = t.z;
    }
  }

  if (bestFoodScore > 0) {
    p.input.a = aimAt(p.x, p.z, fx, fz);
  } else {
    // Steer towards long-range strategic waypoint across the farm
    p.input.a = toGoalAng;
  }

  // 7. COMPREHENSIVE HAZARD STEERING AVOIDANCE & REPULSION
  let rx = 0, rz = 0;
  let inDanger = false;

  // Electric fence: strong inward vector if within 10m of fence
  const distFromCenter = Math.hypot(p.x, p.z);
  if (distFromCenter > CFG.R - 10.0 - r) {
    const pen = (distFromCenter - (CFG.R - 10.0 - r)) / 5.0;
    rx += (-p.x / distFromCenter) * Math.max(1.2, pen * 4);
    rz += (-p.z / distFromCenter) * Math.max(1.2, pen * 4);
    inDanger = true;
  }

  // Stone wells: strong outward vector
  for (const [wx, wz, wr] of w.map.well || []) {
    const d = Math.hypot(p.x - wx, p.z - wz);
    const safeDist = wr + r + 5.5;
    if (d < safeDist) {
      const pen = (safeDist - d) / 3.0;
      const mag = Math.max(1.2, pen * 4);
      rx += ((p.x - wx) / (d || 1)) * mag;
      rz += ((p.z - wz) / (d || 1)) * mag;
      inDanger = true;
    }
  }

  // Fire pits: strong outward vector
  for (const [fx2, fz2, fr2] of w.map.fire || []) {
    const d = Math.hypot(p.x - fx2, p.z - fz2);
    const safeDist = fr2 + r + 5.5;
    if (d < safeDist) {
      const pen = (safeDist - d) / 3.0;
      const mag = Math.max(1.2, pen * 4);
      rx += ((p.x - fx2) / (d || 1)) * mag;
      rz += ((p.z - fz2) / (d || 1)) * mag;
      inDanger = true;
    }
  }

  // Ponds for non-ducks: strong outward vector
  if (p.species !== 'duck') {
    for (const bnd of w.map.pond || []) {
      const d = Math.hypot(p.x - bnd[0], p.z - bnd[1]);
      const safeDist = bnd[2] * 1.35 + r + 5.0;
      if (d < safeDist) {
        const pen = (safeDist - d) / 3.0;
        const mag = Math.max(1.2, pen * 4);
        rx += ((p.x - bnd[0]) / (d || 1)) * mag;
        rz += ((p.z - bnd[1]) / (d || 1)) * mag;
        inDanger = true;
      }
    }
  }

  if (inDanger) {
    p.input.a = Math.atan2(rz, rx);
    // Cancel any dangerous charge
    p.input.btn = false;
    b.press = 0;
    // Dash away if dangerously close
    if (Math.hypot(rx, rz) > 3.0 && p.cd <= 0 && w.rand() < 0.65) {
      b.press = 0.08;
      p.input.btn = true;
    }
  }

  // Avoid hay bales: smooth tangent steering
  for (const [hx, hz, hr] of w.map.hay || []) {
    const d = Math.hypot(hx - p.x, hz - p.z);
    if (d > hr + r + 2.5) continue;
    const ang = aimAt(p.x, p.z, hx, hz);
    const off = wrapAngle(ang - p.input.a);
    if (Math.abs(off) < 1.1) p.input.a = ang - Math.sign(off || 1) * 1.4;
  }
}
