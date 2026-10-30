import * as THREE from 'three';
import { CFG, radiusOf, type Species } from '@shared/constants';
import { FLAG, type PlayerMeta } from '@shared/protocol';
import { t } from '../i18n';
import { getArenaTheme, type ArenaTheme } from '../theme';

interface AnimalVisual {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  species: Species;
  skin: number;
  label: THREE.Sprite | null;
  labelKey: string;
  regalia: THREE.Group | null;
  flowerHat: THREE.Group;
  witchHat: THREE.Group;
  isCrowned: boolean;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  collarMat: THREE.MeshStandardMaterial;
  stars: THREE.Group | null;
  phase: number;
  lastX: number;
  lastZ: number;
  hitT: number;
  dust: number;
  rainbow: [THREE.Mesh, THREE.Material][] | null;
  wasSuper: boolean;
  trailX?: number;
  trailZ?: number;
  shockwaveTimer?: number;
  rainbowTimer?: number;
  waterT?: number;
  squishFactor?: number;
  visualY?: number;
  waterRippleTimer?: number;
  mudSplats: THREE.Mesh[];
  mudSplatMat: THREE.MeshBasicMaterial;
  cartGroup: THREE.Group;
  cartThemeGroups: {
    classic: THREE.Group;
    womenDay: THREE.Group;
    halloween: THREE.Group;
  };
  cartWheels: THREE.Mesh[];
  summonRingTimer?: number;
  summonGroup: THREE.Group;
  summonOuter: THREE.Mesh;
  summonInner: THREE.Mesh;
  summonBeam: THREE.Mesh;
  summonOuterMat: THREE.MeshBasicMaterial;
  summonInnerMat: THREE.MeshBasicMaterial;
  summonBeamMat: THREE.MeshBasicMaterial;
}

function computePodiumRampY(x: number, z: number, podX: number, podZ: number): number {
  const dist = Math.hypot(x - podX, z - podZ);
  const innerR = CFG.PODIUM_R - 0.30;
  const outerR = CFG.PODIUM_R + 0.20;

  if (dist <= innerR) return 0.55;
  if (dist >= outerR) return 0;

  const t = (dist - innerR) / (outerR - innerR);
  const smooth = t * t * (3 - 2 * t);
  return 0.55 * (1 - smooth);
}

function setRainbow(vis: AnimalVisual, on: boolean, now: number): void {
  if (on && !vis.rainbow) {
    vis.rainbow = [];
    for (const part of [vis.body, ...vis.legs]) {
      part.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(m.userData && m.userData.eye)) {
          vis.rainbow!.push([m, m.material as THREE.Material]);
          m.material = (m.material as THREE.Material).clone();
        }
      });
    }
  } else if (!on && vis.rainbow) {
    for (const [o, m] of vis.rainbow) {
      if ((o.material as THREE.Material).dispose) (o.material as THREE.Material).dispose();
      o.material = m;
    }
    vis.rainbow = null;
  }
  if (vis.rainbow) {
    vis.rainbow.forEach(([o], i) => {
      const h = (now / 600 + i * 0.13) % 1;
      const mat = o.material as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.setHSL(h, 1, 0.52);
      if (mat.emissive) mat.emissive.setHSL(h, 1, 0.16);
    });
  }
}

const ringGeo = new THREE.RingGeometry(0.88, 1.05, 32);
ringGeo.rotateX(-Math.PI / 2);

const mudSplatGeo = new THREE.CircleGeometry(0.42, 12);
mudSplatGeo.rotateX(-Math.PI / 2);

const sharedMudSplatMat = new THREE.MeshBasicMaterial({
  color: 0x16100c, // Deep dark black mud puddle
  transparent: true,
  opacity: 0.90,
  depthWrite: false,
});

const summonOuterGeo = new THREE.RingGeometry(1.15, 1.55, 32);
summonOuterGeo.rotateX(-Math.PI / 2);

const summonInnerGeo = new THREE.RingGeometry(0.65, 0.90, 24);
summonInnerGeo.rotateX(-Math.PI / 2);

const summonBeamGeo = new THREE.CylinderGeometry(1.35, 1.35, 3.8, 20, 1, true);

const SPECIES_RING_COLOR: Record<Species, number> = {
  chicken: 0xffb74d,
  sheep: 0xf3f1ea,
  horse: 0x8b5a2b,
  cow: 0x4fc3f7,
  duck: 0xffd54f,
  pig: 0xf48fb1,
  dog: 0xffa726,
  elephant: 0x90a4ae,
};

// Detailed color palettes per species (4 skins per animal matching original game)
const SKINS: Record<Species, Record<string, number>[]> = {
  chicken: [
    { body: 0xfaf6ee, tail: 0xfaf6ee },
    { body: 0xb5652b, tail: 0x4a2412 },
    { body: 0x2e2c30, tail: 0x1d3b2c },
    { body: 0xd8c08a, tail: 0x8a6a3a },
  ],
  sheep: [
    { wool: 0xf3f1ea, face: 0x3a3a3a },
    { wool: 0x4a4442, face: 0x1f1c1b },
    { wool: 0xe6d6b0, face: 0x6b4a33 },
    { wool: 0xf8f6f0, face: 0xe2c9b8 },
  ],
  horse: [
    { body: 0x8b5a2b, mane: 0x2b1a0e, legs: 0x6b4220 },
    { body: 0x2a2522, mane: 0x121010, legs: 0x1c1816 },
    { body: 0xd6d2ca, mane: 0x8f8a82, legs: 0xb5b0a8 },
    { body: 0xd9a441, mane: 0xf3ead0, legs: 0xbf8c33 },
  ],
  cow: [
    { body: 0xffffff, spot: 0x222222, legs: 0xeeeeee, nose: 0xf3a0a8 },
    { body: 0xffffff, spot: 0x7a4320, legs: 0xeeeeee, nose: 0xf3a0a8 },
    { body: 0xb8814a, spot: 0x000000, legs: 0x9a6a3c, nose: 0x3a2a22 },
    { body: 0x2a2624, spot: 0, legs: 0x221e1c, nose: 0x5a4a48 },
  ],
  duck: [
    { body: 0xffd23f, head: 0xffd23f, bill: 0xff7f11 },
    { body: 0xf7f4ec, head: 0xf7f4ec, bill: 0xffa41b },
    { body: 0x8a6a4a, head: 0x1f6b3a, bill: 0xe8c547 },
    { body: 0x34343a, head: 0x5c3322, bill: 0xe8c547 },
  ],
  pig: [
    { body: 0xf6a5b5, snout: 0xee8fa2 },
    { body: 0x2f2a2c, snout: 0xf0b9c4 },
    { body: 0xd2773a, snout: 0xe39a6b },
    { body: 0xf6a5b5, snout: 0xee8fa2, spot: 0x2e2628 },
  ],
  dog: [
    { body: 0xd9822b, head: 0xd9822b, snout: 0xf4eedb, chest: 0xf4eedb, collar: 0xd32f2f, ear: 0xd9822b, innerEar: 0xf4eedb, tail: 0xd9822b, tailTip: 0xf4eedb, legs: 0xd9822b, paws: 0xf4eedb },
    { body: 0x48505c, head: 0x48505c, snout: 0xe8ecf0, chest: 0xe8ecf0, collar: 0x1976d2, ear: 0x2e343d, innerEar: 0xe8ecf0, tail: 0x48505c, tailTip: 0xe8ecf0, legs: 0x48505c, paws: 0xe8ecf0 },
    { body: 0xc47b38, head: 0xc47b38, snout: 0xffffff, chest: 0xffffff, collar: 0x388e3c, ear: 0xb36a28, innerEar: 0xf4c2c2, tail: 0xc47b38, tailTip: 0xffffff, legs: 0xffffff, paws: 0xffffff },
    { body: 0x242228, head: 0x242228, snout: 0xa86a3d, chest: 0xa86a3d, collar: 0xf57c00, ear: 0x242228, innerEar: 0xa86a3d, tail: 0x242228, tailTip: 0x242228, legs: 0xa86a3d, paws: 0x242228 },
  ],
  elephant: [
    { body: 0x828892, tusk: 0xf7f5f0, innerEar: 0xdfb4b4, toenails: 0xd0c8be, tuft: 0x2b2522 },
    { body: 0xf2ede4, tusk: 0xffd700, innerEar: 0xf5c6c6, toenails: 0xe8dfd5, tuft: 0xffd700 },
    { body: 0x6d5e54, tusk: 0xf0eee6, innerEar: 0xc99b9b, toenails: 0xbaa89b, tuft: 0x261d18 },
    { body: 0x607d8b, tusk: 0xffffff, innerEar: 0xf8bbd0, toenails: 0xcfd8dc, tuft: 0x37474f },
  ],
};

const LABEL_FONT = '"Be Vietnam Pro", "Barlow Condensed", sans-serif';

// Helper: smooth material for animal parts
function animalMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, flatShading: false, ...opts });
}

// Helper: create a mesh positioned at (x, y, z) - shadow enabled by default
function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opts?: Partial<THREE.MeshStandardMaterialParameters>, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, animalMat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

// Helper: scaled sphere "blob" - shadow enabled by default
function blob(g: THREE.Group, color: number, r: number, scale: [number, number, number], x: number, y: number, z: number, rot?: [number, number, number], shadow = true): THREE.Mesh {
  const m = part(new THREE.SphereGeometry(r, 14, 10), color, x, y, z, undefined, shadow);
  m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  g.add(m);
  return m;
}

// Helper: create a rectangular box with softly curved/beveled edges
function createRoundedBox(width: number, height: number, depth: number, radius = 0.12, bevel = 0.06): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = width - bevel * 2;
  const h = height - bevel * 2;
  const r = Math.min(radius, w / 2, h / 2);
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const d = depth - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
  });
  geo.center();
  return geo;
}

// Helper: add eyes pair
function addEyes(g: THREE.Group, x: number, y: number, sep: number, s: number): void {
  const whiteMat = animalMat(0xffffff, { roughness: 0.5 });
  const pupilMat = animalMat(0x161210, { roughness: 0.5 });
  const hlMat = animalMat(0xffffff, { roughness: 0.5 });
  for (const zOff of [-sep, sep]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), whiteMat);
    eyeWhite.position.set(x, y, zOff);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(s * 0.58, 12, 8), pupilMat);
    pupil.position.set(x + s * 0.55, y, zOff);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(s * 0.2, 8, 6), hlMat);
    hl.position.set(x + s * 0.95, y + s * 0.28, zOff - Math.sign(zOff) * s * 0.12);
    g.add(eyeWhite, pupil, hl);
  }
}

// Helper: add legs with hooves casting shadows
function addLegs(g: THREE.Group, color: number, pts: [number, number][], len: number, rad: number, hoofColor?: number): THREE.Group[] {
  const arr: THREE.Group[] = [];
  for (const [x, z] of pts) {
    const pivot = new THREE.Group();
    pivot.position.set(x, len, z);
    const legMesh = part(new THREE.CapsuleGeometry(rad, Math.max(0.01, len - rad * 2), 4, 10), color, 0, -len / 2, 0, undefined, true);
    pivot.add(legMesh);
    if (hoofColor !== undefined) {
      const hoof = part(new THREE.CylinderGeometry(rad * 1.06, rad * 1.12, rad * 1.1, 12), hoofColor, 0, -len + rad * 0.55, 0, undefined, true);
      pivot.add(hoof);
    }
    g.add(pivot);
    arr.push(pivot);
  }
  return arr;
}

// Build species-specific 3D model
function buildChicken(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Body - oval shape (main shadow caster)
  blob(g, s.body, 0.62, [1.15, 0.9, 0.9], 0, 0.95, 0, undefined, true);
  // Head
  g.add(part(new THREE.SphereGeometry(0.36, 18, 12), s.body, 0.55, 1.6, 0));
  // Wings
  for (const z of [-0.5, 0.5]) blob(g, s.body, 0.34, [1.25, 0.7, 0.3], -0.05, 1.0, z, [0, 0, 0.25]);
  // Comb (3 red bumps)
  for (let i = 0; i < 3; i++) {
    g.add(part(new THREE.SphereGeometry(0.1, 10, 8), 0xe0302a, 0.44 + i * 0.12, 1.96 - Math.abs(i - 1) * 0.05, 0));
  }
  // Beak
  const beak = part(new THREE.ConeGeometry(0.11, 0.3, 6), 0xffa41b, 0.98, 1.55, 0);
  beak.rotation.z = -Math.PI / 2;
  g.add(beak);
  // Wattle
  blob(g, 0xe0302a, 0.08, [0.8, 1.4, 0.8], 0.86, 1.36, 0);
  // Tail feathers
  for (let i = 0; i < 3; i++) {
    blob(g, s.tail ?? s.body, 0.2, [0.6, 1.7, 0.45], -0.72, 1.28, (i - 1) * 0.14, [(i - 1) * 0.35, 0, 0.55]);
  }
  addEyes(g, 0.8, 1.68, 0.2, 0.08);
  return addLegs(g, 0xffa41b, [[0, 0.2], [0, -0.2]], 0.5, 0.06);
}

function buildSheep(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Fluffy wool body - central one casts shadow
  g.add(part(new THREE.IcosahedronGeometry(0.44, 1), s.wool, 0, 1.05, 0, undefined, true));
  const woolPositions: [number, number, number][] = [
    [0.38, 1.1, 0.22], [0.38, 1.1, -0.22],
    [-0.38, 1.1, 0.22], [-0.38, 1.1, -0.22], [0, 1.42, 0],
    [0.05, 1.05, 0.38], [0.05, 1.05, -0.38],
  ];
  for (const [x, y, z] of woolPositions) {
    g.add(part(new THREE.IcosahedronGeometry(0.44, 1), s.wool, x, y, z));
  }
  // Face - rounded box
  g.add(part(new THREE.BoxGeometry(0.5, 0.48, 0.44), s.face, 0.78, 1.3, 0));
  // Fluffy fringe on top
  g.add(part(new THREE.IcosahedronGeometry(0.2, 1), s.wool, 0.68, 1.58, 0));
  // Floppy ears
  for (const z of [-0.3, 0.3]) {
    blob(g, s.face, 0.14, [1.1, 0.45, 1.5], 0.7, 1.45, z, [z > 0 ? 0.3 : -0.3, 0, 0]);
  }
  addEyes(g, 1.03, 1.38, 0.13, 0.07);
  return addLegs(g, s.face, [[0.35, 0.22], [0.35, -0.22], [-0.35, 0.22], [-0.35, -0.22]], 0.65, 0.09, 0x2a2624);
}

function buildHorse(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Rounded elongated body using capsule (casts shadow)
  const bodyGeo = new THREE.CapsuleGeometry(0.35, 0.8, 8, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, s.body, 0, 1.4, 0, undefined, true);
  bodyMesh.scale.set(1, 1.05, 0.9);
  g.add(bodyMesh);
  // Neck (tilted capsule)
  const neckGeo = new THREE.CapsuleGeometry(0.16, 0.55, 6, 12);
  const neck = part(neckGeo, s.body, 0.72, 1.85, 0);
  neck.rotation.z = -0.5;
  g.add(neck);
  // Head (rounded snout)
  const headGeo = new THREE.CapsuleGeometry(0.15, 0.4, 6, 12);
  headGeo.rotateZ(Math.PI / 2);
  const head = part(headGeo, s.body, 1.12, 2.2, 0);
  head.rotation.z = -0.25;
  g.add(head);
  // Mane
  const mane = part(new THREE.CapsuleGeometry(0.05, 0.55, 4, 8), s.mane, 0.55, 2.0, 0);
  mane.rotation.z = -0.5;
  g.add(mane);
  // Tail: simple elongated blob slanting from top-rear downwards (từ trên chéo xuống)
  blob(g, s.mane, 0.14, [1, 3, 1], -0.83, 1.24, 0, [0, 0, -0.42]);
  // Ears
  for (const z of [-0.1, 0.1]) {
    g.add(part(new THREE.ConeGeometry(0.06, 0.2, 10), s.body, 0.95, 2.45, z));
  }
  addEyes(g, 1.22, 2.3, 0.17, 0.07);
  return addLegs(g, s.legs ?? s.body, [[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]], 1.05, 0.1, 0x2b2522);
}

function buildCow(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Rectangular box body with softly curved/beveled edges (not a round ball/capsule)
  const bodyGeo = createRoundedBox(1.3, 0.86, 0.88, 0.14, 0.06);
  const bodyMesh = part(bodyGeo, s.body, 0, 1.25, 0, undefined, true);
  g.add(bodyMesh);
  // Spots (if the skin has them)
  if (s.spot) {
    blob(g, s.spot, 0.24, [1, 0.8, 0.14], 0.2, 1.3, 0.45);
    blob(g, s.spot, 0.21, [1, 0.85, 0.14], -0.35, 1.2, -0.45);
    blob(g, s.spot, 0.26, [1.1, 0.14, 0.9], -0.15, 1.68, 0.1);
  }
  // Head (rounded)
  g.add(part(new THREE.SphereGeometry(0.3, 16, 12), s.body, 0.92, 1.45, 0));
  // Nose/muzzle (rounded)
  const muzzleGeo = new THREE.CapsuleGeometry(0.14, 0.08, 6, 12);
  muzzleGeo.rotateX(Math.PI / 2);
  g.add(part(muzzleGeo, s.nose ?? 0xf3a0a8, 1.22, 1.35, 0));
  // Nostrils
  for (const z of [-0.08, 0.08]) {
    g.add(part(new THREE.SphereGeometry(0.035, 8, 6), 0x3a2a22, 1.33, 1.38, z));
  }
  // Horns
  for (const z of [-0.22, 0.22]) {
    g.add(part(new THREE.ConeGeometry(0.07, 0.28, 10), 0xe8dcb0, 0.85, 1.83, z));
  }
  // Ears
  for (const z of [-0.34, 0.34]) {
    blob(g, s.body, 0.12, [0.6, 0.45, 1.4], 0.86, 1.62, z);
  }
  // Cow tail hanging from rear - seamless connected group
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.65, 1.35, 0);
  tailGroup.rotation.z = -0.25;

  const stemLen = 0.46;
  const tailStem = part(new THREE.CylinderGeometry(0.026, 0.02, stemLen, 8), s.body, 0, -stemLen / 2, 0);
  tailGroup.add(tailStem);

  const tuftLen = 0.22;
  // Cone apex points up and nests inside the stem bottom tip (-0.548 + 0.11 = -0.438 > -0.46)
  const tailTuft = part(new THREE.ConeGeometry(0.065, tuftLen, 8), s.spot || 0x2a2624, 0, -stemLen - tuftLen * 0.4, 0);
  tailGroup.add(tailTuft);

  // Bushy end tuft to form a fluffy, lush tassel
  const tuftEnd = part(new THREE.SphereGeometry(0.062, 8, 6), s.spot || 0x2a2624, 0, -stemLen - tuftLen * 0.8, 0);
  tuftEnd.scale.set(0.9, 1.25, 0.9);
  tailGroup.add(tuftEnd);

  g.add(tailGroup);
  addEyes(g, 1.2, 1.58, 0.16, 0.07);
  return addLegs(g, s.legs ?? s.body, [[0.5, 0.28], [0.5, -0.28], [-0.5, 0.28], [-0.5, -0.28]], 0.8, 0.11, 0x3a3330);
}

function buildDuck(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Body - plump oval (casts shadow)
  blob(g, s.body, 0.6, [1.25, 0.8, 0.85], 0, 0.85, 0, undefined, true);
  // Head
  g.add(part(new THREE.SphereGeometry(0.34, 18, 12), s.head ?? s.body, 0.55, 1.45, 0));
  // Wings
  for (const z of [-0.47, 0.47]) {
    blob(g, s.body, 0.34, [1.3, 0.62, 0.3], -0.1, 0.92, z, [0, 0, 0.2]);
  }
  // Flat bill
  g.add(part(new THREE.BoxGeometry(0.38, 0.09, 0.26), s.bill, 0.93, 1.4, 0));
  // Tail feather
  const tail = part(new THREE.ConeGeometry(0.15, 0.35, 6), s.body, -0.75, 1.05, 0);
  tail.rotation.z = 0.9;
  g.add(tail);
  addEyes(g, 0.79, 1.53, 0.17, 0.07);
  return addLegs(g, s.bill, [[0, 0.2], [0, -0.2]], 0.45, 0.06);
}

let spottedPigBodyTex: THREE.CanvasTexture | null = null;
let spottedPigHeadTex: THREE.CanvasTexture | null = null;

function getSpottedPigBodyTexture(): THREE.CanvasTexture {
  if (spottedPigBodyTex) return spottedPigBodyTex;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base pink coat
  ctx.fillStyle = '#f6a5b5';
  ctx.fillRect(0, 0, 512, 256);

  // Black spots (smooth, organic round patches painted directly on surface)
  ctx.fillStyle = '#2e2628';

  // Spot 1: Large back / spine saddle patch (visible from top-down)
  ctx.beginPath();
  ctx.ellipse(230, 55, 68, 38, 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Spot 2: Right flank / shoulder (X=128 is right side)
  ctx.beginPath();
  ctx.ellipse(135, 95, 52, 40, -0.25, 0, Math.PI * 2);
  ctx.fill();

  // Spot 3: Left flank / hip (X=384 is left side)
  ctx.beginPath();
  ctx.ellipse(385, 105, 56, 42, 0.28, 0, Math.PI * 2);
  ctx.fill();

  // Spot 4: Rump / rear patch across edge boundary
  ctx.beginPath();
  ctx.ellipse(0, 75, 42, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(512, 75, 42, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spot 5: Small cute patch on front shoulder
  ctx.beginPath();
  ctx.ellipse(275, 110, 26, 22, -0.3, 0, Math.PI * 2);
  ctx.fill();

  spottedPigBodyTex = new THREE.CanvasTexture(canvas);
  spottedPigBodyTex.wrapS = THREE.RepeatWrapping;
  spottedPigBodyTex.wrapT = THREE.ClampToEdgeWrapping;
  return spottedPigBodyTex;
}

function getSpottedPigHeadTexture(): THREE.CanvasTexture {
  if (spottedPigHeadTex) return spottedPigHeadTex;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base pink coat
  ctx.fillStyle = '#f6a5b5';
  ctx.fillRect(0, 0, 256, 256);

  // Dark eye patch over right eye / temple (X=64 is right side)
  ctx.fillStyle = '#2e2628';
  ctx.beginPath();
  ctx.ellipse(70, 85, 38, 44, 0.18, 0, Math.PI * 2);
  ctx.fill();

  spottedPigHeadTex = new THREE.CanvasTexture(canvas);
  return spottedPigHeadTex;
}

function buildPig(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  if (s.spot) {
    // Smooth, perfectly rounded body with painted spots texture (zero protruding lumps)
    const bodyGeo = new THREE.SphereGeometry(0.72, 28, 20);
    const bodyMat = new THREE.MeshStandardMaterial({
      map: getSpottedPigBodyTexture(),
      roughness: 0.72,
      flatShading: false,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.scale.set(1.35, 1, 1);
    bodyMesh.position.set(0, 1.0, 0);
    bodyMesh.castShadow = true;
    g.add(bodyMesh);

    // Smooth, perfectly rounded head with painted eye patch texture
    const headGeo = new THREE.SphereGeometry(0.5, 24, 18);
    const headMat = new THREE.MeshStandardMaterial({
      map: getSpottedPigHeadTexture(),
      roughness: 0.72,
      flatShading: false,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.set(0.85, 1.3, 0);
    headMesh.castShadow = true;
    g.add(headMesh);
  } else {
    // Round plump body (casts shadow)
    blob(g, s.body, 0.72, [1.35, 1, 1], 0, 1.0, 0, undefined, true);
    // Head
    g.add(part(new THREE.SphereGeometry(0.5, 18, 12), s.body, 0.85, 1.3, 0));
  }
  // Snout cylinder
  const snout = part(new THREE.CylinderGeometry(0.22, 0.23, 0.2, 20), s.snout, 1.33, 1.22, 0);
  snout.rotation.z = Math.PI / 2;
  g.add(snout);
  // Nostrils
  for (const z of [-0.08, 0.08]) {
    g.add(part(new THREE.SphereGeometry(0.045, 8, 6), 0x5a2a35, 1.44, 1.24, z));
  }
  // Ears (droopy cone) - right ear is black on spotted skin
  for (const z of [-0.27, 0.27]) {
    const earColor = (z > 0 && s.spot) ? s.spot : s.body;
    const ear = part(new THREE.ConeGeometry(0.15, 0.28, 10), earColor, 0.72, 1.76, z);
    ear.rotation.x = z > 0 ? 0.4 : -0.4;
    g.add(ear);
  }
  // Curly tail
  const tail = part(new THREE.TorusGeometry(0.12, 0.04, 8, 16, 4.5), s.snout, -0.95, 1.15, 0);
  tail.rotation.y = Math.PI / 2;
  g.add(tail);
  addEyes(g, 1.2, 1.46, 0.2, 0.08);
  return addLegs(g, s.body, [[0.5, 0.3], [0.5, -0.3], [-0.5, 0.3], [-0.5, -0.3]], 0.45, 0.13);
}

function buildDog(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Elongated rounded body using capsule (casts shadow)
  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.60, 8, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, s.body, 0, 1.15, 0, undefined, true);
  bodyMesh.scale.set(1.05, 0.95, 0.9);
  g.add(bodyMesh);

  // Chest / Underbelly patch
  if (s.chest) {
    blob(g, s.chest, 0.24, [1.0, 0.75, 0.75], 0.22, 1.02, 0);
  }

  // Head (rounded sphere)
  g.add(part(new THREE.SphereGeometry(0.33, 16, 12), s.head ?? s.body, 0.72, 1.48, 0));

  // Snout / Muzzle (rounded capsule extending forward)
  const muzzleGeo = new THREE.CapsuleGeometry(0.12, 0.16, 6, 12);
  muzzleGeo.rotateZ(Math.PI / 2);
  g.add(part(muzzleGeo, s.snout ?? s.body, 1.02, 1.38, 0));

  // Cute Black Nose at muzzle tip
  g.add(part(new THREE.SphereGeometry(0.046, 8, 6), 0x1a1614, 1.16, 1.43, 0));

  // Triangular perky ears with inner ear flap
  for (const z of [-0.18, 0.18]) {
    const ear = part(new THREE.ConeGeometry(0.10, 0.28, 8), s.ear ?? s.body, 0.70, 1.84, z);
    ear.rotation.z = -0.15;
    ear.rotation.x = z > 0 ? 0.3 : -0.3;
    g.add(ear);

    if (s.innerEar) {
      const inner = part(new THREE.ConeGeometry(0.065, 0.22, 6), s.innerEar, 0.72, 1.84, z);
      inner.rotation.z = -0.15;
      inner.rotation.x = z > 0 ? 0.3 : -0.3;
      g.add(inner);
    }
  }

  // Collar with golden medallion tag
  const collar = part(new THREE.TorusGeometry(0.24, 0.035, 8, 20), s.collar ?? 0xd32f2f, 0.55, 1.34, 0);
  collar.rotation.y = Math.PI / 2;
  collar.rotation.x = 0.35;
  g.add(collar);
  const tag = part(new THREE.SphereGeometry(0.06, 8, 6), 0xffd700, 0.65, 1.22, 0, { metalness: 0.8, roughness: 0.2 });
  g.add(tag);

  // Wagging tail tilted up/curved
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.55, 1.26, 0);
  tailGroup.rotation.z = 0.65;
  const tailStem = part(new THREE.CapsuleGeometry(0.05, 0.36, 6, 10), s.tail ?? s.body, 0, 0.16, 0);
  tailGroup.add(tailStem);
  if (s.tailTip) {
    const tailTip = part(new THREE.SphereGeometry(0.065, 8, 6), s.tailTip, 0, 0.34, 0);
    tailGroup.add(tailTip);
  }
  g.add(tailGroup);

  addEyes(g, 0.94, 1.55, 0.15, 0.07);
  return addLegs(g, s.legs ?? s.body, [[0.28, 0.13], [0.28, -0.13], [-0.28, 0.13], [-0.28, -0.13]], 0.90, 0.095, s.paws ?? 0x2b2522);
}

function buildElephant(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Hefty rounded body (main shadow caster)
  const bodyGeo = new THREE.CapsuleGeometry(0.55, 0.75, 8, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, s.body, 0, 1.35, 0, undefined, true);
  bodyMesh.scale.set(1.05, 1.08, 1.02);
  g.add(bodyMesh);

  // Head (rounded sphere)
  g.add(part(new THREE.SphereGeometry(0.46, 18, 14), s.body, 0.95, 1.65, 0));
  // Forehead brow / dome
  blob(g, s.body, 0.28, [0.85, 0.9, 1.15], 0.9, 1.95, 0);

  // Trunk: continuous smooth tapering curve extending from face and curling up gracefully
  const trunkNodes: [number, number, number][] = [
    [1.24, 1.56, 0.18],  // Node 0: Base emerging from front face of head
    [1.40, 1.36, 0.15],  // Node 1: Sloping down and forward
    [1.52, 1.14, 0.125], // Node 2: Dropping towards chest level
    [1.58, 0.92, 0.105], // Node 3: Lowest point, starting to curve forward
    [1.70, 0.94, 0.09],  // Node 4: Curving forward and starting to lift
    [1.82, 1.10, 0.078], // Node 5: Curling upwards
    [1.80, 1.26, 0.068], // Node 6: Proud curled tip
  ];

  // Spheres at all nodes to seal joints seamlessly
  for (const [nx, ny, nr] of trunkNodes) {
    g.add(part(new THREE.SphereGeometry(nr, 12, 10), s.body, nx, ny, 0));
  }

  // Tapered cylinder segments connecting consecutive nodes
  for (let i = 0; i < trunkNodes.length - 1; i++) {
    const [x0, y0, r0] = trunkNodes[i];
    const [x1, y1, r1] = trunkNodes[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const segMesh = part(new THREE.CylinderGeometry(r1, r0, len, 12), s.body, (x0 + x1) / 2, (y0 + y1) / 2, 0);
    segMesh.rotation.z = -Math.atan2(dx, dy);
    g.add(segMesh);
  }

  // Nostrils at the curled tip
  for (const z of [-0.026, 0.026]) {
    g.add(part(new THREE.SphereGeometry(0.02, 6, 4), 0x241e1c, 1.77, 1.28, z));
  }

  // Tusks: firmly rooted in lower mouth/cheeks flanking the trunk base, curving forward & upward
  for (const z of [-0.15, 0.15]) {
    // Fleshy cheek socket anchoring the tusk root
    blob(g, s.body, 0.08, [1, 1, 1], 1.20, 1.34, z);

    // Tusk cone starting at socket, pointing forward & upward
    const tusk = part(new THREE.ConeGeometry(0.052, 0.42, 10), s.tusk ?? 0xf7f5f0, 1.40, 1.40, z > 0 ? 0.17 : -0.17, { roughness: 0.28, metalness: 0.12 });
    tusk.rotation.z = -1.28;
    tusk.rotation.y = z > 0 ? 0.12 : -0.12;
    g.add(tusk);
  }

  // Large flapping ears with inner ear flap
  for (const z of [-0.44, 0.44]) {
    blob(g, s.body, 0.38, [0.75, 1.15, 0.15], 0.78, 1.72, z, [0, z > 0 ? -0.25 : 0.25, -0.15]);
    blob(g, s.innerEar ?? 0xdfb4b4, 0.28, [0.65, 1.05, 0.12], 0.80, 1.72, z > 0 ? z - 0.02 : z + 0.02, [0, z > 0 ? -0.25 : 0.25, -0.15]);
  }

  // Elephant tail hanging from rear like cow tail - seamless connected group
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.70, 1.40, 0);
  tailGroup.rotation.z = -0.25;

  const stemLen = 0.50;
  const tailStem = part(new THREE.CylinderGeometry(0.028, 0.022, stemLen, 8), s.body, 0, -stemLen / 2, 0);
  tailGroup.add(tailStem);

  const tuftLen = 0.24;
  // Cone apex points up and nests inside the stem bottom tip
  const tailTuft = part(new THREE.ConeGeometry(0.07, tuftLen, 8), s.tuft ?? 0x2b2522, 0, -stemLen - tuftLen * 0.4, 0);
  tailGroup.add(tailTuft);

  // Bushy end tuft to form a fluffy, lush tassel (identical style to cow tail)
  const tuftEnd = part(new THREE.SphereGeometry(0.066, 8, 6), s.tuft ?? 0x2b2522, 0, -stemLen - tuftLen * 0.8, 0);
  tuftEnd.scale.set(0.9, 1.25, 0.9);
  tailGroup.add(tuftEnd);

  g.add(tailGroup);

  // Prominent cute eyes situated on the side temples of the head
  addEyes(g, 1.26, 1.72, 0.35, 0.08);
  return addLegs(g, s.legs ?? s.body, [[0.46, 0.32], [0.46, -0.32], [-0.46, 0.32], [-0.46, -0.32]], 1.05, 0.16, s.toenails ?? 0xd0c8be);
}

const BUILDERS: Record<Species, (g: THREE.Group, s: Record<string, number>) => THREE.Group[]> = {
  chicken: buildChicken,
  sheep: buildSheep,
  horse: buildHorse,
  cow: buildCow,
  duck: buildDuck,
  pig: buildPig,
  dog: buildDog,
  elephant: buildElephant,
};

export function buildCollar(species: Species, mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.85,
    roughness: 0.25,
  });

  switch (species) {
    case 'chicken': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 8, 24), mat);
      band.position.set(0.42, 1.34, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.45;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), goldMat);
      medal.position.set(0.53, 1.25, 0);
      g.add(medal);
      break;
    }
    case 'sheep': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.038, 8, 24), mat);
      band.position.set(0.55, 1.24, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.2;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), goldMat);
      medal.position.set(0.68, 1.14, 0);
      g.add(medal);
      break;
    }
    case 'horse': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.036, 8, 24), mat);
      band.position.set(0.84, 1.96, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.52;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), goldMat);
      medal.position.set(0.96, 1.84, 0);
      g.add(medal);
      break;
    }
    case 'cow': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.038, 8, 24), mat);
      band.position.set(0.70, 1.35, 0);
      band.rotation.y = Math.PI / 2;
      g.add(band);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), goldMat);
      bell.position.set(0.70, 1.12, 0);
      g.add(bell);
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshStandardMaterial({ color: 0x3a3a3a }));
      clapper.position.set(0.70, 1.04, 0);
      g.add(clapper);
      break;
    }
    case 'duck': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.032, 8, 24), mat);
      band.position.set(0.42, 1.22, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.38;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), goldMat);
      medal.position.set(0.52, 1.13, 0);
      g.add(medal);
      break;
    }
    case 'pig': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.042, 8, 24), mat);
      band.position.set(0.58, 1.18, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.15;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), goldMat);
      medal.position.set(0.72, 1.06, 0);
      g.add(medal);
      break;
    }
    case 'dog': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.034, 8, 24), mat);
      band.position.set(0.55, 1.35, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.35;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), goldMat);
      medal.position.set(0.66, 1.24, 0);
      g.add(medal);
      break;
    }
    case 'elephant': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 8, 24), mat);
      band.position.set(0.72, 1.48, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.3;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), goldMat);
      medal.position.set(0.85, 1.34, 0);
      g.add(medal);
      break;
    }
  }
  return g;
}

// Where the crown sits on each species
const HEAD: Record<Species, [number, number]> = {
  chicken: [0.55, 2.05],
  sheep: [0.78, 1.6],
  horse: [1.12, 2.45],
  cow: [0.92, 1.8],
  duck: [0.55, 1.83],
  pig: [0.85, 1.83],
  dog: [0.72, 1.85],
  elephant: [0.95, 2.15],
};

// Back of each species for the cape
const BACK: Record<Species, [number, number, number, number, number]> = {
  chicken: [-0.2, 0.95, 0.6, 0.6, 0.95],
  sheep: [-0.15, 1.15, 0.9, 0.75, 1.1],
  horse: [-0.2, 1.4, 0.36, 0.4, 1.2],
  cow: [-0.15, 1.2, 0.47, 0.45, 1.2],
  duck: [-0.2, 0.85, 0.56, 0.53, 0.95],
  pig: [-0.25, 1.0, 0.77, 0.77, 1.3],
  dog: [-0.15, 1.1, 0.55, 0.55, 1.05],
  elephant: [-0.15, 1.35, 0.65, 0.65, 1.3],
};

function buildRegalia(species: Species): THREE.Group {
  const g = new THREE.Group();
  const [hx, hy] = HEAD[species] || [0.5, 1.8];
  const gold = { metalness: 0.6, roughness: 0.3, emissive: 0x664400 };

  // Crown cylinder
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.3, 0.26, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffc400, ...gold, side: THREE.DoubleSide })
  );
  base.position.set(hx, hy, 0);
  g.add(base);

  // Crown spikes & red jewels
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0xffc400, ...gold })
    );
    spike.position.set(hx + Math.cos(a) * 0.3, hy + 0.22, Math.sin(a) * 0.3);
    g.add(spike);

    const jewel = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe0302a, emissive: 0x440000 })
    );
    jewel.position.set(hx + Math.cos(a) * 0.3, hy + 0.35, Math.sin(a) * 0.3);
    g.add(jewel);
  }

  // Red cape
  const [cx, cy, hw, ht, len] = BACK[species] || [-0.2, 1.0, 0.6, 0.6, 1.0];
  const shell = new THREE.CylinderGeometry(1, 1, len * 0.8, 28, 1, true, Math.PI / 2 - 1.0, 2.0);
  shell.rotateZ(Math.PI / 2);
  const cape = new THREE.Mesh(
    shell,
    new THREE.MeshStandardMaterial({ color: 0xa5281b, roughness: 0.7, side: THREE.DoubleSide })
  );
  cape.castShadow = true;
  cape.position.set(cx - len * 0.1, cy, 0);
  cape.scale.set(1, ht + 0.1, hw + 0.1);
  cape.rotation.z = 0.12;
  g.add(cape);

  const clasp = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffc400, ...gold })
  );
  clasp.position.set(cx + len * 0.3, cy + ht + 0.08, 0);
  g.add(clasp);

  return g;
}

export function buildFlowerHat(species: Species): THREE.Group {
  const g = new THREE.Group();
  const [hx, hy] = HEAD[species] || [0.5, 1.8];

  // Side offsets so flower sits cutely beside ear / comb / horn
  const zOffsets: Record<Species, number> = {
    chicken: 0.16,
    sheep: 0.22,
    horse: 0.16,
    cow: 0.24,
    duck: 0.16,
    pig: 0.20,
    dog: 0.18,
    elephant: 0.28,
  };
  const yOffsets: Record<Species, number> = {
    chicken: 0.08,
    sheep: 0.05,
    horse: 0.08,
    cow: 0.06,
    duck: 0.06,
    pig: 0.06,
    dog: 0.06,
    elephant: 0.08,
  };
  const hz = zOffsets[species] ?? 0.18;
  const hyOffset = yOffsets[species] ?? 0.06;

  const flowerGroup = new THREE.Group();
  flowerGroup.position.set(hx, hy + hyOffset, hz);
  // Tilt outward slightly
  flowerGroup.rotation.set(0.35, 0.2, -0.25);

  // 1. Calyx / green base
  const calyx = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.02, 0.09, 8),
    new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7 })
  );
  calyx.rotation.x = Math.PI / 2;
  flowerGroup.add(calyx);

  // 2. Small leafy accents
  for (const rotZ of [-0.6, 0.6]) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x43a047, roughness: 0.7 })
    );
    leaf.scale.set(1.7, 0.35, 0.7);
    leaf.position.set(rotZ * 0.12, -0.04, 0);
    leaf.rotation.z = rotZ;
    flowerGroup.add(leaf);
  }

  // 3. Five blooming pink/rose petals
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xff4081,
    roughness: 0.38,
    metalness: 0.08,
  });
  const petalGeo = new THREE.SphereGeometry(0.08, 10, 8);
  petalGeo.scale(1.3, 0.45, 0.85);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, petalMat);
    petal.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.04);
    petal.rotation.z = a;
    petal.rotation.y = 0.18;
    flowerGroup.add(petal);
  }

  // 4. Center pistil (bright golden dome)
  const pistilMat = new THREE.MeshStandardMaterial({
    color: 0xffd54f,
    roughness: 0.3,
    metalness: 0.25,
    emissive: 0xff9800,
    emissiveIntensity: 0.3,
  });
  const pistil = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), pistilMat);
  pistil.position.set(0, 0, 0.06);
  flowerGroup.add(pistil);

  g.add(flowerGroup);
  return g;
}

export function buildWitchHat(species: Species): THREE.Group {
  const g = new THREE.Group();
  const [hx, hy] = HEAD[species] || [0.5, 1.8];

  const hatGroup = new THREE.Group();
  // Sit the hat snugly on the crown of each species' head
  const yOffset = species === 'elephant' ? 0.18 : species === 'horse' ? 0.22 : species === 'cow' ? 0.18 : 0.14;
  hatGroup.position.set(hx, hy + yOffset, 0);
  // Slight forward lean (toward the face) for style
  hatGroup.rotation.z = -0.12;

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1528,
    roughness: 0.6,
    flatShading: true,
  });
  const orangeMat = new THREE.MeshStandardMaterial({
    color: 0xff6d00,
    roughness: 0.5,
    emissive: 0x331100,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd54f,
    metalness: 0.8,
    roughness: 0.25,
  });

  const brimRadius = species === 'elephant' ? 0.60 : species === 'cow' || species === 'horse' ? 0.46 : 0.34;
  const brimGeo = new THREE.CylinderGeometry(brimRadius, brimRadius * 1.08, 0.05, 16);
  const brim = new THREE.Mesh(brimGeo, darkMat);
  hatGroup.add(brim);

  const ribbonRadius = brimRadius * 0.58;
  const ribbon = new THREE.Mesh(
    new THREE.CylinderGeometry(ribbonRadius * 0.95, ribbonRadius, 0.12, 16),
    orangeMat
  );
  ribbon.position.y = 0.06;
  hatGroup.add(ribbon);

  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.09, 0.05),
    goldMat
  );
  buckle.position.set(ribbonRadius + 0.02, 0.06, 0);
  hatGroup.add(buckle);

  const coneHeight = species === 'elephant' ? 0.95 : 0.72;
  const coneRadius = ribbonRadius * 0.88;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(coneRadius, coneHeight, 16),
    darkMat
  );
  // Center the cone directly above the brim — no X offset
  cone.position.set(0, coneHeight * 0.5 + 0.10, 0);
  // Slight lean matching the hatGroup tilt, not additional off-axis skew
  cone.rotation.z = 0;
  hatGroup.add(cone);

  // Pointy tip accent (small bright orange sphere at cone apex)
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xff8f00, emissive: 0x331500, roughness: 0.4 });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(coneRadius * 0.18, 8, 6), tipMat);
  tip.position.set(0, coneHeight + 0.10, 0);
  hatGroup.add(tip);

  g.add(hatGroup);
  return g;
}

export function buildCartVisual(theme: ArenaTheme): {
  cartGroup: THREE.Group;
  cartThemeGroups: {
    classic: THREE.Group;
    womenDay: THREE.Group;
    halloween: THREE.Group;
  };
  cartWheels: THREE.Mesh[];
} {
  const cartGroup = new THREE.Group();
  const wheels: THREE.Mesh[] = [];

  // 1. Classic Farm Tractor / Bumper Cart
  const classic = new THREE.Group();
  {
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.75 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.4, metalness: 0.6 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 });

    const chassis = part(new THREE.BoxGeometry(1.6, 0.5, 1.1), chassisMat.color.getHex(), 0, 0.58, 0);
    classic.add(chassis);

    const plow = part(new THREE.ConeGeometry(0.55, 0.65, 4), redMat.color.getHex(), 0.95, 0.5, 0, { roughness: 0.4 });
    plow.rotation.z = -Math.PI / 2;
    plow.scale.set(0.9, 1.0, 1.5);
    classic.add(plow);

    const stack = part(new THREE.CylinderGeometry(0.08, 0.09, 0.75, 8), metalMat.color.getHex(), 0.4, 1.15, 0.38, { metalness: 0.7 });
    classic.add(stack);
    const stackCap = part(new THREE.CylinderGeometry(0.12, 0.08, 0.12, 8), 0xffb300, 0.4, 1.55, 0.38, { metalness: 0.8 });
    classic.add(stackCap);

    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 16), metalMat);
    steering.position.set(-0.15, 1.0, 0);
    steering.rotation.y = Math.PI / 2;
    steering.rotation.z = 0.4;
    classic.add(steering);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.85 });
    const wheelGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.22, 14);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelOffsets = [
      [0.55, 0.40, 0.64],
      [0.55, 0.40, -0.64],
      [-0.55, 0.40, 0.64],
      [-0.55, 0.40, -0.64],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.position.set(wx, wy, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.24, 8), new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.5 }));
      hub.rotation.x = Math.PI / 2;
      wMesh.add(hub);
      classic.add(wMesh);
      wheels.push(wMesh);
    }
  }

  // 2. Women's Day: Floral Chariot
  const womenDay = new THREE.Group();
  {
    const carriageMat = new THREE.MeshStandardMaterial({ color: 0xfff5f8, roughness: 0.3, metalness: 0.1 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.25, metalness: 0.85 });
    const roseMat = new THREE.MeshStandardMaterial({ color: 0xff4081, roughness: 0.4, emissive: 0xe91e63, emissiveIntensity: 0.2 });

    const chassis = part(new THREE.BoxGeometry(1.5, 0.5, 1.05), carriageMat.color.getHex(), 0, 0.58, 0, { roughness: 0.3, metalness: 0.1 });
    womenDay.add(chassis);

    const ram = part(new THREE.SphereGeometry(0.36, 12, 10), roseMat.color.getHex(), 0.85, 0.55, 0, { roughness: 0.3, metalness: 0.2 });
    ram.scale.set(0.9, 1.1, 1.3);
    womenDay.add(ram);

    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 16), goldMat);
    trim.position.set(0, 0.85, 0);
    trim.rotation.x = Math.PI / 2;
    womenDay.add(trim);

    const lantern = part(new THREE.CylinderGeometry(0.09, 0.06, 0.45, 8), goldMat.color.getHex(), -0.5, 1.0, 0.35, { metalness: 0.8 });
    womenDay.add(lantern);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.75 });
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.14, 12);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelOffsets = [
      [0.55, 0.36, 0.6],
      [0.55, 0.36, -0.6],
      [-0.55, 0.36, 0.6],
      [-0.55, 0.36, -0.6],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.position.set(wx, wy, wz);
      const roseHub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), roseMat);
      wMesh.add(roseHub);
      womenDay.add(wMesh);
      wheels.push(wMesh);
    }
  }

  // 3. Halloween: Bone Hearse / Skull Roadster
  const halloween = new THREE.Group();
  {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x181424, roughness: 0.5, metalness: 0.3 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe0d7bf, roughness: 0.65 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xff3d00, emissive: 0xff1744, emissiveIntensity: 0.8 });

    const chassis = part(new THREE.BoxGeometry(1.6, 0.45, 1.1), bodyMat.color.getHex(), 0, 0.55, 0, { roughness: 0.5, metalness: 0.3 });
    halloween.add(chassis);

    const skullPlow = part(new THREE.ConeGeometry(0.5, 0.7, 6), boneMat.color.getHex(), 0.95, 0.52, 0);
    skullPlow.rotation.z = -Math.PI / 2;
    halloween.add(skullPlow);

    for (const z of [-0.35, 0.35]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), glowMat);
      eye.position.set(0.85, 0.65, z);
      halloween.add(eye);
    }

    const stack = part(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), 0x241d30, -0.45, 1.05, 0.35);
    halloween.add(stack);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xba68c8 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 6), flameMat);
    flame.position.set(-0.45, 1.5, 0.35);
    halloween.add(flame);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x221a2c, roughness: 0.8 });
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.18, 12);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelOffsets = [
      [0.55, 0.38, 0.62],
      [0.55, 0.38, -0.62],
      [-0.55, 0.38, 0.62],
      [-0.55, 0.38, -0.62],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.position.set(wx, wy, wz);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), glowMat);
      wMesh.add(hub);
      halloween.add(wMesh);
      wheels.push(wMesh);
    }
  }

  classic.visible = theme === 'classic';
  womenDay.visible = theme === 'women_day';
  halloween.visible = theme === 'halloween';

  cartGroup.add(classic, womenDay, halloween);
  cartGroup.visible = false;

  return {
    cartGroup,
    cartThemeGroups: { classic, womenDay, halloween },
    cartWheels: wheels,
  };
}

// Height where name label floats for each species
const LABEL_Y: Record<Species, number> = {
  chicken: 2.3,
  sheep: 1.9,
  horse: 2.8,
  cow: 2.2,
  duck: 2.0,
  pig: 2.1,
  dog: 2.1,
  elephant: 2.6,
};

function createLabel(text: string, crowned = false, traitor = false, isMe = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 40px ${LABEL_FONT}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = w;
  canvas.height = 58;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (crowned || traitor) {
    ctx.fillStyle = crowned ? '#e8b641' : '#a5281b';
    ctx.fillRect(0, 4, w, 50);
    ctx.fillStyle = crowned ? '#1f1a17' : '#f2ead7';
    ctx.fillText(text, w / 2, 30);
  } else {
    ctx.lineWidth = 7;
    ctx.strokeStyle = isMe ? 'rgba(25, 20, 15, 0.95)' : 'rgba(31, 26, 23, 0.75)';
    ctx.strokeText(text, w / 2, 30);
    ctx.fillStyle = isMe ? '#ffd54f' : '#f2ead7';
    ctx.fillText(text, w / 2, 30);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.aspect = w / 58;
  return sprite;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
  baseRadius: number;
  life: number;
  maxLife: number;
  active: boolean;
}

interface WaterRipple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  startR: number;
  maxR: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export class AnimalRenderer {
  public myId = 0;
  private readonly visuals = new Map<number, AnimalVisual>();
  private readonly group = new THREE.Group();
  private readonly shockwavePool: ShockwaveRing[] = [];
  private readonly waterRipplePool: WaterRipple[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
    // Shockwave rings pool for sonic boom effects
    const swGeo = new THREE.RingGeometry(0.85, 1.25, 36);
    swGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x64d8cb,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(swGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this.shockwavePool.push({
        mesh,
        mat,
        x: 0,
        y: 0,
        z: 0,
        baseRadius: 1,
        life: 0,
        maxLife: 0.38,
        active: false,
      });
    }

    // Water ripple rings pool for swimming ripples & wake waves (slimmer, softer)
    const rippleGeo = new THREE.RingGeometry(0.88, 1.0, 32);
    rippleGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdef5ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(rippleGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.position.y = 0.082;
      this.scene.add(mesh);
      this.waterRipplePool.push({
        mesh,
        mat,
        x: 0,
        z: 0,
        startR: 1,
        maxR: 3,
        life: 0,
        maxLife: 1.0,
        active: false,
      });
    }
  }

  onPuff?: (x: number, y: number, z: number, color: number, size?: number, life?: number, vy?: number) => void;
  onRainbowTrail?: (x: number, y: number, z: number, angle: number, r: number, isDash: boolean) => void;
  onSonicWave?: (x: number, y: number, z: number, r: number) => void;

  spawnShockwave(x: number, y: number, z: number, r: number, color = 0x64d8cb): void {
    let sw = this.shockwavePool.find((s) => !s.active);
    if (!sw) sw = this.shockwavePool[0];
    sw.active = true;
    sw.x = x;
    sw.y = y;
    sw.z = z;
    sw.baseRadius = r;
    sw.life = 0;
    sw.maxLife = 0.38;
    sw.mat.color.setHex(color);
    sw.mat.opacity = 0.9;
    sw.mesh.position.set(x, y, z);
    sw.mesh.scale.setScalar(r);
    sw.mesh.visible = true;
  }

  updateShockwaves(dt: number): void {
    for (const sw of this.shockwavePool) {
      if (!sw.active) continue;
      sw.life += dt;
      if (sw.life >= sw.maxLife) {
        sw.active = false;
        sw.mesh.visible = false;
      } else {
        const k = sw.life / sw.maxLife;
        const sc = sw.baseRadius * (1 + k * 4.2);
        sw.mesh.scale.setScalar(sc);
        sw.mat.opacity = (1 - k) * 0.9;
      }
    }
  }

  spawnWaterRipple(x: number, z: number, startR: number, maxR: number, maxLife = 0.85, color = 0xdef5ff): void {
    let wr = this.waterRipplePool.find((r) => !r.active);
    if (!wr) wr = this.waterRipplePool[0];
    wr.active = true;
    wr.x = x;
    wr.z = z;
    wr.startR = startR;
    wr.maxR = maxR;
    wr.life = 0;
    wr.maxLife = maxLife;
    wr.mat.color.setHex(color);
    wr.mat.opacity = 0.38; // Dimmer, more subtle
    wr.mesh.position.set(x, 0.082, z);
    wr.mesh.scale.set(startR, 1, startR);
    wr.mesh.visible = true;
  }

  updateWaterRipples(dt: number): void {
    for (const wr of this.waterRipplePool) {
      if (!wr.active) continue;
      wr.life += dt;
      if (wr.life >= wr.maxLife) {
        wr.active = false;
        wr.mesh.visible = false;
      } else {
        const k = wr.life / wr.maxLife;
        const curR = wr.startR + (wr.maxR - wr.startR) * Math.sqrt(k);
        wr.mesh.scale.set(curR, 1, curR);
        // Soft gradual fade out (mờ dần các vòng sóng nước)
        wr.mat.opacity = Math.pow(1 - k, 1.8) * 0.38;
      }
    }
  }

  getVisual(id: number, meta?: PlayerMeta): AnimalVisual | undefined {
    let vis = this.visuals.get(id);
    if (vis && meta && vis.species !== meta.species) {
      this.remove(id);
      vis = undefined;
    }
    if (!vis && meta) {
      const isMe = id === this.myId;
      vis = this.buildAnimal(meta, isMe);
      this.visuals.set(id, vis);
      this.group.add(vis.root);
    }
    return vis;
  }

  notifyHit(id: number): void {
    const vis = this.visuals.get(id);
    if (vis) {
      vis.hitT = performance.now();
    }
  }

  getPosition(id: number): { x: number; z: number } | undefined {
    const vis = this.visuals.get(id);
    return vis ? { x: vis.root.position.x, z: vis.root.position.z } : undefined;
  }

  remove(id: number): void {
    const vis = this.visuals.get(id);
    if (vis) {
      if (vis.rainbow) setRainbow(vis, false, 0);
      if (vis.stars) {
        this.scene.remove(vis.stars);
        vis.stars = null;
      }
      if (vis.label) {
        this.scene.remove(vis.label);
        vis.label.material.map?.dispose();
        vis.label.material.dispose();
        vis.label = null;
      }
      if (vis.mudSplats) {
        for (const s of vis.mudSplats) {
          this.scene.remove(s);
        }
      }
      if (vis.summonGroup) {
        this.scene.remove(vis.summonGroup);
      }
      this.group.remove(vis.root);
      this.scene.remove(vis.ring);
      this.visuals.delete(id);
    }
  }

  clear(): void {
    for (const vis of this.visuals.values()) {
      if (vis.rainbow) setRainbow(vis, false, 0);
      if (vis.stars) {
        this.scene.remove(vis.stars);
        vis.stars = null;
      }
      if (vis.label) {
        this.scene.remove(vis.label);
        vis.label.material.map?.dispose();
        vis.label.material.dispose();
        vis.label = null;
      }
      if (vis.mudSplats) {
        for (const s of vis.mudSplats) {
          this.scene.remove(s);
          s.geometry.dispose();
        }
        vis.mudSplatMat.dispose();
      }
      if (vis.summonGroup) {
        this.scene.remove(vis.summonGroup);
      }
      this.group.remove(vis.root);
      this.scene.remove(vis.ring);
    }
    this.visuals.clear();
    for (const sw of this.shockwavePool) {
      sw.active = false;
      sw.mesh.visible = false;
    }
    for (const wr of this.waterRipplePool) {
      wr.active = false;
      wr.mesh.visible = false;
    }
  }

  triggerSundaySummon(duration = 1.5): void {
    for (const vis of this.visuals.values()) {
      vis.summonRingTimer = duration;
      vis.summonGroup.visible = true;
    }
  }

  update(
    id: number,
    meta: PlayerMeta,
    x: number,
    z: number,
    angle: number,
    mass: number,
    flags: number,
    isKing = false,
    podiumPos?: [number, number],
    dt = 0.016,
    now = performance.now(),
    charge = 0,
    activeRule = ''
  ): void {
    const vis = this.getVisual(id, meta);
    if (!vis) return;

    const speed = Math.hypot(x - vis.lastX, z - vis.lastZ);
    vis.lastX = x;
    vis.lastZ = z;

    const isDashing = (flags & 1) !== 0;
    const isPlowing = (flags & 2) !== 0;
    const isCharging = (flags & 4) !== 0;
    const isStunned = (flags & 8) !== 0;
    const isWater = (flags & 16) !== 0;
    const isMud = (flags & 32) !== 0;
    const isDrowning = (flags & 64) !== 0;
    const isSuper = (flags & FLAG.SUPER) !== 0;
    const isFlying = (flags & FLAG.FLYING) !== 0;
    const isSquished = (flags & FLAG.SQUISHED) !== 0;
    const isWheel = (flags & FLAG.WHEEL) !== 0;
    const lvl = (charge || 0) / 10;

    // Smooth squish factor transition: fast flatten on impact (dt * 16), gentle cartoon pop back up (dt * 5)
    vis.squishFactor = isSquished
      ? Math.min(1, (vis.squishFactor || 0) + dt * 16)
      : Math.max(0, (vis.squishFactor || 0) - dt * 5);
    const sq = vis.squishFactor || 0;

    setRainbow(vis, isSuper, now);

    // Continuous walking / dashing leg phase accumulation (elephant has slower strides; mud creates sluggish heavy stepping)
    const legFreqMult = vis.species === 'elephant' ? 0.5 : 1.0;
    const mudSpeedMult = isMud && !isSuper ? 0.65 : 1.0;
    vis.phase += dt * (isDashing ? 26 : 8 + Math.min(10, speed * 12)) * legFreqMult * mudSpeedMult;
    const r = radiusOf(mass);
    const sc = r * 1.35 * (isKing ? 1.2 : 1) * (isSuper ? 1.15 : 1);

    const podX = podiumPos ? podiumPos[0] : 0;
    const podZ = podiumPos ? podiumPos[1] : 0;
    const targetBaseY = computePodiumRampY(x, z, podX, podZ);
    const prevBaseY = vis.visualY ?? targetBaseY;
    const yLerpFactor = 1 - Math.exp(-16.0 * Math.min(dt, 0.05));
    const smoothBaseY = prevBaseY + (targetBaseY - prevBaseY) * yLerpFactor;
    vis.visualY = smoothBaseY;
    let y = smoothBaseY;
    if (isMud && !isSuper) {
      y -= 0.08 * sc;
    }

    if (isWater && !isSuper) {
      vis.waterT = Math.min(3.0, (vis.waterT || 0) + dt);
    } else {
      vis.waterT = Math.max(0, (vis.waterT || 0) - dt * 3.5);
    }

    // Maximum water duration is 1.5s
    const sinkProgress = Math.min(1, (vis.waterT || 0) / 1.5);

    // Visual sinking effect reduced by 25%
    const inWaterShrink = isWater && !isSuper && vis.species !== 'duck' && vis.species !== 'dog'
      ? Math.max(0.72, 1 - sinkProgress * 0.28)
      : 1;

    if (isWater && !isSuper) {
      if (vis.species === 'duck') {
        // Ducks float peacefully on the surface with subtle bobbing
        y = -0.20 * sc + Math.sin(now / 300) * 0.035;
      } else if (vis.species === 'dog') {
        // Dogs can swim, half body submerged under water with paddling bob
        y = -0.90 * sc + Math.sin(now / 220) * 0.022;
      } else {
        // Visual sinking speed reduced by 25%
        const sinkDepth = 0.25 + Math.pow(sinkProgress, 1.3) * 1.05;
        const sinkY = -sinkDepth * sc;
        const rippleBob = Math.sin(now / 160) * 0.035 * (1 - sinkProgress);
        y = sinkY + (sinkProgress < 0.95 ? rippleBob : 0);

        // Water bubble puffs floating up from underwater while sinking (25% fewer & smaller)
        if (this.onPuff && Math.random() < 0.16) {
          this.onPuff(
            x + (Math.random() - 0.5) * 0.6 * r,
            0.1,
            z + (Math.random() - 0.5) * 0.6 * r,
            0xdff1ff,
            0.40 * r,
            0.55,
            1.6
          );
        }
      }
    }

    // Water surface ripples & waves when swimming or floating (smaller, softer, less frequent)
    if (isWater && !isSuper) {
      vis.waterRippleTimer = (vis.waterRippleTimer || 0) + dt;
      const rippleInterval = speed > 0.03 ? 0.28 : 0.55;
      if (vis.waterRippleTimer >= rippleInterval) {
        vis.waterRippleTimer = 0;
        this.spawnWaterRipple(x, z, r * 0.55, r * 1.85, 0.85, 0xdef5ff);
        if (speed > 0.03) {
          this.spawnWaterRipple(
            x - Math.cos(angle) * r * 0.6,
            z - Math.sin(angle) * r * 0.6,
            r * 0.38,
            r * 1.40,
            0.75,
            0xbfe5fa
          );
        }
      }
    }

    // Body hopping & positioning
    let bodyY = y + (isWater && !isSuper ? 0 : Math.abs(Math.sin(vis.phase)) * 0.1 * r);
    if (isFlying) bodyY += 1.1 * r;
    if (sq > 0) bodyY = (y + 0.05) * sq + bodyY * (1 - sq);
    vis.root.position.set(x, bodyY, z);
    vis.root.rotation.y = -angle + (isStunned && sq <= 0.4 ? Math.sin(now / 50) * 0.5 : 0);

    // Lean forward on dash/plow/flying, lean back on charge, struggle tilt in water, dazed sway when stunned
    const targetRotZ = sq > 0.4
      ? Math.sin(now / 120) * 0.05
      : isStunned
      ? Math.sin(now / 90) * 0.15
      : isFlying
      ? -0.5
      : isPlowing
      ? -0.4
      : isDashing
      ? -0.25
      : isDrowning
      ? Math.sin(now / 180) * 0.3
      : isWater && vis.species === 'duck'
      ? Math.sin(vis.phase * 0.7) * 0.08
      : isWater && vis.species !== 'duck' && vis.species !== 'dog'
      ? Math.sin(now / 120) * 0.15
      : isCharging
      ? 0.15 + lvl * 0.15
      : 0;

    vis.root.rotation.z += (targetRotZ - vis.root.rotation.z) * Math.min(1, 16 * dt);

    if (isDrowning && sq <= 0.4) {
      // Gentle side-to-side flailing
      vis.root.rotation.x = Math.sin(now / 200) * 0.2;
    } else if (isMud && !isSuper && speed > 0.02 && sq <= 0.4) {
      // Gentle subtle wobble as animal trudges through deep mud
      vis.root.rotation.x = Math.sin(vis.phase * 0.6) * 0.04;
      vis.root.rotation.z += Math.sin(vis.phase * 0.3) * 0.03;
    }

    // Charge trembling wind-up
    if (isCharging) {
      vis.root.position.x += (Math.random() - 0.5) * 0.12 * lvl * r;
      vis.root.position.z += (Math.random() - 0.5) * 0.12 * lvl * r;
    }

    // Squash & stretch & water shrinking
    const squash = isCharging ? 1 - 0.18 * lvl : 1;
    let baseSx = sc * inWaterShrink * (isPlowing ? 1.25 : isDashing ? 1.15 : 1 + 0.1 * lvl);
    let baseSy = sc * inWaterShrink * (isDashing ? 0.9 : squash);
    let baseSz = sc * inWaterShrink;

    if (sq > 0) {
      // Flattened like a pancake by Farmer Till's tractor!
      baseSx *= 1 + 0.55 * sq;
      baseSy *= 1 - 0.90 * sq;
      baseSz *= 1 + 0.55 * sq;
    }

    vis.root.scale.set(baseSx, baseSy, baseSz);

    // Hit knockback tumble (seen in original game when rammed)
    if (vis.hitT && now - vis.hitT < 450 && sq <= 0.4) {
      const hk = Math.sin(((now - vis.hitT) / 450) * Math.PI);
      vis.root.rotation.x = hk * 0.9 * (id % 2 ? 1 : -1);
      vis.root.scale.y *= 1 - 0.3 * hk;
      vis.root.scale.x *= 1 + 0.2 * hk;
      vis.root.position.y += hk * 0.8;
    } else {
      vis.root.rotation.x = 0;
    }

    // Dynamic leg swinging with amplitude 0.7
    vis.legs.forEach((leg, idx) => {
      if (isWater && vis.species === 'dog') {
        leg.visible = false;
        return;
      }
      leg.visible = true;

      if (leg.userData.origY === undefined) {
        leg.userData.origY = leg.position.y;
      }

      const baseSwing = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI) + (idx > 1 ? Math.PI : 0));
      if (sq > 0.4) {
        // Flattened pancake: legs splayed flat horizontally to the sides
        leg.rotation.z = (Math.PI / 2.2) * (idx % 2 === 0 ? 1 : -1);
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      } else if (isDrowning || (isWater && vis.species !== 'duck')) {
        // Slow paddling motion, slowing as it sinks deeper
        const paddleSpeed = Math.max(0.15, 1 - sinkProgress * 0.75);
        leg.rotation.z = baseSwing * 0.4 * paddleSpeed;
        leg.rotation.x = Math.sin(now / 160 + idx * 1.5) * 0.35 * paddleSpeed;
        leg.position.y = leg.userData.origY;
      } else if (isMud && !isSuper) {
        // Toned-down mud wading stride: legs stay firmly under body, zero Y elevation to prevent torso popping
        leg.rotation.z = baseSwing * 0.38;
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      } else if (isStunned) {
        leg.rotation.z = 0;
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      } else {
        leg.rotation.z = baseSwing * 0.7;
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      }
    });

    // Under-foot dark mud patches (prominent black mud pools on ground under each foot)
    if (vis.mudSplats && vis.mudSplats.length > 0) {
      const inMud = isMud && !isSuper;
      const cosA = Math.cos(-angle);
      const sinA = Math.sin(-angle);
      const footR = r * 0.45;

      vis.mudSplats.forEach((splat, idx) => {
        if (!inMud) {
          splat.visible = false;
          return;
        }
        const leg = vis.legs[idx];
        if (!leg) {
          splat.visible = false;
          return;
        }
        const lx = leg.position.x;
        const lz = leg.position.z;
        const fx = x + (lx * cosA - lz * sinA) * sc;
        const fz = z + (lx * sinA + lz * cosA) * sc;
        splat.position.set(fx, smoothBaseY + 0.02, fz);
        const press = 1.0 + 0.15 * Math.sin(vis.phase + idx * 1.5);
        splat.scale.set(footR * press, 1, footR * (2.0 - press));
        splat.visible = true;
      });
    }

    // Stunned spinning stars above head
    if (isStunned || sq > 0.2) {
      if (!vis.stars) {
        vis.stars = new THREE.Group();
        const starGeo = new THREE.OctahedronGeometry(0.22, 0);
        const starMat = new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0x887700, roughness: 0.4 });
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(starGeo, starMat);
          m.position.set(Math.cos(i * 2.1) * 0.8, 0, Math.sin(i * 2.1) * 0.8);
          vis.stars.add(m);
        }
        this.scene.add(vis.stars);
      }
      vis.stars.visible = true;
      const starY = sq > 0.3 ? y + 0.45 : y + sc * 2.3;
      vis.stars.position.set(x, starY, z);
      vis.stars.rotation.y = now / 150;
    } else if (vis.stars) {
      vis.stars.visible = false;
    }

    // Dust particles
    vis.dust -= dt;
    if (vis.dust <= 0) {
      if (isWater && vis.species !== 'duck') {
        vis.dust = 0.32; // 25% less frequent
        this.onPuff?.(x - Math.cos(angle) * r, 0.12, z - Math.sin(angle) * r, 0xbfe3ff, 0.55 * r, 0.5, 0.8);
      } else if (isCharging) {
        vis.dust = 0.06;
        const d = r * (1.6 + lvl);
        const ang = Math.random() * Math.PI * 2;
        this.onPuff?.(x + Math.cos(ang) * d, 0.3, z + Math.sin(ang) * d, lvl >= 1 ? 0xff5a3c : 0xfff3a0, 0.6, 0.35, 1.5);
      } else if (isPlowing) {
        vis.dust = 0.02;
        this.onPuff?.(x - Math.cos(angle) * r + (Math.random() - 0.5) * 0.6, 0.5, z - Math.sin(angle) * r + (Math.random() - 0.5) * 0.6, 0xff5a3c, 1.6, 0.5);
      } else if (flags & FLAG.SONG) {
        vis.dust = 0.08;
        this.onPuff?.(x + (Math.random() - 0.5) * 1.5, sc * 2.2, z + (Math.random() - 0.5) * 1.5, Math.random() < 0.5 ? 0xe8b641 : 0x1f1a17, 0.5, 0.8, 1.5);
      } else if (flags & FLAG.PITCHFORK && Math.random() < 0.4) {
        vis.dust = 0.1;
        this.onPuff?.(x + (Math.random() - 0.5) * r, 0.8 * sc, z + (Math.random() - 0.5) * r, 0xe8b641, 0.35, 0.4, 0.8);
      } else if (flags & FLAG.DYNAMITE && Math.random() < 0.4) {
        vis.dust = 0.1;
        this.onPuff?.(x + (Math.random() - 0.5) * 0.4 * r, sc * 1.8, z + (Math.random() - 0.5) * 0.4 * r, 0xff7043, 0.3, 0.3, 1.2);
      } else if (isDashing || isMud) {
        vis.dust = isDashing ? 0.03 : 0.12;
        const mudColor = Math.random() < 0.5 ? 0x16100c : 0x241a12;
        this.onPuff?.(
          x - Math.cos(angle) * r * 0.85 + (Math.random() - 0.5) * 0.3 * r,
          0.10,
          z - Math.sin(angle) * r * 0.85 + (Math.random() - 0.5) * 0.3 * r,
          isMud ? mudColor : 0xd8c09a,
          isMud ? 1.25 * r : (isDashing ? 1.4 : 0.8),
          0.70
        );
      }
    }

    // Super Rainbow dash trail & powerful sonic shockwave effects
    if (isSuper) {
      // Rainbow ribbon trail trailing behind tail
      if (speed > 0.05 || isDashing || isFlying) {
        vis.rainbowTimer = (vis.rainbowTimer || 0) + dt;
        const interval = isDashing || isFlying ? 0.015 : 0.04;
        if (vis.rainbowTimer >= interval) {
          vis.rainbowTimer = 0;
          this.onRainbowTrail?.(x, bodyY + 0.35, z, angle, r, isDashing || isFlying);
        }
      }
      // Powerful sonic wave shockwave ripples when dashing or flying
      if (isDashing || isFlying) {
        vis.shockwaveTimer = (vis.shockwaveTimer || 0) + dt;
        if (vis.shockwaveTimer >= 0.065) {
          vis.shockwaveTimer = 0;
          const swColor = Math.random() < 0.5 ? 0x64d8cb : 0xe0f7fa;
          this.spawnShockwave(x, y + 0.1, z, r * 1.15, swColor);
          this.onSonicWave?.(x, bodyY + 0.3, z, r);
        }
      }
    }

    // Regalia (crown + cape): visible on King, or on all if Squealer rule active
    const showCrown = (isKing || activeRule === 'squealer') && !isWheel;
    if (vis.regalia) {
      vis.regalia.visible = showCrown;
    }

    // Wheel cart transformation: transforms animal into a continuous driving vehicle
    if (isWheel) {
      vis.body.visible = false;
      vis.flowerHat.visible = false;
      vis.witchHat.visible = false;
      vis.cartGroup.visible = true;
      vis.cartWheels.forEach((w) => {
        w.rotation.z -= dt * 26;
      });
      if (this.onPuff && Math.random() < 0.4) {
        const theme = getArenaTheme();
        const puffColor = theme === 'halloween' ? 0xba68c8 : (theme === 'women_day' ? 0xff80ab : 0x3e2723);
        this.onPuff(
          x - Math.cos(angle) * r * 0.95 + (Math.random() - 0.5) * 0.3 * r,
          sc * 1.4,
          z - Math.sin(angle) * r * 0.95 + (Math.random() - 0.5) * 0.3 * r,
          puffColor,
          0.65 * r,
          0.6,
          2.0
        );
      }
    } else {
      vis.body.visible = true;
      vis.cartGroup.visible = false;
      vis.flowerHat.visible = getArenaTheme() === 'women_day';
      vis.witchHat.visible = getArenaTheme() === 'halloween';
    }

    // Update label matching original game:
    // King: "👑 Name · 45kg" on gold badge
    // Traitor: "⚡ Name · Kẻ phản bội" on red badge
    // Normal: "Name"
    const isTraitor = (flags & FLAG.TRAITOR) !== 0;

    let iconPrefix = '';
    if (flags & FLAG.WHEEL) iconPrefix += '🛞 ';
    if (flags & FLAG.SONG) iconPrefix += '🎵 ';
    if (flags & FLAG.DYNAMITE) iconPrefix += '🧨 ';
    if (flags & FLAG.PITCHFORK) iconPrefix += '🍴 ';

    const isMe = id === this.myId;
    const roundedMass = Math.round(mass / 5) * 5;
    const labelText = showCrown
      ? `${iconPrefix}👑 ${meta.name} · ${roundedMass}kg`
      : isTraitor
      ? `${iconPrefix}⚡ ${meta.name} · ${t('traitor')}`
      : `${iconPrefix}${meta.name}`;

    const labelKey = `${labelText}_${isMe ? '1' : '0'}_${showCrown ? 'c' : ''}_${isTraitor ? 't' : ''}`;
    if (vis.labelKey !== labelKey) {
      if (vis.label) {
        this.scene.remove(vis.label);
        vis.label.material.map?.dispose();
        vis.label.material.dispose();
      }
      vis.label = createLabel(labelText, showCrown, isTraitor, isMe);
      this.scene.add(vis.label);
      vis.labelKey = labelKey;
      vis.isCrowned = showCrown;
    }

    if (vis.label) {
      const isHiddenInWater = isWater && vis.species !== 'duck' && vis.species !== 'dog' && sinkProgress >= 0.85;
      vis.label.visible = !isHiddenInWater;
      if (!isHiddenInWater) {
        const lh = 1.3 + r * 0.25;
        const labelY = (LABEL_Y[vis.species] || 2.1) + 0.6;
        const targetLabelY = sq > 0.3 ? y + 0.65 : y + labelY * sc * inWaterShrink;
        vis.label.position.set(x, targetLabelY, z);
        vis.label.scale.set(lh * vis.label.userData.aspect, lh, 1);
      }
    }

    // Ground indicator ring
    vis.ring.visible = !isWater;
    vis.ring.position.set(x, smoothBaseY + 0.06, z);
    vis.ring.scale.setScalar(sq > 0.3 ? r * (1 + 0.45 * sq) : r);
    if (isWheel) {
      vis.ring.scale.setScalar(r * 1.35);
      vis.ringMat.color.set(0xff5722);
      vis.ringMat.opacity = 0.95;
    } else if (isSuper) {
      vis.ring.scale.setScalar(r * 1.25);
      vis.ringMat.color.setHSL((now / 500) % 1, 1, 0.6);
      vis.ringMat.opacity = 0.9;
    } else if (isCharging) {
      vis.ring.scale.setScalar(r * (1 + 0.6 * lvl));
      vis.ringMat.color.set(lvl >= 1 ? 0xff3b30 : 0xfff3a0);
      vis.ringMat.opacity = 0.5 + Math.sin(now / (lvl >= 1 ? 40 : 90)) * 0.4;
    } else if (isStunned) {
      vis.ringMat.color.set(0x55504a);
      vis.ringMat.opacity = 0.5;
    } else if (isDashing) {
      vis.ring.scale.setScalar(r * 1.25);
      vis.ringMat.color.set(0xff3b30);
      vis.ringMat.opacity = 0.95;
    } else if (isKing) {
      vis.ring.scale.setScalar(r * 1.15);
      vis.ringMat.color.set(0xffc928);
      vis.ringMat.opacity = 0.9;
    } else {
      const ringColor = meta.team !== undefined
        ? (meta.team === 0 ? 0x4fc3f7 : 0xf44336)
        : (SPECIES_RING_COLOR[vis.species] ?? 0xffffff);
      vis.ringMat.color.set(ringColor);
      vis.ringMat.opacity = 0.85;
    }

    // Collar color reflects team (A12 Blue 0x2196f3, WFM Red 0xf44336) or gold for King
    const collarColor = meta.team !== undefined
      ? (meta.team === 0 ? 0x2196f3 : 0xf44336)
      : (SPECIES_RING_COLOR[vis.species] ?? 0xff9800);
    vis.collarMat.color.setHex(isKing ? 0xffc928 : collarColor);

    // Requirement 4: Sunday Meeting Summoning Ring animation (1.5s)
    if (vis.summonRingTimer !== undefined && vis.summonRingTimer > 0) {
      vis.summonRingTimer = Math.max(0, vis.summonRingTimer - dt);
      const prog = vis.summonRingTimer / 1.5; // 1 down to 0
      if (prog <= 0) {
        vis.summonGroup.visible = false;
      } else {
        vis.summonGroup.visible = true;
        vis.summonGroup.position.set(x, smoothBaseY, z);
        const baseSc = r * (1.1 + (1 - prog) * 0.35);
        vis.summonGroup.scale.set(baseSc, 1, baseSc);

        // Rotation of magic rings
        vis.summonOuter.rotation.z = now * 0.003;
        vis.summonInner.rotation.z = -now * 0.005;

        // Pulsing glowing opacity
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.012);
        vis.summonOuterMat.opacity = Math.min(1, prog * 1.2) * pulse * 0.95;
        vis.summonInnerMat.opacity = Math.min(1, prog * 1.2) * (1.3 - pulse) * 0.9;
        vis.summonBeamMat.opacity = Math.min(1, prog * 1.4) * pulse * 0.45;
      }
    } else {
      vis.summonGroup.visible = false;
    }
  }

  setTheme(theme: ArenaTheme): void {
    const isWomenDay = theme === 'women_day';
    const isHalloween = theme === 'halloween';
    for (const vis of this.visuals.values()) {
      vis.flowerHat.visible = isWomenDay;
      vis.witchHat.visible = isHalloween;
      vis.cartThemeGroups.classic.visible = theme === 'classic';
      vis.cartThemeGroups.womenDay.visible = isWomenDay;
      vis.cartThemeGroups.halloween.visible = isHalloween;
    }
  }

  private buildAnimal(meta: PlayerMeta, isMe = false): AnimalVisual {
    const { root, body, legs, collarMat, flowerHat, witchHat, cartGroup, cartThemeGroups, cartWheels } = buildFullAnimal(meta.species, meta.skin, meta.team);

    // Add King regalia (crown + cape)
    const regalia = buildRegalia(meta.species);
    regalia.visible = false;
    root.add(regalia);

    // Add floating name label
    const label = createLabel(meta.name, false, false, isMe);
    this.scene.add(label);

    // Add ground indicator ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: meta.team !== undefined
        ? (meta.team === 0 ? 0x4fc3f7 : 0xf44336)
        : (SPECIES_RING_COLOR[meta.species] ?? 0xffffff),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(ring);

    // Large dark mud patches under each foot (visible when wading through mud, shared static resources)
    const mudSplats: THREE.Mesh[] = [];
    for (let i = 0; i < legs.length; i++) {
      const splat = new THREE.Mesh(mudSplatGeo, sharedMudSplatMat);
      splat.visible = false;
      splat.renderOrder = 2; // Flat on ground, below animal ring
      this.scene.add(splat);
      mudSplats.push(splat);
    }

    // Summoning light circle for Sunday Meeting rule (1.5s visual)
    const summonGroup = new THREE.Group();
    summonGroup.visible = false;

    const summonOuterMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const summonOuter = new THREE.Mesh(summonOuterGeo, summonOuterMat);
    summonOuter.position.y = 0.08;
    summonGroup.add(summonOuter);

    const summonInnerMat = new THREE.MeshBasicMaterial({
      color: 0x40c4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const summonInner = new THREE.Mesh(summonInnerGeo, summonInnerMat);
    summonInner.position.y = 0.09;
    summonGroup.add(summonInner);

    const summonBeamMat = new THREE.MeshBasicMaterial({
      color: 0xfff59d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const summonBeam = new THREE.Mesh(summonBeamGeo, summonBeamMat);
    summonBeam.position.y = 1.9;
    summonGroup.add(summonBeam);

    this.scene.add(summonGroup);

    return {
      root,
      body,
      legs,
      species: meta.species,
      skin: meta.skin,
      label,
      labelKey: meta.name,
      regalia,
      flowerHat,
      witchHat,
      isCrowned: false,
      ring,
      ringMat,
      collarMat,
      stars: null,
      phase: 0,
      lastX: 0,
      lastZ: 0,
      hitT: 0,
      dust: 0,
      rainbow: null,
      wasSuper: false,
      shockwaveTimer: 0,
      rainbowTimer: 0,
      mudSplats,
      mudSplatMat: sharedMudSplatMat,
      cartGroup,
      cartThemeGroups,
      cartWheels,
      summonRingTimer: 0,
      summonGroup,
      summonOuter,
      summonInner,
      summonBeam,
      summonOuterMat,
      summonInnerMat,
      summonBeamMat,
    };
  }
}

export function buildFullAnimal(species: Species, skinIdx: number, team?: number): {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  collarMat: THREE.MeshStandardMaterial;
  flowerHat: THREE.Group;
  witchHat: THREE.Group;
  cartGroup: THREE.Group;
  cartThemeGroups: {
    classic: THREE.Group;
    womenDay: THREE.Group;
    halloween: THREE.Group;
  };
  cartWheels: THREE.Mesh[];
} {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skinList = SKINS[species] || SKINS.chicken;
  const skin = skinList[skinIdx % skinList.length];
  const builder = BUILDERS[species] || BUILDERS.chicken;
  const legs = builder(body, skin);

  // Add team collar around neck
  const collarColor = team !== undefined
    ? (team === 0 ? 0x2196f3 : 0xf44336)
    : (SPECIES_RING_COLOR[species] ?? 0xff9800);
  const collarMat = new THREE.MeshStandardMaterial({
    color: collarColor,
    roughness: 0.45,
    metalness: 0.15,
  });
  body.add(buildCollar(species, collarMat));

  // 20/10 Flower Hat accessory
  const flowerHat = buildFlowerHat(species);
  flowerHat.name = 'flowerHat';
  flowerHat.visible = getArenaTheme() === 'women_day';
  root.add(flowerHat);

  // 31/10 Witch Hat accessory
  const witchHat = buildWitchHat(species);
  witchHat.name = 'witchHat';
  witchHat.visible = getArenaTheme() === 'halloween';
  root.add(witchHat);

  // Wheel cart vehicle model (attached to root, visible when FLAG.WHEEL active)
  const { cartGroup, cartThemeGroups, cartWheels } = buildCartVisual(getArenaTheme());
  cartGroup.name = 'cartGroup';
  root.add(cartGroup);

  return { root, body, legs, collarMat, flowerHat, witchHat, cartGroup, cartThemeGroups, cartWheels };
}

export function buildCorpseAnimal(species: Species, skinIdx: number, crowned = false, team?: number): { group: THREE.Group; regalia: THREE.Group | null } {
  const { root } = buildFullAnimal(species, skinIdx, team);
  const regalia = buildRegalia(species);
  regalia.visible = crowned;
  root.add(regalia);

  return { group: root, regalia };
}

export { SKINS, BUILDERS, SPECIES_RING_COLOR };

