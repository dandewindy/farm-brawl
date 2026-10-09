import * as THREE from 'three';
import { CFG, FOOD_KG, type FoodKind } from '@shared/constants';
import type { FoodItem } from '../game/state';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
  size: number;
  g: number;
}

function createWatermelonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // Base bright/rich green
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, 256, 128);

  // Wavy dark forest green stripes
  ctx.fillStyle = '#143c16';
  for (let x = 6; x < 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 128; y += 16) {
      const wobble = Math.sin((y / 128) * Math.PI * 4) * 5;
      ctx.lineTo(x + wobble, y);
    }
    for (let y = 128; y >= 0; y -= 16) {
      const wobble = Math.sin((y / 128) * Math.PI * 4) * 5;
      ctx.lineTo(x + 14 + wobble, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export class FoodAndParticleRenderer {

  private readonly foodMeshes: THREE.InstancedMesh[] = [];
  private readonly foodTops: Partial<Record<FoodKind, THREE.InstancedMesh>> = {};
  private readonly foodShadow: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly shadowM = new THREE.Matrix4();
  private readonly hueCol = new THREE.Color();
  private readonly rainbowColors = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de];
  private readonly maxFoodPerKind = 800;
  private readonly maxFoodTotal = 1500;
  private readonly maxParticles = 1200;

  constructor(private readonly scene: THREE.Scene) {
    // 0: Corn (Bắp) - elongated ear of corn with sculpted 3D kernel rows profile
    const cornProfile = [
      new THREE.Vector2(0.08, -0.70), // base stem
      new THREE.Vector2(0.14, -0.62), // kernel row 1
      new THREE.Vector2(0.12, -0.56),
      new THREE.Vector2(0.18, -0.47), // kernel row 2
      new THREE.Vector2(0.16, -0.41),
      new THREE.Vector2(0.22, -0.31), // kernel row 3
      new THREE.Vector2(0.20, -0.25),
      new THREE.Vector2(0.24, -0.14), // kernel row 4
      new THREE.Vector2(0.22, -0.08),
      new THREE.Vector2(0.24, 0.04),  // kernel row 5 (plump center)
      new THREE.Vector2(0.22, 0.10),
      new THREE.Vector2(0.23, 0.22),  // kernel row 6
      new THREE.Vector2(0.20, 0.28),
      new THREE.Vector2(0.21, 0.39),  // kernel row 7
      new THREE.Vector2(0.18, 0.45),
      new THREE.Vector2(0.17, 0.54),  // kernel row 8 (tapering)
      new THREE.Vector2(0.13, 0.60),
      new THREE.Vector2(0.11, 0.66),  // kernel row 9
      new THREE.Vector2(0.01, 0.70),  // cob tip
    ];
    const cornCobGeo = new THREE.LatheGeometry(cornProfile, 12);

    // 1: Apple (Táo đỏ) - sculpted apple profile with indented top and bottom
    const appleProfile = [
      new THREE.Vector2(0.03, -0.34),
      new THREE.Vector2(0.18, -0.28),
      new THREE.Vector2(0.38, -0.05),
      new THREE.Vector2(0.40, 0.12),
      new THREE.Vector2(0.30, 0.28),
      new THREE.Vector2(0.08, 0.35),
      new THREE.Vector2(0.02, 0.32),
    ];
    const appleGeo = new THREE.LatheGeometry(appleProfile, 14);

    // 2: Golden Corn (Bắp vàng lớn) - large sculpted lathe profile
    const goldenCornGeo = cornCobGeo.clone().scale(1.25, 1.25, 1.25);

    // 3: Carrot (Cà rốt) - tapered cone with wide crown at +Y and pointy root tip at -Y
    const carrotGeo = new THREE.ConeGeometry(0.22, 0.85, 10).rotateX(Math.PI).translate(0, -0.075, 0);

    // 4: Pumpkin (Bí đỏ) - squashed ribbed sphere
    const pumpkinGeo = new THREE.SphereGeometry(0.78, 14, 10).scale(1.08, 0.74, 1.08);

    // 5: Turnip (Củ cải trắng)
    const turnipGeo = new THREE.SphereGeometry(0.45, 10, 8);

    // 6: Rainbow Candy (Kẹo cầu vồng siêu thú) - sparkling octahedron
    const rainbowCandyGeo = new THREE.OctahedronGeometry(1.5, 0);

    // 7: Watermelon (Dưa hấu) - large oblong sphere, visibly larger than pumpkin
    // Rotate geometry 90 degrees around Z so poles align with horizontal ends (-X and +X)
    // and striped texture converges organically at the tips rather than the belly!
    const watermelonGeo = new THREE.SphereGeometry(1.05, 18, 14);
    watermelonGeo.rotateZ(Math.PI / 2);
    watermelonGeo.scale(1.26, 0.94, 0.94);

    const geos = [
      cornCobGeo,
      appleGeo,
      goldenCornGeo,
      carrotGeo,
      pumpkinGeo,
      turnipGeo,
      rainbowCandyGeo,
      watermelonGeo,
    ];

    const mats = [
      // 0: Corn - warm golden yellow with crisp faceted kernels
      new THREE.MeshStandardMaterial({ color: 0xffcb2b, emissive: 0x442c00, roughness: 0.4, flatShading: true }),
      // 1: Apple - glossy red
      new THREE.MeshStandardMaterial({ color: 0xdb2828, emissive: 0x220000, roughness: 0.28 }),
      // 2: Golden Corn - metallic gold with crisp faceted kernels
      new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xaa7700, metalness: 0.65, roughness: 0.22, flatShading: true }),
      // 3: Carrot - vibrant orange
      new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0x331100, roughness: 0.55 }),
      // 4: Pumpkin - deep pumpkin orange
      new THREE.MeshStandardMaterial({ color: 0xee7200, emissive: 0x2a1000, roughness: 0.65 }),
      // 5: Turnip - pale cream
      new THREE.MeshStandardMaterial({ color: 0xf5f5f0, emissive: 0x222222, roughness: 0.6 }),
      // 6: Rainbow Candy - sparkling crystalline
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.2, metalness: 0.25, flatShading: true }),
      // 7: Watermelon - striped green
      new THREE.MeshStandardMaterial({ map: createWatermelonTexture(), roughness: 0.45 }),
    ];

    for (let i = 0; i < 8; i++) {
      const cap = i === 6 ? 8 : this.maxFoodPerKind;
      const mesh = new THREE.InstancedMesh(geos[i], mats[i], cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (i === 6) {
        // Initialize instance colors for rainbow candy
        for (let j = 0; j < 8; j++) mesh.setColorAt(j, new THREE.Color(0xffffff));
      }
      this.scene.add(mesh);
      this.foodMeshes.push(mesh);
    }

    // 0: Corn Husk & stem (Vỏ bắp xanh bọc chân bắp)
    const huskProfile = [
      new THREE.Vector2(0.05, -0.84), // stalk stem
      new THREE.Vector2(0.06, -0.72),
      new THREE.Vector2(0.16, -0.58), // wrapping cob base
      new THREE.Vector2(0.25, -0.36), // husk body
      new THREE.Vector2(0.29, -0.15), // peeling husk leaf tips
    ];
    const cornHuskGeo = new THREE.LatheGeometry(huskProfile, 6);
    const cornHuskMat = new THREE.MeshStandardMaterial({ color: 0x689f38, roughness: 0.65, side: THREE.DoubleSide, flatShading: true });
    const cornHuskMesh = new THREE.InstancedMesh(cornHuskGeo, cornHuskMat, this.maxFoodPerKind);
    cornHuskMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cornHuskMesh.frustumCulled = false;
    cornHuskMesh.count = 0;
    this.scene.add(cornHuskMesh);
    this.foodTops[0] = cornHuskMesh;

    // 1: Apple stem (Cuống táo nâu)
    const appleStemGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.24, 6).translate(0, 0.42, 0);
    const appleStemMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 });
    const appleStemMesh = new THREE.InstancedMesh(appleStemGeo, appleStemMat, this.maxFoodPerKind);
    appleStemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    appleStemMesh.frustumCulled = false;
    appleStemMesh.count = 0;
    this.scene.add(appleStemMesh);
    this.foodTops[1] = appleStemMesh;

    // 2: Golden Corn Husk (Vỏ bắp vàng)
    const goldenHuskGeo = cornHuskGeo.clone().scale(1.25, 1.25, 1.25);
    const goldenHuskMat = new THREE.MeshStandardMaterial({ color: 0xe6b800, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide, flatShading: true });
    const goldenHuskMesh = new THREE.InstancedMesh(goldenHuskGeo, goldenHuskMat, this.maxFoodPerKind);
    goldenHuskMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    goldenHuskMesh.frustumCulled = false;
    goldenHuskMesh.count = 0;
    this.scene.add(goldenHuskMesh);
    this.foodTops[2] = goldenHuskMesh;

    // 3: Carrot greens (Lá cà rốt xanh mọc từ cuống phẳng phía trên củ)
    const leafProfile = [
      new THREE.Vector2(0.04, 0.35), // stem base connecting to crown
      new THREE.Vector2(0.06, 0.44), // stems
      new THREE.Vector2(0.18, 0.60), // spreading lush leaves
      new THREE.Vector2(0.14, 0.72),
      new THREE.Vector2(0.01, 0.78), // leaf tips
    ];
    const carrotTopGeo = new THREE.LatheGeometry(leafProfile, 6);
    const carrotTopMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.7, flatShading: true });
    const carrotTopMesh = new THREE.InstancedMesh(carrotTopGeo, carrotTopMat, this.maxFoodPerKind);
    carrotTopMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    carrotTopMesh.frustumCulled = false;
    carrotTopMesh.count = 0;
    this.scene.add(carrotTopMesh);
    this.foodTops[3] = carrotTopMesh;

    // 4: Pumpkin stem (Cuống bí đỏ)
    const pumpkinStemGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.35, 6).translate(0, 0.65, 0);
    const pumpkinStemMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.8 });
    const pumpkinStemMesh = new THREE.InstancedMesh(pumpkinStemGeo, pumpkinStemMat, this.maxFoodPerKind);
    pumpkinStemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pumpkinStemMesh.frustumCulled = false;
    pumpkinStemMesh.count = 0;
    this.scene.add(pumpkinStemMesh);
    this.foodTops[4] = pumpkinStemMesh;

    // 7: Watermelon stem (Cuống dưa hấu mọc từ đầu quả dưa)
    const melonStemGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.32, 6);
    melonStemGeo.rotateZ(-Math.PI / 2 + 0.28);
    melonStemGeo.translate(1.28, 0.08, 0);
    const melonStemMat = new THREE.MeshStandardMaterial({ color: 0x335522, roughness: 0.8 });
    const melonStemMesh = new THREE.InstancedMesh(melonStemGeo, melonStemMat, this.maxFoodPerKind);
    melonStemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    melonStemMesh.frustumCulled = false;
    melonStemMesh.count = 0;
    this.scene.add(melonStemMesh);
    this.foodTops[7] = melonStemMesh;


    // Soft dark circular shadows under all food items
    const shadowGeo = new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1f3a12,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.foodShadow = new THREE.InstancedMesh(shadowGeo, shadowMat, this.maxFoodTotal);
    this.foodShadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foodShadow.frustumCulled = false;
    this.foodShadow.renderOrder = 2;
    this.foodShadow.count = 0;
    this.scene.add(this.foodShadow);

    // Instanced particle mesh
    const partGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, this.maxParticles);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.scene.add(this.particleMesh);
  }

  updateFood(foodMap: Map<number, FoodItem>, now: number, podiumPos?: [number, number]): void {
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    let nShadow = 0;
    const tt = now / 1000;
    const podX = podiumPos ? podiumPos[0] : 0;
    const podZ = podiumPos ? podiumPos[1] : 0;

    for (const f of foodMap.values()) {
      const k = f.k as FoodKind;
      if (k < 0 || k > 7) continue;
      const maxForThis = k === 6 ? 8 : this.maxFoodPerKind;
      if (counts[k] >= maxForThis) continue;

      const idx = counts[k]++;
      const baseKg = FOOD_KG[k] || 1;
      const sz = Math.min(1.6, Math.max(0.7, Math.sqrt((f.v || baseKg) / baseKg)));
      const grow = f.born ? Math.max(0, Math.min(1, (now - f.born) / 350)) : 1;
      const seed = f.id * 1.37;
      const onPod = Math.hypot(f.x - podX, f.z - podZ) < CFG.PODIUM_R ? 0.53 : 0;

      if (k === 6) {
        // Rainbow candy: floats high, spins fast, cycles colors and sparkles
        this.dummy.position.set(f.x, onPod + 2.1 + Math.sin(tt * 2.5 + seed) * 0.35, f.z);
        this.dummy.rotation.set(tt * 1.3, tt * 2.1, 0);
        this.foodMeshes[6].setColorAt(idx, this.hueCol.setHSL((tt * 0.6) % 1, 1, 0.55));
        if (Math.random() < 0.35 && this.particles.length < this.maxParticles) {
          const c = this.rainbowColors[Math.floor(Math.random() * this.rainbowColors.length)];
          this.particles.push({
            x: f.x + (Math.random() - 0.5) * 3.2,
            y: onPod + 0.6 + Math.random() * 2.2,
            z: f.z + (Math.random() - 0.5) * 3.2,
            vx: 0,
            vy: 1 + Math.random() * 1.5,
            vz: 0,
            life: 0.9,
            maxLife: 0.9,
            color: new THREE.Color(c),
            size: 0.65,
            g: 0,
          });
        }
      } else if (k === 7) {
        // Watermelon: large melon sits on ground, gently rocks & turns slowly
        this.dummy.position.set(f.x, onPod + 0.62 * sz, f.z);
        this.dummy.rotation.set(0, seed + tt * 0.25, 0);
      } else if (k === 4) {
        // Pumpkin sits on the ground and turns slowly (0.3 rad/s)
        this.dummy.position.set(f.x, onPod + 0.5 * sz, f.z);
        this.dummy.rotation.set(0, seed + tt * 0.3, 0);
      } else if (k === 1) {
        // Apple floats with gentle bobbing and tumble rotation
        this.dummy.position.set(f.x, onPod + 0.45 * sz + Math.sin(tt * 3 + seed) * 0.12, f.z);
        this.dummy.rotation.set(0, tt + seed, 0);
        this.dummy.rotateX(0.4);
      } else {
        // Corn, Golden Corn, Carrot: angled lean with steady spinning around its axis
        this.dummy.position.set(f.x, onPod + 0.45 * sz + Math.sin(tt * 3 + seed) * 0.12, f.z);
        this.dummy.rotation.set(0, tt + seed, 0);
        this.dummy.rotateZ(Math.PI / 4);
      }

      // Golden corn has a gentle pulsating glow size
      const pulse = k === 2 ? 1 + Math.sin(tt * 6 + seed) * 0.12 : 1;
      this.dummy.scale.setScalar(grow * sz * pulse);
      this.dummy.updateMatrix();

      this.foodMeshes[k].setMatrixAt(idx, this.dummy.matrix);
      if (this.foodTops[k]) {
        this.foodTops[k]!.setMatrixAt(idx, this.dummy.matrix);
      }

      // Render ground shadow disc under food item
      if (nShadow < this.maxFoodTotal) {
        const shadowScale = grow * sz * (k === 6 ? 3.4 : k === 7 ? 2.6 : k === 4 ? 2.0 : 1.0);
        this.shadowM.makeScale(shadowScale, 1, shadowScale);
        this.shadowM.setPosition(f.x, onPod + 0.05, f.z);
        this.foodShadow.setMatrixAt(nShadow++, this.shadowM);
      }
    }

    for (let k = 0; k < 8; k++) {
      this.foodMeshes[k].count = counts[k];
      this.foodMeshes[k].instanceMatrix.needsUpdate = true;
      if (this.foodTops[k as FoodKind]) {
        this.foodTops[k as FoodKind]!.count = counts[k];
        this.foodTops[k as FoodKind]!.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.foodMeshes[6].instanceColor) {
      this.foodMeshes[6].instanceColor.needsUpdate = true;
    }

    this.foodShadow.count = nShadow;
    this.foodShadow.instanceMatrix.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, colorHex: number, count = 15, speed = 8, up = 6, life = 0.9): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * speed;
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * Math.max(1, up - 2),
        vz: Math.sin(a) * sp,
        life,
        maxLife: life,
        color: col,
        size: 0.6 + Math.random() * 0.8,
        g: 14,
      });
    }
  }

  puff(x: number, y: number, z: number, colorHex: number, size = 1.3, life = 0.8, vy = 2): void {
    if (this.particles.length < this.maxParticles) {
      this.particles.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 1.2,
        vy,
        vz: (Math.random() - 0.5) * 1.2,
        life,
        maxLife: life,
        color: new THREE.Color(colorHex),
        size,
        g: -0.5,
      });
    }
  }

  fluff(x: number, z: number, colorHex: number, count = 8): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 1.0,
        y: 1.4,
        z: z + (Math.random() - 0.5) * 1.0,
        vx: (Math.random() - 0.5) * 8,
        vy: 2 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 8,
        life: 1.2,
        maxLife: 1.2,
        color: col,
        size: 0.4 + Math.random() * 0.4,
        g: 4,
      });
    }
  }

  rainbowTrail(x: number, y: number, z: number, angle: number, r: number, isDash: boolean): void {
    const px = -Math.sin(angle);
    const pz = Math.cos(angle);
    const tx = x - Math.cos(angle) * r * 0.95;
    const tz = z - Math.sin(angle) * r * 0.95;

    if (isDash) {
      // 6 parallel colored ribbon streams trailing behind the tail
      for (let i = 0; i < 6 && this.particles.length < this.maxParticles; i++) {
        const off = (i - 2.5) * 0.22 * r;
        this.particles.push({
          x: tx + px * off,
          y: y + (Math.random() - 0.5) * 0.12,
          z: tz + pz * off,
          vx: (Math.random() - 0.5) * 0.4,
          vy: 0.2 + Math.random() * 0.4,
          vz: (Math.random() - 0.5) * 0.4,
          life: 0.65,
          maxLife: 0.65,
          color: new THREE.Color(this.rainbowColors[i]),
          size: 0.75 * r,
          g: -0.2,
        });
      }
    } else {
      // Walking trail: cycling vibrant sparkles
      const col = this.rainbowColors[Math.floor(Math.random() * this.rainbowColors.length)];
      if (this.particles.length < this.maxParticles) {
        this.particles.push({
          x: tx + (Math.random() - 0.5) * 0.3 * r,
          y: y + (Math.random() - 0.5) * 0.1,
          z: tz + (Math.random() - 0.5) * 0.3 * r,
          vx: (Math.random() - 0.5) * 0.6,
          vy: 0.4 + Math.random() * 0.4,
          vz: (Math.random() - 0.5) * 0.6,
          life: 0.5,
          maxLife: 0.5,
          color: new THREE.Color(col),
          size: 0.6 * r,
          g: 0,
        });
      }
    }
  }

  sonicWave(x: number, y: number, z: number, r: number): void {
    const count = 16;
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 8 + Math.random() * 5;
      this.particles.push({
        x: x + Math.cos(a) * r * 0.8,
        y: y + 0.1,
        z: z + Math.sin(a) * r * 0.8,
        vx: Math.cos(a) * sp,
        vy: 0.2,
        vz: Math.sin(a) * sp,
        life: 0.28,
        maxLife: 0.28,
        color: new THREE.Color(0xa7f3d0),
        size: 0.65 * r,
        g: 0,
      });
    }
  }

  updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Bounce on ground with friction and dampening (matching main.js.download)
      if (p.y < 0.15) {
        p.y = 0.15;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }

    let aliveCount = 0;
    for (const p of this.particles) {
      // Smooth scale shrink formula: smoothly vanishes before dying
      const s = p.size * Math.min(1, (p.life / p.maxLife) * 1.5);

      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();

      this.particleMesh.setMatrixAt(aliveCount, this.dummy.matrix);
      this.particleMesh.setColorAt(aliveCount, p.color);
      aliveCount++;
    }

    this.particleMesh.count = aliveCount;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }
}
