import * as THREE from 'three';
import { DEFAULT_OUTFIT, HEROES } from '../data';
import { profile } from '../save';
import { sfx } from '../audio';
import { CharacterRig } from '../models/character';
import type { RoomNet } from '../webrtc';
import type { MapId } from './maps';
import type { NetActorSnap, NetMsg } from '../netproto';
import type { MatchResult } from './match';
import { ARENA_R, pickArena } from './match';
import { World } from './world';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';

export interface NetMatchOpts {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  net: RoomNet;
  map: MapId;
  seed: number;
  selfActorId: number;
  hostId: string;
  onEnd: (r: MatchResult) => void;
}

/**
 * The guest's view of a room match: no local physics or hit detection —
 * everything here is either a direct echo of what the host (the authority)
 * reports, or the player's own input forwarded to the host over the WebRTC
 * link already opened by the room. Simplified HUD/avatars compared to the
 * full single-player Match (no scope zoom, same look for every remote
 * avatar) to keep this small; the host runs the real simulation.
 */
export class NetMatch {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  fx = new Fx();
  hud: Hud;
  input: Input;
  over = false;
  private renderer: THREE.WebGLRenderer;
  private net: RoomNet;
  private selfId: number;
  private hostId: string;
  private rigs = new Map<number, CharacterRig>();
  private zoneWall: THREE.Mesh | null = null;
  private latest: NetActorSnap[] = [];
  private yaw = 0;
  private pitch = 0;
  private scoreA = 0;
  private scoreB = 0;
  private camDist = 3.2;
  private far: number;
  private onEndCb: (r: MatchResult) => void;
  private lastMsgT = 0;
  private pingAcc = 0;

  constructor(opts: NetMatchOpts) {
    this.renderer = opts.renderer;
    this.net = opts.net;
    this.selfId = opts.selfActorId;
    this.hostId = opts.hostId;
    this.onEndCb = opts.onEnd;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 700);
    this.camera.rotation.order = 'YXZ';
    this.world = new World(opts.map, opts.seed);
    const sky = this.world.def.sky;
    const q = profile.settings.quality;
    this.far = q === 'low' ? 120 : q === 'medium' ? 175 : 250;
    this.scene.fog = new THREE.Fog(sky.fog, 30, this.far);
    this.scene.add(new THREE.HemisphereLight(sky.hemiSky, sky.hemiGround, sky.hemiInt));
    const sun = new THREE.DirectionalLight(sky.sun, sky.sunInt);
    sun.position.set(...sky.sunPos);
    this.scene.add(sun, this.world.group, this.fx.group);
    // Same seeded draw the host makes right after building its own World, so
    // everyone in the room ends up with the identical safe-zone ring — no
    // extra network message needed for it.
    const poi = pickArena(this.world);
    if (poi) {
      this.zoneWall = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 60, 48, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff4a6a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      this.zoneWall.position.set(poi.x, 20, poi.z);
      this.zoneWall.scale.set(ARENA_R, 1, ARENA_R);
      this.scene.add(this.zoneWall);
    }
    this.hud = new Hud(opts.root, 'squad');
    this.input = new Input(opts.canvas, this.hud.el);
    this.input.enabled = true;
    this.net.onMessage = (_from, data) => {
      this.lastMsgT = performance.now();
      this.onNet(data as NetMsg);
    };
    this.lastMsgT = performance.now();
    this.hud.banner('CONTRA SQUAD', 'A ligar ao anfitrião da sala...', 2);
  }

  private onNet(msg: NetMsg) {
    if (msg.t === 'snap') {
      this.latest = msg.actors;
      this.scoreA = msg.scoreA;
      this.scoreB = msg.scoreB;
    }
    else if (msg.t === 'shot') this.fx.tracer(new THREE.Vector3(...msg.a), new THREE.Vector3(...msg.b), 0xffe28a);
    else if (msg.t === 'boom') {
      const p = new THREE.Vector3(...msg.p);
      this.fx.blast(p, 4.5);
      if (p.distanceTo(this.camera.position) < 80) sfx.boom();
    } else if (msg.t === 'gloo' && msg.kind === 'spawn') {
      const p = new THREE.Vector3(msg.x, msg.y + 1, msg.z);
      this.fx.burst(p, 0x9fe8ff, 16, 4, 0.14, 8, 0.6);
      if (p.distanceTo(this.camera.position) < 60) sfx.gel();
    } else if (msg.t === 'kill') this.hud.kill(msg.killer, msg.victim, msg.weapon, false, false, 0);
    else if (msg.t === 'end') {
      this.over = true;
      this.onEndCb(msg.result);
    }
  }

  update(dt: number) {
    if (this.over) return;
    if (performance.now() - this.lastMsgT > 8000) {
      this.over = true;
      this.hud.banner('LIGAÇÃO PERDIDA', 'O anfitrião desligou-se', 2);
      setTimeout(() => this.onEndCb({ mode: 'squad', win: false, rank: 0, total: 0, kills: 0, damage: 0, time: 0, scoreA: 0, scoreB: 0, quit: true }), 1200);
      return;
    }
    const inp = this.input;
    inp.poll();
    const [lx, ly] = inp.consumeLook();
    const sens = 0.0009 + profile.settings.sens * 0.00042;
    this.yaw -= lx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - ly * sens, -1.25, 1.15);
    this.net.sendTo(this.hostId, {
      t: 'input', yaw: this.yaw, pitch: this.pitch, mx: inp.mx, my: inp.my, fire: inp.fire, ads: inp.ads, crouch: inp.crouchHold,
      jump: inp.take('jump'), reload: inp.take('reload'), gel: inp.take('gel'), nade: inp.take('nade'), heal: inp.take('heal'),
      ability: inp.take('ability'), pickup: inp.take('pickup'), slot: inp.take('slot0') ? 0 : inp.take('slot1') ? 1 : inp.take('slot2') ? 2 : -1,
    });

    this.pingAcc += dt;
    if (this.pingAcc > 0.5) {
      this.pingAcc = 0;
      this.hud.netPing(profile.settings.showPing ? this.net.peers().find((p) => p.id === this.hostId)?.ping ?? null : null);
    }

    this.fx.update(dt);
    this.world.updateVisibility(this.camera.position, this.far);
    this.world.clouds.position.x = Math.sin(performance.now() * 0.00001) * 30;
    this.renderActors(dt);
    this.hud.update(dt);
  }

  private renderActors(dt: number) {
    let mine: NetActorSnap | undefined;
    const seen = new Set<number>();
    for (const s of this.latest) {
      seen.add(s.id);
      if (s.id === this.selfId) mine = s;
      let rig = this.rigs.get(s.id);
      if (!rig) {
        rig = new CharacterRig(HEROES[s.id % HEROES.length].id, DEFAULT_OUTFIT);
        this.rigs.set(s.id, rig);
        this.scene.add(rig.root);
      }
      rig.root.visible = s.alive && s.id !== this.selfId;
      if (!s.alive) continue;
      rig.root.position.set(s.x, s.y, s.z);
      rig.root.rotation.y = s.yaw;
      if (s.weapon !== rig.weaponId) rig.setWeapon(s.weapon, 'default');
      rig.update(dt, { speed: s.speed, crouch: s.crouch, air: !s.onGround, pitch: s.pitch, reload: 0, glide: s.dropping && !s.onGround, dead: false, vx: s.vx, vz: s.vz }, this.world.heightAt(s.x, s.z));
    }
    for (const [id, rig] of this.rigs) if (!seen.has(id)) rig.root.visible = false;
    this.updateCamera(mine);
    this.updateHud(mine);
  }

  private updateCamera(mine: NetActorSnap | undefined) {
    if (!mine || !mine.alive) {
      this.camera.rotation.set(this.pitch, this.yaw + Math.PI, 0);
      return;
    }
    const f = tA.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const pivot = tB.set(mine.x, mine.y + (mine.crouch ? 1.2 : 1.6), mine.z);
    const want = this.net.isConnectedTo(this.hostId) ? 3.2 : 5;
    this.camDist += (want - this.camDist) * 0.15;
    const desired = tC.copy(pivot).addScaledVector(f, -this.camDist);
    desired.x += -Math.cos(this.yaw) * 0.6;
    desired.z += Math.sin(this.yaw) * 0.6;
    const dir = tD.copy(desired).sub(pivot);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = this.world.raycast(pivot, dir, len + 0.25);
    const useLen = hit < len + 0.25 ? Math.max(0.3, hit - 0.3) : len;
    this.camera.position.copy(pivot).addScaledVector(dir, useLen);
    this.camera.rotation.set(this.pitch, this.yaw + Math.PI, 0);
  }

  private updateHud(mine: NetActorSnap | undefined) {
    if (!mine) {
      this.hud.center('A LIGAR AO ANFITRIÃO...');
      return;
    }
    this.hud.center(mine.alive ? '' : 'ELIMINADO · A RENASCER...');
    this.hud.vitals(mine.hp, mine.armor, false);
    this.hud.weapons(mine.slots, mine.cur, mine.reloading);
    this.hud.counts(mine.meds, mine.gel, mine.nades);
    this.hud.ability('⚡', 1);
    this.hud.healing(0);
    this.hud.crosshair(6, mine.alive, false);
    this.hud.scope(false);
    this.hud.text('#tsScore .a', this.scoreA);
    this.hud.text('#tsScore .f', this.scoreB);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.input.dispose();
    this.hud.dispose();
    for (const rig of this.rigs.values()) rig.dispose();
    this.zoneWall?.geometry.dispose();
    (this.zoneWall?.material as THREE.Material | undefined)?.dispose();
    this.world.dispose();
    this.fx.dispose();
  }
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();
