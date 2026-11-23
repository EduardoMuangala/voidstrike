import * as THREE from 'three';
import { HEROES, ITEMS, PRIMARY_IDS, SLOTS, WEAPONS, type AbilityId, type Difficulty, type ModeId, type Outfit, type WeaponDef, type WeaponId } from '../data';
import { profile } from '../save';
import { sfx } from '../audio';
import { box, cyl, glow, mat, sphere } from '../models/materials';
import { weaponMesh } from '../models/weapon';
import { Actor, RADIUS } from './actor';
import { World, type Wall } from './world';
import type { MapId, Poi } from './maps';
import type { RoomNet } from '../webrtc';
import type { NetInputMsg } from '../netproto';
import { netSnap, netShot, netBoom, netKill, netEnd } from '../netproto';
import type { NetActorSnap } from '../netproto';
import { Fx } from './fx';
import { Hud, esc } from './hud';
import { Input } from './input';
import { Gloo } from './gloo';
import { Plane } from './plane';
import { Replay, FL, type Snap } from './replay';
import { Spectator } from './spectator';

export interface MatchResult {
  mode: ModeId;
  win: boolean;
  rank: number;
  total: number;
  kills: number;
  damage: number;
  time: number;
  scoreA: number;
  scoreB: number;
  quit: boolean;
  winner?: string;
}

export interface MatchOpts {
  mode: ModeId;
  map: MapId;
  difficulty: Difficulty;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  onEnd: (r: MatchResult) => void;
  /** Room play: a real human occupies this actor instead of a bot, driven by messages over net. */
  net?: RoomNet;
  netPlayers?: { id: string; name: string }[];
  seed?: number;
}


type LootKind = 'weapon' | 'med' | 'armor' | 'gel' | 'nade';
interface Loot { kind: LootKind; wid?: WeaponId; n: number; obj: THREE.Group; pos: THREE.Vector3; alive: boolean; spin: number }
interface Nade { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; owner: Actor }

const GRAV = 22;
const JUMP = 7.4;
const SPEED = 6.2;
const BR_PLAYERS = 48;
const BASE_NAMES = ['xKiller', 'NinjaAO', 'Sombra77', 'Fénix', 'ReiDoCapim', 'Mamba', 'Kuduro', 'TugaSniper', 'Bala7', 'Jaguar', 'Mito', 'LoboAlfa', 'ProPlayer', 'Zica', 'Raio', 'Pantera', 'Cobra', 'Trovão', 'Kamikaze', 'Ghost', 'Sniperzinho', 'Diamante', 'Bruxo', 'Dread', 'Kiala', 'Muxima', 'Zumbi', 'Nzola', 'Vulcão', 'Tigre', 'Falcão', 'Sobas', 'Kalunga', 'Fantasma', 'Ciclone', 'Neblina', 'Kanzala', 'Bumbo', 'Ritmo', 'Capitão', 'Tsunami', 'Orion', 'Nova', 'Furacão', 'Kwanza', 'Zeus', 'Hydra', 'Sniper99', 'Boladão', 'Malandro'];
const ABIL_ICON: Record<AbilityId, string> = { dash: '⚡', heal: '✚', shield: '⛨', reveal: '◉', fury: '🔥' };
const PREF_DIST: Record<WeaponId, number> = { ar: 22, smg: 12, sg: 6, sr: 55, dmr: 40, lmg: 24, pistol: 14 };
// Only scales how dangerous bots are to the human player — picking "hard" must not
// also make bots slaughter each other faster, or the 48-player lobby empties out fast.
const DIFF = {
  easy: { acc: 0.15, react: 0.85, dmg: 0.5, detect: 0.8, rate: 1.4 },
  normal: { acc: 0.24, react: 0.5, dmg: 0.75, detect: 1, rate: 1.15 },
  hard: { acc: 0.4, react: 0.16, dmg: 1.05, detect: 1.3, rate: 0.9 },
};
const HEAD_CHANCE: Record<Difficulty, number> = { easy: 0.06, normal: 0.12, hard: 0.24 };
// Fixed baseline for bot-vs-bot fights, independent of the chosen difficulty, so the
// 48-player population thins out at a believable pace no matter how hard the player set it.
const BOT_VS_BOT = { acc: 0.13, react: 0.5, dmg: 0.42, rate: 1.3, head: 0.07 };
const LOW_HP = 38;
const ZONE_PHASES = [
  { wait: 55, shrink: 40, r: 120, dps: 1.5 },
  { wait: 40, shrink: 30, r: 75, dps: 3 },
  { wait: 30, shrink: 25, r: 45, dps: 5 },
  { wait: 25, shrink: 20, r: 24, dps: 8 },
  { wait: 20, shrink: 16, r: 10, dps: 12 },
  { wait: 15, shrink: 14, r: 0, dps: 16 },
];
const ARMOR_RED = [0, 0.2, 0.3, 0.42];
export const ARENA_R = 52;

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ringGeo = new THREE.RingGeometry(0.45, 0.6, 20).rotateX(-Math.PI / 2);

const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Squad mode's arena is picked from the map's seeded RNG (not Math.random)
 * so the host and every room guest — all building an identical World from
 * the same seed — land on the exact same arena without needing a message. */
export function pickArena(world: World): Poi | null {
  const names = world.def.arenas;
  if (!names.length) return null;
  return world.pois.find((p) => p.name === names[(world.R() * names.length) | 0]) || world.pois[0];
}
const netFwd = (yaw: number, pitch: number, out: THREE.Vector3) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

function randomOutfit(): Outfit {
  const o = {} as Outfit;
  for (const s of SLOTS) {
    const opts = ITEMS.filter((i) => i.slot === s.id);
    o[s.id] = (Math.random() < 0.35 ? opts[0] : pick(opts)).id;
  }
  return o;
}

function makeNames(n: number) {
  const out = [...BASE_NAMES].sort(() => Math.random() - 0.5);
  let k = 1;
  while (out.length < n) out.push(`${pick(BASE_NAMES)}${k++}`);
  return out;
}

export class Match {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  fx = new Fx();
  hud: Hud;
  input: Input;
  gloo: Gloo;
  actors: Actor[] = [];
  player: Actor;
  loot: Loot[] = [];
  nades: Nade[] = [];
  mode: ModeId;
  diff: Difficulty;
  time = 0;
  over = false;
  scoreA = 0;
  scoreB = 0;
  total = 0;
  plane: Plane | null = null;
  private onPlane = new Set<Actor>();
  private jumpAt = new Map<Actor, number>();
  private landAt = new Map<Actor, THREE.Vector3>();
  private poiLanded = new Map<Poi, number>();
  spec: Spectator | null = null;
  replay: Replay | null = null;
  replayOn = false;
  replayT = 0;
  replaySpeed = 1;
  replayPaused = false;
  private replayA = 0;
  private replayB = 0;
  private replayPrev = 0;
  private snap: Snap = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, weapon: null, hp: 0, speed: 0, vx: 0, vz: 0 };
  private opts: MatchOpts;
  private net: RoomNet | null = null;
  private netInputs = new Map<string, NetInputMsg>();
  private netActorByPeer = new Map<string, Actor>();
  private netAcc = 0;
  far: number;
  private camDist = 3;
  private shake = 0;
  private fovNow = 72;
  private semiLatch = false;
  private assist: { a: Actor; head: boolean } | null = null;
  private toastT = 0;
  private streak = 0;
  private streakT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private endT = -1;
  private result: MatchResult | null = null;
  private pauseEl: HTMLElement;
  private menuOpen = false;
  private deathEl: HTMLElement | null = null;
  zone = { cx: 0, cz: 0, r: 300, ncx: 0, ncz: 0, nr: 300, fcx: 0, fcz: 0, fr: 300, phase: -1, t: 0, shrinking: false, dps: 0, started: false };
  private zoneWall: THREE.Mesh | null = null;
  private zoneRing: THREE.Mesh | null = null;
  private miniBase: HTMLCanvasElement;
  private auraGeo = new THREE.SphereGeometry(1.05, 14, 10);
  private auraMat = new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.18, depthWrite: false });
  private nadeGeo = new THREE.SphereGeometry(0.13, 8, 6);
  private tagTimer = 0;
  private mapOpen = false;
  private mapT = 0;
  arena: Poi | null = null;

  constructor(opts: MatchOpts) {
    this.opts = opts;
    this.mode = opts.mode;
    this.diff = opts.difficulty;
    const q = profile.settings.quality;
    this.far = q === 'low' ? 120 : q === 'medium' ? 175 : 250;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 700);
    this.camera.rotation.order = 'YXZ';

    const mapId: MapId = this.mode === 'train' ? 'range' : opts.map;
    this.world = new World(mapId, opts.seed ?? ((Math.random() * 1e9) | 0));
    this.net = opts.net || null;
    if (this.net) this.net.onMessage = (from, data) => this.onNetMessage(from, data as NetInputMsg);
    const sky = this.world.def.sky;
    this.scene.fog = new THREE.Fog(sky.fog, 30, this.far);
    this.scene.add(new THREE.HemisphereLight(sky.hemiSky, sky.hemiGround, sky.hemiInt));
    const sun = new THREE.DirectionalLight(sky.sun, sky.sunInt);
    sun.position.set(...sky.sunPos);
    this.scene.add(sun);
    this.scene.add(this.world.group, this.fx.group);
    this.gloo = new Gloo(this.scene, this.world, this.fx);

    this.hud = new Hud(opts.root, this.mode);
    this.input = new Input(opts.canvas, this.hud.el);
    this.input.enabled = true;

    // A match can't actually be paused — bots/zone/net peers keep going either way —
    // so this menu only offers to leave; tap the pause button again to dismiss it.
    this.pauseEl = document.createElement('div');
    this.pauseEl.id = 'pausemenu';
    this.pauseEl.innerHTML = `<div class="pbox"><h2>MENU</h2><button class="btn-ghost" data-p="quit">SAIR DA PARTIDA</button></div>`;
    this.pauseEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
      if (!b) return;
      sfx.click();
      this.quit();
    });
    opts.root.appendChild(this.pauseEl);

    const watch = this.mode === 'watch';
    const p = new Actor(0, profile.name, 0, profile.hero, profile.outfit, true);
    this.player = p;
    if (!watch) this.actors.push(p);
    const names = makeNames(BR_PLAYERS);
    const mkBot = (team: number) => {
      const b = new Actor(this.actors.length + (watch ? 1 : 0), names.pop() || 'BOT', team, pick(HEROES).id, randomOutfit());
      b.ai = {
        target: null, lastSeen: new THREE.Vector3(), seenT: 0, think: Math.random() * 0.3, strafe: 1, strafeT: 0, react: 0,
        burst: 4, burstPause: 0, goal: null, goalT: 0, stuckT: 0, lastPos: new THREE.Vector3(), detour: 0, detourT: 0,
        crouchT: 0, gelT: 0, visible: false, passive: false, home: new THREE.Vector3(), skill: 0.85 + Math.random() * 0.3,
      };
      this.actors.push(b);
      return b;
    };

    if (this.mode === 'br' || watch) {
      const n = BR_PLAYERS - (watch ? 0 : 1);
      for (let i = 0; i < n; i++) mkBot(i + 1);
      this.plane = new Plane(this.world.radius, this.world.terrain.maxH + 75);
      this.scene.add(this.plane.group);
      for (const a of this.actors) {
        a.give(2, 'pistol', a.isPlayer ? profile.weaponSkins.pistol || 'default' : 'default');
        this.onPlane.add(a);
        a.rig.root.visible = false;
        if (!a.isPlayer) this.planBotDrop(a);
      }
      this.spawnLoot();
      this.setupZone();
      if (watch) {
        p.alive = false;
        this.spec = new Spectator(this, null, 'auto');
      }
    } else if (this.mode === 'squad') {
      this.setupArena();
      const netPlayers = (opts.netPlayers || []).slice(0, 7);
      const isRoom = !!opts.net;
      // The host is already team 0; split the other real people across both
      // teams as evenly as possible so a room of 2 is a 1v1, 4 is a 2v2, etc.
      const teamCount = [1, 0];
      for (let i = 0; i < netPlayers.length; i++) {
        const peer = netPlayers[i];
        const team = teamCount[1] < teamCount[0] ? 1 : teamCount[0] < teamCount[1] ? 0 : i % 2 === 0 ? 1 : 0;
        if (teamCount[team] >= 4) continue;
        const a = new Actor(this.actors.length, peer.name, team, pick(HEROES).id, randomOutfit());
        a.netId = peer.id;
        this.actors.push(a);
        this.netActorByPeer.set(peer.id, a);
        teamCount[team]++;
      }
      // Live rooms are real people only — no bots padding out the teams.
      if (!isRoom) {
        for (let i = teamCount[0]; i < 4; i++) mkBot(0);
        for (let i = teamCount[1]; i < 4; i++) mkBot(1);
      }
      for (const a of this.actors) {
        if (a.isPlayer) {
          a.give(0, profile.loadout[0], profile.weaponSkins[profile.loadout[0]] || 'default');
          a.give(1, profile.loadout[1], profile.weaponSkins[profile.loadout[1]] || 'default');
        } else {
          const ws = [...PRIMARY_IDS].sort(() => Math.random() - 0.5);
          a.give(0, ws[0]);
          a.give(1, ws[1]);
        }
        a.give(2, 'pistol', a.isPlayer ? profile.weaponSkins.pistol || 'default' : 'default');
        a.equip(0);
        this.respawn(a, true);
      }
    } else {
      p.give(0, profile.loadout[0], profile.weaponSkins[profile.loadout[0]] || 'default');
      p.give(1, profile.loadout[1], profile.weaponSkins[profile.loadout[1]] || 'default');
      p.give(2, 'pistol', profile.weaponSkins.pistol || 'default');
      p.equip(0);
      this.world.targets.forEach((t) => {
        const b = mkBot(1);
        b.ai!.passive = true;
        b.ai!.home.copy(t);
        b.give(0, 'ar');
        b.equip(0);
      });
      for (const a of this.actors) this.respawn(a, true);
    }
    this.total = this.actors.length;
    for (const a of this.actors) {
      this.scene.add(a.rig.root);
      a.rig.root.position.copy(a.pos);
    }
    if (this.mode !== 'train') {
      this.replay = new Replay(this.actors.length);
      this.gloo.onEvent = (e) => {
        this.replay?.gloo(this.time, e);
        this.net?.broadcast({ t: 'gloo', ...e });
      };
    }

    this.miniBase = this.world.paintMap(this.mode === 'train' ? 256 : 512);

    this.hud.banner(
      this.mode === 'br' ? 'EMBARQUE!' : this.mode === 'squad' ? 'CONTRA SQUAD' : watch ? 'MODO OBSERVADOR' : 'TREINO',
      this.mode === 'br' ? 'Salta do avião quando quiseres' : this.mode === 'squad' ? `${this.arena?.name} · primeira equipa a 25 abates` : watch ? '48 jogadores · câmaras de transmissão' : 'Prédio, armazém, gelo e alvos móveis',
      3,
    );
    this.onResize();
  }

  // =============================================================== setup helpers
  inPlane(a: Actor) {
    return this.onPlane.has(a);
  }

  private planBotDrop(a: Actor) {
    const pl = this.plane!;
    const land = this.world.pois.filter((p) => p.kind !== 'range');
    let tx: number, tz: number;
    // Most bots favour a POI near the flight path, but each already-chosen POI gets
    // steadily less appealing — otherwise everyone piles onto the one or two spots the
    // plane happens to fly over, and a third of the lobby dies in the first minute.
    const cap = Math.max(5, Math.ceil(this.actors.length / Math.max(2, land.length) * 1.3));
    if (Math.random() < 0.62 && land.length) {
      const weights = land.map((p) => {
        const crowd = this.poiLanded.get(p) || 0;
        if (crowd >= cap) return 0;
        const k = pl.progressNear(p.x, p.z);
        const pp = pl.pointAt(k, tA);
        const near = 1 / (1 + Math.hypot(pp.x - p.x, pp.z - p.z) / 60);
        return near / Math.pow(1 + crowd, 2.4);
      });
      let r = Math.random() * weights.reduce((s, x) => s + x, 0);
      let i = 0;
      while (r > weights[i] && i < weights.length - 1) r -= weights[i++];
      const p = land[i];
      this.poiLanded.set(p, (this.poiLanded.get(p) || 0) + 1);
      const ang = Math.random() * 6.28, rr = Math.random() * p.r;
      tx = p.x + Math.cos(ang) * rr;
      tz = p.z + Math.sin(ang) * rr;
    } else {
      const k = 0.15 + Math.random() * 0.7;
      const pp = pl.pointAt(k, tA);
      tx = pp.x + (Math.random() - 0.5) * 120;
      tz = pp.z + (Math.random() - 0.5) * 120;
    }
    // whichever branch picked it, never drop straight into an already-crowded POI
    for (const p of land) {
      if ((this.poiLanded.get(p) || 0) < cap) continue;
      const dx = tx - p.x, dz = tz - p.z, dd = Math.hypot(dx, dz);
      if (dd < p.r + 15) {
        const push = (p.r + 30) / Math.max(1, dd);
        tx = p.x + dx * push;
        tz = p.z + dz * push;
      }
    }
    const d = Math.hypot(tx, tz);
    if (d > this.world.radius - 25) {
      tx *= (this.world.radius - 25) / d;
      tz *= (this.world.radius - 25) / d;
    }
    this.landAt.set(a, new THREE.Vector3(tx, 0, tz));
    this.jumpAt.set(a, THREE.MathUtils.clamp(pl.progressNear(tx, tz) + (Math.random() - 0.5) * 0.08, 0.1, 0.9));
  }

  private jump(a: Actor) {
    if (!this.onPlane.has(a)) return;
    this.onPlane.delete(a);
    const pl = this.plane!;
    a.pos.copy(pl.pos).add(tA.set((Math.random() - 0.5) * 4, -4, (Math.random() - 0.5) * 4));
    a.vel.copy(pl.dir).multiplyScalar(8);
    a.yaw = Math.atan2(pl.dir.x, pl.dir.z);
    a.dropping = true;
    a.glide = false;
    a.onGround = false;
    a.rig.root.visible = true;
    a.rig.root.position.copy(a.pos);
    if (a.isPlayer) {
      sfx.click();
      this.toast('PARAQUEDAS: SALTAR / ESPAÇO');
    }
  }

  private setupArena() {
    const poi = pickArena(this.world) || this.world.pois[0];
    this.arena = poi;
    this.world.cx = poi.x;
    this.world.cz = poi.z;
    this.world.clampR = ARENA_R;
    const ang = this.world.R() * Math.PI * 2;
    for (const [list, s] of [[this.world.spawnsA, 1], [this.world.spawnsB, -1]] as const) {
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 4;
        const x = poi.x + Math.cos(ang) * 45 * s - Math.sin(ang) * off, z = poi.z + Math.sin(ang) * 45 * s + Math.cos(ang) * off;
        list.push(new THREE.Vector3(x, 0, z));
      }
    }
    this.zoneWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 60, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff4a6a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.zoneWall.position.set(poi.x, 20, poi.z);
    this.zoneWall.scale.set(ARENA_R, 1, ARENA_R);
    this.scene.add(this.zoneWall);
    this.zone.cx = poi.x;
    this.zone.cz = poi.z;
    this.zone.r = ARENA_R;
  }

  private respawn(a: Actor, initial = false) {
    let sp: THREE.Vector3;
    if (this.mode === 'squad') sp = pick(a.team === 0 ? this.world.spawnsA : this.world.spawnsB);
    else if (a.ai?.passive) sp = a.ai.home;
    else sp = this.world.spawnsA[0];
    a.pos.set(sp.x + (Math.random() - 0.5) * 3, 0, sp.z + (Math.random() - 0.5) * 3);
    a.pos.y = this.world.groundAt(a.pos.x, a.pos.z, 60);
    a.pos.y = this.world.resolve(a.pos, RADIUS, 1.8);
    a.vel.set(0, 0, 0);
    a.hp = 100;
    a.alive = true;
    if (this.mode === 'squad' && this.arena) a.yaw = Math.atan2(this.arena.x - a.pos.x, this.arena.z - a.pos.z);
    else a.yaw = Math.PI;
    a.rig.root.rotation.x = 0;
    a.rig.root.visible = true;
    a.reloadT = 0;
    a.healT = 0;
    a.lastAttacker = null;
    a.invulnT = initial ? 0 : 2;
    if (this.mode === 'squad') {
      a.armor = 2;
      a.meds = 3;
      a.gel = 5;
      a.nades = 1;
      for (const s of a.slots) if (s) s.mag = WEAPONS[s.id].mag;
    } else if (this.mode === 'train') {
      a.meds = a.gel = a.nades = 99;
    }
    if (a.ai) {
      a.ai.target = null;
      a.ai.goal = null;
      a.ai.seenT = 0;
    }
  }

  private spawnLoot() {
    const spots = [...this.world.loot];
    for (let i = 0; i < 150; i++) {
      const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (this.world.radius - 15);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (this.world.heightAt(x, z) > 1) spots.push(new THREE.Vector3(x, 0, z));
    }
    const wTable: WeaponId[] = ['smg', 'smg', 'ar', 'ar', 'ar', 'sg', 'sg', 'dmr', 'sr', 'lmg', 'smg', 'ar'];
    for (const s of spots) {
      if (Math.random() < 0.18) continue;
      const roll = Math.random();
      const p = s.clone();
      p.y = this.world.groundAt(p.x, p.z, p.y + 1);
      if (roll < 0.42) this.addLoot('weapon', p, 1, pick(wTable));
      else if (roll < 0.62) this.addLoot('med', p, 1 + ((Math.random() * 2) | 0));
      else if (roll < 0.76) this.addLoot('armor', p, Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3);
      else if (roll < 0.9) this.addLoot('gel', p, 3 + ((Math.random() * 3) | 0));
      else this.addLoot('nade', p, 1 + ((Math.random() * 2) | 0));
    }
  }

  private addLoot(kind: LootKind, pos: THREE.Vector3, n: number, wid?: WeaponId) {
    const g = new THREE.Group();
    let ring = 0xffffff;
    if (kind === 'weapon') {
      const w = weaponMesh(wid!);
      w.rotation.z = Math.PI / 2;
      w.scale.setScalar(1.4);
      w.position.y = 0.35;
      g.add(w);
      ring = [0, 0x9aa4b2, 0x3fa9ff, 0xb45cff, 0xffb81c][WEAPONS[wid!].tier];
    } else {
      const m = new THREE.Group();
      if (kind === 'med') {
        m.add(new THREE.Mesh(box(0.42, 0.3, 0.3), mat(0xf5f5f5)));
        m.add(new THREE.Mesh(box(0.2, 0.06, 0.31), mat(0xe5383b)), new THREE.Mesh(box(0.06, 0.2, 0.31), mat(0xe5383b)));
        ring = 0x2bd97c;
      } else if (kind === 'armor') {
        const col = [0, 0x6c8ca8, 0x8e5bd6, 0xe0a92e][n];
        m.add(new THREE.Mesh(box(0.45, 0.5, 0.18), mat(col)), new THREE.Mesh(box(0.3, 0.12, 0.2), mat(0x222222)));
        ring = col;
      } else if (kind === 'gel') {
        m.add(new THREE.Mesh(cyl(0.15, 0.15, 0.4, 8), mat(0x8fe3ff)), new THREE.Mesh(cyl(0.16, 0.16, 0.06, 8), mat(0x2b6f8a)));
        ring = 0x8fe3ff;
      } else {
        m.add(new THREE.Mesh(sphere(0.15, 8, 6), mat(0x5c8a3a)), new THREE.Mesh(box(0.08, 0.1, 0.08), mat(0x333333)).translateY(0.15));
        ring = 0xa3d977;
      }
      m.position.y = 0.4;
      g.add(m);
    }
    const r = new THREE.Mesh(ringGeo, glow(ring));
    r.position.y = 0.04;
    g.add(r);
    g.position.copy(pos);
    g.visible = false;
    this.scene.add(g);
    this.loot.push({ kind, wid, n, obj: g, pos: pos.clone(), alive: true, spin: Math.random() * 6 });
  }

  private removeLoot(l: Loot) {
    l.alive = false;
    this.scene.remove(l.obj);
  }

  private setupZone() {
    const z = this.zone;
    z.r = z.nr = this.world.radius * 1.2;
    this.zoneWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 120, 56, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4a7dff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.zoneWall.position.y = 40;
    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false, depthTest: false }));
    this.zoneRing.renderOrder = 5;
    this.scene.add(this.zoneWall, this.zoneRing);
    this.nextZone();
  }

  private nextZone() {
    const z = this.zone;
    z.phase++;
    const ph = ZONE_PHASES[z.phase];
    if (!ph) return;
    z.fr = z.r;
    z.fcx = z.cx;
    z.fcz = z.cz;
    z.nr = ph.r;
    const maxOff = z.phase === 0 ? this.world.radius - ph.r - 15 : z.r - ph.r;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(0, maxOff) * 0.85;
      z.ncx = z.cx + Math.cos(a) * d;
      z.ncz = z.cz + Math.sin(a) * d;
      if (this.world.heightAt(z.ncx, z.ncz) > 1) break;
    }
    z.t = 0;
    z.shrinking = false;
    z.dps = ph.dps;
  }

  // =============================================================== main loop
  update(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);
    if (this.input.take('pause') && !this.over) this.toggleMenu();
    if (this.input.take('map')) this.mapOpen = !this.mapOpen;
    this.fpsAcc += rawDt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.hud.fps(profile.settings.showFps ? Math.round(this.fpsN / this.fpsAcc) : null);
      this.fpsAcc = 0;
      this.fpsN = 0;
      if (this.net) {
        // Star topology: the host can have several guests, so show the worst (highest)
        // of their pings — that's the one affecting how stale anyone's view can get.
        const pings = this.net.peers().map((p) => p.ping).filter((p): p is number => p !== null);
        this.hud.netPing(profile.settings.showPing && pings.length ? Math.max(...pings) : null);
      }
    }

    if (this.replayOn) {
      this.updateReplay(dt);
      this.fx.update(dt);
      this.spec?.update(dt);
      this.world.updateVisibility(this.camera.position, this.far);
      this.hud.update(dt);
      this.drawMinimap();
      return;
    }

    this.time += dt;
    if (this.plane) this.updatePlane(dt);
    if (!this.spec) this.updatePlayer(dt);
    else this.input.take('jump');
    for (const a of this.actors) {
      if (this.onPlane.has(a)) continue;
      if (a.netId) this.updateNetActor(a, dt);
      else if (!a.isPlayer) this.updateBot(a, dt);
      this.updateActor(a, dt);
    }
    this.updateLoot(dt);
    this.gloo.update(dt);
    this.updateNades(dt);
    if (this.mode === 'br' || this.mode === 'watch') this.updateZone(dt);
    this.fx.update(dt);
    if (this.spec) this.spec.update(dt);
    else this.updateCamera(dt);
    this.world.updateVisibility(this.camera.position, (this.scene.fog as THREE.Fog).far);
    this.world.clouds.position.x = Math.sin(this.time * 0.01) * 30;
    this.updateHud(dt);
    this.replay?.record(dt, this.time, this.actors, this.plane && !this.plane.done ? this.plane.pos : null, (a) => this.onPlane.has(a));
    if (this.net) this.broadcastNet(dt);

    if (this.endT >= 0) {
      this.endT -= dt;
      if (this.endT < 0 && this.result) this.finish(this.result);
    }
    if (this.mode === 'squad' && !this.over && this.time >= 300) this.endMatch(this.scoreA > this.scoreB);
  }

  render() {
    this.opts.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** A match can't be paused — bots/zone/net peers keep going either way — this just shows/hides the exit menu. */
  private toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.pauseEl.classList.toggle('show', this.menuOpen);
    if (this.menuOpen) {
      this.input.reset();
      document.exitPointerLock?.();
    }
  }

  quit() {
    this.menuOpen = false;
    this.pauseEl.classList.remove('show');
    const r = { ...(this.result || this.makeResult(false)), quit: true };
    if (this.net && !this.over) this.net.broadcast(netEnd(r));
    this.finish(r);
  }

  private makeResult(win: boolean): MatchResult {
    const alive = this.actors.filter((a) => a.alive).length;
    const p = this.player;
    return {
      mode: this.mode,
      win,
      rank: this.mode === 'br' ? (win ? 1 : p.alive ? alive : alive + 1) : win ? 1 : 2,
      total: this.total,
      kills: p.kills,
      damage: Math.round(p.damage),
      time: this.time,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      quit: false,
    };
  }

  private endMatch(win: boolean, winner?: Actor) {
    if (this.over) return;
    this.over = true;
    if (!this.result) this.result = this.makeResult(win);
    if (winner) this.result.winner = winner.name;
    this.net?.broadcast(netEnd(this.result));
    this.endT = this.spec ? 5 : win ? 3 : 2.4;
    if (this.spec || this.mode === 'watch') {
      this.hud.banner('BOOYAH!', winner ? `CAMPEÃO: ${winner.name}` : 'Fim da partida', 4.5);
      if (winner && this.spec) this.spec.target = winner;
      sfx.booyah();
    } else if (win) {
      sfx.booyah();
      this.hud.banner(this.mode === 'br' ? 'BOOYAH!' : 'VITÓRIA!', this.mode === 'br' ? 'Último sobrevivente' : `${this.scoreA} - ${this.scoreB}`, 3);
    } else {
      this.hud.banner(this.mode === 'br' ? 'ELIMINADO' : 'DERROTA', this.mode === 'br' ? `#${this.result.rank} de ${this.total}` : `${this.scoreA} - ${this.scoreB}`, 3);
    }
    document.exitPointerLock?.();
  }

  private finish(r: MatchResult) {
    if (!this.input.enabled) return;
    this.input.enabled = false;
    this.opts.onEnd(r);
  }

  private toast(msg: string) {
    this.hud.center(msg);
    this.toastT = 1.6;
  }

  // =============================================================== spectate & replay
  enterSpectate(target: Actor | null) {
    this.deathEl?.remove();
    this.deathEl = null;
    if (!this.spec) this.spec = new Spectator(this, target, 'follow');
    else this.spec.target = target;
  }

  leaveSpectate() {
    if (this.mode === 'watch') return this.quit();
    this.finish(this.result || this.makeResult(false));
  }

  private showDeath(killer: Actor | null) {
    const r = this.result!;
    const el = document.createElement('div');
    el.id = 'deathbox';
    el.className = 'hud-ui';
    el.innerHTML = `<div class="db"><span>ELIMINADO POR</span><b>${esc(killer ? killer.name : 'ZONA')}</b><em>#${r.rank} de ${r.total} · ${r.kills} abates</em>
      <div class="dbtn"><button class="btn-ghost" data-d="replay">⟲ REPETIÇÃO</button><button class="btn-ghost" data-d="spec">◉ ESPECTAR</button><button class="btn-primary" data-d="exit">CONTINUAR</button></div></div>`;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      if (!b) return;
      sfx.click();
      if (b.dataset.d === 'exit') this.finish(r);
      else if (b.dataset.d === 'spec') this.enterSpectate(killer && killer.alive ? killer : null);
      else {
        this.enterSpectate(this.player);
        this.startReplay(this.player, 0.5);
      }
    });
    this.hud.el.appendChild(el);
    this.deathEl = el;
    document.exitPointerLock?.();
  }

  replayRange(): [number, number] {
    return [this.replayA, this.replayB];
  }

  startReplay(focus: Actor | null, speed = 1) {
    if (!this.replay || this.replay.newest - this.replay.oldest < 1) return;
    if (!this.spec) this.enterSpectate(focus);
    this.replayOn = true;
    this.replayB = this.replay.newest;
    this.replayA = Math.max(this.replay.oldest, this.replayB - 12);
    this.replayT = this.replayPrev = this.replayA;
    this.replaySpeed = speed;
    this.replayPaused = false;
    if (focus && this.spec) {
      this.spec.target = focus;
      if (this.spec.mode === 'auto') this.spec.setMode('follow');
    }
    this.hud.banner('REPETIÇÃO', 'Últimos segundos da partida', 1.4);
  }

  seekReplay(frac: number) {
    this.replayT = this.replayA + (this.replayB - this.replayA) * THREE.MathUtils.clamp(frac, 0, 1);
    this.replayPrev = this.replayT;
  }

  stopReplay() {
    if (!this.replayOn) return;
    this.replayOn = false;
    this.gloo.showReplay(null);
    for (const a of this.actors) {
      a.rig.root.visible = !this.onPlane.has(a) && (a.alive || a.deathT < 4 || this.mode === 'squad');
      a.rig.root.position.copy(a.pos);
      a.rig.root.rotation.y = a.yaw;
    }
    if (this.plane) {
      this.plane.group.visible = !this.plane.done;
      this.plane.group.position.copy(this.plane.pos);
    }
  }

  private updateReplay(dt: number) {
    const r = this.replay!;
    if (!this.replayPaused) this.replayT += dt * this.replaySpeed;
    if (this.replayT >= this.replayB) {
      this.stopReplay();
      return;
    }
    const t = this.replayT;
    const sdt = this.replayPaused ? 0 : dt * this.replaySpeed;
    const s = this.snap;
    this.actors.forEach((a, i) => {
      r.sample(t, i, s);
      const rig = a.rig;
      const inPl = (s.flags & FL.plane) !== 0;
      const alive = (s.flags & FL.alive) !== 0;
      rig.root.visible = !inPl;
      if (inPl) return;
      rig.root.position.set(s.x, s.y, s.z);
      rig.root.rotation.y = s.yaw;
      rig.root.rotation.x = alive ? 0 : -Math.PI / 2;
      const dropping = (s.flags & FL.dropping) !== 0;
      rig.setChute(dropping && (s.flags & FL.glide) !== 0);
      if (s.weapon !== rig.weaponId) {
        const slot = a.slots.find((x) => x?.id === s.weapon);
        rig.setWeapon(s.weapon, slot?.skin || 'default');
      }
      if (alive && rig.root.position.distanceTo(this.camera.position) < this.far)
        rig.update(sdt, { speed: s.speed, crouch: (s.flags & FL.crouch) !== 0, air: (s.flags & FL.ground) === 0, pitch: s.pitch, reload: 0, glide: dropping, dead: false, vx: s.vx, vz: s.vz }, this.world.heightAt(s.x, s.z));
    });
    if (this.plane) {
      const pp = r.planeAt(t);
      this.plane.group.visible = !!pp;
      if (pp) this.plane.group.position.set(pp[0], pp[1], pp[2]);
    }
    const from = this.replayPrev;
    if (t > from) {
      for (const e of r.shots) if (e.t > from && e.t <= t) this.fx.tracer(tA.set(...e.a), tB.set(...e.b), e.color);
      for (const e of r.booms) if (e.t > from && e.t <= t) this.fx.blast(tA.set(...e.p), 4.5);
      for (const e of r.kills)
        if (e.t > from && e.t <= t) {
          const [k, w, v] = e.text.split('|');
          this.hud.kill(k, v, w, false, false, 0);
        }
    }
    this.replayPrev = t;
    this.gloo.showReplay(r.glooAt(t));
  }

  // =============================================================== plane
  private updatePlane(dt: number) {
    const pl = this.plane!;
    if (pl.done) return;
    const k = pl.update(dt);
    for (const a of [...this.onPlane]) {
      a.pos.copy(pl.pos);
      if (!a.isPlayer && k >= (this.jumpAt.get(a) ?? 0.5)) this.jump(a);
    }
    if (k > 0.96) for (const a of [...this.onPlane]) this.jump(a);
    if (pl.done) pl.group.visible = false;
  }

  // =============================================================== player
  private camFwd(out: THREE.Vector3) {
    const p = this.player;
    return out.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch));
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const inp = this.input;
    inp.poll();
    const [lx, ly] = inp.consumeLook();
    const w = p.weapon;
    const def = w ? WEAPONS[w.id] : null;
    const ads = inp.ads && !!def && !p.dropping && p.alive && !this.onPlane.has(p);
    const sens = (0.0009 + profile.settings.sens * 0.00042) * (ads && def ? def.adsFov / 72 : 1);
    if (p.alive) {
      p.yaw -= lx * sens;
      p.pitch = THREE.MathUtils.clamp(p.pitch - ly * sens, -1.25, 1.15);
    }
    if (this.onPlane.has(p)) {
      if (inp.take('jump') || inp.take('pickup')) this.jump(p);
      return;
    }
    if (!p.alive || this.over) {
      p.vel.x *= 0.9;
      p.vel.z *= 0.9;
      return;
    }

    this.assist = this.findAssist();
    if (this.assist && inp.fire && profile.settings.aimAssist > 0) {
      const t = this.assist.head ? this.assist.a.headPos(tA) : this.assist.a.chestPos(tA);
      tB.copy(this.camera.position);
      const dx = t.x - tB.x, dy = t.y - tB.y, dz = t.z - tB.z;
      const k = Math.min(1, dt * (2 + profile.settings.aimAssist * 2.2));
      p.yaw += angDiff(Math.atan2(dx, dz), p.yaw) * k;
      p.pitch += (Math.atan2(dy, Math.hypot(dx, dz)) - p.pitch) * k * 0.7;
    }

    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = -fz, rz = fx;
    const wx = fx * inp.my + rx * inp.mx;
    const wz = fz * inp.my + rz * inp.mx;

    if (p.dropping) {
      if (inp.take('jump') && !p.glide) this.openChute(p);
      if (!p.glide && p.pos.y - p.ground < 38) this.openChute(p);
      const hs = p.glide ? 9 : 17;
      p.vel.x += (wx * hs - p.vel.x) * Math.min(1, dt * 3);
      p.vel.z += (wz * hs - p.vel.z) * Math.min(1, dt * 3);
      return;
    }

    if (inp.take('crouch')) p.crouch = !p.crouch;
    if (inp.crouchHold) p.crouch = true;
    if (inp.take('jump') && p.onGround) {
      p.vel.y = JUMP;
      p.onGround = false;
      p.crouch = false;
      p.healT = 0;
    }
    let speed = SPEED * (def ? def.moveMul : 1);
    if (p.crouch) speed *= 0.45;
    if (ads) speed *= 0.65;
    if (p.furyT > 0) speed *= 1.2;
    if (p.healT > 0) speed *= 0.4;
    if (p.pos.y < -0.4) speed *= 0.6;
    if (p.dashT <= 0) {
      const tx = wx * speed, tz = wz * speed;
      const speeding = tx * tx + tz * tz > p.vel.x * p.vel.x + p.vel.z * p.vel.z;
      const acc = p.onGround ? (speeding ? 9 : 13) : 3.5;
      p.vel.x += (tx - p.vel.x) * Math.min(1, dt * acc);
      p.vel.z += (tz - p.vel.z) * Math.min(1, dt * acc);
    }

    for (let i = 0; i < 3; i++) if (inp.take(`slot${i}` as 'slot0')) this.switchTo(p, i);
    if (inp.take('swap')) {
      for (let k = 1; k <= 3; k++) {
        const i = (p.cur + k) % 3;
        if (p.slots[i]) {
          this.switchTo(p, i);
          break;
        }
      }
    }
    if (inp.take('reload')) this.startReload(p);
    if (p.glooCd <= 0 && inp.take('gel')) this.throwGloo(p, p.yaw);
    if (inp.take('nade')) this.throwNade(p, this.camFwd(tA));
    if (inp.take('heal')) this.startHeal(p);
    if (inp.take('ability')) this.useAbility(p);
    const pickup = inp.take('pickup');

    if (inp.fire) {
      if (p.healT > 0) p.healT = 0;
      this.playerShoot(ads);
    } else this.semiLatch = false;

    let near: Loot | null = null;
    let nd = 2.0;
    for (const l of this.loot) {
      if (!l.alive) continue;
      const dx = l.pos.x - p.pos.x, dz = l.pos.z - p.pos.z;
      if (Math.abs(dx) > 2 || Math.abs(dz) > 2 || Math.abs(l.pos.y - p.pos.y) > 1.6) continue;
      const d = Math.hypot(dx, dz);
      if (l.kind !== 'weapon') {
        if (d < 1.5) this.takeItem(p, l);
        continue;
      }
      if (d < nd) {
        nd = d;
        near = l;
      }
    }
    if (near) {
      this.hud.prompt(`PEGAR ${WEAPONS[near.wid!].name}`);
      if (pickup) this.takeWeapon(p, near);
    } else this.hud.prompt(null);
  }

  private switchTo(a: Actor, i: number) {
    if (a.equip(i) && a.isPlayer) sfx.click();
  }

  private findAssist(): { a: Actor; head: boolean } | null {
    const lvl = profile.settings.aimAssist;
    const p = this.player;
    const w = p.weapon;
    if (!w || lvl <= 0) return null;
    const cone = [0, 0.04, 0.07, 0.1][lvl];
    const cam = this.camera.position;
    const f = this.camFwd(tC);
    let best: Actor | null = null;
    let bestA = cone;
    let head = false;
    const range = WEAPONS[w.id].range;
    for (const e of this.actors) {
      if (!e.alive || e.team === p.team || e.dropping || this.onPlane.has(e)) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > range) continue;
      e.chestPos(tA).sub(cam);
      const len = tA.length();
      const ang = Math.acos(THREE.MathUtils.clamp(tA.dot(f) / len, -1, 1));
      const allowed = cone * (1 + 4 / Math.max(2, d));
      if (ang > allowed || ang > bestA * (1 + 4 / Math.max(2, d))) continue;
      tA.divideScalar(len);
      if (this.world.raycast(cam, tA, len) < len - 0.4) continue;
      best = e;
      bestA = ang;
      e.headPos(tB).sub(cam).normalize();
      head = Math.acos(THREE.MathUtils.clamp(tB.dot(f), -1, 1)) < allowed * 0.55;
    }
    return best ? { a: best, head } : null;
  }

  private playerShoot(ads: boolean) {
    const p = this.player;
    const w = p.weapon;
    if (!w || p.dropping) return;
    const def = WEAPONS[w.id];
    if (p.reloadT > 0) return;
    if (w.mag <= 0) {
      if (!this.semiLatch) sfx.empty();
      this.semiLatch = true;
      this.startReload(p);
      return;
    }
    if (p.cd > 0) return;
    if (!def.auto && this.semiLatch) return;
    this.semiLatch = true;
    p.cd = def.interval * (p.furyT > 0 ? 0.65 : 1);
    w.mag--;
    const cam = this.camera.position;
    const fwd = this.camFwd(tC).clone();
    const moving = Math.hypot(p.vel.x, p.vel.z) > 1.5;
    let spread = (ads ? def.adsSpread : def.spread) * (p.crouch ? 0.7 : 1) * (moving ? 1.35 : 1) * (p.onGround ? 1 : 1.8);
    const t0 = Math.max(0, tA.copy(p.pos).setY(p.pos.y + 1.4).sub(cam).dot(fwd) - 0.3);
    const as = this.assist && profile.settings.aimAssist > 0 ? this.assist : null;
    let aimDir: THREE.Vector3 | null = null;
    if (as) {
      const tp = as.head || Math.random() < 0.2 ? as.a.headPos(tA) : as.a.chestPos(tA);
      aimDir = tp.sub(cam).normalize().clone();
      spread *= 0.55;
    }
    const muzzle = p.rig.muzzleWorld(tD).clone();
    for (let i = 0; i < def.pellets; i++) {
      const d = fwd.clone();
      if (aimDir) d.lerp(aimDir, def.pellets > 1 ? 0.7 : 0.88).normalize();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * 2 * spread;
        d.y += (Math.random() - 0.5) * 2 * spread;
        d.z += (Math.random() - 0.5) * 2 * spread;
        d.normalize();
      }
      this.fireRay(p, cam, d, def, t0, muzzle, i === 0 || i % 3 === 0);
    }
    p.pitch += def.recoil * (ads ? 0.45 : 0.8);
    p.yaw += (Math.random() - 0.5) * def.recoil * 0.6;
    p.rig.kick = 1;
    p.firedT = 1.5;
    this.fx.flash(muzzle, fwd, w.id === 'sg' || w.id === 'sr' ? 1.4 : 1);
    sfx.shot(w.id, 0.9);
    this.shake = Math.max(this.shake, def.recoil * 6);
    if (w.mag === 0) setTimeout(() => this.startReload(p), 220);
  }

  private fireRay(s: Actor, o: THREE.Vector3, d: THREE.Vector3, def: WeaponDef, t0: number, muzzle: THREE.Vector3, tracer: boolean) {
    const maxT = def.range * 1.25;
    const o2 = tB.copy(o).addScaledVector(d, t0);
    const tw = t0 + this.world.raycast(o2, d, maxT - t0);
    const wall = this.world.hitWall;
    let best = tw;
    let victim: Actor | null = null;
    let head = false;
    for (const e of this.actors) {
      if (!e.alive || e.team === s.team || e.dropping || this.onPlane.has(e)) continue;
      tA.copy(e.pos).sub(o);
      const along = tA.dot(d);
      if (along < t0 || along > best + 1) continue;
      if (tA.lengthSq() - along * along > 4) continue;
      const t = e.rayHit(o, d, 0);
      if (t > t0 && t < best) {
        best = t;
        victim = e;
        head = e.lastHead;
      }
    }
    const hit = tC.copy(o).addScaledVector(d, Math.min(best, maxT));
    if (tracer) {
      this.fx.tracer(muzzle, hit, 0xffe28a);
      this.replay?.shot(this.time, muzzle, hit, 0xffe28a);
      this.net?.broadcast(netShot(muzzle, hit));
    }
    if (victim) {
      const dist = s.pos.distanceTo(victim.pos);
      const fall = dist > def.range * 0.5 ? THREE.MathUtils.lerp(1, 0.55, Math.min(1, (dist - def.range * 0.5) / (def.range * 0.5))) : 1;
      this.hurt(victim, def.dmg * (head ? def.head : 1) * fall * (s.furyT > 0 ? 1.1 : 1), s, head, def.name);
      this.fx.burst(hit, head ? 0xffd34d : 0xff3b3b, 5, 3, 0.07);
    } else if (best < maxT) {
      if (wall && best === tw) this.gloo.damage(wall, def.dmg);
      this.fx.burst(hit, wall && best === tw ? 0xbff3ff : 0xd8c8a8, 3, 2.5, 0.06);
    }
  }

  // =============================================================== networked players (room host side)
  private onNetMessage(from: string, data: NetInputMsg) {
    if (data.t === 'input') this.netInputs.set(from, data);
  }

  private updateNetActor(a: Actor, dt: number) {
    const net = a.netId ? this.netInputs.get(a.netId) : null;
    if (!net) return;
    a.yaw = net.yaw;
    a.pitch = THREE.MathUtils.clamp(net.pitch, -1.25, 1.15);
    if (!a.alive || this.over) {
      a.vel.x *= 0.9;
      a.vel.z *= 0.9;
      return;
    }
    const w = a.weapon;
    const def = w ? WEAPONS[w.id] : null;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    const rx = -fz, rz = fx;
    const wx = fx * net.my + rx * net.mx, wz = fz * net.my + rz * net.mx;
    if (net.jump) a.crouch = false;
    if (net.jump && a.onGround) a.vel.y = JUMP;
    a.crouch = net.crouch && a.onGround;
    let speed = SPEED * (def ? def.moveMul : 1);
    if (a.crouch) speed *= 0.45;
    if (net.ads) speed *= 0.65;
    if (a.furyT > 0) speed *= 1.2;
    if (a.healT > 0) speed *= 0.4;
    if (a.dashT <= 0) {
      const tx = wx * speed, tz = wz * speed;
      const acc = a.onGround ? 11 : 3.5;
      a.vel.x += (tx - a.vel.x) * Math.min(1, dt * acc);
      a.vel.z += (tz - a.vel.z) * Math.min(1, dt * acc);
    }
    if (net.slot >= 0 && net.slot <= 2) this.switchTo(a, net.slot);
    if (net.reload) this.startReload(a);
    if (a.glooCd <= 0 && net.gel) this.throwGloo(a, a.yaw);
    if (net.nade) this.throwNade(a, netFwd(a.yaw, a.pitch, tA));
    if (net.heal) this.startHeal(a);
    if (net.ability) this.useAbility(a);
    if (net.fire) {
      if (a.healT > 0) a.healT = 0;
      this.netShoot(a, net.ads);
    } else a.semiLatch = false;

    if (net.pickup) {
      for (const l of this.loot) {
        if (!l.alive) continue;
        const dx = l.pos.x - a.pos.x, dz = l.pos.z - a.pos.z;
        if (Math.abs(dx) > 2 || Math.abs(dz) > 2 || Math.abs(l.pos.y - a.pos.y) > 1.6) continue;
        const d = Math.hypot(dx, dz);
        if (l.kind !== 'weapon') {
          if (d < 1.5) this.takeItem(a, l);
        } else if (d < 2) this.takeWeapon(a, l);
      }
    }
  }

  private netShoot(a: Actor, ads: boolean) {
    const w = a.weapon;
    if (!w || a.dropping || !a.alive) return;
    const def = WEAPONS[w.id];
    if (a.reloadT > 0) return;
    if (w.mag <= 0) {
      a.semiLatch = true;
      this.startReload(a);
      return;
    }
    if (a.cd > 0) return;
    if (!def.auto && a.semiLatch) return;
    a.semiLatch = true;
    a.cd = def.interval * (a.furyT > 0 ? 0.65 : 1);
    w.mag--;
    const muzzle = a.rig.muzzleWorld(tD).clone();
    const fwd = netFwd(a.yaw, a.pitch, tC);
    const spread = (ads ? def.adsSpread : def.spread) * (a.crouch ? 0.7 : 1) * (a.onGround ? 1 : 1.8);
    for (let i = 0; i < def.pellets; i++) {
      const d = fwd.clone();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * 2 * spread;
        d.y += (Math.random() - 0.5) * 2 * spread;
        d.z += (Math.random() - 0.5) * 2 * spread;
        d.normalize();
      }
      this.fireRay(a, muzzle, d, def, 0, muzzle, i === 0 || i % 3 === 0);
    }
    a.rig.kick = 1;
    a.firedT = 1.5;
    this.fx.flash(muzzle, fwd, w.id === 'sg' || w.id === 'sr' ? 1.4 : 1);
    const dc = muzzle.distanceTo(this.camera.position);
    if (dc < this.far) sfx.shot(w.id, Math.max(0.1, 1 - dc / this.far) * 0.8);
    if (w.mag === 0) setTimeout(() => this.startReload(a), 220);
  }

  private broadcastNet(dt: number) {
    this.netAcc += dt;
    if (this.netAcc < 1 / 15) return;
    this.netAcc = 0;
    const actors: NetActorSnap[] = [];
    for (const a of this.actors) {
      if (this.onPlane.has(a)) continue;
      actors.push({
        id: a.id, name: a.name, team: a.team, x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw, pitch: a.pitch,
        hp: a.hp, armor: a.armor, alive: a.alive, weapon: a.weapon?.id ?? null, mag: a.weapon?.mag ?? 0,
        slots: a.slots.map((s) => (s ? { id: s.id, mag: s.mag } : null)), cur: a.cur, reloading: a.reloadT > 0,
        meds: a.meds, gel: a.gel, nades: a.nades,
        crouch: a.crouch, onGround: a.onGround, dropping: a.dropping, glide: a.glide, speed: a.speedNow, vx: a.vel.x, vz: a.vel.z,
      });
    }
    this.net!.broadcast(netSnap(this.time, this.scoreA, this.scoreB, actors));
  }

  // =============================================================== shared actions
  private startReload(a: Actor) {
    const w = a.weapon;
    if (!w || a.reloadT > 0 || w.mag >= WEAPONS[w.id].mag) return;
    a.reloadT = WEAPONS[w.id].reload;
    if (a.isPlayer) sfx.reload();
  }

  private startHeal(a: Actor) {
    if (a.meds <= 0 || a.hp >= 100 || a.healT > 0) return;
    a.healT = 2.2;
    if (a.isPlayer) sfx.click();
  }

  private openChute(a: Actor) {
    a.glide = true;
    a.rig.setChute(true);
  }

  private useAbility(a: Actor) {
    if (a.abilityCd > 0 || !a.alive || a.dropping) return;
    const ab = a.hero.ability;
    a.abilityCd = ab.cd;
    switch (ab.id) {
      case 'dash': {
        let dx = a.vel.x, dz = a.vel.z;
        const l = Math.hypot(dx, dz);
        if (l < 0.5) {
          dx = Math.sin(a.yaw);
          dz = Math.cos(a.yaw);
        } else {
          dx /= l;
          dz /= l;
        }
        a.vel.x = dx * 24;
        a.vel.z = dz * 24;
        a.vel.y = Math.max(a.vel.y, 2.5);
        a.dashT = 0.22;
        this.fx.burst(tA.copy(a.pos).setY(a.pos.y + 1), 0x5ce1ff, 14, 3, 0.1, 2, 0.4);
        break;
      }
      case 'heal':
        a.hotT = 3;
        this.fx.burst(tA.copy(a.pos).setY(a.pos.y + 1), 0x2bd97c, 16, 2.5, 0.1, -3, 0.8);
        break;
      case 'shield':
        a.shieldT = 5;
        break;
      case 'reveal':
        a.revealT = 7;
        break;
      case 'fury':
        a.furyT = 6;
        this.fx.burst(tA.copy(a.pos).setY(a.pos.y + 1), 0xff5a1f, 16, 3, 0.1, -2, 0.6);
        break;
    }
    if (a.isPlayer) {
      sfx.ability();
      this.toast(ab.name);
    }
  }

  private throwGloo(a: Actor, yaw: number) {
    if (a.gel <= 0 || a.dropping || !a.alive || a.glooCd > 0) return;
    a.gel--;
    a.glooCd = 0.22;
    const skin = a.isPlayer ? profile.gloo || 'classic' : a.id % 5 === 0 ? pick(['lava', 'rose', 'toxic', 'galaxy', 'gold']) : 'classic';
    // distance: where the crosshair meets the ground (player) or a fixed step toward the threat (bots)
    let d = 2.4;
    if (a.isPlayer && !this.spec) {
      const cam = this.camera.position;
      const f = this.camFwd(tA);
      const t = this.world.raycast(cam, f, 14);
      const hx = cam.x + f.x * t - a.pos.x, hz = cam.z + f.z * t - a.pos.z;
      d = t < 14 ? Math.hypot(hx, hz) : 4.5;
    }
    d = THREE.MathUtils.clamp(d, 1.6, 4.5);
    // never through walls: stop just before the first obstacle at chest height
    const dir = tB.set(Math.sin(yaw), 0, Math.cos(yaw));
    const block = this.world.raycast(tC.set(a.pos.x, a.pos.y + 1.0, a.pos.z), dir, d + 0.6);
    if (block < d + 0.6) d = Math.max(1.1, block - 0.6);
    const x = a.pos.x + dir.x * d, z = a.pos.z + dir.z * d;
    const audible = a.pos.distanceTo(this.camera.position) < 60;
    this.gloo.place(x, z, this.world.groundAt(x, z, a.pos.y + 1.2), yaw, skin, a.team, audible);
    a.rig.kick = 0.6;
  }

  private throwNade(a: Actor, dir: THREE.Vector3, power = 17) {
    if (a.nades <= 0 || a.dropping || !a.alive) return;
    a.nades--;
    const pos = a.headPos(new THREE.Vector3()).addScaledVector(dir, 0.6);
    const vel = dir.clone().multiplyScalar(power).addScaledVector(UP, 4);
    const mesh = new THREE.Mesh(this.nadeGeo, mat(0x5c8a3a));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.nades.push({ mesh, pos, vel, fuse: 1.8, owner: a });
    if (a.isPlayer) sfx.click();
  }

  private takeItem(a: Actor, l: Loot) {
    let took = '';
    if (l.kind === 'med' && a.meds < 6) {
      a.meds = Math.min(6, a.meds + l.n);
      took = `+${l.n} KIT MÉDICO`;
    } else if (l.kind === 'gel' && a.gel < 10) {
      a.gel = Math.min(10, a.gel + l.n);
      took = `+${l.n} GELO`;
    } else if (l.kind === 'nade' && a.nades < 4) {
      a.nades = Math.min(4, a.nades + l.n);
      took = `+${l.n} GRANADA`;
    } else if (l.kind === 'armor' && l.n > a.armor) {
      a.armor = l.n;
      took = `COLETE NÍVEL ${l.n}`;
    }
    if (!took) return;
    this.removeLoot(l);
    if (a.isPlayer) {
      sfx.pickup();
      this.toast(took);
    }
  }

  private takeWeapon(a: Actor, l: Loot) {
    const id = l.wid!;
    const has = a.slots.findIndex((s) => s?.id === id);
    if (has >= 0) {
      a.slots[has]!.mag = WEAPONS[id].mag;
      this.removeLoot(l);
      if (a.isPlayer) {
        sfx.pickup();
        this.toast(`MUNIÇÃO ${WEAPONS[id].name}`);
      }
      return;
    }
    const slot = !a.slots[0] ? 0 : !a.slots[1] ? 1 : a.cur < 2 ? a.cur : 0;
    const old = a.slots[slot];
    if (old) this.addLoot('weapon', a.pos.clone(), 1, old.id);
    this.removeLoot(l);
    a.slots[slot] = null;
    a.give(slot, id, a.isPlayer ? profile.weaponSkins[id] || 'default' : 'default');
    a.equip(slot);
    if (a.isPlayer) {
      sfx.pickup();
      this.toast(`${WEAPONS[id].name} EQUIPADA`);
    }
  }

  hurt(v: Actor, dmg: number, by: Actor | null, head: boolean, label: string) {
    if (!v.alive || v.invulnT > 0 || v.dropping) return;
    if (this.mode === 'train' && v.isPlayer) return;
    let d = dmg * (1 - ARMOR_RED[v.armor]);
    if (v.shieldT > 0) d *= 0.45;
    v.hp -= d;
    v.heat = Math.min(5, v.heat + 0.6);
    if (by) {
      by.damage += d;
      by.heat = Math.min(5, by.heat + 0.5);
      v.lastAttacker = by;
    }
    if (v.isPlayer) {
      sfx.hurt();
      this.shake = Math.max(this.shake, 0.25);
      if (by) {
        const dx = by.pos.x - v.pos.x, dz = by.pos.z - v.pos.z;
        const fwd = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw);
        const right = -dx * Math.cos(v.yaw) + dz * Math.sin(v.yaw);
        this.hud.hurtDir(Math.atan2(right, fwd));
      }
    }
    if (v.ai && by && by !== v) {
      if (!v.ai.target || !v.ai.visible || Math.random() < 0.3) {
        v.ai.target = by;
        v.ai.lastSeen.copy(by.pos);
        v.ai.seenT = 3;
      }
    }
    const killed = v.hp <= 0;
    if (by?.isPlayer && !this.spec) {
      sfx.hit(head);
      this.hud.hit(head, killed);
      const s = this.project(v.headPos(tA).setY(tA.y + 0.3));
      if (s) this.hud.damagePop(s.x, s.y, d, head);
    }
    if (killed) this.die(v, by, head, label);
  }

  private die(v: Actor, by: Actor | null, head: boolean, label: string) {
    v.alive = false;
    v.hp = 0;
    v.deathT = 0;
    v.healT = 0;
    v.reloadT = 0;
    v.crouch = false;
    v.shieldT = v.furyT = v.hotT = 0;
    if (by && by !== v) {
      by.kills++;
      by.heat = 5;
    }
    const p = this.player;
    const allyRel = v.team === p.team ? -1 : by && by.team === p.team ? 1 : 0;
    this.hud.kill(by ? by.name : 'ZONA', v.name, label, head, v.isPlayer || !!by?.isPlayer, this.mode === 'squad' ? allyRel : 0);
    this.replay?.kill(this.time, `${by ? by.name : 'ZONA'}|${label}|${v.name}`);
    this.net?.broadcast(netKill(by ? by.name : 'ZONA', v.name, label));
    this.fx.burst(v.chestPos(tA), 0xff3b3b, 14, 4, 0.1);
    if (by?.isPlayer && v !== by) {
      sfx.kill();
      this.streak = this.streakT > 0 ? this.streak + 1 : 1;
      this.streakT = 4;
      const labels = ['', 'ABATE', 'ABATE DUPLO', 'ABATE TRIPLO', 'MASSACRE', 'IMPARÁVEL'];
      this.hud.banner(labels[Math.min(5, this.streak)], `${v.name}${head ? ' · TIRO NA CABEÇA' : ''}`, 1.4);
    }

    if (this.mode === 'br' || this.mode === 'watch') {
      for (let i = 0; i < 2; i++) {
        const s = v.slots[i];
        if (s) this.addLoot('weapon', tA.copy(v.pos).add(tB.set(Math.random() - 0.5, 0, Math.random() - 0.5)).clone(), 1, s.id);
      }
      if (v.meds > 0) this.addLoot('med', tA.copy(v.pos).add(tB.set(0.8, 0, 0.5)).clone(), Math.min(3, v.meds));
      if (v.gel > 0) this.addLoot('gel', tA.copy(v.pos).add(tB.set(-0.7, 0, 0.6)).clone(), Math.min(5, v.gel));
      if (v.armor > 0) this.addLoot('armor', tA.copy(v.pos).add(tB.set(0.2, 0, -0.9)).clone(), v.armor);
      const alive = this.actors.filter((a) => a.alive);
      if (v.isPlayer && this.mode === 'br') {
        this.result = this.makeResult(false);
        this.hud.banner('ELIMINADO', `#${this.result.rank} de ${this.total}`, 2);
        setTimeout(() => {
          if (!this.over && !this.spec && this.input.enabled) this.showDeath(by);
        }, 1200);
      }
      if (alive.length <= 1) this.endMatch(!!alive[0]?.isPlayer, alive[0]);
      else if (!this.spec && p.alive) this.toast(`${alive.length} VIVOS`);
    } else if (this.mode === 'squad') {
      if (by && by !== v) {
        if (by.team === 0) this.scoreA++;
        else this.scoreB++;
      } else if (v.team === 0) this.scoreB++;
      else this.scoreA++;
      v.respawnT = 3.5;
      if (this.scoreA >= 25 || this.scoreB >= 25) this.endMatch(this.scoreA >= 25);
    } else {
      v.respawnT = 2;
    }
  }

  // =============================================================== physics & rig
  private updateActor(a: Actor, dt: number) {
    const rig = a.rig;
    a.heat = Math.max(0, a.heat - dt * 0.35);
    if (!a.alive) {
      a.deathT += dt;
      rig.root.rotation.x = Math.max(-Math.PI / 2, -a.deathT * 5);
      if (this.mode !== 'squad' && this.mode !== 'train' && a.deathT > 4) rig.root.visible = false;
      if (a.respawnT > 0 && !this.over) {
        a.respawnT -= dt;
        if (a.respawnT <= 0) this.respawn(a);
      }
      a.vel.set(0, a.vel.y - GRAV * dt, 0);
      a.pos.y = Math.max(a.ground, a.pos.y + a.vel.y * dt);
      rig.root.position.copy(a.pos);
      if (a.aura) {
        rig.root.remove(a.aura);
        a.aura = null;
      }
      return;
    }
    a.cd = Math.max(0, a.cd - dt);
    a.abilityCd = Math.max(0, a.abilityCd - dt);
    a.invulnT = Math.max(0, a.invulnT - dt);
    a.firedT = Math.max(0, a.firedT - dt);
    a.revealT = Math.max(0, a.revealT - dt);
    a.furyT = Math.max(0, a.furyT - dt);
    a.dashT = Math.max(0, a.dashT - dt);
    a.glooCd = Math.max(0, a.glooCd - dt);
    if (a.shieldT > 0) a.shieldT -= dt;
    if (a.hotT > 0) {
      a.hotT -= dt;
      a.hp = Math.min(100, a.hp + 15 * dt);
    }
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0 && a.weapon) a.weapon.mag = WEAPONS[a.weapon.id].mag;
    }
    if (a.healT > 0) {
      a.healT -= dt;
      if (a.healT <= 0) {
        a.meds--;
        a.hp = Math.min(100, a.hp + 55);
        if (a.isPlayer) {
          sfx.pickup();
          this.toast('+55 VIDA');
        }
      }
    }

    const wantAura = a.shieldT > 0;
    if (wantAura && !a.aura) {
      a.aura = new THREE.Mesh(this.auraGeo, this.auraMat);
      a.aura.position.y = 0.95;
      rig.root.add(a.aura);
    } else if (!wantAura && a.aura) {
      rig.root.remove(a.aura);
      a.aura = null;
    }

    a.vel.y -= GRAV * dt;
    if (a.dropping) a.vel.y = a.glide ? -6.5 : Math.max(a.vel.y, -30);
    a.pos.addScaledVector(a.vel, dt);
    const g = this.world.resolve(a.pos, RADIUS, a.height, a.vel.y);
    if (this.world.ceil && a.vel.y > 0) a.vel.y = 0;
    a.ground = g;
    if (a.pos.y <= g + 0.001) {
      a.pos.y = g;
      if (a.vel.y < 0) a.vel.y = 0;
      a.onGround = true;
      if (a.dropping) {
        a.dropping = false;
        a.glide = false;
        rig.setChute(false);
        a.vel.set(0, 0, 0);
        if (a.isPlayer && !this.spec) this.hud.banner('ATERRASTE', 'Procura armas e equipamento', 1.8);
      }
    } else if (a.onGround && a.vel.y <= 0 && a.pos.y - g < 0.5) {
      a.pos.y = g;
      a.vel.y = 0;
    } else a.onGround = false;

    a.speedNow = Math.hypot(a.vel.x, a.vel.z);

    rig.root.position.copy(a.pos);
    rig.root.rotation.y = a.yaw;
    rig.root.rotation.x = 0;
    if (a.weapon && rig.weaponId !== a.weapon.id) rig.setWeapon(a.weapon.id, a.weapon.skin);
    if (!a.dropping && rig.chute) rig.setChute(false);
    const cam = this.camera.position;
    const dc = Math.abs(a.pos.x - cam.x) + Math.abs(a.pos.z - cam.z);
    const visible = a.isPlayer || dc < this.far * 1.3;
    rig.root.visible = visible && !(a.isPlayer && this.scoped);
    if (visible) {
      const w = a.weapon;
      rig.update(dt, {
        speed: a.speedNow,
        crouch: a.crouch,
        air: !a.onGround,
        pitch: a.pitch,
        reload: a.reloadT > 0 && w ? 1 - a.reloadT / WEAPONS[w.id].reload : 0,
        glide: a.dropping,
        dead: false,
        vx: a.vel.x,
        vz: a.vel.z,
      }, g);
      if (a.isPlayer && rig.stepped && !this.spec) sfx.step();
    }
  }

  // =============================================================== bots
  private canSee(a: Actor, b: Actor): boolean {
    const eye = a.headPos(tA);
    const tgt = b.chestPos(tB).sub(eye);
    const d = tgt.length();
    tgt.divideScalar(d);
    return this.world.raycast(eye, tgt, d) >= d - 0.4;
  }

  private updateBot(b: Actor, dt: number) {
    const ai = b.ai!;
    if (!b.alive || this.over) return;

    if (b.dropping) {
      if (!b.glide && b.pos.y - b.ground < 32 + (b.id % 7)) this.openChute(b);
      const land = this.landAt.get(b);
      if (land) {
        const dx = land.x - b.pos.x, dz = land.z - b.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const hs = Math.min(b.glide ? 9 : 17, d * 0.8);
        b.vel.x += ((dx / d) * hs - b.vel.x) * Math.min(1, dt * 2);
        b.vel.z += ((dz / d) * hs - b.vel.z) * Math.min(1, dt * 2);
        b.yaw = Math.atan2(dx, dz);
      }
      return;
    }

    ai.think -= dt;
    ai.react -= dt;
    ai.seenT -= dt;
    ai.gelT -= dt;
    ai.strafeT -= dt;
    ai.detourT -= dt;
    ai.crouchT -= dt;

    if (ai.passive) {
      const t = this.time * 0.6 + b.id;
      const tx = ai.home.x + Math.sin(t) * 4;
      b.vel.x = (tx - b.pos.x) * 2;
      b.vel.z = 0;
      b.yaw = Math.PI;
      b.pitch = 0;
      return;
    }

    if (ai.think <= 0) {
      const far = b.pos.distanceTo(this.camera.position) > 150;
      ai.think = (far ? 0.55 : 0.22) + Math.random() * 0.12;
      this.botThink(b);
    }

    let mx = 0, mz = 0;
    const t = ai.target;
    const w = b.weapon;
    const def = w ? WEAPONS[w.id] : null;
    let faceYaw: number | null = null;
    let wantPitch = 0;

    if (t && t.alive && ai.visible) {
      const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist, nz = dz / dist;
      const pref = def ? PREF_DIST[def.id] : 15;
      const retreating = b.hp < LOW_HP && b.shieldT <= 0;
      const fwd = retreating ? -1 : dist > pref + 5 ? 1 : dist < pref - 5 ? -0.7 : 0;
      if (ai.strafeT <= 0) {
        ai.strafe = Math.random() < 0.5 ? -1 : 1;
        ai.strafeT = 0.5 + Math.random() * 1.1;
        if (Math.random() < 0.12 && b.onGround) b.vel.y = JUMP;
      }
      const st = b.healT > 0 ? 0 : ai.strafe * 0.85;
      mx = nx * fwd - nz * st;
      mz = nz * fwd + nx * st;
      faceYaw = Math.atan2(dx, dz);
      const tc = t.chestPos(tC);
      wantPitch = Math.atan2(tc.y - (b.pos.y + 1.6), dist);
      if (ai.crouchT <= 0) {
        b.crouch = dist > 18 && Math.random() < 0.3;
        ai.crouchT = 1 + Math.random() * 2;
      }
      this.botShoot(b, t, dist, dt);
    } else {
      b.crouch = false;
      const goal = t && ai.seenT > 0 ? ai.lastSeen : ai.goal;
      if (goal) {
        const dx = goal.x - b.pos.x, dz = goal.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.8) {
          if (goal === ai.goal) ai.goal = null;
          else ai.target = null;
        } else {
          mx = dx / d;
          mz = dz / d;
        }
      }
      if (w && w.mag < WEAPONS[w.id].mag * 0.5) this.startReload(b);
      if (b.hp < 70 && b.meds > 0) this.startHeal(b);
    }

    if (mx || mz) {
      if (ai.detourT > 0) {
        const c = Math.cos(ai.detour), s = Math.sin(ai.detour);
        const nx = mx * c - mz * s;
        mz = mx * s + mz * c;
        mx = nx;
      } else {
        const o = tA.set(b.pos.x, b.pos.y + 0.6, b.pos.z);
        const dir = tB.set(mx, 0, mz).normalize();
        if (this.world.raycast(o, dir, 1.5) < 1.5) {
          let found = false;
          for (const ang of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
            const c = Math.cos(ang), s = Math.sin(ang);
            tC.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
            if (this.world.raycast(o, tC, 1.6) >= 1.6) {
              ai.detour = ang;
              ai.detourT = 0.5;
              found = true;
              break;
            }
          }
          if (!found && b.onGround) b.vel.y = JUMP;
        }
      }
      ai.stuckT += dt;
      if (ai.stuckT > 1) {
        if (ai.lastPos.distanceTo(b.pos) < 0.6) {
          if (b.onGround) b.vel.y = JUMP;
          ai.detour = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 1.2);
          ai.detourT = 0.9;
          if (Math.random() < 0.4) ai.goal = null;
        }
        ai.stuckT = 0;
        ai.lastPos.copy(b.pos);
      }
    }

    let speed = SPEED * (def ? def.moveMul : 1) * (b.crouch ? 0.45 : 1) * (b.healT > 0 ? 0.3 : 1) * (b.furyT > 0 ? 1.2 : 1) * (ai.visible ? 0.8 : 0.92) * (b.pos.y < -0.4 ? 0.6 : 1);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) speed /= ml;
    if (b.dashT <= 0) {
      const acc = b.onGround ? 8 : 3;
      b.vel.x += (mx * speed - b.vel.x) * Math.min(1, dt * acc);
      b.vel.z += (mz * speed - b.vel.z) * Math.min(1, dt * acc);
    }
    if (faceYaw === null && (mx || mz)) faceYaw = Math.atan2(mx, mz);
    if (faceYaw !== null) b.yaw += angDiff(faceYaw, b.yaw) * Math.min(1, dt * 8);
    b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * 6);
  }

  private botThink(b: Actor) {
    const ai = b.ai!;
    const cfg = DIFF[this.diff];
    const br = this.mode === 'br' || this.mode === 'watch';
    const detect = (br ? 48 : 75) * cfg.detect;
    const cands: [number, Actor][] = [];
    for (const e of this.actors) {
      if (!e.alive || e.team === b.team || e.dropping || e === b || this.onPlane.has(e)) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
      if (Math.abs(dx) > detect * 1.6 || Math.abs(dz) > detect * 1.6) continue;
      const d = Math.hypot(dx, dz) * (e.isPlayer || !br ? 1 : 1.35);
      if (d > detect && !(e.firedT > 0 && d < detect * 1.4)) continue;
      const ang = Math.abs(angDiff(Math.atan2(dx, dz), b.yaw));
      if (ang > 1.4 && d > 10 && e.firedT <= 0 && e !== ai.target) continue;
      cands.push([d, e]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    const prev = ai.target;
    ai.visible = false;
    for (let i = 0; i < Math.min(3, cands.length); i++) {
      const e = cands[i][1];
      if (this.canSee(b, e)) {
        ai.target = e;
        ai.visible = true;
        ai.lastSeen.copy(e.pos);
        ai.seenT = 2.5;
        if (e !== prev) {
          const rc = e.isPlayer ? cfg : BOT_VS_BOT;
          ai.react = (rc.react * (0.7 + Math.random() * 0.6)) / ai.skill;
        }
        break;
      }
    }
    if (!ai.visible && ai.target && (!ai.target.alive || ai.seenT <= 0)) ai.target = null;

    const t = ai.target;
    if (t && ai.visible) {
      const d = b.pos.distanceTo(t.pos);
      const inDanger = b.hp < LOW_HP && b.shieldT <= 0;
      if ((b.hp < 50 || inDanger) && b.gel > 0 && ai.gelT <= 0 && Math.random() < (inDanger ? 0.85 : 0.55)) {
        this.throwGloo(b, Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z));
        ai.gelT = inDanger ? 3.5 : 6;
      }
      if (b.healT <= 0 && b.meds > 0 && b.hp < 48 && Math.random() < 0.45) this.startHeal(b);
      if (b.nades > 0 && d > 9 && d < 26 && Math.random() < 0.035) {
        const dir = tC.set(t.pos.x - b.pos.x, 0, t.pos.z - b.pos.z).normalize();
        dir.y = 0.35;
        this.throwNade(b, dir.normalize(), Math.min(18, 7 + d * 0.45));
      }
      if (b.abilityCd <= 0 && Math.random() < 0.25) {
        const id = b.hero.ability.id;
        if ((id === 'heal' && b.hp < 60) || (id === 'shield' && b.hp < 75) || (id === 'fury' && d < 30) || (id === 'dash' && d > 15) || id === 'reveal') this.useAbility(b);
      }
      const w = b.weapon;
      if (w && b.reloadT <= 0) {
        let bestI = b.cur, bestScore = -1e9;
        b.slots.forEach((s, i) => {
          if (!s || s.mag <= 0) return;
          const sc = -Math.abs(PREF_DIST[s.id] - d) + WEAPONS[s.id].tier * 4;
          if (sc > bestScore) {
            bestScore = sc;
            bestI = i;
          }
        });
        if (bestI !== b.cur && Math.random() < 0.3) b.equip(bestI);
      }
      return;
    }

    if (!ai.goal || Math.random() < 0.02) {
      if (br) {
        const z = this.zone;
        const dz = Math.hypot(b.pos.x - z.ncx, b.pos.z - z.ncz);
        if (dz > z.nr * 0.8 || Math.hypot(b.pos.x - z.cx, b.pos.z - z.cz) > z.r * 0.9) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * z.nr * 0.5;
          ai.goal = new THREE.Vector3(z.ncx + Math.cos(a) * r, 0, z.ncz + Math.sin(a) * r);
        } else {
          const needW = !b.slots[0] || !b.slots[1];
          let best: Loot | null = null, bd = needW ? 60 : 35;
          const myTier = Math.max(...b.slots.map((s) => (s ? WEAPONS[s.id].tier : 0)));
          for (const l of this.loot) {
            if (!l.alive) continue;
            const dx = l.pos.x - b.pos.x, dz2 = l.pos.z - b.pos.z;
            if (Math.abs(dx) > bd || Math.abs(dz2) > bd) continue;
            if (l.kind === 'weapon' && !needW && WEAPONS[l.wid!].tier <= myTier) continue;
            if (l.kind === 'armor' && l.n <= b.armor) continue;
            const d = Math.hypot(dx, dz2);
            if (d < bd && Math.hypot(l.pos.x - z.ncx, l.pos.z - z.ncz) < z.nr) {
              bd = d;
              best = l;
            }
          }
          if (best) ai.goal = best.pos.clone();
          else {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.min(z.nr, z.r) * 0.8;
            ai.goal = new THREE.Vector3(z.ncx + Math.cos(a) * r, 0, z.ncz + Math.sin(a) * r);
          }
        }
      } else {
        const enemies = this.actors.filter((e) => e.alive && e.team !== b.team);
        const cx = this.world.cx, cz = this.world.cz;
        if (enemies.length && Math.random() < 0.55) {
          const e = pick(enemies);
          ai.goal = new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 16, 0, e.pos.z + (Math.random() - 0.5) * 16);
        } else {
          const a = Math.random() * 6.28, r = Math.random() * (this.world.clampR - 6);
          ai.goal = new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
        }
      }
    }

    if (br) {
      for (const l of this.loot) {
        if (!l.alive || Math.abs(l.pos.x - b.pos.x) > 1.8 || Math.abs(l.pos.z - b.pos.z) > 1.8 || Math.abs(l.pos.y - b.pos.y) > 1.8) continue;
        if (l.kind === 'weapon') {
          const worst = !b.slots[0] ? -1 : !b.slots[1] ? -1 : Math.min(WEAPONS[b.slots[0]!.id].tier, WEAPONS[b.slots[1]!.id].tier);
          if (worst < WEAPONS[l.wid!].tier && !b.slots.some((s) => s?.id === l.wid)) {
            if (b.slots[0] && b.slots[1]) b.cur = WEAPONS[b.slots[0].id].tier <= WEAPONS[b.slots[1].id].tier ? 0 : 1;
            this.takeWeapon(b, l);
          }
        } else this.takeItem(b, l);
      }
      if (b.cur === 2 && (b.slots[0] || b.slots[1])) b.equip(b.slots[0] ? 0 : 1);
    }
  }

  private botShoot(b: Actor, t: Actor, dist: number, dt: number) {
    const ai = b.ai!;
    const w = b.weapon;
    if (!w || ai.react > 0 || b.healT > 0) return;
    const def = WEAPONS[w.id];
    if (b.reloadT > 0) return;
    if (w.mag <= 0) {
      this.startReload(b);
      return;
    }
    if (dist > def.range) return;
    if (ai.burstPause > 0) {
      ai.burstPause -= dt;
      return;
    }
    if (b.cd > 0) return;
    const cfg = t.isPlayer ? DIFF[this.diff] : BOT_VS_BOT;
    b.cd = def.interval * cfg.rate * (b.furyT > 0 ? 0.65 : 1) * (def.auto ? 1 : 1.25);
    w.mag--;
    b.firedT = 1.5;
    ai.burst--;
    if (ai.burst <= 0) {
      ai.burst = 3 + ((Math.random() * 6) | 0);
      ai.burstPause = def.auto ? 0.25 + Math.random() * 0.5 : 0.1;
    }
    let acc = cfg.acc * ai.skill * THREE.MathUtils.clamp(1.25 - dist / def.range, 0.2, 1.15);
    if (!def.auto) acc *= 1.6;
    if (t.crouch) acc *= 0.85;
    if (t.speedNow > 4) acc *= 0.82;
    if (!t.onGround) acc *= 0.7;
    if (t.isPlayer && this.mode !== 'br') acc *= 0.9;
    const muzzle = b.rig.muzzleWorld(new THREE.Vector3());
    const chest = t.chestPos(tC);
    let anyHit = false;
    for (let i = 0; i < def.pellets; i++) {
      if (Math.random() < acc * (def.pellets > 1 ? 1.3 : 1)) {
        anyHit = true;
        const head = Math.random() < (t.isPlayer ? HEAD_CHANCE[this.diff] : BOT_VS_BOT.head);
        const fall = dist > def.range * 0.5 ? 0.7 : 1;
        this.hurt(t, def.dmg * (head ? def.head : 1) * fall * cfg.dmg, b, head, def.name);
        if (!t.alive) break;
      }
    }
    const end = chest.clone();
    if (!anyHit) end.add(tA.set((Math.random() - 0.5) * 2.2, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 2.2));
    const dc = muzzle.distanceTo(this.camera.position);
    if (dc < this.far) this.fx.tracer(muzzle, end, 0xff9a6b);
    this.replay?.shot(this.time, muzzle, end, 0xff9a6b);
    if (dc < 60) {
      this.fx.flash(muzzle, tA.copy(end).sub(muzzle).normalize());
      sfx.shot(w.id, Math.max(0.05, 1 - dc / 60) * 0.55);
    }
    b.rig.kick = 1;
  }

  // =============================================================== world objects
  private updateLoot(dt: number) {
    const c = this.camera.position;
    for (const l of this.loot) {
      if (!l.alive) continue;
      const near = Math.abs(l.pos.x - c.x) + Math.abs(l.pos.z - c.z) < 60;
      l.obj.visible = near;
      if (!near) continue;
      l.spin += dt;
      const inner = l.obj.children[0];
      inner.rotation.y = l.spin * 1.2;
      inner.position.y = (l.kind === 'weapon' ? 0.35 : 0.4) + Math.sin(l.spin * 2.4) * 0.08;
    }
    if (this.loot.length > 700) this.loot = this.loot.filter((l) => l.alive);
  }

  private updateNades(dt: number) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      n.vel.y -= GRAV * dt;
      const step = n.vel.length() * dt;
      if (step > 0) {
        const dir = tA.copy(n.vel).normalize();
        const h = this.world.raycast(n.pos, dir, step + 0.15);
        if (h < step + 0.15 && n.pos.y > this.world.groundAt(n.pos.x, n.pos.z, n.pos.y) + 0.2) {
          n.vel.x *= -0.35;
          n.vel.z *= -0.35;
        }
      }
      n.pos.addScaledVector(n.vel, dt);
      const gy = this.world.groundAt(n.pos.x, n.pos.z, n.pos.y) + 0.13;
      if (n.pos.y < gy) {
        n.pos.y = gy;
        n.vel.y *= -0.35;
        n.vel.x *= 0.65;
        n.vel.z *= 0.65;
      }
      n.mesh.position.copy(n.pos);
      if (n.fuse <= 0) {
        this.scene.remove(n.mesh);
        this.nades.splice(i, 1);
        this.explode(n);
      }
    }
  }

  private explode(n: Nade) {
    const R = 6.5;
    this.fx.blast(n.pos, R * 0.7);
    this.replay?.boom(this.time, n.pos);
    this.net?.broadcast(netBoom(n.pos));
    const dc = n.pos.distanceTo(this.camera.position);
    if (dc < 80) sfx.boom();
    if (dc < 20) this.shake = Math.max(this.shake, 1.2 * (1 - dc / 20));
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.team === n.owner.team && a !== n.owner) continue;
      const d = a.chestPos(tB).distanceTo(n.pos);
      if (d < R) this.hurt(a, 105 * (1 - d / R) * (a === n.owner ? 0.5 : 1), n.owner, false, 'GRANADA');
    }
    for (const g of [...this.gloo.groups]) {
      const w = g.segs.find((s) => s.wall)?.wall;
      if (w && Math.hypot(g.x - n.pos.x, g.z - n.pos.z) < R) this.gloo.damage(w as Wall, 300);
    }
  }

  private updateZone(dt: number) {
    const z = this.zone;
    const ph = ZONE_PHASES[z.phase];
    if (!z.started && this.plane && this.plane.done) {
      z.started = true;
      z.t = -10;
    }
    if (ph && z.started) {
      z.t += dt;
      if (!z.shrinking && z.t >= ph.wait) {
        z.shrinking = true;
        z.t = 0;
        this.hud.banner('A ZONA ESTÁ A FECHAR', 'Move-te para a área segura', 2.2);
      }
      if (z.shrinking) {
        const k = Math.min(1, z.t / ph.shrink);
        z.r = THREE.MathUtils.lerp(z.fr, z.nr, k);
        z.cx = THREE.MathUtils.lerp(z.fcx, z.ncx, k);
        z.cz = THREE.MathUtils.lerp(z.fcz, z.ncz, k);
        if (k >= 1) this.nextZone();
      }
    }
    for (const a of this.actors) {
      if (!a.alive || a.dropping || this.onPlane.has(a)) continue;
      if (Math.hypot(a.pos.x - z.cx, a.pos.z - z.cz) > z.r) {
        a.hp -= z.dps * dt;
        if (a.isPlayer && Math.random() < dt * 2) this.hud.hurtDir(Math.PI);
        if (a.hp <= 0) this.die(a, null, false, 'ZONA');
      }
    }
    const r = Math.max(0.1, z.r);
    this.zoneWall!.position.set(z.cx, 40, z.cz);
    this.zoneWall!.scale.set(r, 1, r);
    this.zoneRing!.position.set(z.ncx, this.world.terrain.maxH + 0.5, z.ncz);
    this.zoneRing!.scale.set(Math.max(0.1, z.nr), 1, Math.max(0.1, z.nr));
    this.zoneRing!.visible = !!ph && z.nr < z.r - 0.5 && this.camera.position.y > 40;
  }

  // =============================================================== camera & hud
  private get scoped() {
    const p = this.player;
    const w = p.weapon;
    return !!w && WEAPONS[w.id].scope && this.input.ads && p.alive && !p.dropping && !this.spec;
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const w = p.weapon;
    const def = w ? WEAPONS[w.id] : null;
    const ads = this.input.ads && !!def && p.alive && !p.dropping;
    const scoped = this.scoped;
    const f = this.camFwd(tA);
    const rx = -Math.cos(p.yaw), rz = Math.sin(p.yaw);
    const s = p.rig.root.scale.y;

    if (this.onPlane.has(p) && this.plane) {
      const pp = this.plane.group.position;
      cam.position.set(pp.x - f.x * 42, pp.y + 10 - f.y * 42, pp.z - f.z * 42);
      cam.rotation.set(p.pitch - 0.15, p.yaw + Math.PI, 0);
      if (Math.abs(cam.fov - 65) > 0.1) {
        cam.fov = 65;
        cam.updateProjectionMatrix();
      }
      return;
    }

    const pivot = tB.set(p.pos.x, p.pos.y + (p.crouch ? 1.2 : 1.6) * s, p.pos.z);
    if (!p.alive) {
      p.yaw += dt * 0.25;
      p.pitch += (-0.35 - p.pitch) * dt * 2;
    }

    let fov = 72;
    if (scoped) {
      p.headPos(cam.position).addScaledVector(f, 0.3);
      fov = def!.adsFov;
    } else {
      const want = p.dropping ? 7.5 : !p.alive ? 5 : ads ? 1.8 : 3.5;
      const side = p.dropping ? 0 : ads ? 0.6 : 0.85;
      this.camDist += (want - this.camDist) * Math.min(1, dt * 10);
      const desired = tC.copy(pivot).addScaledVector(f, -this.camDist);
      desired.x += rx * side;
      desired.z += rz * side;
      desired.y += ads ? 0.2 : 0.35;
      const dir = tD.copy(desired).sub(pivot);
      const len = dir.length();
      dir.divideScalar(len);
      const hit = this.world.raycast(pivot, dir, len + 0.25);
      const useLen = hit < len + 0.25 ? Math.max(0.3, hit - 0.3) : len;
      cam.position.copy(pivot).addScaledVector(dir, useLen);
      if (useLen < len) this.camDist = Math.max(this.camDist * 0.98, useLen);
      if (ads) fov = Math.max(def!.adsFov, 50);
    }
    if (this.shake > 0) {
      const k = this.shake * 0.06;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    this.fovNow += (fov - this.fovNow) * Math.min(1, dt * 14);
    if (Math.abs(cam.fov - this.fovNow) > 0.05) {
      cam.fov = this.fovNow;
      cam.updateProjectionMatrix();
    }
    cam.rotation.set(p.pitch, p.yaw + Math.PI, 0);
  }

  project(v: THREE.Vector3): { x: number; y: number } | null {
    const t = tD.copy(v).project(this.camera);
    if (t.z > 1 || t.x < -1.1 || t.x > 1.1 || t.y < -1.1 || t.y > 1.1) return null;
    return { x: ((t.x + 1) / 2) * innerWidth, y: ((1 - t.y) / 2) * innerHeight };
  }

  private updateHud(dt: number) {
    const p = this.player;
    const h = this.hud;
    h.update(dt);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) h.center('');
    }
    this.streakT -= dt;
    const plane = this.onPlane.has(p) && !this.spec;
    h.el.classList.toggle('plane', plane);
    if (!this.spec) {
      h.vitals(p.hp, p.armor, p.shieldT > 0);
      h.weapons(p.slots, p.cur, p.reloadT > 0);
      h.counts(p.meds, p.gel, p.nades);
      h.ability(ABIL_ICON[p.hero.ability.id], 1 - p.abilityCd / p.hero.ability.cd);
      h.healing(p.healT > 0 ? 1 - p.healT / 2.2 : 0);
      const w = p.weapon;
      const def = w ? WEAPONS[w.id] : null;
      const moving = p.speedNow > 1.5;
      const spread = def ? (this.input.ads ? def.adsSpread : def.spread) * (moving ? 1.35 : 1) * (p.onGround ? 1 : 1.8) * (p.crouch ? 0.7 : 1) : 0.02;
      h.crosshair(4 + spread * 520 + (p.cd > 0 ? 3 : 0), !this.scoped && p.alive && !p.dropping && !plane, !!this.assist);
      h.scope(this.scoped);
    } else {
      h.crosshair(0, false, false);
      h.scope(false);
    }

    const alive = this.actors.filter((a) => a.alive).length;
    h.text('#tsAlive b', alive);
    h.text('#tsKills b', p.kills);
    if (this.mode === 'br' || this.mode === 'watch') {
      const z = this.zone;
      const ph = ZONE_PHASES[z.phase];
      const txt = !ph ? 'FINAL' : !z.started ? 'AVIÃO' : z.t < 0 ? fmt(ph.wait - z.t) : z.shrinking ? 'A FECHAR' : fmt(ph.wait - z.t);
      h.text('#tsZone b', txt);
      h.toggle('#tsZone', 'warn', z.shrinking);
      const out = !this.spec && Math.hypot(p.pos.x - z.cx, p.pos.z - z.cz) > z.r;
      h.toggle('#tsZone', 'out', out && p.alive && !p.dropping && !plane);
    } else if (this.mode === 'squad') {
      h.text('#tsScore .a', this.scoreA);
      h.text('#tsScore .f', this.scoreB);
      h.text('#tsTime', fmt(Math.max(0, 300 - this.time)));
    }
    if (!this.spec) {
      if (plane) h.center(`A BORDO · ${this.onPlane.size}`);
      else if (!p.alive && this.mode === 'squad' && p.respawnT > 0) h.center(`RENASCES EM ${Math.ceil(p.respawnT)}`);
      else if (p.dropping) h.center(p.glide ? '' : `QUEDA LIVRE · ${Math.round(p.pos.y - p.ground)} m`);
      else if (this.toastT <= 0) h.center('');

      this.tagTimer -= dt;
      const recheck = this.tagTimer <= 0;
      if (recheck) this.tagTimer = 0.25;
      let n = 0;
      for (const a of this.actors) {
        if (a.isPlayer || !a.alive || this.onPlane.has(a)) continue;
        const ally = a.team === p.team;
        const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
        if (Math.abs(dx) > 120 || Math.abs(dz) > 120) continue;
        const d = Math.hypot(dx, dz);
        if (d > (ally ? 120 : 55) && !(p.revealT > 0 && d < 60)) continue;
        if (!ally && recheck) a.seen = p.revealT > 0 || this.canSee(p, a);
        if (!ally && !a.seen) continue;
        const s = this.project(tA.set(a.pos.x, a.pos.y + 2.1 * a.rig.root.scale.y, a.pos.z));
        if (!s) continue;
        h.tag(n++, s.x, s.y, a.name, a.hp, ally ? 'ally' : 'enemy', !ally || a.hp < 100);
      }
      h.hideTags(n);
    } else if (this.toastT <= 0) h.center('');

    this.drawMinimap();
    if (this.mapOpen) {
      this.mapT -= dt;
      if (this.mapT <= 0) {
        this.mapT = 0.2;
        this.drawBigMap();
      }
    }
    h.toggle('#bigmap', 'show', this.mapOpen);
  }

  private focusPos(): [number, number, number] {
    if (this.spec) {
      const c = this.camera;
      const t = this.spec.target;
      if (t && this.spec.mode !== 'free' && this.spec.mode !== 'map') return [t.rig.root.position.x, t.rig.root.position.z, t.rig.root.rotation.y];
      return [c.position.x, c.position.z, c.rotation.y - Math.PI];
    }
    const p = this.player;
    if (this.onPlane.has(p) && this.plane) return [this.plane.pos.x, this.plane.pos.z, p.yaw];
    return [p.pos.x, p.pos.z, p.yaw];
  }

  private drawMinimap() {
    const c = this.hud.mini;
    const [px, pz, yaw] = this.focusPos();
    const S = 150, H = 75;
    const p = this.player;
    const view = this.mode === 'squad' || this.mode === 'train' ? 45 : p.dropping || this.onPlane.has(p) ? 120 : 62;
    const k = H / view;
    const W = this.world.terrain.S;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(H, H, H, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1d6f9c';
    c.fillRect(0, 0, S, S);
    c.translate(H, H);
    c.rotate(yaw + Math.PI);
    c.scale(k, k);
    c.translate(-px, -pz);
    c.drawImage(this.miniBase, -W, -W, W * 2, W * 2);
    this.drawOverlay(c, k, false);
    c.restore();
    c.fillStyle = '#ffb81c';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(H, H - 8);
    c.lineTo(H + 6, H + 6);
    c.lineTo(H, H + 2);
    c.lineTo(H - 6, H + 6);
    c.closePath();
    c.fill();
    c.stroke();
    const nEl = this.hud.el.querySelector<HTMLElement>('#minimap .n');
    if (nEl) {
      const th = yaw + Math.PI;
      nEl.style.transform = `translate(${Math.sin(th) * 64}px, ${-Math.cos(th) * 64}px)`;
    }
  }

  /** Zone circles, plane route and actor dots in world coordinates (context already transformed). */
  private drawOverlay(c: CanvasRenderingContext2D, k: number, big: boolean) {
    const p = this.player;
    const z = this.zone;
    if (this.mode === 'br' || this.mode === 'watch') {
      c.lineWidth = 2 / k;
      c.strokeStyle = '#ffffff';
      c.beginPath();
      c.arc(z.ncx, z.ncz, Math.max(0.1, z.nr), 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = '#4a7dff';
      c.lineWidth = 3 / k;
      c.beginPath();
      c.arc(z.cx, z.cz, Math.max(0.1, z.r), 0, Math.PI * 2);
      c.stroke();
    } else if (this.arena) {
      c.strokeStyle = '#ff4a6a';
      c.lineWidth = 2.5 / k;
      c.beginPath();
      c.arc(this.arena.x, this.arena.z, ARENA_R, 0, Math.PI * 2);
      c.stroke();
    }
    if (this.plane && !this.plane.done) {
      c.setLineDash([6 / k, 5 / k]);
      c.strokeStyle = '#ffd34d';
      c.lineWidth = 2 / k;
      c.beginPath();
      c.moveTo(this.plane.start.x, this.plane.start.z);
      c.lineTo(this.plane.end.x, this.plane.end.z);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ffd34d';
      c.beginPath();
      c.arc(this.plane.pos.x, this.plane.pos.z, 5 / k, 0, Math.PI * 2);
      c.fill();
    }
    const dot = (big ? 4 : 3.4) / k;
    for (const a of this.actors) {
      if (a.isPlayer || !a.alive || this.onPlane.has(a)) continue;
      const ally = a.team === p.team && this.mode === 'squad';
      const d = a.pos.distanceTo(p.pos);
      if (!this.spec && !ally && !(a.firedT > 0 && d < 70) && !(p.revealT > 0 && d < 60)) continue;
      c.fillStyle = this.spec ? (a === this.spec.target ? '#ffd34d' : this.mode === 'squad' ? (a.team === 0 ? '#3fa9ff' : '#ff3b4e') : '#ffffff') : ally ? '#3fa9ff' : '#ff3b4e';
      c.beginPath();
      c.arc(a.pos.x, a.pos.z, dot, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawBigMap() {
    const cv = this.hud.el.querySelector<HTMLCanvasElement>('#bigmap canvas');
    if (!cv) return;
    const size = Math.max(200, Math.min(innerWidth, innerHeight) - 40);
    if (cv.width !== size) cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    const S = this.world.terrain.S;
    const k = size / (S * 2);
    c.save();
    c.clearRect(0, 0, size, size);
    c.scale(k, k);
    c.translate(S, S);
    c.drawImage(this.miniBase, -S, -S, S * 2, S * 2);
    this.drawOverlay(c, k, true);
    c.font = `600 ${12 / k}px Rajdhani, sans-serif`;
    c.textAlign = 'center';
    for (const poi of this.world.pois) {
      if (poi.kind === 'range') continue;
      c.fillStyle = 'rgba(0,0,0,.55)';
      const w = c.measureText(poi.name).width + 8 / k;
      c.fillRect(poi.x - w / 2, poi.z - 10 / k, w, 14 / k);
      c.fillStyle = '#fff';
      c.fillText(poi.name, poi.x, poi.z + 1 / k);
    }
    const [px, pz, yaw] = this.focusPos();
    c.translate(px, pz);
    c.rotate(-yaw + Math.PI);
    c.fillStyle = '#ffb81c';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5 / k;
    c.beginPath();
    c.moveTo(0, 9 / k);
    c.lineTo(6 / k, -6 / k);
    c.lineTo(0, -2 / k);
    c.lineTo(-6 / k, -6 / k);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  dispose() {
    this.spec?.dispose();
    this.input.dispose();
    this.hud.dispose();
    this.pauseEl.remove();
    for (const a of this.actors) a.rig.dispose();
    if (this.mode === 'watch') this.player.rig.dispose();
    this.world.dispose();
    this.fx.dispose();
    this.gloo.dispose();
    this.plane?.dispose();
    this.auraGeo.dispose();
    this.auraMat.dispose();
    this.nadeGeo.dispose();
    this.zoneWall?.geometry.dispose();
    (this.zoneWall?.material as THREE.Material | undefined)?.dispose();
    this.zoneRing?.geometry.dispose();
    (this.zoneRing?.material as THREE.Material | undefined)?.dispose();
  }
}

function fmt(s: number) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
