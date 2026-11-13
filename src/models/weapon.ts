import * as THREE from 'three';
import { WEAPON_SKINS, type WeaponId } from '../data';
import { bake, box, cyl, glow, mat, part } from './materials';

const H = Math.PI / 2;
const templates = new Map<string, THREE.Group>();
export const MUZZLE: Record<WeaponId, number> = { ar: 0.72, smg: 0.46, sg: 0.74, sr: 1.02, dmr: 0.86, lmg: 0.86, pistol: 0.2 };

function build(id: WeaponId, skinId: string): THREE.Group {
  const skin = WEAPON_SKINS.find((s) => s.id === skinId) || WEAPON_SKINS[0];
  const B = mat(skin.body);
  const A = mat(skin.accent);
  const D = mat(0x16181d);
  const G = glow(skin.glow);
  const g = new THREE.Group();

  switch (id) {
    case 'ar':
      part(g, box(0.08, 0.12, 0.5), B, 0, 0, 0.12);
      part(g, box(0.075, 0.085, 0.22), A, 0, -0.005, 0.44);
      part(g, cyl(0.02, 0.02, 0.22), D, 0, 0.01, 0.62, H);
      part(g, box(0.06, 0.1, 0.24), B, 0, -0.025, -0.25);
      part(g, box(0.05, 0.17, 0.08), D, 0, -0.13, 0.14, 0.25);
      part(g, box(0.05, 0.12, 0.06), D, 0, -0.09, -0.04, -0.3);
      part(g, box(0.035, 0.05, 0.12), D, 0, 0.085, 0.1);
      part(g, box(0.085, 0.014, 0.26), G, 0, 0.035, 0.12);
      break;
    case 'smg':
      part(g, box(0.075, 0.11, 0.34), B, 0, 0, 0.08);
      part(g, cyl(0.022, 0.022, 0.18), D, 0, 0.01, 0.33, H);
      part(g, box(0.04, 0.24, 0.06), D, 0, -0.16, 0.1, 0.1);
      part(g, box(0.045, 0.11, 0.055), D, 0, -0.09, -0.04, -0.3);
      part(g, box(0.02, 0.06, 0.2), A, 0, -0.01, -0.16);
      part(g, box(0.05, 0.03, 0.08), A, 0, 0.07, 0.06);
      part(g, box(0.08, 0.014, 0.18), G, 0, 0.03, 0.1);
      break;
    case 'sg':
      part(g, box(0.09, 0.12, 0.4), B, 0, 0, 0.06);
      part(g, cyl(0.026, 0.026, 0.48), D, 0, 0.025, 0.48, H);
      part(g, cyl(0.022, 0.022, 0.4), D, 0, -0.03, 0.44, H);
      part(g, box(0.07, 0.07, 0.18), A, 0, -0.035, 0.4);
      part(g, box(0.07, 0.13, 0.28), B, 0, -0.04, -0.28, 0.1);
      part(g, box(0.05, 0.12, 0.06), D, 0, -0.1, -0.06, -0.3);
      part(g, box(0.095, 0.016, 0.16), G, 0, 0.04, 0.04);
      break;
    case 'sr':
      part(g, box(0.08, 0.11, 0.6), B, 0, 0, 0.12);
      part(g, cyl(0.016, 0.02, 0.48), D, 0, 0.015, 0.74, H);
      part(g, cyl(0.035, 0.035, 0.32), D, 0, 0.11, 0.1, H);
      part(g, cyl(0.042, 0.042, 0.05), A, 0, 0.11, 0.27, H);
      part(g, box(0.03, 0.05, 0.03), D, 0, 0.07, 0.04);
      part(g, box(0.07, 0.15, 0.3), B, 0, -0.04, -0.3, 0.12);
      part(g, box(0.045, 0.1, 0.08), D, 0, -0.1, 0.12);
      part(g, box(0.05, 0.12, 0.06), D, 0, -0.09, -0.08, -0.3);
      part(g, box(0.085, 0.014, 0.4), G, 0, 0.035, 0.1);
      break;
    case 'dmr':
      part(g, box(0.08, 0.12, 0.55), B, 0, 0, 0.12);
      part(g, cyl(0.018, 0.02, 0.28), D, 0, 0.01, 0.68, H);
      part(g, cyl(0.03, 0.03, 0.22), D, 0, 0.1, 0.1, H);
      part(g, box(0.06, 0.11, 0.24), A, 0, -0.025, -0.27);
      part(g, box(0.05, 0.14, 0.07), D, 0, -0.12, 0.16, 0.2);
      part(g, box(0.05, 0.12, 0.06), D, 0, -0.09, -0.05, -0.3);
      part(g, box(0.085, 0.014, 0.3), G, 0, 0.035, 0.14);
      break;
    case 'lmg':
      part(g, box(0.11, 0.14, 0.55), B, 0, 0, 0.1);
      part(g, cyl(0.04, 0.04, 0.28), A, 0, 0.01, 0.5, H);
      part(g, cyl(0.022, 0.022, 0.2), D, 0, 0.01, 0.74, H);
      part(g, cyl(0.11, 0.11, 0.08, 12), D, 0, -0.14, 0.12, 0, 0, H);
      part(g, box(0.03, 0.05, 0.22), D, 0, 0.11, 0.08);
      part(g, box(0.07, 0.12, 0.26), B, 0, -0.02, -0.28);
      part(g, box(0.05, 0.12, 0.06), D, 0, -0.1, -0.08, -0.3);
      part(g, box(0.115, 0.016, 0.3), G, 0, 0.04, 0.1);
      break;
    case 'pistol':
      part(g, box(0.045, 0.06, 0.22), B, 0, 0.03, 0.07);
      part(g, box(0.04, 0.12, 0.055), D, 0, -0.04, 0, -0.25);
      part(g, box(0.047, 0.012, 0.12), G, 0, 0.055, 0.06);
      break;
  }
  bake(g);
  return g;
}

export function weaponMesh(id: WeaponId, skin = 'default'): THREE.Group {
  const key = `${id}:${skin}`;
  let t = templates.get(key);
  if (!t) {
    t = build(id, skin);
    templates.set(key, t);
  }
  const c = t.clone();
  c.userData.muzzle = MUZZLE[id];
  return c;
}
