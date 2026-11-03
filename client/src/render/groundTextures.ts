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
 * Lush cartoon grass tufts, lawn mower grooming stripes, charming daisies & clovers
 */
function drawClassicGrass(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 45678 : 12345);

  // Base background
  g.fillStyle = isOuter ? '#6aa84f' : '#8ccf5e';
  g.fillRect(0, 0, S, S);

  // 1. Subtle farm lawn stripes (8 vertical bands across 512px, seamless repeat)
  const stripeW = 64;
  for (let i = 0; i < S; i += stripeW) {
    g.fillStyle = (i / stripeW) % 2 === 0 ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.035)';
    g.fillRect(i, 0, stripeW, S);
  }

  // 2. Soft micro-patches of organic soil & grass shade
  for (let i = 0; i < 350; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 10 + rand() * 18;
    const ry = 6 + rand() * 14;
    const isLight = rand() < 0.5;
    const col = isLight ? 'rgba(185, 245, 115, 0.08)' : 'rgba(80, 140, 45, 0.07)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 3. Vibrant 3D cartoon grass blades (búi cỏ mềm mại)
  const tuftCount = isOuter ? 160 : 230;
  for (let i = 0; i < tuftCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 8 + rand() * 9;
    const w = 2.0 + rand() * 1.5;
    const tilt = (rand() - 0.5) * 0.5;

    wrapDraw(S, x, y, h + 5, (px, py) => {
      // Grass base contact shadow
      g.fillStyle = 'rgba(40, 75, 20, 0.32)';
      g.beginPath();
      g.ellipse(px, py + 1, w * 1.5, 2, 0, 0, Math.PI * 2);
      g.fill();

      // Center bright blade
      g.fillStyle = '#b4f073';
      g.beginPath();
      g.moveTo(px - w * 0.4, py + 1);
      g.lineTo(px + w * 0.4, py + 1);
      g.lineTo(px + tilt * h, py - h);
      g.closePath();
      g.fill();

      // Left blade
      g.fillStyle = '#6cb834';
      g.beginPath();
      g.moveTo(px - w * 0.6, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.4 + tilt * h * 0.4, py - h * 0.72);
      g.closePath();
      g.fill();

      // Right blade
      g.fillStyle = '#8ed849';
      g.beginPath();
      g.moveTo(px, py + 1);
      g.lineTo(px + w * 0.6, py + 1);
      g.lineTo(px + w * 1.4 + tilt * h * 0.4, py - h * 0.75);
      g.closePath();
      g.fill();
    });
  }

  // 4. White meadow daisies (hoa cúc trắng nhụy vàng)
  const daisyCount = isOuter ? 14 : 42;
  for (let i = 0; i < daisyCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 2.8 + rand() * 1.4;
    const isGold = rand() < 0.2;
    const petColor = isGold ? '#ffe066' : '#ffffff';
    const coreColor = isGold ? '#e69500' : '#ffc400';

    wrapDraw(S, x, y, r * 3, (px, py) => {
      // Little green leaf under flower
      g.fillStyle = 'rgba(75, 140, 35, 0.75)';
      g.beginPath();
      g.ellipse(px - r * 1.2, py + r * 0.2, r * 0.9, r * 0.45, -0.4, 0, Math.PI * 2);
      g.fill();

      // 5 petals
      g.fillStyle = petColor;
      for (let p = 0; p < 5; p++) {
        const ang = (p * (Math.PI * 2)) / 5;
        const petX = px + Math.cos(ang) * (r * 1.15);
        const petY = py + Math.sin(ang) * (r * 1.15);
        g.beginPath();
        g.arc(petX, petY, r * 0.7, 0, Math.PI * 2);
        g.fill();
      }

      // Golden center disc
      g.fillStyle = coreColor;
      g.beginPath();
      g.arc(px, py, r * 0.62, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 5. Clover patches (cỏ 3 lá)
  const cloverCount = isOuter ? 18 : 32;
  for (let i = 0; i < cloverCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const cr = 2.0 + rand() * 1.2;

    wrapDraw(S, x, y, cr * 3, (px, py) => {
      g.fillStyle = 'rgba(65, 125, 30, 0.7)';
      for (let c = 0; c < 3; c++) {
        const ang = (c * (Math.PI * 2)) / 3;
        const lx = px + Math.cos(ang) * cr;
        const ly = py + Math.sin(ang) * cr;
        g.beginPath();
        g.arc(lx, ly, cr * 0.7, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
}

/**
 * Theme 2: Vietnamese Women's Day Blossom Meadow (🌸 Phụ Nữ VN 20/10)
 * Romantic pastel rose lawn, sakura petals, 5-petal cherry blossoms & mint grass shoots
 */
function drawWomenDayMeadow(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 20109 : 20101);

  // Base background
  g.fillStyle = isOuter ? '#db839d' : '#f5a3b7';
  g.fillRect(0, 0, S, S);

  // 1. Soft petal wave stripes (8 vertical bands)
  const stripeW = 64;
  for (let i = 0; i < S; i += stripeW) {
    g.fillStyle = (i / stripeW) % 2 === 0 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(215, 80, 120, 0.035)';
    g.fillRect(i, 0, stripeW, S);
  }

  // 2. Pastel blush mottling
  for (let i = 0; i < 350; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 10 + rand() * 20;
    const ry = 6 + rand() * 15;
    const isLight = rand() < 0.55;
    const col = isLight ? 'rgba(255, 215, 228, 0.12)' : 'rgba(215, 125, 150, 0.1)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 3. Spring shoots & pastel grass tufts (hồng phấn và chồi non xanh ngọc mint)
  const shootCount = isOuter ? 140 : 200;
  for (let i = 0; i < shootCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 7 + rand() * 8;
    const w = 1.8 + rand() * 1.3;
    const isMint = rand() < 0.35;
    const col1 = isMint ? '#a7f3d0' : '#ffe0ec';
    const col2 = isMint ? '#6ee7b7' : '#f494ba';

    wrapDraw(S, x, y, h + 4, (px, py) => {
      g.fillStyle = 'rgba(150, 75, 100, 0.22)';
      g.beginPath();
      g.ellipse(px, py + 1, w * 1.4, 1.8, 0, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = col1;
      g.beginPath();
      g.moveTo(px - w * 0.4, py + 1);
      g.lineTo(px + w * 0.4, py + 1);
      g.lineTo(px, py - h);
      g.closePath();
      g.fill();

      g.fillStyle = col2;
      g.beginPath();
      g.moveTo(px - w * 0.6, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.3, py - h * 0.7);
      g.closePath();
      g.fill();

      g.beginPath();
      g.moveTo(px, py + 1);
      g.lineTo(px + w * 0.6, py + 1);
      g.lineTo(px + w * 1.3, py - h * 0.72);
      g.closePath();
      g.fill();
    });
  }

  // 4. Fallen cherry blossom petals (cánh hoa anh đào rơi)
  const petalCount = isOuter ? 35 : 85;
  for (let i = 0; i < petalCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const pr = 3.6 + rand() * 2.8;
    const ang = rand() * Math.PI * 2;
    const pCol = rand() < 0.5 ? '#ff6097' : '#ff94ba';

    wrapDraw(S, x, y, pr * 2, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(ang);

      g.fillStyle = pCol;
      g.beginPath();
      g.ellipse(0, 0, pr, pr * 0.52, 0, 0, Math.PI * 2);
      g.fill();

      // Soft light reflection on petal
      g.fillStyle = 'rgba(255, 255, 255, 0.45)';
      g.beginPath();
      g.ellipse(-pr * 0.25, -pr * 0.1, pr * 0.45, pr * 0.22, 0, 0, Math.PI * 2);
      g.fill();

      g.restore();
    });
  }

  // 5. Blooming 5-petal Sakura Flowers (hoa anh đào nở rộ)
  const sakuraCount = isOuter ? 16 : 48;
  for (let i = 0; i < sakuraCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 3.2 + rand() * 1.6;

    wrapDraw(S, x, y, r * 3, (px, py) => {
      // 5 rounded pink petals
      g.fillStyle = '#ff4b87';
      for (let p = 0; p < 5; p++) {
        const ang = (p * (Math.PI * 2)) / 5;
        const petX = px + Math.cos(ang) * (r * 1.18);
        const petY = py + Math.sin(ang) * (r * 1.18);
        g.beginPath();
        g.arc(petX, petY, r * 0.72, 0, Math.PI * 2);
        g.fill();
      }

      // White-pink heart center
      g.fillStyle = '#fff2f7';
      g.beginPath();
      g.arc(px, py, r * 0.56, 0, Math.PI * 2);
      g.fill();

      // Golden pistil
      g.fillStyle = '#ffca28';
      g.beginPath();
      g.arc(px, py, r * 0.3, 0, Math.PI * 2);
      g.fill();
    });
  }
}

/**
 * Theme 3: Spooky Halloween Mystic Graveyard Earth (🎃 Halloween 31/10)
 * Mystic dark soil, eerie withered purple grass, pumpkin orange maple leaves & glowing ecto sparks
 */
function drawHalloweenGround(g: CanvasRenderingContext2D, S: number, isOuter: boolean): void {
  const rand = createPRNG(isOuter ? 31109 : 31101);

  // Base background
  g.fillStyle = isOuter ? '#22181c' : '#34222a';
  g.fillRect(0, 0, S, S);

  // 1. Dark eerie earth stripes (8 vertical bands)
  const stripeW = 64;
  for (let i = 0; i < S; i += stripeW) {
    g.fillStyle = (i / stripeW) % 2 === 0 ? 'rgba(0, 0, 0, 0.12)' : 'rgba(75, 45, 65, 0.07)';
    g.fillRect(i, 0, stripeW, S);
  }

  // 2. Earth mottling / dark mystic patches
  for (let i = 0; i < 350; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 10 + rand() * 20;
    const ry = 6 + rand() * 15;
    const isDark = rand() < 0.6;
    const col = isDark ? 'rgba(15, 8, 14, 0.28)' : 'rgba(75, 45, 62, 0.16)';
    wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 3. Spooky withered grass tufts (cỏ khô úa đêm trăng)
  const tuftCount = isOuter ? 130 : 190;
  for (let i = 0; i < tuftCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const h = 8 + rand() * 9;
    const w = 1.6 + rand() * 1.4;
    const tilt = (rand() - 0.5) * 0.6;
    const col1 = rand() < 0.5 ? '#6e4c75' : '#8c6340';
    const col2 = rand() < 0.5 ? '#55395c' : '#6d4c30';

    wrapDraw(S, x, y, h + 4, (px, py) => {
      g.fillStyle = 'rgba(12, 6, 10, 0.45)';
      g.beginPath();
      g.ellipse(px, py + 1, w * 1.3, 1.8, 0, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = col1;
      g.beginPath();
      g.moveTo(px - w * 0.35, py + 1);
      g.lineTo(px + w * 0.35, py + 1);
      g.lineTo(px + tilt * h, py - h);
      g.closePath();
      g.fill();

      g.fillStyle = col2;
      g.beginPath();
      g.moveTo(px - w * 0.5, py + 1);
      g.lineTo(px, py + 1);
      g.lineTo(px - w * 1.3 + tilt * h * 0.4, py - h * 0.68);
      g.closePath();
      g.fill();

      g.beginPath();
      g.moveTo(px, py + 1);
      g.lineTo(px + w * 0.5, py + 1);
      g.lineTo(px + w * 1.3 + tilt * h * 0.4, py - h * 0.7);
      g.closePath();
      g.fill();
    });
  }

  // 4. Autumn Pumpkin Maple Leaves (lá phong cam bí ngô rực lửa)
  const leafCount = isOuter ? 25 : 68;
  for (let i = 0; i < leafCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const s = 4.2 + rand() * 3.2;
    const ang = rand() * Math.PI * 2;
    const lcol = rand() < 0.6 ? '#ff6600' : '#e64a00';

    wrapDraw(S, x, y, s * 2.5, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(ang);

      g.fillStyle = lcol;
      // 3 pointed maple lobes
      g.beginPath();
      g.moveTo(0, -s * 1.25);
      g.lineTo(-s * 0.45, -s * 0.35);
      g.lineTo(s * 0.45, -s * 0.35);
      g.closePath();
      g.fill();

      g.beginPath();
      g.moveTo(-s * 1.15, -s * 0.4);
      g.lineTo(-s * 0.2, 0);
      g.lineTo(-s * 0.35, -s * 0.85);
      g.closePath();
      g.fill();

      g.beginPath();
      g.moveTo(s * 1.15, -s * 0.4);
      g.lineTo(s * 0.2, 0);
      g.lineTo(s * 0.35, -s * 0.85);
      g.closePath();
      g.fill();

      // Leaf center disc
      g.beginPath();
      g.arc(0, 0, s * 0.48, 0, Math.PI * 2);
      g.fill();

      // Leaf stem
      g.strokeStyle = '#992d00';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, s * 0.6);
      g.stroke();

      g.restore();
    });
  }

  // 5. Mystic Glowing Green & Violet Ecto-Sparks (rêu & đốm dạ quang phép thuật)
  const sparkCount = isOuter ? 18 : 45;
  for (let i = 0; i < sparkCount; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const sr = 1.8 + rand() * 1.6;
    const isGreen = rand() < 0.65;
    const glowCol = isGreen ? 'rgba(57, 255, 20, 0.65)' : 'rgba(217, 70, 239, 0.65)';
    const coreCol = isGreen ? '#c8ffb4' : '#f5d2ff';

    wrapDraw(S, x, y, sr * 3, (px, py) => {
      g.fillStyle = glowCol;
      g.beginPath();
      g.arc(px, py, sr * 1.8, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = coreCol;
      g.beginPath();
      g.arc(px, py, sr * 0.65, 0, Math.PI * 2);
      g.fill();
    });
  }
}

/**
 * Creates and returns cached seamless textures for arena and outer field across all 3 themes
 */
export function createThemeGroundTextures(): Record<ArenaTheme, ArenaGroundTextures> {
  const ARENA_REPEAT = 24;  // 210m / 24 ≈ 8.75m per tile
  const OUTER_REPEAT = 114; // 1000m / 114 ≈ 8.77m per tile (matches world scale!)

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
