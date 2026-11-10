"""
Generate static Vietnamese Voice Announcer MP3 clips for Farm Brawl using VieNeu-TTS v3 Turbo.
Uses Southern Female voices:
  - "Thùy Dung" (Nữ · Nam · Phong cách tin tức): Rõ chữ, dứt khoát cho thông báo chiến thuật, item, hạ gục & luật chơi.
  - "Thục Đoan" (Nữ · Nam · Phong cách kể chuyện): Truyền cảm, tươi vui cho chào mừng, giờ chơi của bé, sự kiện lễ hội & phần thưởng.
"""

import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf
from vieneu.v3turbo import V3TurboVieNeuTTS

OUT_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "voices" / "vi"

SPECIES_VI: dict[str, str] = {
    "chicken": "Gà",
    "sheep": "Cừu",
    "horse": "Ngựa",
    "cow": "Bò",
    "duck": "Vịt",
    "pig": "Heo",
    "dog": "Chó",
    "elephant": "Voi",
    "monkey": "Khỉ",
    "gorilla": "Khỉ đột",
    "mammoth": "Voi ma mút",
}

CAUSE_BY_VI: dict[str, str] = {
    "fence": "húc vào hàng rào điện",
    "drown": "húc chìm dưới ao nước",
    "well": "húc rơi xuống hố sâu",
    "fire": "húc vào lò lửa",
    "dynamite": "cho nổ tung",
    "crush": "cán dẹp lép",
    "starve": "húc cạn sạch ký",
}

# Danh sách các câu thông báo cố định
BASE_VOICE_LINES: list[tuple[str, str, str]] = [
    # 0. Chào mừng vào trận & Kết thúc giờ chơi của bé (Windy)
    ("welcome", "Thục Đoan", "Chào mừng đến với nông trại!"),
    ("kids_lock", "Thục Đoan", "Kết thúc giờ chơi rồi Windy ơi, hãy nghỉ ngơi một chút nhé!"),
    ("time_1min", "Thục Đoan", "Còn một phút nữa thôi bé ơi!"),
    ("time_30s", "Thục Đoan", "Còn ba mươi giây nữa thôi bé ơi!"),
    ("time_10s", "Thục Đoan", "Còn mười giây nữa là hết giờ chơi rồi!"),

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
    ("self_heart_get", "Thục Đoan", "Trái tim bảo hộ!"),
    ("self_revive", "Thục Đoan", "Trái tim bảo hộ kích hoạt! Chuẩn bị hồi sinh!"),
    ("self_streak", "Thùy Dung", "Hạ gục liên hoàn! Không ai cản nổi bạn!"),
    ("match_win", "Thục Đoan", "Chiến thắng chung cuộc! Xin chúc mừng!"),

    # Nhóm E: Các Item Đặc Biệt ngắn gọn 2-3 từ
    ("item_speed", "Thùy Dung", "Giày tăng tốc!"),
    ("item_dynamite", "Thùy Dung", "Pháo thuốc nổ!"),
    ("item_shield", "Thùy Dung", "Khiên bảo vệ!"),
    ("item_pitchfork", "Thùy Dung", "Chĩa ba cướp ký!"),
    ("item_wheel", "Thùy Dung", "Bánh xe càn quét!"),
    ("item_star", "Thục Đoan", "Trứng thần hộ vệ!"),
    ("item_heart", "Thục Đoan", "Trái tim bảo hộ!"),
    ("item_banana_monkey", "Thục Đoan", "Biến hình Khỉ!"),
    ("item_banana_elephant", "Thục Đoan", "Biến hình Voi!"),

    # Nhóm F: Hạ gục đối thủ (KO)
    ("ko_double", "Thùy Dung", "Hai mạng liên tiếp!"),
    ("ko_generic", "Thùy Dung", "Đã hạ gục đối thủ!"),
    ("ko_chicken", "Thùy Dung", "Đã hạ gục Gà!"),
    ("ko_sheep", "Thùy Dung", "Đã hạ gục Cừu!"),
    ("ko_horse", "Thùy Dung", "Đã hạ gục Ngựa!"),
    ("ko_cow", "Thùy Dung", "Đã hạ gục Bò!"),
    ("ko_duck", "Thùy Dung", "Đã hạ gục Vịt!"),
    ("ko_pig", "Thùy Dung", "Đã hạ gục Heo!"),
    ("ko_dog", "Thùy Dung", "Đã hạ gục Chó!"),
    ("ko_elephant", "Thùy Dung", "Đã hạ gục Voi!"),
    ("ko_monkey", "Thùy Dung", "Đã hạ gục Khỉ!"),
    ("ko_gorilla", "Thùy Dung", "Đã hạ gục Khỉ đột!"),
    ("ko_mammoth", "Thùy Dung", "Đã hạ gục Voi ma mút!"),

    # Nhóm G: Lý do tự chết do địa hình (Self Death Causes)
    ("die_self_fence", "Thùy Dung", "Bạn tự lao vào hàng rào điện!"),
    ("die_self_drown", "Thùy Dung", "Bạn bị chìm dưới ao nước!"),
    ("die_self_well", "Thùy Dung", "Bạn rơi xuống đáy hố sâu!"),
    ("die_self_fire", "Thùy Dung", "Bạn lao đầu vào lò lửa!"),
    ("die_self_starve", "Thùy Dung", "Bạn đã kiệt sức vì đói!"),
    ("die_self_till", "Thùy Dung", "Bạn bị xe máy cày cán dẹp lép!"),
    ("die_self_dynamite", "Thùy Dung", "Bạn bị pháo nổ tung!"),
    ("die_self_crush", "Thùy Dung", "Bạn đã bị cán dẹp lép!"),

    # Nhóm H: Cao bồi kéo bò (Cowboy Arcade Minigame)
    ("cowboy_catch", "Thùy Dung", "Đã bắt trúng rồi!"),
    ("cowboy_miss", "Thùy Dung", "Vuột mất rồi!"),
    ("cowboy_welcome", "Thục Đoan", "Chào mừng đến với cao bồi kéo bò!"),
    ("cowboy_shop_welcome", "Thục Đoan", "Chào mừng đến với cửa hàng nông trại! Hãy chọn vật phẩm hỗ trợ đắc lực nhé!"),
    ("cowboy_empty", "Thục Đoan", "Hết credit rồi! Hãy nhận trợ cấp để chơi tiếp nhé!"),
    ("cowboy_jackpot", "Thùy Dung", "Trúng lớn rồi! Siêu thú cầu vồng!"),
    ("cowboy_hit_sparkle", "Thùy Dung", "Trúng thú lấp lánh rồi! Nhân đôi điểm số!"),
    ("cowboy_hit_swan", "Thùy Dung", "Dính Thiên Nga rồi! Cộng hai mươi điểm!"),
    ("cowboy_hit_ram", "Thùy Dung", "Dính Cừu Kim Cương rồi! Cộng hai mươi lăm điểm!"),
    ("cowboy_hit_wolf", "Thùy Dung", "Dính Sói Băng rồi! Cộng ba mươi điểm!"),
    ("cowboy_hit_boar", "Thùy Dung", "Dính Heo Rừng rồi! Cộng ba mươi lăm điểm!"),
    ("cowboy_hit_gorilla", "Thùy Dung", "Dính Khỉ Đột rồi! Cộng bốn mươi điểm!"),
    ("cowboy_hit_bull", "Thùy Dung", "Dính Bò Tót rồi! Cộng năm mươi điểm!"),
    ("cowboy_hit_pegasus", "Thùy Dung", "Dính Kỳ Lân rồi! Cộng sáu mươi điểm!"),
    ("cowboy_hit_phoenix", "Thùy Dung", "Bắt được Phượng Hoàng rồi! Cộng tám mươi điểm!"),
    ("cowboy_hit_mammoth", "Thùy Dung", "Trúng Voi Ma Mút rồi! Một trăm điểm cực khủng!"),
]


def build_all_voice_lines() -> list[tuple[str, str, str]]:
    lines = list(BASE_VOICE_LINES)
    # Nhóm I: Bị con vật khác hạ gục (11 con vật x 7 nguyên nhân)
    for sp_key, sp_vi in SPECIES_VI.items():
        for cause_key, cause_vi in CAUSE_BY_VI.items():
            key = f"die_{sp_key}_{cause_key}"
            text = f"Bạn bị {sp_vi} {cause_vi}!"
            lines.append((key, "Thùy Dung", text))
    return lines


def normalize_peak(wav: np.ndarray, target_peak: float = 0.92) -> np.ndarray:
    """Chuẩn hóa âm lượng đồng đều và cắt khoảng lặng thừa ở 2 đầu."""
    wav = np.asarray(wav, dtype=np.float32)
    nonzero = np.flatnonzero(np.abs(wav) > 0.008)
    if nonzero.size > 0:
        pad = int(0.035 * 48000)
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

    all_lines = build_all_voice_lines()
    pending = [item for item in all_lines if force or not (OUT_DIR / f"{item[0]}.mp3").exists()]
    print(f"[*] Tổng số câu: {len(all_lines)} | Cần sinh mới: {len(pending)}")
    if not pending:
        print("[+] Tất cả file âm thanh đã tồn tại!")
        return

    print(f"[*] Khởi tạo VieNeu-TTS v3 Turbo (ONNX CPU, precision={precision})...")
    t0 = time.time()
    tts = V3TurboVieNeuTTS(backend="onnx", precision=precision)
    print(f"[+] Model sẵn sàng sau {time.time() - t0:.1f}s. Thư mục xuất: {OUT_DIR}")

    total = len(pending)
    for idx, (key, voice_name, text) in enumerate(pending, 1):
        out_path = OUT_DIR / f"{key}.mp3"
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
        print(f"[{idx:03d}/{total:03d}] {key}.mp3 ({voice_name}) -> {dur_s:.2f}s | {size_kb:.1f} KB | gen: {elapsed:.2f}s")

    tts.close()
    print("[+] Hoàn tất sinh toàn bộ gói âm thanh thông báo!")


if __name__ == "__main__":
    main()
