import { supabase } from './supabase';
import { profile, applyCloudProfile, switchToUser, setOnSave, type Profile } from './save';

interface ProfileRow {
  id: string;
  username: string;
  data: Partial<Profile>;
  updated_at: string;
}

const PUSH_DEBOUNCE_MS = 1500;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let activeUserId: string | null = null;
let activeUsername = 'Operador';

async function pushNow() {
  if (!activeUserId) return;
  const row = { id: activeUserId, username: activeUsername, data: profile, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('profiles').upsert(row);
  if (error) console.warn('[cloudProfile] falha ao sincronizar com a cloud:', error.message);
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
}

/**
 * Links the local save to a Supabase account: migrates/namespaces local
 * storage per user, pulls whatever the cloud already has (first device
 * wins nothing lost, every device converges), seeds the row on first
 * login, and then keeps pushing on every local save (debounced) so
 * progress follows the account in near-real-time across devices.
 */
export async function syncAccount(userId: string, username: string): Promise<void> {
  activeUserId = userId;
  activeUsername = username;
  switchToUser(userId);

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle<ProfileRow>();
  if (error) {
    console.warn('[cloudProfile] falha ao carregar perfil da cloud, a usar apenas dados locais:', error.message);
  } else if (data?.data) {
    applyCloudProfile(data.data);
  }
  if (!profile.name || /^OPERADOR\d+$/.test(profile.name)) profile.name = username;

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
