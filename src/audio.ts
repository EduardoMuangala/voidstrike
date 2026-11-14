import { profile } from './save';
import type { WeaponId } from './data';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  master!.gain.value = profile.settings.volume / 100;
  return ctx;
}

export function unlockAudio() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide?: number, delay = 0) {
  const c = ac();
  if (!c || vol <= 0) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur: number, vol: number, freq: number, q = 0.8, type: BiquadFilterType = 'lowpass', delay = 0) {
  const c = ac();
  if (!c || !noiseBuf || vol <= 0) return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const GUN: Record<WeaponId, [number, number, number, number]> = {
  ar: [0.16, 0.32, 1800, 140],
  smg: [0.1, 0.24, 2600, 220],
  sg: [0.32, 0.5, 900, 80],
  sr: [0.5, 0.55, 1300, 60],
  dmr: [0.28, 0.42, 1500, 90],
  lmg: [0.18, 0.36, 1500, 120],
  pistol: [0.12, 0.26, 2200, 200],
};

export const sfx = {
  shot(w: WeaponId, vol = 1) {
    const [d, v, f, b] = GUN[w];
    burst(d, v * vol, f, 0.7);
    tone(b, d * 0.8, 'square', 0.08 * vol, b * 0.4);
  },
  hit(head: boolean) {
    tone(head ? 1650 : 1100, 0.07, 'square', 0.07);
    if (head) tone(2400, 0.08, 'sine', 0.06, undefined, 0.03);
  },
  kill() {
    tone(880, 0.09, 'square', 0.08);
    tone(1320, 0.14, 'square', 0.08, undefined, 0.07);
  },
  hurt() {
    burst(0.12, 0.25, 500, 1);
    tone(160, 0.12, 'sawtooth', 0.06, 90);
  },
  reload() {
    tone(420, 0.05, 'square', 0.05);
    tone(620, 0.06, 'square', 0.05, undefined, 0.18);
  },
  empty() {
    tone(900, 0.03, 'square', 0.04);
  },
  pickup() {
    tone(660, 0.07, 'sine', 0.08);
    tone(990, 0.1, 'sine', 0.08, undefined, 0.06);
  },
  gel() {
    burst(0.35, 0.3, 3000, 0.5, 'highpass');
    tone(300, 0.3, 'sine', 0.08, 900);
  },
  gelBreak() {
    burst(0.4, 0.35, 2500, 0.6, 'highpass');
  },
  boom() {
    burst(0.9, 0.7, 400, 0.6);
    tone(70, 0.7, 'sine', 0.3, 30);
  },
  ability() {
    tone(500, 0.25, 'sawtooth', 0.06, 1500);
    tone(750, 0.3, 'sine', 0.06, 2000, 0.05);
  },
  step() {
    burst(0.05, 0.05, 700, 1);
  },
  click() {
    tone(1200, 0.035, 'square', 0.04);
  },
  buy() {
    tone(784, 0.1, 'triangle', 0.1);
    tone(1046, 0.1, 'triangle', 0.1, undefined, 0.08);
    tone(1568, 0.22, 'triangle', 0.1, undefined, 0.16);
  },
  booyah() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, undefined, i * 0.09));
  },
  countdown(final = false) {
    tone(final ? 1320 : 660, final ? 0.35 : 0.12, 'square', 0.07);
  },
};
