import * as THREE from 'three';
import { HEROES, ITEMS, PRIMARY_IDS, SLOTS, WEAPONS, type AbilityId, type Difficulty, type ModeId, type Outfit, type WeaponDef, type WeaponId } from '../data';
import { profile } from '../save';
import { sfx } from '../audio';
import { box, cyl, glow, mat, sphere } from '../models/materials';
import { weaponMesh } from '../models/weapon';
import { Actor, RADIUS } from './actor';
import { World, type Wall } from './world';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';

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
}

export interface MatchOpts {
  mode: ModeId;
  difficulty: Difficulty;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  onEnd: (r: MatchResult) => void;
}

type LootKind = 'weapon' | 'med' | 'armor' | 'gel' | 'nade';
interface Loot { kind: LootKind; wid?: WeaponId; n: number; obj: THREE.Group; pos: THREE.Vector3; alive: boolean; spin: number }
interface Gel { wall: Wall; mesh: THREE.Mesh; life: number; grow: number }
interface Nade { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; owner: Actor }

const GRAV = 22;
const JUMP = 7.4;
const SPEED = 6.2;
const NAMES = ['xKiller', 'NinjaAO', 'Sombra77', 'Fénix', 'ReiDoCapim', 'Mamba', 'Kuduro', 'TugaSniper', 'Bala7', 'Jaguar', 'Mito_FF', 'LoboAlfa', 'ProPlayer', 'Zica', 'Raio', 'Pantera', 'Cobra', 'Trovão', 'Kamikaze', 'Ghost', 'Sniperzinho', 'Diamante', 'Bruxo', 'Dread', 'Kiala', 'Muxima', 'Zumbi', 'Nzola'];
const ABIL_ICON: Record<AbilityId, string> = { dash: '⚡', heal: '✚', shield: '⛨', reveal: '◉', fury: '🔥' };
const PREF_DIST: Record<WeaponId, number> = { ar: 22, smg: 12, sg: 6, sr: 55, dmr: 40, lmg: 24, pistol: 14 };
const DIFF = {
  easy: { acc: 0.17, react: 0.75, dmg: 0.55, detect: 0.8, rate: 1.35 },
  normal: { acc: 0.27, react: 0.48, dmg: 0.75, detect: 1, rate: 1.15 },
  hard: { acc: 0.38, react: 0.3, dmg: 0.95, detect: 1.2, rate: 1 },
};
const ZONE_PHASES = [
  { wait: 45, shrink: 35, r: 72, dps: 1.5 },
  { wait: 35, shrink: 25, r: 44, dps: 3 },
  { wait: 28, shrink: 20, r: 24, dps: 5 },
  { wait: 22, shrink: 16, r: 10, dps: 8 },
  { wait: 18, shrink: 14, r: 0, dps: 12 },
];
const ARMOR_RED = [0, 0.2, 0.3, 0.42];

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function randomOutfit(): Outfit {
  const o = {} as Outfit;
  for (const s of SLOTS) {
    const opts = ITEMS.filter((i) => i.slot === s.id);
    o[s.id] = (Math.random() < 0.35 ? opts[0] : pick(opts)).id;
  }
  return o;
}

export class Match {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  fx = new Fx();
  hud: Hud;
  input: Input;
  actors: Actor[] = [];
  player: Actor;
  loot: Loot[] = [];
  gels: Gel[] = [];
  nades: Nade[] = [];
  mode: ModeId;
  diff: Difficulty;
  time = 0;
  over = false;
  paused = false;
  scoreA = 0;
  scoreB = 0;
  total = 0;
  private opts: MatchOpts;
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
  private zone = { cx: 0, cz: 0, r: 300, ncx: 0, ncz: 0, nr: 300, fcx: 0, fcz: 0, fr: 300, phase: -1, t: 0, shrinking: false, dps: 0 };
  private zoneWall: THREE.Mesh | null = null;
  private zoneRing: THREE.Mesh | null = null;
  private miniBase: HTMLCanvasElement;
  private miniPpm: number;
  private gelGeo = new THREE.BoxGeometry(3.6, 2.5, 0.44).translate(0, 1.25, 0);
  private gelMat = new THREE.MeshLambertMaterial({ color: 0x9fe8ff, emissive: 0x1d5f7a, transparent: true, opacity: 0.8 });
  private auraGeo = new THREE.SphereGeometry(1.05, 14, 10);
  private auraMat = new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.18, depthWrite: false });
  private nadeGeo = new THREE.SphereGeometry(0.13, 8, 6);
  private tagTimer = 0;

  constructor(opts: MatchOpts) {
    this.opts = opts;
    this.mode = opts.mode;
    this.diff = opts.difficulty;
    const q = profile.settings.quality;
    const far = q === 'low' ? 110 : q === 'medium' ? 160 : 230;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.Fog(0xcfe9ff, 25, far);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5d7a46, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
    sun.position.set(60, 100, 35);
    this.scene.add(sun);

    const kind = this.mode === 'br' ? 'island' : this.mode === 'squad' ? 'village' : 'range';
    this.world = new World(kind, (Math.random() * 1e9) | 0);
    this.scene.add(this.world.group, this.fx.group);

    this.hud = new Hud(opts.root, this.mode);
    this.input = new Input(opts.canvas, this.hud.el);
    this.input.enabled = true;

    this.pauseEl = document.createElement('div');
    this.pauseEl.id = 'pausemenu';
    this.pauseEl.innerHTML = `<div class="pbox"><h2>PAUSA</h2><button class="btn-primary" data-p="resume">CONTINUAR</button><button class="btn-ghost" data-p="quit">SAIR DA PARTIDA</button></div>`;
    this.pauseEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
      if (!b) return;
      sfx.click();
      if (b.dataset.p === 'resume') this.setPaused(false);
      else this.quit();
    });
    opts.root.appendChild(this.pauseEl);

    // ---------------- actors
    const p = new Actor(0, profile.name, 0, profile.hero, profile.outfit, true);
    this.player = p;
    this.actors.push(p);
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    const mkBot = (team: number) => {
      const b = new Actor(this.actors.length, names.pop() || 'BOT', team, pick(HEROES).id, randomOutfit());
      b.ai = {
        target: null, lastSeen: new THREE.Vector3(), seenT: 0, think: Math.random() * 0.3, strafe: 1, strafeT: 0, react: 0,
        burst: 4, burstPause: 0, goal: null, goalT: 0, stuckT: 0, lastPos: new THREE.Vector3(), detour: 0, detourT: 0,
        crouchT: 0, gelT: 0, visible: false, passive: false, home: new THREE.Vector3(), skill: 0.85 + Math.random() * 0.3,
      };
      this.actors.push(b);
      return b;
    };

    if (this.mode === 'br') {
      for (let i = 1; i < 16; i++) mkBot(i);
      for (const a of this.actors) {
        a.give(2, 'pistol', a.isPlayer ? profile.weaponSkins.pistol || 'default' : 'default');
        a.dropping = true;
        const ang = Math.random() * Math.PI * 2, r = a.isPlayer ? Math.random() * 50 : 20 + Math.random() * 80;
        a.pos.set(Math.cos(ang) * r, a.isPlayer ? 120 : 70 + Math.random() * 50, Math.sin(ang) * r);
        a.yaw = Math.random() * Math.PI * 2;
      }
      this.spawnLoot();
      this.setupZone();
    } else if (this.mode === 'squad') {
      for (let i = 0; i < 3; i++) mkBot(0);
      for (let i = 0; i < 4; i++) mkBot(1);
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

    // minimap base
    const W = this.world.radius + 10;
    this.miniPpm = this.mode === 'br' ? 2 : 4;
    const size = Math.ceil(W * 2 * this.miniPpm);
    this.miniBase = document.createElement('canvas');
    this.miniBase.width = this.miniBase.height = size;
    const mc = this.miniBase.getContext('2d')!;
    mc.fillStyle = '#1d6f9c';
    mc.fillRect(0, 0, size, size);
    mc.fillStyle = '#d9c48a';
    mc.beginPath();
    mc.arc(size / 2, size / 2, (this.world.radius + 6) * this.miniPpm, 0, Math.PI * 2);
    mc.fill();
    mc.fillStyle = this.mode === 'train' ? '#8f876a' : '#5f9a43';
    mc.beginPath();
    mc.arc(size / 2, size / 2, this.world.radius * this.miniPpm, 0, Math.PI * 2);
    mc.fill();
    for (const b of this.world.boxes) {
      const h = b.maxY - b.minY;
      mc.fillStyle = h > 2.5 ? '#e8e2d4' : h > 1.2 ? '#b9a98a' : '#7c8a62';
      mc.fillRect((b.minX + W) * this.miniPpm, (b.minZ + W) * this.miniPpm, Math.max(1, (b.maxX - b.minX) * this.miniPpm), Math.max(1, (b.maxZ - b.minZ) * this.miniPpm));
    }

    this.hud.banner(
      this.mode === 'br' ? 'SALTA!' : this.mode === 'squad' ? 'CONTRA SQUAD' : 'TREINO',
      this.mode === 'br' ? 'Guia a queda e aterra perto de loot' : this.mode === 'squad' ? 'Primeira equipa a 25 abates vence' : 'Alvos móveis · munição infinita',
      3,
    );
    if (this.mode === 'br') this.toast('PARAQUEDAS: ESPAÇO / SALTAR');
    this.onResize();
  }

  // =============================================================== setup helpers
  private respawn(a: Actor, initial = false) {
    let sp: THREE.Vector3;
    if (this.mode === 'squad') sp = pick(a.team === 0 ? this.world.spawnsA : this.world.spawnsB);
    else if (a.ai?.passive) sp = a.ai.home;
    else sp = this.world.spawnsA[0];
    a.pos.set(sp.x + (Math.random() - 0.5) * 3, 0, sp.z + (Math.random() - 0.5) * 3);
    a.pos.y = this.world.resolve(a.pos, RADIUS, 1.8);
    a.vel.set(0, 0, 0);
    a.hp = 100;
    a.alive = true;
    a.yaw = this.mode === 'squad' ? (a.team === 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI;
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
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (this.world.radius - 8);
      spots.push(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    }
    const wTable: WeaponId[] = ['smg', 'smg', 'ar', 'ar', 'ar', 'sg', 'sg', 'dmr', 'sr', 'lmg', 'smg', 'ar'];
    for (const s of spots) {
      if (Math.random() < 0.15) continue;
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
        const c1 = new THREE.Mesh(box(0.2, 0.06, 0.31), mat(0xe5383b));
        const c2 = new THREE.Mesh(box(0.06, 0.2, 0.31), mat(0xe5383b));
        m.add(c1, c2);
        ring = 0x2bd97c;
      } else if (kind === 'armor') {
        const col = [0, 0x6c8ca8, 0x8e5bd6, 0xe0a92e][n];
        m.add(new THREE.Mesh(box(0.45, 0.5, 0.18), mat(col)));
        m.add(new THREE.Mesh(box(0.3, 0.12, 0.2), mat(0x222222)));
        ring = col;
      } else if (kind === 'gel') {
        m.add(new THREE.Mesh(cyl(0.15, 0.15, 0.4, 8), mat(0x8fe3ff)));
        m.add(new THREE.Mesh(cyl(0.16, 0.16, 0.06, 8), mat(0x2b6f8a)));
        ring = 0x8fe3ff;
      } else {
        const s = new THREE.Mesh(sphere(0.15, 8, 6), mat(0x5c8a3a));
        m.add(s);
        m.add(new THREE.Mesh(box(0.08, 0.1, 0.08), mat(0x333333)).translateY(0.15));
        ring = 0xa3d977;
      }
      m.position.y = 0.4;
      g.add(m);
    }
    const r = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 20).rotateX(-Math.PI / 2), glow(ring));
    r.position.y = 0.04;
    g.add(r);
    g.position.copy(pos);
    this.scene.add(g);
    this.loot.push({ kind, wid, n, obj: g, pos: pos.clone(), alive: true, spin: Math.random() * 6 });
  }

  private removeLoot(l: Loot) {
    l.alive = false;
    this.scene.remove(l.obj);
    l.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.type === 'RingGeometry') m.geometry.dispose();
    });
  }

  private setupZone() {
    const z = this.zone;
    z.r = z.nr = this.world.radius * 1.3;
    this.zoneWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 90, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4a7dff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.zoneWall.position.y = 30;
    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, fog: false }));
    this.zoneRing.position.y = 0.15;
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
    const maxOff = z.phase === 0 ? this.world.radius - ph.r - 10 : z.r - ph.r;
    const a = Math.random() * Math.PI * 2, d = Math.random() * Math.max(0, maxOff) * 0.8;
    z.ncx = z.cx + Math.cos(a) * d;
    z.ncz = z.cz + Math.sin(a) * d;
    z.t = 0;
    z.shrinking = false;
    z.dps = ph.dps;
  }

  // =============================================================== main loop
  update(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);
    if (this.input.take('pause')) {
      if (!this.over) this.setPaused(!this.paused);
    }
    this.fpsAcc += rawDt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.hud.fps(profile.settings.showFps ? Math.round(this.fpsN / this.fpsAcc) : null);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    if (this.paused) {
      this.input.consumeLook();
      return;
    }
    this.time += dt;

    this.updatePlayer(dt);
    for (const a of this.actors) {
      if (!a.isPlayer) this.updateBot(a, dt);
      this.updateActor(a, dt);
    }
    this.updateLoot(dt);
    this.updateGels(dt);
    this.updateNades(dt);
    if (this.mode === 'br') this.updateZone(dt);
    this.fx.update(dt);
    this.updateCamera(dt);
    this.updateHud(dt);

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

  setPaused(p: boolean) {
    this.paused = p;
    this.pauseEl.classList.toggle('show', p);
    this.input.reset();
    if (p) document.exitPointerLock?.();
  }

  quit() {
    this.setPaused(false);
    this.finish({ ...this.makeResult(false), quit: true });
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

  private endMatch(win: boolean) {
    if (this.over) return;
    this.over = true;
    this.result = this.makeResult(win);
    this.endT = win ? 2.5 : 2.2;
    if (win) {
      sfx.booyah();
      this.hud.banner(this.mode === 'br' ? 'BOOYAH!' : 'VITÓRIA!', this.mode === 'br' ? 'Último sobrevivente' : `${this.scoreA} - ${this.scoreB}`, 3);
    } else {
      this.hud.banner(this.mode === 'br' ? 'ELIMINADO' : 'DERROTA', this.mode === 'br' ? `#${this.result.rank} de ${this.total}` : `${this.scoreA} - ${this.scoreB}`, 3);
    }
    document.exitPointerLock?.();
  }

  private finish(r: MatchResult) {
    this.input.enabled = false;
    this.opts.onEnd(r);
  }

  private toast(msg: string) {
    this.hud.center(msg);
    this.toastT = 1.6;
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
    const ads = inp.ads && !!def && !p.dropping && p.alive;
    const sens = (0.0009 + profile.settings.sens * 0.00042) * (ads && def ? def.adsFov / 72 : 1);
    if (p.alive) {
      p.yaw -= lx * sens;
      p.pitch = THREE.MathUtils.clamp(p.pitch - ly * sens, -1.25, 1.15);
    }
    if (!p.alive || this.over) {
      p.vel.x *= 0.9;
      p.vel.z *= 0.9;
      return;
    }

    // aim assist / magnetism
    this.assist = this.findAssist();
    if (this.assist && inp.fire && profile.settings.aimAssist > 0) {
      const t = this.assist.head ? this.assist.a.headPos(tA) : this.assist.a.chestPos(tA);
      tB.copy(this.camera.position);
      const dx = t.x - tB.x, dy = t.y - tB.y, dz = t.z - tB.z;
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const k = Math.min(1, dt * (2 + profile.settings.aimAssist * 2.2));
      p.yaw += angDiff(wantYaw, p.yaw) * k;
      p.pitch += (wantPitch - p.pitch) * k * 0.7;
    }

    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = -fz, rz = fx;
    const wx = fx * inp.my + rx * inp.mx;
    const wz = fz * inp.my + rz * inp.mx;

    if (p.dropping) {
      if (inp.take('jump') && !p.glide && p.pos.y - p.ground < 100) this.openChute(p);
      if (!p.glide && p.pos.y - p.ground < 38) this.openChute(p);
      const hs = p.glide ? 9 : 17;
      p.vel.x += (wx * hs - p.vel.x) * Math.min(1, dt * 3);
      p.vel.z += (wz * hs - p.vel.z) * Math.min(1, dt * 3);
      p.vel.y = p.glide ? -6.5 : -28;
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
    if (p.dashT <= 0) {
      const acc = p.onGround ? 16 : 5;
      p.vel.x += (wx * speed - p.vel.x) * Math.min(1, dt * acc);
      p.vel.z += (wz * speed - p.vel.z) * Math.min(1, dt * acc);
    }

    // weapon actions
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
    if (inp.take('gel')) this.placeGel(p);
    if (inp.take('nade')) this.throwNade(p, this.camFwd(tA));
    if (inp.take('heal')) this.startHeal(p);
    if (inp.take('ability')) this.useAbility(p);
    const pickup = inp.take('pickup');

    if (inp.fire) {
      if (p.healT > 0) p.healT = 0;
      this.playerShoot(ads);
    } else this.semiLatch = false;

    // nearby loot
    let near: Loot | null = null;
    let nd = 2.0;
    for (const l of this.loot) {
      if (!l.alive) continue;
      const d = Math.hypot(l.pos.x - p.pos.x, l.pos.z - p.pos.z);
      if (d > 2 || Math.abs(l.pos.y - p.pos.y) > 1.6) continue;
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
      if (!e.alive || e.team === p.team || e.dropping) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > range) continue;
      e.chestPos(tA).sub(cam);
      const len = tA.length();
      const ang = Math.acos(THREE.MathUtils.clamp(tA.dot(f) / len, -1, 1));
      const allowed = cone * (1 + 4 / Math.max(2, d));
      if (ang > allowed || ang > bestA * (1 + 4 / Math.max(2, d))) continue;
      tA.divideScalar(len);
      const t = this.world.raycast(cam, tA, len);
      if (t < len - 0.4) continue;
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
      if (!e.alive || e.team === s.team || e.dropping) continue;
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
    if (tracer) this.fx.tracer(muzzle, hit, s.isPlayer ? 0xffe28a : 0xff9a6b);
    if (victim) {
      const dist = s.pos.distanceTo(victim.pos);
      const fall = dist > def.range * 0.5 ? THREE.MathUtils.lerp(1, 0.55, Math.min(1, (dist - def.range * 0.5) / (def.range * 0.5))) : 1;
      const dmg = def.dmg * (head ? def.head : 1) * fall * (s.furyT > 0 ? 1.1 : 1);
      this.hurt(victim, dmg, s, head, def.name);
      this.fx.burst(hit, head ? 0xffd34d : 0xff3b3b, 5, 3, 0.07);
    } else if (best < maxT) {
      if (wall && best === tw) this.damageWall(wall, def.dmg);
      this.fx.burst(hit, wall && best === tw ? 0xbff3ff : 0xd8c8a8, 3, 2.5, 0.06);
    }
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

  private placeGel(a: Actor, yawOverride?: number) {
    if (a.gel <= 0 || a.dropping || !a.alive) return;
    const yaw = yawOverride ?? a.yaw;
    const x = a.pos.x + Math.sin(yaw) * 1.7, z = a.pos.z + Math.cos(yaw) * 1.7;
    const gy = this.world.groundAt(x, z, a.pos.y + 0.6);
    const wall = this.world.addWall(x, gy, z, yaw, 1.8, 0.22, 2.5, 260);
    const mesh = new THREE.Mesh(this.gelGeo, this.gelMat);
    mesh.position.set(x, gy, z);
    mesh.rotation.y = yaw;
    mesh.scale.y = 0.05;
    this.scene.add(mesh);
    this.gels.push({ wall, mesh, life: 25, grow: 0 });
    a.gel--;
    const d = a.pos.distanceTo(this.camera.position);
    if (d < 50) sfx.gel();
    this.fx.burst(tA.set(x, gy + 0.3, z), 0xbff3ff, 10, 3, 0.12, 8, 0.5);
  }

  private damageWall(w: Wall, dmg: number) {
    w.hp -= dmg;
    if (w.hp <= 0) {
      const g = this.gels.find((x) => x.wall === w);
      if (g) this.breakGel(g);
    }
  }

  private breakGel(g: Gel) {
    this.world.removeWall(g.wall);
    this.scene.remove(g.mesh);
    this.gels.splice(this.gels.indexOf(g), 1);
    this.fx.burst(tA.set(g.wall.x, g.wall.y0 + 1.2, g.wall.z), 0xbff3ff, 22, 5, 0.16, 12, 0.7);
    if (g.mesh.position.distanceTo(this.camera.position) < 40) sfx.gelBreak();
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
      took = `+${l.n} PAREDE DE GEL`;
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
    if (by) {
      by.damage += d;
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
    if (by?.isPlayer) {
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
    if (by && by !== v) by.kills++;
    const p = this.player;
    const allyRel = v.team === p.team ? -1 : by && by.team === p.team ? 1 : 0;
    this.hud.kill(by ? by.name : 'ZONA', v.name, label, head, v.isPlayer || !!by?.isPlayer, this.mode === 'squad' ? allyRel : 0);
    this.fx.burst(v.chestPos(tA), 0xff3b3b, 14, 4, 0.1);
    if (by?.isPlayer && v !== by) {
      sfx.kill();
      this.streak = this.streakT > 0 ? this.streak + 1 : 1;
      this.streakT = 4;
      const labels = ['', 'ABATE', 'ABATE DUPLO', 'ABATE TRIPLO', 'MASSACRE', 'IMPARÁVEL'];
      this.hud.banner(labels[Math.min(5, this.streak)], `${v.name}${head ? ' · TIRO NA CABEÇA' : ''}`, 1.4);
    }

    if (this.mode === 'br') {
      for (let i = 0; i < 2; i++) {
        const s = v.slots[i];
        if (s) this.addLoot('weapon', tA.copy(v.pos).add(tB.set(Math.random() - 0.5, 0, Math.random() - 0.5)).clone(), 1, s.id);
      }
      if (v.meds > 0) this.addLoot('med', tA.copy(v.pos).add(tB.set(0.8, 0, 0.5)).clone(), Math.min(3, v.meds));
      if (v.gel > 0) this.addLoot('gel', tA.copy(v.pos).add(tB.set(-0.7, 0, 0.6)).clone(), Math.min(5, v.gel));
      if (v.armor > 0) this.addLoot('armor', tA.copy(v.pos).add(tB.set(0.2, 0, -0.9)).clone(), v.armor);
      const alive = this.actors.filter((a) => a.alive);
      if (v.isPlayer) this.endMatch(false);
      else if (alive.length === 1 && alive[0].isPlayer) this.endMatch(true);
      else this.toast(`${alive.length} VIVOS`);
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
    if (!a.alive) {
      a.deathT += dt;
      rig.root.rotation.x = Math.max(-Math.PI / 2, -a.deathT * 5);
      if (this.mode === 'br' && a.deathT > 4) rig.root.visible = false;
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

    // shield aura
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
    if (a.dropping) a.vel.y = a.glide ? -6.5 : Math.max(a.vel.y, -28);
    a.pos.addScaledVector(a.vel, dt);
    const g = this.world.resolve(a.pos, RADIUS, a.height);
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
        if (a.isPlayer) this.hud.banner('ATERRASTE', 'Procura armas e equipamento', 1.8);
      }
    } else if (a.onGround && a.vel.y <= 0 && a.pos.y - g < 0.5) {
      a.pos.y = g;
      a.vel.y = 0;
    } else a.onGround = false;

    a.speedNow = Math.hypot(a.vel.x, a.vel.z);
    if (a.isPlayer && a.onGround && a.speedNow > 2) {
      a.stepT -= dt * (a.speedNow / 5);
      if (a.stepT <= 0) {
        a.stepT = 0.36;
        sfx.step();
      }
    }

    rig.root.position.copy(a.pos);
    rig.root.rotation.y = a.yaw;
    const cam = this.camera.position;
    const dc = Math.abs(a.pos.x - cam.x) + Math.abs(a.pos.z - cam.z);
    const visible = a.isPlayer || dc < (this.scene.fog as THREE.Fog).far * 1.2;
    rig.root.visible = visible && !(a.isPlayer && this.scoped);
    if (visible) {
      const w = a.weapon;
      rig.update(dt, {
        speed: a.speedNow,
        crouch: a.crouch,
        air: !a.onGround,
        pitch: a.pitch,
        reload: a.reloadT > 0 && w ? 1 - a.reloadT / WEAPONS[w.id].reload : 0,
        glide: a.glide || (a.dropping && !a.glide),
        dead: false,
      }, g);
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
      if (!b.glide && b.pos.y - b.ground < 30 + Math.random() * 10) this.openChute(b);
      b.vel.x *= 0.98;
      b.vel.z *= 0.98;
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
      ai.think = 0.22 + Math.random() * 0.12;
      this.botThink(b);
    }

    // ---- movement
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
      const fwd = dist > pref + 5 ? 1 : dist < pref - 5 ? -0.7 : 0;
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

    // ---- obstacle steering
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

    let speed = SPEED * (def ? def.moveMul : 1) * (b.crouch ? 0.45 : 1) * (b.healT > 0 ? 0.3 : 1) * (b.furyT > 0 ? 1.2 : 1) * (ai.visible ? 0.8 : 0.92);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) speed /= ml;
    if (b.dashT <= 0) {
      const acc = b.onGround ? 10 : 3;
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
    const detect = (this.mode === 'br' ? 48 : 75) * cfg.detect;
    // pick target
    const cands: [number, Actor][] = [];
    for (const e of this.actors) {
      if (!e.alive || e.team === b.team || e.dropping || e === b) continue;
      const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) * (e.isPlayer || this.mode !== 'br' ? 1 : 1.5);
      if (d > detect && !(e.firedT > 0 && d < detect * 1.4)) continue;
      const ang = Math.abs(angDiff(Math.atan2(e.pos.x - b.pos.x, e.pos.z - b.pos.z), b.yaw));
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
        if (e !== prev) ai.react = cfg.react * (0.7 + Math.random() * 0.6) / ai.skill;
        break;
      }
    }
    if (!ai.visible && ai.target && (!ai.target.alive || ai.seenT <= 0)) ai.target = null;

    // tactics
    const t = ai.target;
    if (t && ai.visible) {
      const d = b.pos.distanceTo(t.pos);
      if (b.hp < 45 && b.gel > 0 && ai.gelT <= 0 && Math.random() < 0.55) {
        this.placeGel(b, Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z));
        ai.gelT = 6;
        if (b.meds > 0) this.startHeal(b);
      }
      if (b.nades > 0 && d > 9 && d < 26 && Math.random() < 0.035) {
        const dir = tC.set(t.pos.x - b.pos.x, 0, t.pos.z - b.pos.z).normalize();
        dir.y = 0.35;
        this.throwNade(b, dir.normalize(), Math.min(18, 7 + d * 0.45));
      }
      if (b.abilityCd <= 0 && Math.random() < 0.25) {
        const id = b.hero.ability.id;
        if ((id === 'heal' && b.hp < 60) || (id === 'shield' && b.hp < 75) || (id === 'fury' && d < 30) || (id === 'dash' && d > 15) || id === 'reveal') this.useAbility(b);
      }
      // better weapon for the range
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

    // non-combat goals
    if (!ai.goal || Math.random() < 0.02) {
      if (this.mode === 'br') {
        const z = this.zone;
        const dz = Math.hypot(b.pos.x - z.ncx, b.pos.z - z.ncz);
        if (dz > z.nr * 0.8 || Math.hypot(b.pos.x - z.cx, b.pos.z - z.cz) > z.r * 0.9) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * z.nr * 0.5;
          ai.goal = new THREE.Vector3(z.ncx + Math.cos(a) * r, 0, z.ncz + Math.sin(a) * r);
        } else {
          const needW = !b.slots[0] || !b.slots[1];
          let best: Loot | null = null, bd = needW ? 60 : 35;
          for (const l of this.loot) {
            if (!l.alive) continue;
            if (l.kind === 'weapon' && !needW && WEAPONS[l.wid!].tier <= Math.max(...b.slots.map((s) => (s ? WEAPONS[s.id].tier : 0)))) continue;
            if (l.kind === 'armor' && l.n <= b.armor) continue;
            const d = l.pos.distanceTo(b.pos);
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
        if (enemies.length && Math.random() < 0.55) {
          const e = pick(enemies);
          ai.goal = new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 16, 0, e.pos.z + (Math.random() - 0.5) * 16);
        } else ai.goal = new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 50);
      }
    }

    // loot pickup in reach
    if (this.mode === 'br') {
      for (const l of this.loot) {
        if (!l.alive || l.pos.distanceTo(b.pos) > 1.8) continue;
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
    const cfg = DIFF[this.diff];
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
      const hit = Math.random() < acc * (def.pellets > 1 ? 1.3 : 1);
      if (hit) {
        anyHit = true;
        const head = Math.random() < (this.diff === 'hard' ? 0.2 : 0.12);
        const fall = dist > def.range * 0.5 ? 0.7 : 1;
        const botVsBot = t.isPlayer ? 1 : this.mode === 'br' ? 0.4 : 0.6;
        this.hurt(t, def.dmg * (head ? def.head : 1) * fall * cfg.dmg * botVsBot, b, head, def.name);
        if (!t.alive) break;
      }
    }
    const end = chest.clone();
    if (!anyHit) end.add(tA.set((Math.random() - 0.5) * 2.2, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 2.2));
    this.fx.tracer(muzzle, end, 0xff9a6b);
    const dc = muzzle.distanceTo(this.camera.position);
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
      const near = Math.abs(l.pos.x - c.x) + Math.abs(l.pos.z - c.z) < 70;
      l.obj.visible = near;
      if (!near) continue;
      l.spin += dt;
      const inner = l.obj.children[0];
      inner.rotation.y = l.spin * 1.2;
      inner.position.y = (l.kind === 'weapon' ? 0.35 : 0.4) + Math.sin(l.spin * 2.4) * 0.08;
    }
    if (this.loot.length > 220) this.loot = this.loot.filter((l) => l.alive);
  }

  private updateGels(dt: number) {
    for (let i = this.gels.length - 1; i >= 0; i--) {
      const g = this.gels[i];
      g.life -= dt;
      if (g.grow < 1) {
        g.grow = Math.min(1, g.grow + dt * 7);
        g.mesh.scale.y = 0.05 + g.grow * 0.95;
      }
      if (g.life <= 0) this.breakGel(g);
    }
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
    const dc = n.pos.distanceTo(this.camera.position);
    if (dc < 80) sfx.boom();
    if (dc < 20) this.shake = Math.max(this.shake, 1.2 * (1 - dc / 20));
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.team === n.owner.team && a !== n.owner) continue;
      const d = a.chestPos(tB).distanceTo(n.pos);
      if (d < R) this.hurt(a, 105 * (1 - d / R) * (a === n.owner ? 0.5 : 1), n.owner, false, 'GRANADA');
    }
    for (const g of [...this.gels]) if (Math.hypot(g.wall.x - n.pos.x, g.wall.z - n.pos.z) < R) this.damageWall(g.wall, 300);
  }

  private updateZone(dt: number) {
    const z = this.zone;
    const ph = ZONE_PHASES[z.phase];
    const landed = this.time > 14;
    if (ph && landed) {
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
      if (!a.alive || a.dropping) continue;
      if (Math.hypot(a.pos.x - z.cx, a.pos.z - z.cz) > z.r) {
        a.hp -= z.dps * dt;
        if (a.isPlayer && Math.random() < dt * 2) this.hud.hurtDir(Math.PI);
        if (a.hp <= 0) this.die(a, null, false, 'ZONA');
      }
    }
    const r = Math.max(0.1, z.r);
    this.zoneWall!.position.set(z.cx, 30, z.cz);
    this.zoneWall!.scale.set(r, 1, r);
    this.zoneRing!.position.set(z.ncx, 0.15, z.ncz);
    this.zoneRing!.scale.set(Math.max(0.1, z.nr), 1, Math.max(0.1, z.nr));
    this.zoneRing!.visible = !!ph && z.nr < z.r - 0.5;
  }

  // =============================================================== camera & hud
  private get scoped() {
    const p = this.player;
    const w = p.weapon;
    return !!w && WEAPONS[w.id].scope && this.input.ads && p.alive && !p.dropping;
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
      const k = this.shake * (profile.settings.quality === 'low' ? 0.05 : 0.07);
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

  private project(v: THREE.Vector3): { x: number; y: number } | null {
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
    h.vitals(p.hp, p.armor, p.shieldT > 0);
    h.weapons(p.slots, p.cur, p.reloadT > 0);
    h.counts(p.meds, p.gel, p.nades);
    h.ability(ABIL_ICON[p.hero.ability.id], 1 - p.abilityCd / p.hero.ability.cd);
    h.healing(p.healT > 0 ? 1 - p.healT / 2.2 : 0);
    const w = p.weapon;
    const def = w ? WEAPONS[w.id] : null;
    const ads = this.input.ads;
    const moving = p.speedNow > 1.5;
    const spread = def ? (ads ? def.adsSpread : def.spread) * (moving ? 1.35 : 1) * (p.onGround ? 1 : 1.8) * (p.crouch ? 0.7 : 1) : 0.02;
    h.crosshair(4 + spread * 520 + (p.cd > 0 ? 3 : 0), !this.scoped && p.alive && !p.dropping, !!this.assist);
    h.scope(this.scoped);

    const alive = this.actors.filter((a) => a.alive).length;
    h.text('#tsAlive b', alive);
    h.text('#tsKills b', p.kills);
    if (this.mode === 'br') {
      const z = this.zone;
      const ph = ZONE_PHASES[z.phase];
      const txt = !ph ? 'FINAL' : this.time <= 14 ? '--' : z.shrinking ? 'A FECHAR' : fmt(ph.wait - z.t);
      h.text('#tsZone b', txt);
      h.toggle('#tsZone', 'warn', z.shrinking);
      const out = Math.hypot(p.pos.x - z.cx, p.pos.z - z.cz) > z.r;
      h.toggle('#tsZone', 'out', out && p.alive);
    } else if (this.mode === 'squad') {
      h.text('#tsScore .a', this.scoreA);
      h.text('#tsScore .f', this.scoreB);
      h.text('#tsTime', fmt(Math.max(0, 300 - this.time)));
    }
    if (!p.alive && this.mode === 'squad' && p.respawnT > 0) h.center(`RENASCES EM ${Math.ceil(p.respawnT)}`);
    else if (p.dropping) h.center(p.glide ? '' : `QUEDA LIVRE · ${Math.round(p.pos.y)} m`);

    // tags
    this.tagTimer -= dt;
    const recheck = this.tagTimer <= 0;
    if (recheck) this.tagTimer = 0.25;
    let n = 0;
    for (const a of this.actors) {
      if (a.isPlayer || !a.alive) continue;
      const d = a.pos.distanceTo(p.pos);
      const ally = a.team === p.team;
      if (d > (ally ? 120 : 55) && !(p.revealT > 0 && d < 60)) continue;
      if (!ally && recheck) a.seen = p.revealT > 0 || this.canSee(p, a);
      if (!ally && !a.seen) continue;
      const s = this.project(tA.set(a.pos.x, a.pos.y + 2.1 * a.rig.root.scale.y, a.pos.z));
      if (!s) continue;
      h.tag(n++, s.x, s.y, a.name, a.hp, ally ? 'ally' : 'enemy', !ally || a.hp < 100);
    }
    h.hideTags(n);

    this.drawMinimap();
  }

  private drawMinimap() {
    const c = this.hud.mini;
    const p = this.player;
    const S = 150, H = 75;
    const view = this.mode === 'br' ? (p.dropping ? 110 : 60) : 45;
    const k = H / view;
    const W = this.world.radius + 10;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(H, H, H, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1d6f9c';
    c.fillRect(0, 0, S, S);
    c.translate(H, H);
    c.rotate(p.yaw + Math.PI);
    c.scale(k, k);
    c.translate(-p.pos.x, -p.pos.z);
    c.drawImage(this.miniBase, -W, -W, W * 2, W * 2);
    if (this.mode === 'br') {
      const z = this.zone;
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
    }
    const dot = 3.4 / k;
    for (const a of this.actors) {
      if (a.isPlayer || !a.alive) continue;
      const ally = a.team === p.team;
      const d = a.pos.distanceTo(p.pos);
      if (!ally && !(a.firedT > 0 && d < 70) && !(p.revealT > 0 && d < 60)) continue;
      c.fillStyle = ally ? '#3fa9ff' : '#ff3b4e';
      c.beginPath();
      c.arc(a.pos.x, a.pos.z, dot, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // player arrow
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
      const th = p.yaw + Math.PI;
      nEl.style.transform = `translate(${Math.sin(th) * 64}px, ${-Math.cos(th) * 64}px)`;
    }
  }

  dispose() {
    this.input.dispose();
    this.hud.dispose();
    this.pauseEl.remove();
    for (const a of this.actors) a.rig.dispose();
    this.world.dispose();
    this.fx.dispose();
    this.gelGeo.dispose();
    this.gelMat.dispose();
    this.auraGeo.dispose();
    this.auraMat.dispose();
    this.nadeGeo.dispose();
    this.zoneWall?.geometry.dispose();
    (this.zoneWall?.material as THREE.Material | undefined)?.dispose();
    this.zoneRing?.geometry.dispose();
    (this.zoneRing?.material as THREE.Material | undefined)?.dispose();
    for (const l of this.loot) if (l.alive) this.removeLoot(l);
  }
}

function fmt(s: number) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
