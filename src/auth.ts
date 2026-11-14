import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface GameProfile {
  id: string;
  username: string;
  level: number;
  xp: number;
  coins: number;
  diamonds: number;
}

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

export async function fetchProfile(userId: string): Promise<GameProfile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data as GameProfile | null;
}

export function onAuthChange(cb: (user: User | null) => void) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}
