import { DurableObject } from 'cloudflare:workers';
import { World } from '@shared/sim/world';
import { TICK_MS, SKIN_COUNT } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';

const GRACE_PERIOD_MS = 8000;

export class GameRoom extends DurableObject {
  private readonly world: World;
  private readonly sockets = new Map<WebSocket, number>();
  private readonly allSockets = new Set<WebSocket>();
  private readonly lobbyTeams = new Map<WebSocket, number>();
  private readonly clientSockets = new Map<string, WebSocket>();
  private readonly socketClientIds = new Map<WebSocket, string>();
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
    const isTeam = roomParam.startsWith('team-') || roomParam === 'team-1' || roomParam === 'team-sea-1' || roomParam.includes('team');
    if (isPrivate || isTeam) {
      this.world.mode = isTeam ? 'team' : 'friend';
      this.world.botsEnabled = false;
      for (const [id, p] of this.world.players.entries()) {
        if (p.bot) this.world.removePlayer(id);
      }
    }

    if (isTeam && this.allSockets.size === 0) {
      // Clear any orphaned players from inactive team sessions
      for (const [id] of [...this.world.players.entries()]) {
        this.world.removePlayer(id);
      }
      this.lobbyTeams.clear();
      this.sockets.clear();
      this.clientSockets.clear();
      this.socketClientIds.clear();
      this.disconnectedPlayers.clear();
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const cid = url.searchParams.get('cid') || '';
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = request.headers.get('x-edge-colo') || cfRay.split('-')[1] || (request as any).cf?.colo || 'APAC';
      this.handleWebSocket(server, edgeColo, cid);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (url.pathname === '/info') {
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = request.headers.get('x-edge-colo') || cfRay.split('-')[1] || (request as any).cf?.colo || 'APAC';
      return new Response(
        JSON.stringify({
          room: roomParam,
          isPrivate,
          players: this.sockets.size,
          bots: this.world.players.size - this.sockets.size,
          tick: this.world.tick,
          king: this.world.napoleonId,
          edgeColo,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(ws: WebSocket, edgeColo: string, cid = ''): void {
    ws.accept();

    if (cid) {
      const oldWs = this.clientSockets.get(cid);
      if (oldWs && oldWs !== ws) {
        this.allSockets.delete(oldWs);
        this.lobbyTeams.delete(oldWs);
        const oldPid = this.sockets.get(oldWs);
        if (oldPid) {
          this.sockets.delete(oldWs);
          this.world.removePlayer(oldPid);
          const tok = this.playerTokens.get(oldPid);
          if (tok) this.playerTokens.delete(oldPid);
        }
        this.socketClientIds.delete(oldWs);
        try { oldWs.close(1000, 'Replaced'); } catch (_) {}
      }
      this.clientSockets.set(cid, ws);
      this.socketClientIds.set(ws, cid);
    }

    this.allSockets.add(ws);
    this.sendTeamCounts(ws);

    ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const msg = JSON.parse(raw) as ClientMsg;
        this.onMessage(ws, msg, edgeColo);
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });

    const onCloseOrError = () => {
      this.allSockets.delete(ws);
      this.lobbyTeams.delete(ws);
      const c = this.socketClientIds.get(ws);
      if (c && this.clientSockets.get(c) === ws) {
        this.clientSockets.delete(c);
      }
      this.socketClientIds.delete(ws);
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
      this.broadcastTeamCounts();
      if (this.sockets.size === 0 && this.disconnectedPlayers.size === 0) {
        this.stopLoop();
      }
    };

    ws.addEventListener('close', onCloseOrError);
    ws.addEventListener('error', onCloseOrError);
  }

  private onMessage(ws: WebSocket, msg: ClientMsg, edgeColo: string): void {
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

      // Hot handover: another active socket transferring connection for the same session token
      if (!playerId && sessionToken) {
        for (const [existingPid, token] of this.playerTokens.entries()) {
          if (token === sessionToken && this.world.players.has(existingPid)) {
            playerId = existingPid;
            // Detach and cleanly close previous socket(s) for this player
            for (const [oldWs, pid] of this.sockets.entries()) {
              if (pid === playerId && oldWs !== ws) {
                this.sockets.delete(oldWs);
                try {
                  oldWs.close(1000, 'Handover');
                } catch (_) {}
              }
            }
            this.sockets.set(ws, playerId);
            break;
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

      // Send joined confirmation with session token and edge colo
      const joinedMsg: ServerMsg = { t: 'joined', id: playerId, token: sessionToken, colo: edgeColo };
      ws.send(JSON.stringify(joinedMsg));

      if (msg.team !== undefined) {
        this.world.mode = 'team';
        this.world.botsEnabled = false;
        for (const [id, p] of this.world.players.entries()) {
          if (p.bot) this.world.removePlayer(id);
        }
      }

      this.lobbyTeams.delete(ws);
      this.broadcastTeamCounts();
      this.startLoop();
    } else if (msg.t === 'team_select') {
      const team = msg.team === 1 ? 1 : 0;
      this.lobbyTeams.set(ws, team);
      const playerId = this.sockets.get(ws);
      if (playerId) {
        const p = this.world.players.get(playerId);
        if (p) p.team = team;
      }
      this.broadcastTeamCounts();
    } else if (msg.t === 'input') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.setInput(playerId, { a: msg.a, mv: msg.mv, btn: msg.btn });
      }
    } else if (msg.t === 'ping') {
      ws.send(`{"t":"pong","c":${msg.c},"s":${Date.now()},"colo":"${edgeColo}"}`);
    } else if (msg.t === 'rule') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.chooseRule(playerId, msg.id);
      }
    }
  }

  private getTeamCounts(): [number, number] {
    let c0 = 0;
    let c1 = 0;
    for (const ws of this.allSockets) {
      if (ws.readyState !== 1) continue;
      const playerId = this.sockets.get(ws);
      if (playerId) {
        const p = this.world.players.get(playerId);
        if (p && !p.bot && p.team !== undefined) {
          if (p.team === 0) c0++;
          else if (p.team === 1) c1++;
        }
      } else {
        const team = this.lobbyTeams.get(ws);
        if (team === 0) c0++;
        else if (team === 1) c1++;
      }
    }
    return [c0, c1];
  }

  private broadcastTeamCounts(): void {
    const [c0, c1] = this.getTeamCounts();
    const packet = JSON.stringify({ t: 'team_counts', c0, c1 });
    for (const ws of this.allSockets) {
      if (ws.readyState !== 1) continue;
      try {
        ws.send(packet);
      } catch {
        // ignore
      }
    }
  }

  private sendTeamCounts(ws: WebSocket): void {
    const [c0, c1] = this.getTeamCounts();
    try {
      ws.send(JSON.stringify({ t: 'team_counts', c0, c1 }));
    } catch {
      // ignore
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
