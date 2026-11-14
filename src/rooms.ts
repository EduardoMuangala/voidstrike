import { supabase } from './supabase';

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  mode: string;
  map: string;
  max_players: number;
  host_id: string;
  host_name: string;
  created_at: string;
}

export interface Member {
  key: string;
  name: string;
  ready: boolean;
}

export interface RoomChannel {
  leave: () => void;
  setReady: (ready: boolean) => void;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1, hard to confuse out loud
const ROOM_MAX_AGE_MS = 6 * 3600 * 1000;

function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export async function listRooms(): Promise<RoomRow[]> {
  const since = new Date(Date.now() - ROOM_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase.from('rooms').select('*').gt('created_at', since).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []) as RoomRow[];
}

export async function createRoom(hostId: string, hostName: string, name: string, mode: string, map: string, maxPlayers: number): Promise<RoomRow> {
  for (let tries = 0; tries < 5; tries++) {
    const code = makeCode();
    const { data, error } = await supabase
      .from('rooms')
      .insert({ code, name, mode, map, max_players: maxPlayers, host_id: hostId, host_name: hostName })
      .select()
      .single();
    if (!error) return data as RoomRow;
    if (!String(error.message).toLowerCase().includes('duplicate')) throw error;
  }
  throw new Error('Não foi possível criar a sala, tenta outra vez.');
}

export async function findRoomByCode(code: string): Promise<RoomRow | null> {
  const { data } = await supabase.from('rooms').select('*').eq('code', code.trim().toUpperCase()).maybeSingle();
  return (data as RoomRow | null) || null;
}

export async function deleteRoom(id: string) {
  await supabase.from('rooms').delete().eq('id', id);
}

/** Live room list: refetch on any insert/update/delete (cheap — rooms churn rarely). */
export function subscribeRoomList(onChange: () => void): () => void {
  const ch = supabase
    .channel('rooms-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** Who's in a room right now, kept live via Supabase Realtime Presence (no table, no polling). */
export function joinRoom(roomId: string, userId: string, name: string, onMembers: (members: Member[]) => void): RoomChannel {
  const channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: userId } } });
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState<{ name: string; ready: boolean }>();
    onMembers(Object.entries(state).map(([key, metas]) => ({ key, name: metas[0]?.name || '???', ready: !!metas[0]?.ready })));
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel.track({ name, ready: false });
  });
  return {
    leave: () => supabase.removeChannel(channel),
    setReady: (ready: boolean) => void channel.track({ name, ready }),
  };
}
