import * as THREE from 'three';
import type { ArenaTheme } from '../theme';

export interface ArenaGroundTextures {
  arena: THREE.CanvasTexture;
  outer: THREE.CanvasTexture;
}

function createPRNG(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
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

function makeCanvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D, size: number) => void,
  repeatCount: number
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatCount, repeatCount);
  t.anisotropy = 4;
  return t;
}

/**
 * Theme 1: Classic Farm Pasture Grass (🌿 Nông trại xanh - Mặc định)
 * Clean, smooth single-tone pasture, subtle grass tufts, sparse tiny daisies
 */
function drawClassicGrass(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 45678 : 12345);

  // Clean uniform single-color base (không có các sọc màu đậm nhạt xen kẽ)
  g.fillStyle = isOuter ? '#6aa84f' : '#8ccf5e';
  g.fillRect(0, 0, S, S);

  // Subtle organic micro-tone variations (very low opacity, completely smooth)
  for (let i = 0; i < 180; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 12 + rand() * 22;
    const ry = 8 + rand() * 16;
    const col = rand() < 0.5 ? 'rgba(175, 235, 110, 0.05)' : 'rgba(85, 145, 50, 0.04)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // Gentle, neat 3D grass tufts (búi cỏ gọn gàng, thanh thoát)
  const tuftCount = isOuter ? 90 : 130;
  for (let i = 0; i < tuftCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 6 + rand() * 7;
    const w = 1.6 + rand() * 1.0;
    const tilt = (rand() - 0.5) * 0.4;

    wrapDraw(S, x, y, h + 3, (px, py) => {
      // Soft base shadow
      g.fillStyle = 'rgba(40, 75, 20, 0.2)';
      g.beginPath();
      g.ellipse(px, py + 1, w * 1.2, 1.5, 0, 0, Math.PI * 2);
      g.fill();

      // Center blade
      g.fillStyle = '#a6ea66';
      g.beginPath();
      g.moveTo(px - w * 0.35, py + 1);
      g.lineTo(px + w * 0.35, py + 1);
      g.lineTo(px + tilt * h, py - h);
      g.closePath();
      g.fill();

      // Left blade
      g.fillStyle = '#6ab832';
      g.beginPath();
      g.moveTo(px - w * 0.5, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.2 + tilt * h * 0.3, py - h * 0.68);
      g.closePath();
      g.fill();

      // Right blade
      g.fillStyle = '#86d042';
      g.beginPath();
      g.moveTo(px, py + 1);
      g.lineTo(px + w * 0.5, py + 1);
      g.lineTo(px + w * 1.2 + tilt * h * 0.3, py - h * 0.7);
      g.closePath();
      g.fill();
    });
  }

  // Sparse, tiny daisies (giảm số lượng và thu nhỏ kích thước hoa)
  const daisyCount = isOuter ? 6 : 14;
  for (let i = 0; i < daisyCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 1.6 + rand() * 0.8; // Hoa nhỏ li ti

    wrapDraw(S, x, y, r * 3, (px, py) => {
      // 5 tiny petals
      g.fillStyle = '#ffffff';
      for (let p = 0; p < 5; p++) {
        const ang = (p * (Math.PI * 2)) / 5;
        const petX = px + Math.cos(ang) * (r * 1.15);
        const petY = py + Math.sin(ang) * (r * 1.15);
        g.beginPath();
        g.arc(petX, petY, r * 0.65, 0, Math.PI * 2);
        g.fill();
      }

      // Yellow core
      g.fillStyle = '#ffc400';
      g.beginPath();
      g.arc(px, py, r * 0.55, 0, Math.PI * 2);
      g.fill();
    });
  }
}

/**
 * Theme 2: Vietnamese Women's Day Blossom Meadow (🌸 Phụ Nữ VN 20/10)
 * Clean pastel pink meadow, gentle shoots, sparse tiny sakura petals
 */
function drawWomenDayMeadow(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 20109 : 20101);

  // Clean uniform pastel pink base (không có các sọc tối xen kẽ)
  g.fillStyle = isOuter ? '#db839d' : '#f5a3b7';
  g.fillRect(0, 0, S, S);

  // Subtle blush variation
  for (let i = 0; i < 180; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 12 + rand() * 22;
    const ry = 8 + rand() * 16;
    const col = rand() < 0.5 ? 'rgba(255, 225, 235, 0.06)' : 'rgba(215, 125, 150, 0.05)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // Gentle spring shoots
  const shootCount = isOuter ? 80 : 120;
  for (let i = 0; i < shootCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 5 + rand() * 6;
    const w = 1.4 + rand() * 0.9;
    const isMint = rand() < 0.3;
    const col1 = isMint ? '#a7f3d0' : '#ffe0ec';
    const col2 = isMint ? '#6ee7b7' : '#f494ba';

    wrapDraw(S, x, y, h + 3, (px, py) => {
      g.fillStyle = col1;
      g.beginPath();
      g.moveTo(px - w * 0.3, py + 1);
      g.lineTo(px + w * 0.3, py + 1);
      g.lineTo(px, py - h);
      g.closePath();
      g.fill();

      g.fillStyle = col2;
      g.beginPath();
      g.moveTo(px - w * 0.5, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.1, py - h * 0.65);
      g.closePath();
      g.fill();
    });
  }

  // Sparse, tiny petals (cánh hoa đào rơi rải rác nhỏ gọn)
  const petalCount = isOuter ? 8 : 18;
  for (let i = 0; i < petalCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const pr = 2.2 + rand() * 1.5;
    const ang = rand() * Math.PI * 2;
    const pCol = rand() < 0.5 ? '#ff6097' : '#ff94ba';

    wrapDraw(S, x, y, pr * 2, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(ang);

      g.fillStyle = pCol;
      g.beginPath();
      g.ellipse(0, 0, pr, pr * 0.5, 0, 0, Math.PI * 2);
      g.fill();

      g.restore();
    });
  }

  // Sparse tiny Sakura blossoms
  const sakuraCount = isOuter ? 4 : 10;
  for (let i = 0; i < sakuraCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 2.0 + rand() * 0.8;

    wrapDraw(S, x, y, r * 3, (px, py) => {
      g.fillStyle = '#ff4b87';
      for (let p = 0; p < 5; p++) {
        const ang = (p * (Math.PI * 2)) / 5;
        const petX = px + Math.cos(ang) * (r * 1.1);
        const petY = py + Math.sin(ang) * (r * 1.1);
        g.beginPath();
        g.arc(petX, petY, r * 0.65, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = '#ffca28';
      g.beginPath();
      g.arc(px, py, r * 0.45, 0, Math.PI * 2);
      g.fill();
    });
  }
}

/**
 * Theme 3: Spooky Halloween Mystic Graveyard Earth (🎃 Halloween 31/10)
 * Clean dark mystic earth, subtle withered grass, sparse tiny pumpkin leaves & sparkles
 */
function drawHalloweenGround(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 31109 : 31101);

  // Clean uniform dark earth base (không có các sọc tối xen kẽ)
  g.fillStyle = isOuter ? '#22181c' : '#34222a';
  g.fillRect(0, 0, S, S);

  // Subtle dark mottling
  for (let i = 0; i < 180; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 12 + rand() * 22;
    const ry = 8 + rand() * 16;
    const col = rand() < 0.5 ? 'rgba(18, 10, 16, 0.15)' : 'rgba(70, 42, 58, 0.08)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // Withered grass tufts
  const tuftCount = isOuter ? 75 : 110;
  for (let i = 0; i < tuftCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 6 + rand() * 7;
    const w = 1.3 + rand() * 0.9;
    const col = rand() < 0.5 ? '#6e4c75' : '#8c6340';

    wrapDraw(S, x, y, h + 3, (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(px - w * 0.3, py + 1);
      g.lineTo(px + w * 0.3, py + 1);
      g.lineTo(px, py - h);
      g.closePath();
      g.fill();

      g.beginPath();
      g.moveTo(px - w * 0.5, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.1, py - h * 0.65);
      g.closePath();
      g.fill();
    });
  }

  // Sparse tiny pumpkin orange leaves (lá phong cam nhỏ gọn)
  const leafCount = isOuter ? 6 : 15;
  for (let i = 0; i < leafCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const s = 2.6 + rand() * 1.6;
    const ang = rand() * Math.PI * 2;
    const lcol = rand() < 0.6 ? '#ff6600' : '#e64a00';

    wrapDraw(S, x, y, s * 2, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(ang);

      g.fillStyle = lcol;
      g.beginPath();
      g.moveTo(0, -s * 1.1);
      g.lineTo(-s * 0.4, -s * 0.3);
      g.lineTo(s * 0.4, -s * 0.3);
      g.closePath();
      g.fill();

      g.beginPath();
      g.arc(0, 0, s * 0.45, 0, Math.PI * 2);
      g.fill();

      g.restore();
    });
  }

  // Sparse tiny glowing sparkles
  const sparkCount = isOuter ? 6 : 14;
  for (let i = 0; i < sparkCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const sr = 1.3 + rand() * 0.9;
    const isGreen = rand() < 0.65;
    const glowCol = isGreen ? 'rgba(57, 255, 20, 0.55)' : 'rgba(217, 70, 239, 0.55)';

    wrapDraw(S, x, y, sr * 2, (px, py) => {
      g.fillStyle = glowCol;
      g.beginPath();
      g.arc(px, py, sr, 0, Math.PI * 2);
      g.fill();
    });
  }
}

/**
 * Creates and returns cached seamless textures for arena and outer field across all 3 themes
 */
export function createThemeGroundTextures(): Record<ArenaTheme, ArenaGroundTextures> {
  const ARENA_REPEAT = 24;  // 210m / 24 ≈ 8.75m per tile
  const OUTER_REPEAT = 114; // 1000m / 114 ≈ 8.77m per tile

  return {
    classic: {
      arena: makeCanvasTexture(512, (g, S) => drawClassicGrass(g, S, false), ARENA_REPEAT),
      outer: makeCanvasTexture(512, (g, S) => drawClassicGrass(g, S, true), OUTER_REPEAT),
    },
    women_day: {
      arena: makeCanvasTexture(512, (g, S) => drawWomenDayMeadow(g, S, false), ARENA_REPEAT),
      outer: makeCanvasTexture(512, (g, S) => drawWomenDayMeadow(g, S, true), OUTER_REPEAT),
    },
    halloween: {
      arena: makeCanvasTexture(512, (g, S) => drawHalloweenGround(g, S, false), ARENA_REPEAT),
      outer: makeCanvasTexture(512, (g, S) => drawHalloweenGround(g, S, true), OUTER_REPEAT),
    },
  };
}
