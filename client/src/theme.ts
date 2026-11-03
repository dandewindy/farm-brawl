// Arena theme management: Classic Farm, Vietnamese Women's Day (20/10), or Spooky Halloween (31/10)
export type ArenaTheme = 'classic' | 'women_day' | 'halloween';

let currentTheme: ArenaTheme = (localStorage.getItem('fb_arena_theme') as ArenaTheme) || 'classic';
const listeners = new Set<(theme: ArenaTheme) => void>();

function syncBodyThemeAttr(theme: ArenaTheme): void {
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.arenaTheme = theme;
  }
}

if (typeof document !== 'undefined') {
  if (document.body) {
    syncBodyThemeAttr(currentTheme);
  } else {
    document.addEventListener('DOMContentLoaded', () => syncBodyThemeAttr(currentTheme), { once: true });
  }
}

export function getArenaTheme(): ArenaTheme {
  return currentTheme;
}

export function setArenaTheme(theme: ArenaTheme): void {
  currentTheme = theme;
  syncBodyThemeAttr(theme);
  try {
    localStorage.setItem('fb_arena_theme', theme);
  } catch (_) {}
  for (const cb of listeners) {
    cb(theme);
  }
}

export function onThemeChange(cb: (theme: ArenaTheme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
