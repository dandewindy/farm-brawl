import * as THREE from 'three';
import { CFG, radiusOf, type Species, isEvolvedSpecies } from '@shared/constants';
import { FLAG, type PlayerMeta } from '@shared/protocol';
import { t } from '../i18n';
import { getArenaTheme, type ArenaTheme } from '../theme';
import { sfxEvolveFanfare, computeSpatialVolume } from '../audio/sfx';

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
  wasWheel?: boolean;
  wasKing?: boolean;
  trailX?: number;
  trailZ?: number;
  shockwaveTimer?: number;
  rainbowTimer?: number;
  waterT?: number;
  squishFactor?: number;
  visualY?: number;
  waterRippleTimer?: number;
  arms?: THREE.Group[];
  tailSegments?: (THREE.Mesh | THREE.Group)[];
  trunk?: THREE.Group;
  head?: THREE.Group;
  wings?: THREE.Group[];
  shieldAura?: THREE.Mesh;
  heartAura?: THREE.Group;
  windWhirlMesh?: THREE.Group;
  windTrailTimer?: number;
  leapTimer?: number;
  leapDur?: number;
  leapHeight?: number;
  leapDone?: boolean;
  leapActive?: boolean;
  lastLeapStart?: number;
  morphTimer?: number;
  throwTimer?: number;
  wolfBiteTimer?: number;
  bullSmokeTimer?: number;
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
  summonTotalDur?: number;
  summonGroup: THREE.Group;
  summonOuter: THREE.Mesh;
  summonInner: THREE.Mesh;
  summonBeam: THREE.Mesh;
  summonRisingRing: THREE.Mesh;
  summonRisingRingOuter: THREE.Mesh;
  summonOuterMat: THREE.MeshBasicMaterial;
  summonInnerMat: THREE.MeshBasicMaterial;
  summonBeamMat: THREE.MeshBasicMaterial;
  summonRisingMat: THREE.MeshBasicMaterial;
  summonRisingOuterMat: THREE.MeshBasicMaterial;
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

const summonRisingRingGeo = new THREE.TorusGeometry(1.35, 0.08, 12, 36);
summonRisingRingGeo.rotateX(Math.PI / 2);

const summonRisingRingOuterGeo = new THREE.TorusGeometry(1.48, 0.035, 8, 36);
summonRisingRingOuterGeo.rotateX(Math.PI / 2);

const SPECIES_RING_COLOR: Record<Species, number> = {
  chicken: 0xffb74d,
  sheep: 0xf3f1ea,
  horse: 0x8b5a2b,
  cow: 0x4fc3f7,
  duck: 0xffd54f,
  pig: 0xf48fb1,
  dog: 0xffa726,
  elephant: 0x90a4ae,
  monkey: 0x8d5b38,
  gorilla: 0xff6d00,
  mammoth: 0x8d6e63,
  wolf: 0x78909c,
  phoenix: 0xff3d00,
  swan: 0x80deea,
  ram: 0x8d6e63,
  boar: 0xd84315,
  pegasus: 0xffd700,
  bull: 0xff3d00,
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
  monkey: [
    { fur: 0x6e472b, skin: 0xf3cfb3, dark: 0x1a1412 },
    { fur: 0x362b28, skin: 0xd9c2b0, dark: 0x120f0e },
    { fur: 0xd4a373, skin: 0xffe5d9, dark: 0x2e1c0c },
    { fur: 0x934b28, skin: 0xf6d5c2, dark: 0x1c120c },
  ],
  gorilla: [
    { body: 0x34373d, chest: 0x78604d, face: 0x8a705a, crest: 0x222428, silver: 0x686d75 }, // Low-Poly Classic Bronze & Charcoal
    { body: 0x242528, chest: 0x5a554e, face: 0x7a746d, crest: 0x18191b, silver: 0x787d86 }, // Silverback Alpha
    { body: 0x3e2f28, chest: 0x8a634e, face: 0x9a755e, crest: 0x2c201a, silver: 0x6e5e54 }, // Mountain Bronze
    { body: 0x1b1c1e, chest: 0x3e4046, face: 0x63666d, crest: 0x111214, silver: 0x54575f }, // Dark Obsidian
  ],
  mammoth: [
    { body: 0x5a3d28, hump: 0x432815, skirt: 0x4a2e1c, tusk: 0xfcf7eb, innerEar: 0x7a4d33, toenails: 0xd4c8b8, tuft: 0x381f11 }, // Classic Warm Woolly Brown
    { body: 0xedeae4, hump: 0xdcd8cf, skirt: 0xe2dfd8, tusk: 0xfffcf5, innerEar: 0xdec4c4, toenails: 0xe8e2d8, tuft: 0xbab4aa }, // Arctic Snow Mammoth
    { body: 0x422616, hump: 0x2e170c, skirt: 0x361c0f, tusk: 0xfaeed2, innerEar: 0x54321d, toenails: 0xa8998a, tuft: 0x221107 }, // Dark Earth Mammoth
    { body: 0x8c5b36, hump: 0x6e4221, skirt: 0x7a4b29, tusk: 0xfdf5e2, innerEar: 0x9e6d4c, toenails: 0xd0c0a8, tuft: 0x522f16 }, // Golden Tawny Mammoth
  ],
  wolf: [
    { body: 0x546e7a, mane: 0x263238, chest: 0xcfd8dc, snout: 0xb0bec5, ear: 0x37474f, innerEar: 0x90a4ae, eye: 0xffca28, legs: 0x455a64, paws: 0xcfd8dc, tailTip: 0x1c262b }, // Sói Xám Bắc Cực (Timber Wolf)
    { body: 0x212529, mane: 0x111315, chest: 0x495057, snout: 0x343a40, ear: 0x16191d, innerEar: 0x6c757d, eye: 0xff3d00, legs: 0x1b1e22, paws: 0x343a40, tailTip: 0x0b0d0e }, // Sói Đen Hắc Ám (Dire Black Wolf)
    { body: 0xeceff1, mane: 0xb0bec5, chest: 0xffffff, snout: 0xfafafa, ear: 0xcfd8dc, innerEar: 0xf8bbd0, eye: 0x00e5ff, legs: 0xdce1e5, paws: 0xffffff, tailTip: 0x90a4ae }, // Sói Trắng Tuyết (Arctic White Wolf)
    { body: 0x7f3822, mane: 0x3e190e, chest: 0xd7ccc8, snout: 0xbcaaa4, ear: 0x4e2012, innerEar: 0xa1887f, eye: 0xffab00, legs: 0x5d2716, paws: 0xd7ccc8, tailTip: 0x271008 }, // Sói Đỏ Huyết Nguyệt (Blood Moon Wolf)
  ],
  phoenix: [
    { body: 0xff3d00, wing: 0xff9100, chest: 0xffea00, tail: 0xd50000, crest: 0xffd600, beak: 0xffab00 }, // Kim Kê Thần (Lửa đỏ vàng)
    { body: 0x00e5ff, wing: 0x80d8ff, chest: 0xe0f7fa, tail: 0x0091ea, crest: 0x00b0ff, beak: 0xffd54f }, // Băng Phượng Tuyết Sơn
    { body: 0x212121, wing: 0x424242, chest: 0x757575, tail: 0xb71c1c, crest: 0xd50000, beak: 0xffa000 }, // Hắc Hỏa Dạ Điểu
    { body: 0xaa00ff, wing: 0xe040fb, chest: 0xf3e5f5, tail: 0x6200ea, crest: 0x00e5ff, beak: 0xffd700 }, // Tử Quang Thiên Điểu
  ],
  swan: [
    { body: 0xffffff, neck: 0xfafafa, wing: 0xf5f5f5, bill: 0xff6d00, knob: 0x212121, crown: 0xffd700 }, // Bạch Nga Hoàng Gia
    { body: 0x212121, neck: 0x1a1a1a, wing: 0x37474f, bill: 0xd50000, knob: 0x000000, crown: 0xc0c0c0 }, // Hắc Nga Huyền Bí
    { body: 0xe0f7fa, neck: 0xb2ebf2, wing: 0x80deea, bill: 0x00b0ff, knob: 0x006064, crown: 0x00e5ff }, // Băng Tuyết Bắc Cực
    { body: 0xf8bbd0, neck: 0xf48fb1, wing: 0xf06292, bill: 0xffab00, knob: 0x880e4f, crown: 0xffd54f }, // Hồng Hạc Ánh Dương
  ],
  ram: [
    { wool: 0xd7ccc8, face: 0x4e342e, horn: 0x3e2723, hornRing: 0x8d6e63, legs: 0x3e2723 }, // Sơn Dương Thiết Giáp
    { wool: 0x263238, face: 0x1a237e, horn: 0xffd700, hornRing: 0xffa000, legs: 0x212121 }, // Hắc Sơn Dương Thạch
    { wool: 0xffffff, face: 0x90a4ae, horn: 0xb0bec5, hornRing: 0xcfd8dc, legs: 0x78909c }, // Tuyết Dương Đỉnh Núi
    { wool: 0xffecb3, face: 0xff8f00, horn: 0xc62828, hornRing: 0xe53935, legs: 0xb26a00 }, // Kim Dương Thần Thoại
  ],
  boar: [
    { body: 0x4e342e, crest: 0x271c19, snout: 0x795548, tusk: 0xf5f5f5, belly: 0x6d4c41, legs: 0x271c19 }, // Heo Rừng Rậm Chiến Tướng
    { body: 0x212121, crest: 0x000000, snout: 0x424242, tusk: 0xb0bec5, belly: 0x37474f, legs: 0x1b1b1b }, // Hắc Nanh Độc Giác
    { body: 0xd84315, crest: 0xbf360c, snout: 0xff7043, tusk: 0xffd700, belly: 0xff8a65, legs: 0x870000 }, // Lôi Đình Bão Bùn
    { body: 0xefebe9, crest: 0xbcaaa4, snout: 0xd7ccc8, tusk: 0x80deea, belly: 0xffffff, legs: 0x8d6e63 }, // Bạch Nanh Tuyết Sơn
  ],
  pegasus: [
    { body: 0xffffff, wing: 0xffffff, mane: 0xffd700, hoof: 0xffd700, eye: 0x00b0ff, featherTip: 0xfff59d }, // Bạch Mã Thiên Thần
    { body: 0x1a1a24, wing: 0x2c2c3d, mane: 0xaa00ff, hoof: 0x7c4dff, eye: 0xff1744, featherTip: 0xe040fb }, // Dạ Mã Hắc Ám
    { body: 0xe1f5fe, wing: 0xb3e5fc, mane: 0x00b0ff, hoof: 0x0091ea, eye: 0x00e5ff, featherTip: 0x80d8ff }, // Băng Thiên Tinh Vân
    { body: 0xb71c1c, wing: 0xd32f2f, mane: 0xffab00, hoof: 0xff6d00, eye: 0xffea00, featherTip: 0xffd600 }, // Xích Huyết Thần Mã
  ],
  bull: [
    { body: 0x1b1c1e, shoulder: 0x111213, horn: 0xffd700, snout: 0x3e2723, ring: 0xffd700, eye: 0xff3d00 }, // Ngưu Vương Đấu Trường
    { body: 0x871010, shoulder: 0x5b0808, horn: 0xf5f5f5, snout: 0x3e1818, ring: 0xffab00, eye: 0xffea00 }, // Bò Tót Đỏ Lửa
    { body: 0x455a64, shoulder: 0x263238, horn: 0x1a1a1a, snout: 0x37474f, ring: 0xc0c0c0, eye: 0x00e5ff }, // Thiết Ngưu Giáp Đá
    { body: 0x6d4c41, shoulder: 0x4e342e, horn: 0x00e676, snout: 0x8d6e63, ring: 0xffd700, eye: 0xffd600 }, // Kim Ngưu Hoàng Gia
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
function addLegs(g: THREE.Group, color: number, pts: [number, number][], len: number, rad: number, hoofColor?: number, opts?: Partial<THREE.MeshStandardMaterialParameters>): THREE.Group[] {
  const arr: THREE.Group[] = [];
  for (const [x, z] of pts) {
    const pivot = new THREE.Group();
    pivot.position.set(x, len, z);
    pivot.userData.origY = len;
    const legMesh = part(new THREE.CapsuleGeometry(rad, Math.max(0.01, len - rad * 2), 4, 10), color, 0, -len / 2, 0, opts, true);
    pivot.add(legMesh);
    if (hoofColor !== undefined) {
      const hoof = part(new THREE.CylinderGeometry(rad * 1.06, rad * 1.12, rad * 1.1, 12), hoofColor, 0, -len + rad * 0.55, 0, opts, true);
      pivot.add(hoof);
    }
    g.add(pivot);
    arr.push(pivot);
  }
  return arr;
}

// Bàn chân màng dẹt bơi lội đặc trưng của Vịt và Thiên Nga (flat webbed duck paddle foot)
function addDuckWebbedFeet(pivots: THREE.Group[], len: number, footColor: number): void {
  for (const pivot of pivots) {
    const footGroup = new THREE.Group();
    footGroup.position.set(0.08, -len + 0.02, 0);

    // Màng chân chính hình quạt dẹt vươn ra trước
    const paddleGeo = new THREE.CylinderGeometry(0.14, 0.06, 0.028, 5);
    paddleGeo.rotateX(Math.PI / 2);
    paddleGeo.rotateY(Math.PI / 2);
    const paddle = part(paddleGeo, footColor, 0.04, 0, 0);
    paddle.scale.set(1.45, 0.85, 1.35);
    footGroup.add(paddle);

    // 3 khía ngón màng chân vịt
    for (const a of [-0.075, 0, 0.075]) {
      const webToe = part(new THREE.BoxGeometry(0.12, 0.024, 0.038), footColor, 0.11, 0, a);
      footGroup.add(webToe);
    }
    pivot.add(footGroup);
  }
}

// Bàn chân gà & phượng hoàng có 3 móng vuốt xòe ra trước và 1 cựa sau bám đất
function addChickenClawFeet(pivots: THREE.Group[], len: number, clawColor: number): void {
  for (const pivot of pivots) {
    const footGroup = new THREE.Group();
    footGroup.position.set(0, -len + 0.025, 0);

    // 3 móng vuốt trước xòe góc nhọn bám đất
    for (const a of [-0.32, 0, 0.32]) {
      const toe = part(new THREE.ConeGeometry(0.032, 0.18, 5), clawColor, 0.09, 0, a * 0.12);
      toe.rotation.z = -Math.PI / 2;
      toe.rotation.y = a * 0.65;
      footGroup.add(toe);
    }
    // 1 cựa phía sau giữ thăng bằng
    const spur = part(new THREE.ConeGeometry(0.032, 0.13, 5), clawColor, -0.07, 0.015, 0);
    spur.rotation.z = Math.PI / 2;
    footGroup.add(spur);

    pivot.add(footGroup);
  }
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
  const chickenLegs = addLegs(g, 0xffa41b, [[0, 0.2], [0, -0.2]], 0.5, 0.06);
  addChickenClawFeet(chickenLegs, 0.5, 0xff9100);
  return chickenLegs;
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
  // Thân ngựa tuấn mã cơ bắp thanh thoát (y=1.32 để tỷ lệ chân và thân liền khối hoàn hảo)
  const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.85, 8, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, s.body, 0, 1.32, 0, undefined, true);
  bodyMesh.scale.set(1.0, 1.08, 0.92);
  g.add(bodyMesh);

  // Khối ức và bả vai trước nở nang (muscular chest & withers)
  blob(g, s.body, 0.32, [1.15, 1.05, 0.95], 0.38, 1.38, 0);
  // Khối mông và đùi sau tròn đầy (muscular rump / croup)
  blob(g, s.body, 0.34, [1.10, 1.05, 0.92], -0.38, 1.35, 0);

  // Khớp háng tĩnh bao bọc thân (thigh sockets ôm sát quanh 4 điểm pivot)
  for (const [hx, hz] of [[0.48, 0.22], [0.48, -0.22], [-0.48, 0.22], [-0.48, -0.22]]) {
    const socket = part(new THREE.SphereGeometry(0.18, 8, 8), s.body, hx, 1.25, hz);
    socket.scale.set(0.95, 1.25, 0.95);
    g.add(socket);
  }

  // Cổ ngựa tuấn tú vươn cao (arched athletic neck)
  const neckGeo = new THREE.CapsuleGeometry(0.17, 0.58, 8, 12);
  const neck = part(neckGeo, s.body, 0.70, 1.80, 0);
  neck.rotation.z = -0.52;
  g.add(neck);

  // Đầu ngựa tuấn mã thon gọn (streamlined noble head)
  const headGeo = new THREE.CapsuleGeometry(0.15, 0.42, 8, 12);
  headGeo.rotateZ(Math.PI / 2);
  const head = part(headGeo, s.body, 1.10, 2.18, 0);
  head.rotation.z = -0.26;
  g.add(head);

  // Mũi và lỗ mũi ngựa
  blob(g, s.mane ?? 0x2b1a0e, 0.08, [1.2, 0.8, 1.0], 1.32, 2.12, 0);
  for (const nz of [-0.06, 0.06]) {
    blob(g, 0x1a120c, 0.035, [1, 1, 1], 1.35, 2.14, nz);
  }

  // BỜM NGỰA LIỀN MẠCH HOÀN HẢO: Quét từ gáy qua đỉnh đầu giữa 2 tai và phủ xuống trước trán
  // 1. Dải bờm cổ uốn lượn dọc sống cổ
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const mx = 0.42 + t * 0.44;
    const my = 1.62 + t * 0.56;
    const mSize = 0.14 - t * 0.015;
    blob(g, s.mane, mSize, [1.35, 0.50, 0.28], mx, my, 0, [0, 0, -0.58]);
  }
  // 2. Bờm đỉnh đầu quét qua giữa 2 tai (poll mane nối liền mạch)
  const pollMane = part(new THREE.CapsuleGeometry(0.08, 0.32, 6, 8), s.mane, 0.96, 2.38, 0);
  pollMane.rotation.z = -0.35;
  g.add(pollMane);
  // 3. Bờm trán (forelock) vươn dài rủ xuống trước trán giữa 2 mắt
  const forelock = part(new THREE.ConeGeometry(0.08, 0.36, 6), s.mane, 1.20, 2.32, 0);
  forelock.rotation.z = -1.22;
  g.add(forelock);
  for (const z of [-0.05, 0.05]) {
    const lock = part(new THREE.ConeGeometry(0.055, 0.28, 5), s.mane, 1.22, 2.26, z);
    lock.rotation.z = -1.30;
    lock.rotation.x = z * 1.6;
    g.add(lock);
  }

  // Đuôi ngựa dài buông lơi duyên dáng (flowing mane tail)
  blob(g, s.mane, 0.16, [1.1, 3.2, 0.8], -0.84, 1.18, 0, [0, 0, -0.38]);
  blob(g, s.mane, 0.12, [0.9, 2.4, 0.6], -0.92, 1.05, 0.05, [0.12, 0, -0.42]);
  blob(g, s.mane, 0.12, [0.9, 2.4, 0.6], -0.92, 1.05, -0.05, [-0.12, 0, -0.42]);

  // Đôi tai tuấn mã nhọn vểnh
  for (const z of [-0.10, 0.10]) {
    const ear = part(new THREE.ConeGeometry(0.06, 0.22, 8), s.body, 0.95, 2.46, z);
    ear.rotation.z = -0.20;
    ear.rotation.x = z > 0 ? 0.22 : -0.22;
    g.add(ear);
  }
  addEyes(g, 1.20, 2.28, 0.17, 0.075);

  // 4 CHÂN NGỰA: PIVOT ĂN SÂU VÀO THÂN TẠI Y=1.28, BẮP ĐÙI XOAY CÙNG CHÂN CHE KHÍT 100% KHE HỞ KHI CHẠY
  const legPts: [number, number][] = [[0.48, 0.22], [0.48, -0.22], [-0.48, 0.22], [-0.48, -0.22]];
  const legs = addLegs(g, s.legs ?? s.body, legPts, 1.28, 0.10, 0x241d19);
  legs.forEach((pivot) => {
    // Bắp đùi trên gắn trực tiếp vào pivot: xoay đồng bộ với chân, chìm sâu vào thân bụng triệt tiêu hoàn toàn khe hở
    const upperThigh = part(new THREE.CapsuleGeometry(0.15, 0.45, 6, 10), s.body, 0, -0.22, 0, undefined, true);
    upperThigh.scale.set(1.15, 1.0, 1.0);
    pivot.add(upperThigh);
  });
  return legs;
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
  const duckLegs = addLegs(g, s.bill, [[0, 0.2], [0, -0.2]], 0.45, 0.06);
  addDuckWebbedFeet(duckLegs, 0.45, s.bill);
  return duckLegs;
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

function buildWolf(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0x546e7a;
  const maneColor = s.mane ?? 0x263238;
  const chestColor = s.chest ?? 0xcfd8dc;
  const snoutColor = s.snout ?? 0xb0bec5;
  const earColor = s.ear ?? 0x37474f;
  const innerEarColor = s.innerEar ?? 0x90a4ae;
  const eyeColor = s.eye ?? 0xffca28;
  const legsColor = s.legs ?? 0x455a64;
  const pawsColor = s.paws ?? 0xcfd8dc;
  const tailTipColor = s.tailTip ?? 0x1c262b;

  // 1. Thân sói cơ bắp, ngực nở vai u, thon gọn săn chắc về phía hông (Apex Predator Torso)
  const chestTorso = blob(g, bodyColor, 0.44, [1.22, 1.05, 1.04], 0.22, 1.24, 0, undefined, true);
  chestTorso.rotation.z = -0.08;
  const waistTorso = blob(g, bodyColor, 0.36, [1.25, 0.92, 0.88], -0.28, 1.16, 0, undefined, true);
  waistTorso.rotation.z = 0.06;

  // Mảng lông sống lưng đậm màu kéo dọc từ vai xuống hông
  const dorsalStripe = blob(g, maneColor, 0.32, [1.55, 0.45, 0.72], -0.05, 1.46, 0);
  dorsalStripe.rotation.z = -0.08;

  // Mảng ngực trước sáng màu săn chắc
  blob(g, chestColor, 0.31, [1.05, 0.96, 0.88], 0.44, 1.12, 0, [0, 0, -0.18]);
  blob(g, chestColor, 0.24, [1.20, 0.65, 0.72], -0.02, 0.98, 0);

  // 2. BỜM LÔNG CỔ DÀY XÙ & DŨNG MÃNH (Multi-layered Fierce Wolf Neck Fur Ruff / Mane)
  const ruffGroup = new THREE.Group();
  ruffGroup.position.set(0.50, 1.38, 0);

  // Khối đệm bờm cổ chính bao quanh cổ và vai
  blob(ruffGroup, maneColor, 0.42, [0.95, 1.12, 1.18], -0.06, 0.02, 0, [0, 0, 0.15], true);
  blob(ruffGroup, chestColor, 0.36, [0.92, 1.02, 1.06], 0.08, -0.16, 0, [0, 0, -0.22]);

  // Vòng gai lông cổ tầng trên & hai bên vai (chĩa ngược ra sau đầy uy lực)
  const ruffCones = 12;
  for (let i = 0; i < ruffCones; i++) {
    const a = (i / ruffCones) * Math.PI * 2;
    const cy = Math.cos(a);
    const sz = Math.sin(a);
    const isBottom = cy < -0.15;
    const spikeCol = isBottom ? chestColor : (i % 2 === 0 ? maneColor : bodyColor);
    const coneR = isBottom ? 0.12 : 0.135;
    const coneH = isBottom ? 0.34 : 0.40;
    const tuft = part(new THREE.ConeGeometry(coneR, coneH, 7), spikeCol, -0.05 + cy * 0.06, cy * 0.30, sz * 0.34);
    // Hướng chóp lông chĩa ra ngoài và vuốt ngược về phía sau
    tuft.rotation.z = 1.15 + cy * 0.45;
    tuft.rotation.x = sz * 0.85;
    ruffGroup.add(tuft);
  }

  // Vòng gai lông cổ tầng thứ hai (xếp so le tạo độ dày bồng bềnh)
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const cy = Math.cos(a);
    const sz = Math.sin(a);
    const spikeCol = cy < 0 ? chestColor : maneColor;
    const tuft = part(new THREE.ConeGeometry(0.11, 0.34, 6), spikeCol, -0.18, cy * 0.26, sz * 0.30);
    tuft.rotation.z = 1.32 + cy * 0.35;
    tuft.rotation.x = sz * 0.75;
    ruffGroup.add(tuft);
  }
  g.add(ruffGroup);

  // 3. ĐẦU SÓI DŨNG MÃNH, MÕM DÀI & RĂNG NANH SẮC NHỌN (Fierce Wolf Head, Cheek Tufts & Fangs)
  const headGroup = new THREE.Group();
  headGroup.position.set(0.80, 1.56, 0);

  // Hộp sọ góc cạnh mạnh mẽ
  const skull = blob(headGroup, bodyColor, 0.34, [1.14, 0.96, 1.04], 0, 0, 0, undefined, true);
  skull.rotation.z = -0.06;

  // Mảng lông trán chữ V đậm màu
  blob(headGroup, maneColor, 0.25, [1.15, 0.62, 0.86], -0.02, 0.14, 0, [0, 0, -0.10]);

  // Chùm lông má sói xòe ngang hai bên hàm (Cheek Fur Ruffs)
  for (const side of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const cheekSpike = part(
        new THREE.ConeGeometry(0.085, 0.26, 6),
        j === 1 ? chestColor : bodyColor,
        0.02 - j * 0.04,
        -0.06 - j * 0.05,
        side * (0.28 + j * 0.03)
      );
      cheekSpike.rotation.x = side * (1.15 + j * 0.12);
      cheekSpike.rotation.z = 0.65;
      headGroup.add(cheekSpike);
    }
  }

  // Sống mũi & Mõm trên dài sắc bén (Long Lupine Upper Snout)
  const upperSnout = blob(headGroup, bodyColor, 0.16, [1.75, 0.72, 0.82], 0.32, -0.03, 0, [0, 0, -0.08]);
  upperSnout.castShadow = true;
  blob(headGroup, snoutColor, 0.145, [1.65, 0.55, 0.86], 0.33, -0.08, 0, [0, 0, -0.06]);

  // Hàm dưới hơi hé mở khoe nanh (Slightly parted fierce Lower Jaw)
  blob(headGroup, chestColor, 0.12, [1.55, 0.45, 0.74], 0.28, -0.17, 0, [0, 0, -0.18]);

  // 4 Răng nanh trắng sắc nhọn (2 nanh trên + 2 nanh dưới)
  const fangMatOpts = { roughness: 0.2, metalness: 0.1 };
  for (const side of [-1, 1]) {
    const upperFang = part(new THREE.ConeGeometry(0.028, 0.11, 6), 0xffffff, 0.44, -0.13, side * 0.085, fangMatOpts, false);
    upperFang.rotation.z = Math.PI - 0.12; // Chĩa xuống
    headGroup.add(upperFang);

    const lowerFang = part(new THREE.ConeGeometry(0.022, 0.085, 6), 0xffffff, 0.38, -0.14, side * 0.072, fangMatOpts, false);
    lowerFang.rotation.z = 0.15; // Chĩa lên
    headGroup.add(lowerFang);
  }

  // Chóp mũi đen lớn của sói săn mồi
  const nose = part(new THREE.SphereGeometry(0.058, 10, 8), 0x141210, 0.56, 0.01, 0, { roughness: 0.35 });
  nose.scale.set(0.95, 0.85, 1.15);
  headGroup.add(nose);

  // Đôi mắt sói hung dữ sắc lạnh hình quả hạnh nhân xếch ngược + Gờ chân mày cau có gầm gừ (Fierce Predator Wolf Eyes)
  const fierceEyeColor = eyeColor || 0xff9100; // Hổ phách rực lửa săn mồi
  const eyeGlowMat = animalMat(fierceEyeColor, { roughness: 0.1, emissive: 0xff3d00, emissiveIntensity: 1.2 });
  const pupilMat = animalMat(0x050505, { roughness: 0.1 });
  const browMat = animalMat(maneColor, { roughness: 0.7 });

  // Nếp nhăn cau có giận dữ trên sống mũi giữa 2 mắt (Snarl wrinkles)
  blob(headGroup, maneColor, 0.10, [1.45, 0.38, 0.82], 0.28, 0.18, 0, [0, 0, -0.15]);

  for (const side of [-1, 1]) {
    // 1. Mắt sói xếch quả hạnh nhân (Almond-shaped slanted predator eye)
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(0.28, 0.18, side * 0.22);
    eyeGroup.rotation.set(side * 0.28, side * 0.38, -0.36);

    // Lòng mắt quả hạnh nhân xếch phát sáng rực lửa hổ phách
    const eyeSclera = new THREE.Mesh(new THREE.SphereGeometry(0.092, 12, 10), eyeGlowMat);
    eyeSclera.scale.set(1.5, 0.75, 0.45);
    eyeSclera.userData.eye = true;
    eyeGroup.add(eyeSclera);

    // Đồng tử mắt dựng đứng hình khe sắc nhọn (Demonic vertical slit predator pupil)
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.12, 0.05), pupilMat);
    pupil.position.set(0.032, 0, 0);
    pupil.userData.eye = true;
    eyeGroup.add(pupil);

    headGroup.add(eyeGroup);

    // 2. Gờ chân mày sói đậm dày, xếch chéo đè lên mắt tạo ánh nhìn gầm gừ hung dữ (Aggressive Furrowed Brow)
    const browGeo = new THREE.BoxGeometry(0.22, 0.065, 0.085);
    const brow = new THREE.Mesh(browGeo, browMat);
    brow.position.set(0.28, 0.24, side * 0.21);
    brow.rotation.set(side * 0.40, side * 0.35, -0.45);
    headGroup.add(brow);
  }

  // Đôi tai sói dựng đứng, cao và nhọn hoắt (Tall Erect Pointed Wolf Ears)
  for (const side of [-1, 1]) {
    const earOuter = part(new THREE.ConeGeometry(0.115, 0.36, 8), earColor, -0.06, 0.36, side * 0.20);
    earOuter.rotation.z = -0.18;
    earOuter.rotation.x = side * 0.22;
    headGroup.add(earOuter);

    const earInner = part(new THREE.ConeGeometry(0.072, 0.28, 6), innerEarColor, -0.035, 0.35, side * 0.205);
    earInner.rotation.z = -0.18;
    earInner.rotation.x = side * 0.22;
    headGroup.add(earInner);
  }

  g.add(headGroup);
  g.userData.head = headGroup;

  // 4. Đuôi sói rậm dài vểnh nhẹ uy phong (Bushy Wolf Tail)
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.62, 1.20, 0);
  tailGroup.rotation.z = 0.85;
  const tailBase = blob(tailGroup, bodyColor, 0.11, [0.95, 1.85, 0.95], 0, 0.16, 0);
  tailBase.castShadow = true;
  const tailMid = blob(tailGroup, maneColor, 0.125, [1.0, 1.95, 1.0], -0.02, 0.36, 0);
  tailMid.castShadow = true;
  const tailTip = part(new THREE.ConeGeometry(0.11, 0.28, 8), tailTipColor, -0.03, 0.60, 0);
  tailGroup.add(tailTip);
  g.add(tailGroup);

  // 5. 4 Chân sói cơ bắp săn chắc (Muscular Wolf Legs)
  return addLegs(g, legsColor, [[0.32, 0.17], [0.32, -0.17], [-0.32, 0.17], [-0.32, -0.17]], 0.96, 0.11, pawsColor);
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

function addMammothEyes(headGroup: THREE.Group): void {
  const whiteMat = animalMat(0xffffff, { roughness: 0.35 });
  const pupilMat = animalMat(0x161210, { roughness: 0.3 });
  const hlMat = animalMat(0xffffff, { roughness: 0.15 });

  for (const side of [-1, 1]) {
    // Tọa độ chuẩn khớp với sọ đầu to 30%, phẳng ôm sọ tự nhiên (không lồi)
    const x = 0.26;
    const y = 0.10;
    const z = side * 0.34;
    const r = 0.068;

    // Tròng trắng mắt hơi dẹt nhẹ ôm theo hộp sọ, không bị lồi
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), whiteMat);
    eyeWhite.scale.set(0.68, 1.0, 0.88);
    eyeWhite.position.set(x, y, z);
    eyeWhite.rotation.y = side * 0.32;
    headGroup.add(eyeWhite);

    // Con ngươi đen
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.60, 12, 8), pupilMat);
    pupil.scale.set(0.40, 1, 1);
    pupil.position.set(x + 0.026, y, z + side * 0.016);
    pupil.rotation.y = side * 0.32;
    headGroup.add(pupil);

    // Điểm sáng lấp lánh
    const hl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 8, 6), hlMat);
    hl.position.set(x + 0.040, y + 0.018, z + side * 0.022);
    headGroup.add(hl);
  }
}

function addMammothEars(
  headGroup: THREE.Group,
  bodyColor: number,
  innerEarColor: number,
  furOpts: Partial<THREE.MeshStandardMaterialParameters>
): void {
  for (const side of [-1, 1]) {
    const z = side * 0.38;
    const earGroup = new THREE.Group();
    earGroup.position.set(-0.06, 0.08, z);
    earGroup.rotation.y = side * 0.22;
    earGroup.rotation.z = -0.15;
    earGroup.rotation.x = side * 0.08;

    // Vành tai ngoài - NẰM DỌC THEO THÂN ĐẦU (trục X-Y dọc, không nằm ngang)
    const earGeo = new THREE.CylinderGeometry(0.14, 0.18, 0.045, 12);
    earGeo.rotateX(Math.PI / 2);
    earGeo.scale(0.85, 1.25, 0.24);
    const earMesh = part(earGeo, bodyColor, 0, 0, 0, furOpts);
    earGroup.add(earMesh);

    // Lòng tai trong
    const innerGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.035, 10);
    innerGeo.rotateX(Math.PI / 2);
    innerGeo.scale(0.80, 1.15, 0.20);
    const innerMesh = part(innerGeo, innerEarColor, 0, 0, side * 0.012, furOpts);
    earGroup.add(innerMesh);

    headGroup.add(earGroup);
  }
}

function buildMammoth(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0x5a3d28;
  const humpColor = s.hump ?? 0x432815;
  const skirtColor = s.skirt ?? 0x4a2e1c;
  const tuskColor = s.tusk ?? 0xfcf7eb;
  const innerEarColor = s.innerEar ?? 0x7a4d33;
  const toenailsColor = s.toenails ?? 0xd4c8b8;
  const tuftColor = s.tuft ?? 0x381f11;

  // Ultra-matte, non-specular woolly fur material (khử bóng, tạo chất liệu lông chân thực)
  const furOpts: Partial<THREE.MeshStandardMaterialParameters> = { roughness: 1.0, metalness: 0.0 };

  // Helper for textured matte fur geometry
  const furBlob = (
    parent: THREE.Group,
    color: number,
    r: number,
    scale: [number, number, number],
    x: number,
    y: number,
    z: number,
    rot?: [number, number, number],
    shadow = true
  ): THREE.Mesh => {
    const m = part(new THREE.SphereGeometry(r, 14, 10), color, x, y, z, furOpts, shadow);
    m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  };

  // =========================================================================
  // 1. Unified, Muscular Wedge Torso (Lưng gù cao, dốc xuống mông thấp liền khối)
  // =========================================================================
  // Main Shoulder Hump (Khối gù vai đồ sộ - đỉnh cao nhất của thân)
  const shoulderHump = furBlob(g, bodyColor, 0.64, [1.18, 1.06, 1.16], 0.22, 1.52, 0, undefined, true);
  shoulderHump.rotation.z = -0.06;

  // Neck Juncture (Nối liền vai vào đầu mượt mà, không kẽ hở)
  furBlob(g, bodyColor, 0.52, [1.10, 1.02, 0.98], 0.56, 1.50, 0);

  // Sloping Mid-Spine (Lưng giữa dốc thoai thoải từ gù xuống mông)
  const midBack = furBlob(g, bodyColor, 0.54, [1.16, 0.96, 1.04], -0.08, 1.32, 0);
  midBack.rotation.z = 0.10;

  // Pelvis & Rump (Mông thấp, tròn đầy, bao phủ hoàn toàn chân sau, dốc dáng chữ nêm)
  const rump = furBlob(g, bodyColor, 0.48, [1.12, 0.90, 0.98], -0.42, 1.10, 0);
  rump.rotation.z = 0.14;

  // Rear Tail-End Cap (Bịt kín hoàn toàn đuôi mông)
  furBlob(g, bodyColor, 0.32, [0.88, 0.88, 0.84], -0.60, 1.06, 0);

  // Hip Sockets (Hông hai bên ôm khít lấy đùi sau z: +-0.28)
  for (const z of [-0.28, 0.28]) {
    furBlob(g, bodyColor, 0.30, [1.02, 1.04, 0.96], -0.40, 1.06, z);
  }

  // Shaggy Woolly Flank Skirts & Textured Fur Layers (Tạo cảm giác lông rủ tự nhiên, khử hoàn toàn cảm giác bóng)
  for (const z of [-0.44, 0.44]) {
    const skirtF = furBlob(g, skirtColor, 0.32, [1.20, 0.72, 0.22], 0.18, 1.12, z);
    skirtF.rotation.z = 0.16;
    skirtF.rotation.x = z > 0 ? 0.12 : -0.12;
    const skirtR = furBlob(g, skirtColor, 0.26, [1.08, 0.65, 0.20], -0.22, 0.98, z * 0.92);
    skirtR.rotation.z = 0.18;
    skirtR.rotation.x = z > 0 ? 0.12 : -0.12;
    // Layered flank fur tufts (Cụm lông phủ sườn tạo độ gợn sóng bề mặt lông)
    const flankTuft = furBlob(g, bodyColor, 0.28, [1.15, 0.65, 0.24], 0.02, 1.28, z);
    flankTuft.rotation.z = 0.08;
    flankTuft.rotation.x = z > 0 ? 0.10 : -0.10;
  }

  // =========================================================================
  // Majestic Woolly Back Mane (Lông lưng giống phần đầu, màu đậm hơn thân, to hơn phần đầu)
  // =========================================================================
  // Main Summit Crest (Đỉnh bờm chính trên gù vai - to và bồng bềnh hơn đầu)
  const maneApex = furBlob(g, humpColor, 0.60, [1.32, 0.72, 1.10], 0.18, 2.12, 0);
  maneApex.rotation.z = -0.06;

  // Front flow towards neck/head (Vuốt mượt về trước cổ nối liền sọ đầu)
  const maneFront = furBlob(g, humpColor, 0.52, [1.20, 0.64, 1.00], 0.46, 1.98, 0);
  maneFront.rotation.z = -0.10;

  // Mid-spine flow down the slope (Trải dài dọc theo sống lưng dốc xuống mông)
  const maneSlope = furBlob(g, humpColor, 0.54, [1.24, 0.66, 1.02], -0.12, 1.84, 0);
  maneSlope.rotation.z = 0.12;

  // Rear crest taper (Đuôi bờm lưng vuốt dần về phía mông)
  const maneRear = furBlob(g, humpColor, 0.46, [1.16, 0.56, 0.92], -0.40, 1.54, 0);
  maneRear.rotation.z = 0.16;

  // Swept Woolly Tufts / Flank Locks (Các lọn lông vuốt ngược đặc trưng giống phần đầu quiff nhưng đồ sộ hơn)
  for (const z of [-0.32, 0.32]) {
    const maneSideF = furBlob(g, humpColor, 0.44, [1.22, 0.60, 0.80], 0.14, 2.02, z);
    maneSideF.rotation.z = -0.04;
    maneSideF.rotation.x = z > 0 ? 0.16 : -0.16;
    const maneSideR = furBlob(g, humpColor, 0.40, [1.16, 0.56, 0.76], -0.16, 1.82, z);
    maneSideR.rotation.z = 0.08;
    maneSideR.rotation.x = z > 0 ? 0.16 : -0.16;
  }

  // =========================================================================
  // 2. Sculpted Head (+30% Scale, Unified with Eyes, Ears, Tusks & Trunk)
  // =========================================================================
  const headGroup = new THREE.Group();
  headGroup.position.set(0.80, 1.54, 0);
  headGroup.scale.set(1.69, 1.69, 1.69); // Đầu to lên 30% so với phiên bản hiện tại (1.30 * 1.30 = 1.69)

  // Skull (Hộp sọ vòm cao chuẩn voi ma mút, nhẵn nhụi, liền khối với cổ)
  furBlob(headGroup, bodyColor, 0.44, [1.05, 1.12, 0.95], 0, 0.05, 0);

  // Forehead & Brow (Trán dốc êm xuống gốc vòi)
  furBlob(headGroup, bodyColor, 0.32, [1.04, 0.92, 0.84], 0.18, -0.06, 0);

  // Cheeks (Hai bên má chứa gốc ngà)
  for (const z of [-0.18, 0.18]) {
    furBlob(headGroup, bodyColor, 0.18, [1.0, 1.0, 1.0], 0.16, -0.18, z);
  }

  // Stylish Swept-Back Woolly Hair Quiff on Head (Tóc vuốt ngược trên đỉnh sọ)
  const hairCrown = furBlob(headGroup, humpColor, 0.28, [1.24, 0.50, 0.74], 0.04, 0.52, 0);
  hairCrown.rotation.z = 0.16;
  const hairFore = furBlob(headGroup, humpColor, 0.20, [0.96, 0.42, 0.64], 0.16, 0.44, 0);
  hairFore.rotation.z = 0.10;
  const hairBack = furBlob(headGroup, humpColor, 0.24, [1.10, 0.44, 0.68], -0.10, 0.48, 0);
  hairBack.rotation.z = 0.20;

  // Small Woolly Ears (Tai nhỏ nép 2 bên sọ rõ ràng, không bị chìm)
  addMammothEars(headGroup, bodyColor, innerEarColor, furOpts);

  // 🌟 Expressive Cute Eyes (Tỉ lệ chuẩn theo đầu to 30%, phẳng ôm sọ tự nhiên không lồi)
  addMammothEyes(headGroup);

  // Smooth Animatable Trunk (Vòi voi gắn trong headGroup)
  const trunkGroup = new THREE.Group();
  trunkGroup.position.set(0.20, -0.11, 0);

  const trunkNodes: [number, number, number][] = [
    [0.00,  0.00, 0.150],
    [0.08, -0.16, 0.135],
    [0.16, -0.34, 0.120],
    [0.23, -0.53, 0.105],
    [0.29, -0.71, 0.090],
    [0.37, -0.84, 0.078],
    [0.45, -0.79, 0.068],
    [0.49, -0.68, 0.058],
  ];

  for (const [nx, ny, nr] of trunkNodes) {
    trunkGroup.add(part(new THREE.SphereGeometry(nr, 12, 10), bodyColor, nx, ny, 0, furOpts));
  }

  for (let i = 0; i < trunkNodes.length - 1; i++) {
    const [x0, y0, r0] = trunkNodes[i];
    const [x1, y1, r1] = trunkNodes[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const segMesh = part(new THREE.CylinderGeometry(r1, r0, len, 12), bodyColor, (x0 + x1) / 2, (y0 + y1) / 2, 0, furOpts);
    segMesh.rotation.z = -Math.atan2(dx, dy);
    trunkGroup.add(segMesh);
  }

  // Nostrils
  for (const z of [-0.018, 0.018]) {
    trunkGroup.add(part(new THREE.SphereGeometry(0.013, 6, 4), 0x241e1c, 0.48, -0.66, z));
  }
  headGroup.add(trunkGroup);

  // Majestic Sweeping Tusks (Cặp ngà vút cong chữ C)
  for (const z of [-0.14, 0.14]) {
    const sign = Math.sign(z);
    const tuskPoints = [
      new THREE.Vector3(0.14, -0.24, z),
      new THREE.Vector3(0.34, -0.39, sign * 0.19),
      new THREE.Vector3(0.57, -0.47, sign * 0.22),
      new THREE.Vector3(0.78, -0.29, sign * 0.20),
      new THREE.Vector3(0.85, -0.06, sign * 0.16),
      new THREE.Vector3(0.80,  0.13, sign * 0.12),
    ];

    const curve = new THREE.CatmullRomCurve3(tuskPoints);
    const tubularSegments = 28;
    const radialSegments = 10;
    const baseRadius = 0.075;
    const tuskGeo = new THREE.TubeGeometry(curve, tubularSegments, baseRadius, radialSegments, false);

    const posAttr = tuskGeo.attributes.position;
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      const scale = 1.0 - 0.86 * Math.pow(t, 0.85);
      const center = curve.getPoint(t);
      for (let j = 0; j <= radialSegments; j++) {
        const idx = i * (radialSegments + 1) + j;
        const px = posAttr.getX(idx);
        const py = posAttr.getY(idx);
        const pz = posAttr.getZ(idx);
        posAttr.setXYZ(
          idx,
          center.x + (px - center.x) * scale,
          center.y + (py - center.y) * scale,
          center.z + (pz - center.z) * scale
        );
      }
    }
    tuskGeo.computeVertexNormals();

    const tuskMat = animalMat(tuskColor, { roughness: 0.28, metalness: 0.04 });
    const tuskMesh = new THREE.Mesh(tuskGeo, tuskMat);
    tuskMesh.castShadow = true;
    headGroup.add(tuskMesh);
  }

  g.userData.head = headGroup;
  g.userData.trunk = trunkGroup;
  g.add(headGroup);

  // =========================================================================
  // 6. Tail (Đuôi tăng độ dài và độ lớn lên 50%, buông tự nhiên ra sau mông)
  // =========================================================================
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.66, 1.18, 0);
  tailGroup.rotation.z = -0.15; // buông thẳng tự nhiên xuống phía sau mông
  const stemLen = 0.72; // tăng độ dài 50% (từ 0.48 lên 0.72)
  tailGroup.add(part(new THREE.CylinderGeometry(0.039, 0.027, stemLen, 8), bodyColor, 0, -stemLen / 2, 0, furOpts));
  const tuftLen = 0.33; // tăng độ dài chùm lông 50% (từ 0.22 lên 0.33)
  tailGroup.add(part(new THREE.ConeGeometry(0.098, tuftLen, 8), tuftColor, 0, -stemLen - tuftLen * 0.4, 0, furOpts));
  const tuftBall = part(new THREE.SphereGeometry(0.090, 8, 6), tuftColor, 0, -stemLen - tuftLen * 0.8, 0, furOpts);
  tuftBall.scale.set(0.95, 1.35, 0.95);
  tailGroup.add(tuftBall);
  g.add(tailGroup);

  // =========================================================================
  // 7. Sturdy Pillar Legs:
  // Chân trước cao (1.14), Chân sau thấp hơn (0.90) tạo dáng đứng dốc uy nghi
  // =========================================================================
  const frontLegs = addLegs(g, s.legs ?? bodyColor, [[0.42, 0.34], [0.42, -0.34]], 1.14, 0.18, toenailsColor, furOpts);
  const rearLegs = addLegs(g, s.legs ?? bodyColor, [[-0.38, 0.28], [-0.38, -0.28]], 0.90, 0.165, toenailsColor, furOpts);
  return [...frontLegs, ...rearLegs];
}

function buildMonkey(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const furColor = s.fur ?? 0x6e472b;
  const skinColor = s.skin ?? 0xf3cfb3;
  const darkColor = s.dark ?? 0x1a1412;

  // 1. Torso (capsule tilted forward)
  const torsoGeo = new THREE.CapsuleGeometry(0.32, 0.45, 8, 16);
  const torsoMesh = part(torsoGeo, furColor, 0, 1.05, 0, undefined, true);
  torsoMesh.rotation.z = -0.18;
  g.add(torsoMesh);

  // Belly (cream sphere on front of torso)
  const belly = blob(g, skinColor, 0.26, [0.85, 1.15, 0.6], 0.18, 1.02, 0);
  belly.rotation.z = -0.18;

  // 2. Head
  g.add(part(new THREE.SphereGeometry(0.34, 16, 14), furColor, 0.12, 1.55, 0));
  blob(g, skinColor, 0.27, [0.75, 0.95, 0.9], 0.28, 1.55, 0);
  blob(g, skinColor, 0.18, [0.95, 0.75, 0.9], 0.40, 1.45, 0);

  // Nostrils
  for (const z of [-0.05, 0.05]) {
    g.add(part(new THREE.SphereGeometry(0.024, 8, 6), darkColor, 0.52, 1.48, z));
  }

  // Eyes
  addEyes(g, 0.38, 1.62, 0.14, 0.065);

  // Large round ears
  for (const z of [-0.34, 0.34]) {
    const earOuter = part(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16), furColor, 0.10, 1.57, z);
    earOuter.rotation.x = Math.PI / 2;
    earOuter.rotation.y = z > 0 ? 0.2 : -0.2;
    g.add(earOuter);

    const earInner = part(new THREE.CylinderGeometry(0.09, 0.09, 0.055, 14), skinColor, 0.10, 1.57, z > 0 ? z - 0.01 : z + 0.01);
    earInner.rotation.x = Math.PI / 2;
    earInner.rotation.y = z > 0 ? 0.2 : -0.2;
    g.add(earInner);
  }

  // Hair tuft
  const hair = part(new THREE.ConeGeometry(0.08, 0.18, 8), furColor, 0.08, 1.90, 0);
  hair.rotation.z = 0.25;
  g.add(hair);

  // 3. Two flexible long arms (kinematic chain: shoulder -> upper arm -> elbow joint -> forearm -> hand)
  const arms: THREE.Group[] = [];
  for (const z of [-0.32, 0.32]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(0.05, 1.25, z);
    armPivot.userData.origY = 1.25;

    // Shoulder sphere
    const shoulder = part(new THREE.SphereGeometry(0.082, 8, 8), furColor, 0, 0, 0);
    armPivot.add(shoulder);

    // Upper arm: length 0.30, hangs straight down from shoulder
    const upperLen = 0.30;
    const upperArm = part(new THREE.CapsuleGeometry(0.075, upperLen, 8, 12), furColor, 0, -upperLen / 2, 0);
    upperArm.rotation.x = z > 0 ? 0.08 : -0.08;
    armPivot.add(upperArm);

    // Elbow Joint Group attached at bottom tip of upper arm (0, -upperLen, 0)
    const elbowJoint = new THREE.Group();
    elbowJoint.position.set(0, -upperLen, 0);
    // Natural bend forward and slight outward angle
    elbowJoint.rotation.z = -0.22;
    elbowJoint.rotation.x = z > 0 ? 0.12 : -0.12;

    // Spherical elbow ball to create a 100% seamless, unbroken joint
    const elbowBall = part(new THREE.SphereGeometry(0.072, 8, 8), furColor, 0, 0, 0);
    elbowJoint.add(elbowBall);

    // Forearm: length 0.28, hangs down from elbow joint
    const foreLen = 0.28;
    const forearm = part(new THREE.CapsuleGeometry(0.065, foreLen, 8, 12), furColor, 0, -foreLen / 2, 0);
    elbowJoint.add(forearm);

    // Hand: attached at bottom of forearm
    const hand = part(new THREE.SphereGeometry(0.08, 10, 8), skinColor, 0, -foreLen - 0.04, 0);
    hand.scale.set(0.9, 1.15, 0.8);
    elbowJoint.add(hand);

    armPivot.add(elbowJoint);
    g.add(armPivot);
    arms.push(armPivot);
  }
  g.userData.arms = arms;

  // 4. Multi-segment kinematic chain curved tail (seamless ball-and-socket joints)
  const tailSegments: THREE.Group[] = [];
  let parentJoint: THREE.Group = g;
  let prevLen = 0.18;
  for (let i = 0; i < 6; i++) {
    const rad = 0.065 * (1 - i * 0.09);
    const len = 0.18 * (1 - i * 0.05);
    const geo = new THREE.CapsuleGeometry(rad, len, 6, 10);
    geo.translate(0, len / 2, 0); // Bottom spherical cap centered at (0,0,0), top cap at (0,len,0)
    const joint = new THREE.Group();
    if (i === 0) {
      joint.position.set(-0.35, 0.95, 0);
      joint.rotation.z = 1.05; // upward-backward angle from rump
      g.add(joint);
    } else {
      joint.position.set(0, prevLen, 0); // attached exactly to previous segment's apex
      joint.rotation.z = -0.36; // smooth continuous upward curl
      parentJoint.add(joint);
    }
    const mesh = part(geo, furColor, 0, 0, 0);
    joint.add(mesh);
    parentJoint = joint;
    prevLen = len;
    tailSegments.push(joint);
  }
  g.userData.tail = tailSegments;

  // 5. Bipedal legs (2 legs)
  return addLegs(g, furColor, [[-0.05, 0.20], [-0.05, -0.20]], 0.72, 0.09, skinColor);
}

function buildGorilla(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  // Smooth rounded cartoon gorilla matching Farm Brawl art style (pig, monkey, cow)
  const furColor = s.body ?? 0x2b2d32;     // Smooth dark charcoal ape fur
  const chestColor = s.chest ?? 0x6e6862;   // Warm tan/grey chest & belly
  const faceColor = s.face ?? 0x82776c;    // Warm tan ape face mask
  const crestColor = s.crest ?? 0x212327;   // Dark sagittal crown
  const silverColor = s.silver ?? 0x727882;  // Silverback saddle
  const eyeColor = 0x141210;

  // =========================================================================
  // 1. Massive Upper Torso (Ngực & vai đồ sộ - to hơn mông)
  // =========================================================================
  // Main Upper Chest Sphere (rộng ngang Z, nhô ra trước tại x=0.18, y=1.36)
  const chestMesh = blob(g, furColor, 0.56, [1.18, 1.02, 1.28], 0.18, 1.36, 0, undefined, true);
  chestMesh.rotation.z = -0.16;

  // Muscular Trapezius / Neck Hump behind head
  const trapHump = blob(g, furColor, 0.44, [1.02, 0.88, 1.14], -0.02, 1.58, 0, undefined, true);
  trapHump.rotation.z = 0.12;

  // Pectoral Chest Plates (smooth rounded tan chest pads on front)
  for (const z of [-0.22, 0.22]) {
    blob(g, chestColor, 0.27, [0.82, 1.06, 1.08], 0.45, 1.34, z, [0, 0, -0.32]);
  }

  // Smooth Abdominal Belly Pad
  blob(g, chestColor, 0.24, [0.88, 1.02, 0.86], 0.36, 1.04, 0, [0, 0, -0.22]);

  // =========================================================================
  // 2. Lower Torso & Pelvis (Thân dưới / mông - nhỏ hơn ngực & vai một chút)
  // =========================================================================
  // Pelvis / Buttocks: nhỏ hơn ngực (bán kính 0.44 vs 0.56, hẹp hơn theo Z)
  const pelvis = blob(g, furColor, 0.44, [1.04, 0.95, 0.96], -0.32, 1.14, 0, undefined, true);
  pelvis.rotation.z = 0.10;

  // Silverback Saddle across lower/mid back
  blob(g, silverColor, 0.38, [0.95, 0.42, 1.08], -0.25, 1.34, 0, [0, 0, -0.28]);

  // Solid hip sockets that embed the hind legs completely into the body
  for (const z of [-0.30, 0.30]) {
    blob(g, furColor, 0.22, [1.0, 1.0, 1.0], -0.34, 0.96, z);
  }

  // =========================================================================
  // 3. Smooth Gorilla Head (Vòm sọ tròn, sagittal dome, gờ mày ape, mõm & mũi hơi lồi)
  // =========================================================================
  const headGroup = new THREE.Group();
  headGroup.position.set(0.50, 1.60, 0);

  // Rounded Cranial Dome (Vòm đầu tròn trịa)
  const skull = part(new THREE.SphereGeometry(0.35, 22, 16), furColor, 0, 0, 0);
  skull.scale.set(1.06, 1.02, 0.98);
  headGroup.add(skull);

  // Smooth Rounded Sagittal Crest (Đỉnh đầu ape gồ cong mềm mại)
  blob(headGroup, crestColor, 0.18, [1.25, 0.82, 0.60], -0.05, 0.28, 0, [0, 0, 0.16]);

  // Heavy Arched Brow Ridge (Gờ mày ape vắt cong trên trán)
  const browGeo = new THREE.CapsuleGeometry(0.07, 0.38, 8, 14);
  browGeo.rotateZ(Math.PI / 2);
  const brow = part(browGeo, furColor, 0.24, 0.17, 0);
  brow.scale.set(1.05, 0.95, 1.08);
  headGroup.add(brow);

  // Main Face Mask (Vùng mặt tan/da ape ôm trọn mắt và gò má giống phong cách Farm Brawl)
  blob(headGroup, faceColor, 0.26, [0.85, 1.05, 1.02], 0.20, 0.04, 0);

  // Rounded Cheeks (Hai má mở rộng hai bên mặt)
  for (const z of [-0.20, 0.20]) {
    blob(headGroup, faceColor, 0.16, [0.95, 0.95, 0.82], 0.18, -0.04, z);
  }

  // Cute, expressive cartoon eyes sitting on the facial mask
  addEyes(headGroup, 0.32, 0.10, 0.12, 0.065);

  // Protruding Snout & Nose Pad (Mũi hơi lồi ra phía trước)
  blob(headGroup, faceColor, 0.18, [1.12, 0.82, 1.02], 0.31, 0.0, 0);

  // Two cute distinct dark ape nostrils
  for (const z of [-0.052, 0.052]) {
    const nostril = part(new THREE.SphereGeometry(0.034, 8, 6), eyeColor, 0.44, 0.005, z);
    headGroup.add(nostril);
  }

  // Lower Muzzle & Mouth/Jaw (Miệng & quai hàm hơi lồi)
  blob(headGroup, faceColor, 0.19, [1.15, 0.86, 0.98], 0.31, -0.14, 0, [0, 0, -0.15]);

  // Smooth indented mouth line
  const mouthGeo = new THREE.CapsuleGeometry(0.018, 0.18, 4, 8);
  mouthGeo.rotateZ(Math.PI / 2);
  const mouth = part(mouthGeo, eyeColor, 0.43, -0.13, 0);
  headGroup.add(mouth);

  // Chin under-throat transition
  blob(headGroup, furColor, 0.18, [1.0, 0.85, 0.95], 0.20, -0.22, 0, [0, 0, -0.20]);

  // Rounded C-shaped ape ears
  for (const z of [-0.30, 0.30]) {
    blob(headGroup, furColor, 0.11, [0.55, 1.10, 1.0], -0.02, 0.05, z);
    blob(headGroup, faceColor, 0.07, [0.50, 1.0, 0.85], -0.01, 0.05, z > 0 ? z - 0.015 : z + 0.015);
  }

  g.add(headGroup);

  // =========================================================================
  // 4. Front Knuckle-Walking Arms (Vai tròn cơ bắp -> Cánh tay -> Nắm đấm tiếp đất)
  // =========================================================================
  const arms: THREE.Group[] = [];
  for (const z of [-0.52, 0.52]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(0.30, 1.45, z);
    armPivot.userData.origY = 1.45;

    // Shoulder Deltoid: massive smooth sphere
    blob(armPivot, furColor, 0.28, [1.15, 1.10, 1.12], 0, 0, 0, undefined, true);

    // Upper Arm: smooth capsule
    const upperLen = 0.46;
    const upperArm = part(new THREE.CapsuleGeometry(0.18, upperLen, 10, 16), furColor, 0.03, -upperLen / 2, 0, undefined, true);
    upperArm.rotation.z = -0.20;
    upperArm.rotation.x = z > 0 ? 0.08 : -0.08;
    armPivot.add(upperArm);

    // Elbow Joint
    const elbowJoint = new THREE.Group();
    elbowJoint.position.set(0.07, -upperLen, 0);
    elbowJoint.rotation.z = -0.14;

    blob(elbowJoint, furColor, 0.16, [1, 1, 1], 0, 0, 0, undefined, true);

    // Forearm: thick muscular capsule
    const foreLen = 0.50;
    const forearm = part(new THREE.CapsuleGeometry(0.165, foreLen, 10, 16), furColor, 0.03, -foreLen / 2, 0, undefined, true);
    elbowJoint.add(forearm);

    // Knuckle Fist Group
    const fistGroup = new THREE.Group();
    fistGroup.position.set(0.05, -foreLen - 0.04, 0);

    // Main knuckle hand block
    const handGeo = new THREE.CapsuleGeometry(0.12, 0.16, 8, 12);
    handGeo.rotateX(Math.PI / 2);
    const hand = part(handGeo, faceColor, 0, 0, 0, undefined, true);
    fistGroup.add(hand);

    // 4 Smooth Rounded Knuckle Fingers resting flat on ground
    for (let f = 0; f < 4; f++) {
      const fz = -0.09 + f * 0.06;
      blob(fistGroup, faceColor, 0.065, [1.4, 0.95, 0.85], 0.10, -0.03, fz, undefined, true);
    }

    elbowJoint.add(fistGroup);
    armPivot.add(elbowJoint);

    g.add(armPivot);
    arms.push(armPivot);
  }
  g.userData.arms = arms;

  // =========================================================================
  // 5. Hind Legs: 100% physically connected into pelvis (Zero Gap!)
  // =========================================================================
  const legs: THREE.Group[] = [];
  for (const z of [-0.30, 0.30]) {
    const legPivot = new THREE.Group();
    const legLen = 0.88;
    // Positioned at y = 0.88, x = -0.32: sits completely inside pelvis bottom at y=0.96!
    legPivot.position.set(-0.32, legLen, z);
    legPivot.userData.origY = legLen;

    // Hip Ball Socket (seamlessly fills joint with body)
    blob(legPivot, furColor, 0.20, [1.08, 1.05, 1.08], 0, 0, 0, undefined, true);

    // Thigh: smooth muscular capsule
    const thighLen = 0.42;
    const thigh = part(new THREE.CapsuleGeometry(0.19, thighLen, 10, 16), furColor, -0.02, -thighLen / 2, 0, undefined, true);
    thigh.rotation.z = 0.20; // Bent knee posture
    legPivot.add(thigh);

    // Knee Ball
    blob(legPivot, furColor, 0.165, [1.05, 1.0, 1.05], 0.04, -thighLen + 0.02, 0, undefined, true);

    // Calf: smooth capsule angled forward
    const calfLen = 0.36;
    const calf = part(new THREE.CapsuleGeometry(0.16, calfLen, 10, 16), furColor, 0.05, -thighLen - calfLen / 2 + 0.04, 0, undefined, true);
    calf.rotation.z = -0.12;
    legPivot.add(calf);

    // Foot Group (grounded flat at -legLen)
    const footGroup = new THREE.Group();
    footGroup.position.set(0.08, -legLen + 0.08, 0);

    blob(footGroup, faceColor, 0.14, [1.35, 0.70, 1.25], 0, 0, 0, undefined, true);

    // 4 Rounded Toes
    for (let tIdx = 0; tIdx < 4; tIdx++) {
      const tz = -0.09 + tIdx * 0.06;
      blob(footGroup, faceColor, 0.055, [1.35, 0.85, 0.85], 0.12, -0.02, tz, undefined, true);
    }

    legPivot.add(footGroup);
    g.add(legPivot);
    legs.push(legPivot);
  }

  return legs;
}

function buildPhoenix(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0xff2d00;
  const wingColor = s.wing ?? 0xff8f00;
  const chestColor = s.chest ?? 0xffd600;
  const tailColor = s.tail ?? 0xd50000;
  const crestColor = s.crest ?? 0xffea00;
  const beakColor = s.beak ?? 0xffab00;

  // 1. THÂN CHIM THẦN PHƯỢNG HOÀNG LỬA: KHÍ CHẤT HOÀNG GIA, THON GỌN, NGỰC ƯỠN KIÊU DŨNG
  // Thân thon khí động học (aerodynamic mythical raptor torso)
  const bodyGeo = new THREE.CapsuleGeometry(0.38, 0.85, 8, 14);
  bodyGeo.rotateZ(Math.PI / 2 + 0.18);
  const bodyMesh = part(bodyGeo, bodyColor, 0, 1.25, 0, undefined, true);
  bodyMesh.scale.set(1.0, 1.15, 0.85);
  g.add(bodyMesh);

  // Ức chim thần nở cao dát giáp lông vũ hoàng kim rực lửa (Radiant solar chest armor)
  blob(g, chestColor, 0.36, [1.25, 0.95, 0.72], 0.35, 1.36, 0, [0, 0, -0.28]);
  blob(g, crestColor, 0.26, [1.10, 0.80, 0.58], 0.46, 1.44, 0, [0, 0, -0.32]);

  // Vòng lông lửa bảo hộ quanh cổ (8 ngọn lửa bập bùng quanh cổ)
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const ruff = part(new THREE.ConeGeometry(0.065, 0.42, 5), i % 2 === 0 ? wingColor : crestColor, 0.38 + Math.cos(ang) * 0.16, 1.60, Math.sin(ang) * 0.20);
    ruff.rotation.x = Math.sin(ang) * 0.45;
    ruff.rotation.z = -0.65 - Math.cos(ang) * 0.25;
    g.add(ruff);
  }

  // 2. CỔ & ĐẦU CHIM ƯNG THẦN THOẠI SẮC SẢO VƯƠN CAO
  blob(g, bodyColor, 0.24, [0.85, 1.45, 0.82], 0.46, 1.74, 0, [0, 0, -0.36]);

  const headGroup = new THREE.Group();
  headGroup.position.set(0.70, 2.12, 0);

  // Đầu
  headGroup.add(part(new THREE.SphereGeometry(0.34, 18, 12), bodyColor, 0, 0, 0));

  // Mỏ chim ưng vàng kim cong sắc nhọn (Hooked golden raptor beak)
  const beakMat = new THREE.MeshLambertMaterial({
    color: beakColor,
    emissive: 0xffaa00,
    emissiveIntensity: 0.30,
  });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.48, 8), beakMat);
  beak.position.set(0.42, -0.07, 0);
  beak.rotation.z = -Math.PI / 2 - 0.28;
  headGroup.add(beak);

  const jaw = part(new THREE.ConeGeometry(0.075, 0.35, 6), beakColor, 0.35, -0.16, 0);
  jaw.rotation.z = -Math.PI / 2 - 0.12;
  headGroup.add(jaw);

  // MÀO LỬA 5 CHÓP MẶT TRỜI BỐC CHÁY VƯƠN CAO UY NGHI (Solar Crown Crest Plumes)
  const crestPlumes: [number, number, number, number, number][] = [
    [0, 0.58, 0.90, -0.62, 0xffd600],       // Giữa cao nhất vươn trời
    [0.12, 0.44, 0.75, -0.50, 0xff9100],    // Phải tầng 1
    [-0.12, 0.44, 0.75, -0.50, 0xff9100],   // Trái tầng 1
    [0.22, 0.28, 0.60, -0.38, 0xd50000],    // Phải ngoài
    [-0.22, 0.28, 0.60, -0.38, 0xd50000],   // Trái ngoài
  ];
  for (const [zOff, yPos, length, rotZ, clr] of crestPlumes) {
    const crestMat = new THREE.MeshLambertMaterial({
      color: clr,
      emissive: clr,
      emissiveIntensity: 0.45,
    });
    const cMesh = new THREE.Mesh(new THREE.ConeGeometry(0.075, length, 5), crestMat);
    cMesh.position.set(-0.24, yPos, zOff);
    cMesh.rotation.z = rotZ;
    cMesh.rotation.x = zOff * 0.32;
    headGroup.add(cMesh);
  }

  // Đôi mắt đại bàng vàng rực sắc sảo gắn trên đầu
  addEyes(headGroup, 0.26, 0.06, 0.22, 0.085);
  g.add(headGroup);
  g.userData.head = headGroup;

  // 3. ĐÔI CÁNH LỬA 3 TẦNG SẢI RỘNG RỰC RỠ (Triple-tiered wide sweeping flame wings)
  const phoenixWings: THREE.Group[] = [];
  for (const z of [-0.62, 0.62]) {
    const side = z > 0 ? 1 : -1;
    const wingPivot = new THREE.Group();
    wingPivot.position.set(0.05, 1.30, z);
    wingPivot.userData.origZ = z;
    wingPivot.userData.side = side;

    // Tầng cánh gốc
    blob(wingPivot, wingColor, 0.42, [1.60, 0.68, 0.22], 0, 0, 0, [0, 0, 0.20]);
    // Tầng lông vũ thứ 2
    blob(wingPivot, chestColor, 0.32, [1.50, 0.50, 0.18], -0.27, 0.08, z * -0.02, [0, 0, 0.30]);

    // 6 lưỡi kiếm lông lửa xòe rộng vuốt nhọn về sau phát sáng rực rỡ
    for (let f = 0; f < 6; f++) {
      const bladeColor = f % 2 === 0 ? tailColor : crestColor;
      const bladeMat = new THREE.MeshLambertMaterial({
        color: bladeColor,
        emissive: bladeColor,
        emissiveIntensity: 0.40,
      });
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.095 - f * 0.010, 0.82 - f * 0.08, 6),
        bladeMat
      );
      blade.position.set(-0.25 - f * 0.15, 0.12 - f * 0.05, (z > 0 ? 1 : -1) * (f * 0.04));
      blade.rotation.z = 0.85 + f * 0.16;
      blade.rotation.y = side * (0.24 + f * 0.05);
      blade.rotation.x = side * -0.15;
      wingPivot.add(blade);
    }
    g.add(wingPivot);
    phoenixWings.push(wingPivot);
  }
  g.userData.wings = phoenixWings;

  // 4. BỘ ĐUÔI PHƯỢNG HOÀNG LỬA HUYỀN THOẠI NGẮN GỌN & THIẾT KẾ TINH TẾ
  // 5 dải lông lửa uốn lượn gọn gàng, thon thả phía sau hông, không dài quá khổ
  const gemMat = new THREE.MeshLambertMaterial({
    color: 0xffd700,
    emissive: 0xffea00,
    emissiveIntensity: 0.95,
  });

  const streamersConfig = [
    { zSpread: 0.0, len: 1.50, baseColor: tailColor, midColor: 0xff6d00, tipColor: crestColor }, // Dải trung tâm ngắn gọn
    { zSpread: 0.22, len: 1.25, baseColor: 0xd50000, midColor: wingColor, tipColor: 0xffd600 },   // Dải phải trong
    { zSpread: -0.22, len: 1.25, baseColor: 0xd50000, midColor: wingColor, tipColor: 0xffd600 },  // Dải trái trong
    { zSpread: 0.38, len: 1.05, baseColor: wingColor, midColor: chestColor, tipColor: 0xffea00 }, // Dải phải ngoài
    { zSpread: -0.38, len: 1.05, baseColor: wingColor, midColor: chestColor, tipColor: 0xffea00 },// Dải trái ngoài
  ];

  // Gốc đuôi nối liền khít chắc chắn từ sâu trong hông sau
  blob(g, bodyColor, 0.36, [1.18, 0.82, 0.72], -0.42, 1.18, 0, [0, 0, -0.20]);

  for (const st of streamersConfig) {
    const numBlades = 7; // 7 phiến lông liên tục, ngắn gọn, thanh thoát
    
    for (let i = 0; i < numBlades; i++) {
      const u = i / (numBlades - 1); // 0 -> 1
      const bx = -0.48 - u * st.len; // vuốt ngắn gọn từ -0.48 đến ~ -1.98
      const waveY = Math.sin(u * Math.PI) * 0.15;
      const by = 1.18 - u * 0.20 + waveY;
      const bz = st.zSpread * (0.85 + u * 0.55);

      // Màu chuyển sắc rực lửa: Đỏ son -> Cam lửa -> Vàng hoàng kim
      const bladeColor = u < 0.35 ? st.baseColor : (u < 0.70 ? st.midColor : st.tipColor);
      const bladeScaleX = 1.20 - u * 0.22;
      const bladeScaleY = 0.34 - u * 0.08;
      const bladeScaleZ = 0.22 - u * 0.06;
      const featherRad = 0.19 * (1.0 - u * 0.22);

      const fMat = new THREE.MeshLambertMaterial({
        color: bladeColor,
        emissive: bladeColor,
        emissiveIntensity: 0.30 + u * 0.45,
      });
      const featherMesh = new THREE.Mesh(new THREE.SphereGeometry(featherRad, 10, 8), fMat);
      featherMesh.position.set(bx, by, bz);
      featherMesh.scale.set(bladeScaleX, bladeScaleY, bladeScaleZ);
      featherMesh.rotation.set(st.zSpread * 0.22, 0, 0.12 - u * 0.08);
      g.add(featherMesh);

      // Ở mút cuối mỗi dải: Đính Ngọc Mặt Trời hoàng kim nhỏ xinh và 2 tia lửa đuôi vút nhọn
      if (i === numBlades - 1) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), gemMat);
        gem.position.set(bx - 0.07, by + 0.02, bz);
        g.add(gem);

        for (let sp = -1; sp <= 1; sp += 2) {
          const spark = part(new THREE.ConeGeometry(0.034, 0.25, 4), crestColor, bx - 0.18, by + sp * 0.03, bz + sp * 0.05, {
            emissive: crestColor,
            emissiveIntensity: 0.85,
          });
          spark.rotation.z = Math.PI / 2 + 0.14;
          spark.rotation.y = sp * 0.20;
          g.add(spark);
        }
      }
    }
  }

  // 6. Chân móng vuốt đại bàng hoàng kim vững chắc
  const legs = addLegs(g, beakColor, [[0.05, 0.22], [0.05, -0.22]], 0.62, 0.085);
  legs.forEach((pivot) => {
    // Bắp đùi chim thần nối liền khít thân
    const thigh = part(new THREE.CapsuleGeometry(0.13, 0.26, 6, 8), bodyColor, 0, -0.12, 0, undefined, true);
    pivot.add(thigh);

    // 3 móng vuốt nhọn trước
    for (const a of [-0.28, 0, 0.28]) {
      const talon = part(new THREE.ConeGeometry(0.045, 0.20, 6), 0xffd54f, 0.18, -0.62 + 0.06, a * 0.10);
      talon.rotation.z = -Math.PI / 2;
      talon.rotation.y = a * 0.5;
      pivot.add(talon);
    }
    // 1 cựa sau bám đất
    const spur = part(new THREE.ConeGeometry(0.045, 0.18, 6), 0xffd54f, -0.12, -0.62 + 0.08, 0);
    spur.rotation.z = Math.PI / 2;
    pivot.add(spur);
  });
  return legs;
}

function buildSwan(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0xffffff;
  const neckColor = s.neck ?? 0xfafafa;
  const wingColor = s.wing ?? 0xf5f5f5;
  const billColor = s.bill ?? 0xff6d00;
  const knobColor = s.knob ?? 0x212121;
  const crownColor = s.crown ?? 0xffd700;

  // 1. THÂN THIÊN NGA HÌNH CHIẾC THUYỀN KIỀU DIỄM LƯỚT SÓNG (Graceful Sculpted Swan Hull)
  // Thân capsule thanh tú, thon thả kiêu sa, triệt tiêu hoàn toàn khối tròn ục ịch
  const bodyGeo = new THREE.CapsuleGeometry(0.38, 0.85, 12, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, bodyColor, 0, 1.05, 0, undefined, true);
  bodyMesh.scale.set(1.0, 1.05, 0.90);
  g.add(bodyMesh);

  // Ức thiên nga kiêu hãnh nở nhẹ phía trước
  const chest = part(new THREE.SphereGeometry(0.36, 16, 12), bodyColor, 0.42, 1.15, 0);
  chest.scale.set(1.18, 1.10, 0.86);
  g.add(chest);

  // Khối hông sau thon gọn nâng đỡ gốc đuôi
  const rump = part(new THREE.SphereGeometry(0.34, 16, 12), bodyColor, -0.42, 1.10, 0);
  rump.scale.set(1.10, 1.05, 0.85);
  g.add(rump);

  // ĐUÔI THIÊN NGA XÒE QUẠT LIỀN KHỐI TUYỆT ĐẸP (Graceful Seamless Upturned Fan Tail)
  // Gốc đuôi nối liền khít 100% từ sâu bên trong hông sau, uốn cong vểnh nhẹ kiêu sa
  const tailBase = part(new THREE.SphereGeometry(0.26, 14, 10), bodyColor, -0.62, 1.18, 0);
  tailBase.scale.set(1.20, 0.95, 0.80);
  g.add(tailBase);

  // 7 dải lông vũ xòe quạt xếp lớp mềm mại uốn cong vút cao lên trời (hoàn toàn liền mạch không kẽ hở)
  const fanFeathers: [number, number, number, number, number, number][] = [
    [0, -0.88, 1.35, 0.28, -0.55, 1.85],        // Lông trung tâm dài nhất vút cao
    [0.12, -0.84, 1.30, 0.25, -0.50, 1.65],     // Lông phải trong
    [-0.12, -0.84, 1.30, 0.25, -0.50, 1.65],    // Lông trái trong
    [0.22, -0.78, 1.25, 0.22, -0.45, 1.45],     // Lông phải giữa
    [-0.22, -0.78, 1.25, 0.22, -0.45, 1.45],    // Lông trái giữa
    [0.30, -0.70, 1.20, 0.18, -0.38, 1.25],     // Lông phải ngoài
    [-0.30, -0.70, 1.20, 0.18, -0.38, 1.25],    // Lông trái ngoài
  ];
  for (const [z, x, y, r, rotZ, lenScale] of fanFeathers) {
    const side = z !== 0 ? Math.sign(z) : 0;
    blob(g, wingColor, r, [lenScale, 0.55, 0.28], x, y, z, [side * 0.28, 0, rotZ]);
  }
  // Chóp đuôi vút nhọn thanh tú kiêu sa
  const tailTip = part(new THREE.ConeGeometry(0.09, 0.45, 6), wingColor, -1.02, 1.42, 0);
  tailTip.rotation.z = -1.15;
  g.add(tailTip);

  // 2. CỔ CHỮ S THIÊN NGA KIÊU HÃNH UỐN LƯỢN 4 KHÚC LIỀN MẠCH (Majestic S-curved neck)
  blob(g, neckColor, 0.22, [0.90, 1.40, 0.88], 0.46, 1.30, 0, [0, 0, -0.40]);
  blob(g, neckColor, 0.20, [0.90, 1.38, 0.88], 0.56, 1.62, 0, [0, 0, -0.15]);
  blob(g, neckColor, 0.19, [0.88, 1.35, 0.88], 0.58, 1.94, 0, [0, 0, 0.25]);
  
  // Đầu thiên nga thon gọn thanh tú
  const headGroup = new THREE.Group();
  headGroup.position.set(0.68, 2.22, 0);

  const head = part(new THREE.SphereGeometry(0.26, 18, 14), neckColor, 0, 0, 0);
  head.scale.set(1.10, 1.0, 0.90);
  headGroup.add(head);

  // Vương miện hoàng gia 5 chóp lấp lánh trên đỉnh đầu thiên nga
  const crownBase = part(new THREE.CylinderGeometry(0.12, 0.10, 0.05, 10), crownColor, -0.02, 0.20, 0);
  headGroup.add(crownBase);
  for (let i = 0; i < 5; i++) {
    const ang = (i / 4 - 0.5) * 1.2;
    const spike = part(new THREE.ConeGeometry(0.035, 0.18 + (i === 2 ? 0.08 : 0), 5), crownColor, -0.02 + Math.cos(ang) * 0.08, 0.28, Math.sin(ang) * 0.10);
    headGroup.add(spike);
  }

  // Mấu sừng đen đặc trưng của loài thiên nga (Regal basal knob)
  blob(headGroup, knobColor, 0.075, [1.1, 0.85, 0.95], 0.18, 0.04, 0);

  // Mỏ thiên nga cong thon nhọn quý phái màu cam rực rỡ, chóp mỏ đen viền tinh tế
  const bill = part(new THREE.ConeGeometry(0.10, 0.38, 8), billColor, 0.38, -0.08, 0);
  bill.rotation.z = -Math.PI / 2 - 0.20;
  headGroup.add(bill);
  const billTip = part(new THREE.ConeGeometry(0.055, 0.12, 6), knobColor, 0.54, -0.14, 0);
  billTip.rotation.z = -Math.PI / 2 - 0.20;
  headGroup.add(billTip);

  // Đôi mắt thiên nga
  for (const z of [-0.22, 0.22]) {
    const eyeRing = part(new THREE.TorusGeometry(0.082, 0.018, 6, 14), 0xffd700, 0.10, 0.03, z);
    eyeRing.rotation.y = Math.PI / 2;
    headGroup.add(eyeRing);
  }
  addEyes(headGroup, 0.10, 0.03, 0.22, 0.078);
  g.add(headGroup);
  g.userData.head = headGroup;

  // 3. ĐÔI CÁNH THIÊN NGA XẾP TẦNG LÔNG TUYẾT ÔM SÁT HAI BÊN MẠN SƯỜN
  const swanWings: THREE.Group[] = [];
  for (const z of [-0.46, 0.46]) {
    const side = z > 0 ? 1 : -1;
    const wingPivot = new THREE.Group();
    wingPivot.position.set(-0.05, 1.15, z);
    wingPivot.userData.origZ = z;
    wingPivot.userData.side = side;

    // Tầng cánh chính
    blob(wingPivot, wingColor, 0.40, [1.60, 0.70, 0.22], 0, 0, 0, [0, 0, 0.15]);
    // Tầng lông vũ tơ thứ 2
    blob(wingPivot, bodyColor, 0.28, [1.50, 0.50, 0.16], -0.35, 0.09, z * -0.05, [0, 0, 0.30]);
    // 3 phiến lông bay uốn cong vểnh nhẹ
    for (let f = 0; f < 4; f++) {
      const quill = part(new THREE.ConeGeometry(0.070 - f * 0.010, 0.45 - f * 0.04, 6), wingColor, -0.55 - f * 0.12, 0.15 - f * 0.06, (z > 0 ? 1 : -1) * (f * 0.02));
      quill.rotation.z = 1.05 + f * 0.14;
      quill.rotation.y = side * (0.12 + f * 0.04);
      wingPivot.add(quill);
    }
    g.add(wingPivot);
    swanWings.push(wingPivot);
  }
  g.userData.wings = swanWings;

  // Chân màng thiên nga màu đen/xám thuôn gọn dạng dẹt bơi lội
  const swanLegs = addLegs(g, knobColor, [[0.05, 0.22], [0.05, -0.22]], 0.48, 0.075);
  addDuckWebbedFeet(swanLegs, 0.48, knobColor);
  return swanLegs;
}

function buildRam(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const woolColor = s.wool ?? 0xd7ccc8;
  const faceColor = s.face ?? 0x4e342e;
  const hornColor = s.horn ?? 0x3e2723;
  const hornRingColor = s.hornRing ?? 0x8d6e63;
  const legsColor = s.legs ?? 0x3e2723;
  const plateColor = s.plate ?? 0x5d4037;

  // 1. Armored thick wool coat with battle cuirass
  g.add(part(new THREE.IcosahedronGeometry(0.58, 1), woolColor, 0, 1.20, 0, undefined, true));
  const woolPuffs: [number, number, number][] = [
    [0.44, 1.28, 0.30], [0.44, 1.28, -0.30],
    [-0.44, 1.28, 0.30], [-0.44, 1.28, -0.30],
    [0, 1.58, 0], [0.05, 1.20, 0.48], [0.05, 1.20, -0.48],
    [-0.18, 1.52, 0.24], [-0.18, 1.52, -0.24],
    [0.22, 1.54, 0.20], [0.22, 1.54, -0.20],
  ];
  for (const [x, y, z] of woolPuffs) {
    g.add(part(new THREE.IcosahedronGeometry(0.42, 1), woolColor, x, y, z));
  }
  g.add(part(new THREE.IcosahedronGeometry(0.48, 1), woolColor, 0.48, 1.26, 0));

  // 2. Chiseled Ram Head with heavy metal battering brow plate
  g.add(part(new THREE.BoxGeometry(0.58, 0.54, 0.48), faceColor, 0.84, 1.45, 0));
  blob(g, faceColor, 0.25, [1.2, 0.85, 0.9], 1.10, 1.35, 0);
  g.add(part(new THREE.IcosahedronGeometry(0.26, 1), woolColor, 0.74, 1.78, 0));

  // Steel brow battering plate on forehead
  const browPlate = part(new THREE.BoxGeometry(0.12, 0.38, 0.42), plateColor, 1.12, 1.56, 0);
  browPlate.rotation.z = -0.35;
  g.add(browPlate);
  for (const rz of [-0.14, 0.14]) {
    for (const ry of [-0.10, 0.10]) {
      g.add(part(new THREE.SphereGeometry(0.03, 6, 6), 0xffd700, 1.18, 1.56 + ry, rz));
    }
  }

  // 3. Colossal 4-segment Spiral Horns with gold reinforcing bands
  for (const z of [-0.36, 0.36]) {
    const hornGroup = new THREE.Group();
    hornGroup.position.set(0.80, 1.64, z);

    // Segment 1: base arches up and back
    const s1 = part(new THREE.CylinderGeometry(0.16, 0.22, 0.40, 8), hornColor, -0.12, 0.18, z * 0.12);
    s1.rotation.z = -1.15;
    s1.rotation.y = z > 0 ? 0.35 : -0.35;
    hornGroup.add(s1);

    // Band 1
    const r1 = part(new THREE.TorusGeometry(0.20, 0.04, 8, 16), hornRingColor, -0.06, 0.14, z * 0.08);
    r1.rotation.y = Math.PI / 2;
    hornGroup.add(r1);

    // Segment 2: curls down around cheek
    const s2 = part(new THREE.CylinderGeometry(0.12, 0.16, 0.40, 8), hornColor, -0.28, -0.05, z * 0.24);
    s2.rotation.z = 0.55;
    s2.rotation.x = z > 0 ? -0.45 : 0.45;
    hornGroup.add(s2);

    // Band 2
    const r2 = part(new THREE.TorusGeometry(0.15, 0.035, 8, 16), hornRingColor, -0.24, -0.12, z * 0.26);
    r2.rotation.y = Math.PI / 2;
    hornGroup.add(r2);

    // Segment 3: arches forward
    const s3 = part(new THREE.CylinderGeometry(0.09, 0.12, 0.32, 8), hornColor, -0.14, -0.26, z * 0.28);
    s3.rotation.z = 1.95;
    s3.rotation.y = z > 0 ? -0.30 : 0.30;
    hornGroup.add(s3);

    // Segment 4: sharp forward point
    const tip = part(new THREE.ConeGeometry(0.09, 0.36, 8), hornColor, 0.06, -0.20, z * 0.22);
    tip.rotation.z = 2.45;
    tip.rotation.y = z > 0 ? -0.45 : 0.45;
    hornGroup.add(tip);

    g.add(hornGroup);
  }

  for (const z of [-0.38, 0.38]) {
    blob(g, faceColor, 0.15, [1.1, 0.45, 1.5], 0.76, 1.48, z, [z > 0 ? 0.3 : -0.3, 0, 0]);
  }

  addEyes(g, 1.10, 1.55, 0.19, 0.078);
  const legs = addLegs(g, legsColor, [[0.40, 0.28], [0.40, -0.28], [-0.40, 0.28], [-0.40, -0.28]], 0.72, 0.12, 0x1f1b18);
  for (const pivot of legs) {
    // Bắp đùi lông cừu dày dặn gắn trực tiếp vào pivot chân, vung nhịp nhàng theo bước chạy, tuyệt đối không có thanh cố định dưới bụng
    const haunch = part(new THREE.IcosahedronGeometry(0.18, 1), woolColor, 0, -0.12, 0);
    pivot.add(haunch);
  }
  return legs;
}

function buildBoar(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0x4e342e;
  const crestColor = s.crest ?? 0x271c19;
  const snoutColor = s.snout ?? 0x795548;
  const tuskColor = s.tusk ?? 0xf5f5f5;
  const bellyColor = s.belly ?? 0x6d4c41;
  const legsColor = s.legs ?? 0x271c19;

  // 1. THÂN HÌNH HEO RỪNG DÃ THÚ CƠ BẮP LIỀN MẠCH (Wedge-shaped Muscular Boar Torso)
  // Thân chính dạng capsule mượt mà, triệt tiêu hoàn toàn hiện tượng 2 quả cầu lồi lõm (khoai tây)
  const bodyGeo = new THREE.CapsuleGeometry(0.48, 0.72, 12, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, bodyColor, 0, 1.02, 0, undefined, true);
  bodyMesh.scale.set(1.0, 1.08, 0.95);
  g.add(bodyMesh);

  // Gù vai trước nở to lực lưỡng (muscular hunchback withers) vuốt dốc về hông sau
  const shoulderHump = part(new THREE.SphereGeometry(0.55, 16, 14), bodyColor, 0.22, 1.18, 0, undefined, true);
  shoulderHump.scale.set(1.20, 1.25, 1.08);
  g.add(shoulderHump);

  // Bụng dưới và ức săn chắc
  blob(g, bellyColor, 0.40, [1.32, 0.82, 0.90], 0.05, 0.85, 0);

  // Khớp háng tĩnh 4 chân ôm khít gốc chân, triệt tiêu khe hở
  for (const [hx, hz] of [[0.36, 0.30], [0.36, -0.30], [-0.36, 0.28], [-0.36, -0.28]]) {
    const socket = part(new THREE.SphereGeometry(0.22, 8, 8), bodyColor, hx, 0.98, hz);
    socket.scale.set(1.0, 1.25, 0.95);
    g.add(socket);
  }

  // 2. BỜM LÔNG GAI NHỌN DỰNG ĐỨNG HOANG DÃ DỌC SỐNG LƯNG (Majestic Razorback Mohawk Crest)
  // Chiều cao nhô vút hẳn lên trời (y từ 1.55 lên tới 2.12), đảm bảo nhìn góc nào cũng thấy sống lưng gai góc dũng mãnh
  const ridgeColor = (crestColor === 0x000000 || crestColor === 0x212121) ? 0x3d2b27 : crestColor;
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const rx = -0.56 + t * 1.38; // từ khấu đuôi qua đỉnh gù vai đến đỉnh đầu
    const ry = 1.62 + Math.sin(t * Math.PI) * 0.46; // Đỉnh bờm vươn cao tới y = 2.08!
    const rHeight = 0.48 + Math.sin(t * Math.PI) * 0.22;
    const rRad = 0.09 - Math.abs(t - 0.5) * 0.025;

    const bristle = part(new THREE.ConeGeometry(rRad, rHeight, 5), ridgeColor, rx, ry, 0);
    bristle.rotation.z = -0.40 + (t - 0.5) * 0.35;
    g.add(bristle);

    // Cặp gai tơ hai bên sống lưng tạo bờm xù xì dày dặn hoang dã
    for (const z of [-0.10, 0.10]) {
      const sub = part(new THREE.ConeGeometry(rRad * 0.75, rHeight * 0.72, 4), ridgeColor, rx - 0.03, ry - 0.08, z);
      sub.rotation.z = -0.38;
      sub.rotation.x = z > 0 ? 0.36 : -0.36;
      g.add(sub);
    }
  }

  // 3. ĐẦU HEO RỪNG HÌNH NÊM SẮC SẢO & MÕM TỰ NHIÊN (Chiseled Wedge Boar Skull & Snout)
  // Cổ gáy dày dặn vươn chéo xuống đầu
  blob(g, bodyColor, 0.42, [1.38, 1.15, 0.92], 0.58, 1.12, 0, [0, 0, -0.24]);

  // Hộp sọ heo rừng
  const skull = part(new THREE.SphereGeometry(0.36, 16, 12), bodyColor, 0.86, 1.10, 0);
  skull.scale.set(1.15, 1.0, 0.92);
  g.add(skull);

  // Sống mũi heo rừng vuốt dốc nối mượt mà từ trán xuống mõm
  const snoutBridge = part(new THREE.CylinderGeometry(0.18, 0.30, 0.46, 10), snoutColor, 1.18, 0.98, 0);
  snoutBridge.rotation.z = -Math.PI / 2 - 0.12;
  g.add(snoutBridge);

  // Đĩa mõm sừng dẹt mềm mại ôm khít đầu mũi (triệt tiêu 100% cảm giác bánh xe phẳng lì lơ lửng)
  const snoutDisc = part(new THREE.CylinderGeometry(0.16, 0.18, 0.09, 14), ridgeColor, 1.42, 0.94, 0);
  snoutDisc.rotation.z = -Math.PI / 2 - 0.12;
  g.add(snoutDisc);

  // 2 lỗ mũi heo rừng sâu rõ nét
  for (const nz of [-0.065, 0.065]) {
    blob(g, 0x111111, 0.038, [0.8, 1.3, 0.9], 1.46, 0.94, nz);
  }

  // 4. CẶP RĂNG NANH HEO RỪNG TIẾN HOÁ UỐN CONG VÚT NGƯỢC LÊN TRÊN (Loại bỏ hoàn toàn nanh quặp xuống cằm)
  const tuskMatOpts = { roughness: 0.25, metalness: 0.15 };
  for (const z of [-0.24, 0.24]) {
    const side = z > 0 ? 1 : -1;
    const tuskGroup = new THREE.Group();
    // Gốc nanh cắm chắc vào khóe hàm dưới của mõm heo
    tuskGroup.position.set(1.16, 0.86, z);

    // Gốc nanh ngà bọc khóe mép hàm dưới
    const rootSocket = part(new THREE.SphereGeometry(0.075, 8, 8), snoutColor, 0, 0, 0);
    rootSocket.scale.set(1.1, 0.8, 1.1);
    tuskGroup.add(rootSocket);

    // Đốt 1 nanh dưới: vươn chéo ra trước và hơi ngửa lên
    const tuskBase = part(new THREE.CylinderGeometry(0.062, 0.080, 0.24, 8), tuskColor, 0.08, 0.08, side * 0.035, tuskMatOpts);
    tuskBase.rotation.z = -0.72;
    tuskBase.rotation.x = side * 0.25;
    tuskGroup.add(tuskBase);

    // Đốt 2 nanh dưới: vuốt nhọn cong vút ngược lên trên và choãi ra ngoài ôm sát má
    const tuskTip = part(new THREE.ConeGeometry(0.062, 0.34, 8), tuskColor, 0.20, 0.24, side * 0.075, tuskMatOpts);
    tuskTip.rotation.z = -1.15;
    tuskTip.rotation.x = side * 0.42;
    tuskGroup.add(tuskTip);

    g.add(tuskGroup);
  }

  // 5. ĐÔI TAI HEO RỪNG NHỌN VỂNH CẢNH GIÁC & MẮT HỔ PHÁCH HUNG TỢN
  for (const z of [-0.30, 0.30]) {
    const side = z > 0 ? 1 : -1;
    const ear = part(new THREE.ConeGeometry(0.11, 0.36, 6), ridgeColor, 0.62, 1.52, z);
    ear.rotation.x = side * 0.42;
    ear.rotation.z = -0.30;
    g.add(ear);
    // Lòng tai hồng đất da thú
    const innerEar = part(new THREE.ConeGeometry(0.075, 0.28, 5), bellyColor, 0.64, 1.52, z * 0.92);
    innerEar.rotation.x = side * 0.42;
    innerEar.rotation.z = -0.30;
    g.add(innerEar);
  }

  // Gờ mày gồ cao và đôi mắt heo rừng hổ phách tinh anh
  for (const z of [-0.24, 0.24]) {
    blob(g, ridgeColor, 0.11, [1.2, 0.6, 0.7], 0.98, 1.25, z, [0, 0, -0.26]);
  }
  addEyes(g, 1.02, 1.20, 0.26, 0.075);

  // Đuôi heo rừng nhỏ ngắn vểnh có chùm lông ở chóp
  const tailStem = part(new THREE.CylinderGeometry(0.04, 0.05, 0.35, 6), bodyColor, -0.82, 1.05, 0);
  tailStem.rotation.z = 0.52;
  g.add(tailStem);
  const tailBrush = part(new THREE.ConeGeometry(0.085, 0.24, 6), ridgeColor, -0.98, 1.18, 0);
  tailBrush.rotation.z = 1.55;
  g.add(tailBrush);

  // 4 CHÂN HEO RỪNG CƠ BẮP: PIVOT NỐI LIỀN THÂN, CÓ BẮP ĐÙI XOAY ĐỒNG BỘ TRIỆT TIÊU KHE HỞ
  const legPts: [number, number][] = [[0.36, 0.30], [0.36, -0.30], [-0.36, 0.28], [-0.36, -0.28]];
  const legs = addLegs(g, legsColor, legPts, 0.75, 0.13, 0x14100e);
  legs.forEach((pivot) => {
    const upperThigh = part(new THREE.CapsuleGeometry(0.16, 0.32, 6, 8), bodyColor, 0, -0.16, 0, undefined, true);
    upperThigh.scale.set(1.15, 1.0, 1.0);
    pivot.add(upperThigh);
  });
  return legs;
}

function buildPegasus(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0xffffff;
  const wingColor = s.wing ?? 0xffffff;
  const maneColor = s.mane ?? 0xffd700;
  const hoofColor = s.hoof ?? 0xffd700;
  const featherTipColor = s.featherTip ?? 0xfff9c4;

  // 1. THÂN HÌNH THIÊN MÃ KỲ LÂN BẠCH KIM THANH THOÁT, KIÊU DŨNG (Celestial Divine Steed Torso)
  // Thân capsule liền mạch quý phái, không bao giờ có bất kỳ dải băng quấn bụng hay yên ngựa thô kệch
  const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.88, 12, 16);
  bodyGeo.rotateZ(Math.PI / 2);
  const bodyMesh = part(bodyGeo, bodyColor, 0, 1.34, 0, undefined, true);
  bodyMesh.scale.set(1.0, 1.08, 0.92);
  g.add(bodyMesh);

  // Ức chim thần nở cao vạm vỡ và hông mông cơ bắp tròn đầy
  blob(g, bodyColor, 0.35, [1.18, 1.08, 0.95], 0.38, 1.40, 0);
  blob(g, bodyColor, 0.36, [1.12, 1.06, 0.92], -0.38, 1.36, 0);

  // Khớp háng tĩnh 4 chân bao bọc thân quanh 4 điểm pivot
  for (const [hx, hz] of [[0.48, 0.22], [0.48, -0.22], [-0.48, 0.22], [-0.48, -0.22]]) {
    const socket = part(new THREE.SphereGeometry(0.19, 10, 10), bodyColor, hx, 1.26, hz);
    socket.scale.set(1.0, 1.25, 0.98);
    g.add(socket);
  }

  // Cổ ngựa thần vươn cao kiêu hãnh (Arched majestic celestial neck)
  const neckGeo = new THREE.CapsuleGeometry(0.17, 0.60, 8, 14);
  const neck = part(neckGeo, bodyColor, 0.72, 1.86, 0);
  neck.rotation.z = -0.52;
  g.add(neck);

  // Đầu ngựa thần thon gọn quý phái (Noble celestial head)
  const headGeo = new THREE.CapsuleGeometry(0.15, 0.44, 8, 14);
  headGeo.rotateZ(Math.PI / 2);
  const head = part(headGeo, bodyColor, 1.15, 2.26, 0);
  head.rotation.z = -0.26;
  g.add(head);

  // Mũi và lỗ mũi thiên mã
  blob(g, featherTipColor, 0.075, [1.2, 0.8, 1.0], 1.36, 2.20, 0);
  for (const nz of [-0.055, 0.055]) {
    blob(g, 0xd4af37, 0.03, [1, 1, 1], 1.39, 2.22, nz);
  }

  // 2. SỪNG KỲ LÂN XOẮN ỐC HOÀNG KIM PHÁT SÁNG MA THUẬT (Spiral Luminous Alicorn Horn)
  const hornMat: Partial<THREE.MeshStandardMaterialParameters> = {
    emissive: 0xffd700,
    emissiveIntensity: 0.90,
    roughness: 0.15,
    metalness: 0.85,
  };
  // Thân sừng kỳ lân xoắn vuốt nhọn vút cao 45 độ từ trán
  const horn = part(new THREE.ConeGeometry(0.065, 0.72, 12), maneColor, 1.36, 2.70, 0, hornMat);
  horn.rotation.z = -0.58;
  g.add(horn);

  // Vòng xoắn ốc ánh kim quang quấn quanh sừng
  for (let r = 0; r < 5; r++) {
    const ringRad = 0.058 - r * 0.009;
    const ring = part(
      new THREE.TorusGeometry(ringRad, 0.014, 6, 16),
      0xffffff,
      1.26 + r * 0.08,
      2.52 + r * 0.13,
      0,
      { emissive: 0xffea00, emissiveIntensity: 0.95 }
    );
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = -0.58;
    g.add(ring);
  }

  // 3. BỜM KỲ LÂN HOÀNG KIM SUÔN MƯỢT BỒNG BỀNH QUÉT TỪ TRÁN XUỐNG GÁY
  // Bờm trán vươn dài (forelock) rủ nhẹ giữa hai mắt
  const forelock = part(new THREE.ConeGeometry(0.075, 0.38, 6), maneColor, 1.25, 2.42, 0);
  forelock.rotation.z = -1.25;
  g.add(forelock);
  // Bờm đỉnh đầu giữa 2 tai
  const pollMane = part(new THREE.CapsuleGeometry(0.08, 0.32, 6, 8), maneColor, 1.00, 2.45, 0);
  pollMane.rotation.z = -0.38;
  g.add(pollMane);
  // 6 tầng bờm hoàng kim uốn lượn thướt tha mềm mại dọc theo sống cổ
  for (let i = 0; i < 6; i++) {
    blob(g, maneColor, 0.14, [1.65, 0.52, 0.28], 0.75 - i * 0.13, 2.26 - i * 0.14, 0.04, [0.08, 0, -0.52 - i * 0.04]);
  }

  // Đôi tai tuấn mã thanh mảnh nhọn vểnh
  for (const z of [-0.11, 0.11]) {
    const ear = part(new THREE.ConeGeometry(0.06, 0.22, 8), bodyColor, 0.98, 2.52, z);
    ear.rotation.z = -0.20;
    ear.rotation.x = z > 0 ? 0.22 : -0.22;
    g.add(ear);
  }

  // 4. ĐÔI CÁNH THIÊN THẦN ARCHANGEL XÒE RỘNG LỘNG LẪY (Grand Feathered Archangel Wings)
  // Gắn liền khít vào khớp vai lưng thân ngựa (x: 0.08, y: 1.48, z: ±0.34), triệt tiêu hoàn toàn 2 cây cột capsule to thô
  const wingMatGlow = { emissive: 0xfff9c4, emissiveIntensity: 0.22 };
  const pegasusWings: THREE.Group[] = [];
  for (const z of [-0.34, 0.34]) {
    const side = z > 0 ? 1 : -1;
    const wingGroup = new THREE.Group();
    // Tọa độ gắn liền khít với sống lưng và bả vai tuấn mã
    wingGroup.position.set(0.08, 1.48, z);
    wingGroup.rotation.y = side * 0.18;
    wingGroup.rotation.x = side * -0.08;
    wingGroup.userData.origZ = z;
    wingGroup.userData.side = side;

    // Khớp vai cánh cơ bắp nối liền mượt mà từ lưng
    blob(wingGroup, wingColor, 0.22, [1.35, 0.85, 0.45], 0, 0, 0, [0, 0, 0.25]);

    // Tầng 1: Lớp lông vũ tơ ôm sát khớp vai cánh (Coverts)
    for (let c = 0; c < 4; c++) {
      blob(wingGroup, wingColor, 0.16, [0.65, 0.95 - c * 0.08, 0.22], -0.10 - c * 0.10, 0.18 + c * 0.06, side * 0.04, [0, 0, 0.38 + c * 0.08]);
    }

    // Tầng 2: Các phiến lông vũ đại bàng vươn cao và xòe cong mềm mại ra sau (Archangel Wings)
    for (let f = 0; f < 6; f++) {
      const fColor = f % 2 === 0 ? wingColor : featherTipColor;
      const fLen = 0.85 - f * 0.06;
      const feather = part(new THREE.ConeGeometry(0.060 - f * 0.005, fLen, 6), fColor, -0.16 - f * 0.11, 0.42 + f * 0.08, side * 0.03, wingMatGlow);
      feather.scale.set(1.15, 1.0, 0.32); // Phiến lông vũ dẹt mỏng lượn cong thanh thoát
      feather.rotation.z = 0.85 + f * 0.18;
      feather.rotation.y = side * (0.12 + f * 0.04);
      feather.rotation.x = side * -0.12;
      wingGroup.add(feather);
    }

    // Gốc khớp cánh đính ngọc hoàng kim bảo hộ
    blob(wingGroup, featherTipColor, 0.11, [1.2, 0.65, 0.35], 0.05, 0.06, 0, undefined);
    g.add(wingGroup);
    pegasusWings.push(wingGroup);
  }
  g.userData.wings = pegasusWings;

  // 5. ĐUÔI THIÊN MÃ HOÀNG KIM DÀI THƯỚT THA UỐN LƯỢN CHẠM ĐẤT
  blob(g, maneColor, 0.18, [0.60, 2.9, 0.35], -0.90, 1.22, 0, [0, 0, 0.42]);
  blob(g, featherTipColor, 0.15, [0.50, 2.5, 0.28], -0.96, 1.10, 0.10, [0.16, 0, 0.48]);
  blob(g, featherTipColor, 0.15, [0.50, 2.5, 0.28], -0.96, 1.10, -0.10, [-0.16, 0, 0.48]);

  // Đôi mắt thiên mã to tròn tinh anh có viền sáng long lanh
  for (const z of [-0.18, 0.18]) {
    const eyeRing = part(new THREE.TorusGeometry(0.075, 0.015, 6, 14), 0xffd700, 1.25, 2.36, z);
    eyeRing.rotation.y = Math.PI / 2;
    g.add(eyeRing);
  }
  addEyes(g, 1.25, 2.36, 0.18, 0.080);

  // 6. 4 CHÂN THIÊN MÃ LIỀN KHÍT THÂN: PIVOT ĂN SÂU Y=1.28, BẮP ĐÙI XOAY ĐỒNG BỘ, MÓNG VÀNG CÓ LÔNG PHỦ CỔ CHÂN
  const legPts: [number, number][] = [[0.48, 0.22], [0.48, -0.22], [-0.48, 0.22], [-0.48, -0.22]];
  const legs = addLegs(g, bodyColor, legPts, 1.28, 0.105, hoofColor);
  legs.forEach((pivot) => {
    // Bắp đùi trên xoay đồng bộ cùng chân che khít 100% khớp háng
    const upperThigh = part(new THREE.CapsuleGeometry(0.15, 0.45, 6, 10), bodyColor, 0, -0.22, 0, undefined, true);
    upperThigh.scale.set(1.15, 1.0, 1.0);
    pivot.add(upperThigh);

    // Lông phủ cổ chân (Feathered Fetlocks) hoàng kim gắn trên pivot
    const fetlock = part(new THREE.SphereGeometry(0.12, 8, 8), featherTipColor, 0, -1.05, 0);
    fetlock.scale.set(1.15, 0.75, 1.15);
    pivot.add(fetlock);
  });
  return legs;
}

function buildBull(g: THREE.Group, s: Record<string, number>): THREE.Group[] {
  const bodyColor = s.body ?? 0x1b1c1e;
  const shoulderColor = s.shoulder ?? 0x111213;
  const hornColor = s.horn ?? 0xffd700;
  const snoutColor = s.snout ?? 0x3e2723;
  const ringColor = s.ring ?? 0xffd700;
  const plateColor = s.plate ?? 0x424242;

  // 1. Massive Colossal Titan Torso with heavy gladiator harness
  blob(g, shoulderColor, 0.64, [1.32, 1.18, 1.22], 0.36, 1.66, 0, undefined, true);
  blob(g, bodyColor, 0.68, [1.44, 1.08, 1.16], -0.06, 1.38, 0);
  blob(g, bodyColor, 0.58, [1.18, 1.00, 1.05], -0.50, 1.32, 0);

  // Giáp vai chiến binh giác đấu ôm sát lưng trên (không dùng vòng tròn lọt xuống đáy bụng)
  const shoulderPlate = part(new THREE.BoxGeometry(0.65, 0.12, 0.98), plateColor, 0.32, 1.95, 0);
  shoulderPlate.rotation.z = -0.15;
  g.add(shoulderPlate);

  // 2. Heavy Neck & Gladiator Head
  blob(g, shoulderColor, 0.48, [1.20, 1.20, 1.10], 0.74, 1.50, 0);
  g.add(part(new THREE.BoxGeometry(0.68, 0.64, 0.58), bodyColor, 1.08, 1.58, 0));
  g.add(part(new THREE.BoxGeometry(0.38, 0.38, 0.50), snoutColor, 1.42, 1.42, 0));

  // Gladiator steel brow plate
  const brow = part(new THREE.BoxGeometry(0.10, 0.28, 0.52), plateColor, 1.38, 1.68, 0);
  brow.rotation.z = -0.32;
  g.add(brow);

  // Heavy golden nose ring
  const noseRing = part(new THREE.TorusGeometry(0.14, 0.04, 8, 20), ringColor, 1.58, 1.32, 0);
  noseRing.rotation.y = Math.PI / 2;
  g.add(noseRing);

  // 3. Colossal inward-curved arena gladiator horns (Sừng bò cong vào trong uy mãnh, đồng trục khít khao)
  for (const z of [-0.42, 0.42]) {
    const side = z > 0 ? 1 : -1;
    const hornGroup = new THREE.Group();
    hornGroup.position.set(1.05, 1.82, z);
    hornGroup.rotation.z = -0.92;
    hornGroup.rotation.x = side * 0.45;

    // Đốt 1: Gốc sừng vươn ra ngoài và hơi chúc về phía trước
    const hornBase = part(new THREE.CylinderGeometry(0.14, 0.18, 0.42, 8), hornColor, 0, 0.21, 0);
    hornGroup.add(hornBase);

    // Vòng thép bọc khớp sừng 1
    const hRing = part(new THREE.TorusGeometry(0.155, 0.032, 8, 16), plateColor, 0, 0.42, 0);
    hRing.rotation.x = Math.PI / 2;
    hornGroup.add(hRing);

    // Đốt 2: Khớp uốn cong hướng vào trong tâm trán
    const midPivot = new THREE.Group();
    midPivot.position.set(0, 0.42, 0);
    midPivot.rotation.x = -side * 0.45; // Cong vào trong
    midPivot.rotation.z = -0.18; // Uốn cong về phía trước

    const hornMid = part(new THREE.CylinderGeometry(0.075, 0.14, 0.42, 8), hornColor, 0, 0.21, 0);
    midPivot.add(hornMid);

    // Vòng thép nẹp chóp sừng
    const cRing = part(new THREE.TorusGeometry(0.082, 0.02, 8, 16), plateColor, 0, 0.42, 0);
    cRing.rotation.x = Math.PI / 2;
    midPivot.add(cRing);

    // Đốt 3: Chóp thép bọc đỉnh sừng uốn cong vút nhọn vào trong đối diện nhau
    const tipPivot = new THREE.Group();
    tipPivot.position.set(0, 0.42, 0);
    tipPivot.rotation.x = -side * 0.42; // Cong quặp mạnh vào trong
    tipPivot.rotation.z = -0.12;

    const cap = part(new THREE.ConeGeometry(0.072, 0.32, 8), plateColor, 0, 0.16, 0);
    tipPivot.add(cap);

    midPivot.add(tipPivot);
    hornGroup.add(midPivot);

    g.add(hornGroup);
    blob(g, bodyColor, 0.20, [1.4, 0.5, 0.7], 0.98, 1.72, z * 1.25, [0, side * 0.3, 0]);
  }

  // 2 Lỗ mũi to khỏe thở ra khói
  for (const nz of [-0.12, 0.12]) {
    blob(g, 0x1a0f0d, 0.055, [1.1, 0.85, 0.85], 1.58, 1.36, nz);
  }

  // Tail with thick tuft
  const tail = part(new THREE.CylinderGeometry(0.045, 0.055, 0.85, 6), bodyColor, -0.80, 1.08, 0);
  tail.rotation.z = 0.25;
  g.add(tail);
  blob(g, shoulderColor, 0.15, [0.85, 2.1, 0.85], -0.92, 0.62, 0);

  // Tròng mắt màu đỏ rực lửa săn mồi uy nghiêm
  const eyeScleraMat = animalMat(0xd50000, { emissive: 0xff1744, emissiveIntensity: 1.25, roughness: 0.1 });
  const eyeIrisMat = animalMat(0xffea00, { emissive: 0xffd600, emissiveIntensity: 0.85, roughness: 0.1 });
  for (const z of [-0.25, 0.25]) {
    const eyeSclera = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10), eyeScleraMat);
    eyeSclera.position.set(1.28, 1.65, z);
    eyeSclera.scale.set(1.3, 0.8, 0.55);
    eyeSclera.userData.eye = true;
    g.add(eyeSclera);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 8), eyeIrisMat);
    pupil.position.set(1.34, 1.65, z);
    pupil.scale.set(0.6, 1.2, 0.55);
    pupil.userData.eye = true;
    g.add(pupil);
  }
  // Chân bò dũng mãnh, vòng giáp chân được gắn trực tiếp vào pivot chân đồng bộ khi chạy (không lơ lửng dưới bụng)
  const legs = addLegs(g, bodyColor, [[0.46, 0.34], [0.46, -0.34], [-0.44, 0.32], [-0.44, -0.32]], 0.82, 0.15, 0x111111);
  for (const pivot of legs) {
    const cuff = part(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 10), plateColor, 0, -0.42, 0);
    pivot.add(cuff);
  }
  return legs;
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
  monkey: buildMonkey,
  gorilla: buildGorilla,
  mammoth: buildMammoth,
  wolf: buildWolf,
  phoenix: buildPhoenix,
  swan: buildSwan,
  ram: buildRam,
  boar: buildBoar,
  pegasus: buildPegasus,
  bull: buildBull,
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
    case 'elephant':
    case 'mammoth': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.046, 8, 24), mat);
      band.position.set(0.74, 1.50, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.3;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), goldMat);
      medal.position.set(0.88, 1.36, 0);
      g.add(medal);
      break;
    }
    case 'monkey': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.034, 8, 24), mat);
      band.position.set(0.12, 1.28, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.18;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), goldMat);
      medal.position.set(0.26, 1.20, 0);
      g.add(medal);
      break;
    }
    case 'gorilla': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 8, 24), mat);
      band.position.set(0.48, 1.38, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.35;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), goldMat);
      medal.position.set(0.62, 1.25, 0);
      g.add(medal);
      break;
    }
    case 'wolf': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.042, 8, 24), mat);
      band.position.set(0.58, 1.40, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.38;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), goldMat);
      medal.position.set(0.74, 1.24, 0);
      g.add(medal);
      break;
    }
    case 'phoenix': {
      // Phượng Hoàng Lửa thần thoại không đeo vòng collar thú cưng
      break;
    }
    case 'swan': {
      // Thiên Nga quý phái không đeo vòng collar thú cưng (yêu cầu người dùng)
      break;
    }
    case 'ram': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 8, 24), mat);
      band.position.set(0.62, 1.35, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.25;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), goldMat);
      medal.position.set(0.78, 1.25, 0);
      g.add(medal);
      break;
    }
    case 'boar': {
      // Heo Rừng dũng mãnh đã có giáp cổ sắt với gai nhọn riêng, không đeo vòng collar thú cưng
      break;
    }
    case 'pegasus': {
      // Thiên Mã Kỳ Lân không đeo vòng collar thú cưng
      break;
    }
    case 'bull': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.052, 8, 24), mat);
      band.position.set(0.75, 1.48, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = 0.38;
      g.add(band);
      const medal = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 8), goldMat);
      medal.position.set(0.95, 1.35, 0);
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
  monkey: [0.12, 1.95],
  gorilla: [0.58, 2.15],
  mammoth: [1.02, 2.30],
  wolf: [0.80, 1.98],
  phoenix: [0.70, 2.30],
  swan: [0.68, 2.45],
  ram: [0.82, 1.85],
  boar: [0.85, 1.80],
  pegasus: [1.26, 2.75],
  bull: [1.05, 2.10],
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
  monkey: [-0.15, 1.10, 0.45, 0.45, 1.0],
  gorilla: [-0.15, 1.45, 0.65, 0.65, 1.35],
  mammoth: [-0.15, 1.55, 0.70, 0.70, 1.45],
  wolf: [-0.15, 1.25, 0.62, 0.62, 1.22],
  phoenix: [-0.20, 1.10, 0.65, 0.65, 1.05],
  swan: [-0.20, 1.05, 0.65, 0.65, 1.15],
  ram: [-0.15, 1.25, 0.70, 0.70, 1.20],
  boar: [-0.20, 1.30, 0.75, 0.75, 1.35],
  pegasus: [-0.20, 1.55, 0.50, 0.50, 1.35],
  bull: [-0.15, 1.45, 0.75, 0.75, 1.45],
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
    monkey: 0.16,
    gorilla: 0.22,
    mammoth: 0.28,
    wolf: 0.22,
    phoenix: 0.18,
    swan: 0.16,
    ram: 0.22,
    boar: 0.22,
    pegasus: 0.18,
    bull: 0.26,
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
    monkey: 0.06,
    gorilla: 0.08,
    mammoth: 0.10,
    wolf: 0.08,
    phoenix: 0.08,
    swan: 0.08,
    ram: 0.08,
    boar: 0.08,
    pegasus: 0.10,
    bull: 0.10,
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
  const yOffset = (species === 'elephant' || species === 'mammoth') ? 0.18 : species === 'horse' ? 0.22 : species === 'cow' ? 0.18 : 0.14;
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
  monkey: 2.2,
  gorilla: 2.6,
  mammoth: 2.8,
  wolf: 2.4,
  phoenix: 2.5,
  swan: 2.6,
  ram: 2.3,
  boar: 2.3,
  pegasus: 2.9,
  bull: 2.6,
};

export function createLabel(text: string, crowned = false, traitor = false, isMe = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 40px ${LABEL_FONT}`;
  ctx.font = font;

  // Đo độ rộng chữ và bù đắp an toàn cho emoji trên iOS / iPadOS Safari (nơi measureText thường đo thiếu emoji)
  const measured = ctx.measureText(text).width;
  let emojiCount = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0x2000) emojiCount++;
  }
  const emojiSafety = emojiCount * 44;
  const padding = 56 + emojiSafety;
  const w = Math.max(160, Math.ceil(measured + padding));
  const h = 64;

  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const centerY = h / 2;

  if (crowned || traitor) {
    ctx.fillStyle = crowned ? '#e8b641' : '#a5281b';
    ctx.fillRect(0, 6, w, 52);
    ctx.fillStyle = crowned ? '#1f1a17' : '#f2ead7';
    ctx.fillText(text, w / 2, centerY);
  } else {
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isMe ? 'rgba(25, 20, 15, 0.95)' : 'rgba(31, 26, 23, 0.75)';
    ctx.strokeText(text, w / 2, centerY);
    ctx.fillStyle = isMe ? '#ffd54f' : '#f2ead7';
    ctx.fillText(text, w / 2, centerY);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.aspect = w / h;
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

interface GroundCrack {
  group: THREE.Group;
  matDark: THREE.MeshBasicMaterial;
  matGlow: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  baseRadius: number;
  life: number;
  maxLife: number;
  active: boolean;
}

function buildGroundCrackMesh(matDark: THREE.Material, matGlow: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  const darkPositions: number[] = [];
  const glowPositions: number[] = [];
  const branches = 12;

  for (let b = 0; b < branches; b++) {
    const baseAngle = (b / branches) * Math.PI * 2 + ((b % 2 === 0) ? 0.08 : -0.08);
    const length = 0.75 + (b % 3 === 0 ? 0.35 : b % 2 === 0 ? 0.2 : 0.1);
    const segs = 4;
    let cx = 0, cz = 0;
    let angle = baseAngle;

    for (let s = 0; s < segs; s++) {
      const segLen = length / segs;
      angle += ((s % 2 === 0 ? 1 : -1) * 0.28) + (b % 2 === 0 ? 0.1 : -0.1);
      const nx = cx + Math.cos(angle) * segLen;
      const nz = cz + Math.sin(angle) * segLen;

      const dx = nx - cx;
      const dz = nz - cz;
      const d = Math.hypot(dx, dz) || 1;
      const px = -dz / d;
      const pz = dx / d;

      const wDark = Math.max(0.04, (1 - (s / segs)) * 0.16);
      const wGlow = Math.max(0.02, (1 - (s / segs)) * 0.06);

      darkPositions.push(
        cx + px * wDark, 0, cz + pz * wDark,
        nx + px * wDark * 0.7, 0, nz + pz * wDark * 0.7,
        cx - px * wDark, 0, cz - pz * wDark,

        cx - px * wDark, 0, cz - pz * wDark,
        nx + px * wDark * 0.7, 0, nz + pz * wDark * 0.7,
        nx - px * wDark * 0.7, 0, nz - pz * wDark * 0.7
      );

      glowPositions.push(
        cx + px * wGlow, 0.002, cz + pz * wGlow,
        nx + px * wGlow * 0.7, 0.002, nz + pz * wGlow * 0.7,
        cx - px * wGlow, 0.002, cz - pz * wGlow,

        cx - px * wGlow, 0.002, cz - pz * wGlow,
        nx + px * wGlow * 0.7, 0.002, nz + pz * wGlow * 0.7,
        nx - px * wGlow * 0.7, 0.002, nz - pz * wGlow * 0.7
      );

      cx = nx;
      cz = nz;
    }
  }

  const darkGeo = new THREE.BufferGeometry();
  darkGeo.setAttribute('position', new THREE.Float32BufferAttribute(darkPositions, 3));
  const darkMesh = new THREE.Mesh(darkGeo, matDark);
  darkMesh.renderOrder = 4;
  grp.add(darkMesh);

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPositions, 3));
  const glowMesh = new THREE.Mesh(glowGeo, matGlow);
  glowMesh.renderOrder = 5;
  grp.add(glowMesh);

  return grp;
}

export class AnimalRenderer {
  public myId = 0;
  private readonly visuals = new Map<number, AnimalVisual>();
  private readonly group = new THREE.Group();
  private readonly shockwavePool: ShockwaveRing[] = [];
  private readonly waterRipplePool: WaterRipple[] = [];
  private readonly groundCrackPool: GroundCrack[] = [];

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

    // Ground cracks pool for Gorilla leap slam
    for (let i = 0; i < 16; i++) {
      const matDark = new THREE.MeshBasicMaterial({
        color: 0x180f08,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const matGlow = new THREE.MeshBasicMaterial({
        color: 0xff5722,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const group = buildGroundCrackMesh(matDark, matGlow);
      group.visible = false;
      this.scene.add(group);
      this.groundCrackPool.push({
        group,
        matDark,
        matGlow,
        x: 0,
        z: 0,
        baseRadius: 1,
        life: 0,
        maxLife: 2.4,
        active: false,
      });
    }
  }

  onPuff?: (x: number, y: number, z: number, color: number, size?: number, life?: number, vy?: number) => void;
  onRainbowTrail?: (x: number, y: number, z: number, angle: number, r: number, isDash: boolean) => void;
  onSonicWave?: (x: number, y: number, z: number, r: number) => void;
  onSmokePoof?: (x: number, y: number, z: number, r?: number, count?: number) => void;
  onWindTrail?: (x: number, y: number, z: number, angle: number, r: number, speed: number) => void;

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
        const sc = sw.baseRadius * (0.85 + k * 0.45);
        sw.mesh.scale.setScalar(sc);
        sw.mat.opacity = (1 - k) * 0.85;
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

  spawnGroundCracks(x: number, z: number, r: number): void {
    let gc = this.groundCrackPool.find((c) => !c.active);
    if (!gc) gc = this.groundCrackPool[0];
    gc.active = true;
    gc.x = x;
    gc.z = z;
    gc.baseRadius = r;
    gc.life = 0;
    gc.maxLife = 2.4;
    gc.matDark.opacity = 0.95;
    gc.matGlow.opacity = 0.90;
    gc.group.position.set(x, 0.05, z);
    gc.group.scale.set(r * 0.35, 1, r * 0.35);
    gc.group.visible = true;
  }

  updateGroundCracks(dt: number): void {
    for (const gc of this.groundCrackPool) {
      if (!gc.active) continue;
      gc.life += dt;
      if (gc.life >= gc.maxLife) {
        gc.active = false;
        gc.group.visible = false;
      } else {
        const k = gc.life / gc.maxLife;
        const expandProg = Math.min(1, gc.life / 0.12);
        const curR = gc.baseRadius * (0.35 + 0.65 * Math.sqrt(expandProg));
        gc.group.scale.set(curR, 1, curR);
        gc.matDark.opacity = Math.max(0, (1 - Math.pow(k, 1.3)) * 0.95);
        gc.matGlow.opacity = Math.max(0, (1 - k * 1.5) * 0.90);
      }
    }
  }

  notifyThrow(id: number): void {
    const vis = this.visuals.get(id);
    if (vis) {
      vis.throwTimer = 0.32;
    }
  }

  notifyWolfBite(id: number): void {
    const vis = this.visuals.get(id);
    if (vis) {
      vis.wolfBiteTimer = 0.24;
    }
  }

  notifyLeap(id: number, dur: number, height: number, isBounce = false): void {
    const vis = this.visuals.get(id);
    if (vis) {
      const now = performance.now();
      if (isBounce) {
        // Cú nhảy nảy quán tính do server xác nhận va chạm trực tiếp với con vật khác: reset timer để nảy tiếp
        vis.leapDur = dur;
        vis.leapHeight = height;
        vis.leapTimer = 0;
        vis.leapDone = false;
        vis.leapActive = true;
        vis.lastLeapStart = now;
      } else {
        // Cú nhảy ban đầu: chặn tuyệt đối kích hoạt trùng lặp khi đang nhảy hoặc vừa mới nhảy xong
        const minCooldownMs = ((vis.leapDur || dur) * 1000) + 250;
        if (vis.leapActive || (vis.lastLeapStart && (now - vis.lastLeapStart) < minCooldownMs)) {
          vis.leapDur = dur;
          vis.leapHeight = height;
          return;
        }
        vis.leapDur = dur;
        vis.leapHeight = height;
        vis.leapTimer = 0;
        vis.leapDone = false;
        vis.leapActive = true;
        vis.lastLeapStart = now;
      }
    }
  }

  syncLeapParams(id: number, dur: number, height: number): void {
    const vis = this.visuals.get(id);
    if (vis) {
      vis.leapDur = dur;
      vis.leapHeight = height;
    }
  }

  getVisual(id: number, meta?: PlayerMeta): AnimalVisual | undefined {
    let vis = this.visuals.get(id);
    let speciesChanged = false;
    let oldX = 0, oldY = 0, oldZ = 0, oldR = 1.8;
    if (vis && meta && vis.species !== meta.species) {
      speciesChanged = true;
      oldX = vis.lastX;
      oldY = vis.visualY || 0;
      oldZ = vis.lastZ;
      oldR = Math.max(1.4, (vis.root.scale.x / 1.35) || 1.8);
      this.remove(id);
      vis = undefined;
    }
    if (!vis && meta) {
      const isMe = id === this.myId;
      vis = this.buildAnimal(meta, isMe);
      if (speciesChanged) {
        vis.morphTimer = 1.6;
        this.onSmokePoof?.(oldX, oldY + 0.8, oldZ, oldR, 42);
        this.spawnShockwave(oldX, oldY + 0.08, oldZ, oldR * 1.5, 0xffffff);
        // Kích hoạt âm thanh biến hình và tiếng kêu đặc trưng của con vật
        sfxEvolveFanfare(meta.species, isMe ? 1.0 : computeSpatialVolume(oldX, oldZ, 0.75), oldX, oldZ);
      }
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

  triggerSundaySummon(duration = 1.5, kingId?: number): void {
    for (const [id, vis] of this.visuals) {
      if (kingId !== undefined && id === kingId) continue;
      vis.summonRingTimer = duration;
      vis.summonTotalDur = duration;
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
    const isSafeSwimmer = vis.species === 'duck' || vis.species === 'swan' || vis.species === 'dog' || vis.species === 'wolf' || vis.species === 'pegasus';
    const isDrowning = (flags & 64) !== 0 && !isSafeSwimmer;
    const isSuper = (flags & FLAG.SUPER) !== 0;
    const isFlying = (flags & FLAG.FLYING) !== 0;
    const isSquished = (flags & FLAG.SQUISHED) !== 0;
    const isWheel = (flags & FLAG.WHEEL) !== 0;
    const isTreeShake = (flags & FLAG.TREE_SHAKE) !== 0;
    const isMammothRoar = (flags & FLAG.MAMMOTH_ROAR) !== 0;
    const isTossed = (flags & FLAG.TOSSED) !== 0;
    const isBurning = (flags & FLAG.BURNING) !== 0;
    const lvl = (charge || 0) / 10;
    const isEvolved = isEvolvedSpecies(vis.species);

    if (vis.leapActive) {
      vis.leapTimer = (vis.leapTimer || 0) + dt;
      if (vis.leapTimer >= (vis.leapDur || 0.7)) {
        vis.leapActive = false;
        vis.leapDone = true;
        vis.leapTimer = 0;
        vis.leapDur = undefined;
        vis.leapHeight = undefined;
      }
    }
    const isLeapingVisual = !!vis.leapActive;
    const isMonkeyLeap = isLeapingVisual;

    // Smooth squish factor transition: fast flatten on impact (dt * 16), gentle cartoon pop back up (dt * 5)
    vis.squishFactor = isSquished
      ? Math.min(1, (vis.squishFactor || 0) + dt * 16)
      : Math.max(0, (vis.squishFactor || 0) - dt * 5);
    const sq = vis.squishFactor || 0;

    setRainbow(vis, isSuper, now);

    // Continuous walking / dashing leg phase accumulation (elephant has slower strides; mud creates sluggish heavy stepping)
    const legFreqMult = (vis.species === 'elephant' || vis.species === 'mammoth') ? 0.5 : 1.0;
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

    // State change & upgrade: Super Rainbow mode
    if (isSuper && !vis.wasSuper) {
      this.onSmokePoof?.(x, y + 0.8, z, r * 1.4, 34);
      this.spawnShockwave(x, y + 0.08, z, r * 1.6, 0xffffff);
      vis.morphTimer = 0.6;
    } else if (!isSuper && vis.wasSuper) {
      this.onSmokePoof?.(x, y + 0.6, z, r * 1.1, 20);
    }
    vis.wasSuper = isSuper;

    // State change & upgrade: Wheel Cart transformation
    if (isWheel && !vis.wasWheel) {
      this.onSmokePoof?.(x, y + 0.8, z, r * 1.5, 36);
      this.spawnShockwave(x, y + 0.08, z, r * 1.7, 0xffffff);
    } else if (!isWheel && vis.wasWheel) {
      this.onSmokePoof?.(x, y + 0.8, z, r * 1.3, 28);
      this.spawnShockwave(x, y + 0.08, z, r * 1.4, 0xffffff);
    }
    vis.wasWheel = isWheel;

    // State change & upgrade: King coronation
    if (isKing && !vis.wasKing) {
      this.onSmokePoof?.(x, y + 1.0, z, r * 1.6, 36);
      this.spawnShockwave(x, y + 0.08, z, r * 1.8, 0xffd700);
      this.spawnShockwave(x, y + 0.12, z, r * 1.4, 0xffffff);
    }
    vis.wasKing = isKing;

    if (isWater && !isSuper) {
      vis.waterT = Math.min(3.0, (vis.waterT || 0) + dt);
    } else {
      vis.waterT = Math.max(0, (vis.waterT || 0) - dt * 3.5);
    }

    // Maximum water duration is 1.5s
    const sinkProgress = Math.min(1, (vis.waterT || 0) / 1.5);

    // Visual sinking effect reduced by 25%
    const inWaterShrink = isWater && !isSuper && vis.species !== 'duck' && vis.species !== 'swan' && vis.species !== 'dog' && vis.species !== 'wolf' && vis.species !== 'pegasus'
      ? Math.max(0.72, 1 - sinkProgress * 0.28)
      : 1;

    if (isWater && !isSuper) {
      if (vis.species === 'duck' || vis.species === 'swan') {
        // Vịt & Thiên Nga bơi nằm yên phẳng lặng trên mặt nước, giữ nguyên vị trí ổn định
        y = -0.15 * sc;
      } else if (vis.species === 'pegasus') {
        // Pegasus lướt nhẹ trên mặt nước
        y = 0.25 * sc;
      } else if (vis.species === 'dog' || vis.species === 'wolf') {
        // Chó & Sói bơi với phần đầu và lưng nổi trên mặt nước vững vàng, nằm yên phẳng lặng
        y = -0.32 * sc;
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

    // Body hopping & positioning: lướt mượt mà khi húc (isDashing), nhún bước chân nhẹ nhàng khi đi bộ
    const isGroundHopping = !isLeapingVisual && (!isWater || isSuper);
    const hopHeight = isDashing ? 0.05 : 0.10;
    let bodyY = y + (isGroundHopping ? Math.abs(Math.sin(vis.phase)) * hopHeight * r : 0);
    // Monkey bipedal bobbing run
    if (vis.species === 'monkey' && !isLeapingVisual && !isWater && speed > 0.02) {
      bodyY += Math.abs(Math.sin(vis.phase * 1.3)) * 0.15 * r;
    }
    // Gorilla knuckle-walking swagger & bobbing
    if (vis.species === 'gorilla' && !isLeapingVisual && !isWater && speed > 0.02) {
      bodyY += Math.abs(Math.sin(vis.phase * 0.9)) * 0.13 * r;
    }
    // Super Leap parabolic arc (chuẩn quỹ đạo ném xiên không rơi sớm, bay vọt qua chướng ngại vật mượt mà)
    if (isLeapingVisual) {
      const dur = vis.leapDur || 0.7;
      const progress = Math.min(1.0, (vis.leapTimer || 0) / dur);
      const arc = Math.sin(progress * Math.PI);
      const peakH = vis.leapHeight || (vis.species === 'gorilla' ? 5.5 + 2.5 * r : 4.0 + 2.0 * r);
      bodyY += arc * peakH;
    }
    if (isFlying) {
      const flyH = (vis.species === 'swan' || vis.species === 'pegasus' || vis.species === 'phoenix') ? (3.5 * r + 1.2) : (1.2 * r);
      bodyY += flyH;
    }
    if (isTossed) {
      bodyY += 4.5 * sc + Math.sin(now * 0.01) * 0.4 * sc;
    }
    if (sq > 0) bodyY = (y + 0.05) * sq + bodyY * (1 - sq);
    vis.root.position.set(x, bodyY, z);
    vis.root.rotation.y = -angle + (isStunned && sq <= 0.4 ? Math.sin(now / 50) * 0.5 : 0);
    if (isTossed) {
      vis.root.rotation.x = Math.sin(now * 0.012) * 2.2;
      vis.root.rotation.z = Math.cos(now * 0.01) * 1.5;
    } else {
      vis.root.rotation.x = 0;
    }
    if (isBurning && Math.random() < 0.35) {
      this.onPuff?.(x + (Math.random() - 0.5) * r, bodyY + Math.random() * r, z + (Math.random() - 0.5) * r, 0xff3d00, 1.2, 0.4);
    }

    const isThrowing = (vis.throwTimer !== undefined && vis.throwTimer > 0);

    // Lean forward on dash/plow/flying, lean back on charge, struggle tilt in water, dazed sway when stunned
    const targetRotZ = isThrowing
      ? 0
      : sq > 0.4
      ? Math.sin(now / 120) * 0.05
      : isStunned
      ? Math.sin(now / 90) * 0.15
      : isMonkeyLeap
      ? -0.45
      : isTreeShake
      ? 0.25
      : isFlying
      ? 0.02
      : isPlowing
      ? (vis.species === 'mammoth' ? 0 : vis.species === 'bull' ? (Math.sin(now / 70) * 0.35 + 0.15) : -0.4)
      : isDashing
      ? (vis.species === 'mammoth' ? 0 : vis.species === 'bull' ? (Math.sin(now / 70) * 0.35 + 0.15) : -0.25)
      : isWater && isSafeSwimmer
      ? 0 // Khóa cứng nằm yên trên mặt nước, không chao đảo tới lui
      : isDrowning
      ? Math.sin(now / 180) * 0.3
      : isWater
      ? Math.sin(now / 120) * 0.15
      : isCharging
      ? (vis.species === 'mammoth' ? 0 : 0.15 + lvl * 0.15)
      : 0;

    vis.root.rotation.z += (targetRotZ - vis.root.rotation.z) * Math.min(1, 16 * dt);
    if (isWater && isSafeSwimmer) {
      vis.root.rotation.z = 0; // Triệt tiêu 100% chao đảo Z khi bơi
      vis.root.rotation.x = 0; // Triệt tiêu 100% chao đảo X khi bơi
    }

    if (isDrowning && sq <= 0.4) {
      // Gentle side-to-side flailing
      vis.root.rotation.x = Math.sin(now / 200) * 0.2;
    } else if (isMud && !isSuper && speed > 0.02 && sq <= 0.4) {
      // Gentle subtle wobble as animal trudges through deep mud
      vis.root.rotation.x = Math.sin(vis.phase * 0.6) * 0.04;
      vis.root.rotation.z += Math.sin(vis.phase * 0.3) * 0.03;
    } else if (vis.species === 'gorilla' && !isMonkeyLeap && !isWater && !isThrowing && speed > 0.02 && sq <= 0.4) {
      // Gorilla walking shoulder roll
      vis.root.rotation.x = Math.sin(vis.phase * 0.9) * 0.08;
    }

    // Charge trembling wind-up (không rung lắc toàn thân đối với voi mammoth)
    if (isCharging && vis.species !== 'mammoth') {
      vis.root.position.x += (Math.random() - 0.5) * 0.18 * lvl * r;
      vis.root.position.z += (Math.random() - 0.5) * 0.18 * lvl * r;
    }

    // Squash & stretch & water shrinking (nén gồng sâu hơn)
    const squash = isCharging ? (vis.species === 'mammoth' ? 1 - 0.22 * lvl : 1 - 0.24 * lvl) : 1;
    let baseSx = sc * inWaterShrink * (isPlowing ? 1.25 : isDashing ? 1.15 : 1 + 0.1 * lvl);
    let baseSy = sc * inWaterShrink * (isDashing ? 0.9 : squash);
    let baseSz = sc * inWaterShrink;

    // Morphing evolution animation (e.g. monkey -> gorilla)
    if (vis.morphTimer && vis.morphTimer > 0) {
      vis.morphTimer = Math.max(0, vis.morphTimer - dt);
      const morphProg = Math.min(1, Math.max(0, 1 - vis.morphTimer / 1.6)); // 0 to 1
      // Elastic overshoot bounce: swells up dramatically then settles with weighty punch
      let morphScale = 1.0;
      if (morphProg < 0.22) {
        morphScale = 0.90 + morphProg * 1.6; // 0.90 -> 1.25
      } else {
        const k = (morphProg - 0.22) / 0.78;
        morphScale = 1.0 + Math.sin(k * Math.PI) * 0.38 * Math.exp(-k * 2.2);
      }
      baseSx *= morphScale;
      baseSy *= morphScale;
      baseSz *= morphScale;
      // Billowing white smoke clouds swirling around the morphing animal!
      if (this.onPuff && Math.random() < 0.72) {
        const whiteCol = Math.random() < 0.65 ? 0xffffff : (Math.random() < 0.5 ? 0xf1f5f9 : 0xe2e8f0);
        this.onPuff(
          x + (Math.random() - 0.5) * 1.6 * r,
          0.3 + Math.random() * 1.8 * r,
          z + (Math.random() - 0.5) * 1.6 * r,
          whiteCol,
          (1.1 + Math.random() * 0.7) * r,
          0.75 + Math.random() * 0.45,
          1.8 + Math.random() * 1.4
        );
      }
      if (this.onPuff && Math.random() < 0.25) {
        const pColor = Math.random() < 0.5 ? 0xffd700 : 0xffee58;
        this.onPuff(
          x + (Math.random() - 0.5) * 1.4 * r,
          0.6 + Math.random() * 1.6 * r,
          z + (Math.random() - 0.5) * 1.4 * r,
          pColor,
          0.45 * r,
          0.6,
          2.4
        );
      }
    }

    if (sq > 0) {
      // Flattened like a pancake by Farmer Till's tractor or Gorilla leap slam!
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
      vis.root.position.y += hk * 1.5; // Khi bị húc nảy tung lên cao hơn
    } else if (vis.species !== 'gorilla' || speed <= 0.02) {
      vis.root.rotation.x = 0;
    }

    // Dynamic shield aura visual when IMMUNITY flag is active
    const isShielded = (flags & FLAG.IMMUNITY) !== 0;
    if (isShielded) {
      if (!vis.shieldAura) {
        const auraGeo = new THREE.SphereGeometry(1.4, 16, 12);
        const auraMat = new THREE.MeshBasicMaterial({
          color: 0x00e676,
          transparent: true,
          opacity: 0.35,
          wireframe: true,
        });
        vis.shieldAura = new THREE.Mesh(auraGeo, auraMat);
        vis.shieldAura.position.y = 1.0;
        vis.root.add(vis.shieldAura);
      }
      vis.shieldAura.visible = true;
      vis.shieldAura.rotation.y = now * 0.003;
      vis.shieldAura.rotation.z = now * 0.002;
    } else if (vis.shieldAura) {
      vis.shieldAura.visible = false;
    }

    if (vis.heartAura) {
      vis.heartAura.visible = false;
    }

    // Aerodynamic speed boost indicator
    const isSpeedBoost = (flags & FLAG.SPEED_BOOST) !== 0;
    if (vis.windWhirlMesh) {
      vis.windWhirlMesh.visible = false;
    }

    // Dynamic leg swinging with amplitude 0.7
    const gorillaCycle = Math.sin(vis.phase * 0.9);
    vis.legs.forEach((leg, idx) => {
      if (isWater && isSafeSwimmer) {
        leg.visible = false;
        leg.rotation.z = 0;
        leg.rotation.x = 0;
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
      } else if (isDrowning || (isWater && vis.species !== 'duck' && vis.species !== 'swan')) {
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
      } else if (isMonkeyLeap) {
        leg.rotation.z = 0.35;
        leg.rotation.x = idx % 2 === 0 ? 0.15 : -0.15;
        leg.position.y = leg.userData.origY;
      } else if (isFlying) {
        // Legs tucked backwards neatly against underbelly during flight glide
        leg.rotation.z = 0.55;
        leg.rotation.x = idx % 2 === 0 ? 0.08 : -0.08;
        leg.position.y = leg.userData.origY + 0.04 * sc;
      } else if (vis.species === 'gorilla') {
        // Gorilla hind legs step in diagonal synchronization with knuckle arms
        leg.rotation.z = (idx === 0 ? -gorillaCycle : gorillaCycle) * 0.55;
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      } else {
        leg.rotation.z = baseSwing * 0.7;
        leg.rotation.x = 0;
        leg.position.y = leg.userData.origY;
      }
    });

    // Monkey and Gorilla arms dynamic animation
    if (vis.arms && vis.arms.length === 2) {
      const [armL, armR] = vis.arms;
      if (vis.throwTimer && vis.throwTimer > 0) {
        vis.throwTimer = Math.max(0, vis.throwTimer - dt);
        const throwProg = 1 - vis.throwTimer / 0.32;
        if (vis.species === 'gorilla') {
          // Gorilla throws banana smoothly using right arm without body jerk
          armR.rotation.z = -0.28 + Math.sin(throwProg * Math.PI) * (-1.35);
          armR.rotation.x = -0.12 - Math.sin(throwProg * Math.PI) * 0.35;
          armL.rotation.z = -0.28;
          armL.rotation.x = 0.12;
        } else {
          // Monkey throws banana using right arm
          armR.rotation.z = Math.sin(throwProg * Math.PI) * (-1.45);
          armR.rotation.x = -0.12 - Math.sin(throwProg * Math.PI) * 0.35;
          armL.rotation.z = 0.2;
          armL.rotation.x = 0.12;
        }
      } else if (vis.species === 'gorilla') {
        if (isTreeShake) {
          // Requirement 2: Gorilla shakes tree vigorously for 3s
          const shakeVibe = Math.sin(now * 0.05) * 0.45;
          armL.rotation.z = -1.25 + shakeVibe;
          armR.rotation.z = -1.25 + shakeVibe;
          armL.rotation.x = 0.25;
          armR.rotation.x = -0.25;
          // Body vibrations shaking the trunk
          vis.root.position.x += (Math.random() - 0.5) * 0.09 * r;
          vis.root.position.z += (Math.random() - 0.5) * 0.09 * r;
        } else if (isMonkeyLeap) {
          // Gorilla devastating ground slam leap posture
          armL.rotation.z = -1.6;
          armR.rotation.z = -1.6;
          armL.rotation.x = 0.38;
          armR.rotation.x = -0.38;
        } else if (isCharging) {
          // Chest-beating windup before leap!
          const beat = Math.sin(now * 0.035);
          armL.rotation.z = -0.7 + beat * 0.45;
          armR.rotation.z = -0.7 - beat * 0.45;
          armL.rotation.x = 0.35;
          armR.rotation.x = -0.35;
        } else if (isStunned || sq > 0.3) {
          armL.rotation.z = 0.7;
          armR.rotation.z = 0.7;
          armL.rotation.x = Math.PI / 3;
          armR.rotation.x = -Math.PI / 3;
        } else if (speed > 0.02) {
          // Knuckle-walking arm swing: diagonal stride with hind legs
          armL.rotation.z = -0.28 + gorillaCycle * 0.48;
          armR.rotation.z = -0.28 - gorillaCycle * 0.48;
          armL.rotation.x = 0.15;
          armR.rotation.x = -0.15;
        } else {
          // Idle stance: resting firmly on knuckles
          armL.rotation.z = -0.28;
          armR.rotation.z = -0.28;
          armL.rotation.x = 0.12;
          armR.rotation.x = -0.12;
        }
      } else {
        if (isTreeShake) {
          // Both hands grip and shake the tree vigorously
          const shakeVibe = Math.sin(now * 0.04) * 0.35;
          armL.rotation.z = -1.25 + shakeVibe;
          armR.rotation.z = -1.25 + shakeVibe;
          armL.rotation.x = 0.25;
          armR.rotation.x = -0.25;
        } else if (isMonkeyLeap) {
          // Athletic superhero leap posture
          armL.rotation.z = -1.45;
          armR.rotation.z = -1.45;
          armL.rotation.x = 0.35;
          armR.rotation.x = -0.35;
        } else if (isCharging) {
          // Winding up muscles before leap
          armL.rotation.z = 0.45 * lvl;
          armR.rotation.z = 0.45 * lvl;
          armL.rotation.x = 0.2;
          armR.rotation.x = -0.2;
        } else if (isStunned || sq > 0.3) {
          armL.rotation.z = 0.8;
          armR.rotation.z = 0.8;
          armL.rotation.x = Math.PI / 3;
          armR.rotation.x = -Math.PI / 3;
        } else {
          // Natural bipedal running swing (opposite to legs)
          const armSwing = Math.sin(vis.phase) * 0.65;
          armL.rotation.z = -armSwing;
          armR.rotation.z = armSwing;
          armL.rotation.x = 0.12;
          armR.rotation.x = -0.12;
        }
      }
    }

    // Wing flapping and soaring animation for flying animals (Phoenix, Swan, Pegasus)
    if (vis.wings && vis.wings.length === 2) {
      const [leftWing, rightWing] = vis.wings;
      if (isFlying) {
        const flapRate = vis.species === 'phoenix' ? 0.016 : vis.species === 'swan' ? 0.012 : 0.014;
        const flapCycle = Math.sin(now * flapRate);
        const soarAngle = 0.45;
        const flapAmp = 0.55;
        leftWing.rotation.x = soarAngle + flapCycle * flapAmp;
        rightWing.rotation.x = -soarAngle - flapCycle * flapAmp;
        const pitchFlap = Math.cos(now * flapRate) * 0.14;
        leftWing.rotation.z = 0.10 + pitchFlap;
        rightWing.rotation.z = 0.10 + pitchFlap;
        leftWing.rotation.y = Math.sin(now * flapRate) * 0.08;
        rightWing.rotation.y = -Math.sin(now * flapRate) * 0.08;
      } else if (speed > 0.05 || isDashing) {
        const runFlap = Math.sin(vis.phase * 1.2) * 0.22;
        leftWing.rotation.x = THREE.MathUtils.lerp(leftWing.rotation.x, 0.12 + runFlap, 12 * dt);
        rightWing.rotation.x = THREE.MathUtils.lerp(rightWing.rotation.x, -0.12 - runFlap, 12 * dt);
        leftWing.rotation.z = THREE.MathUtils.lerp(leftWing.rotation.z, 0, 10 * dt);
        rightWing.rotation.z = THREE.MathUtils.lerp(rightWing.rotation.z, 0, 10 * dt);
      } else {
        leftWing.rotation.x = THREE.MathUtils.lerp(leftWing.rotation.x, 0, 8 * dt);
        rightWing.rotation.x = THREE.MathUtils.lerp(rightWing.rotation.x, 0, 8 * dt);
        leftWing.rotation.z = THREE.MathUtils.lerp(leftWing.rotation.z, 0, 8 * dt);
        rightWing.rotation.z = THREE.MathUtils.lerp(rightWing.rotation.z, 0, 8 * dt);
        leftWing.rotation.y = THREE.MathUtils.lerp(leftWing.rotation.y, 0, 8 * dt);
        rightWing.rotation.y = THREE.MathUtils.lerp(rightWing.rotation.y, 0, 8 * dt);
      }
    }

    // Monkey multi-segment tail smooth sinusoidal sway
    if (vis.tailSegments && vis.tailSegments.length > 0) {
      vis.tailSegments.forEach((seg, i) => {
        if (i > 0) {
          seg.rotation.z = -0.32 + Math.sin(now * 0.005 + i * 0.45) * 0.12;
          seg.rotation.x = Math.cos(now * 0.004 + i * 0.4) * 0.08;
        }
      });
    }

    // Mammoth dynamic head, trunk, and roar animation
    if (vis.species === 'mammoth') {
      if (isMammothRoar) {
        // Mighty roar blast: giữ tư thế uy nghi nâng ngực, đưa cao đầu và vòi lên trời
        vis.body.rotation.z = 0.18;
        if (vis.head) {
          vis.head.rotation.z = 0.50; // đầu ngẩng cao uy phong
        }
        if (vis.trunk) {
          vis.trunk.rotation.z = 1.45; // vòi uốn cong vút lên trời
          vis.trunk.rotation.y = 0;
        }
      } else if (isCharging) {
        // Nén gồng: nén cơ thể và đưa cao đầu và vòi lên 1 lần êm ái theo mức gồng (lvl: 0 -> 1), không giật/khựng, không chúi đầu xuống đất
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.rotation.z = 0.12 * t; // nâng ngực hơi ngửa đón lực nén
        if (vis.head) {
          vis.head.rotation.z = 0.45 * t; // nâng đầu lên cao mượt mà không chúi
        }
        if (vis.trunk) {
          vis.trunk.rotation.z = 1.35 * t; // nâng vòi lên cao mượt mà
          vis.trunk.rotation.y = 0;
        }
      } else {
        // Natural gentle swaying trunk while walking or idle
        vis.body.rotation.z = 0;
        if (vis.head) vis.head.rotation.z = 0;
        if (vis.trunk) {
          const sway = Math.sin(vis.phase) * 0.16;
          vis.trunk.rotation.z = sway * 0.6;
          vis.trunk.rotation.y = Math.sin(now * 0.003) * 0.06;
        }
      }
    } else if (vis.trunk) {
      // Elephant trunk sway
      const sway = Math.sin(vis.phase) * 0.16;
      vis.trunk.rotation.z = sway * 0.6;
      vis.trunk.rotation.y = Math.sin(now * 0.003) * 0.06;
    } else if (vis.species === 'wolf') {
      const isWolfFrenzy = (flags & FLAG.WOLF_FRENZY) !== 0;
      if (vis.wolfBiteTimer && vis.wolfBiteTimer > 0) {
        vis.wolfBiteTimer = Math.max(0, vis.wolfBiteTimer - dt);
        const biteProg = 1 - vis.wolfBiteTimer / 0.24;
        const snap = Math.sin(biteProg * Math.PI);
        vis.body.position.x = snap * 0.36;
        vis.body.rotation.z = -snap * 0.25;
        if (vis.head) {
          vis.head.rotation.z = -snap * 0.35;
          vis.head.rotation.x = Math.sin(biteProg * Math.PI * 2) * 0.22;
        }
      } else if (isCharging) {
        // Sói hạ thấp trọng tâm gồng mình chuẩn bị vồ mồi
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = -0.14 * t;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0.14 * t;
        if (vis.head) {
          vis.head.rotation.z = -0.18 * t;
          vis.head.rotation.x = 0;
        }
      } else if (isWolfFrenzy) {
        const snap = Math.sin(now * 0.045);
        vis.body.position.x = 0.15;
        vis.body.position.y = 0;
        vis.body.rotation.z = -0.15;
        if (vis.head) {
          vis.head.rotation.z = snap * 0.25;
          vis.head.rotation.x = Math.cos(now * 0.045) * 0.18;
        }
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
        if (vis.head) {
          vis.head.rotation.z = 0;
          vis.head.rotation.x = 0;
        }
      }
    } else if (vis.species === 'phoenix') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = 0.08 * t;
        vis.body.position.y = -0.06 * t;
        vis.body.rotation.z = -0.22 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
    } else if (vis.species === 'swan') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = -0.06 * t;
        vis.body.position.y = 0.04 * t;
        vis.body.rotation.z = 0.22 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
    } else if (vis.species === 'ram') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = 0.12 * t;
        vis.body.position.y = -0.06 * t;
        vis.body.rotation.z = -0.32 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
    } else if (vis.species === 'boar') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = 0.10 * t;
        vis.body.position.y = -0.14 * t * r;
        vis.body.rotation.z = -0.22 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
    } else if (vis.species === 'pegasus') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = -0.08 * t;
        vis.body.position.y = 0.08 * t * r;
        vis.body.rotation.z = 0.28 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
    } else if (vis.species === 'bull') {
      if (isCharging) {
        const t = Math.min(1, Math.max(0, lvl));
        vis.body.position.x = 0.14 * t;
        vis.body.position.y = -0.08 * t * r;
        vis.body.rotation.z = -0.35 * t;
      } else {
        vis.body.position.x = 0;
        vis.body.position.y = 0;
        vis.body.rotation.z = 0;
      }
      // Lỗ mũi bò thở ra khói (Snorting smoke puffs from nostrils)
      vis.bullSmokeTimer = (vis.bullSmokeTimer || 0) + dt;
      const smokeInterval = (isCharging || isDashing || isSuper) ? 0.08 : 0.22;
      if (vis.bullSmokeTimer >= smokeInterval) {
        vis.bullSmokeTimer = 0;
        const cosA = Math.cos(-angle);
        const sinA = Math.sin(-angle);
        for (const nz of [-0.12, 0.12]) {
          const nx = 1.58 * sc;
          const ny = 1.36 * sc;
          const wx = x + (nx * cosA - nz * sc * sinA);
          const wy = bodyY + ny;
          const wz = z + (nx * sinA + nz * sc * cosA);
          const puffCol = isSuper ? (Math.random() < 0.5 ? 0xff80ab : 0x80d8ff) : (Math.random() < 0.4 ? 0xf5f5f5 : 0xe0e0e0);
          this.onPuff?.(wx, wy, wz, puffCol, (isCharging ? 0.55 : 0.38) * r, 0.45, 1.2);
        }
      }
    } else {
      vis.body.position.x = 0;
      vis.body.position.y = 0;
      vis.body.rotation.z = 0;
      if (vis.head) {
        vis.head.rotation.z = 0;
        vis.head.rotation.x = 0;
      }
    }
    // Đảm bảo tuyệt đối vis.body.position.z luôn luôn bằng 0, không bao giờ bị lệch tâm gốc
    vis.body.position.z = 0;

    // Head leveling for flying animals: counter-rotates body pitch so head remains upright and looking forward
    if (vis.head && isFlying) {
      vis.head.rotation.z = -vis.root.rotation.z;
      vis.head.rotation.x = 0;
    }

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
      const starY = (sq > 0.3 ? y + 0.45 : y + sc * 2.3) + (isFlying ? (bodyY - y) : 0);
      vis.stars.position.set(x, starY, z);
      vis.stars.rotation.y = now / 150;
    } else if (vis.stars) {
      vis.stars.visible = false;
    }

    // Dust particles
    vis.dust -= dt;
    if (vis.dust <= 0) {
      if (isMonkeyLeap) {
        // Vệt bụi nhỏ tracking theo Khỉ và Gorilla theo vòng cung khi nhảy (nhỏ nhẹ cho khỉ giống cú húc, to hơn chút cho gorilla)
        vis.dust = 0.035;
        const isGorilla = vis.species === 'gorilla';
        const tailOff = r * 0.85;
        const emitX = x - Math.cos(angle) * tailOff + (Math.random() - 0.5) * 0.18 * r;
        const emitY = bodyY + 0.15 * sc + (Math.random() - 0.5) * 0.12 * r;
        const emitZ = z - Math.sin(angle) * tailOff + (Math.random() - 0.5) * 0.18 * r;

        const dustCol = isSuper
          ? (Math.random() < 0.5 ? 0xff80df : 0x80d8ff)
          : (Math.random() < 0.5 ? 0xebdcc4 : 0xd8c09a);
        const dustSize = isGorilla
          ? (1.05 + Math.random() * 0.3) * r
          : (0.65 + Math.random() * 0.25) * r;

        this.onPuff?.(
          emitX,
          emitY,
          emitZ,
          dustCol,
          dustSize,
          isGorilla ? 0.38 : 0.28,
          0.02
        );
      } else if (isWater && vis.species !== 'duck' && vis.species !== 'swan') {
        vis.dust = 0.32; // 25% less frequent
        this.onPuff?.(x - Math.cos(angle) * r, 0.12, z - Math.sin(angle) * r, 0xbfe3ff, 0.55 * r, 0.5, 0.8);
      } else if (isCharging) {
        vis.dust = Math.max(0.015, 0.05 - lvl * 0.034);
        const d = r * (1.5 + lvl * 1.4);
        const ang = Math.random() * Math.PI * 2;
        const pColors = isSuper
          ? [0x00e5ff, 0xff4081, 0xffd700, 0x76ff03, 0xff1744]
          : (isEvolved
            ? [0xffd54f, 0xffa000, 0xff7043]
            : (lvl >= 1 ? [0xffea00, 0xffd54f, 0xffa000] : [0xfff3a0, 0xffd54f, 0xffca28]));
        const chosenCol = pColors[Math.floor(Math.random() * pColors.length)];
        this.onPuff?.(
          x + Math.cos(ang) * d,
          smoothBaseY + 0.15 + Math.random() * 0.4 * r,
          z + Math.sin(ang) * d,
          chosenCol,
          (0.55 + lvl * 0.45) * r,
          0.45,
          1.6 + lvl * 1.2
        );
        // Chỉ Thần Thú hoặc Siêu Cấp gồng mới phát sóng xung kích tụ lực, con vật nhỏ giữ tụ lực vàng tự nhiên như cũ
        if (isSuper && lvl >= 0.7 && Math.random() < 0.26) {
          const swCol = 0xff4081;
          this.spawnShockwave(x, smoothBaseY + 0.08, z, r * (1.1 + lvl * 0.7), swCol);
        }
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

    // CHỈ KHI ĂN KẸO CẦU VỒNG (isSuper = true) MỚI CÓ HIỆU ỨNG LƯỚT CẦU VỒNG & SÓNG ÂM CẦU VỒNG
    // Thú tiến hóa (isEvolved) khi lướt hoặc nhảy giữ nguyên dải khói bụi đất (onPuff) phía sau như cũ
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
      // Powerful sonic wave shockwave ripples when Super Rainbow
      if (isDashing || isFlying) {
        vis.shockwaveTimer = (vis.shockwaveTimer || 0) + dt;
        if (vis.shockwaveTimer >= 0.045) {
          vis.shockwaveTimer = 0;
          const RAINBOW_SHOCK_COLORS = [0xff1744, 0xff9100, 0xffea00, 0x00e676, 0x00b0ff, 0xd500f9];
          const swColor = RAINBOW_SHOCK_COLORS[Math.floor(Math.random() * RAINBOW_SHOCK_COLORS.length)];
          if (!isMonkeyLeap) this.spawnShockwave(x, y + 0.08, z, r * 1.6, swColor);
          this.onSonicWave?.(x, bodyY + 0.3, z, r);
        }
      }
    }

    // Speed Boots aerodynamic wind trail when moving or dashing
    if (isSpeedBoost && (speed > 0.02 || isDashing)) {
      vis.windTrailTimer = (vis.windTrailTimer || 0) + dt;
      const windInterval = isDashing ? 0.018 : 0.032;
      if (vis.windTrailTimer >= windInterval) {
        vis.windTrailTimer = 0;
        this.onWindTrail?.(x, bodyY + 0.25 * sc, z, angle, r, speed);
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
      if (this.onPuff && Math.random() < 0.45) {
        const theme = getArenaTheme();
        const puffColor = theme === 'halloween' ? 0xba68c8 : (theme === 'women_day' ? 0xff80ab : 0x4a4542);
        // Local coordinates of the exhaust chimney pipe on the cart model
        const lx = theme === 'halloween' ? -0.45 : (theme === 'women_day' ? -0.50 : 0.40);
        const ly = theme === 'halloween' ? 1.65 : (theme === 'women_day' ? 1.25 : 1.62);
        const lz = theme === 'halloween' ? 0.35 : (theme === 'women_day' ? 0.35 : 0.38);

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const stackX = x + sc * (lx * cosA - lz * sinA) + (Math.random() - 0.5) * 0.08 * sc;
        const stackY = bodyY + sc * ly;
        const stackZ = z + sc * (lx * sinA + lz * cosA) + (Math.random() - 0.5) * 0.08 * sc;

        this.onPuff(
          stackX,
          stackY,
          stackZ,
          puffColor,
          0.45 * sc,
          0.75,
          1.8
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
    if (flags & FLAG.HEART) iconPrefix += '💖 ';
    if (flags & FLAG.SPEED_BOOST) iconPrefix += '⚡ ';
    if (flags & FLAG.IMMUNITY) iconPrefix += '🛡️ ';
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

    const elevationOffset = isFlying ? (bodyY - y) : 0;
    if (vis.label) {
      const isHiddenInWater = isWater && vis.species !== 'duck' && vis.species !== 'swan' && vis.species !== 'dog' && vis.species !== 'wolf' && vis.species !== 'pegasus' && sinkProgress >= 0.85;
      vis.label.visible = !isHiddenInWater;
      if (!isHiddenInWater) {
        const lh = 1.3 + r * 0.25;
        const labelY = (LABEL_Y[vis.species] || 2.1) + 0.6;
        const targetLabelY = (sq > 0.3 ? y + 0.65 : y + labelY * sc * inWaterShrink) + elevationOffset;
        vis.label.position.set(x, targetLabelY, z);
        vis.label.scale.set(lh * vis.label.userData.aspect, lh, 1);
      }
    }

    // Ground indicator ring: Hiệu ứng vòng hào quang tụ lực dưới chân rực rỡ & rung chấn max charge (bay thì bay theo dưới chân)
    const ringBaseY = (smoothBaseY + 0.06) + elevationOffset;
    vis.ring.position.set(x, ringBaseY, z);
    if (isCharging) {
      vis.ring.visible = !isWater;
      const isMax = lvl >= 0.98;
      if (isSuper || isEvolved) {
        // Thần thú tiến hóa / Siêu cấp: Vòng hào quang nguyên tố xoay vần rực rỡ, nhịp đập năng lượng mạnh mẽ
        const auraSpeed = isMax ? 0.006 : 0.002;
        vis.ring.scale.setScalar(r * (1.15 + lvl * (isMax ? 0.95 : 0.65) + (isMax ? Math.sin(now * 0.035) * 0.15 : 0)));
        vis.ringMat.color.setHSL((now * auraSpeed) % 1, 1.0, isMax ? 0.82 : 0.65);
        vis.ringMat.opacity = isMax ? (0.95 + Math.sin(now / 15) * 0.05) : (0.85 + Math.sin(now / 45) * 0.15);
      } else {
        // Con vật nhỏ chưa nâng cấp: Giữ nguyên hiệu ứng cũ - vòng màu vàng/cam nhẹ nhàng, không đỏ rực, không phóng đại
        vis.ring.scale.setScalar(r * (1.0 + lvl * 0.4));
        vis.ringMat.color.set(lvl >= 1.0 ? 0xffa000 : 0xffea00);
        vis.ringMat.opacity = 0.65 + Math.sin(now / (lvl >= 1.0 ? 45 : 80)) * 0.25;
      }
      // Vi rung uy lực điều hòa chỉ cho Thần Thú khi gồng MAX (dao động quanh 0, tuyệt đối không cộng dồn làm trôi lệch tâm)
      if (isMax && (isEvolved || isSuper)) {
        vis.body.position.x += Math.sin(now * 0.08) * 0.008 * sc;
        if (isEvolved && Math.random() < 0.28) {
          const EVOLVED_SHOCK_COLORS: Record<string, number> = {
            phoenix: 0xff3d00,
            swan: 0x00e5ff,
            pegasus: 0xffd700,
            boar: 0xd84315,
            ram: 0xffa000,
            bull: 0xff1744,
            gorilla: 0xff6d00,
            mammoth: 0x8d6e63,
            wolf: 0x78909c,
          };
          const swCol = EVOLVED_SHOCK_COLORS[vis.species] || 0xffea00;
          this.spawnShockwave(x, ringBaseY + 0.02, z, r * (1.2 + Math.random() * 0.5), swCol);
        }
      }
      // Khóa cứng vis.body.position.z luôn luôn bằng 0
      vis.body.position.z = 0;
    } else {
      vis.ring.visible = false;
      vis.body.position.z = 0;
    }

    // Collar color reflects team (A12 Blue 0x2196f3, WFM Red 0xf44336) or gold for King
    const collarColor = meta.team !== undefined
      ? (meta.team === 0 ? 0x2196f3 : 0xf44336)
      : (SPECIES_RING_COLOR[vis.species] ?? 0xff9800);
    vis.collarMat.color.setHex(isKing ? 0xffc928 : collarColor);

    // Sunday Meeting Summoning Ring animation: Rising ring of light from feet up to head (1.5s)
    if (vis.summonRingTimer !== undefined && vis.summonRingTimer > 0) {
      vis.summonRingTimer = Math.max(0, vis.summonRingTimer - dt);
      const totalDur = vis.summonTotalDur || 1.5;
      const elapsed = totalDur - vis.summonRingTimer;
      const prog = Math.min(1.0, Math.max(0.0, elapsed / totalDur)); // 0.0 (feet) -> 1.0 (head)
      if (vis.summonRingTimer <= 0) {
        vis.summonGroup.visible = false;
      } else {
        vis.summonGroup.visible = true;
        vis.summonGroup.position.set(x, smoothBaseY, z);
        const baseRadius = Math.max(0.8, r * 1.05);
        vis.summonGroup.scale.set(baseRadius, 1, baseRadius);

        const animalHeight = Math.max(1.5, r * 2.2);

        // 1. Rising ring of light: travels from feet (y = 0.05) up to head (y = animalHeight)
        const ringY = 0.05 + prog * animalHeight;
        vis.summonRisingRing.position.y = ringY;
        vis.summonRisingRingOuter.position.y = ringY;

        // Ring expands slightly and pulses with energy as it rises
        const ringExpand = 1.0 + Math.sin(prog * Math.PI) * 0.18;
        vis.summonRisingRing.scale.set(ringExpand, ringExpand, 1.0);
        vis.summonRisingRingOuter.scale.set(ringExpand, ringExpand, 1.0);

        vis.summonRisingRing.rotation.z = now * 0.006;
        vis.summonRisingRingOuter.rotation.z = -now * 0.009;

        // 2. Ascending light beam / energy pillar rising from feet up to the ring
        const beamH = Math.max(0.01, ringY);
        vis.summonBeam.scale.set(1.0, beamH / 3.8, 1.0);
        vis.summonBeam.position.y = beamH / 2;

        // 3. Ground magic rings spin at the feet
        vis.summonOuter.rotation.z = now * 0.003;
        vis.summonInner.rotation.z = -now * 0.006;

        // Opacity and pulsing glow
        const pulse = 0.75 + 0.25 * Math.sin(now * 0.015);
        vis.summonRisingMat.opacity = Math.min(1.0, (0.4 + prog * 0.6) * pulse);
        vis.summonRisingOuterMat.opacity = Math.min(1.0, (0.5 + prog * 0.5) * pulse * 0.9);
        vis.summonBeamMat.opacity = Math.min(0.55, (0.15 + prog * 0.4) * pulse);
        vis.summonOuterMat.opacity = (1.0 - prog * 0.3) * pulse * 0.9;
        vis.summonInnerMat.opacity = (1.0 - prog * 0.3) * (1.2 - pulse) * 0.85;
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

    const summonRisingMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const summonRisingRing = new THREE.Mesh(summonRisingRingGeo, summonRisingMat);
    summonRisingRing.position.y = 0.1;
    summonGroup.add(summonRisingRing);

    const summonRisingOuterMat = new THREE.MeshBasicMaterial({
      color: 0xffd600,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const summonRisingRingOuter = new THREE.Mesh(summonRisingRingOuterGeo, summonRisingOuterMat);
    summonRisingRingOuter.position.y = 0.1;
    summonGroup.add(summonRisingRingOuter);

    this.scene.add(summonGroup);

    return {
      root,
      body,
      legs,
      species: meta.species,
      skin: meta.skin,
      arms: body.userData.arms,
      tailSegments: body.userData.tail,
      trunk: body.userData.trunk,
      head: body.userData.head,
      wings: body.userData.wings,
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
      wasWheel: false,
      wasKing: false,
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
      summonRisingRing,
      summonRisingRingOuter,
      summonOuterMat,
      summonInnerMat,
      summonBeamMat,
      summonRisingMat,
      summonRisingOuterMat,
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
  // Evolved celestial beasts and swan never wear domestic collars
  if (species !== 'swan' && species !== 'phoenix' && species !== 'pegasus' && species !== 'boar' && species !== 'wolf' && species !== 'mammoth' && species !== 'gorilla' && species !== 'ram' && species !== 'bull') {
    body.add(buildCollar(species, collarMat));
  }

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

