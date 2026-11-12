// Fully procedural WebAudio: no asset downloads.
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode; private noise!: AudioBuffer;
  private rumbleG!: GainNode; private windG!: GainNode; private musicG!: GainNode;
  muted = false; intensity = 0; private step = 0; private nextT = 0; playing = false; root = 45;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (freq: number, type: BiquadFilterType, q: number) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(this.master); s.start(); return g;
    };
    this.rumbleG = loop(90, 'lowpass', 1); this.windG = loop(700, 'bandpass', 0.6);
    this.musicG = c.createGain(); this.musicG.gain.value = 0.5; this.musicG.connect(this.master);
  }
  setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
  ambience(rumble: number, wind: number) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.rumbleG.gain.setTargetAtTime(rumble * 0.9, t, 0.15); this.windG.gain.setTargetAtTime(wind * 0.12, t, 0.2);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, slide = 0, when = 0, dest?: AudioNode) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  private hiss(dur: number, freq: number, vol: number, type: BiquadFilterType = 'bandpass', when = 0, dest?: AudioNode) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest ?? this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  jump(n: number) { this.tone(n ? 520 : 380, 0.16, 'triangle', 0.16, 1.7); }
  land(v: number) { this.tone(110, 0.12, 'sine', Math.min(0.35, 0.08 + v * 0.015), 0.5); this.hiss(0.08, 400, 0.1, 'lowpass'); }
  dash() { this.hiss(0.25, 1800, 0.22); this.tone(300, 0.2, 'sawtooth', 0.05, 2.5); }
  place() { const p = 0.9 + Math.random() * 0.25; this.tone(260 * p, 0.07, 'square', 0.1, 0.6); this.tone(180 * p, 0.1, 'triangle', 0.22, 0.5, 0.06); this.hiss(0.05, 2500, 0.12); }
  deny() { this.tone(140, 0.14, 'sawtooth', 0.09, 0.8); }
  wood() { this.tone(660, 0.09, 'triangle', 0.16); this.tone(990, 0.14, 'triangle', 0.14, 1, 0.07); }
  star() { [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.14, 1, i * 0.06)); }
  checkpoint() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.15, 1, i * 0.09)); }
  crack() { this.hiss(0.5, 300, 0.4, 'lowpass'); this.tone(70, 0.5, 'sawtooth', 0.14, 0.4); }
  hit() { this.tone(160, 0.25, 'square', 0.2, 0.3); this.hiss(0.15, 900, 0.3); }
  boom() { this.hiss(0.9, 180, 0.7, 'lowpass'); this.tone(60, 0.8, 'sine', 0.4, 0.4); }
  fall() { this.tone(500, 0.9, 'sawtooth', 0.1, 0.12); }
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { this.tone(f, 0.6, 'triangle', 0.14, 1, i * 0.11); this.tone(f / 2, 0.6, 'sine', 0.1, 1, i * 0.11); }); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.09, 1, i * 0.18)); }
  ui() { this.tone(700, 0.05, 'triangle', 0.1); }

  /** Simple step sequencer that speeds up as doom closes in */
  music(dt: number) {
    const c = this.ctx; if (!c || !this.playing) return;
    const bpm = 128 + this.intensity * 36, s16 = 60 / bpm / 4;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.12) {
      const s = this.step++, when = this.nextT - c.currentTime, bar = Math.floor(s / 16) % 4, i = s % 16;
      const prog = [0, 0, -4, -2][bar], hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12), r = this.root + prog;
      if (i % 4 === 0) { this.tone(120, 0.14, 'sine', 0.3, 0.35, when, this.musicG); }
      if (i % 4 === 2) this.hiss(0.04, 7000, 0.06 + this.intensity * 0.05, 'highpass', when, this.musicG);
      if (i === 4 || i === 12) this.hiss(0.1, 1600, 0.12, 'bandpass', when, this.musicG);
      if ([0, 3, 6, 8, 11, 14].includes(i)) this.tone(hz(r - 12), s16 * 1.6, 'sawtooth', 0.07, 1, when, this.musicG);
      const arp = [0, 7, 12, 15, 12, 7, 19, 15][s % 8];
      if (i % 2 === 0 || this.intensity > 0.5) this.tone(hz(r + 12 + arp), s16 * 0.9, 'square', 0.025 + this.intensity * 0.02, 1, when, this.musicG);
      this.nextT += s16;
    }
  }
}
