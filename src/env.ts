import * as THREE from 'three';
import { noiseTex, puffTex, rng } from './fx';

export interface Theme {
  top: number; hor: number; sun: number; sunDir: [number, number, number]; sunI: number;
  hemiSky: number; hemiGround: number; hemiI: number; fogD: number;
  cloud: number; cloudShade: number; grass: number[]; rock: number; stone: number; leaf: number[];
  doomA: number; doomB: number; stars: number; lava?: boolean; exposure: number;
}

const TONE = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

export class Env {
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } };
  private seaU = { uT: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uNoise: { value: noiseTex }, uGlow: { value: new THREE.Color(0) } };
  private sky: THREE.Mesh; private sea: THREE.Mesh; private puffs: THREE.Sprite[] = []; private stars: THREE.Points;
  private puffMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.75 });
  dir = new THREE.Vector3();
  fogBase = new THREE.Color(); theme!: Theme;

  constructor(private scene: THREE.Scene, low: boolean) {
    scene.fog = new THREE.FogExp2(0xffffff, 0.004);
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    const s = this.sun.shadow; s.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    s.camera.left = -45; s.camera.right = 45; s.camera.top = 45; s.camera.bottom = -45; s.camera.near = 1; s.camera.far = 220; s.bias = -0.0006; s.normalBias = 0.05;

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 uTop,uHor,uSun,uSunCol;varying vec3 vD;void main(){vec3 d=normalize(vD);
        vec3 c=mix(uHor,uTop,pow(clamp(d.y*.9+.12,0.,1.),.55));c=mix(c,uHor*.85,smoothstep(0.,-.4,d.y));
        float s=max(dot(d,uSun),0.);c+=uSunCol*(pow(s,10.)*.35+pow(s,900.)*6.);gl_FragColor=vec4(c,1.);${TONE}}`,
    }));
    this.sky.frustumCulled = false; scene.add(this.sky);

    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.seaU, fog: false,
      vertexShader: `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `uniform float uT;uniform vec3 uA,uB,uFog,uGlow;uniform sampler2D uNoise;varying vec3 vW;void main(){
        vec2 p=vW.xz*.0035;float n=texture2D(uNoise,p+vec2(uT*.004,uT*.002)).r*.6+texture2D(uNoise,p*2.7-vec2(uT*.006,0.)).r*.3+texture2D(uNoise,p*7.+uT*.01).r*.15;
        vec3 c=mix(uB,uA,smoothstep(.3,.75,n));c+=uGlow*smoothstep(.42,.2,n);
        float d=length(cameraPosition.xz-vW.xz);c=mix(c,uFog,smoothstep(250.,1500.,d));gl_FragColor=vec4(c,1.);${TONE}}`,
    }));
    this.sea.position.y = -70; scene.add(this.sea);

    const r = rng(3);
    for (let i = 0; i < 46; i++) {
      const sp = new THREE.Sprite(this.puffMat); const sc = 40 + r() * 90;
      sp.scale.set(sc * 2, sc, 1); sp.userData.o = [(r() < 0.5 ? -1 : 1) * (120 + r() * 260), -55 + r() * 75, -r() * 900 + 120];
      sp.userData.v = 1 + r() * 2.5; this.puffs.push(sp); scene.add(sp);
    }
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const a = r() * 6.283, e = Math.acos(r() * 0.95), R = 850; sp.set([Math.cos(a) * Math.sin(e) * R, Math.cos(e) * R, Math.sin(a) * Math.sin(e) * R], i * 3); }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; scene.add(this.stars);
  }

  apply(t: Theme, renderer: THREE.WebGLRenderer) {
    this.theme = t;
    this.skyU.uTop.value.set(t.top); this.skyU.uHor.value.set(t.hor); this.skyU.uSunCol.value.set(t.sun);
    this.dir.set(...t.sunDir).normalize(); this.skyU.uSun.value.copy(this.dir);
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.fogBase.set(t.hor); (this.scene.fog as THREE.FogExp2).density = t.fogD;
    this.seaU.uA.value.set(t.cloud); this.seaU.uB.value.set(t.cloudShade); this.seaU.uFog.value.set(t.hor);
    this.seaU.uGlow.value.set(t.lava ? 0x7a1c05 : 0x000000);
    this.puffMat.color.set(t.cloud); (this.stars.material as THREE.PointsMaterial).opacity = t.stars;
    renderer.toneMappingExposure = t.exposure;
  }

  update(dt: number, time: number, focus: THREE.Vector3, danger: number) {
    this.seaU.uT.value = time;
    this.sky.position.copy(focus); this.stars.position.copy(focus);
    this.sea.position.x = focus.x; this.sea.position.z = focus.z;
    this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.dir, 110);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.fogBase).lerp(TMP.set(this.theme.doomA), danger * 0.45);
    for (const p of this.puffs) {
      const o = p.userData.o as number[]; o[0] += p.userData.v * dt; if (o[0] > 380) o[0] = -380; else if (o[0] > -120 && o[0] < 0) o[0] = 120;
      // keep clouds wrapped around the player along the course
      let z = o[2]; const rel = z - focus.z; if (rel > 220) o[2] -= 900; else if (rel < -680) o[2] += 900;
      z = o[2]; p.position.set(focus.x * 0.5 + o[0], o[1], z);
    }
  }
}
const TMP = new THREE.Color();
