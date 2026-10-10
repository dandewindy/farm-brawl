import { GameRoom } from './room';

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
}

function getTargetLocationHint(request: Request): string {
  const cf = (request as any).cf;
  const continent = cf?.continent;
  const country = cf?.country;
  if (country === 'VN' || continent === 'AS') {
    return 'apac';
  }
  if (continent === 'EU') return 'weur';
  if (continent === 'NA') return 'enam';
  return 'apac';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket requests to Durable Object: /ws?room=pub-1
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      // Route default rooms to fresh regional APAC / SEA Durable Objects for optimal latency
      let targetRoomKey = roomParam;
      if (roomParam === 'pub-1') {
        targetRoomKey = `pub-${hint}-1`;
      } else if (roomParam === 'team-1') {
        targetRoomKey = `team-${hint}-1`;
      }

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      return roomStub.fetch(request);
    }

    // Health check endpoint
    if (url.pathname === '/api/health') {
      const cf = (request as any).cf;
      return new Response(JSON.stringify({
        status: 'ok',
        time: Date.now(),
        colo: cf?.colo ?? 'unknown',
        country: cf?.country ?? 'unknown',
        city: cf?.city ?? 'unknown',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Room info endpoint for lobby / checking private room status
    if (url.pathname === '/api/room-info') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      let targetRoomKey = roomParam;
      if (roomParam === 'pub-1') {
        targetRoomKey = `pub-${hint}-1`;
      } else if (roomParam === 'team-1') {
        targetRoomKey = `team-${hint}-1`;
      }

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });
      return roomStub.fetch(new Request(`${url.origin}/info?room=${encodeURIComponent(roomParam)}`, {
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
