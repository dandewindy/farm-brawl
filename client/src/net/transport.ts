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
  readonly colo?: string;
  inGame?: boolean;
  forceReconnect?(): void;
  triggerHotMigration?(): void;
  onMigrationSuccess?: (newColo: string) => void;
}

export type Handler = (m: ServerMsg) => void;

/** runs the authoritative World inside the page at the real tick rate */
export class LocalServer implements Transport {
  public readonly rtt = 0;
  public readonly rttMin = 0;
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
      const me = this.world.players.get(this.myId);
      if (me) this.world.respawn(this.myId, m.name, m.species, m.skin, m.team);
      else this.myId = this.world.addPlayer(m.name, m.species, false, m.team, m.skin);
      this.onMsg({ t: 'joined', id: this.myId });
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
