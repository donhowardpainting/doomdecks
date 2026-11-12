import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FX, rng, noiseTex } from './fx';
import { Sfx } from './audio';
import type { Theme } from './env';
import type { Player } from './player';

export interface Box { min: THREE.Vector3; max: THREE.Vector3; on: boolean; owner: any; vel?: THREE.Vector3 }
export interface Host { addWood(n: number): void; addStar(): void; shake(a: number): void; checkpoint(i: Island): void; reachFinish(): void; knock(vx: number, vy: number, vz: number): void }
export interface Island {
  ord: number; kind: 'main' | 'stone' | 'mover'; box: Box; mesh: THREE.Group; w: number; d: number; color: number; state: number; t: number;
  home: THREE.Vector3; cp?: boolean; cpOn?: boolean; fin?: boolean; flag?: THREE.Mesh;
  mv?: { a: number; b: number; speed: number; ph: number }; spin?: { bar: THREE.Object3D; len: number; w: number; ang: number };
}
interface Piece { type: number; boxes: Box[]; mesh: THREE.Mesh; maxZ: number; min: THREE.Vector3; max: THREE.Vector3; state: number; t: number; y: number }
interface Pickup { mesh: THREE.Object3D; kind: 'wood' | 'star'; ord: number; taken: boolean; y: number }
interface Meteor { mesh: THREE.Mesh; ring: THREE.Mesh; target: THREE.Vector3; t: number }

export interface CourseDef {
  id: string; name: string; tag: string; desc: string; seed: number; n: number; gap: [number, number]; dy: [number, number]; lat: number;
  doom: number; wood: number; rate: number; cp: number; spin: number; mover: number; stones: number; meteor: number; par: number; reserve: number; theme: Theme;
}

/* ---------- buildable pieces ---------- */
export const PIECES = [
  { id: 'deck', name: 'Deck', cost: 1, len: 2, rise: 0, tip: 'One tile. Hold to pave as you run.' },
  { id: 'bridge', name: 'Bridge', cost: 2, len: 6, rise: 0, tip: 'Three tiles for the price of two.' },
  { id: 'stairs', name: 'Stairs', cost: 2, len: 2, rise: 2, tip: 'Steep climb: +2 m in one tile.' },
  { id: 'ramp', name: 'Ramp', cost: 2, len: 6, rise: 2, tip: 'Long climb: +2 m over three tiles.' },
];
const woodRnd = rng(5), tc = new THREE.Color();
function bx(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, base = 0xc8935a) {
  const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z);
  tc.set(base).offsetHSL((woodRnd() - 0.5) * 0.03, (woodRnd() - 0.5) * 0.1, (woodRnd() - 0.5) * 0.14);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([tc.r, tc.g, tc.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
const DARK = 0x8a5a33;
function pieceGeo(i: number) {
  const g: THREE.BufferGeometry[] = [], len = PIECES[i].len;
  if (i < 2) {
    for (let k = 0; k < len / 0.4; k++) g.push(bx(1.96, 0.12, 0.36, 0, -0.06, -0.2 - 0.4 * k));
    for (const s of [-0.7, 0.7]) g.push(bx(0.16, 0.16, len - 0.04, s, -0.2, -len / 2, 0, DARK));
    if (i === 1) for (const s of [-0.93, 0.93]) {
      g.push(bx(0.06, 0.06, len, s, 0.62, -len / 2, 0, DARK));
      for (const z of [-0.1, -2, -4, -5.9]) g.push(bx(0.1, 0.72, 0.1, s, 0.3, z, 0, DARK));
    }
  } else if (i === 2) {
    for (let k = 0; k < 4; k++) g.push(bx(1.96, 0.12, 0.52, 0, 0.5 * (k + 1) - 0.06, -0.25 - 0.5 * k));
    for (const s of [-0.85, 0.85]) { g.push(bx(0.12, 0.32, 2.83, s, 0.78, -1, Math.PI / 4, DARK)); g.push(bx(0.12, 2.1, 0.12, s, 0.85, -1.9, 0, DARK)); }
  } else {
    const a = Math.atan2(2, 6);
    for (let k = 0; k < 12; k++) g.push(bx(1.96, 0.12, 0.5, 0, (k + 0.5) / 6 + 0.08, -0.25 - 0.5 * k, a));
    for (const s of [-0.8, 0.8]) { g.push(bx(0.14, 0.2, 6.32, s, 0.94, -3, a, DARK)); g.push(bx(0.14, 2.1, 0.14, s, 0.85, -5.85, 0, DARK)); g.push(bx(0.14, 1.1, 0.14, s, 0.35, -3, 0, DARK)); }
  }
  return mergeGeometries(g)!;
}
function pieceLocalBoxes(i: number): number[][] {
  if (i === 0) return [[-1, 1, -0.25, 0, -2, 0]];
  if (i === 1) return [[-1, 1, -0.25, 0, -6, 0]];
  const out: number[][] = [];
  if (i === 2) for (let k = 0; k < 4; k++) out.push([-1, 1, 0.5 * (k + 1) - 0.5, 0.5 * (k + 1), -0.5 * (k + 1), -0.5 * k]);
  else for (let k = 0; k < 12; k++) out.push([-1, 1, (k + 1) / 6 - 0.3, (k + 1) / 6, -0.5 * (k + 1), -0.5 * k]);
  return out;
}
export const pieceGeos = PIECES.map((_, i) => pieceGeo(i));
const pieceBoxes = PIECES.map((_, i) => pieceLocalBoxes(i));
const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });

const NO_METEOR = new URLSearchParams(location.search).has('nometeor'); // debug switch used by the playtest
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const overlap = (a0: THREE.Vector3, a1: THREE.Vector3, b: Box, e = 0.04) =>
  a0.x < b.max.x - e && a1.x > b.min.x + e && a0.y < b.max.y - e && a1.y > b.min.y + e && a0.z < b.max.z - e && a1.z > b.min.z + e;

export interface Target { ok: boolean; origin: THREE.Vector3; yaw: number; dx: number; dz: number; afford: boolean }

export class Level {
  root = new THREE.Group(); boxes: Box[] = []; islands: Island[] = []; mains: Island[] = []; pieces: Piece[] = []; pickups: Pickup[] = [];
  meteors: Meteor[] = []; doomZ = 40; doomOn = false; endZ = 0; private doom: THREE.Mesh; private doomU: any; private meteorT = 4; built = 0;
  private mats: Record<string, THREE.Material> = {};

  constructor(public def: CourseDef, private scene: THREE.Scene, private fx: FX, private sfx: Sfx, private host: Host) {
    scene.add(this.root);
    this.generate();
    const t = def.theme;
    this.doomU = { uT: { value: 0 }, uA: { value: new THREE.Color(t.doomA) }, uB: { value: new THREE.Color(t.doomB) }, uNoise: { value: noiseTex }, uFlash: { value: 0 } };
    this.doom = new THREE.Mesh(new THREE.PlaneGeometry(700, 420), new THREE.ShaderMaterial({
      uniforms: this.doomU, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float uT,uFlash;uniform vec3 uA,uB;uniform sampler2D uNoise;varying vec2 vUv;void main(){
        vec2 p=vUv*vec2(5.,3.);float n=texture2D(uNoise,p*.3+vec2(uT*.02,-uT*.07)).r;float m=texture2D(uNoise,p*.9+vec2(n*.4,-uT*.16)).r;
        float v=n*.6+m*.5;vec3 c=mix(uB,uA,smoothstep(.45,.8,v));c+=uA*pow(smoothstep(.62,.9,m),3.)*2.5;c+=vec3(.8,.85,1.)*uFlash*smoothstep(.3,.8,n);
        float a=smoothstep(0.,.25,vUv.y)*smoothstep(1.,.75,vUv.y)*smoothstep(0.,.15,vUv.x)*smoothstep(1.,.85,vUv.x)*(.82+.18*v);gl_FragColor=vec4(c,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }));
    this.doom.renderOrder = 4; this.doom.frustumCulled = false; scene.add(this.doom);
  }

  private mat(color: number, o: THREE.MeshStandardMaterialParameters = {}) {
    const k = color + JSON.stringify(o);
    return (this.mats[k] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...o })) as THREE.MeshStandardMaterial;
  }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
  }

  /* ---------- world generation ---------- */
  private island(kind: Island['kind'], ord: number, cx: number, top: number, cz: number, w: number, d: number, r: () => number): Island {
    const t = this.def.theme, g = new THREE.Group(); g.position.set(cx, top, cz);
    const color = kind === 'stone' ? t.stone : kind === 'mover' ? 0x5f6f86 : t.grass[(r() * t.grass.length) | 0];
    this.mesh(new THREE.BoxGeometry(w, 0.4, d), this.mat(color, t.lava && kind === 'main' ? { emissive: 0x2a0500 } : {}), g, 0, -0.2, 0);
    this.mesh(new THREE.BoxGeometry(w - 0.12, 0.6, d - 0.12), this.mat(t.rock), g, 0, -0.7, 0);
    const H = kind === 'main' ? 2 + 0.5 * Math.max(w, d) * (0.7 + r() * 0.6) : 1.6;
    const cone = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 3).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, -0.5, 0);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); if (y > -0.05) continue;
      const h = Math.sin(p.getX(i) * 91.7 + y * 37.1 + p.getZ(i) * 53.3 + ord * 7) * 43758.5; const j = (h - Math.floor(h) - 0.5) * 0.22;
      p.setX(i, p.getX(i) * (1 + j) + j * 0.3); p.setZ(i, p.getZ(i) * (1 - j) + j * 0.2);
    }
    cone.scale(w - 0.12, H, d - 0.12); cone.computeVertexNormals();
    this.mesh(cone, this.mat(t.rock), g, 0, -1, 0);
    if (kind === 'mover') for (const s of [-1, 1]) this.mesh(new THREE.BoxGeometry(w + 0.1, 0.12, 0.14), this.mat(0x7df9ff, { emissive: 0x39d7ff, emissiveIntensity: 2.2 }), g, 0, -0.1, s * d / 2, false);
    this.root.add(g);
    const box: Box = { min: V(cx - w / 2, top - 1, cz - d / 2), max: V(cx + w / 2, top, cz + d / 2), on: true, owner: null };
    const isl: Island = { ord, kind, box, mesh: g, w, d, color, state: 0, t: 0, home: g.position.clone() };
    box.owner = isl; this.boxes.push(box); this.islands.push(isl); if (kind === 'main') this.mains.push(isl);
    return isl;
  }
  private decorate(isl: Island, r: () => number) {
    const t = this.def.theme, n = 1 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const sx = r() < 0.5 ? -1 : 1, x = sx * (isl.w / 2 - 0.7 - r() * 0.8), z = (r() - 0.5) * (isl.d - 1.6), k = r();
      if (t.lava ? k < 0.5 : k < 0.3) {
        const m = this.mesh(new THREE.DodecahedronGeometry(0.35 + r() * 0.45, 0), this.mat(t.rock), isl.mesh, x, 0.2, z); m.rotation.set(r() * 3, r() * 3, 0);
      } else if (t.lava) {
        const h = 0.8 + r() * 1.2;
        this.mesh(new THREE.ConeGeometry(0.22, h, 5), this.mat(0xff7a2a, { emissive: 0xff4a10, emissiveIntensity: 1.8 }), isl.mesh, x, h / 2, z).rotation.z = (r() - 0.5) * 0.5;
      } else {
        const h = 1.6 + r() * 1.6, leaf = t.leaf[(r() * t.leaf.length) | 0];
        this.mesh(new THREE.CylinderGeometry(0.1, 0.16, h * 0.5, 6), this.mat(0x6b4a2f), isl.mesh, x, h * 0.25, z);
        this.mesh(new THREE.ConeGeometry(0.75, h * 0.7, 7), this.mat(leaf), isl.mesh, x, h * 0.75, z);
        this.mesh(new THREE.ConeGeometry(0.55, h * 0.5, 7), this.mat(leaf), isl.mesh, x, h * 1.05, z);
      }
    }
  }
  private pickup(kind: Pickup['kind'], ord: number, x: number, y: number, z: number) {
    let mesh: THREE.Object3D;
    if (kind === 'wood') {
      const g = mergeGeometries([bx(0.22, 0.22, 1.1, -0.13, 0, 0), bx(0.22, 0.22, 1.1, 0.13, 0, 0), bx(0.22, 0.22, 1.1, 0, 0.22, 0), bx(0.52, 0.08, 0.12, 0, 0.1, 0.25, 0, 0x3a6fd0), bx(0.52, 0.08, 0.12, 0, 0.1, -0.25, 0, 0x3a6fd0)])!;
      mesh = this.mesh(g, this.mats.pick ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0xffa040, emissiveIntensity: 0.35 }), this.root, x, y, z);
    } else {
      mesh = this.mesh(new THREE.OctahedronGeometry(0.45, 0), this.mat(0xffd84a, { emissive: 0xffb400, emissiveIntensity: 2.4, flatShading: true }), this.root, x, y, z, false);
    }
    this.pickups.push({ mesh, kind, ord, taken: false, y });
  }

  private generate() {
    const d = this.def, r = rng(d.seed), t = d.theme;
    let prev = this.island('main', 0, 0, 0, 0, 12, 12, r); this.decorate(prev, r);
    const needs: number[] = [];
    for (let i = 1; i <= d.n; i++) {
      const last = i === d.n, cp = last || i % d.cp === 0, prog = i / d.n;
      const gap = 2 * Math.round((d.gap[0] + (d.gap[1] - d.gap[0]) * (0.35 * r() + 0.65 * prog * (0.5 + r() * 0.5))) / 2);
      const w = cp ? 12 : 2 * (3 + ((r() * 3) | 0)), dep = cp ? 12 : 2 * (3 + ((r() * 3) | 0));
      const pcx = prev.home.x, py = prev.home.y, far = prev.box.min.z;
      let cx = Math.max(-18, Math.min(18, pcx + 2 * Math.round((r() * 2 - 1) * d.lat)));
      if ((((cx - w / 2) % 2) + 2) % 2 !== 0) cx += 1;
      const y = py + 0.5 * Math.round((d.dy[0] + (d.dy[1] - d.dy[0]) * r()) / 0.5), zmax = far - gap;
      const need = Math.ceil(gap / 6) * 2 + (y - py > 0.5 ? Math.ceil((y - py) / 2) * 2 : 0) + Math.ceil(Math.max(0, Math.abs(cx - pcx) - (w + prev.w) / 2 + 2.5) / 2);
      const ord = i - 0.5, k = r();
      if (k < d.mover && gap >= 10) {
        const mx = 2 * Math.round((pcx + cx) / 4), my = Math.max(py, Math.min(y, py + 1.5));
        const m = this.island('mover', ord, mx, my, far - gap / 2, 4, 4, r);
        m.mv = { a: far - 2, b: zmax + 2, speed: 3.4 + r() * 1.6, ph: r() * 6 };
      } else if (k < d.mover + d.stones && gap >= 8) {
        const cnt = Math.floor(gap / 6);
        for (let j = 0; j < cnt; j++) {
          const f = (j + 1) / (cnt + 1), odd = (v: number) => Math.floor(v / 2) * 2 + 1;
          this.island('stone', ord, odd(pcx + (cx - pcx) * f + (r() - 0.5) * 3), Math.round((py + (y - py) * f) * 2) / 2, odd(far - gap * f), 2, 2, r);
        }
      }
      if (r() < 0.75) this.pickup('star', ord, (pcx + cx) / 2 + (r() - 0.5) * 4, Math.max(py, y) + 1.6 + r() * 1.5, far - gap * (0.35 + r() * 0.3));
      needs.push(need);
      const isl = this.island('main', i, cx, y, zmax - dep / 2, w, dep, r); this.decorate(isl, r);
      if (cp && !last) {
        isl.cp = true;
        this.mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), this.mat(0xdddddd), isl.mesh, -4.5, 1.7, 3.5);
        isl.flag = this.mesh(new THREE.BoxGeometry(1.5, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.7 }), isl.mesh, -3.7, 2.9, 3.5);
      }
      if (last) {
        isl.fin = true;
        this.mesh(new THREE.TorusGeometry(3.2, 0.35, 8, 28), this.mat(0xffe9a8, { emissive: 0xffc23a, emissiveIntensity: 2.5 }), isl.mesh, 0, 3.4, -2, false);
        const disc = this.mesh(new THREE.CircleGeometry(3, 28), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), isl.mesh, 0, 3.4, -2, false);
        disc.userData.portal = 1; const pl = new THREE.PointLight(0xffc860, 60, 30); pl.position.set(0, 3.4, -1); isl.mesh.add(pl);
      } else if (!cp && r() < d.spin && w >= 8 && dep >= 8) {
        const len = Math.min(w, dep) - 1.4, bar = new THREE.Group(); bar.position.y = 0.75; isl.mesh.add(bar);
        this.mesh(new THREE.BoxGeometry(len, 0.34, 0.34), this.mat(0xe23b3b, { emissive: 0xa01010, emissiveIntensity: 0.9 }), bar);
        for (const s of [-1, 1]) this.mesh(new THREE.BoxGeometry(0.5, 0.42, 0.42), this.mat(0xf4f4f4), bar, s * (len / 2 - 0.25), 0, 0);
        this.mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.9, 8), this.mat(0x3b3f4a), isl.mesh, 0, 0.45, 0);
        isl.spin = { bar, len, w: (1.5 + r() * 0.9) * (r() < 0.5 ? -1 : 1), ang: r() * 6 };
      }
      prev = isl;
    }
    // wood bundles sized to what the *next* gap demands
    let bal = d.wood; // running budget guarantees a bridge-efficient builder can always cross
    for (let i = 0; i < d.n; i++) {
      const isl = this.mains[i], cnt = Math.max(i === 0 ? 0 : 1, Math.round((needs[i] * d.rate) / 3 + (r() - 0.5) * 0.8) - (i === 0 ? 1 : 0), Math.ceil((needs[i] + d.reserve - bal) / 3));
      bal += cnt * 3 - needs[i];
      for (let j = 0; j < cnt; j++) this.pickup('wood', isl.ord, isl.home.x + (r() - 0.5) * (isl.w - 2.4), isl.home.y + 0.7, isl.home.z + (r() - 0.5) * (isl.d - 2.4));
    }
    this.endZ = prev.home.z; void t;
  }

  /* ---------- building ---------- */
  private free(a0: THREE.Vector3, a1: THREE.Vector3) { for (const b of this.boxes) if (b.on && overlap(a0, a1, b)) return false; return true; }
  private supported(a0: THREE.Vector3, a1: THREE.Vector3, y: number) {
    for (const b of this.boxes) if (b.on && a0.x < b.max.x - 0.1 && a1.x > b.min.x + 0.1 && a0.z < b.max.z - 0.1 && a1.z > b.min.z + 0.1 && b.max.y <= y + 0.01 && b.max.y > y - 2.6) return true;
    return false;
  }
  private a0 = V(); private a1 = V();
  /** Finds the snap target for a piece: first empty grid cell ahead of the player. */
  target(type: number, pl: Player, dx: number, dz: number, wood: number): Target {
    const p = PIECES[type], g = pl.grounded, lead = g ? 0 : 0.05;
    const cx = Math.floor((pl.pos.x + pl.vel.x * lead) / 2) * 2, cz = Math.floor((pl.pos.z + pl.vel.z * lead) / 2) * 2;
    const y = g ? Math.round(pl.pos.y * 2) / 2 : Math.floor((pl.pos.y - 0.25 + Math.min(0, pl.vel.y) * 0.02) * 2) / 2; // just under the feet so a mid-air deck always catches you
    const res: Target = { ok: false, origin: V(cx + 1 - dx + dx * 2, y, cz + 1 - dz + dz * 2), yaw: Math.atan2(-dx, -dz), dx, dz, afford: wood >= p.cost };
    for (let k = g ? 1 : 0; k <= 2; k++) {
      const x0 = cx + dx * 2 * k, z0 = cz + dz * 2 * k;
      this.a0.set(x0, p.rise ? y + 0.06 : y - 0.25, z0); this.a1.set(x0 + 2, p.rise ? y + 0.5 : y, z0 + 2);
      if (!this.free(this.a0, this.a1)) continue;
      if (!p.rise && this.supported(this.a0, this.a1, y)) continue;
      res.origin.set(x0 + 1 - dx, y, z0 + 1 - dz); res.ok = true; break;
    }
    return res;
  }
  place(type: number, t: Target) {
    const boxes: Box[] = [], min = V(1e9, 1e9, 1e9), max = V(-1e9, -1e9, -1e9), o = t.origin, { dx, dz } = t;
    const mesh = new THREE.Mesh(pieceGeos[type], woodMat); mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.copy(o); mesh.rotation.y = t.yaw; this.root.add(mesh);
    const piece: Piece = { type, boxes, mesh, maxZ: 0, min, max, state: 0, t: 0, y: o.y };
    for (const l of pieceBoxes[type]) {
      const xs = [o.x + l[0] * -dz - l[4] * dx, o.x + l[1] * -dz - l[5] * dx], zs = [o.z + l[0] * dx - l[4] * dz, o.z + l[1] * dx - l[5] * dz];
      const b: Box = { min: V(Math.min(...xs), o.y + l[2], Math.min(...zs)), max: V(Math.max(...xs), o.y + l[3], Math.max(...zs)), on: true, owner: piece };
      boxes.push(b); this.boxes.push(b); min.min(b.min); max.max(b.max);
    }
    piece.maxZ = max.z; this.pieces.push(piece); this.built++;
    const c = V().addVectors(min, max).multiplyScalar(0.5);
    this.fx.burst(c, 14, 0xf2d9a8, 3.5, 0.35, 0.5, 4, 0.3);
    return piece;
  }
  private removePiece(p: Piece, shatter: boolean) {
    for (const b of p.boxes) b.on = false;
    if (shatter) this.fx.shatter(p.min, p.max, 0xb98654, 4 + PIECES[p.type].len, 3);
    this.root.remove(p.mesh); p.state = 3;
  }

  /* ---------- simulation ---------- */
  update(dt: number, time: number, pl: Player, alive: boolean) {
    const d = this.def;
    if (this.doomOn) {
      const lead = this.doomZ - pl.pos.z;
      this.doomZ -= d.doom * (lead > 70 ? 1.7 : lead > 45 ? 1.25 : 1) * dt;
    }
    this.doom.position.set(pl.pos.x * 0.6, 40, this.doomZ + 7);
    this.doomU.uT.value = time; this.doomU.uFlash.value = Math.max(0, this.doomU.uFlash.value - dt * 4);
    if (Math.random() < dt * 0.5) this.doomU.uFlash.value = 1;

    for (const isl of this.islands) {
      if (isl.state === 2) continue;
      const b = isl.box;
      if (isl.mv && isl.state < 2) {
        const mid = (isl.mv.a + isl.mv.b) / 2, amp = Math.abs(isl.mv.a - isl.mv.b) / 2, om = isl.mv.speed / Math.max(amp, 1);
        const z = mid + Math.sin(time * om + isl.mv.ph) * amp; (b.vel ??= V()).set(0, 0, Math.cos(time * om + isl.mv.ph) * amp * om);
        isl.home.z = z; b.min.z = z - isl.d / 2; b.max.z = z + isl.d / 2;
      }
      if (isl.state === 0) {
        isl.mesh.position.copy(isl.home);
        if (this.doomZ < b.max.z) { isl.state = 1; isl.t = isl.kind === 'main' ? 1.3 : 0.6; if (Math.abs(b.max.z - pl.pos.z) < 40) this.sfx.crack(); }
        else if (isl.kind === 'stone' && pl.ground === b) { isl.state = 1; isl.t = 0.6; this.sfx.crack(); }
      } else {
        isl.t -= dt; const a = 0.12;
        isl.mesh.position.set(isl.home.x + (Math.random() - 0.5) * a, isl.home.y + (Math.random() - 0.5) * a - (1.3 - Math.max(isl.t, 0)) * 0.15, isl.home.z + (Math.random() - 0.5) * a);
        if (Math.random() < dt * 30) this.fx.spark(b.min.x + Math.random() * isl.w, b.min.y, b.min.z + Math.random() * isl.d, 0, -2, 0, 0.8, 0.5, 0xbfae98, 8);
        if (isl.t <= 0) {
          isl.state = 2; b.on = false; isl.mesh.visible = false;
          this.fx.shatter(V(b.min.x, b.min.y - 1.5, b.min.z), b.max, isl.color, isl.kind === 'main' ? 9 : 3, 3);
          this.fx.shatter(V(b.min.x, b.min.y - 3, b.min.z), V(b.max.x, b.min.y, b.max.z), d.theme.rock, isl.kind === 'main' ? 9 : 3, 3);
          const dist = pl.pos.distanceTo(isl.home); if (dist < 45) { this.host.shake(0.55 * (1 - dist / 45)); this.sfx.boom(); }
        }
      }
      if (isl.spin && isl.state < 2) {
        const s = isl.spin; s.ang += s.w * dt; s.bar.rotation.y = s.ang;
        const ex = Math.cos(s.ang) * s.len / 2, ez = -Math.sin(s.ang) * s.len / 2, px = pl.pos.x - isl.home.x, pz = pl.pos.z - isl.home.z;
        const tt = Math.max(-1, Math.min(1, (px * ex + pz * ez) / (ex * ex + ez * ez))), qx = px - ex * tt, qz = pz - ez * tt, by = isl.home.y + 0.75;
        if (alive && pl.stun <= 0 && qx * qx + qz * qz < 0.55 * 0.55 && pl.pos.y < by + 0.3 && pl.pos.y + 1.7 > by - 0.2) {
          const sg = Math.sign(s.w) * tt; // tangential velocity of the bar at the hit point
          this.host.knock(ez * sg * 3.2 + qx * 6, 8, -ex * sg * 3.2 + qz * 6);
        }
      }
      if (isl.cp && !isl.cpOn && pl.ground === b) { isl.cpOn = true; (isl.flag!.material as THREE.MeshStandardMaterial).color.set(0xffc93a); (isl.flag!.material as THREE.MeshStandardMaterial).emissive.set(0xff9a00); this.host.checkpoint(isl); }
      if (isl.fin) {
        isl.mesh.traverse((o) => { if (o.userData.portal) { o.rotation.z = time * 1.5; (o as THREE.Mesh).scale.setScalar(1 + Math.sin(time * 4) * 0.04); } });
        if (alive && pl.ground === b) this.host.reachFinish();
      }
    }

    for (const p of this.pieces) {
      if (p.state === 3) continue;
      p.t += dt;
      if (p.state === 0) {
        const k = Math.min(1, p.t / 0.2), e = 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
        p.mesh.scale.set(0.6 + 0.4 * e, e, 0.6 + 0.4 * e); p.mesh.position.y = p.y - (1 - k) * 0.5;
        if (k >= 1) { p.state = 1; p.mesh.scale.setScalar(1); p.mesh.position.y = p.y; }
      }
      if (p.state < 2 && this.doomZ < p.maxZ) { p.state = 2; p.t = 0; }
      if (p.state === 2) { p.mesh.position.y = p.y + (Math.random() - 0.5) * 0.08; if (p.t > 0.7) this.removePiece(p, true); }
    }
    if (this.pieces.length > 40 && this.pieces[0].state === 3) this.pieces = this.pieces.filter((p) => p.state !== 3);

    for (const k of this.pickups) {
      if (k.taken) continue;
      k.mesh.rotation.y += dt * 2.2; k.mesh.position.y = k.y + Math.sin(time * 3 + k.mesh.position.x) * 0.18;
      if (this.doomZ < k.mesh.position.z - 3) { k.taken = true; k.mesh.visible = false; continue; }
      const dxp = k.mesh.position.x - pl.pos.x, dyp = k.mesh.position.y - (pl.pos.y + 0.9), dzp = k.mesh.position.z - pl.pos.z;
      if (alive && dxp * dxp + dzp * dzp < 2.4 && Math.abs(dyp) < 1.7) {
        k.taken = true; k.mesh.visible = false;
        this.fx.burst(k.mesh.position, 16, k.kind === 'wood' ? 0xffc27a : 0xffe45a, 5, 0.4, 0.5, 3);
        if (k.kind === 'wood') this.host.addWood(3); else this.host.addStar();
      }
    }

    if (d.meteor && this.doomOn && alive && !NO_METEOR) {
      this.meteorT -= dt;
      if (this.meteorT <= 0) {
        this.meteorT = d.meteor * (0.7 + Math.random() * 0.6);
        const target = V(pl.pos.x + pl.vel.x * 1.1 + (Math.random() - 0.5) * 5, pl.pos.y + 0.05, pl.pos.z + pl.vel.z * 1.1 + (Math.random() - 0.5) * 5 - 3);
        const mesh = this.mesh(new THREE.IcosahedronGeometry(0.9, 0), this.mat(0xffb060, { emissive: 0xff5a10, emissiveIntensity: 3 }), this.root, 0, 0, 0, false);
        const ring = this.mesh(new THREE.RingGeometry(2.6, 3.1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), this.root, target.x, target.y, target.z, false);
        this.meteors.push({ mesh, ring, target, t: 1.7 });
      }
    }
    for (const m of this.meteors) {
      m.t -= dt; const f = Math.max(0, m.t);
      m.mesh.position.set(m.target.x + f * 14, m.target.y + f * 45, m.target.z + f * 9); m.mesh.rotation.x += dt * 5;
      m.ring.scale.setScalar(0.5 + 0.5 * Math.min(1, (1.7 - m.t) * 1.2)); (m.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(time * 22);
      this.fx.spark(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.5, 1.1, 0xff8a30, -2);
      if (m.t <= 0) {
        this.fx.burst(m.target, 40, 0xff7a20, 12, 0.7, 0.8, 10, 0.6); this.sfx.boom(); this.host.shake(0.7);
        for (const p of this.pieces) if (p.state !== 3 && p.min.x - 1.6 < m.target.x && p.max.x + 1.6 > m.target.x && p.min.z - 1.6 < m.target.z && p.max.z + 1.6 > m.target.z && Math.abs(p.max.y - m.target.y) < 4) this.removePiece(p, true);
        const ddx = pl.pos.x - m.target.x, ddz = pl.pos.z - m.target.z, dist = Math.hypot(ddx, ddz);
        if (alive && dist < 3.2 && Math.abs(pl.pos.y - m.target.y) < 3) this.host.knock((ddx / (dist + 0.01)) * 9, 10, (ddz / (dist + 0.01)) * 9);
        this.root.remove(m.mesh, m.ring);
      }
    }
    this.meteors = this.meteors.filter((m) => m.t > 0);
  }

  /** Rewind the world to a checkpoint: everything at/after it is rebuilt, the rest is gone. */
  restore(cp: Island) {
    for (const p of this.pieces) if (p.state !== 3) this.removePiece(p, false);
    this.pieces = [];
    for (const isl of this.islands) {
      const keep = isl.ord >= cp.ord;
      isl.state = keep ? 0 : 2; isl.box.on = keep; isl.mesh.visible = keep; isl.mesh.position.copy(isl.home);
    }
    for (const k of this.pickups) { if (k.kind === 'wood' || !k.taken) { k.taken = k.ord < cp.ord; k.mesh.visible = !k.taken; } }
    for (const m of this.meteors) this.root.remove(m.mesh, m.ring);
    this.meteors = []; this.meteorT = 4;
    this.doomZ = cp.box.max.z + 26; this.doomOn = false;
  }
  dispose() {
    this.scene.remove(this.root, this.doom);
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !pieceGeos.includes(m.geometry)) m.geometry.dispose(); });
  }
}

/* ---------- courses ---------- */
export const COURSES: CourseDef[] = [
  {
    id: 'shoals', name: 'Sunrise Shoals', tag: 'Course 1 · Warm-up', desc: 'Wide islands, friendly gaps. Learn to pave the sky.', seed: 11, n: 16, gap: [12, 22], dy: [-0.5, 1], lat: 2,
    doom: 5.4, wood: 12, rate: 1.3, cp: 4, spin: 0.15, mover: 0.12, stones: 0.2, meteor: 0, par: 90, reserve: 4,
    theme: { top: 0x3f8fe0, hor: 0xffd9b0, sun: 0xfff0d0, sunDir: [-0.55, 0.6, 0.5], sunI: 3.2, hemiSky: 0xbfe0ff, hemiGround: 0xc9a27a, hemiI: 1.3, fogD: 0.0042,
      cloud: 0xffffff, cloudShade: 0xe7b9a0, grass: [0x7fc04f, 0x8ccb55, 0x6fb347], rock: 0xa88463, stone: 0xd9d2c0, leaf: [0x3f9a48, 0x58b04e, 0xf2a53c], doomA: 0xff5a2a, doomB: 0x2a1030, stars: 0, exposure: 1 },
  },
  {
    id: 'reach', name: 'Thunder Reach', tag: 'Course 2 · Vertical', desc: 'Climb through the storm. Spinners, movers and tall steps.', seed: 23, n: 20, gap: [14, 28], dy: [-1, 3], lat: 3,
    doom: 6.0, wood: 10, rate: 1.12, cp: 5, spin: 0.45, mover: 0.25, stones: 0.25, meteor: 0, par: 150, reserve: 3,
    theme: { top: 0x2b2a6a, hor: 0xff9a6a, sun: 0xffb37a, sunDir: [0.7, 0.32, 0.45], sunI: 3.4, hemiSky: 0x8f8ad0, hemiGround: 0x7a4a5a, hemiI: 1.1, fogD: 0.005,
      cloud: 0xffc9b0, cloudShade: 0x6a4a8a, grass: [0xd9973a, 0xc9803a, 0xe0aa48], rock: 0x6a5a7a, stone: 0xb9b0c8, leaf: [0xd9562f, 0xe98a2a, 0x8a3a5a], doomA: 0xc060ff, doomB: 0x120a30, stars: 0.25, exposure: 1.05 },
  },
  {
    id: 'crown', name: 'Cinder Crown', tag: 'Course 3 · Meltdown', desc: 'Scarce wood, falling fire, and a doom that sprints.', seed: 37, n: 24, gap: [16, 34], dy: [-1.5, 3], lat: 4,
    doom: 6.5, wood: 12, rate: 1.08, cp: 4, spin: 0.5, mover: 0.3, stones: 0.3, meteor: 4.6, par: 200, reserve: 5,
    theme: { top: 0x070a1c, hor: 0x5a1a22, sun: 0xff8a5a, sunDir: [-0.4, 0.5, -0.6], sunI: 3.6, hemiSky: 0x7a8ac8, hemiGround: 0x8a3212, hemiI: 1.6, fogD: 0.0058,
      cloud: 0x4a3040, cloudShade: 0x1a0c14, grass: [0x5a5262, 0x665a68, 0x4e4a5a], rock: 0x30262e, stone: 0x6a5a5a, leaf: [0xff7a2a], doomA: 0xff3a10, doomB: 0x100408, stars: 1, lava: true, exposure: 1.15 },
  },
];
