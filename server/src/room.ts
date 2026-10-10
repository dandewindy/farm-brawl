import { DurableObject } from 'cloudflare:workers';
import { World } from '@shared/sim/world';
import { TICK_MS, SKIN_COUNT } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';

const GRACE_PERIOD_MS = 8000;

export class GameRoom extends DurableObject {
  private readonly world: World;
  private readonly sockets = new Map<WebSocket, number>();
  private readonly playerTokens = new Map<number, string>();
  private readonly disconnectedPlayers = new Map<string, { playerId: number; disconnectTime: number }>();
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTickTime = 0;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.world = new World();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomParam = url.searchParams.get('room') || 'pub-1';
    const isPrivate = roomParam.startsWith('priv-') || roomParam.startsWith('friend-');
    const isTeam = roomParam.startsWith('team-') || roomParam === 'team-1' || roomParam === 'team-sea-1';
    if (isPrivate || isTeam) {
      this.world.botsEnabled = false;
      for (const [id, p] of this.world.players.entries()) {
        if (p.bot) this.world.removePlayer(id);
      }
    }

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
          room: roomParam,
          isPrivate,
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
        this.sockets.delete(ws);
        const token = this.playerTokens.get(playerId);
        const player = this.world.players.get(playerId);
        if (token && player) {
          // Keep player in world during grace period, but stop their motion
          this.world.setInput(playerId, { a: 0, mv: false, btn: false });
          this.disconnectedPlayers.set(token, {
            playerId,
            disconnectTime: performance.now(),
          });
        } else {
          this.world.removePlayer(playerId);
          if (token) this.playerTokens.delete(playerId);
        }
      }
      if (this.sockets.size === 0 && this.disconnectedPlayers.size === 0) {
        this.stopLoop();
      }
    };

    ws.addEventListener('close', onCloseOrError);
    ws.addEventListener('error', onCloseOrError);
  }

  private onMessage(ws: WebSocket, msg: ClientMsg): void {
    if (msg.t === 'join') {
      let playerId = this.sockets.get(ws);
      let sessionToken = msg.token;

      // Check if reconnecting within grace period with an existing session token
      if (sessionToken && this.disconnectedPlayers.has(sessionToken)) {
        const entry = this.disconnectedPlayers.get(sessionToken)!;
        this.disconnectedPlayers.delete(sessionToken);
        const existingPlayer = this.world.players.get(entry.playerId);
        if (existingPlayer) {
          playerId = entry.playerId;
          this.sockets.set(ws, playerId);
          // If the player died while disconnected, respawn them
          if (!existingPlayer.alive) {
            this.world.respawn(playerId, msg.name, msg.species, msg.skin, msg.team);
          }
        }
      }

      if (!playerId) {
        // Brand new player or grace period expired
        sessionToken = crypto.randomUUID();
        playerId = this.world.addPlayer(msg.name, msg.species, false, msg.team, msg.skin);
        this.sockets.set(ws, playerId);
        this.playerTokens.set(playerId, sessionToken);
      } else {
        if (!this.playerTokens.has(playerId)) {
          if (!sessionToken) sessionToken = crypto.randomUUID();
          this.playerTokens.set(playerId, sessionToken);
        } else {
          sessionToken = this.playerTokens.get(playerId)!;
        }
        const existingPlayer = this.world.players.get(playerId);
        if (existingPlayer) {
          if (!existingPlayer.alive) {
            this.world.respawn(playerId, msg.name, msg.species, msg.skin, msg.team);
          } else {
            if (msg.name) existingPlayer.name = msg.name.slice(0, 16);
            if (msg.species) existingPlayer.species = msg.species;
            if (msg.skin !== undefined) existingPlayer.skin = msg.skin % SKIN_COUNT;
            if (msg.team !== undefined) existingPlayer.team = msg.team;
          }
        }
      }

      // Send initial world configuration & map
      const initMsg: ServerMsg = this.world.init();
      ws.send(JSON.stringify(initMsg));

      // Send joined confirmation with session token
      const joinedMsg: ServerMsg = { t: 'joined', id: playerId, token: sessionToken };
      ws.send(JSON.stringify(joinedMsg));

      this.startLoop();
    } else if (msg.t === 'input') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.setInput(playerId, { a: msg.a, mv: msg.mv, btn: msg.btn });
      }
    } else if (msg.t === 'ping') {
      ws.send(`{"t":"pong","c":${msg.c}}`);
    } else if (msg.t === 'rule') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.chooseRule(playerId, msg.id);
      }
    }
  }

  private startLoop(): void {
    if (this.loopTimer !== null) return;
    this.nextTickTime = performance.now();
    this.scheduleNextTick();
  }

  private stopLoop(): void {
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private scheduleNextTick(): void {
    if (this.sockets.size === 0 && this.disconnectedPlayers.size === 0) {
      this.stopLoop();
      return;
    }
    const now = performance.now();
    this.nextTickTime += TICK_MS;
    if (now - this.nextTickTime > TICK_MS * 2) {
      this.nextTickTime = now + TICK_MS;
    }
    const delay = Math.max(0, Math.round(this.nextTickTime - now));
    this.loopTimer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, delay);
  }

  private tick(): void {
    // Clean up expired disconnected sessions
    if (this.disconnectedPlayers.size > 0) {
      const now = performance.now();
      for (const [token, entry] of this.disconnectedPlayers.entries()) {
        if (now - entry.disconnectTime > GRACE_PERIOD_MS) {
          this.disconnectedPlayers.delete(token);
          this.playerTokens.delete(entry.playerId);
          this.world.removePlayer(entry.playerId);
        }
      }
    }

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
