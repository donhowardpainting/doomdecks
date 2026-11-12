import * as THREE from 'three';
import type { Box } from './level';

export interface Input { mx: number; mz: number; jump: boolean; jumpHeld: boolean; dash: boolean }
const HW = 0.36, H = 1.7, STEP = 0.56;
export const SPEED = 9.6;

export class Player {
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); grounded = false; ground: Box | null = null;
  coyote = 0; buffer = 0; jumps = 0; dashT = 0; dashCd = 0; airDash = false; stun = 0; facing = 0; landed = 0; jumped = -1; dashed = false;
  model = new THREE.Group(); private body: THREE.Group; private legs: THREE.Mesh[] = []; private arms: THREE.Mesh[] = [];
  private ph = 0; private squash = 0; private visY = 0; private dashDir = new THREE.Vector3();

  constructor() {
    const m = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
    const b = (this.body = new THREE.Group()); this.model.add(b);
    add(new THREE.CapsuleGeometry(0.3, 0.42, 4, 10), m(0xf07a28), b, 0, 0.98, 0);                 // hi-vis vest
    add(new THREE.BoxGeometry(0.64, 0.1, 0.5), m(0xfff07a, { emissive: 0xfff07a, emissiveIntensity: 0.4 }), b, 0, 0.95, 0); // reflective band
    add(new THREE.SphereGeometry(0.23, 12, 10), m(0xf2c9a0), b, 0, 1.52, 0);                      // head
    add(new THREE.SphereGeometry(0.27, 12, 8, 0, 6.3, 0, 1.45), m(0xffd21f, { roughness: 0.35 }), b, 0, 1.56, 0); // hard hat
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), m(0xffd21f, { roughness: 0.35 }), b, 0, 1.56, -0.1);
    add(new THREE.BoxGeometry(0.42, 0.5, 0.2), m(0x8a5a33), b, 0, 1.05, 0.33);                    // lumber pack
    add(new THREE.BoxGeometry(0.12, 0.12, 0.9), m(0xd9a868), b, 0, 1.33, 0.36).rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) {
      const leg = add(new THREE.BoxGeometry(0.2, 0.55, 0.22).translate(0, -0.27, 0), m(0x2f4a7a), b, s * 0.16, 0.6, 0); this.legs.push(leg);
      add(new THREE.BoxGeometry(0.22, 0.12, 0.32), m(0x3a2a20), leg, 0, -0.55, -0.05);
      const arm = add(new THREE.BoxGeometry(0.15, 0.5, 0.15).translate(0, -0.22, 0), m(0xf07a28), b, s * 0.4, 1.22, 0); this.arms.push(arm);
    }
  }

  reset(x: number, y: number, z: number) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.grounded = false; this.ground = null; this.stun = 0; this.dashT = 0; this.jumps = 0; this.visY = y; this.buffer = 0; }

  private hits(b: Box) {
    const p = this.pos;
    return b.on && p.x + HW > b.min.x && p.x - HW < b.max.x && p.z + HW > b.min.z && p.z - HW < b.max.z && p.y + H > b.min.y && p.y < b.max.y;
  }
  private moveAxis(ax: 'x' | 'z', d: number, boxes: Box[]) {
    const p = this.pos; p[ax] += d;
    for (const b of boxes) {
      if (!this.hits(b)) continue;
      const up = b.max.y - p.y;
      if (up <= STEP && this.vel.y <= 4) { p.y = b.max.y; if (this.vel.y < 0) this.vel.y = 0; continue; } // step / mantle up
      p[ax] = d > 0 ? b.min[ax] - HW - 1e-4 : b.max[ax] + HW + 1e-4; this.vel[ax] = 0;
    }
  }

  update(dt: number, inp: Input, boxes: Box[]) {
    const v = this.vel, p = this.pos;
    this.landed = 0; this.jumped = -1; this.dashed = false;
    this.stun -= dt; this.dashCd -= dt; this.buffer -= dt; this.coyote -= dt;
    if (inp.jump) this.buffer = 0.13;
    // carried by / pushed out of moving platforms
    if (this.grounded && this.ground?.vel) { p.x += this.ground.vel.x * dt; p.z += this.ground.vel.z * dt; }
    for (const b of boxes) if (b.vel && this.hits(b)) {
      if (b.max.y - p.y < 1.7) { p.y = b.max.y; if (this.vel.y < 0) this.vel.y = 0; } else { const s = Math.sign(b.vel.z) || 1; p.z = s > 0 ? b.max.z + HW + 0.01 : b.min.z - HW - 0.01; }
    }
    const moving = inp.mx !== 0 || inp.mz !== 0;
    if (this.dashT > 0) {
      this.dashT -= dt; v.x = this.dashDir.x * 23; v.z = this.dashDir.z * 23; v.y = 0;
      if (this.dashT <= 0) { v.x *= 0.5; v.z *= 0.5; }
    } else {
      if (this.stun <= 0) {
        const acc = (this.grounded ? 75 : 34) * dt, tx = inp.mx * SPEED, tz = inp.mz * SPEED, dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz);
        const a = moving ? acc : this.grounded ? acc * 1.2 : acc * 0.25;
        if (l <= a) { v.x = tx; v.z = tz; } else { v.x += (dx / l) * a; v.z += (dz / l) * a; }
      }
      const g = v.y > 0 ? (inp.jumpHeld ? 27 : 60) : 38;
      v.y = Math.max(-45, v.y - g * dt);
      if (this.buffer > 0 && this.stun <= 0) {
        if (this.grounded || this.coyote > 0) { v.y = 11.6; this.jumps = 1; this.buffer = 0; this.coyote = 0; this.grounded = false; this.jumped = 0; this.squash = -0.3; }
        else if (this.jumps < 2) { v.y = 10.6; this.jumps = 2; this.buffer = 0; this.jumped = 1; this.squash = -0.3; }
      }
      if (inp.dash && this.dashCd <= 0 && this.stun <= 0 && (this.grounded || !this.airDash)) {
        if (moving) this.dashDir.set(inp.mx, 0, inp.mz); else this.dashDir.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
        this.dashT = 0.16; this.dashCd = 0.75; this.airDash = !this.grounded; this.dashed = true;
      }
    }
    // integrate with sub-steps so nothing tunnels
    const n = Math.max(1, Math.ceil(dt / 0.009)), h = dt / n;
    let wasGround = this.grounded, hitGround = false; const vy0 = v.y;
    for (let i = 0; i < n; i++) {
      this.moveAxis('x', v.x * h, boxes); this.moveAxis('z', v.z * h, boxes);
      p.y += v.y * h; hitGround = false;
      for (const b of boxes) {
        if (!this.hits(b)) continue;
        if (v.y <= 0) { p.y = b.max.y; v.y = 0; hitGround = true; this.ground = b; } else { p.y = b.min.y - H; v.y = 0; }
      }
      if (!hitGround && v.y <= 0) { // ground probe keeps us glued on steps / ramps
        p.y -= 0.3; let g: Box | null = null;
        for (const b of boxes) if (this.hits(b) && b.max.y - p.y <= 0.31) { if (!g || b.max.y > g.max.y) g = b; }
        if (g && wasGround) { p.y = g.max.y; hitGround = true; this.ground = g; v.y = 0; } else p.y += 0.3;
      }
      if (hitGround) wasGround = true;
    }
    if (hitGround) {
      if (!this.grounded) { this.landed = -vy0; this.squash = Math.min(0.35, -vy0 * 0.02); }
      this.grounded = true; this.coyote = 0.11; this.jumps = 0; this.airDash = false;
    } else { if (this.grounded && this.jumps === 0) this.jumps = 1; this.grounded = false; this.ground = null; }

    // presentation
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.5) { let d = Math.atan2(-v.x, -v.z) - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d)); this.facing += d * Math.min(1, dt * 16); }
    this.visY += (p.y - this.visY) * Math.min(1, dt * 30); if (Math.abs(p.y - this.visY) > 1.5 || !this.grounded) this.visY = p.y;
    this.model.position.set(p.x, this.visY, p.z); this.model.rotation.y = this.facing;
    this.squash += (0 - this.squash) * Math.min(1, dt * 10);
    const sq = 1 - this.squash; this.body.scale.set(1 + this.squash * 0.6, sq, 1 + this.squash * 0.6);
    this.ph += sp * dt * 1.5;
    const sw = this.grounded ? Math.sin(this.ph) * Math.min(1, sp / 6) * 0.95 : 0.5;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = this.grounded ? -sw : -0.7;
    this.arms[0].rotation.x = this.grounded ? -sw : -2.6; this.arms[1].rotation.x = this.grounded ? sw : -2.6;
    this.body.rotation.x = this.dashT > 0 ? -0.6 : -Math.min(0.22, sp * 0.02) + (this.grounded ? 0 : Math.max(-0.3, Math.min(0.3, -v.y * 0.015)));
    this.body.position.y = this.grounded ? Math.abs(Math.sin(this.ph)) * 0.06 * Math.min(1, sp / 6) : 0;
  }
}
