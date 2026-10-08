// Tunables shared by the server simulation and the client (prediction, HUD, rendering).
// Keep this file free of DOM / Node / Workers APIs: it runs everywhere.

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;
/** physics substeps per tick, so fast dashes don't tunnel through each other */
export const SUBSTEPS = 2;

export const CFG = {
  /** radius of the electric fence */
  R: 70,
  PODIUM_R: 7,
  START_MASS: 20,
  MIN_MASS: 10,
  MAX_MASS: 600,

  MOVE_SPEED: 13,
  MOVE_ACCEL: 7,

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

  STUN_TIME: 0.55,
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
  /** above this, mass slowly melts so giants don't stay forever */
  DECAY_START: 80,
  DECAY_RATE: 0.004,

  /** keep at least this many animals in a room (bots fill the gap) */
  BOT_FILL: 10,
  BOT_RESPAWN: 3,
  MAX_PLAYERS: 24,
} as const;
export type Cfg = typeof CFG;

/** body radius from mass (kg) */
export const radiusOf = (m: number): number => 1 + Math.sqrt(m) * 0.09;

export const SPECIES = ['chicken', 'sheep', 'horse', 'cow', 'duck', 'pig'] as const;
export type Species = (typeof SPECIES)[number];

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
}

export const TRAITS: Record<Species, SpeciesTraits> = {
  chicken: { speed: 1.0, dash: 1.12, weight: 0.9, water: 0.45, mud: 0.5 },
  sheep: { speed: 0.97, dash: 1.0, weight: 1.15, water: 0.45, mud: 0.5 },
  horse: { speed: 1.08, dash: 1.0, weight: 1.0, water: 0.45, mud: 0.5 },
  cow: { speed: 0.95, dash: 0.97, weight: 1.25, water: 0.45, mud: 0.5 },
  duck: { speed: 0.88, dash: 1.0, weight: 0.95, water: 1.25, mud: 0.5 },
  pig: { speed: 1.0, dash: 1.0, weight: 1.05, water: 0.45, mud: 1.1 },
};

export const SKIN_COUNT = 4;

/** food kinds: 0 corn, 1 apple, 2 golden corn, 3 carrot, 4 pumpkin, 5 turnip, 6 rainbow candy */
export const FOOD_KG = [1, 2.5, 6, 1.6, 7, 2.5, 3] as const;
/** spawn weights for each food kind */
export const FOOD_WEIGHT = [50, 18, 3, 24, 5, 0, 0] as const;
export type FoodKind = 0 | 1 | 2 | 3 | 4 | 5 | 6;
