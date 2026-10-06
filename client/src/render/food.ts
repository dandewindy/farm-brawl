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
}

export class FoodAndParticleRenderer {
  private readonly foodMeshes: THREE.InstancedMesh[] = [];
  private readonly foodTops: Partial<Record<FoodKind, THREE.InstancedMesh>> = {};
  private readonly foodShadow: THREE.InstancedMesh;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly shadowM = new THREE.Matrix4();
  private readonly maxFoodPerKind = 800;
  private readonly maxFoodTotal = 1500;
  private readonly maxParticles = 600;

  constructor(private readonly scene: THREE.Scene) {
    // Geometries & materials matching original game:
    // 0: Corn (yellow capsule)
    // 1: Apple (red sphere)
    // 2: Golden Corn (gold glowing capsule)
    // 3: Carrot (orange cone) + green leaves top
    // 4: Pumpkin (squashed orange sphere) + green stem top

    const geos = [
      new THREE.CapsuleGeometry(0.22, 0.5, 4, 8),
      new THREE.SphereGeometry(0.42, 8, 8),
      new THREE.CapsuleGeometry(0.36, 0.8, 4, 8),
      new THREE.ConeGeometry(0.2, 0.75, 6),
      new THREE.SphereGeometry(0.75, 10, 8).scale(1, 0.72, 1),
    ];

    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0x554000, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xe8322e, emissive: 0x220000, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0x996600, metalness: 0.5, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x331100, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xf28a1a, emissive: 0x2a1000, roughness: 0.7 }),
    ];

    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.InstancedMesh(geos[i], mats[i], this.maxFoodPerKind);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // CRITICAL: prevent disappearing when camera moves away from origin!
      mesh.count = 0;
      this.scene.add(mesh);
      this.foodMeshes.push(mesh);
    }

    // Green carrot leaves & pumpkin stems (matching main.js.download lines 699-702)
    const carrotTopGeo = new THREE.ConeGeometry(0.15, 0.32, 5).rotateX(Math.PI).translate(0, -0.52, 0);
    const carrotTopMat = new THREE.MeshStandardMaterial({ color: 0x3f9a3a, roughness: 0.7 });
    const carrotTopMesh = new THREE.InstancedMesh(carrotTopGeo, carrotTopMat, this.maxFoodPerKind);
    carrotTopMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    carrotTopMesh.frustumCulled = false;
    carrotTopMesh.count = 0;
    this.scene.add(carrotTopMesh);
    this.foodTops[3] = carrotTopMesh;

    const pumpkinStemGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5).translate(0, 0.62, 0);
    const pumpkinStemMat = new THREE.MeshStandardMaterial({ color: 0x4f7a2a, roughness: 0.7 });
    const pumpkinStemMesh = new THREE.InstancedMesh(pumpkinStemGeo, pumpkinStemMat, this.maxFoodPerKind);
    pumpkinStemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pumpkinStemMesh.frustumCulled = false;
    pumpkinStemMesh.count = 0;
    this.scene.add(pumpkinStemMesh);
    this.foodTops[4] = pumpkinStemMesh;

    // Soft dark circular shadows under all food items (matching main.js.download line 707)
    const shadowGeo = new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1f3a12,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.foodShadow = new THREE.InstancedMesh(shadowGeo, shadowMat, this.maxFoodTotal);
    this.foodShadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foodShadow.frustumCulled = false; // CRITICAL: never cull shadow mesh!
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
    const counts = [0, 0, 0, 0, 0];
    const max = this.maxFoodPerKind;
    let nShadow = 0;
    const tt = now / 1000; // Continuous time in seconds, ensures smooth constant rotational speed
    const podX = podiumPos ? podiumPos[0] : 0;
    const podZ = podiumPos ? podiumPos[1] : 0;

    for (const f of foodMap.values()) {
      const k = f.k as FoodKind;
      if (k < 0 || k > 4) continue;
      if (counts[k] >= max) continue;

      const idx = counts[k]++;
      const baseKg = FOOD_KG[k] || 1;
      const sz = Math.min(1.6, Math.max(0.7, Math.sqrt((f.v || baseKg) / baseKg)));
      const grow = f.born ? Math.min(1, (now - f.born) / 350) : 1;
      const seed = f.id * 1.37;
      const onPod = Math.hypot(f.x - podX, f.z - podZ) < CFG.PODIUM_R ? 0.53 : 0;

      if (k === 4) {
        // Pumpkin sits on the ground and turns slowly (0.3 rad/s)
        this.dummy.position.set(f.x, onPod + 0.5 * sz, f.z);
        this.dummy.rotation.set(0, seed + tt * 0.3, 0);
      } else if (k === 1) {
        // Apple floats with gentle bobbing and tumble rotation
        this.dummy.position.set(f.x, onPod + 0.45 * sz + Math.sin(tt * 3 + seed) * 0.12, f.z);
        this.dummy.rotation.set(tt * 0.7 + seed, tt + seed, 0);
      } else {
        // Corn, Golden Corn, Carrot: angled lean with steady spinning
        this.dummy.position.set(f.x, onPod + 0.45 * sz + Math.sin(tt * 3 + seed) * 0.12, f.z);
        this.dummy.rotation.set(0.5, tt + seed, Math.PI / 2.5);
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
        const shadowScale = grow * sz * (k === 4 ? 2.0 : 1.0);
        this.shadowM.makeScale(shadowScale, 1, shadowScale);
        this.shadowM.setPosition(f.x, onPod + 0.04, f.z);
        this.foodShadow.setMatrixAt(nShadow++, this.shadowM);
      }
    }

    for (let k = 0; k < 5; k++) {
      this.foodMeshes[k].count = counts[k];
      this.foodMeshes[k].instanceMatrix.needsUpdate = true;
      if (this.foodTops[k as FoodKind]) {
        this.foodTops[k as FoodKind]!.count = counts[k];
        this.foodTops[k as FoodKind]!.instanceMatrix.needsUpdate = true;
      }
    }

    this.foodShadow.count = nShadow;
    this.foodShadow.instanceMatrix.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, colorHex: number, count = 15, speed = 8): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * speed;
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * 6,
        vz: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1.0,
        color: col,
        size: 0.5 + Math.random() * 0.8,
      });
    }
  }

  updateParticles(dt: number): void {
    let aliveCount = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      p.vy -= 14 * dt; // gravity
      p.x += p.vx * dt;
      p.y = Math.max(0.1, p.y + p.vy * dt);
      p.z += p.vz * dt;

      const progress = p.life / p.maxLife;
      const s = p.size * progress;

      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();

      this.particleMesh.setMatrixAt(aliveCount, this.dummy.matrix);
      this.particleMesh.setColorAt(aliveCount, p.color);
      aliveCount++;
    }

    this.particleMesh.count = aliveCount;
    if (aliveCount > 0) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }
}
