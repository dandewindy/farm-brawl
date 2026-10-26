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
const TIER_0_SEA_COLOS = /^(SIN|HKG|SGN|HAN|DAD|BKK|KUL|CGK|MNL|TPE|PNH|VTE)$/i;

/**
 * Lưu trạng thái thế hệ Shard trên bộ nhớ Isolate để nếu một room ID vô tình
 * bị khởi tạo ở trạm xa (ví dụ FRA, LAX, NRT), Worker sẽ tự động nâng shard
 * ngay khi có request đi qua trạm chuẩn Đông Nam Á (SIN/HKG).
 */
const activeRoomShardMap = new Map<string, number>();

/**
 * Xác định Location Hint tối ưu cho Durable Object.
 * Dùng 'apac-se' (Southeast Asia-Pacific) để Cloudflare đặt DO tại Singapore (SIN).
 */
function getTargetLocationHint(): DurableObjectLocationHint {
  return 'apac-se';
}

/**
 * Tạo khóa phòng thế hệ mới (sea-v16) để tách khỏi hoàn toàn các DO cũ
 * vốn đã bị ghim cố định ở các trung tâm dữ liệu xa.
 */
function resolveRoomKey(roomParam: string, shardIdx = 0): string {
  const baseRoom =
    roomParam === 'pub-1'
      ? 'pub-sea-v16'
      : roomParam === 'team-1'
        ? 'team-sea-v16'
        : `${roomParam}-sea-v16`;

  return shardIdx > 0 ? `${baseRoom}-s${shardIdx}` : baseRoom;
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
    const edgeColo = extractRealEdgeColo(request, url);
    const isSeaEdge = TIER_0_SEA_COLOS.test(edgeColo);

    // 1. Endpoint kiểm tra nhanh độ trễ thuần tới trạm biên (Client <-> Edge POP)
    if (url.pathname === '/api/health' || url.pathname === '/api/edge-ping') {
      const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;
      return new Response(
        JSON.stringify({
          status: 'ok',
          time: Date.now(),
          colo: edgeColo,
          tier: isSeaEdge ? 0 : 2,
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
          },
        }
      );
    }

    // 2. Định tuyến WebSocket vào Durable Object GameRoom
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const currentShard = activeRoomShardMap.get(roomParam) ?? 0;
      const targetRoomKey = resolveRoomKey(roomParam, currentShard);
      const hint = getTargetLocationHint();

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

      const response = await roomStub.fetch(forwardedReq);

      // Nếu DO báo qua header rằng nó vô tình bị sinh ra ở ngoài cụm SEA (ví dụ FRA/LAX/NRT)
      // và phòng đang sẵn sàng relocate, trong khi request hiện tại đang đứng ở trạm SIN/HKG (Tier 0),
      // tự động nâng chỉ số Shard để lần kết nối kế tiếp sinh ra DO mới 100% tại SIN/HKG!
      const doColoHeader = response.headers.get('x-do-colo');
      const doRelocateReady = response.headers.get('x-do-relocate-ready') === '1';
      if (
        doColoHeader &&
        doRelocateReady &&
        isSeaEdge &&
        !TIER_0_SEA_COLOS.test(doColoHeader)
      ) {
        activeRoomShardMap.set(roomParam, (currentShard + 1) % 8);
      }

      return response;
    }

    // 3. Room info endpoint for lobby / checking private room status
    if (url.pathname === '/api/room-info') {
      const roomParam = url.searchParams.get('room') || 'pub-1';
      const currentShard = activeRoomShardMap.get(roomParam) ?? 0;
      const targetRoomKey = resolveRoomKey(roomParam, currentShard);
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
