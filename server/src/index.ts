import { GameRoom } from './room';

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS?: Fetcher;
}

/**
 * Danh sách các trạm Edge POP thuộc trục Đông Nam Á & Đông Á lân cận (Tier 0).
 * Khi một Worker đang chạy tại các POP này gọi lệnh khởi tạo Durable Object với locationHint: 'apac-se',
 * Cloudflare sẽ đặt Durable Object vật lý ngay tại Singapore (SIN) hoặc Hồng Kông (HKG).
 */
/**
 * Danh sách các trạm Cloudflare Edge POP chuẩn tại Đông Nam Á & Hồng Kông (Tier 0).
 */
export const TIER_0_SEA_COLOS = /^(SIN|HKG|SGN|HAN|DAD|BKK|KUL|PNH|VTE)$/i;
export const TIER_1_APAC_COLOS = /^(TPE|KHH|MNL|CEB|CAN|SZX|MFN|CGK|DPS|RGN|BNY|NRT|HND|KIX|FUK|OKA|ICN|PUS)$/i;

export function getColoTierServer(colo: string): 0 | 1 | 2 {
  if (TIER_0_SEA_COLOS.test(colo)) return 0;
  if (TIER_1_APAC_COLOS.test(colo)) return 1;
  return 2;
}

/**
 * Sử dụng locationHint 'apac-se' (Southeast Asia-Pacific - Singapore) chính thức của Cloudflare
 * để ép Durable Object khởi tạo ngay tại cụm Singapore.
 */
function getTargetLocationHint(): DurableObjectLocationHint {
  return 'apac-se' as DurableObjectLocationHint;
}

/**
 * Tạo khóa phòng thế hệ mới (sin-v17) tách biệt hoàn toàn với các DO cũ từng bị tạo nhầm vị trí.
 * Hỗ trợ hậu tố shard bền vững từ query param để di dời tức thì nếu DO bị lệch vùng.
 */
function resolveRoomKey(roomParam: string, shardParam = '0'): string {
  const cleanRoom = roomParam.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'pub-1';
  const cleanShard = String(shardParam).replace(/[^0-9]/g, '').slice(0, 2) || '0';

  const baseRoom =
    cleanRoom === 'pub-1'
      ? 'pub-sin-v17'
      : cleanRoom === 'team-1'
        ? 'team-sin-v17'
        : `${cleanRoom}-sin-v17`;

  return cleanShard !== '0' ? `${baseRoom}-s${cleanShard}` : baseRoom;
}

/**
 * Trích xuất chính xác mã IATA của trạm Edge POP thực tế từ Cloudflare.
 * TUYỆT ĐỐI ưu tiên cf.colo và cf-ray hơn query param để tránh thông tin giả từ URL cũ.
 */
function extractRealEdgeColo(request: Request, url: URL): string {
  const cf = (request as unknown as { cf?: { colo?: string } }).cf;
  if (cf?.colo && typeof cf.colo === 'string' && cf.colo.length >= 3) {
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
    const edgeColo = extractRealEdgeColo(request, url);
    const edgeTier = getColoTierServer(edgeColo);

    // 1. Endpoint kiểm tra nhanh độ trễ thuần tới trạm biên (Client <-> Edge POP)
    if (url.pathname === '/api/health' || url.pathname === '/api/edge-ping') {
      const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;
      return new Response(
        JSON.stringify({
          status: 'ok',
          time: Date.now(),
          colo: edgeColo,
          tier: edgeTier,
          country: cf?.country ?? 'unknown',
          city: cf?.city ?? 'unknown',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Timing-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'X-Edge-Colo': edgeColo,
            'X-Edge-Tier': String(edgeTier),
          },
        }
      );
    }

    // 2. Endpoint kiểm tra trực tiếp vị trí vật lý của Durable Object & độ trễ Edge <-> DO
    if (url.pathname === '/api/do-diag') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const shardParam = url.searchParams.get('shard') || '0';
      const targetRoomKey = resolveRoomKey(roomParam, shardParam);
      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, {
        locationHint: getTargetLocationHint(),
      });

      const t0 = Date.now();
      const diagUrl = new URL(request.url);
      diagUrl.pathname = '/internal/diag';
      diagUrl.searchParams.set('colo', edgeColo);
      const doResp = await roomStub.fetch(new Request(diagUrl.toString()));
      const edgeToDoMs = Date.now() - t0;
      const doData = (await doResp.json()) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          roomKey: targetRoomKey,
          edgeColo,
          edgeTier,
          edgeToDoMs,
          ...doData,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // 3. Định tuyến WebSocket vào Durable Object GameRoom
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const shardParam = url.searchParams.get('shard') || '0';
      const targetRoomKey = resolveRoomKey(roomParam, shardParam);
      const hint = getTargetLocationHint();

      url.searchParams.set('colo', edgeColo);
      url.searchParams.set('rk', targetRoomKey);

      const headers = new Headers(request.headers);
      headers.set('x-edge-colo', edgeColo);
      headers.set('x-edge-tier', String(edgeTier));
      headers.set('x-edge-ts', Date.now().toString());
      headers.set('x-room-shard', shardParam);

      const roomId = env.ROOM.idFromName(targetRoomKey);
      const roomStub = (env.ROOM as any).get(roomId, { locationHint: hint });

      const forwardedReq = new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
      });

      return roomStub.fetch(forwardedReq);
    }

    // 4. Room info endpoint for lobby / checking private room status
    if (url.pathname === '/api/room-info') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const shardParam = url.searchParams.get('shard') || '0';
      const targetRoomKey = resolveRoomKey(roomParam, shardParam);
      const hint = getTargetLocationHint();

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
