import * as THREE from 'three';
import { HERO_BY_ID, ITEM_BY_ID, type HeroDef, type Outfit, type WeaponId } from '../data';
import { bake, box, capsule, cone, cyl, glow, mat, part, sphere, torus } from './materials';
import { weaponMesh } from './weapon';

export interface RigState {
  speed: number;
  crouch: boolean;
  air: boolean;
  pitch: number;
  reload: number;
  glide: boolean;
  dead: boolean;
  vx?: number;
  vz?: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const shadowGeo = new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });

const tmpV = new THREE.Vector3();

export class CharacterRig {
  root = new THREE.Group();
  body = new THREE.Group();
  spine = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  foreL = new THREE.Group();
  foreR = new THREE.Group();
  handR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  shinL = new THREE.Group();
  shinR = new THREE.Group();
  mount = new THREE.Group();
  shadow: THREE.Mesh;
  weapon: THREE.Group | null = null;
  weaponId: WeaponId | null = null;
  chute: THREE.Group | null = null;
  outfitParts: THREE.Object3D[] = [];
  phase = Math.random() * 6;
  private amp = 0;
  private lowerYaw = NaN;
  private landT = 0;
  private wasAir = false;
  private shuffle = 0;
  /** True on the frame a foot touches the ground. */
  stepped = false;
  kick = 0;
  crouchT = 0;
  airT = 0;
  deadT = 0;
  hero: HeroDef;

  constructor(heroId: string, outfit: Outfit) {
    this.hero = HERO_BY_ID.get(heroId) || HERO_BY_ID.get('kai')!;
    const r = this.root;
    r.add(this.body);
    this.body.position.y = 0.92;
    this.body.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.add(this.head);
    this.head.position.y = 0.58;

    this.spine.add(this.armL, this.armR);
    this.armL.position.set(0.27, 0.47, 0);
    this.armR.position.set(-0.27, 0.47, 0);
    this.armL.add(this.foreL);
    this.armR.add(this.foreR);
    this.foreL.position.y = -0.3;
    this.foreR.position.y = -0.3;
    this.foreR.add(this.handR);
    this.handR.position.y = -0.27;

    this.body.add(this.legL, this.legR);
    this.legL.position.set(0.11, -0.04, 0);
    this.legR.position.set(-0.11, -0.04, 0);
    this.legL.add(this.shinL);
    this.legR.add(this.shinR);
    this.shinL.position.y = -0.43;
    this.shinR.position.y = -0.43;

    this.spine.add(this.mount);

    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = -1;
    r.add(this.shadow);

    this.root.rotation.order = 'YXZ';
    this.root.scale.setScalar(this.hero.build);
    this.dress(outfit);
    this.pose('rifle');
  }

  dress(outfit: Outfit) {
    this.disposeParts();
    const add = (parent: THREE.Object3D, ...a: Parameters<typeof part> extends [any, ...infer R] ? R : never) => {
      const m = part(parent, ...a);
      this.outfitParts.push(m);
      return m;
    };
    const h = this.hero;
    const SK = mat(h.skin);
    const HR = mat(h.hairColor);
    const it = (slot: keyof Outfit) => ITEM_BY_ID.get(outfit[slot]) || ITEM_BY_ID.get('head_none')!;
    const top = it('top');
    const bot = it('bottom');
    const shoe = it('shoes');
    const hat = it('head');
    const face = it('face');
    const back = it('back');
    const T1 = mat(top.c1);
    const T2 = mat(top.c2);
    const P1 = mat(bot.c1);
    const P2 = mat(bot.c2);

    // torso & pelvis
    add(this.body, box(0.36, 0.18, 0.22), P1, 0, 0, 0);
    add(this.spine, box(0.42, 0.5, 0.24), T1, 0, 0.27, 0);
    add(this.spine, box(0.46, 0.14, 0.26), T1, 0, 0.47, 0);
    add(this.spine, cyl(0.06, 0.07, 0.1, 7), SK, 0, 0.56, 0);

    if (top.style === 'jacket') {
      add(this.spine, box(0.14, 0.46, 0.02), T2, 0, 0.27, 0.125);
      add(this.spine, box(0.46, 0.06, 0.2), T1, 0, 0.55, -0.02, 0.3);
    } else if (top.style === 'hoodie') {
      add(this.spine, sphere(0.16, 10, 6, true), T1, 0, 0.53, -0.1, -0.6);
      add(this.spine, box(0.26, 0.12, 0.03), T2, 0, 0.15, 0.125);
      add(this.spine, box(0.012, 0.16, 0.012), T2, 0.05, 0.4, 0.125);
      add(this.spine, box(0.012, 0.16, 0.012), T2, -0.05, 0.4, 0.125);
    } else if (top.style === 'vest') {
      add(this.spine, box(0.46, 0.38, 0.3), T1, 0, 0.3, 0);
      add(this.spine, box(0.09, 0.1, 0.05), T2, -0.12, 0.2, 0.16);
      add(this.spine, box(0.09, 0.1, 0.05), T2, 0, 0.2, 0.16);
      add(this.spine, box(0.09, 0.1, 0.05), T2, 0.12, 0.2, 0.16);
    } else {
      add(this.spine, box(0.2, 0.06, 0.02), T2, 0, 0.36, 0.125);
    }
    if (top.glow) {
      add(this.spine, box(0.43, 0.02, 0.25), glow(top.glow), 0, 0.1, 0);
      add(this.spine, box(0.02, 0.4, 0.02), glow(top.glow), 0.2, 0.3, 0.12);
      add(this.spine, box(0.02, 0.4, 0.02), glow(top.glow), -0.2, 0.3, 0.12);
    }

    // arms
    const sleeveLong = top.style !== 'tee';
    for (const [arm, fore] of [[this.armL, this.foreL], [this.armR, this.foreR]] as const) {
      add(arm, capsule(0.07, 0.18), T1, 0, -0.14, 0);
      add(fore, capsule(0.06, 0.17), sleeveLong ? T1 : SK, 0, -0.12, 0);
      add(fore, sphere(0.06, 8, 6), SK, 0, -0.27, 0);
      if (top.glow) add(fore, torus(0.062, 0.012), glow(top.glow), 0, -0.2, 0, Math.PI / 2);
    }

    // legs
    const longPants = bot.style !== 'shorts';
    for (const [leg, shin, side] of [[this.legL, this.shinL, 1], [this.legR, this.shinR, -1]] as const) {
      add(leg, capsule(0.088, 0.26), P1, 0, -0.21, 0);
      add(shin, capsule(0.075, 0.26), longPants ? P1 : SK, 0, -0.2, 0);
      if (bot.style === 'cargo') add(leg, box(0.05, 0.12, 0.12), P2, side * 0.085, -0.22, 0);
      if (bot.style === 'shorts') add(leg, box(0.012, 0.3, 0.012), P2, side * 0.09, -0.2, 0);
      if (bot.glow) add(shin, box(0.014, 0.3, 0.014), glow(bot.glow), side * 0.075, -0.2, 0);
      const S1 = mat(shoe.c1);
      const S2 = mat(shoe.c2);
      if (shoe.style === 'boots') add(shin, box(0.15, 0.2, 0.17), S1, 0, -0.36, 0.01);
      add(shin, box(0.13, 0.09, 0.25), S1, 0, -0.43, 0.04);
      add(shin, box(0.135, 0.03, 0.26), shoe.glow ? glow(shoe.glow) : S2, 0, -0.475, 0.04);
    }

    // head
    const hd = this.head;
    add(hd, sphere(0.165, 12, 10), SK, 0, 0.16, 0).scale.set(1, 1.08, 1);
    add(hd, box(0.035, 0.045, 0.02), mat(0x16120f), 0.06, 0.17, 0.152);
    add(hd, box(0.035, 0.045, 0.02), mat(0x16120f), -0.06, 0.17, 0.152);
    add(hd, box(0.05, 0.014, 0.02), HR, 0.06, 0.215, 0.152, 0, 0, -0.12);
    add(hd, box(0.05, 0.014, 0.02), HR, -0.06, 0.215, 0.152, 0, 0, 0.12);
    add(hd, box(0.05, 0.012, 0.015), mat(0x8a4b3a), 0, 0.09, 0.155);

    const coversHair = hat.style === 'helmet' || hat.style === 'beanie';
    if (!coversHair) {
      switch (h.hair) {
        case 'short':
          add(hd, sphere(0.175, 12, 6, true), HR, 0, 0.18, -0.01).scale.set(1, 0.8, 1.02);
          add(hd, box(0.12, 0.05, 0.1), HR, 0.05, 0.31, 0.1, 0.5, 0, -0.3);
          break;
        case 'buzz':
          add(hd, sphere(0.169, 12, 6, true), HR, 0, 0.19, 0).scale.set(1, 0.7, 1);
          break;
        case 'ponytail':
          add(hd, sphere(0.177, 12, 6, true), HR, 0, 0.17, -0.01).scale.set(1, 0.85, 1.03);
          add(hd, capsule(0.05, 0.18), HR, 0, 0.12, -0.2, 0.4);
          break;
        case 'long':
          add(hd, sphere(0.178, 12, 6, true), HR, 0, 0.17, -0.01).scale.set(1, 0.9, 1.04);
          add(hd, box(0.32, 0.32, 0.08), HR, 0, 0.04, -0.13);
          break;
        case 'mohawk':
          add(hd, sphere(0.168, 12, 6, true), mat(0x2a1a14), 0, 0.18, 0).scale.set(1, 0.6, 1);
          add(hd, box(0.05, 0.12, 0.32), HR, 0, 0.32, -0.02);
          break;
      }
    }

    const C1 = mat(hat.c1);
    const C2 = mat(hat.c2);
    switch (hat.style) {
      case 'cap':
        add(hd, sphere(0.178, 12, 6, true), C1, 0, 0.2, 0).scale.set(1, 0.75, 1);
        add(hd, box(0.24, 0.02, 0.16), C1, 0, 0.21, 0.2, -0.1);
        add(hd, box(0.06, 0.05, 0.01), C2, 0, 0.27, 0.16, -0.4);
        break;
      case 'beanie':
        add(hd, sphere(0.182, 12, 6, true), C1, 0, 0.17, 0).scale.set(1, 1.1, 1);
        add(hd, cyl(0.185, 0.185, 0.06, 12), C2, 0, 0.18, 0);
        add(hd, sphere(0.05, 8, 6), C2, 0, 0.38, 0);
        break;
      case 'helmet':
        add(hd, sphere(0.2, 12, 6, true), C1, 0, 0.17, -0.01).scale.set(1, 0.95, 1.05);
        add(hd, box(0.42, 0.03, 0.3), C1, 0, 0.17, -0.02);
        add(hd, box(0.1, 0.06, 0.04), C2, 0, 0.3, 0.17);
        break;
      case 'bandana':
        add(hd, torus(0.168, 0.025), C1, 0, 0.25, 0, Math.PI / 2 - 0.15);
        add(hd, box(0.04, 0.14, 0.02), C1, 0.03, 0.18, -0.18, 0.3, 0, 0.3);
        add(hd, box(0.04, 0.12, 0.02), C1, -0.03, 0.18, -0.18, 0.3, 0, -0.3);
        break;
      case 'ears':
        for (const s of [1, -1]) {
          add(hd, cone(0.06, 0.13, 4), C1, s * 0.1, 0.34, 0, 0, 0, -s * 0.35);
          add(hd, cone(0.03, 0.08, 4), glow(hat.glow!), s * 0.1, 0.33, 0.025, 0, 0, -s * 0.35);
        }
        add(hd, torus(0.17, 0.012), C1, 0, 0.25, 0, Math.PI / 2 + 0.3);
        break;
      case 'crown': {
        add(hd, cyl(0.15, 0.13, 0.07, 10), C1, 0, 0.36, 0);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(hd, cone(0.03, 0.08, 4), C1, Math.sin(a) * 0.13, 0.43, Math.cos(a) * 0.13);
          add(hd, sphere(0.018, 6, 4), C2, Math.sin(a) * 0.14, 0.36, Math.cos(a) * 0.14);
        }
        break;
      }
    }

    const F1 = mat(face.c1);
    const F2 = mat(face.c2);
    switch (face.style) {
      case 'shades':
        add(hd, box(0.27, 0.06, 0.03), F1, 0, 0.17, 0.155);
        add(hd, box(0.3, 0.012, 0.012), F2, 0, 0.2, 0.16);
        break;
      case 'halfmask':
        add(hd, sphere(0.172, 10, 6), F1, 0, 0.1, 0.01).scale.set(1, 0.55, 1);
        add(hd, box(0.06, 0.04, 0.03), F2, 0, 0.07, 0.165);
        break;
      case 'skull':
        add(hd, sphere(0.17, 10, 8), F1, 0, 0.15, 0.025).scale.set(0.98, 1.05, 0.95);
        add(hd, box(0.05, 0.05, 0.02), F2, 0.06, 0.17, 0.18);
        add(hd, box(0.05, 0.05, 0.02), F2, -0.06, 0.17, 0.18);
        add(hd, box(0.1, 0.025, 0.02), F2, 0, 0.07, 0.175);
        break;
      case 'visor':
        add(hd, box(0.3, 0.07, 0.06), F1, 0, 0.17, 0.13);
        add(hd, box(0.28, 0.03, 0.02), glow(face.glow!), 0, 0.17, 0.165);
        break;
    }

    const K1 = mat(back.c1);
    const K2 = mat(back.c2);
    switch (back.style) {
      case 'pack':
        add(this.spine, box(0.3, 0.32, 0.14), K1, 0, 0.28, -0.19);
        add(this.spine, box(0.26, 0.1, 0.03), K2, 0, 0.2, -0.27);
        break;
      case 'packbig':
        add(this.spine, box(0.36, 0.44, 0.2), K1, 0, 0.26, -0.22);
        add(this.spine, cyl(0.07, 0.07, 0.38, 8), K2, 0, 0.52, -0.22, 0, 0, Math.PI / 2);
        add(this.spine, box(0.3, 0.12, 0.04), K2, 0, 0.14, -0.33);
        break;
      case 'katana':
        add(this.spine, box(0.03, 0.85, 0.05), mat(0xc8ccd2), 0, 0.3, -0.17, 0, 0, 0.7);
        add(this.spine, box(0.045, 0.25, 0.055), K2, 0.24, 0.56, -0.17, 0, 0, 0.7);
        add(this.spine, box(0.1, 0.02, 0.08), K1, 0.17, 0.48, -0.17, 0, 0, 0.7);
        break;
      case 'wings':
        for (const s of [1, -1]) {
          const w = add(this.spine, sphere(0.3, 10, 6), K1, s * 0.3, 0.42, -0.25, 0.2, s * 0.6, s * 0.5);
          w.scale.set(1.3, 0.55, 0.12);
          const w2 = add(this.spine, sphere(0.22, 8, 6), glow(back.glow!), s * 0.42, 0.3, -0.28, 0.2, s * 0.6, s * 0.8);
          w2.scale.set(1.2, 0.4, 0.08);
        }
        break;
    }

    this.outfitParts = [];
    for (const g of [this.body, this.spine, this.head, this.armL, this.armR, this.foreL, this.foreR, this.legL, this.legR, this.shinL, this.shinR])
      this.outfitParts.push(...bake(g));
  }

  private disposeParts() {
    for (const p of this.outfitParts) {
      p.parent?.remove(p);
      (p as THREE.Mesh).geometry?.dispose();
    }
    this.outfitParts = [];
  }

  dispose() {
    this.disposeParts();
    this.setChute(false);
  }

  pose(kind: 'rifle' | 'pistol') {
    if (kind === 'pistol') {
      this.armR.rotation.set(-1.45, 0, 0.32);
      this.foreR.rotation.set(-0.1, 0, 0);
      this.armL.rotation.set(-1.4, 0, -0.55);
      this.foreL.rotation.set(-0.15, 0, 0);
    } else {
      this.armR.rotation.set(-1.0, 0, 0.42);
      this.foreR.rotation.set(-0.85, 0, 0);
      this.armL.rotation.set(-1.25, 0, -0.62);
      this.foreL.rotation.set(-0.35, 0, 0);
    }
    this.spine.updateMatrixWorld(true);
    this.handR.getWorldPosition(tmpV);
    this.spine.worldToLocal(tmpV);
    this.mount.position.copy(tmpV);
    this.mount.position.y += 0.02;
    this.mount.userData.base = this.mount.position.clone();
  }

  setWeapon(id: WeaponId | null, skin = 'default') {
    if (this.weapon) this.mount.remove(this.weapon);
    this.weapon = null;
    this.weaponId = id;
    if (!id) return;
    this.weapon = weaponMesh(id, skin);
    this.mount.add(this.weapon);
    this.pose(id === 'pistol' ? 'pistol' : 'rifle');
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weapon) return this.head.getWorldPosition(out);
    out.set(0, 0.02, this.weapon.userData.muzzle as number);
    return this.weapon.localToWorld(out);
  }

  setChute(on: boolean) {
    if (on && !this.chute) {
      const c = new THREE.Group();
      const canopy = new THREE.Mesh(sphere(1.6, 12, 6, true), mat(0xff7a1a));
      canopy.scale.set(1.3, 0.45, 1);
      canopy.position.y = 2.9;
      c.add(canopy);
      const stripe = new THREE.Mesh(sphere(1.62, 12, 6, true), mat(0xffffff));
      stripe.scale.set(0.4, 0.46, 1.01);
      stripe.position.y = 2.9;
      c.add(stripe);
      for (const [x, z] of [[1.6, 0.8], [-1.6, 0.8], [1.6, -0.8], [-1.6, -0.8]]) {
        const l = new THREE.Mesh(box(0.015, 1.9, 0.015), mat(0x222222));
        l.position.set(x * 0.5, 2.0, z * 0.5);
        l.rotation.z = -x * 0.25;
        l.rotation.x = z * 0.3;
        c.add(l);
      }
      this.chute = c;
      this.root.add(c);
    } else if (!on && this.chute) {
      this.root.remove(this.chute);
      this.chute = null;
    }
  }

  update(dt: number, s: RigState, groundY: number) {
    const k = Math.min(1, dt * 12);
    this.crouchT += ((s.crouch ? 1 : 0) - this.crouchT) * k;
    this.airT += ((s.air || s.glide ? 1 : 0) - this.airT) * Math.min(1, dt * 10);
    this.kick = Math.max(0, this.kick - dt * 9);
    const cr = this.crouchT, air = this.airT;
    const yaw = this.root.rotation.y;

    // local velocity: forward / right relative to where the character aims
    const vx = s.vx ?? Math.sin(yaw) * s.speed, vz = s.vz ?? Math.cos(yaw) * s.speed;
    const fwd = vx * Math.sin(yaw) + vz * Math.cos(yaw);
    const side = -vx * Math.cos(yaw) + vz * Math.sin(yaw);
    const moving = s.speed > 0.4 && !s.air;
    const back = fwd < -0.3;

    // lower body follows the movement direction (or lags when turning on the spot)
    if (Number.isNaN(this.lowerYaw)) this.lowerYaw = yaw;
    let target = this.lowerYaw;
    if (moving) target = yaw + Math.max(-1.0, Math.min(1.0, back ? Math.atan2(-side, -fwd) : Math.atan2(side, Math.max(0.01, fwd))));
    else if (Math.abs(wrap(this.lowerYaw - yaw)) > 0.7) target = yaw;
    const before = this.lowerYaw;
    this.lowerYaw += wrap(target - this.lowerYaw) * Math.min(1, dt * (moving ? 10 : 7));
    const turning = !moving && Math.abs(wrap(this.lowerYaw - before)) / Math.max(dt, 1e-3) > 1.2;
    this.shuffle += ((turning ? 1 : 0) - this.shuffle) * Math.min(1, dt * 8);
    const hip = Math.max(-1.0, Math.min(1.0, wrap(this.lowerYaw - yaw)));

    // stride-driven cycle so the feet do not slide
    const run = Math.min(1, s.speed / 6.2);
    const stride = (1.25 + run * 1.15) * (1 - cr * 0.35);
    const prev = this.phase;
    const dir = back ? -1 : 1;
    if (moving) this.phase += dir * ((s.speed / stride) * Math.PI * 2 * dt);
    else if (this.shuffle > 0.05) this.phase += dt * 9;
    const wantAmp = moving ? (0.32 + run * 0.5) * (1 - cr * 0.45) : this.shuffle * 0.22;
    this.amp += (wantAmp - this.amp) * Math.min(1, dt * 8);
    const amp = this.amp * (1 - air);
    this.stepped = moving && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI);

    // landing dip
    if (this.wasAir && !s.air && !s.glide) this.landT = 0.28;
    this.wasAir = s.air || s.glide;
    this.landT = Math.max(0, this.landT - dt);
    const land = Math.sin((this.landT / 0.28) * Math.PI) * (this.landT > 0 ? 1 : 0);

    const ph = this.phase;
    const sw = Math.sin(ph);
    const bob = Math.abs(Math.cos(ph)) * (0.025 + run * 0.045) * (amp > 0.05 ? 1 : 0);
    const breathe = Math.sin(performance.now() * 0.0021) * 0.006;
    this.body.position.y = 0.92 - cr * 0.3 - land * 0.14 - (0.02 + run * 0.03) * (amp > 0.05 ? 1 : 0) + bob + breathe;
    this.body.position.x = sw * 0.025 * amp;

    // legs: thigh swing + knee flex during the swing phase
    const thighBase = -1.0 * cr - 0.45 * air - land * 0.5;
    const shinBase = 1.6 * cr + 0.8 * air + land * 0.9;
    const knee = 0.55 + run * 0.9;
    this.legL.rotation.order = this.legR.rotation.order = 'YXZ';
    this.legL.rotation.x = thighBase - sw * amp;
    this.legR.rotation.x = thighBase + sw * amp + air * 0.3;
    this.shinL.rotation.x = shinBase + Math.max(0, Math.cos(ph)) * amp * knee + 0.06;
    this.shinR.rotation.x = shinBase + Math.max(0, -Math.cos(ph)) * amp * knee + 0.06 - air * 0.3;
    this.legL.rotation.y = this.legR.rotation.y = hip * 0.35;

    // pelvis turns toward the movement, the upper body counter-rotates to keep aiming
    this.body.rotation.order = 'YXZ';
    this.body.rotation.y = hip * 0.65 + sw * 0.07 * amp;
    this.body.rotation.x = cr * 0.25 + run * 0.06 * (moving ? 1 : 0) * (back ? -0.5 : 1);
    const lean = moving ? Math.max(-1, Math.min(1, side / 6.2)) : 0;
    this.body.rotation.z += (-lean * 0.1 - this.body.rotation.z) * Math.min(1, dt * 8);

    if (s.glide) {
      this.armL.rotation.set(-2.9, 0, -0.4);
      this.armR.rotation.set(-2.9, 0, 0.4);
      this.foreL.rotation.set(0, 0, 0);
      this.foreR.rotation.set(0, 0, 0);
      this.mount.visible = false;
    } else if (!this.mount.visible || this.armR.rotation.x < -2.5) {
      this.mount.visible = true;
      this.pose(this.weaponId === 'pistol' ? 'pistol' : 'rifle');
    }

    this.spine.rotation.order = 'YXZ';
    this.spine.rotation.x = -s.pitch * 0.55 - cr * 0.2 - run * 0.05 * (moving ? 1 : 0);
    this.spine.rotation.y = -hip * 0.65 - sw * 0.1 * amp;
    this.spine.rotation.z = -this.body.rotation.z * 0.6;
    this.head.rotation.x = -s.pitch * 0.35;
    this.head.rotation.y = -Math.sin(ph) * 0.04 * amp;

    const base = this.mount.userData.base as THREE.Vector3 | undefined;
    if (base) {
      const wb = Math.sin(ph * 2) * 0.012 * amp, ws = Math.cos(ph) * 0.01 * amp;
      this.mount.position.set(base.x + ws, base.y + this.kick * 0.02 + wb - land * 0.03, base.z - this.kick * 0.07);
      this.mount.rotation.x = -this.kick * 0.25 + (s.reload > 0 ? 0.5 * Math.sin(s.reload * Math.PI) : 0) + wb * 2;
      this.mount.rotation.z = s.reload > 0 ? 0.6 * Math.sin(s.reload * Math.PI) : ws * 2;
    }

    this.shadow.position.y = (groundY - this.root.position.y) / this.root.scale.y + 0.03;
    const sh = Math.max(0.3, 1 - (this.root.position.y - groundY) * 0.15);
    this.shadow.scale.setScalar(sh);
  }
}
