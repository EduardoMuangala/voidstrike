import * as THREE from 'three';

const MAX_P = 260;
const dummy = new THREE.Object3D();
const col = new THREE.Color();

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; s: number; g: number; r: number; gg: number; b: number }
interface Tracer { mesh: THREE.Mesh; life: number }
interface Flash { mesh: THREE.Mesh; life: number }
interface Blast { mesh: THREE.Mesh; life: number; r: number }

export class Fx {
  group = new THREE.Group();
  private parts: P[] = [];
  private inst: THREE.InstancedMesh;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private blasts: Blast[] = [];
  private tGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  private fGeo: THREE.BufferGeometry;
  private bGeo = new THREE.SphereGeometry(1, 14, 10);

  constructor() {
    this.inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_P);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.setColorAt(0, col.setHex(0xffffff));
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    this.group.add(this.inst);

    const p1 = new THREE.PlaneGeometry(0.5, 0.5);
    const p2 = new THREE.PlaneGeometry(0.5, 0.5).rotateY(Math.PI / 2);
    const p3 = new THREE.PlaneGeometry(0.5, 0.5).rotateX(Math.PI / 2);
    this.fGeo = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (const g of [p1, p2, p3]) {
      const ng = g.toNonIndexed();
      pos.push(...(ng.getAttribute('position').array as Float32Array));
    }
    this.fGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));

    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(this.tGeo, new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(this.fGeo, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      this.group.add(m);
      this.flashes.push({ mesh: m, life: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.bGeo, new THREE.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.blasts.push({ mesh: m, life: 0, r: 1 });
    }
  }

  burst(at: THREE.Vector3, color: number, n: number, power = 5, size = 0.09, grav = 14, life = 0.5) {
    col.setHex(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_P) this.parts.shift();
      this.parts.push({
        x: at.x, y: at.y, z: at.z,
        vx: (Math.random() - 0.5) * power * 2,
        vy: Math.random() * power,
        vz: (Math.random() - 0.5) * power * 2,
        life: life * (0.6 + Math.random() * 0.6),
        max: life,
        s: size * (0.6 + Math.random() * 0.8),
        g: grav,
        r: col.r, gg: col.g, b: col.b,
      });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe28a, width = 0.035) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const m = t.mesh;
    const len = from.distanceTo(to);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(width, width, len);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
    m.visible = true;
    t.life = 0.07;
  }

  flash(at: THREE.Vector3, dir: THREE.Vector3, scale = 1) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.mesh.position.copy(at);
    f.mesh.lookAt(at.x + dir.x, at.y + dir.y, at.z + dir.z);
    f.mesh.rotation.z = Math.random() * 6;
    f.mesh.scale.setScalar(scale * (0.7 + Math.random() * 0.5));
    f.mesh.visible = true;
    f.life = 0.05;
  }

  blast(at: THREE.Vector3, r: number) {
    const b = this.blasts.find((x) => x.life <= 0) || this.blasts[0];
    b.mesh.position.copy(at);
    b.r = r;
    b.life = 0.45;
    b.mesh.visible = true;
    this.burst(at, 0xffb347, 24, 9, 0.2, 10, 0.8);
    this.burst(at, 0x444444, 16, 5, 0.3, -2, 1.2);
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const s = p.s * Math.min(1, (p.life / p.max) * 2);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.life * 7, p.life * 5, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.inst.setMatrixAt(n, dummy.matrix);
      this.inst.setColorAt(n, col.setRGB(p.r, p.gg, p.b));
      n++;
    }
    this.inst.count = n;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.mesh.visible = false;
    }
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = 1 - b.life / 0.45;
      b.mesh.scale.setScalar(b.r * (0.3 + k * 0.9));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    this.inst.geometry.dispose();
    this.tGeo.dispose();
    this.fGeo.dispose();
    this.bGeo.dispose();
  }
}
