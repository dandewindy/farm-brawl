// How the client talks to a farm. Phase 1: LocalServer (simulation in this tab). Phase 2: a WebSocket to a
// Cloudflare Durable Object. Both deliver the same ServerMsg objects.
import { TICK_MS } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { World } from '@shared/sim/world';

export interface Transport {
  send(m: ClientMsg): void;
  close(): void;
  readonly rtt: number;
  readonly rttMin: number;
  readonly displayPing?: number;
  readonly netRtt?: number;
  readonly clockOffset?: number | null;
  readonly colo?: string;
  readonly doColo?: string;
  readonly displayColo?: string;
  inGame?: boolean;
  isMigrating?: boolean;
  sessionToken?: string | null;
  forceReconnect?(): void;
  triggerHotMigration?(): void;
  leaveGame?(): void;
  manualRetune?(): void;
  onMigrationSuccess?: (newColo: string) => void;
  onMigrationStatus?: (status: 'probing' | 'migrated' | 'failed', colo?: string) => void;
}

export type Handler = (m: ServerMsg) => void;

/** runs the authoritative World inside the page at the real tick rate */
export class LocalServer implements Transport {
  public readonly rtt = 0;
  public readonly rttMin = 0;
  public readonly displayPing = 0;
  public readonly netRtt = 0;
  public readonly clockOffset = 0;
  public readonly colo = 'LOCAL';
  private readonly world = new World();
  private myId = 0;
  private last = performance.now();
  private acc = 0;
  private readonly timer: number;

  constructor(private readonly onMsg: Handler) {
    queueMicrotask(() => this.onMsg(this.world.init()));
    this.timer = window.setInterval(() => this.pump(), TICK_MS / 2);
  }

  private pump(): void {
    const now = performance.now();
    this.acc = Math.min(this.acc + now - this.last, TICK_MS * 10); // don't fast-forward minutes after a hidden tab
    this.last = now;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.world.step();
      this.onMsg(this.world.snapshotFor(this.myId));
      this.world.flush();
    }
  }

  send(m: ClientMsg): void {
    if (m.t === 'join') {
      if (m.theme) {
        this.world.theme = m.theme;
      }
      if (m.team !== undefined) {
        this.world.mode = 'team';
        this.world.botsEnabled = false;
        for (const [id, p] of this.world.players.entries()) {
          if (p.bot) this.world.removePlayer(id);
        }
      }
      if (m.matchDuration !== undefined && this.world.matchDuration === 0) {
        this.world.matchDuration = m.matchDuration;
        this.world.matchClock = m.matchDuration;
      }
      const me = this.world.players.get(this.myId);
      if (me) this.world.respawn(this.myId, m.name, m.species, m.skin, m.team);
      else this.myId = this.world.addPlayer(m.name, m.species, false, m.team, m.skin);
      this.onMsg({ t: 'joined', id: this.myId });
    } else if (m.t === 'set_match_duration') {
      const dur = Math.max(0, Math.floor(m.duration || 0));
      this.world.matchDuration = dur;
      this.world.matchClock = dur;
      this.world.matchEnded = false;
      this.world.matchEndTimer = 0;
      this.onMsg({ t: 'match_duration', duration: dur });
    } else if (m.t === 'input') {
      this.world.setInput(this.myId, m);
    } else if (m.t === 'rule') {
      this.world.chooseRule(this.myId, m.id);
    }
  }

  close(): void {
    clearInterval(this.timer);
  }
}
