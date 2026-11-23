import * as THREE from 'three';
import type { World } from './world';

export const FLOOR_H = 3.2;
const T = 0.25;
const PLINTH = 0.15;

// ---------------------------------------------------------------- shared geometries
function gablePrism() {
  const g = new THREE.BufferGeometry();
  const v = [
    // slopes
    -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5,
    -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0,
    // ends
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
export const GEO = {
  gable: gablePrism(),
  hip: new THREE.ConeGeometry(0.7072, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl10: new THREE.CylinderGeometry(1, 1, 1, 10),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone7: new THREE.ConeGeometry(1, 1, 7),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 8, 6),
};

export interface Style {
  wall: number;
  trim: number;
  floor: number;
  roof: number;
  roofType: 'flat' | 'gable' | 'hip';
  access: boolean;
  shutter?: number;
  awning?: number;
}

export const WALL_PALETTE = [0xf6e3c6, 0xf2c9a8, 0xbfe0ea, 0xf7b9b0, 0xd6e8b0, 0xfaf3e4, 0xd8c6f0, 0xffd98a, 0xa8d8c8, 0xf0a868];
export const ROOF_PALETTE = [0xd2413a, 0x2f78c4, 0x7a4b36, 0x3f9a62, 0xe0782a, 0x384b63, 0xb83a6a];
export const SHUTTER_PALETTE = [0x2f6f9f, 0x3f9a62, 0xc0392b, 0x6d4c41, 0x2b2b2b, 0xe0a020];

/** Local frame helper: door side is local -Z; rot is in quarter turns. */
export class Kit {
  w: World;
  x: number;
  y: number;
  z: number;
  c: number;
  s: number;
  rot: number;

  constructor(w: World, x: number, y: number, z: number, rot: number) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    this.rot = ((rot % 4) + 4) % 4;
    this.c = [1, 0, -1, 0][this.rot];
    this.s = [0, 1, 0, -1][this.rot];
  }

  tx(lx: number, lz: number): [number, number] {
    return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c];
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, collide = true, jit = 0.03) {
    const [ax, az] = this.tx(x0, z0);
    const [bx, bz] = this.tx(x1, z1);
    this.w.solid(Math.min(ax, bx), this.y + y0, Math.min(az, bz), Math.max(ax, bx), this.y + y1, Math.max(az, bz), color, collide, jit);
  }

  geo(g: THREE.BufferGeometry, color: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry = 0, jit = 0.04) {
    const [wx, wz] = this.tx(lx, lz);
    this.w.deco(g, color, wx, this.y + ly, wz, sx, sy, sz, ry + (this.rot * Math.PI) / 2, jit);
  }

  loot(lx: number, ly: number, lz: number) {
    const [wx, wz] = this.tx(lx, lz);
    this.w.loot.push(new THREE.Vector3(wx, this.y + ly, wz));
  }
}

interface Opening { c: number; w: number; b: number; t: number }
const DOOR = (c: number): Opening => ({ c, w: 1.7, b: 0, t: 2.5 });
const WIN = (c: number): Opening => ({ c, w: 1.35, b: 0.85, t: 2.75 });

/**
 * Wall along local X (axis 'x') or local Z (axis 'z') with real openings.
 * `out` is the outward direction across the thickness (+1/-1) for frames and shutters.
 */
function wall(k: Kit, axis: 'x' | 'z', a0: number, a1: number, f0: number, f1: number, y0: number, H: number, ops: Opening[], color: number, trim: number, shutter: number | undefined, out: number) {
  const seg = (s0: number, s1: number, yb: number, yt: number, c = color, collide = true) => {
    if (s1 - s0 < 0.01 || yt - yb < 0.01) return;
    if (axis === 'x') k.box(s0, yb, f0, s1, yt, f1, c, collide, 0.015);
    else k.box(f0, yb, s0, f1, yt, s1, c, collide, 0.015);
  };
  const across = (d0: number, d1: number) => (out > 0 ? [f1 + d0, f1 + d1] : [f0 - d1, f0 - d0]);
  const decor = (s0: number, s1: number, yb: number, yt: number, d: number, c: number) => {
    const [g0, g1] = across(0, d);
    if (axis === 'x') k.box(s0, yb, g0, s1, yt, g1, c, false, 0);
    else k.box(g0, yb, s0, g1, yt, s1, c, false, 0);
  };
  const sorted = [...ops].sort((p, q) => p.c - q.c);
  let cur = a0;
  for (const o of sorted) {
    const l = o.c - o.w / 2, r = o.c + o.w / 2;
    seg(cur, l, y0, y0 + H);
    if (o.b > 0) seg(l, r, y0, y0 + o.b);
    if (o.t < H) seg(l, r, y0 + o.t, y0 + H);
    // frame
    decor(l - 0.08, r + 0.08, y0 + o.t, y0 + o.t + 0.1, 0.06, trim);
    if (o.b > 0) {
      decor(l - 0.12, r + 0.12, y0 + o.b - 0.08, y0 + o.b, 0.14, trim);
      if (shutter !== undefined) {
        decor(l - 0.62, l - 0.1, y0 + o.b + 0.05, y0 + o.t - 0.05, 0.05, shutter);
        decor(r + 0.1, r + 0.62, y0 + o.b + 0.05, y0 + o.t - 0.05, 0.05, shutter);
      }
    }
    cur = r;
  }
  seg(cur, a1, y0, y0 + H);
}

function windowsFor(len: number, skip: (c: number) => boolean): number[] {
  const n = Math.max(1, Math.floor((len - 1) / 2.9));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = -len / 2 + ((i + 0.5) * len) / n;
    if (!skip(c)) out.push(c);
  }
  return out;
}

/** Floor slab with a rectangular stair hole. */
function slab(k: Kit, x0: number, z0: number, x1: number, z1: number, yb: number, yt: number, hole: [number, number, number, number] | null, color: number) {
  if (!hole) return k.box(x0, yb, z0, x1, yt, z1, color, true, 0.02);
  const [hx0, hz0, hx1, hz1] = hole;
  k.box(x0, yb, z0, x1, yt, hz0, color, true, 0.02);
  k.box(x0, yb, hz1, x1, yt, z1, color, true, 0.02);
  k.box(x0, yb, hz0, hx0, yt, hz1, color, true, 0.02);
  k.box(hx1, yb, hz0, x1, yt, hz1, color, true, 0.02);
}

/**
 * Multi-storey building with switch-back stairs along the back wall, open windows
 * (sill 0.85 m, top 2.75 m so players fit through after a jump), door at local -Z.
 */
export function building(w: World, x: number, z: number, rot: number, W: number, D: number, floors: number, st: Style) {
  const gy = Math.min(w.heightAt(x - W / 2, z - D / 2), w.heightAt(x + W / 2, z - D / 2), w.heightAt(x - W / 2, z + D / 2), w.heightAt(x + W / 2, z + D / 2), w.heightAt(x, z));
  const k = new Kit(w, x, gy, z, rot);
  const H = FLOOR_H, base = PLINTH;
  k.box(-W / 2 - 0.3, -3, -D / 2 - 0.3, W / 2 + 0.3, base, D / 2 + 0.3, 0x9c968c, true, 0.02);
  // front step
  k.box(-1.2, -1, -D / 2 - 1.1, 1.2, base - 0.05, -D / 2 - 0.3, 0xa8a297, true, 0);

  const RUN = 3.6, NST = 12, rise = H / NST, dep = RUN / NST, SW = 1.15;
  const xs = -W / 2 + T + 0.95, xe = xs + RUN;
  const band = (i: number): [number, number] => (i % 2 === 0 ? [D / 2 - T - SW, D / 2 - T] : [D / 2 - T - 2 * SW, D / 2 - T - SW]);
  const nStairs = floors - 1 + (st.access ? 1 : 0);
  const doorX = W >= 9.5 ? W / 4 : 0.6;
  const ix0 = -W / 2 + T, ix1 = W / 2 - T, iz0 = -D / 2 + T, iz1 = D / 2 - T;

  for (let f = 0; f < floors; f++) {
    const y0 = base + f * H;
    if (f >= 1) {
      const b = band(f - 1);
      slab(k, ix0, iz0, ix1, iz1, y0 - 0.22, y0, [xs - 0.15, b[0], xe + 0.15, b[1]], st.floor);
    } else k.box(ix0, base - 0.01, iz0, ix1, base + 0.005, iz1, st.floor, false, 0.02);

    // walls
    const front = windowsFor(W, (c) => Math.abs(c - doorX) < 1.8 && f === 0).map(WIN);
    if (f === 0) front.push(DOOR(doorX));
    wall(k, 'x', -W / 2, W / 2, -D / 2, -D / 2 + T, y0, H, front, st.wall, st.trim, st.shutter, -1);
    const backSkip = (c: number) => nStairs > f && c > xs - 1.2 && c < xe + 1.2;
    wall(k, 'x', -W / 2, W / 2, D / 2 - T, D / 2, y0, H, windowsFor(W, backSkip).map(WIN), st.wall, st.trim, st.shutter, 1);
    const sideSkip = (c: number) => nStairs > 0 && c > D / 2 - T - 2 * SW - 0.9;
    const sideL = windowsFor(D - 2 * T, sideSkip).map(WIN);
    const sideR = windowsFor(D - 2 * T, () => false).map(WIN);
    wall(k, 'z', -D / 2 + T, D / 2 - T, -W / 2, -W / 2 + T, y0, H, sideL, st.wall, st.trim, st.shutter, -1);
    wall(k, 'z', -D / 2 + T, D / 2 - T, W / 2 - T, W / 2, y0, H, sideR, st.wall, st.trim, st.shutter, 1);
    // floor band trim on the outside
    if (f > 0) {
      k.box(-W / 2 - 0.06, y0 - 0.25, -D / 2 - 0.06, W / 2 + 0.06, y0 - 0.05, -D / 2, st.trim, false, 0);
      k.box(-W / 2 - 0.06, y0 - 0.25, D / 2, W / 2 + 0.06, y0 - 0.05, D / 2 + 0.06, st.trim, false, 0);
    }

    // stairs (switch-back on alternating bands)
    if (f < nStairs) {
      const [b0, b1] = band(f);
      const dir = f % 2 === 0 ? 1 : -1;
      for (let i = 0; i < NST; i++) {
        const sx0 = dir > 0 ? xs + i * dep : xe - (i + 1) * dep;
        k.box(sx0, y0, b0, sx0 + dep, y0 + (i + 1) * rise, b1, 0x8d6e4f, true, 0.04);
      }
      // hand rail on the open side
      const rz = f % 2 === 0 ? b0 : b1;
      k.box(xs, y0 + 1.1, rz - 0.03, xe, y0 + H + 0.9, rz + 0.03, 0x3a3a3a, false, 0);
    }

    // furniture
    const fx = W / 2 - T - 0.9;
    k.box(fx - 0.6, y0, -D / 2 + T + 0.5, fx + 0.6, y0 + 0.78, -D / 2 + T + 1.4, 0x8a5a36, true, 0.08);
    if (W > 9) k.box(-0.9, y0, -0.6, 0.9, y0 + 0.45, 0.4, [0xc0392b, 0x2f78c4, 0x3f9a62, 0x8e44ad][(w.R() * 4) | 0], true, 0.05);
    k.loot(0.3 + w.R() * 1.2, y0 + 0.05, -D / 2 + 1.8 + w.R());
  }

  // roof
  const top = base + floors * H;
  if (st.access) {
    const b = band(floors - 1);
    slab(k, -W / 2, -D / 2, W / 2, D / 2, top - 0.22, top, [xs - 0.15, b[0], xe + 0.15, b[1]], 0x8f8a83);
    k.box(-W / 2, top, -D / 2, W / 2, top + 1.05, -D / 2 + T, st.wall, true, 0.015);
    k.box(-W / 2, top, D / 2 - T, W / 2, top + 1.05, D / 2, st.wall, true, 0.015);
    k.box(-W / 2, top, -D / 2 + T, -W / 2 + T, top + 1.05, D / 2 - T, st.wall, true, 0.015);
    k.box(W / 2 - T, top, -D / 2 + T, W / 2, top + 1.05, D / 2 - T, st.wall, true, 0.015);
    k.box(-W / 2 - 0.05, top + 1.05, -D / 2 - 0.05, W / 2 + 0.05, top + 1.15, D / 2 + 0.05, st.trim, false, 0);
    // rail around the stair hole
    k.box(xs - 0.15, top, b[0] - 0.08, xe + 0.15, top + 1, b[0], 0x3a3a3a, true, 0);
    // rooftop details
    k.box(W / 2 - 2.2, top, -D / 2 + 0.8, W / 2 - 0.8, top + 0.9, -D / 2 + 1.8, 0xb8bcc2, true, 0.04);
    if (W > 9) k.geo(GEO.cyl10, 0x6a8fb0, W / 2 - 1.6, top + 1.6, 0.2, 0.7, 1.4, 0.7);
    k.loot(0.5, top + 0.05, -D / 2 + 1.5);
  } else {
    k.box(-W / 2 - 0.35, top - 0.22, -D / 2 - 0.35, W / 2 + 0.35, top + 0.08, D / 2 + 0.35, st.trim, true, 0);
    const rh = Math.min(2.6, 1.2 + W * 0.12);
    if (st.roofType === 'gable') k.geo(GEO.gable, st.roof, 0, top + 0.08, 0, W + 0.9, rh, D + 0.9, 0, 0.03);
    else k.geo(GEO.hip, st.roof, 0, top + 0.08, 0, W + 0.8, rh, D + 0.8, 0, 0.03);
    if (st.roofType === 'gable' && floors > 0) k.box(W / 4 - 0.35, top, D / 6, W / 4 + 0.35, top + rh + 0.6, D / 6 + 0.7, 0x8c5b45, false, 0.05);
  }
  if (st.awning !== undefined) {
    k.box(doorX - 1.6, 2.8, -D / 2 - 1.4, doorX + 1.6, 2.95, -D / 2, st.awning, false, 0.02);
    k.box(-W / 2 + 0.3, 3.0, -D / 2 - 0.12, W / 2 - 0.3, 3.0 + 0.55, -D / 2 - 0.02, st.awning, false, 0.05);
  }
  return { top, gy };
}

/** Large hall with big doors, high windows, a mezzanine with stairs, and crates. */
export function warehouse(w: World, x: number, z: number, rot: number, W: number, D: number, wallC: number, roofC: number) {
  const gy = Math.min(w.heightAt(x - W / 2, z - D / 2), w.heightAt(x + W / 2, z + D / 2), w.heightAt(x + W / 2, z - D / 2), w.heightAt(x - W / 2, z + D / 2));
  const k = new Kit(w, x, gy, z, rot);
  const H = 6.6, base = PLINTH;
  k.box(-W / 2 - 0.3, -3, -D / 2 - 0.3, W / 2 + 0.3, base, D / 2 + 0.3, 0x8e8a84, true, 0.02);
  k.box(-W / 2 + T, base - 0.01, -D / 2 + T, W / 2 - T, base + 0.005, D / 2 - T, 0x6f7276, false, 0.02);
  const big = (c: number): Opening => ({ c, w: 4.4, b: 0, t: 4.8 });
  const hi = (c: number): Opening => ({ c, w: 2, b: 4.05, t: 5.95 });
  const trim = 0xf0f0f0;
  wall(k, 'x', -W / 2, W / 2, -D / 2, -D / 2 + T, base, H, [big(0), ...windowsFor(W, (c) => Math.abs(c) < 3.6).map((c) => ({ c, w: 1.4, b: 1.0, t: 2.7 }))], wallC, trim, undefined, -1);
  wall(k, 'x', -W / 2, W / 2, D / 2 - T, D / 2, base, H, windowsFor(W, () => false).map(hi), wallC, trim, undefined, 1);
  wall(k, 'z', -D / 2 + T, D / 2 - T, -W / 2, -W / 2 + T, base, H, [big(-1), ...windowsFor(D, (c) => c < 2).map(hi)], wallC, trim, undefined, -1);
  wall(k, 'z', -D / 2 + T, D / 2 - T, W / 2 - T, W / 2, base, H, windowsFor(D, () => false).map(hi), wallC, trim, undefined, 1);
  // stripes
  k.box(-W / 2 - 0.05, base + 2.9, -D / 2 - 0.05, W / 2 + 0.05, base + 3.3, -D / 2, 0xffc21a, false, 0);
  // mezzanine along back wall
  const mz0 = D / 2 - T - 3, my = base + FLOOR_H;
  k.box(-W / 2 + T, my - 0.22, mz0, W / 2 - T, my, D / 2 - T, 0x5d6168, true, 0.02);
  k.box(-W / 2 + T, my, mz0 - 0.06, W / 2 - T - 1.4, my + 1, mz0, 0x3a3a3a, true, 0);
  for (let px = -W / 2 + 2; px < W / 2 - 1; px += 4) k.box(px - 0.15, base, mz0 + 0.1, px + 0.15, my - 0.22, mz0 + 0.4, 0x4a4d52, true, 0);
  const NST = 12, rise = FLOOR_H / NST, dep = 0.3;
  for (let i = 0; i < NST; i++) {
    const sz1 = mz0 - (NST - 1 - i) * dep;
    k.box(W / 2 - T - 1.3, base, sz1 - dep, W / 2 - T, base + (i + 1) * rise, sz1, 0x4a4d52, true, 0.03);
  }
  // crates
  for (let i = 0; i < 5; i++) {
    const cx = -W / 2 + 2 + w.R() * (W - 6), cz = -D / 2 + 3 + w.R() * (D - 9);
    if (Math.abs(cx) < 2.6 && cz < -D / 2 + 5) continue;
    k.box(cx - 0.6, base, cz - 0.6, cx + 0.6, base + 1.2, cz + 0.6, 0xb07a3c, true, 0.08);
    if (w.R() < 0.5) k.box(cx - 0.5, base + 1.2, cz - 0.5, cx + 0.5, base + 2.2, cz + 0.5, 0x9b6a33, true, 0.08);
  }
  k.loot(0, base + 0.05, 0);
  k.loot(-W / 4, my + 0.05, D / 2 - 1.6);
  k.loot(W / 4, base + 0.05, -D / 4);
  // roof
  const top = base + H;
  k.box(-W / 2 - 0.3, top - 0.2, -D / 2 - 0.3, W / 2 + 0.3, top + 0.1, D / 2 + 0.3, 0x5d6168, true, 0);
  k.geo(GEO.gable, roofC, 0, top + 0.1, 0, W + 0.8, 2.2, D + 0.8, 0, 0.02);
}

export function watchtower(w: World, x: number, z: number, rot: number) {
  const gy = w.heightAt(x, z);
  const k = new Kit(w, x, gy, z, rot);
  const P = 5.3, S = 1.8;
  for (const [px, pz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) k.box(px - 0.15, -1, pz - 0.15, px + 0.15, P + 2.6, pz + 0.15, 0x6b4a2e, true, 0.05);
  k.box(-S - 0.2, P - 0.25, -S - 0.2, S + 0.2, P, S + 0.2, 0x8a6a45, true, 0.04);
  k.box(-S - 0.2, P, S, S + 0.2, P + 1.05, S + 0.2, 0x7a5a38, true, 0.04);
  k.box(-S - 0.2, P, -S - 0.2, -S, P + 1.05, S, 0x7a5a38, true, 0.04);
  k.box(S, P, -S - 0.2, S + 0.2, P + 1.05, S, 0x7a5a38, true, 0.04);
  k.box(-S, P, -S - 0.2, S - 1.2, P + 1.05, -S, 0x7a5a38, true, 0.04);
  k.geo(GEO.hip, 0x5b3b25, 0, P + 2.6, 0, S * 2 + 1.2, 1.4, S * 2 + 1.2);
  const N = 20, rise = P / N, dep = 0.3;
  for (let i = 0; i < N; i++) {
    const sz = -S - 0.2 - (N - 1 - i) * dep;
    k.box(S - 1.2, -1, sz - dep, S, (i + 1) * rise, sz, 0x7a5a38, true, 0.05);
  }
  k.loot(0, P + 0.02, 0);
}

export function tree(w: World, x: number, z: number, s: number, palette: number[], kind: 'round' | 'pine' | 'palm' = 'round') {
  const y = w.heightAt(x, z);
  const R = w.R;
  if (kind === 'palm') {
    const lean = (R() - 0.5) * 0.4;
    w.deco(GEO.cyl6, 0x9a7650, x, y + 2.6 * s, z, 0.16 * s, 5.2 * s, 0.16 * s, 0, 0.05, 0, lean);
    const tx = x - Math.sin(lean) * 5 * s;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + R();
      w.deco(GEO.box, palette[(R() * palette.length) | 0], tx + Math.cos(a) * 1.3 * s, y + 5.1 * s, z + Math.sin(a) * 1.3 * s, 2.8 * s, 0.08, 0.7 * s, -a, 0.1, 0, -0.35);
    }
    w.addBox(x - 0.22 * s, y - 1, z - 0.22 * s, x + 0.22 * s, y + 4 * s, z + 0.22 * s);
    return;
  }
  w.deco(GEO.cyl6, 0x6b4428, x, y + 1.2 * s, z, 0.22 * s, 2.6 * s, 0.22 * s);
  const c = palette[(R() * palette.length) | 0];
  if (kind === 'pine') {
    w.deco(GEO.cone7, c, x, y + 3.2 * s, z, 1.7 * s, 2.8 * s, 1.7 * s, R() * 6, 0.08);
    w.deco(GEO.cone7, c, x, y + 4.7 * s, z, 1.2 * s, 2.2 * s, 1.2 * s, R() * 6, 0.08);
  } else {
    w.deco(GEO.ico, c, x, y + 3.5 * s, z, 1.8 * s, 1.6 * s, 1.8 * s, R() * 6, 0.1);
    w.deco(GEO.ico, c, x + 0.7 * s, y + 4.4 * s, z + 0.3 * s, 1.1 * s, 1.1 * s, 1.1 * s, R() * 6, 0.1);
  }
  w.addBox(x - 0.3 * s, y - 1, z - 0.3 * s, x + 0.3 * s, y + 3 * s, z + 0.3 * s);
}

export function bush(w: World, x: number, z: number, color: number, flower?: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.ico, color, x, y + 0.4, z, 0.9, 0.6, 0.9, w.R() * 6, 0.12);
  if (flower !== undefined) for (let i = 0; i < 4; i++) w.deco(GEO.box, flower, x + (w.R() - 0.5) * 1.2, y + 0.85, z + (w.R() - 0.5) * 1.2, 0.18, 0.18, 0.18, w.R() * 3, 0.1);
}

export function rock(w: World, x: number, z: number, s: number, color = 0x8f8b86) {
  const y = w.heightAt(x, z);
  w.deco(GEO.dodeca, color, x, y + s * 0.35, z, s * 1.3, s * 0.95, s, w.R() * 6, 0.1);
  w.addBox(x - s * 0.9, y - 1, z - s * 0.7, x + s * 0.9, y + s * 1.1, z + s * 0.7);
}

export function crate(w: World, x: number, z: number, y?: number, s = 1) {
  const gy = y ?? w.heightAt(x, z);
  w.solid(x - s / 2, gy, z - s / 2, x + s / 2, gy + s, z + s / 2, 0xb07a3c, true, 0.08);
  w.solid(x - s / 2 - 0.01, gy + s * 0.45, z - s / 2 - 0.01, x + s / 2 + 0.01, gy + s * 0.55, z + s / 2 + 0.01, 0x7d5528, false, 0);
  return gy + s;
}

const CONTAINER_C = [0xc0392b, 0x2471a3, 0x229954, 0xe08e0b, 0x7d3c98, 0x17a2b8];
export function container(w: World, x: number, z: number, alongX: boolean, y?: number) {
  const gy = y ?? w.heightAt(x, z) - 0.05;
  const c = CONTAINER_C[(w.R() * CONTAINER_C.length) | 0];
  const hx = alongX ? 3 : 1.2, hz = alongX ? 1.2 : 3;
  w.solid(x - hx, gy, z - hz, x + hx, gy + 2.6, z + hz, c, true, 0.03);
  for (let i = -2; i <= 2; i++) {
    const ox = alongX ? i * 1.1 : 0, oz = alongX ? 0 : i * 1.1;
    w.solid(x + ox - (alongX ? 0.06 : hx + 0.03), gy + 0.1, z + oz - (alongX ? hz + 0.03 : 0.06), x + ox + (alongX ? 0.06 : hx + 0.03), gy + 2.5, z + oz + (alongX ? hz + 0.03 : 0.06), c, false, 0.12);
  }
  return gy + 2.6;
}

/** Containers with a crate stair so players can climb on top. */
export function containerStack(w: World, x: number, z: number, alongX: boolean) {
  const top = container(w, x, z, alongX);
  if (w.R() < 0.6) container(w, x, z, alongX, top);
  const ox = alongX ? 3.9 : 0, oz = alongX ? 0 : 3.9;
  const sx = alongX ? 0.9 : 1.2, sz = alongX ? 1.2 : 0.9;
  crate(w, x + ox + sx, z + oz + sz, undefined, 1);
  crate(w, x + ox, z + oz, undefined, 1);
  crate(w, x + ox, z + oz, w.heightAt(x + ox, z + oz) + 1, 1);
  w.loot.push(new THREE.Vector3(x, top, z));
}

export function lowWall(w: World, x: number, z: number, len: number, alongX: boolean, color = 0xa59e94) {
  const y = w.heightAt(x, z);
  w.solid(x - (alongX ? len / 2 : 0.22), y - 0.5, z - (alongX ? 0.22 : len / 2), x + (alongX ? len / 2 : 0.22), y + 1.05, z + (alongX ? 0.22 : len / 2), color, true, 0.05);
}

export function fence(w: World, x0: number, z0: number, x1: number, z1: number, color = 0xc9a26b) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2.5));
  for (let i = 0; i < n; i++) {
    const ax = x0 + ((x1 - x0) * i) / n, az = z0 + ((z1 - z0) * i) / n;
    const bx = x0 + ((x1 - x0) * (i + 1)) / n, bz = z0 + ((z1 - z0) * (i + 1)) / n;
    const y = w.heightAt((ax + bx) / 2, (az + bz) / 2);
    const minX = Math.min(ax, bx) - 0.08, maxX = Math.max(ax, bx) + 0.08, minZ = Math.min(az, bz) - 0.08, maxZ = Math.max(az, bz) + 0.08;
    w.solid(minX, y + 0.55, minZ, maxX, y + 0.7, maxZ, color, false, 0.05);
    w.solid(minX, y + 0.2, minZ, maxX, y + 0.32, maxZ, color, false, 0.05);
    w.solid(ax - 0.08, y - 0.3, az - 0.08, ax + 0.08, y + 0.95, az + 0.08, color, false, 0.05);
    w.addBox(minX, y - 0.3, minZ, maxX, y + 0.9, maxZ);
  }
}

export function car(w: World, x: number, z: number, alongX: boolean) {
  const y = w.heightAt(x, z);
  const c = [0xe63946, 0x1d6fd8, 0xf4d03f, 0x2ecc71, 0xf5f5f5, 0x222222, 0xff7a1a][(w.R() * 7) | 0];
  const hx = alongX ? 2.1 : 0.95, hz = alongX ? 0.95 : 2.1;
  w.solid(x - hx, y + 0.3, z - hz, x + hx, y + 1.05, z + hz, c, true, 0.04);
  const cx = alongX ? 1.2 : 0.8, cz = alongX ? 0.8 : 1.2;
  w.solid(x - cx, y + 1.05, z - cz, x + cx, y + 1.65, z + cz, 0x2b3542, true, 0.02);
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) w.deco(GEO.cyl10, 0x151515, x + ox * (hx - 0.5), y + 0.35, z + oz * (hz - 0.05), 0.35, 0.25, 0.35, 0, 0, alongX ? Math.PI / 2 : 0, alongX ? 0 : Math.PI / 2);
}

export function lamp(w: World, x: number, z: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl6, 0x3a3f47, x, y + 2.2, z, 0.08, 4.4, 0.08, 0, 0);
  w.solid(x - 0.3, y + 4.35, z - 0.18, x + 0.3, y + 4.55, z + 0.18, 0x3a3f47, false, 0);
  w.solid(x - 0.22, y + 4.25, z - 0.12, x + 0.22, y + 4.36, z + 0.12, 0xfff3b0, false, 0);
  w.addBox(x - 0.1, y, z - 0.1, x + 0.1, y + 4.4, z + 0.1);
}

export function tank(w: World, x: number, z: number, r: number, h: number, color: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl16, color, x, y + h / 2, z, r, h, r, 0, 0.03);
  w.deco(GEO.cyl16, 0x9aa0a6, x, y + h + 0.15, z, r * 1.02, 0.3, r * 1.02, 0, 0);
  w.deco(GEO.cyl16, 0xd0d4d8, x, y + h * 0.6, z, r * 1.01, 0.5, r * 1.01, 0, 0);
  w.addBox(x - r * 0.88, y - 1, z - r * 0.88, x + r * 0.88, y + h, z + r * 0.88);
}

export function chimney(w: World, x: number, z: number, h: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl10, 0xb5543c, x, y + h / 2, z, 1.1, h, 1.1, 0, 0.03);
  for (let i = 1; i <= 3; i++) w.deco(GEO.cyl10, 0xf2f2f2, x, y + h - i * 2.4, z, 1.13, 0.6, 1.13, 0, 0);
  w.addBox(x - 1, y - 1, z - 1, x + 1, y + h, z + 1);
}

export function crane(w: World, x: number, z: number, rotY: number) {
  const y = w.heightAt(x, z);
  const Y = 0xf2b51b;
  for (const [ox, oz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) w.solid(x + ox - 0.3, y - 1, z + oz - 0.3, x + ox + 0.3, y + 14, z + oz + 0.3, Y, true, 0.03);
  w.solid(x - 3, y + 14, z - 3, x + 3, y + 15.5, z + 3, Y, false, 0.03);
  const dx = Math.cos(rotY), dz = Math.sin(rotY);
  for (let i = -1; i < 7; i++) w.solid(x + dx * i * 3 - 0.6, y + 15.5, z + dz * i * 3 - 0.6, x + dx * i * 3 + 0.6, y + 16.6, z + dz * i * 3 + 0.6, Y, false, 0.02);
  w.solid(x - 1.5, y + 15.5, z - 1.5, x + 1.5, y + 18, z + 1.5, 0x2b3542, false, 0.02);
}

export function tent(w: World, x: number, z: number, color: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cone6, color, x, y + 1.1, z, 1.9, 2.2, 1.9, w.R() * 3, 0.06);
  w.addBox(x - 1.1, y - 0.5, z - 1.1, x + 1.1, y + 1.3, z + 1.1);
}

export function hay(w: World, x: number, z: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl10, 0xe2c25a, x, y + 0.75, z, 0.75, 1.5, 0.75, 0, 0.06, 0, Math.PI / 2);
  w.addBox(x - 0.75, y - 0.3, z - 0.75, x + 0.75, y + 1.45, z + 0.75);
}

export function windmill(w: World, x: number, z: number) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl10, 0xf3ece0, x, y + 6, z, 1.6, 12, 1.9, 0, 0.02);
  w.deco(GEO.cone7, 0xb83a3a, x, y + 13, z, 2.1, 2.4, 2.1);
  for (let i = 0; i < 4; i++) w.deco(GEO.box, 0xeadfcf, x + 2, y + 11.5, z, 0.2, 9, 1.1, 0, 0.02, i * (Math.PI / 2) + 0.3, 0);
  w.addBox(x - 1.5, y - 1, z - 1.5, x + 1.5, y + 12, z + 1.5);
}

export function radioTower(w: World, x: number, z: number, h: number) {
  const y = w.heightAt(x, z);
  for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) w.deco(GEO.cyl6, 0xd6342c, x + ox * 0.6, y + h / 2, z + oz * 0.6, 0.12, h, 0.12, 0, 0, ox * 0.02, oz * 0.02);
  for (let i = 1; i < h / 4; i++) w.solid(x - 0.8, y + i * 4, z - 0.8, x + 0.8, y + i * 4 + 0.2, z + 0.8, i % 2 ? 0xffffff : 0xd6342c, false, 0);
  w.addBox(x - 1, y - 1, z - 1, x + 1, y + h, z + 1);
}

export function bridge(w: World, x0: number, z0: number, x1: number, z1: number, width: number, deckY: number) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const minX = Math.min(x0, x1) - (alongX ? 0 : width / 2), maxX = Math.max(x0, x1) + (alongX ? 0 : width / 2);
  const minZ = Math.min(z0, z1) - (alongX ? width / 2 : 0), maxZ = Math.max(z0, z1) + (alongX ? width / 2 : 0);
  w.solid(minX, deckY - 0.5, minZ, maxX, deckY, maxZ, 0x7d7368, true, 0.02);
  if (alongX) {
    w.solid(minX, deckY, minZ, maxX, deckY + 1, minZ + 0.3, 0xc8b89a, true, 0.02);
    w.solid(minX, deckY, maxZ - 0.3, maxX, deckY + 1, maxZ, 0xc8b89a, true, 0.02);
    for (let px = minX + 4; px < maxX - 2; px += 8) w.solid(px - 0.6, -4, (minZ + maxZ) / 2 - 1.2, px + 0.6, deckY - 0.5, (minZ + maxZ) / 2 + 1.2, 0x6d665e, true, 0.02);
  } else {
    w.solid(minX, deckY, minZ, minX + 0.3, deckY + 1, maxZ, 0xc8b89a, true, 0.02);
    w.solid(maxX - 0.3, deckY, minZ, maxX, deckY + 1, maxZ, 0xc8b89a, true, 0.02);
    for (let pz = minZ + 4; pz < maxZ - 2; pz += 8) w.solid((minX + maxX) / 2 - 1.2, -4, pz - 0.6, (minX + maxX) / 2 + 1.2, deckY - 0.5, pz + 0.6, 0x6d665e, true, 0.02);
  }
}

export function bunker(w: World, x: number, z: number, rot: number) {
  const gy = w.heightAt(x, z);
  const k = new Kit(w, x, gy, z, rot);
  const W = 7, D = 5, H = 2.6, C = 0x7f8a6a;
  k.box(-W / 2 - 0.3, -2, -D / 2 - 0.3, W / 2 + 0.3, 0.1, D / 2 + 0.3, 0x6f6a5e, true, 0.02);
  wall(k, 'x', -W / 2, W / 2, -D / 2, -D / 2 + 0.4, 0.1, H, [{ c: -1.5, w: 2.2, b: 1.1, t: 1.6 }, { c: 1.5, w: 2.2, b: 1.1, t: 1.6 }], C, 0x5f6a4a, undefined, -1);
  wall(k, 'x', -W / 2, W / 2, D / 2 - 0.4, D / 2, 0.1, H, [DOOR(0)], C, 0x5f6a4a, undefined, 1);
  k.box(-W / 2, 0.1, -D / 2 + 0.4, -W / 2 + 0.4, H + 0.1, D / 2 - 0.4, C, true, 0.02);
  k.box(W / 2 - 0.4, 0.1, -D / 2 + 0.4, W / 2, H + 0.1, D / 2 - 0.4, C, true, 0.02);
  k.box(-W / 2 - 0.2, H + 0.1, -D / 2 - 0.2, W / 2 + 0.2, H + 0.6, D / 2 + 0.2, 0x6c775a, true, 0.02);
  k.loot(0, 0.15, 0);
}

export function sandbags(w: World, x: number, z: number, alongX: boolean) {
  const y = w.heightAt(x, z);
  const L = 3.2;
  w.solid(x - (alongX ? L / 2 : 0.4), y - 0.3, z - (alongX ? 0.4 : L / 2), x + (alongX ? L / 2 : 0.4), y + 0.95, z + (alongX ? 0.4 : L / 2), 0xc8b483, true, 0.08);
}

export function bench(w: World, x: number, z: number, alongX: boolean) {
  const y = w.heightAt(x, z);
  w.solid(x - (alongX ? 0.9 : 0.25), y + 0.4, z - (alongX ? 0.25 : 0.9), x + (alongX ? 0.9 : 0.25), y + 0.5, z + (alongX ? 0.25 : 0.9), 0x9b6a3a, true, 0.05);
}
