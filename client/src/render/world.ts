import * as THREE from 'three';
import { CFG, radiusOf } from '@shared/constants';
import type { MapData } from '@shared/map';
import { blobOutline, type Blob } from '@shared/math';

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function wrapDraw(S: number, x: number, y: number, r: number, fn: (px: number, py: number) => void): void {
  for (const dx of [-S, 0, S]) {
    for (const dy of [-S, 0, S]) {
      if (x + dx > -r && x + dx < S + r && y + dy > -r && y + dy < S + r) {
        fn(x + dx, y + dy);
      }
    }
  }
}

const tiled = (tex: THREE.CanvasTexture, units: number): THREE.CanvasTexture => {
  tex.repeat.set(1 / units, 1 / units);
  return tex;
};

interface WorldTextures {
  waterMat: THREE.MeshStandardMaterial;
  rippleMat: THREE.MeshBasicMaterial;
  deepMat: THREE.MeshBasicMaterial;
  foamMat: THREE.MeshBasicMaterial;
  sandMat: THREE.MeshStandardMaterial;
  mudMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
  dirtMat: THREE.MeshStandardMaterial;
  pitWallMat: THREE.MeshBasicMaterial;
  holeMat: THREE.MeshBasicMaterial;
  brickMat: THREE.MeshStandardMaterial;
  chimneyMat: THREE.MeshStandardMaterial;
  coalsMat: THREE.MeshStandardMaterial;
}

function createTextures(): WorldTextures {
  const R = Math.random;

  const water = canvasTex(256, (g, S) => {
    g.fillStyle = '#3a8ad2';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S, r = 10 + R() * 30, a = 0.12 + R() * 0.2;
      wrapDraw(S, x, y, r, (px, py) => {
        g.fillStyle = `rgba(25,85,165,${a})`;
        g.beginPath();
        g.ellipse(px, py, r, r * 0.6, 0, 0, 7);
        g.fill();
      });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = R() * S, y = R() * S, w = 8 + R() * 22, a = 0.25 + R() * 0.35, lw = 1.5 + R() * 1.5;
      wrapDraw(S, x, y, w * 2, (px, py) => {
        g.strokeStyle = `rgba(215,238,255,${a})`;
        g.lineWidth = lw;
        g.beginPath();
        g.arc(px, py + w, w, -Math.PI * 0.75, -Math.PI * 0.25);
        g.stroke();
      });
    }
  });

  const ripple = canvasTex(256, (g, S) => {
    g.lineCap = 'round';
    for (let i = 0; i < 45; i++) {
      const x = R() * S, y = R() * S, w = 10 + R() * 26, a = 0.2 + R() * 0.3;
      wrapDraw(S, x, y, w * 2, (px, py) => {
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, py + w, w, -Math.PI * 0.72, -Math.PI * 0.28);
        g.stroke();
      });
    }
  });

  const mud = canvasTex(256, (g, S) => {
    g.fillStyle = '#6a4628';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const x = R() * S, y = R() * S, r = 6 + R() * 26, dark = R() < 0.6;
      const a = dark ? 0.25 + R() * 0.3 : 0.15 + R() * 0.2;
      const k = 0.4 + R() * 0.5, rot = R() * 3;
      wrapDraw(S, x, y, r, (px, py) => {
        g.fillStyle = dark ? `rgba(55,34,18,${a})` : `rgba(150,108,65,${a})`;
        g.beginPath();
        g.ellipse(px, py, r, r * k, rot, 0, 7);
        g.fill();
      });
    }
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S, r = 2 + R() * 5;
      wrapDraw(S, x, y, r, (px, py) => {
        g.strokeStyle = 'rgba(40,25,12,.6)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px, py, r, 0, 7);
        g.stroke();
        g.fillStyle = 'rgba(210,180,140,.35)';
        g.beginPath();
        g.arc(px - r * 0.3, py - r * 0.3, r * 0.35, 0, 7);
        g.fill();
      });
    }
  });

  const sand = canvasTex(128, (g, S) => {
    g.fillStyle = '#d9c48c';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(170,140,90,.5)' : 'rgba(255,245,210,.5)';
      g.fillRect(R() * S, R() * S, 2, 2);
    }
  });

  const dirt = canvasTex(128, (g, S) => {
    g.fillStyle = '#7a5a3a';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(60,40,22,.55)' : 'rgba(160,125,85,.45)';
      const z = 1 + R() * 3;
      g.fillRect(R() * S, R() * S, z, z);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(130,130,125,.8)';
      g.beginPath();
      g.ellipse(R() * S, R() * S, 2 + R() * 4, 2 + R() * 3, R() * 3, 0, 7);
      g.fill();
    }
  });

  const brick = canvasTex(128, (g, S) => {
    g.fillStyle = '#3e1a13';
    g.fillRect(0, 0, S, S);
    const bh = S / 8, bw = S / 4;
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = 120 + Math.floor(R() * 40);
        g.fillStyle = `rgb(${v + 20},${Math.floor(v * 0.42)},${Math.floor(v * 0.3)})`;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
  });

  const coals = canvasTex(256, (g, S) => {
    g.fillStyle = '#1b100c';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const x = R() * S, y = R() * S, r = 8 + R() * 16, gg = 150 + Math.floor(R() * 80);
      wrapDraw(S, x, y, r, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, `rgba(255,${gg},40,.95)`);
        gr.addColorStop(0.5, 'rgba(220,70,10,.6)');
        gr.addColorStop(1, 'rgba(40,10,5,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(px, py, r, 0, 7);
        g.fill();
      });
    }
    g.strokeStyle = 'rgba(20,10,8,.9)';
    g.lineWidth = 3;
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      let x = R() * S, y = R() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += R() * 30 - 15;
        y += R() * 30 - 15;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });

  const hole = canvasTex(256, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, '#000');
    gr.addColorStop(0.55, '#050302');
    gr.addColorStop(0.82, '#24170c');
    gr.addColorStop(0.96, '#4a3420');
    gr.addColorStop(1, 'rgba(74,52,32,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }, false);

  const brickWall = brick.clone();
  brickWall.repeat.set(6, 1);
  brickWall.needsUpdate = true;

  const brickTall = brick.clone();
  brickTall.repeat.set(1, 4);
  brickTall.needsUpdate = true;

  const dirtLip = dirt.clone();
  dirtLip.repeat.set(6, 1);
  dirtLip.needsUpdate = true;

  const rimTex = dirt.clone();
  rimTex.repeat.set(1 / 4, 1 / 4);
  rimTex.needsUpdate = true;

  return {
    waterMat: new THREE.MeshStandardMaterial({
      map: tiled(water, 9),
      roughness: 0.15,
      metalness: 0.15,
      emissive: 0x0a2a55,
      emissiveIntensity: 0.6,
    }),
    rippleMat: new THREE.MeshBasicMaterial({
      map: tiled(ripple, 7),
      transparent: true,
      depthWrite: false,
    }),
    deepMat: new THREE.MeshBasicMaterial({
      color: 0x0d3b78,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    foamMat: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    sandMat: new THREE.MeshStandardMaterial({
      map: tiled(sand, 4),
      roughness: 1,
    }),
    mudMat: new THREE.MeshStandardMaterial({
      map: tiled(mud, 8),
      roughness: 0.35,
      metalness: 0.05,
    }),
    rimMat: new THREE.MeshStandardMaterial({
      map: rimTex,
      color: 0x9a8270,
      roughness: 0.9,
    }),
    dirtMat: new THREE.MeshStandardMaterial({
      map: dirtLip,
      roughness: 1,
      flatShading: true,
    }),
    pitWallMat: new THREE.MeshBasicMaterial({
      color: 0x1c130b,
      side: THREE.BackSide,
    }),
    holeMat: new THREE.MeshBasicMaterial({
      map: hole,
      transparent: true,
      depthWrite: false,
    }),
    brickMat: new THREE.MeshStandardMaterial({
      map: brickWall,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    chimneyMat: new THREE.MeshStandardMaterial({
      map: brickTall,
      roughness: 0.9,
    }),
    coalsMat: new THREE.MeshStandardMaterial({
      map: coals,
      emissiveMap: coals,
      emissive: 0xff7a2a,
      emissiveIntensity: 1,
      roughness: 1,
    }),
  };
}

function blobGeo(b: Blob, extra = 0, holeExtra: number | null = null): THREE.BufferGeometry {
  const pts = blobOutline(b, extra, 64);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1]);
  shape.closePath();

  if (holeExtra !== null) {
    const holePts = blobOutline(b, holeExtra, 64);
    const hole = new THREE.Path();
    hole.moveTo(holePts[0][0], -holePts[0][1]);
    for (let i = 1; i < holePts.length; i++) hole.lineTo(holePts[i][0], -holePts[i][1]);
    hole.closePath();
    shape.holes.push(hole);
  }

  return new THREE.ShapeGeometry(shape);
}

interface FlameInfo {
  mesh: THREE.Mesh;
  idx: number;
}

const ARC_SEG = 48;

export class WorldRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly hazardGroup = new THREE.Group();
  private readonly podiumGroup = new THREE.Group();
  private readonly fenceRails: THREE.Mesh[] = [];
  private readonly flames: FlameInfo[] = [];
  private blades: THREE.Group | null = null;
  private sun: THREE.DirectionalLight | null = null;
  readonly camTarget = { x: 0, z: 0 };
  private camH = 60;
  private readonly tex: WorldTextures;

  // Local player cooldown ground indicator ring & arc
  private readonly cdArc: THREE.Mesh;
  private readonly cdTrack: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    const SKY_COLOR = 0xa8dcff;
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 110, 230);

    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 700);
    this.camera.position.set(0, 70, 50);

    this.tex = createTextures();

    // Cooldown ground meter
    const arcGeo = new THREE.RingGeometry(1.45, 1.72, ARC_SEG, 1, -Math.PI / 2, Math.PI * 2);
    this.cdArc = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffc928,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.cdArc.rotation.x = -Math.PI / 2;
    this.cdArc.visible = false;
    this.cdArc.renderOrder = 4;

    this.cdTrack = new THREE.Mesh(
      arcGeo.clone(),
      new THREE.MeshBasicMaterial({
        color: 0x1f1a17,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.cdTrack.rotation.x = -Math.PI / 2;
    this.cdTrack.visible = false;
    this.cdTrack.renderOrder = 3;

    this.scene.add(this.cdTrack, this.cdArc);

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
    sun.position.set(30, 65, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 60;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0006;
    sun.shadow.camera.updateProjectionMatrix(); // Essential for shadow camera bounds to apply!

    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  private buildStaticGround(): void {
    const R = CFG.R;

    // Outer endless field
    const outerGeo = new THREE.PlaneGeometry(1000, 1000);
    const outerMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: 0.85, flatShading: true });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // Inner farm arena
    const arenaGeo = new THREE.CircleGeometry(R, 128);
    const arenaMat = new THREE.MeshStandardMaterial({ color: 0x8ccf5e, roughness: 0.85, flatShading: true });
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
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.85, flatShading: true });
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
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 9, 0.12), flatMat(0x6b4a2b));
      arm.position.y = 4.6;
      arm.castShadow = true;
      b.add(arm);
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

    // Barn roof
    const roofGeo = new THREE.CylinderGeometry(8.5, 8.5, 25, 3);
    const roof = new THREE.Mesh(roofGeo, flatMat(0x5a3a2a));
    roof.position.y = 13.4;
    roof.rotation.set(0, 0, Math.PI / 2);
    roof.rotateX(Math.PI / 6);
    roof.castShadow = true;
    barn.add(roof);

    // The Seven Commandments Wooden Sign on Barn
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 290;
    const sg = signCanvas.getContext('2d')!;
    sg.fillStyle = '#1f1a17';
    sg.fillRect(0, 0, signCanvas.width, signCanvas.height);
    for (let y = 0; y < signCanvas.height; y += 48) {
      sg.fillStyle = 'rgba(0,0,0,.45)';
      sg.fillRect(0, y + 45, signCanvas.width, 3);
    }
    sg.textAlign = 'center';
    sg.textBaseline = 'middle';
    sg.fillStyle = '#a5281b';
    sg.font = '900 52px "Baloo 2", sans-serif';
    sg.fillText('★ ĐIỀU RĂN ★', signCanvas.width / 2, 70);
    sg.fillStyle = '#f2ead7';
    sg.font = '700 58px "Be Vietnam Pro", sans-serif';
    sg.fillText('TẤT CẢ CON VẬT ĐỀU BÌNH ĐẲNG', signCanvas.width / 2, 185, signCanvas.width - 60);

    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 5.1),
      new THREE.MeshBasicMaterial({ map: signTex })
    );
    sign.position.set(0, 6.5, 7.1);
    barn.add(sign);

    this.scene.add(barn);
  }

  private buildFarmhouse(): void {
    const R = CFG.R;
    const flatMat = (color: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

    const house = new THREE.Group();
    house.position.set(R + 28, 0, 14);
    house.rotation.y = -Math.PI / 2;

    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), flatMat(0xf0e4c8));
    body.position.y = 4;
    body.castShadow = true;
    house.add(body);

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
    const nTree = 140;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85, flatShading: true });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.85, flatShading: true });

    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 5), trunkMat, nTree);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6.5, 6), leavesMat, nTree);
    trunks.castShadow = true;
    leaves.castShadow = true;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const m4 = new THREE.Matrix4();

    for (let i = 0; i < nTree; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(R + 8, R + 80);
      let x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
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
    this.flames.length = 0;
    this.podiumGroup.position.set(map.podium[0], 0, map.podium[1]);

    const T = this.tex;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const flat = (g: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, material);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // Build Ponds: sandy shore, water texture, deep center, foam rim, ripples, water lilies, reeds
    for (const p of map.pond) {
      const [x, z, r, seed] = p;
      const g = new THREE.Group();

      flat(g, blobGeo(p, 1.4, 0), T.sandMat, 0.03);
      flat(g, blobGeo(p, 0), T.waterMat, 0.06);
      flat(g, blobGeo([0, 0, r * 0.55, seed], 0), T.deepMat, 0.07);
      flat(g, blobGeo(p, 0.3, 0), T.foamMat, 0.075);
      flat(g, blobGeo(p, 0), T.rippleMat, 0.08);

      // Water Lily Pads floating in the pond
      for (let i = 0; i < 4; i++) {
        const ang = rand(0, Math.PI * 2);
        const dist = r * rand(0.3, 0.75);
        const ox = Math.cos(ang) * dist;
        const oz = Math.sin(ang) * dist;
        const padMat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.6 });
        const pad = new THREE.Mesh(new THREE.CircleGeometry(rand(0.4, 0.7), 8, 0.4, 5.6), padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rand(0, 6);
        pad.position.set(ox, 0.09, oz);
        pad.receiveShadow = true;
        g.add(pad);
      }

      // Shoreline reeds
      const reedsPts = blobOutline(p, 0.7, 40);
      const reedMat = new THREE.MeshStandardMaterial({ color: 0x5d8a2f, roughness: 0.75 });
      for (const [ox, oz] of reedsPts) {
        if (Math.random() < 0.3) {
          const reed = new THREE.Mesh(new THREE.ConeGeometry(0.12, rand(1, 1.8), 3), reedMat);
          reed.position.set(ox, 0.6, oz);
          reed.castShadow = true;
          g.add(reed);
        }
      }

      g.position.set(x, 0, z);
      this.hazardGroup.add(g);
    }

    // Build Mud patches: wet organic rim with glossy puddles
    for (const m of map.mud) {
      const [x, z] = m;
      const g = new THREE.Group();
      flat(g, blobGeo(m, 0.9, 0), T.rimMat, 0.035);
      flat(g, blobGeo(m, 0), T.mudMat, 0.045);
      g.position.set(x, 0, z);
      this.hazardGroup.add(g);
    }

    // Build Hay Bales: cylinders with rounded spherical caps casting crisp shadows
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

    // Build Wells / Pits: dirt lip, stones around rim, dark pit wall, void hole, broken wooden planks
    for (const [wx, wz, wr] of (map.well || [])) {
      const g = new THREE.Group();
      g.position.set(wx, 0, wz);

      const lip = new THREE.Mesh(new THREE.CylinderGeometry(wr + 0.3, wr + 2.2, 0.6, 20, 1, true), T.dirtMat);
      lip.position.y = 0.3;
      lip.receiveShadow = true;
      g.add(lip);

      const wall = new THREE.Mesh(new THREE.CylinderGeometry(wr + 0.3, wr + 0.3, 0.6, 20, 1, true), T.pitWallMat);
      wall.position.y = 0.3;
      g.add(wall);

      flat(g, new THREE.CircleGeometry(wr + 0.32, 32), T.holeMat, 0.02);

      // Broken wooden planks across pit
      const plankMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
      for (let i = 0; i < 3; i++) {
        const a = rand(0, 6.3);
        const plank = new THREE.Mesh(new THREE.BoxGeometry(rand(1.6, 2.6), 0.12, 0.45), plankMat);
        plank.position.set(Math.cos(a) * (wr + 1.2), 0.62, Math.sin(a) * (wr + 1.2));
        plank.rotation.set(rand(-0.2, 0.2), -a + rand(-0.6, 0.6), rand(-0.15, 0.15));
        plank.castShadow = true;
        g.add(plank);
      }

      // Stones around the pit
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 });
      for (let i = 0; i < 5; i++) {
        const a = rand(0, 6.3);
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.2, 0.4), 0), stoneMat);
        stone.position.set(Math.cos(a) * (wr + 1.9), 0.25, Math.sin(a) * (wr + 1.9));
        stone.castShadow = true;
        g.add(stone);
      }

      this.hazardGroup.add(g);
    }

    // Build Fire Furnaces: brick outer wall, top rim, glowing coals, chimney, and animated flames
    for (const [fx, fz, fr] of (map.fire || [])) {
      const g = new THREE.Group();
      g.position.set(fx, 0, fz);

      const wall = new THREE.Mesh(new THREE.CylinderGeometry(fr + 0.6, fr + 0.8, 1.2, 12, 1, true), T.brickMat);
      wall.position.y = 0.6;
      wall.castShadow = true;
      g.add(wall);

      const rimMat = new THREE.MeshStandardMaterial({ color: 0x6e2f22, roughness: 0.8 });
      const rim = new THREE.Mesh(new THREE.RingGeometry(fr, fr + 0.8, 12), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 1.2;
      g.add(rim);

      const coals = new THREE.Mesh(new THREE.CircleGeometry(fr, 16), T.coalsMat);
      coals.rotation.x = -Math.PI / 2;
      coals.position.y = 0.7;
      g.add(coals);

      const chimney = new THREE.Mesh(new THREE.BoxGeometry(1, 4.5, 1), T.chimneyMat);
      chimney.position.set(fr + 0.7, 2.25, 0);
      chimney.castShadow = true;
      g.add(chimney);

      // Animated flame cones
      for (let i = 0; i < 5; i++) {
        const flMat = new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xffb21a : 0xff6a1a,
          transparent: true,
          opacity: 0.85,
        });
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 6), flMat);
        const a = (i / 5) * Math.PI * 2;
        const d = i ? fr * 0.5 : 0;
        fl.position.set(Math.cos(a) * d, 1.6, Math.sin(a) * d);
        g.add(fl);
        this.flames.push({ mesh: fl, idx: i });
      }

      this.hazardGroup.add(g);
    }
  }

  updateHazards(now: number): void {
    if (this.tex) {
      this.tex.waterMat.map!.offset.set(now * 0.000012, now * 0.000008);
      this.tex.rippleMat.map!.offset.set(-now * 0.00003, now * 0.00002);
      this.tex.coalsMat.emissiveIntensity = 0.75 + 0.35 * Math.sin(now / 280);
    }
    for (const f of this.flames) {
      f.mesh.scale.y = 0.8 + 0.45 * Math.sin(now / 90 + f.idx * 1.7);
      f.mesh.scale.x = f.mesh.scale.z = 0.9 + 0.15 * Math.sin(now / 70 + f.idx);
    }
  }

  updateCdArc(x: number, y: number, z: number, mass: number, cdFrac: number, visible: boolean): void {
    const show = visible && cdFrac > 0;
    this.cdArc.visible = show;
    this.cdTrack.visible = show;
    if (!show) return;

    const r = radiusOf(mass);
    this.cdTrack.position.set(x, y + 0.01, z);
    this.cdArc.position.set(x, y + 0.02, z);
    this.cdTrack.scale.set(r, r, r);
    this.cdArc.scale.set(-r, r, r); // mirrored so it fills clockwise!
    this.cdArc.geometry.setDrawRange(0, 6 * Math.floor(ARC_SEG * (1 - cdFrac)));
  }

  updateCamera(targetX: number, targetZ: number, mass: number, dt: number, shake = 0): void {
    const r = radiusOf(mass);
    let h = 30 + r * 6;
    if (this.camera.aspect < 1) h *= 1 + (1 - this.camera.aspect) * 0.9;

    const k = 1 - Math.exp(-dt * 7);
    this.camTarget.x += (targetX - this.camTarget.x) * k;
    this.camTarget.z += (targetZ - this.camTarget.z) * k;
    this.camH += (h - this.camH) * (1 - Math.exp(-dt * 2));

    const sx = (Math.random() - 0.5) * shake;
    const sz = (Math.random() - 0.5) * shake;

    this.camera.position.set(this.camTarget.x + sx, this.camH, this.camTarget.z + this.camH * 0.7 + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z - 1 + sz);

    if (this.sun) {
      this.sun.position.set(this.camTarget.x + 30, 65, this.camTarget.z + 22);
      this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
      this.sun.target.updateMatrixWorld();
    }

    if (this.blades) {
      this.blades.rotation.z += dt * 0.9;
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
