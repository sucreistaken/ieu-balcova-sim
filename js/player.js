// First-person controller: walk / run / jump with terrain following and wall collision,
// plus a free-fly mode. Pointer lock look, with a drag-to-look fallback.

import * as THREE from 'three';
import { clamp } from './util.js';

const EYE = 1.68;
const RADIUS = 0.38;

export class Player {
  constructor(camera, dom, hf, collision, opts = {}) {
    this.camera = camera;
    this.dom = dom;
    this.hf = hf;
    this.collision = collision;
    this.bound = opts.bound || 430;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; // 0 faces north (-z)
    this.pitch = 0;
    this.onGround = true;
    this.fly = false;
    this.enabled = false;
    this.speedScale = 1;
    this.sensitivity = 0.0022;
    this.bobPhase = 0;
    this.keys = new Set();
    this.locked = false;
    this.dragging = false;
    this.moved = 0;
    this.interior = null; // set by the interior system
    this.onEdge = null;
    this.boundary = null; // campus boundary clamp (js/boundary.js)
    this.groundFn = null; // interior floors override the terrain height
    this.interiorCollision = null; // partitions of the building the player is in
    this._forward = new THREE.Vector3();
    this._bounded = false;

    this._bind();
    this.snapToGround();
  }

  _bind() {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.enabled && !this.fly && this.onGround) {
        this.vel.y = 4.6;
        this.onGround = false;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.enabled) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.look(e.movementX, e.movementY);
      else if (this.dragging && this.enabled) this.look(e.movementX * 1.2, e.movementY * 1.2);
    });
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.enabled && !this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
  }

  look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -1.5, 1.5);
  }

  requestLock() {
    if (this.dom.requestPointerLock) {
      try {
        const p = this.dom.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {
        /* pointer lock may be unavailable (automation, iframes); drag-look still works */
      }
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  groundAt(x, z) {
    return this.groundFn ? this.groundFn(x, z) : this.hf.h(x, z);
  }

  snapToGround() {
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
  }

  teleport(x, z, yaw) {
    this.pos.set(x, this.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.onGround = true;
  }

  get running() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Yaw 0 faces -z. Forward = (-sin, -cos), right = (cos, -sin).
    let dx = -sin * fz + cos * fx;
    let dz = -cos * fz - sin * fx;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }

    if (this.fly) {
      const speed = (this.running ? 70 : 24) * this.speedScale;
      const cp = Math.cos(this.pitch);
      this._forward.set(-sin * cp, Math.sin(this.pitch), -cos * cp);
      const fwd = fz;
      const move = new THREE.Vector3(cos * fx, 0, -sin * fx).addScaledVector(this._forward, fwd);
      if (k.has('Space')) move.y += 1;
      if (k.has('ControlLeft') || k.has('KeyC')) move.y -= 1;
      if (move.lengthSq() > 0) move.normalize();
      this.vel.lerp(move.multiplyScalar(speed), Math.min(1, dt * 6));
      this.pos.addScaledVector(this.vel, dt);
      const fd = Math.hypot(this.pos.x, this.pos.z);
      if (fd > 460) {
        this.pos.x *= 460 / fd;
        this.pos.z *= 460 / fd;
      }
      const ground = this.hf.h(this.pos.x, this.pos.z);
      if (this.pos.y < ground + 0.4) this.pos.y = ground + 0.4;
    } else {
      const speed = (this.running ? 7.0 : 3.4) * this.speedScale;
      const tx = dx * speed;
      const tz = dz * speed;
      const a = Math.min(1, dt * (this.onGround ? 11 : 2.5));
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
      const ox = this.pos.x;
      const oz = this.pos.z;
      let nx = ox + this.vel.x * dt;
      let nz = oz + this.vel.z * dt;
      let r = this.collision.resolve(nx, nz, RADIUS);
      if (this.interiorCollision) r = this.interiorCollision.resolve(r.x, r.z, RADIUS);
      nx = r.x;
      nz = r.z;
      // Refuse to climb near-vertical embankments.
      if (this.onGround && this.groundAt(nx, nz) - this.pos.y > 0.9 + Math.hypot(nx - ox, nz - oz)) {
        nx = ox;
        nz = oz;
        this.vel.x = this.vel.z = 0;
      }
      // Campus boundary (polygon) first, then a generous radial safety limit.
      if (this.boundary) {
        const q = { x: nx, z: nz };
        if (this.boundary.clamp(q)) {
          nx = q.x;
          nz = q.z;
          if (!this._bounded && this.onEdge) this.onEdge();
          this._bounded = true;
        } else this._bounded = false;
      }
      const d = Math.hypot(nx, nz);
      if (d > this.bound) {
        nx *= this.bound / d;
        nz *= this.bound / d;
      }
      this.pos.x = nx;
      this.pos.z = nz;
      this.moved += Math.hypot(nx - ox, nz - oz);

      const ground = this.groundAt(nx, nz);
      this.vel.y -= 19 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.pos.y - ground > 0.35) {
        this.onGround = false;
      } else if (this.vel.y <= 0) {
        // Stick to slopes when descending.
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      }
    }

    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && !this.fly) this.bobPhase += speedNow * dt * 2.1;
    const bob = this.fly ? 0 : Math.sin(this.bobPhase) * 0.035 * Math.min(1, speedNow / 3);
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bob, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    const targetFov = 70 + (this.running && speedNow > 4 ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }
}
