import { DurableObject } from 'cloudflare:workers';
import { World } from '@shared/sim/world';
import { TICK_MS } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';

export class GameRoom extends DurableObject {
  private readonly world: World;
  private readonly sockets = new Map<WebSocket, number>();
  private loopInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.world = new World();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.handleWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (url.pathname === '/info') {
      return new Response(
        JSON.stringify({
          players: this.sockets.size,
          bots: this.world.players.size - this.sockets.size,
          tick: this.world.tick,
          king: this.world.napoleonId,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(ws: WebSocket): void {
    ws.accept();

    ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const msg = JSON.parse(raw) as ClientMsg;
        this.onMessage(ws, msg);
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });

    const onCloseOrError = () => {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.removePlayer(playerId);
        this.sockets.delete(ws);
      }
      if (this.sockets.size === 0) {
        this.stopLoop();
      }
    };

    ws.addEventListener('close', onCloseOrError);
    ws.addEventListener('error', onCloseOrError);
  }

  private onMessage(ws: WebSocket, msg: ClientMsg): void {
    if (msg.t === 'join') {
      let playerId = this.sockets.get(ws);
      if (!playerId) {
        playerId = this.world.addPlayer(msg.name, msg.species, false);
        this.sockets.set(ws, playerId);
      } else {
        this.world.respawn(playerId, msg.name, msg.species);
      }

      // Send initial world configuration & map
      const initMsg: ServerMsg = this.world.init();
      ws.send(JSON.stringify(initMsg));

      // Send joined confirmation
      const joinedMsg: ServerMsg = { t: 'joined', id: playerId };
      ws.send(JSON.stringify(joinedMsg));

      this.startLoop();
    } else if (msg.t === 'input') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.setInput(playerId, { a: msg.a, mv: msg.mv, btn: msg.btn });
      }
    } else if (msg.t === 'ping') {
      const pongMsg: ServerMsg = { t: 'pong', c: msg.c };
      ws.send(JSON.stringify(pongMsg));
    } else if (msg.t === 'rule') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.chooseRule(playerId, msg.id);
      }
    }
  }

  private startLoop(): void {
    if (this.loopInterval !== null) return;
    this.loopInterval = setInterval(() => this.tick(), TICK_MS);
  }

  private stopLoop(): void {
    if (this.loopInterval !== null) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
  }

  private tick(): void {
    this.world.step();

    // Broadcast authoritative snapshot to all human players
    for (const [ws, playerId] of this.sockets.entries()) {
      try {
        const snap = this.world.snapshotFor(playerId);
        ws.send(JSON.stringify(snap));
      } catch {
        // Socket error handled in close event listener
      }
    }

    this.world.flush();
  }
}
