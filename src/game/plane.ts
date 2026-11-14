import * as THREE from 'three';
import { bake, box, cyl, glow, mat, part, sphere } from '../models/materials';

/** Cargo plane that carries every player across the island before the drop. */
export class Plane {
  group = new THREE.Group();
  private props: THREE.Object3D[] = [];
  start = new THREE.Vector3();
  end = new THREE.Vector3();
  dir = new THREE.Vector3();
  pos = new THREE.Vector3();
  t = 0;
  dur: number;
  alt: number;
  done = false;

  constructor(radius: number, alt: number) {
    this.alt = alt;
    const ang = Math.random() * Math.PI * 2;
    const off = (Math.random() - 0.5) * radius * 0.5;
    const L = radius + 70;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const nx = -dz, nz = dx;
    this.start.set(-dx * L + nx * off, alt, -dz * L + nz * off);
    this.end.set(dx * L + nx * off, alt, dz * L + nz * off);
    this.dir.copy(this.end).sub(this.start).normalize();
    this.dur = this.start.distanceTo(this.end) / 30;
    this.pos.copy(this.start);
    this.build();
    this.group.position.copy(this.start);
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
  }

  private build() {
    const body = new THREE.Group();
    const W = mat(0xf4f1ea), O = mat(0xff7a1a), D = mat(0x2b3542), G = mat(0x9aa4b2);
    part(body, cyl(1.5, 1.3, 16, 12), W, 0, 0, 0, Math.PI / 2);
    part(body, sphere(1.5, 12, 8), W, 0, 0, 8);
    part(body, cyl(1.3, 0.5, 5, 12), W, 0, 0.3, -10.5, Math.PI / 2);
    part(body, cyl(1.52, 1.52, 1.2, 12), O, 0, 0, 3, Math.PI / 2);
    part(body, cyl(1.52, 1.52, 0.5, 12), O, 0, 0, -4, Math.PI / 2);
    part(body, box(1.6, 0.6, 1.2), D, 0, 0.75, 8.4, -0.4);
    part(body, box(22, 0.35, 3.2), W, 0, 0.6, 1);
    part(body, box(22.2, 0.37, 0.6), O, 0, 0.6, 2.4);
    part(body, box(8, 0.25, 2), W, 0, 0.9, -11.5);
    part(body, box(0.3, 3.4, 2.4), O, 0, 2.2, -11.8, -0.25);
    for (const s of [-1, 1]) {
      part(body, cyl(0.55, 0.55, 3, 10), G, s * 5.5, 0.1, 2.4, Math.PI / 2);
      part(body, cyl(0.5, 0.5, 3.2, 10), D, s * 5.5, 0.1, 2.3, Math.PI / 2);
    }
    for (let i = -3; i <= 3; i++) part(body, box(0.05, 0.5, 0.7), mat(0x7fc8ff), 1.52, 0.4, i * 1.6);
    for (let i = -3; i <= 3; i++) part(body, box(0.05, 0.5, 0.7), mat(0x7fc8ff), -1.52, 0.4, i * 1.6);
    part(body, box(0.15, 0.15, 0.15), glow(0xff3030), -11, 0.6, 1);
    part(body, box(0.15, 0.15, 0.15), glow(0x30ff60), 11, 0.6, 1);
    bake(body);
    this.group.add(body);
    for (const s of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(s * 5.5, 0.1, 4);
      const b1 = new THREE.Mesh(box(0.25, 3.4, 0.08), D);
      const b2 = new THREE.Mesh(box(3.4, 0.25, 0.08), D);
      p.add(b1, b2);
      this.group.add(p);
      this.props.push(p);
    }
    this.group.scale.setScalar(1.15);
  }

  /** Closest point of the route to (x, z), as progress 0..1. */
  progressNear(x: number, z: number) {
    const v = new THREE.Vector3(x, this.alt, z).sub(this.start);
    return Math.max(0, Math.min(1, v.dot(this.dir) / this.start.distanceTo(this.end)));
  }

  pointAt(k: number, out: THREE.Vector3) {
    return out.copy(this.start).lerp(this.end, k);
  }

  update(dt: number) {
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    this.pointAt(k, this.pos);
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.t * 1.3) * 0.4;
    this.group.rotation.z = Math.sin(this.t * 0.7) * 0.03;
    for (const p of this.props) p.rotation.z += dt * 40;
    if (k >= 1) this.done = true;
    return k;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.parent && !this.props.includes(m.parent)) m.geometry.dispose();
    });
  }
}
