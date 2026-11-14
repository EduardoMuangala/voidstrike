import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type MapKind = 'island' | 'village' | 'range';

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
  hp: number;
  id: number;
}

const CELL = 8;
const STEP = 0.45;
const key = (ix: number, iz: number) => (ix + 512) * 1024 + (iz + 512);

class Batch {
  parts: THREE.BufferGeometry[] = [];
  private col = new THREE.Color();
  add(g: THREE.BufferGeometry, color: number, m: THREE.Matrix4, jitter = 0) {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    ng.applyMatrix4(m);
    ng.deleteAttribute('uv');
    const n = ng.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    this.col.setHex(color);
    if (jitter) this.col.offsetHSL(0, 0, (Math.random() - 0.5) * jitter);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.col.r;
      arr[i * 3 + 1] = this.col.g;
      arr[i * 3 + 2] = this.col.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(ng);
  }
  build(material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eul = new THREE.Euler();
const vs = new THREE.Vector3();
const vp = new THREE.Vector3();

const HOUSE_COLORS = [0xf4e1c1, 0xe9c79f, 0xb9d8e3, 0xf2b8a8, 0xd9e4ad, 0xf6f1e7, 0xc7b8e6];
const ROOF_COLORS = [0xc0392b, 0x2c6fbb, 0x6d4c41, 0x3d8b5c, 0xd35400, 0x34495e];

export class World {
  group = new THREE.Group();
  boxes: Box[] = [];
  private stamps: number[] = [];
  private stamp = 1;
  private grid = new Map<number, number[]>();
  walls: Wall[] = [];
  radius: number;
  loot: THREE.Vector3[] = [];
  spawnsA: THREE.Vector3[] = [];
  spawnsB: THREE.Vector3[] = [];
  targets: THREE.Vector3[] = [];
  private batch = new Batch();
  private R: () => number;
  private wallSeq = 0;
  hitWall: Wall | null = null;

  kind: MapKind;

  constructor(kind: MapKind, seed: number) {
    this.kind = kind;
    this.R = rng(seed);
    this.radius = kind === 'island' ? 118 : kind === 'village' ? 50 : 42;
    this.buildGround();
    if (kind === 'island') this.genIsland();
    else if (kind === 'village') this.genVillage();
    else this.genRange();
    const mesh = this.batch.build(new THREE.MeshLambertMaterial({ vertexColors: true }));
    if (mesh) this.group.add(mesh);
  }

  // ------------------------------------------------------------------ geometry helpers
  private solid(x: number, y: number, z: number, w: number, h: number, d: number, color: number, collide = true, jitter = 0.04) {
    m4.compose(vp.set(x, y + h / 2, z), q.identity(), vs.set(w, h, d));
    this.batch.add(unitBox, color, m4, jitter);
    if (collide) this.addBox(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
  }

  private deco(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, jitter = 0.05) {
    eul.set(0, ry, 0);
    q.setFromEuler(eul);
    m4.compose(vp.set(x, y, z), q, vs.set(sx, sy, sz));
    this.batch.add(g, color, m4, jitter);
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

  private buildGround() {
    const R = this.radius;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cx = cv.getContext('2d')!;
    const base = this.kind === 'range' ? [150, 140, 110] : [112, 170, 72];
    cx.fillStyle = `rgb(${base.join(',')})`;
    cx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const v = (this.R() - 0.5) * 34;
      cx.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v * 0.6 | 0})`;
      cx.fillRect(this.R() * 128, this.R() * 128, 2 + this.R() * 3, 2 + this.R() * 3);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(R / 6, R / 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 4, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    this.group.add(ground);

    const sand = new THREE.Mesh(new THREE.RingGeometry(R + 3.9, R + 22, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe8d39a }));
    sand.position.y = -0.05;
    this.group.add(sand);

    const water = new THREE.Mesh(new THREE.CircleGeometry(820, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2a8fc7 }));
    water.position.y = -0.35;
    this.group.add(water);

    // sky dome with vertex-colour gradient
    const sky = new THREE.SphereGeometry(900, 16, 10);
    const pos = sky.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x3d8fe0);
    const hor = new THREE.Color(0xcfe9ff);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 900);
      c.copy(hor).lerp(top, Math.min(1, Math.pow(t * 1.6, 0.7)));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    sky.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const skyMesh = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -10;
    this.group.add(skyMesh);
  }

  private road(x0: number, z0: number, x1: number, z1: number, w = 5) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    eul.set(0, Math.atan2(dx, dz), 0);
    q.setFromEuler(eul);
    m4.compose(vp.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2), q, vs.set(w, 0.04, len));
    this.batch.add(unitBox, 0x6b6660, m4, 0.02);
    m4.compose(vp.set((x0 + x1) / 2, 0.045, (z0 + z1) / 2), q, vs.set(0.18, 0.01, len));
    this.batch.add(unitBox, 0xf0e6c8, m4, 0);
  }

  private house(x: number, z: number, w: number, d: number, door: number) {
    const R = this.R;
    const col = HOUSE_COLORS[(R() * HOUSE_COLORS.length) | 0];
    const roof = ROOF_COLORS[(R() * ROOF_COLORS.length) | 0];
    const H = 3.2, t = 0.25, dw = 1.7, dh = 2.35;
    this.solid(x, 0, z, w + 0.6, 0.12, d + 0.6, 0x9e9a92, false);
    this.solid(x, 0.12, z, w - 0.2, 0.02, d - 0.2, 0xa8784a, false);
    const sides: [number, number, number, number, boolean][] = [
      [x, z - d / 2, w, t, true],
      [x, z + d / 2, w, t, true],
      [x - w / 2, z, t, d, false],
      [x + w / 2, z, t, d, false],
    ];
    sides.forEach(([sx, sz, sw, sd, alongX], i) => {
      if (i === door) {
        const len = alongX ? sw : sd;
        const seg = (len - dw) / 2;
        const off = dw / 2 + seg / 2;
        if (alongX) {
          this.solid(sx - off, 0, sz, seg, H, sd, col);
          this.solid(sx + off, 0, sz, seg, H, sd, col);
          this.solid(sx, dh, sz, dw, H - dh, sd, col);
        } else {
          this.solid(sx, 0, sz - off, sw, H, seg, col);
          this.solid(sx, 0, sz + off, sw, H, seg, col);
          this.solid(sx, dh, sz, sw, H - dh, dw, col);
        }
      } else {
        this.solid(sx, 0, sz, sw, H, sd, col);
        // windows
        const len = alongX ? sw : sd;
        for (const o of [-len / 4, len / 4]) {
          const wx = alongX ? sx + o : sx;
          const wz = alongX ? sz : sz + o;
          const ox = alongX ? 0 : Math.sign(sx - x) * 0.01;
          const oz = alongX ? Math.sign(sz - z) * 0.01 : 0;
          this.solid(wx + ox, 1.2, wz + oz, alongX ? 1.1 : t + 0.04, 0.9, alongX ? t + 0.04 : 1.1, 0x29435c, false, 0);
          this.solid(wx + ox, 1.12, wz + oz, alongX ? 1.3 : t + 0.1, 0.08, alongX ? t + 0.1 : 1.3, 0xffffff, false, 0);
        }
      }
    });
    // ceiling slab (blocks camera from clipping above) and roof
    this.solid(x, H, z, w + 0.5, 0.2, d + 0.5, roof);
    eul.set(0, Math.PI / 4, 0);
    q.setFromEuler(eul);
    m4.compose(vp.set(x, H + 0.2 + 0.9, z), q, vs.set((w + 0.8) * 0.71, 1.8, (d + 0.8) * 0.71));
    this.batch.add(new THREE.ConeGeometry(1, 1, 4), roof, m4, 0.03);
    // furniture / loot spots
    this.solid(x + w / 2 - 1.1, 0.12, z - d / 2 + 0.9, 1.4, 0.8, 0.9, 0x7a5434);
    this.loot.push(new THREE.Vector3(x, 0.14, z), new THREE.Vector3(x - w / 4, 0.14, z + d / 4));
  }

  private tree(x: number, z: number, s = 1) {
    const R = this.R;
    this.deco(new THREE.CylinderGeometry(0.18, 0.26, 1, 6), 0x6b4428, x, 1.2 * s, z, s, 2.4 * s, s);
    const g = R() < 0.5;
    const green = [0x3f8f3a, 0x4c9a2a, 0x2f7d3b, 0x5aa83c][(R() * 4) | 0];
    if (g) {
      this.deco(new THREE.ConeGeometry(1.6, 2.6, 7), green, x, 3.3 * s, z, s, s, s, R() * 6, 0.08);
      this.deco(new THREE.ConeGeometry(1.2, 2.0, 7), green, x, 4.6 * s, z, s, s, s, R() * 6, 0.08);
    } else {
      this.deco(new THREE.IcosahedronGeometry(1.7, 0), green, x, 3.6 * s, z, s, s * 0.95, s, R() * 6, 0.08);
      this.deco(new THREE.IcosahedronGeometry(1.1, 0), green, x + 0.6 * s, 4.6 * s, z + 0.3 * s, s, s, s, R() * 6, 0.08);
    }
    this.addBox(x - 0.28 * s, 0, z - 0.28 * s, x + 0.28 * s, 3 * s, z + 0.28 * s);
  }

  private rock(x: number, z: number, s: number) {
    this.deco(new THREE.DodecahedronGeometry(1, 0), 0x8d8a85, x, s * 0.45, z, s * 1.3, s * 0.9, s, this.R() * 6, 0.1);
    this.addBox(x - s * 0.95, 0, z - s * 0.75, x + s * 0.95, s * 1.2, z + s * 0.75);
  }

  private crate(x: number, z: number, y = 0, s = 1) {
    this.solid(x, y, z, s, s, s, 0xb07a3c, true, 0.08);
    this.solid(x, y + s * 0.45, z, s + 0.02, 0.1, s + 0.02, 0x7d5528, false, 0);
  }

  private container(x: number, z: number, rot: boolean) {
    const cols = [0xc0392b, 0x2471a3, 0x229954, 0xd68910, 0x7d3c98];
    const c = cols[(this.R() * cols.length) | 0];
    const w = rot ? 2.4 : 6, d = rot ? 6 : 2.4;
    this.solid(x, 0, z, w, 2.6, d, c, true, 0.03);
    for (let i = -2; i <= 2; i++)
      this.solid(x + (rot ? 0 : i * 1.1), 0.1, z + (rot ? i * 1.1 : 0), rot ? w + 0.06 : 0.12, 2.4, rot ? 0.12 : d + 0.06, c, false, 0.12);
  }

  private lowWall(x: number, z: number, len: number, alongX: boolean) {
    this.solid(x, 0, z, alongX ? len : 0.45, 1.05, alongX ? 0.45 : len, 0xa59e94, true, 0.05);
  }

  private free(x: number, z: number, r: number) {
    for (const b of this.boxes) if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
    return true;
  }

  private town(cx: number, cz: number, n: number, spread: number) {
    const R = this.R;
    this.road(cx - spread - 6, cz, cx + spread + 6, cz, 5);
    this.road(cx, cz - spread - 6, cx, cz + spread + 6, 5);
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < n; tries++) {
      const qx = R() < 0.5 ? -1 : 1, qz = R() < 0.5 ? -1 : 1;
      const w = 7 + R() * 3, d = 6 + R() * 3;
      const x = cx + qx * (6 + w / 2 + R() * (spread - 6));
      const z = cz + qz * (6 + d / 2 + R() * (spread - 6));
      if (Math.hypot(x, z) > this.radius - 12) continue;
      if (!this.free(x, z, Math.max(w, d) / 2 + 2)) continue;
      const door = Math.abs(x - cx) > Math.abs(z - cz) ? (qx < 0 ? 3 : 2) : qz < 0 ? 1 : 0;
      this.house(x, z, w, d, door);
      placed++;
    }
    for (let i = 0; i < 4; i++) {
      const x = cx + (R() - 0.5) * spread * 1.6, z = cz + (R() - 0.5) * spread * 1.6;
      if (this.free(x, z, 1.5)) {
        this.crate(x, z);
        if (R() < 0.4) this.crate(x, z, 1, 0.8);
        this.loot.push(new THREE.Vector3(x + 1.2, 0, z));
      }
    }
  }

  private scatter(nTrees: number, nRocks: number, nCrates: number) {
    const R = this.R, rad = this.radius - 4;
    for (let i = 0; i < nTrees; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.free(x, z, 2.2)) this.tree(x, z, 0.85 + R() * 0.5);
    }
    for (let i = 0; i < nRocks; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.free(x, z, 2)) this.rock(x, z, 0.7 + R() * 1.1);
    }
    for (let i = 0; i < nCrates; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.free(x, z, 2)) {
        this.crate(x, z);
        if (R() < 0.5) this.crate(x + 1.05, z + (R() - 0.5) * 0.3);
        if (R() < 0.3) this.lowWall(x, z + 2.2, 3.5, true);
        this.loot.push(new THREE.Vector3(x - 1.4, 0, z));
      }
    }
  }

  private genIsland() {
    const R = this.R;
    const towns: [number, number][] = [[0, 0]];
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const r = 62 + R() * 18;
      towns.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 1; i < towns.length; i++) this.road(towns[0][0], towns[0][1], towns[i][0], towns[i][1], 4);
    towns.forEach(([x, z], i) => this.town(x, z, i === 0 ? 6 : 4, i === 0 ? 20 : 15));
    // port with containers near first outer town
    const [px, pz] = towns[1];
    for (let i = 0; i < 6; i++) {
      const x = px + (R() - 0.5) * 30, z = pz + (R() - 0.5) * 30;
      if (this.free(x, z, 4)) {
        this.container(x, z, R() < 0.5);
        this.loot.push(new THREE.Vector3(x + 3.5, 0, z + 3.5));
      }
    }
    this.scatter(170, 60, 40);
  }

  private genVillage() {
    const R = this.R;
    this.road(-48, 0, 48, 0, 6);
    this.road(0, -40, 0, 40, 5);
    const lots: [number, number][] = [[-22, -14], [-22, 14], [22, -14], [22, 14], [-8, -24], [8, 24], [-8, 24], [8, -24]];
    lots.forEach(([x, z], i) => this.house(x + (R() - 0.5) * 2, z + (R() - 0.5) * 2, 8 + R() * 2, 7 + R() * 1.5, Math.abs(z) > 20 ? (z < 0 ? 1 : 0) : i % 2 ? 0 : 1));
    this.container(0, -8, false);
    this.container(0, 8, false);
    this.container(-34, -6, true);
    this.container(34, 6, true);
    for (const [x, z] of [[-12, 0], [12, 0], [-30, 22], [30, -22], [-30, -24], [30, 24], [0, -34], [0, 34]]) {
      this.crate(x, z + 1.5);
      this.crate(x + 1.05, z + 1.5);
      this.crate(x + 0.5, z + 1.5, 1, 0.8);
    }
    this.lowWall(-17, 0, 5, false);
    this.lowWall(17, 0, 5, false);
    this.lowWall(-28, -32, 6, true);
    this.lowWall(28, 32, 6, true);
    for (let i = 0; i < 4; i++) {
      this.spawnsA.push(new THREE.Vector3(-42, 0, -6 + i * 4));
      this.spawnsB.push(new THREE.Vector3(42, 0, -6 + i * 4));
    }
    this.scatter(40, 14, 0);
  }

  private genRange() {
    for (let i = 0; i < 5; i++) {
      const x = -24 + i * 12;
      this.lowWall(x, -8, 4, true);
      this.solid(x, 0, -30, 3, 0.25, 3, 0xd1c7b0, false);
      this.targets.push(new THREE.Vector3(x, 0, 10 + i * 6));
    }
    this.crate(-30, 0);
    this.crate(-30, 1.1);
    this.crate(30, 0);
    this.container(0, 30, false);
    this.house(-28, 22, 8, 7, 0);
    this.house(28, 22, 8, 7, 0);
    this.spawnsA.push(new THREE.Vector3(0, 0, -20));
    this.scatter(24, 8, 0);
  }

  // ------------------------------------------------------------------ queries
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

  private near: number[] = [];

  /** Push the actor out of solids and return the floor height under it. */
  resolve(p: THREE.Vector3, r: number, h: number): number {
    let ground = 0;
    for (let pass = 0; pass < 2; pass++) {
      ground = 0;
      const list = this.cellBoxes(p.x - r - 0.1, p.z - r - 0.1, p.x + r + 0.1, p.z + r + 0.1, this.near);
      for (const i of list) {
        const b = this.boxes[i];
        if (b.maxY <= p.y + STEP) {
          if (p.x > b.minX - r * 0.5 && p.x < b.maxX + r * 0.5 && p.z > b.minZ - r * 0.5 && p.z < b.maxZ + r * 0.5 && b.maxY > ground) ground = b.maxY;
          continue;
        }
        if (b.minY >= p.y + h) continue;
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
    const d = Math.hypot(p.x, p.z), lim = this.radius - 0.5;
    if (d > lim) {
      p.x *= lim / d;
      p.z *= lim / d;
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
    let g = 0;
    const list = this.cellBoxes(x - 0.2, z - 0.2, x + 0.2, z + 0.2, this.near);
    for (const i of list) {
      const b = this.boxes[i];
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y + STEP && b.maxY > g) g = b.maxY;
    }
    return g;
  }

  /** Distance along a normalized ray to the first solid, or maxT. Sets hitWall when a gel wall is hit. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    this.hitWall = null;
    let best = maxT;
    const ix0 = Math.floor(o.x / CELL), iz0 = Math.floor(o.z / CELL);
    let ix = ix0, iz = iz0;
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const dX = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const dZ = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tX = Math.abs(d.x) > 1e-9 ? ((ix + (sx > 0 ? 1 : 0)) * CELL - o.x) / d.x : Infinity;
    let tZ = Math.abs(d.z) > 1e-9 ? ((iz + (sz > 0 ? 1 : 0)) * CELL - o.z) / d.z : Infinity;
    const inv = vs.set(1 / d.x, 1 / d.y, 1 / d.z);
    this.stamp++;
    let t = 0;
    for (let guard = 0; guard < 200 && t <= best; guard++) {
      const c = this.grid.get(key(ix, iz));
      if (c)
        for (const i of c) {
          if (this.stamps[i] === this.stamp) continue;
          this.stamps[i] = this.stamp;
          const b = this.boxes[i];
          const h = slab(o, inv, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
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
    if (o.y + d.y * best < 0 && d.y < 0) best = Math.min(best, -o.y / d.y);
    for (const w of this.walls) {
      const dx = o.x - w.x, dz = o.z - w.z;
      const lox = dx * w.c - dz * w.s, loz = dx * w.s + dz * w.c;
      const ldx = d.x * w.c - d.z * w.s, ldz = d.x * w.s + d.z * w.c;
      const h = slab(vp.set(lox, o.y, loz), vs.set(1 / ldx, 1 / d.y, 1 / ldz), -w.hw, w.y0, -w.hd, w.hw, w.y1, w.hd);
      if (h < best) {
        best = h;
        this.hitWall = w;
      }
    }
    return best;
  }

  addWall(x: number, y: number, z: number, yaw: number, hw: number, hd: number, h: number, hp: number): Wall {
    const w: Wall = { x, z, y0: y, y1: y + h, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw), hp, id: ++this.wallSeq };
    this.walls.push(w);
    return w;
  }

  removeWall(w: Wall) {
    const i = this.walls.indexOf(w);
    if (i >= 0) this.walls.splice(i, 1);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mt = m.material as THREE.MeshLambertMaterial;
        mt.map?.dispose();
        mt.dispose();
      }
    });
  }
}

function slab(o: THREE.Vector3, inv: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let t1 = (x0 - o.x) * inv.x, t2 = (x1 - o.x) * inv.x;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (y0 - o.y) * inv.y;
  t2 = (y1 - o.y) * inv.y;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (z0 - o.z) * inv.z;
  t2 = (z1 - o.z) * inv.z;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0)) return Infinity;
  return tmin < 0 ? 0 : tmin;
}
