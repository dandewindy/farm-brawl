import * as THREE from 'three';
import { radiusOf, type Species } from '@shared/constants';
import type { MinionWire } from '@shared/protocol';
import { getArenaTheme } from '../theme';
import { buildFullAnimal } from './animals';

interface MinionVisual {
  id: number;
  ownerId: number;
  root: THREE.Group;
  animalRoot: THREE.Group;
  ring: THREE.Mesh;
  legs: THREE.Group[];
  x: number;
  z: number;
  a: number;
  targetX: number;
  targetZ: number;
  targetA: number;
  mass: number;
  phase: number;
  species: Species;
  skin: number;
  ringMat: THREE.MeshBasicMaterial;
}

export class MinionRenderer {
  private readonly minions = new Map<number, MinionVisual>();
  private readonly group = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  private buildMinionMesh(species: Species, skinIdx: number, mass = 50): {
    root: THREE.Group;
    animalRoot: THREE.Group;
    ring: THREE.Mesh;
    legs: THREE.Group[];
    ringMat: THREE.MeshBasicMaterial;
  } {
    const root = new THREE.Group();
    const theme = getArenaTheme();
    const r = radiusOf(mass);
    const sc = r * 1.35;

    let animalRoot: THREE.Group;
    let legs: THREE.Group[];

    if (theme === 'halloween') {
      // Zombie mini warrior: green rotting flesh & glowing red eyes
      const full = buildFullAnimal(species, skinIdx);
      animalRoot = full.root;
      legs = full.legs;
      full.body.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material = child.material.clone();
          child.material.color.setHex(0x546e50); // Rotting zombie skin
          child.material.roughness = 0.9;
        }
      });
      // Glowing evil red eyes
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
      const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      leftEye.position.set(0.6, 1.4, 0.2);
      const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      rightEye.position.set(0.6, 1.4, -0.2);
      animalRoot.add(leftEye, rightEye);
    } else {
      // Cute mini animal clone with golden bodyguard ring
      const full = buildFullAnimal(species, skinIdx);
      animalRoot = full.root;
      legs = full.legs;
    }

    // Exact 50kg animal scale (r * 1.35 = 2.209)
    animalRoot.scale.set(sc, sc, sc);
    root.add(animalRoot);

    // Ground aura ring matching exact radiusOf(mass)
    const ringMat = new THREE.MeshBasicMaterial({
      color: theme === 'halloween' ? 0x39ff14 : (theme === 'women_day' ? 0xff4081 : 0xffd700),
      transparent: true,
      opacity: theme === 'halloween' ? 0.65 : 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.88, 1.08, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.05;
    ring.scale.setScalar(r);
    root.add(ring);

    return { root, animalRoot, ring, legs, ringMat };
  }

  sync(list: MinionWire[]): void {
    const live = new Set<number>();
    for (const [id, ownerId, x, z, a, mass, species, skin] of list) {
      live.add(id);
      let vis = this.minions.get(id);
      if (!vis) {
        const { root, animalRoot, ring, legs, ringMat } = this.buildMinionMesh(species, skin, mass);
        root.position.set(x, 0, z);
        root.rotation.y = -a;
        this.group.add(root);
        vis = {
          id,
          ownerId,
          root,
          animalRoot,
          ring,
          legs,
          x,
          z,
          a,
          targetX: x,
          targetZ: z,
          targetA: a,
          mass,
          phase: Math.random() * 6,
          species,
          skin,
          ringMat,
        };
        this.minions.set(id, vis);
      } else {
        vis.targetX = x;
        vis.targetZ = z;
        vis.targetA = a;
        if (vis.mass !== mass) {
          vis.mass = mass;
          const r = radiusOf(mass);
          const sc = r * 1.35;
          vis.animalRoot.scale.set(sc, sc, sc);
          vis.ring.scale.setScalar(r);
        }
      }
    }

    // Clean up dead minions
    for (const [id, vis] of this.minions) {
      if (!live.has(id)) {
        this.group.remove(vis.root);
        vis.root.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
        this.minions.delete(id);
      }
    }
  }

  update(dt: number, now: number): void {
    const lerpRate = 1 - Math.exp(-18 * Math.min(dt, 0.05));
    for (const vis of this.minions.values()) {
      const dx = vis.targetX - vis.x;
      const dz = vis.targetZ - vis.z;
      const dist = Math.hypot(dx, dz);
      vis.x += dx * lerpRate;
      vis.z += dz * lerpRate;

      // Angle interpolation
      let da = vis.targetA - vis.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      vis.a += da * lerpRate;

      vis.root.position.set(vis.x, 0, vis.z);
      vis.root.rotation.y = -vis.a;

      // Leg running animation
      const moveSpeed = dist / Math.max(dt, 0.001);
      vis.phase += dt * (8 + Math.min(16, moveSpeed * 8));
      vis.legs.forEach((leg, idx) => {
        leg.rotation.z = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI)) * 0.7;
      });

      // Pulse ring opacity
      vis.ringMat.opacity = 0.5 + 0.3 * Math.sin(now / 150 + vis.id);
    }
  }

  clear(): void {
    for (const vis of this.minions.values()) {
      this.group.remove(vis.root);
      vis.root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.minions.clear();
  }
}
