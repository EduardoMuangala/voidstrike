import type { HeroDef, OutfitItem, WeaponId, WeaponSkin } from '../data';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export const COIN = '<svg class="cur" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffb81c"/><circle cx="12" cy="12" r="7" fill="#ffd45c"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" stroke="#b37400" stroke-width="1.6" fill="none"/></svg>';
export const GEM = '<svg class="cur" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z" fill="#3fd0ff"/><path d="M2 9h20M8 3l4 18 4-18M6 3l2 6 4-6 4 6 2-6" stroke="#bff3ff" stroke-width="1" fill="none"/></svg>';

export const MENU_ICONS: Record<string, string> = {
  store: '<svg viewBox="0 0 24 24"><path d="M4 8h16l-1 12H5z" fill="currentColor"/><path d="M8 8a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  wardrobe: '<svg viewBox="0 0 24 24"><path d="M8 3l4 2 4-2 5 4-3 3-2-1v12H8V9l-2 1-3-3z" fill="currentColor"/></svg>',
  rooms: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="17" cy="9" r="2.4" fill="currentColor" opacity=".7"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6z" fill="currentColor"/><path d="M13 20c.3-3 2-5 4.3-5 2.4 0 4.3 1.8 4.7 5z" fill="currentColor" opacity=".7"/></svg>',
  heroes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7z" fill="currentColor"/></svg>',
  arsenal: '<svg viewBox="0 0 24 24"><path d="M2 9h15l2-2h3v4h-3l-1 2h-4l-1 3H9l1-3H6l-2 5H2l1-5H2z" fill="currentColor"/></svg>',
  daily: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="12" rx="1" fill="currentColor"/><rect x="2" y="6" width="20" height="4" fill="currentColor"/><path d="M12 6v15" stroke="#111" stroke-width="2"/><path d="M12 6c-2-4-6-3-5 0M12 6c2-4 6-3 5 0" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 5v-2l-2.2-.6-.6-1.5 1.1-2-1.4-1.4-2 1.1-1.5-.6L13.8 3h-2l-.6 2.2-1.5.6-2-1.1-1.4 1.4 1.1 2-.6 1.5L3 11v2l2.2.6.6 1.5-1.1 2 1.4 1.4 2-1.1 1.5.6.6 2.2h2l.6-2.2 1.5-.6 2 1.1 1.4-1.4-1.1-2 .6-1.5z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8" stroke="currentColor" stroke-width="3" fill="none"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
};

export function itemIcon(it: OutfitItem): string {
  const a = hex(it.c1), b = hex(it.c2);
  const g = it.glow ? hex(it.glow) : b;
  switch (it.slot) {
    case 'head':
      if (it.style === 'none') return none();
      if (it.style === 'crown') return svg(`<path d="M10 40l6-22 10 12 6-18 6 18 10-12 6 22z" fill="${a}"/><rect x="10" y="40" width="44" height="8" fill="${a}"/><circle cx="32" cy="44" r="3" fill="${b}"/><circle cx="20" cy="44" r="2.5" fill="${b}"/><circle cx="44" cy="44" r="2.5" fill="${b}"/>`);
      if (it.style === 'ears') return svg(`<path d="M14 44L18 14l12 18zM50 44L46 14 34 32z" fill="${a}"/><path d="M18 38l2-16 6 10zM46 38l-2-16-6 10z" fill="${g}"/><path d="M12 46q20-12 40 0" stroke="${a}" stroke-width="5" fill="none"/>`);
      if (it.style === 'bandana') return svg(`<path d="M10 34q22-14 44 0v8q-22-12-44 0z" fill="${a}"/><path d="M50 38l8 12-4 2-6-10zM50 38l2 14" stroke="${a}" stroke-width="4"/><circle cx="24" cy="34" r="2" fill="${b}"/><circle cx="38" cy="33" r="2" fill="${b}"/>`);
      if (it.style === 'helmet') return svg(`<path d="M10 40a22 22 0 0 1 44 0z" fill="${a}"/><rect x="6" y="38" width="52" height="6" rx="2" fill="${a}"/><rect x="26" y="20" width="12" height="6" fill="${b}"/>`);
      if (it.style === 'beanie') return svg(`<path d="M12 42a20 22 0 0 1 40 0z" fill="${a}"/><rect x="10" y="38" width="44" height="9" rx="3" fill="${b}"/><circle cx="32" cy="16" r="5" fill="${b}"/>`);
      return svg(`<path d="M12 38a20 18 0 0 1 40 0z" fill="${a}"/><path d="M30 36h28q-2 8-14 8H30z" fill="${a}"/><rect x="28" y="24" width="8" height="6" fill="${b}"/>`);
    case 'face':
      if (it.style === 'none') return none();
      if (it.style === 'skull') return svg(`<path d="M14 30a18 18 0 0 1 36 0v10l-6 4v6H20v-6l-6-4z" fill="${a}"/><circle cx="25" cy="32" r="5" fill="${b}"/><circle cx="39" cy="32" r="5" fill="${b}"/><path d="M28 46h8M30 42l2-4 2 4" stroke="${b}" stroke-width="2" fill="none"/>`);
      if (it.style === 'visor') return svg(`<rect x="8" y="24" width="48" height="16" rx="8" fill="${a}"/><rect x="12" y="29" width="40" height="6" rx="3" fill="${g}"/>`);
      if (it.style === 'halfmask') return svg(`<path d="M10 30h44q-2 20-22 20T10 30z" fill="${a}"/><rect x="26" y="38" width="12" height="6" rx="2" fill="${b}"/>`);
      return svg(`<rect x="8" y="26" width="20" height="12" rx="5" fill="${a}"/><rect x="36" y="26" width="20" height="12" rx="5" fill="${a}"/><path d="M28 30h8M4 28h4M56 28h4" stroke="${b}" stroke-width="3"/>`);
    case 'top':
      return svg(`<path d="M20 10l12 5 12-5 14 10-6 10-6-3v27H18V27l-6 3-6-10z" fill="${a}"/>${
        it.style === 'jacket' ? `<path d="M28 14h8v40h-8z" fill="${b}"/>` : it.style === 'hoodie' ? `<path d="M24 12q8 10 16 0" stroke="${b}" stroke-width="3" fill="none"/><rect x="24" y="38" width="16" height="8" rx="2" fill="${b}"/>` : it.style === 'vest' ? `<rect x="20" y="24" width="24" height="16" fill="${b}"/>` : `<rect x="26" y="24" width="12" height="4" fill="${b}"/>`
      }${it.glow ? `<path d="M18 50h28" stroke="${g}" stroke-width="3"/>` : ''}`);
    case 'bottom':
      return it.style === 'shorts'
        ? svg(`<path d="M16 14h32l4 26H35l-3-14-3 14H12z" fill="${a}"/><path d="M14 30l2-16M50 30l-2-16" stroke="${b}" stroke-width="2"/>`)
        : svg(`<path d="M18 8h28l4 50H36l-4-34-4 34H14z" fill="${a}"/>${it.style === 'cargo' ? `<rect x="15" y="28" width="9" height="10" fill="${b}"/><rect x="40" y="28" width="9" height="10" fill="${b}"/>` : ''}${it.glow ? `<path d="M16 56l3-46M48 56l-3-46" stroke="${g}" stroke-width="2"/>` : ''}`);
    case 'shoes':
      return svg(`<path d="M8 40V24h14l6 8 20 4q8 2 8 8v2H8z" fill="${a}"/><rect x="6" y="44" width="52" height="6" rx="2" fill="${it.glow ? g : b}"/>${it.style === 'boots' ? `<rect x="8" y="14" width="16" height="12" fill="${a}"/>` : ''}`);
    case 'back':
      if (it.style === 'none') return none();
      if (it.style === 'wings') return svg(`<path d="M30 30Q14 6 4 14q6 4 4 10 6 2 4 8 8 2 18-2zM34 30Q50 6 60 14q-6 4-4 10-6 2-4 8-8 2-18-2z" fill="${a}"/><path d="M30 30Q18 16 10 18M34 30q12-14 20-12" stroke="${g}" stroke-width="2" fill="none"/>`);
      if (it.style === 'katana') return svg(`<path d="M12 54L50 10l3 3-38 44z" fill="#c8ccd2"/><path d="M8 58l8-9 4 4-8 9z" fill="${b}"/><rect x="14" y="46" width="10" height="3" transform="rotate(-48 19 47)" fill="${a}"/>`);
      return svg(`<rect x="16" y="14" width="32" height="40" rx="8" fill="${a}"/><rect x="20" y="34" width="24" height="12" rx="3" fill="${b}"/><path d="M24 14q8-10 16 0" stroke="${b}" stroke-width="3" fill="none"/>`);
  }
}

export function heroIcon(h: HeroDef): string {
  const s = hex(h.skin), hc = hex(h.hairColor);
  const hair =
    h.hair === 'mohawk' ? `<rect x="28" y="4" width="8" height="16" rx="3" fill="${hc}"/>`
      : h.hair === 'long' ? `<path d="M14 26a18 18 0 0 1 36 0v24H44V28H20v22h-6z" fill="${hc}"/>`
        : h.hair === 'ponytail' ? `<path d="M14 26a18 18 0 0 1 36 0q-4-8-18-8t-18 8z" fill="${hc}"/><path d="M48 22q10 6 6 20" stroke="${hc}" stroke-width="6" fill="none"/>`
          : h.hair === 'buzz' ? `<path d="M15 24a17 17 0 0 1 34 0q-8-6-17-6t-17 6z" fill="${hc}"/>`
            : `<path d="M13 28a19 19 0 0 1 38 0q-6-6-14-4l-6-4-8 4q-6 0-10 4z" fill="${hc}"/>`;
  return svg(`<rect x="22" y="44" width="20" height="10" fill="${s}"/><path d="M8 64q0-14 24-14t24 14z" fill="#2b2f38"/><ellipse cx="32" cy="30" rx="16" ry="18" fill="${s}"/><rect x="24" y="28" width="4" height="5" fill="#16120f"/><rect x="36" y="28" width="4" height="5" fill="#16120f"/>${hair}`);
}

const GUN_PATHS: Record<WeaponId, string> = {
  ar: 'M4 26h40l4-3h10v6h-6v4H40l-4 10h-7l2-10h-6l-4 12h-7l3-12H4z',
  smg: 'M10 24h32l4-2h8v6h-8v3H36l-2 14h-6l1-14h-6l-3 8h-6l2-8h-6z',
  sg: 'M2 24h50l6-2v6l-6 2H40l-2 6H24l-3 10h-8l3-10H6l-4 6z',
  sr: 'M2 26h44l8-2h8v4h-8l-2 2H34l-3 12h-6l2-12h-9l-4 10H6l3-10H2zM16 18h18v6H16z',
  dmr: 'M4 26h42l6-2h8v5h-8v3H38l-3 11h-6l2-11h-8l-4 10h-7l3-10H4zM18 19h14v5H18z',
  lmg: 'M4 24h44l4-2h8v6h-8v4H40l-2 4H24v10H14v-10H6l-2 6zM26 32a6 6 0 1 0 12 0z',
  pistol: 'M14 22h34v8H34l-2 4h-6l-3 12h-9l3-12h-3z',
};

export function weaponIcon(id: WeaponId, skin?: WeaponSkin): string {
  const body = skin ? hex(skin.body) : '#d6dbe4';
  const glow = skin ? hex(skin.glow) : '#ffb81c';
  return `<svg class="ico gun" viewBox="0 0 64 64"><path d="${GUN_PATHS[id]}" fill="${body}" stroke="rgba(0,0,0,.45)" stroke-width="1"/><path d="M14 27h22" stroke="${glow}" stroke-width="2"/></svg>`;
}

function svg(inner: string) {
  return `<svg class="ico" viewBox="0 0 64 64">${inner}</svg>`;
}
function none() {
  return svg('<circle cx="32" cy="32" r="16" stroke="#5b6372" stroke-width="4" fill="none"/><path d="M21 43L43 21" stroke="#5b6372" stroke-width="4"/>');
}
