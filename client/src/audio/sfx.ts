// Synthesized Web Audio sound effects: zero external assets needed.
let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) ctx = new AudioCtx();
  }
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
}

export function isMuted(): boolean {
  return muted;
}

export function unlockAudio(): void {
  getCtx();
}

/** Soft pop when eating food */
export function sfxEat(big = false): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(big ? 320 : 440, now);
  osc.frequency.exponentialRampToValueAtTime(big ? 640 : 880, now + 0.08);

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.09);
}

/** Whoosh dash sound */
export function sfxDash(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(420, now + 0.14);

  gain.gain.setValueAtTime(0.25 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.17);
}

/** Heavy impact / ram hit */
export function sfxHit(strength = 20, volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();

  const freq = Math.max(60, 220 - strength * 2.5);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq * 1.5, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);

  gain.gain.setValueAtTime(Math.min(0.4, 0.15 + strength * 0.005) * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

/** Zap on fence hit */
export function sfxZap(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.08);
  osc.frequency.linearRampToValueAtTime(120, now + 0.25);

  gain.gain.setValueAtTime(0.3 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.32);
}

/** Rewarding chime on knockout */
export function sfxReward(): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = now + idx * 0.07;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  });
}

/** Button click sound */
export function sfxClick(): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

/** Water splash sound when falling into a pond */
export function sfxSplash(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.35);

  gain.gain.setValueAtTime(0.35 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

/** Falling sound when dropping into pit / well */
export function sfxFall(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.45);

  gain.gain.setValueAtTime(0.25 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.5);
}

/** Fire sizzling sound */
export function sfxBurn(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.linearRampToValueAtTime(260, now + 0.15);
  osc.frequency.linearRampToValueAtTime(80, now + 0.35);

  gain.gain.setValueAtTime(0.28 * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

/** Fanfare when seizing crown / becoming Napoleon King */
export function sfxVictory(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const notes = [440, 554.37, 659.25, 880];
  notes.forEach((freq, idx) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = now + idx * 0.1;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.28 * volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.38);
  });
}

/** Dramatic chime when King is dethroned */
export function sfxDethrone(volume = 1): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const notes = [783.99, 659.25, 523.25, 392.0];
  notes.forEach((freq, idx) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = now + idx * 0.12;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.22 * volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
}
