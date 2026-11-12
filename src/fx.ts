import * as THREE from 'three';

export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const noiseTex = canvasTex(256, 256, (g) => {
  const S = 256, img = g.createImageData(S, S), r = rng(7);
  const octs = [4, 8, 16, 32, 64].map((n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return { n, a }; });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, amp = 0.5, tot = 0;
    for (const o of octs) {
      const fx = (x / S) * o.n, fy = (y / S) * o.n, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const x1 = (x0 + 1) % o.n, y1 = (y0 + 1) % o.n;
      const a = o.a[y0 * o.n + x0], b = o.a[y0 * o.n + x1], c = o.a[y1 * o.n + x0], d = o.a[y1 * o.n + x1];
      v += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty); tot += amp; amp *= 0.55;
    }
    v = Math.max(0, Math.min(1, (v / tot - 0.5) * 1.9 + 0.5)) * 255;
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, false);

export const puffTex = canvasTex(256, 128, (g) => {
  const r = rng(9);
  for (let i = 0; i < 24; i++) {
    const x = 50 + r() * 156, y = 58 + r() * 26, rad = 22 + r() * 34, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  }
});

const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});

const N = 2600, D = 420;
const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

export class FX {
  points: THREE.Points;
  private pos = new Float32Array(N * 3); private col = new Float32Array(N * 3); private size = new Float32Array(N); private alpha = new Float32Array(N);
  private vel = new Float32Array(N * 3); private life = new Float32Array(N); private max = new Float32Array(N); private grav = new Float32Array(N); private s0 = new Float32Array(N);
  private cur = 0;
  debris: THREE.InstancedMesh;
  private dp = new Float32Array(D * 3); private dv = new Float32Array(D * 3); private dr = new Float32Array(D * 3); private da = new Float32Array(D * 3);
  private ds = new Float32Array(D * 3); private dl = new Float32Array(D); private dcur = 0;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: dotTex }, uScale: { value: 600 } },
      vertexShader: `attribute float aSize;attribute float aAlpha;attribute vec3 color;varying vec3 vC;varying float vA;uniform float uScale;
        void main(){vC=color;vA=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/max(.1,-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uTex;varying vec3 vC;varying float vA;void main(){float a=texture2D(uTex,gl_PointCoord).a*vA;if(a<.01)discard;gl_FragColor=vec4(vC,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), D);
    this.debris.frustumCulled = false; this.debris.castShadow = true;
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < D; i++) { this.debris.setMatrixAt(i, tmpM); this.debris.setColorAt(i, tmpC.set(0xffffff)); }
    scene.add(this.debris);
  }

  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 0) {
    const i = this.cur; this.cur = (i + 1) % N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    tmpC.set(color); this.col[i * 3] = tmpC.r; this.col[i * 3 + 1] = tmpC.g; this.col[i * 3 + 2] = tmpC.b;
    this.life[i] = this.max[i] = life; this.s0[i] = size; this.grav[i] = grav;
  }
  burst(p: THREE.Vector3, n: number, color: number, speed: number, size: number, life: number, grav = 6, up = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 2 - 1 + up, s = speed * (0.4 + Math.random() * 0.6), h = Math.sqrt(Math.max(0, 1 - Math.min(1, e * e)));
      this.spark(p.x, p.y, p.z, Math.cos(a) * h * s, e * s, Math.sin(a) * h * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, grav);
    }
  }
  chunk(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, vx: number, vy: number, vz: number) {
    const i = this.dcur; this.dcur = (i + 1) % D;
    this.dp.set([x, y, z], i * 3); this.dv.set([vx, vy, vz], i * 3); this.ds.set([sx, sy, sz], i * 3);
    this.dr.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.da.set([(Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5], i * 3);
    this.dl[i] = 4; this.debris.setColorAt(i, tmpC.set(color)); this.debris.instanceColor!.needsUpdate = true;
  }
  /** Shatter a box volume into falling chunks */
  shatter(min: THREE.Vector3, max: THREE.Vector3, color: number, n: number, kick = 2) {
    const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
    for (let i = 0; i < n; i++) {
      const s = 0.35 + Math.random() * 0.5, w = Math.max(0.3, sx * s * 0.5), d = Math.max(0.3, sz * s * 0.5);
      this.chunk(min.x + Math.random() * sx, min.y + Math.random() * sy, min.z + Math.random() * sz, Math.min(w, 3), Math.max(0.25, Math.min(sy, 1.2) * (0.5 + Math.random() * 0.5)), Math.min(d, 3), color,
        (Math.random() - 0.5) * kick, Math.random() * kick, (Math.random() - 0.5) * kick);
    }
  }
  clear() { this.life.fill(0); this.dl.fill(0); }

  update(dt: number) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt; const j = i * 3;
      this.vel[j + 1] -= this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, f * 2.2); this.size[i] = this.s0[i] * (0.5 + 0.5 * f);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = g.attributes.color.needsUpdate = true;
    for (let i = 0; i < D; i++) {
      if (this.dl[i] <= 0) continue;
      this.dl[i] -= dt; const j = i * 3;
      this.dv[j + 1] -= 22 * dt;
      for (let k = 0; k < 3; k++) { this.dp[j + k] += this.dv[j + k] * dt; this.dr[j + k] += this.da[j + k] * dt; }
      const s = this.dl[i] <= 0 ? 0 : Math.min(1, this.dl[i] * 2);
      tmpM.compose(tmpP.set(this.dp[j], this.dp[j + 1], this.dp[j + 2]), tmpQ.setFromEuler(tmpE.set(this.dr[j], this.dr[j + 1], this.dr[j + 2])), tmpS.set(this.ds[j] * s, this.ds[j + 1] * s, this.ds[j + 2] * s));
      this.debris.setMatrixAt(i, tmpM);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
