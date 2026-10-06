import * as THREE from 'three';
import { CFG } from '@shared/constants';
import type { MapData } from '@shared/map';
import { blobOutline, type Blob } from '@shared/math';

export class WorldRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private hazardGroup = new THREE.Group();
  private podiumGroup = new THREE.Group();
  private fenceRails: THREE.Mesh[] = [];
  private blades: THREE.Group | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    const SKY_COLOR = 0xa8dcff;
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 110, 230);

    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 700);
    this.camera.position.set(0, 55, 42);

    this.setupLighting();
    this.buildStaticGround();
    this.buildFence();
    this.buildPodium();
    this.buildWindmill();
    this.buildBarn();
    this.buildFarmhouse();
    this.buildTrees();
    this.scene.add(this.hazardGroup);

    window.addEventListener('resize', () => this.resize());
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4f7a32, 1.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sun.position.set(40, 80, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 75;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
  }

  private buildStaticGround(): void {
    const R = CFG.R;

    // Outer endless field
    const outerGeo = new THREE.PlaneGeometry(1000, 1000);
    const outerMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: 0.9, flatShading: true });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // Inner farm arena
    const arenaGeo = new THREE.CircleGeometry(R, 128);
    const arenaMat = new THREE.MeshStandardMaterial({ color: 0x8ccf5e, roughness: 0.8, flatShading: true });
    const arena = new THREE.Mesh(arenaGeo, arenaMat);
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Warning perimeter ring near electric fence
    const warnGeo = new THREE.RingGeometry(R - 5, R, 128);
    const warnMat = new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.85, flatShading: true });
    const warn = new THREE.Mesh(warnGeo, warnMat);
    warn.rotation.x = -Math.PI / 2;
    warn.position.y = 0.02;
    warn.receiveShadow = true;
    this.scene.add(warn);
  }

  private buildFence(): void {
    const R = CFG.R;
    const postCount = Math.floor((Math.PI * 2 * R) / 3);
    const postGeo = new THREE.BoxGeometry(0.35, 2, 0.35);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, flatShading: true });
    const instPosts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    instPosts.castShadow = true;

    const m4 = new THREE.Matrix4();
    for (let i = 0; i < postCount; i++) {
      const a = (i / postCount) * Math.PI * 2;
      m4.makeRotationY(-a);
      m4.setPosition(Math.cos(a) * R, 1, Math.sin(a) * R);
      instPosts.setMatrixAt(i, m4);
    }
    this.scene.add(instPosts);

    // 2 glowing electric wire rails
    for (const y of [0.8, 1.6]) {
      const railGeo = new THREE.TorusGeometry(R, 0.08, 4, 256);
      const railMat = new THREE.MeshStandardMaterial({
        color: 0xfff35c,
        emissive: 0xaa9900,
        roughness: 0.85,
        flatShading: true,
      });
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      this.scene.add(rail);
      this.fenceRails.push(rail);
    }
  }

  private buildPodium(): void {
    const PR = CFG.PODIUM_R;
    const flatMat = (color: number, opts?: Partial<THREE.MeshStandardMaterialParameters>) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(PR, PR + 0.4, 0.5, 40),
      flatMat(0xb9a07a)
    );
    base.position.y = 0.25;
    base.receiveShadow = true;
    this.podiumGroup.add(base);

    const carpet = new THREE.Mesh(
      new THREE.CylinderGeometry(PR - 1.2, PR - 1.2, 0.06, 40),
      flatMat(0xa5281b)
    );
    carpet.position.y = 0.53;
    carpet.receiveShadow = true;
    this.podiumGroup.add(carpet);

    // Podium border tiles
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.15, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x5b4a33, emissive: 0x000000 })
      );
      tile.position.set(Math.cos(a) * (PR - 0.6), 0.55, Math.sin(a) * (PR - 0.6));
      tile.rotation.y = -a + Math.PI / 2;
      this.podiumGroup.add(tile);
    }

    // Flag pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 6, 6),
      flatMat(0x6b4a2b)
    );
    pole.position.set(0, 3.5, -(PR - 1.6));
    pole.castShadow = true;
    this.podiumGroup.add(pole);

    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.3, 0.06),
      flatMat(0xa5281b)
    );
    flag.position.set(1.15, 5.8, -(PR - 1.6));
    flag.castShadow = true;
    this.podiumGroup.add(flag);

    this.scene.add(this.podiumGroup);
  }

  private buildWindmill(): void {
    const R = CFG.R;
    const flatMat = (color: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

    const mill = new THREE.Group();
    mill.position.set(-22, 0, -(R + 20));

    // Tower body
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.5, 14, 8), flatMat(0xe2d3b0));
    tower.position.y = 7;
    tower.castShadow = true;
    mill.add(tower);

    // Roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4.5, 8), flatMat(0x9c3d2c));
    roof.position.y = 16.2;
    roof.castShadow = true;
    mill.add(roof);

    // Rotating blades
    this.blades = new THREE.Group();
    this.blades.position.set(0, 13, 3.6);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      b.rotation.z = (i * Math.PI) / 2;
      // Blade arm
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 9, 0.12), flatMat(0x6b4a2b));
      arm.position.y = 4.6;
      arm.castShadow = true;
      b.add(arm);
      // Blade sail
      const sail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 0.06), flatMat(0xfaf3e0));
      sail.position.set(0.75, 5.2, 0);
      sail.castShadow = true;
      b.add(sail);
      this.blades.add(b);
    }
    mill.add(this.blades);
    this.scene.add(mill);
  }

  private buildBarn(): void {
    const R = CFG.R;
    const flatMat = (color: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

    const barn = new THREE.Group();
    barn.position.set(18, 0, -(R + 24));

    // Barn body
    const body = new THREE.Mesh(new THREE.BoxGeometry(24, 11, 14), flatMat(0xb8322a));
    body.position.y = 5.5;
    body.castShadow = true;
    barn.add(body);

    // Barn roof - triangular prism
    const roofGeo = new THREE.CylinderGeometry(8.5, 8.5, 25, 3);
    const roof = new THREE.Mesh(roofGeo, flatMat(0x5a3a2a));
    roof.position.y = 13.4;
    roof.rotation.set(0, 0, Math.PI / 2);
    roof.rotateX(Math.PI / 6);
    roof.castShadow = true;
    barn.add(roof);

    // Barn sign (canvas texture with farm name)
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 290;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#1f1a17';
    ctx.fillRect(0, 0, signCanvas.width, signCanvas.height);
    // Add horizontal lines
    for (let y = 0; y < signCanvas.height; y += 48) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, y + 45, signCanvas.width, 3);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a5281b';
    ctx.font = '900 52px "Baloo 2", system-ui, sans-serif';
    ctx.fillText('★ LUẬT NÔNG TRẠI ★', signCanvas.width / 2, 70);
    ctx.fillStyle = '#f2ead7';
    ctx.font = '64px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText('Mọi con vật đều bình đẳng', signCanvas.width / 2, 190, signCanvas.width - 60);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 5.1),
      new THREE.MeshBasicMaterial({ map: signTex })
    );
    sign.position.set(0, 6.5, 7.1);
    barn.add(sign);

    // Barn door
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 7, 0.1), flatMat(0x3a1a0e));
    door.position.set(0, 3.5, 7.05);
    barn.add(door);

    this.scene.add(barn);
  }

  private buildFarmhouse(): void {
    const R = CFG.R;
    const flatMat = (color: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

    const house = new THREE.Group();
    house.position.set(R + 28, 0, 14);
    house.rotation.y = -Math.PI / 2;

    // Main structure
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), flatMat(0xf0e4c8));
    body.position.y = 4;
    body.castShadow = true;
    house.add(body);

    // Roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 5, 4), flatMat(0x37474f));
    roof.position.y = 10.5;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.75;
    roof.castShadow = true;
    house.add(roof);

    this.scene.add(house);
  }

  private buildTrees(): void {
    const R = CFG.R;
    const nTree = 200;
    const m4 = new THREE.Matrix4();

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85, flatShading: true });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.85, flatShading: true });

    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 5), trunkMat, nTree);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6.5, 6), leavesMat, nTree);
    trunks.castShadow = true;
    leaves.castShadow = true;

    // Seeded random for tree placement
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    for (let i = 0; i < nTree; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(R + 8, R + 80);
      let x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // Avoid overlap with barn and windmill areas
      if (z < -(R + 6) && z > -(R + 40) && x > -36 && x < 36) x += 90;
      const s = rand(0.8, 1.5);

      m4.makeScale(s, s, s);
      m4.setPosition(x, 1.5 * s, z);
      trunks.setMatrixAt(i, m4);

      m4.makeScale(s, s, s);
      m4.setPosition(x, 5.5 * s, z);
      leaves.setMatrixAt(i, m4);
    }
    this.scene.add(trunks, leaves);
  }

  buildMap(map: MapData): void {
    this.hazardGroup.clear();
    this.podiumGroup.position.set(map.podium[0], 0, map.podium[1]);

    // Build Ponds
    for (const p of map.pond) {
      const g = new THREE.Group();
      g.position.set(p[0], 0, p[1]);
      const shore = this.createBlobMesh(p, 1.2, 0xdec68c, 0.02);
      const water = this.createBlobMesh(p, 0, 0x3a8fd4, 0.05, 0.2);
      g.add(shore);
      g.add(water);
      this.hazardGroup.add(g);
    }

    // Build Mud patches
    for (const m of map.mud) {
      const g = new THREE.Group();
      g.position.set(m[0], 0, m[1]);
      const rim = this.createBlobMesh(m, 0.8, 0x5a3e26, 0.02);
      const mud = this.createBlobMesh(m, 0, 0x6e4627, 0.035);
      g.add(rim);
      g.add(mud);
      this.hazardGroup.add(g);
    }

    // Build Hay Bales
    for (const [hx, hz, hr] of map.hay) {
      const hayMat = new THREE.MeshStandardMaterial({ color: 0xe8c55a, roughness: 0.85, flatShading: true });
      const hay = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 2.6, 14), hayMat);
      hay.position.set(hx, 1.3, hz);
      hay.castShadow = true;
      hay.receiveShadow = true;

      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(hr, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        hayMat
      );
      cap.position.set(hx, 2.6, hz);
      cap.scale.y = 0.45;
      cap.castShadow = true;
      this.hazardGroup.add(hay, cap);
    }
  }

  private createBlobMesh(blob: Blob, extra: number, color: number, y: number, metalness = 0): THREE.Mesh {
    const pts = blobOutline(blob, extra, 48);
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], -pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1]);
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    return mesh;
  }

  updateCamera(targetX: number, targetZ: number, dt: number): void {
    const camTarget = new THREE.Vector3(targetX, 0, targetZ);
    const desiredPos = new THREE.Vector3(targetX, 48, targetZ + 36);
    this.camera.position.lerp(desiredPos, Math.min(1, 6 * dt));
    this.camera.lookAt(camTarget);

    // Rotate windmill blades
    if (this.blades) {
      this.blades.rotation.z += dt * 0.3;
    }
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
