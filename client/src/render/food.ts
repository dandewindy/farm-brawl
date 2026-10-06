import * as THREE from 'three';
import { FOOD_KG, type FoodKind } from '@shared/constants';
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
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly maxFoodPerKind = 400;
  private readonly maxParticles = 600;

  constructor(private readonly scene: THREE.Scene) {
    // Geometries & materials for 5 food types:
    // 0: Corn (yellow capsule)
    // 1: Apple (red sphere)
    // 2: Golden Corn (gold glowing capsule)
    // 3: Carrot (orange cone)
    // 4: Pumpkin (orange squashed sphere)

    const geos = [
      new THREE.CapsuleGeometry(0.22, 0.45, 4, 8),
      new THREE.SphereGeometry(0.35, 8, 8),
      new THREE.CapsuleGeometry(0.32, 0.65, 4, 8),
      new THREE.ConeGeometry(0.2, 0.7, 6),
      new THREE.SphereGeometry(0.55, 8, 8),
    ];
    geos[4].scale(1, 0.75, 1);

    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xffd94a, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xeb3b3b, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0x553300, metalness: 0.5, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xf58220, roughness: 0.7 }),
    ];

    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.InstancedMesh(geos[i], mats[i], this.maxFoodPerKind);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
      this.foodMeshes.push(mesh);
    }

    // Instanced particle mesh
    const partGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, this.maxParticles);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.count = 0;
    this.scene.add(this.particleMesh);
  }

  updateFood(foodMap: Map<number, FoodItem>, now: number): void {
    const counts = [0, 0, 0, 0, 0];
    const max = this.maxFoodPerKind;

    for (const f of foodMap.values()) {
      const k = f.k as FoodKind;
      if (counts[k] >= max) continue;

      const idx = counts[k]++;
      const baseKg = FOOD_KG[k] || 1;
      const scale = Math.min(1.6, Math.max(0.7, Math.sqrt(f.v / baseKg)));
      const bob = Math.sin(now * 0.003 + f.id * 1.5) * 0.08;

      this.dummy.position.set(f.x, 0.35 * scale + bob, f.z);
      this.dummy.rotation.y = f.id * 0.7 + now * 0.001;
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();

      this.foodMeshes[k].setMatrixAt(idx, this.dummy.matrix);
    }

    for (let k = 0; k < 5; k++) {
      this.foodMeshes[k].count = counts[k];
      this.foodMeshes[k].instanceMatrix.needsUpdate = true;
    }
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
