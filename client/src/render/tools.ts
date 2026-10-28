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
      } else {
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
      } else {
        // Sách Phù Thủy Ma Thuật (Spooky Witch Grimoire)
        // Dark leather cover
        g.add(mesh(new THREE.BoxGeometry(1.4, 1.7, 0.3), 0x24112e, 0, 1.6, 0, { roughness: 0.7 }));
        // Glowing magic runes on cover
        g.add(mesh(new THREE.TorusGeometry(0.32, 0.04, 6, 16), 0x39ff14, 0, 1.6, 0.16, { emissive: 0x39ff14, emissiveIntensity: 1.5 }));
        // Golden corner brackets
        for (const [cx, cy] of [[-0.6, 2.3], [0.6, 2.3], [-0.6, 0.9], [0.6, 0.9]]) {
          g.add(mesh(new THREE.BoxGeometry(0.15, 0.15, 0.32), 0xffb300, cx, cy, 0, { metalness: 0.7 }));
        }
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
      } else {
        // Sheet music parchment ("Beasts of England")
        g.add(mesh(new THREE.BoxGeometry(1.4, 1.8, 0.05), 0xf2ead7, 0, 1.6, 0));
        // 4 staff lines
        for (let i = 0; i < 4; i++) {
          g.add(mesh(new THREE.BoxGeometry(1.1, 0.03, 0.06), 0x222222, 0, 1.1 + i * 0.3, 0.03));
        }
        // Notehead + stem
        g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), 0x111111, -0.2, 1.3, 0.06));
        g.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), 0x111111, -0.06, 1.6, 0.06));
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
    for (const o of this.toolObjs.values()) {
      o.group.rotation.y = now / 600 + o.seed;
      o.group.position.y = 0.3 + Math.sin(now / 300 + o.seed) * 0.25;
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
}
