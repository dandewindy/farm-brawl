import { GameRoom } from './room';

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
}

/**
 * Xác định Location Hint tối ưu cho Durable Object.
 * Luôn cố định 'apac' cho cụm phòng Châu Á để DO ưu tiên đặt tại SIN / HKG.
 */
function getTargetLocationHint(_request: Request): DurableObjectLocationHint {
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

/**
 * Trích xuất chính xác mã IATA của trạm Edge POP thực tế từ Cloudflare.
 * TUYỆT ĐỐI ưu tiên cf.colo và cf-ray hơn query param để tránh thông tin giả từ URL cũ.
 */
function extractRealEdgeColo(request: Request, url: URL): string {
  const cf = (request as unknown as { cf?: { colo?: string } }).cf;
  if (cf?.colo && typeof cf.colo === 'string') {
    return cf.colo.toUpperCase();
  }
  const cfRay = request.headers.get('cf-ray') || '';
  const dashIdx = cfRay.indexOf('-');
  if (dashIdx !== -1 && dashIdx + 1 < cfRay.length) {
    return cfRay.slice(dashIdx + 1).toUpperCase();
  }
  return (url.searchParams.get('colo') || 'SIN').toUpperCase();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Endpoint kiểm tra nhanh độ trễ thuần tới trạm biên (Client <-> Edge POP)
    if (url.pathname === '/api/health' || url.pathname === '/api/edge-ping') {
      const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;
      const edgeColo = extractRealEdgeColo(request, url);
      return new Response(
        JSON.stringify({
          status: 'ok',
          time: Date.now(),
          colo: edgeColo,
          country: cf?.country ?? 'unknown',
          city: cf?.city ?? 'unknown',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          },
        }
      );
    }

    // 2. Định tuyến WebSocket vào Durable Object GameRoom
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      const targetRoomKey = resolveRoomKey(roomParam);
      const edgeColo = extractRealEdgeColo(request, url);

      // Ghi đè colo thực tế vào query param và header để DO đọc chính xác
      url.searchParams.set('colo', edgeColo);

      const headers = new Headers(request.headers);
      headers.set('x-edge-colo', edgeColo);
      headers.set('x-edge-ts', Date.now().toString());

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      const forwardedReq = new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
      });

      return roomStub.fetch(forwardedReq);
    }

    // 3. Room info endpoint for lobby / checking private room status
    if (url.pathname === '/api/room-info') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const hint = getTargetLocationHint(request);
      const targetRoomKey = resolveRoomKey(roomParam);
      const edgeColo = extractRealEdgeColo(request, url);

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      return roomStub.fetch(new Request(`${url.origin}/info?room=${encodeURIComponent(roomParam)}&colo=${edgeColo}`, {
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
