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
    setMuted(false);
    setMusic(true);
  } else if (mode === 1) {
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
    startAmbience();
    startMusic();
  }
  if (ctx.state === 'suspended' && !held) {
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
};

export function yelp(species: Species, vol = 1): void {
  if (!ready() || vol < 0.05) return;
  const f = SQUEAK[species] || 700;
  tone(species === 'cow' ? 'sawtooth' : 'square', f, f * 0.7, 0.16, 0.08 * vol, { attack: 0.02 });
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
}

export function chargeStop(): void {
  if (!chargeNode || !ctx) return;
  const { o, g } = chargeNode;
  chargeNode = null;
  g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
  o.stop(ctx.currentTime + 0.2);
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
  tone('sine', 160, 35, 0.5, 0.45, { attack: 0.005 });
  noise('lowpass', 600, 80, 2, 0.6, 0.4, { attack: 0.01 });
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
