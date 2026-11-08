import * as THREE from 'three';
import type { CowboyThemeId } from './cowboyTypes';

/**
 * Procedural Canvas Textures for Cowboy Arcade Minigame
 * Produces seamless, lightweight, AAA stylized textures for ground, meadow, wood, and props
 * with zero external asset loading and deterministic PRNG.
 */

function createPRNG(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function wrapDraw(
  size: number,
  x: number,
  y: number,
  r: number,
  fn: (px: number, py: number) => void
): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      if (x + dx > -r && x + dx < size + r && y + dy > -r && y + dy < size + r) {
        fn(x + dx, y + dy);
      }
    }
  }
}

function makeCanvasTexture(
  width: number,
  height: number,
  repeatX: number,
  repeatY: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([130, 86, 51, 255]);
    const dt = new THREE.DataTexture(data, 1, 1);
    dt.needsUpdate = true;
    return dt;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      const data = new Uint8Array([130, 86, 51, 255]);
      return new THREE.DataTexture(data, 1, 1);
    }
    draw(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = 4;
    return texture;
  } catch {
    const data = new Uint8Array([130, 86, 51, 255]);
    return new THREE.DataTexture(data, 1, 1);
  }
}

// Module-level caches
const trackTextureCache: Partial<Record<CowboyThemeId, THREE.Texture>> = {};
let meadowTextureCache: THREE.Texture | null = null;
let woodTextureCache: THREE.Texture | null = null;
let barnTextureCache: THREE.Texture | null = null;

/**
 * 1. Farm Loam / Prairie Red Dirt / Snowy Track Texture
 */
export function getCowboyTrackTexture(theme: CowboyThemeId): THREE.Texture {
  if (trackTextureCache[theme]) {
    return trackTextureCache[theme]!;
  }

  const texture = makeCanvasTexture(512, 512, 10, 6, (ctx, S) => {
    const rand = createPRNG(theme === 'prairie' ? 88219 : theme === 'ice' ? 44102 : 19482);

    if (theme === 'prairie') {
      // --- PRAIRIE: Sunbaked Terracotta & Canyon Sandstone ---
      ctx.fillStyle = '#b34d28';
      ctx.fillRect(0, 0, S, S);

      // Warm dusty organic mottling
      for (let i = 0; i < 220; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const rx = 16 + rand() * 32;
        const ry = 8 + rand() * 18;
        const col = rand() < 0.5 ? 'rgba(215, 110, 65, 0.12)' : 'rgba(135, 45, 18, 0.10)';
        wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Wind-swept desert sand ripples with periodic boundary matching
      ctx.strokeStyle = 'rgba(235, 140, 90, 0.14)';
      ctx.lineWidth = 2.5;
      for (let y = 16; y < S; y += 32) {
        ctx.beginPath();
        for (let x = 0; x <= S; x += 16) {
          const dy = Math.sin((x / S) * Math.PI * 4) * 4.5;
          if (x === 0) ctx.moveTo(0, y + dy);
          else ctx.lineTo(x, y + dy);
        }
        ctx.stroke();
      }

      // Desert gravel & sandstone chips (sample color outside wrapDraw for identical wrapped copies)
      for (let i = 0; i < 110; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const r = 1.2 + rand() * 2.2;
        const col = rand() < 0.6 ? '#d47448' : '#7c2810';

        wrapDraw(S, x, y, r * 2, (px, py) => {
          ctx.fillStyle = 'rgba(60, 20, 8, 0.25)';
          ctx.beginPath();
          ctx.ellipse(px + 1, py + 1.2, r * 1.1, r * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    } else if (theme === 'ice') {
      // --- ICE: Crisp Powder Snow & Glacial Glints ---
      ctx.fillStyle = '#e8f2f9';
      ctx.fillRect(0, 0, S, S);

      // Soft pale blue ambient drifts
      for (let i = 0; i < 180; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const rx = 18 + rand() * 36;
        const ry = 10 + rand() * 22;
        const col = rand() < 0.5 ? 'rgba(180, 215, 238, 0.15)' : 'rgba(255, 255, 255, 0.25)';
        wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Sleigh runner tracks spanning seamlessly from x=0 to x=S
      ctx.strokeStyle = 'rgba(160, 200, 225, 0.22)';
      ctx.lineWidth = 3.2;
      for (const ty of [120, 160, 360, 400]) {
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(S, ty);
        ctx.stroke();
      }

      // Sparkling ice crystals
      for (let i = 0; i < 80; i++) {
        const x = rand() * S;
        const y = rand() * S;
        wrapDraw(S, x, y, 4, (px, py) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px, py, 2.0, 2.0);
          ctx.fillStyle = 'rgba(130, 220, 255, 0.5)';
          ctx.fillRect(px - 1, py, 4.0, 1.0);
          ctx.fillRect(px, py - 1, 1.0, 4.0);
        });
      }
    } else {
      // --- FARM: Warm Earthy Loam, Cart Wheel Ruts, Pebbles & Straw ---
      ctx.fillStyle = '#825633';
      ctx.fillRect(0, 0, S, S);

      // Organic soil tone variations
      for (let i = 0; i < 240; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const rx = 15 + rand() * 30;
        const ry = 9 + rand() * 20;
        const col = rand() < 0.5 ? 'rgba(150, 102, 62, 0.13)' : 'rgba(88, 55, 30, 0.12)';
        wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Subtle wagon wheel tracks with periodic sine wave matching at x=0 and x=S
      ctx.strokeStyle = 'rgba(64, 40, 22, 0.16)';
      ctx.lineWidth = 5.0;
      for (const trackY of [110, 170, 340, 400]) {
        ctx.beginPath();
        for (let x = 0; x <= S; x += 16) {
          const dy = Math.sin((x / S) * Math.PI * 2) * 3.0;
          if (x === 0) ctx.moveTo(0, trackY + dy);
          else ctx.lineTo(x, trackY + dy);
        }
        ctx.stroke();
      }

      // Embedded river pebbles & stones
      const stoneColors = ['#9e9e9e', '#757575', '#a1887f', '#d7ccc8', '#4e342e'];
      for (let i = 0; i < 140; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const r = 1.3 + rand() * 2.2;
        const col = stoneColors[Math.floor(rand() * stoneColors.length)];

        wrapDraw(S, x, y, r * 2.5, (px, py) => {
          ctx.fillStyle = 'rgba(40, 25, 15, 0.28)';
          ctx.beginPath();
          ctx.ellipse(px + 1.0, py + 1.2, r * 1.15, r * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.beginPath();
          ctx.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Scattered golden straw / dry hay bits
      ctx.strokeStyle = '#deb841';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 55; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const len = 6 + rand() * 7;
        const ang = rand() * Math.PI;
        wrapDraw(S, x, y, len, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
          ctx.stroke();
        });
      }
    }
  });

  trackTextureCache[theme] = texture;
  return texture;
}

/**
 * 2. Lush Country Meadow Pasture Grass with Daisies & Clovers
 */
export function getCowboyMeadowTexture(): THREE.Texture {
  if (meadowTextureCache) {
    return meadowTextureCache;
  }

  const texture = makeCanvasTexture(512, 512, 14, 7, (ctx, S) => {
    const rand = createPRNG(92371);

    // Deep pasture emerald green base
    ctx.fillStyle = '#4a9c3d';
    ctx.fillRect(0, 0, S, S);

    // Multi-tone lush foliage variations
    for (let i = 0; i < 200; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const rx = 16 + rand() * 28;
      const ry = 10 + rand() * 18;
      const col = rand() < 0.5 ? 'rgba(118, 196, 74, 0.14)' : 'rgba(46, 110, 36, 0.12)';
      wrapDraw(S, x, y, Math.max(rx, ry), (px, py) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Stylized 3-blade grass tufts
    const tuftCount = 130;
    for (let i = 0; i < tuftCount; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const h = 5.5 + rand() * 6.5;
      const w = 1.4 + rand() * 0.9;
      const tilt = (rand() - 0.5) * 0.35;

      wrapDraw(S, x, y, h + 4, (px, py) => {
        ctx.fillStyle = 'rgba(25, 60, 18, 0.22)';
        ctx.beginPath();
        ctx.ellipse(px, py + 1, w * 1.3, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#8bd44a';
        ctx.beginPath();
        ctx.moveTo(px - w * 0.35, py + 1);
        ctx.lineTo(px + w * 0.35, py + 1);
        ctx.lineTo(px + tilt * h, py - h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#5ba829';
        ctx.beginPath();
        ctx.moveTo(px - w * 0.5, py + 1);
        ctx.lineTo(px, py + 1);
        ctx.lineTo(px - w * 1.2 + tilt * h * 0.3, py - h * 0.7);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#73c636';
        ctx.beginPath();
        ctx.moveTo(px, py + 1);
        ctx.lineTo(px + w * 0.5, py + 1);
        ctx.lineTo(px + w * 1.2 + tilt * h * 0.3, py - h * 0.72);
        ctx.closePath();
        ctx.fill();
      });
    }

    // Wild white daisies with gold center
    for (let i = 0; i < 28; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 1.8 + rand() * 0.9;

      wrapDraw(S, x, y, r * 3, (px, py) => {
        ctx.fillStyle = '#ffffff';
        for (let p = 0; p < 5; p++) {
          const ang = (p * (Math.PI * 2)) / 5;
          const petX = px + Math.cos(ang) * (r * 1.15);
          const petY = py + Math.sin(ang) * (r * 1.15);
          ctx.beginPath();
          ctx.arc(petX, petY, r * 0.65, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = '#ffb300';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Gentle clovers (3 green lobes)
    for (let i = 0; i < 22; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 2.0 + rand() * 0.8;
      wrapDraw(S, x, y, r * 2.5, (px, py) => {
        ctx.fillStyle = '#2e7d32';
        for (let l = 0; l < 3; l++) {
          const ang = (l * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(px + Math.cos(ang) * r, py + Math.sin(ang) * r, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  });

  meadowTextureCache = texture;
  return texture;
}

/**
 * 3. Rustic Weathered Wood Grain Texture for Fence, Gates & Windmill
 */
export function getCowboyWoodTexture(): THREE.Texture {
  if (woodTextureCache) {
    return woodTextureCache;
  }

  const texture = makeCanvasTexture(256, 256, 2, 8, (ctx, S) => {
    const rand = createPRNG(61842);

    ctx.fillStyle = '#6d4829';
    ctx.fillRect(0, 0, S, S);

    // Longitudinal fine wood grain lines with vertical wrap handling
    for (let i = 0; i < 90; i++) {
      const y = rand() * S;
      const h = 1.0 + rand() * 2.0;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(64, 40, 20, 0.22)' : 'rgba(138, 96, 58, 0.20)';
      ctx.fillRect(0, y, S, h);
      if (y + h > S) {
        ctx.fillRect(0, y - S, S, h);
      }
    }

    // Rustic wood knots
    for (let k = 0; k < 5; k++) {
      const kx = rand() * S;
      const ky = rand() * S;
      const kr = 6 + rand() * 8;
      wrapDraw(S, kx, ky, kr * 2, (px, py) => {
        ctx.strokeStyle = 'rgba(45, 26, 12, 0.35)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(px, py, kr * 1.5, kr * 0.6, 0.1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#3e2311';
        ctx.beginPath();
        ctx.ellipse(px, py, kr * 0.6, kr * 0.3, 0.1, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  woodTextureCache = texture;
  return texture;
}

/**
 * 4. Classic American Barn Red Plank Siding Texture
 */
export function getCowboyBarnTexture(): THREE.Texture {
  if (barnTextureCache) {
    return barnTextureCache;
  }

  const texture = makeCanvasTexture(256, 256, 4, 2, (ctx, S) => {
    ctx.fillStyle = '#9e2a2b';
    ctx.fillRect(0, 0, S, S);

    for (let x = 0; x < S; x += 32) {
      ctx.fillStyle = '#5c1617';
      ctx.fillRect(x, 0, 2.5, S);

      ctx.fillStyle = 'rgba(215, 75, 76, 0.35)';
      ctx.fillRect(x + 2.5, 0, 1.2, S);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (let y = 0; y < S; y += 12) {
      ctx.fillRect(0, y, S, 2);
    }
  });

  barnTextureCache = texture;
  return texture;
}
