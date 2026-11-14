import { ALL_WEAPON_IDS, type WeaponId } from '../data';
import type { Actor } from './actor';
import type { GlooEvent } from './gloo';

const HZ = 20;
const SECS = 15;
const FR = HZ * SECS;
const F = 8;

export const FL = { alive: 1, crouch: 2, glide: 4, dropping: 8, plane: 16, ground: 32 };

export interface Snap { x: number; y: number; z: number; yaw: number; pitch: number; flags: number; weapon: WeaponId | null; hp: number; speed: number }
export interface ShotEv { t: number; a: [number, number, number]; b: [number, number, number]; color: number }
export interface BoomEv { t: number; p: [number, number, number] }
export interface KillEv { t: number; text: string }
interface GlooRec { id: number; t: number; end: number; x: number; y: number; z: number; yaw: number; skin: string }

const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Replay {
  private n: number;
  private buf: Float32Array;
  private times = new Float64Array(FR);
  private plane = new Float32Array(FR * 3);
  private head = 0;
  private count = 0;
  private acc = 0;
  shots: ShotEv[] = [];
  booms: BoomEv[] = [];
  kills: KillEv[] = [];
  private gloos: GlooRec[] = [];

  constructor(n: number) {
    this.n = n;
    this.buf = new Float32Array(FR * n * F);
  }

  record(dt: number, time: number, actors: Actor[], planePos: { x: number; y: number; z: number } | null, inPlane: (a: Actor) => boolean) {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    const f = this.head;
    this.times[f] = time;
    for (let i = 0; i < this.n; i++) {
      const a = actors[i];
      const o = (f * this.n + i) * F;
      const b = this.buf;
      if (!a) continue;
      b[o] = a.pos.x;
      b[o + 1] = a.pos.y;
      b[o + 2] = a.pos.z;
      b[o + 3] = a.yaw;
      b[o + 4] = a.pitch;
      b[o + 5] = (a.alive ? FL.alive : 0) | (a.crouch ? FL.crouch : 0) | (a.glide ? FL.glide : 0) | (a.dropping ? FL.dropping : 0) | (inPlane(a) ? FL.plane : 0) | (a.onGround ? FL.ground : 0);
      const w = a.weapon;
      b[o + 6] = w ? ALL_WEAPON_IDS.indexOf(w.id) : -1;
      b[o + 7] = a.hp;
    }
    if (planePos) {
      this.plane[f * 3] = planePos.x;
      this.plane[f * 3 + 1] = planePos.y;
      this.plane[f * 3 + 2] = planePos.z;
    } else this.plane[f * 3 + 1] = -999;
    this.head = (this.head + 1) % FR;
    this.count = Math.min(FR, this.count + 1);
    const oldest = this.oldest;
    const trim = <T extends { t: number }>(arr: T[]) => {
      let k = 0;
      while (k < arr.length && arr[k].t < oldest) k++;
      if (k) arr.splice(0, k);
    };
    trim(this.shots);
    trim(this.booms);
    trim(this.kills);
    this.gloos = this.gloos.filter((g) => g.end >= oldest);
  }

  get oldest() {
    if (!this.count) return 0;
    return this.times[(this.head - this.count + FR) % FR];
  }

  get newest() {
    if (!this.count) return 0;
    return this.times[(this.head - 1 + FR) % FR];
  }

  shot(t: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, color: number) {
    this.shots.push({ t, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], color });
  }

  boom(t: number, p: { x: number; y: number; z: number }) {
    this.booms.push({ t, p: [p.x, p.y, p.z] });
  }

  kill(t: number, text: string) {
    this.kills.push({ t, text });
  }

  gloo(t: number, e: GlooEvent) {
    if (e.kind === 'spawn') this.gloos.push({ id: e.id, t, end: Infinity, x: e.x, y: e.y, z: e.z, yaw: e.yaw, skin: e.skin });
    else {
      const g = this.gloos.find((x) => x.id === e.id);
      if (g) g.end = t;
    }
  }

  glooAt(t: number) {
    return this.gloos.filter((g) => g.t <= t && t < g.end).map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z, yaw: g.yaw, skin: g.skin, age: t - g.t }));
  }

  private frameIndex(t: number): [number, number, number] {
    // returns two ring indices and blend factor
    let lo = 0, hi = this.count - 1;
    const idx = (k: number) => (this.head - this.count + k + FR) % FR;
    if (t <= this.times[idx(0)]) return [idx(0), idx(0), 0];
    if (t >= this.times[idx(hi)]) return [idx(hi), idx(hi), 0];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.times[idx(m)] <= t) lo = m;
      else hi = m;
    }
    const a = idx(lo), b = idx(hi);
    const span = this.times[b] - this.times[a];
    return [a, b, span > 0 ? (t - this.times[a]) / span : 0];
  }

  sample(t: number, i: number, out: Snap): Snap {
    const [fa, fb, k] = this.frameIndex(t);
    const b = this.buf;
    const oa = (fa * this.n + i) * F, ob = (fb * this.n + i) * F;
    out.x = b[oa] + (b[ob] - b[oa]) * k;
    out.y = b[oa + 1] + (b[ob + 1] - b[oa + 1]) * k;
    out.z = b[oa + 2] + (b[ob + 2] - b[oa + 2]) * k;
    out.yaw = lerpAng(b[oa + 3], b[ob + 3], k);
    out.pitch = b[oa + 4] + (b[ob + 4] - b[oa + 4]) * k;
    const src = k < 0.5 ? oa : ob;
    out.flags = b[src + 5];
    const wi = b[src + 6];
    out.weapon = wi >= 0 ? ALL_WEAPON_IDS[wi] : null;
    out.hp = b[src + 7];
    const dtf = this.times[fb] - this.times[fa];
    out.speed = dtf > 0 ? Math.hypot(b[ob] - b[oa], b[ob + 2] - b[oa + 2]) / dtf : 0;
    return out;
  }

  planeAt(t: number): [number, number, number] | null {
    const [fa, fb, k] = this.frameIndex(t);
    if (this.plane[fa * 3 + 1] < -900 || this.plane[fb * 3 + 1] < -900) return null;
    const p = this.plane;
    return [p[fa * 3] + (p[fb * 3] - p[fa * 3]) * k, p[fa * 3 + 1] + (p[fb * 3 + 1] - p[fa * 3 + 1]) * k, p[fa * 3 + 2] + (p[fb * 3 + 2] - p[fa * 3 + 2]) * k];
  }
}
