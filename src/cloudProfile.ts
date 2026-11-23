import { supabase } from './supabase';
import { profile, applyCloudProfile, switchToUser, setOnSave } from './save';

/** Matches the live `public.profiles` table (fixed columns, created ahead of this feature). */
interface ProfileRow {
  id: string;
  username: string;
  level: number;
  xp: number;
  coins: number;
  diamonds: number;
  matches: number;
  kills: number;
  best_score: number;
}

const PUSH_DEBOUNCE_MS = 1500;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let activeUserId: string | null = null;

function toRow() {
  return {
    id: activeUserId,
    // `username` carries a unique constraint in the live table, with a
    // trigger that de-duplicates it on first insert (e.g. "OPERADOR",
    // "OPERADOR1", ...). Always echo back profile.name, which is only ever
    // set from the cloud's own (already de-duplicated) value — never the
    // raw signup name — so this upsert can't collide with another account.
    username: profile.name,
    level: profile.level,
    xp: profile.xp,
    coins: profile.coins,
    diamonds: profile.diamonds,
    matches: profile.stats.matches,
    kills: profile.stats.kills,
    best_score: profile.stats.best,
    updated_at: new Date().toISOString(),
  };
}

async function pushNow() {
  if (!activeUserId) return;
  const { error } = await supabase.from('profiles').upsert(toRow());
  if (error) console.warn('[cloudProfile] falha ao sincronizar com a cloud:', error.message);
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
}

/**
 * Links the local save to a Supabase account: namespaces local storage per
 * user, pulls whatever the cloud already has (so a new device picks up
 * where the account left off), and then keeps pushing on every local save
 * (debounced) so progress follows the account in near-real-time across
 * devices/browsers.
 */
export async function syncAccount(userId: string, username: string): Promise<void> {
  activeUserId = userId;
  switchToUser(userId);

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle<ProfileRow>();
  if (error) {
    console.warn('[cloudProfile] falha ao carregar perfil da cloud, a usar apenas dados locais:', error.message);
    // No cloud row to read a de-duplicated name from (e.g. first sync ever
    // failed) — fall back to the raw signup name as a best effort.
    if (!profile.name || /^OPERADOR\d+$/.test(profile.name)) profile.name = username;
  } else if (data) {
    applyCloudProfile({
      name: data.username,
      level: data.level,
      xp: data.xp,
      coins: data.coins,
      diamonds: data.diamonds,
      stats: { ...profile.stats, matches: data.matches, kills: data.kills, best: data.best_score },
    });
  } else {
    // Trigger hasn't created the row yet (shouldn't normally happen) — seed
    // it with the raw signup name; the unique constraint still protects us.
    profile.name = username;
  }

  setOnSave(schedulePush);
  await pushNow();
}

/** Flushes any pending save immediately — call before signing out or leaving the page. */
export async function flushSync() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  await pushNow();
}

export function stopSync() {
  activeUserId = null;
  setOnSave(null);
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
