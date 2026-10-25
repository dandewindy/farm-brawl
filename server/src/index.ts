import { GameRoom } from './room';

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
}

function getTargetLocationHint(_request: Request): DurableObjectLocationHint {
  // 'apac' là mã chuẩn của Cloudflare cho vùng Châu Á - Thái Bình Dương (Singapore, Tokyo, Hong Kong)
  return 'apac';
}

function resolveRoomKey(roomParam: string): string {
  // Tăng version lên v14 để Cloudflare tạo mới hoàn toàn Durable Object tại trạm 'apac'
  if (roomParam === 'pub-1') return 'pub-apac-v14';
  if (roomParam === 'team-1') return 'team-apac-v14';
  if (roomParam.startsWith('priv-') || roomParam.startsWith('friend-')) {
    return `${roomParam}-apac-v14`;
  }
  return `${roomParam}-apac-v14`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket requests to Durable Object: /ws?room=pub-1
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      const targetRoomKey = resolveRoomKey(roomParam);

      const cf = (request as any).cf;
      const cfRay = request.headers.get('cf-ray') || '';
      const clientColo = cf?.colo || (cfRay.includes('-') ? cfRay.split('-')[1] : null) || 'SIN';

      url.searchParams.set('colo', clientColo);

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      return roomStub.fetch(new Request(url.toString(), request));
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
      const targetRoomKey = resolveRoomKey(roomParam);

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
