import * as THREE from 'three';
import { CFG, radiusOf, type Species } from '@shared/constants';
import { FLAG, type PlayerMeta } from '@shared/protocol';
import { t } from '../i18n';

interface AnimalVisual {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  species: Species;
  skin: number;
  label: THREE.Sprite | null;
  labelKey: string;
  regalia: THREE.Group | null;
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

const SPECIES_RING_COLOR: Record<Species, number> = {
  chicken: 0xffb74d,
  sheep: 0xf3f1ea,
  horse: 0x8b5a2b,
  cow: 0x4fc3f7,
  duck: 0xffd54f,
  pig: 0xf48fb1,
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

const BUILDERS: Record<Species, (g: THREE.Group, s: Record<string, number>) => THREE.Group[]> = {
  chicken: buildChicken,
  sheep: buildSheep,
  horse: buildHorse,
  cow: buildCow,
  duck: buildDuck,
  pig: buildPig,
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
};

// Back of each species for the cape
const BACK: Record<Species, [number, number, number, number, number]> = {
  chicken: [-0.2, 0.95, 0.6, 0.6, 0.95],
  sheep: [-0.15, 1.15, 0.9, 0.75, 1.1],
  horse: [-0.2, 1.4, 0.36, 0.4, 1.2],
  cow: [-0.15, 1.2, 0.47, 0.45, 1.2],
  duck: [-0.2, 0.85, 0.56, 0.53, 0.95],
  pig: [-0.25, 1.0, 0.77, 0.77, 1.3],
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

// Height where name label floats for each species
const LABEL_Y: Record<Species, number> = {
  chicken: 2.3,
  sheep: 1.9,
  horse: 2.8,
  cow: 2.2,
  duck: 2.0,
  pig: 2.1,
};

function createLabel(text: string, crowned = false, traitor = false): THREE.Sprite {
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
    ctx.strokeStyle = 'rgba(31, 26, 23, 0.75)';
    ctx.strokeText(text, w / 2, 30);
    ctx.fillStyle = '#f2ead7';
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

export class AnimalRenderer {
  private readonly visuals = new Map<number, AnimalVisual>();
  private readonly group = new THREE.Group();
  private readonly shockwavePool: ShockwaveRing[] = [];

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

  getVisual(id: number, meta?: PlayerMeta): AnimalVisual | undefined {
    let vis = this.visuals.get(id);
    if (!vis && meta) {
      vis = this.buildAnimal(meta);
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
      this.group.remove(vis.root);
      this.scene.remove(vis.ring);
    }
    this.visuals.clear();
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
    const lvl = (charge || 0) / 10;

    setRainbow(vis, isSuper, now);

    // Continuous walking / dashing leg phase accumulation
    vis.phase += dt * (isDashing ? 26 : 8 + Math.min(10, speed * 12));
    const r = radiusOf(mass);
    const sc = r * 1.35 * (isKing ? 1.2 : 1) * (isSuper ? 1.15 : 1);

    const podX = podiumPos ? podiumPos[0] : 0;
    const podZ = podiumPos ? podiumPos[1] : 0;
    const onPodium = Math.hypot(x - podX, z - podZ) < CFG.PODIUM_R;
    let y = onPodium ? 0.55 : 0;

    if (isWater && !isSuper) {
      vis.waterT = Math.min(3.0, (vis.waterT || 0) + dt);
    } else {
      vis.waterT = Math.max(0, (vis.waterT || 0) - dt * 3.5);
    }

    // Maximum water duration is 1.5s
    const sinkProgress = Math.min(1, (vis.waterT || 0) / 1.5);

    // Visual sinking effect reduced by 20%
    const inWaterShrink = isWater && !isSuper && vis.species !== 'duck'
      ? Math.max(0.68, 1 - sinkProgress * 0.32)
      : 1;

    if (isWater && !isSuper) {
      if (vis.species === 'duck') {
        // Ducks float peacefully on the surface with slight bobbing
        y = -0.25 * sc + Math.sin(now / 300) * 0.05;
      } else {
        // Visual sinking speed reduced by 20% over the 1.5s duration
        const sinkDepth = 0.30 + Math.pow(sinkProgress, 1.3) * 1.32;
        const sinkY = -sinkDepth * sc;
        const rippleBob = Math.sin(now / 160) * 0.05 * (1 - sinkProgress);
        y = sinkY + (sinkProgress < 0.95 ? rippleBob : 0);

        // Water bubble puffs floating up from underwater while sinking
        if (this.onPuff && Math.random() < 0.22) {
          this.onPuff(
            x + (Math.random() - 0.5) * 0.7 * r,
            0.1,
            z + (Math.random() - 0.5) * 0.7 * r,
            0xdff1ff,
            0.55,
            0.65,
            2.0
          );
        }
      }
    }

    // Body hopping & positioning
    let bodyY = y + (isWater && !isSuper ? 0 : Math.abs(Math.sin(vis.phase)) * 0.1 * r);
    if (isFlying) bodyY += 1.1 * r;
    vis.root.position.set(x, bodyY, z);
    vis.root.rotation.y = -angle + (isStunned ? Math.sin(now / 50) * 0.5 : 0);

    // Lean forward on dash/plow/flying, lean back on charge, struggle tilt in water, dazed sway when stunned
    vis.root.rotation.z = isStunned
      ? Math.sin(now / 90) * 0.15
      : isFlying
      ? -0.5
      : isPlowing
      ? -0.4
      : isDashing
      ? -0.25
      : isDrowning
      ? Math.sin(now / 180) * 0.3
      : isWater && vis.species !== 'duck'
      ? Math.sin(now / 120) * 0.15
      : isCharging
      ? 0.15 + lvl * 0.15
      : 0;

    if (isDrowning) {
      // Gentle side-to-side flailing
      vis.root.rotation.x = Math.sin(now / 200) * 0.2;
    }

    // Charge trembling wind-up
    if (isCharging) {
      vis.root.position.x += (Math.random() - 0.5) * 0.12 * lvl * r;
      vis.root.position.z += (Math.random() - 0.5) * 0.12 * lvl * r;
    }

    // Squash & stretch & water shrinking
    const squash = isCharging ? 1 - 0.18 * lvl : 1;
    vis.root.scale.set(
      sc * inWaterShrink * (isPlowing ? 1.25 : isDashing ? 1.15 : 1 + 0.1 * lvl),
      sc * inWaterShrink * (isDashing ? 0.9 : squash),
      sc * inWaterShrink
    );

    // Hit knockback tumble (seen in original game when rammed)
    if (vis.hitT && now - vis.hitT < 450) {
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
      const baseSwing = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI) + (idx > 1 ? Math.PI : 0));
      if (isDrowning || (isWater && vis.species !== 'duck')) {
        // Slow paddling motion, slowing as it sinks deeper
        const paddleSpeed = Math.max(0.15, 1 - sinkProgress * 0.75);
        leg.rotation.z = baseSwing * 0.4 * paddleSpeed;
        leg.rotation.x = Math.sin(now / 160 + idx * 1.5) * 0.35 * paddleSpeed;
      } else if (isStunned) {
        leg.rotation.z = 0;
        leg.rotation.x = 0;
      } else {
        leg.rotation.z = baseSwing * 0.7;
        leg.rotation.x = 0;
      }
    });

    // Stunned spinning stars above head
    if (isStunned) {
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
      vis.stars.position.set(x, y + sc * 2.3, z);
      vis.stars.rotation.y = now / 150;
    } else if (vis.stars) {
      vis.stars.visible = false;
    }

    // Dust particles
    vis.dust -= dt;
    if (vis.dust <= 0) {
      if (isWater && vis.species !== 'duck') {
        vis.dust = 0.25;
        this.onPuff?.(x - Math.cos(angle) * r, 0.15, z - Math.sin(angle) * r, 0xbfe3ff, 0.8, 0.6, 1);
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
        vis.dust = isDashing ? 0.03 : 0.15;
        this.onPuff?.(x - Math.cos(angle) * r, 0.4, z - Math.sin(angle) * r, isMud ? 0x6b4a2b : 0xd8c09a, isDashing ? 1.4 : 0.8, 0.6);
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
    const showCrown = isKing || activeRule === 'squealer';
    if (vis.regalia) {
      vis.regalia.visible = showCrown;
    }

    // Update label matching original game:
    // King: "👑 Name · 45kg" on gold badge
    // Traitor: "⚡ Name · Kẻ phản bội" on red badge
    // Normal: "Name"
    const isTraitor = (flags & FLAG.TRAITOR) !== 0;

    let iconPrefix = '';
    if (flags & FLAG.SONG) iconPrefix += '🎵 ';
    if (flags & FLAG.DYNAMITE) iconPrefix += '🧨 ';
    if (flags & FLAG.PITCHFORK) iconPrefix += '🍴 ';

    const roundedMass = Math.round(mass / 5) * 5;
    const labelText = showCrown
      ? `${iconPrefix}👑 ${meta.name} · ${roundedMass}kg`
      : isTraitor
      ? `${iconPrefix}⚡ ${meta.name} · ${t('traitor')}`
      : `${iconPrefix}${meta.name}`;

    if (vis.labelKey !== labelText) {
      if (vis.label) {
        this.scene.remove(vis.label);
        vis.label.material.map?.dispose();
        vis.label.material.dispose();
      }
      vis.label = createLabel(labelText, showCrown, isTraitor);
      this.scene.add(vis.label);
      vis.labelKey = labelText;
      vis.isCrowned = showCrown;
    }

    if (vis.label) {
      const isHiddenInWater = isWater && vis.species !== 'duck' && sinkProgress >= 0.85;
      vis.label.visible = !isHiddenInWater;
      if (!isHiddenInWater) {
        const lh = 1.3 + r * 0.25;
        const labelY = (LABEL_Y[vis.species] || 2.1) + 0.6;
        vis.label.position.set(x, y + labelY * sc * inWaterShrink, z);
        vis.label.scale.set(lh * vis.label.userData.aspect, lh, 1);
      }
    }

    // Ground indicator ring
    vis.ring.visible = !isWater;
    vis.ring.position.set(x, onPodium ? 0.6 : 0.06, z);
    vis.ring.scale.setScalar(r);
    if (isSuper) {
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
  }

  private buildAnimal(meta: PlayerMeta): AnimalVisual {
    const { root, body, legs, collarMat } = buildFullAnimal(meta.species, meta.skin, meta.team);

    // Add King regalia (crown + cape)
    const regalia = buildRegalia(meta.species);
    regalia.visible = false;
    root.add(regalia);

    // Add floating name label
    const label = createLabel(meta.name, false, false);
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

    return {
      root,
      body,
      legs,
      species: meta.species,
      skin: meta.skin,
      label,
      labelKey: meta.name,
      regalia,
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
    };
  }
}

export function buildFullAnimal(species: Species, skinIdx: number, team?: number): {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  collarMat: THREE.MeshStandardMaterial;
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

  return { root, body, legs, collarMat };
}

export function buildCorpseAnimal(species: Species, skinIdx: number, crowned = false, team?: number): { group: THREE.Group; regalia: THREE.Group | null } {
  const { root } = buildFullAnimal(species, skinIdx, team);
  const regalia = buildRegalia(species);
  regalia.visible = crowned;
  root.add(regalia);

  return { group: root, regalia };
}

export { SKINS, BUILDERS, SPECIES_RING_COLOR };

