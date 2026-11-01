import * as THREE from 'three';
import type { ToolKind, ToolWire } from '@shared/protocol';
import { getArenaTheme, type ArenaTheme } from '../theme';

interface ToolObject {
  group: THREE.Group;
  kind: ToolKind;
  x: number;
  z: number;
  seed: number;
}

function mesh(
  geo: THREE.BufferGeometry,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  matOptions?: THREE.MeshStandardMaterialParameters
): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, ...matOptions }));
  m.position.set(x, y, z);
  return m;
}

interface EggColors {
  egg: number;
  eggEmissive: number;
  ring: number;
  ringEmissive: number;
  band: number;
  sparkle: number;
  sparkleEmissive: number;
}

function buildSparklingEgg(g: THREE.Group, c: EggColors): void {
  const eggGeo = new THREE.SphereGeometry(0.66, 24, 20);
  const pos = eggGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const t = (y + 0.66) / 1.32; // 0 at bottom, 1 at top
    const taper = 1.0 - 0.28 * Math.pow(t, 1.2);
    x *= taper;
    z *= taper;
    y *= 1.32;
    pos.setXYZ(i, x, y, z);
  }
  eggGeo.computeVertexNormals();

  // Plump sparkling egg
  const eggMesh = mesh(eggGeo, c.egg, 0, 1.55, 0, {
    metalness: 0.55,
    roughness: 0.2,
    emissive: c.eggEmissive,
    emissiveIntensity: 0.45,
  });
  g.add(eggMesh);

  // Celestial ring
  const ring = mesh(new THREE.TorusGeometry(1.05, 0.045, 8, 32), c.ring, 0, 1.55, 0, {
    metalness: 0.85,
    roughness: 0.15,
    emissive: c.ringEmissive,
    emissiveIntensity: 0.55,
  });
  ring.rotation.x = Math.PI / 3;
  ring.rotation.y = Math.PI / 6;
  g.add(ring);

  // Equatorial jewel band
  const band = mesh(new THREE.TorusGeometry(0.68, 0.035, 8, 24), c.band, 0, 1.45, 0, {
    metalness: 0.9,
    roughness: 0.15,
  });
  band.rotation.x = Math.PI / 2;
  g.add(band);

  // 4 orbiting sparkling diamond stars
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const sparkle = mesh(new THREE.OctahedronGeometry(0.13, 0), c.sparkle, Math.cos(a) * 0.88, 1.55 + Math.sin(a * 2) * 0.25, Math.sin(a) * 0.88, {
      metalness: 0.7,
      roughness: 0.2,
      emissive: c.sparkleEmissive,
      emissiveIntensity: 0.85,
    });
    sparkle.rotation.y = a;
    sparkle.rotation.z = Math.PI / 4;
    g.add(sparkle);
  }
}

function createBananaGeometry(): { geo: THREE.BufferGeometry; p0: THREE.Vector3; pLast: THREE.Vector3 } {
  const nSlices = 32;
  const nRadial = 20;

  // Pure smooth parabolic crescent curve (no inflection points, zero twists)
  const points: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];

  for (let i = 0; i <= nSlices; i++) {
    const t = i / nSlices;
    // x goes from -0.52 to 0.48
    const x = -0.52 + 1.00 * t;
    // y is a graceful smiling crescent
    const u = 2 * t - 1; // -1 to 1
    const y = 0.32 - 0.38 * (1 - u * u);
    points.push(new THREE.Vector3(x, y, 0));

    // Tangent derivative: dx/dt = 1.0, dy/dt = 0.38 * 2 * u * 2 = 1.52 * u
    const tx = 1.00;
    const ty = 1.52 * u;
    const len = Math.hypot(tx, ty);
    const tan = new THREE.Vector3(tx / len, ty / len, 0);
    tangents.push(tan);

    // Stable 2D normal in XY plane perpendicular to tangent: (-ty, tx, 0)
    normals.push(new THREE.Vector3(-tan.y, tan.x, 0));
    // Binormal is strictly (0, 0, 1)
    binormals.push(new THREE.Vector3(0, 0, 1));
  }

  function getRadius(t: number): number {
    // Continuous, organic smooth swell
    const baseTaper = (1.0 - t) * 0.068 + t * 0.038;
    const swell = Math.sin(t * Math.PI) * 0.21;
    return baseTaper + swell;
  }

  const positions: number[] = [];
  const vertNormals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Stem cap center vertex (index 0)
  positions.push(points[0].x, points[0].y, points[0].z);
  vertNormals.push(-tangents[0].x, -tangents[0].y, 0);
  uvs.push(0.5, 0.5);

  // Rings of vertices
  for (let i = 0; i <= nSlices; i++) {
    const t = i / nSlices;
    const p = points[i];
    const N = normals[i];
    const B = binormals[i];
    const r = getRadius(t);

    for (let j = 0; j <= nRadial; j++) {
      const phi = (j / nRadial) * Math.PI * 2;
      // Banana 5-sided facet (natural peel geometry)
      const facetFactor = 1.0 + 0.05 * Math.cos(phi * 5);
      const rad = r * facetFactor;

      const cx = Math.cos(phi);
      const cy = Math.sin(phi);

      const vx = p.x + (N.x * cx + B.x * cy) * rad;
      const vy = p.y + (N.y * cx + B.y * cy) * rad;
      const vz = p.z + (N.z * cx + B.z * cy) * rad;
      positions.push(vx, vy, vz);

      const nx = N.x * cx + B.x * cy;
      const ny = N.y * cx + B.y * cy;
      const nz = N.z * cx + B.z * cy;
      vertNormals.push(nx, ny, nz);

      uvs.push(j / nRadial, t);
    }
  }

  // Blossom tip cap center vertex
  const lastP = points[nSlices];
  const tipIdx = positions.length / 3;
  positions.push(lastP.x, lastP.y, lastP.z);
  vertNormals.push(tangents[nSlices].x, tangents[nSlices].y, 0);
  uvs.push(0.5, 0.5);

  // Faces: Stem cap
  for (let j = 0; j < nRadial; j++) {
    const v1 = 1 + j;
    const v2 = 1 + (j + 1);
    indices.push(0, v2, v1);
  }

  // Faces: Tube body
  const stride = nRadial + 1;
  for (let i = 0; i < nSlices; i++) {
    for (let j = 0; j < nRadial; j++) {
      const a = 1 + i * stride + j;
      const b = 1 + (i + 1) * stride + j;
      const c = 1 + (i + 1) * stride + (j + 1);
      const d = 1 + i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // Faces: Blossom tip cap
  const lastRingStart = 1 + nSlices * stride;
  for (let j = 0; j < nRadial; j++) {
    const v1 = lastRingStart + j;
    const v2 = lastRingStart + (j + 1);
    indices.push(tipIdx, v1, v2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(vertNormals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, p0: points[0], pLast: lastP };
}

function buildSparklingBanana(g: THREE.Group): void {
  const { geo: bananaGeo, p0, pLast } = createBananaGeometry();
  const bananaMesh = mesh(bananaGeo, 0xffd500, 0, 1.45, 0, {
    metalness: 0.08,
    roughness: 0.35,
    emissive: 0xffa000,
    emissiveIntensity: 0.22,
  });
  g.add(bananaMesh);

  // Curved green stem seamlessly attached at p0 + (0, 1.45, 0)
  const stemBaseX = p0.x;
  const stemBaseY = p0.y + 1.45;
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(stemBaseX, stemBaseY, 0),
    new THREE.Vector3(stemBaseX - 0.08, stemBaseY + 0.12, 0),
    new THREE.Vector3(stemBaseX - 0.13, stemBaseY + 0.22, 0),
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 10, 0.055, 8, false);
  const stem = mesh(stemGeo, 0x43a047, 0, 0, 0, {
    metalness: 0.0,
    roughness: 0.65,
  });
  g.add(stem);

  // Brownish stem cut tip
  const stemCap = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 8), 0x4e342e, stemBaseX - 0.13, stemBaseY + 0.23, 0, {
    roughness: 0.85,
  });
  stemCap.rotation.z = -0.45;
  g.add(stemCap);

  // Natural subtle dark blossom tip neatly capping the blossom end (pLast + (0, 1.45, 0))
  const tip = mesh(new THREE.SphereGeometry(0.020, 8, 6), 0x4a3424, pLast.x + 0.008, pLast.y + 1.45 + 0.006, 0, {
    roughness: 0.95,
    metalness: 0.0,
  });
  g.add(tip);

  // Orbiting Golden Halo Ring
  const halo = mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 32), 0xffd700, 0, 1.55, 0, {
    metalness: 0.85,
    roughness: 0.2,
    emissive: 0xffb300,
    emissiveIntensity: 0.65,
  });
  halo.rotation.x = Math.PI / 3;
  halo.rotation.y = Math.PI / 6;
  g.add(halo);

  // 6 orbiting sparkling diamond stars
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sparkle = mesh(new THREE.OctahedronGeometry(0.11, 0), 0xffffff, Math.cos(a) * 0.92, 1.55 + Math.sin(a * 3) * 0.22, Math.sin(a) * 0.92, {
      metalness: 0.8,
      roughness: 0.15,
      emissive: 0xffea00,
      emissiveIntensity: 0.9,
    });
    sparkle.rotation.y = a;
    sparkle.rotation.z = Math.PI / 4;
    g.add(sparkle);
  }
}

function buildSpeedBoots(g: THREE.Group): void {
  // Winged boot of Hermes / Lightning Speed Boots
  const bootShaft = mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.8, 12), 0x00e5ff, 0, 1.6, 0, {
    metalness: 0.6,
    roughness: 0.2,
    emissive: 0x00b0ff,
    emissiveIntensity: 0.4,
  });
  g.add(bootShaft);

  const bootToe = mesh(new THREE.SphereGeometry(0.32, 12, 10), 0x00e5ff, 0.26, 1.25, 0, {
    metalness: 0.6,
    roughness: 0.2,
    emissive: 0x00b0ff,
    emissiveIntensity: 0.4,
  });
  bootToe.scale.set(1.4, 0.7, 0.9);
  g.add(bootToe);

  const bootSole = mesh(new THREE.BoxGeometry(0.9, 0.12, 0.55), 0xffd700, 0.1, 1.15, 0, {
    metalness: 0.8,
    roughness: 0.25,
  });
  g.add(bootSole);

  for (const side of [-1, 1]) {
    for (let f = 0; f < 3; f++) {
      const wing = mesh(new THREE.ConeGeometry(0.12, 0.55 - f * 0.08, 6), 0xffea00, -0.18 - f * 0.14, 1.6 + f * 0.18, side * 0.32, {
        metalness: 0.8,
        roughness: 0.2,
        emissive: 0xffd700,
        emissiveIntensity: 0.6,
      });
      wing.rotation.z = Math.PI / 2 + 0.35 - f * 0.2;
      wing.rotation.x = side * 0.25;
      g.add(wing);
    }
  }

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const spark = mesh(new THREE.OctahedronGeometry(0.1, 0), 0xffffff, Math.cos(a) * 0.85, 1.5 + Math.sin(a * 2) * 0.2, Math.sin(a) * 0.85, {
      emissive: 0x00e5ff,
      emissiveIntensity: 1.2,
    });
    g.add(spark);
  }
}

function buildAegisShield(g: THREE.Group): void {
  // Hexagonal Golden Aegis Shield with Emerald Core
  const shieldRim = mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.14, 6), 0xffd700, 0, 1.5, 0, {
    metalness: 0.85,
    roughness: 0.2,
    emissive: 0xffa000,
    emissiveIntensity: 0.35,
  });
  shieldRim.rotation.x = Math.PI / 2;
  g.add(shieldRim);

  const shieldCore = mesh(new THREE.CylinderGeometry(0.65, 0.72, 0.18, 6), 0x00e676, 0, 1.5, 0, {
    metalness: 0.4,
    roughness: 0.2,
    emissive: 0x00c853,
    emissiveIntensity: 0.6,
  });
  shieldCore.rotation.x = Math.PI / 2;
  g.add(shieldCore);

  const gem = mesh(new THREE.OctahedronGeometry(0.28, 0), 0xffffff, 0, 1.5, 0.14, {
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0x69f0ae,
    emissiveIntensity: 1.0,
  });
  gem.scale.set(1.0, 1.2, 0.8);
  g.add(gem);

  const orbitRing = mesh(new THREE.TorusGeometry(1.08, 0.04, 8, 30), 0x69f0ae, 0, 1.5, 0, {
    metalness: 0.7,
    roughness: 0.15,
    emissive: 0x00e676,
    emissiveIntensity: 0.8,
  });
  orbitRing.rotation.x = Math.PI / 2.6;
  g.add(orbitRing);
}

export function createHeartShape(): THREE.Shape {
  const shape = new THREE.Shape();
  // Classic plump rounded 3D heart
  shape.moveTo(0, 0.35);
  shape.bezierCurveTo(0, 0.65, 0.35, 0.95, 0.65, 0.95);
  shape.bezierCurveTo(1.05, 0.95, 1.05, 0.45, 1.05, 0.45);
  shape.bezierCurveTo(1.05, 0.05, 0.65, -0.4, 0, -0.85);
  shape.bezierCurveTo(-0.65, -0.4, -1.05, 0.05, -1.05, 0.45);
  shape.bezierCurveTo(-1.05, 0.45, -1.05, 0.95, -0.65, 0.95);
  shape.bezierCurveTo(-0.35, 0.95, 0, 0.65, 0, 0.35);
  return shape;
}

export function createHeartGeometry(depth = 0.38): THREE.BufferGeometry {
  const shape = createHeartShape();
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth,
    bevelEnabled: true,
    bevelSegments: 5,
    steps: 2,
    bevelSize: 0.14,
    bevelThickness: 0.14,
  };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.center();
  return geo;
}

export function buildSparklingHeart(g: THREE.Group): void {
  const heartGeo = createHeartGeometry(0.38);
  const heartMat = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    emissive: 0xd50000,
    emissiveIntensity: 0.65,
    metalness: 0.2,
    roughness: 0.25,
  });
  const heartMesh = new THREE.Mesh(heartGeo, heartMat);
  heartMesh.name = 'heartBodyMesh';
  heartMesh.position.set(0, 1.5, 0);
  g.add(heartMesh);

  // Orbiting Golden-Pink Halo Ring
  const haloMat = new THREE.MeshStandardMaterial({
    color: 0xff80ab,
    metalness: 0.85,
    roughness: 0.15,
    emissive: 0xff4081,
    emissiveIntensity: 0.8,
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 8, 36), haloMat);
  halo.name = 'heartHaloRing';
  halo.position.set(0, 1.5, 0);
  halo.rotation.x = Math.PI / 3;
  halo.rotation.y = Math.PI / 6;
  g.add(halo);

  // 6 orbiting sparkling diamond stars
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sparkleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0xff80ab,
      emissiveIntensity: 1.2,
    });
    const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), sparkleMat);
    sparkle.name = `heartSparkle_${i}`;
    sparkle.position.set(Math.cos(a) * 1.15, 1.5 + Math.sin(a * 2) * 0.3, Math.sin(a) * 1.15);
    sparkle.rotation.z = Math.PI / 4;
    g.add(sparkle);
  }
}

export class ToolRenderer {
  private readonly toolObjs = new Map<number, ToolObject>();
  private readonly group = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  setTheme(_theme: ArenaTheme): void {
    this.clear();
  }

  private buildTool(kind: ToolKind): THREE.Group {
    const g = new THREE.Group();
    // 🌟 Tăng kích thước item đặc biệt lên 1.5 lần
    g.scale.set(1.5, 1.5, 1.5);
    if (kind === 'banana') {
      buildSparklingBanana(g);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.5, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffd700,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.08;
      g.add(glow);
      return g;
    }

    if (kind === 'speed') {
      buildSpeedBoots(g);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.5, 24),
        new THREE.MeshBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.08;
      g.add(glow);
      return g;
    }

    if (kind === 'shield') {
      buildAegisShield(g);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.5, 24),
        new THREE.MeshBasicMaterial({
          color: 0x00e676,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.08;
      g.add(glow);
      return g;
    }

    if (kind === 'heart') {
      buildSparklingHeart(g);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.5, 24),
        new THREE.MeshBasicMaterial({
          color: 0xff4081,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.08;
      g.add(glow);
      return g;
    }

    const theme = getArenaTheme();
    if (theme === 'women_day') {
      if (kind === 'pitchfork') {
        // Bó hoa hồng rực rỡ (Rose Bouquet)
        // Bundle of green stems
        g.add(mesh(new THREE.CylinderGeometry(0.12, 0.08, 2.2, 8), 0x388e3c, 0, 1.1, 0));
        // Golden-pink ribbon wrapping around stems
        const ribbon = mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 16), 0xff4081, 0, 1.2, 0, { roughness: 0.3 });
        ribbon.rotation.x = Math.PI / 2;
        g.add(ribbon);
        // Ribbon bow tails
        g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.04), 0xff4081, -0.1, 0.95, 0.16));
        g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.04), 0xff4081, 0.1, 0.95, 0.16));

        // Green leaves around base of roses
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const leaf = mesh(new THREE.SphereGeometry(0.18, 8, 6), 0x4caf50, Math.cos(a) * 0.35, 2.15, Math.sin(a) * 0.35);
          leaf.scale.set(1.4, 0.3, 0.8);
          leaf.rotation.y = a;
          g.add(leaf);
        }

        // Center large red rose
        g.add(mesh(new THREE.SphereGeometry(0.42, 12, 10), 0xd81b60, 0, 2.5, 0, { roughness: 0.4, emissive: 0x4a0e1c, emissiveIntensity: 0.2 }));
        // 4 surrounding blooming roses
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          g.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), 0xe91e63, Math.cos(a) * 0.38, 2.38, Math.sin(a) * 0.38, { roughness: 0.4 }));
        }
      } else if (kind === 'dynamite') {
        // Hộp quà bất ngờ (Surprise Gift Box)
        // Square festive gift box
        g.add(mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), 0xf06292, 0, 1.15, 0, { roughness: 0.35 }));
        // Cross ribbon horizontal & vertical
        g.add(mesh(new THREE.BoxGeometry(1.34, 1.34, 0.28), 0xffd700, 0, 1.15, 0, { metalness: 0.6, roughness: 0.25 }));
        g.add(mesh(new THREE.BoxGeometry(0.28, 1.34, 1.34), 0xffd700, 0, 1.15, 0, { metalness: 0.6, roughness: 0.25 }));
        // Ribbon loop bow on top
        const loopL = mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), 0xffd700, -0.16, 1.95, 0, { metalness: 0.6, roughness: 0.25 });
        loopL.rotation.y = Math.PI / 4;
        g.add(loopL);
        const loopR = mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), 0xffd700, 0.16, 1.95, 0, { metalness: 0.6, roughness: 0.25 });
        loopR.rotation.y = -Math.PI / 4;
        g.add(loopR);
        g.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), 0xffd700, 0, 1.88, 0, { metalness: 0.6, roughness: 0.25 }));
      } else if (kind === 'song') {
        // Thư tình & Trái tim (Love Letter / Heart Melody)
        // Pearl envelope
        g.add(mesh(new THREE.BoxGeometry(1.6, 1.2, 0.12), 0xfff8f0, 0, 1.5, 0, { roughness: 0.5 }));
        // Flap crease
        g.add(mesh(new THREE.BoxGeometry(1.52, 0.06, 0.14), 0xf3e5f5, 0, 1.85, 0));
        // Heart wax seal in center
        const heartL = mesh(new THREE.SphereGeometry(0.12, 10, 8), 0xe91e63, -0.07, 1.55, 0.08);
        const heartR = mesh(new THREE.SphereGeometry(0.12, 10, 8), 0xe91e63, 0.07, 1.55, 0.08);
        const heartPt = mesh(new THREE.ConeGeometry(0.15, 0.22, 8), 0xe91e63, 0, 1.45, 0.08);
        heartPt.rotation.z = Math.PI;
        g.add(heartL, heartR, heartPt);
        // Floating heart above
        const topHeartL = mesh(new THREE.SphereGeometry(0.15, 10, 8), 0xff4081, -0.09, 2.38, 0);
        const topHeartR = mesh(new THREE.SphereGeometry(0.15, 10, 8), 0xff4081, 0.09, 2.38, 0);
        const topHeartPt = mesh(new THREE.ConeGeometry(0.19, 0.28, 8), 0xff4081, 0, 2.25, 0);
        topHeartPt.rotation.z = Math.PI;
        g.add(topHeartL, topHeartR, topHeartPt);
      } else if (kind === 'wheel') {
        // Bánh xe hoa (Floral Chariot Wheel)
        g.add(mesh(new THREE.TorusGeometry(0.75, 0.12, 10, 24), 0xf48fb1, 0, 1.5, 0, { roughness: 0.4 }));
        g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), 0xffd54f, 0, 1.5, 0, { metalness: 0.7, roughness: 0.3 }));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const petal = mesh(new THREE.SphereGeometry(0.16, 8, 6), 0xff4081, Math.cos(a) * 0.45, 1.5, Math.sin(a) * 0.45);
          petal.scale.set(1.5, 0.3, 0.8);
          petal.rotation.y = a;
          g.add(petal);
        }
        g.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), 0xe91e63, 0, 1.5, 0.14, { roughness: 0.4, emissive: 0x4a0e1c, emissiveIntensity: 0.2 }));
      } else {
        // Trứng Thần Tình Yêu / Ngọc Trai Hồng (Love & Rose Pearl Egg)
        buildSparklingEgg(g, {
          egg: 0xffe4ec,
          eggEmissive: 0xff4081,
          ring: 0xff80ab,
          ringEmissive: 0xd81b60,
          band: 0xffd700,
          sparkle: 0xffffff,
          sparkleEmissive: 0xff4081,
        });
      }
    } else if (theme === 'halloween') {
      if (kind === 'pitchfork') {
        // Lưỡi Hái Tử Thần (Grim Reaper Scythe)
        // Tall dark curved wooden staff
        g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), 0x1f1b24, 0, 1.6, 0, { roughness: 0.9 }));
        // Curved metallic scythe blade extending horizontally from top
        const bladeSpine = mesh(new THREE.BoxGeometry(1.6, 0.12, 0.08), 0x78909c, -0.6, 3.1, 0, { metalness: 0.85, roughness: 0.2 });
        bladeSpine.rotation.z = 0.25;
        g.add(bladeSpine);
        // Pointed scythe tip curving down
        const bladeTip = mesh(new THREE.ConeGeometry(0.18, 0.9, 4), 0x90a4ae, -1.35, 2.7, 0, { metalness: 0.85, roughness: 0.2 });
        bladeTip.rotation.z = Math.PI - 0.45;
        g.add(bladeTip);
        // Blood edge on blade
        const bloodEdge = mesh(new THREE.BoxGeometry(1.4, 0.04, 0.09), 0xb71c1c, -0.65, 3.02, 0, { emissive: 0x4a0000 });
        bloodEdge.rotation.z = 0.25;
        g.add(bloodEdge);
        // Skull ornament at blade socket
        g.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), 0xe0e0e0, 0, 3.1, 0, { roughness: 0.5 }));
      } else if (kind === 'dynamite') {
        // Bom Bí Ngô Ma Quái (Carved Jack-o'-lantern Bomb)
        // Plump ribbed pumpkin body
        g.add(mesh(new THREE.SphereGeometry(0.85, 14, 10), 0xff6d00, 0, 1.0, 0, { roughness: 0.5, emissive: 0x441a00 }));
        // Glowing carved eyes
        g.add(mesh(new THREE.ConeGeometry(0.14, 0.1, 3), 0xffeb3b, -0.28, 1.15, 0.78, { emissive: 0xffaa00 }));
        g.add(mesh(new THREE.ConeGeometry(0.14, 0.1, 3), 0xffeb3b, 0.28, 1.15, 0.78, { emissive: 0xffaa00 }));
        // Jagged smile mouth
        g.add(mesh(new THREE.BoxGeometry(0.55, 0.12, 0.1), 0x212121, 0, 0.85, 0.8));
        // Green twisted stem
        const stem = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 6), 0x2e7d32, 0, 1.85, 0);
        stem.rotation.z = 0.2;
        g.add(stem);
        // Sizzling spark on top of fuse
        g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), 0xffd600, 0.08, 2.05, 0, { emissive: 0xff6f00, emissiveIntensity: 2 }));
      } else if (kind === 'song') {
        // Sách Phù Thủy Ma Thuật (Spooky Witch Grimoire)
        // Dark leather cover
        g.add(mesh(new THREE.BoxGeometry(1.4, 1.7, 0.3), 0x24112e, 0, 1.6, 0, { roughness: 0.7 }));
        // Glowing magic runes on cover
        g.add(mesh(new THREE.TorusGeometry(0.32, 0.04, 6, 16), 0x39ff14, 0, 1.6, 0.16, { emissive: 0x39ff14, emissiveIntensity: 1.5 }));
        // Golden corner brackets
        for (const [cx, cy] of [[-0.6, 2.3], [0.6, 2.3], [-0.6, 0.9], [0.6, 0.9]]) {
          g.add(mesh(new THREE.BoxGeometry(0.15, 0.15, 0.32), 0xffb300, cx, cy, 0, { metalness: 0.7 }));
        }
      } else if (kind === 'wheel') {
        // Bánh xe xương nguyền rủa (Cursed Bone Wheel)
        g.add(mesh(new THREE.TorusGeometry(0.78, 0.14, 10, 24), 0xded8ce, 0, 1.5, 0, { roughness: 0.8 }));
        g.add(mesh(new THREE.SphereGeometry(0.25, 10, 8), 0xe8e4dc, 0, 1.5, 0));
        g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), 0x111111, -0.09, 1.54, 0.22));
        g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), 0x111111, 0.09, 1.54, 0.22));
        for (let i = 0; i < 6; i++) {
          const spoke = mesh(new THREE.CylinderGeometry(0.045, 0.04, 1.35, 6), 0xd0cbc2, 0, 1.5, 0);
          spoke.rotation.z = (i / 6) * Math.PI;
          g.add(spoke);
        }
        g.add(mesh(new THREE.TorusGeometry(0.85, 0.03, 6, 20), 0x9c27b0, 0, 1.5, 0, { emissive: 0x9c27b0, emissiveIntensity: 1 }));
      } else {
        // Trứng Linh Hồn Ma Thuật (Phantom Soul / Spooky Witch Egg)
        buildSparklingEgg(g, {
          egg: 0x1f2e24,
          eggEmissive: 0x00e676,
          ring: 0x9c27b0,
          ringEmissive: 0x7b1fa2,
          band: 0x00e676,
          sparkle: 0x69f0ae,
          sparkleEmissive: 0x00e676,
        });
      }
    } else {
      if (kind === 'pitchfork') {
        // Long wooden pole
        g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), 0x8b5a2b, 0, 1.5, 0));
        // Crossbar
        g.add(mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), 0xb0b0b0, 0, 3, 0, { metalness: 0.6, roughness: 0.3 }));
        // 3 metal prongs
        for (const x of [-0.4, 0, 0.4]) {
          g.add(mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), 0xd0d0d0, x, 3.4, 0, { metalness: 0.6, roughness: 0.3 }));
        }
      } else if (kind === 'dynamite') {
        // 3 sticks of red dynamite
        for (const [x, z] of [[-0.25, 0], [0.25, 0], [0, 0.3]]) {
          g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 10), 0xd62d20, x, 1.2, z));
        }
        // Black strapping band
        g.add(mesh(new THREE.BoxGeometry(0.9, 0.15, 0.75), 0x3a2a1a, 0, 1.2, 0.1));
        // Fuse cord
        g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), 0x222222, 0, 2.2, 0));
      } else if (kind === 'song') {
        // Sheet music parchment ("Beasts of England")
        g.add(mesh(new THREE.BoxGeometry(1.4, 1.8, 0.05), 0xf2ead7, 0, 1.6, 0));
        // 4 staff lines
        for (let i = 0; i < 4; i++) {
          g.add(mesh(new THREE.BoxGeometry(1.1, 0.03, 0.06), 0x222222, 0, 1.1 + i * 0.3, 0.03));
        }
        // Notehead + stem
        g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), 0x111111, -0.2, 1.3, 0.06));
        g.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), 0x111111, -0.06, 1.6, 0.06));
      } else if (kind === 'wheel') {
        // Classic Oak Wagon Wheel
        g.add(mesh(new THREE.TorusGeometry(0.75, 0.14, 10, 24), 0x6d4c41, 0, 1.5, 0, { roughness: 0.85 }));
        g.add(mesh(new THREE.TorusGeometry(0.78, 0.04, 8, 24), 0x37474f, 0, 1.5, 0, { metalness: 0.7, roughness: 0.4 }));
        g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 12), 0x263238, 0, 1.5, 0, { metalness: 0.6, roughness: 0.4 }));
        for (let i = 0; i < 6; i++) {
          const spoke = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), 0x8d6e63, 0, 1.5, 0);
          spoke.rotation.z = (i / 6) * Math.PI;
          g.add(spoke);
        }
        g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), 0xffb300, 0, 1.5, 0.16, { metalness: 0.8, roughness: 0.25 }));
      } else {
        // Quả Trứng Lấp Lánh Hoàng Kim (Sparkling Golden Egg)
        buildSparklingEgg(g, {
          egg: 0xfff9c4,
          eggEmissive: 0xffd54f,
          ring: 0xffea00,
          ringEmissive: 0xffb300,
          band: 0xffd700,
          sparkle: 0xffffff,
          sparkleEmissive: 0xffea00,
        });
      }
    }

    // Glowing circular ring on the ground underneath (rose-pink for 20/10, orange for halloween, gold for classic)
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.5, 24),
      new THREE.MeshBasicMaterial({
        color: theme === 'women_day' ? 0xff4081 : theme === 'halloween' ? 0xff6d00 : 0xe8b641,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.08;
    g.add(glow);

    return g;
  }

  sync(list: ToolWire[]): void {
    const live = new Set<number>();
    for (const [id, kind, x, z] of list) {
      live.add(id);
      if (!this.toolObjs.has(id)) {
        const group = this.buildTool(kind);
        group.position.set(x, 0, z);
        this.group.add(group);
        this.toolObjs.set(id, { group, kind, x, z, seed: Math.random() * 6 });
      }
    }
    for (const [id, o] of this.toolObjs) {
      if (!live.has(id)) {
        this.group.remove(o.group);
        o.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
        this.toolObjs.delete(id);
      }
    }
  }

  update(now: number): void {
    const colRed = new THREE.Color(0xff1744);
    const colPink = new THREE.Color(0xff4081);
    const cycle = (Math.sin(now * 0.003) + 1) * 0.5;
    const currentHeartColor = new THREE.Color().lerpColors(colRed, colPink, cycle);
    const heartbeatScale = 1.0 + 0.12 * Math.pow(Math.max(0, Math.sin(now * 0.006)), 3);

    for (const o of this.toolObjs.values()) {
      o.group.rotation.y = now / 600 + o.seed;
      o.group.position.y = 0.3 + Math.sin(now / 300 + o.seed) * 0.25;

      if (o.kind === 'heart') {
        const body = o.group.getObjectByName('heartBodyMesh') as THREE.Mesh | undefined;
        if (body && body.material instanceof THREE.MeshStandardMaterial) {
          body.material.color.copy(currentHeartColor);
          body.material.emissive.copy(currentHeartColor);
          body.material.emissiveIntensity = 0.5 + 0.35 * Math.sin(now * 0.006);
          body.scale.set(heartbeatScale, heartbeatScale, heartbeatScale);
        }
        const halo = o.group.getObjectByName('heartHaloRing') as THREE.Mesh | undefined;
        if (halo) {
          halo.rotation.z = now * 0.002;
        }
        for (let i = 0; i < 6; i++) {
          const sp = o.group.getObjectByName(`heartSparkle_${i}`) as THREE.Mesh | undefined;
          if (sp) {
            const a = (i / 6) * Math.PI * 2 + now * 0.002;
            sp.position.x = Math.cos(a) * 1.15;
            sp.position.z = Math.sin(a) * 1.15;
            sp.position.y = 1.5 + Math.sin(a * 2 + now * 0.004) * 0.3;
            sp.rotation.y = a;
          }
        }
      }
    }
  }

  clear(): void {
    for (const o of this.toolObjs.values()) {
      this.group.remove(o.group);
      o.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.toolObjs.clear();
  }

  setTransitionScale(sc: number): void {
    this.group.scale.set(sc, sc, sc);
    this.group.position.y = - (1 - sc) * 4.0;
  }
}
