// Small pure helpers: angles, seeded randomness and the organic "blob" outlines used by ponds and mud.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** wrap an angle into [-PI, PI] */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** deterministic PRNG, so a map seed reproduces the same farm on every machine */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** an organic patch: centre, base radius, shape seed */
export type Blob = [x: number, z: number, r: number, seed: number];
/** a round obstacle: centre and radius */
export type Circle = [x: number, z: number, r: number];

/** the blob's edge distance from its centre in direction `ang` (never more than 1.3 × r) */
export function blobRadius(b: Blob, ang: number): number {
  const r = b[2], s = b[3];
  return r * (1 + 0.16 * Math.sin(3 * ang + s) + 0.09 * Math.sin(5 * ang + s * 1.7) + 0.05 * Math.sin(8 * ang + s * 2.3));
}

export function insideBlob(b: Blob, x: number, z: number, extra = 0): boolean {
  const dx = x - b[0], dz = z - b[1];
  const d = Math.hypot(dx, dz);
  if (d > b[2] * 1.31 + extra) return false;
  return d < blobRadius(b, Math.atan2(dz, dx)) + extra;
}

/** outline points relative to the blob centre */
export function blobOutline(b: Blob, extra = 0, n = 48): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = Math.max(0.2, blobRadius(b, a) + extra);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/**
 * Tính bình phương khoảng cách ngắn nhất từ điểm F(fx, fz) tới đoạn thẳng AB[(ax, az) -> (bx, bz)].
 * Giúp phát hiện chính xác 100% va chạm thức ăn dọc theo toàn bộ quỹ đạo di chuyển trong 50ms tick,
 * triệt tiêu hoàn toàn lỗi đi xuyên qua thức ăn (Discrete Tunneling) khi chạy nhanh hoặc Dash.
 */
export function distToSegmentSq(
  fx: number,
  fz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 0.00001) {
    const dx = fx - bx;
    const dz = fz - bz;
    return dx * dx + dz * dz;
  }
  const apx = fx - ax;
  const apz = fz - az;
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / lenSq));
  const closestX = ax + t * abx;
  const closestZ = az + t * abz;
  const dx = fx - closestX;
  const dz = fz - closestZ;
  return dx * dx + dz * dz;
}

