// Procedural farm layout. The same seed gives the same farm, so the server only has to send the seed + result once.
import { CFG } from './constants';
import { type Blob, type Circle, mulberry32 } from './math';

export interface MapData {
  seed: number;
  podium: [number, number];
  pond: Blob[];
  mud: Blob[];
  hay: Circle[];
  well: Circle[];
  fire: Circle[];
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
    for (let tries = 0; tries < 60; tries++) {
      const a = between(0, Math.PI * 2);
      const d = Math.sqrt(rnd()) * (R - margin - r);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > tr + r + 4)) {
        taken.push([x, z, r]);
        return [x, z];
      }
    }
    return null;
  };

  const pond: Blob[] = [];
  const nPond = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nPond; i++) {
    const r = between(5, 8);
    const p = place(r * 1.3, 8);
    if (p) pond.push([p[0], p[1], r, between(0, 100)]);
  }

  const mud: Blob[] = [];
  const nMud = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nMud; i++) {
    const r = between(4, 6.5);
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
  const nWell = 1;
  for (let i = 0; i < nWell; i++) {
    const r = between(1.6, 2.2);
    const p = place(r, 7);
    if (p) well.push([p[0], p[1], r]);
  }

  const fire: Circle[] = [];
  const nFire = 1;
  for (let i = 0; i < nFire; i++) {
    const r = between(1.8, 2.4);
    const p = place(r, 7);
    if (p) fire.push([p[0], p[1], r]);
  }

  return { seed, podium, pond, mud, hay, well, fire };
}
