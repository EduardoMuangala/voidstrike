import * as THREE from 'three';
import './style.css';

/* ============================================================
   VOIDSTRIKE — arena de tiro 3D (Three.js)
   ============================================================ */

const ARENA = 34;
const PLAYER_H = 1.7;
const PLAYER_R = 0.45;
const GRAVITY = 26;
const JUMP_V = 8.4;
const WALK = 7.2;
const RUN = 11.5;

/* ============================================================
   LÓGICA DE MIRA FREE FIRE
   - Mira Padrão: magnetismo no centro de massa (peito), atração
     contínua, prioridade ao alvo MAIS PRÓXIMO, LOS obrigatório,
     técnica do "Capa" (arrastar para cima = headshot).
   - Precisa no Mira: sem assistência, só precisão.
   - ADS: sempre precisa (sem assistência).
   ============================================================ */
const FF = {
  cone: 10,          // cone base de assistência (graus)
  coneAds: 0,        // cone em ADS
  maxRange: 90,      // alcance máximo da assistência
  pull: 7,           // velocidade de atração (mira fechada)
  pullAds: 0,        // atração em ADS
  capaRatio: 0.55,   // fração do gap peito→cabeça para virar headshot
  sticky: 0.35,      // tempo (s) que mantém o alvo travado
};

/* cone efetivo de assistência: com a mira aberta (ADS) fica sempre precisa */
function aimConeNow() {
  if (player.ads > 0.5) return FF.coneAds;
  return FF.cone;
}

/* escolhe o alvo: dentro do cone, visível (LOS) e o MAIS PRÓXIMO */
function pickAimTarget(aimDir: THREE.Vector3, camPos: THREE.Vector3, cone: number): Enemy | null {
  if (cone <= 0) return null;
  const cosCone = Math.cos(THREE.MathUtils.degToRad(cone));
  let best: Enemy | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (e.dead) continue;
    const toChest = tmpA.setFromMatrixPosition(e.body.matrixWorld).sub(camPos);
    const d2 = toChest.lengthSq();
    if (d2 > FF.maxRange * FF.maxRange) continue;
    const dist = Math.sqrt(d2);
    toChest.multiplyScalar(1 / dist);
    if (toChest.dot(aimDir) < cosCone) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  if (!best) return null;
  /* LOS: nunca travar/puxar para inimigos atrás de obstáculos */
  const chest = tmpA.setFromMatrixPosition(best.body.matrixWorld);
  const dx = chest.x - camPos.x;
  const dy = chest.y - camPos.y;
  const dz = chest.z - camPos.z;
  const dLen = Math.hypot(dx, dy, dz);
  raycaster.set(camPos, tmpB.set(dx / dLen, dy / dLen, dz / dLen));
  const losHits = raycaster.intersectObjects(solids, false);
  if (losHits.length && losHits[0].distance <= dLen - 0.45) return null;
  return best;
}

/* ponto de mira: peito (centro de massa) ou cabeça pela técnica do Capa */
function aimPointOf(e: Enemy, aimDir: THREE.Vector3, camPos: THREE.Vector3, out: THREE.Vector3) {
  const chest = tmpA.setFromMatrixPosition(e.body.matrixWorld);
  const head = tmpB.setFromMatrixPosition(e.head.matrixWorld);
  const chestAng = Math.atan2(chest.y - camPos.y, Math.hypot(chest.x - camPos.x, chest.z - camPos.z));
  const headAng = Math.atan2(head.y - camPos.y, Math.hypot(head.x - camPos.x, head.z - camPos.z));
  const aimAng = Math.asin(THREE.MathUtils.clamp(aimDir.y, -1, 1));
  const pullUp = aimAng - chestAng;
  const headGap = headAng - chestAng;
  return out.copy(pullUp > headGap * FF.capaRatio ? head : chest);
}

/* ---------- armas ---------- */
interface WeaponDef {
  name: string;
  mag: number;
  fireMs: number;
  reloadMs: number;
  dmg: number;
  headDmg: number;
  spread: number;
  recoil: number;
  auto: boolean;
  adsFov: number;
  color: number;
  len: number;
  thick: number;
}
const WEAPONS: WeaponDef[] = [
  { name: 'RIFLE', mag: 12, fireMs: 130, reloadMs: 1100, dmg: 26, headDmg: 52, spread: 0.004, recoil: 1, auto: true, adsFov: 23, color: 0x1b2438, len: 0.62, thick: 0.16 },
  { name: 'SMG', mag: 30, fireMs: 72, reloadMs: 1500, dmg: 13, headDmg: 26, spread: 0.011, recoil: 0.6, auto: true, adsFov: 14, color: 0x24303f, len: 0.46, thick: 0.14 },
  { name: 'SNIPER', mag: 5, fireMs: 900, reloadMs: 2100, dmg: 78, headDmg: 156, spread: 0.0006, recoil: 2.2, auto: false, adsFov: 46, color: 0x2a2f3a, len: 0.86, thick: 0.13 },
];

/* ---------- DOM ---------- */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('scene');
const elHp = $('hp');
const elWave = $('wave');
const elScore = $('score');
const elBest = $('best');
const elHpFill = $('hpfill');
const elAmmo = $('ammoN');
const elMenu = $('menu');
const elDead = $('dead');
const elDeadStats = $('deadStats');
const elHit = $('hitmark');
const elDmg = $('dmgflash');
const elMapLabel = $('mapLabel');
const elMapList = $('mapList');
const elBanner = $('wavebanner');
const elWaveTitle = $('waveTitle');
const elWaveSub = $('waveSub');
const elKillfeed = $('killfeed');
const elCombo = $('combo');
const elComboN = $('comboN');
const elPause = $('pause');
const elAllyN = $('allyN');
const elFoeN = $('foeN');
const elCross = $('crosshair');
const elWeaponHud = $('weaponhud');
const elAbility = $('ability');
const elAbState = $('abState');
const elAbFill = $('abFill');
const elBombHud = $('bombhud');
const elBombState = $('bombState');
const elBombFill = $('bombFill');
const mmCanvas = $<HTMLCanvasElement>('minimap');
const mmCtx = mmCanvas.getContext('2d')!;

/* ============================================================
   MAPAS
   ============================================================ */
interface MapDef {
  id: string;
  name: string;
  desc: string;
  tag: string;
  mode: 'dark' | 'light';
  sky: number;
  fog: [number, number];
  floor: number;
  gridA: number;
  gridB: number;
  wall: number;
  accent: number;
  light: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  density: number;
  pillars: [number, number, number][]; // x, z, altura
  blocks: [number, number, number, number, number][]; // x, z, w, h, d
  /** painéis de vidro / neon nas paredes: [lado 0..3, offset, largura, altura] */
  panels: [number, number, number, number][];
  /** anéis de luz no chão: [x, z, raio] */
  rings: [number, number, number][];
  /** rampas: [x, z, w, d, altura, rotY] */
  ramps: [number, number, number, number, number, number][];
  /** casas: [x, z, w, d, rotY, corTelhado] */
  houses?: [number, number, number, number, number, number][];
  /** árvores: [x, z, escala] */
  trees?: [number, number, number][];
  /** arbustos: [x, z, escala] */
  bushes?: [number, number, number][];
  /** lagos: [x, z, raioX, raioZ] */
  ponds?: [number, number, number, number][];
  /** caminhos de terra: [x, z, w, d, rotY] */
  paths?: [number, number, number, number, number][];
  /** flores: [x, z, cor] */
  flowers?: [number, number, number][];
}

const MAPS: MapDef[] = [
  {
    id: 'nexus',
    name: 'NEXUS',
    desc: 'Pátio industrial de concreto e aço. Pilares altos, visão aberta, combate frontal.',
    tag: 'INDUSTRIAL',
    mode: 'light',
    sky: 0xc9d3dd,
    fog: [80, 210],
    floor: 0x9a9c9e,
    gridA: 0x6f7377,
    gridB: 0x8b8e91,
    wall: 0xb4b7ba,
    accent: 0x8a8f94,
    light: 0xfff1d6,
    sunColor: 0xfff6e8,
    sunIntensity: 2.4,
    hemiSky: 0xf2f6fa,
    hemiGround: 0x8d8f92,
    hemiIntensity: 1.25,
    density: 1,
    pillars: [
      [-16, -16, 6], [16, -16, 6], [-16, 16, 6], [16, 16, 6],
      [0, -24, 7], [0, 24, 7], [-24, 0, 7], [24, 0, 7],
    ],
    blocks: [
      [-8, -8, 3, 1.1, 3], [8, 8, 3, 1.1, 3],
      [-8, 8, 3, 1.1, 3], [8, -8, 3, 1.1, 3],
    ],
    panels: [
      [0, -18, 10, 3.2], [0, 18, 10, 3.2],
      [1, -18, 10, 3.2], [1, 18, 10, 3.2],
      [2, 0, 14, 2.4], [3, 0, 14, 2.4],
    ],
    rings: [[0, 0, 7], [-16, -16, 3.4], [16, 16, 3.4]],
    ramps: [],
  },
  {
    id: 'helix',
    name: 'HELIX',
    desc: 'Átrio diurno de mármore e vidro. Luz natural, sombras duras, cobertura limpa.',
    tag: 'MODERNO',
    mode: 'light',
    sky: 0xdfe9f5,
    fog: [70, 190],
    floor: 0xd8dee8,
    gridA: 0x9aa6b4,
    gridB: 0xc2cad4,
    wall: 0xe8edf4,
    accent: 0x8fa3b8,
    light: 0xfff1d6,
    sunColor: 0xfff4e0,
    sunIntensity: 2.6,
    hemiSky: 0xffffff,
    hemiGround: 0x9aa8bb,
    hemiIntensity: 1.35,
    density: 1.2,
    pillars: [
      [-18, -18, 8], [18, -18, 8], [-18, 18, 8], [18, 18, 8],
      [-6, -6, 5], [6, 6, 5], [-6, 6, 5], [6, -6, 5],
    ],
    blocks: [
      [-14, 0, 9, 1.4, 2.6], [14, 0, 9, 1.4, 2.6],
      [0, -14, 2.6, 1.4, 9], [0, 14, 2.6, 1.4, 9],
      [-24, -24, 4, 2.4, 4], [24, 24, 4, 2.4, 4],
    ],
    panels: [
      [0, -14, 16, 4.2], [0, 14, 16, 4.2],
      [1, -14, 16, 4.2], [1, 14, 16, 4.2],
      [2, 0, 20, 4.2], [3, 0, 20, 4.2],
    ],
    rings: [[0, 0, 9], [-18, 18, 4], [18, -18, 4]],
    ramps: [
      [-24, 0, 6, 8, 1.4, 0],
      [24, 0, 6, 8, 1.4, 0],
    ],
  },
  {
    id: 'village',
    name: 'VILA',
    desc: 'Aldeia de campo ao entardecer. Casas de madeira, árvores, lago e caminhos de terra.',
    tag: 'CAMPO',
    mode: 'light',
    sky: 0xbfe0f5,
    fog: [90, 230],
    floor: 0x6f8a4a,
    gridA: 0x5c7440,
    gridB: 0x7d9a55,
    wall: 0xd9b26a,
    accent: 0x8a6a3a,
    light: 0xfff1d6,
    sunColor: 0xfff2d0,
    sunIntensity: 1.9,
    hemiSky: 0xe8f4ff,
    hemiGround: 0x6b7f4a,
    hemiIntensity: 1.55,
    density: 1.1,
    pillars: [],
    blocks: [],
    panels: [],
    rings: [[0, 0, 6]],
    ramps: [],
    houses: [
      [-20, -20, 9, 7, 0.35, 0xd9a441],
      [20, -20, 10, 7, -0.5, 0xd9a441],
      [-20, 20, 9, 8, -0.3, 0xd9a441],
      [20, 20, 8, 8, 0.45, 0xb5533a],
      [0, -26, 7, 6, 0, 0xd9a441],
      [-27, 6, 7, 6, 1.57, 0xc98a3a],
      [27, -6, 7, 6, -1.57, 0xb5533a],
      [8, 27, 8, 6, 3.14, 0xd9a441],
      [-9, -27, 6, 5, 0, 0xc98a3a],
    ],
    trees: [
      [-8, -14, 1.1], [8, -12, 1.0], [-10, 8, 1.2], [10, 10, 1.0],
      [-26, 0, 1.1], [26, 2, 1.0], [0, 26, 1.2], [-14, 26, 1.0],
      [14, -26, 1.0], [26, -8, 1.1], [-26, -8, 1.0], [4, 16, 0.9],
      [-16, -8, 1.0], [16, 8, 1.1], [-4, 22, 1.0], [22, 16, 0.95],
      [-22, 14, 1.05], [12, -18, 0.9], [-30, -16, 1.1], [30, 14, 1.0],
      [-2, -18, 0.85], [18, 26, 1.0], [-18, -30, 1.0], [30, -20, 0.95],
    ],
    bushes: [
      [-4, -6, 1], [5, -4, 0.9], [-6, 4, 1.1], [7, 6, 1],
      [-16, 6, 0.9], [16, -6, 1], [0, 12, 1], [-12, -22, 0.9],
      [12, 22, 1], [22, 12, 0.9], [-24, -12, 1], [24, -14, 0.95],
      [-8, 18, 0.9], [8, -22, 1], [-30, 10, 1], [30, 4, 0.9],
      [-14, 0, 0.85], [14, 0, 0.85], [0, -12, 0.9], [0, 20, 1],
    ],
    ponds: [[-6, 2, 5, 3.6], [22, -26, 4, 3]],
    paths: [
      [0, 0, 6, 60, 0],
      [0, 0, 60, 6, 0],
      [-14, -14, 4, 22, 0.7],
      [14, 14, 4, 22, 0.7],
      [-24, 0, 4, 26, 1.57],
      [24, 0, 4, 26, 1.57],
      [0, 24, 26, 4, 0],
    ],
    flowers: [
      [-3, -3, 0xd94fa0], [3, 3, 0xf2c94c], [-9, 5, 0x9b59b6],
      [9, -5, 0xe74c3c], [-13, -9, 0xf2c94c], [13, 9, 0xd94fa0],
      [-2, 9, 0x9b59b6], [2, -9, 0xe74c3c], [-18, 12, 0xf2c94c],
      [18, -12, 0xd94fa0], [6, 20, 0x9b59b6], [-6, -20, 0xe74c3c],
      [-11, 14, 0xf2c94c], [11, -14, 0xd94fa0], [-20, -6, 0xe74c3c],
      [20, 6, 0x9b59b6], [-5, 16, 0xf2c94c], [5, -16, 0xd94fa0],
      [-28, 2, 0xe74c3c], [28, -2, 0xf2c94c], [0, 30, 0x9b59b6],
      [-16, 22, 0xd94fa0], [16, -22, 0xe74c3c], [-24, -24, 0xf2c94c],
    ],
  },
];

let currentMap: MapDef = MAPS[0];

/* ---------- renderer / cena ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d3dd);
scene.fog = new THREE.Fog(0xc9d3dd, 80, 210);

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- luzes ---------- */
const hemi = new THREE.HemisphereLight(0xf2f6fa, 0x8d8f92, 1.25);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff6e8, 2.4);
sun.position.set(24, 42, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -ARENA - 6;
sc.right = ARENA + 6;
sc.top = ARENA + 6;
sc.bottom = -ARENA - 6;
sc.near = 1;
sc.far = 140;
scene.add(sun);

const rim = new THREE.PointLight(0xfff1d6, 60, 90, 2);
rim.position.set(0, 16, 0);
scene.add(rim);

/* ---------- chão ---------- */
const floorMat = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.92, metalness: 0.05 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(ARENA * 2, 34, 0x6f7377, 0x8b8e91);
const gridMat = grid.material as THREE.LineBasicMaterial;
gridMat.transparent = true;
gridMat.opacity = 0.22;
grid.position.y = 0.02;
scene.add(grid);

/* ---------- paredes / geometria do mapa ---------- */
const wallMat = new THREE.MeshStandardMaterial({ color: 0xb4b7ba, roughness: 0.88, metalness: 0.08 });
const glowMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.7, metalness: 0.35 });
const panelMat = new THREE.MeshStandardMaterial({
  color: 0x9fb6c9, emissive: 0x000000, emissiveIntensity: 0,
  roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.42,
});
const ringMat = new THREE.MeshBasicMaterial({ color: 0x8a8f94, transparent: true, opacity: 0.18, side: THREE.DoubleSide });

const mapGroup = new THREE.Group();
scene.add(mapGroup);

const obstacles: THREE.Box3[] = [];
const solids: THREE.Object3D[] = [floor];

function buildMap(def: MapDef) {
  // limpar
  while (mapGroup.children.length) {
    const c = mapGroup.children.pop() as THREE.Mesh;
    c.geometry?.dispose();
  }
  obstacles.length = 0;
  solids.length = 0;
  solids.push(floor);

  const light = def.mode === 'light';
  void light;

  // paleta
  scene.background = new THREE.Color(def.sky);
  scene.fog = new THREE.Fog(def.sky, def.fog[0], def.fog[1]);
  floorMat.color.setHex(def.floor);
  floorMat.roughness = 0.92;
  floorMat.metalness = 0.05;
  wallMat.color.setHex(def.wall);
  wallMat.roughness = 0.88;
  wallMat.metalness = 0.08;
  glowMat.color.setHex(def.accent);
  panelMat.color.setHex(def.accent);
  panelMat.emissive.setHex(0x000000);
  panelMat.emissiveIntensity = 0;
  panelMat.opacity = 0.42;
  ringMat.color.setHex(def.accent);
  ringMat.opacity = 0.18;
  gridMat.color.setHex(def.gridA);
  gridMat.opacity = 0.22;
  hemi.color.setHex(def.hemiSky);
  hemi.groundColor.setHex(def.hemiGround);
  hemi.intensity = def.hemiIntensity;
  sun.color.setHex(def.sunColor);
  sun.intensity = def.sunIntensity;
  rim.color.setHex(def.light);
  rim.intensity = 60;

  // paredes + painéis
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 7, 1), wallMat);
    wall.position.set(Math.sin(a) * ARENA, 3.5, Math.cos(a) * ARENA);
    wall.rotation.y = a;
    wall.receiveShadow = true;
    mapGroup.add(wall);
    solids.push(wall);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 0.12, 0.12), glowMat);
    strip.position.set(Math.sin(a) * (ARENA - 0.55), 6.4, Math.cos(a) * (ARENA - 0.55));
    strip.rotation.y = a;
    mapGroup.add(strip);
  }

  for (const [side, off, w, h] of def.panels) {
    const a = (side * Math.PI) / 2;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panelMat);
    p.position.set(
      Math.sin(a) * (ARENA - 0.52) + Math.cos(a) * off,
      h / 2 + 0.6,
      Math.cos(a) * (ARENA - 0.52) - Math.sin(a) * off
    );
    p.rotation.y = a + Math.PI;
    mapGroup.add(p);
  }

  // pilares
  for (const [x, z, h] of def.pillars) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), wallMat);
    p.position.set(x, h / 2, z);
    p.receiveShadow = true;
    mapGroup.add(p);
    solids.push(p);
    obstacles.push(new THREE.Box3().setFromObject(p));

    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 2.6), glowMat);
    cap.position.set(x, h + 0.05, z);
    mapGroup.add(cap);

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 2.9), glowMat);
    base.position.set(x, 0.09, z);
    mapGroup.add(base);
  }

  // blocos baixos (cobertura)
  for (const [x, z, w, h, d] of def.blocks) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    b.position.set(x, h / 2, z);
    b.receiveShadow = true;
    mapGroup.add(b);
    solids.push(b);
    obstacles.push(new THREE.Box3().setFromObject(b));

    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1), glowMat);
    edge.position.set(x, h + 0.04, z);
    mapGroup.add(edge);
  }

  // rampas (decorativas + sólidas)
  for (const [x, z, w, d, h, ry] of def.ramps) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), wallMat);
    r.position.set(x, h / 2, z);
    r.rotation.set(-Math.atan2(h, d), ry, 0);
    r.receiveShadow = true;
    mapGroup.add(r);
    solids.push(r);
    obstacles.push(new THREE.Box3().setFromObject(r));
  }

  // anéis de luz no chão
  for (const [x, z, rad] of def.rings) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(rad - 0.12, rad, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    mapGroup.add(ring);
  }

  /* ---------- elementos de vila (casas, árvores, lago, caminhos) ---------- */
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x9c7b4e, roughness: 1, metalness: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.85, metalness: 0.02 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.95, metalness: 0 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x4f9440, roughness: 0.95, metalness: 0 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3f8fc4, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.85,
  });

  // caminhos de terra
  for (const [x, z, w, d, ry] of def.paths ?? []) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat);
    p.rotation.set(-Math.PI / 2, 0, ry);
    p.position.set(x, 0.015, z);
    p.receiveShadow = true;
    mapGroup.add(p);
  }

  // lagos
  for (const [x, z, rx, rz] of def.ponds ?? []) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 40), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.scale.set(rx, rz, 1);
    water.position.set(x, 0.03, z);
    mapGroup.add(water);
    const bank = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.06, 40), pathMat);
    bank.rotation.x = -Math.PI / 2;
    bank.scale.set(rx, rz, 1);
    bank.position.set(x, 0.025, z);
    mapGroup.add(bank);
  }

  // casas: paredes + telhado de duas águas + porta
  for (const [x, z, w, d, ry, roofColor] of def.houses ?? []) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;

    const wallH = 3.2;
    const T = 0.3; // espessura das paredes
    const doorW = 1.7; // vão da porta (única entrada)

    // helper: cria parede e regista colisão
    const addWall = (bw: number, bh: number, bd: number, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wallMat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      solids.push(m);
      return m;
    };

    // parede de trás (z = -d/2)
    addWall(w, wallH, T, 0, wallH / 2, -d / 2 + T / 2);
    // paredes laterais
    addWall(T, wallH, d, -w / 2 + T / 2, wallH / 2, 0);
    addWall(T, wallH, d, w / 2 - T / 2, wallH / 2, 0);
    // parede da frente com vão da porta ao centro
    const sideW = (w - doorW) / 2;
    addWall(sideW, wallH, T, -(doorW / 2 + sideW / 2), wallH / 2, d / 2 - T / 2);
    addWall(sideW, wallH, T, doorW / 2 + sideW / 2, wallH / 2, d / 2 - T / 2);
    // lintel acima da porta
    addWall(doorW, wallH - 2.2, T, 0, 2.2 + (wallH - 2.2) / 2, d / 2 - T / 2);
    // chão interior (madeira)
    const floorIn = new THREE.Mesh(new THREE.BoxGeometry(w - T * 2, 0.08, d - T * 2), trunkMat);
    floorIn.position.set(0, 0.04, 0);
    floorIn.receiveShadow = true;
    g.add(floorIn);

    // telhado: duas águas com prismas
    const rm = roofMat.clone();
    rm.color.setHex(roofColor);
    const roofH = 1.9;
    const slope = Math.atan2(roofH, w / 2);
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(w / 2, roofH) + 0.3, 0.16, d + 0.7), rm);
      panel.position.set((s * w) / 4, wallH + roofH / 2, 0);
      panel.rotation.z = -s * slope;
      panel.castShadow = true;
      g.add(panel);
    }
    // empenas (triângulos laterais)
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-w / 2, 0);
    gableShape.lineTo(w / 2, 0);
    gableShape.lineTo(0, roofH);
    gableShape.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.12, bevelEnabled: false });
    for (const s of [-1, 1]) {
      const gable = new THREE.Mesh(gableGeo, wallMat);
      gable.position.set(0, wallH, (s * d) / 2 - (s > 0 ? 0 : 0.12));
      g.add(gable);
    }

    // porta
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 0.12), trunkMat);
    door.position.set(0, 1, d / 2 + 0.02);
    g.add(door);

    // janelas
    const winMat = new THREE.MeshStandardMaterial({ color: 0x8fd0e8, roughness: 0.2, metalness: 0.3 });
    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), winMat);
      win.position.set(s * w * 0.3, 2.1, d / 2 + 0.02);
      g.add(win);
    }

    mapGroup.add(g);
    // colisão: cada parede é um obstáculo (entrada só pela porta)
    g.updateMatrixWorld(true);
    for (const c of g.children) {
      if (c === floorIn) continue;
      const box = new THREE.Box3().setFromObject(c);
      if (box.max.y - box.min.y < 0.5) continue; // ignora telhado/janelas finas
      obstacles.push(box);
    }
  }

  // árvores: tronco + copa em camadas
  for (const [x, z, s] of def.trees ?? []) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 2.2 * s, 8), trunkMat);
    trunk.position.set(x, 1.1 * s, z);
    trunk.castShadow = true;
    mapGroup.add(trunk);

    for (let i = 0; i < 3; i++) {
      const r = (1.7 - i * 0.35) * s;
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 ? leafMat2 : leafMat);
      leaf.position.set(x, (2.4 + i * 0.85) * s, z);
      leaf.rotation.y = i * 1.1;
      leaf.castShadow = true;
      mapGroup.add(leaf);
    }
    solids.push(trunk);
    obstacles.push(new THREE.Box3().setFromObject(trunk));
  }

  // arbustos
  for (const [x, z, s] of def.bushes ?? []) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 * s, 0), leafMat2);
    b.position.set(x, 0.55 * s, z);
    b.scale.y = 0.75;
    b.castShadow = true;
    mapGroup.add(b);
  }

  // flores
  for (const [x, z, c] of def.flowers ?? []) {
    const f = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
    );
    f.position.set(x, 0.16, z);
    mapGroup.add(f);
  }
}

/* ============================================================
   JOGADOR
   ============================================================ */
const player = {
  pos: new THREE.Vector3(0, PLAYER_H, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  onGround: true,
  hp: 200,
  ads: 0,
  weapon: 0,
  ammo: WEAPONS[0].mag,
  ammoByWeapon: WEAPONS.map((w) => w.mag),
  reloading: 0,
  fireCd: 0,
  bob: 0,
  recoil: 0,
  semiLock: false,
};

/* arma em primeira pessoa — modelo detalhado (corpo, cano, coronha, carregador,
   punho, mira red-dot, supressor, luz de estado) */
const gun = new THREE.Group();
const gunBodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2438, roughness: 0.4, metalness: 0.8 });
const gunMetalMat = new THREE.MeshStandardMaterial({ color: 0x2b3a55, metalness: 0.9, roughness: 0.3 });
const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x11161f, metalness: 0.6, roughness: 0.55 });

const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.62), gunBodyMat);
gunBody.position.set(0, 0, -0.2);
gun.add(gunBody);

/* guarda-mão (rail) */
const gunRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.34), gunDarkMat);
gunRail.position.set(0, 0.1, -0.42);
gun.add(gunRail);

const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10), gunMetalMat);
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0, 0.02, -0.62);
gun.add(gunBarrel);

/* supressor na ponta */
const gunSuppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), gunDarkMat);
gunSuppressor.rotation.x = Math.PI / 2;
gunSuppressor.position.set(0, 0.02, -0.86);
gun.add(gunSuppressor);

/* coronha */
const gunStock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.26), gunDarkMat);
gunStock.position.set(0, -0.02, 0.2);
gun.add(gunStock);

/* carregador */
const gunMag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), gunDarkMat);
gunMag.position.set(0, -0.16, -0.12);
gunMag.rotation.x = -0.18;
gun.add(gunMag);

/* punho */
const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), gunDarkMat);
gunGrip.position.set(0, -0.14, 0.06);
gunGrip.rotation.x = 0.28;
gun.add(gunGrip);

/* mira red-dot: base + aro (anel) + ponto luminoso alinhado ao centro */
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), gunDarkMat);
gunSight.position.set(0, 0.14, -0.28);
gun.add(gunSight);
const gunRing = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 14), gunDarkMat);
gunRing.position.set(0, 0.14, -0.34);
gun.add(gunRing);
const gunDotMat = new THREE.MeshBasicMaterial({ color: 0xff2d4d });
const gunDot = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), gunDotMat);
gunDot.position.set(0, 0.14, -0.34);
gun.add(gunDot);

const gunGlowMat = new THREE.MeshBasicMaterial({ color: 0x35e6ff });
const gunGlow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), gunGlowMat);
gunGlow.position.set(0, 0.1, -0.3);
gun.add(gunGlow);

const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffd93d, transparent: true, opacity: 0 });
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), muzzleMat);
muzzle.position.set(0, 0.02, -0.9);
gun.add(muzzle);
gun.position.set(0.28, -0.24, -0.45);
camera.add(gun);
scene.add(camera);

/* aplica o modelo da arma ativa */
function applyWeaponModel() {
  const w = WEAPONS[player.weapon];
  const k = w.len / 0.62;
  gunBody.scale.set(w.thick / 0.16, w.thick / 0.16, k);
  gunBody.position.set(0, 0, -w.len * 0.32);
  gunBodyMat.color.setHex(w.color);
  gunRail.scale.set(1, 1, k);
  gunRail.position.set(0, w.thick * 0.62, -w.len * 0.68);
  gunBarrel.scale.set(1, k, 1);
  gunBarrel.position.set(0, 0.02, -w.len * 0.95);
  gunSuppressor.position.set(0, 0.02, -w.len * 1.32);
  gunStock.position.set(0, -0.02, w.len * 0.32);
  gunMag.position.set(0, -w.thick * 1.0, -w.len * 0.19);
  gunGrip.position.set(0, -w.thick * 0.88, w.len * 0.1);
  gunSight.position.set(0, w.thick * 0.88, -w.len * 0.45);
  gunRing.position.set(0, w.thick * 0.88, -w.len * 0.55);
  gunDot.position.set(0, w.thick * 0.88, -w.len * 0.55);
  muzzle.position.set(0, 0.02, -w.len * 1.45);
  gunGlow.position.set(0, w.thick * 0.62, -w.len * 0.5);
}

function switchWeapon(i: number) {
  if (i === player.weapon || i < 0 || i >= WEAPONS.length) return;
  player.ammoByWeapon[player.weapon] = player.ammo;
  player.weapon = i;
  player.ammo = player.ammoByWeapon[i];
  player.reloading = 0;
  player.fireCd = Math.max(player.fireCd, 180);
  player.semiLock = true;
  applyWeaponModel();
  SFX.reload();
  updateHud();
}
applyWeaponModel();

/* ============================================================
   INIMIGOS
   ============================================================ */
type EnemyKind = 'grunt' | 'runner' | 'tank' | 'flyer';
type Team = 'ally' | 'foe';

interface Enemy {
  mesh: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  kind: EnemyKind;
  team: Team;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  radius: number;
  score: number;
  hitCd: number;
  phase: number;
  dead: boolean;
  /* ---- IA tática ---- */
  atkCd: number;
  strafeDir: number;
  strafeT: number;
  los: boolean;
  losT: number;
  stuckT: number;
  lastX: number;
  lastZ: number;
}

const enemies: Enemy[] = [];
const allies: Enemy[] = [];
const ALLY_COLOR = 0x35e6ff;

const KIND_CFG: Record<EnemyKind, { hp: number; speed: number; dmg: number; radius: number; score: number; color: number; scale: number; label: string }> = {
  grunt: { hp: 170, speed: 3.4, dmg: 14, radius: 0.55, score: 100, color: 0xff4d6d, scale: 1, label: 'GRUNT' },
  runner: { hp: 105, speed: 6.2, dmg: 9, radius: 0.45, score: 140, color: 0xffd93d, scale: 0.85, label: 'RUNNER' },
  tank: { hp: 520, speed: 2.1, dmg: 28, radius: 0.85, score: 260, color: 0xb14bff, scale: 1.45, label: 'TANK' },
  flyer: { hp: 135, speed: 4.6, dmg: 12, radius: 0.5, score: 180, color: 0x3dff9e, scale: 0.9, label: 'FLYER' },
};

function buildUnit(color: number, scale: number): { g: THREE.Group; body: THREE.Mesh; head: THREE.Mesh } {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.35),
    roughness: 0.45,
    metalness: 0.5,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), mat);
  body.position.y = 0.75;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat);
  head.position.y = 1.55;
  g.add(head);

  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  eye.position.set(0, 1.58, 0.29);
  g.add(eye);

  const legGeo = new THREE.BoxGeometry(0.22, 0.6, 0.22);
  for (const sx of [-0.24, 0.24]) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(sx, 0.3, 0);
    g.add(leg);
  }

  g.scale.setScalar(scale);
  return { g, body, head };
}

function makeEnemy(kind: EnemyKind, wave: number): Enemy {
  const cfg = KIND_CFG[kind];
  const { g, body, head } = buildUnit(cfg.color, cfg.scale);

  const hpScale = 1 + (wave - 1) * 0.16;
  const hp = Math.round(cfg.hp * hpScale);
  const e: Enemy = {
    mesh: g,
    body,
    head,
    kind,
    team: 'foe',
    hp,
    maxHp: hp,
    speed: cfg.speed * (1 + (wave - 1) * 0.045),
    dmg: cfg.dmg,
    radius: cfg.radius,
    score: cfg.score,
    hitCd: 0,
    phase: Math.random() * Math.PI * 2,
    dead: false,
    atkCd: 0.6 + Math.random() * 0.8,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeT: 0,
    los: false,
    losT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
  };

  // spawn no lado oposto (norte), como no Free Fire
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
  const r = ARENA - 6;
  g.position.set(Math.cos(a) * r, kind === 'flyer' ? 2.2 : 0, Math.sin(a) * r);
  scene.add(g);
  enemies.push(e);
  return e;
}

function makeAlly(idx: number): Enemy {
  const { g, body, head } = buildUnit(ALLY_COLOR, 1);
  const hp = 120;
  // esquadrão alinhado atrás do jogador (lado sul), como no Free Fire
  const off = (idx - 1) * 2.4;
  g.position.set(off, 0, 4.5 + Math.abs(idx - 1) * 0.8);
  scene.add(g);
  const ally: Enemy = {
    mesh: g,
    body,
    head,
    kind: 'grunt',
    team: 'ally',
    hp,
    maxHp: hp,
    speed: 6.4,
    dmg: 14,
    radius: 0.55,
    score: 0,
    hitCd: 0,
    phase: Math.random() * Math.PI * 2,
    dead: false,
    atkCd: 0.6 + Math.random() * 0.8,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeT: 0,
    los: false,
    losT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
  };
  allies.push(ally);
  return ally;
}

function spawnSquad() {
  for (let i = 0; i < 3; i++) makeAlly(i);
}

/* ============================================================
   TRACERS / PARTÍCULAS
   ============================================================ */
interface Tracer {
  line: THREE.Line;
  life: number;
}
const tracers: Tracer[] = [];

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
}
const particles: Particle[] = [];

const partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const partMats = new Map<number, THREE.MeshBasicMaterial>();
function partMat(color: number) {
  let m = partMats.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); partMats.set(color, m); }
  return m;
}

function spawnParticles(at: THREE.Vector3, color: number, n: number, power = 6) {
  const mat = partMat(color);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, mat);
    m.position.copy(at);
    scene.add(m);
    particles.push({
      mesh: m,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * power,
        Math.random() * power * 0.8,
        (Math.random() - 0.5) * power
      ),
      life: 0.5 + Math.random() * 0.4,
      max: 0.9,
    });
  }
}

/* ============================================================
   ÁUDIO PROCEDURAL
   ============================================================ */
let audioCtx: AudioContext | null = null;
let muted = false;
let masterVol = 0.7;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function blip(freq: number, dur: number, type: OscillatorType, vol = 0.12, slideTo?: number) {
  const ctx = ac();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
  g.gain.setValueAtTime(vol * masterVol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur);
}

function noise(dur: number, vol = 0.15, hp = 800) {
  const ctx = ac();
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol * masterVol;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

const SFX = {
  shot: () => {
    blip(220, 0.09, 'square', 0.09, 60);
    noise(0.07, 0.1, 1200);
  },
  hit: () => blip(880, 0.05, 'square', 0.06, 1200),
  head: () => {
    blip(1400, 0.07, 'square', 0.08, 2000);
    blip(700, 0.1, 'triangle', 0.06);
  },
  kill: () => blip(320, 0.16, 'sawtooth', 0.09, 90),
  hurt: () => {
    blip(140, 0.18, 'sawtooth', 0.14, 60);
    noise(0.12, 0.12, 300);
  },
  reload: () => {
    blip(500, 0.05, 'square', 0.05);
    setTimeout(() => blip(700, 0.05, 'square', 0.05), 120);
  },
  wave: () => {
    blip(440, 0.12, 'triangle', 0.1);
    setTimeout(() => blip(660, 0.12, 'triangle', 0.1), 130);
    setTimeout(() => blip(880, 0.2, 'triangle', 0.1), 260);
  },
  dead: () => blip(300, 0.7, 'sawtooth', 0.16, 40),
};

/* ============================================================
   ESTADO DO JOGO
   ============================================================ */
const game = {
  running: false,
  paused: false,
  over: false,
  score: 0,
  wave: 1,
  toSpawn: 0,
  spawnTimer: 0,
  waveBreak: 0,
  countdown: 0,
  cdStep: -1,
  best: Number(localStorage.getItem('voidstrike_best') || 0),
  time: 0,
  kills: 0,
  combo: 0,
  comboTimer: 0,
};

elBest.textContent = String(game.best);

/* ---------- input ---------- */
const keys: Record<string, boolean> = {};
let mouseDown = false;
let adsDown = false;
let pointerLocked = false;
let sens = 0.0022;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR' && game.running && !game.paused) startReload();
  if (e.code === 'KeyQ' && game.running && !game.paused) castIceWall();
  if (e.code === 'KeyG' && game.running && !game.paused) throwBomb();
  if (e.code === 'KeyE' && game.running && !game.paused) adsDown = true;
  if (e.code === 'KeyV' && game.running && !game.paused) thirdPerson = !thirdPerson;
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
  if (e.code === 'KeyM') {
    muted = !muted;
    if (!muted) SFX.hit();
  }
  if (e.code === 'Escape' && game.running && !game.over) setPaused(true);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyE') adsDown = false;
});

canvas.addEventListener('mousedown', (e) => {
  if (!pointerLocked) return;
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) adsDown = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) adsDown = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!pointerLocked || game.paused) return;
    e.preventDefault();
    const n = WEAPONS.length;
    switchWeapon((player.weapon + (e.deltaY > 0 ? 1 : n - 1)) % n);
  },
  { passive: false },
);

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) {
    mouseDown = false;
    if (game.running && !game.over) setPaused(true);
  }
});

addEventListener('mousemove', (e) => {
  if (!pointerLocked || game.paused) return;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
});

/* ---------- HUD ---------- */
let hudCache = { hp: -1, wave: -1, score: -1, best: -1, ammo: -1, reload: false, ally: -1, foe: -1, low: false, weapon: -1 };
const wSlots = Array.from(elWeaponHud.querySelectorAll<HTMLElement>('.wslot'));
const wAmmoEls = wSlots.map((s) => s.querySelector<HTMLElement>('.wammo')!);
function updateHud() {
  const hp = Math.max(0, Math.round(player.hp));
  if (hp !== hudCache.hp) {
    hudCache.hp = hp;
    elHp.textContent = String(hp);
    elHpFill.style.width = `${(hp / 200) * 100}%`;
    const low = hp <= 70;
    if (low !== hudCache.low) {
      hudCache.low = low;
      elHpFill.classList.toggle('low', low);
    }
  }
  if (game.wave !== hudCache.wave) {
    hudCache.wave = game.wave;
    elWave.textContent = String(game.wave);
  }
  if (game.score !== hudCache.score) {
    hudCache.score = game.score;
    elScore.textContent = String(game.score);
  }
  if (game.best !== hudCache.best) {
    hudCache.best = game.best;
    elBest.textContent = String(game.best);
  }
  const reloading = player.reloading > 0;
  if (reloading !== hudCache.reload || (!reloading && player.ammo !== hudCache.ammo)) {
    hudCache.reload = reloading;
    hudCache.ammo = player.ammo;
    elAmmo.textContent = reloading ? '...' : String(player.ammo);
  }
  if (player.weapon !== hudCache.weapon) {
    hudCache.weapon = player.weapon;
    for (let i = 0; i < wSlots.length; i++) wSlots[i].classList.toggle('active', i === player.weapon);
  }
  for (let i = 0; i < wAmmoEls.length; i++) {
    const n = i === player.weapon ? player.ammo : player.ammoByWeapon[i];
    const txt = String(n);
    if (wAmmoEls[i].textContent !== txt) {
      wAmmoEls[i].textContent = txt;
      wSlots[i].classList.toggle('empty', n <= 0);
    }
  }
  let allyN = 0;
  for (const a of allies) if (!a.dead) allyN++;
  if (allyN !== hudCache.ally) {
    hudCache.ally = allyN;
    elAllyN.textContent = String(allyN);
  }
  let foeN = 0;
  for (const e of enemies) if (!e.dead) foeN++;
  if (foeN !== hudCache.foe) {
    hudCache.foe = foeN;
    elFoeN.textContent = String(foeN);
  }
}

function flashHit(headshot: boolean) {
  elHit.classList.toggle('hs', headshot);
  elHit.classList.add('on');
  setTimeout(() => elHit.classList.remove('on'), 90);
}

/* ---------- dano flutuante estilo Free Fire ---------- */
const elDmgPop = $('dmgpop');
const dmgPopPool: HTMLDivElement[] = [];
const dmgPopTmp = new THREE.Vector3();

function popDamage(worldPos: THREE.Vector3, amount: number, headshot: boolean, kill = false) {
  if (!elDmgPop) return;
  dmgPopTmp.copy(worldPos).project(camera);
  if (dmgPopTmp.z > 1) return;
  const x = (dmgPopTmp.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-dmgPopTmp.y * 0.5 + 0.5) * window.innerHeight;
  if (x < -60 || y < -60 || x > window.innerWidth + 60 || y > window.innerHeight + 60) return;

  let el = dmgPopPool.pop();
  if (!el) {
    el = document.createElement('div');
    el.className = 'dmg';
  }
  el.className = 'dmg' + (headshot ? ' hs' : '') + (kill ? ' kill' : '');
  el.textContent = String(Math.round(amount));
  el.style.left = `${x + (Math.random() * 26 - 13)}px`;
  el.style.top = `${y + (Math.random() * 16 - 8)}px`;
  elDmgPop.appendChild(el);
  window.setTimeout(() => {
    el!.remove();
    if (dmgPopPool.length < 40) dmgPopPool.push(el!);
  }, 860);
}

function flashDamage() {
  if (!opts.shake) return;
  elDmg.style.opacity = '1';
  setTimeout(() => (elDmg.style.opacity = '0'), 120);
}

/* ---------- banner / killfeed / combo ---------- */
let bannerTimer = 0;
function showBanner(title: string, sub: string) {
  elWaveTitle.textContent = title;
  elWaveSub.textContent = sub;
  elBanner.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => elBanner.classList.remove('on'), 2000);
}

function addKillfeed(kind: EnemyKind, headshot: boolean) {
  if (!opts.killfeed) return;
  const d = document.createElement('div');
  d.className = 'kf' + (headshot ? ' hs' : '');
  d.textContent = `${headshot ? 'HEADSHOT · ' : ''}${KIND_CFG[kind].label} ELIMINADO`;
  elKillfeed.appendChild(d);
  while (elKillfeed.children.length > 5) elKillfeed.firstElementChild?.remove();
  setTimeout(() => d.classList.add('out'), 2200);
  setTimeout(() => d.remove(), 2700);
}

function bumpCombo() {
  game.combo++;
  game.comboTimer = 2.6;
  if (game.combo >= 2) {
    elComboN.textContent = `x${game.combo}`;
    elCombo.classList.add('on');
  }
}

/* ---------- tiro ---------- */
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

/* ---------- parede de gelo (habilidade Q) ---------- */
const ICE_CD = 0;
const ICE_LIFE = 15000;
const ICE_MAX = 6;
const iceMat = new THREE.MeshStandardMaterial({
  color: 0x9fe8ff,
  transparent: true,
  opacity: 0.42,
  roughness: 0.15,
  metalness: 0.1,
  emissive: 0x2a7fa8,
  emissiveIntensity: 0.5,
});
const iceGeo = new THREE.BoxGeometry(4.6, 3.2, 0.5);
type IceWall = { mesh: THREE.Mesh; box: THREE.Box3; life: number };
const iceWalls: IceWall[] = [];
let iceCd = 0;

function castIceWall() {
  if (iceCd > 0 || !game.running || game.paused) return;
  /* limite de paredes simultâneas: a mais antiga desaparece */
  if (iceWalls.length >= ICE_MAX) removeIceWall(iceWalls[0]);
  const mesh = new THREE.Mesh(iceGeo, iceMat);
  const dir = tmpA.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  mesh.position.set(player.pos.x + dir.x * 3.2, 1.6, player.pos.z + dir.z * 3.2);
  mesh.rotation.y = player.yaw;
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push(box);
  solids.push(mesh);
  iceWalls.push({ mesh, box, life: ICE_LIFE });
  iceCd = ICE_CD;
  blip(880, 0.05, 'square', 0.05);
  updateAbilityHud();
}

function removeIceWall(w: IceWall) {
  scene.remove(w.mesh);
  const oi = obstacles.indexOf(w.box);
  if (oi >= 0) obstacles.splice(oi, 1);
  const si = solids.indexOf(w.mesh);
  if (si >= 0) solids.splice(si, 1);
  const wi = iceWalls.indexOf(w);
  if (wi >= 0) iceWalls.splice(wi, 1);
}

function clearIceWalls() {
  while (iceWalls.length) removeIceWall(iceWalls[0]);
}

let abCache = { pct: -1, ready: true };
function updateAbilityHud() {
  const ready = iceCd <= 0;
  const pct = ready || ICE_CD <= 0 ? 100 : Math.round((1 - iceCd / ICE_CD) * 100);
  if (pct !== abCache.pct) {
    abCache.pct = pct;
    elAbFill.style.width = `${pct}%`;
  }
  if (ready !== abCache.ready) {
    abCache.ready = ready;
    elAbility.classList.toggle('cooling', !ready);
    elAbState.textContent = ready ? 'PRONTA · Q' : `RECARGA ${Math.ceil(iceCd / 1000)}s`;
  } else if (!ready) {
    elAbState.textContent = `RECARGA ${Math.ceil(iceCd / 1000)}s`;
  }
}

/* ---------- bomba (habilidade G) ---------- */
const BOMB_CD = 6000;
const BOMB_FUSE = 1500;
const BOMB_RADIUS = 6.5;
const BOMB_DMG = 110;
const BOMB_GRAV = 22;
const bombGeo = new THREE.SphereGeometry(0.16, 10, 10);
const bombMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.7, emissive: 0xff6b35, emissiveIntensity: 0.6 });
const blastGeo = new THREE.SphereGeometry(1, 14, 14);
type Bomb = { mesh: THREE.Mesh; vel: THREE.Vector3; fuse: number };
const bombs: Bomb[] = [];
const blasts: { mesh: THREE.Mesh; life: number }[] = [];
let bombCd = 0;

function throwBomb() {
  if (bombCd > 0 || !game.running || game.paused) return;
  const mesh = new THREE.Mesh(bombGeo, bombMat);
  const dir = camera.getWorldDirection(tmpA).clone();
  mesh.position.copy(camera.getWorldPosition(tmpB)).addScaledVector(dir, 0.6);
  const vel = dir.multiplyScalar(17).clone();
  vel.y += 4.5;
  scene.add(mesh);
  bombs.push({ mesh, vel, fuse: BOMB_FUSE });
  bombCd = BOMB_CD;
  blip(320, 0.06, 'sawtooth', 0.05);
  updateBombHud();
}

function explodeBomb(b: Bomb) {
  const p = b.mesh.position;
  scene.remove(b.mesh);
  const bi = bombs.indexOf(b);
  if (bi >= 0) bombs.splice(bi, 1);

  /* onda de choque visual */
  const blast = new THREE.Mesh(
    blastGeo,
    new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.55 }),
  );
  blast.position.copy(p);
  scene.add(blast);
  blasts.push({ mesh: blast, life: 0.35 });

  spawnParticles(p, 0xff8a3d, 26, 11);
  spawnParticles(p, 0xffd93d, 14, 8);
  noise(0.35, 0.5);
  flashHit(false);

  /* dano em área com falloff */
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) continue;
    const d = e.mesh.position.distanceTo(p);
    if (d > BOMB_RADIUS) continue;
    const falloff = 1 - d / BOMB_RADIUS;
    const dealt = Math.round(BOMB_DMG * (0.35 + 0.65 * falloff));
    e.hp -= dealt;
    popDamage(e.mesh.position, dealt, false, e.hp <= 0);
    if (e.hp <= 0) killEnemy(e, false);
  }
  /* aliados também sofrem (fogo amigo reduzido) */
  for (const a of allies) {
    if (a.dead) continue;
    const d = a.mesh.position.distanceTo(p);
    if (d > BOMB_RADIUS) continue;
    hurtAlly(a, Math.round(BOMB_DMG * 0.4 * (1 - d / BOMB_RADIUS)));
  }
  /* dano ao jogador se estiver perto */
  const pd = player.pos.distanceTo(p);
  if (pd < BOMB_RADIUS) {
    player.hp = Math.max(0, player.hp - Math.round(BOMB_DMG * 0.5 * (1 - pd / BOMB_RADIUS)));
    updateHud();
    if (player.hp <= 0) die();
  }
}

function clearBombs() {
  for (const b of bombs) scene.remove(b.mesh);
  bombs.length = 0;
  for (const bl of blasts) scene.remove(bl.mesh);
  blasts.length = 0;
}

let bombCache = { pct: -1, ready: true };
function updateBombHud() {
  const ready = bombCd <= 0;
  const pct = ready ? 100 : Math.round((1 - bombCd / BOMB_CD) * 100);
  if (pct !== bombCache.pct) {
    bombCache.pct = pct;
    elBombFill.style.width = `${pct}%`;
  }
  if (ready !== bombCache.ready) {
    bombCache.ready = ready;
    elBombHud.classList.toggle('cooling', !ready);
    elBombState.textContent = ready ? 'PRONTA · G' : `RECARGA ${Math.ceil(bombCd / 1000)}s`;
  } else if (!ready) {
    elBombState.textContent = `RECARGA ${Math.ceil(bombCd / 1000)}s`;
  }
}

function startReload() {
  const w = WEAPONS[player.weapon];
  if (player.reloading > 0 || player.ammo === w.mag) return;
  player.reloading = w.reloadMs;
  SFX.reload();
}

function shoot() {
  const wi = player.weapon;
  const w = WEAPONS[wi];
  if (player.reloading > 0 || player.ammo <= 0) {
    if (player.ammo <= 0) startReload();
    return;
  }
  player.ammo--;
  player.fireCd = w.fireMs;
  player.recoil = w.recoil;
  muzzleMat.opacity = 1;
  SFX.shot();

  raycaster.setFromCamera(center, camera);
  raycaster.far = 120;

  /* ---- spread: dispersão por arma, reduzida em ADS ---- */
  const spread = w.spread * (1 - player.ads * 0.75) * (1 + player.recoil * 0.5);
  if (spread > 0) {
    raycaster.ray.direction.x += (Math.random() - 0.5) * spread * 2;
    raycaster.ray.direction.y += (Math.random() - 0.5) * spread * 2;
    raycaster.ray.direction.normalize();
  }

  /* ---- MIRA PADRÃO (Free Fire): magnetismo no centro de massa (peito) ---- */
  const aimDir = raycaster.ray.direction;
  const camPos = camera.position;
  const lockedTarget = pickAimTarget(aimDir, camPos, aimConeNow());
  if (lockedTarget) {
    /* o Capa: se o jogador arrastou a mira para cima, o tiro sobe para a cabeça */
    const target = aimPointOf(lockedTarget, aimDir, camPos, tmpC);
    const dir = tmpA.copy(target).sub(camPos).normalize();
    raycaster.set(camPos, dir);
    const blocked = raycaster.intersectObjects(solids, false).some((h) => h.distance < 120);
    if (blocked) raycaster.set(camPos, aimDir);
  }

  elCross.classList.add('fire');
  window.setTimeout(() => elCross.classList.remove('fire'), 90);

  const targets: THREE.Object3D[] = [];
  for (const e of enemies) if (!e.dead) targets.push(e.body, e.head);

  const hits = raycaster.intersectObjects(targets, false);
  const wallHits = raycaster.intersectObjects(solids, false);

  const end = tmpB;
  raycaster.ray.at(80, end);

  const enemyHit = hits[0];
  const wallHit = wallHits[0];

  if (enemyHit && (!wallHit || enemyHit.distance < wallHit.distance)) {
    end.copy(enemyHit.point);
    const enemy = enemies.find((e) => e.body === enemyHit.object || e.head === enemyHit.object);
    if (enemy) {
      const headshot = enemyHit.object === enemy.head;
      const dealt = headshot ? w.headDmg : w.dmg;
      enemy.hp -= dealt;
      popDamage(enemyHit.point, dealt, headshot, enemy.hp <= 0);
      spawnParticles(enemyHit.point, headshot ? 0xffd93d : 0xff4d6d, headshot ? 14 : 8, 5);
      flashHit(headshot);
      if (headshot) SFX.head();
      else SFX.hit();
      if (enemy.hp <= 0) killEnemy(enemy, headshot);
    }
  } else if (lockedTarget && !lockedTarget.dead) {
    /* Mira Padrão: se o alvo travado está visível, o tiro "cola" nele */
    const chest = tmpA.setFromMatrixPosition(lockedTarget.body.matrixWorld);
    end.copy(chest);
    lockedTarget.hp -= w.dmg;
    popDamage(chest, w.dmg, false, lockedTarget.hp <= 0);
    spawnParticles(chest, 0xff4d6d, 8, 5);
    flashHit(false);
    SFX.hit();
    if (lockedTarget.hp <= 0) killEnemy(lockedTarget, false);
  } else if (wallHit) {
    end.copy(wallHit.point);
    spawnParticles(end, 0x35e6ff, 4, 3);
  }

  const start = tmpC;
  gunBarrel.getWorldPosition(start);
  const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

function killEnemy(e: Enemy, headshot: boolean, byAlly = false) {
  e.dead = true;
  if (!byAlly) {
    game.kills++;
    bumpCombo();
  }
  const comboBonus = 1 + Math.min(1, (game.combo - 1) * 0.1);
  const gain = Math.round(e.score * (headshot ? 1.5 : 1) * comboBonus * (byAlly ? 0.4 : 1));
  game.score += gain;
  if (!byAlly) popDamage(e.mesh.position.clone().setY(1.5), gain, false, true);
  spawnParticles(e.mesh.position.clone().setY(1), KIND_CFG[e.kind].color, 22, 9);
  scene.remove(e.mesh);
  e.mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  addKillfeed(e.kind, headshot);
  SFX.kill();
  updateHud();
}

function hurtAlly(a: Enemy, dmg: number) {
  a.hp -= dmg;
  spawnParticles(a.mesh.position.clone().setY(1.1), 0xff4d6d, 5, 4);
  if (a.hp <= 0) {
    a.dead = true;
    spawnParticles(a.mesh.position.clone().setY(1), ALLY_COLOR, 18, 8);
    scene.remove(a.mesh);
    const idx = allies.indexOf(a);
    if (idx >= 0) allies.splice(idx, 1);
    updateHud();
  }
}

/* ---------- ondas ---------- */
function startWave(n: number) {
  game.wave = n;
  // 4v4 fixo: exatamente 4 inimigos, nunca mais
  game.toSpawn = 4;
  game.spawnTimer = 0;
  game.waveBreak = 0;
  showBanner('4 VS 4', 'ELIMINA A EQUIPA INIMIGA');
  SFX.wave();
  updateHud();
}

function pickKind(wave: number): EnemyKind {
  const r = Math.random();
  if (wave >= 4 && r < 0.18) return 'tank';
  if (wave >= 2 && r < 0.42) return 'runner';
  if (wave >= 3 && r < 0.62) return 'flyer';
  return 'grunt';
}

/* ---------- dano no jogador ---------- */
function hurtPlayer(dmg: number) {
  if (game.over || game.paused) return;
  player.hp -= dmg;
  flashDamage();
  SFX.hurt();
  if (player.hp <= 0) {
    player.hp = 0;
    die();
  }
  updateHud();
}

function die() {
  game.over = true;
  game.running = false;
  mouseDown = false;
  SFX.dead();
  if (document.pointerLockElement) document.exitPointerLock();
  if (game.score > game.best) {
    game.best = game.score;
    localStorage.setItem('voidstrike_best', String(game.best));
  }
  elDeadStats.innerHTML = `PONTOS ${game.score}<br>ONDA ${game.wave}<br>ABATES ${game.kills}<br>MAPA ${currentMap.name}<br>RECORDE ${game.best}`;
  elDead.classList.remove('hidden');
  updateHud();
  recordMatch();
}

/* ---------- pausa ---------- */
function setPaused(p: boolean) {
  if (game.over) return;
  game.paused = p;
  mouseDown = false;
  elPause.classList.toggle('hidden', !p);
  if (p && document.pointerLockElement) document.exitPointerLock();
}

/* ---------- colisão ---------- */
function resolveObstacles(p: THREE.Vector3, radius = PLAYER_R) {
  for (const box of obstacles) {
    const minX = box.min.x - radius;
    const maxX = box.max.x + radius;
    const minZ = box.min.z - radius;
    const maxZ = box.max.z + radius;
    if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
      const dl = p.x - minX;
      const dr = maxX - p.x;
      const dt = p.z - minZ;
      const db = maxZ - p.z;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) p.x = minX;
      else if (m === dr) p.x = maxX;
      else if (m === dt) p.z = minZ;
      else p.z = maxZ;
    }
  }
  const lim = ARENA - 1.2;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
}

/* ============================================================
   LOOP
   ============================================================ */
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const camDir = new THREE.Vector3();
const camPivot = new THREE.Vector3();
const camWant = new THREE.Vector3();

/* ---- terceira pessoa ---- */
let thirdPerson = false;
let camDist = 0;
const TP_DIST = 4.2;
const TP_HEIGHT = 1.5;
const tpBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 1.1, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x35e6ff, emissive: 0x0a3a44, roughness: 0.45, metalness: 0.5 })
);
tpBody.position.y = 0.75;
const tpHead = new THREE.Mesh(
  new THREE.BoxGeometry(0.55, 0.5, 0.55),
  new THREE.MeshStandardMaterial({ color: 0x9fe9ff, emissive: 0x0a3a44, roughness: 0.4, metalness: 0.5 })
);
tpHead.position.y = 1.55;
const tpGun = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.14, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x1b2438, roughness: 0.4, metalness: 0.8 })
);
tpGun.position.set(0.3, 1.15, -0.45);
const tpAvatar = new THREE.Group();
tpAvatar.add(tpBody, tpHead, tpGun);
tpAvatar.visible = false;
scene.add(tpAvatar);

let crossLocked = false;
let adsState = false;
let crossGap = -1;

function update(dt: number) {
  game.time += dt;

  /* ---- combo decay ---- */
  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) {
      game.combo = 0;
      elCombo.classList.remove('on');
    }
  }

  /* ---- movimento ---- */
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  moveDir.set(0, 0, 0);

  const active = game.running && !game.paused && game.countdown <= 0;

  if (active) {
    if (keys['KeyW'] || keys['ArrowUp']) moveDir.add(fwd);
    if (keys['KeyS'] || keys['ArrowDown']) moveDir.sub(fwd);
    if (keys['KeyD'] || keys['ArrowRight']) moveDir.add(right);
    if (keys['KeyA'] || keys['ArrowLeft']) moveDir.sub(right);
  }

  const running = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = running ? RUN : WALK;

  if (moveDir.lengthSq() > 0) {
    moveDir.normalize().multiplyScalar(speed);
    player.bob += dt * (running ? 14 : 9);
  } else {
    player.bob += dt * 2;
  }

  player.vel.x += (moveDir.x - player.vel.x) * Math.min(1, dt * 14);
  player.vel.z += (moveDir.z - player.vel.z) * Math.min(1, dt * 14);

  if (active && keys['Space'] && player.onGround) {
    player.vel.y = JUMP_V;
    player.onGround = false;
  }
  player.vel.y -= GRAVITY * dt;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  if (player.pos.y <= PLAYER_H) {
    player.pos.y = PLAYER_H;
    player.vel.y = 0;
    player.onGround = true;
  }

  resolveObstacles(player.pos);

  /* ---- câmara (1ª / 3ª pessoa) ---- */
  const bobY = Math.sin(player.bob) * 0.045;
  const bobX = Math.cos(player.bob * 0.5) * 0.03;
  camDir.set(0, 0, -1).applyEuler(camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ'));
  if (thirdPerson) {
    /* pivô acima do ombro: a mira fica mais alta e nunca tapada pelo corpo */
    camPivot.set(player.pos.x, player.pos.y + TP_HEIGHT, player.pos.z);
    camWant.copy(camPivot).addScaledVector(camDir, -TP_DIST);
    /* evita a câmara entrar em paredes/obstáculos */
    const back = tmpA.copy(camPivot).sub(camWant);
    const backLen = back.length();
    back.multiplyScalar(1 / backLen);
    raycaster.set(camPivot, back);
    raycaster.far = backLen;
    const hits = raycaster.intersectObjects(solids, false);
    const maxD = hits.length ? Math.max(0.6, hits[0].distance - 0.25) : TP_DIST;
    raycaster.far = 120;
    camDist += (maxD - camDist) * Math.min(1, dt * 14);
    camera.position.copy(camPivot).addScaledVector(back, camDist);
    camera.position.y = Math.max(camera.position.y, 0.35);
    /* a câmara olha sempre para o pivô (mira no centro do ecrã) */
    camera.lookAt(camPivot);
    tpAvatar.position.set(player.pos.x, player.pos.y, player.pos.z);
    tpAvatar.rotation.y = player.yaw;
    tpAvatar.visible = true;
    gun.visible = false;
  } else {
    camera.position.set(player.pos.x + bobX, player.pos.y + bobY, player.pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw);
    camera.rotateX(player.pitch);
    tpAvatar.visible = false;
    gun.visible = true;
  }

  /* ---- mira ADS (abrir/fechar) ---- */
  const adsTarget = adsDown && !game.paused && player.reloading <= 0 ? 1 : 0;
  player.ads += (adsTarget - player.ads) * Math.min(1, dt * 12);
  const ads = player.ads;
  const fov = 78 - WEAPONS[player.weapon].adsFov * ads;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const adsOn = ads > 0.5;
  if (adsOn !== adsState) {
    adsState = adsOn;
    elCross.classList.toggle('ads', adsOn);
  }

  /* ---- arma ---- */
  player.recoil = Math.max(0, player.recoil - dt * 7);
  /* mira fechada: arma em baixo à direita (hip fire)
     mira aberta (ADS): arma centrada e mais baixa, para não tapar a mira */
  const gunX = 0.26 * (1 - ads);
  const gunY = (-0.26 + Math.sin(player.bob) * 0.012) * (1 - ads) - 0.2 * ads;
  const gunZ = (-0.5 + player.recoil * 0.12) * (1 - ads) - 0.3 * ads;
  gun.position.set(gunX, gunY, gunZ);
  gun.rotation.x = player.recoil * 0.22;
  gun.rotation.z = Math.sin(player.bob * 0.5) * 0.02 * (1 - ads);
  /* em ADS a arma esconde-se parcialmente para a mira ficar limpa */
  gun.scale.setScalar(1 - 0.25 * ads);
  /* red-dot: cresce e brilha em ADS para ficar bem visível no centro */
  gunDot.scale.setScalar(1 + ads * 1.6);
  gunDotMat.color.setHex(ads > 0.5 ? 0xff1f3d : 0xff2d4d);
  muzzleMat.opacity = Math.max(0, muzzleMat.opacity - dt * 12);
  gunGlowMat.color.setHex(currentMap.accent);
  gunGlow.scale.setScalar(1 + Math.sin(game.time * 4) * 0.12);

  /* ---- tiro ---- */
  player.fireCd = Math.max(0, player.fireCd - dt * 1000);
  if (player.reloading > 0) {
    player.reloading -= dt * 1000;
    if (player.reloading <= 0) {
      player.reloading = 0;
      player.ammo = WEAPONS[player.weapon].mag;
      updateHud();
    }
  }
  const wDef = WEAPONS[player.weapon];
  if (!mouseDown) player.semiLock = false;
  if (active && mouseDown && player.fireCd <= 0 && (wDef.auto || !player.semiLock)) {
    if (!wDef.auto) player.semiLock = true;
    shoot();
  }

  /* ---- paredes de gelo: várias ao mesmo tempo, cada uma dura 15s ---- */
  for (let i = iceWalls.length - 1; i >= 0; i--) {
    const w = iceWalls[i];
    w.life -= dt * 1000;
    if (w.life <= 0) removeIceWall(w);
  }
  if (iceCd > 0) {
    iceCd = Math.max(0, iceCd - dt * 1000);
    updateAbilityHud();
  }

  /* ---- bombas: física, fusível e explosão ---- */
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.vel.y -= BOMB_GRAV * dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    if (b.mesh.position.y <= 0.16) {
      b.mesh.position.y = 0.16;
      b.vel.y *= -0.35;
      b.vel.x *= 0.7;
      b.vel.z *= 0.7;
    }
    b.fuse -= dt * 1000;
    if (b.fuse <= 0) explodeBomb(b);
  }
  for (let i = blasts.length - 1; i >= 0; i--) {
    const bl = blasts[i];
    bl.life -= dt;
    const k = Math.max(0, bl.life / 0.35);
    bl.mesh.scale.setScalar(1 + (1 - k) * BOMB_RADIUS);
    (bl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
    if (bl.life <= 0) {
      scene.remove(bl.mesh);
      blasts.splice(i, 1);
    }
  }
  if (bombCd > 0) {
    bombCd = Math.max(0, bombCd - dt * 1000);
    updateBombHud();
  }

  /* ---- crosshair dinâmico (gap por velocidade + recoil + spread) ---- */
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  const gapPx = Math.round(
    (4 + hSpeed * 0.55 + player.recoil * 7 + wDef.spread * 900) * (1 - ads * 0.55),
  );
  if (gapPx !== crossGap) {
    crossGap = gapPx;
    elCross.style.setProperty('--gap', `${gapPx}px`);
  }

  /* ---- tracers ---- */
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.09);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
      tracers.splice(i, 1);
    }
  }

  /* ---- partículas ---- */
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.vel.y -= 18 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += dt * 8;
    p.mesh.rotation.y += dt * 6;
    p.mesh.scale.setScalar(Math.max(0.01, p.life / p.max));
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }

  /* ---- contagem decrescente 4v4 (estilo Free Fire) ---- */
  if (game.running && !game.paused && game.countdown > 0) {
    game.countdown -= dt;
    const step = Math.ceil(game.countdown);
    if (step !== game.cdStep) {
      game.cdStep = step;
      if (step > 0) {
        showBanner(String(step), '4 VS 4 · PREPARA-TE');
        SFX.wave();
      } else {
        showBanner('GO!', 'ELIMINA A EQUIPA INIMIGA');
        SFX.wave();
        startWave(1);
      }
    }
  }

  /* ---- 4v4: exatamente 4 inimigos, sem ondas extra ---- */
  if (active) {
    if (game.toSpawn > 0) {
      game.spawnTimer -= dt;
      if (game.spawnTimer <= 0) {
        game.spawnTimer = 0.45;
        makeEnemy(pickKind(game.wave), game.wave);
        game.toSpawn--;
      }
    } else if (enemies.length === 0 && !game.over) {
      game.waveBreak += dt;
      if (game.waveBreak > 1.6) {
        game.score += 500;
        showBanner('VITÓRIA', 'EQUIPA INIMIGA ELIMINADA');
        SFX.wave();
        game.waveBreak = -999; // evita repetir
      }
    }
  }

  /* ---- IA tática dos inimigos: noção de jogo (cobertura, flanco, gelo) e de tiro ---- */
  for (const e of enemies) {
    if (e.dead) continue;
    e.phase += dt * 6;
    e.hitCd = Math.max(0, e.hitCd - dt);
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.strafeT -= dt;
    e.losT -= dt;

    /* escolha de alvo: o mais próximo, mas o jogador tem prioridade se estiver perto */
    let target = player.pos;
    let targetUnit: Enemy | null = null;
    let bestD = e.mesh.position.distanceTo(player.pos) * 0.85;
    for (const a of allies) {
      if (a.dead) continue;
      const d = e.mesh.position.distanceTo(a.mesh.position);
      if (d < bestD) {
        bestD = d;
        target = a.mesh.position;
        targetUnit = a;
      }
    }

    /* linha de visão (recalculada a cada ~0.2s para poupar CPU) */
    if (e.losT <= 0) {
      e.losT = 0.2;
      const eye = tmpA.copy(e.mesh.position).setY(1.4);
      const dir = tmpB.copy(target).setY(1.1).sub(eye);
      const d = dir.length();
      dir.multiplyScalar(1 / Math.max(0.001, d));
      raycaster.set(eye, dir);
      const hits = raycaster.intersectObjects(solids, false);
      e.los = !hits.length || hits[0].distance > d - 0.4;
    }

    /* distância ideal por tipo: tank cola, runner flanqueia, flyer circula */
    const ideal = e.kind === 'tank' ? 1.4 : e.kind === 'runner' ? 2.2 : e.kind === 'flyer' ? 7 : 4.5;
    const toP = tmpA.subVectors(target, e.mesh.position);
    toP.y = 0;
    const dist = toP.length();
    toP.multiplyScalar(1 / Math.max(0.001, dist));

    /* strafe lateral (muda de direção periodicamente) */
    if (e.strafeT <= 0) {
      e.strafeT = 0.7 + Math.random() * 1.1;
      if (Math.random() < 0.45) e.strafeDir *= -1;
    }
    const strafeAmt = e.los && dist < 14 ? 0.75 : 0.25;

    let mx = 0;
    let mz = 0;
    if (dist > ideal + 0.4) {
      mx += toP.x;
      mz += toP.z;
    } else if (dist < ideal - 0.6) {
      mx -= toP.x * 0.8;
      mz -= toP.z * 0.8;
    }
    mx += -toP.z * e.strafeDir * strafeAmt;
    mz += toP.x * e.strafeDir * strafeAmt;

    /* separação: não empilhar em cima dos outros */
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const dx = e.mesh.position.x - o.mesh.position.x;
      const dz = e.mesh.position.z - o.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      const minD = e.radius + o.radius + 0.5;
      if (d2 < minD * minD && d2 > 0.0001) {
        const inv = 1 / Math.sqrt(d2);
        mx += dx * inv * 0.9;
        mz += dz * inv * 0.9;
      }
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 0.001) {
      mx /= ml;
      mz /= ml;
      const spd = e.speed * (e.los ? 1 : 1.15);
      e.mesh.position.x += mx * spd * dt;
      e.mesh.position.z += mz * spd * dt;
      resolveObstacles(e.mesh.position, e.radius);
    }

    /* deteção de bloqueio (gelo/obstáculo): contorna em vez de ficar preso */
    const moved = Math.hypot(e.mesh.position.x - e.lastX, e.mesh.position.z - e.lastZ);
    e.lastX = e.mesh.position.x;
    e.lastZ = e.mesh.position.z;
    if (ml > 0.001 && moved < e.speed * dt * 0.35) {
      e.stuckT += dt;
      if (e.stuckT > 0.35) {
        e.stuckT = 0;
        e.strafeDir *= -1;
        e.mesh.position.x += -toP.z * e.strafeDir * 0.9;
        e.mesh.position.z += toP.x * e.strafeDir * 0.9;
        resolveObstacles(e.mesh.position, e.radius);
      }
    } else {
      e.stuckT = 0;
    }

    if (e.kind === 'flyer') {
      e.mesh.position.y = 2.2 + Math.sin(e.phase * 0.6) * 0.5;
    } else {
      e.mesh.position.y = Math.abs(Math.sin(e.phase)) * 0.12;
    }

    e.mesh.rotation.y = Math.atan2(toP.x, toP.z);

    /* tiro: só dispara com linha de visão e dentro do alcance da sua arma */
    const range = e.kind === 'tank' ? 2.4 : e.kind === 'runner' ? 2.6 : e.kind === 'flyer' ? 16 : 20;
    if (active && e.los && dist < range && e.atkCd <= 0) {
      e.atkCd = e.kind === 'tank' ? 1.15 : e.kind === 'runner' ? 0.75 : 1.0;
      const hitAt = tmpC.copy(target).setY(1.1);
      const geo = new THREE.BufferGeometry().setFromPoints([
        tmpB.copy(e.mesh.position).setY(1.35),
        hitAt,
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.7 }),
      );
      scene.add(line);
      tracers.push({ line, life: 0.07 });
      if (targetUnit) {
        hurtAlly(targetUnit, e.dmg);
        spawnParticles(hitAt, 0xff4d6d, 4, 4);
      } else {
        hurtPlayer(e.dmg);
        spawnParticles(hitAt, 0xff4d6d, 6, 4);
      }
    }
  }

  /* ---- IA dos aliados: independentes, escolhem alvo, mantêm distância e fazem strafe ---- */
  for (let i = 0; i < allies.length; i++) {
    const a = allies[i];
    if (a.dead) continue;
    a.phase += dt * 6;
    a.hitCd = Math.max(0, a.hitCd - dt);
    a.atkCd = Math.max(0, a.atkCd - dt);
    a.strafeT -= dt;
    a.losT -= dt;

    /* escolhe o hostil mais próximo (com preferência por quem está a atacar o jogador) */
    let foe: Enemy | null = null;
    let foeD = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = a.mesh.position.distanceTo(e.mesh.position);
      if (d < foeD) {
        foeD = d;
        foe = e;
      }
    }

    /* LOS throttled */
    let hasLos = false;
    if (foe) {
      if (a.losT <= 0) {
        a.losT = 0.2;
        const from = tmpA.copy(a.mesh.position).setY(1.4);
        const to = tmpB.copy(foe.mesh.position).setY(1.1);
        const dir = tmpC.subVectors(to, from);
        const len = dir.length();
        dir.multiplyScalar(1 / len);
        raycaster.set(from, dir);
        const hits = raycaster.intersectObjects(solids, false);
        a.los = !hits.length || hits[0].distance > len - 0.4;
      }
      hasLos = a.los;
    }

    /* strafe periódico */
    if (a.strafeT <= 0) {
      a.strafeT = 0.9 + Math.random() * 1.1;
      a.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    /* objetivo: manter distância ideal do alvo; sem alvo, patrulhar perto do jogador */
    const ideal = 7;
    let gx: number;
    let gz: number;
    if (foe && foeD < 26) {
      const dx = a.mesh.position.x - foe.mesh.position.x;
      const dz = a.mesh.position.z - foe.mesh.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      const nx = dx / dl;
      const nz = dz / dl;
      const push = foeD < ideal - 1.5 ? 1 : foeD > ideal + 2 ? -1 : 0;
      gx = a.mesh.position.x + nx * push * 3 + -nz * a.strafeDir * 2;
      gz = a.mesh.position.z + nz * push * 3 + nx * a.strafeDir * 2;
    } else {
      gx = player.pos.x + Math.cos((i / 3) * Math.PI * 2 + 0.6) * 4.5;
      gz = player.pos.z + Math.sin((i / 3) * Math.PI * 2 + 0.6) * 4.5;
    }

    const toG = tmpA.set(gx - a.mesh.position.x, 0, gz - a.mesh.position.z);
    const gd = toG.length();
    if (gd > 0.4) {
      toG.multiplyScalar(1 / gd);
      a.mesh.position.x += toG.x * a.speed * dt;
      a.mesh.position.z += toG.z * a.speed * dt;
      resolveObstacles(a.mesh.position, 0.5);
    }

    /* deteção de bloqueio: se não se mexeu, inverte o strafe */
    if (Math.abs(a.mesh.position.x - a.lastX) < 0.002 && Math.abs(a.mesh.position.z - a.lastZ) < 0.002) {
      a.stuckT += dt;
      if (a.stuckT > 0.35) {
        a.strafeDir *= -1;
        a.stuckT = 0;
      }
    } else {
      a.stuckT = 0;
    }
    a.lastX = a.mesh.position.x;
    a.lastZ = a.mesh.position.z;

    a.mesh.position.y = Math.abs(Math.sin(a.phase)) * 0.1;
    if (foe) a.mesh.rotation.y = Math.atan2(foe.mesh.position.x - a.mesh.position.x, foe.mesh.position.z - a.mesh.position.z);

    /* dispara só com linha de visão e dentro do alcance */
    if (active && foe && foeD < 22 && hasLos && a.atkCd <= 0) {
      a.atkCd = 0.75 + Math.random() * 0.35;
      foe.hp -= a.dmg;
      const hitAt = tmpC.copy(foe.mesh.position).setY(1.1);
      spawnParticles(hitAt, ALLY_COLOR, 4, 4);
      const geo = new THREE.BufferGeometry().setFromPoints([
        tmpB.copy(a.mesh.position).setY(1.4),
        hitAt,
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: ALLY_COLOR, transparent: true, opacity: 0.75 }),
      );
      scene.add(line);
      tracers.push({ line, life: 0.07 });
      if (foe.hp <= 0) killEnemy(foe, false, true);
    }
  }

/* ---------- minimapa tático (estilo CS) ---------- */
const MM_SIZE = 220;
const MM_SCALE = MM_SIZE / (ARENA * 2);
function mmX(x: number) {
  return MM_SIZE / 2 + x * MM_SCALE;
}
function mmY(z: number) {
  return MM_SIZE / 2 + z * MM_SCALE;
}

function drawMinimap() {
  if (!opts.minimap) return;
  const c = mmCtx;
  c.clearRect(0, 0, MM_SIZE, MM_SIZE);

  c.fillStyle = 'rgba(6, 12, 22, 0.72)';
  c.fillRect(0, 0, MM_SIZE, MM_SIZE);

  c.strokeStyle = 'rgba(53, 230, 255, 0.10)';
  c.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (MM_SIZE / 8) * i;
    c.beginPath();
    c.moveTo(p, 0);
    c.lineTo(p, MM_SIZE);
    c.moveTo(0, p);
    c.lineTo(MM_SIZE, p);
    c.stroke();
  }

  c.strokeStyle = 'rgba(53, 230, 255, 0.45)';
  c.lineWidth = 1.5;
  c.strokeRect(1, 1, MM_SIZE - 2, MM_SIZE - 2);

  c.fillStyle = 'rgba(120, 150, 190, 0.30)';
  for (const b of obstacles) {
    const sx = mmX(b.min.x);
    const sz = mmY(b.min.z);
    c.fillRect(sx, sz, (b.max.x - b.min.x) * MM_SCALE, (b.max.z - b.min.z) * MM_SCALE);
  }

  for (const a of allies) {
    if (a.dead) continue;
    c.fillStyle = '#35e6ff';
    c.beginPath();
    c.arc(mmX(a.mesh.position.x), mmY(a.mesh.position.z), 3.2, 0, Math.PI * 2);
    c.fill();
  }

  for (const e of enemies) {
    if (e.dead) continue;
    c.fillStyle = '#ff4d6d';
    c.beginPath();
    c.arc(mmX(e.mesh.position.x), mmY(e.mesh.position.z), e.kind === 'tank' ? 4.2 : 3, 0, Math.PI * 2);
    c.fill();
  }

  const px = mmX(player.pos.x);
  const pz = mmY(player.pos.z);
  const ang = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));

  const grad = c.createRadialGradient(px, pz, 2, px, pz, 46);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(px, pz);
  c.arc(px, pz, 46, ang - 0.55, ang + 0.55);
  c.closePath();
  c.fill();

  c.save();
  c.translate(px, pz);
  c.rotate(ang + Math.PI / 2);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(0, -6);
  c.lineTo(4.5, 5);
  c.lineTo(0, 2.5);
  c.lineTo(-4.5, 5);
  c.closePath();
  c.fill();
  c.restore();
}

/* ---------- ambiente ---------- */
  const rimBase = currentMap.mode === 'light' ? 60 : 200;
  rim.intensity = rimBase + Math.sin(game.time * 2) * rimBase * 0.3;
  grid.position.y = 0.02 + Math.sin(game.time * 1.5) * 0.004;

  drawMinimap();

  /* ---- crosshair: destaca quando há alvo dentro do cone de correção ---- */
  raycaster.setFromCamera(center, camera);
  const aimDir = raycaster.ray.direction;
  const camPos = camera.position;
  let locked = false;
  const best = pickAimTarget(aimDir, camPos, aimConeNow());
  if (best) {
    locked = true;
    /* ---- magnetismo contínuo: a mira é atraída para o peito do alvo ---- */
    const chest = tmpA.setFromMatrixPosition(best.body.matrixWorld);
    const dx = chest.x - camPos.x;
    const dy = chest.y - camPos.y;
    const dz = chest.z - camPos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    let dYaw = wantYaw - player.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const k = Math.min(1, dt * (FF.pull + player.ads * FF.pullAds));
    player.yaw += dYaw * k;
    player.pitch += (wantPitch - player.pitch) * k;
  }
  if (locked !== crossLocked) {
    crossLocked = locked;
    elCross.classList.toggle('lock', locked);
  }
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ============================================================
   START / RESET
   ============================================================ */
function resetGame() {
  for (const e of enemies) scene.remove(e.mesh);
  enemies.length = 0;
  for (const a of allies) scene.remove(a.mesh);
  allies.length = 0;
  for (const p of particles) scene.remove(p.mesh);
  particles.length = 0;
  for (const t of tracers) scene.remove(t.line);
  tracers.length = 0;
  elKillfeed.innerHTML = '';
  elCombo.classList.remove('on');
  elBanner.classList.remove('on');

  player.pos.set(0, PLAYER_H, 0);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.hp = 200;
  player.ads = 0;
  adsDown = false;
  player.ammo = WEAPONS[0].mag;
  player.reloading = 0;
  player.fireCd = 0;
  player.weapon = 0;
  player.ammoByWeapon = WEAPONS.map((w) => w.mag);
  player.ammo = WEAPONS[0].mag;
  player.semiLock = false;
  applyWeaponModel();
  clearIceWalls();
  iceCd = 0;
  iceMat.opacity = 0.42;
  abCache = { pct: -1, ready: true };
  updateAbilityHud();
  clearBombs();
  bombCd = 0;
  bombCache = { pct: -1, ready: true };
  updateBombHud();
  hudCache.weapon = -1;

  game.score = 0;
  game.kills = 0;
  game.over = false;
  game.paused = false;
  game.running = true;
  game.wave = 0;
  game.combo = 0;
  game.comboTimer = 0;
  spawnSquad();
  game.countdown = 3.2;
  game.cdStep = -1;
  updateHud();
}

function begin() {
  elMenu.classList.remove('show');
  elDead.classList.add('hidden');
  elPause.classList.add('hidden');
  buildMap(currentMap);
  resetGame();
  canvas.requestPointerLock();
}

/* ---------- seleção de mapas ---------- */
function renderMapList() {
  elMapList.innerHTML = '';
  for (const m of MAPS) {
    const card = document.createElement('div');
    card.className = 'mapcard' + (m.id === currentMap.id ? ' sel' : '');
    card.innerHTML = `<h3>${m.name}</h3><p>${m.desc}</p><span class="tag">${m.tag}</span>`;
    card.addEventListener('click', () => {
      currentMap = m;
      elMapLabel.textContent = m.name;
      renderMapList();
      buildMap(m);
    });
    elMapList.appendChild(card);
  }
}

$('startBtn').addEventListener('click', begin);
$('retryBtn').addEventListener('click', begin);
$('resumeBtn').addEventListener('click', () => {
  setPaused(false);
  canvas.requestPointerLock();
});

/* ============================================================
   MENU — perfil, tabs, modos, salas, amigos, definições
   ============================================================ */
const opts = { minimap: true, killfeed: true, shake: true };

const MODES: Record<string, { label: string; diff: string }> = {
  solo: { label: 'SOLO SURVIVAL', diff: 'normal' },
  ranked: { label: 'RANKED 4v4', diff: 'hard' },
  custom: { label: 'CUSTOM', diff: 'normal' },
};
const DIFFS: Record<string, string> = { easy: 'FÁCIL', normal: 'NORMAL', hard: 'DIFÍCIL', insane: 'INSANO' };

interface Profile {
  name: string;
  xp: number;
  matches: number;
  kills: number;
  best: number;
}
const loadProfile = (): Profile => {
  try {
    return { name: 'OPERADOR', xp: 0, matches: 0, kills: 0, best: 0, ...JSON.parse(localStorage.getItem('voidstrike_profile') || '{}') };
  } catch {
    return { name: 'OPERADOR', xp: 0, matches: 0, kills: 0, best: 0 };
  }
};
const profile = loadProfile();
const saveProfile = () => localStorage.setItem('voidstrike_profile', JSON.stringify(profile));
const levelOf = (xp: number) => Math.floor(xp / 500) + 1;

let selMode = 'solo';
let selDiff = 'normal';

function renderProfile() {
  $('pname').textContent = profile.name;
  $('avatar').textContent = profile.name.slice(0, 1).toUpperCase() || 'V';
  $('plevel').textContent = `NÍVEL ${levelOf(profile.xp)} · ${profile.xp} XP`;
  $('pMatches').textContent = String(profile.matches);
  $('pKills').textContent = String(profile.kills);
  $('pBest').textContent = String(Math.max(profile.best, game.best));
  $('sumBest').textContent = String(Math.max(profile.best, game.best));
}

function renderSummary() {
  $('sumMode').textContent = MODES[selMode].label;
  $('sumMap').textContent = currentMap.name;
  $('sumDiff').textContent = DIFFS[selDiff];
}

function setStatus(msg: string) {
  $('footStatus').textContent = msg;
}

/* ---------- tabs ---------- */
document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === tab));
    const id = tab.dataset.tab;
    document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === id));
    setStatus(id === 'multi' ? 'SERVIDOR LOCAL · SALAS SIMULADAS' : 'PRONTO');
  });
});

/* ---------- modos / dificuldade ---------- */
document.querySelectorAll<HTMLElement>('.mode').forEach((m) => {
  m.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('sel', x === m));
    selMode = m.dataset.mode || 'solo';
    selDiff = MODES[selMode].diff;
    document.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('on', c.dataset.diff === selDiff));
    renderSummary();
  });
});
document.querySelectorAll<HTMLElement>('.chip').forEach((c) => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    selDiff = c.dataset.diff || 'normal';
    renderSummary();
  });
});

/* ---------- modal ---------- */
let modalOk: (() => void) | null = null;
function openModal(title: string, text: string, okLabel: string, onOk: () => void, withInput = false) {
  $('modalTitle').textContent = title;
  $('modalText').innerHTML = withInput
    ? `<input id="modalInput" value="${text}" maxlength="14" />`
    : text;
  $('modalOk').textContent = okLabel;
  modalOk = onOk;
  $('modal').classList.remove('hidden');
  if (withInput) ($<HTMLInputElement>('modalInput')).focus();
}
function closeModal() {
  $('modal').classList.add('hidden');
  modalOk = null;
}
$('modalCancel').addEventListener('click', closeModal);
$('modalOk').addEventListener('click', () => {
  const fn = modalOk;
  closeModal();
  fn?.();
});

/* ---------- perfil ---------- */
$('editNameBtn').addEventListener('click', () => {
  openModal('NOME DE OPERADOR', profile.name, 'GUARDAR', () => {
    const v = ($<HTMLInputElement>('modalInput')).value.trim().toUpperCase();
    if (!v) return;
    profile.name = v;
    saveProfile();
    renderProfile();
    setStatus('PERFIL ATUALIZADO');
  }, true);
});

/* ---------- salas ---------- */
interface Room {
  id: number;
  name: string;
  map: string;
  mode: string;
  players: number;
  max: number;
  ping: number;
  locked: boolean;
}
let rooms: Room[] = [];
let roomSeq = 1;

/* sem bots: a lista só mostra salas criadas por jogadores reais */
function genRooms() {
  rooms = rooms.filter((r) => r.players > 0);
}

function renderRooms() {
  const q = ($<HTMLInputElement>('roomSearch')).value.trim().toLowerCase();
  const body = $('roomList');
  body.innerHTML = '';
  const list = rooms.filter((r) => !q || r.name.toLowerCase().includes(q) || r.map.toLowerCase().includes(q));
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Nenhuma sala ativa. Cria a tua sala para jogar com pessoas reais.</td></tr>';
    return;
  }
  for (const r of list) {
    const tr = document.createElement('tr');
    const pingCls = r.ping < 45 ? 'ping' : r.ping < 80 ? 'ping mid' : 'ping bad';
    const full = r.players >= r.max;
    tr.innerHTML = `
      <td><b>${r.name}</b>${r.locked ? ' <span class="lock">🔒</span>' : ''}</td>
      <td>${r.map}</td>
      <td>${r.mode}</td>
      <td>${r.players}/${r.max}</td>
      <td><span class="${pingCls}">${r.ping} ms</span></td>
      <td><button class="primary" ${full ? 'disabled' : ''}>${full ? 'CHEIA' : 'ENTRAR'}</button></td>`;
    tr.querySelector('button')?.addEventListener('click', () => joinRoom(r));
    body.appendChild(tr);
  }
}

function joinRoom(r: Room) {
  if (r.locked) {
    openModal('SALA PRIVADA', 'Esta sala exige convite. Pede ao anfitrião para te adicionar.', 'OK', () => {});
    return;
  }
  const map = MAPS.find((m) => m.name === r.map) || MAPS[0];
  currentMap = map;
  elMapLabel.textContent = map.name;
  renderMapList();
  selMode = r.mode === 'SOLO SURVIVAL' ? 'solo' : 'ranked';
  selDiff = r.mode === '4v4 RANKED' ? 'hard' : 'normal';
  renderSummary();
  setStatus(`A ENTRAR EM ${r.name}...`);
  begin();
}

$('refreshRooms').addEventListener('click', () => {
  genRooms();
  renderRooms();
  setStatus('LISTA DE SALAS ATUALIZADA');
});
$('roomSearch').addEventListener('input', renderRooms);

function createRoom() {
  const name = ($<HTMLInputElement>('newRoomName')).value.trim().toUpperCase() || 'NOVA SALA';
  const mapId = ($<HTMLSelectElement>('newRoomMap')).value;
  const map = MAPS.find((m) => m.id === mapId) || MAPS[0];
  const mode = ($<HTMLSelectElement>('newRoomMode')).value;
  const max = Number(($<HTMLSelectElement>('newRoomMax')).value);
  const priv = ($<HTMLInputElement>('newRoomPrivate')).checked;
  rooms.unshift({ id: roomSeq++, name, map: map.name, mode, players: 1, max, ping: 8, locked: priv });
  renderRooms();
  currentMap = map;
  elMapLabel.textContent = map.name;
  renderMapList();
  selMode = mode === 'SOLO SURVIVAL' ? 'solo' : 'ranked';
  selDiff = mode === '4v4 RANKED' ? 'hard' : 'normal';
  renderSummary();
  setStatus(`SALA "${name}" CRIADA`);
  begin();
}
$('createRoomBtn').addEventListener('click', () => {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === 'multi'));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === 'multi'));
  ($<HTMLInputElement>('newRoomName')).focus();
});
$('createRoomBtn2').addEventListener('click', createRoom);

/* ---------- amigos ---------- */
interface Friend {
  name: string;
  status: 'online' | 'ingame' | 'offline';
  level: number;
}
let friends: Friend[] = [
  { name: 'NOVA', status: 'online', level: 12 },
  { name: 'KAIRO', status: 'ingame', level: 24 },
  { name: 'ZENITH', status: 'offline', level: 7 },
];
let requests: string[] = ['RAVEN', 'ORION'];
const SUGGESTED = ['VEGA', 'SABLE', 'ECHO', 'DRIFT', 'ONYX'];

function friendRow(f: Friend, actions: 'friend' | 'request' | 'suggest') {
  const li = document.createElement('li');
  const dot = f.status === 'online' ? 'dot on' : f.status === 'ingame' ? 'dot ingame' : 'dot';
  const label = f.status === 'online' ? 'ONLINE' : f.status === 'ingame' ? 'EM JOGO' : 'OFFLINE';
  li.innerHTML = `
    <span class="${dot}"></span>
    <span class="fname">${f.name}</span>
    <span class="fstat">NÍVEL ${f.level} · ${label}</span>
    <span class="acts"></span>`;
  const acts = li.querySelector('.acts')!;
  const mk = (txt: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = txt;
    b.addEventListener('click', fn);
    acts.appendChild(b);
  };
  if (actions === 'friend') {
    mk('CONVIDAR', 'ghost', () => setStatus(`CONVITE ENVIADO A ${f.name}`));
    mk('REMOVER', 'ghost', () => {
      friends = friends.filter((x) => x.name !== f.name);
      renderFriends();
      setStatus(`${f.name} REMOVIDO`);
    });
  } else if (actions === 'request') {
    mk('ACEITAR', 'primary', () => {
      requests = requests.filter((n) => n !== f.name);
      friends.push({ name: f.name, status: 'online', level: 1 + Math.floor(Math.random() * 30) });
      renderFriends();
      setStatus(`${f.name} ADICIONADO`);
    });
    mk('RECUSAR', 'ghost', () => {
      requests = requests.filter((n) => n !== f.name);
      renderFriends();
    });
  } else {
    mk('ADICIONAR', 'primary', () => {
      friends.push({ name: f.name, status: 'offline', level: 1 + Math.floor(Math.random() * 30) });
      renderFriends();
      setStatus(`PEDIDO ENVIADO A ${f.name}`);
    });
  }
  return li;
}

function renderFriends() {
  const fl = $('friendList');
  fl.innerHTML = '';
  if (!friends.length) fl.innerHTML = '<li class="empty">Sem amigos. Adiciona operadores acima.</li>';
  for (const f of friends) fl.appendChild(friendRow(f, 'friend'));

  const rl = $('requestList');
  rl.innerHTML = '';
  if (!requests.length) rl.innerHTML = '<li class="empty">Sem pedidos pendentes.</li>';
  for (const n of requests) rl.appendChild(friendRow({ name: n, status: 'online', level: 1 + (n.length % 20) }, 'request'));

  const sl = $('suggestList');
  sl.innerHTML = '';
  const pool = SUGGESTED.filter((n) => !friends.some((f) => f.name === n));
  if (!pool.length) sl.innerHTML = '<li class="empty">Sem sugestões.</li>';
  for (const n of pool) sl.appendChild(friendRow({ name: n, status: 'offline', level: 1 + (n.length % 20) }, 'suggest'));

  const online = friends.filter((f) => f.status !== 'offline').length;
  $('friendCount').textContent = `${online} online · ${friends.length} total`;
}

$('addFriendBtn').addEventListener('click', () => {
  const inp = $<HTMLInputElement>('friendInput');
  const v = inp.value.trim().toUpperCase();
  if (!v) return;
  if (friends.some((f) => f.name === v)) {
    setStatus(`${v} JÁ ESTÁ NA LISTA`);
    return;
  }
  friends.push({ name: v, status: 'offline', level: 1 });
  inp.value = '';
  renderFriends();
  setStatus(`PEDIDO ENVIADO A ${v}`);
});
$('friendInput').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') $('addFriendBtn').click();
});

/* ---------- definições ---------- */
const setVol = $<HTMLInputElement>('setVol');
const setSens = $<HTMLInputElement>('setSens');
const setAim = $<HTMLInputElement>('setAim');

setVol.addEventListener('input', () => {
  masterVol = Number(setVol.value) / 100;
  $('setVolV').textContent = setVol.value;
});
setSens.addEventListener('input', () => {
  sens = 0.0006 + (Number(setSens.value) / 10) * 0.0038;
  $('setSensV').textContent = setSens.value;
});
const setAimMode = $<HTMLSelectElement>('setAimMode');
/* aplica o cone de assistência: ADS é sempre precisa; o modo só afeta a mira fechada */
function applyAimCone() {
  const base = Number(setAim.value);
  FF.cone = setAimMode.value === 'precise' ? base * 0.45 : base;
  $('setAimV').textContent = `${setAim.value}°`;
}
setAim.addEventListener('input', applyAimCone);
setAimMode.addEventListener('change', applyAimCone);
applyAimCone();
$<HTMLInputElement>('setMinimap').addEventListener('change', (e) => {
  opts.minimap = (e.target as HTMLInputElement).checked;
  $('minimapwrap').style.display = opts.minimap ? '' : 'none';
});
$<HTMLInputElement>('setKillfeed').addEventListener('change', (e) => {
  opts.killfeed = (e.target as HTMLInputElement).checked;
  elKillfeed.style.display = opts.killfeed ? '' : 'none';
});
$<HTMLInputElement>('setShake').addEventListener('change', (e) => {
  opts.shake = (e.target as HTMLInputElement).checked;
});
$('resetStatsBtn').addEventListener('click', () => {
  openModal('APAGAR ESTATÍSTICAS', 'Isto apaga XP, partidas, abates e recorde. Continuar?', 'APAGAR', () => {
    profile.xp = 0;
    profile.matches = 0;
    profile.kills = 0;
    profile.best = 0;
    game.best = 0;
    localStorage.removeItem('voidstrike_best');
    saveProfile();
    renderProfile();
    updateHud();
    setStatus('ESTATÍSTICAS APAGADAS');
  });
});

/* ---------- sair para o menu ---------- */
function backToMenu() {
  game.running = false;
  game.paused = false;
  game.over = false;
  mouseDown = false;
  if (document.pointerLockElement) document.exitPointerLock();
  elPause.classList.add('hidden');
  elDead.classList.add('hidden');
  elMenu.classList.add('show');
  renderProfile();
  renderSummary();
  setStatus('PRONTO');
}
$('quitBtn').addEventListener('click', backToMenu);
$('menuBtn').addEventListener('click', backToMenu);

/* ---------- registo de fim de partida ---------- */
function recordMatch() {
  profile.matches++;
  profile.kills += game.kills;
  profile.xp += game.score;
  profile.best = Math.max(profile.best, game.score);
  saveProfile();
  renderProfile();
}

canvas.addEventListener('click', () => {
  if (game.running && !game.paused && !pointerLocked) canvas.requestPointerLock();
});

elMapLabel.textContent = currentMap.name;
renderMapList();
renderProfile();
renderSummary();
genRooms();
renderRooms();
renderFriends();
buildMap(currentMap);
updateHud();
loop();
