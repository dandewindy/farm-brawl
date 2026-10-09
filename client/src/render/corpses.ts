import * as THREE from 'three';
import { radiusOf } from '@shared/constants';
import type { MapData } from '@shared/map';
import type { DeathCause, GameEvent, PlayerMeta } from '@shared/protocol';
import { buildCorpseAnimal } from './animals';
import type { FoodAndParticleRenderer } from './food';

interface CorpseItem {
  group: THREE.Group;
  cause: DeathCause | 'burn' | 'jones' | 'beaten';
  born: number;
  sc: number;
  x: number;
  z: number;
  target: [number, number] | null;
  charred: boolean;
  fx: number;
}

const charMat = new THREE.MeshStandardMaterial({
  color: 0x1b1612,
  roughness: 1,
  flatShading: true,
});

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function nearestOf(list: [number, number, number][] | undefined, x: number, z: number): [number, number] | null {
  if (!list || list.length === 0) return null;
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  for (const h of list) {
    const d = Math.hypot(h[0] - x, h[1] - z);
    if (d < bestDist) {
      bestDist = d;
      best = [h[0], h[1]];
    }
  }
  return best;
}

export class CorpseRenderer {
  private readonly corpses: CorpseItem[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private mapData?: MapData
  ) {}

  setMap(map: MapData): void {
    this.mapData = map;
  }

  spawn(ev: Extract<GameEvent, { k: 'die' }>, meta?: PlayerMeta): void {
    if (!meta) return;
    // When drowning, the animal has already sunk completely underwater; do not pop back up!
    if (ev.cause === 'drown') return;
    const isKing = false; // King crown/regalia
    const { group } = buildCorpseAnimal(meta.species, meta.skin, isKing, meta.team);

    const sc = radiusOf(ev.mass) * 1.35;
    group.position.set(ev.x, 0, ev.z);
    group.scale.setScalar(sc);

    const cause = ev.cause;
    let target: [number, number] | null = null;
    if (cause === 'well') {
      target = nearestOf(this.mapData?.well, ev.x, ev.z);
    } else if (cause === 'fire') {
      target = nearestOf(this.mapData?.fire, ev.x, ev.z);
    }

    this.scene.add(group);
    this.corpses.push({
      group,
      cause,
      born: performance.now(),
      sc,
      x: ev.x,
      z: ev.z,
      target,
      charred: false,
      fx: 0,
    });
  }

  private charify(c: CorpseItem): void {
    c.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = charMat;
      }
    });
    c.charred = true;
  }

  update(now: number, dt: number, parts?: FoodAndParticleRenderer): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      const a = (now - c.born) / 1000;
      const g = c.group;
      let done = false;
      c.fx -= dt;

      if (c.cause === 'fence') {
        // Electrocuted: violent jitter and visibility flicker, then charred & smoking
        if (a < 0.6) {
          g.position.set(c.x + rand(-0.15, 0.15), rand(0, 0.2), c.z + rand(-0.15, 0.15));
          g.visible = Math.floor(now / 45) % 2 === 0;
          if (c.fx <= 0) {
            c.fx = 0.05;
            parts?.burst(c.x, c.sc * 1.2, c.z, 0xfff35c, 4, 6, 6, 0.3);
          }
        } else {
          g.visible = true;
          if (!c.charred) this.charify(c);
          if (c.fx <= 0) {
            c.fx = 0.08;
            parts?.puff(c.x + rand(-0.5, 0.5), c.sc * 1.4, c.z + rand(-0.5, 0.5), 0x444444, 1.2, 1);
          }
        }
        if (a > 1.0) {
          g.scale.setScalar(c.sc * Math.max(0.01, 1 - (a - 1) / 0.3));
        }
        done = a > 1.3;
      } else if (c.cause === 'drown') {
        // Sinks into deep water with a final wobble and trail of bubbles
        g.position.y = -a * 2.2;
        g.rotation.z = Math.sin(a * 8) * 0.3;
        if (c.fx <= 0) {
          c.fx = 0.06;
          parts?.puff(c.x + rand(-0.8, 0.8), 0.1, c.z + rand(-0.8, 0.8), 0xdff1ff, 0.8, 0.8, 3);
        }
        done = a > 1.3;
      } else if (c.cause === 'well') {
        // Slides to hole, rapidly spins and drops down out of sight
        const [wx, wz] = c.target || [c.x, c.z];
        const k = Math.min(1, a / 0.25);
        g.position.set(c.x + (wx - c.x) * k, 0.9 - Math.max(0, a - 0.2) * 6, c.z + (wz - c.z) * k);
        g.rotation.y += dt * 10;
        g.scale.setScalar(c.sc * Math.max(0.05, 1 - a * 0.9));
        done = a > 0.9;
      } else if (c.cause === 'fire') {
        // Pulled into incinerator flames, blackened to charcoal, crumbles to ash
        const [fx, fz] = c.target || [c.x, c.z];
        const k = Math.min(1, a / 0.2) * 0.7;
        g.position.set(c.x + (fx - c.x) * k, 0.4, c.z + (fz - c.z) * k);
        if (a > 0.15 && !c.charred) this.charify(c);
        if (c.fx <= 0) {
          c.fx = 0.03;
          parts?.puff(
            g.position.x + rand(-0.6, 0.6),
            0.8 + rand(0, 1),
            g.position.z + rand(-0.6, 0.6),
            Math.random() < 0.6 ? 0xff7a1a : 0xffd23f,
            1.1,
            0.6,
            4
          );
          if (Math.random() < 0.3) {
            parts?.puff(g.position.x, 2, g.position.z, 0x3a3a3a, 1.5, 1.2, 2);
          }
        }
        g.scale.set(c.sc, c.sc * Math.max(0.05, 1 - a * 0.7), c.sc);
        done = a > 1.4;
      } else {
        done = true;
      }

      if (done) {
        this.scene.remove(g);
        g.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((m) => m.dispose());
            } else if (mesh.material !== charMat) {
              mesh.material?.dispose();
            }
          }
        });
        this.corpses.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const c of this.corpses) {
      this.scene.remove(c.group);
    }
    this.corpses.length = 0;
  }
}
