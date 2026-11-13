import { WEAPONS, type WeaponId } from '../data';
import { isTouch } from './input';

const ICON = {
  heal: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="3" fill="#fff"/><path d="M10 9h4v3h3v4h-3v3h-4v-3H7v-4h3z" fill="#e5383b"/><rect x="8" y="3" width="8" height="4" rx="1" fill="#fff"/></svg>',
  gel: '<svg viewBox="0 0 24 24"><path d="M3 20V9c0-3 4-6 9-6s9 3 9 6v11z" fill="#8fe3ff"/><path d="M6 20V10c0-2 3-4 6-4" stroke="#fff" stroke-width="2" fill="none" opacity=".7"/></svg>',
  nade: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="7" fill="#5c8a3a"/><rect x="10" y="3" width="5" height="5" rx="1" fill="#333"/><path d="M15 5h4" stroke="#ccc" stroke-width="2"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v7H9v-7H5z" fill="#fff"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="3" fill="#fff"/><path d="M8 11h7l2 5h3v3h-5l-2-4-3 4H6l3-5z" fill="#fff"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 0 7 7h-3a4 4 0 1 1-4-4v3l5-4.5L12 2z" fill="#fff"/></svg>',
  scope: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="#fff" stroke-width="2" fill="none"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="#fff" stroke-width="2"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" stroke="#fff" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2" fill="#fff"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#fff" stroke-width="2"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="#fff"/><rect x="14" y="5" width="4" height="14" rx="1" fill="#fff"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M7 11V5a1.5 1.5 0 0 1 3 0v5V3.5a1.5 1.5 0 0 1 3 0V10V4.5a1.5 1.5 0 0 1 3 0V11v-3a1.5 1.5 0 0 1 3 0v7c0 4-3 7-7 7s-6-2-8-6l-2-4a1.5 1.5 0 0 1 2.5-1.5z" fill="#fff"/></svg>',
};

export class Hud {
  el: HTMLElement;
  private $ = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private cache = new Map<string, string | number | boolean>();
  mini: CanvasRenderingContext2D;
  private feed: HTMLElement;
  private pops: HTMLElement;
  private tags: HTMLElement;
  private tagPool: HTMLElement[] = [];
  private popPool: HTMLElement[] = [];
  private bannerT = 0;
  private hitT = 0;
  private dirs: { el: HTMLElement; t: number }[] = [];

  constructor(parent: HTMLElement, mode: string) {
    const el = document.createElement('div');
    el.id = 'hud';
    el.className = `mode-${mode} ${isTouch ? 'touch' : 'desk'}`;
    el.innerHTML = `
      <div id="vignette"></div><div id="dmgflash"></div>
      <div id="tags"></div><div id="pops"></div>
      <div id="scope"><i></i></div>
      <div id="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
      <div id="hitmark"><i></i><i></i><i></i><i></i></div>
      <div id="dirs"></div>
      <div class="hud-ui" id="topl">
        <button class="hbtn sm" data-act="pause">${ICON.pause}</button>
        <div id="fps"></div>
      </div>
      <div id="topc">
        <div class="tstat" id="tsAlive"><span>VIVOS</span><b>0</b></div>
        <div class="tstat" id="tsKills"><span>ABATES</span><b>0</b></div>
        <div class="tstat zone" id="tsZone"><span>ZONA</span><b>--</b></div>
        <div class="score" id="tsScore"><b class="a">0</b><span id="tsTime">5:00</span><b class="f">0</b></div>
      </div>
      <div id="minimap"><canvas width="150" height="150"></canvas><span class="n">N</span></div>
      <div id="killfeed"></div>
      <div id="banner"><b></b><span></span></div>
      <div id="center-msg"></div>
      <button class="hud-ui" id="prompt" data-act="pickup">${ICON.hand}<span></span><kbd>F</kbd></button>
      <div class="hud-ui" id="vitals">
        <div class="armor" id="armorBadge">0</div>
        <div class="bars"><div class="hpbar"><i id="hpFill"></i><i id="hpGhost"></i></div><b id="hpTxt">100</b></div>
      </div>
      <div class="hud-ui" id="wslots">
        ${[0, 1, 2].map((i) => `<button class="wslot" data-act="slot${i}"><kbd>${i + 1}</kbd><b>—</b><span>VAZIO</span></button>`).join('')}
      </div>
      <div class="hud-ui" id="ammo"><b id="ammoMag">0</b><span id="ammoMax">/ 0</span><em id="reloadTxt">A RECARREGAR</em></div>
      <div class="hud-ui" id="utils">
        <button class="hbtn util" data-act="heal">${ICON.heal}<i id="cHeal">0</i><kbd>H</kbd><s id="healRing"></s></button>
        <button class="hbtn util" data-act="gel">${ICON.gel}<i id="cGel">0</i><kbd>E</kbd></button>
        <button class="hbtn util" data-act="nade">${ICON.nade}<i id="cNade">0</i><kbd>G</kbd></button>
        <button class="hbtn util abil" data-act="ability"><span id="abIcon">⚡</span><s id="abCd"></s><kbd>Q</kbd></button>
      </div>
      <div id="touch">
        <div id="joy"><i id="joyKnob"></i></div>
        <div class="joyhint">MOVER</div>
        <button class="hbtn fire main" data-act="fire">${ICON.fire}</button>
        <button class="hbtn fire left" data-act="fire">${ICON.fire}</button>
        <button class="hbtn tb" id="tbAds" data-act="ads">${ICON.scope}</button>
        <button class="hbtn tb" id="tbJump" data-act="jump">${ICON.jump}</button>
        <button class="hbtn tb" id="tbCrouch" data-act="crouch">${ICON.crouch}</button>
        <button class="hbtn tb" id="tbReload" data-act="reload">${ICON.reload}</button>
      </div>
      <div id="deskhint">CLIQUE PARA CONTROLAR · WASD mover · RATO mirar · BOTÃO DIREITO zoom · ESPAÇO saltar · C agachar</div>
    `;
    parent.appendChild(el);
    this.el = el;
    this.mini = this.$<HTMLCanvasElement>('#minimap canvas').getContext('2d')!;
    this.feed = this.$('#killfeed');
    this.pops = this.$('#pops');
    this.tags = this.$('#tags');
  }

  private set(key: string, val: string | number | boolean, fn: () => void) {
    if (this.cache.get(key) === val) return;
    this.cache.set(key, val);
    fn();
  }

  text(sel: string, v: string | number) {
    this.set('t' + sel, v, () => (this.$(sel).textContent = String(v)));
  }

  toggle(sel: string, cls: string, on: boolean) {
    this.set('c' + sel + cls, on, () => this.$(sel).classList.toggle(cls, on));
  }

  vitals(hp: number, armor: number, shield: boolean) {
    const h = Math.max(0, Math.ceil(hp));
    this.set('hp', h, () => {
      this.$('#hpFill').style.width = `${h}%`;
      this.$('#hpTxt').textContent = String(h);
      this.$('#vitals').classList.toggle('low', h <= 30);
      setTimeout(() => (this.$('#hpGhost').style.width = `${h}%`), 250);
    });
    this.set('armor', armor, () => {
      const b = this.$('#armorBadge');
      b.textContent = armor ? `LV${armor}` : '—';
      b.className = `armor lv${armor}`;
    });
    this.toggle('#vitals', 'shield', shield);
    this.toggle('#vignette', 'on', hp <= 30);
  }

  weapons(slots: ({ id: WeaponId; mag: number } | null)[], cur: number, reloading: boolean) {
    const btns = this.el.querySelectorAll<HTMLElement>('.wslot');
    slots.forEach((s, i) => {
      const k = s ? `${s.id}:${s.mag}:${i === cur}` : `none:${i === cur}`;
      this.set('ws' + i, k, () => {
        const b = btns[i];
        b.classList.toggle('on', i === cur);
        b.classList.toggle('empty', !s);
        b.querySelector('b')!.textContent = s ? WEAPONS[s.id].name : '—';
        b.querySelector('span')!.textContent = s ? WEAPONS[s.id].cls : 'VAZIO';
      });
    });
    const s = slots[cur];
    this.text('#ammoMag', s ? s.mag : 0);
    this.text('#ammoMax', s ? `/ ${WEAPONS[s.id].mag}` : '/ 0');
    this.toggle('#ammo', 'reloading', reloading);
    this.toggle('#ammo', 'low', !!s && s.mag <= Math.ceil(WEAPONS[s.id].mag * 0.25));
  }

  counts(meds: number, gel: number, nades: number) {
    this.text('#cHeal', meds);
    this.text('#cGel', gel);
    this.text('#cNade', nades);
    this.toggle('[data-act="heal"]', 'off', meds <= 0);
    this.toggle('[data-act="gel"]', 'off', gel <= 0);
    this.toggle('[data-act="nade"]', 'off', nades <= 0);
  }

  ability(icon: string, frac: number) {
    this.text('#abIcon', icon);
    const p = Math.round(frac * 100);
    this.set('ab', p, () => {
      this.$('#abCd').style.setProperty('--p', `${p}%`);
      this.$('.abil').classList.toggle('ready', p >= 100);
    });
  }

  healing(frac: number) {
    const p = Math.round(frac * 100);
    this.set('heal', p, () => {
      this.$('#healRing').style.setProperty('--p', `${p}%`);
      this.$('[data-act="heal"]').classList.toggle('busy', p > 0 && p < 100);
    });
  }

  crosshair(gap: number, visible: boolean, onTarget: boolean) {
    const g = Math.round(gap);
    this.set('xg', g, () => this.$('#xhair').style.setProperty('--g', `${g}px`));
    this.toggle('#xhair', 'hide', !visible);
    this.toggle('#xhair', 'target', onTarget);
  }

  scope(on: boolean) {
    this.toggle('#scope', 'on', on);
  }

  hit(head: boolean, kill: boolean) {
    const h = this.$('#hitmark');
    h.className = head ? 'head show' : 'show';
    if (kill) h.classList.add('kill');
    this.hitT = 0.18;
  }

  damagePop(x: number, y: number, amount: number, head: boolean) {
    let p = this.popPool.pop();
    if (!p) {
      p = document.createElement('div');
      p.className = 'pop';
    }
    p.textContent = String(Math.round(amount));
    p.classList.toggle('head', head);
    p.style.left = `${x + (Math.random() - 0.5) * 30}px`;
    p.style.top = `${y - 20}px`;
    p.style.animation = 'none';
    void p.offsetWidth;
    p.style.animation = '';
    this.pops.appendChild(p);
    setTimeout(() => {
      p!.remove();
      this.popPool.push(p!);
    }, 700);
  }

  hurtDir(angle: number) {
    let d = this.dirs.find((x) => x.t <= 0);
    if (!d) {
      if (this.dirs.length > 5) d = this.dirs[0];
      else {
        const el = document.createElement('i');
        this.$('#dirs').appendChild(el);
        d = { el, t: 0 };
        this.dirs.push(d);
      }
    }
    d.t = 0.9;
    d.el.style.transform = `rotate(${angle}rad)`;
    d.el.style.opacity = '1';
    const f = this.$('#dmgflash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  kill(killer: string, victim: string, weapon: string, head: boolean, mine: boolean, ally: number) {
    const row = document.createElement('div');
    row.className = `kf ${mine ? 'mine' : ''} ${ally > 0 ? 'ally' : ally < 0 ? 'enemy' : ''}`;
    row.innerHTML = `<b>${esc(killer)}</b><span>${esc(weapon)}${head ? ' ✦' : ''}</span><b>${esc(victim)}</b>`;
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('out'), 4500);
    setTimeout(() => row.remove(), 5000);
  }

  banner(title: string, sub = '', dur = 2.2) {
    const b = this.$('#banner');
    b.querySelector('b')!.textContent = title;
    b.querySelector('span')!.textContent = sub;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerT = dur;
  }

  center(msg: string) {
    this.text('#center-msg', msg);
    this.toggle('#center-msg', 'show', !!msg);
  }

  prompt(label: string | null) {
    this.set('prompt', label || '', () => {
      const p = this.$('#prompt');
      p.classList.toggle('show', !!label);
      if (label) p.querySelector('span')!.textContent = label;
    });
  }

  tag(i: number, x: number, y: number, name: string, hp: number, kind: 'ally' | 'enemy', showHp: boolean) {
    let t = this.tagPool[i];
    if (!t) {
      t = document.createElement('div');
      t.className = 'tag';
      t.innerHTML = '<span></span><i><b></b></i>';
      this.tags.appendChild(t);
      this.tagPool[i] = t;
    }
    t.style.display = '';
    t.style.transform = `translate(${x | 0}px, ${y | 0}px)`;
    const k = `${name}|${kind}|${Math.ceil(hp)}|${showHp}`;
    if (t.dataset.k !== k) {
      t.dataset.k = k;
      t.className = `tag ${kind} ${showHp ? 'hp' : ''}`;
      t.querySelector('span')!.textContent = name;
      (t.querySelector('b') as HTMLElement).style.width = `${Math.max(0, hp)}%`;
    }
  }

  hideTags(from: number) {
    for (let i = from; i < this.tagPool.length; i++) this.tagPool[i].style.display = 'none';
  }

  fps(v: number | null) {
    this.text('#fps', v === null ? '' : `${v} FPS`);
  }

  update(dt: number) {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.$('#banner').classList.remove('show');
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.$('#hitmark').className = '';
    }
    for (const d of this.dirs) {
      if (d.t <= 0) continue;
      d.t -= dt;
      d.el.style.opacity = String(Math.max(0, d.t / 0.9));
    }
  }

  dispose() {
    this.el.remove();
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
