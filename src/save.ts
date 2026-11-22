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
  mode: 'br' | 'squad' | 'train' | 'watch';
  map: 'solaris' | 'inferna';
  gloo: string;
  difficulty: 'easy' | 'normal' | 'hard';
}

const KEY = 'voidstrike.profile.v3';
const isTouch = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

let activeKey = KEY;
let onSave: (() => void) | null = null;

/** Called by the cloud-sync module whenever a logged-in save happens, so it can push to Supabase too. */
export function setOnSave(fn: (() => void) | null) {
  onSave = fn;
}

function fresh(): Profile {
  return {
    name: 'OPERADOR' + Math.floor(1000 + Math.random() * 9000),
    level: 1,
    xp: 0,
    coins: 2500,
    diamonds: 300,
    owned: ['hero:kai', 'gloo:classic', ...ITEMS.filter((i) => !i.price.coins && !i.price.diamonds).map((i) => i.id)],
    hero: 'kai',
    outfit: { ...DEFAULT_OUTFIT },
    weaponSkins: {},
    loadout: ['ar', 'smg'],
    stats: { matches: 0, wins: 0, kills: 0, best: 0 },
    settings: { sens: 5, aimAssist: 2, quality: isTouch ? 'low' : 'medium', volume: 70, showFps: false, leftFire: true },
    lastDaily: 0,
    mode: 'br',
    map: 'solaris',
    gloo: 'classic',
    difficulty: 'normal',
  };
}

function merge(base: Profile, p: Partial<Profile>): Profile {
  return {
    ...base,
    ...p,
    outfit: { ...base.outfit, ...(p.outfit || {}) },
    stats: { ...base.stats, ...(p.stats || {}) },
    settings: { ...base.settings, ...(p.settings || {}) },
    owned: Array.from(new Set([...base.owned, ...(p.owned || [])])),
  };
}

function loadKey(key: string): Profile {
  const base = fresh();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return base;
    return merge(base, JSON.parse(raw) as Partial<Profile>);
  } catch {
    return base;
  }
}

export const profile: Profile = loadKey(activeKey);

export function save() {
  try {
    localStorage.setItem(activeKey, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
  onSave?.();
}

/**
 * Switches local storage to a per-account namespace so two different
 * accounts on the same browser never see each other's progress. The first
 * time a given user logs in on this browser, any pre-login (legacy-key)
 * progress is migrated into their namespaced save instead of being lost.
 * Returns the profile data to reconcile against the cloud copy, if any.
 */
export function switchToUser(userId: string): Profile {
  activeKey = `${KEY}.${userId}`;
  const existing = localStorage.getItem(activeKey);
  const loaded = existing ? loadKey(activeKey) : loadKey(KEY);
  Object.assign(profile, loaded);
  save();
  return profile;
}

/** Applies cloud data on top of the current local profile (cloud wins on conflicting fields) and saves. */
export function applyCloudProfile(p: Partial<Profile>) {
  Object.assign(profile, merge(profile, p));
  save();
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
