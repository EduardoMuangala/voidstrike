import './style.css';
import * as THREE from 'three';
import { profile } from './save';
import { getSession, usernameOf } from './auth';
import { syncAccount, flushSync } from './cloudProfile';
import { AuthScreen } from './ui/auth';
import { Lobby, type NetPlayOpts } from './ui/lobby';
import { Match } from './game/match';
import { NetMatch } from './game/netclient';
import type { Difficulty, ModeId } from './data';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const loading = document.getElementById('loading')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.settings.quality !== 'low', alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);

let lobby: Lobby | null = null;
let match: Match | null = null;
let netMatch: NetMatch | null = null;

function applySize() {
  const dpr = window.devicePixelRatio || 1;
  const q = profile.settings.quality;
  const pr = q === 'low' ? Math.min(dpr, 1.3) : q === 'medium' ? Math.min(dpr, 1.75) : Math.min(dpr, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  lobby?.onResize();
  match?.onResize();
  netMatch?.onResize();
}

function backToLobby() {
  document.body.classList.remove('ingame');
  lobby?.reclaimRoomNet();
  lobby?.show(true);
}

function startRoomMatch(opts: NetPlayOpts) {
  loading.classList.add('show');
  setTimeout(() => {
    if (opts.isHost) {
      match = new Match({
        mode: 'squad',
        difficulty: profile.difficulty,
        map: opts.map,
        seed: opts.seed,
        net: opts.net,
        netPlayers: opts.netPlayers,
        renderer,
        canvas,
        root: ui,
        onEnd: (r) => {
          match?.dispose();
          match = null;
          backToLobby();
          lobby?.showResult(r);
        },
      });
    } else {
      netMatch = new NetMatch({
        renderer,
        canvas,
        root: ui,
        net: opts.net,
        map: opts.map,
        seed: opts.seed,
        hostId: opts.hostId,
        selfActorId: opts.selfActorId!,
        onEnd: (r) => {
          netMatch?.dispose();
          netMatch = null;
          backToLobby();
          lobby?.showResult(r);
        },
      });
    }
    lobby?.show(false);
    document.body.classList.add('ingame');
    loading.classList.remove('show');
  }, 60);
}

function boot() {
  lobby = new Lobby(
    ui,
    (mode: ModeId, diff: Difficulty) => {
      loading.classList.add('show');
      setTimeout(() => {
        match = new Match({
          mode,
          difficulty: diff,
          map: profile.map,
          renderer,
          canvas,
          root: ui,
          onEnd: (r) => {
            match?.dispose();
            match = null;
            document.body.classList.remove('ingame');
            lobby?.show(true);
            lobby?.showResult(r);
          },
        });
        lobby?.show(false);
        document.body.classList.add('ingame');
        loading.classList.remove('show');
      }, 60);
    },
    startRoomMatch,
  );
  applySize();
}

addEventListener('resize', applySize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && match && !match.over && !match.isRoom) match.setPaused(true);
  if (document.hidden) void flushSync();
});
applySize();

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (match) {
    match.update(dt);
    if (match) match.render();
  } else if (netMatch) {
    netMatch.update(dt);
    netMatch.render();
  } else if (lobby) {
    lobby.update(dt);
    renderer.render(lobby.scene, lobby.camera);
  }
}
requestAnimationFrame(frame);

getSession().then(async (session) => {
  if (session) {
    await syncAccount(session.user.id, usernameOf(session.user));
    boot();
  } else {
    new AuthScreen(ui, async (user) => {
      await syncAccount(user.id, usernameOf(user));
      boot();
    });
  }
});
