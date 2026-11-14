import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLOO_SKINS } from '../data';
import { sfx } from '../audio';
import type { World, Wall } from './world';
import type { Fx } from './fx';

const SEGS = 7;
const RAD = 3.4;
const SPAN = 1.3;
const HGT = 2.5;
const THK = 0.5;
const SEG_W = 2 * RAD * Math.sin(SPAN / (2 * SEGS)) + 0.14;
const GROW = 0.2;
export const GLOO_HP = 300;

interface Seg { body: THREE.Mesh; cap: THREE.Mesh; wall: Wall | null; delay: number; x: number; y: number; z: number; yaw: number; hs: number }
export interface GlooGroup { id: number; hp: number; segs: Seg[]; life: number; skin: string; x: number; y: number; z: number; yaw: number; age: number; dying: number; ownerTeam: number }
interface Can { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; skin: string; t: number; team: number }
export interface GlooEvent { kind: 'spawn' | 'end'; id: number; x: number; y: number; z: number; yaw: number; skin: string }

const tmp = new THREE.Vector3();
const backOut = (t: number) => {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class Gloo {
  groups: GlooGroup[] = [];
  private cans: Can[] = [];
  private scene: THREE.Scene;
  private world: World;
  private fx: Fx;
  private seq = 0;
  private bodyGeo: THREE.BufferGeometry;
  private capGeo: THREE.BufferGeometry;
  private canGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.34, 8);
  private mats = new Map<string, { body: THREE.Material; cap: THREE.Material }>();
  private ghosts = new Map<number, THREE.Group>();
  onEvent: ((e: GlooEvent) => void) | null = null;

  constructor(scene: THREE.Scene, world: World, fx: Fx) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    const body = new THREE.BoxGeometry(SEG_W, HGT - 0.28, THK).translate(0, (HGT - 0.28) / 2, 0);
    const bevel = new THREE.BoxGeometry(SEG_W - 0.1, 0.16, THK + 0.08).translate(0, 0.08, 0);
    this.bodyGeo = mergeGeometries([body, bevel], false)!;
    body.dispose();
    bevel.dispose();
    this.capGeo = new THREE.CapsuleGeometry(0.29, SEG_W - 0.58, 3, 8).rotateZ(Math.PI / 2).translate(0, HGT - 0.28, 0);
  }

  private mat(skin: string) {
    let m = this.mats.get(skin);
    if (!m) {
      const s = GLOO_SKINS.find((x) => x.id === skin) || GLOO_SKINS[0];
      m = {
        body: new THREE.MeshLambertMaterial({ color: s.body, emissive: s.emissive, transparent: s.opacity < 1, opacity: s.opacity }),
        cap: new THREE.MeshLambertMaterial({ color: s.cap, emissive: s.emissive, emissiveIntensity: 0.6 }),
      };
      this.mats.set(skin, m);
    }
    return m;
  }

  private color(skin: string) {
    return (GLOO_SKINS.find((x) => x.id === skin) || GLOO_SKINS[0]).body;
  }

  /** Throw a canister; the wall deploys where it lands, curving around the thrower. */
  throw(from: THREE.Vector3, yaw: number, skin: string, team: number) {
    const mesh = new THREE.Mesh(this.canGeo, this.mat(skin).cap);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const vel = new THREE.Vector3(Math.sin(yaw) * 8, 3.4, Math.cos(yaw) * 8);
    this.cans.push({ mesh, pos: from.clone(), vel, yaw, skin, t: 0, team });
  }

  private deploy(x: number, z: number, y: number, yaw: number, skin: string, team: number, id = ++this.seq, silent = false): GlooGroup {
    const g: GlooGroup = { id, hp: GLOO_HP, segs: [], life: 25, skin, x, y, z, yaw, age: 0, dying: 0, ownerTeam: team };
    const ox = x - Math.sin(yaw) * RAD, oz = z - Math.cos(yaw) * RAD;
    const m = this.mat(skin);
    for (let i = 0; i < SEGS; i++) {
      const a = -SPAN / 2 + ((i + 0.5) * SPAN) / SEGS;
      const sx = ox + Math.sin(yaw + a) * RAD, sz = oz + Math.cos(yaw + a) * RAD;
      const sy = this.world.groundAt(sx, sz, y + 1.2);
      const body = new THREE.Mesh(this.bodyGeo, m.body);
      const cap = new THREE.Mesh(this.capGeo, m.cap);
      const hs = 0.92 + ((i * 37) % 10) / 60;
      for (const o of [body, cap]) {
        o.position.set(sx, sy - 0.05, sz);
        o.rotation.y = yaw + a;
        o.scale.set(0.7, 0.02, 0.7);
        this.scene.add(o);
      }
      const wall = this.world.addWall(sx, sy - 0.3, sz, yaw + a, SEG_W / 2, THK / 2, HGT * hs + 0.3, g);
      g.segs.push({ body, cap, wall, delay: Math.abs(i - (SEGS - 1) / 2) * 0.035, x: sx, y: sy, z: sz, yaw: yaw + a, hs });
    }
    this.groups.push(g);
    if (!silent) {
      this.fx.burst(tmp.set(x, y + 0.4, z), this.color(skin), 18, 4, 0.14, 9, 0.6);
      this.onEvent?.({ kind: 'spawn', id, x, y, z, yaw, skin });
    }
    return g;
  }

  /** Deploy immediately in front of an actor (used when no space to throw). */
  place(x: number, z: number, y: number, yaw: number, skin: string, team: number) {
    sfx.gel();
    return this.deploy(x, z, y, yaw, skin, team);
  }

  damage(w: Wall, dmg: number) {
    const g = w.group as GlooGroup;
    g.hp -= dmg;
    if (g.hp <= 0 && !g.dying) this.shatter(g);
  }

  private shatter(g: GlooGroup) {
    g.dying = 0.001;
    g.hp = 0;
    const c = this.color(g.skin);
    for (const s of g.segs) {
      this.fx.burst(tmp.set(s.x, s.y + 1.2, s.z), c, 6, 5, 0.18, 14, 0.7);
      if (s.wall) this.world.removeWall(s.wall);
      s.wall = null;
    }
    sfx.gelBreak();
  }

  private remove(g: GlooGroup) {
    for (const s of g.segs) {
      this.scene.remove(s.body, s.cap);
      if (s.wall) this.world.removeWall(s.wall);
    }
    this.groups.splice(this.groups.indexOf(g), 1);
    this.onEvent?.({ kind: 'end', id: g.id, x: g.x, y: g.y, z: g.z, yaw: g.yaw, skin: g.skin });
  }

  update(dt: number, camPos: THREE.Vector3) {
    for (let i = this.cans.length - 1; i >= 0; i--) {
      const c = this.cans[i];
      c.t += dt;
      c.vel.y -= 22 * dt;
      const step = c.vel.length() * dt;
      tmp.copy(c.vel).normalize();
      const hit = this.world.raycast(c.pos, tmp, step + 0.2) < step + 0.2;
      c.pos.addScaledVector(c.vel, dt);
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.x += dt * 14;
      const gy = this.world.groundAt(c.pos.x, c.pos.z, c.pos.y + 0.6);
      if (c.pos.y <= gy + 0.12 || hit || c.t > 0.9) {
        this.scene.remove(c.mesh);
        this.cans.splice(i, 1);
        const y = this.world.groundAt(c.pos.x, c.pos.z, c.pos.y + 0.8);
        if (c.pos.distanceTo(camPos) < 60) sfx.gel();
        this.deploy(c.pos.x, c.pos.z, y, c.yaw, c.skin, c.team);
      }
    }
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      g.age += dt;
      g.life -= dt;
      if (g.life <= 0 && !g.dying) {
        g.dying = 0.001;
        for (const s of g.segs) if (s.wall) this.world.removeWall(s.wall), (s.wall = null);
      }
      if (g.dying) {
        g.dying += dt;
        const k = Math.max(0, 1 - g.dying / 0.25);
        for (const s of g.segs) {
          s.body.scale.y = s.cap.scale.y = Math.max(0.01, k * s.hs);
        }
        if (g.dying > 0.25) this.remove(g);
        continue;
      }
      this.animate(g.segs, g.age);
    }
  }

  private animate(segs: Seg[], age: number) {
    for (const s of segs) {
      const t = Math.max(0, Math.min(1, (age - s.delay) / GROW));
      const sy = Math.max(0.02, backOut(t)) * s.hs;
      const sxz = 0.7 + 0.3 * Math.min(1, t * 1.4);
      s.body.scale.set(sxz, sy, sxz);
      s.cap.scale.set(sxz, sy, sxz);
    }
  }

  /** Replay view: show walls from recorded events instead of live ones. */
  showReplay(items: { id: number; x: number; y: number; z: number; yaw: number; skin: string; age: number }[] | null) {
    const live = items === null;
    for (const g of this.groups) for (const s of g.segs) s.body.visible = s.cap.visible = live;
    for (const c of this.cans) c.mesh.visible = live;
    const keep = new Set<number>();
    if (items)
      for (const it of items) {
        keep.add(it.id);
        let gr = this.ghosts.get(it.id);
        if (!gr) {
          gr = new THREE.Group();
          const tmpG = this.deploy(it.x, it.z, it.y, it.yaw, it.skin, -1, -1, true);
          for (const s of tmpG.segs) {
            this.scene.remove(s.body, s.cap);
            if (s.wall) this.world.removeWall(s.wall);
            gr.add(s.body, s.cap);
          }
          this.groups.splice(this.groups.indexOf(tmpG), 1);
          gr.userData.segs = tmpG.segs;
          this.scene.add(gr);
          this.ghosts.set(it.id, gr);
        }
        for (const s of gr.userData.segs as Seg[]) s.wall = null;
        this.animate(gr.userData.segs as Seg[], it.age);
      }
    for (const [id, gr] of this.ghosts)
      if (!keep.has(id)) {
        this.scene.remove(gr);
        this.ghosts.delete(id);
      }
  }

  dispose() {
    this.bodyGeo.dispose();
    this.capGeo.dispose();
    this.canGeo.dispose();
    for (const m of this.mats.values()) {
      m.body.dispose();
      m.cap.dispose();
    }
  }
}
