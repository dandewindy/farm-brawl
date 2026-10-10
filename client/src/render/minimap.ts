import { CFG } from '@shared/constants';
import type { MapData } from '@shared/map';
import type { ToolWire } from '@shared/protocol';
import type { Ent } from '../game/state';

export class MinimapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private bgCanvas: HTMLCanvasElement | null = null;
  private lastMapRef: MapData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.size = canvas.width;
  }

  private renderStaticBg(map: MapData): void {
    if (!this.bgCanvas) {
      this.bgCanvas = document.createElement('canvas');
      this.bgCanvas.width = this.size;
      this.bgCanvas.height = this.size;
    }
    const bCtx = this.bgCanvas.getContext('2d')!;
    const size = this.size;
    const center = size / 2;
    const scale = (center - 8) / CFG.R;

    bCtx.clearRect(0, 0, size, size);

    // Arena circular background
    bCtx.beginPath();
    bCtx.arc(center, center, center - 6, 0, Math.PI * 2);
    bCtx.fillStyle = 'rgba(40, 32, 26, 0.75)';
    bCtx.fill();

    // Electric fence perimeter
    bCtx.beginPath();
    bCtx.arc(center, center, CFG.R * scale, 0, Math.PI * 2);
    bCtx.strokeStyle = '#e8b641';
    bCtx.lineWidth = 2.5;
    bCtx.stroke();

    // Hazards: Ponds (blue)
    bCtx.fillStyle = '#3a8fd4';
    for (const [px, pz, pr] of map.pond) {
      bCtx.beginPath();
      bCtx.arc(center + px * scale, center + pz * scale, Math.max(2, pr * scale), 0, Math.PI * 2);
      bCtx.fill();
    }

    // Hazards: Mud (brown)
    bCtx.fillStyle = '#6e4627';
    for (const [mx, mz, mr] of map.mud) {
      bCtx.beginPath();
      bCtx.arc(center + mx * scale, center + mz * scale, Math.max(2, mr * scale), 0, Math.PI * 2);
      bCtx.fill();
    }

    // Hazards: Wells / Pits (dark void)
    bCtx.fillStyle = '#0f0c0a';
    for (const [wx, wz, wr] of (map.well || [])) {
      bCtx.beginPath();
      bCtx.arc(center + wx * scale, center + wz * scale, Math.max(2, wr * scale * 1.2), 0, Math.PI * 2);
      bCtx.fill();
    }

    // Hazards: Fire pits (orange / red)
    bCtx.fillStyle = '#ff5511';
    for (const [fx, fz, fr] of (map.fire || [])) {
      bCtx.beginPath();
      bCtx.arc(center + fx * scale, center + fz * scale, Math.max(2, fr * scale), 0, Math.PI * 2);
      bCtx.fill();
    }

    // Podium (red carpet)
    bCtx.beginPath();
    bCtx.arc(center + map.podium[0] * scale, center + map.podium[1] * scale, CFG.PODIUM_R * scale, 0, Math.PI * 2);
    bCtx.fillStyle = '#a5281b';
    bCtx.fill();
  }

  draw(
    map: MapData | null,
    ents: Map<number, Ent>,
    myId: number,
    tools?: Map<number, ToolWire>,
    napoleonId = 0,
    food?: Map<number, { k: number; x: number; z: number }>,
    truck?: [number, number, number],
    podShieldActive = false
  ): void {
    const { ctx, size } = this;
    const center = size / 2;
    const scale = (center - 8) / CFG.R;

    ctx.clearRect(0, 0, size, size);

    if (map) {
      if (map !== this.lastMapRef || !this.bgCanvas) {
        this.lastMapRef = map;
        this.renderStaticBg(map);
      }
      ctx.drawImage(this.bgCanvas!, 0, 0);
    } else {
      return;
    }

    // Protective energy barrier indicator on minimap
    if (podShieldActive) {
      ctx.beginPath();
      ctx.arc(center + map.podium[0] * scale, center + map.podium[1] * scale, (CFG.PODIUM_R + 1.2) * scale, 0, Math.PI * 2);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Rainbow Candy (flashing rainbow beacon on minimap)
    if (food) {
      for (const f of food.values()) {
        if (f.k === 6) {
          const fx = center + f.x * scale;
          const fz = center + f.z * scale;
          const hue = (performance.now() / 400) % 1;
          ctx.beginPath();
          ctx.arc(fx, fz, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${Math.round(hue * 360)}, 100%, 55%)`;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }
      }
    }

    // Bonus tools / weapons (gold squares like original game)
    if (tools) {
      ctx.fillStyle = '#e8b641';
      for (const t of tools.values()) {
        const tx = center + t[2] * scale;
        const tz = center + t[3] * scale;
        ctx.fillRect(tx - 3, tz - 3, 6, 6);
      }
    }

    // Other Animals
    for (const e of ents.values()) {
      if (e.id === myId) continue;
      const ex = center + e.x * scale;
      const ez = center + e.z * scale;
      const isNap = e.id === napoleonId && napoleonId > 0;
      ctx.beginPath();
      ctx.arc(ex, ez, isNap ? 4.5 : Math.max(2.5, Math.sqrt(e.mass) * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = isNap ? '#e8b641' : '#f2ead7';
      ctx.fill();
    }

    // My Animal (bright red with white ring)
    const me = ents.get(myId);
    if (me) {
      const mx = center + me.x * scale;
      const mz = center + me.z * scale;
      ctx.beginPath();
      ctx.arc(mx, mz, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3b30';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Farmer Till's tractor (sweeping hazard)
    if (truck) {
      const tx = center + truck[0] * scale;
      const tz = center + truck[1] * scale;
      ctx.save();
      ctx.translate(tx, tz);
      ctx.rotate(-truck[2]);
      ctx.fillStyle = '#ff3d00';
      ctx.fillRect(-7, -4.5, 14, 9);
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-7, -4.5, 14, 9);
      ctx.restore();
    }
  }
}
