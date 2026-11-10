"""
Generate static Vietnamese Voice Announcer MP3 clips for Cowboy Arcade (Cao bồi kéo bò)
using VieNeu-TTS v3 Turbo (ONNX CPU, 48kHz).

Preset voices used:
- "Thùy Dung" (Nữ · Miền Nam · Tin tức): Rõ chữ, dứt khoát, giàu năng lượng cho các hiệu lệnh bắt trúng, vuột mất, jackpot & điểm số thần thú.
- "Thục Đoan" (Nữ · Miền Nam · Kể chuyện): Ngọt ngào, truyền cảm, tươi vui cho chào mừng vào game, cửa hàng & thông báo trợ cấp.
"""

import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf
from vieneu.v3turbo import V3TurboVieNeuTTS

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "voices" / "vi"

COWBOY_VOICE_LINES: list[tuple[str, str, str]] = [
    # 1. Bắt trúng & Vuột mất (theo đúng yêu cầu ngắn gọn, biểu cảm)
    ("cowboy_catch", "Thùy Dung", "Đã bắt trúng rồi!"),
    ("cowboy_miss", "Thùy Dung", "Vuột mất rồi!"),

    # 2. Chào mừng & Cửa hàng & Trợ cấp (Thục Đoan ngọt ngào, tươi vui)
    ("cowboy_welcome", "Thục Đoan", "Chào mừng đến với cao bồi kéo bò!"),
    ("cowboy_shop_welcome", "Thục Đoan", "Chào mừng đến với cửa hàng nông trại! Hãy chọn vật phẩm hỗ trợ đắc lực nhé!"),
    ("cowboy_empty", "Thục Đoan", "Hết credit rồi! Hãy nhận trợ cấp để chơi tiếp nhé!"),

    # 3. Trúng lớn / Cầu vồng / Lấp lánh x2 (Thùy Dung dứt khoát)
    ("cowboy_jackpot", "Thùy Dung", "Trúng lớn rồi! Siêu thú cầu vồng!"),
    ("cowboy_hit_sparkle", "Thùy Dung", "Trúng thú lấp lánh rồi! Nhân đôi điểm số!"),

    # 4. Các thần thú tiến hóa điểm cao
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

def normalize_peak(wav: np.ndarray, target_peak: float = 0.92) -> np.ndarray:
    """Chuẩn hóa âm lượng và cắt khoảng lặng thừa ở 2 đầu."""
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
    print(f"[*] Khởi tạo VieNeu-TTS v3 Turbo ONNX (CPU)...")
    t0 = time.time()
    tts = V3TurboVieNeuTTS(backend="onnx", precision="fp32")
    print(f"[+] Model sẵn sàng sau {time.time() - t0:.1f}s. Xuất file tới: {OUT_DIR}")

    total = len(COWBOY_VOICE_LINES)
    for idx, (key, voice_name, text) in enumerate(COWBOY_VOICE_LINES, 1):
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
        dur_s = len(wav) / tts.sample_rate
        size_kb = out_path.stat().st_size / 1024.0
        print(f"[{idx:02d}/{total:02d}] {key}.mp3 ({voice_name}) -> '{text}' ({dur_s:.2f}s | {size_kb:.1f} KB | {elapsed:.2f}s)")

    tts.close()
    print("[+] Hoàn tất sinh toàn bộ 16 file voice cao bồi bằng VieNeu-TTS v3 Turbo!")

if __name__ == "__main__":
    main()
