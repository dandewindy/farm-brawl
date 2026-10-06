# Farm Brawl - Quy tắc & Bộ nhớ dự án (Project Rules & Memory)

## 1. Triển khai Cloudflare Workers & Token Authentication
- **Vấn đề đã gặp:** Trong môi trường subshell PowerShell của Antigravity/agent, biến môi trường `CLOUDFLARE_API_TOKEN` không tự động truyền vào process con nếu chỉ lưu ở User/Machine scope trên Windows. Điều này dẫn đến lệnh `wrangler deploy` thất bại ngầm hoặc báo lỗi `"You are not authenticated. Please run wrangler login."`, khiến server Cloudflare tiếp tục chạy mã cũ.
- **Quy tắc bắt buộc khi deploy:**
  Khi chạy `wrangler deploy` hoặc `wrangler whoami`, luôn nạp token trực tiếp từ User Environment:
  ```powershell
  $env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User'); $env:CLOUDFLARE_ACCOUNT_ID = [System.Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User'); npx wrangler deploy
  ```
- **Quy trình build & deploy chuẩn:**
  1. Chạy `npm run build` để sinh bundle mới trong `dist/`.
  2. Nạp token môi trường và chạy deploy từ thư mục `server/`.
  3. Kiểm tra mã băm bundle (hash `index-[hash].js`) trên `https://farm-brawl.farm-brawl.workers.dev` để xác nhận Cloudflare đã nạp bản mới nhất.
  4. Luôn nhắc người dùng nhấn `Ctrl + F5` (hoặc `Ctrl + Shift + R`) để tránh bị cache trình duyệt phục vụ file cũ.

## 2. Kiểm thử và Server Local
- Luôn giữ Vite dev server sẵn sàng tại cổng 5180 (`http://localhost:5180/?mode=offline`) để người dùng có thể test tức thì mà không bị trễ mạng hoặc phụ thuộc vào cloud.
- Trong `client/src/main.ts`, cơ chế `LocalServer` phải luôn là fallback an toàn nếu kết nối WebSocket gặp sự cố.

## 3. Đối chiếu chất lượng Game (Game Mechanics & Bot IQ)
- Bot phải luôn duy trì các hành vi:
  - Tự động né các vùng nguy hiểm (hàng rào điện, giếng nước, lò lửa).
  - Khi rơi xuống nước (không phải vịt), lập tức dash bơi thoát lên bờ trong vòng 3 giây trước khi chìm.
  - Khi đủ cân nặng ($\ge 20$ kg), chủ động tranh giành bục trung tâm và săn lùng Vua Napoleon.
  - Khi làm Vua, cố thủ giữ ngai vàng và húc văng kẻ địch tiếp cận.
- Hoạt ảnh chết / xác chết (CorpseRenderer) phải kích hoạt đúng loại:
  - Nước: giãy giụa 3s + nổi bọt -> chìm lỉm.
  - Hố/Giếng: xoáy tròn + thu nhỏ dần.
  - Điện: giật rung + chớp sáng + cháy đen thui.
  - Lửa: hút vào tâm + hóa than đen + tro tàn.
