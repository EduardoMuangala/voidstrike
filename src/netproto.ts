import type { ModeId, WeaponId } from './data';
import type { MapId } from './game/maps';
import type { MatchResult } from './game/match';

/** What a guest's browser sends the host, ~15x/second, over its one WebRTC link. */
export interface NetInputMsg {
  t: 'input';
  yaw: number;
  pitch: number;
  mx: number;
  my: number;
  fire: boolean;
  ads: boolean;
  crouch: boolean;
  jump: boolean;
  reload: boolean;
  gel: boolean;
  nade: boolean;
  heal: boolean;
  ability: boolean;
  pickup: boolean;
  slot: number;
}

export interface NetActorSnap {
  id: number;
  name: string;
  team: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  weapon: WeaponId | null;
  mag: number;
  slots: ({ id: WeaponId; mag: number } | null)[];
  cur: number;
  reloading: boolean;
  meds: number;
  gel: number;
  nades: number;
  crouch: boolean;
  onGround: boolean;
  dropping: boolean;
  glide: boolean;
  speed: number;
  vx: number;
  vz: number;
}

export interface NetStartMsg {
  t: 'start';
  seed: number;
  map: MapId;
  mode: ModeId;
  you: number;
}

export interface NetSnapMsg {
  t: 'snap';
  time: number;
  scoreA: number;
  scoreB: number;
  actors: NetActorSnap[];
}

export interface NetShotMsg {
  t: 'shot';
  a: [number, number, number];
  b: [number, number, number];
}

export interface NetBoomMsg {
  t: 'boom';
  p: [number, number, number];
}

export interface NetGlooMsg {
  t: 'gloo';
  kind: 'spawn' | 'end';
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  skin: string;
}

export interface NetKillMsg {
  t: 'kill';
  killer: string;
  victim: string;
  weapon: string;
}

export interface NetEndMsg {
  t: 'end';
  result: MatchResult;
}

/**
 * Who's on which team, by their WebRTC peer id (the room/webrtc.ts id, not the
 * numeric in-match actor id a NetActorSnap carries). The host sends this once
 * match teams are assigned so guests can mesh-connect directly to teammates
 * for voice — the star topology only gives everyone a link to the host.
 */
export interface NetRosterMsg {
  t: 'roster';
  players: { id: string; team: number }[];
}

export type NetMsg = NetInputMsg | NetStartMsg | NetSnapMsg | NetShotMsg | NetBoomMsg | NetGlooMsg | NetKillMsg | NetEndMsg | NetRosterMsg;

export const netStart = (seed: number, map: MapId, mode: ModeId, you: number): NetStartMsg => ({ t: 'start', seed, map, mode, you });
export const netSnap = (time: number, scoreA: number, scoreB: number, actors: NetActorSnap[]): NetSnapMsg => ({ t: 'snap', time, scoreA, scoreB, actors });
export const netShot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): NetShotMsg => ({ t: 'shot', a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] });
export const netBoom = (p: { x: number; y: number; z: number }): NetBoomMsg => ({ t: 'boom', p: [p.x, p.y, p.z] });
export const netKill = (killer: string, victim: string, weapon: string): NetKillMsg => ({ t: 'kill', killer, victim, weapon });
export const netEnd = (result: MatchResult): NetEndMsg => ({ t: 'end', result });
export const netRoster = (players: { id: string; team: number }[]): NetRosterMsg => ({ t: 'roster', players });
