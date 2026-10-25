# TỔNG HỢP MÃ NGUỒN VÀ KIẾN TRÚC MẠNG (NETWORKING / WEBSOCKET / CLOUDFLARE DURABLE OBJECTS) - FARM BRAWL

Tài liệu này tổng hợp toàn bộ các tệp mã nguồn và kiến trúc mạng của **Farm Brawl** để phục vụ việc kiểm tra độc lập, rà soát lỗi đồng bộ (desync), giật lùi (rubberbanding), trễ mạng (latency), đo PING/RTT và cơ chế **Hot Migration** (chuyển tuyến không gián đoạn kết nối).

---

## MỤC LỤC
1. **Kiến trúc mạng & Luồng dữ liệu (Network Architecture & Lifecycle)**
2. **`shared/src/protocol.ts`** (Toàn bộ Wire Format, ClientMsg, ServerMsg, Snapshot, Event)
3. **`server/src/index.ts`** (Cloudflare Worker Entry, Trích xuất & Chuyển tiếp Edge Colo, Định tuyến DO)
4. **`server/src/room.ts`** (Cloudflare Durable Object: WebSocket Handler, Pong Microsecond, Session Handover, Game Loop 20Hz)
5. **`client/src/net/transport.ts`** (Interface `Transport` & Mô phỏng `LocalServer`)
6. **`client/src/net/ws.ts`** (WebSocket Client đầy đủ: RTT, Dynamic Ping, Lobby Steer, In-Game Hot Migration, Manual Retune)
7. **`client/src/main.ts` (Phần Tích hợp Mạng)** (Khởi tạo kết nối, Throttle gửi Input, Nhận Snapshot, Sự kiện Reconnect)
8. **Các điểm kỹ thuật trọng tâm cần kiểm tra (Key Review Points)**

---

## 1. KIẾN TRÚC MẠNG & LUỒNG DỮ LIỆU

- **Hạ tầng máy chủ**: Chạy trên **Cloudflare Workers** và **Cloudflare Durable Objects (DO)**. Vị trí Durable Object được khóa cứng tại vùng Đông Nam Á (`locationHint: 'apac-se'` - Singapore) để đảm bảo độ trễ thấp (~30–45ms từ Việt Nam).
- **Phát hiện Trạm biên (Edge POP / Colo)**:
  - Khi client kết nối, Cloudflare Worker tiếp nhận TLS handshake tại Edge POP gần nhất (`HAN` Hà Nội, `SGN` TP.HCM, `HKG` Hồng Kông, `SIN` Singapore, v.v.).
  - Worker trích xuất mã trạm qua `request.cf.colo` hoặc header `cf-ray`, sau đó truyền qua query string `?colo=${clientColo}` vào Durable Object.
- **Cơ chế đo PING / RTT**:
  - Gói tin ping siêu nhẹ: `{ t: 'ping', c: timestamp }`.
  - Server xử lý phản hồi pong ở cấp độ chuỗi thô (bỏ qua bước `JSON.parse` nặng nề) để trả về trong vài microsecond: `{"t":"pong","c":...,"s":...,"colo":"..."}`.
  - Client tính $RTT = \text{now} - c$, lưu vào cửa sổ 8 mẫu gần nhất, lọc trung vị (median) để loại bỏ nhiễu spike đột ngột.
  - Tần số ping tự điều chỉnh: 500ms khi mạng ổn định, rút ngắn xuống 300ms khi ping > 85ms để phản ứng nhanh.
- **In-Game Zero-Downtime Hot Migration (Di trú mạng không gián đoạn)**:
  - Khi phát hiện mạng bị nghẽn (`badPingStreak >= 3` hoặc người chơi bấm nút đổi tuyến): Client **KHÔNG ngắt kết nối đang chơi**.
  - Client bí mật mở một `probeSocket` song song dưới nền.
  - Nếu `probeSocket` kết nối thành công và có độ trễ tốt hơn (giảm $\ge 20\text{ms}$ hoặc $\ge 20\%$ RTT), client gửi lệnh join kèm `sessionToken` qua socket mới.
  - Server nhận diện `sessionToken`, chuyển quyền điều khiển thực thể (giữ nguyên vị trí, điểm số, vương miện, trạng thái sống), đóng socket cũ với mã `1000 'Handover'` và tiếp tục gửi snapshot qua socket mới. Người chơi hoàn toàn không bị văng game hay respawn.
- **Bảo lưu phiên khi rớt mạng (Grace Period)**:
  - Nếu socket bị đứt đột ngột, server lưu thực thể vào `disconnectedPlayers` trong vòng **15 giây**. Nhân vật tạm dừng di chuyển nhưng không bị xóa khỏi thế giới.
  - Khi client reconnect lại kịp thời với `sessionToken` hoặc `cid`, nhân vật tiếp tục hoạt động tại đúng tọa độ đó.

---

## 2. `shared/src/protocol.ts`
*(Toàn bộ file - Giao thức truyền tin giữa Client và Server)*

```typescript
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
  /** exact hold duration in seconds on release */
  hold?: number;
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
  SQUISHED: 2048,
  SUPER: 32768,
  FLYING: 65536,
} as const;

export type DeathCause = 'fence' | 'drown' | 'well' | 'fire' | 'starve' | 'till' | 'dynamite' | 'crush';

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
  | { k: 'napoleon'; id: number; usurped?: boolean }
  | { k: 'rule'; id: string }
  | { k: 'tool'; id: number; kind: ToolKind; x: number; z: number }
  | { k: 'song'; id: number; nap: number }
  | { k: 'boom'; id: number; x: number; z: number }
  | { k: 'superFood'; x: number; z: number }
  | { k: 'super'; id: number }
  | { k: 'fly'; id: number; x: number; z: number }
  | { k: 'flowerBloom' }
  | {
      k: 'teamWin';
      winner: number;
      s0: number;
      s1: number;
      mvp?: {
        id: number;
        name: string;
        team: number;
        species: Species;
        skin: number;
        score: number;
        kills: number;
        mass: number;
      };
      ranks?: LeaderRow[];
    }
  | { k: 'dice'; id: number; roll: number }
  | { k: 'podBlast'; x: number; z: number }
  | { k: 'podWarn'; willShield: boolean; left: number }
  | { k: 'treeHit'; id: number; by: number; x: number; z: number; size: number; droppedBig: number; droppedSmall: number }
  | { k: 'map'; map: MapData; food: FoodWire[]; tools: ToolWire[] };

/** [id, stage: 0..3, big, small, flowers] */
export type TreeSyncWire = [id: number, stage: number, big: number, small: number, flowers: number];

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
  /** Farmer Till tractor position and angle: [x, z, angle] */
  truck?: [number, number, number];
  /** team mode state: [scoreTeam0, scoreTeam1, remainingClockSeconds, countTeam0?, countTeam1?] */
  team?: [number, number, number] | [number, number, number, number, number];
  /** podium shield state: [shieldActive: boolean, timerSeconds: number] */
  podShield?: [boolean, number];
  /** fruit trees sync state: [id, stage, big, small, flowers] */
  trees?: TreeSyncWire[];
}

export type ServerMsg =
  | { t: 'init'; cfg: Cfg; map: MapData; players: PlayerMeta[]; food: FoodWire[]; tick: number; tools?: ToolWire[]; matchDuration?: number }
  | { t: 'joined'; id: number; token?: string; colo?: string }
  | { t: 'pong'; c: number; colo?: string }
  | { t: 'team_counts'; c0: number; c1: number }
  | { t: 'match_duration'; duration: number }
  | Snapshot;

export type ClientMsg =
  | { t: 'join'; name: string; species: Species; skin?: number; team?: number; token?: string; matchDuration?: number; theme?: string }
  | { t: 'leave' }
  | { t: 'ping'; c: number }
  | { t: 'rule'; id: string }
  | { t: 'team_select'; team: number }
  | { t: 'set_match_duration'; duration: number }
  | ({ t: 'input' } & Input);
```

---

## 3. `server/src/index.ts`
*(Toàn bộ file - Worker Entry Router & Edge POP Forwarder)*

```typescript
import { GameRoom } from './room';

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
}

function getTargetLocationHint(_request: Request): string {
  // Always lock all Durable Objects strictly to Southeast Asia ('apac-se' - Singapore) for ~30-40ms latency in Vietnam.
  return 'apac-se';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket requests to Durable Object: /ws?room=pub-1
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      // Route default rooms to fresh Southeast Asia (Singapore) Durable Objects for ~30ms ping
      let targetRoomKey = roomParam;
      if (roomParam === 'pub-1') {
        targetRoomKey = 'pub-sin-v12';
      } else if (roomParam === 'team-1') {
        targetRoomKey = 'team-sin-v12';
      } else if (roomParam.startsWith('priv-') || roomParam.startsWith('friend-')) {
        targetRoomKey = `${roomParam}-sin2`;
      }

      const cf = (request as any).cf;
      const cfRay = request.headers.get('cf-ray') || '';
      const clientColo = cf?.colo || (cfRay.includes('-') ? cfRay.split('-')[1] : null) || 'SIN';

      url.searchParams.set('colo', clientColo);

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      // Pass request with colo query param to report real Edge POP
      return roomStub.fetch(url.toString(), request);
    }

    // Health check endpoint with zero-caching for rapid client watchdog probing
    if (url.pathname === '/api/health') {
      const cf = (request as any).cf;
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = cfRay.split('-')[1] || cf?.colo || 'unknown';
      return new Response(JSON.stringify({
        status: 'ok',
        time: Date.now(),
        colo: edgeColo,
        country: cf?.country ?? 'unknown',
        city: cf?.city ?? 'unknown',
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Room info endpoint for lobby / checking private room status
    if (url.pathname === '/api/room-info') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      let targetRoomKey = roomParam;
      if (roomParam === 'pub-1') {
        targetRoomKey = 'pub-sin-v12';
      } else if (roomParam === 'team-1') {
        targetRoomKey = 'team-sin-v12';
      } else if (roomParam.startsWith('priv-') || roomParam.startsWith('friend-')) {
        targetRoomKey = `${roomParam}-sin2`;
      }

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      const cf = (request as any).cf;
      const cfRay = request.headers.get('cf-ray') || '';
      const clientColo = cf?.colo || (cfRay.includes('-') ? cfRay.split('-')[1] : null) || 'SIN';

      return roomStub.fetch(new Request(`${url.origin}/info?room=${encodeURIComponent(roomParam)}&colo=${clientColo}`, {
        headers: request.headers,
      }));
    }

    // Static assets fallback (served by Workers Static Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Farm Brawl Server is running', { status: 200 });
  },
};
```

---

## 4. `server/src/room.ts`
*(Toàn bộ file - Durable Object GameRoom, Quản lý WebSocket & Snapshot)*

```typescript
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
  private readonly playerTokens = new Map<number, string>();
  private readonly clientPlayerIds = new Map<string, number>();
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

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const cid = url.searchParams.get('cid') || '';
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = url.searchParams.get('colo') || cfRay.split('-')[1] || (request as any).cf?.colo || 'SIN';
      this.handleWebSocket(server, edgeColo, cid);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (url.pathname === '/info') {
      const cfRay = request.headers.get('cf-ray') || '';
      const edgeColo = url.searchParams.get('colo') || cfRay.split('-')[1] || (request as any).cf?.colo || 'SIN';
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
            const endIdx = raw.indexOf('}', cIdx);
            const cVal = raw.slice(cIdx + 4, endIdx !== -1 ? endIdx : undefined).trim();
            ws.send(`{"t":"pong","c":${cVal},"s":${Date.now()},"colo":"${edgeColo}"}`);
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
          // Keep player in world during grace period (8s), stop their motion
          this.world.setInput(playerId, { a: 0, mv: false, btn: false });
          this.disconnectedPlayers.set(token, {
            playerId,
            disconnectTime: performance.now(),
          });
        } else {
          this.world.removePlayer(playerId);
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
      // If private or friend room, clear all state immediately to free system resources
      if (this.world.mode === 'friend') {
        for (const [id] of [...this.world.players.entries()]) {
          this.world.removePlayer(id);
        }
        this.world.matchDuration = 0;
        this.world.matchClock = 0;
        this.world.matchEnded = false;
        this.world.matchEndTimer = 0;
        this.world.napoleonId = 0;
        this.lobbyTeams.clear();
        this.clientSockets.clear();
        this.socketClientIds.clear();
        this.playerTokens.clear();
        this.clientPlayerIds.clear();
        this.disconnectedPlayers.clear();
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
      const joinedMsg: ServerMsg = { t: 'joined', id: playerId, token: sessionToken, colo: edgeColo };
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
      const playerId = this.sockets.get(ws);
      if (playerId) {
        this.world.setInput(playerId, { a: msg.a, mv: msg.mv, btn: msg.btn, hold: msg.hold });
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
      this.checkRoomEmpty();
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
```

---

## 5. `client/src/net/transport.ts`
*(Toàn bộ file - Interface Transport và LocalServer)*

```typescript
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
```

---

## 6. `client/src/net/ws.ts`
*(Toàn bộ file - WebSocket Client, Ping Tracking & Hot Migration)*

```typescript
import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export function isFastColo(colo?: string): boolean {
  if (!colo) return false;
  return /^(SIN|HKG|HAN|SGN|DAD|BKK|KUL|TPE|KHH|MNL|CEB|NRT|HND|KIX|FUK|OKA|ICN|PUS|CGK|DPS|PNH|VTE|BNY|RGN|CAN|SZX|APAC)$/i.test(colo);
}

export class WsClient implements Transport {
  private ws: WebSocket | null = null;
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private isReconnecting = false;
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;
  public sessionToken: string | null = null;
  private pingInterval: number | null = null;
  public rtt = 0;
  public rttMin = 0;
  public colo = '';
  public inGame = false;
  private reconnectTimer: number | null = null;
  private readonly rttWin: number[] = [];
  private badPingStreak = 0;
  private lastLobbyReconnectTime = 0;
  private lobbySteerAttempts = 0;
  private currentPingDelay = 500;

  // In-Game Zero-Downtime Hot Migration
  public isMigrating = false;
  private migrationWs: WebSocket | null = null;
  private lastMigrationProbeTime = 0;
  private probeAttempts = 0;
  private migrationRetryTimer: number | null = null;
  public onMigrationSuccess?: (newColo: string) => void;
  public onMigrationStatus?: (status: 'probing' | 'migrated' | 'failed', colo?: string) => void;

  constructor(
    private readonly url: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void
  ) {
    try {
      this.sessionToken = sessionStorage.getItem(`fb_tok_${this.getRoomKey()}`) || sessionStorage.getItem('fb_session_token');
    } catch (_) {}
    this.connect();
  }

  private getRoomKey(): string {
    try {
      const u = new URL(this.url);
      return u.searchParams.get('room') || 'pub-1';
    } catch {
      return 'pub-1';
    }
  }

  private connect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
      this.ws = socket;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.onStatus?.('error');
      this.scheduleReconnect();
      return;
    }

    this.bindActiveSocket(socket);
  }

  private bindActiveSocket(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.ws !== socket) return;
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = false;
      this.onStatus?.(wasReconnecting ? 'reconnected' : 'open');

      const hasQueuedJoin = this.queue.some((m) => m.t === 'join');
      if (this.lastJoinMsg && this.inGame && !hasQueuedJoin) {
        this.send({
          ...this.lastJoinMsg,
          token: this.sessionToken || undefined,
        });
      }

      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        this.send(msg);
      }

      setTimeout(() => {
        if (!this.closed && this.ws === socket && socket.readyState === WebSocket.OPEN) {
          const now = Math.round(performance.now());
          this.send({ t: 'ping', c: now });
        }
      }, 50);

      this.startPing();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        if (raw.startsWith('{"t":"pong"')) {
          const msg = JSON.parse(raw) as ServerMsg;
          if (msg.t === 'pong') {
            if (msg.colo) this.colo = msg.colo;
            if (typeof document !== 'undefined' && document.hidden) return;
            const s = performance.now() - msg.c;
            if (s >= 0 && s < 2000) {
              this.rttWin.push(s);
              if (this.rttWin.length > 8) this.rttWin.shift();
              const sorted = [...this.rttWin].sort((a, b) => a - b);
              this.rttMin = sorted[0];
              this.rtt = sorted[Math.floor(sorted.length / 2)];

              const onFastNode = isFastColo(this.colo);

              if (onFastNode) this.lobbySteerAttempts = 0;

              // Bad ping streak:
              // <= 90ms on fast node: excellent → reset
              // > 90ms on fast node: suboptimal → increment (seek better route)
              // Non-fast node: immediately alert
              if (onFastNode && this.rtt <= 85 && s <= 95) {
                this.badPingStreak = 0;
              } else if (!onFastNode) {
                this.badPingStreak = Math.max(3, this.badPingStreak + 1);
              } else {
                this.badPingStreak++;
              }

              // Ping faster when suboptimal (> 85ms) to accelerate route probing
              const targetDelay = this.rtt > 85 || !onFastNode ? 300 : 500;
              if (targetDelay !== this.currentPingDelay) {
                this.currentPingDelay = targetDelay;
                this.startPing();
              }

              // ── LOBBY STEER ──
              // When in lobby with elevated ping (> 100ms), actively reconnect to find a lower-latency route
              if (!this.inGame && this.rtt > 100 && !this.closed) {
                if (this.rttWin.length >= 2 && this.lobbySteerAttempts < 3) {
                  const now = performance.now();
                  if (now - this.lastLobbyReconnectTime > 3500) {
                    this.lastLobbyReconnectTime = now;
                    this.lobbySteerAttempts++;
                    console.log(`[WS] Lobby steer: ${this.colo} ~${Math.round(this.rtt)}ms, attempt ${this.lobbySteerAttempts}/3`);
                    this.forceReconnect();
                  }
                }
              }

              // ── IN-GAME ZERO-DOWNTIME MIGRATION ──
              // When ping > 90ms for 3+ consecutive pongs, silently probe for a faster route.
              // This NEVER interrupts gameplay — it opens a separate probe socket.
              // If the probe finds a faster route, it seamlessly swaps the socket (zero-downtime).
              // If not, nothing happens and the player keeps playing normally.
              if (this.inGame && this.badPingStreak >= 3 && !this.closed) {
                this.triggerHotMigration();
              }
            }
          }
          return;
        }

        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'joined') {
          if (msg.colo) this.colo = msg.colo;
          if (msg.token) {
            this.sessionToken = msg.token;
            try {
              sessionStorage.setItem(`fb_tok_${this.getRoomKey()}`, msg.token);
              sessionStorage.setItem('fb_session_token', msg.token);
            } catch (_) {}
            if (this.lastJoinMsg) {
              this.lastJoinMsg.token = msg.token;
            }
          }
        }
        this.onMsg(msg);
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    socket.onclose = (ev) => {
      if (this.ws !== socket) return;
      this.stopPing();
      if (this.isMigrating || this.migrationWs !== null) return;
      if (ev.reason === 'Handover') return;
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      if (this.isMigrating || this.migrationWs !== null) return;
      this.onStatus?.('error');
    };
  }

  public triggerHotMigration(): void {
    if (!this.inGame || this.closed) return;
    const now = performance.now();
    // Throttle: probe at most once every 3s
    if (this.migrationWs !== null || now - this.lastMigrationProbeTime < 3000) return;
    this.lastMigrationProbeTime = now;
    this.isMigrating = true;
    this.onMigrationStatus?.('probing', this.colo);
    console.log(`[WS] Probe: current ${this.colo} ~${Math.round(this.rtt)}ms, seeking faster route...`);

    const probeUrl = this.url + (this.url.includes('?') ? '&' : '?') + `probe=${Date.now()}&_r=${Math.random().toString(36).slice(2)}`;
    let probeSocket: WebSocket;
    try {
      probeSocket = new WebSocket(probeUrl);
      this.migrationWs = probeSocket;
    } catch (e) {
      console.warn('[WS] Failed to create probe socket:', e);
      this.isMigrating = false;
      this.onMigrationStatus?.('failed', this.colo);
      return;
    }

    const probeTimeout = window.setTimeout(() => {
      if (this.migrationWs === probeSocket) {
        try { probeSocket.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
        this.probeAttempts++;
        this.onMigrationStatus?.('failed', this.colo);
        // After 5 failed probes, accept current route (ISP won't change Anycast routing)
        if (this.probeAttempts >= 5) {
          this.probeAttempts = 0;
          this.badPingStreak = 0;
          console.log('[WS] Accepting current route after 5 failed probes.');
        }
      }
    }, 2500);

    let pendingInit: ServerMsg | null = null;

    probeSocket.onopen = () => {
      if (this.migrationWs !== probeSocket || this.closed) {
        clearTimeout(probeTimeout);
        probeSocket.close();
        return;
      }
      probeSocket.send(JSON.stringify({ t: 'ping', c: Math.round(performance.now()) }));
    };

    probeSocket.onmessage = (event) => {
      if (this.migrationWs !== probeSocket || this.closed) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          const probeColo = msg.colo;
          const probeRtt = performance.now() - msg.c;
          console.log(`[WS] Probe: ${probeColo} ~${Math.round(probeRtt)}ms vs current ${this.colo} ~${Math.round(this.rtt)}ms`);

          const probeIsFast = isFastColo(probeColo);
          const currentIsFast = isFastColo(this.colo);
          let shouldSwitch = false;

          if (probeRtt > 0) {
            if (!currentIsFast && probeIsFast) {
              // Non-Asian → Asian: always switch
              shouldSwitch = true;
            } else if (probeColo !== this.colo && probeIsFast && probeRtt < this.rtt - 10) {
              // Different faster Asian POP (e.g. HKG ~85ms → SIN ~45ms)
              shouldSwitch = true;
            } else if (probeRtt < this.rtt - 20) {
              // Any route (including fresh connection to same POP) that is >= 20ms faster: switch!
              shouldSwitch = true;
            } else if (this.rtt > 85 && probeRtt < this.rtt * 0.8) {
              // At least 20% latency reduction when current ping is elevated: switch!
              shouldSwitch = true;
            }
          }

          if (shouldSwitch && this.lastJoinMsg) {
            this.probeAttempts = 0;
            console.log(`[WS] Switching: ${this.colo} ~${Math.round(this.rtt)}ms → ${probeColo} ~${Math.round(probeRtt)}ms`);
            probeSocket.send(JSON.stringify({
              ...this.lastJoinMsg,
              token: this.sessionToken || undefined,
            }));
          } else {
            clearTimeout(probeTimeout);
            try { probeSocket.close(); } catch (_) {}
            this.migrationWs = null;
            this.isMigrating = false;
            this.probeAttempts++;
            this.onMigrationStatus?.('failed', this.colo);
            if (this.probeAttempts >= 6) {
              this.probeAttempts = 0;
              this.badPingStreak = 0;
              console.log('[WS] Accepting current route after 6 failed probes.');
            }
          }
        } else if (msg.t === 'init') {
          pendingInit = msg;
        } else if (msg.t === 'joined') {
          // Seamless handover complete! Swap sockets without disruption.
          clearTimeout(probeTimeout);
          this.probeAttempts = 0;
          console.log(`[WS] Migrated: ${this.colo} → ${msg.colo || 'unknown'} (zero-downtime, no respawn)`);
          const oldWs = this.ws;
          this.ws = probeSocket;
          this.migrationWs = null;
          this.isMigrating = false;
          this.isReconnecting = false;
          if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          if (msg.colo) this.colo = msg.colo;
          if (msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) this.lastJoinMsg.token = msg.token;
          }
          this.rttWin.length = 0;
          this.badPingStreak = 0;
          this.currentPingDelay = 500;

          if (oldWs) {
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            try { oldWs.close(1000, 'Handover'); } catch (_) {}
          }

          this.bindActiveSocket(probeSocket);
          this.startPing();
          if (pendingInit) this.onMsg(pendingInit);
          this.onMsg(msg);
          this.onMigrationStatus?.('migrated', this.colo);
          this.onMigrationSuccess?.(this.colo);
        } else if (this.ws === probeSocket) {
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('[WS] Error during migration:', err);
      }
    };

    const cleanupProbe = () => {
      clearTimeout(probeTimeout);
      if (this.migrationWs === probeSocket) {
        this.migrationWs = null;
        this.isMigrating = false;
        if (!this.closed && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
          this.scheduleReconnect();
        }
      }
    };
    probeSocket.onclose = cleanupProbe;
    probeSocket.onerror = cleanupProbe;
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
        this.send({ t: 'ping', c: now });
      }
    }, this.currentPingDelay);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, 800);
  }

  send(m: ClientMsg): void {
    let toSend = m;
    if (m.t === 'join') {
      toSend = { ...m, token: this.sessionToken || m.token };
      this.lastJoinMsg = toSend;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (m.t !== 'input') {
        this.queue.push(toSend);
      }
      return;
    }
    if (m.t === 'input' && this.ws.bufferedAmount > 65536) {
      return;
    }
    this.ws.send(JSON.stringify(toSend));
  }

  leaveGame(): void {
    this.inGame = false;
    this.isMigrating = false;
    this.sessionToken = null;
    this.lastJoinMsg = null;
    this.queue.length = 0;
    try {
      sessionStorage.removeItem(`fb_tok_${this.getRoomKey()}`);
      sessionStorage.removeItem('fb_session_token');
    } catch (_) {}
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.migrationRetryTimer !== null) {
      clearTimeout(this.migrationRetryTimer);
      this.migrationRetryTimer = null;
    }
    try {
      this.send({ t: 'leave' });
    } catch (_) {}
  }

  public manualRetune(): void {
    if (this.closed) return;
    this.badPingStreak = 3;
    this.probeAttempts = 0;
    if (this.inGame) {
      if (this.migrationWs) {
        try { this.migrationWs.close(); } catch (_) {}
        this.migrationWs = null;
        this.isMigrating = false;
      }
      this.lastMigrationProbeTime = 0;
      this.triggerHotMigration();
    } else {
      this.forceReconnect();
    }
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.stopPing();
    this.probeAttempts = 0;
    this.isMigrating = false;
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rttWin.length = 0;
    this.isReconnecting = true;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
    setTimeout(() => {
      if (!this.closed) {
        this.connect();
      }
    }, 80);
  }

  close(): void {
    this.closed = true;
    this.isMigrating = false;
    this.stopPing();
    if (this.migrationWs) {
      try { this.migrationWs.close(); } catch (_) {}
      this.migrationWs = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastJoinMsg = null;
    this.sessionToken = null;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
  }
}
```

---

## 7. `client/src/main.ts` (TRÍCH ĐOẠN TÍCH HỢP MẠNG)
*(Các hàm khởi tạo phòng, throttle gói tin input, và xử lý callback đổi tuyến)*

```typescript
// ── GỬI LỆNH HÚC (RAM/DASH) NGAY LẬP TỨC ──
input.onPressRam = () => {
  const me = gameState.ents.get(gameState.myId);
  const myMeta = gameState.metas.get(gameState.myId);
  if (!me || me.mass < CFG.MIN_DASH_MASS || isPlowCooldown(myMeta?.species) || (localStunTimer > 0 && isStunned(me))) {
    input.cancelRam();
    return;
  }
  // Gửi btn: true ngay tức thì để server bắt đầu tính thời gian giữ (0 frame latency)
  if (transport && gameState.alive && localStunTimer <= 0) {
    transport.send({ t: 'input', a: input.aimA, mv: input.aimMove, btn: true });
    lastSentInput = { a: input.aimA, mv: input.aimMove, btn: true };
    lastSentTime = performance.now();
  }
};

input.onReleaseRam = (held: number) => {
  chargeStop();
  const myMeta = gameState.metas.get(gameState.myId);
  const myEnt = gameState.ents.get(gameState.myId);
  const inWater = ((myEnt?.flags ?? 0) & FLAG.WATER) !== 0;
  const isStun = (localStunTimer > 0 && isStunned(myEnt)) || (myEnt && isStunned(myEnt));

  const canDash = myEnt && myEnt.mass >= CFG.MIN_DASH_MASS && !isPlowCooldown(myMeta?.species) && !inWater && !isStun;
  const validHeld = Math.min(1.0, Math.max(0.01, held));

  if (canDash) {
    predictor.predictDash(validHeld);
    const isPlow = myMeta?.species === 'pig';
    const baseCd = isPlow ? 0.35 : CFG.BASE_RAM_COOLDOWN;
    gameState.me.cd = baseCd + (isPlow ? CFG.PLOW_CD * (myMeta.species === 'chicken' ? 0.65 : 1) : 0);
  }

  // Gửi btn: false ngay tức thì; gửi kèm hold nếu cú húc hợp lệ
  if (transport && gameState.alive) {
    if (canDash) {
      transport.send({ t: 'input', a: input.aimA, mv: input.aimMove, btn: false, hold: validHeld });
    } else {
      transport.send({ t: 'input', a: input.aimA, mv: input.aimMove, btn: false });
    }
    lastSentInput = { a: input.aimA, mv: input.aimMove, btn: false };
    lastSentTime = performance.now();
  }
};

// ── NÚT BẤM THỦ CÔNG ĐỔI TUYẾN MẠNG (RECONNECT / MANUAL RETUNE) ──
hud.onReconnect = () => {
  hud.showToast(t('coloSwitchingToast'));
  if (transport?.manualRetune) {
    transport.manualRetune();
  } else if (transport?.triggerHotMigration) {
    transport.triggerHotMigration();
  } else if (transport?.forceReconnect) {
    transport.forceReconnect();
  }
};

// ── KẾT NỐI VÀO PHÒNG (connectToRoom) ──
function connectToRoom(targetRoom: string): void {
  if (currentRoomName === targetRoom && transport) {
    return;
  }

  if (transport && typeof (transport as any).close === 'function') {
    (transport as any).close();
  }

  currentRoomName = targetRoom;
  const isPrivate = targetRoom.startsWith('priv-') || targetRoom.startsWith('friend-');
  const isTeam = targetRoom.startsWith('team-');
  const displayCode = isPrivate ? targetRoom.replace(/^(priv|friend)-/, '').toUpperCase() : targetRoom.toUpperCase();
  const inviteUrl = isPrivate
    ? `${window.location.origin}${window.location.pathname}?room=priv-${displayCode}`
    : (isTeam ? `${window.location.origin}${window.location.pathname}?mode=team&room=${targetRoom}` : undefined);

  if (isTeam || isPrivate) {
    hud.setTeamRoomBadge(displayCode, inviteUrl);
    hud.setRoomTag(
      isPrivate ? `${displayCode} 📋` : t('roomTag', { code: displayCode }),
      inviteUrl
    );
  } else {
    hud.hideTeamRoomBadge();
    hud.setRoomTag(t('roomTag', { code: displayCode }), inviteUrl);
  }

  if (isExplicitOffline) {
    transport = new LocalServer((m) => {
      if ((m as any).t === 'match_duration') {
        const md = m as any;
        hud.setMatchDuration(md.duration, false);
        return;
      }
      gameState.handle(m);
    });
    return;
  }

  function getClientId(): string {
    let cid = localStorage.getItem('fb_cid');
    if (!cid) {
      cid = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('fb_cid', cid); } catch (_) {}
    }
    return cid;
  }

  const isViteDev = window.location.port === '5180';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = isViteDev ? 'localhost:8787' : window.location.host;
  const wsUrl = `${proto}//${host}/ws?room=${encodeURIComponent(targetRoom)}&cid=${encodeURIComponent(getClientId())}&theme=${encodeURIComponent(getArenaTheme())}`;

  transport = new WsClient(
    wsUrl,
    (m) => {
      if ((m as any).t === 'team_counts') {
        const tc = m as any;
        hud.updateTeamCounts(tc.c0, tc.c1);
        return;
      }
      if ((m as any).t === 'match_duration') {
        const md = m as any;
        hud.setMatchDuration(md.duration, false);
        return;
      }
      gameState.handle(m);
    },
    (status) => {
      if (status === 'open') {
        missingMeTicks = 0;
        if (targetRoom.startsWith('team-')) {
          transport?.send({ t: 'team_select', team: hud.selectedTeam });
        }
        const msg = isPrivate
          ? t('joinedPrivRoom', { code: displayCode })
          : t('joinedPubRoom', { code: displayCode });
        hud.showToast(msg);
      } else if (status === 'reconnected') {
        missingMeTicks = 0;
        if (targetRoom.startsWith('team-')) {
          transport?.send({ t: 'team_select', team: hud.selectedTeam });
        }
        hud.showToast(t('reconnectedToast'));
      } else if (status === 'closed') {
        if (gameState.alive) {
          hud.showToast(t('disconnectedToast'));
        }
      } else if (status === 'error' && isViteDev && !fallbackLocal) {
        console.warn('Worker server not detected at port 8787. Falling back to LocalServer.');
        fallbackLocal = true;
        transport = new LocalServer((m) => {
          if ((m as any).t === 'match_duration') {
            const md = m as any;
            hud.setMatchDuration(md.duration, false);
            return;
          }
          gameState.handle(m);
        });
      }
    }
  );

  if (transport) {
    transport.onMigrationSuccess = (newColo) => {
      hud.showToast(t('migratedToast', { colo: newColo }), 3000);
    };
    transport.onMigrationStatus = (status, colo) => {
      if (status === 'probing') {
        hud.showToast(t('coloProbingToast'), 2000);
      } else if (status === 'migrated') {
        hud.showToast(t('migratedSinToast', { colo: colo || 'SIN' }), 3000);
      }
    };
  }
}

// ── VÒNG LẶP GỬI INPUT DI CHUYỂN (RENDER LOOP) ──
// Chỉ gửi input khi: đổi nút húc, đổi trạng thái đi bộ, đổi góc xoay đáng kể, hoặc quá 120ms (heartbeat)
const btnChanged = inp.btn !== lastSentInput.btn;
const mvChanged = inp.mv !== lastSentInput.mv;
const angleDiff = Math.abs(wrapAngle(inp.a - lastSentInput.a));
const timeSinceLast = now - lastSentTime;

if (btnChanged || mvChanged || timeSinceLast >= 120 || (timeSinceLast >= 45 && angleDiff > 0.008)) {
  transport.send({ t: 'input', ...inp });
  lastSentInput = { a: inp.a, mv: inp.mv, btn: inp.btn };
  lastSentTime = now;
}
```

---

## 8. CÁC ĐIỂM KỸ THUẬT TRỌNG TÂM CẦN KIỂM TRA (KEY REVIEW POINTS)

1. **Tính tương thích của Edge POP (`colo`)**:
   - Khảo sát cách `server/src/index.ts` trích xuất `cf.colo` và `cf-ray` để chuyển tiếp vào `roomStub.fetch(url.toString(), request)`.
   - Xem xét liệu Cloudflare Anycast từ các ISP Việt Nam (Viettel, VNPT, FPT) có trường hợp nào định tuyến sai vòng qua Mỹ (`LAX`, `SJC`) thay vì châu Á (`SIN`, `HKG`) hay không.
2. **Thuật toán kích hoạt Hot Migration**:
   - Điều kiện chuyển đổi trong `ws.ts`:
     - Nếu đang ở Node xa (không thuộc Asian nodes) $\rightarrow$ gặp Asian node là chuyển ngay.
     - Nếu cả 2 đều là Asian node nhưng khác POP $\rightarrow$ probe nhanh hơn $10\text{ms}$ là chuyển.
     - Bất kể POP nào, nếu probe nhanh hơn $20\text{ms}$ hoặc giảm $> 20\%$ độ trễ khi đang lag $\rightarrow$ chuyển ngay.
   - Kiểm tra xem ngưỡng này có nhạy quá dẫn đến tình trạng chuyển đổi liên tục ("ping pong") hay không.
3. **Cơ chế Handover không gián đoạn**:
   - `server/src/room.ts`: Khi socket mới gửi `join` kèm `token` trùng khớp với `playerTokens`, server lập tức gán socket mới cho `playerId` cũ và đóng socket cũ với lý do `'Handover'`.
   - Client bắt sự kiện `ev.reason === 'Handover'` để **bỏ qua cờ reconnect**, không kích hoạt quy trình reconnect thông thường.
4. **Hạn chế nghẽn bộ đệm WebSocket (`bufferedAmount`)**:
   - `ws.ts` dòng `if (m.t === 'input' && this.ws.bufferedAmount > 65536) return;`: Bỏ qua các gói tin input khi hàng đợi mạng của trình duyệt bị nghẽn (tránh hiện tượng bufferbloat).
