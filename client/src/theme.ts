// Arena theme management: Classic Farm or Vietnamese Women's Day 20/10 Edition
export type ArenaTheme = 'classic' | 'women_day';

let currentTheme: ArenaTheme = (localStorage.getItem('fb_arena_theme') as ArenaTheme) || 'classic';
const listeners = new Set<(theme: ArenaTheme) => void>();

export function getArenaTheme(): ArenaTheme {
  return currentTheme;
}

export function setArenaTheme(theme: ArenaTheme): void {
  currentTheme = theme;
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
