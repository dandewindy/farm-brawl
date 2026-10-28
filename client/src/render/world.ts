import * as THREE from 'three';
import { CFG, radiusOf } from '@shared/constants';
import type { MapData, TreeData } from '@shared/map';
import type { TreeSyncWire } from '@shared/protocol';
import { blobOutline, type Blob } from '@shared/math';
import { t } from '../i18n';
import { getArenaTheme, type ArenaTheme } from '../theme';
import { sfxZap } from '../audio/sfx';

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

function createMgmTextures(): { carpetTex: THREE.CanvasTexture; flagTex: THREE.CanvasTexture } {
  const cCanvas = document.createElement('canvas');
  cCanvas.width = 512;
  cCanvas.height = 512;
  const cCtx = cCanvas.getContext('2d')!;

  const fCanvas = document.createElement('canvas');
  fCanvas.width = 512;
  fCanvas.height = 256;
  const fCtx = fCanvas.getContext('2d')!;

  const carpetTex = new THREE.CanvasTexture(cCanvas);
  carpetTex.colorSpace = THREE.SRGBColorSpace;
  carpetTex.anisotropy = 4;

  const flagTex = new THREE.CanvasTexture(fCanvas);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  flagTex.anisotropy = 4;

  const render = (img?: HTMLImageElement) => {
    // 1. Carpet texture: circular crimson emblem with concentric gold rings
    cCtx.clearRect(0, 0, 512, 512);
    cCtx.fillStyle = '#992218';
    cCtx.beginPath();
    cCtx.arc(256, 256, 254, 0, Math.PI * 2);
    cCtx.fill();

    cCtx.strokeStyle = '#ffd700';
    cCtx.lineWidth = 10;
    cCtx.beginPath();
    cCtx.arc(256, 256, 240, 0, Math.PI * 2);
    cCtx.stroke();

    cCtx.strokeStyle = '#d4a017';
    cCtx.lineWidth = 4;
    cCtx.beginPath();
    cCtx.arc(256, 256, 226, 0, Math.PI * 2);
    cCtx.stroke();

    // 2. Flag texture: deep red banner with gold fringe
    fCtx.fillStyle = '#a5281b';
    fCtx.fillRect(0, 0, 512, 256);
    fCtx.fillStyle = '#ffd700';
    fCtx.fillRect(0, 0, 512, 8);
    fCtx.fillRect(0, 248, 512, 8);
    fCtx.fillRect(504, 0, 8, 256);

    if (img && img.complete && img.naturalWidth > 0) {
      // Create white tinted version of mgm logo
      const tint = document.createElement('canvas');
      tint.width = img.naturalWidth;
      tint.height = img.naturalHeight;
      const tCtx = tint.getContext('2d')!;
      tCtx.drawImage(img, 0, 0);
      tCtx.globalCompositeOperation = 'source-in';
      tCtx.fillStyle = '#ffffff';
      tCtx.fillRect(0, 0, tint.width, tint.height);

      // Draw onto carpet emblem (centered)
      const ratio = img.naturalHeight / img.naturalWidth;
      const cW = 340;
      const cH = cW * ratio;
      cCtx.drawImage(tint, 256 - cW / 2, 256 - cH / 2, cW, cH);

      // Draw onto flag (centered)
      const fW = 320;
      const fH = fW * ratio;
      fCtx.drawImage(tint, 256 - fW / 2, 128 - fH / 2, fW, fH);
    } else {
      cCtx.fillStyle = '#ffffff';
      cCtx.font = 'bold 110px sans-serif';
      cCtx.textAlign = 'center';
      cCtx.textBaseline = 'middle';
      cCtx.fillText('mgm', 256, 256);

      fCtx.fillStyle = '#ffffff';
      fCtx.font = 'bold 90px sans-serif';
      fCtx.textAlign = 'center';
      fCtx.textBaseline = 'middle';
      fCtx.fillText('mgm', 256, 128);
    }

    carpetTex.needsUpdate = true;
    flagTex.needsUpdate = true;
  };

  render();

  const logoImg = new Image();
  logoImg.src = '/mgm-logo.png';
  logoImg.onload = () => render(logoImg);

  return { carpetTex, flagTex };
}

function createShieldTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(0, 229, 255, 0.65)');
  grad.addColorStop(0.3, 'rgba(0, 200, 255, 0.22)');
  grad.addColorStop(0.7, 'rgba(0, 229, 255, 0.32)');
  grad.addColorStop(1, 'rgba(0, 240, 255, 0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x < 256; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

interface TractorData {
  group: THREE.Group;
  wheels: THREE.Group[];
  cutterDrum: THREE.Group;
  exhaustPos: THREE.Vector3;
}

function buildTractor(): TractorData {
  const g = new THREE.Group();
  const S = 2.4; // 2.4x scale - giant combine harvester!

  const matBody = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.55 }); // Classic farm tractor green
  const matYellow = new THREE.MeshStandardMaterial({ color: 0xfbc02d, roughness: 0.45 }); // Farm yellow trim
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.85 }); // Rubber tires / chassis
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x90a4ae, roughness: 0.15, metalness: 0.85 }); // Tinted glass
  const matChrome = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, metalness: 0.85, roughness: 0.2 }); // Exhaust / trims
  const matHat = new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.9 }); // Farmer straw hat
  const matBlade = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.9, roughness: 0.15 }); // Cutter blades
  const matHazard = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.5 }); // Bumper hazard

  // 1. Heavy Chassis (base frame)
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.6 * S, 0.4 * S, 1.6 * S), matDark);
  chassis.position.set(0.1 * S, 0.5 * S, 0);
  chassis.castShadow = true;
  g.add(chassis);

  // 2. Engine hood (front)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.3 * S, 1.25 * S, 1.5 * S), matBody);
  hood.position.set(0.95 * S, 1.15 * S, 0);
  hood.castShadow = true;
  g.add(hood);

  // Radiator grille with yellow surround
  const grillFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 1.05 * S, 1.35 * S), matYellow);
  grillFrame.position.set(2.1 * S, 1.15 * S, 0);
  g.add(grillFrame);
  const grillCore = new THREE.Mesh(new THREE.BoxGeometry(0.14 * S, 0.9 * S, 1.15 * S), matDark);
  grillCore.position.set(2.11 * S, 1.15 * S, 0);
  g.add(grillCore);

  // Twin massive glowing headlights
  for (const z of [-0.55 * S, 0.55 * S]) {
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * S, 0.16 * S, 0.18 * S, 14), matChrome);
    light.rotation.z = Math.PI / 2;
    light.position.set(2.1 * S, 1.4 * S, z);
    g.add(light);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.14 * S, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffea00 }));
    lens.position.set(2.18 * S, 1.4 * S, z);
    g.add(lens);
  }

  // Tall vertical smokestack exhaust pipe
  const exhaustPos = new THREE.Vector3(1.35 * S, 2.85 * S, 0.65 * S);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * S, 0.08 * S, 1.5 * S, 10), matChrome);
  exhaust.position.set(1.35 * S, 2.1 * S, 0.65 * S);
  g.add(exhaust);
  const exhaustCap = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * S, 0.06 * S, 0.3 * S, 10), matDark);
  exhaustCap.position.set(1.35 * S, 2.85 * S, 0.65 * S);
  g.add(exhaustCap);

  // 3. Cabin / Cab (rear)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.65 * S, 1.7 * S, 1.55 * S), matBody);
  cab.position.set(-0.85 * S, 1.8 * S, 0);
  cab.castShadow = true;
  g.add(cab);

  // Cab yellow overhanging sun roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9 * S, 0.18 * S, 1.8 * S), matYellow);
  roof.position.set(-0.85 * S, 2.68 * S, 0);
  roof.castShadow = true;
  g.add(roof);

  // Windshield & side windows
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06 * S, 1.0 * S, 1.35 * S), matGlass);
  windshield.position.set(-0.02 * S, 1.95 * S, 0);
  g.add(windshield);
  for (const z of [-0.78 * S, 0.78 * S]) {
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(1.15 * S, 0.85 * S, 0.06 * S), matGlass);
    sideWin.position.set(-0.75 * S, 1.95 * S, z);
    g.add(sideWin);
  }

  // 4. Driver: Farmer Till!
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26 * S, 14, 12), new THREE.MeshStandardMaterial({ color: 0xffcc80 }));
  head.position.set(-0.75 * S, 1.95 * S, 0);
  g.add(head);
  // Farmer body / blue overalls
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * S, 0.32 * S, 0.5 * S, 10), new THREE.MeshStandardMaterial({ color: 0x1565c0 }));
  torso.position.set(-0.75 * S, 1.55 * S, 0);
  g.add(torso);
  // Wide straw hat
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.48 * S, 0.48 * S, 0.06 * S, 18), matHat);
  hatBrim.position.set(-0.75 * S, 2.18 * S, 0);
  g.add(hatBrim);
  const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * S, 0.32 * S, 0.28 * S, 16), matHat);
  hatCrown.position.set(-0.75 * S, 2.32 * S, 0);
  g.add(hatCrown);

  // 5. Huge Rolling Wheels inside pivot groups
  const wheels: THREE.Group[] = [];

  // Rear massive drive wheels
  for (const z of [-1.08 * S, 1.08 * S]) {
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(-0.8 * S, 0.95 * S, z);

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.95 * S, 0.95 * S, 0.52 * S, 22), matDark);
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    wheelPivot.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.56 * S, 0.56 * S, 0.55 * S, 14), matYellow);
    rim.rotation.x = Math.PI / 2;
    wheelPivot.add(rim);

    // Tread ridges on big tires
    for (let t = 0; t < 12; t++) {
      const ta = (t / 12) * Math.PI * 2;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 0.08 * S, 0.52 * S), matDark);
      ridge.position.set(Math.cos(ta) * 0.96 * S, Math.sin(ta) * 0.96 * S, 0);
      ridge.rotation.z = ta;
      wheelPivot.add(ridge);
    }

    g.add(wheelPivot);
    wheels.push(wheelPivot);
  }

  // Front steering wheels
  for (const z of [-0.92 * S, 0.92 * S]) {
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(1.15 * S, 0.55 * S, z);

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.54 * S, 0.54 * S, 0.38 * S, 18), matDark);
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    wheelPivot.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * S, 0.32 * S, 0.40 * S, 12), matYellow);
    rim.rotation.x = Math.PI / 2;
    wheelPivot.add(rim);

    g.add(wheelPivot);
    wheels.push(wheelPivot);
  }

  // 6. Giant Combine Harvester Header / Front Cutter Drum!
  // Steel mounting arms connecting from frame to front drum
  for (const z of [-1.0 * S, 1.0 * S]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9 * S, 0.16 * S, 0.14 * S), matDark);
    arm.position.set(2.45 * S, 0.65 * S, z);
    g.add(arm);
  }

  // Cutter drum pivot group (rotates around Z axis as combine moves)
  const cutterDrum = new THREE.Group();
  cutterDrum.position.set(2.85 * S, 0.65 * S, 0);

  // Central cylindrical drum shaft
  const drumShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * S, 0.28 * S, 2.4 * S, 16), matChrome);
  drumShaft.rotation.x = Math.PI / 2;
  cutterDrum.add(drumShaft);

  // 6 rows of sharp revolving steel combine harvester blades/teeth
  for (let b = 0; b < 6; b++) {
    const ba = (b / 6) * Math.PI * 2;
    const bladeRow = new THREE.Mesh(new THREE.BoxGeometry(0.06 * S, 0.32 * S, 2.36 * S), matBlade);
    bladeRow.position.set(Math.cos(ba) * 0.38 * S, Math.sin(ba) * 0.38 * S, 0);
    bladeRow.rotation.z = ba;
    cutterDrum.add(bladeRow);
  }

  g.add(cutterDrum);

  // Outer crop dividers / pointed end shoes (fixed to chassis on left & right of drum)
  for (const z of [-1.25 * S, 1.25 * S]) {
    const divider = new THREE.Mesh(new THREE.ConeGeometry(0.22 * S, 0.7 * S, 8), matYellow);
    divider.rotation.z = -Math.PI / 2;
    divider.position.set(3.0 * S, 0.65 * S, z);
    g.add(divider);
  }

  // Lower safety bumper with hazard warning stripes
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.18 * S, 0.22 * S, 2.6 * S), matHazard);
  bumper.position.set(2.85 * S, 0.25 * S, 0);
  g.add(bumper);

  return {
    group: g,
    wheels,
    cutterDrum,
    exhaustPos,
  };
}

function getDeviceInfo(): { isIPad: boolean; isMobile: boolean; dpr: number } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { isIPad: false, isMobile: false, dpr: 1 };
  }
  const isIPad = (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) || /iPad/.test(navigator.userAgent);
  const isMobile = /Android|iPhone|iPod/i.test(navigator.userAgent) || isIPad;
  const dpr = window.devicePixelRatio || 1;
  return { isIPad, isMobile, dpr };
}

export function getOptimalPixelRatio(): number {
  const { isIPad, isMobile, dpr } = getDeviceInfo();
  if (isIPad) {
    // iPad (e.g. iPad Gen 9: 2160x1620 Retina, CSS 1080x810):
    // 1.4 DPR gives 1512x1134 high resolution with 4x MSAA antialiasing.
    // Models, horns, fences, and edges are silky smooth with zero jaggedness (hết răng cưa)!
    return Math.min(dpr, 1.4);
  }
  if (isMobile) {
    // Mobile phones (CSS viewport ~390px): 1.5 DPR gives crisp Retina rendering with zero jaggies
    return Math.min(dpr, 1.5);
  }
  // PC / Desktop:
  return Math.min(dpr, 1.5);
}

export function shouldEnableAntialias(): boolean {
  // Always enable hardware MSAA antialiasing across all devices (PC, iPad, mobile)
  // so low-poly 3D animal models, horns, fences, and borders are silky-smooth without jagged edges (hết răng cưa).
  return true;
}

export interface FarmFruitTreeVisual {
  id: number;
  x: number;
  z: number;
  size: 0 | 1 | 2;
  group: THREE.Group;
  trunkMesh: THREE.Mesh;
  canopyGroup: THREE.Group;
  flowerMeshes: THREE.Mesh[];
  smallFruitMeshes: THREE.Mesh[];
  bigFruitMeshes: THREE.Group[];
  shakeTimer: number;
  stage: number;
  bigCount: number;
  smallCount: number;
  flowerCount: number;
}

export interface FallingFruit {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotSpeed: number;
  life: number;
}

export class WorldRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  zoomBias = 0;
  private readonly hazardGroup = new THREE.Group();
  private readonly podiumGroup = new THREE.Group();
  private readonly podiumTileMats: THREE.MeshStandardMaterial[] = [];
  private readonly farmTreeGroup = new THREE.Group();
  private readonly farmTrees: FarmFruitTreeVisual[] = [];
  private readonly fallingFruits: FallingFruit[] = [];
  private lastMapData: MapData | null = null;
  private barnSignCanvas: HTMLCanvasElement | null = null;
  private barnSignTex: THREE.CanvasTexture | null = null;
  private shieldGroup: THREE.Group | null = null;
  private shieldMat: THREE.MeshBasicMaterial | null = null;
  private shieldRingMat: THREE.MeshBasicMaterial | null = null;
  private shieldTex: THREE.CanvasTexture | null = null;
  private readonly fenceRails: THREE.Mesh[] = [];
  private readonly treeGroup = new THREE.Group();
  private readonly treeCoords: { x: number; z: number; s: number }[] = [];
  private readonly electricGroup = new THREE.Group();
  private readonly electricArcs: {
    coreMesh: THREE.Mesh;
    glowMesh: THREE.Mesh;
    coreSphere: THREE.Mesh;
    coreHalo: THREE.Mesh;
    active: boolean;
    startTime: number;
    duration: number;
    angle: number;
    soundPlayed: boolean;
  }[] = [];
  private nextZapTime = 0;
  private readonly flames: FlameInfo[] = [];
  private blades: THREE.Group | null = null;
  private sun: THREE.DirectionalLight | null = null;
  public shadowsEnabled = true;
  private tillTruck: TractorData | null = null;
  private tillSmokeT = 0;
  private truckCurrentX = 0;
  private truckCurrentZ = 0;
  private truckCurrentAngle = 0;
  private truckHasPos = false;
  readonly camTarget = { x: 0, z: 0 };
  private camH = 60;
  private readonly tex: WorldTextures;

  private outerMat!: THREE.MeshStandardMaterial;
  private arenaMat!: THREE.MeshStandardMaterial;
  private warnMat!: THREE.MeshStandardMaterial;

  // Local player cooldown ground indicator ring & arc
  private readonly cdArc: THREE.Mesh;
  private readonly cdTrack: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    const antialias = shouldEnableAntialias();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(getOptimalPixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const savedShadows = typeof localStorage !== 'undefined' ? localStorage.getItem('fb_shadows') : null;
    this.shadowsEnabled = savedShadows !== '0';
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
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
    this.scene.add(this.treeGroup);
    this.scene.add(this.electricGroup);
    this.scene.add(this.hazardGroup);
    this.scene.add(this.farmTreeGroup);

    this.tillTruck = buildTractor();
    this.tillTruck.group.visible = false;
    this.scene.add(this.tillTruck.group);

    this.setTheme(getArenaTheme());

    window.addEventListener('resize', () => this.resize());
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4f7a32, 1.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sun.position.set(30, 65, 22);
    sun.castShadow = this.shadowsEnabled;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 60;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.camera.updateProjectionMatrix(); // Essential for shadow camera bounds to apply!

    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  private buildStaticGround(): void {
    const R = CFG.R;

    // Outer endless field
    const outerGeo = new THREE.PlaneGeometry(1000, 1000);
    this.outerMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: 0.85, flatShading: true });
    const outer = new THREE.Mesh(outerGeo, this.outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // Inner farm arena
    const arenaGeo = new THREE.CircleGeometry(R, 128);
    this.arenaMat = new THREE.MeshStandardMaterial({ color: 0x8ccf5e, roughness: 0.85, flatShading: true });
    const arena = new THREE.Mesh(arenaGeo, this.arenaMat);
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    this.scene.add(arena);

    // Warning perimeter ring near electric fence
    const warnGeo = new THREE.RingGeometry(R - 5, R, 128);
    this.warnMat = new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.85, flatShading: true });
    const warn = new THREE.Mesh(warnGeo, this.warnMat);
    warn.rotation.x = -Math.PI / 2;
    warn.position.y = 0.02;
    warn.receiveShadow = true;
    this.scene.add(warn);
  }

  setShadowsEnabled(enabled: boolean): void {
    if (this.shadowsEnabled === enabled && this.renderer.shadowMap.enabled === enabled) return;
    this.shadowsEnabled = enabled;
    this.renderer.shadowMap.enabled = enabled;
    if (this.sun) {
      this.sun.castShadow = enabled;
    }
    if (enabled) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    // Update materials to compile with/without shadows cleanly without errors
    this.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => {
            if (m) m.needsUpdate = true;
          });
        } else if (mesh.material) {
          mesh.material.needsUpdate = true;
        }
      }
    });
  }

  setTheme(theme: ArenaTheme): void {
    if (theme === 'women_day') {
      const sky = new THREE.Color(0xffe2ea);
      this.scene.background = sky;
      if (this.scene.fog) {
        (this.scene.fog as THREE.Fog).color.copy(sky);
      }
      if (this.outerMat) this.outerMat.color.setHex(0xdb839d);
      if (this.arenaMat) this.arenaMat.color.setHex(0xf5a3b7);
      if (this.warnMat) this.warnMat.color.setHex(0xe65c82);
      for (const r of this.fenceRails) {
        (r.material as THREE.MeshStandardMaterial).emissive.setHex(0xff4081);
      }
    } else if (theme === 'halloween') {
      const sky = new THREE.Color(0x160728);
      this.scene.background = sky;
      if (this.scene.fog) {
        (this.scene.fog as THREE.Fog).color.setHex(0x280e38);
      }
      if (this.outerMat) this.outerMat.color.setHex(0x22181c);
      if (this.arenaMat) this.arenaMat.color.setHex(0x34222a);
      if (this.warnMat) this.warnMat.color.setHex(0xc45e00);
      for (const r of this.fenceRails) {
        (r.material as THREE.MeshStandardMaterial).emissive.setHex(0x39ff14);
      }
    } else {
      const sky = new THREE.Color(0xa8dcff);
      this.scene.background = sky;
      if (this.scene.fog) {
        (this.scene.fog as THREE.Fog).color.copy(sky);
      }
      if (this.outerMat) this.outerMat.color.setHex(0x6aa84f);
      if (this.arenaMat) this.arenaMat.color.setHex(0x8ccf5e);
      if (this.warnMat) this.warnMat.color.setHex(0xc9b56a);
      for (const r of this.fenceRails) {
        (r.material as THREE.MeshStandardMaterial).emissive.setHex(0x00bfff);
      }
    }
    this.updateBarnSign();
    this.buildTrees(theme);
    if (this.lastMapData) {
      this.buildFarmFruitTrees(this.lastMapData.trees || []);
    }
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

    // 2 glowing high-voltage electric wire rails
    for (const y of [0.8, 1.6]) {
      const railGeo = new THREE.TorusGeometry(R, 0.14, 6, 256);
      const railMat = new THREE.MeshStandardMaterial({
        color: 0xfff35c,
        emissive: 0x00bfff,
        emissiveIntensity: 1.2,
        roughness: 0.35,
        metalness: 0.7,
      });
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      this.scene.add(rail);
      this.fenceRails.push(rail);
    }
    this.buildElectricArcs();
  }

  private createRibbonGeometry(segs: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const vCount = (segs + 1) * 2;
    const positions = new Float32Array(vCount * 3);
    const indices: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }

  private buildElectricArcs(): void {
    const arcCount = 10;
    const segs = 8;
    for (let i = 0; i < arcCount; i++) {
      const coreGeo = this.createRibbonGeometry(segs);
      const glowGeo = this.createRibbonGeometry(segs);

      // Searing bright white core lightning ribbon
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      // Outer neon cyan electrical discharge glow ribbon
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00f5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.visible = false;
      coreMesh.renderOrder = 20;

      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.visible = false;
      glowMesh.renderOrder = 19;

      // High-voltage core spark ball at contact point (radius reduced to 10%: 0.07m)
      const coreSphereMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), coreSphereMat);
      coreSphere.visible = false;
      coreSphere.renderOrder = 21;

      // Tight glowing plasma halo (radius reduced to 10%: 0.16m)
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const coreHalo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), haloMat);
      coreHalo.visible = false;
      coreHalo.renderOrder = 18;

      this.electricGroup.add(coreMesh, glowMesh, coreSphere, coreHalo);
      this.electricArcs.push({
        coreMesh,
        glowMesh,
        coreSphere,
        coreHalo,
        active: false,
        startTime: 0,
        duration: 0,
        angle: 0,
        soundPlayed: false,
      });
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

    // Create official mgm podium carpet and flag textures
    const { carpetTex, flagTex } = createMgmTextures();

    const carpet = new THREE.Mesh(
      new THREE.CylinderGeometry(PR - 1.2, PR - 1.2, 0.06, 40),
      flatMat(0x992218)
    );
    carpet.position.y = 0.53;
    carpet.receiveShadow = true;
    this.podiumGroup.add(carpet);

    // mgm logo circular decal on top of the carpet
    const logoDiscGeo = new THREE.CircleGeometry(PR - 1.35, 48);
    logoDiscGeo.rotateX(-Math.PI / 2);
    const logoDisc = new THREE.Mesh(
      logoDiscGeo,
      new THREE.MeshStandardMaterial({
        map: carpetTex,
        roughness: 0.75,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    logoDisc.position.y = 0.562;
    logoDisc.receiveShadow = true;
    this.podiumGroup.add(logoDisc);

    // Podium border tiles (capture progress indicators)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const tileMat = new THREE.MeshStandardMaterial({
        color: 0x5b4a33,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.85,
        flatShading: true,
      });
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.15, 0.5),
        tileMat
      );
      tile.position.set(Math.cos(a) * (PR - 0.6), 0.55, Math.sin(a) * (PR - 0.6));
      tile.rotation.y = -a + Math.PI / 2;
      this.podiumGroup.add(tile);
      this.podiumTileMats.push(tileMat);
    }

    // Flag pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 6, 6),
      flatMat(0x6b4a2b)
    );
    pole.position.set(0, 3.5, -(PR - 1.6));
    pole.castShadow = true;
    this.podiumGroup.add(pole);

    // Red flag with mgm logo
    const flagMat = new THREE.MeshStandardMaterial({
      map: flagTex,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.3, 0.06),
      flagMat
    );
    flag.position.set(1.15, 5.8, -(PR - 1.6));
    flag.castShadow = true;
    this.podiumGroup.add(flag);

    // Glowing protective energy barrier around the podium
    const shieldR = PR + 0.5;
    this.shieldGroup = new THREE.Group();

    this.shieldTex = createShieldTexture();
    this.shieldMat = new THREE.MeshBasicMaterial({
      map: this.shieldTex,
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shieldCylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(shieldR, shieldR, 3.4, 48, 1, true),
      this.shieldMat
    );
    shieldCylinder.position.y = 1.7;
    this.shieldGroup.add(shieldCylinder);

    this.shieldRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const groundRing = new THREE.Mesh(
      new THREE.RingGeometry(shieldR - 0.35, shieldR + 0.35, 48),
      this.shieldRingMat
    );
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = 0.55;
    this.shieldGroup.add(groundRing);

    const topRim = new THREE.Mesh(
      new THREE.RingGeometry(shieldR - 0.2, shieldR + 0.2, 48),
      this.shieldRingMat
    );
    topRim.rotation.x = -Math.PI / 2;
    topRim.position.y = 3.4;
    this.shieldGroup.add(topRim);

    this.shieldGroup.visible = true;
    this.podiumGroup.add(this.shieldGroup);

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
    this.barnSignCanvas = document.createElement('canvas');
    this.barnSignCanvas.width = 1024;
    this.barnSignCanvas.height = 290;
    this.barnSignTex = new THREE.CanvasTexture(this.barnSignCanvas);
    this.barnSignTex.colorSpace = THREE.SRGBColorSpace;
    this.updateBarnSign();

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 5.1),
      new THREE.MeshBasicMaterial({ map: this.barnSignTex })
    );
    sign.position.set(0, 6.5, 7.1);
    barn.add(sign);

    this.scene.add(barn);
  }

  updateBarnSign(): void {
    if (!this.barnSignCanvas || !this.barnSignTex) return;
    const sg = this.barnSignCanvas.getContext('2d')!;
    sg.fillStyle = '#1f1a17';
    sg.fillRect(0, 0, this.barnSignCanvas.width, this.barnSignCanvas.height);
    for (let y = 0; y < this.barnSignCanvas.height; y += 48) {
      sg.fillStyle = 'rgba(0,0,0,.45)';
      sg.fillRect(0, y + 45, this.barnSignCanvas.width, 3);
    }
    sg.textAlign = 'center';
    sg.textBaseline = 'middle';
    sg.shadowColor = 'rgba(0, 0, 0, 0.7)';
    sg.shadowBlur = 6;
    sg.shadowOffsetY = 2;
    const theme = getArenaTheme();
    if (theme === 'women_day') {
      sg.fillStyle = '#ff4081';
      sg.font = '900 52px "Baloo 2", sans-serif';
      sg.fillText(t('barn_womenday_title'), this.barnSignCanvas.width / 2, 72);
      sg.fillStyle = '#ffe4ec';
      sg.font = '700 48px "Be Vietnam Pro", sans-serif';
      sg.fillText(t('barn_womenday_msg'), this.barnSignCanvas.width / 2, 185, this.barnSignCanvas.width - 50);
    } else if (theme === 'halloween') {
      sg.fillStyle = '#ff6d00';
      sg.font = '900 52px "Baloo 2", sans-serif';
      sg.fillText(t('barn_halloween_title'), this.barnSignCanvas.width / 2, 72);
      sg.fillStyle = '#ffd180';
      sg.font = '700 48px "Be Vietnam Pro", sans-serif';
      sg.fillText(t('barn_halloween_msg'), this.barnSignCanvas.width / 2, 185, this.barnSignCanvas.width - 50);
    } else {
      sg.fillStyle = '#a5281b';
      sg.font = '900 52px "Baloo 2", sans-serif';
      sg.fillText(t('boardEyebrow'), this.barnSignCanvas.width / 2, 70);
      sg.fillStyle = '#f2ead7';
      sg.font = '700 58px "Be Vietnam Pro", sans-serif';
      sg.fillText(t('r_equal'), this.barnSignCanvas.width / 2, 185, this.barnSignCanvas.width - 60);
    }
    sg.shadowColor = 'transparent';
    sg.shadowBlur = 0;
    sg.shadowOffsetY = 0;
    this.barnSignTex.needsUpdate = true;
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

  private buildTrees(theme: ArenaTheme = getArenaTheme()): void {
    this.treeGroup.clear();
    const R = CFG.R;
    const nTree = 140;

    // Fixed coordinates generation so trees stay in consistent spots across theme changes
    if (this.treeCoords.length === 0) {
      const rand = (a: number, b: number) => a + Math.random() * (b - a);
      for (let i = 0; i < nTree; i++) {
        const a = rand(0, Math.PI * 2);
        const d = rand(R + 8, R + 80);
        let x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (z < -(R + 6) && z > -(R + 40) && x > -36 && x < 36) x += 90;
        const s = rand(0.8, 1.5);
        this.treeCoords.push({ x, z, s });
      }
    }

    const m4 = new THREE.Matrix4();

    if (theme === 'women_day') {
      // 20/10 Vietnamese Women's Day: Alternating tall flowering canopy trees & lush flowering shrub bushes!
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.85, flatShading: true });
      // Layered vibrant romantic foliage: rich crimson-magenta, coral-rose, and soft blush pink
      const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0xd81b60, roughness: 0.75, flatShading: true });
      const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0xec407a, roughness: 0.75, flatShading: true });
      const foliageMat3 = new THREE.MeshStandardMaterial({ color: 0xf48fb1, roughness: 0.75, flatShading: true });

      // Prominent, radiant floral blossoms: snow white, vivid cherry blossom pink, and golden stamen dots
      const flowerWhiteMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x444444,
        roughness: 0.35,
        flatShading: true,
      });
      const flowerPinkMat = new THREE.MeshStandardMaterial({
        color: 0xff4081,
        emissive: 0x441122,
        roughness: 0.4,
        flatShading: true,
      });
      const flowerGoldMat = new THREE.MeshStandardMaterial({
        color: 0xffeb3b,
        emissive: 0x332200,
        roughness: 0.35,
        flatShading: true,
      });

      const nTall = Math.ceil(nTree / 2);
      const nBush = nTree - nTall;

      const trunksTall = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.65, 3.8, 6), trunkMat, nTall);
      const trunksBush = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.48, 1.8, 5), trunkMat, nBush);
      const canopyLower = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(3.0, 1), foliageMat1, nTree);
      const canopyMid = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.3, 1), foliageMat2, nTree);
      const canopyTop = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.7, 1), foliageMat3, nTall);

      // Plump prominent blossoms (radius 0.46m, 0.42m, 0.36m)
      const flowersWhite = new THREE.InstancedMesh(new THREE.SphereGeometry(0.46, 7, 5), flowerWhiteMat, nTree * 4);
      const flowersPink = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 7, 5), flowerPinkMat, nTree * 4);
      const flowersGold = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 6, 5), flowerGoldMat, nTree * 2);

      trunksTall.castShadow = true;
      trunksBush.castShadow = true;
      canopyLower.castShadow = true;
      canopyMid.castShadow = true;
      canopyTop.castShadow = true;
      flowersWhite.castShadow = true;
      flowersPink.castShadow = true;
      flowersGold.castShadow = true;

      let tallIdx = 0;
      let bushIdx = 0;
      let fWhiteIdx = 0;
      let fPinkIdx = 0;
      let fGoldIdx = 0;

      for (let i = 0; i < nTree; i++) {
        const { x, z, s } = this.treeCoords[i];
        const isTall = i % 2 === 0;

        if (isTall) {
          // --- TALL FLOWERING CANOPY TREE (Tán cao và to hơn) ---
          // Trunk reaches height 3.8, base at ground
          m4.makeScale(s, s, s);
          m4.setPosition(x, 1.9 * s, z);
          trunksTall.setMatrixAt(tallIdx++, m4);

          // Canopy 1: Broad lower crown (y = 4.5 * s)
          m4.makeScale(s * 1.25, s * 0.95, s * 1.25);
          m4.setPosition(x, 4.5 * s, z);
          canopyLower.setMatrixAt(i, m4);

          // Canopy 2: Mid crown (y = 6.2 * s)
          m4.makeScale(s * 1.15, s * 0.9, s * 1.15);
          m4.setPosition(x, 6.2 * s, z);
          canopyMid.setMatrixAt(i, m4);
          const r2 = 2.3 * 1.15 * s;

          // Canopy 3: High crowning dome (y = 7.6 * s) - Total height ~8.6s!
          m4.makeScale(s * 1.0, s * 0.85, s * 1.0);
          m4.setPosition(x, 7.6 * s, z);
          canopyTop.setMatrixAt(tallIdx - 1, m4);
          const r3 = 1.7 * 1.0 * s;

          // 10 prominent blossoms perched proudly on the outer canopy surface
          const flowerSpots = [
            { r: r2, cy: 6.2 * s, th: 0.4, ph: 0.55, type: 'w' },
            { r: r2, cy: 6.2 * s, th: 2.1, ph: 0.65, type: 'w' },
            { r: r3, cy: 7.6 * s, th: 3.6, ph: 0.75, type: 'w' },
            { r: r3, cy: 7.6 * s, th: 5.2, ph: 0.85, type: 'w' },
            { r: r2, cy: 6.2 * s, th: 1.2, ph: 0.60, type: 'p' },
            { r: r2, cy: 6.2 * s, th: 4.5, ph: 0.50, type: 'p' },
            { r: r3, cy: 7.6 * s, th: 0.8, ph: 0.80, type: 'p' },
            { r: r3, cy: 7.6 * s, th: 2.7, ph: 0.70, type: 'p' },
            { r: r3, cy: 7.6 * s, th: 1.8, ph: 0.92, type: 'g' },
            { r: r2, cy: 6.2 * s, th: 3.3, ph: 0.55, type: 'g' },
          ];

          for (const sp of flowerSpots) {
            const outR = sp.r + 0.16 * s;
            const fx = x + Math.cos(sp.th) * Math.cos(sp.ph) * outR;
            const fy = sp.cy + Math.sin(sp.ph) * outR;
            const fz = z + Math.sin(sp.th) * Math.cos(sp.ph) * outR;
            m4.makeScale(s, s, s);
            m4.setPosition(fx, fy, fz);
            if (sp.type === 'w') flowersWhite.setMatrixAt(fWhiteIdx++, m4);
            else if (sp.type === 'p') flowersPink.setMatrixAt(fPinkIdx++, m4);
            else flowersGold.setMatrixAt(fGoldIdx++, m4);
          }
        } else {
          // --- BROAD FLOWERING SHRUB BUSH (Cây bụi tán tròn đầy đặn) ---
          // Sturdy short trunk
          m4.makeScale(s, s, s);
          m4.setPosition(x, 0.9 * s, z);
          trunksBush.setMatrixAt(bushIdx++, m4);

          // Canopy 1: Wide spreading base (y = 2.4 * s)
          m4.makeScale(s * 1.35, s * 0.9, s * 1.35);
          m4.setPosition(x, 2.4 * s, z);
          canopyLower.setMatrixAt(i, m4);
          const r1 = 3.0 * 1.35 * s;

          // Canopy 2: Lush upper dome (y = 3.7 * s)
          m4.makeScale(s * 1.15, s * 0.85, s * 1.15);
          m4.setPosition(x, 3.7 * s, z);
          canopyMid.setMatrixAt(i, m4);
          const r2 = 2.3 * 1.15 * s;

          // 10 prominent blossoms perched proudly on the outer shrub surface
          const flowerSpots = [
            { r: r1, cy: 2.4 * s, th: 0.5, ph: 0.40, type: 'w' },
            { r: r2, cy: 3.7 * s, th: 1.9, ph: 0.70, type: 'w' },
            { r: r1, cy: 2.4 * s, th: 3.4, ph: 0.45, type: 'w' },
            { r: r2, cy: 3.7 * s, th: 5.0, ph: 0.80, type: 'w' },
            { r: r1, cy: 2.4 * s, th: 1.3, ph: 0.45, type: 'p' },
            { r: r2, cy: 3.7 * s, th: 2.8, ph: 0.65, type: 'p' },
            { r: r1, cy: 2.4 * s, th: 4.2, ph: 0.40, type: 'p' },
            { r: r2, cy: 3.7 * s, th: 5.9, ph: 0.75, type: 'p' },
            { r: r2, cy: 3.7 * s, th: 0.9, ph: 0.88, type: 'g' },
            { r: r1, cy: 2.4 * s, th: 2.5, ph: 0.50, type: 'g' },
          ];

          for (const sp of flowerSpots) {
            const outR = sp.r + 0.16 * s;
            const fx = x + Math.cos(sp.th) * Math.cos(sp.ph) * outR;
            const fy = sp.cy + Math.sin(sp.ph) * outR;
            const fz = z + Math.sin(sp.th) * Math.cos(sp.ph) * outR;
            m4.makeScale(s, s, s);
            m4.setPosition(fx, fy, fz);
            if (sp.type === 'w') flowersWhite.setMatrixAt(fWhiteIdx++, m4);
            else if (sp.type === 'p') flowersPink.setMatrixAt(fPinkIdx++, m4);
            else flowersGold.setMatrixAt(fGoldIdx++, m4);
          }
        }
      }

      this.treeGroup.add(
        trunksTall,
        trunksBush,
        canopyLower,
        canopyMid,
        canopyTop,
        flowersWhite,
        flowersPink,
        flowersGold
      );
    } else if (theme === 'halloween') {
      // Halloween Theme: Spooky autumnal trees with pumpkin orange, blood plum, and gothic purple crowns
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2b1d1d, roughness: 0.9, flatShading: true });
      const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0xd96414, roughness: 0.75, flatShading: true });
      const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x5e192c, roughness: 0.75, flatShading: true });
      const foliageMat3 = new THREE.MeshStandardMaterial({ color: 0x331038, roughness: 0.75, flatShading: true });
      const lanternMat = new THREE.MeshStandardMaterial({
        color: 0xff6d00,
        emissive: 0xff3300,
        emissiveIntensity: 1.5,
        roughness: 0.3,
      });

      const nTall = Math.ceil(nTree / 2);
      const nBush = nTree - nTall;

      const trunksTall = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.65, 3.8, 6), trunkMat, nTall);
      const trunksBush = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.48, 1.8, 5), trunkMat, nBush);
      const canopyLower = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(3.0, 1), foliageMat1, nTree);
      const canopyMid = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(2.3, 1), foliageMat2, nTree);
      const canopyTop = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.7, 1), foliageMat3, nTall);
      const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), lanternMat, nTree * 3);

      trunksTall.castShadow = true;
      trunksBush.castShadow = true;
      canopyLower.castShadow = true;
      canopyMid.castShadow = true;
      canopyTop.castShadow = true;
      lanterns.castShadow = true;

      let tallIdx = 0;
      let bushIdx = 0;
      let lantIdx = 0;

      for (let i = 0; i < nTree; i++) {
        const { x, z, s } = this.treeCoords[i];
        const isTall = i % 2 === 0;

        if (isTall) {
          m4.makeScale(s, s, s);
          m4.setPosition(x, 1.9 * s, z);
          trunksTall.setMatrixAt(tallIdx++, m4);

          m4.makeScale(s * 1.25, s * 0.95, s * 1.25);
          m4.setPosition(x, 4.5 * s, z);
          canopyLower.setMatrixAt(i, m4);

          m4.makeScale(s * 1.15, s * 0.95, s * 1.15);
          m4.setPosition(x, 6.2 * s, z);
          canopyMid.setMatrixAt(i, m4);

          m4.makeScale(s, s * 0.9, s);
          m4.setPosition(x, 7.6 * s, z);
          canopyTop.setMatrixAt(Math.floor(i / 2), m4);
        } else {
          m4.makeScale(s, s, s);
          m4.setPosition(x, 0.9 * s, z);
          trunksBush.setMatrixAt(bushIdx++, m4);

          m4.makeScale(s * 1.35, s * 0.85, s * 1.35);
          m4.setPosition(x, 2.2 * s, z);
          canopyLower.setMatrixAt(i, m4);

          m4.makeScale(s * 1.1, s * 0.8, s * 1.1);
          m4.setPosition(x, 3.4 * s, z);
          canopyMid.setMatrixAt(i, m4);
        }

        for (let j = 0; j < 3; j++) {
          const ang = (j / 3) * Math.PI * 2 + (i * 1.3);
          const r = (isTall ? 2.6 : 2.0) * s;
          m4.makeScale(s, s, s);
          m4.setPosition(x + Math.cos(ang) * r, (isTall ? 4.2 : 2.2) * s, z + Math.sin(ang) * r);
          lanterns.setMatrixAt(lantIdx++, m4);
        }
      }

      this.treeGroup.add(trunksTall, trunksBush, canopyLower, canopyMid, canopyTop, lanterns);
    } else {
      // Classic Farm Theme: traditional pines
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85, flatShading: true });
      const leavesMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.85, flatShading: true });

      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 5), trunkMat, nTree);
      const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6.5, 6), leavesMat, nTree);
      trunks.castShadow = true;
      leaves.castShadow = true;

      for (let i = 0; i < nTree; i++) {
        const { x, z, s } = this.treeCoords[i];
        m4.makeScale(s, s, s);
        m4.setPosition(x, 1.5 * s, z);
        trunks.setMatrixAt(i, m4);
        m4.makeScale(s, s, s);
        m4.setPosition(x, 5.5 * s, z);
        leaves.setMatrixAt(i, m4);
      }
      this.treeGroup.add(trunks, leaves);
    }
  }

  buildMap(map: MapData): void {
    this.lastMapData = map;
    this.hazardGroup.clear();
    this.flames.length = 0;
    this.podiumGroup.position.set(map.podium[0], 0, map.podium[1]);
    this.buildFarmFruitTrees(map.trees || []);

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

  private buildFarmFruitTrees(trees: TreeData[]): void {
    this.farmTreeGroup.clear();
    this.farmTrees.length = 0;
    const theme = getArenaTheme();

    for (const t of trees) {
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);

      // Distinct sizes (+100% scale, +100% trunk height):
      // Size 2 (Large, 1000kg): trunkH = 9.0m, trunk r ~ 1.3..1.9m, canopy 3 tiers (r=8.4, 6.6, 4.6)
      // Size 1 (Medium, 500kg): trunkH = 7.0m, trunk r ~ 0.96..1.44m, canopy 2 tiers (r=6.2, 4.6)
      // Size 0 (Small, 100kg): trunkH = 5.0m, trunk r ~ 0.70..1.00m, canopy 1 tier (r=4.4)

      const trunkH = t.size === 2 ? 9.0 : t.size === 1 ? 7.0 : 5.0;
      const trunkRTop = t.size === 2 ? 1.30 : t.size === 1 ? 0.96 : 0.70;
      const trunkRBot = t.size === 2 ? 1.90 : t.size === 1 ? 1.44 : 1.00;

      const trunkMat = new THREE.MeshStandardMaterial({
        color: theme === 'women_day' ? 0x4e342e : theme === 'halloween' ? 0x2b1d1d : 0x5d3a1a,
        roughness: 0.85,
        flatShading: true,
      });

      const trunkMesh = new THREE.Mesh(new THREE.CylinderGeometry(trunkRTop, trunkRBot, trunkH, 8), trunkMat);
      trunkMesh.position.y = trunkH * 0.5;
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      g.add(trunkMesh);

      // Canopy group (animates/shakes on impact)
      const canopyGroup = new THREE.Group();
      g.add(canopyGroup);

      // Foliage materials based on theme
      const folMat1 = new THREE.MeshStandardMaterial({
        color: theme === 'women_day' ? 0xd81b60 : theme === 'halloween' ? 0xd96414 : 0x2e7d32,
        roughness: 0.75,
        flatShading: true,
      });
      const folMat2 = new THREE.MeshStandardMaterial({
        color: theme === 'women_day' ? 0xec407a : theme === 'halloween' ? 0x5e192c : 0x388e3c,
        roughness: 0.75,
        flatShading: true,
      });
      const folMat3 = new THREE.MeshStandardMaterial({
        color: theme === 'women_day' ? 0xf48fb1 : theme === 'halloween' ? 0x331038 : 0x43a047,
        roughness: 0.75,
        flatShading: true,
      });

      // Tiers of canopy (raised to top of lengthened trunk)
      if (t.size === 2) {
        // Large: 3 tiers
        const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(8.4, 1), folMat1);
        c1.position.y = 9.0;
        c1.castShadow = true;
        const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(6.6, 1), folMat2);
        c2.position.y = 12.6;
        c2.castShadow = true;
        const c3 = new THREE.Mesh(new THREE.DodecahedronGeometry(4.6, 1), folMat3);
        c3.position.y = 15.4;
        c3.castShadow = true;
        canopyGroup.add(c1, c2, c3);
      } else if (t.size === 1) {
        // Medium: 2 tiers
        const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(6.2, 1), folMat1);
        c1.position.y = 7.2;
        c1.castShadow = true;
        const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(4.6, 1), folMat2);
        c2.position.y = 10.4;
        c2.castShadow = true;
        canopyGroup.add(c1, c2);
      } else {
        // Small: 1 tier
        const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(4.4, 1), folMat2);
        c1.position.y = 5.6;
        c1.castShadow = true;
        canopyGroup.add(c1);
      }

      const canopyCenterY = t.size === 2 ? 11.5 : t.size === 1 ? 8.8 : 5.8;
      const canopyMaxR = t.size === 2 ? 7.6 : t.size === 1 ? 5.6 : 4.0;

      // Flowers on canopy: Yellow flowers, naturally scattered in 3D around the canopy
      const flowerMeshes: THREE.Mesh[] = [];
      const flowerCount = t.size === 2 ? 24 : t.size === 1 ? 16 : 10;
      const flowerYellowMat = new THREE.MeshStandardMaterial({
        color: 0xffd600,
        emissive: 0x332200,
        roughness: 0.35,
        flatShading: true,
      });

      for (let i = 0; i < flowerCount; i++) {
        const fMesh = new THREE.Mesh(new THREE.SphereGeometry(t.size === 2 ? 0.45 : 0.35, 6, 5), flowerYellowMat);
        const fPhi = (((i * 1.6180339887) % 1) * 0.75 + 0.2) * Math.PI;
        const fTheta = (i * 2.399963229728 + t.id * 1.7) % (Math.PI * 2);
        const r = canopyMaxR * (0.85 + 0.15 * Math.sin(i * 3.7));
        fMesh.position.set(
          Math.sin(fPhi) * Math.cos(fTheta) * r,
          canopyCenterY + Math.cos(fPhi) * r * 0.65,
          Math.sin(fPhi) * Math.sin(fTheta) * r
        );
        fMesh.visible = false;
        canopyGroup.add(fMesh);
        flowerMeshes.push(fMesh);
      }

      // Small Fruits (Red shiny apples with little brown stem, 3D scattered)
      const smallFruitMeshes: THREE.Mesh[] = [];
      const smallFruitCount = t.size === 2 ? 14 : t.size === 1 ? 9 : 5;
      const appleMat = new THREE.MeshStandardMaterial({
        color: 0xe53935,
        roughness: 0.28,
        metalness: 0.1,
      });
      const appleStemMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 });

      for (let i = 0; i < smallFruitCount; i++) {
        const sGroup = new THREE.Group();
        const aMesh = new THREE.Mesh(new THREE.SphereGeometry(t.size === 2 ? 0.45 : 0.35, 8, 7), appleMat);
        aMesh.scale.set(1, 0.95, 1);
        sGroup.add(aMesh);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 5), appleStemMat);
        stem.position.y = t.size === 2 ? 0.5 : 0.4;
        stem.rotation.z = 0.2;
        sGroup.add(stem);

        const aPhi = (((((i + 0.5) * 1.6180339887) % 1) * 0.72) + 0.24) * Math.PI;
        const aTheta = (i * 2.718281828 + t.id * 2.3) % (Math.PI * 2);
        const aR = canopyMaxR * (0.84 + 0.12 * Math.cos(i * 4.1));
        sGroup.position.set(
          Math.sin(aPhi) * Math.cos(aTheta) * aR,
          canopyCenterY + Math.cos(aPhi) * aR * 0.65,
          Math.sin(aPhi) * Math.sin(aTheta) * aR
        );
        sGroup.visible = false;
        canopyGroup.add(sGroup);
        smallFruitMeshes.push(sGroup as any);
      }

      // Big Fruits (Giant Red Apples with stem and leaf - 100% red tree fruit, no watermelons!)
      const bigFruitMeshes: THREE.Group[] = [];
      const bigFruitCount = t.size === 2 ? 14 : t.size === 1 ? 9 : 5;
      const bigAppleMat = new THREE.MeshStandardMaterial({
        color: 0xd32f2f,
        roughness: 0.25,
        metalness: 0.08,
      });
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.5 });

      for (let i = 0; i < bigFruitCount; i++) {
        const mGroup = new THREE.Group();
        const bigR = t.size === 2 ? 0.85 : 0.65;
        const mBody = new THREE.Mesh(new THREE.SphereGeometry(bigR, 12, 10), bigAppleMat);
        mBody.scale.set(1.0, 0.94, 1.0);
        mGroup.add(mBody);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, bigR * 0.55, 6), appleStemMat);
        stem.position.y = bigR * 1.05;
        stem.rotation.z = 0.25;
        mGroup.add(stem);
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(bigR * 0.22, bigR * 0.55, 4), leafMat);
        leaf.position.set(bigR * 0.18, bigR * 1.15, 0);
        leaf.rotation.z = -0.8;
        mGroup.add(leaf);

        const mPhi = (((((i + 0.25) * 1.6180339887) % 1) * 0.72) + 0.24) * Math.PI;
        const mTheta = (i * 3.14159265 + t.id * 3.1) % (Math.PI * 2);
        const mR = canopyMaxR * (0.88 + 0.12 * Math.sin(i * 5.3));
        mGroup.position.set(
          Math.sin(mPhi) * Math.cos(mTheta) * mR,
          canopyCenterY + Math.cos(mPhi) * mR * 0.65,
          Math.sin(mPhi) * Math.sin(mTheta) * mR
        );
        mGroup.visible = false;
        canopyGroup.add(mGroup);
        bigFruitMeshes.push(mGroup);
      }

      this.farmTreeGroup.add(g);
      this.farmTrees.push({
        id: t.id,
        x: t.x,
        z: t.z,
        size: t.size,
        group: g,
        trunkMesh,
        canopyGroup,
        flowerMeshes,
        smallFruitMeshes,
        bigFruitMeshes,
        shakeTimer: 0,
        stage: 0,
        bigCount: 0,
        smallCount: 0,
        flowerCount: 0,
      });
    }
  }

  updateTrees(wireTrees: TreeSyncWire[]): void {
    for (const [id, stage, big, small, flowers] of wireTrees) {
      const vis = this.farmTrees.find((t) => t.id === id);
      if (!vis) continue;
      vis.stage = stage;
      vis.bigCount = big;
      vis.smallCount = small;
      vis.flowerCount = flowers;

      // Flowers visible: when stage === 1 or flowers > 0
      const showFlowers = stage === 1 || flowers > 0;
      vis.flowerMeshes.forEach((fm) => {
        fm.visible = showFlowers;
      });

      // Small fruits visible: when stage >= 2 or small > 0
      const showSmall = stage >= 2 || small > 0;
      const smallSlots = vis.smallFruitMeshes.length;
      const smallVisCount = showSmall
        ? Math.max(1, Math.min(smallSlots, Math.ceil((small / (vis.size === 2 ? 12 : vis.size === 1 ? 8 : 4)) * smallSlots)))
        : 0;
      vis.smallFruitMeshes.forEach((sm, idx) => {
        sm.visible = showSmall && idx < smallVisCount;
      });

      // Big ripe fruits visible: when stage === 3 or big > 0
      const showBig = stage === 3 || big > 0;
      const bigSlots = vis.bigFruitMeshes.length;
      const bigVisCount = showBig
        ? Math.max(1, Math.min(bigSlots, Math.ceil((big / (vis.size === 2 ? 24 : vis.size === 1 ? 16 : 8)) * bigSlots)))
        : 0;
      vis.bigFruitMeshes.forEach((bm, idx) => {
        bm.visible = showBig && idx < bigVisCount;
      });
    }
  }

  onTreeHit(id: number, _by: number, x: number, z: number, size: number, droppedBig: number, droppedSmall: number): void {
    const vis = this.farmTrees.find((t) => t.id === id);
    if (vis) {
      vis.shakeTimer = 1.2;
    }

    // Spawn falling fruit projectiles from canopy to ground
    const canopyY = size === 2 ? 5.2 : size === 1 ? 4.0 : 3.0;
    const totalDrop = Math.min(10, droppedBig + droppedSmall);
    for (let i = 0; i < totalDrop; i++) {
      const isBig = i < droppedBig;
      const ang = Math.random() * Math.PI * 2;
      const dist = (size === 2 ? 3.0 : size === 1 ? 2.2 : 1.5) * (0.6 + Math.random() * 0.5);
      const startX = x + Math.cos(ang) * dist;
      const startZ = z + Math.sin(ang) * dist;

      const fruitGeo = new THREE.SphereGeometry(isBig ? 0.35 : 0.2, 7, 6);
      const fruitMat = new THREE.MeshStandardMaterial({
        color: isBig ? 0x2e7d32 : 0xe53935,
        roughness: 0.35,
      });
      const mesh = new THREE.Mesh(fruitGeo, fruitMat);
      mesh.position.set(startX, canopyY + Math.random() * 0.5, startZ);
      this.scene.add(mesh);

      const outAng = Math.atan2(startZ - z, startX - x) + (Math.random() - 0.5) * 0.6;
      const speed = 3.5 + Math.random() * 4.0;
      this.fallingFruits.push({
        mesh,
        x: startX,
        y: canopyY,
        z: startZ,
        vx: Math.cos(outAng) * speed,
        vy: 2.0 + Math.random() * 3.0,
        vz: Math.sin(outAng) * speed,
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 1.5,
      });
    }
  }

  private updateFarmTrees(dt: number, _now: number): void {
    // 1. Shaking animation
    for (const tree of this.farmTrees) {
      if (tree.shakeTimer > 0) {
        tree.shakeTimer = Math.max(0, tree.shakeTimer - dt);
        const amp = Math.sin(tree.shakeTimer * 28) * 0.12 * Math.min(1, tree.shakeTimer);
        tree.canopyGroup.rotation.z = amp;
        tree.canopyGroup.rotation.x = Math.cos(tree.shakeTimer * 22) * amp * 0.7;
      } else {
        tree.canopyGroup.rotation.z = 0;
        tree.canopyGroup.rotation.x = 0;
      }
    }

    // 2. Falling fruit physics
    for (let i = this.fallingFruits.length - 1; i >= 0; i--) {
      const f = this.fallingFruits[i];
      f.life -= dt;
      f.vy -= 22 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.mesh.position.set(f.x, Math.max(0.2, f.y), f.z);
      f.mesh.rotation.x += f.rotSpeed * dt;
      f.mesh.rotation.y += f.rotSpeed * dt;

      if (f.y <= 0.25 || f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.fallingFruits.splice(i, 1);
      }
    }
  }

  updateHazards(
    now: number,
    parts?: { puff: (x: number, y: number, z: number, color: number, scale: number, life: number, vy?: number) => void },
    playerPos?: { x: number; z: number }
  ): void {
    this.updateFarmTrees(0.016, now);
    if (this.tex) {
      this.tex.waterMat.map!.offset.set(now * 0.000012, now * 0.000008);
      this.tex.rippleMat.map!.offset.set(-now * 0.00003, now * 0.00002);
      this.tex.coalsMat.emissiveIntensity = 0.75 + 0.35 * Math.sin(now / 280);
    }
    for (const f of this.flames) {
      f.mesh.scale.y = 0.8 + 0.45 * Math.sin(now / 90 + f.idx * 1.7);
      f.mesh.scale.x = f.mesh.scale.z = 0.9 + 0.15 * Math.sin(now / 70 + f.idx);
    }
    this.updateElectricFence(now, parts, playerPos);
  }

  private updateElectricFence(
    now: number,
    parts?: { puff: (x: number, y: number, z: number, color: number, scale: number, life: number, vy?: number) => void },
    playerPos?: { x: number; z: number }
  ): void {
    const R = CFG.R;

    // Ambient electric hum pulse along the entire fence wire rails
    const hum = 1.0 + 0.45 * Math.sin(now / 110) + 0.25 * Math.sin(now / 37);
    let flashEmissive = false;

    // Trigger frequent energetic electric arc discharges (every 450ms - 850ms)
    if (now >= this.nextZapTime) {
      this.nextZapTime = now + 450 + Math.random() * 400;
      const inactive = this.electricArcs.filter((a) => !a.active);
      const spawnCount = Math.min(inactive.length, Math.random() < 0.65 ? 2 : 1);
      for (let i = 0; i < spawnCount; i++) {
        const arc = inactive[i];
        arc.active = true;
        arc.startTime = now;
        arc.duration = 260 + Math.random() * 200; // 260 - 460ms duration
        arc.soundPlayed = false;

        // Biased towards player angle 85% of the time when player is near fence (dist > 25)
        if (playerPos && Math.hypot(playerPos.x, playerPos.z) > 25 && Math.random() < 0.85) {
          const playerAngle = Math.atan2(playerPos.z, playerPos.x);
          arc.angle = playerAngle + (Math.random() - 0.5) * 0.7;
        } else {
          arc.angle = Math.random() * Math.PI * 2;
        }
      }
    }

    const segs = 8;
    for (const arc of this.electricArcs) {
      if (!arc.active) continue;
      const age = now - arc.startTime;
      if (age >= arc.duration) {
        arc.active = false;
        arc.coreMesh.visible = false;
        arc.glowMesh.visible = false;
        arc.coreSphere.visible = false;
        arc.coreHalo.visible = false;
        continue;
      }

      flashEmissive = true;
      arc.coreMesh.visible = true;
      arc.glowMesh.visible = true;
      arc.coreSphere.visible = true;
      arc.coreHalo.visible = true;

      const a = arc.angle;
      const corePos = arc.coreMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const glowPos = arc.glowMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

      // Normal vector facing outwards/upwards for ribbon width
      const nx = Math.cos(a);
      const nz = Math.sin(a);

      const coreW = 0.22;
      const glowW = 0.58;

      // Generate violently crackling zigzag lightning between top rail (1.6), bottom rail (0.8), and ground (0.0)
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const curA = a + (s > 0 && s < segs ? (Math.random() - 0.5) * 0.09 : 0);
        const curR = R + (s > 0 && s < segs ? (Math.random() - 0.5) * 0.45 : 0);
        const curY = 1.6 - t * 1.6 + (s > 0 && s < segs ? (Math.random() - 0.5) * 0.35 : 0);

        const px = Math.cos(curA) * curR;
        const py = Math.max(0.05, curY);
        const pz = Math.sin(curA) * curR;

        // Core ribbon vertices (width 0.44m)
        const idx = s * 2;
        corePos.setXYZ(idx, px - nx * coreW, py, pz - nz * coreW);
        corePos.setXYZ(idx + 1, px + nx * coreW, py, pz + nz * coreW);

        // Glow ribbon vertices (width 1.16m)
        glowPos.setXYZ(idx, px - nx * glowW, py, pz - nz * glowW);
        glowPos.setXYZ(idx + 1, px + nx * glowW, py, pz + nz * glowW);
      }
      corePos.needsUpdate = true;
      glowPos.needsUpdate = true;

      // Glowing plasma discharge orb at the contact point
      arc.coreSphere.position.set(Math.cos(a) * R, 1.2 + (Math.random() - 0.5) * 0.25, Math.sin(a) * R);
      const pulseScale = 0.85 + Math.random() * 0.55;
      arc.coreSphere.scale.setScalar(pulseScale);

      arc.coreHalo.position.copy(arc.coreSphere.position);
      arc.coreHalo.scale.setScalar(pulseScale * 1.4);

      // Sound effect if within hearing range of the player
      if (!arc.soundPlayed && playerPos) {
        const arcX = Math.cos(a) * R;
        const arcZ = Math.sin(a) * R;
        const dist = Math.hypot(playerPos.x - arcX, playerPos.z - arcZ);
        if (dist < 55) {
          const vol = Math.max(0.06, 0.25 * (1 - dist / 55));
          sfxZap(vol);
        }
        arc.soundPlayed = true;
      }

      // Bright spark particles shower puffing outwards
      if (parts) {
        const count = Math.random() < 0.7 ? 2 : 1;
        for (let p = 0; p < count; p++) {
          const spkX = Math.cos(a) * R + (Math.random() - 0.5) * 0.5;
          const spkY = 0.4 + Math.random() * 1.3;
          const spkZ = Math.sin(a) * R + (Math.random() - 0.5) * 0.5;
          const color = Math.random() < 0.4 ? 0xffffff : Math.random() < 0.7 ? 0x00f5ff : 0xfffa65;
          parts.puff(spkX, spkY, spkZ, color, 0.75, 0.35, 2.2);
        }
      }
    }

    // Apply emissive intensity to rails (flashes up to 3.5 during zaps)
    const targetEmissive = flashEmissive ? 3.5 : hum;
    for (const rail of this.fenceRails) {
      const mat = rail.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.emissiveIntensity = targetEmissive;
        mat.emissive.setHex(flashEmissive ? 0x00f5ff : 0x00bfff);
      }
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

  updatePodiumRing(progress: number, contested: boolean, now: number, captorColor: number): void {
    const total = this.podiumTileMats.length;
    if (total === 0) return;
    const litCount = Math.floor(progress * total);
    for (let i = 0; i < total; i++) {
      const mat = this.podiumTileMats[i];
      if (i < litCount) {
        mat.emissive.setHex(captorColor);
        if (contested) {
          // Flash when contested
          mat.emissiveIntensity = 0.4 + 0.5 * Math.abs(Math.sin(now / 130));
        } else {
          mat.emissiveIntensity = 0.7 + 0.2 * Math.sin(now / 250 + i * 0.3);
        }
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  }

  updatePodiumShield(active: boolean, timer: number, now: number): void {
    if (!this.shieldGroup || !this.shieldMat || !this.shieldRingMat) return;
    this.shieldGroup.visible = active;
    if (!active) return;
    const pulseSpeed = timer <= 5 ? 0.015 : 0.005;
    this.shieldGroup.rotation.y = (now * 0.0006) % (Math.PI * 2);
    const pulse = 0.45 + (timer <= 5 ? 0.28 : 0.18) * Math.sin(now * pulseSpeed);
    this.shieldMat.opacity = pulse;
    this.shieldRingMat.opacity = Math.min(1.0, pulse * 1.25);
    if (this.shieldTex) {
      this.shieldTex.offset.x = (now * 0.0002) % 1;
      this.shieldTex.offset.y = (now * 0.0004) % 1;
    }
  }

  updateTillTruck(
    truck?: [number, number, number],
    dt = 0.016,
    now = 0,
    parts?: { puff: (x: number, y: number, z: number, color: number, scale: number, life: number, vy?: number) => void }
  ): void {
    if (!this.tillTruck) return;
    if (truck) {
      this.tillTruck.group.visible = true;

      // 60/120 FPS smooth dead-reckoning & exponential lerp interpolation
      if (!this.truckHasPos) {
        this.truckCurrentX = truck[0];
        this.truckCurrentZ = truck[1];
        this.truckCurrentAngle = truck[2];
        this.truckHasPos = true;
      } else {
        const k = 1 - Math.exp(-dt * 18);
        this.truckCurrentX += (truck[0] - this.truckCurrentX) * k;
        this.truckCurrentZ += (truck[1] - this.truckCurrentZ) * k;

        let dAngle = truck[2] - this.truckCurrentAngle;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        this.truckCurrentAngle += dAngle * k;
      }

      this.tillTruck.group.position.set(this.truckCurrentX, 0, this.truckCurrentZ);
      this.tillTruck.group.rotation.y = -this.truckCurrentAngle;

      // Rotate wheels & front harvester cutter drum
      const rollAngle = now * 0.015;
      for (const w of this.tillTruck.wheels) {
        w.rotation.z = -rollAngle;
      }
      this.tillTruck.cutterDrum.rotation.z = -now * 0.035;

      // Exhaust diesel smoke puffs
      if (parts && now - this.tillSmokeT > 75) {
        this.tillSmokeT = now;
        const cosA = Math.cos(-this.truckCurrentAngle);
        const sinA = Math.sin(-this.truckCurrentAngle);
        const off = this.tillTruck.exhaustPos;
        const ex = this.truckCurrentX + (off.x * cosA - off.z * sinA);
        const ey = off.y;
        const ez = this.truckCurrentZ + (off.x * sinA + off.z * cosA);
        parts.puff(ex, ey, ez, 0x222222, 1.3, 0.75, 1.8);
      }
    } else {
      this.tillTruck.group.visible = false;
      this.truckHasPos = false;
    }
  }

  snapCamera(targetX: number, targetZ: number, mass: number): void {
    const r = radiusOf(mass);
    let h = 30 + r * 6 + this.zoomBias;
    if (this.camera.aspect < 1) h *= 1 + (1 - this.camera.aspect) * 0.9;

    this.camTarget.x = targetX;
    this.camTarget.z = targetZ;
    this.camH = h;

    this.camera.position.set(targetX, h, targetZ + h * 0.7);
    this.camera.lookAt(targetX, 0, targetZ - 1);
    this.camera.updateMatrixWorld(true);

    if (this.sun) {
      this.sun.position.set(targetX + 30, 65, targetZ + 22);
      this.sun.target.position.set(targetX, 0, targetZ);
      this.sun.target.updateMatrixWorld();
    }
  }

  updateCamera(targetX: number, targetZ: number, mass: number, dt: number, shake = 0): void {
    const r = radiusOf(mass);
    let h = 30 + r * 6 + this.zoomBias;
    if (this.camera.aspect < 1) h *= 1 + (1 - this.camera.aspect) * 0.9;

    const k = 1 - Math.exp(-dt * 14);
    this.camTarget.x += (targetX - this.camTarget.x) * k;
    this.camTarget.z += (targetZ - this.camTarget.z) * k;
    this.camH += (h - this.camH) * (1 - Math.exp(-dt * 2));

    const sx = (Math.random() - 0.5) * shake;
    const sz = (Math.random() - 0.5) * shake;

    this.camera.position.set(this.camTarget.x + sx, this.camH, this.camTarget.z + this.camH * 0.7 + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z - 1 + sz);
    this.camera.updateMatrixWorld(true);

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
    this.renderer.setPixelRatio(getOptimalPixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
