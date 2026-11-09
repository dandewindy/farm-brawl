import * as THREE from 'three';
import type { CowboyItemKind } from './cowboyTypes';

/** Utility: tạo mesh với bóng đổ và vật liệu an toàn */
function createMesh(
  geo: THREE.BufferGeometry,
  color: number,
  opts: {
    metalness?: number;
    roughness?: number;
    emissive?: number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
  } = {}
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.2,
    roughness: opts.roughness ?? 0.6,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1.0,
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Giải phóng toàn bộ bộ nhớ GPU của một cây Three.js Object3D */
export function disposeHierarchy(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    }
  });
}

// =========================================================================
// 1. NHÂN VẬT BÁC NÔNG DÂN (SHOPKEEPER NPC)
// =========================================================================

export interface FarmerNPC {
  group: THREE.Group;
  update: (dt: number, time: number, isTalking: boolean) => void;
  dispose: () => void;
}

export function buildFarmerNPC(): FarmerNPC {
  const group = new THREE.Group();
  group.position.set(-2.8, 0, 0.4);
  group.rotation.y = 0.32; // Đứng hơi quay vào quầy hàng chính giữa

  // --- THÂN & YẾM JEANS NÔNG DÂN ---
  // Áo kẻ ca-rô đỏ
  const shirt = createMesh(new THREE.CylinderGeometry(0.48, 0.58, 0.95, 14), 0xd32f2f, { roughness: 0.8 });
  shirt.position.y = 1.45;
  group.add(shirt);

  // Quần yếm bò xanh denim
  const overalls = createMesh(new THREE.CylinderGeometry(0.52, 0.54, 0.65, 14), 0x1976d2, { roughness: 0.7 });
  overalls.position.y = 1.15;
  group.add(overalls);

  // Dây đai quần yếm (2 quai vai)
  for (const x of [-0.22, 0.22]) {
    const strap = createMesh(new THREE.BoxGeometry(0.09, 0.72, 0.05), 0x1565c0, { roughness: 0.7 });
    strap.position.set(x, 1.48, 0.38);
    strap.rotation.x = -0.15;
    group.add(strap);

    // Khóa kim loại đồng
    const buckle = createMesh(new THREE.BoxGeometry(0.12, 0.12, 0.07), 0xffd54f, { metalness: 0.8, roughness: 0.3 });
    buckle.position.set(x, 1.35, 0.41);
    group.add(buckle);
  }

  // Chân & Ủng làm việc của Bác Nông Dân
  for (const x of [-0.24, 0.24]) {
    const leg = createMesh(new THREE.CylinderGeometry(0.18, 0.16, 0.75, 10), 0x1565c0, { roughness: 0.8 });
    leg.position.set(x, 0.52, 0);
    group.add(leg);

    const bootGroup = new THREE.Group();
    bootGroup.position.set(x, 0, 0);

    // Cổ ủng cao su ôm gấu quần bò
    const bootShaft = createMesh(new THREE.CylinderGeometry(0.20, 0.18, 0.32, 12), 0x3e2723, { roughness: 0.6 });
    bootShaft.position.set(0, 0.24, 0.02);
    bootGroup.add(bootShaft);

    // Vành cổ ủng viền gập da màu nâu đất
    const bootCuff = createMesh(new THREE.TorusGeometry(0.20, 0.025, 8, 16), 0x5d4037, { roughness: 0.7 });
    bootCuff.rotation.x = Math.PI / 2;
    bootCuff.position.set(0, 0.38, 0.02);
    bootGroup.add(bootCuff);

    // Gót ủng bo tròn tự nhiên
    const bootHeel = createMesh(new THREE.SphereGeometry(0.18, 12, 10), 0x3e2723, { roughness: 0.5 });
    bootHeel.scale.set(1.0, 0.9, 1.1);
    bootHeel.position.set(0, 0.17, -0.04);
    bootGroup.add(bootHeel);

    // Mũi ủng nông dân cong vểnh nhẹ về phía trước (không chạm đất)
    const bootToe = createMesh(new THREE.SphereGeometry(0.18, 12, 10), 0x3e2723, { roughness: 0.5 });
    bootToe.scale.set(1.05, 0.72, 1.30);
    bootToe.position.set(0, 0.16, 0.16);
    bootToe.rotation.x = -0.16;
    bootGroup.add(bootToe);

    // Đế ủng cao su chính dày dặn
    const sole = createMesh(new THREE.BoxGeometry(0.28, 0.05, 0.54), 0x1f140e, {
      roughness: 0.9,
      metalness: 0.1,
    });
    sole.position.set(0, 0.065, 0.08);
    bootGroup.add(sole);

    // Gót nâng (Heel block) chắc chắn ở phía sau
    const heelBlock = createMesh(new THREE.BoxGeometry(0.26, 0.04, 0.18), 0x150d09, { roughness: 0.95 });
    heelBlock.position.set(0, 0.02, -0.08);
    bootGroup.add(heelBlock);

    // Rãnh khấc gai chống trượt (Lug treads) ở nửa trước bàn chân
    for (let t = 0; t < 3; t++) {
      const lug = createMesh(new THREE.BoxGeometry(0.24, 0.025, 0.05), 0x150d09, { roughness: 0.95 });
      lug.position.set(0, 0.025, 0.06 + t * 0.08);
      bootGroup.add(lug);
    }

    // Đường viền mép đế ủng (Welt)
    const welt = createMesh(new THREE.BoxGeometry(0.29, 0.02, 0.55), 0x8d6e63, { roughness: 0.8 });
    welt.position.set(0, 0.09, 0.08);
    bootGroup.add(welt);

    group.add(bootGroup);
  }

  // --- ĐẦU & KHUÔN MẶT BÁC NÔNG DÂN ---
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 2.05, 0.02);
  group.add(headPivot);

  // Đầu
  const headMesh = createMesh(new THREE.SphereGeometry(0.44, 16, 14), 0xffcc80, { roughness: 0.6 });
  headMesh.scale.set(1.0, 1.05, 0.95);
  headPivot.add(headMesh);

  // Mũi to tròn phúc hậu
  const nose = createMesh(new THREE.SphereGeometry(0.12, 12, 10), 0xffa726, { roughness: 0.5 });
  nose.position.set(0, 0.02, 0.44);
  headPivot.add(nose);

  // Bộ ria mép trắng bạc đặc trưng của lão nông vui tính
  const mustacheGroup = new THREE.Group();
  mustacheGroup.position.set(0, -0.12, 0.42);
  for (const side of [-1, 1]) {
    const stache = createMesh(new THREE.CapsuleGeometry(0.065, 0.22, 6, 8), 0xf5f5f5, { roughness: 0.9 });
    stache.position.set(side * 0.12, 0, 0);
    stache.rotation.z = side * 0.45;
    stache.rotation.y = side * 0.2;
    mustacheGroup.add(stache);
  }
  headPivot.add(mustacheGroup);

  // Miệng cử động khi nói
  const mouth = createMesh(new THREE.CylinderGeometry(0.1, 0.08, 0.04, 10), 0x5d4037, { roughness: 0.8 });
  mouth.rotation.x = Math.PI / 2;
  mouth.position.set(0, -0.21, 0.38);
  headPivot.add(mouth);

  // Đôi mắt tròn có mí chớp mắt
  const eyesGroup = new THREE.Group();
  eyesGroup.position.set(0, 0.12, 0.38);
  for (const side of [-1, 1]) {
    const white = createMesh(new THREE.SphereGeometry(0.09, 10, 10), 0xffffff, { roughness: 0.2 });
    white.scale.set(1.0, 1.1, 0.6);
    white.position.x = side * 0.16;
    eyesGroup.add(white);

    const pupil = createMesh(new THREE.SphereGeometry(0.045, 8, 8), 0x1a1a1a, { roughness: 0.1 });
    pupil.position.set(side * 0.16, -0.01, 0.075);
    eyesGroup.add(pupil);

    const brow = createMesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), 0xf5f5f5, { roughness: 0.9 });
    brow.position.set(side * 0.16, 0.13, 0.06);
    brow.rotation.z = -side * 0.12;
    eyesGroup.add(brow);
  }
  headPivot.add(eyesGroup);

  // Mũ rơm rộng vành che nắng
  const hatGroup = new THREE.Group();
  hatGroup.position.set(0, 0.32, -0.04);
  hatGroup.rotation.x = -0.12;

  const hatBrim = createMesh(new THREE.CylinderGeometry(0.78, 0.82, 0.06, 24), 0xe0a96d, { roughness: 0.85 });
  hatGroup.add(hatBrim);

  const hatCrown = createMesh(new THREE.CylinderGeometry(0.42, 0.52, 0.42, 18), 0xd29b63, { roughness: 0.85 });
  hatCrown.position.y = 0.22;
  hatGroup.add(hatCrown);

  const hatBand = createMesh(new THREE.CylinderGeometry(0.44, 0.46, 0.1, 18), 0xb71c1c, { roughness: 0.6 });
  hatBand.position.y = 0.08;
  hatGroup.add(hatBand);

  headPivot.add(hatGroup);

  // --- TAY TRÁI (KHỚP NỐI LIỀN MẠCH, CHỐNG HÔNG) ---
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.50, 1.78, 0);

  // Khớp vai trái
  const leftShoulder = createMesh(new THREE.SphereGeometry(0.14, 12, 10), 0xd32f2f, { roughness: 0.8 });
  leftArm.add(leftShoulder);

  // Cánh tay trên trái
  const leftUpperArm = new THREE.Group();
  leftUpperArm.rotation.set(0.1, 0, -0.68);
  const leftUpperMesh = createMesh(new THREE.CylinderGeometry(0.12, 0.10, 0.38, 12), 0xd32f2f, { roughness: 0.8 });
  leftUpperMesh.position.y = -0.19;
  leftUpperArm.add(leftUpperMesh);

  // Khớp khuỷu tay trái
  const leftElbow = createMesh(new THREE.SphereGeometry(0.11, 10, 10), 0xd32f2f, { roughness: 0.8 });
  leftElbow.position.y = -0.38;
  leftUpperArm.add(leftElbow);

  // Cẳng tay dưới trái
  const leftForearm = new THREE.Group();
  leftForearm.position.y = -0.38;
  leftForearm.rotation.set(0.75, 0.2, 0.95);
  const leftForeMesh = createMesh(new THREE.CylinderGeometry(0.10, 0.09, 0.34, 12), 0xd32f2f, { roughness: 0.8 });
  leftForeMesh.position.y = -0.17;
  leftForearm.add(leftForeMesh);

  // Khớp cổ tay & Bàn tay trái
  const leftWrist = createMesh(new THREE.SphereGeometry(0.08, 10, 8), 0xffcc80, { roughness: 0.6 });
  leftWrist.position.y = -0.34;
  leftForearm.add(leftWrist);

  const leftHand = createMesh(new THREE.SphereGeometry(0.10, 12, 10), 0xffcc80, { roughness: 0.6 });
  leftHand.scale.set(1.0, 0.8, 1.2);
  leftHand.position.set(0, -0.40, 0.05);
  leftForearm.add(leftHand);

  leftUpperArm.add(leftForearm);
  leftArm.add(leftUpperArm);
  group.add(leftArm);

  // --- TAY PHẢI (KHỚP NỐI LIỀN MẠCH, ĐƯA TAY MỞ RỘNG CHÀO MỪNG) ---
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.50, 1.78, 0);

  // Khớp vai phải
  const rightShoulder = createMesh(new THREE.SphereGeometry(0.14, 12, 10), 0xd32f2f, { roughness: 0.8 });
  rightArmPivot.add(rightShoulder);

  // Cánh tay trên phải
  const rightUpperGroup = new THREE.Group();
  rightUpperGroup.rotation.set(0.42, 0, 0.72);
  const rightUpperMesh = createMesh(new THREE.CylinderGeometry(0.12, 0.10, 0.40, 12), 0xd32f2f, { roughness: 0.8 });
  rightUpperMesh.position.y = -0.20;
  rightUpperGroup.add(rightUpperMesh);

  // Khớp khuỷu tay phải
  const rightElbow = createMesh(new THREE.SphereGeometry(0.11, 10, 10), 0xd32f2f, { roughness: 0.8 });
  rightElbow.position.y = -0.40;
  rightUpperGroup.add(rightElbow);

  // Cẳng tay dưới phải
  const rightForearm = new THREE.Group();
  rightForearm.position.y = -0.40;
  rightForearm.rotation.set(-0.25, 0.35, -0.90);
  const rightForeMesh = createMesh(new THREE.CylinderGeometry(0.10, 0.09, 0.42, 12), 0xd32f2f, { roughness: 0.8 });
  rightForeMesh.position.y = -0.21;
  rightForearm.add(rightForeMesh);

  // Khớp cổ tay & Bàn tay mở chào đón
  const rightWrist = createMesh(new THREE.SphereGeometry(0.08, 10, 8), 0xffcc80, { roughness: 0.6 });
  rightWrist.position.y = -0.42;
  rightForearm.add(rightWrist);

  const rightHandGroup = new THREE.Group();
  rightHandGroup.position.set(0, -0.46, 0);
  rightHandGroup.rotation.set(-0.2, 0.3, 0);

  const rightPalm = createMesh(new THREE.BoxGeometry(0.14, 0.05, 0.16), 0xffcc80, { roughness: 0.6 });
  rightHandGroup.add(rightPalm);

  const thumb = createMesh(new THREE.CapsuleGeometry(0.035, 0.08, 6, 6), 0xffcc80, { roughness: 0.6 });
  thumb.position.set(-0.08, 0.02, 0.04);
  thumb.rotation.set(0.3, 0.2, 0.5);
  rightHandGroup.add(thumb);

  for (let f = 0; f < 4; f++) {
    const finger = createMesh(new THREE.CapsuleGeometry(0.025, 0.09, 5, 5), 0xffcc80, { roughness: 0.6 });
    finger.position.set(-0.045 + f * 0.03, 0, 0.12);
    finger.rotation.x = 0.2;
    rightHandGroup.add(finger);
  }
  rightForearm.add(rightHandGroup);

  rightUpperGroup.add(rightForearm);
  rightArmPivot.add(rightUpperGroup);
  group.add(rightArmPivot);

  let blinkTimer = 0;

  return {
    group,
    update: (dt: number, time: number, isTalking: boolean) => {
      // 1. Đầu lắc lư, gật gù nhẹ nhàng
      headPivot.rotation.z = Math.sin(time * 1.6) * 0.045;
      headPivot.rotation.y = 0.22 + Math.sin(time * 1.3) * 0.065;
      headPivot.rotation.x = Math.sin(time * 2.1) * 0.03;

      // 2. Tay phải cử động đưa tay chào mừng & giới thiệu
      rightArmPivot.rotation.z = -0.15 + Math.sin(time * 2.2) * 0.08;
      rightArmPivot.rotation.y = 0.25 + Math.cos(time * 1.8) * 0.06;
      rightForearm.rotation.z = Math.sin(time * 2.5) * 0.06;

      // 3. Chớp mắt tự nhiên (khoảng 3.5s một lần)
      blinkTimer += dt;
      if (blinkTimer > 3.6) {
        eyesGroup.scale.y = 0.15;
        if (blinkTimer > 3.75) {
          eyesGroup.scale.y = 1.0;
          blinkTimer = 0;
        }
      } else {
        eyesGroup.scale.y = 1.0;
      }

      // 4. Miệng cử động nhấp nháy khi đang nói
      if (isTalking) {
        mouth.scale.y = 0.3 + 0.9 * Math.abs(Math.sin(time * 11));
      } else {
        mouth.scale.y = 0.35 + 0.15 * Math.abs(Math.sin(time * 1.5));
      }
    },
    dispose: () => {
      disposeHierarchy(group);
    },
  };
}

// =========================================================================
// 2. QUẦY HÀNG GỖ NÔNG TRẠI (STALL & SHELVES)
// =========================================================================

export function buildShopStall(): THREE.Group {
  const stall = new THREE.Group();
  stall.position.set(0.65, 0, 0);

  const tableMat = { color: 0x6d4c41, roughness: 0.75 };
  const table = createMesh(new THREE.BoxGeometry(4.8, 0.22, 1.8), tableMat.color, tableMat);
  table.position.set(0, 0.75, 0.3);
  stall.add(table);

  for (const x of [-2.2, 2.2]) {
    for (const z of [-0.4, 0.9]) {
      const leg = createMesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), 0x4e342e, { roughness: 0.8 });
      leg.position.set(x, 0.375, z);
      stall.add(leg);
    }
  }

  const frontSkirt = createMesh(new THREE.BoxGeometry(4.6, 0.62, 0.08), 0x5d4037, { roughness: 0.8 });
  frontSkirt.position.set(0, 0.44, 1.05);
  stall.add(frontSkirt);

  // Tầng kệ trên đặt tại y = 2.32, tầng kệ dưới tại y = 0.98 (Khoảng cách thông thoáng 1.34 unit)
  const topShelf = createMesh(new THREE.BoxGeometry(4.4, 0.14, 0.74), 0x795548, { roughness: 0.7 });
  topShelf.position.set(0, 2.32, -0.15);
  stall.add(topShelf);

  const bottomShelf = createMesh(new THREE.BoxGeometry(4.4, 0.14, 0.74), 0x795548, { roughness: 0.7 });
  bottomShelf.position.set(0, 0.98, 0.1);
  stall.add(bottomShelf);

  // Cột trụ gỗ cao vươn lên đỡ mái che y = 3.82
  for (const x of [-2.1, 2.1]) {
    const post = createMesh(new THREE.BoxGeometry(0.14, 3.82, 0.14), 0x3e2723, { roughness: 0.8 });
    post.position.set(x, 1.91, -0.45);
    stall.add(post);
  }

  // MÁI CHE NÂNG CAO LÊN y = 3.82 (GÓC NGHIÊNG NHẸ 0.10 RAD) ĐỂ KHÔNG BAO GIỜ CHE VẬT PHẨM TẦNG TRÊN
  const canopyGroup = new THREE.Group();
  canopyGroup.position.set(0, 3.82, -0.22);
  canopyGroup.rotation.x = 0.10;

  const stripes = 8;
  const stripeWidth = 4.6 / stripes;
  for (let s = 0; s < stripes; s++) {
    const isRed = s % 2 === 0;
    const stripe = createMesh(
      new THREE.BoxGeometry(stripeWidth * 0.96, 0.08, 1.4),
      isRed ? 0xd32f2f : 0xfff9c4,
      { roughness: 0.7 }
    );
    stripe.position.set(-2.3 + (s + 0.5) * stripeWidth, 0, 0);
    canopyGroup.add(stripe);

    const scallop = createMesh(
      new THREE.CylinderGeometry(stripeWidth * 0.45, stripeWidth * 0.45, 0.06, 12),
      isRed ? 0xd32f2f : 0xfff9c4,
      { roughness: 0.7 }
    );
    scallop.rotation.x = Math.PI / 2;
    scallop.position.set(-2.3 + (s + 0.5) * stripeWidth, -0.10, 0.70);
    canopyGroup.add(scallop);
  }
  stall.add(canopyGroup);

  return stall;
}

// =========================================================================
// 3. CÁC MODEL 3D VẬT PHẨM TRƯNG BÀY (VỚI XOAY VÒNG & LẤP LÁNH)
// =========================================================================

export interface ShopItemModel {
  group: THREE.Group;
  pedestalPos: THREE.Vector3;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

export function buildShopItemModel(kind: CowboyItemKind, slotIdx: number): ShopItemModel {
  const group = new THREE.Group();

  const isTop = slotIdx < 3;
  const col = slotIdx % 3;
  const posX = -1.35 + col * 1.35 + 0.65;
  const posY = isTop ? 2.39 : 1.05;
  const posZ = isTop ? -0.12 : 0.12;

  const pedestalPos = new THREE.Vector3(posX, posY, posZ);
  group.position.copy(pedestalPos);

  const pedestal = createMesh(new THREE.CylinderGeometry(0.42, 0.46, 0.12, 20), 0xd4a359, {
    roughness: 0.4,
    metalness: 0.3,
  });
  pedestal.position.y = 0.06;
  group.add(pedestal);

  const rim = createMesh(new THREE.TorusGeometry(0.44, 0.03, 8, 24), 0xffd700, {
    metalness: 0.9,
    roughness: 0.2,
    emissive: 0xffa000,
    emissiveIntensity: 0.35,
  });
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.12;
  group.add(rim);

  const floatingGroup = new THREE.Group();
  floatingGroup.position.y = 0.36;
  group.add(floatingGroup);

  const sparklesGroup = new THREE.Group();
  floatingGroup.add(sparklesGroup);

  if (kind === 'speed_boots') {
    // 🥾 Giày Thần Tốc Hermes: Cổ giày xanh cyan, đế vàng, cánh bay 2 bên
    const shaft = createMesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 12), 0x00e5ff, {
      metalness: 0.6,
      roughness: 0.2,
      emissive: 0x00b0ff,
      emissiveIntensity: 0.45,
    });
    shaft.position.y = 0.15;
    floatingGroup.add(shaft);

    const toe = createMesh(new THREE.SphereGeometry(0.22, 12, 10), 0x00e5ff, {
      metalness: 0.6,
      roughness: 0.2,
      emissive: 0x00b0ff,
      emissiveIntensity: 0.45,
    });
    toe.scale.set(1.3, 0.7, 0.9);
    toe.position.set(0.18, -0.06, 0);
    floatingGroup.add(toe);

    const sole = createMesh(new THREE.BoxGeometry(0.62, 0.09, 0.36), 0xffd700, {
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0xffa000,
      emissiveIntensity: 0.3,
    });
    sole.position.set(0.08, -0.14, 0);
    floatingGroup.add(sole);

    for (const side of [-1, 1]) {
      for (let f = 0; f < 2; f++) {
        const wing = createMesh(new THREE.ConeGeometry(0.08, 0.36 - f * 0.06, 6), 0xffea00, {
          metalness: 0.8,
          roughness: 0.2,
          emissive: 0xffd700,
          emissiveIntensity: 0.6,
        });
        wing.position.set(-0.12 - f * 0.08, 0.16 + f * 0.1, side * 0.22);
        wing.rotation.z = Math.PI / 2 + 0.3;
        wing.rotation.x = side * 0.25;
        floatingGroup.add(wing);
      }
    }
  } else if (kind === 'lucky_shield') {
    // 🛡️ Khiên Hộ Thể: Khiên tròn mạ vàng, tâm ngọc lục bảo và sao sáng
    const shieldRim = createMesh(new THREE.CylinderGeometry(0.48, 0.52, 0.09, 20), 0xffd700, {
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0xff9800,
      emissiveIntensity: 0.4,
    });
    shieldRim.rotation.x = Math.PI / 2;
    floatingGroup.add(shieldRim);

    const shieldCore = createMesh(new THREE.CylinderGeometry(0.38, 0.42, 0.11, 20), 0x00e676, {
      metalness: 0.4,
      roughness: 0.2,
      emissive: 0x00c853,
      emissiveIntensity: 0.65,
    });
    shieldCore.rotation.x = Math.PI / 2;
    floatingGroup.add(shieldCore);

    const gem = createMesh(new THREE.OctahedronGeometry(0.18, 0), 0xffffff, {
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0x69f0ae,
      emissiveIntensity: 1.1,
    });
    gem.position.z = 0.08;
    floatingGroup.add(gem);

    const orbit = createMesh(new THREE.TorusGeometry(0.62, 0.025, 8, 24), 0x69f0ae, {
      emissive: 0x00e676,
      emissiveIntensity: 0.9,
    });
    orbit.rotation.x = Math.PI / 3;
    floatingGroup.add(orbit);
  } else if (kind === 'rainbow_net') {
    // 🌈 Lưới Cầu Vồng: Vòng Torus đa sắc lung linh tỏa sáng rực rỡ
    const netTorus = createMesh(new THREE.TorusGeometry(0.45, 0.065, 12, 36), 0xff4081, {
      metalness: 0.8,
      roughness: 0.15,
      emissive: 0x7c4dff,
      emissiveIntensity: 0.85,
    });
    floatingGroup.add(netTorus);

    const innerRing = createMesh(new THREE.TorusGeometry(0.28, 0.045, 10, 24), 0x00e5ff, {
      metalness: 0.8,
      roughness: 0.15,
      emissive: 0x00b0ff,
      emissiveIntensity: 0.8,
    });
    innerRing.rotation.y = Math.PI / 2;
    floatingGroup.add(innerRing);

    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2;
      const bead = createMesh(new THREE.SphereGeometry(0.07, 8, 8), 0xffeb3b, {
        metalness: 0.9,
        roughness: 0.2,
        emissive: 0xffd600,
        emissiveIntensity: 1.0,
      });
      bead.position.set(Math.cos(ang) * 0.45, Math.sin(ang) * 0.45, 0);
      floatingGroup.add(bead);
    }
  } else if (kind === 'strength_potion') {
    // 🧪 Thuốc Tăng Lực: Bình thủy tinh bầu dục chứa thần dược tím sủi bọt (chiều cao tối ưu không chạm kệ trên)
    const bottleBody = createMesh(new THREE.SphereGeometry(0.27, 14, 12), 0x9c27b0, {
      metalness: 0.3,
      roughness: 0.15,
      emissive: 0x7b1fa2,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.88,
    });
    bottleBody.scale.set(1.0, 1.12, 1.0);
    floatingGroup.add(bottleBody);

    const neck = createMesh(new THREE.CylinderGeometry(0.10, 0.12, 0.16, 12), 0xba68c8, {
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
    });
    neck.position.y = 0.28;
    floatingGroup.add(neck);

    const cork = createMesh(new THREE.CylinderGeometry(0.11, 0.09, 0.08, 10), 0x8d6e63, { roughness: 0.85 });
    cork.position.y = 0.38;
    floatingGroup.add(cork);
  } else if (kind === 'lucky_clover') {
    // 🍀 Cỏ 4 Lá May Mắn: 4 cánh lá hình trái tim xòe tròn cùng giọt sương vàng
    for (let c = 0; c < 4; c++) {
      const ang = (c / 4) * Math.PI * 2;
      const leaf = createMesh(new THREE.SphereGeometry(0.18, 10, 8), 0x43a047, {
        metalness: 0.4,
        roughness: 0.3,
        emissive: 0x2e7d32,
        emissiveIntensity: 0.55,
      });
      leaf.scale.set(1.2, 0.3, 0.8);
      leaf.position.set(Math.cos(ang) * 0.22, 0, Math.sin(ang) * 0.22);
      leaf.rotation.y = -ang;
      floatingGroup.add(leaf);
    }
    const dew = createMesh(new THREE.SphereGeometry(0.09, 8, 8), 0xffeb3b, {
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0xffd600,
      emissiveIntensity: 1.2,
    });
    dew.position.y = 0.06;
    floatingGroup.add(dew);
  } else if (kind === 'time_clock') {
    // ⏰ Đồng Hồ Cát Thời Gian: Hai bầu thủy tinh hình nón đối đỉnh và nắp gỗ gụ
    const topCone = createMesh(new THREE.ConeGeometry(0.24, 0.32, 14), 0xffd54f, {
      metalness: 0.5,
      roughness: 0.2,
      emissive: 0xffb300,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.85,
    });
    topCone.position.y = 0.16;
    floatingGroup.add(topCone);

    const botCone = createMesh(new THREE.ConeGeometry(0.24, 0.32, 14), 0xffd54f, {
      metalness: 0.5,
      roughness: 0.2,
      emissive: 0xffb300,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.85,
    });
    botCone.position.y = -0.16;
    botCone.rotation.x = Math.PI;
    floatingGroup.add(botCone);

    for (const y of [-0.34, 0.34]) {
      const cap = createMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), 0x5d4037, {
        roughness: 0.6,
      });
      cap.position.y = y;
      floatingGroup.add(cap);
    }
  }

  const sparkGeo = new THREE.OctahedronGeometry(0.065, 0);
  const sparkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffd54f,
    emissiveIntensity: 1.4,
    metalness: 0.9,
    roughness: 0.1,
  });
  for (let s = 0; s < 4; s++) {
    const sp = new THREE.Mesh(sparkGeo, sparkMat);
    sparklesGroup.add(sp);
  }

  return {
    group,
    pedestalPos,
    update: (dt: number, time: number) => {
      floatingGroup.rotation.y += dt * 1.6;
      floatingGroup.position.y = 0.42 + Math.sin(time * 2.5 + slotIdx * 0.9) * 0.055;
      sparklesGroup.children.forEach((child, idx) => {
        const ang = time * 3.2 + (idx / 4) * Math.PI * 2;
        const rad = 0.52 + Math.sin(time * 4.0 + idx) * 0.06;
        child.position.set(Math.cos(ang) * rad, Math.sin(time * 3.0 + idx) * 0.18, Math.sin(ang) * rad);
        child.rotation.y += dt * 4.0;
      });
    },
    dispose: () => {
      disposeHierarchy(group);
    },
  };
}

// =========================================================================
// 4. TÚI HÀNG / THÙNG BẢO BỐI (3D SACK EFFECT ON PURCHASE)
// =========================================================================

export interface ShopSack {
  group: THREE.Group;
  triggerPurchaseHop: (startWorldPos: THREE.Vector3) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

export function buildShopSack(scene: THREE.Scene): ShopSack {
  const group = new THREE.Group();
  // Đặt túi bên ngoài bàn (X = 3.42, Y = 0.42, Z = 1.12), tiếp đất vững chãi Y >= 0
  group.position.set(3.42, 0.42, 1.12);
  group.rotation.y = -0.32;

  // innerSackGroup chứa thân túi để rung lắc khi mua mà KHÔNG làm nghiêng các đồng xu trên sàn
  const innerSack = new THREE.Group();
  group.add(innerSack);

  // Thân túi vải lụa vàng kim phồng tròn căng mọng
  const sackBody = createMesh(new THREE.SphereGeometry(0.44, 16, 14), 0xc68a4c, {
    roughness: 0.75,
    metalness: 0.15,
  });
  sackBody.scale.set(1.22, 0.94, 1.18);
  innerSack.add(sackBody);

  // Đáy túi tiếp đất êm ái
  const sackBase = createMesh(new THREE.CylinderGeometry(0.36, 0.42, 0.14, 16), 0xa06733, { roughness: 0.8 });
  sackBase.position.y = -0.30;
  innerSack.add(sackBase);

  // Cổ túi thắt nơ dây thừng vàng kim óng ánh
  const ropeTie = createMesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20), 0xffd54f, {
    metalness: 0.85,
    roughness: 0.25,
    emissive: 0xffa000,
    emissiveIntensity: 0.45,
  });
  ropeTie.rotation.x = Math.PI / 2;
  ropeTie.position.y = 0.34;
  innerSack.add(ropeTie);

  // Dây thừng thắt rủ xuống mặt túi
  for (const s of [-0.08, 0.08]) {
    const ropeTassel = createMesh(new THREE.ConeGeometry(0.04, 0.18, 8), 0xffd54f, {
      metalness: 0.85,
      roughness: 0.25,
      emissive: 0xffa000,
      emissiveIntensity: 0.35,
    });
    ropeTassel.position.set(s, 0.22, 0.24);
    ropeTassel.rotation.x = 0.28;
    innerSack.add(ropeTassel);
  }

  // Miệng túi xòe lượn sóng hé lộ kho báu
  const ruffle = createMesh(new THREE.CylinderGeometry(0.32, 0.20, 0.22, 16, 1, true), 0xc68a4c, {
    roughness: 0.75,
  });
  ruffle.position.y = 0.46;
  innerSack.add(ruffle);

  // Đống tiền vàng óng ánh bên trong miệng túi
  const goldMound = createMesh(new THREE.SphereGeometry(0.20, 12, 10), 0xffd700, {
    metalness: 0.95,
    roughness: 0.15,
    emissive: 0xffa000,
    emissiveIntensity: 0.65,
  });
  goldMound.scale.set(1.1, 0.6, 1.1);
  goldMound.position.y = 0.44;
  innerSack.add(goldMound);

  // Các đồng xu vàng lẻ lấp lánh trên miệng túi
  for (let c = 0; c < 5; c++) {
    const coin = createMesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 12), 0xffeb3b, {
      metalness: 0.95,
      roughness: 0.15,
      emissive: 0xffc107,
      emissiveIntensity: 0.8,
    });
    const ang = (c / 5) * Math.PI * 2;
    coin.position.set(Math.cos(ang) * 0.14, 0.50 + (c % 2) * 0.02, Math.sin(ang) * 0.14);
    coin.rotation.set(0.3 * (c % 3 - 1), ang, 0.2);
    innerSack.add(coin);
  }

  // Huy hiệu đồng tiền vàng lớn nổi bật ở mặt trước túi
  const coinBadge = createMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), 0xffd700, {
    metalness: 0.95,
    roughness: 0.2,
    emissive: 0xffa000,
    emissiveIntensity: 0.7,
  });
  coinBadge.rotation.x = Math.PI / 2;
  coinBadge.position.set(0, 0.04, 0.48);
  innerSack.add(coinBadge);

  // Vài đồng tiền vàng rơi vãi duyên dáng trên sàn cạnh túi (gắn trực tiếp vào group cố định trên sàn)
  for (let f = 0; f < 4; f++) {
    const floorCoin = createMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), 0xffd700, {
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0xffa000,
      emissiveIntensity: 0.5,
    });
    const fAng = (f / 4) * Math.PI * 1.5 + 0.8;
    floorCoin.position.set(Math.cos(fAng) * 0.52, -0.40, Math.sin(fAng) * 0.52);
    floorCoin.rotation.y = f * 0.7;
    group.add(floorCoin);
  }

  // Flying Item bay vào túi
  const flyingItem = new THREE.Group();
  flyingItem.visible = false;
  const flyingOrb = createMesh(new THREE.SphereGeometry(0.22, 12, 10), 0xffeb3b, {
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0xffb300,
    emissiveIntensity: 1.0,
  });
  flyingItem.add(flyingOrb);

  for (let s = 0; s < 4; s++) {
    const sp = createMesh(new THREE.OctahedronGeometry(0.07, 0), 0xffffff, {
      emissive: 0xffd54f,
      emissiveIntensity: 1.5,
    });
    const a = (s / 4) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
    flyingItem.add(sp);
  }
  scene.add(flyingItem);

  let shakeTime = 0;
  let hopProgress = 1.0;
  const startP = new THREE.Vector3();
  const endP = new THREE.Vector3();

  return {
    group,
    triggerPurchaseHop: (startWorldPos: THREE.Vector3) => {
      startP.copy(startWorldPos);
      innerSack.getWorldPosition(endP);
      endP.y += 0.45; // Đích đến là miệng túi

      hopProgress = 0;
      shakeTime = 0.65;

      flyingItem.visible = true;
      flyingItem.position.copy(startP);
      flyingItem.scale.set(1.0, 1.0, 1.0);
    },
    update: (dt: number, time: number) => {
      // 1. Animation rung lắc túi hàng khi mua (chỉ rung innerSack, tiền sàn đứng yên)
      if (shakeTime > 0) {
        shakeTime -= dt;
        const progress = Math.max(0, shakeTime / 0.65);
        innerSack.rotation.z = Math.sin(time * 36) * 0.24 * progress;
        innerSack.rotation.x = Math.cos(time * 28) * 0.16 * progress;
        innerSack.scale.y = 1.0 + Math.sin(time * 30) * 0.18 * progress;
      } else {
        innerSack.rotation.z = 0;
        innerSack.rotation.x = 0;
        innerSack.scale.y = 1.0;
      }

      // 2. Quỹ đạo bay hình parabol của item vào túi
      if (hopProgress < 1.0) {
        hopProgress += dt * 1.85;
        const p = Math.min(1.0, hopProgress);

        const currentPos = new THREE.Vector3().lerpVectors(startP, endP, p);
        const arcY = Math.sin(p * Math.PI) * 1.6;
        currentPos.y += arcY;
        flyingItem.position.copy(currentPos);

        flyingItem.rotation.y = time * 12;
        flyingItem.rotation.x = time * 8;

        const sc = 1.0 - p * 0.65;
        flyingItem.scale.set(sc, sc, sc);

        if (p >= 1.0) {
          flyingItem.visible = false;
        }
      }
    },
    dispose: () => {
      scene.remove(flyingItem);
    },
  };
}

// =========================================================================
// 5. PHÔNG NỀN NÔNG TRẠI MỘC MẠC (RUSTIC BARN STORE BACKGROUND)
// =========================================================================

export function buildShopStoreBackground(): THREE.Group {
  const bg = new THREE.Group();

  // 1. Tường gỗ ván mộc (12 tấm ván ngang phong cách barnhouse)
  const plankMat1 = { color: 0x4e342e, roughness: 0.9 };
  const plankMat2 = { color: 0x3e2723, roughness: 0.85 };
  const plankMat3 = { color: 0x5d4037, roughness: 0.92 };

  for (let p = 0; p < 12; p++) {
    const mat = p % 3 === 0 ? plankMat1 : p % 3 === 1 ? plankMat2 : plankMat3;
    const plank = createMesh(new THREE.BoxGeometry(26, 0.58, 0.08), mat.color, mat);
    plank.position.set(0, 0.35 + p * 0.58, -2.4);
    bg.add(plank);
  }

  // 2. Xà gồ gỗ ngang & Cột trụ lớn 2 bên
  const beamMat = { color: 0x271611, roughness: 0.8 };
  const topBeam = createMesh(new THREE.BoxGeometry(26, 0.36, 0.36), beamMat.color, beamMat);
  topBeam.position.set(0, 5.2, -1.8);
  bg.add(topBeam);

  for (const x of [-6.8, 6.8]) {
    const pillar = createMesh(new THREE.BoxGeometry(0.42, 6.5, 0.42), beamMat.color, beamMat);
    pillar.position.set(x, 2.8, -1.8);
    bg.add(pillar);
  }

  // 3. Hai đèn bão treo phát sáng ấm cúng (1 bên trái trên đầu bác nông dân, 1 bên phải)
  const lanternPositions = [
    { x: -3.2, y: 3.8, z: -1.2 },
    { x: 3.8, y: 3.8, z: -1.2 },
  ];

  for (const pos of lanternPositions) {
    const lanternGroup = new THREE.Group();
    lanternGroup.position.set(pos.x, pos.y, pos.z);

    // Dây xích sắt treo từ xà gồ
    const chain = createMesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), 0x212121, { metalness: 0.8 });
    chain.position.y = 0.6;
    lanternGroup.add(chain);

    // Khung đèn sắt hở với 4 thanh góc mảnh để lộ lõi phát sáng rực rỡ bên trong
    for (const sx of [-0.15, 0.15]) {
      for (const sz of [-0.15, 0.15]) {
        const strut = createMesh(new THREE.BoxGeometry(0.024, 0.38, 0.024), 0x263238, { metalness: 0.8, roughness: 0.3 });
        strut.position.set(sx, 0.02, sz);
        lanternGroup.add(strut);
      }
    }
    const topRing = createMesh(new THREE.TorusGeometry(0.18, 0.018, 6, 16), 0x263238, { metalness: 0.8 });
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 0.20;
    lanternGroup.add(topRing);

    const bottomRing = createMesh(new THREE.TorusGeometry(0.15, 0.018, 6, 16), 0x263238, { metalness: 0.8 });
    bottomRing.rotation.x = Math.PI / 2;
    bottomRing.position.y = -0.16;
    lanternGroup.add(bottomRing);

    // Lõi đèn kính phát sáng vàng ấm
    const glass = createMesh(new THREE.CylinderGeometry(0.13, 0.11, 0.32, 8), 0xffd54f, {
      emissive: 0xffa000,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    lanternGroup.add(glass);

    // Nón che đèn
    const cap = createMesh(new THREE.ConeGeometry(0.24, 0.12, 6), 0x212121, { metalness: 0.8 });
    cap.position.y = 0.24;
    lanternGroup.add(cap);

    // Đèn điểm ấm áp
    const pLight = new THREE.PointLight(0xffb74d, 1.2, 6.5);
    pLight.position.set(0, 0, 0);
    lanternGroup.add(pLight);

    bg.add(lanternGroup);
  }

  // 4. Các kiện rơm vàng xếp góc tường (Hay bales)
  const hayMat = { color: 0xe0a96d, roughness: 0.95 };
  const hayPositions = [
    { x: 4.8, y: 0.36, z: -1.5, rot: 0.1 },
    { x: 5.6, y: 0.36, z: -1.4, rot: -0.15 },
    { x: 5.2, y: 0.92, z: -1.45, rot: 0.05 },
    { x: -5.2, y: 0.36, z: -1.5, rot: 0.2 },
  ];
  for (const hp of hayPositions) {
    const hay = createMesh(new THREE.BoxGeometry(1.2, 0.65, 0.85), hayMat.color, hayMat);
    hay.position.set(hp.x, hp.y, hp.z);
    hay.rotation.y = hp.rot;
    bg.add(hay);

    // Dây thừng buộc kiện rơm
    for (const b of [-0.3, 0.3]) {
      const twine = createMesh(new THREE.BoxGeometry(0.04, 0.66, 0.86), 0x8d6e63, { roughness: 0.9 });
      twine.position.set(hp.x + b, hp.y, hp.z);
      twine.rotation.y = hp.rot;
      bg.add(twine);
    }
  }

  // 5. Thùng gỗ sồi (Barrels) cạnh tường
  const barrelMat = { color: 0x5d4037, roughness: 0.7 };
  const barrelPositions = [
    { x: -4.4, y: 0.55, z: -1.2 },
    { x: 4.2, y: 0.55, z: -1.1 },
  ];
  for (const bp of barrelPositions) {
    const barrel = createMesh(new THREE.CylinderGeometry(0.42, 0.38, 1.1, 14), barrelMat.color, barrelMat);
    barrel.position.set(bp.x, bp.y, bp.z);
    bg.add(barrel);

    // Đai sắt thùng
    for (const y of [-0.35, 0.35]) {
      const hoop = createMesh(new THREE.TorusGeometry(0.43, 0.02, 6, 16), 0x263238, { metalness: 0.8 });
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(bp.x, bp.y + y, bp.z);
      bg.add(hoop);
    }
  }

  // 6. Cuộn dây thừng treo trên vách gỗ
  const ropeCoil = createMesh(new THREE.TorusGeometry(0.35, 0.05, 8, 20), 0xd4a359, { roughness: 0.85 });
  ropeCoil.position.set(-2.2, 3.2, -2.32);
  bg.add(ropeCoil);

  return bg;
}
