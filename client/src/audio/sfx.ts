// Procedural Web Audio synthesizer (100% synthesized in code, zero external audio assets).
// Implements full sound effects, ambient wind/bird chirps, and live sequenced Oom-Pah polka farm march.

import type { Species } from '@shared/constants';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let held = false; // paused on purpose (offline / hidden tab)
let chargeNode: { o: OscillatorNode; g: GainNode; f: BiquadFilterNode } | null = null;
let chargeMaxNode: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode } | null = null;
let ambienceTimer: number | null = null;

export type AudioMode = 0 | 1 | 2; // 0: All On, 1: SFX Only (BGM Off), 2: All Muted

let audioMode: AudioMode = (() => {
  try {
    const saved = localStorage.getItem('fb_audio_mode');
    if (saved === '1') return 1;
    if (saved === '2') return 2;
  } catch (_) {}
  return 0;
})();

let muted = audioMode === 2;

export function getAudioMode(): AudioMode {
  return audioMode;
}

export function setAudioMode(mode: AudioMode): void {
  audioMode = mode;
  try {
    localStorage.setItem('fb_audio_mode', String(mode));
  } catch (_) {}

  if (mode === 0) {
    unlock();
    setMuted(false);
    setMusic(true);
  } else if (mode === 1) {
    unlock();
    setMuted(false);
    setMusic(false);
  } else {
    setMusic(false);
    setMuted(true);
  }
}

export function cycleAudioMode(): AudioMode {
  const next = ((audioMode + 1) % 3) as AudioMode;
  setAudioMode(next);
  return next;
}

export function unlock(): void {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.gain.value = 0.18;
    ambBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // iOS / iPadOS WebKit silent buffer unlock trick:
    try {
      const unlockBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = unlockBuf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
    startAmbience();
    startMusic();
    preloadAnimalAudioBuffers();
  }
  if (ctx && ctx.state === 'suspended' && !held) {
    ctx.resume().catch(() => {});
  }
}

export const unlockAudio = unlock;

export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) {
    master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
  }
}

export const isMuted = () => muted;
const ready = () => ctx !== null && !muted;

// ---------- Building blocks ----------
function env(node: GainNode, t: number, a: number, peak: number, dur: number): void {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  opts: { attack?: number; delay?: number; bus?: GainNode } = {}
): void {
  if (!ctx) return;
  const attack = opts.attack ?? 0.005;
  const delay = opts.delay ?? 0;
  const bus = opts.bus ?? sfxBus!;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, attack, vol, dur);
  o.connect(g);
  g.connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(
  filterType: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  dur: number,
  vol: number,
  opts: { attack?: number; delay?: number; bus?: GainNode } = {}
): void {
  if (!ctx || !noiseBuf) return;
  const attack = opts.attack ?? 0.005;
  const delay = opts.delay ?? 0;
  const bus = opts.bus ?? sfxBus!;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, attack, vol, dur);
  src.connect(f);
  f.connect(g);
  g.connect(bus);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

// ---------- Sound effects ----------
export function dash(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  noise('bandpass', 400, 2200, 1.2, 0.22, 0.35 * vol);
}
export const sfxDash = dash;

// Ram landing: cartoon "bonk" + fur slap + body thud + "boing"
export function hit(strength = 24, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  const k = Math.min(1.6, strength / 24);
  const v = vol * Math.min(1.2, 0.55 + k * 0.45);
  const p = 0.88 + Math.random() * 0.24;
  tone('triangle', 520 * p, 150 * p, 0.16, 0.5 * v);
  tone('square', 260 * p, 90 * p, 0.08, 0.1 * v);
  noise('bandpass', 2600 * p, 900, 1.4, 0.07, 0.5 * v);
  tone('sine', 120 / (0.8 + k * 0.3), 40, 0.26, 0.85 * v);
  if (k > 1.1) tone('sine', 280 * p, 640 * p, 0.2, 0.12 * v, { delay: 0.05 });
}
export const sfxHit = hit;

const SQUEAK: Record<Species, number> = {
  chicken: 1500,
  duck: 900,
  sheep: 700,
  pig: 520,
  cow: 260,
  horse: 380,
  dog: 620,
  elephant: 180,
  monkey: 850,
  gorilla: 140,
  mammoth: 120,
  wolf: 210,
  phoenix: 1200,
  swan: 750,
  ram: 450,
  boar: 320,
  pegasus: 420,
  bull: 160,
};

export function yelp(species: Species, vol = 1): void {
  if (!ready() || vol < 0.05) return;
  const f = SQUEAK[species] || 700;
  tone(species === 'cow' || species === 'bull' ? 'sawtooth' : 'square', f, f * 0.7, 0.16, 0.08 * vol, { attack: 0.02 });
}


const ANIMAL_AUDIO_FILES: Partial<Record<Species, string>> = {
  chicken: '/audio/animals/chicken.mp3',
  phoenix: '/audio/animals/phoenix.mp3',
  duck: '/audio/animals/duck.mp3',
  swan: '/audio/animals/swan.mp3',
  pig: '/audio/animals/pig.mp3',
  boar: '/audio/animals/boar.mp3',
  sheep: '/audio/animals/sheep.mp3',
  ram: '/audio/animals/ram.mp3',
  cow: '/audio/animals/cow.mp3',
  bull: '/audio/animals/bull.mp3',
  horse: '/audio/animals/horse.mp3',
  pegasus: '/audio/animals/pegasus.mp3',
  dog: '/audio/animals/dog.mp3',
  wolf: '/audio/animals/wolf.mp3',
  elephant: '/audio/animals/elephant.mp3',
  mammoth: '/audio/animals/mammoth.mp3',
  monkey: '/audio/animals/monkey.mp3',
  gorilla: '/audio/animals/gorilla.mp3',
};

let listenerX = 0;
let listenerZ = 0;

export function updateAudioListener(x: number, z: number): void {
  listenerX = x;
  listenerZ = z;
}

export function computeSpatialVolume(sourceX?: number, sourceZ?: number, baseVol = 1.0): number {
  if (sourceX === undefined || sourceZ === undefined) return baseVol;
  const dx = sourceX - listenerX;
  const dz = sourceZ - listenerZ;
  const dist = Math.hypot(dx, dz);
  // Ngoài bán kính 70m: triệt tiêu âm lượng hoàn toàn để tránh spam âm thanh
  if (dist > 70) return 0;
  // Bán kính gần <= 12m: nghe rõ 100% âm lượng
  if (dist <= 12) return baseVol;
  // Giảm âm lượng tuyến tính êm ái từ 12m -> 70m
  const falloff = Math.max(0, 1 - (dist - 12) / 58);
  return baseVol * falloff;
}

const lastCryTime: Partial<Record<Species, number>> = {};

const animalBufferCache = new Map<Species, AudioBuffer>();
let isPreloadingAnimals = false;

function preloadAnimalAudioBuffers(): void {
  if (!ctx || isPreloadingAnimals) return;
  isPreloadingAnimals = true;
  for (const [sp, url] of Object.entries(ANIMAL_AUDIO_FILES)) {
    if (!url) continue;
    fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((arr) => {
        if (!arr || !ctx) return;
        return ctx.decodeAudioData(arr);
      })
      .then((buf) => {
        if (buf) animalBufferCache.set(sp as Species, buf);
      })
      .catch(() => {});
  }
}

export function sfxCountdownTick(sec: number): void {
  if (!ready() || muted) return;
  const isFinal = sec <= 3;
  const freq = isFinal ? 1046.5 : (sec <= 5 ? 880 : 740);
  tone('sine', freq, freq * 1.05, 0.08, 0.35, { attack: 0.005 });
  tone('triangle', freq * 1.5, freq * 0.9, 0.06, 0.22, { attack: 0.005, delay: 0.01 });
}

export function playSpeciesAudio(species: Species, vol = 1, x?: number, z?: number): void {
  if (muted) return;
  const effectiveVol = (x !== undefined && z !== undefined) ? computeSpatialVolume(x, z, vol) : vol;
  if (effectiveVol < 0.04) return;
  const src = ANIMAL_AUDIO_FILES[species];
  if (!src) return;

  // Rate-limiter chống đè âm / echo: cùng một loài không phát liên tiếp trong 350ms
  const now = performance.now();
  if (now - (lastCryTime[species] || 0) < 350) return;
  lastCryTime[species] = now;

  // 1. Phát qua Web Audio buffer (100% không bị chính sách autoplay của iPad / Safari chặn)
  if (ctx && animalBufferCache.has(species)) {
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const buf = animalBufferCache.get(species)!;
      const source = ctx.createBufferSource();
      source.buffer = buf;
      const gain = ctx.createGain();
      const targetGain = Math.min(1.0, Math.max(0, effectiveVol * 0.9));
      gain.gain.setValueAtTime(targetGain, ctx.currentTime);
      source.connect(gain);
      gain.connect(sfxBus || master || ctx.destination);
      source.start(0);

      // Tự động fade out sau 2.8s cho Web Audio đối với các file dài
      const fadeStartTime = ctx.currentTime + 2.8;
      gain.gain.setValueAtTime(targetGain, fadeStartTime);
      gain.gain.linearRampToValueAtTime(0.001, fadeStartTime + 0.4);
      setTimeout(() => {
        try {
          source.stop();
          source.disconnect();
          gain.disconnect();
        } catch (_) {}
      }, 3400);
      return;
    } catch (_) {}
  }

  // 2. Fallback sang HTML5 Audio nếu buffer chưa kịp decode xong
  try {
    const audio = new Audio(src);
    audio.volume = Math.min(1.0, Math.max(0, effectiveVol * 0.9));
    audio.play().catch(() => {});
    // Tự động fade out sau 2.8s đối với các file dài để giữ nhịp độ trận đấu luôn dồn dập, gãy gọn
    setTimeout(() => {
      try {
        if (!audio.paused) {
          const fade = setInterval(() => {
            if (audio.volume > 0.08) {
              audio.volume = Math.max(0, audio.volume - 0.08);
            } else {
              clearInterval(fade);
              audio.pause();
            }
          }, 50);
        }
      } catch (_) {}
    }, 2800);
  } catch (_) {}
}

export function sfxPhoenixCry(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Phượng Hoàng Lửa hót réo rắt thiên đình ngân vang đa tầng
  tone('triangle', 880, 2400, 0.75, 0.55 * vol, { attack: 0.03 });
  tone('sawtooth', 1400, 850, 0.95, 0.45 * vol, { delay: 0.12, attack: 0.04 });
  tone('sine', 1760, 2640, 1.20, 0.35 * vol, { delay: 0.25, attack: 0.05 });
  // Tiếng ngọn lửa thần thoại bốc cháy cuồn cuộn
  noise('bandpass', 1600, 480, 2.2, 0.95, 0.45 * vol, { attack: 0.02 });
  // Chuỗi âm chuông vàng thiêng liêng rực rỡ
  [1318, 1760, 2093, 2637].forEach((f, i) => {
    tone('sine', f, f * 1.02, 0.6, 0.22 * vol, { delay: 0.15 + i * 0.08, attack: 0.01 });
  });
}

export function sfxSwanCall(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng kèn hoàng gia thiên nga thánh thót ngân nga vang vọng mặt hồ
  tone('sawtooth', 440, 660, 0.65, 0.55 * vol, { attack: 0.05 });
  tone('triangle', 660, 587, 0.75, 0.48 * vol, { delay: 0.20, attack: 0.04 });
  tone('sawtooth', 587, 880, 0.95, 0.50 * vol, { delay: 0.45, attack: 0.05 });
  // Tiếng sóng nước dâng trào và tiếng vỗ cánh lướt sóng dạt dào
  noise('bandpass', 750, 320, 2.0, 1.25, 0.38 * vol, { attack: 0.04 });
  // Chuỗi âm giọt nước pha lê thánh khiết
  [880, 1174, 1318, 1760].forEach((f, i) => {
    tone('sine', f, f, 0.7, 0.25 * vol, { delay: 0.30 + i * 0.09, attack: 0.01 });
  });
}

export function sfxRamBash(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng tù và chiến trận cừu thần sừng kim cương rền vang
  tone('sawtooth', 175, 350, 0.85, 0.65 * vol, { attack: 0.04 });
  tone('triangle', 350, 262, 0.95, 0.55 * vol, { delay: 0.25, attack: 0.05 });
  // Tiếng va chạm sừng kim cương cực đại tạo sóng xung kích nổ sét
  tone('square', 280, 60, 0.45, 0.75 * vol, { delay: 0.05, attack: 0.003 });
  noise('highpass', 2400, 1200, 1.2, 0.55, 0.60 * vol, { delay: 0.05, attack: 0.003 });
  tone('sine', 95, 40, 1.2, 0.85 * vol, { delay: 0.06, attack: 0.01 });
}

export function sfxBoarGrunt(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng gầm gừ hung tợn sâu thẳm trong cuống họng của heo rừng
  tone('sawtooth', 140, 65, 0.75, 0.70 * vol, { attack: 0.03 });
  tone('square', 95, 40, 0.85, 0.60 * vol, { delay: 0.08, attack: 0.04 });
  // Sub-bass rung lồng ngực
  tone('sine', 55, 28, 1.10, 0.95 * vol, { attack: 0.02 });
  // Tiếng nanh sắt cọ xát ken két và tiếng khịt mũi thở phì phò cày đất
  noise('bandpass', 550, 180, 3.2, 0.85, 0.55 * vol, { attack: 0.02 });
}

export function sfxPegasusNeigh(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng ngựa thần Pegasus hí vang trời sấm sét rền vang
  tone('sawtooth', 620, 1650, 0.75, 0.60 * vol, { attack: 0.03 });
  tone('triangle', 1650, 1100, 0.85, 0.50 * vol, { delay: 0.22, attack: 0.04 });
  tone('sine', 1100, 1760, 0.95, 0.40 * vol, { delay: 0.45, attack: 0.03 });
  // Tiếng sấm sét sải cánh xuyên tầng mây
  tone('sine', 120, 35, 1.4, 0.85 * vol, { attack: 0.02 });
  noise('lowpass', 650, 280, 2.0, 0.75, 0.35 * vol, { attack: 0.03 });
  // Chuỗi âm sao băng lấp lánh
  [1046, 1318, 1568, 2093].forEach((f, i) => {
    tone('sine', f, f * 1.05, 0.55, 0.25 * vol, { delay: 0.35 + i * 0.07, attack: 0.01 });
  });
}

export function sfxBullRoar(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng rống sấm sét địa chấn rung chuyển mặt đất của bò mộng đấu trường
  tone('sawtooth', 110, 42, 1.35, 0.80 * vol, { attack: 0.06 });
  tone('triangle', 75, 38, 1.45, 0.65 * vol, { delay: 0.15, attack: 0.08 });
  tone('sine', 48, 22, 1.65, 1.00 * vol, { attack: 0.05 });
  // Tiếng móng guốc dậm đất rung chuyển cực mạnh và tiếng thở nộ khí
  noise('bandpass', 320, 110, 3.8, 1.20, 0.65 * vol, { attack: 0.04 });
}

export function sfxGorillaRoar(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng đấm ngực thùm thụp liên hoàn của Vua Khỉ Đột King Kong
  [0.0, 0.14, 0.28, 0.42].forEach((delay) => {
    tone('sine', 120, 38, 0.22, 0.85 * vol, { delay, attack: 0.005 });
    noise('lowpass', 350, 120, 2.0, 0.18, 0.55 * vol, { delay, attack: 0.005 });
  });
  // Tiếng gầm King Kong vang dội núi rừng
  tone('sawtooth', 110, 48, 1.10, 0.75 * vol, { delay: 0.25, attack: 0.05 });
  tone('sine', 65, 32, 1.30, 0.90 * vol, { delay: 0.25, attack: 0.04 });
}

export function sfxMammothRoar(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng tù và vòi voi khổng lồ rền vang 1.8s xé rách không gian
  tone('sawtooth', 140, 340, 1.65, 0.75 * vol, { attack: 0.08 });
  tone('sawtooth', 210, 480, 1.45, 0.60 * vol, { attack: 0.10 });
  tone('sine', 68, 32, 1.80, 1.05 * vol, { attack: 0.06 });
  noise('bandpass', 520, 220, 4.0, 1.50, 0.55 * vol, { attack: 0.06 });
}

export function sfxWolfHowl(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  // Tiếng sói thần đầu đàn hú vang trăng sao cô độc và dũng mãnh ngân dài 2.0s
  tone('sawtooth', 220, 520, 0.65, 0.60 * vol, { attack: 0.08 });
  tone('triangle', 520, 440, 0.95, 0.65 * vol, { delay: 0.35, attack: 0.06 });
  tone('sine', 330, 180, 0.85, 0.50 * vol, { delay: 0.85, attack: 0.05 });
  noise('bandpass', 650, 280, 3.2, 1.40, 0.40 * vol, { attack: 0.06 });
}

export function sfxWolfBite(vol = 1, rainbow = false): void {
  if (!ready() || vol < 0.03) return;
  tone('sawtooth', rainbow ? 480 : 320, 95, 0.14, 0.55 * vol, { attack: 0.004 });
  tone('square', rainbow ? 720 : 540, 140, 0.09, 0.32 * vol, { attack: 0.003 });
  noise('bandpass', 2400, 680, 2.2, 0.11, 0.55 * vol, { attack: 0.003 });
  if (rainbow) {
    tone('triangle', 880, 1560, 0.11, 0.28 * vol, { delay: 0.02, attack: 0.005 });
  }
}

export function playSpeciesCry(species: Species, vol = 1, x?: number, z?: number): void {
  playSpeciesAudio(species, vol, x, z);
  playSpeciesAudio(species, vol);
  switch (species) {
    case 'phoenix': sfxPhoenixCry(vol); break;
    case 'swan': sfxSwanCall(vol); break;
    case 'boar': sfxBoarGrunt(vol); break;
    case 'pegasus': sfxPegasusNeigh(vol); break;
    case 'ram': sfxRamBash(vol); break;
    case 'bull': sfxBullRoar(vol); break;
    case 'gorilla': sfxGorillaRoar(vol); break;
    case 'mammoth': sfxMammothRoar(vol); break;
    case 'wolf': sfxWolfHowl(vol); break;
    default: yelp(species, vol); break;
  }
}

// SFX KỸ NĂNG ĐẶC BIỆT CỦA 6 THẦN THÚ
export function sfxPhoenixInferno(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('triangle', superSkill ? 980 : 740, superSkill ? 2800 : 1800, 0.65, 0.65 * vol, { attack: 0.02 });
  noise('bandpass', superSkill ? 2200 : 1400, 450, 2.5, 0.85, 0.70 * vol, { attack: 0.01 });
  tone('sine', 140, 35, 0.9, 0.85 * vol, { attack: 0.01 });
}

export function sfxSwanTidalWave(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  noise('bandpass', superSkill ? 950 : 650, 280, 3.0, 1.2, 0.75 * vol, { attack: 0.03 });
  tone('sawtooth', superSkill ? 520 : 380, superSkill ? 220 : 160, 0.85, 0.60 * vol, { attack: 0.04 });
  tone('sine', 85, 30, 1.1, 0.90 * vol, { attack: 0.02 });
}

export function sfxBoarBulldozer(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('square', superSkill ? 180 : 140, 45, 0.65, 0.75 * vol, { attack: 0.01 });
  noise('lowpass', 550, 180, 3.5, 0.95, 0.85 * vol, { attack: 0.01 });
  tone('sine', 48, 20, 1.3, 1.05 * vol, { attack: 0.01 });
}

export function sfxRamDiamondClash(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('square', superSkill ? 420 : 320, 80, 0.45, 0.85 * vol, { attack: 0.003 });
  noise('highpass', superSkill ? 3200 : 2200, 800, 2.0, 0.65, 0.75 * vol, { attack: 0.003 });
  tone('sine', 110, 30, 1.2, 0.95 * vol, { attack: 0.01 });
}

export function sfxBullEarthStomp(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('sawtooth', superSkill ? 140 : 95, 30, 1.2, 0.85 * vol, { attack: 0.02 });
  tone('sine', 42, 18, 1.6, 1.15 * vol, { attack: 0.01 });
  noise('bandpass', 240, 80, 4.5, 1.4, 0.80 * vol, { attack: 0.02 });
}

export function sfxPegasusSkyFlight(superSkill = false, vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('triangle', superSkill ? 880 : 660, superSkill ? 1760 : 1320, 0.75, 0.55 * vol, { attack: 0.03 });
  noise('bandpass', superSkill ? 1600 : 1100, 380, 2.2, 0.85, 0.50 * vol, { attack: 0.02 });
  tone('sine', 160, 45, 0.85, 0.70 * vol, { attack: 0.02 });
}

export function sfxEvolveFanfare(species: Species, vol = 1, x?: number, z?: number): void {
  if (!ready() || vol < 0.03) return;
  // 1. Dạo đầu bùng nổ năng lượng hoàng kim khải hoàn (C Major Celestial Chord)
  const brassNotes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
  brassNotes.forEach((freq, idx) => {
    tone('sawtooth', freq, freq * 1.005, 1.2 + idx * 0.04, 0.28 * vol, { delay: idx * 0.045, attack: 0.015 });
    tone('triangle', freq, freq, 1.3 + idx * 0.04, 0.20 * vol, { delay: idx * 0.045, attack: 0.01 });
  });

  // 2. Chấn động địa bàn Sub-bass rung chuyển không gian
  tone('sine', 120, 28, 1.6, 1.05 * vol, { delay: 0.02, attack: 0.005 });
  noise('bandpass', 1600, 300, 2.2, 0.95, 0.70 * vol, { delay: 0.03, attack: 0.01 });

  // 3. Chuỗi âm pha lê thần thánh lấp lánh
  [1046.5, 1318.5, 1567.9, 2093.0, 2637.0].forEach((f, i) => {
    tone('sine', f, f * 1.02, 0.8, 0.22 * vol, { delay: 0.18 + i * 0.05, attack: 0.005 });
  });

  // 4. TIẾNG KÊU ĐẶC TRƯNG CỦA CHÍNH LOÀI ĐÓ VANG LÊN HÙNG TRÁNG RÕ RỆT NHẤT (Ngay sau 0.12s, âm lượng 1.65x)
  setTimeout(() => {
    playSpeciesCry(species, 1.65 * vol, x, z);
  }, 120);
}

export function sfxRainbowSuperSkill(species: Species, vol = 1, x?: number, z?: number): void {
  if (!ready() || vol < 0.03) return;
  // 1. Shimmering celestial rainbow scale arpeggio (7 sắc cầu vồng tần số ma thuật rực rỡ)
  const rainbowNotes = [523.25, 659.25, 783.99, 987.77, 1046.50, 1318.51, 1567.98];
  rainbowNotes.forEach((freq, i) => {
    tone('triangle', freq, freq * 1.35, 0.45, 0.35 * vol, { delay: i * 0.022, attack: 0.005 });
    tone('sine', freq * 1.5, freq * 1.8, 0.35, 0.20 * vol, { delay: i * 0.022, attack: 0.005 });
  });

  // 2. Supersonic Sonic-Boom: Luồng xung kích xé gió siêu thanh uy lực
  tone('sine', 140, 28, 1.1, 1.0 * vol, { delay: 0.01, attack: 0.005 });
  noise('bandpass', 3200, 500, 2.0, 0.75, 0.65 * vol, { delay: 0.02, attack: 0.008 });

  // 3. Tiếng xung trận rền vang sấm sét của thần thú
  playSpeciesCry(species, 1.35 * vol, x, z);
}

export function sfxMaxChargeReady(species: Species, vol = 1, x?: number, z?: number): void {
  if (!ready() || vol < 0.03) return;
  // Xung âm năng lượng cực đại khi nén gồng max (Energy Overload Shockwave Pulse)
  tone('triangle', 440, 880, 0.35, 0.45 * vol, { attack: 0.005 });
  tone('sine', 160, 40, 0.65, 0.75 * vol, { attack: 0.005 });
  tone('sawtooth', 880, 1760, 0.25, 0.25 * vol, { attack: 0.01 });
  noise('highpass', 2400, 1200, 1.5, 0.30, 0.35 * vol, { attack: 0.005 });
  playSpeciesCry(species, 0.85 * vol, x, z);
}

function stopChargeMax(): void {
  if (!chargeMaxNode || !ctx) return;
  const { o, lfo, g } = chargeMaxNode;
  chargeMaxNode = null;
  try {
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
    o.stop(ctx.currentTime + 0.08);
    lfo.stop(ctx.currentTime + 0.08);
  } catch (_) {}
}

// Rising whine while a charged ram is winding up; level 0..1
export function chargeUpdate(level: number): void {
  if (!ready() || !ctx) {
    chargeStop();
    return;
  }
  if (!chargeNode) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.value = 0.0001;
    o.connect(f);
    f.connect(g);
    g.connect(sfxBus!);
    o.start();
    chargeNode = { o, g, f };
  }
  const t = ctx.currentTime;
  chargeNode.o.frequency.setTargetAtTime(110 + 330 * level, t, 0.05);
  chargeNode.f.frequency.setTargetAtTime(600 + 2200 * level, t, 0.05);
  chargeNode.g.gain.setTargetAtTime(0.05 + 0.1 * level, t, 0.04);

  // Khi gồng max (level >= 0.95): kích hoạt dao động tụ khí cực đại nén năng lượng rung chuyển trời đất
  if (level >= 0.95 && !chargeMaxNode) {
    const o2 = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    const g2 = ctx.createGain();

    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(440, t);
    o2.frequency.exponentialRampToValueAtTime(880, t + 0.3);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(24, t);
    lfoG.gain.setValueAtTime(65, t);

    g2.gain.setValueAtTime(0.001, t);
    g2.gain.linearRampToValueAtTime(0.28, t + 0.04);

    lfo.connect(lfoG);
    lfoG.connect(o2.frequency);
    o2.connect(g2);
    g2.connect(sfxBus!);

    o2.start();
    lfo.start();
    chargeMaxNode = { o: o2, lfo, g: g2 };
  } else if (level < 0.95 && chargeMaxNode) {
    stopChargeMax();
  }
}

export function chargeStop(): void {
  stopChargeMax();
  if (!chargeNode || !ctx) return;
  const { o, g } = chargeNode;
  chargeNode = null;
  try {
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
    o.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

export function zap(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  for (let i = 0; i < 3; i++) {
    tone('sawtooth', 120 + i * 7, 110, 0.12, 0.25 * vol, { delay: i * 0.08 });
  }
  noise('highpass', 3000, 6000, 0.7, 0.3, 0.25 * vol);
}
export const sfxZap = zap;

// Crisp, punchy "TÕM!" / "ker-plop" water entry drop
export function splash(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  const v = Math.min(1.2, vol);
  // 1. Resonant downward "TÕM" pitch plunge (480Hz -> 95Hz)
  tone('sine', 480, 95, 0.15, 0.9 * v, { attack: 0.003 });
  // 2. Hollow cavity water displacement thump
  tone('sine', 160, 50, 0.2, 0.65 * v, { attack: 0.004 });
  // 3. Crisp wet surface slap
  noise('bandpass', 1700, 650, 2.2, 0.11, 0.45 * v, { attack: 0.004 });
  // 4. Quick secondary droplet pop
  tone('sine', 360, 780, 0.07, 0.28 * v, { delay: 0.05 });
}
export const sfxSplash = splash;

// Submerged underwater drowning & bubbling gurgle sound when completely sunken
export function drown(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  const v = Math.min(1.2, vol);
  // 1. Deep muffled underwater submersion whoosh
  noise('lowpass', 550, 140, 1.4, 0.85, 0.65 * v, { attack: 0.04 });
  // 2. Heavy sinking downward bass
  tone('sine', 170, 42, 0.75, 0.75 * v, { attack: 0.03 });
  // 3. Chain of muffled escaping air bubbles (glug-glub-bloop)
  const gurgles = [
    { start: 240, end: 480, dur: 0.1, del: 0.08, gain: 0.4 },
    { start: 200, end: 420, dur: 0.11, del: 0.22, gain: 0.42 },
    { start: 280, end: 560, dur: 0.1, del: 0.36, gain: 0.38 },
    { start: 340, end: 680, dur: 0.09, del: 0.5, gain: 0.35 },
    { start: 420, end: 840, dur: 0.08, del: 0.64, gain: 0.3 },
  ];
  for (const g of gurgles) {
    tone('sine', g.start, g.end, g.dur, g.gain * v, { delay: g.del });
  }
  // 4. Underwater bubbling murmur
  noise('bandpass', 850, 320, 2.5, 0.65, 0.35 * v, { delay: 0.14 });
}
export const sfxDrown = drown;

export function fall(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  tone('sine', 900, 120, 0.9, 0.25 * vol);
  tone('sine', 70, 40, 0.3, 0.6 * vol, { delay: 0.9 });
  noise('lowpass', 1200, 200, 0.7, 0.3, 0.3 * vol, { delay: 0.9 });
}
export const sfxFall = fall;

export function burn(vol = 1): void {
  if (!ready() || vol < 0.03) return;
  noise('lowpass', 400, 1800, 0.8, 0.9, 0.6 * vol, { attack: 0.08 });
  for (let i = 0; i < 6; i++) {
    noise('highpass', 2500, 4000, 1, 0.04, 0.25 * vol, { delay: 0.1 + Math.random() * 0.7 });
  }
}
export const sfxBurn = burn;

let lastEat = 0;
export function eat(big = false): void {
  if (!ready() || !ctx) return;
  const now = ctx.currentTime;
  if (now - lastEat < 0.05) return;
  lastEat = now;
  const f = big ? 880 : 520 + Math.random() * 180;
  tone('triangle', f, f * 1.6, 0.07, big ? 0.2 : 0.11);
  if (big) tone('triangle', f * 1.5, f * 2.2, 0.1, 0.15, { delay: 0.06 });
}
export const sfxEat = eat;

export function superFood(vol = 1): void {
  if (!ready()) return;
  [84, 88, 91, 96].forEach((n, i) => {
    const f = 440 * Math.pow(2, (n - 69) / 12);
    tone('triangle', f, f, 0.12, 0.07 * vol, { delay: i * 0.05 });
  });
}
export const sfxSuperFood = superFood;

export function superUp(): void {
  if (!ready()) return;
  [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => {
    const f = 440 * Math.pow(2, (n - 69) / 12);
    tone('square', f, f * 1.01, 0.1, 0.06, { delay: i * 0.055 });
  });
  tone('sine', 130, 520, 0.5, 0.25, { delay: 0.05 });
}
export const sfxSuperUp = superUp;

export function superFly(vol = 1): void {
  if (!ready() || vol <= 0) return;
  noise('bandpass', 600, 4000, 0.9, 0.5, 0.45 * vol);
  tone('sine', 85, 45, 0.45, 0.45 * vol);
  tone('sawtooth', 220, 880, 0.35, 0.1 * vol);
  tone('triangle', 880, 1760, 0.3, 0.06 * vol, { delay: 0.08 });
}
export const sfxSuperFly = superFly;

export function crown(): void {
  if (!ready()) return;
  [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.32, 0.22, { delay: i * 0.11, attack: 0.01 }));
  tone('sawtooth', 196, 196, 0.8, 0.08, { delay: 0.33, attack: 0.05 });
}
export const sfxVictory = crown;
export const sfxCrown = crown;

export function dethrone(): void {
  if (!ready()) return;
  [523, 466, 392, 311].forEach((f, i) => tone('triangle', f, f * 0.98, 0.28, 0.2, { delay: i * 0.13 }));
}
export const sfxDethrone = dethrone;

export function repaint(): void {
  if (!ready()) return;
  noise('bandpass', 1200, 2600, 2, 0.35, 0.25, { attack: 0.05 });
  noise('bandpass', 2600, 1400, 2, 0.5, 0.2, { delay: 0.4, attack: 0.05 });
  tone('sine', 110, 108, 1.6, 0.35, { delay: 0.35, attack: 0.01 });
  tone('sine', 220 * 1.48, 220 * 1.46, 1.2, 0.1, { delay: 0.35, attack: 0.01 });
}

export function reward(): void {
  if (!ready()) return;
  [659, 880, 1047].forEach((f, i) => tone('triangle', f, f, 0.15, 0.14, { delay: i * 0.07 }));
}
export const sfxReward = reward;

export function death(): void {
  if (!ready()) return;
  tone('sawtooth', 300, 80, 0.7, 0.18, { attack: 0.01 });
}

export function ramReady(): void {
  if (!ready()) return;
  tone('triangle', 1100, 1300, 0.05, 0.06);
  tone('triangle', 1500, 1700, 0.06, 0.06, { delay: 0.06 });
}

export function click(): void {
  if (!ready()) return;
  tone('triangle', 700, 900, 0.05, 0.12);
}

export function boom(): void {
  if (!ready()) return;
  // Deep concussive sub-bass thump
  tone('sine', 190, 25, 0.6, 0.7, { attack: 0.005 });
  tone('sawtooth', 260, 40, 0.45, 0.35, { attack: 0.008 });
  // Heavy low explosion blast + crackle rumble
  noise('lowpass', 1400, 60, 1.8, 0.75, 0.65, { attack: 0.006 });
  noise('bandpass', 700, 180, 2.0, 0.5, 0.4, { delay: 0.04 });
}
export const sfxBoom = boom;

export function podBlast(): void {
  if (!ready()) return;
  tone('sine', 180, 35, 0.65, 0.6, { attack: 0.005 });
  tone('sawtooth', 360, 60, 0.45, 0.25, { attack: 0.01 });
  noise('lowpass', 1400, 200, 1.2, 0.6, 0.45, { attack: 0.01 });
}
export const sfxPodBlast = podBlast;

export function podWarning(): void {
  if (!ready()) return;
  tone('sine', 880, 880, 0.1, 0.15, { attack: 0.005 });
  tone('sine', 1174, 1174, 0.12, 0.15, { delay: 0.12, attack: 0.005 });
}
export const sfxPodWarning = podWarning;

export function song(): void {
  if (!ready()) return;
  [261, 329, 392, 523, 659].forEach((f, i) => {
    tone('triangle', f, f, 0.35, 0.22, { attack: 0.02, delay: i * 0.12 });
    tone('sawtooth', f / 2, f / 2, 0.35, 0.1, { attack: 0.02, delay: i * 0.12 });
  });
}
export const sfxSong = song;

// Gentle ambient wind + bird chirps
function startAmbience(): void {
  if (ambienceTimer || !ctx || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 500;
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  lfo.frequency.value = 0.08;
  lg.gain.value = 250;
  lfo.connect(lg);
  lg.connect(f.frequency);
  const g = ctx.createGain();
  g.gain.value = 0.25;
  src.connect(f);
  f.connect(g);
  g.connect(ambBus!);
  src.start();
  lfo.start();
  ambienceTimer = window.setInterval(() => {
    if (!ready() || Math.random() > 0.35) return;
    const base = 2200 + Math.random() * 1500;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      tone('sine', base, base * 1.25, 0.06, 0.05, { delay: i * 0.1, bus: ambBus! });
    }
  }, 2500);
}

// ---------- Background Music: Oom-Pah Polka Farm March ----------
const MELODY: (number | null)[][] = [
  [74, null, 71, 67, 71, 74, 79, null],
  [76, null, 72, 76, 79, null, 76, null],
  [78, null, 81, 78, 74, null, 76, 78],
  [79, null, null, null, 74, null, null, null],
  [76, null, 79, 76, 71, null, 76, null],
  [72, null, 76, 79, 76, null, 72, null],
  [69, 71, 72, 74, 76, null, 78, null],
  [79, null, 74, null, 67, null, null, null],
];

const CHORDS: number[][] = [
  [43, 59, 62],
  [48, 64, 67],
  [50, 66, 69],
  [43, 59, 62],
  [40, 55, 59],
  [48, 64, 67],
  [50, 66, 69],
  [43, 59, 62],
];

const BPM = 112;
const EIGHTH = 60 / BPM / 2;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let musicBus: GainNode | null = null;
let musicOn = audioMode === 0;
let musicTimer: number | null = null;
let nextNoteTime = 0;
let step = 0;
let mood: 'normal' | 'napoleon' = 'normal';

export function setMusic(on: boolean): void {
  musicOn = on;
  if (musicBus && ctx) {
    musicBus.gain.setTargetAtTime(on ? 0.16 : 0.0001, ctx.currentTime, 0.3);
  }
}
export const isMusicOn = () => musicOn;
export function setMood(m: 'normal' | 'napoleon'): void {
  mood = m;
}

export function startMusic(): void {
  if (!ctx || musicTimer) return;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.0001;
  musicBus.connect(master!);
  musicBus.gain.setTargetAtTime(musicOn ? 0.16 : 0.0001, ctx.currentTime, 1.5);
  nextNoteTime = ctx.currentTime + 0.1;
  step = 0;

  musicTimer = window.setInterval(() => {
    if (!ctx) return;
    if (!musicOn || muted) {
      nextNoteTime = Math.max(nextNoteTime, ctx.currentTime + 0.05);
      return;
    }
    while (nextNoteTime < ctx.currentTime + 0.3) {
      playStep(step, nextNoteTime);
      nextNoteTime += EIGHTH;
      step = (step + 1) % (MELODY.length * 8 * 2);
    }
  }, 100);
}

function voice(
  type: OscillatorType,
  freq: number,
  t: number,
  dur: number,
  vol: number,
  opts: { cutoff?: number; vibrato?: number } = {}
): void {
  if (!ctx || !musicBus) return;
  const cutoff = opts.cutoff ?? 2000;
  const vibrato = opts.vibrato ?? 0;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  if (vibrato) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = 5.5;
    lg.gain.value = freq * vibrato;
    l.connect(lg);
    lg.connect(o.frequency);
    l.start(t);
    l.stop(t + dur + 0.1);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f);
  f.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function drum(kind: 'kick' | 'snare', t: number, vol: number): void {
  if (!ctx || !musicBus || !noiseBuf) return;
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + 0.2);
  } else {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f);
    f.connect(g);
    g.connect(musicBus);
    src.start(t, Math.random());
    src.stop(t + 0.15);
  }
}

function playStep(s: number, t: number): void {
  const pass = Math.floor(s / 64);
  const i = s % 64;
  const bar = Math.floor(i / 8);
  const e = i % 8;
  const chord = CHORDS[bar];

  if (e === 0) voice('triangle', midi(chord[0]), t, EIGHTH * 1.8, 0.55, { cutoff: 600 });
  if (e === 4) voice('triangle', midi(chord[0] + 7), t, EIGHTH * 1.8, 0.45, { cutoff: 600 });
  if (e === 2 || e === 6) {
    for (const n of chord.slice(1)) {
      voice('sawtooth', midi(n), t, EIGHTH * 0.6, 0.07, { cutoff: 1400 });
    }
  }
  if (e === 0 || e === 4) drum('kick', t, 0.35);
  if (e === 2 || e === 6) drum('snare', t, 0.12);
  if (mood === 'napoleon' && e === 7) drum('snare', t, 0.08);

  const n = MELODY[bar][e];
  if (n !== null) {
    let len = 1;
    while (e + len < 8 && MELODY[bar][e + len] === null) len++;
    const dur = EIGHTH * len * 0.92;
    if (mood === 'napoleon') {
      voice('sawtooth', midi(n), t, dur, 0.12, { cutoff: 2600, vibrato: 0.006 });
    } else {
      voice('square', midi(n), t, dur, 0.09, { cutoff: 1800, vibrato: 0.004 });
    }
    if (pass === 1) {
      voice('sine', midi(n + 12), t, dur, 0.05, { vibrato: 0.01 });
    }
  }
}

export function pause(): void {
  held = true;
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resume(): void {
  held = false;
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
