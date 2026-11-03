"""
Generate static Vietnamese Voice Announcer MP3 clips for Farm Brawl using VieNeu-TTS v3 Turbo.
Uses Southern Female voices:
  - "Thùy Dung" (Nữ · Nam · Phong cách tin tức): Rõ chữ, dứt khoát cho thông báo chiến thuật & luật chơi.
  - "Thục Đoan" (Nữ · Nam · Phong cách kể chuyện): Truyền cảm, tươi vui cho sự kiện lễ hội & phần thưởng.
"""

import os
import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf
from vieneu.v3turbo import V3TurboVieNeuTTS

OUT_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "voices" / "vi"

# Danh sách 28 câu thông báo quan trọng (Không đọc tên người chơi, ngắn gọn, súc tích)
VOICE_LINES: list[tuple[str, str, str]] = [
    # (key, voice_name, text)
    # Nhóm A: Vương quyền & Bục Vinh Quang
    ("king_you", "Thùy Dung", "Bạn đã lên ngôi Vua nông trại! Hãy ban hành điều răn mới!"),
    ("king_new", "Thùy Dung", "Ngai vàng đã có chủ mới! Hãy cẩn thận!"),
    ("king_fell", "Thùy Dung", "Vua nông trại đã bị lật đổ! Ngai vàng đang bỏ trống!"),
    ("song_you", "Thùy Dung", "Cảnh báo! Cả trại đang nổi dậy, bạn bị suy yếu!"),
    ("song_all", "Thùy Dung", "Tiếng hát tổng tấn công vang lên! Vua đang suy yếu, mau xông lên!"),
    ("pod_lock", "Thùy Dung", "Chú ý! Bục vinh quang sắp khóa!"),
    ("pod_open", "Thùy Dung", "Bục vinh quang sắp mở lại, chuẩn bị tranh ngôi!"),

    # Nhóm B: Điều răn của Vua (Commandment Rules)
    ("rule_poultry", "Thùy Dung", "Điều răn mới: Thế giới gia cầm! Tất cả biến thành gà và vịt!"),
    ("rule_titan", "Thùy Dung", "Điều răn mới: Titan đại chiến! Tất cả hóa khổng lồ một ngàn ký!"),
    ("rule_equal", "Thùy Dung", "Điều răn mới: Chúng sinh bình đẳng! Mọi con vật trở về ba mươi ký!"),
    ("rule_tax", "Thùy Dung", "Điều răn mới: Thu thuế! Cả trại phải nộp cân nặng cho Vua!"),
    ("rule_sunday", "Thùy Dung", "Điều răn mới: Họp ngày chủ nhật! Triệu tập toàn bộ về bục trung tâm!"),
    ("rule_snowball", "Thùy Dung", "Điều răn mới: Lệnh truy nã! Hạ kẻ phản bội nhận thưởng gấp ba!"),
    ("rule_till", "Thùy Dung", "Cảnh báo! Xe máy cày đang càn quét nông trại, mau tránh đường!"),
    ("rule_dice", "Thục Đoan", "Điều răn mới: Đổ xúc xắc may mắn, nhận thưởng hàng trăm ký!"),
    ("rule_womenday", "Thục Đoan", "Sự kiện đặc biệt: Hoa khổng lồ đã nở rộ khắp nông trại!"),
    ("rule_halloween", "Thục Đoan", "Sự kiện đặc biệt: Bão bí ngô ma thuật đã xuất hiện!"),
    ("rule_corn", "Thùy Dung", "Điều răn mới: Bắp là của heo! Heo và Vua ăn bắp gấp ba!"),
    ("rule_squealer", "Thùy Dung", "Điều răn mới: Vương miện giả khắp nơi, thật giả bất phân!"),
    ("rule_twoleg", "Thùy Dung", "Điều răn mới: Gia cầm hai chân bị húc văng gấp đôi!"),
    ("rule_fourleg", "Thùy Dung", "Điều răn mới: Thú bốn chân tăng mạnh lực húc!"),

    # Nhóm C: Biến cố Bản đồ & Sự kiện Toàn trại
    ("map_warn", "Thùy Dung", "Chú ý! Địa hình nông trại sắp dịch chuyển!"),
    ("map_shift", "Thục Đoan", "Địa hình và vật phẩm đã được làm mới!"),
    ("super_spawn", "Thục Đoan", "Kẹo cầu vồng vừa rơi xuống nông trại!"),

    # Nhóm D: Đột phá & Sinh tử của Chính Người Chơi
    ("self_super", "Thục Đoan", "Hóa siêu thú cầu vồng! Bấm húc để bay như tên lửa!"),
    ("self_gorilla", "Thùy Dung", "Đột phá ba tấn! Tiến hóa thành Khỉ đột khổng lồ!"),
    ("self_mammoth", "Thùy Dung", "Đột phá ba tấn! Tiến hóa thành Voi ma mút cổ đại!"),
    ("self_heart_get", "Thục Đoan", "Đã nhận trái tim bảo hộ! Tự động hồi sinh khi gặp nạn!"),
    ("self_revive", "Thục Đoan", "Trái tim bảo hộ kích hoạt! Chuẩn bị hồi sinh!"),
    ("self_streak", "Thùy Dung", "Hạ gục liên hoàn! Không ai cản nổi bạn!"),
    ("match_win", "Thục Đoan", "Chiến thắng chung cuộc! Xin chúc mừng!"),
]


def normalize_peak(wav: np.ndarray, target_peak: float = 0.92) -> np.ndarray:
    """Chuẩn hóa âm lượng đồng đều và cắt khoảng lặng thừa ở 2 đầu."""
    wav = np.asarray(wav, dtype=np.float32)
    nonzero = np.flatnonzero(np.abs(wav) > 0.008)
    if nonzero.size > 0:
        pad = int(0.04 * 48000)
        start = max(0, int(nonzero[0]) - pad)
        end = min(len(wav), int(nonzero[-1]) + pad)
        wav = wav[start:end]
    peak = float(np.max(np.abs(wav))) if wav.size > 0 else 0.0
    if peak > 1e-4:
        wav = wav * (target_peak / peak)
    return np.clip(wav, -1.0, 1.0)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    force = "--force" in sys.argv
    precision = "int8" if "--int8" in sys.argv else "fp32"

    print(f"[*] Khởi tạo VieNeu-TTS v3 Turbo (ONNX CPU, precision={precision})...")
    t0 = time.time()
    tts = V3TurboVieNeuTTS(backend="onnx", precision=precision)
    print(f"[+] Model sẵn sàng sau {time.time() - t0:.1f}s. Thư mục xuất: {OUT_DIR}")

    total = len(VOICE_LINES)
    for idx, (key, voice_name, text) in enumerate(VOICE_LINES, 1):
        out_path = OUT_DIR / f"{key}.mp3"
        if out_path.exists() and not force:
            print(f"[{idx:02d}/{total:02d}] Bỏ qua (đã có): {key}.mp3")
            continue

        t_start = time.time()
        wav = tts.infer(
            text=text,
            voice=voice_name,
            temperature=0.75,
            apply_watermark=False,
        )
        wav = normalize_peak(wav)
        sf.write(str(out_path), wav, tts.sample_rate, format="MP3")
        elapsed = time.time() - t_start
        size_kb = out_path.stat().st_size / 1024.0
        dur_s = len(wav) / tts.sample_rate
        print(f"[{idx:02d}/{total:02d}] {key}.mp3 ({voice_name}) -> {dur_s:.2f}s | {size_kb:.1f} KB | gen: {elapsed:.2f}s")

    tts.close()
    print("[+] Hoàn tất sinh toàn bộ gói âm thanh thông báo!")


if __name__ == "__main__":
    main()
