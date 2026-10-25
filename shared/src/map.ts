// Procedural farm layout. The same seed gives the same farm, so the server only has to send the seed + result once.
import { CFG } from './constants';
import { type Blob, type Circle, mulberry32 } from './math';

export type TreeSize = 0 | 1 | 2; // 0: Small (100kg, 10 fruits), 1: Medium (500kg, 20 fruits), 2: Large (1000kg, 30 fruits)

export interface TreeData {
  id: number;
  x: number;
  z: number;
  size: TreeSize;
  r: number;
  totalFruits: number;
  initBig: number;
  initSmall: number;
}

export interface MapData {
  seed: number;
  podium: [number, number];
  pond: Blob[];
  mud: Blob[];
  hay: Circle[];
  well: Circle[];
  fire: Circle[];
  trees: TreeData[];
}

export function generateMap(seed: number, R: number = CFG.R): MapData {
  const rnd = mulberry32(seed);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const taken: Circle[] = [];

  const pa = between(0, Math.PI * 2), pd = between(0, R * 0.25);
  const podium: [number, number] = [Math.cos(pa) * pd, Math.sin(pa) * pd];
  taken.push([podium[0], podium[1], CFG.PODIUM_R + 3]);

  /** find a free spot for something of radius `r`, at least `margin` from the fence */
  const place = (r: number, margin: number): [number, number] | null => {
    for (let tries = 0; tries < 250; tries++) {
      const a = between(0, Math.PI * 2);
      const d = Math.sqrt(rnd()) * Math.max(1, R - margin - r);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > tr + r + 2.0)) {
        taken.push([x, z, r]);
        return [x, z];
      }
    }
    return null;
  };

  const pond: Blob[] = [];
  const nPond = 2;
  for (let i = 0; i < nPond; i++) {
    // Water ponds: exactly 1 scaled x2 and 1 scaled x4
    const scale = i === 0 ? 2 : 4;
    const baseR = between(3.6, 4.2);
    const r = baseR * scale;
    const p = place(r * 1.15, 6);
    if (p) pond.push([p[0], p[1], r, between(0, 100)]);
  }

  const mud: Blob[] = [];
  const nMud = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nMud; i++) {
    // Large mud puddles: some scaled x2, some scaled x3
    const scale = i === 0 ? 2 : i === 1 ? 3 : (rnd() < 0.5 ? 2 : 3);
    const baseR = between(4.2, 5.0);
    const r = baseR * scale;
    const p = place(r * 1.3, 6);
    if (p) mud.push([p[0], p[1], r, between(0, 100)]);
  }

  const hay: Circle[] = [];
  // Podium flag post as solid post obstacle ("cọc bục")
  hay.push([podium[0], podium[1] - (CFG.PODIUM_R - 1.6), 0.6]);
  const nHay = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < nHay; i++) {
    const r = between(1.3, 2);
    const p = place(r, 6);
    if (p) hay.push([p[0], p[1], r]);
  }

  const well: Circle[] = [];
  const nWell = 3;
  for (let i = 0; i < nWell; i++) {
    const r = between(1.6, 2.2);
    const p = place(r, 6);
    if (p) well.push([p[0], p[1], r]);
  }

  const fire: Circle[] = [];
  const nFire = 3;
  for (let i = 0; i < nFire; i++) {
    const r = between(1.8, 2.4);
    const p = place(r, 6);
    if (p) fire.push([p[0], p[1], r]);
  }

  // 3 models of fruit trees (Large, Medium, Small) scattered inside the farm near the perimeter fence
  const trees: TreeData[] = [];
  const treeSizes: TreeSize[] = [2, 1, 0, 2, 1, 0];
  const treeRadii = [1.0, 1.4, 1.8];
  const treeTotals = [10, 20, 30];

  for (let i = 0; i < treeSizes.length; i++) {
    const size = treeSizes[i];
    const r = treeRadii[size];
    const totalFruits = treeTotals[size];
    // Big fruits are the majority:
    // Size 2 (Large, 30 fruits): 18..24 big, 6..12 small
    // Size 1 (Med, 20 fruits): 12..16 big, 4..8 small
    // Size 0 (Small, 10 fruits): 6..8 big, 2..4 small
    const initBig = size === 2
      ? 18 + Math.floor(rnd() * 7)
      : size === 1
      ? 12 + Math.floor(rnd() * 5)
      : 6 + Math.floor(rnd() * 3);
    const initSmall = totalFruits - initBig;

    const baseAngle = (i / treeSizes.length) * Math.PI * 2;
    let placed = false;
    for (let tryIdx = 0; tryIdx < 40; tryIdx++) {
      const a = baseAngle + between(-0.35, 0.35) + (tryIdx > 15 ? between(-1.0, 1.0) : 0);
      const d = between(52, 61);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > tr + r + 2.5)) {
        taken.push([x, z, r + 2.0]);
        trees.push({
          id: i + 1,
          x,
          z,
          size,
          r,
          totalFruits,
          initBig,
          initSmall,
        });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const p = place(r + 1.2, 8);
      if (p) {
        trees.push({
          id: i + 1,
          x: p[0],
          z: p[1],
          size,
          r,
          totalFruits,
          initBig,
          initSmall,
        });
      }
    }
  }

  return { seed, podium, pond, mud, hay, well, fire, trees };
}
