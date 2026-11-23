import * as THREE from 'three';
import { HERO_BY_ID, WEAPONS, type HeroDef, type Outfit, type WeaponId } from '../data';
import { CharacterRig } from '../models/character';

export interface WSlot { id: WeaponId; skin: string; mag: number }

export interface AiState {
  target: Actor | null;
  lastSeen: THREE.Vector3;
  seenT: number;
  think: number;
  strafe: number;
  strafeT: number;
  react: number;
  burst: number;
  burstPause: number;
  goal: THREE.Vector3 | null;
  goalT: number;
  stuckT: number;
  lastPos: THREE.Vector3;
  detour: number;
  detourT: number;
  crouchT: number;
  gelT: number;
  visible: boolean;
  passive: boolean;
  home: THREE.Vector3;
  skill: number;
}

export const RADIUS = 0.38;
export const HEIGHT = 1.8;

export class Actor {
  rig: CharacterRig;
  hero: HeroDef;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  ground = 0;
  onGround = true;
  crouch = false;
  hp = 100;
  armor = 0;
  alive = true;
  slots: (WSlot | null)[] = [null, null, null];
  cur = 2;
  reloadT = 0;
  cd = 0;
  meds = 0;
  gel = 0;
  nades = 0;
  healT = 0;
  abilityCd = 0;
  shieldT = 0;
  furyT = 0;
  revealT = 0;
  hotT = 0;
  invulnT = 0;
  firedT = 0;
  kills = 0;
  damage = 0;
  deathT = 0;
  respawnT = 0;
  dropping = false;
  glide = false;
  lastAttacker: Actor | null = null;
  ai: AiState | null = null;
  speedNow = 0;
  stepT = 0;
  dashT = 0;
  heat = 0;
  glooCd = 0;
  seen = false;
  seenT = 0;
  aura: THREE.Mesh | null = null;
  /** Non-null for an actor controlled by a remote human over WebRTC (its RoomNet peer id). */
  netId: string | null = null;
  semiLatch = false;

  id: number;
  name: string;
  team: number;
  isPlayer: boolean;

  constructor(id: number, name: string, team: number, heroId: string, outfit: Outfit, isPlayer = false) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.isPlayer = isPlayer;
    this.hero = HERO_BY_ID.get(heroId) || HERO_BY_ID.get('kai')!;
    this.rig = new CharacterRig(this.hero.id, outfit);
  }

  get weapon(): WSlot | null {
    return this.slots[this.cur];
  }

  get height() {
    return this.crouch ? 1.25 : HEIGHT;
  }

  equip(i: number) {
    if (!this.slots[i] || i === this.cur) return false;
    this.cur = i;
    this.reloadT = 0;
    this.cd = Math.max(this.cd, 0.25);
    const w = this.slots[i]!;
    this.rig.setWeapon(w.id, w.skin);
    return true;
  }

  give(i: number, id: WeaponId, skin = 'default') {
    this.slots[i] = { id, skin, mag: WEAPONS[id].mag };
    if (i === this.cur || !this.slots[this.cur]) {
      this.cur = i;
      this.rig.setWeapon(id, skin);
    }
  }

  headPos(out: THREE.Vector3) {
    const s = this.rig.root.scale.y;
    return out.set(this.pos.x, this.pos.y + (this.crouch ? 1.2 : 1.66) * s, this.pos.z);
  }

  chestPos(out: THREE.Vector3) {
    const s = this.rig.root.scale.y;
    return out.set(this.pos.x, this.pos.y + (this.crouch ? 0.85 : 1.2) * s, this.pos.z);
  }

  /** Ray hit test: returns distance along ray or Infinity; sets lastHead. */
  lastHead = false;
  rayHit(o: THREE.Vector3, d: THREE.Vector3, assist = 0): number {
    const s = this.rig.root.scale.y;
    const hy = this.pos.y + (this.crouch ? 1.2 : 1.66) * s;
    const th = raySphere(o, d, this.pos.x, hy, this.pos.z, 0.2 * s + assist * 0.3);
    const top = this.pos.y + (this.crouch ? 1.05 : 1.45) * s;
    const tb = rayCapsule(o, d, this.pos.x, this.pos.y + 0.15, this.pos.z, top, 0.34 * s + assist);
    if (th < tb && th < Infinity) {
      this.lastHead = true;
      return th;
    }
    this.lastHead = false;
    return tb;
  }
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}

function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, x: number, y0: number, z: number, y1: number, r: number): number {
  // vertical capsule: solve in XZ for infinite cylinder, then clamp to height, then cap spheres
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  let best = Infinity;
  if (a > 1e-8) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = o.y + d.y * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  if (best === Infinity) {
    best = Math.min(raySphere(o, d, x, y0, z, r), raySphere(o, d, x, y1, z, r));
  }
  return best;
}
