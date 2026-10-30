import * as THREE from 'three';
import { radiusOf, type Species } from '@shared/constants';
import type { MinionWire } from '@shared/protocol';
import type { MapData } from '@shared/map';
import { terrainAt } from '@shared/physics';
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
  sinkProgress?: number;
}

export class MinionRenderer {
  private readonly minions = new Map<number, MinionVisual>();
  private readonly group = new THREE.Group();
  private map: MapData | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  setMap(map: MapData): void {
    this.map = map;
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

      vis.root.rotation.y = -vis.a;

      const r = radiusOf(vis.mass);
      const sc = r * 1.35;
      const isWater = this.map ? terrainAt(this.map, vis.x, vis.z) === 1 : false;

      if (isWater) {
        // Requirement 5: Water animation - swimming or sinking like real animals
        vis.sinkProgress = Math.min(1, (vis.sinkProgress || 0) + dt * 0.4);
        let y = 0;
        if (vis.species === 'duck') {
          // Ducks float peacefully on the surface with subtle bobbing
          y = -0.20 * sc + Math.sin(now / 300) * 0.035;
          vis.root.rotation.z = Math.sin(vis.phase * 0.7) * 0.08;
          vis.root.rotation.x = 0;
          vis.legs.forEach((leg, idx) => {
            leg.visible = true;
            leg.rotation.z = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI)) * 0.4;
            leg.rotation.x = 0;
          });
        } else if (vis.species === 'dog') {
          // Dogs swim, half body submerged with paddling bob
          y = -0.90 * sc + Math.sin(now / 220) * 0.022;
          vis.root.rotation.z = Math.sin(vis.phase * 0.5) * 0.06;
          vis.root.rotation.x = 0;
          // Hide legs while swimming like the real dog
          vis.legs.forEach((leg) => {
            leg.visible = false;
          });
        } else {
          // Other animals sink into water with struggling paddle motion
          const sinkProgress = vis.sinkProgress || 0;
          const sinkDepth = 0.25 + Math.pow(sinkProgress, 1.3) * 0.95;
          const rippleBob = Math.sin(now / 160) * 0.035 * (1 - sinkProgress);
          y = -sinkDepth * sc + (sinkProgress < 0.95 ? rippleBob : 0);

          vis.root.rotation.z = Math.sin(now / 180) * 0.25;
          vis.root.rotation.x = Math.sin(now / 200) * 0.18;

          const paddleSpeed = Math.max(0.15, 1 - sinkProgress * 0.75);
          vis.legs.forEach((leg, idx) => {
            leg.visible = true;
            const baseSwing = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI) + (idx > 1 ? Math.PI : 0));
            leg.rotation.z = baseSwing * 0.4 * paddleSpeed;
            leg.rotation.x = Math.sin(now / 160 + idx * 1.5) * 0.35 * paddleSpeed;
          });
        }
        vis.ring.visible = false;
        vis.root.position.set(vis.x, y, vis.z);
      } else {
        // On land: keep terrain unaffected, run normally
        vis.sinkProgress = Math.max(0, (vis.sinkProgress || 0) - dt * 2.0);
        const moveSpeed = dist / Math.max(dt, 0.001);
        vis.phase += dt * (8 + Math.min(16, moveSpeed * 8));
        const hopY = Math.abs(Math.sin(vis.phase)) * 0.08 * r;
        vis.root.position.set(vis.x, hopY, vis.z);
        vis.root.rotation.z = 0;
        vis.root.rotation.x = 0;
        vis.ring.visible = true;
        vis.legs.forEach((leg, idx) => {
          leg.visible = true;
          leg.rotation.z = Math.sin(vis.phase + (idx % 2 === 0 ? 0 : Math.PI)) * 0.7;
          leg.rotation.x = 0;
        });
      }

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
