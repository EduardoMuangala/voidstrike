import * as THREE from 'three';
import {
  ALL_WEAPON_IDS, HEROES, HERO_BY_ID, ITEMS, ITEM_BY_ID, MODES, RARITY, SLOTS, WEAPONS, WEAPON_SKINS,
  weaponSkinItemId, GLOO_SKINS, glooItemId, type Difficulty, type ModeId, type Outfit, type Price, type Slot, type WeaponId,
} from '../data';
import { buy, canAfford, grantRewards, owns, profile, resetProfile, save, xpForLevel } from '../save';
import { sfx, unlockAudio } from '../audio';
import { signOut } from '../auth';
import { flushSync, stopSync } from '../cloudProfile';
import { supabase } from '../supabase';
import { createRoom, deleteRoom, findRoomByCode, joinRoom, listRooms, subscribeRoomList, type Member, type RoomChannel, type RoomRow } from '../rooms';
import { RoomNet, type PeerLink } from '../webrtc';
import type { MapId } from '../game/maps';

export interface NetPlayOpts {
  isHost: boolean;
  net: RoomNet;
  map: MapId;
  seed: number;
  hostId: string;
  netPlayers?: { id: string; name: string }[];
  selfActorId?: number;
}
import { CharacterRig } from '../models/character';
import { glow, mat } from '../models/materials';
import { COIN, GEM, MENU_ICONS, heroIcon, itemIcon, weaponIcon } from './icons';
import { esc } from '../game/hud';
import type { MatchResult } from '../game/match';
import { BR_MAPS } from '../game/maps';

type Page = 'home' | 'store' | 'wardrobe' | 'heroes' | 'arsenal' | 'rooms';
type StoreTab = 'heroes' | 'outfits' | 'weapons' | 'gloo';

const DAILY_MS = 20 * 3600 * 1000;
const priceHtml = (p: Price) => (p.diamonds ? `${GEM}<b>${p.diamonds}</b>` : p.coins ? `${COIN}<b>${p.coins}</b>` : '<b>GRÁTIS</b>');

export class Lobby {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  el: HTMLElement;
  private rig: CharacterRig | null = null;
  private mates: CharacterRig[] = [];
  private stage = new THREE.Group();
  private page: Page = 'home';
  private storeTab: StoreTab = 'outfits';
  private settingsTab: 'geral' | 'controlos' | 'audio' | 'hud' = 'geral';
  private slotTab: Slot = 'top';
  private sel: string | null = null;
  private previewHero: string | null = null;
  private previewOutfit: Outfit | null = null;
  private previewWeapon: { id: WeaponId; skin: string } | null = null;
  private previewGloo: string | null = null;
  private glooKey = '';
  private glooGroup: THREE.Group | null = null;
  private glooAge = 0;
  private arsenalSel: WeaponId = profile.loadout[0];
  private yaw = 0.5;
  private yawVel = 0;
  private dragging = false;
  private lastX = 0;
  private camX = 0;
  private camZ = 6.3;
  private sparks: THREE.Points;
  private onPlay: (mode: ModeId, diff: Difficulty) => void;
  private onNetPlay: (opts: NetPlayOpts) => void;
  private rigKey = '';
  private authUserId: string | null = null;
  private roomList: RoomRow[] = [];
  private roomsBusy = false;
  private roomsUnsub: (() => void) | null = null;
  private currentRoom: RoomRow | null = null;
  private roomChannel: RoomChannel | null = null;
  private roomMembers: Member[] = [];
  private roomReady = false;
  private net: RoomNet | null = null;
  private netPeers: PeerLink[] = [];

  constructor(root: HTMLElement, onPlay: (mode: ModeId, diff: Difficulty) => void, onNetPlay: (opts: NetPlayOpts) => void) {
    this.onPlay = onPlay;
    this.onNetPlay = onNetPlay;
    this.el = document.createElement('div');
    this.el.id = 'lobby';
    root.appendChild(this.el);
    supabase.auth.getUser().then(({ data }) => (this.authUserId = data.user?.id || null));

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1d3a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 4, 5);
    const rim = new THREE.DirectionalLight(0xff8a2b, 2.2);
    rim.position.set(-3, 3, -4);
    const rim2 = new THREE.DirectionalLight(0x4aa8ff, 1.4);
    rim2.position.set(4, 2, -3);
    this.scene.add(key, rim, rim2, this.stage);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.24, 48), mat(0x1a1d26));
    base.position.y = -0.12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.025, 6, 72), glow(0xffb81c));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.012, 6, 72), glow(0xff7a1a));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -0.2;
    this.stage.add(base, ring, ring2);

    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = -1 - Math.random() * 4;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffb81c, size: 0.04, transparent: true, opacity: 0.7 }));
    this.scene.add(this.sparks);

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('submit', (e) => this.onSubmit(e));
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#stagehit')) {
        this.dragging = true;
        this.lastX = e.clientX;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yawVel = (e.clientX - this.lastX) * 0.012;
      this.yaw += this.yawVel;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));

    this.render();
  }

  // ------------------------------------------------------------------ 3D
  private wantRig(): { hero: string; outfit: Outfit; weapon: { id: WeaponId; skin: string } } {
    const hero = this.previewHero || profile.hero;
    const outfit = this.previewOutfit || profile.outfit;
    const wid = this.previewWeapon?.id || profile.loadout[0];
    const skin = this.previewWeapon?.skin || profile.weaponSkins[wid] || 'default';
    return { hero, outfit, weapon: { id: wid, skin } };
  }

  private syncRig() {
    const w = this.wantRig();
    const k = JSON.stringify(w);
    if (k === this.rigKey) return;
    this.rigKey = k;
    if (this.rig) {
      this.stage.remove(this.rig.root);
      this.rig.dispose();
    }
    this.rig = new CharacterRig(w.hero, w.outfit);
    this.rig.setWeapon(w.weapon.id, w.weapon.skin);
    this.rig.shadow.visible = false;
    this.stage.add(this.rig.root);
    this.syncMates();
  }

  private syncMates() {
    const want = profile.mode === 'squad' && this.page === 'home';
    if (want && !this.mates.length) {
      const picks = HEROES.filter((h) => h.id !== profile.hero).slice(0, 2);
      picks.forEach((h, i) => {
        const outfit: Outfit = { head: ['cap_black', 'helmet'][i], face: 'face_none', top: ['jacket', 'tac_vest'][i], bottom: ['joggers', 'cargo'][i], shoes: 'boots', back: 'back_none' };
        const r = new CharacterRig(h.id, outfit);
        r.setWeapon(i ? 'smg' : 'sr');
        r.root.position.set(i ? 1.55 : -1.55, 0, -1.1);
        r.root.rotation.y = i ? -0.35 : 0.35;
        this.scene.add(r.root);
        this.mates.push(r);
      });
    } else if (!want && this.mates.length) {
      for (const m of this.mates) {
        this.scene.remove(m.root);
        m.dispose();
      }
      this.mates = [];
    }
  }

  private syncGloo(dt: number) {
    const want = this.previewGloo || '';
    if (want !== this.glooKey) {
      this.glooKey = want;
      if (this.glooGroup) {
        this.stage.remove(this.glooGroup);
        this.glooGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        });
        this.glooGroup = null;
      }
      if (want) {
        const s = GLOO_SKINS.find((x) => x.id === want)!;
        const g = new THREE.Group();
        const body = new THREE.MeshLambertMaterial({ color: s.body, emissive: s.emissive, transparent: true, opacity: s.opacity });
        const cap = new THREE.MeshLambertMaterial({ color: s.cap, emissive: s.emissive });
        for (let i = 0; i < 7; i++) {
          const a = -0.75 + (i + 0.5) * (1.5 / 7);
          const seg = new THREE.Group();
          seg.position.set(Math.sin(a) * 2.3, 0, -Math.cos(a) * 2.3 + 0.4);
          seg.rotation.y = -a;
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.2, 0.45).translate(0, 1.1, 0), body);
          const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.3, 3, 8).rotateZ(Math.PI / 2).translate(0, 2.2, 0), cap);
          seg.add(b, c);
          seg.userData.delay = Math.abs(i - 3) * 0.05;
          g.add(seg);
        }
        g.scale.setScalar(0.8);
        g.position.z = -0.4;
        this.glooGroup = g;
        this.glooAge = 0;
        this.stage.add(g);
      }
    }
    if (this.glooGroup) {
      this.glooAge += dt;
      for (const seg of this.glooGroup.children) {
        const t = Math.max(0, Math.min(1, (this.glooAge - seg.userData.delay) / 0.25));
        const k = 1 + 2.9 * Math.pow(t - 1, 3) + 1.9 * Math.pow(t - 1, 2);
        seg.scale.set(0.7 + 0.3 * t, Math.max(0.02, k), 0.7 + 0.3 * t);
      }
    }
  }

  update(dt: number) {
    this.syncRig();
    this.syncGloo(dt);
    const t = performance.now() / 1000;
    if (!this.dragging) {
      this.yawVel *= 0.92;
      this.yaw += this.yawVel;
      if (Math.abs(this.yawVel) < 0.001) this.yaw += (0.45 + Math.sin(t * 0.4) * 0.2 - this.yaw) * dt * 0.8;
    }
    this.stage.rotation.y = this.yaw;
    if (this.rig) this.rig.update(dt, { speed: 0, crouch: false, air: false, pitch: -0.05, reload: 0, glide: false, dead: false }, 0);
    for (const m of this.mates) m.update(dt, { speed: 0, crouch: false, air: false, pitch: -0.08, reload: 0, glide: false, dead: false }, 0);

    const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.15 + (i % 5) * 0.05);
      if (y > 4) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    const narrow = innerWidth / innerHeight < 1.2;
    const side = this.page !== 'home';
    const tx = side ? (narrow ? 0 : 1.15) : 0;
    const tz = side ? 5.4 : this.mates.length ? 7.4 : 6.3;
    this.camX += (tx - this.camX) * Math.min(1, dt * 5);
    this.camZ += (tz - this.camZ) * Math.min(1, dt * 5);
    this.camera.position.set(this.camX, 1.35, this.camZ);
    this.camera.lookAt(this.camX, 0.92, 0);
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ UI
  render() {
    this.syncMates();
    const p = profile;
    const hero = HERO_BY_ID.get(this.previewHero || p.hero)!;
    const xpNeed = xpForLevel(p.level);
    const dailyReady = Date.now() - p.lastDaily > DAILY_MS;
    const mode = MODES.find((m) => m.id === p.mode)!;

    this.el.className = `page-${this.page}`;
    this.el.innerHTML = `
      <div id="stagehit"></div>
      <div class="bgword">VOIDSTRIKE</div>
      <header class="lb-top">
        <div class="lb-profile" data-a="settings">
          <div class="lb-avatar">${heroIcon(HERO_BY_ID.get(p.hero)!)}<span class="lvl">${p.level}</span></div>
          <div class="lb-pinfo">
            <b>${esc(p.name)}</b>
            <div class="xpbar"><i style="width:${Math.min(100, (p.xp / xpNeed) * 100)}%"></i></div>
            <span>NÍVEL ${p.level} · ${p.xp}/${xpNeed} XP</span>
          </div>
        </div>
        <div class="lb-curr">
          <div class="pill">${COIN}<b>${p.coins.toLocaleString('pt-PT')}</b></div>
          <div class="pill">${GEM}<b>${p.diamonds.toLocaleString('pt-PT')}</b></div>
          <button class="icobtn" data-a="fullscreen" title="Ecrã inteiro">${MENU_ICONS.full}</button>
          <button class="icobtn" data-a="settings" title="Definições">${MENU_ICONS.settings}</button>
        </div>
      </header>
      ${this.page === 'home' ? this.homeHtml(hero, dailyReady, mode) : this.pageHtml()}
    `;
  }

  private homeHtml(hero: (typeof HEROES)[number], dailyReady: boolean, mode: (typeof MODES)[number]) {
    const p = profile;
    const menu = [
      ['store', 'LOJA'],
      ['wardrobe', 'GUARDA-ROUPA'],
      ['heroes', 'PERSONAGENS'],
      ['arsenal', 'ARSENAL'],
      ['rooms', 'SALAS'],
    ];
    return `
      <nav class="lb-menu">
        ${menu.map(([id, label]) => `<button class="mbtn" data-page="${id}">${MENU_ICONS[id]}<span>${label}</span></button>`).join('')}
        <button class="mbtn daily ${dailyReady ? 'ready' : ''}" data-a="daily">${MENU_ICONS.daily}<span>${dailyReady ? 'RECOMPENSA' : 'AMANHÃ'}</span>${dailyReady ? '<i class="dot"></i>' : ''}</button>
      </nav>
      <div class="lb-hero">
        <span class="role">${hero.role}</span>
        <b>${hero.name}</b>
        <small>⚡ ${hero.ability.name}</small>
      </div>
      <div class="lb-stats">
        <div><span>PARTIDAS</span><b>${p.stats.matches}</b></div>
        <div><span>BOOYAHS</span><b>${p.stats.wins}</b></div>
        <div><span>ABATES</span><b>${p.stats.kills}</b></div>
      </div>
      <div class="lb-play">
        <button class="modecard" data-a="modes" style="--mc:${mode.color}">
          <span class="mtag">${mode.players}</span>
          <b>${mode.name}</b>
          <small>${mode.maps ? BR_MAPS.find((x) => x.id === p.map)!.name : 'CAMPO DE TREINO'} · ${{ easy: 'FÁCIL', normal: 'NORMAL', hard: 'DIFÍCIL' }[p.difficulty]}</small>
          <i class="chev">▸</i>
        </button>
        <button class="startbtn" data-a="start"><span>INICIAR</span></button>
      </div>
      <div class="lb-hint">Arrasta para rodar o personagem</div>
    `;
  }

  private pageHtml(): string {
    const titles: Record<Page, string> = { home: '', store: 'LOJA', wardrobe: 'GUARDA-ROUPA', heroes: 'PERSONAGENS', arsenal: 'ARSENAL', rooms: 'SALAS' };
    let body = '';
    if (this.page === 'store') body = this.storeHtml();
    else if (this.page === 'wardrobe') body = this.wardrobeHtml();
    else if (this.page === 'heroes') body = this.heroesHtml();
    else if (this.page === 'arsenal') body = this.arsenalHtml();
    else if (this.page === 'rooms') body = this.roomsHtml();
    return `
      <section class="lb-page">
        <div class="pg-head">
          <button class="backbtn" data-a="back">${MENU_ICONS.back}</button>
          <h1>${titles[this.page]}</h1>
        </div>
        ${body}
      </section>
    `;
  }

  // ---------- store
  private storeHtml() {
    const tabs: [StoreTab, string][] = [['outfits', 'ROUPAS'], ['gloo', 'GELO'], ['heroes', 'PERSONAGENS'], ['weapons', 'SKINS DE ARMAS']];
    let cards = '';
    if (this.storeTab === 'outfits') {
      cards = ITEMS.filter((i) => i.price.coins || i.price.diamonds)
        .map((i) => this.card(i.id, i.name, RARITY[i.rarity].color, itemIcon(i), owns(i.id) ? '<em>ADQUIRIDO</em>' : priceHtml(i.price), SLOTS.find((s) => s.id === i.slot)!.label))
        .join('');
    } else if (this.storeTab === 'heroes') {
      cards = HEROES.map((h) => this.card('hero:' + h.id, h.name, RARITY[h.rarity].color, heroIcon(h), owns('hero:' + h.id) ? '<em>ADQUIRIDO</em>' : priceHtml(h.price), h.role)).join('');
    } else if (this.storeTab === 'gloo') {
      cards = GLOO_SKINS.map((g) => this.card(glooItemId(g.id), g.name, RARITY[g.rarity].color, glooIcon(g.body, g.cap), owns(glooItemId(g.id)) ? (profile.gloo === g.id ? '<em>EQUIPADO</em>' : '<em>ADQUIRIDO</em>') : priceHtml(g.price), 'PAREDE DE GELO')).join('');
    } else {
      for (const w of ALL_WEAPON_IDS)
        for (const s of WEAPON_SKINS) {
          if (s.id === 'default') continue;
          const id = weaponSkinItemId(w, s.id);
          cards += this.card(id, `${WEAPONS[w].name} ${s.name}`, RARITY[s.rarity].color, weaponIcon(w, s), owns(id) ? '<em>ADQUIRIDO</em>' : priceHtml(s.price), WEAPONS[w].cls);
        }
    }
    return `
      <div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${this.storeTab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      <div class="grid">${cards}</div>
      ${this.detailHtml()}
    `;
  }

  private card(id: string, name: string, color: string, icon: string, foot: string, sub: string) {
    return `<button class="card ${this.sel === id ? 'sel' : ''}" data-sel="${id}" style="--rc:${color}">
      <span class="rbar"></span><span class="sub">${sub}</span>${icon}<b>${name}</b><span class="foot">${foot}</span></button>`;
  }

  private itemInfo(id: string): { name: string; rarity: string; color: string; price: Price; desc: string; owned: boolean; equipped: boolean } | null {
    if (id.startsWith('hero:')) {
      const h = HERO_BY_ID.get(id.slice(5))!;
      return { name: h.name, rarity: RARITY[h.rarity].label, color: RARITY[h.rarity].color, price: h.price, desc: `<b>${h.ability.name}</b> — ${h.ability.desc}<br><span class="bio">${h.bio}</span>`, owned: owns(id), equipped: profile.hero === h.id };
    }
    if (id.startsWith('gloo:')) {
      const g = GLOO_SKINS.find((x) => x.id === id.slice(5))!;
      return { name: g.name, rarity: RARITY[g.rarity].label, color: RARITY[g.rarity].color, price: g.price, desc: 'Parede de gelo curva: lança, cai e sobe em segundos. Protege de tiros até partir.', owned: owns(id), equipped: profile.gloo === g.id };
    }
    if (id.startsWith('wskin:')) {
      const [, w, s] = id.split(':') as [string, WeaponId, string];
      const sk = WEAPON_SKINS.find((x) => x.id === s)!;
      return { name: `${WEAPONS[w].name} · ${sk.name}`, rarity: RARITY[sk.rarity].label, color: RARITY[sk.rarity].color, price: sk.price, desc: `Skin para a ${WEAPONS[w].cls.toLowerCase()} ${WEAPONS[w].name}.`, owned: s === 'default' || owns(id), equipped: (profile.weaponSkins[w] || 'default') === s };
    }
    const it = ITEM_BY_ID.get(id);
    if (!it) return null;
    return { name: it.name, rarity: RARITY[it.rarity].label, color: RARITY[it.rarity].color, price: it.price, desc: `Item de ${SLOTS.find((s) => s.id === it.slot)!.label.toLowerCase()}.`, owned: owns(id), equipped: profile.outfit[it.slot] === id };
  }

  private detailHtml() {
    if (!this.sel) return '<div class="detail empty">Toca num item para pré-visualizar no personagem.</div>';
    const info = this.itemInfo(this.sel);
    if (!info) return '';
    const action = info.equipped
      ? '<button class="btn-ghost" disabled>EQUIPADO</button>'
      : info.owned
        ? `<button class="btn-primary" data-a="equip">EQUIPAR</button>`
        : `<button class="btn-buy ${canAfford(info.price) ? '' : 'poor'}" data-a="buy">COMPRAR ${priceHtml(info.price)}</button>`;
    return `<div class="detail" style="--rc:${info.color}">
      <span class="rar">${info.rarity}</span><h3>${info.name}</h3><p>${info.desc}</p>${action}</div>`;
  }

  // ---------- wardrobe
  private wardrobeHtml() {
    const owned = ITEMS.filter((i) => i.slot === this.slotTab && owns(i.id));
    const locked = ITEMS.filter((i) => i.slot === this.slotTab && !owns(i.id)).length;
    return `
      <div class="tabs slots">${SLOTS.map((s) => `<button class="tab ${this.slotTab === s.id ? 'on' : ''}" data-slot="${s.id}">${s.label}</button>`).join('')}</div>
      <div class="grid">
        ${owned.map((i) => `<button class="card ${profile.outfit[i.slot] === i.id ? 'sel eq' : ''}" data-wear="${i.id}" style="--rc:${RARITY[i.rarity].color}"><span class="rbar"></span>${itemIcon(i)}<b>${i.name}</b><span class="foot">${profile.outfit[i.slot] === i.id ? '<em>EQUIPADO</em>' : 'EQUIPAR'}</span></button>`).join('')}
        ${locked ? `<button class="card more" data-page="store">${MENU_ICONS.lock}<b>+${locked} NA LOJA</b><span class="foot">VER LOJA</span></button>` : ''}
      </div>
    `;
  }

  // ---------- heroes
  private heroesHtml() {
    const h = HERO_BY_ID.get(this.previewHero || profile.hero)!;
    const own = owns('hero:' + h.id);
    return `
      <div class="grid heroes">
        ${HEROES.map((x) => `<button class="card hero ${x.id === h.id ? 'sel' : ''}" data-hero="${x.id}" style="--rc:${RARITY[x.rarity].color}"><span class="rbar"></span>${heroIcon(x)}<b>${x.name}</b><span class="foot">${profile.hero === x.id ? '<em>EM USO</em>' : owns('hero:' + x.id) ? x.role : priceHtml(x.price)}</span></button>`).join('')}
      </div>
      <div class="detail" style="--rc:${RARITY[h.rarity].color}">
        <span class="rar">${h.role} · ${RARITY[h.rarity].label}</span>
        <h3>${h.name}</h3>
        <p class="bio">${h.bio}</p>
        <div class="ability"><i>⚡</i><div><b>${h.ability.name}</b><span>${h.ability.desc} · Recarga ${h.ability.cd}s</span></div></div>
        ${profile.hero === h.id ? '<button class="btn-ghost" disabled>EM USO</button>' : own ? `<button class="btn-primary" data-a="usehero">USAR PERSONAGEM</button>` : `<button class="btn-buy ${canAfford(h.price) ? '' : 'poor'}" data-a="buyhero">DESBLOQUEAR ${priceHtml(h.price)}</button>`}
      </div>
    `;
  }

  // ---------- arsenal
  private arsenalHtml() {
    const w = WEAPONS[this.arsenalSel];
    const skinNow = this.previewWeapon?.id === w.id ? this.previewWeapon.skin : profile.weaponSkins[w.id] || 'default';
    const bars: [string, number][] = [
      ['DANO', Math.min(1, (w.dmg * w.pellets) / 100)],
      ['CADÊNCIA', Math.min(1, 0.07 / w.interval)],
      ['ALCANCE', Math.min(1, w.range / 220)],
      ['PRECISÃO', Math.max(0.05, 1 - w.spread * 12)],
      ['CARREGADOR', Math.min(1, w.mag / 60)],
    ];
    const slot = profile.loadout[0] === w.id ? 'PRIMÁRIA' : profile.loadout[1] === w.id ? 'SECUNDÁRIA' : w.id === 'pistol' ? 'PISTOLA' : '';
    return `
      <div class="grid weapons">
        ${ALL_WEAPON_IDS.map((id) => {
          const d = WEAPONS[id];
          const tag = profile.loadout[0] === id ? '<em>1ª</em>' : profile.loadout[1] === id ? '<em>2ª</em>' : d.cls;
          return `<button class="card wpn ${id === w.id ? 'sel' : ''}" data-wpn="${id}" style="--rc:${RARITY[(['common', 'common', 'rare', 'epic', 'legendary'] as const)[d.tier]].color}"><span class="rbar"></span>${weaponIcon(id, WEAPON_SKINS.find((s) => s.id === (profile.weaponSkins[id] || 'default')))}<b>${d.name}</b><span class="foot">${tag}</span></button>`;
        }).join('')}
      </div>
      <div class="detail">
        <span class="rar">${w.cls}${slot ? ' · ' + slot : ''}</span>
        <h3>${w.name}</h3>
        <div class="stats">${bars.map(([l, v]) => `<div class="st"><span>${l}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`).join('')}</div>
        ${w.id !== 'pistol' ? `<div class="loadbtns"><button class="btn-ghost ${profile.loadout[0] === w.id ? 'on' : ''}" data-load="0">PRIMÁRIA</button><button class="btn-ghost ${profile.loadout[1] === w.id ? 'on' : ''}" data-load="1">SECUNDÁRIA</button></div>` : ''}
        <h4>SKINS</h4>
        <div class="skins">
          ${WEAPON_SKINS.map((s) => {
            const id = weaponSkinItemId(w.id, s.id);
            const own = s.id === 'default' || owns(id);
            return `<button class="skin ${skinNow === s.id ? 'sel' : ''} ${own ? '' : 'locked'}" data-skin="${s.id}" style="--rc:${RARITY[s.rarity].color};--sb:#${s.body.toString(16).padStart(6, '0')};--sg:#${s.glow.toString(16).padStart(6, '0')}" title="${s.name}"><i></i><span>${own ? s.name : priceHtml(s.price)}</span></button>`;
          }).join('')}
        </div>
        ${this.skinAction(w.id, skinNow)}
      </div>
    `;
  }

  private skinAction(w: WeaponId, s: string) {
    const id = weaponSkinItemId(w, s);
    const sk = WEAPON_SKINS.find((x) => x.id === s)!;
    if ((profile.weaponSkins[w] || 'default') === s) return '<button class="btn-ghost" disabled>SKIN EQUIPADA</button>';
    if (s === 'default' || owns(id)) return `<button class="btn-primary" data-a="equipskin">EQUIPAR SKIN</button>`;
    return `<button class="btn-buy ${canAfford(sk.price) ? '' : 'poor'}" data-a="buyskin">COMPRAR ${priceHtml(sk.price)}</button>`;
  }

  // ---------- rooms
  private roomsHtml() {
    if (this.currentRoom) return this.roomDetailHtml(this.currentRoom);
    const modeName = (id: string) => MODES.find((m) => m.id === id)?.name || id.toUpperCase();
    const mapName = (id: string) => BR_MAPS.find((m) => m.id === id)?.name || id.toUpperCase();
    return `
      <div class="rooms-scroll">
        <h2 class="sect">CRIAR SALA</h2>
        <form class="form room-form" id="roomCreateForm">
          <label>NOME DA SALA<input name="name" maxlength="24" placeholder="SALA DE ${esc(profile.name)}"/></label>
          <label>MODO<select name="mode">${MODES.filter((m) => m.id === 'squad').map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>
          <label>MAPA<select name="map">${BR_MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>
          <label>MÁX. JOGADORES<select name="max">${[4, 8, 16, 48].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
          <button class="btn-primary" type="submit" ${this.roomsBusy ? 'disabled' : ''}>CRIAR E ENTRAR</button>
        </form>
        <h2 class="sect">ENTRAR POR CÓDIGO</h2>
        <form class="form room-form" id="roomJoinForm">
          <label>CÓDIGO DA SALA<input name="code" maxlength="5" style="text-transform:uppercase" placeholder="EX: 7K2PX"/></label>
          <button class="btn-ghost" type="submit" ${this.roomsBusy ? 'disabled' : ''}>ENTRAR NA SALA</button>
        </form>
        <h2 class="sect">SALAS ABERTAS · ${this.roomList.length}</h2>
        <div class="room-list">
          ${this.roomList.length ? this.roomList.map((r) => `
            <button class="card room-card" data-join="${r.id}">
              <span class="rbar"></span>
              <b>${esc(r.name)}</b>
              <span class="foot">${modeName(r.mode)} · ${mapName(r.map)}</span>
              <span class="room-code">${r.code}</span>
            </button>`).join('') : '<p class="tip">Ainda não há salas abertas. Cria a primeira!</p>'}
        </div>
      </div>
    `;
  }

  private roomDetailHtml(r: RoomRow) {
    const isHost = r.host_id === this.authUserId;
    const members = this.roomMembers;
    const netBadge = (key: string) => {
      if (key === this.authUserId) return '<em class="net you">TU</em>';
      // Star topology: the host has a direct link to every guest; a guest only
      // knows the state of its own link to the host, not to other guests.
      const link = isHost ? this.netPeers.find((p) => p.id === key) : key === r.host_id ? this.netPeers.find((p) => p.id === r.host_id) : null;
      if (!link) return '<em class="net">—</em>';
      if (link.status === 'connected') return `<em class="net on">● P2P ${link.ping ?? '…'}ms</em>`;
      if (link.status === 'connecting') return '<em class="net">a ligar…</em>';
      return '<em class="net off">desligado</em>';
    };
    return `
      <div class="rooms-scroll">
        <h2 class="sect">${esc(r.name)}</h2>
        <div class="room-code-big">CÓDIGO <b>${r.code}</b></div>
        <p class="tip">Partilha este código para outras pessoas entrarem na tua sala.</p>
        <div class="mrow">
          <button class="btn-ghost" data-a="leave-room">SAIR DA SALA</button>
          ${isHost ? '<button class="btn-ghost danger" data-a="close-room">FECHAR SALA</button>' : ''}
          <button class="btn-primary ${this.roomReady ? 'on' : ''}" data-a="toggle-ready">${this.roomReady ? 'PRONTO ✓' : 'MARCAR PRONTO'}</button>
          ${isHost ? '<button class="btn-primary" data-a="start-room-match">INICIAR PARTIDA</button>' : ''}
        </div>
        ${isHost ? '' : '<p class="tip wait">A aguardar que o anfitrião da sala inicie a partida...</p>'}
        <h2 class="sect">JOGADORES NA SALA · ${members.length}</h2>
        <ul class="room-members">
          ${members.map((m) => `<li class="${m.ready ? 'ready' : ''}"><b>${esc(m.name)}</b>${netBadge(m.key)}<span>${m.ready ? 'PRONTO' : 'A PREPARAR...'}</span></li>`).join('')}
        </ul>
        <p class="tip">Ligação direta entre navegadores (WebRTC) para a partida.</p>
      </div>
    `;
  }

  // ------------------------------------------------------------------ events
  private go(page: Page) {
    if (this.page === 'rooms' && page !== 'rooms') this.leaveRoomsPage();
    this.page = page;
    this.sel = null;
    this.previewHero = null;
    this.previewOutfit = null;
    this.previewWeapon = null;
    this.previewGloo = null;
    if (page === 'arsenal') this.previewWeapon = { id: this.arsenalSel, skin: profile.weaponSkins[this.arsenalSel] || 'default' };
    if (page === 'rooms') this.enterRoomsPage();
    this.render();
  }

  // ---------- rooms (Supabase: a public `rooms` row per lobby + Realtime Presence for who's inside)
  private enterRoomsPage() {
    this.roomsUnsub?.();
    this.roomsUnsub = subscribeRoomList(() => this.refreshRooms());
    this.refreshRooms();
  }

  private leaveRoomsPage() {
    this.roomsUnsub?.();
    this.roomsUnsub = null;
    this.leaveCurrentRoom();
  }

  private leaveCurrentRoom() {
    this.roomChannel?.leave();
    this.roomChannel = null;
    this.net?.dispose();
    this.net = null;
    this.netPeers = [];
    this.currentRoom = null;
    this.roomMembers = [];
    this.roomReady = false;
  }

  private async refreshRooms() {
    try {
      this.roomList = await listRooms();
    } catch {
      /* transient network hiccup — keep the last known list */
    }
    this.render();
  }

  private async ensureUserId(): Promise<string | null> {
    if (!this.authUserId) {
      const { data } = await supabase.auth.getUser();
      this.authUserId = data.user?.id || null;
    }
    return this.authUserId;
  }

  private enterRoom(row: RoomRow) {
    this.currentRoom = row;
    this.roomReady = false;
    const uid = this.authUserId!;
    this.roomChannel = joinRoom(row.id, uid, profile.name, (members) => {
      this.roomMembers = members;
      this.render();
    });
    this.net = new RoomNet(row.id, uid, row.host_id === uid, row.host_id);
    this.net.onUpdate = (peers) => {
      this.netPeers = peers;
      this.render();
    };
    this.net.onMessage = (_from, data) => this.onRoomNetMessage(data as { t: string; seed: number; map: MapId; you: number });
    this.render();
  }

  private async createRoomFlow(name: string, mode: string, map: string, maxPlayers: number) {
    const uid = await this.ensureUserId();
    if (!uid) return this.toast('Sessão expirada, entra de novo.', true);
    this.roomsBusy = true;
    this.render();
    try {
      const row = await createRoom(uid, profile.name, name || `SALA DE ${profile.name}`, mode, map, maxPlayers);
      sfx.buy();
      this.enterRoom(row);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Não foi possível criar a sala.', true);
    } finally {
      this.roomsBusy = false;
      this.render();
    }
  }

  private async joinByCode(code: string) {
    if (!code.trim()) return;
    const uid = await this.ensureUserId();
    if (!uid) return this.toast('Sessão expirada, entra de novo.', true);
    this.roomsBusy = true;
    this.render();
    try {
      const row = await findRoomByCode(code);
      if (!row) this.toast('Não existe nenhuma sala com esse código.', true);
      else {
        sfx.pickup();
        this.enterRoom(row);
      }
    } catch {
      this.toast('Não foi possível procurar a sala.', true);
    } finally {
      this.roomsBusy = false;
      this.render();
    }
  }

  private async joinRoomFlow(id: string) {
    const row = this.roomList.find((r) => r.id === id);
    if (!row) return;
    const uid = await this.ensureUserId();
    if (!uid) return this.toast('Sessão expirada, entra de novo.', true);
    sfx.pickup();
    this.enterRoom(row);
  }

  /** Called after a room match ends: Match/NetMatch had taken over net.onMessage. */
  reclaimRoomNet() {
    if (!this.net) return;
    this.net.onMessage = (_from, data) => this.onRoomNetMessage(data as { t: string; seed: number; map: MapId; you: number });
  }

  private onRoomNetMessage(data: { t: string; seed: number; map: MapId; you: number }) {
    if (data.t !== 'start' || !this.currentRoom || !this.net) return;
    this.onNetPlay({ isHost: false, net: this.net, map: data.map, seed: data.seed, hostId: this.currentRoom.host_id, selfActorId: data.you });
  }

  private startRoomMatch() {
    // Only the room's creator may start the match — everyone else waits for
    // the 'start' message this sends them (see onRoomNetMessage).
    if (!this.currentRoom || !this.net || !this.authUserId || this.currentRoom.host_id !== this.authUserId) return;
    const seed = (Math.random() * 1e9) | 0;
    const others = this.roomMembers.filter((m) => m.key !== this.authUserId).map((m) => ({ id: m.key, name: m.name }));
    const map = this.currentRoom.map as MapId;
    others.forEach((o, i) => this.net!.sendTo(o.id, { t: 'start', seed, map, you: i + 1 }));
    sfx.buy();
    this.onNetPlay({ isHost: true, net: this.net, map, seed, hostId: this.authUserId, netPlayers: others });
  }

  private toggleReady() {
    if (!this.roomChannel) return;
    this.roomReady = !this.roomReady;
    this.roomChannel.setReady(this.roomReady);
    this.render();
  }

  private async closeRoomFlow() {
    if (!this.currentRoom) return;
    const id = this.currentRoom.id;
    this.leaveCurrentRoom();
    this.render();
    await deleteRoom(id);
  }

  private preview(id: string) {
    this.sel = id;
    this.previewHero = null;
    this.previewOutfit = null;
    this.previewWeapon = null;
    this.previewGloo = null;
    if (id.startsWith('hero:')) this.previewHero = id.slice(5);
    else if (id.startsWith('gloo:')) this.previewGloo = id.slice(5);
    else if (id.startsWith('wskin:')) {
      const [, w, s] = id.split(':') as [string, WeaponId, string];
      this.previewWeapon = { id: w, skin: s };
    } else {
      const it = ITEM_BY_ID.get(id);
      if (it) this.previewOutfit = { ...profile.outfit, [it.slot]: it.id };
    }
  }

  private equipSel() {
    const id = this.sel;
    if (!id) return;
    if (id.startsWith('hero:')) profile.hero = id.slice(5);
    else if (id.startsWith('gloo:')) profile.gloo = id.slice(5);
    else if (id.startsWith('wskin:')) {
      const [, w, s] = id.split(':') as [string, WeaponId, string];
      profile.weaponSkins[w] = s;
    } else {
      const it = ITEM_BY_ID.get(id);
      if (it) profile.outfit[it.slot] = it.id;
    }
    save();
    sfx.pickup();
  }

  private purchase(id: string, price: Price) {
    if (owns(id)) return;
    if (!canAfford(price)) {
      sfx.empty();
      this.toast(price.diamonds ? 'Diamantes insuficientes' : 'Ouro insuficiente', true);
      return;
    }
    this.confirm('CONFIRMAR COMPRA', `Comprar <b>${this.itemInfo(id)?.name}</b> por ${priceHtml(price)}?`, () => {
      if (buy(id, price)) {
        sfx.buy();
        this.toast('Compra efetuada!');
        this.equipSel();
        this.render();
      }
    });
  }

  private onClick(e: MouseEvent) {
    unlockAudio();
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-a],[data-page],[data-tab],[data-sel],[data-slot],[data-wear],[data-hero],[data-wpn],[data-skin],[data-load],[data-mode],[data-diff],[data-map],[data-join]');
    if (!b) return;
    sfx.click();
    const d = b.dataset;
    if (d.page) return this.go(d.page as Page);
    if (d.tab) {
      this.storeTab = d.tab as StoreTab;
      this.sel = null;
      this.previewHero = this.previewOutfit = null;
      this.previewWeapon = null;
      this.previewGloo = null;
      return this.render();
    }
    if (d.sel) {
      this.preview(d.sel);
      return this.render();
    }
    if (d.slot) {
      this.slotTab = d.slot as Slot;
      return this.render();
    }
    if (d.wear) {
      const it = ITEM_BY_ID.get(d.wear)!;
      profile.outfit[it.slot] = it.id;
      save();
      return this.render();
    }
    if (d.hero) {
      this.previewHero = d.hero;
      this.sel = 'hero:' + d.hero;
      return this.render();
    }
    if (d.wpn) {
      this.arsenalSel = d.wpn as WeaponId;
      this.previewWeapon = { id: this.arsenalSel, skin: profile.weaponSkins[this.arsenalSel] || 'default' };
      return this.render();
    }
    if (d.skin) {
      this.previewWeapon = { id: this.arsenalSel, skin: d.skin };
      return this.render();
    }
    if (d.load) {
      const i = Number(d.load) as 0 | 1;
      const w = this.arsenalSel;
      const other = profile.loadout[1 - i];
      if (other === w) profile.loadout[1 - i] = profile.loadout[i];
      profile.loadout[i] = w;
      save();
      return this.render();
    }
    if (d.mode) {
      profile.mode = d.mode as ModeId;
      save();
      this.el.querySelectorAll('.mselect .mcard').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.mode === d.mode));
      return;
    }
    if (d.map) {
      profile.map = d.map as typeof profile.map;
      save();
      this.el.querySelectorAll('.mapsel button').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.map === d.map));
      return;
    }
    if (d.diff) {
      profile.difficulty = d.diff as Difficulty;
      save();
      this.el.querySelectorAll('.diffs button').forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.diff === d.diff));
      return;
    }
    if (d.join) return this.joinRoomFlow(d.join);
    switch (d.a) {
      case 'back':
        return this.go('home');
      case 'leave-room':
        this.leaveCurrentRoom();
        return this.render();
      case 'close-room':
        return this.closeRoomFlow();
      case 'toggle-ready':
        return this.toggleReady();
      case 'start-room-match':
        return this.startRoomMatch();
      case 'start':
        return this.matchmaking();
      case 'modes':
        return this.modeModal();
      case 'settings':
        return this.settingsModal();
      case 'fullscreen':
        return toggleFullscreen();
      case 'daily':
        return this.claimDaily();
      case 'equip':
        this.equipSel();
        return this.render();
      case 'buy': {
        const info = this.itemInfo(this.sel!);
        if (info) this.purchase(this.sel!, info.price);
        return;
      }
      case 'buyhero': {
        const h = HERO_BY_ID.get(this.previewHero!)!;
        this.sel = 'hero:' + h.id;
        return this.purchase(this.sel, h.price);
      }
      case 'usehero':
        profile.hero = this.previewHero!;
        save();
        this.previewHero = null;
        sfx.pickup();
        return this.render();
      case 'equipskin':
        profile.weaponSkins[this.arsenalSel] = this.previewWeapon!.skin;
        save();
        sfx.pickup();
        return this.render();
      case 'buyskin': {
        const s = WEAPON_SKINS.find((x) => x.id === this.previewWeapon!.skin)!;
        this.sel = weaponSkinItemId(this.arsenalSel, s.id);
        return this.purchase(this.sel, s.price);
      }
      case 'close':
        this.closeModal();
        return this.render();
    }
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.set;
    if (!k) return;
    const s = profile.settings;
    if (k === 'sens') s.sens = Number(t.value);
    if (k === 'volume') s.volume = Number(t.value);
    if (k === 'aim') s.aimAssist = Number(t.value);
    if (k === 'quality') s.quality = t.value as typeof s.quality;
    if (k === 'fps') s.showFps = t.checked;
    if (k === 'ping') s.showPing = t.checked;
    if (k === 'leftfire') {
      s.leftFire = t.checked;
      document.getElementById('hud')?.classList.toggle('lefty', s.leftFire);
    }
    if (k === 'name') profile.name = t.value.replace(/[^\w\-À-ÿ ]/g, '').slice(0, 14).toUpperCase() || 'OPERADOR';
    const out = t.parentElement?.querySelector('output');
    if (out) out.textContent = t.value;
    save();
    if (k === 'quality') window.dispatchEvent(new Event('resize'));
  }

  private onSubmit(e: Event) {
    const form = e.target as HTMLFormElement;
    if (form.id !== 'roomCreateForm' && form.id !== 'roomJoinForm') return;
    e.preventDefault();
    if (this.roomsBusy) return;
    sfx.click();
    const data = new FormData(form);
    if (form.id === 'roomCreateForm') {
      this.createRoomFlow(String(data.get('name') || ''), String(data.get('mode') || 'squad'), String(data.get('map') || 'solaris'), Number(data.get('max') || 8));
    } else {
      this.joinByCode(String(data.get('code') || ''));
    }
  }

  // ------------------------------------------------------------------ modals
  private modal(html: string, cls = '') {
    this.closeModal();
    const m = document.createElement('div');
    m.className = `lb-modal ${cls}`;
    m.innerHTML = `<div class="mbox">${html}</div>`;
    m.addEventListener('click', (e) => {
      if (e.target === m && !cls.includes('locked')) this.closeModal();
    });
    this.el.appendChild(m);
    return m;
  }

  private closeModal() {
    this.el.querySelector('.lb-modal')?.remove();
  }

  private confirm(title: string, text: string, ok: () => void) {
    const m = this.modal(`<h2>${title}</h2><p>${text}</p><div class="mrow"><button class="btn-ghost" data-a="close">CANCELAR</button><button class="btn-primary" id="okBtn">CONFIRMAR</button></div>`);
    m.querySelector('#okBtn')!.addEventListener('click', () => {
      this.closeModal();
      ok();
    });
  }

  private toast(msg: string, bad = false) {
    const t = document.createElement('div');
    t.className = `lb-toast ${bad ? 'bad' : ''}`;
    t.textContent = msg;
    this.el.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  private modeModal() {
    this.modal(`
      <h2>SELECIONAR MODO</h2>
      <div class="mselect">
        ${MODES.map((m) => `<button class="mcard ${profile.mode === m.id ? 'sel' : ''}" data-mode="${m.id}" style="--mc:${m.color}"><span class="mtag">${m.players}</span><b>${m.name}</b><p>${m.desc}</p></button>`).join('')}
      </div>
      <h4>MAPA (BATTLE ROYALE · 4V4 · OBSERVADOR)</h4>
      <div class="mapsel">${BR_MAPS.map((mp) => `<button class="${profile.map === mp.id ? 'sel' : ''}" data-map="${mp.id}" style="--mc:${mp.color}"><b>${mp.name}</b><span>${mp.sub}</span></button>`).join('')}</div>
      <h4>DIFICULDADE DOS BOTS</h4>
      <div class="diffs">${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button class="${profile.difficulty === d ? 'on' : ''}" data-diff="${d}">${{ easy: 'FÁCIL', normal: 'NORMAL', hard: 'DIFÍCIL' }[d]}</button>`).join('')}</div>
      <div class="mrow"><button class="btn-primary" id="modeOk">CONFIRMAR</button></div>
    `, 'wide');
    this.el.querySelector('#modeOk')!.addEventListener('click', () => {
      sfx.click();
      this.closeModal();
      this.render();
    });
  }

  private settingsModal() {
    const s = profile.settings;
    const tab = this.settingsTab;
    const tabBtn = (id: typeof this.settingsTab, label: string) => `<button class="tab ${tab === id ? 'on' : ''}" data-stab="${id}">${label}</button>`;
    const panels: Record<typeof this.settingsTab, string> = {
      geral: `
        <label>NOME<input data-set="name" maxlength="14" value="${esc(profile.name)}"/></label>
        <div class="keys">
          <b>PC</b> WASD mover · RATO mirar · CLIQUE disparar · DIREITO zoom · ESPAÇO saltar · C agachar · R recarregar · 1/2/3 armas · E gelo · G granada · H curar · Q habilidade · F apanhar · M mapa · V falar com a equipa (premir) · ESC menu<br><b>OBSERVADOR</b> 1-5 câmaras · ←/→ jogador · R repetição · ESPAÇO/C subir/descer
        </div>`,
      controlos: `
        <label>SENSIBILIDADE <output>${s.sens}</output><input type="range" min="1" max="10" data-set="sens" value="${s.sens}"/></label>
        <label>ASSISTÊNCIA DE MIRA <output>${s.aimAssist}</output><input type="range" min="0" max="3" data-set="aim" value="${s.aimAssist}"/></label>
        <label class="chk"><input type="checkbox" data-set="leftfire" ${s.leftFire ? 'checked' : ''}/> BOTÃO DE DISPARO À ESQUERDA (CANHOTO)</label>`,
      audio: `
        <label>VOLUME <output>${s.volume}</output><input type="range" min="0" max="100" data-set="volume" value="${s.volume}"/></label>`,
      hud: `
        <label class="chk"><input type="checkbox" data-set="fps" ${s.showFps ? 'checked' : ''}/> MOSTRAR FPS</label>
        <label class="chk"><input type="checkbox" data-set="ping" ${s.showPing ? 'checked' : ''}/> MOSTRAR PING</label>
        <label>GRÁFICOS<select data-set="quality">${(['low', 'medium', 'high'] as const).map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${{ low: 'BAIXO (leve)', medium: 'MÉDIO', high: 'ALTO' }[q]}</option>`).join('')}</select></label>`,
    };
    const m = this.modal(`
      <h2>DEFINIÇÕES</h2>
      <div class="tabs stabs">${tabBtn('geral', 'GERAL')}${tabBtn('controlos', 'CONTROLOS')}${tabBtn('audio', 'ÁUDIO')}${tabBtn('hud', 'HUD')}</div>
      <div class="form">${panels[tab]}</div>
      <div class="mrow"><button class="btn-ghost danger" id="logoutBtn">SAIR DA CONTA</button><button class="btn-ghost danger" id="resetBtn">APAGAR PROGRESSO</button><button class="btn-primary" data-a="close">FECHAR</button></div>
    `);
    m.querySelectorAll<HTMLElement>('[data-stab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.settingsTab = b.dataset.stab as typeof this.settingsTab;
        this.settingsModal();
      }),
    );
    m.querySelector('#resetBtn')!.addEventListener('click', () =>
      this.confirm('APAGAR PROGRESSO', 'Isto apaga nível, moedas e itens comprados. Continuar?', () => {
        resetProfile();
        this.render();
      }),
    );
    m.querySelector('#logoutBtn')!.addEventListener('click', () =>
      this.confirm('SAIR DA CONTA', 'Vais voltar ao ecrã de login.', async () => {
        await flushSync();
        stopSync();
        await signOut();
        location.reload();
      }),
    );
  }

  private claimDaily() {
    if (Date.now() - profile.lastDaily <= DAILY_MS) {
      const h = Math.ceil((DAILY_MS - (Date.now() - profile.lastDaily)) / 3600000);
      this.toast(`Próxima recompensa em ${h}h`, true);
      return;
    }
    profile.lastDaily = Date.now();
    grantRewards(400, 30, 50);
    sfx.buy();
    this.render();
    this.modal(`<h2>RECOMPENSA DIÁRIA</h2><div class="rewards"><div>${COIN}<b>+400</b></div><div>${GEM}<b>+30</b></div><div><span>XP</span><b>+50</b></div></div><div class="mrow"><button class="btn-primary" data-a="close">BOA!</button></div>`);
  }

  private matchmaking() {
    unlockAudio();
    const mode = MODES.find((m) => m.id === profile.mode)!;
    const total = mode.id === 'br' || mode.id === 'watch' ? 48 : mode.id === 'squad' ? 8 : 1;
    const mapName = mode.maps ? BR_MAPS.find((x) => x.id === profile.map)!.name : 'CAMPO DE TREINO';
    const m = this.modal(`
      <div class="mm"><div class="spin"></div><h2>A PROCURAR PARTIDA</h2><p>${mode.name} · ${mapName}</p><b id="mmCount">1 / ${total}</b>
      <div class="mrow"><button class="btn-ghost" id="mmCancel">CANCELAR</button></div></div>`, 'locked');
    let n = 1;
    let done = false;
    const iv = setInterval(() => {
      n = Math.min(total, n + 1 + ((Math.random() * 3) | 0));
      const c = m.querySelector('#mmCount');
      if (c) c.textContent = `${n} / ${total}`;
      if (n >= total && !done) {
        done = true;
        clearInterval(iv);
        sfx.countdown(true);
        const h = m.querySelector('h2');
        if (h) h.textContent = 'A CARREGAR MAPA...';
        setTimeout(() => {
          this.closeModal();
          this.onPlay(profile.mode, profile.difficulty);
        }, 350);
      }
    }, 140);
    m.querySelector('#mmCancel')!.addEventListener('click', () => {
      clearInterval(iv);
      done = true;
      this.closeModal();
    });
  }

  showResult(r: MatchResult) {
    this.page = 'home';
    if (r.quit && r.mode === 'train') return this.render();
    if (r.mode === 'watch') {
      grantRewards(0, 0, r.quit ? 0 : 40);
      this.render();
      this.modal(`<div class="result win"><div class="rbig">BOOYAH!</div><div class="rsub">${r.winner ? 'CAMPEÃO: ' + esc(r.winner) : 'Transmissão terminada'}</div><div class="mrow"><button class="btn-primary" data-a="close">CONTINUAR</button></div></div>`, 'locked');
      return;
    }
    const p = profile;
    p.stats.matches++;
    p.stats.kills += r.kills;
    if (r.win) p.stats.wins++;
    p.stats.best = Math.max(p.stats.best, r.kills);
    const coins = r.quit ? 0 : Math.round(60 + r.kills * 35 + r.damage * 0.1 + (r.win ? 350 : Math.max(0, r.total - r.rank) * 12));
    const gems = r.quit ? 0 : (r.win ? 25 : 0) + (r.kills >= 3 ? 5 : 0);
    const xp = r.quit ? 10 : Math.round(80 + r.kills * 45 + (r.win ? 260 : 0) + r.time * 0.4);
    const ups = grantRewards(coins, gems, xp);
    const big = r.mode === 'br' ? (r.win ? 'BOOYAH!' : `#${r.rank}`) : r.win ? 'VITÓRIA' : 'DERROTA';
    const sub = r.mode === 'br' ? (r.win ? 'Último sobrevivente!' : `de ${r.total} jogadores${r.winner ? ' · campeão ' + esc(r.winner) : ''}`) : r.mode === 'squad' ? `${r.scoreA} - ${r.scoreB}` : 'Treino concluído';
    const t = Math.round(r.time);
    this.render();
    this.modal(`
      <div class="result ${r.win ? 'win' : ''}">
        <div class="rbig">${big}</div><div class="rsub">${sub}</div>
        <div class="rstats">
          <div><span>ABATES</span><b>${r.kills}</b></div>
          <div><span>DANO</span><b>${r.damage}</b></div>
          <div><span>TEMPO</span><b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b></div>
        </div>
        <h4>RECOMPENSAS</h4>
        <div class="rewards"><div>${COIN}<b>+${coins}</b></div><div>${GEM}<b>+${gems}</b></div><div><span>XP</span><b>+${xp}</b></div></div>
        ${ups ? `<div class="levelup">SUBISTE PARA O NÍVEL ${p.level}! <small>+${ups * 20} ${GEM}</small></div>` : ''}
        <div class="mrow"><button class="btn-primary" data-a="close">CONTINUAR</button></div>
      </div>`, 'locked');
    if (r.win) sfx.booyah();
  }

  show(on: boolean) {
    this.el.style.display = on ? '' : 'none';
    if (on) this.render();
  }
}

function glooIcon(body: number, cap: number) {
  const b = '#' + body.toString(16).padStart(6, '0'), c = '#' + cap.toString(16).padStart(6, '0');
  return `<svg class="ico" viewBox="0 0 64 64">${[0, 1, 2, 3, 4].map((i) => {
    const x = 6 + i * 10.6, y = 18 + Math.abs(i - 2) * 4;
    return `<rect x="${x}" y="${y}" width="10" height="${42 - y}" rx="2" fill="${b}" opacity=".9"/><rect x="${x}" y="${y - 3}" width="10" height="6" rx="3" fill="${c}"/>`;
  }).join('')}<rect x="4" y="56" width="56" height="4" rx="2" fill="rgba(0,0,0,.3)"/></svg>`;
}

function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element };
  if (document.fullscreenElement || d.webkitFullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const p = el.requestFullscreen ? el.requestFullscreen() : (el.webkitRequestFullscreen?.(), undefined);
  Promise.resolve(p)
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
    .catch(() => {});
}

