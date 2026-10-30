import * as THREE from 'three';

interface ActiveBanana {
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  t: number;
  dur: number;
  giant: boolean;
}

export class BananaRenderer {
  private readonly group = new THREE.Group();
  private readonly bananas: ActiveBanana[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  spawn(x: number, z: number, vx: number, vz: number, giant = false): void {
    const bGroup = new THREE.Group();
    const sc = giant ? 2.4 : 1.0;

    // Curved golden banana body using TubeGeometry with CatmullRomCurve3
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.45 * sc, 0.35 * sc, 0),
      new THREE.Vector3(-0.15 * sc, 0.08 * sc, 0),
      new THREE.Vector3(0.20 * sc, 0.12 * sc, 0),
      new THREE.Vector3(0.50 * sc, 0.40 * sc, 0),
    ]);
    const tubeGeo = new THREE.TubeGeometry(curve, 14, 0.18 * sc, 8, false);
    const bananaMat = new THREE.MeshStandardMaterial({
      color: giant ? 0xffeb3b : 0xffd54f,
      emissive: giant ? 0xff9800 : 0xf57f17,
      emissiveIntensity: giant ? 0.75 : 0.35,
      roughness: 0.25,
      metalness: 0.2,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, bananaMat);
    bGroup.add(tubeMesh);

    // Green stem at top
    const stemGeo = new THREE.CylinderGeometry(0.06 * sc, 0.08 * sc, 0.22 * sc, 6);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.6 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(-0.48 * sc, 0.42 * sc, 0);
    stem.rotation.z = 0.5;
    bGroup.add(stem);

    // Dark tip at bottom
    const tipGeo = new THREE.SphereGeometry(0.08 * sc, 6, 6);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0.52 * sc, 0.42 * sc, 0);
    bGroup.add(tip);

    if (giant) {
      // Sparkling ring around giant banana
      const ringGeo = new THREE.TorusGeometry(0.85 * sc, 0.04 * sc, 6, 16);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.8 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      bGroup.add(ring);
    }

    bGroup.position.set(x, 1.2, z);
    this.group.add(bGroup);

    this.bananas.push({
      mesh: bGroup,
      x,
      y: 1.2,
      z,
      vx,
      vz,
      t: 0,
      dur: giant ? 1.2 : 0.9,
      giant,
    });
  }

  update(dt: number, onPuff?: (x: number, y: number, z: number, color: number, size?: number, life?: number, vy?: number) => void): void {
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      b.t += dt;
      if (b.t >= b.dur) {
        this.group.remove(b.mesh);
        b.mesh.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            (c as THREE.Mesh).geometry.dispose();
            const mat = (c as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else if (mat) (mat as THREE.Material).dispose();
          }
        });
        this.bananas.splice(i, 1);
        continue;
      }

      b.x += b.vx * dt;
      b.z += b.vz * dt;
      // Parabolic flight arc
      const prog = b.t / b.dur;
      const arc = Math.sin(prog * Math.PI) * (b.giant ? 2.5 : 1.6);
      b.mesh.position.set(b.x, 1.0 + arc, b.z);

      // Tumbling rotation
      b.mesh.rotation.y += dt * 14;
      b.mesh.rotation.z += dt * 9;

      // Yellow / gold sparkling dust trail
      if (onPuff && Math.random() < (b.giant ? 0.6 : 0.35)) {
        onPuff(b.x, 1.0 + arc, b.z, b.giant ? 0xffeb3b : 0xfff59d, (b.giant ? 0.6 : 0.35), 0.35, 0.5);
      }
    }
  }

  clear(): void {
    for (const b of this.bananas) {
      this.group.remove(b.mesh);
      b.mesh.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          (c as THREE.Mesh).geometry.dispose();
        }
      });
    }
    this.bananas.length = 0;
  }
}
