import * as THREE from 'three';
import type { World } from './world';
import { smooth } from './terrain';
import {
  ROOF_PALETTE, SHUTTER_PALETTE, WALL_PALETTE, building, bench, bridge, bunker, bush, car, chimney, containerStack, crane, crate,
  fence, hay, lamp, lowWall, radioTower, rock, sandbags, tank, tent, tree, warehouse, watchtower, windmill, GEO, type Style,
} from './builder';

export type MapId = 'solaris' | 'inferna' | 'range';
export type PoiKind = 'city' | 'town' | 'industrial' | 'port' | 'farm' | 'military' | 'peak' | 'camp' | 'range';
export interface Poi { name: string; x: number; z: number; r: number; kind: PoiKind; y?: number; base?: number }
interface Mountain { x: number; z: number; r: number; h: number }
type Seg = [number, number, number, number, number];

export interface MapDef {
  id: MapId;
  name: string;
  sub: string;
  radius: number;
  seed: number;
  step: number;
  sky: { top: number; horizon: number; fog: number; water: number; cloud: number; sun: number; sunInt: number; hemiSky: number; hemiGround: number; hemiInt: number; sunPos: [number, number, number] };
  pois: Poi[];
  arenas: string[];
  height: (w: World) => (x: number, z: number) => number;
  color: (w: World, x: number, z: number, h: number, slope: number) => number;
  populate: (w: World) => void;
}

// ---------------------------------------------------------------- shared helpers
const pick = <T>(w: World, a: T[]) => a[(w.R() * a.length) | 0];

function segDist(x: number, z: number, s: Seg) {
  const [x0, z0, x1, z1] = s;
  const dx = x1 - x0, dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

function polyDist(x: number, z: number, pts: [number, number][]) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0]));
  return d;
}

function roadsFrom(pois: Poi[], hub: string, extra: [string, string][] = []): Seg[] {
  const by = (n: string) => pois.find((p) => p.name === n)!;
  const h = by(hub);
  const segs: Seg[] = pois.filter((p) => p !== h && p.kind !== 'peak').map((p) => [h.x, h.z, p.x, p.z, 3.2]);
  for (const [a, b] of extra) segs.push([by(a).x, by(a).z, by(b).x, by(b).z, 2.6]);
  return segs;
}

function roadDist(x: number, z: number, roads: Seg[]) {
  let best = Infinity;
  for (const s of roads) {
    const d = segDist(x, z, s) - s[4];
    if (d < best) best = d;
  }
  return best;
}

interface IslandOpts { mountains: Mountain[]; river?: [number, number][]; riverW?: number; roll: number }

function islandHeight(def: MapDef, o: IslandOpts) {
  return (w: World) => {
    const n = w.noise;
    const raw = (x: number, z: number) => {
      let h = 2.2 + n.fbm(x * 0.011 + 10, z * 0.011 + 3) * o.roll;
      for (const m of o.mountains) {
        const d = Math.hypot(x - m.x, z - m.z);
        if (d < m.r) {
          const k = 1 - d / m.r;
          h += m.h * k * k * (3 - 2 * k) * (0.78 + 0.45 * n.fbm(x * 0.045, z * 0.045, 3));
        }
      }
      return h;
    };
    for (const p of def.pois) p.base = Math.max(2.2, raw(p.x, p.z));
    return (x: number, z: number) => {
      const R = def.radius;
      const ang = Math.atan2(z, x);
      const coast = R * (0.94 + 0.12 * (n.noise(Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2 + 5) - 0.5));
      const d = Math.hypot(x, z);
      let h = raw(x, z);
      for (const p of def.pois) {
        const dd = Math.hypot(x - p.x, z - p.z);
        const wgt = 1 - smooth(p.r, p.r + 26, dd);
        if (wgt > 0) h = h + (p.base! - h) * wgt;
      }
      if (o.river) {
        const dr = polyDist(x, z, o.river);
        const rw = o.riverW || 7;
        if (dr < rw * 2.4) h = h + (-1.7 - h) * smooth(rw * 2.4, rw * 0.8, dr);
      }
      const land = smooth(coast + 4, coast - 16, d);
      return -5 + (h + 5) * land;
    };
  };
}

function paint(w: World, x: number, z: number, h: number, slope: number, pal: Palette, roads: Seg[], river?: [number, number][]) {
  if (h < 0.9) return pal.sand;
  if (river && h < 2 && polyDist(x, z, river) < 13) return pal.mud;
  if (h > pal.snowline) return 0xf4f7fb;
  if (slope > 0.62) return pal.rock;
  const rd = roadDist(x, z, roads);
  if (rd < 0) return pal.road;
  for (const p of w.pois) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r + 4) continue;
    if (p.kind === 'city' || p.kind === 'industrial' || p.kind === 'port') {
      const gx = ((x - p.x) % 24 + 36) % 24, gz = ((z - p.z) % 24 + 36) % 24;
      if (p.kind === 'city' && (Math.abs(gx - 12) < 3.5 || Math.abs(gz - 12) < 3.5)) return pal.road;
      return p.kind === 'city' ? (Math.hypot(x - p.x, z - p.z) < 12 ? 0xd8c7a8 : pal.pave) : pal.concrete;
    }
    if (p.kind === 'farm' && d > 14) return ((Math.floor((x - p.x) / 4) + Math.floor((z - p.z) / 30)) % 3 === 0 ? 0xd9b44a : (Math.floor((x - p.x) / 4) % 2 ? 0x8fbf4a : 0x7a5a3a));
    if (p.kind === 'military') return 0xa89f7a;
    if (p.kind === 'town' && d < 10) return 0xd8c7a8;
  }
  const v = w.noise.noise(x * 0.04 + 7, z * 0.04 + 1);
  const v2 = w.noise.noise(x * 0.18, z * 0.18);
  const base = new THREE.Color(pal.grassA).lerp(new THREE.Color(pal.grassB), v);
  base.offsetHSL(0, 0, (v2 - 0.5) * 0.05);
  if (h > pal.snowline - 6) base.lerp(new THREE.Color(pal.rock), (h - pal.snowline + 6) / 6);
  return base.getHex();
}

interface Palette { grassA: number; grassB: number; sand: number; rock: number; road: number; pave: number; concrete: number; mud: number; snowline: number; trees: number[]; bushes: number[]; flowers: number[] }

function styleCity(w: World, tall: boolean): Style {
  return {
    wall: pick(w, WALL_PALETTE),
    trim: pick(w, [0xffffff, 0xf3efe6, 0x3a3f47, 0x8c5b45]),
    floor: pick(w, [0xb08a63, 0xa9a39a, 0x8f6b4c, 0xc7b79f]),
    roof: pick(w, ROOF_PALETTE),
    roofType: tall || w.R() < 0.55 ? 'flat' : 'hip',
    access: tall || w.R() < 0.7,
    awning: w.R() < 0.45 ? pick(w, [0xe63946, 0x2a9d8f, 0xf4a261, 0x1d6fd8, 0x8e44ad]) : undefined,
    shutter: w.R() < 0.3 ? pick(w, SHUTTER_PALETTE) : undefined,
  };
}

function styleHouse(w: World, rustic = false): Style {
  return {
    wall: rustic ? pick(w, [0x9b6b43, 0xb5835a, 0x8a5a36, 0xc49a6c]) : pick(w, WALL_PALETTE),
    trim: rustic ? 0x5b3b25 : 0xffffff,
    floor: 0xa47a52,
    roof: pick(w, ROOF_PALETTE),
    roofType: w.R() < 0.6 ? 'gable' : 'hip',
    access: false,
    shutter: pick(w, SHUTTER_PALETTE),
  };
}

/** Footprint-aware placement: returns extents for rot. */
function fits(w: World, x: number, z: number, rot: number, W: number, D: number) {
  const ex = rot % 2 ? D : W, ez = rot % 2 ? W : D;
  if (w.heightAt(x, z) < 1.2) return false;
  return w.free(x, z, Math.max(ex, ez) / 2 + 1.2);
}

const faceRot = (dx: number, dz: number) => (Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 1 : 3) : dz < 0 ? 0 : 2);

// ---------------------------------------------------------------- POI builders
function plaza(w: World, x: number, z: number, pal: Palette) {
  const y = w.heightAt(x, z);
  w.deco(GEO.cyl16, 0xd8d2c4, x, y + 0.3, z, 3.2, 0.6, 3.2, 0, 0);
  w.deco(GEO.cyl16, 0x4fb8e8, x, y + 0.62, z, 2.8, 0.06, 2.8, 0, 0);
  w.deco(GEO.cyl10, 0xd8d2c4, x, y + 1.5, z, 0.4, 2, 0.4, 0, 0);
  w.addBox(x - 2.9, y - 0.5, z - 2.9, x + 2.9, y + 0.65, z + 2.9);
  for (const [ox, oz, ax] of [[0, 7, true], [0, -7, true], [7, 0, false], [-7, 0, false]] as const) bench(w, x + ox, z + oz, ax);
  for (const [ox, oz] of [[6, 6], [-6, 6], [6, -6], [-6, -6]]) {
    tree(w, x + ox, z + oz, 0.9, pal.trees);
    bush(w, x + ox * 1.35, z + oz * 0.7, pick(w, pal.bushes), pick(w, pal.flowers));
  }
}

function city(w: World, p: Poi, pal: Palette) {
  const B = 24;
  const n = Math.ceil(p.r / B);
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const bx = p.x + i * B, bz = p.z + j * B;
      const dc = Math.hypot(i, j) * B;
      if (dc > p.r) continue;
      if (i === 0 && j === 0) {
        plaza(w, bx, bz, pal);
        continue;
      }
      if (i === 0 && j === -1) {
        building(w, bx, bz, 2, 8, 8, 5, { ...styleCity(w, true), wall: 0xf2e6d0, trim: 0x8c5b45 });
        w.deco(GEO.cyl16, 0xffffff, bx, w.heightAt(bx, bz) + 13.3, bz + 4.06, 1.4, 0.1, 1.4, 0, 0, Math.PI / 2, 0);
        w.deco(GEO.box, 0x222222, bx, w.heightAt(bx, bz) + 13.6, bz + 4.13, 0.12, 1.1, 0.05, 0, 0);
        continue;
      }
      const central = dc < p.r * 0.55;
      if (w.R() < 0.5) {
        const floors = central ? 3 + (w.R() < 0.5 ? 1 : 0) : 2 + (w.R() < 0.4 ? 1 : 0);
        const rot = (w.R() * 4) | 0;
        const W = 11 + w.R() * 3, D = 9 + w.R() * 2;
        building(w, bx, bz, rot, W, D, floors, styleCity(w, floors >= 3));
      } else {
        const floors = central ? 2 + (w.R() < 0.6 ? 1 : 0) : 1 + (w.R() < 0.6 ? 1 : 0);
        building(w, bx - 4.3, bz, 1, 8.6, 7.8, floors, styleCity(w, false));
        building(w, bx + 4.3, bz, 3, 8.6, 7.8, Math.max(1, floors - (w.R() < 0.4 ? 1 : 0)), styleCity(w, false));
      }
      // street furniture
      const sx = bx + B / 2, sz = bz + B / 2;
      if (Math.hypot(sx - p.x, sz - p.z) < p.r) lamp(w, sx - 2.6, sz - 2.6);
      if (w.R() < 0.6) car(w, bx + (w.R() - 0.5) * 12, bz + B / 2 + (w.R() < 0.5 ? -1.4 : 1.4), true);
      if (w.R() < 0.4) car(w, bx + B / 2 + (w.R() < 0.5 ? -1.4 : 1.4), bz + (w.R() - 0.5) * 12, false);
    }
}

function town(w: World, p: Poi, pal: Palette, rustic = false) {
  const y = w.heightAt(p.x, p.z);
  w.deco(GEO.cyl10, 0x9c968c, p.x, y + 0.5, p.z, 1.4, 1, 1.4, 0, 0);
  w.addBox(p.x - 1.3, y - 0.5, p.z - 1.3, p.x + 1.3, y + 1, p.z + 1.3);
  const count = 7 + ((w.R() * 3) | 0);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + w.R() * 0.3;
    const r = p.r * (0.5 + w.R() * 0.3);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const rot = faceRot(p.x - x, p.z - z);
    const W = 8.5 + w.R() * 1.5, D = 7.8 + w.R() * 1;
    if (!fits(w, x, z, rot, W, D)) continue;
    building(w, x, z, rot, W, D, w.R() < 0.45 ? 2 : 1, styleHouse(w, rustic));
    // garden + fence
    const gx = x + (Math.cos(a) * (W / 2 + 3)), gz = z + Math.sin(a) * (D / 2 + 3);
    bush(w, gx, gz, pick(w, pal.bushes), pick(w, pal.flowers));
    if (w.R() < 0.5) tree(w, gx + 2, gz - 2, 0.85, pal.trees);
  }
  for (let i = 0; i < 5; i++) {
    const a = w.R() * 6.28, r = 5 + w.R() * 6;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (w.free(x, z, 1.5)) w.R() < 0.5 ? crate(w, x, z) : bench(w, x, z, w.R() < 0.5);
  }
  w.loot.push(new THREE.Vector3(p.x + 3, y, p.z + 3));
}

function industrial(w: World, p: Poi) {
  const wcol = [0x9aa5b1, 0xc9d1d9, 0x8bb3c9, 0xd4b483];
  const spots: [number, number][] = [[-17, -12], [17, -12], [-17, 14], [17, 14]];
  const skip = (w.R() * 4) | 0;
  spots.forEach(([ox, oz], i) => {
    if (i === skip) {
      for (let k = 0; k < 4; k++) tank(w, p.x + ox + (k % 2 ? 4 : -4), p.z + oz + (k < 2 ? -4 : 4), 2.6, 6 + w.R() * 3, pick(w, [0xe0e4e8, 0xf2b51b, 0x3b82c4]));
      return;
    }
    const W = 20 + w.R() * 4, D = 13 + w.R() * 2;
    warehouse(w, p.x + ox, p.z + oz, oz < 0 ? 2 : 0, W, D, pick(w, wcol), pick(w, [0x3b5f8a, 0x8a3b3b, 0x4a6b4a, 0x5a5f66]));
  });
  building(w, p.x, p.z, 0, 10, 9, 3, { wall: 0xe8eef2, trim: 0x2f78c4, floor: 0xa9a39a, roof: 0x384b63, roofType: 'flat', access: true });
  chimney(w, p.x + p.r * 0.6, p.z - p.r * 0.55, 20);
  chimney(w, p.x + p.r * 0.6 + 3, p.z - p.r * 0.55 + 3, 16);
  for (let i = 0; i < 6; i++) {
    const a = w.R() * 6.28, r = p.r * (0.7 + w.R() * 0.3);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (w.free(x, z, 5)) containerStack(w, x, z, w.R() < 0.5);
  }
  for (let i = 0; i < 4; i++) lamp(w, p.x + (i % 2 ? 8 : -8), p.z + (i < 2 ? 3 : -3));
}

function port(w: World, p: Poi) {
  const ang = Math.atan2(p.z, p.x);
  const ox = Math.cos(ang), oz = Math.sin(ang);
  for (let row = -2; row <= 2; row++)
    for (let c = -1; c <= 1; c++) {
      const x = p.x + -oz * row * 7 + ox * c * 9, z = p.z + ox * row * 7 + oz * c * 9;
      if (w.free(x, z, 4) && w.R() < 0.75) containerStack(w, x, z, Math.abs(ox) < Math.abs(oz));
    }
  crane(w, p.x + ox * 20 - oz * 10, p.z + oz * 20 + ox * 10, ang);
  crane(w, p.x + ox * 20 + oz * 12, p.z + oz * 20 - ox * 12, ang);
  warehouse(w, p.x - ox * 22, p.z - oz * 22, faceRot(ox, oz), 20, 13, 0x6fa8c9, 0x2f4f6f);
  // pier into the sea
  const px = p.x + ox * (p.r + 8), pz = p.z + oz * (p.r + 8);
  const alongX = Math.abs(ox) > Math.abs(oz);
  const L = 26;
  const minX = alongX ? Math.min(px, px + ox * L) : px - 3, maxX = alongX ? Math.max(px, px + ox * L) : px + 3;
  const minZ = alongX ? pz - 3 : Math.min(pz, pz + oz * L), maxZ = alongX ? pz + 3 : Math.max(pz, pz + oz * L);
  w.solid(minX, 0.9, minZ, maxX, 1.3, maxZ, 0x8a6a45, true, 0.04);
  for (let t = 4; t < L; t += 6) w.solid(px + ox * t - 0.3, -4, pz + oz * t - 0.3, px + ox * t + 0.3, 0.9, pz + oz * t + 0.3, 0x5b4630, true, 0);
  for (let i = 0; i < 4; i++) lamp(w, p.x + -oz * (i - 1.5) * 10, p.z + ox * (i - 1.5) * 10);
}

function farm(w: World, p: Poi, pal: Palette) {
  warehouse(w, p.x - 6, p.z - 2, 0, 16, 12, 0xb33a2e, 0x6b2a20);
  building(w, p.x + 12, p.z + 10, 1, 9.5, 8.5, 2, { ...styleHouse(w), wall: 0xf6efe0, roof: 0x7a4b36 });
  tank(w, p.x + 6, p.z - 12, 2.2, 9, 0xd8dde2);
  windmill(w, p.x - p.r * 0.7, p.z + p.r * 0.5);
  for (let i = 0; i < 10; i++) {
    const a = w.R() * 6.28, r = 15 + w.R() * (p.r - 15);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (w.free(x, z, 1.5)) hay(w, x, z);
  }
  fence(w, p.x - p.r, p.z - p.r * 0.8, p.x + p.r * 0.2, p.z - p.r * 0.8);
  fence(w, p.x + p.r * 0.9, p.z - p.r * 0.5, p.x + p.r * 0.9, p.z + p.r * 0.4);
  for (let i = 0; i < 6; i++) tree(w, p.x + p.r * 0.9 + w.R() * 6, p.z - p.r + i * 8, 1, pal.trees);
  car(w, p.x + 4, p.z + 12, false);
}

function military(w: World, p: Poi) {
  const R = p.r * 0.72;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) watchtower(w, p.x + sx * R, p.z + sz * R, sx < 0 ? 1 : 3);
  for (const s of [-1, 1]) {
    lowWall(w, p.x + s * R * 0.55, p.z - R, R * 0.7, true, 0x8f8a74);
    lowWall(w, p.x + s * R * 0.55, p.z + R, R * 0.7, true, 0x8f8a74);
    lowWall(w, p.x - R, p.z + s * R * 0.55, R * 0.7, false, 0x8f8a74);
    lowWall(w, p.x + R, p.z + s * R * 0.55, R * 0.7, false, 0x8f8a74);
  }
  building(w, p.x - 7, p.z + 5, 0, 14, 8, 1, { wall: 0x8a9a6e, trim: 0x5f6a4a, floor: 0x7d7a6a, roof: 0x5f6a4a, roofType: 'flat', access: true });
  building(w, p.x + 9, p.z + 6, 3, 9, 8, 2, { wall: 0x9aa58a, trim: 0x5f6a4a, floor: 0x7d7a6a, roof: 0x5f6a4a, roofType: 'flat', access: true });
  bunker(w, p.x - 8, p.z - 10, 0);
  bunker(w, p.x + 9, p.z - 10, 0);
  for (let i = 0; i < 6; i++) sandbags(w, p.x + (w.R() - 0.5) * R * 1.5, p.z + (w.R() - 0.5) * R * 1.5, w.R() < 0.5);
  containerStack(w, p.x, p.z - 2, true);
  const y = w.heightAt(p.x + 2, p.z + 18);
  w.solid(p.x - 4, y, p.z + 14, p.x + 8, y + 0.12, p.z + 22, 0x5a5a5a, true, 0);
}

function camp(w: World, p: Poi, pal: Palette) {
  const cols = [0xe63946, 0x2a9d8f, 0xf4a261, 0x1d6fd8, 0xe9c46a, 0x8e44ad];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.28, r = 9 + w.R() * 3;
    tent(w, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, pick(w, cols));
    w.loot.push(new THREE.Vector3(p.x + Math.cos(a) * (r - 2.4), w.heightAt(p.x, p.z), p.z + Math.sin(a) * (r - 2.4)));
  }
  const y = w.heightAt(p.x, p.z);
  w.deco(GEO.cyl10, 0x555555, p.x, y + 0.2, p.z, 1.1, 0.4, 1.1, 0, 0);
  w.deco(GEO.cone6, 0xff7a1a, p.x, y + 0.7, p.z, 0.6, 1, 0.6, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + 0.6, r = p.r * 0.75;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const rot = faceRot(p.x - x, p.z - z);
    if (fits(w, x, z, rot, 8.5, 7.8)) building(w, x, z, rot, 8.5, 7.8, i === 0 ? 2 : 1, styleHouse(w, true));
  }
  for (let i = 0; i < 14; i++) {
    const a = w.R() * 6.28, r = p.r * 0.9 + w.R() * 14;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (w.free(x, z, 2)) tree(w, x, z, 1 + w.R() * 0.4, pal.trees, 'pine');
  }
}

function peak(w: World, p: Poi) {
  radioTower(w, p.x + 6, p.z + 5, 26);
  building(w, p.x - 4, p.z - 3, 0, 9, 8, 2, { wall: 0xe8e2d6, trim: 0x8c5b45, floor: 0x8f6b4c, roof: 0x2f4f6f, roofType: 'flat', access: true });
  for (let i = 0; i < 6; i++) {
    const a = w.R() * 6.28, r = p.r * 0.8 + w.R() * 10;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (w.free(x, z, 2)) rock(w, x, z, 1 + w.R() * 1.5);
  }
}

function scatter(w: World, pal: Palette, roads: Seg[], river: [number, number][] | undefined, n: { trees: number; rocks: number; bushes: number; cover: number; houses: number; cars: number }, treeKinds: ('round' | 'pine' | 'palm')[]) {
  const R = w.radius;
  const inPoi = (x: number, z: number, pad: number) => w.pois.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);
  const okGround = (x: number, z: number) => w.heightAt(x, z) > 1.3 && (!river || polyDist(x, z, river) > 16) && roadDist(x, z, roads) > 2.5;
  const rp = () => {
    const a = w.R() * Math.PI * 2, r = Math.sqrt(w.R()) * R;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < n.trees; i++) {
    const [x, z] = rp();
    if (!okGround(x, z) || inPoi(x, z, 4) || !w.free(x, z, 2)) continue;
    const h = w.heightAt(x, z);
    const kind = h < 3 && treeKinds.includes('palm') ? 'palm' : h > 12 && treeKinds.includes('pine') ? 'pine' : pick(w, treeKinds.filter((k) => k !== 'palm'));
    // small groves
    const g = 1 + ((w.R() * 3) | 0);
    for (let k = 0; k < g; k++) {
      const tx = x + (w.R() - 0.5) * 10, tz = z + (w.R() - 0.5) * 10;
      if (okGround(tx, tz) && w.free(tx, tz, 1.8)) tree(w, tx, tz, 0.85 + w.R() * 0.5, pal.trees, kind);
    }
  }
  for (let i = 0; i < n.rocks; i++) {
    const [x, z] = rp();
    if (!okGround(x, z) || inPoi(x, z, 2) || !w.free(x, z, 2.5)) continue;
    rock(w, x, z, 0.7 + w.R() * 1.4, pal.rock);
    if (w.R() < 0.4) rock(w, x + 2, z + 1, 0.5 + w.R(), pal.rock);
  }
  for (let i = 0; i < n.bushes; i++) {
    const [x, z] = rp();
    if (okGround(x, z) && !inPoi(x, z, 0) && w.free(x, z, 1)) bush(w, x, z, pick(w, pal.bushes), w.R() < 0.4 ? pick(w, pal.flowers) : undefined);
  }
  // cover clusters in open fields
  for (let i = 0; i < n.cover; i++) {
    const [x, z] = rp();
    if (!okGround(x, z) || inPoi(x, z, 6) || !w.free(x, z, 4)) continue;
    const t = w.R();
    if (t < 0.35) {
      crate(w, x, z);
      crate(w, x + 1.05, z + 0.1);
      crate(w, x + 0.5, z, w.heightAt(x, z) + 1, 0.85);
      w.loot.push(new THREE.Vector3(x - 1.4, w.heightAt(x - 1.4, z), z));
    } else if (t < 0.65) {
      lowWall(w, x, z, 4, w.R() < 0.5);
      lowWall(w, x + 3, z + 3, 3, w.R() < 0.5);
    } else sandbags(w, x, z, w.R() < 0.5);
  }
  // lone houses along roads
  let placed = 0;
  for (let tries = 0; tries < 200 && placed < n.houses; tries++) {
    const s = pick(w, roads);
    const t = 0.25 + w.R() * 0.5;
    const rx = s[0] + (s[2] - s[0]) * t, rz = s[1] + (s[3] - s[1]) * t;
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const nx = -(s[3] - s[1]) / len, nz = (s[2] - s[0]) / len;
    const side = w.R() < 0.5 ? 1 : -1;
    const x = rx + nx * side * 12, z = rz + nz * side * 12;
    if (inPoi(x, z, 10) || !okGround(x, z)) continue;
    const rot = faceRot(rx - x, rz - z);
    if (!fits(w, x, z, rot, 9, 8)) continue;
    building(w, x, z, rot, 9, 8, w.R() < 0.35 ? 2 : 1, styleHouse(w, treeKinds.includes('pine')));
    placed++;
  }
  for (let i = 0; i < n.cars; i++) {
    const s = pick(w, roads);
    const t = 0.15 + w.R() * 0.7;
    const x = s[0] + (s[2] - s[0]) * t, z = s[1] + (s[3] - s[1]) * t;
    if (!inPoi(x, z, 0) && w.free(x, z, 3)) car(w, x + 1.5, z, Math.abs(s[2] - s[0]) > Math.abs(s[3] - s[1]));
  }
}

function populatePois(w: World, pal: Palette) {
  for (const p of w.pois) {
    if (p.kind === 'city') city(w, p, pal);
    else if (p.kind === 'town') town(w, p, pal);
    else if (p.kind === 'industrial') industrial(w, p);
    else if (p.kind === 'port') port(w, p);
    else if (p.kind === 'farm') farm(w, p, pal);
    else if (p.kind === 'military') military(w, p);
    else if (p.kind === 'camp') camp(w, p, pal);
    else if (p.kind === 'peak') peak(w, p);
  }
}

// ================================================================= SOLARIS
const SOL_PAL: Palette = {
  grassA: 0x63c04a, grassB: 0x8fd35a, sand: 0xf1dca0, rock: 0x8c8a86, road: 0x5f5b57, pave: 0xb7b0a4, concrete: 0x9c9a96, mud: 0x8a7a5a, snowline: 60,
  trees: [0x3f9a3a, 0x4cae2e, 0x2f8a3b, 0x5cbf3c, 0x7bc043], bushes: [0x3f8f3a, 0x55a63a, 0x2f7d3b], flowers: [0xff5c8a, 0xffd23f, 0xffffff, 0xff8a3d, 0xb05cff],
};
const SOL_POIS: Poi[] = [
  { name: 'CIDADE SOL', x: 0, z: 8, r: 56, kind: 'city' },
  { name: 'PORTO AZUL', x: 112, z: 108, r: 32, kind: 'port' },
  { name: 'FÁBRICA', x: 118, z: -92, r: 38, kind: 'industrial' },
  { name: 'VILA PALMA', x: -112, z: 92, r: 30, kind: 'town' },
  { name: 'FAZENDA', x: -122, z: -78, r: 36, kind: 'farm' },
  { name: 'BASE MILITAR', x: 8, z: -142, r: 30, kind: 'military' },
  { name: 'MIRANTE', x: -22, z: 132, r: 15, kind: 'peak' },
];
const SOL_ROADS = roadsFrom(SOL_POIS, 'CIDADE SOL', [['VILA PALMA', 'FAZENDA'], ['FÁBRICA', 'BASE MILITAR'], ['PORTO AZUL', 'FÁBRICA']]);

const SOLARIS: MapDef = {
  id: 'solaris', name: 'SOLARIS', sub: 'Ilha tropical · cidade, porto e fábrica', radius: 200, seed: 7331, step: 2.5,
  sky: { top: 0x2f86e0, horizon: 0xcdebff, fog: 0xcdebff, water: 0x25a4d8, cloud: 0xffffff, sun: 0xfff1d6, sunInt: 2.0, hemiSky: 0xffffff, hemiGround: 0x5d7a46, hemiInt: 1.55, sunPos: [70, 110, 40] },
  pois: SOL_POIS,
  arenas: ['CIDADE SOL', 'FÁBRICA', 'PORTO AZUL', 'BASE MILITAR'],
  height: (w) => islandHeight(SOLARIS, { roll: 7, mountains: [{ x: -22, z: 132, r: 62, h: 24 }, { x: 62, z: 44, r: 44, h: 13 }, { x: -64, z: -14, r: 38, h: 11 }, { x: 160, z: -10, r: 40, h: 15 }] })(w),
  color: (w, x, z, h, s) => paint(w, x, z, h, s, SOL_PAL, SOL_ROADS),
  populate: (w) => {
    populatePois(w, SOL_PAL);
    scatter(w, SOL_PAL, SOL_ROADS, undefined, { trees: 150, rocks: 70, bushes: 140, cover: 46, houses: 14, cars: 14 }, ['round', 'round', 'palm']);
  },
};

// ================================================================= INFERNA
const INF_PAL: Palette = {
  grassA: 0x9cb04a, grassB: 0xc2b04e, sand: 0xe6cf98, rock: 0x8a7f74, road: 0x595048, pave: 0xb5a796, concrete: 0x9a958e, mud: 0x7a6a4a, snowline: 27,
  trees: [0xd9822b, 0xc2412d, 0xe8b23a, 0x6f8f3a, 0xb8562a], bushes: [0x8a8a3a, 0xa06a2a, 0x6f8f3a], flowers: [0xffd23f, 0xff5c3d, 0xffffff],
};
const RIVER: [number, number][] = [[-240, -150], [-120, -62], [-24, 6], [62, 18], [140, 88], [240, 160]];
const INF_POIS: Poi[] = [
  { name: 'CENTRAL', x: -72, z: 62, r: 54, kind: 'city' },
  { name: 'COMPLEXO INDUSTRIAL', x: 92, z: -52, r: 42, kind: 'industrial' },
  { name: 'ACAMPAMENTO', x: -132, z: -118, r: 26, kind: 'camp' },
  { name: 'MOINHO', x: 30, z: 142, r: 32, kind: 'farm' },
  { name: 'QUARTEL', x: -18, z: -140, r: 30, kind: 'military' },
  { name: 'PICO NEVADO', x: 112, z: -150, r: 14, kind: 'peak' },
  { name: 'VILA RIO', x: -158, z: 30, r: 28, kind: 'town' },
];
const INF_ROADS = roadsFrom(INF_POIS, 'CENTRAL', [['QUARTEL', 'ACAMPAMENTO'], ['COMPLEXO INDUSTRIAL', 'QUARTEL'], ['MOINHO', 'COMPLEXO INDUSTRIAL']]);

function riverBridges(w: World) {
  for (const s of INF_ROADS)
    for (let i = 0; i < RIVER.length - 1; i++) {
      const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
      const d1x = s[2] - s[0], d1z = s[3] - s[1], d2x = bx - ax, d2z = bz - az;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-6) continue;
      const t = ((ax - s[0]) * d2z - (az - s[1]) * d2x) / den;
      const u = ((ax - s[0]) * d1z - (az - s[1]) * d1x) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const cx = s[0] + d1x * t, cz = s[1] + d1z * t;
      const alongX = Math.abs(d1x) > Math.abs(d1z);
      const L = 19;
      const e0 = alongX ? w.heightAt(cx - L, cz) : w.heightAt(cx, cz - L);
      const e1 = alongX ? w.heightAt(cx + L, cz) : w.heightAt(cx, cz + L);
      const deck = Math.max(e0, e1, 1.5) + 0.15;
      if (alongX) bridge(w, cx - L, cz, cx + L, cz, 7, deck);
      else bridge(w, cx, cz - L, cx, cz + L, 7, deck);
    }
}

const INFERNA: MapDef = {
  id: 'inferna', name: 'INFERNA', sub: 'Vale do rio · indústria, quartel e pico nevado', radius: 210, seed: 9127, step: 2.5,
  sky: { top: 0x3d4f9a, horizon: 0xffbe8a, fog: 0xf6c49a, water: 0x3b8fb0, cloud: 0xffe2c9, sun: 0xffc48a, sunInt: 2.1, hemiSky: 0xffe0c4, hemiGround: 0x6a5a3a, hemiInt: 1.45, sunPos: [-90, 60, 50] },
  pois: INF_POIS,
  arenas: ['CENTRAL', 'COMPLEXO INDUSTRIAL', 'QUARTEL'],
  height: (w) => islandHeight(INFERNA, { roll: 8, river: RIVER, riverW: 7, mountains: [{ x: 112, z: -150, r: 64, h: 32 }, { x: -60, z: 172, r: 50, h: 18 }, { x: 22, z: -62, r: 34, h: 10 }, { x: -170, z: -40, r: 36, h: 14 }] })(w),
  color: (w, x, z, h, s) => paint(w, x, z, h, s, INF_PAL, INF_ROADS, RIVER),
  populate: (w) => {
    riverBridges(w);
    populatePois(w, INF_PAL);
    scatter(w, INF_PAL, INF_ROADS, RIVER, { trees: 170, rocks: 80, bushes: 110, cover: 46, houses: 14, cars: 12 }, ['round', 'pine', 'pine']);
  },
};

// ================================================================= TRAINING RANGE
const RANGE_PAL: Palette = { ...SOL_PAL, grassA: 0x7fbf5a, grassB: 0x8fcf6a };
const RANGE: MapDef = {
  id: 'range', name: 'CAMPO DE TREINO', sub: '', radius: 58, seed: 42, step: 3,
  sky: SOLARIS.sky,
  pois: [{ name: 'CAMPO DE TREINO', x: 0, z: 0, r: 70, kind: 'range' }],
  arenas: [],
  height: () => (x, z) => {
    const d = Math.hypot(x, z);
    return d < 62 ? 2.2 : 2.2 - (d - 62) * 0.6;
  },
  color: (_w, x, z, h) => (h < 0.9 ? RANGE_PAL.sand : Math.abs(x) < 3 && z < 0 ? 0x5f5b57 : ((Math.floor(x / 6) + Math.floor(z / 6)) % 2 ? 0x7fbf5a : 0x8fcf6a)),
  populate: (w) => {
    building(w, -28, 22, 0, 11, 10, 3, { wall: 0xf2c9a8, trim: 0xffffff, floor: 0xa9a39a, roof: 0x384b63, roofType: 'flat', access: true });
    warehouse(w, 26, 24, 0, 18, 13, 0x9aa5b1, 0x3b5f8a);
    building(w, -30, -22, 1, 9, 8, 1, { ...styleHouse(w), roofType: 'gable' });
    containerStack(w, 24, -18, true);
    watchtower(w, 0, 40, 0);
    for (let i = 0; i < 5; i++) {
      const x = -20 + i * 10;
      lowWall(w, x, -6, 3.5, true);
      w.targets.push(new THREE.Vector3(x, 2.2, 12 + i * 3));
    }
    for (let i = 0; i < 10; i++) tree(w, -50 + i * 11, 52, 1, RANGE_PAL.trees);
    w.spawnsA.push(new THREE.Vector3(0, 2.2, -24));
  },
};

export const MAP_DEFS: Record<MapId, MapDef> = { solaris: SOLARIS, inferna: INFERNA, range: RANGE };
export const BR_MAPS: { id: MapId; name: string; sub: string; color: string }[] = [
  { id: 'solaris', name: 'SOLARIS', sub: SOLARIS.sub, color: '#2bb3ff' },
  { id: 'inferna', name: 'INFERNA', sub: INFERNA.sub, color: '#ff7a3a' },
];
