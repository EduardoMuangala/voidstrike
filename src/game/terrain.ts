import * as THREE from 'three';

/** Seeded value-noise helpers. */
export function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (ix: number, iz: number) => perm[(perm[ix & 255] + iz) & 255] / 255;
  const fade = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = fade(x - ix), fz = fade(z - iz);
    const a = val(ix, iz), b = val(ix + 1, iz), c = val(ix, iz + 1), d = val(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const fbm = (x: number, z: number, oct = 4) => {
    let sum = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * f, z * f) * amp;
      f *= 2.03;
      amp *= 0.5;
    }
    return sum / 0.9375;
  };
  return { noise, fbm };
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Terrain {
  S: number;
  step: number;
  n: number;
  h: Float32Array;
  maxH = 0;

  constructor(S: number, step: number, fn: (x: number, z: number) => number) {
    this.S = S;
    this.step = step;
    this.n = Math.round((S * 2) / step) + 1;
    this.h = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const v = fn(-S + i * step, -S + j * step);
        this.h[j * this.n + i] = v;
        if (v > this.maxH) this.maxH = v;
      }
  }

  heightAt(x: number, z: number): number {
    const gx = (x + this.S) / this.step, gz = (z + this.S) / this.step;
    if (gx < 0 || gz < 0 || gx >= this.n - 1 || gz >= this.n - 1) return -6;
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const n = this.n, h = this.h;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    // match the triangle split used by the mesh
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Distance along a normalised ray to the terrain surface, or Infinity. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    if (o.y > this.maxH + 0.5 && d.y >= 0) return Infinity;
    const stepT = this.step * 0.6;
    let prevT = 0;
    let prevD = o.y - this.heightAt(o.x, o.z);
    if (prevD < 0) return 0;
    for (let t = stepT; t <= maxT + stepT; t += stepT) {
      const tt = Math.min(t, maxT);
      const y = o.y + d.y * tt;
      if (y > this.maxH + 0.5 && d.y >= 0) return Infinity;
      const diff = y - this.heightAt(o.x + d.x * tt, o.z + d.z * tt);
      if (diff < 0) {
        let lo = prevT, hi = tt;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m - this.heightAt(o.x + d.x * m, o.z + d.z * m) < 0) hi = m;
          else lo = m;
        }
        return hi;
      }
      prevT = tt;
      prevD = diff;
      if (tt >= maxT) break;
    }
    return Infinity;
  }

  mesh(color: (x: number, z: number, h: number, slope: number) => number): THREE.Mesh {
    const n = this.n, S = this.S, st = this.step;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -S + i * st, z = -S + j * st, y = this.h[k];
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        const hx = this.h[j * n + Math.min(n - 1, i + 1)] - this.h[j * n + Math.max(0, i - 1)];
        const hz = this.h[Math.min(n - 1, j + 1) * n + i] - this.h[Math.max(0, j - 1) * n + i];
        const slope = Math.hypot(hx, hz) / (2 * st);
        c.setHex(color(x, z, y, slope));
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
        idx[p++] = a; idx[p++] = cc; idx[p++] = b;
        idx[p++] = b; idx[p++] = cc; idx[p++] = d;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.matrixAutoUpdate = false;
    return m;
  }
}
