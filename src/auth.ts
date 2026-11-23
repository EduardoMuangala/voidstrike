import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export async function signUp(email: string, password: string, username: string) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function usernameOf(user: User): string {
  return String(user.user_metadata?.username || user.email?.split('@')[0] || 'Operador').slice(0, 14);
}

export function onAuthChange(cb: (user: User | null) => void) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}
