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
  team?: number;
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
  DROWNING: 64,
  SONG: 128,
  PITCHFORK: 256,
  DYNAMITE: 512,
  TRAITOR: 1024,
  SUPER: 32768,
  FLYING: 65536,
} as const;

export type DeathCause = 'fence' | 'drown' | 'well' | 'fire';

export type ToolKind = 'pitchfork' | 'dynamite' | 'song';
export type ToolWire = [id: number, kind: ToolKind, x: number, z: number];

export type HofRow = [name: string, species: Species, dur: number];

export interface ChoiceWire {
  options: string[];
  left: number;
}

export type GameEvent =
  | ({ k: 'join' } & PlayerMeta)
  | { k: 'leave'; id: number }
  | { k: 'hit'; a: number; v: number; x: number; z: number; s: number; loss?: number }
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
  | { k: 'rule'; id: string }
  | { k: 'tool'; id: number; kind: ToolKind; x: number; z: number }
  | { k: 'song'; id: number; nap: number }
  | { k: 'boom'; id: number; x: number; z: number }
  | { k: 'superFood'; x: number; z: number }
  | { k: 'super'; id: number }
  | { k: 'fly'; id: number; x: number; z: number };

/** [id, name, mass, kills, reign?] */
export type LeaderRow = [id: number, name: string, mass: number, kills: number, reign?: number];

export interface Snapshot {
  t: 's';
  tick: number;
  p: PlayerWire[];
  /** food added this tick */
  fa: FoodWire[];
  /** food removed this tick */
  fr: number[];
  ev: GameEvent[];
  /** bonus tools on the ground: [id, kind, x, z] */
  tl?: ToolWire[];
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
  me?: { kills: number; cd: number; rank: number; choice?: ChoiceWire | null };
}

export type ServerMsg =
  | { t: 'init'; cfg: Cfg; map: MapData; players: PlayerMeta[]; food: FoodWire[]; tick: number; tools?: ToolWire[] }
  | { t: 'joined'; id: number }
  | { t: 'pong'; c: number }
  | Snapshot;

export type ClientMsg =
  | { t: 'join'; name: string; species: Species; skin?: number }
  | { t: 'ping'; c: number }
  | { t: 'rule'; id: string }
  | ({ t: 'input' } & Input);
