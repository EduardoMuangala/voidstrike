import './style.css';
import * as THREE from 'three';
import { profile } from './save';
import { Lobby } from './ui/lobby';
import { Match } from './game/match';
import type { Difficulty, ModeId } from './data';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const loading = document.getElementById('loading')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);

function applySize() {
  const dpr = window.devicePixelRatio || 1;
  const q = profile.settings.quality;
  const pr = q === 'low' ? Math.min(dpr, 1) * 0.85 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  lobby.onResize();
  match?.onResize();
}

let match: Match | null = null;

const lobby = new Lobby(ui, (mode: ModeId, diff: Difficulty) => {
  loading.classList.add('show');
  setTimeout(() => {
    match = new Match({
      mode,
      difficulty: diff,
      renderer,
      canvas,
      root: ui,
      onEnd: (r) => {
        match?.dispose();
        match = null;
        document.body.classList.remove('ingame');
        lobby.show(true);
        lobby.showResult(r);
      },
    });
    lobby.show(false);
    document.body.classList.add('ingame');
    loading.classList.remove('show');
  }, 60);
});

addEventListener('resize', applySize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && match && !match.over) match.setPaused(true);
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
  } else {
    lobby.update(dt);
    renderer.render(lobby.scene, lobby.camera);
  }
}
requestAnimationFrame(frame);
