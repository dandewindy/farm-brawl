import * as THREE from 'three';
import type { ToolKind, ToolWire } from '@shared/protocol';

interface ToolObject {
  group: THREE.Group;
  kind: ToolKind;
  x: number;
  z: number;
  seed: number;
}

export class ToolRenderer {
  private readonly toolObjs = new Map<number, ToolObject>();
  private readonly group = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  private buildTool(kind: ToolKind): THREE.Group {
    const g = new THREE.Group();

    const mesh = (
      geo: THREE.BufferGeometry,
      color: number,
      x = 0,
      y = 0,
      z = 0,
      opts?: Partial<THREE.MeshStandardMaterialParameters>
    ) => {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...opts })
      );
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

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

    // Glowing gold circular ring on the ground underneath
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xe8b641,
        transparent: true,
        opacity: 0.7,
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
