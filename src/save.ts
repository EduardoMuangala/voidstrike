import { DEFAULT_OUTFIT, ITEMS, type Outfit, type Price, type WeaponId } from './data';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sens: number;
  aimAssist: number;
  quality: Quality;
  volume: number;
  showFps: boolean;
  leftFire: boolean;
}

export interface Profile {
  name: string;
  level: number;
  xp: number;
  coins: number;
  diamonds: number;
  owned: string[];
  hero: string;
  outfit: Outfit;
  weaponSkins: Partial<Record<WeaponId, string>>;
  loadout: [WeaponId, WeaponId];
  stats: { matches: number; wins: number; kills: number; best: number };
  settings: Settings;
  lastDaily: number;
  mode: 'br' | 'squad' | 'train';
  difficulty: 'easy' | 'normal' | 'hard';
}

const KEY = 'voidstrike.profile.v3';
const isTouch = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

function fresh(): Profile {
  return {
    name: 'OPERADOR' + Math.floor(1000 + Math.random() * 9000),
    level: 1,
    xp: 0,
    coins: 2500,
    diamonds: 300,
    owned: ['hero:kai', ...ITEMS.filter((i) => !i.price.coins && !i.price.diamonds).map((i) => i.id)],
    hero: 'kai',
    outfit: { ...DEFAULT_OUTFIT },
    weaponSkins: {},
    loadout: ['ar', 'smg'],
    stats: { matches: 0, wins: 0, kills: 0, best: 0 },
    settings: { sens: 5, aimAssist: 2, quality: isTouch ? 'low' : 'medium', volume: 70, showFps: false, leftFire: true },
    lastDaily: 0,
    mode: 'br',
    difficulty: 'normal',
  };
}

function load(): Profile {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      ...base,
      ...p,
      outfit: { ...base.outfit, ...(p.outfit || {}) },
      stats: { ...base.stats, ...(p.stats || {}) },
      settings: { ...base.settings, ...(p.settings || {}) },
      owned: Array.from(new Set([...(base.owned), ...(p.owned || [])])),
    };
  } catch {
    return base;
  }
}

export const profile: Profile = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
}

export function resetProfile() {
  Object.assign(profile, fresh());
  save();
}

export const owns = (id: string) => profile.owned.includes(id);

export function canAfford(p: Price) {
  return (p.coins || 0) <= profile.coins && (p.diamonds || 0) <= profile.diamonds;
}

export function buy(id: string, p: Price): boolean {
  if (owns(id) || !canAfford(p)) return false;
  profile.coins -= p.coins || 0;
  profile.diamonds -= p.diamonds || 0;
  profile.owned.push(id);
  save();
  return true;
}

export const xpForLevel = (lvl: number) => 400 + (lvl - 1) * 150;

export function grantRewards(coins: number, diamonds: number, xp: number): number {
  profile.coins += coins;
  profile.diamonds += diamonds;
  profile.xp += xp;
  let ups = 0;
  while (profile.xp >= xpForLevel(profile.level)) {
    profile.xp -= xpForLevel(profile.level);
    profile.level++;
    profile.diamonds += 20;
    ups++;
  }
  save();
  return ups;
}
