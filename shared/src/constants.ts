// Tunables shared by the server simulation and the client (prediction, HUD, rendering).
// Keep this file free of DOM / Node / Workers APIs: it runs everywhere.

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;
/** physics substeps per tick, so fast dashes don't tunnel through each other */
export const SUBSTEPS = 2;

export const CFG = {
  /** radius of the electric fence (expanded 50% from 70m to 105m) */
  R: 105,
  PODIUM_R: 7,
  START_MASS: 20,
  MIN_MASS: 10,
  MAX_MASS: Infinity,

  MOVE_SPEED: 13,
  MOVE_ACCEL: 28,

  DASH_SPEED: 34,
  DASH_TIME: 0.22,
  DASH_CD: 1,
  /** extra cooldown after a charged ram */
  PLOW_CD: 0.4,
  /** button held shorter than this = a plain dash on release */
  CHARGE_MIN: 0.2,
  /** full charge */
  CHARGE_MAX: 1.2,
  /** charging only slows you down after this long, so quick taps feel instant */
  CHARGE_SLOW_AFTER: 0.12,

  CAPTURE_TIME: 4,
  TRACTOR_R: 5.2,
  SUNDAY_PULL: 7,
  SUNDAY_TEAM: 0.6,
  SUNDAY_RING: 2,
  POD_WARN: 1,
  SUPER_FLY_SPEED: 62,
  SUPER_FLY_TIME: 0.55,

  STUN_TIME: 1.5,
  DROWN_TIME: 1.5,
  /** closing speed a dash needs to count as a hit */
  HIT_MIN_SPEED: 8,
  KNOCKBACK: 1.15,
  KNOCKBACK_MIN: 6,
  KNOCKBACK_MAX: 60,
  /** fraction of the victim's mass knocked loose (as food) per hit */
  HIT_LOSS: 0.06,
  /** fraction of the victim's mass the killer receives directly */
  KILL_SPOILS: 0.25,
  /** fraction of the victim's mass scattered as food on death */
  DEATH_DROP: 0.45,
  /** seconds a hit still earns the kill if the victim dies afterwards */
  CREDIT_TIME: 4,

  FOOD_TARGET: 260,
  FOOD_SPAWN_PER_TICK: 4,
  /** total special items/tools maintained on map (20 items for optimal map density) */
  TOOL_TARGET: 20,
  /** above this, mass slowly melts so giants don't stay forever */
  DECAY_START: 120,
  DECAY_RATE: 0.001,

  /** keep at least this many animals in a room (bots fill the gap) */
  BOT_FILL: 10,
  BOT_RESPAWN: 3,
  MAX_PLAYERS: 24,
} as const;
export type Cfg = typeof CFG;

/** body radius from mass (kg) with progressively diminishing scaling above 3000kg */
export const radiusOf = (m: number): number => {
  if (m <= 3000) return 1 + Math.sqrt(m) * 0.09;
  const r3000 = 1 + Math.sqrt(3000) * 0.09;
  const extraKg = m - 3000;
  // Progressively diminishing logarithmic growth above 3000kg
  return r3000 + Math.log1p(extraKg / 1200) * 0.42;
};

export const SPECIES = [
  'chicken', 'sheep', 'horse', 'cow', 'duck', 'pig', 'dog', 'elephant', 'monkey',
  'gorilla', 'mammoth', 'wolf',
  'phoenix', 'swan', 'ram', 'boar', 'pegasus', 'bull',
] as const;
export type Species = (typeof SPECIES)[number];

export const EVOLVED_PAIRS: Record<string, Species> = {
  monkey: 'gorilla',
  elephant: 'mammoth',
  dog: 'wolf',
  chicken: 'phoenix',
  duck: 'swan',
  sheep: 'ram',
  pig: 'boar',
  horse: 'pegasus',
  cow: 'bull',
};

export const DEVOLVED_PAIRS: Record<string, Species> = {
  gorilla: 'monkey',
  mammoth: 'elephant',
  wolf: 'dog',
  phoenix: 'chicken',
  swan: 'duck',
  ram: 'sheep',
  boar: 'pig',
  pegasus: 'horse',
  bull: 'cow',
};

export const EVOLVED_SPECIES = new Set<Species>([
  'gorilla', 'mammoth', 'wolf',
  'phoenix', 'swan', 'ram', 'boar', 'pegasus', 'bull',
]);

export function isEvolvedSpecies(s: Species): boolean {
  return EVOLVED_SPECIES.has(s);
}

export interface SpeciesTraits {
  /** walking speed multiplier */
  speed: number;
  /** dash speed multiplier */
  dash: number;
  /** effective mass multiplier when being knocked back */
  weight: number;
  /** speed multiplier in ponds */
  water: number;
  /** speed multiplier in mud */
  mud: number;
  /** ram knockback power multiplier */
  ram: number;
}

export const TRAITS: Record<Species, SpeciesTraits> = {
  chicken: { speed: 1.0, dash: 1.30, weight: 0.9, water: 0.45, mud: 0.45, ram: 1.0 },
  sheep: { speed: 0.97, dash: 1.0, weight: 1.15, water: 0.45, mud: 0.45, ram: 1.3 },
  horse: { speed: 1.08, dash: 1.0, weight: 1.0, water: 0.45, mud: 0.45, ram: 1.0 },
  cow: { speed: 0.95, dash: 0.97, weight: 1.25, water: 0.45, mud: 0.45, ram: 1.0 },
  duck: { speed: 0.88, dash: 1.0, weight: 0.95, water: 1.25, mud: 0.45, ram: 1.0 },
  pig: { speed: 1.0, dash: 1.0, weight: 1.05, water: 0.45, mud: 1.1, ram: 1.0 },
  dog: { speed: 1.08, dash: 1.0, weight: 1.0, water: 0.35, mud: 0.45, ram: 1.0 },
  elephant: { speed: 0.92, dash: 0.95, weight: 1.4, water: 0.45, mud: 0.45, ram: 1.5 },
  monkey: { speed: 1.05, dash: 1.0, weight: 0.95, water: 0.45, mud: 0.50, ram: 1.0 },
  gorilla: { speed: 1.02, dash: 1.15, weight: 1.5, water: 0.45, mud: 0.50, ram: 1.4 },
  mammoth: { speed: 0.95, dash: 1.0, weight: 1.6, water: 0.45, mud: 0.45, ram: 1.6 },
  wolf: { speed: 1.30, dash: 1.15, weight: 1.45, water: 0.35, mud: 0.50, ram: 1.45 },
  phoenix: { speed: 1.15, dash: 1.40, weight: 1.10, water: 0.50, mud: 0.50, ram: 1.25 },
  swan: { speed: 0.98, dash: 1.15, weight: 1.35, water: 1.45, mud: 0.50, ram: 1.30 },
  ram: { speed: 1.05, dash: 1.20, weight: 1.55, water: 0.45, mud: 0.45, ram: 1.65 },
  boar: { speed: 1.10, dash: 1.20, weight: 1.50, water: 0.45, mud: 1.35, ram: 1.45 },
  pegasus: { speed: 1.32, dash: 1.25, weight: 1.35, water: 0.85, mud: 0.85, ram: 1.35 },
  bull: { speed: 1.05, dash: 1.15, weight: 1.70, water: 0.45, mud: 0.45, ram: 1.65 },
};

export const SKIN_COUNT = 4;

/** food kinds: 0 corn, 1 apple, 2 golden corn, 3 carrot, 4 pumpkin, 5 turnip, 6 rainbow candy, 7 watermelon, 8 giant flower, 9 giant pumpkin */
export const FOOD_KG = [1, 2.5, 6, 1.6, 7, 2.5, 3, 11, 11, 15] as const;
/** spawn weights for each food kind */
export const FOOD_WEIGHT = [47, 17, 3, 23, 5, 0, 0, 5, 0, 0] as const;
export type FoodKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Easter egg prefix check:
 * Names starting with "Monkey" / "Money" / "Khỉ" / "Khi" get 100% monkey on random selection.
 * Names starting with "Elephant" / "Voi" get 100% elephant on random selection.
 */
export function getEasterEggSpeciesFromName(name: string): Species | null {
  if (!name) return null;
  let clean = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Also strip common clan tags in brackets, parentheses, or emojis at start: e.g. "[VN] Khỉ", "(VN) Voi", "👑 Khỉ"
  clean = clean.replace(/^(\[[^\]]*\]|\([^)]*\)|<[^>]*>|[\s\p{P}\p{S}]+)/u, '').trim();

  // Names containing "Cho" / "Chó" / "Dog" / "Cún" get 100% dog on random selection
  if (clean.includes('cho') || clean.includes('dog') || clean.includes('cun')) {
    return 'dog';
  }

  if (
    clean.startsWith('monkey') || clean.startsWith('money') || clean.startsWith('khi')
  ) {
    return 'monkey';
  }
  if (
    clean.startsWith('elephant') || clean.startsWith('voi')
  ) {
    return 'elephant';
  }
  return null;
}

/**
 * Roll a random species for a player name, taking into account secret easter egg prefixes.
 */
export function pickRandomSpecies(name: string, rnd = Math.random): Species {
  const egg = getEasterEggSpeciesFromName(name);
  if (egg) return egg;

  const roll = rnd();
  if (roll < 0.10) {
    return 'elephant';
  } else if (roll < 0.20) {
    return 'monkey';
  } else if (roll < 0.45) {
    return 'dog';
  } else {
    const normalSpecies: Species[] = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig'];
    return normalSpecies[Math.floor(rnd() * normalSpecies.length)];
  }
}


