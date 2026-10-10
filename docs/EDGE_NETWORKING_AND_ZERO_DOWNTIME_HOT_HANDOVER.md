# Kỹ Thuật Tối Ưu Mạng Cho Game Thời Gian Thực (Realtime Multiplayer) Trên Cloudflare Workers & Anycast
> **Tham chiếu kiến trúc & giải pháp xử lý Ping cao, Jitter mạng và Hot Handover không gián đoạn (Zero-Downtime Hot Handover) để áp dụng cho các dự án game multiplayer kế tiếp.**

---

## 1. Vấn Đề Gốc Của Cloudflare Anycast Với Game Multiplayer Tại Việt Nam

### 1.1 Hiện tượng
- Khi triển khai Game Server trên nền tảng Serverless Edge (như Cloudflare Workers / Durable Objects) với kiến trúc mạng Anycast:
  - Cùng một người chơi tại Việt Nam, lúc thì kết nối vào trạm Singapore (`SIN`) với ping siêu thấp **~30 - 38ms**.
  - Đôi khi F5 hoặc kết nối qua mạng khác (Viettel / VNPT / FPT / 4G / Wi-Fi quán cà phê / công ty) lại bị định tuyến sang Tokyo (`NRT`) hoặc Osaka (`KIX`), khiến ping tăng vọt lên **~90 - 140ms**.
  - Khi người chơi bấm nút đổi tuyến hoặc đổi mạng, kết nối WebSocket bị đứt (`disconnect`), dẫn đến game bị reset, mất điểm, mất nhân vật hoặc bị giật khựng liên tục.

### 1.2 Nguyên nhân kỹ thuật
1. **Anycast BGP Routing**: Anycast định tuyến lưu lượng dựa trên số lượng AS-hop ngắn nhất trên BGP thay vì độ trễ vật lý (latency). Khi đường truyền quốc tế (AAG, APG, v.v.) bảo trì hoặc các ISP peering định tuyến lệch, gói tin từ Việt Nam bị đẩy sang Nhật Bản (`NRT`) thay vì Singapore (`SIN`) hay Hồng Kông (`HKG`).
2. **WebSocket State Invalidation**: WebSocket gắn liền với một phiên (session) cụ thể trong bộ nhớ RAM của một Node. Nếu ngắt kết nối đột ngột để reconnect sang Node khác, toàn bộ trạng thái trong trận (vị trí, kg, điểm số, combo, kills) sẽ bị mất hoặc giật khựng.

---

## 2. Kiến Trúc Giải Pháp Đã Triển Khai & Kiểm Chứng (100% Smooth)

### 2.1 Phát Hiện PoP (Edge Colo Detection) & Đánh Giá Chất Lượng Tuyến
- **Nhận diện Colo**: Cloudflare Worker trả về mã sân bay của PoP gần nhất qua `request.cf?.colo` (hoặc header `cf-ray`).
- **Phân loại chất lượng theo khu vực địa lý**:
  - `SIN` (Singapore): **Tối ưu nhất** (Ping ~32 - 40ms) -> Giữ nguyên kết nối, đánh dấu xanh lá.
  - `HKG` (Hồng Kông): **Nhanh & Ổn định** (Ping ~65 - 75ms) -> Giữ nguyên kết nối, đánh dấu xanh lá.
  - `NRT`, `KIX`, `ICN`...: **Độ trễ cao** (Ping > 90ms) -> Kích hoạt cơ chế tự động chuyển tuyến.

---

### 2.2 Quy Trình Chuyển Tuyến Không Gián Đoạn (Zero-Downtime Hot Handover)

Thay vì ngắt WebSocket hiện tại (hard reconnect), hệ thống thực hiện Hot Handover 4 bước:

```
[Client (NRT - Ping 110ms)]                     [Server NRT]                      [Server SIN]
         |                                           |                                  |
         | 1. Phát hiện NRT, mở WS ngầm             |                                  |
         |----------------------------------------------------------------------------->|
         |                                           |                                  |
         | 2. Gửi Handshake ngầm (token, playerId)   |                                  |
         |----------------------------------------------------------------------------->|
         |                                           |                                  |
         | 3. Đồng bộ State Snapshot từ NRT sang SIN |                                  |
         |                                           |<================================>|
         |                                           |   (Chuyển giao thực thể & điểm)  |
         |                                           |                                  |
         | 4. Bàn giao Input & Frame sang SIN       |                                  |
         |<============================================================================>|
         | (Lập tức đóng WS NRT cũ, không gián đoạn khung hình, không mất kg / vị trí)  |
```

#### Chi tiết kỹ thuật:
1. **WS Dual-Connect Guard**: Client giữ kết nối đang chơi trên `NRT` tiếp tục gửi nhận gói tin di chuyển, song song mở một kênh WebSocket thứ 2 trỏ thẳng về endpoint tối ưu (`SIN`).
2. **Seamless Handover Token**: Client gửi gói tin `{ t: 'hot-handover', playerId, token, lastSeq }`.
3. **Instant Switchover**: Khi kênh WebSocket mới nhận được xác nhận `{ t: 'handover-ack' }`, Client trỏ con trỏ transport sang socket mới trong đúng **1 tick (16ms)**, sau đó ngắt socket cũ.
4. **Kết quả**: Người chơi không hề bị đứng màn hình, không bị bay về sảnh, ping giảm tức thì từ **~110ms xuống ~35ms** ngay giữa trận đấu!

---

### 2.3 Bộ Đệm Chống Biến Động Mạng (Adaptive Jitter Buffer)
- **Vấn đề tại quán cà phê & 4G/5G**: Ping trung bình có thể thấp nhưng độ lệch gói (jitter) lớn, gây hiện tượng nhân vật giật thụt lùi (rubberbanding).
- **Giải pháp**:
  - Áp dụng Client-side Adaptive Jitter Buffer tự động co giãn từ 1.0x đến 1.5x tick rate tùy theo độ lệch chuẩn của RTT.
  - Sử dụng Hermite Spline / Dead Reckoning để nội suy mượt mà vị trí của đối thủ giữa 2 snapshot server.

---

### 2.4 Giao Diện Hiển Thị Trực Quan Cho Game (UX/UI Best Practice)
1. **Chỉ số 3-trong-1 minh bạch**:
   - `FPS`: Xanh khi $\ge 55$, Vàng khi $30 - 54$, Đỏ khi $< 30$.
   - `Ping ms`: Xanh khi $\le 70\text{ms}$, Vàng khi $71 - 140\text{ms}$, Đỏ khi $> 140\text{ms}$.
   - `Colo Badge`: Hiển thị rõ trạm kết nối (`SIN` / `HKG` / `NRT`).
2. **Tương tác 1-chạm**: Người chơi có thể nhấp trực tiếp vào cụm chỉ số mạng để kích hoạt dò tuyến tức thì nếu cảm thấy mạng giật lag.

---

## 3. Checklist Triển Khai Cho Các Game Kế Tiếp
- [x] Luôn trả về header `cf-colo` hoặc gửi thông tin `colo` trong gói tin `join-ack` / `hello`.
- [x] Thiết lập DNS fallback hoặc subdomain chuyên biệt định tuyến khu vực Đông Nam Á.
- [x] Không bao giờ đóng kết nối cũ trước khi kết nối mới sẵn sàng nhận input stream.
- [x] Áp dụng client prediction + server reconciliation với sequence number để chống giật khi chuyển socket.
