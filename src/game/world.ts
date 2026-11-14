import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain, makeNoise } from './terrain';
import { MAP_DEFS, type MapId, type MapDef, type Poi } from './maps';
import { groundMaterial } from './ground';
import { profile } from '../save';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface Wall {
  x: number; z: number; y0: number; y1: number;
  hw: number; hd: number;
  c: number; s: number;
  group: { hp: number };
}

const CELL = 8;
const CHUNK = 40;
export const STEP = 0.45;
const key = (ix: number, iz: number) => (ix + 512) * 1024 + (iz + 512);

class Batch {
  parts: THREE.BufferGeometry[] = [];
  cx = 0;
  cz = 0;
}

const col = new THREE.Color();
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
unitBox.deleteAttribute('uv');
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eul = new THREE.Euler();
const vs = new THREE.Vector3();
const vp = new THREE.Vector3();
const prepared = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function prep(g: THREE.BufferGeometry) {
  let p = prepared.get(g);
  if (!p) {
    p = g.index ? g.toNonIndexed() : g.clone();
    if (p.getAttribute('uv')) p.deleteAttribute('uv');
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    prepared.set(g, p);
  }
  return p;
}

export class World {
  group = new THREE.Group();
  boxes: Box[] = [];
  private stamps: number[] = [];
  private stamp = 1;
  private grid = new Map<number, number[]>();
  private batches = new Map<number, Batch>();
  private chunks: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  walls: Wall[] = [];
  hitWall: Wall | null = null;
  ceil = false;
  def: MapDef;
  terrain: Terrain;
  radius: number;
  cx = 0;
  cz = 0;
  clampR: number;
  pois: Poi[];
  loot: THREE.Vector3[] = [];
  spawnsA: THREE.Vector3[] = [];
  spawnsB: THREE.Vector3[] = [];
  targets: THREE.Vector3[] = [];
  R: () => number;
  noise: ReturnType<typeof makeNoise>;
  water: THREE.Mesh;
  sky: THREE.Mesh;
  clouds = new THREE.Group();
  groundColor: HTMLCanvasElement;

  constructor(id: MapId, seed: number) {
    this.def = MAP_DEFS[id];
    this.R = rng(seed);
    this.noise = makeNoise(this.def.seed);
    this.radius = this.def.radius;
    this.clampR = this.radius;
    this.pois = this.def.pois.map((p) => ({ ...p }));
    const S = this.radius + 40;
    const hf = this.def.height(this);
    this.terrain = new Terrain(S, this.def.step, hf);
    for (const p of this.pois) p.y = this.terrain.heightAt(p.x, p.z);
    const res = profile.settings.quality === 'high' ? 2048 : profile.settings.quality === 'medium' ? 1536 : 1024;
    const gm = this.def.ground(this, res);
    this.groundColor = gm.color;
    this.group.add(this.terrain.mesh(groundMaterial(gm.color, gm.mask, S)));

    this.water = new THREE.Mesh(new THREE.CircleGeometry(S + 600, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: this.def.sky.water }));
    this.water.position.y = 0;
    this.group.add(this.water);

    this.sky = this.makeSky();
    this.group.add(this.sky);

    this.def.populate(this);
    this.buildChunks();
    this.makeClouds();
    this.group.add(this.clouds);
  }

  // ------------------------------------------------------------------ batching
  private batchAt(x: number, z: number) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const k = key(ix, iz);
    let b = this.batches.get(k);
    if (!b) {
      b = new Batch();
      b.cx = (ix + 0.5) * CHUNK;
      b.cz = (iz + 0.5) * CHUNK;
      this.batches.set(k, b);
    }
    return b;
  }

  private push(src: THREE.BufferGeometry, color: number, m: THREE.Matrix4, jitter: number) {
    const g = src.clone();
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    col.setHex(color);
    if (jitter) col.offsetHSL(0, 0, (this.R() - 0.5) * jitter);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.batchAt(m.elements[12], m.elements[14]).parts.push(g);
  }

  private buildChunks() {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const b of this.batches.values()) {
      if (!b.parts.length) continue;
      const merged = mergeGeometries(b.parts, false)!;
      b.parts.forEach((p) => p.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.chunks.push({ mesh, x: b.cx, z: b.cz });
    }
    this.batches.clear();
  }

  /** Hide chunks beyond the fog distance; cheap per-frame culling for phones. */
  updateVisibility(cam: THREE.Vector3, far: number) {
    const lim = far + CHUNK;
    for (const c of this.chunks) c.mesh.visible = Math.abs(c.x - cam.x) < lim && Math.abs(c.z - cam.z) < lim;
    this.sky.position.set(cam.x, 0, cam.z);
  }

  // ------------------------------------------------------------------ build helpers
  /** Axis-aligned solid box (world coords). */
  solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: number, collide = true, jitter = 0.04) {
    const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    m4.compose(vp.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2), q.identity(), vs.set(w, h, d));
    this.push(unitBox, color, m4, jitter);
    if (collide) this.addBox(minX, minY, minZ, maxX, maxY, maxZ);
  }

  deco(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, jitter = 0.05, rx = 0, rz = 0) {
    eul.set(rx, ry, rz);
    q.setFromEuler(eul);
    m4.compose(vp.set(x, y, z), q, vs.set(sx, sy, sz));
    this.push(prep(g), color, m4, jitter);
  }

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    const i = this.boxes.length;
    this.boxes.push({ minX, minY, minZ, maxX, maxY, maxZ });
    this.stamps.push(0);
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = key(ix, iz);
        let c = this.grid.get(k);
        if (!c) this.grid.set(k, (c = []));
        c.push(i);
      }
  }

  free(x: number, z: number, r: number) {
    const list = this.cellBoxes(x - r, z - r, x + r, z + r, this.near);
    for (const i of list) {
      const b = this.boxes[i];
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
    }
    return true;
  }

  heightAt(x: number, z: number) {
    return this.terrain.heightAt(x, z);
  }

  private makeSky() {
    const sky = new THREE.SphereGeometry(600, 16, 10);
    const pos = sky.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(this.def.sky.top);
    const hor = new THREE.Color(this.def.sky.horizon);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 600);
      c.copy(hor).lerp(top, Math.min(1, Math.pow(t * 1.5, 0.65)));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    sky.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
  }

  private makeClouds() {
    const parts: THREE.BufferGeometry[] = [];
    const ico = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const a = this.R() * Math.PI * 2, r = 60 + this.R() * (this.radius + 80);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 95 + this.R() * 40;
      for (let k = 0; k < 4; k++) {
        const g = ico.clone();
        const s = 6 + this.R() * 7;
        g.scale(s * 1.4, s * 0.6, s);
        g.translate(cx + (k - 1.5) * 7, cy + this.R() * 3, cz + (this.R() - 0.5) * 6);
        parts.push(g);
      }
    }
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    this.clouds.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: this.def.sky.cloud, fog: false, transparent: true, opacity: 0.92 })));
  }

  // ------------------------------------------------------------------ queries
  private near: number[] = [];

  private cellBoxes(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]) {
    out.length = 0;
    this.stamp++;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const c = this.grid.get(key(ix, iz));
        if (!c) continue;
        for (const i of c) {
          if (this.stamps[i] === this.stamp) continue;
          this.stamps[i] = this.stamp;
          out.push(i);
        }
      }
    return out;
  }

  /** Push the actor out of solids, handle ceilings and return the floor height. */
  resolve(p: THREE.Vector3, r: number, h: number, vy = 0): number {
    let ground = 0;
    this.ceil = false;
    for (let pass = 0; pass < 2; pass++) {
      ground = this.terrain.heightAt(p.x, p.z);
      const list = this.cellBoxes(p.x - r - 0.1, p.z - r - 0.1, p.x + r + 0.1, p.z + r + 0.1, this.near);
      for (const i of list) {
        const b = this.boxes[i];
        if (b.maxY <= p.y + STEP) {
          const m = r * 0.5;
          if (p.x > b.minX - m && p.x < b.maxX + m && p.z > b.minZ - m && p.z < b.maxZ + m && b.maxY > ground) ground = b.maxY;
          continue;
        }
        if (b.minY >= p.y + h) continue;
        if (vy > 0 && b.minY > p.y + h * 0.55) {
          const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
          if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < r * r * 0.5) {
            p.y = b.minY - h - 0.01;
            this.ceil = true;
            continue;
          }
        }
        this.pushOut(p, r, b.minX, b.minZ, b.maxX, b.maxZ);
      }
      for (const w of this.walls) {
        if (w.y1 <= p.y + STEP || w.y0 >= p.y + h) continue;
        const dx = p.x - w.x, dz = p.z - w.z;
        const lx = dx * w.c - dz * w.s, lz = dx * w.s + dz * w.c;
        const tmp = vp.set(lx, 0, lz);
        if (this.pushOut(tmp, r, -w.hw, -w.hd, w.hw, w.hd)) {
          p.x = w.x + tmp.x * w.c + tmp.z * w.s;
          p.z = w.z - tmp.x * w.s + tmp.z * w.c;
        }
      }
    }
    const dx = p.x - this.cx, dz = p.z - this.cz;
    const d = Math.hypot(dx, dz), lim = this.clampR - 0.5;
    if (d > lim) {
      p.x = this.cx + (dx * lim) / d;
      p.z = this.cz + (dz * lim) / d;
    }
    return ground;
  }

  private pushOut(p: THREE.Vector3, r: number, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    const cx = Math.max(minX, Math.min(p.x, maxX));
    const cz = Math.max(minZ, Math.min(p.z, maxZ));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      p.x += dx * k;
      p.z += dz * k;
    } else {
      const l = p.x - minX, rr = maxX - p.x, t = p.z - minZ, bb = maxZ - p.z;
      const m = Math.min(l, rr, t, bb);
      if (m === l) p.x = minX - r;
      else if (m === rr) p.x = maxX + r;
      else if (m === t) p.z = minZ - r;
      else p.z = maxZ + r;
    }
    return true;
  }

  groundAt(x: number, z: number, y: number): number {
    let g = this.terrain.heightAt(x, z);
    const list = this.cellBoxes(x - 0.2, z - 0.2, x + 0.2, z + 0.2, this.near);
    for (const i of list) {
      const b = this.boxes[i];
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y + STEP && b.maxY > g) g = b.maxY;
    }
    return g;
  }

  /** Distance along a normalised ray to the first solid, or maxT. Sets hitWall when a gloo wall is hit. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    this.hitWall = null;
    let best = maxT;
    let ix = Math.floor(o.x / CELL), iz = Math.floor(o.z / CELL);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const dX = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const dZ = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tX = Math.abs(d.x) > 1e-9 ? ((ix + (sx > 0 ? 1 : 0)) * CELL - o.x) / d.x : Infinity;
    let tZ = Math.abs(d.z) > 1e-9 ? ((iz + (sz > 0 ? 1 : 0)) * CELL - o.z) / d.z : Infinity;
    const ivx = 1 / d.x, ivy = 1 / d.y, ivz = 1 / d.z;
    this.stamp++;
    let t = 0;
    for (let guard = 0; guard < 400 && t <= best; guard++) {
      const c = this.grid.get(key(ix, iz));
      if (c)
        for (const i of c) {
          if (this.stamps[i] === this.stamp) continue;
          this.stamps[i] = this.stamp;
          const b = this.boxes[i];
          const h = slab(o.x, o.y, o.z, ivx, ivy, ivz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
          if (h < best) best = h;
        }
      if (tX < tZ) {
        t = tX;
        tX += dX;
        ix += sx;
      } else {
        t = tZ;
        tZ += dZ;
        iz += sz;
      }
    }
    const th = this.terrain.raycast(o, d, best);
    if (th < best) best = th;
    for (const w of this.walls) {
      const dx = o.x - w.x, dz = o.z - w.z;
      const lox = dx * w.c - dz * w.s, loz = dx * w.s + dz * w.c;
      const ldx = d.x * w.c - d.z * w.s, ldz = d.x * w.s + d.z * w.c;
      const h = slab(lox, o.y, loz, 1 / ldx, ivy, 1 / ldz, -w.hw, w.y0, -w.hd, w.hw, w.y1, w.hd);
      if (h < best) {
        best = h;
        this.hitWall = w;
      }
    }
    return best;
  }

  addWall(x: number, y: number, z: number, yaw: number, hw: number, hd: number, h: number, group: { hp: number }): Wall {
    const w: Wall = { x, z, y0: y, y1: y + h, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw), group };
    this.walls.push(w);
    return w;
  }

  removeWall(w: Wall) {
    const i = this.walls.indexOf(w);
    if (i >= 0) this.walls.splice(i, 1);
  }

  /** Top-down colour map for minimap and big map. */
  paintMap(size: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const cx = cv.getContext('2d')!;
    cx.imageSmoothingEnabled = true;
    cx.drawImage(this.groundColor, 0, 0, size, size);
    const img = cx.getImageData(0, 0, size, size);
    const S = this.terrain.S;
    const wc = new THREE.Color(this.def.sky.water);
    const wr = (wc.r ** (1 / 2.2)) * 255, wg = (wc.g ** (1 / 2.2)) * 255, wb = (wc.b ** (1 / 2.2)) * 255;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const h = this.terrain.heightAt(-S + ((i + 0.5) / size) * S * 2, -S + ((j + 0.5) / size) * S * 2);
        if (h >= -0.05) continue;
        const k = (j * size + i) * 4, d = Math.max(0.7, 1 + h * 0.03);
        img.data[k] = wr * d;
        img.data[k + 1] = wg * d;
        img.data[k + 2] = wb * d;
      }
    cx.putImageData(img, 0, 0);
    const k = size / (S * 2);
    for (const b of this.boxes) {
      const g = this.terrain.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      const top = b.maxY - g;
      if (top < 0.9 || (b.maxX - b.minX) * (b.maxZ - b.minZ) < 0.6) continue;
      cx.fillStyle = top > 5 ? '#f4efe6' : top > 2.4 ? '#d9d1c2' : '#a99c84';
      cx.fillRect((b.minX + S) * k, (b.minZ + S) * k, Math.max(1, (b.maxX - b.minX) * k), Math.max(1, (b.maxZ - b.minZ) * k));
    }
    return cv;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mt = m.material as THREE.Material;
        (mt.userData.textures as THREE.Texture[] | undefined)?.forEach((t) => t.dispose());
        mt.dispose();
      }
    });
  }
}

function slab(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let t1 = (x0 - ox) * ix, t2 = (x1 - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (y0 - oy) * iy;
  t2 = (y1 - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (z0 - oz) * iz;
  t2 = (z1 - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (!(tmax >= Math.max(tmin, 0))) return Infinity;
  return tmin < 0 ? 0 : tmin;
}
