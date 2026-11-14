import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const lambert = new Map<number, THREE.MeshLambertMaterial>();
const basic = new Map<number, THREE.MeshBasicMaterial>();

export function mat(color: number): THREE.MeshLambertMaterial {
  let m = lambert.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    lambert.set(color, m);
  }
  return m;
}

export function glow(color: number): THREE.MeshBasicMaterial {
  let m = basic.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    basic.set(color, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

const r = (n: number) => Math.round(n * 1000);
export const box = (w: number, h: number, d: number) => cached(`b${r(w)},${r(h)},${r(d)}`, () => new THREE.BoxGeometry(w, h, d));
export const cyl = (rt: number, rb: number, h: number, s = 8) => cached(`c${r(rt)},${r(rb)},${r(h)},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
export const sphere = (rad: number, ws = 10, hs = 8, half = false) =>
  cached(`s${r(rad)},${ws},${hs},${half}`, () => new THREE.SphereGeometry(rad, ws, hs, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI));
export const capsule = (rad: number, len: number) => cached(`k${r(rad)},${r(len)}`, () => new THREE.CapsuleGeometry(rad, len, 3, 7));
export const cone = (rad: number, h: number, s = 8) => cached(`o${r(rad)},${r(h)},${s}`, () => new THREE.ConeGeometry(rad, h, s));
export const torus = (rad: number, tube: number) => cached(`t${r(rad)},${r(tube)}`, () => new THREE.TorusGeometry(rad, tube, 6, 16));

export function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.matrixAutoUpdate = true;
  parent.add(m);
  return m;
}

const bakedLambert = new THREE.MeshLambertMaterial({ vertexColors: true });
const bakedBasic = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Merge the direct mesh children of a group into at most two vertex-coloured meshes (lit + glow). */
export function bake(group: THREE.Object3D): THREE.Mesh[] {
  const lit: THREE.BufferGeometry[] = [];
  const glw: THREE.BufferGeometry[] = [];
  const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
  if (!meshes.length) return [];
  const c = new THREE.Color();
  for (const m of meshes) {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const mt = m.material as THREE.MeshLambertMaterial;
    c.copy(mt.color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    ((mt as THREE.Material).type === 'MeshBasicMaterial' ? glw : lit).push(g);
    group.remove(m);
  }
  const out: THREE.Mesh[] = [];
  for (const [list, material] of [[lit, bakedLambert], [glw, bakedBasic]] as const) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false)!;
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, material);
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}
