export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'COMUM', color: '#9aa4b2' },
  rare: { label: 'RARO', color: '#3fa9ff' },
  epic: { label: 'ÉPICO', color: '#b45cff' },
  legendary: { label: 'LENDÁRIO', color: '#ffb81c' },
};

export interface Price { coins?: number; diamonds?: number }

// ---------------------------------------------------------------- WEAPONS
export type WeaponId = 'ar' | 'smg' | 'sg' | 'sr' | 'dmr' | 'lmg' | 'pistol';
export type WeaponClass = 'RIFLE' | 'SMG' | 'ESCOPETA' | 'SNIPER' | 'DMR' | 'METRALHADORA' | 'PISTOLA';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cls: WeaponClass;
  dmg: number;
  pellets: number;
  interval: number;
  mag: number;
  reload: number;
  spread: number;
  adsSpread: number;
  range: number;
  head: number;
  auto: boolean;
  adsFov: number;
  scope: boolean;
  moveMul: number;
  recoil: number;
  tier: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: { id: 'ar', name: 'VX-4', cls: 'RIFLE', dmg: 22, pellets: 1, interval: 0.105, mag: 30, reload: 2.0, spread: 0.022, adsSpread: 0.008, range: 95, head: 1.9, auto: true, adsFov: 48, scope: false, moveMul: 0.95, recoil: 0.012, tier: 3 },
  smg: { id: 'smg', name: 'VIPER', cls: 'SMG', dmg: 15, pellets: 1, interval: 0.068, mag: 35, reload: 1.6, spread: 0.034, adsSpread: 0.018, range: 45, head: 1.6, auto: true, adsFov: 55, scope: false, moveMul: 1.05, recoil: 0.009, tier: 2 },
  sg: { id: 'sg', name: 'BRUTE', cls: 'ESCOPETA', dmg: 13, pellets: 9, interval: 0.85, mag: 6, reload: 2.4, spread: 0.075, adsSpread: 0.06, range: 24, head: 1.5, auto: false, adsFov: 58, scope: false, moveMul: 1, recoil: 0.05, tier: 3 },
  sr: { id: 'sr', name: 'LONGSHOT', cls: 'SNIPER', dmg: 96, pellets: 1, interval: 1.35, mag: 5, reload: 2.8, spread: 0.06, adsSpread: 0.0, range: 220, head: 2.6, auto: false, adsFov: 16, scope: true, moveMul: 0.9, recoil: 0.06, tier: 4 },
  dmr: { id: 'dmr', name: 'RAPTOR', cls: 'DMR', dmg: 46, pellets: 1, interval: 0.32, mag: 12, reload: 2.2, spread: 0.03, adsSpread: 0.003, range: 140, head: 2.0, auto: false, adsFov: 32, scope: true, moveMul: 0.95, recoil: 0.03, tier: 4 },
  lmg: { id: 'lmg', name: 'TITAN', cls: 'METRALHADORA', dmg: 24, pellets: 1, interval: 0.09, mag: 60, reload: 3.6, spread: 0.03, adsSpread: 0.014, range: 85, head: 1.7, auto: true, adsFov: 50, scope: false, moveMul: 0.85, recoil: 0.014, tier: 4 },
  pistol: { id: 'pistol', name: 'HAWK', cls: 'PISTOLA', dmg: 26, pellets: 1, interval: 0.2, mag: 12, reload: 1.3, spread: 0.02, adsSpread: 0.008, range: 50, head: 2.0, auto: false, adsFov: 58, scope: false, moveMul: 1.08, recoil: 0.018, tier: 1 },
};
export const PRIMARY_IDS: WeaponId[] = ['ar', 'smg', 'sg', 'sr', 'dmr', 'lmg'];
export const ALL_WEAPON_IDS: WeaponId[] = [...PRIMARY_IDS, 'pistol'];

export interface WeaponSkin { id: string; name: string; body: number; accent: number; glow: number; rarity: Rarity; price: Price }
export const WEAPON_SKINS: WeaponSkin[] = [
  { id: 'default', name: 'PADRÃO', body: 0x2a2f38, accent: 0x4a525e, glow: 0xffb81c, rarity: 'common', price: {} },
  { id: 'camo', name: 'CAMUFLADA', body: 0x4d5a36, accent: 0x7a6a45, glow: 0xb8ff5c, rarity: 'rare', price: { coins: 600 } },
  { id: 'arctic', name: 'ÁRTICA', body: 0xdfe8ef, accent: 0x7d9bb3, glow: 0x5ce1ff, rarity: 'rare', price: { coins: 800 } },
  { id: 'neon', name: 'NEON VOID', body: 0x1a1030, accent: 0x3b1f6e, glow: 0xff2bd6, rarity: 'epic', price: { diamonds: 120 } },
  { id: 'dragon', name: 'DRAGÃO', body: 0x1b0d0d, accent: 0xb3121e, glow: 0xff5a1f, rarity: 'epic', price: { diamonds: 160 } },
  { id: 'gold', name: 'OURO PURO', body: 0xc9971a, accent: 0xffe08a, glow: 0xfff2b0, rarity: 'legendary', price: { diamonds: 300 } },
];
export const weaponSkinItemId = (w: WeaponId, s: string) => `wskin:${w}:${s}`;

// ---------------------------------------------------------------- OUTFITS
export type Slot = 'head' | 'face' | 'top' | 'bottom' | 'shoes' | 'back';
export const SLOTS: { id: Slot; label: string }[] = [
  { id: 'head', label: 'CABEÇA' },
  { id: 'face', label: 'ROSTO' },
  { id: 'top', label: 'TORSO' },
  { id: 'bottom', label: 'PERNAS' },
  { id: 'shoes', label: 'PÉS' },
  { id: 'back', label: 'COSTAS' },
];

export interface OutfitItem {
  id: string;
  slot: Slot;
  name: string;
  rarity: Rarity;
  price: Price;
  style: string;
  c1: number;
  c2: number;
  glow?: number;
}

export const ITEMS: OutfitItem[] = [
  { id: 'head_none', slot: 'head', name: 'NENHUM', rarity: 'common', price: {}, style: 'none', c1: 0, c2: 0 },
  { id: 'cap_red', slot: 'head', name: 'BONÉ RUBI', rarity: 'common', price: { coins: 300 }, style: 'cap', c1: 0xd7263d, c2: 0xffffff },
  { id: 'cap_black', slot: 'head', name: 'BONÉ STREET', rarity: 'rare', price: { coins: 450 }, style: 'cap', c1: 0x15171c, c2: 0xffb81c },
  { id: 'beanie', slot: 'head', name: 'GORRO NOITE', rarity: 'common', price: { coins: 400 }, style: 'beanie', c1: 0x2d3142, c2: 0xf25c54 },
  { id: 'helmet', slot: 'head', name: 'CAPACETE TÁTICO', rarity: 'rare', price: { coins: 900 }, style: 'helmet', c1: 0x4b5842, c2: 0x2a2f25 },
  { id: 'bandana', slot: 'head', name: 'BANDANA FOGO', rarity: 'epic', price: { diamonds: 60 }, style: 'bandana', c1: 0xff4d1f, c2: 0x1a1a1a },
  { id: 'cat_ears', slot: 'head', name: 'ORELHAS NEON', rarity: 'epic', price: { diamonds: 150 }, style: 'ears', c1: 0x1d1033, c2: 0xff2bd6, glow: 0xff2bd6 },
  { id: 'crown', slot: 'head', name: 'COROA BOOYAH', rarity: 'legendary', price: { diamonds: 320 }, style: 'crown', c1: 0xffc533, c2: 0xff2b4e, glow: 0xffd45c },

  { id: 'face_none', slot: 'face', name: 'NENHUM', rarity: 'common', price: {}, style: 'none', c1: 0, c2: 0 },
  { id: 'shades', slot: 'face', name: 'ÓCULOS ESCUROS', rarity: 'common', price: { coins: 350 }, style: 'shades', c1: 0x0b0b0f, c2: 0xc0c0c0 },
  { id: 'mask_half', slot: 'face', name: 'MÁSCARA TÁTICA', rarity: 'rare', price: { coins: 500 }, style: 'halfmask', c1: 0x23262d, c2: 0x5a606b },
  { id: 'mask_skull', slot: 'face', name: 'MÁSCARA CAVEIRA', rarity: 'epic', price: { diamonds: 120 }, style: 'skull', c1: 0xf2efe6, c2: 0x111111 },
  { id: 'visor', slot: 'face', name: 'VISOR CYBER', rarity: 'legendary', price: { diamonds: 200 }, style: 'visor', c1: 0x101820, c2: 0x2bf5ff, glow: 0x2bf5ff },

  { id: 'tee_white', slot: 'top', name: 'T-SHIRT BÁSICA', rarity: 'common', price: {}, style: 'tee', c1: 0xeeeeee, c2: 0xcfcfcf },
  { id: 'jersey', slot: 'top', name: 'CAMISA ESQUADRÃO', rarity: 'common', price: { coins: 450 }, style: 'tee', c1: 0x1f5fff, c2: 0xffb81c },
  { id: 'hoodie_orange', slot: 'top', name: 'MOLETOM LARANJA', rarity: 'rare', price: { coins: 600 }, style: 'hoodie', c1: 0xff7a1a, c2: 0x2b2b2b },
  { id: 'jacket', slot: 'top', name: 'JAQUETA COURO', rarity: 'rare', price: { coins: 900 }, style: 'jacket', c1: 0x2a1d17, c2: 0xd9d9d9 },
  { id: 'tac_vest', slot: 'top', name: 'COLETE TÁTICO', rarity: 'epic', price: { coins: 1400 }, style: 'vest', c1: 0x3d4a32, c2: 0x1f2419 },
  { id: 'hoodie_neon', slot: 'top', name: 'MOLETOM NEON', rarity: 'epic', price: { diamonds: 180 }, style: 'hoodie', c1: 0x14102a, c2: 0x2bf5ff, glow: 0x2bf5ff },
  { id: 'suit_gold', slot: 'top', name: 'TRAJE DOURADO', rarity: 'legendary', price: { diamonds: 350 }, style: 'jacket', c1: 0xd4a017, c2: 0x111111, glow: 0xffd45c },

  { id: 'jeans', slot: 'bottom', name: 'JEANS', rarity: 'common', price: {}, style: 'pants', c1: 0x34507a, c2: 0x25395a },
  { id: 'shorts', slot: 'bottom', name: 'BERMUDA PRAIA', rarity: 'common', price: { coins: 300 }, style: 'shorts', c1: 0xe63946, c2: 0xffffff },
  { id: 'joggers', slot: 'bottom', name: 'JOGGER PRETA', rarity: 'common', price: { coins: 400 }, style: 'pants', c1: 0x1a1c20, c2: 0xffffff },
  { id: 'cargo', slot: 'bottom', name: 'CARGO CAMUFLADA', rarity: 'rare', price: { coins: 650 }, style: 'cargo', c1: 0x5b6b3a, c2: 0x3b4526 },
  { id: 'pants_neon', slot: 'bottom', name: 'CALÇA NEON', rarity: 'epic', price: { diamonds: 140 }, style: 'pants', c1: 0x14102a, c2: 0xff2bd6, glow: 0xff2bd6 },

  { id: 'sneaker_white', slot: 'shoes', name: 'TÉNIS BRANCOS', rarity: 'common', price: {}, style: 'sneaker', c1: 0xf5f5f5, c2: 0x222222 },
  { id: 'sneaker_red', slot: 'shoes', name: 'TÉNIS SPEED', rarity: 'common', price: { coins: 300 }, style: 'sneaker', c1: 0xe63946, c2: 0xffffff },
  { id: 'boots', slot: 'shoes', name: 'BOTAS DE COMBATE', rarity: 'rare', price: { coins: 500 }, style: 'boots', c1: 0x3a2b1f, c2: 0x1a1410 },
  { id: 'sneaker_gold', slot: 'shoes', name: 'TÉNIS DOURADOS', rarity: 'legendary', price: { diamonds: 120 }, style: 'sneaker', c1: 0xffc533, c2: 0x111111, glow: 0xffd45c },

  { id: 'back_none', slot: 'back', name: 'NENHUM', rarity: 'common', price: {}, style: 'none', c1: 0, c2: 0 },
  { id: 'pack_small', slot: 'back', name: 'MOCHILA LEVE', rarity: 'common', price: { coins: 400 }, style: 'pack', c1: 0x2f6f4f, c2: 0x1d3f2e },
  { id: 'pack_tac', slot: 'back', name: 'MOCHILA TÁTICA', rarity: 'rare', price: { coins: 800 }, style: 'packbig', c1: 0x4b4a3a, c2: 0x2a2a20 },
  { id: 'katana', slot: 'back', name: 'KATANA RONIN', rarity: 'epic', price: { diamonds: 220 }, style: 'katana', c1: 0x1a1a1a, c2: 0xd7263d },
  { id: 'wings', slot: 'back', name: 'ASAS ANGELICAIS', rarity: 'legendary', price: { diamonds: 450 }, style: 'wings', c1: 0xffffff, c2: 0xbfe9ff, glow: 0x9fe8ff },
];
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export type Outfit = Record<Slot, string>;
export const DEFAULT_OUTFIT: Outfit = { head: 'head_none', face: 'face_none', top: 'tee_white', bottom: 'jeans', shoes: 'sneaker_white', back: 'back_none' };

// ---------------------------------------------------------------- HEROES
export type AbilityId = 'dash' | 'heal' | 'shield' | 'reveal' | 'fury';
export interface HeroDef {
  id: string;
  name: string;
  role: string;
  bio: string;
  skin: number;
  hair: string;
  hairColor: number;
  build: number;
  ability: { id: AbilityId; name: string; desc: string; cd: number };
  price: Price;
  rarity: Rarity;
}

export const HEROES: HeroDef[] = [
  { id: 'kai', name: 'KAI', role: 'ASSALTO', bio: 'Ex-piloto de corridas. Entra primeiro, sai por último.', skin: 0xc68c5a, hair: 'short', hairColor: 0x1b1410, build: 1, ability: { id: 'dash', name: 'ARRANQUE RELÂMPAGO', desc: 'Investida rápida na direção do movimento.', cd: 9 }, price: {}, rarity: 'rare' },
  { id: 'luna', name: 'LUNA', role: 'SUPORTE', bio: 'Médica de campo. Ninguém fica para trás.', skin: 0xf1c7a3, hair: 'ponytail', hairColor: 0x6b2fb3, build: 0.94, ability: { id: 'heal', name: 'CURA LUNAR', desc: 'Recupera 45 de vida ao longo de 3 s.', cd: 22 }, price: { coins: 1800 }, rarity: 'rare' },
  { id: 'rocco', name: 'ROCCO', role: 'TANQUE', bio: 'Segurança de elite. Uma parede com pernas.', skin: 0x7a4a2c, hair: 'buzz', hairColor: 0x111111, build: 1.08, ability: { id: 'shield', name: 'ESCUDO TITÃ', desc: 'Reduz 55% do dano recebido durante 5 s.', cd: 26 }, price: { coins: 2800 }, rarity: 'epic' },
  { id: 'nova', name: 'NOVA', role: 'BATEDORA', bio: 'Hacker de satélites. Vê-te antes de tu a veres.', skin: 0xe8b48f, hair: 'long', hairColor: 0xf2f2f2, build: 0.95, ability: { id: 'reveal', name: 'OLHO DE FALCÃO', desc: 'Revela inimigos num raio de 60 m durante 7 s.', cd: 28 }, price: { diamonds: 199 }, rarity: 'epic' },
  { id: 'zara', name: 'ZARA', role: 'DUELISTA', bio: 'Campeã de arenas clandestinas. Pura adrenalina.', skin: 0x5a3622, hair: 'mohawk', hairColor: 0xff3b5c, build: 1, ability: { id: 'fury', name: 'FÚRIA', desc: '+35% cadência e +20% velocidade durante 6 s.', cd: 26 }, price: { diamonds: 299 }, rarity: 'legendary' },
];
export const HERO_BY_ID = new Map(HEROES.map((h) => [h.id, h]));

// ---------------------------------------------------------------- MODES
export type ModeId = 'br' | 'squad' | 'train' | 'watch';
export type Difficulty = 'easy' | 'normal' | 'hard';
export const MODES: { id: ModeId; name: string; desc: string; players: string; color: string; maps: boolean }[] = [
  { id: 'br', name: 'BATTLE ROYALE', desc: 'Salta do avião, apanha loot e sê o último de pé. Partidas de ~7 minutos.', players: '48 JOGADORES', color: '#ff7a1a', maps: true },
  { id: 'squad', name: 'CONTRA SQUAD', desc: '4v4 numa zona do mapa com o equipamento do Arsenal. Primeira equipa a 25 abates.', players: '4 VS 4', color: '#3fa9ff', maps: true },
  { id: 'watch', name: 'MODO OBSERVADOR', desc: 'Assiste a uma partida de 48 com câmaras de transmissão, vista tática e repetições.', players: 'TRANSMISSÃO', color: '#ff3b6b', maps: true },
  { id: 'train', name: 'TREINO', desc: 'Campo de tiro com prédio de 3 andares, armazém e alvos móveis.', players: 'SOLO', color: '#2bd97c', maps: false },
];

export function priceLabel(p: Price): string {
  if (p.diamonds) return `${p.diamonds}`;
  if (p.coins) return `${p.coins}`;
  return 'GRÁTIS';
}

// ---------------------------------------------------------------- GLOO WALL SKINS
export interface GlooSkin { id: string; name: string; body: number; emissive: number; cap: number; opacity: number; rarity: Rarity; price: Price }
export const GLOO_SKINS: GlooSkin[] = [
  { id: 'classic', name: 'GELO CLÁSSICO', body: 0x9fe8ff, emissive: 0x1d5f7a, cap: 0xeafcff, opacity: 0.86, rarity: 'common', price: {} },
  { id: 'lava', name: 'LAVA', body: 0xff5a1f, emissive: 0x6a1500, cap: 0xffd23f, opacity: 0.94, rarity: 'rare', price: { coins: 900 } },
  { id: 'rose', name: 'CRISTAL ROSA', body: 0xff8ad8, emissive: 0x6a1f50, cap: 0xffe3f6, opacity: 0.88, rarity: 'rare', price: { coins: 1100 } },
  { id: 'toxic', name: 'TÓXICO', body: 0x7cff4f, emissive: 0x1f5a10, cap: 0xdcff8a, opacity: 0.9, rarity: 'epic', price: { diamonds: 120 } },
  { id: 'galaxy', name: 'GALÁXIA', body: 0x6b3bd6, emissive: 0x2a0a6a, cap: 0x2bf5ff, opacity: 0.92, rarity: 'epic', price: { diamonds: 180 } },
  { id: 'gold', name: 'OURO REAL', body: 0xffc533, emissive: 0x6a4a00, cap: 0xfff2b0, opacity: 0.95, rarity: 'legendary', price: { diamonds: 260 } },
];
export const glooItemId = (s: string) => `gloo:${s}`;
