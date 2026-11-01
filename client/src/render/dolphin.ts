import * as THREE from 'three';
import type { MapData, Blob } from '@shared/map';
import { createHeartGeometry } from './tools';

export class DolphinRenderer {
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly headHeart = new THREE.Group();

  private pondCenter = new THREE.Vector2(0, 0);
  private pondRadius = 15;
  private hasPond = false;

  private state: 'swim' | 'jump' | 'surface_center' = 'swim';
  private swimAngle = 0;
  private swimSpeed = 3.8; // m/s
  private jumpTimer = 0;
  private jumpDur = 1.8; // seconds
  private jumpStartY = 0;
  private nextJumpTimer = 10 + Math.random() * 5;
  private heartCycleTimer = 30; // 30s interval
  private surfaceHoldTimer = 0;

  private onSplash?: (x: number, y: number, z: number, count?: number) => void;

  constructor(scene: THREE.Scene, onSplash?: (x: number, y: number, z: number, count?: number) => void) {
    this.onSplash = onSplash;
    this.buildDolphin();
    this.root.visible = false;
    scene.add(this.root);
  }

  setMap(map: MapData): void {
    if (!map.pond || map.pond.length === 0) {
      this.hasPond = false;
      this.root.visible = false;
      return;
    }
    // Find largest pond by radius
    const largestPond = map.pond.reduce((max: Blob, p: Blob) => (p[2] > max[2] ? p : max), map.pond[0]);
    this.pondCenter.set(largestPond[0], largestPond[1]);
    this.pondRadius = largestPond[2];
    this.hasPond = true;
    this.root.visible = true;
    this.swimAngle = Math.random() * Math.PI * 2;
    this.state = 'swim';
    this.nextJumpTimer = 8 + Math.random() * 6;
    this.heartCycleTimer = 30;
  }

  private buildDolphin(): void {
    // 30kg Dolphin: length ~1.5m, width ~0.42m, height ~0.4m
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0x0288d1, // Oceanic cerulean blue
      roughness: 0.28,
      metalness: 0.12,
    });
    const bellyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Smooth creamy white underbelly
      roughness: 0.32,
      metalness: 0.05,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.2,
      metalness: 0.8,
    });

    // Body (Torso)
    const torsoGeo = new THREE.SphereGeometry(0.24, 18, 14);
    torsoGeo.scale(1.0, 0.9, 1.8);
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    torso.position.set(0, 0, 0);
    this.body.add(torso);

    // White underbelly
    const bellyGeo = new THREE.SphereGeometry(0.22, 14, 10);
    bellyGeo.scale(0.85, 0.5, 1.6);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, -0.09, 0.02);
    this.body.add(belly);

    // Melon (Forehead)
    const melonGeo = new THREE.SphereGeometry(0.18, 14, 12);
    melonGeo.scale(0.9, 0.85, 1.1);
    const melon = new THREE.Mesh(melonGeo, skinMat);
    melon.position.set(0, 0.06, 0.32);
    this.body.add(melon);

    // Snout / Rostrum (Beak)
    const beakGeo = new THREE.ConeGeometry(0.08, 0.24, 12);
    beakGeo.rotateX(Math.PI / 2);
    const beak = new THREE.Mesh(beakGeo, skinMat);
    beak.position.set(0, -0.03, 0.52);
    this.body.add(beak);

    // Friendly smile line (small dark wedge)
    const smile = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.015, 0.16), darkMat);
    smile.position.set(0, -0.06, 0.48);
    this.body.add(smile);

    // Blowhole on top of head
    const blowhole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), darkMat);
    blowhole.position.set(0, 0.18, 0.22);
    this.body.add(blowhole);

    // Cute dark eyes with white specular highlight
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), darkMat);
      eye.position.set(side * 0.17, 0.07, 0.28);
      this.body.add(eye);

      const eyeGlint = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      eyeGlint.position.set(side * 0.185, 0.085, 0.295);
      this.body.add(eyeGlint);
    }

    // Curved swept-back dorsal fin on back
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(0, 0);
    dorsalShape.bezierCurveTo(-0.02, 0.15, -0.12, 0.28, -0.25, 0.3);
    dorsalShape.bezierCurveTo(-0.16, 0.18, -0.14, 0.06, -0.18, 0);
    dorsalShape.closePath();
    const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, {
      depth: 0.035,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.01,
      bevelThickness: 0.01,
    });
    dorsalGeo.center();
    const dorsal = new THREE.Mesh(dorsalGeo, skinMat);
    dorsal.rotation.y = Math.PI / 2;
    dorsal.position.set(0, 0.26, -0.08);
    this.body.add(dorsal);

    // Pectoral flippers (left and right)
    for (const side of [-1, 1]) {
      const flipperGeo = new THREE.ConeGeometry(0.12, 0.38, 6);
      flipperGeo.scale(0.3, 1.0, 0.8);
      const flipper = new THREE.Mesh(flipperGeo, skinMat);
      flipper.position.set(side * 0.24, -0.1, 0.12);
      flipper.rotation.z = side * 1.1;
      flipper.rotation.x = -0.55;
      flipper.rotation.y = side * 0.2;
      this.body.add(flipper);
    }

    // Tail Stalk (Peduncle) & Flukes (Tail Fin) - hinged for flapping
    this.tail.position.set(0, 0, -0.38);

    const tailStalkGeo = new THREE.ConeGeometry(0.14, 0.46, 12);
    tailStalkGeo.rotateX(-Math.PI / 2);
    tailStalkGeo.scale(0.7, 0.9, 1.0);
    const tailStalk = new THREE.Mesh(tailStalkGeo, skinMat);
    tailStalk.position.set(0, 0, -0.2);
    this.tail.add(tailStalk);

    // Horizontal Fluke (Tail fin)
    const flukeShape = new THREE.Shape();
    flukeShape.moveTo(0, -0.06);
    flukeShape.bezierCurveTo(0.18, 0.08, 0.32, 0.12, 0.38, 0.04);
    flukeShape.bezierCurveTo(0.28, -0.04, 0.14, -0.12, 0.04, -0.14);
    flukeShape.lineTo(0, -0.11); // center notch
    flukeShape.lineTo(-0.04, -0.14);
    flukeShape.bezierCurveTo(-0.14, -0.12, -0.28, -0.04, -0.38, 0.04);
    flukeShape.bezierCurveTo(-0.32, 0.12, -0.18, 0.08, 0, -0.06);
    flukeShape.closePath();

    const flukeGeo = new THREE.ExtrudeGeometry(flukeShape, {
      depth: 0.025,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.008,
      bevelThickness: 0.008,
    });
    flukeGeo.center();
    const fluke = new THREE.Mesh(flukeGeo, skinMat);
    fluke.position.set(0, 0, -0.44);
    this.tail.add(fluke);

    this.body.add(this.tail);
    this.root.add(this.body);

    // Head crown socket for heart item (surfacing at 30s)
    const heartGeo = createHeartGeometry(0.24);
    heartGeo.scale(0.48, 0.48, 0.48);
    const heartMat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xff4081,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.2,
    });
    const heartMesh = new THREE.Mesh(heartGeo, heartMat);
    heartMesh.name = 'dolphinHeadHeartMesh';
    this.headHeart.add(heartMesh);

    // Mini halo ring
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.018, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xff80ab,
        emissive: 0xff4081,
        emissiveIntensity: 0.8,
      })
    );
    halo.rotation.x = Math.PI / 3;
    this.headHeart.add(halo);

    this.headHeart.position.set(0, 0.28, 0.25);
    this.headHeart.visible = false;
    this.body.add(this.headHeart);
  }

  update(dt: number, now: number): void {
    if (!this.hasPond) return;

    // Swimming radius inside the largest pond
    const swimR = Math.max(4.0, this.pondRadius * 0.6);
    const waterLevel = 0.0;

    // Countdown to 30s heart surfacing
    this.heartCycleTimer -= dt;
    if (this.heartCycleTimer <= 0 && this.state !== 'surface_center') {
      this.state = 'surface_center';
      this.surfaceHoldTimer = 6.0;
      this.heartCycleTimer = 30;
      this.headHeart.visible = true;
    }

    if (this.state === 'swim') {
      this.headHeart.visible = false;
      this.swimAngle += (this.swimSpeed / swimR) * dt;
      const targetX = this.pondCenter.x + Math.cos(this.swimAngle) * swimR;
      const targetZ = this.pondCenter.y + Math.sin(this.swimAngle) * swimR;

      // Dolphin swims just at or slightly below surface
      const targetY = waterLevel - 0.12 + Math.sin(now * 0.0035) * 0.08;
      this.root.position.set(targetX, targetY, targetZ);

      // Facing tangent along the swimming circle
      const forwardAngle = this.swimAngle + Math.PI / 2;
      this.root.rotation.y = -forwardAngle + Math.PI / 2;

      // Inward banking roll while turning
      this.body.rotation.z = 0.18;
      this.body.rotation.x = Math.sin(now * 0.004) * 0.08;

      // Tail flapping vertically
      this.tail.rotation.x = Math.sin(now * 0.007) * 0.28;

      // Random jump countdown
      this.nextJumpTimer -= dt;
      if (this.nextJumpTimer <= 0) {
        this.state = 'jump';
        this.jumpTimer = 0;
        this.jumpStartY = this.root.position.y;
        this.nextJumpTimer = 12 + Math.random() * 8;
        // Splash takeoff
        this.onSplash?.(this.root.position.x, 0.1, this.root.position.z, 14);
      }
    } else if (this.state === 'jump') {
      this.jumpTimer += dt;
      const t = Math.min(1.0, this.jumpTimer / this.jumpDur);

      // Continue circling forward along arc during jump
      this.swimAngle += (this.swimSpeed * 1.2 / swimR) * dt;
      const targetX = this.pondCenter.x + Math.cos(this.swimAngle) * swimR;
      const targetZ = this.pondCenter.y + Math.sin(this.swimAngle) * swimR;

      // High parabolic leap out of the water up to 2.2m!
      const jumpPeak = 2.2;
      const targetY = waterLevel + 4 * jumpPeak * t * (1 - t);
      this.root.position.set(targetX, targetY, targetZ);

      const forwardAngle = this.swimAngle + Math.PI / 2;
      this.root.rotation.y = -forwardAngle + Math.PI / 2;

      // Pitch rotates gracefully: up -> apex flat -> dive plunge
      const pitch = (0.5 - t) * 1.5; // +0.75 -> -0.75 rad
      this.body.rotation.x = pitch;
      this.body.rotation.z = 0.05;

      // Tail flap during jump
      this.tail.rotation.x = Math.sin(now * 0.012) * 0.35;

      if (t >= 1.0) {
        this.state = 'swim';
        // Water re-entry splash plunge!
        this.onSplash?.(this.root.position.x, 0.1, this.root.position.z, 22);
      }
    } else if (this.state === 'surface_center') {
      // Swims to pond center and surfaces proudly presenting the heart
      const targetX = this.pondCenter.x;
      const targetZ = this.pondCenter.y;

      // Smoothly approach center
      this.root.position.x += (targetX - this.root.position.x) * 2.5 * dt;
      this.root.position.z += (targetZ - this.root.position.z) * 2.5 * dt;

      // Head rises high out of water with heart
      const targetY = waterLevel + 0.38 + Math.sin(now * 0.003) * 0.05;
      this.root.position.y += (targetY - this.root.position.y) * 3.0 * dt;

      // Upright proud posture
      this.body.rotation.x = 0.42; // nose pointing up
      this.body.rotation.z = Math.sin(now * 0.002) * 0.08;
      this.tail.rotation.x = Math.sin(now * 0.005) * 0.15;

      // Animate heart on head (color shift & thumping beat)
      const heartMesh = this.headHeart.getObjectByName('dolphinHeadHeartMesh') as THREE.Mesh | undefined;
      if (heartMesh && heartMesh.material instanceof THREE.MeshStandardMaterial) {
        const colRed = new THREE.Color(0xff1744);
        const colPink = new THREE.Color(0xff4081);
        const cycle = (Math.sin(now * 0.004) + 1) * 0.5;
        const col = new THREE.Color().lerpColors(colRed, colPink, cycle);
        heartMesh.material.color.copy(col);
        heartMesh.material.emissive.copy(col);
        const beat = 0.65 * (1.0 + 0.15 * Math.pow(Math.max(0, Math.sin(now * 0.006)), 3));
        heartMesh.scale.set(beat, beat, beat);
      }

      this.surfaceHoldTimer -= dt;
      if (this.surfaceHoldTimer <= 0) {
        this.state = 'swim';
        this.headHeart.visible = false;
        this.onSplash?.(this.root.position.x, 0.1, this.root.position.z, 16);
      }
    }
  }

  destroy(): void {
    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
  }
}
