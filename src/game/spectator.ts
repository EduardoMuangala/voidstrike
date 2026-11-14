import * as THREE from 'three';
import { WEAPONS } from '../data';
import { sfx } from '../audio';
import type { Actor } from './actor';
import type { Match } from './match';
import { esc } from './hud';
import { isTouch } from './input';

export type CamMode = 'follow' | 'aerial' | 'free' | 'map' | 'auto';
const MODES: [CamMode, string, string][] = [
  ['auto', 'DIRETOR', '1'],
  ['follow', 'SEGUIR', '2'],
  ['aerial', 'AÉREA', '3'],
  ['free', 'LIVRE', '4'],
  ['map', 'TÁTICA', '5'],
];

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

export class Spectator {
  m: Match;
  el: HTMLElement;
  mode: CamMode = 'auto';
  target: Actor | null = null;
  private orbit = Math.random() * 6;
  private free = { pos: new THREE.Vector3(0, 60, 0), yaw: 0, pitch: -0.5 };
  private map = { x: 0, z: 0, h: 260 };
  private autoT = 0;
  private autoShot: 'follow' | 'aerial' | 'wide' = 'follow';
  private listT = 0;
  private keys = new Set<string>();
  private up = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private cut = true;
  private onKey: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onWheel: (e: WheelEvent) => void;

  constructor(m: Match, target: Actor | null, mode: CamMode = 'auto') {
    this.m = m;
    this.target = target;
    this.mode = mode;
    this.free.pos.set(0, m.world.terrain.maxH + 40, -m.world.radius * 0.6);
    this.map.h = m.world.radius * 1.35;
    this.el = document.createElement('div');
    this.el.id = 'spec';
    this.el.className = 'hud-ui';
    this.el.innerHTML = `
      <div class="sp-live"><i></i><b id="spLabel">AO VIVO</b><span id="spInfo"></span></div>
      <div class="sp-list" id="spList"></div>
      <div class="sp-card" id="spCard"></div>
      <div class="sp-bar">
        <div class="sp-modes">${MODES.map(([id, l, k]) => `<button data-cam="${id}"><kbd>${k}</kbd>${l}</button>`).join('')}</div>
        <div class="sp-nav">
          <button data-sp="prev">◀</button><button data-sp="next">▶</button>
          <button data-sp="replay" class="rep">⟲ REPETIÇÃO</button>
          <button data-sp="exit" class="exit">SAIR</button>
        </div>
      </div>
      <div class="sp-rep" id="spRep">
        <button data-sp="play" id="spPlay">❚❚</button>
        <input type="range" id="spSeek" min="0" max="1000" value="1000"/>
        <span id="spTime">0.0s</span>
        <div class="sp-speeds">${[0.25, 0.5, 1].map((s) => `<button data-speed="${s}">${s}x</button>`).join('')}</div>
        <button data-sp="live" class="live">● AO VIVO</button>
      </div>
      <div class="sp-fly"><button data-fly="1">▲</button><button data-fly="-1">▼</button></div>
      <div class="sp-zoom"><button data-zoom="-1">＋</button><button data-zoom="1">－</button></div>
    `;
    m.hud.el.appendChild(this.el);
    m.hud.el.classList.add('spec');

    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button,[data-follow]');
      if (!b) return;
      sfx.click();
      const d = b.dataset;
      if (d.cam) this.setMode(d.cam as CamMode);
      if (d.follow) {
        const a = this.m.actors.find((x) => x.id === Number(d.follow));
        if (a) {
          this.target = a;
          if (this.mode === 'auto' || this.mode === 'map' || this.mode === 'free') this.setMode('follow');
          this.cut = true;
        }
      }
      if (d.sp === 'prev') this.cycle(-1);
      if (d.sp === 'next') this.cycle(1);
      if (d.sp === 'replay') this.m.startReplay(this.target);
      if (d.sp === 'live') this.m.stopReplay();
      if (d.sp === 'play') this.m.replayPaused = !this.m.replayPaused;
      if (d.sp === 'exit') this.m.leaveSpectate();
      if (d.speed) this.m.replaySpeed = Number(d.speed);
      if (d.zoom) this.map.h = THREE.MathUtils.clamp(this.map.h * (Number(d.zoom) > 0 ? 1.25 : 0.8), 40, this.m.world.radius * 2);
    });
    const seek = this.el.querySelector<HTMLInputElement>('#spSeek')!;
    seek.addEventListener('input', () => this.m.seekReplay(Number(seek.value) / 1000));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-fly]')) {
      const v = Number(b.dataset.fly);
      b.addEventListener('pointerdown', () => (this.up = v));
      b.addEventListener('pointerup', () => (this.up = 0));
      b.addEventListener('pointerleave', () => (this.up = 0));
    }
    this.onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      this.keys.add(e.code);
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (idx >= 0) this.setMode(MODES[idx][0]);
      if (e.code === 'ArrowRight' || e.code === 'Tab') this.cycle(1);
      if (e.code === 'ArrowLeft') this.cycle(-1);
      if (e.code === 'KeyR') this.m.replayOn ? this.m.stopReplay() : this.m.startReplay(this.target);
      if (e.code === 'KeyP' && this.m.replayOn) this.m.replayPaused = !this.m.replayPaused;
      if (e.code === 'Tab') e.preventDefault();
    };
    this.onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    this.onWheel = (e: WheelEvent) => {
      if (this.mode === 'map') this.map.h = THREE.MathUtils.clamp(this.map.h * (e.deltaY > 0 ? 1.12 : 0.89), 40, this.m.world.radius * 2);
    };
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('wheel', this.onWheel, { passive: true });
    this.setMode(mode);
    if (!this.target) this.target = this.pickHot();
  }

  setMode(m: CamMode) {
    if (m === 'free' && this.mode !== 'free') {
      this.free.pos.copy(this.m.camera.position);
      this.free.yaw = this.m.camera.rotation.y - Math.PI;
      this.free.pitch = this.m.camera.rotation.x;
    }
    if (m === 'map' && this.target) {
      this.map.x = this.target.rig.root.position.x;
      this.map.z = this.target.rig.root.position.z;
    }
    this.mode = m;
    this.cut = true;
    this.el.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
    this.el.classList.toggle('free', m === 'free');
    this.el.classList.toggle('map', m === 'map');
    this.autoT = 0;
  }

  private alive() {
    return this.m.actors.filter((a) => a.alive && !this.m.inPlane(a));
  }

  cycle(dir: number) {
    const list = this.alive().sort((a, b) => a.id - b.id);
    if (!list.length) return;
    const i = this.target ? list.indexOf(this.target) : -1;
    this.target = list[(i + dir + list.length) % list.length];
    if (this.mode === 'auto' || this.mode === 'free' || this.mode === 'map') this.setMode('follow');
    this.cut = true;
  }

  private pickHot(): Actor | null {
    const list = this.alive();
    if (!list.length) return null;
    let best = list[0], bs = -1;
    for (const a of list) {
      const s = a.heat + a.kills * 0.4 + (a.dropping ? 0 : 0.2) + Math.random() * 0.3;
      if (s > bs) {
        bs = s;
        best = a;
      }
    }
    return best;
  }

  update(dt: number) {
    const m = this.m;
    const cam = m.camera;
    const [lx, ly] = m.input.consumeLook();
    m.input.poll();

    if (this.target && (!this.target.alive || m.inPlane(this.target)) && !m.replayOn && this.mode !== 'free' && this.mode !== 'map') {
      if (this.target.deathT > 1.6 || m.inPlane(this.target)) {
        this.target = m.inPlane(this.target) && m.plane ? this.target : this.pickHot();
        this.cut = true;
      }
    }
    if (!this.target) this.target = this.pickHot();

    // director
    let shot: 'follow' | 'aerial' | 'wide' | 'free' | 'map' = this.mode === 'auto' ? this.autoShot : this.mode;
    if (this.mode === 'auto') {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        const hot = this.pickHot();
        if (hot) this.target = hot;
        const r = Math.random();
        this.autoShot = r < 0.55 ? 'follow' : r < 0.88 ? 'aerial' : 'wide';
        this.autoT = this.autoShot === 'wide' ? 4 : 6 + Math.random() * 4;
        this.cut = true;
        shot = this.autoShot;
      }
    }

    const tgt = this.target;
    const tp = tgt ? tgt.rig.root.position : tA.set(m.zone.cx, 0, m.zone.cz);
    const ty = tgt ? tgt.rig.root.rotation.y : 0;
    const inPlane = tgt && m.inPlane(tgt) && m.plane;
    let fov = 62;
    if (inPlane) {
      const p = m.plane!.group.position;
      this.orbit += dt * 0.25;
      tB.set(p.x + Math.sin(this.orbit) * 34, p.y + 12, p.z + Math.cos(this.orbit) * 34);
      tC.copy(p);
      this.place(tB, tC, dt);
    } else if (shot === 'follow') {
      const back = tgt?.crouch ? 3.6 : 4.4;
      const pv = tC.set(tp.x, tp.y + 1.6, tp.z);
      tB.set(tp.x - Math.sin(ty) * back - Math.cos(ty) * 0.9, tp.y + 2.4, tp.z - Math.cos(ty) * back + Math.sin(ty) * 0.9);
      if (tgt?.dropping) tB.y += 3;
      const dir = tA.copy(tB).sub(pv);
      const len = dir.length();
      dir.divideScalar(len);
      const hit = m.world.raycast(pv, dir, len);
      if (hit < len) tB.copy(pv).addScaledVector(dir, Math.max(0.6, hit - 0.3));
      const look = tA.set(tp.x + Math.sin(ty) * 6, tp.y + 1.3, tp.z + Math.cos(ty) * 6);
      this.place(tB, look, dt, 9);
    } else if (shot === 'aerial') {
      this.orbit += dt * 0.18;
      const R = 26, H = 20;
      tB.set(tp.x + Math.sin(this.orbit) * R, tp.y + H, tp.z + Math.cos(this.orbit) * R);
      const g = m.world.heightAt(tB.x, tB.z);
      if (tB.y < g + 8) tB.y = g + 8;
      this.place(tB, tC.set(tp.x, tp.y + 1, tp.z), dt, 4);
      fov = 55;
    } else if (shot === 'wide') {
      this.orbit += dt * 0.08;
      const z = m.zone;
      const R = Math.max(60, z.r * 0.9);
      tB.set(z.cx + Math.sin(this.orbit) * R, m.world.terrain.maxH + R * 0.55, z.cz + Math.cos(this.orbit) * R);
      this.place(tB, tC.set(z.cx, 0, z.cz), dt, 3);
      fov = 60;
    } else if (shot === 'free') {
      const f = this.free;
      f.yaw -= lx * 0.0032;
      f.pitch = THREE.MathUtils.clamp(f.pitch - ly * 0.0032, -1.5, 1.2);
      const fast = this.keys.has('ShiftLeft') ? 3 : 1;
      const sp = 28 * fast;
      const fx = Math.sin(f.yaw) * Math.cos(f.pitch), fy = Math.sin(f.pitch), fz = Math.cos(f.yaw) * Math.cos(f.pitch);
      const rx = -Math.cos(f.yaw), rz = Math.sin(f.yaw);
      let up = this.up;
      if (this.keys.has('Space') || this.keys.has('KeyE')) up = 1;
      if (this.keys.has('KeyC') || this.keys.has('KeyQ')) up = -1;
      f.pos.x += (fx * m.input.my + rx * m.input.mx) * sp * dt;
      f.pos.y += (fy * m.input.my + up) * sp * dt;
      f.pos.z += (fz * m.input.my + rz * m.input.mx) * sp * dt;
      f.pos.y = Math.max(f.pos.y, m.world.heightAt(f.pos.x, f.pos.z) + 1.2);
      cam.position.copy(f.pos);
      cam.rotation.set(f.pitch, f.yaw + Math.PI, 0);
      fov = 70;
    } else if (shot === 'map') {
      const mp = this.map;
      const sp = mp.h * 0.9;
      mp.x += m.input.mx * sp * dt;
      mp.z -= m.input.my * sp * dt;
      mp.x -= lx * mp.h * 0.002;
      mp.z -= ly * mp.h * 0.002;
      cam.position.set(mp.x, mp.h, mp.z + mp.h * 0.18);
      cam.lookAt(mp.x, 0, mp.z);
      fov = 60;
    }
    const fog = m.scene.fog as THREE.Fog;
    const wantFar = shot === 'map' ? this.map.h * 2.5 : shot === 'wide' ? Math.max(m.far, 260) : m.far;
    if (fog.far !== wantFar) fog.far = wantFar;
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    this.cut = false;

    this.updateUi(dt, shot === 'map');
  }

  private place(pos: THREE.Vector3, look: THREE.Vector3, dt: number, smooth = 6) {
    const cam = this.m.camera;
    if (this.cut) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      const k = Math.min(1, dt * smooth);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, Math.min(1, dt * smooth * 1.5));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  private updateUi(dt: number, mapMode: boolean) {
    const m = this.m;
    const h = m.hud;
    // name tags
    let n = 0;
    const cam = m.camera.position;
    for (const a of m.actors) {
      if (!a.alive || m.inPlane(a)) continue;
      const p = a.rig.root.position;
      const d = p.distanceTo(cam);
      if (!mapMode && d > 80) continue;
      const s = m.project(tA.set(p.x, p.y + 2.2, p.z));
      if (!s) continue;
      const kind = m.mode === 'squad' ? (a.team === 0 ? 'ally' : 'enemy') : a === this.target ? 'ally' : 'enemy';
      h.tag(n++, s.x, s.y, mapMode ? (this.map.h > 120 ? '●' : a.name) : a.name, a.hp, a === this.target ? 'ally' : kind, !mapMode);
    }
    h.hideTags(n);

    this.listT -= dt;
    if (this.listT > 0) return;
    this.listT = 0.4;
    const alive = this.alive().sort((a, b) => b.kills - a.kills || b.hp - a.hp);
    const list = this.el.querySelector('#spList')!;
    list.innerHTML = `<h5>JOGADORES · ${alive.length}</h5>` + alive.slice(0, isTouch ? 6 : 12).map((a) => `<div class="sp-row ${a === this.target ? 'on' : ''} ${m.mode === 'squad' ? (a.team === 0 ? 't0' : 't1') : ''}" data-follow="${a.id}"><b>${esc(a.name)}</b><span>${a.kills}</span><i><s style="width:${Math.max(0, a.hp)}%"></s></i></div>`).join('');
    const t = this.target;
    const card = this.el.querySelector('#spCard')!;
    card.innerHTML = t
      ? `<span class="hero">${t.hero.name} · ${t.hero.role}</span><b>${esc(t.name)}</b><div class="cs"><span>❤ ${Math.max(0, Math.ceil(t.hp))}</span><span>☠ ${t.kills}</span><span>${t.weapon ? WEAPONS[t.weapon.id].name : '—'}</span></div>`
      : '';
    const z = m.zone;
    this.el.querySelector('#spInfo')!.textContent = m.mode === 'squad' ? `${m.scoreA} - ${m.scoreB}` : `${alive.length} VIVOS · ZONA ${Math.round(z.r)}m`;
    this.el.classList.toggle('replay', m.replayOn);
    this.el.querySelector('#spLabel')!.textContent = m.replayOn ? 'REPETIÇÃO' : 'AO VIVO';
    if (m.replayOn) {
      const [a, b] = m.replayRange();
      this.el.querySelector<HTMLInputElement>('#spSeek')!.value = String(Math.round(((m.replayT - a) / Math.max(0.01, b - a)) * 1000));
      this.el.querySelector('#spTime')!.textContent = `-${(b - m.replayT).toFixed(1)}s`;
      this.el.querySelector('#spPlay')!.textContent = m.replayPaused ? '▶' : '❚❚';
      this.el.querySelectorAll<HTMLElement>('[data-speed]').forEach((x) => x.classList.toggle('on', Number(x.dataset.speed) === m.replaySpeed));
    }
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('wheel', this.onWheel);
    this.el.remove();
    this.m.hud.el.classList.remove('spec');
  }
}
