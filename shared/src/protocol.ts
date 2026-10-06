// Wire format between client and server. In phase 1 the "server" runs inside the page (LocalServer), but it already
// speaks exactly these messages, so phase 2 only has to swap the transport for a WebSocket.
import type { Cfg, FoodKind, Species } from './constants';
import type { MapData } from './map';

export interface Input {
  /** aim / walking direction, radians in the x-z plane */
  a: number;
  /** walking (false = coast to a stop) */
  mv: boolean;
  /** ram button held */
  btn: boolean;
}

export interface PlayerMeta {
  id: number;
  name: string;
  species: Species;
  skin: number;
  bot: boolean;
}

/** [id, x, z, kind, kg] */
export type FoodWire = [id: number, x: number, z: number, k: FoodKind, v: number];

/** [id, x, z, angle, mass, flags, charge 0..10] */
export type PlayerWire = [id: number, x: number, z: number, a: number, mass: number, flags: number, charge: number];

export const FLAG = {
  DASH: 1,
  PLOW: 2,
  CHARGING: 4,
  STUN: 8,
  WATER: 16,
  MUD: 32,
} as const;

export type DeathCause = 'fence' | 'drown' | 'well' | 'fire';

export type HofRow = [name: string, species: Species, dur: number];

export type GameEvent =
  | ({ k: 'join' } & PlayerMeta)
  | { k: 'leave'; id: number }
  | { k: 'hit'; a: number; v: number; x: number; z: number; s: number }
  | {
      k: 'die';
      id: number;
      by: number;
      cause: DeathCause;
      x: number;
      z: number;
      mass: number;
      best: number;
      kills: number;
      alive: number;
      spoils: number;
      streak: number;
    }
  | { k: 'napoleon'; id: number }
  | { k: 'rule'; id: string };

/** [id, name, mass, kills] */
export type LeaderRow = [id: number, name: string, mass: number, kills: number];

export interface Snapshot {
  t: 's';
  tick: number;
  p: PlayerWire[];
  /** food added this tick */
  fa: FoodWire[];
  /** food removed this tick */
  fr: number[];
  ev: GameEvent[];
  /** top 10, sent every few ticks */
  lb?: LeaderRow[];
  total?: number;
  /** podium capture state: [capId, progress 0..1, contested] */
  pod?: [number, number, boolean];
  /** current Napoleon / King id */
  nap?: number;
  /** active commandment rule */
  rule?: string;
  /** Napoleon reign in seconds */
  reign?: number;
  /** hall of fame top reigns */
  hof?: HofRow[];
  /** per-recipient extras */
  me?: { kills: number; cd: number; rank: number };
}

export type ServerMsg =
  | { t: 'init'; cfg: Cfg; map: MapData; players: PlayerMeta[]; food: FoodWire[]; tick: number }
  | { t: 'joined'; id: number }
  | { t: 'pong'; c: number }
  | Snapshot;

export type ClientMsg =
  | { t: 'join'; name: string; species: Species }
  | { t: 'ping'; c: number }
  | ({ t: 'input' } & Input);
