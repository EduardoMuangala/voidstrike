import * as THREE from 'three';

const D = 256;
let detailTex: THREE.DataTexture | null = null;

/** Tileable value noise on a period grid. */
function tileNoise(seed: number, period: number) {
  const g = new Float32Array(period * period);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    g[i] = s / 4294967296;
  }
  const at = (ix: number, iy: number) => g[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
  return (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(seed: number, x: number, y: number, base: number, oct: number, cache: Map<string, (x: number, y: number) => number>) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const p = base << o;
    const key = `${seed}:${p}`;
    let f = cache.get(key);
    if (!f) cache.set(key, (f = tileNoise(seed + o * 101, p)));
    sum += f((x / D) * p, (y / D) * p) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function normalize(a: Float32Array, lo: number, hi: number) {
  let mn = Infinity, mx = -Infinity, mean = 0;
  for (const v of a) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    mean += v;
  }
  mean /= a.length;
  const r = mx - mn || 1;
  for (let i = 0; i < a.length; i++) a[i] = lo + ((a[i] - mn) / r) * (hi - lo);
  return mean;
}

/** Four grayscale detail layers packed into RGBA: grass, asphalt, sand, rock. */
export function detailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const cache = new Map<string, (x: number, y: number) => number>();
  const N = D * D;
  const grass = new Float32Array(N), hard = new Float32Array(N), sand = new Float32Array(N), rock = new Float32Array(N);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < D; y++)
    for (let x = 0; x < D; x++) {
      const i = y * D + x;
      grass[i] = fbm(11, x, y, 8, 4, cache) * 0.6 + rnd() * 0.25;
      hard[i] = fbm(23, x, y, 16, 3, cache) * 0.35 + rnd() * 0.65;
      const rip = Math.sin((x + fbm(31, x, y, 4, 2, cache) * 60) * 0.35) * 0.5 + 0.5;
      sand[i] = fbm(37, x, y, 16, 3, cache) * 0.5 + rip * 0.3 + rnd() * 0.2;
      const r1 = fbm(41, x, y, 4, 5, cache);
      rock[i] = 1 - Math.abs(r1 - 0.5) * 2 * 0.8 + fbm(43, x, y, 32, 2, cache) * 0.3;
    }
  // grass blades
  for (let b = 0; b < 9000; b++) {
    const x0 = rnd() * D, y0 = rnd() * D;
    const len = 3 + rnd() * 6, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.9, v = (rnd() - 0.45) * 0.55;
    for (let t = 0; t < len; t++) {
      const px = Math.floor(x0 + Math.cos(ang) * t) & (D - 1), py = Math.floor(y0 + Math.sin(ang) * t) & (D - 1);
      grass[py * D + px] += v * (1 - t / len) + 0.08;
    }
  }
  // asphalt cracks and stones
  for (let c = 0; c < 14; c++) {
    let x = rnd() * D, y = rnd() * D, a = rnd() * 6.28;
    for (let t = 0; t < 70; t++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      hard[(Math.floor(y) & (D - 1)) * D + (Math.floor(x) & (D - 1))] -= 0.55;
    }
  }
  for (let st = 0; st < 1600; st++) {
    const px = Math.floor(rnd() * D), py = Math.floor(rnd() * D);
    hard[py * D + px] += 0.5;
  }
  normalize(grass, 0.12, 0.92);
  normalize(hard, 0.18, 0.85);
  normalize(sand, 0.25, 0.8);
  normalize(rock, 0.08, 0.95);
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4] = grass[i] * 255;
    data[i * 4 + 1] = hard[i] * 255;
    data[i * 4 + 2] = sand[i] * 255;
    data[i * 4 + 3] = rock[i] * 255;
  }
  const t = new THREE.DataTexture(data, D, D, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

/** Terrain material: smooth painted colour map + mask, with tiled micro detail per surface type. */
export function groundMaterial(color: HTMLCanvasElement, mask: HTMLCanvasElement, S: number): THREE.MeshLambertMaterial {
  const ct = new THREE.CanvasTexture(color);
  ct.colorSpace = THREE.SRGBColorSpace;
  ct.flipY = false;
  ct.anisotropy = 8;
  const mt = new THREE.CanvasTexture(mask);
  mt.anisotropy = 4;
  mt.flipY = false;
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGColor = { value: ct };
    sh.uniforms.uGMask = { value: mt };
    sh.uniforms.uDetail = { value: detailTexture() };
    sh.uniforms.uS = { value: S };
    sh.vertexShader = 'varying vec3 vGW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = position;');
    sh.fragmentShader =
      'varying vec3 vGW;\nuniform sampler2D uGColor;\nuniform sampler2D uGMask;\nuniform sampler2D uDetail;\nuniform float uS;\n' +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        `vec2 gUv = (vGW.xz + uS) / (2.0 * uS);
        vec3 gc = texture2D(uGColor, gUv).rgb;
        vec3 gm = texture2D(uGMask, gUv).rgb;
        vec4 d = texture2D(uDetail, vGW.xz * 0.31);
        vec4 d2 = texture2D(uDetail, vGW.xz * 0.043 + 0.37);
        float hard = gm.r;
        float sand = gm.g * (1.0 - hard);
        float rock = gm.b * (1.0 - hard);
        float grass = max(0.0, 1.0 - hard - sand - rock);
        float det = (d.r * grass + d.g * hard + d.b * sand + d.a * rock) / max(0.001, grass + hard + sand + rock);
        float macro = 0.84 + 0.3 * d2.r;
        diffuseColor.rgb *= gc * (0.48 + det * 1.05) * mix(macro, 1.0, hard * 0.7);`,
      );
  };
  m.userData.textures = [ct, mt];
  return m;
}
