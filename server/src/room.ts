import { DurableObject } from 'cloudflare:workers';
import { World } from '@shared/sim/world';
import { TICK_MS, SKIN_COUNT } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';

const GRACE_PERIOD_MS = 15000;

export class GameRoom extends DurableObject {
  private readonly world: World;
  private readonly sockets = new Map<WebSocket, number>();
  private readonly allSockets = new Set<WebSocket>();
  private readonly lobbyTeams = new Map<WebSocket, number>();
  private readonly clientSockets = new Map<string, WebSocket>();
  private readonly socketClientIds = new Map<WebSocket, string>();
  private readonly socketEdgeColo = new Map<WebSocket, string>();
  private readonly playerTokens = new Map<number, string>();
  private readonly clientPlayerIds = new Map<string, number>();
  private readonly playerLastSeq = new Map<number, number>();
  private readonly playerLastDashSeq = new Map<number, number>();
  private readonly disconnectedPlayers = new Map<string, { playerId: number; disconnectTime: number }>();
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private tickAccumulator = 0;
  private lastTickPerfTime = 0;
  private doColo = 'UNKNOWN';
  private doColoPromise: Promise<string> | null = null;
  private readonly playerTiming = new Map<number, { lastClientTs: number; receivedAtServerMs: number; ackedInSnapshot: boolean }>();

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.world = new World();
    this.doColoPromise = this.detectDoColo();
  }

  private async detectDoColo(): Promise<string> {
    if (this.doColo !== 'UNKNOWN') return this.doColo;
    try {
      const resp = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        cf: { cacheTtl: 0 },
      } as RequestInit);
      if (resp.ok) {
        const text = await resp.text();
        const match = text.match(/^colo=([A-Z0-9]+)/m);
        if (match && match[1]) {
          this.doColo = match[1].toUpperCase();
          return this.doColo;
        }
      }
    } catch {
      // Giữ mặc định 'APAC' nếu trace nội bộ bị chặn
    }
    if (this.doColo === 'UNKNOWN') {
      this.doColo = 'APAC';
    }
    return this.doColo;
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

    const themeParam = url.searchParams.get('theme');
    if (themeParam) {
      this.world.theme = themeParam;
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

    const cfRay = request.headers.get('cf-ray') || '';
    const edgeColo = (
      request.headers.get('x-edge-colo') ||
      url.searchParams.get('colo') ||
      (cfRay.includes('-') ? cfRay.split('-')[1] : '') ||
      (request as any).cf?.colo ||
      'SIN'
    ).toUpperCase();

    const edgeTs = Number(request.headers.get('x-edge-ts') || Date.now());
    const currentShard = Number(request.headers.get('x-room-shard') || url.searchParams.get('shard') || '0');
    const realDoColo = await (this.doColoPromise ?? this.detectDoColo());
    const edgeToDoInternalMs = Math.max(0, Date.now() - edgeTs);

    // Endpoint kiểm tra nội bộ trực tiếp vị trí DO và độ trễ
    if (url.pathname === '/internal/diag') {
      return new Response(
        JSON.stringify({
          doColo: realDoColo,
          isDoInSea: /^(SIN|HKG|SGN|HAN|DAD|BKK|KUL|CGK|MNL|TPE|PNH|VTE)$/i.test(realDoColo),
          activePlayers: this.sockets.size,
          tick: this.world.tick,
          edgeToDoInternalMs,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const cid = url.searchParams.get('cid') || '';
      this.handleWebSocket(server, edgeColo, realDoColo, edgeToDoInternalMs, currentShard, cid);

      const responseHeaders = new Headers();
      responseHeaders.set('x-do-colo', realDoColo);
      responseHeaders.set('x-do-edge-ms', String(edgeToDoInternalMs));
      responseHeaders.set('x-do-relocate-ready', this.sockets.size <= 1 ? '1' : '0');

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: responseHeaders,
      });
    }

    if (url.pathname === '/info') {
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = (
        request.headers.get('x-edge-colo') ||
        url.searchParams.get('colo') ||
        (cfRay.includes('-') ? cfRay.split('-')[1] : '') ||
        (request as any).cf?.colo ||
        'SIN'
      ).toUpperCase();
      return new Response(
        JSON.stringify({
          room: roomParam,
          isPrivate,
          players: this.sockets.size,
          bots: this.world.players.size - this.sockets.size,
          tick: this.world.tick,
          king: this.world.napoleonId,
          edgeColo,
          doColo: this.doColo,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(
    ws: WebSocket,
    edgeColo: string,
    realDoColo: string,
    edgeToDoMs: number,
    currentShard: number,
    cid = ''
  ): void {
    ws.accept();
    this.socketEdgeColo.set(ws, edgeColo);
    try {
      ws.send(
        JSON.stringify({
          t: 'hello',
          s: Date.now(),
          colo: edgeColo,
          doColo: realDoColo,
          e2d: edgeToDoMs,
          shard: currentShard,
        })
      );
    } catch (_) {}

    // Nếu người chơi vào trạm biên Đông Nam Á (SIN/HKG) nhưng DO vô tình nằm ở ngoài SEA,
    // yêu cầu client tự động chuyển shard để tạo phòng mới tại Singapore!
    const isEdgeInSea = /^(SIN|HKG|SGN|HAN|DAD|BKK|KUL|CGK|MNL|TPE|PNH|VTE)$/i.test(edgeColo);
    const isDoInSea =
      /^(SIN|HKG|SGN|HAN|DAD|BKK|KUL|CGK|MNL|TPE|PNH|VTE)$/i.test(realDoColo) ||
      realDoColo === 'APAC';

    if (isEdgeInSea && !isDoInSea && this.sockets.size <= 1 && currentShard < 5) {
      try {
        ws.send(
          JSON.stringify({
            t: 'relocate_shard',
            nextShard: currentShard + 1,
            badDoColo: realDoColo,
            edgeColo,
          })
        );
      } catch (_) {}
    }

    if (cid) {
      this.socketClientIds.set(ws, cid);
    }

    this.allSockets.add(ws);
    this.sendTeamCounts(ws);
    if (this.world.matchDuration > 0) {
      ws.send(JSON.stringify({ t: 'match_duration', duration: this.world.matchDuration }));
    }

    ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        // Instant microsecond pong response bypassing full JSON parsing
        if (raw.startsWith('{"t":"ping"')) {
          const cIdx = raw.indexOf('"c":');
          if (cIdx !== -1) {
            const commaIdx = raw.indexOf(',', cIdx + 4);
            const braceIdx = raw.indexOf('}', cIdx + 4);
            const endIdx = commaIdx !== -1 && commaIdx < braceIdx ? commaIdx : braceIdx;
            const cVal = raw.slice(cIdx + 4, endIdx !== -1 ? endIdx : undefined).trim();
            ws.send(`{"t":"pong","c":${cVal},"s":${Date.now()},"colo":"${edgeColo}","doColo":"${this.doColo}"}`);
            return;
          }
        }
        const msg = JSON.parse(raw) as ClientMsg;
        this.onMessage(ws, msg, edgeColo, cid);
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });

    const onCloseOrError = () => {
      this.allSockets.delete(ws);
      this.lobbyTeams.delete(ws);
      this.socketEdgeColo.delete(ws);
      const c = this.socketClientIds.get(ws);
      if (c && this.clientSockets.get(c) === ws) {
        this.clientSockets.delete(c);
      }
      this.socketClientIds.delete(ws);
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.sockets.delete(ws);
        this.playerTiming.delete(playerId);
        const token = this.playerTokens.get(playerId);
        const player = this.world.players.get(playerId);
        if (token && player) {
          // Keep player in world during grace period (8s), stop their motion
          this.world.setInput(playerId, { a: 0, mv: false, btn: false });
          this.disconnectedPlayers.set(token, {
            playerId,
            disconnectTime: performance.now(),
          });
        } else {
          this.world.removePlayer(playerId);
          this.playerLastSeq.delete(playerId);
          this.playerLastDashSeq.delete(playerId);
          if (token) this.playerTokens.delete(playerId);
          if (c) this.clientPlayerIds.delete(c);
        }
      }
      this.broadcastTeamCounts();
      this.checkRoomEmpty();
    };

    ws.addEventListener('close', onCloseOrError);
    ws.addEventListener('error', onCloseOrError);
  }

  private checkRoomEmpty(): void {
    if (this.sockets.size === 0 && this.disconnectedPlayers.size === 0) {
      this.stopLoop();

      // If room is completely empty (no sockets connected at all, not even in lobby):
      if (this.allSockets.size === 0) {
        if (this.world.mode === 'friend') {
          // Friend/Private room: purge everything
          for (const [id] of [...this.world.players.entries()]) {
            this.world.removePlayer(id);
          }
          this.world.matchDuration = 0;
          this.world.matchClock = 0;
          this.world.matchEnded = false;
          this.world.matchEndTimer = 0;
          this.world.napoleonId = 0;
          this.world.clearRule();
          this.world.tools.clear();
          this.world.minions.clear();
          this.world.bananaProjectiles.length = 0;
          this.lobbyTeams.clear();
          this.clientSockets.clear();
          this.socketClientIds.clear();
          this.playerTokens.clear();
          this.clientPlayerIds.clear();
          this.disconnectedPlayers.clear();
          this.playerLastSeq.clear();
          this.playerLastDashSeq.clear();
          this.playerTiming.clear();
          this.socketEdgeColo.clear();
        } else if (this.world.mode === 'team') {
          // Team room: reset team scores & clock, clear players & entities
          for (const [id] of [...this.world.players.entries()]) {
            this.world.removePlayer(id);
          }
          this.world.teamScores = [0, 0];
          this.world.matchClock = 300;
          this.world.matchEnded = false;
          this.world.matchEndTimer = 0;
          this.world.napoleonId = 0;
          this.world.clearRule();
          this.world.tools.clear();
          this.world.minions.clear();
          this.world.bananaProjectiles.length = 0;
          this.lobbyTeams.clear();
          this.clientSockets.clear();
          this.socketClientIds.clear();
          this.playerTokens.clear();
          this.clientPlayerIds.clear();
          this.disconnectedPlayers.clear();
          this.playerLastSeq.clear();
          this.playerLastDashSeq.clear();
          this.playerTiming.clear();
          this.socketEdgeColo.clear();
        } else {
          // Public FFA room: purge bots and lingering entities, leaving only dormant base state
          for (const [id] of [...this.world.players.entries()]) {
            this.world.removePlayer(id);
          }
          this.world.napoleonId = 0;
          this.world.clearRule();
          this.world.minions.clear();
          this.world.bananaProjectiles.length = 0;
          this.clientSockets.clear();
          this.socketClientIds.clear();
          this.playerTokens.clear();
          this.clientPlayerIds.clear();
          this.disconnectedPlayers.clear();
          this.playerLastSeq.clear();
          this.playerLastDashSeq.clear();
          this.playerTiming.clear();
          this.socketEdgeColo.clear();
        }
      }
    }
  }

  private onMessage(ws: WebSocket, msg: ClientMsg, edgeColo: string, cid = ''): void {
    if (msg.t === 'join') {
      if (msg.theme) {
        this.world.theme = msg.theme;
      }
      let playerId = this.sockets.get(ws);
      let sessionToken = msg.token;

      // 1. Check if reconnecting within grace period with an existing session token
      if (!playerId && sessionToken && this.disconnectedPlayers.has(sessionToken)) {
        const entry = this.disconnectedPlayers.get(sessionToken)!;
        this.disconnectedPlayers.delete(sessionToken);
        const existingPlayer = this.world.players.get(entry.playerId);
        if (existingPlayer) {
          playerId = entry.playerId;
          this.sockets.set(ws, playerId);
          if (!existingPlayer.alive) {
            this.world.respawn(playerId, msg.name, msg.species, msg.skin, this.world.mode === 'friend' ? undefined : msg.team);
          }
        }
      }

      // 2. Hot handover: another active socket transferring connection for the same session token
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

      // 3. Fallback: reclaim by client ID (cid) if sessionToken was lost or mismatched
      if (!playerId && cid && this.clientPlayerIds.has(cid)) {
        const candidatePid = this.clientPlayerIds.get(cid)!;
        if (this.world.players.has(candidatePid)) {
          playerId = candidatePid;
          // Clear any disconnected entry for this player
          for (const [tok, entry] of this.disconnectedPlayers.entries()) {
            if (entry.playerId === playerId) {
              this.disconnectedPlayers.delete(tok);
              if (!sessionToken) sessionToken = tok;
              break;
            }
          }
          for (const [oldWs, pid] of this.sockets.entries()) {
            if (pid === playerId && oldWs !== ws) {
              this.sockets.delete(oldWs);
              try {
                oldWs.close(1000, 'Handover');
              } catch (_) {}
            }
          }
          this.sockets.set(ws, playerId);
        }
      }

      // 4. Fallback for private/friend rooms: reclaim unattached player with matching name
      if (!playerId && (this.world.mode === 'friend' || this.world.mode === 'team') && msg.name) {
        const trimmedName = msg.name.trim().slice(0, 16);
        for (const [pId, p] of this.world.players.entries()) {
          if (!p.bot && p.name === trimmedName) {
            const isAttached = [...this.sockets.values()].includes(pId);
            if (!isAttached) {
              playerId = pId;
              for (const [tok, entry] of this.disconnectedPlayers.entries()) {
                if (entry.playerId === playerId) {
                  this.disconnectedPlayers.delete(tok);
                  if (!sessionToken) sessionToken = tok;
                  break;
                }
              }
              this.sockets.set(ws, playerId);
              break;
            }
          }
        }
      }

      if (!playerId) {
        // Brand new player or grace period expired
        // Crucial ghost-cleanup: If cid previously had any orphaned player still in world, remove it!
        if (cid && this.clientPlayerIds.has(cid)) {
          const oldPid = this.clientPlayerIds.get(cid)!;
          if (this.world.players.has(oldPid)) {
            this.world.removePlayer(oldPid);
          }
          this.clientPlayerIds.delete(cid);
        }
        if (sessionToken) {
          for (const [tok, entry] of this.disconnectedPlayers.entries()) {
            if (tok === sessionToken) {
              this.disconnectedPlayers.delete(tok);
              this.world.removePlayer(entry.playerId);
            }
          }
        }
        sessionToken = sessionToken || crypto.randomUUID();
        playerId = this.world.addPlayer(msg.name, msg.species, false, this.world.mode === 'friend' ? undefined : msg.team, msg.skin);
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
            this.world.respawn(playerId, msg.name, msg.species, msg.skin, this.world.mode === 'friend' ? undefined : msg.team);
          } else {
            // Player is alive (reconnect / hot handover): PRESERVE EXACT POSITION, MASS & KING STATUS!
            if (msg.name) existingPlayer.name = msg.name.slice(0, 16);
            if (msg.species) existingPlayer.species = msg.species;
            if (msg.skin !== undefined) existingPlayer.skin = msg.skin % SKIN_COUNT;
            if (this.world.mode === 'friend') {
              existingPlayer.team = undefined;
            } else if (msg.team !== undefined) {
              existingPlayer.team = msg.team;
            }
          }
        } else {
          playerId = this.world.addPlayer(msg.name, msg.species, false, this.world.mode === 'friend' ? undefined : msg.team, msg.skin);
          this.sockets.set(ws, playerId);
          this.playerTokens.set(playerId, sessionToken);
        }
      }

      // 100% guarantee that player exists and is alive upon join
      const currentP = this.world.players.get(playerId);
      if (!currentP) {
        playerId = this.world.addPlayer(msg.name, msg.species, false, this.world.mode === 'friend' ? undefined : msg.team, msg.skin);
        this.sockets.set(ws, playerId);
        this.playerTokens.set(playerId, sessionToken);
      } else if (!currentP.alive) {
        this.world.respawn(playerId, msg.name, msg.species, msg.skin, this.world.mode === 'friend' ? undefined : msg.team);
      }

      if (cid && playerId) {
        this.clientPlayerIds.set(cid, playerId);
        this.clientSockets.set(cid, ws);
      }

      // Reset sequence counter and input state so newly joined player's input packets are immediately accepted
      const numId = typeof playerId === 'number' ? playerId : Number(playerId);
      const keyId = Number.isNaN(numId) ? playerId : numId;
      this.playerLastSeq.set(keyId as any, 0);

      const p = this.world.players.get(numId) ?? this.world.players.get(playerId as any);
      if (p) {
        p.lastInputSeq = 0;
        p.ai = null;
        p.bot = false;
        p.input.mv = false;
        p.input.btn = false;
        p.stunT = 0;
        if (typeof msg.name === 'string' && msg.name.trim()) p.name = msg.name.trim().slice(0, 16);
        if (msg.species) p.species = msg.species;
        if (typeof msg.skin === 'number') p.skin = msg.skin % SKIN_COUNT;
      }

      // Send initial world configuration & map
      const initMsg: ServerMsg = this.world.init();
      if (initMsg.t === 'init') {
        const confirmedP = this.world.players.get(playerId);
        if (confirmedP && !initMsg.players.some((p: any) => p.id === playerId)) {
          initMsg.players.push(this.world.meta(confirmedP));
        }
      }
      ws.send(JSON.stringify(initMsg));

      // Send joined confirmation with session token and edge colo
      const joinedMsg: ServerMsg = { t: 'joined', id: playerId, token: sessionToken, colo: edgeColo, doColo: this.doColo };
      ws.send(JSON.stringify(joinedMsg));

      if (msg.team !== undefined) {
        this.world.mode = 'team';
        this.world.botsEnabled = false;
        for (const [id, p] of this.world.players.entries()) {
          if (p.bot) this.world.removePlayer(id);
        }
      }

      if (msg.matchDuration !== undefined && this.world.mode === 'friend' && this.world.matchDuration === 0) {
        const dur = Math.max(0, Math.floor(msg.matchDuration));
        this.world.matchDuration = dur;
        this.world.matchClock = dur;
        this.broadcastMatchDuration(dur);
      }

      this.lobbyTeams.delete(ws);
      this.broadcastTeamCounts();
      this.startLoop();
    } else if (msg.t === 'leave') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.sockets.delete(ws);
        const tok = this.playerTokens.get(playerId);
        if (tok) this.playerTokens.delete(playerId);
        if (cid) this.clientPlayerIds.delete(cid);
        this.playerLastSeq.delete(playerId);
        this.playerLastDashSeq.delete(playerId);
        this.world.removePlayer(playerId);
      }
      this.lobbyTeams.delete(ws);
      this.broadcastTeamCounts();
      this.checkRoomEmpty();
    } else if (msg.t === 'team_select') {
      const team = msg.team === 1 ? 1 : 0;
      this.lobbyTeams.set(ws, team);
      const playerId = this.sockets.get(ws);
      if (playerId) {
        const p = this.world.players.get(playerId);
        if (p) p.team = team;
      }
      this.broadcastTeamCounts();
    } else if (msg.t === 'set_match_duration') {
      const dur = Math.max(0, Math.floor(msg.duration || 0));
      this.world.matchDuration = dur;
      this.world.matchClock = dur;
      this.world.matchEnded = false;
      this.world.matchEndTimer = 0;
      this.broadcastMatchDuration(dur);
    } else if (msg.t === 'input') {
      const rawPlayerId = this.sockets.get(ws);
      if (rawPlayerId !== undefined && rawPlayerId !== null) {
        const playerId = typeof rawPlayerId === 'number' ? rawPlayerId : Number(rawPlayerId);
        const keyId = Number.isNaN(playerId) ? rawPlayerId : playerId;
        if (typeof msg.seq === 'number' && msg.seq > (this.playerLastSeq.get(keyId as any) ?? 0)) {
          this.playerLastSeq.set(keyId as any, msg.seq);
        }
        if (typeof msg.dashSeq === 'number' && msg.dashSeq > 0) {
          this.playerLastDashSeq.set(keyId as any, msg.dashSeq);
        }
        if (typeof (msg as any).ct === 'number') {
          this.playerTiming.set(keyId as any, {
            lastClientTs: (msg as any).ct,
            receivedAtServerMs: Date.now(),
            ackedInSnapshot: false,
          });
        }
        this.world.setInput(keyId, {
          a: msg.a,
          mv: msg.mv,
          btn: msg.btn,
          hold: msg.hold,
          seq: msg.seq,
          dashSeq: msg.dashSeq,
          eat: (msg as any).eat,
        });
      }
    } else if (msg.t === 'ping') {
      ws.send(`{"t":"pong","c":${msg.c},"s":${Date.now()},"colo":"${edgeColo}","doColo":"${this.doColo}"}`);
    } else if (msg.t === 'rule') {
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.chooseRule(playerId, msg.id);
      }
    }
  }

  private broadcastMatchDuration(dur: number): void {
    const payload = JSON.stringify({ t: 'match_duration', duration: dur });
    for (const ws of this.allSockets) {
      if (ws.readyState === 1) {
        try { ws.send(payload); } catch (_) {}
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
    this.lastTickPerfTime = performance.now();
    this.tickAccumulator = 0;
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
      this.checkRoomEmpty();
      return;
    }
    this.loopTimer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, 25);
  }

  private tick(): void {
    const now = performance.now();
    let elapsed = this.lastTickPerfTime > 0 ? now - this.lastTickPerfTime : TICK_MS;
    this.lastTickPerfTime = now;
    if (elapsed < 0 || elapsed > 500) elapsed = TICK_MS;

    this.tickAccumulator += elapsed;
    if (this.tickAccumulator < TICK_MS) return;

    // Clean up expired disconnected sessions
    if (this.disconnectedPlayers.size > 0) {
      for (const [token, entry] of this.disconnectedPlayers.entries()) {
        if (now - entry.disconnectTime > GRACE_PERIOD_MS) {
          this.disconnectedPlayers.delete(token);
          this.playerTokens.delete(entry.playerId);
          this.playerLastSeq.delete(entry.playerId);
          this.playerLastDashSeq.delete(entry.playerId);
          this.world.removePlayer(entry.playerId);
          for (const [c, pid] of this.clientPlayerIds.entries()) {
            if (pid === entry.playerId) this.clientPlayerIds.delete(c);
          }
        }
      }
      if (this.sockets.size === 0 && this.disconnectedPlayers.size === 0) {
        this.checkRoomEmpty();
        return;
      }
    }

    let steps = 0;
    while (this.tickAccumulator >= TICK_MS && steps < 3) {
      this.world.step();
      this.tickAccumulator -= TICK_MS;
      steps++;
    }
    if (this.tickAccumulator >= TICK_MS) {
      this.tickAccumulator %= TICK_MS;
    }

    // Broadcast authoritative snapshot to all human players
    const serverNow = Date.now();
    for (const [ws, playerId] of this.sockets.entries()) {
      if (ws.readyState !== 1) continue;
      try {
        const snap = this.world.snapshotFor(playerId);
        snap.ackSeq = this.playerLastSeq.get(playerId) ?? 0;
        snap.ackDash = this.playerLastDashSeq.get(playerId) ?? 0;
        snap.st = serverNow;
        const timing = this.playerTiming.get(playerId);
        if (timing && timing.lastClientTs > 0 && !timing.ackedInSnapshot) {
          const holdMs = Math.max(0, serverNow - timing.receivedAtServerMs);
          if (holdMs <= 60) {
            snap.ect = timing.lastClientTs;
            snap.holdMs = holdMs;
          }
          timing.ackedInSnapshot = true;
        }
        snap.colo = this.socketEdgeColo.get(ws) || 'SIN';
        snap.doColo = this.doColo;
        ws.send(JSON.stringify(snap));
      } catch {
        // Socket error handled in close event listener
      }
    this.world.flush();

    // Periodic Server Garbage Collection every 600 ticks (~30 seconds)
    if (this.world.tick % 600 === 0) {
      this.performPeriodicGarbageCollection();
    }
  }

  private performPeriodicGarbageCollection(): void {
    // 1. Clean up orphaned player mappings
    for (const [pid] of this.playerTokens.entries()) {
      if (!this.world.players.has(pid) && ![...this.disconnectedPlayers.values()].some((e) => e.playerId === pid)) {
        this.playerTokens.delete(pid);
        this.playerLastSeq.delete(pid);
        this.playerLastDashSeq.delete(pid);
        this.playerTiming.delete(pid);
      }
    }
    for (const [c, pid] of this.clientPlayerIds.entries()) {
      if (!this.world.players.has(pid) && ![...this.disconnectedPlayers.values()].some((e) => e.playerId === pid)) {
        this.clientPlayerIds.delete(c);
      }
    }
    // 2. Clean up stale clientSockets if disconnected
    for (const [c, s] of this.clientSockets.entries()) {
      if (!this.allSockets.has(s) || s.readyState !== 1) {
        this.clientSockets.delete(c);
      }
    }
  }
}
