import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FX } from './fx';
import { Sfx } from './audio';
import { Env } from './env';
import { Level, COURSES, PIECES, pieceGeos, Island, Host, Target } from './level';
import { Player, SPEED } from './player';

const $ = (id: string) => document.getElementById(id)!;
const Q = new URLSearchParams(location.search), LOW = Q.has('low');
const ICONS = [
  '<path d="M6 20h36v5H6z" fill="#f0a04a"/><path d="M10 25h4v4h-4zM34 25h4v4h-4z" fill="#8a5a33"/>',
  '<path d="M2 19h44v4H2z" fill="#f0a04a"/><path d="M2 11h44v2H2z" fill="#8a5a33"/><path d="M3 11h2v9H3zM16 11h2v9h-2zM30 11h2v9h-2zM43 11h2v9h-2z" fill="#8a5a33"/>',
  '<path d="M6 26h9v-6h9v-6h9V8h9v4h-5v6h-9v6h-9v6H6z" fill="#f0a04a"/>',
  '<path d="M4 27L44 9v5L4 32z" fill="#f0a04a"/><path d="M38 14h3v16h-3z" fill="#8a5a33"/>',
];
type State = 'menu' | 'play' | 'pause' | 'dead' | 'over' | 'win';
interface Save { best: Record<string, number>; done: Record<string, boolean>; muted: boolean }

class Game implements Host {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(68, 1, 0.1, 2500);
  composer: EffectComposer | null = null; env: Env; fx: FX; sfx = new Sfx(); player = new Player(); level!: Level;
  state: State = 'menu'; course = 0; wood = 0; stars = 0; lives = 3; time = 0; clock = 0; deaths = 0; score = 0;
  cp!: Island; cpWood = 0; sel = 0; placeCd = 0; trauma = 0; yaw = 0; pitch = -0.3; intro = 1; grace = 0; deadT = 0; groundY = 0; winT = 0;
  keys = new Set<string>(); jumpEdge = false; dashEdge = false; placeEdge = false; mouseDown = false; locked = false;
  camT = new THREE.Vector3(); ghosts: THREE.Mesh[] = []; ghostMat: THREE.MeshBasicMaterial; tgt: Target | null = null;
  save: Save; bot = Q.has('bot'); botOrd = 0; log: any[] = []; trace: any[] = []; botZ = 0; botStuck = 0; traceT = -1; last = performance.now(); fov = 68; bannerT = 0;

  constructor() {
    const canvas = $('c') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.env = new Env(this.scene, LOW); this.fx = new FX(this.scene);
    this.scene.add(this.player.model);
    if (!LOW) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.cam));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.7, 0.86));
      this.composer.addPass(new OutputPass());
    }
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.4, depthWrite: false });
    pieceGeos.forEach((g) => { const m = new THREE.Mesh(g, this.ghostMat); m.visible = false; m.renderOrder = 3; this.scene.add(m); this.ghosts.push(m); });
    let s: Partial<Save> = {}; try { s = JSON.parse(localStorage.getItem('decks-of-doom') || '{}'); } catch { /* fresh */ }
    this.save = { best: s.best ?? {}, done: s.done ?? {}, muted: !!s.muted };
    this.sfx.muted = this.save.muted;
    this.bind(); this.resize(); addEventListener('resize', () => this.resize());
    this.load(0); this.menu();
    requestAnimationFrame((t) => this.frame(t));
  }
  persist() { try { localStorage.setItem('decks-of-doom', JSON.stringify(this.save)); } catch { /* private mode */ } }
  resize() {
    const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.composer?.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  /* ---------- input ---------- */
  bind() {
    const canvas = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.repeat) return; this.sfx.unlock(); this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpEdge = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashEdge = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.placeEdge = true;
      if (/^Digit[1-4]$/.test(e.code)) this.select(+e.code[5] - 1);
      if (e.code === 'KeyQ') this.select((this.sel + 1) % 4);
      if (e.code === 'KeyR' && this.state === 'play') this.die(true);
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.state === 'play') this.pause(); else if (this.state === 'pause') this.resume(); }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.sfx.unlock(); if (this.state !== 'play') return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) { this.mouseDown = true; this.placeEdge = true; }
    });
    addEventListener('mouseup', () => (this.mouseDown = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked || this.state !== 'play') return;
      this.yaw -= e.movementX * 0.0026; this.pitch = Math.max(-1.25, Math.min(0.6, this.pitch - e.movementY * 0.0022));
    });
    addEventListener('wheel', (e) => { if (this.state === 'play') this.select((this.sel + (e.deltaY > 0 ? 1 : 3)) % 4); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas; this.mouseDown = false;
      $('lock').classList.toggle('hidden', this.locked);
      if (!this.locked && this.state === 'play' && !this.bot && !Q.has('nopause')) this.pause();
    });
    $('mute').onclick = () => { this.sfx.unlock(); this.save.muted = !this.save.muted; this.sfx.setMuted(this.save.muted); this.persist(); $('mute').textContent = `Sound: ${this.save.muted ? 'off' : 'on'}`; };
    $('mute').textContent = `Sound: ${this.save.muted ? 'off' : 'on'}`;
  }
  lock() { try { (this.renderer.domElement.requestPointerLock() as any)?.catch?.(() => {}); } catch { /* unsupported */ } }
  select(i: number) { if (this.sel !== i) this.sfx.ui(); this.sel = i; this.hotbar(); }

  /* ---------- flow ---------- */
  load(i: number) {
    this.level?.dispose(); this.fx.clear();
    this.course = i; const def = COURSES[i];
    this.level = new Level(def, this.scene, this.fx, this.sfx, this);
    this.env.apply(def.theme, this.renderer);
    this.cp = this.level.mains[0]; this.player.reset(0, 0.02, 2.5);
    this.camT.set(0, 1.5, 2.5); this.yaw = 0; this.pitch = -0.3; this.groundY = 0;
  }
  menu() {
    this.state = 'menu'; document.exitPointerLock?.(); this.sfx.playing = false;
    $('hud').classList.add('hidden'); $('modal').classList.add('hidden'); $('menu').classList.remove('hidden');
    $('cards').innerHTML = COURSES.map((c, i) => {
      const locked = i > 0 && !this.save.done[COURSES[i - 1].id] && !Q.has('unlock'), b = this.save.best[c.id];
      return `<button class="card ${locked ? 'locked' : ''}" data-i="${i}"><small>${c.tag}</small><h3>${c.name}</h3><p>${c.desc}</p><div class="best">${locked ? '🔒 Finish the previous course' : b ? `${medal(b, c.par)} Best ${b.toLocaleString()}` : 'Not yet escaped'}</div></button>`;
    }).join('');
    document.querySelectorAll<HTMLElement>('.card:not(.locked)').forEach((el) => {
      el.onclick = () => this.start(+el.dataset.i!);
      el.onmouseenter = () => { const i = +el.dataset.i!; if (i !== this.course) this.load(i); };
    });
  }
  start(i: number) {
    this.sfx.unlock(); this.sfx.ui();
    this.load(i); const def = COURSES[i];
    this.wood = this.cpWood = def.wood; this.stars = 0; this.lives = 3; this.time = 0; this.deaths = 0; this.sel = 0; this.botOrd = 0;
    this.level.doomZ = 34; this.grace = 3.4; this.intro = 0; this.state = 'play'; this.winT = 0;
    this.sfx.playing = true; this.sfx.root = [45, 43, 41][i];
    $('menu').classList.add('hidden'); $('modal').classList.add('hidden'); $('hud').classList.remove('hidden');
    this.hotbar(); this.hud(true); this.banner(def.name.toUpperCase(), 'BUILD YOUR WAY OUT', 2.6);
    const marks = this.level.mains.filter((m) => m.cp).map((m) => `<b style="left:${(m.home.z / this.level.endZ) * 100}%"></b>`).join('');
    $('track').querySelectorAll('b').forEach((b) => b.remove()); $('track').insertAdjacentHTML('beforeend', marks);
    if (!this.bot) this.lock();
    $('lock').classList.toggle('hidden', this.locked);
  }
  pause() {
    this.state = 'pause'; document.exitPointerLock?.(); this.sfx.ambience(0, 0);
    this.panel(`<h2>Paused</h2><p>${COURSES[this.course].name}</p><div class="row"><button class="btn" id="b1">Resume</button><button class="btn alt" id="b2">Restart course</button><button class="btn alt" id="b3">Menu</button></div>`,
      () => this.resume(), () => this.start(this.course), () => this.menu());
  }
  resume() { $('modal').classList.add('hidden'); this.state = 'play'; this.lock(); }
  panel(html: string, ...fns: (() => void)[]) {
    $('panel').innerHTML = html; $('modal').classList.remove('hidden');
    fns.forEach((f, i) => { const b = document.getElementById('b' + (i + 1)); if (b) b.onclick = () => { this.sfx.ui(); f(); }; });
  }
  banner(t: string, sub = '', dur = 1.6) { $('banner').innerHTML = `${t}${sub ? `<small>${sub}</small>` : ''}`; $('banner').classList.add('show'); this.bannerT = dur; }

  die(manual = false) {
    if (this.state !== 'play') return;
    this.log.push({ z: Math.round(this.player.pos.z), x: Math.round(this.player.pos.x), wood: this.wood, ord: this.botOrd, t: +this.time.toFixed(1), doom: Math.round(this.level.doomZ) });
    this.state = 'dead'; this.deadT = manual ? 0.25 : 1.0; this.lives--; this.deaths++; this.sfx.fall(); this.trauma = 0.6;
  }
  respawn() {
    if (this.lives <= 0) {
      this.state = 'over'; this.sfx.playing = false; this.sfx.lose(); document.exitPointerLock?.(); this.sfx.ambience(0, 0);
      this.panel(`<h2>Swallowed by the doom</h2><p>You made it ${Math.round(this.progress() * 100)}% of the way through ${COURSES[this.course].name}.</p><div class="row"><button class="btn" id="b1">Try again</button><button class="btn alt" id="b2">Menu</button></div>`,
        () => this.start(this.course), () => this.menu());
      return;
    }
    this.level.restore(this.cp); this.fx.clear(); this.botOrd = this.cp.ord;
    this.player.reset(this.cp.home.x, this.cp.home.y + 0.02, this.cp.home.z + 2);
    this.wood = Math.max(this.cpWood, 8); this.grace = 2.6; this.state = 'play'; this.groundY = this.cp.home.y; this.yaw = 0; this.pitch = -0.3;
    this.camT.copy(this.player.pos); this.flash(); this.banner('AGAIN!', `${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`, 1.4); this.hud(true);
  }
  flash() { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.7'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
  progress() { return Math.max(0, Math.min(1, this.player.pos.z / this.level.endZ)); }

  // Host callbacks from the level
  addWood(n: number) { this.wood += n; this.sfx.wood(); this.pop(); }
  addStar() { this.stars++; this.sfx.star(); }
  shake(a: number) { this.trauma = Math.min(1, this.trauma + a); }
  knock(vx: number, vy: number, vz: number) { const p = this.player; p.vel.set(vx, vy, vz); p.stun = 0.45; p.grounded = false; p.dashT = 0; this.sfx.hit(); this.trauma = Math.min(1, this.trauma + 0.5); this.fx.burst(p.pos, 14, 0xffffff, 6, 0.4, 0.4); }
  checkpoint(i: Island) {
    this.cp = i; this.cpWood = this.wood; this.sfx.checkpoint(); this.banner('CHECKPOINT', 'the doom never rests', 1.5);
    this.fx.burst(new THREE.Vector3(i.home.x - 3.7, i.home.y + 2.9, i.home.z + 3.5), 40, 0xffd21f, 8, 0.5, 0.9, 5);
  }
  reachFinish() {
    if (this.state !== 'play') return;
    this.state = 'win'; this.winT = 0; this.sfx.playing = false; this.sfx.win(); this.level.doomOn = false; document.exitPointerLock?.(); this.flash();
    const c = COURSES[this.course], t = Math.max(0, Math.round((c.par - this.time) * 15)), rows: [string, number][] = [['Escaped', 1000], [`Time ${fmt(this.time)}`, t], [`Wood saved ×${this.wood}`, this.wood * 20], [`Stars ×${this.stars}`, this.stars * 150], [`Lives ×${this.lives}`, this.lives * 250]];
    this.score = rows.reduce((a, r) => a + r[1], 0);
    const best = this.save.best[c.id] ?? 0, isBest = this.score > best;
    if (isBest) this.save.best[c.id] = this.score; this.save.done[c.id] = true; this.persist();
    const next = this.course < COURSES.length - 1;
    setTimeout(() => this.panel(`<div class="medal">${medal(this.score, c.par)}</div><h2>Escaped!</h2><p>${c.name}${isBest ? ' · <b style="color:#ffd21f">New best!</b>' : ''}</p>
      <table>${rows.map((r) => `<tr><td>${r[0]}</td><td>+${r[1].toLocaleString()}</td></tr>`).join('')}<tr class="total"><td>Score</td><td>${this.score.toLocaleString()}</td></tr></table>
      <div class="row">${next ? '<button class="btn" id="b1">Next course</button>' : '<button class="btn" id="b1">Run it again</button>'}<button class="btn alt" id="b2">Replay</button><button class="btn alt" id="b3">Menu</button></div>`,
      () => this.start(next ? this.course + 1 : this.course), () => this.start(this.course), () => this.menu()), 1700);
  }

  /* ---------- HUD ---------- */
  hotbar() {
    $('bar').innerHTML = PIECES.map((p, i) => `<div class="slot ${i === this.sel ? 'on' : ''} ${this.wood < p.cost ? 'poor' : ''}"><kbd>${i + 1}</kbd><svg viewBox="0 0 48 36">${ICONS[i]}</svg>${p.name} <em>${p.cost}</em></div>`).join('');
    $('tip').textContent = PIECES[this.sel].tip;
  }
  pop(cls = 'pop') { const w = $('wood'); w.classList.add(cls); setTimeout(() => w.classList.remove(cls), 160); this.hud(true); }
  private hudWood = -1; private hudLives = -1;
  hud(force = false) {
    if (force || this.hudWood !== this.wood) { this.hudWood = this.wood; $('wood').lastElementChild!.textContent = String(this.wood); this.hotbar(); }
    if (force || this.hudLives !== this.lives) { this.hudLives = this.lives; $('lives').textContent = '♥'.repeat(Math.max(0, this.lives)) + '♡'.repeat(Math.max(0, 3 - this.lives)); }
    $('stars').textContent = `★ ${this.stars}`; $('clock').lastElementChild!.textContent = fmt(this.time);
    const L = this.level, dp = Math.max(0, Math.min(1, L.doomZ / L.endZ)), gap = L.doomZ - this.player.pos.z;
    $('tdoom').style.width = `${dp * 100}%`; $('tme').style.left = `${this.progress() * 100}%`;
    $('doomtxt').textContent = this.grace > 0 ? `DOOM WAKES IN ${Math.ceil(this.grace)}` : gap < 30 ? `DOOM ${Math.max(0, Math.round(gap))} m` : '';
  }

  /* ---------- per-frame ---------- */
  botInput() {
    const pl = this.player, L = this.level, g = pl.ground?.owner as Island | undefined;
    if (g && g.kind === 'main') this.botOrd = Math.max(this.botOrd, g.ord);
    const cur = L.mains[this.botOrd], next = L.mains[Math.min(this.botOrd + 1, L.mains.length - 1)], nb = next.box;
    this.yaw = 0; let mx = 0, mz = 0;
    const onCur = g === cur, rise = nb.max.y - pl.pos.y, dist = pl.pos.z - nb.max.z;
    const wood = onCur ? L.pickups.filter((k) => k.kind === 'wood' && !k.taken && k.ord === cur.ord).sort((a, b) => a.mesh.position.distanceTo(pl.pos) - b.mesh.position.distanceTo(pl.pos))[0] : undefined;
    if (wood) { const ddx = wood.mesh.position.x - pl.pos.x, ddz = wood.mesh.position.z - pl.pos.z, l = Math.hypot(ddx, ddz) || 1; mx = ddx / l; mz = ddz / l; }
    else {
      const tx = Math.max(nb.min.x + 1.2, Math.min(nb.max.x - 1.2, pl.pos.x));
      const ax = onCur ? Math.max(cur.box.min.x + 0.7, Math.min(cur.box.max.x - 0.7, tx)) : tx;
      if (onCur && Math.abs(pl.pos.x - ax) > 0.5) mx = Math.sign(ax - pl.pos.x);
      else if (pl.pos.z > nb.max.z + 1.2 || Math.abs(pl.pos.x - tx) < 0.6) mz = -1; else mx = Math.sign(tx - pl.pos.x);
    }
    // choose the cheapest piece for what is left of the gap, measured from the current snap target
    const probe = L.target(0, pl, mx ? Math.sign(mx) : 0, mx ? 0 : -1, 99), rem = probe.ok ? probe.origin.z - nb.max.z : 99, flights = Math.ceil(Math.max(0, rise - 0.55) / 2);
    this.sel = mz !== -1 ? 0 : flights > 0 && rem <= 2 * flights + 0.01 ? 2 : rem - 6 >= 2 * flights ? 1 : 0;
    this.mouseDown = probe.ok && !wood && !(onCur && mx !== 0) && (pl.grounded || this.sel !== 2) && !(this.sel === 2 && rem < 1.9);
    // unstuck: if we stop making headway (usually a wall), throw down stairs and climb
    if (Math.abs(pl.pos.z - this.botZ) > 0.5 || wood || mx) { this.botZ = pl.pos.z; this.botStuck = 0; } else if ((this.botStuck += 1 / 60) > 0.5 && pl.grounded) { this.sel = 2; this.mouseDown = true; }
    // leap of faith: jump off the island edge, double-jump at the apex, and only build once falling
    const air = !pl.grounded && !wood && mz === -1 && flights === 0;
    if (!wood && mz === -1 && flights === 0 && onCur && dist > 10) { this.mouseDown = false; if (pl.pos.z < cur.box.min.z + 0.9) this.jumpEdge = true; }
    if (air) { if (pl.jumps === 1 && pl.vel.y < 1 && dist > 6) this.jumpEdge = true; this.sel = 0; this.mouseDown = pl.vel.y < 0 && pl.pos.y < nb.max.y + 0.7 && dist > 0.5; }
    if (pl.grounded && g && g.spin) this.jumpEdge = true;
    for (const m of L.meteors) { const dzm = m.target.z - pl.pos.z; if (pl.grounded && m.t < 0.9 && dzm < 1 && dzm > -8 && Math.abs(m.target.x - pl.pos.x) < 4) this.jumpEdge = true; }
    if (rise > 0.6 && rise < 2.1 && dist < 1.5 && pl.grounded && this.wood < 2) this.jumpEdge = true;
    if (Math.floor(this.time * 2) !== this.traceT) { this.traceT = Math.floor(this.time * 2); this.trace.push([+this.time.toFixed(1), +pl.pos.x.toFixed(1), +pl.pos.y.toFixed(1), +pl.pos.z.toFixed(1), this.sel, this.wood, pl.grounded ? 1 : 0, this.tgt?.ok ? 1 : 0, mx, mz, wood ? 1 : 0, this.botOrd]); if (this.trace.length > 24) this.trace.shift(); }
    return { mx, mz };
  }

  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const raw = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.clock += raw;
    const pl = this.player, L = this.level, K = this.keys;
    const dt = this.state === 'win' ? raw * 0.35 : raw;
    let danger = 0;

    if (this.state === 'play' || this.state === 'dead' || this.state === 'win') {
      const playing = this.state === 'play';
      // --- input → world-space move vector
      if (K.has('ArrowLeft')) this.yaw += raw * 2.4; if (K.has('ArrowRight')) this.yaw -= raw * 2.4;
      let f = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0), s = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0);
      let mx = 0, mz = 0;
      if (this.bot && playing) ({ mx, mz } = this.botInput());
      else if (f || s) { const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), l = Math.hypot(f, s); f /= l; s /= l; mx = -sy * f + cy * s; mz = -cy * f - sy * s; }
      if (!playing) { mx = mz = 0; }
      pl.update(dt, { mx, mz, jump: playing && this.jumpEdge, jumpHeld: K.has('Space'), dash: playing && this.dashEdge }, L.boxes);
      if (pl.jumped >= 0) { this.sfx.jump(pl.jumped); this.fx.burst(pl.pos, pl.jumped ? 14 : 6, pl.jumped ? 0x9fe8ff : 0xe8dcc8, 3, 0.3, 0.35, 2, 0); }
      if (pl.landed > 6) { this.sfx.land(pl.landed); this.fx.burst(pl.pos, 8, 0xe8dcc8, 3, 0.3, 0.35, 3, 0.1); if (pl.landed > 16) this.trauma = Math.min(1, this.trauma + 0.25); }
      if (pl.dashed) { this.sfx.dash(); this.fov = 86; }
      if (pl.dashT > 0) for (let i = 0; i < 3; i++) this.fx.spark(pl.pos.x + (Math.random() - 0.5) * 0.5, pl.pos.y + 0.4 + Math.random(), pl.pos.z + (Math.random() - 0.5) * 0.5, 0, 0, 0, 0.3, 0.5, 0xfff07a);
      if (pl.grounded) this.groundY = pl.pos.y;

      if (playing) {
        this.time += dt;
        if (this.grace > 0) { this.grace -= dt; if (this.grace <= 0) { L.doomOn = true; this.banner('RUN!', '', 0.9); this.sfx.crack(); this.trauma = 0.5; } }
        // --- building: snap target is the first empty tile ahead (or under you when airborne)
        let dx = 0, dz = 0; const bx = mx || -Math.sin(this.yaw), bz = mz || (mx ? 0 : -Math.cos(this.yaw));
        if (Math.abs(bx) > Math.abs(bz)) dx = Math.sign(bx); else dz = Math.sign(bz);
        const t = (this.tgt = L.target(this.sel, pl, dx, dz, this.wood)), cost = PIECES[this.sel].cost;
        this.placeCd -= dt;
        const want = this.mouseDown || K.has('KeyE') || K.has('KeyF') || this.placeEdge;
        if (want && this.placeCd <= 0 && t.ok) {
          if (t.afford) {
            const piece = L.place(this.sel, t); this.wood -= cost; this.sfx.place(); this.placeCd = 0.1;
            for (const b of piece.boxes) if (pl.pos.x + 0.36 > b.min.x && pl.pos.x - 0.36 < b.max.x && pl.pos.z + 0.36 > b.min.z && pl.pos.z - 0.36 < b.max.z && pl.pos.y + 1.7 > b.min.y && pl.pos.y < b.max.y) { pl.pos.y = b.max.y; pl.vel.y = Math.max(0, pl.vel.y); }
          } else if (this.placeEdge) { this.sfx.deny(); this.pop('no'); }
        }
        if (pl.pos.y < this.groundY - 24 || pl.pos.y < -62) this.die();
      } else if (this.state === 'dead') { this.deadT -= raw; if (this.deadT <= 0) this.respawn(); }
      else this.winT += raw;

      L.update(dt, this.clock, pl, playing);
      danger = L.doomOn ? Math.max(0, Math.min(1, 1 - (L.doomZ - pl.pos.z) / 32)) : 0;
      if (danger > 0.25 && Math.random() < danger * 0.6) { // debris and embers streaming past from behind
        const a = Math.random() * 6.28, r = 3 + Math.random() * 9;
        this.fx.spark(pl.pos.x + Math.cos(a) * r, pl.pos.y + 1 + Math.sin(a) * r * 0.6 + 2, pl.pos.z + 14, (Math.random() - 0.5) * 3, Math.random() * 3, -24 - Math.random() * 14, 1.2, 0.5 + Math.random() * 0.6, Math.random() < 0.5 ? L.def.theme.doomA : 0x554040, -1);
        if (Math.random() < 0.08) this.fx.chunk(pl.pos.x + (Math.random() - 0.5) * 30, pl.pos.y + 14 + Math.random() * 8, pl.pos.z + 6 - Math.random() * 30, 0.5, 0.5, 0.5, L.def.theme.rock, 0, -4, -6);
      }
      this.trauma = Math.max(danger * danger * 0.3, this.trauma - raw * 1.3);
      this.sfx.intensity = danger; this.sfx.ambience(this.state === 'play' ? 0.15 + danger * 0.85 : 0, Math.min(1, pl.vel.length() / 20));
      this.hud();
    } else if (this.state === 'menu') {
      this.yaw = Math.sin(this.clock * 0.12) * 0.5 + 0.4; this.pitch = -0.22; L.update(raw, this.clock, pl, false); pl.update(raw, { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false }, L.boxes);
    }
    if (this.bannerT > 0) { this.bannerT -= raw; if (this.bannerT <= 0) $('banner').classList.remove('show'); }
    $('danger').style.opacity = String(this.state === 'play' ? danger * 0.9 : 0);

    // --- ghost preview
    this.ghosts.forEach((g, i) => {
      const t = this.tgt; g.visible = this.state === 'play' && i === this.sel && !!t && t.ok;
      if (g.visible && t) { g.position.copy(t.origin); g.position.y += 0.01; g.rotation.y = t.yaw; }
    });
    this.ghostMat.color.set(this.tgt?.afford ? 0x7fe9ff : 0xff4a3a); this.ghostMat.opacity = 0.3 + 0.12 * Math.sin(this.clock * 9);

    // --- camera: chase cam with intro swoop, speed FOV and trauma shake
    this.intro = Math.min(1, this.intro + raw / 2.4);
    const e = 1 - Math.pow(1 - this.intro, 3), menu = this.state === 'menu';
    const yaw = this.yaw + (1 - e) * 2.7 + (this.state === 'win' ? this.winT * 0.5 : 0), pitch = this.pitch - (1 - e) * 0.25;
    const dist = (menu ? 15 : 7.6) + (1 - e) * 16 + (this.state === 'win' ? 3 : 0);
    const follow = this.state !== 'dead';
    const k = Math.min(1, raw * 14);
    this.camT.x += (pl.pos.x - this.camT.x) * k; this.camT.z += (pl.pos.z - this.camT.z) * k;
    if (follow) this.camT.y += (pl.pos.y + 1.5 - this.camT.y) * Math.min(1, raw * 9);
    const cp = Math.cos(pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
    const sh = this.trauma * this.trauma * 0.55, c = this.clock;
    this.cam.position.set(this.camT.x - fx * dist + Math.sin(c * 47) * sh, this.camT.y - fy * dist + Math.sin(c * 53 + 1) * sh, this.camT.z - fz * dist + Math.sin(c * 41 + 2) * sh);
    if (follow) this.cam.lookAt(this.camT.x + fx * 3, this.camT.y + fy * 3 + 0.3, this.camT.z + fz * 3); else this.cam.lookAt(pl.pos.x, pl.pos.y + 1, pl.pos.z);
    this.cam.rotateZ(Math.sin(c * 31) * sh * 0.05);
    const sp = Math.hypot(pl.vel.x, pl.vel.z), want = 66 + Math.min(16, Math.max(0, sp - 6) * 1.3) + danger * 5;
    this.fov += (want - this.fov) * Math.min(1, raw * 5);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }

    this.env.update(raw, this.clock, this.camT, danger);
    this.fx.update(dt); this.sfx.music(raw);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.cam);
    this.jumpEdge = this.dashEdge = this.placeEdge = false;
  }
}

function fmt(t: number) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }
function medal(score: number, par: number) { const g = 1000 + par * 6; return score >= g + 900 ? '🥇' : score >= g + 300 ? '🥈' : '🥉'; }

(window as any).__g = new Game();
