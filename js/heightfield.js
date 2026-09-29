// Terrain height model: regional DEM (bicubic) plus a fine "core" grid around the
// campus where building pads are carved so every building sits on level ground.

import { clamp, smoothstep, pointInRing, distToRing, ringBBox } from './util.js';

export const CORE_HALF = 448; // metres from the campus centre
export const CORE_CELL = 3.2; // metres; 16 (outer cell) is an exact multiple

const cubic = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

export class HeightField {
  constructor(terrain) {
    this.t = terrain;
    this.cols = terrain.cols;
    this.rows = terrain.rows;
    this.dx = (terrain.xMax - terrain.xMin) / (terrain.cols - 1);
    this.dz = (terrain.zMax - terrain.zMin) / (terrain.rows - 1);
    this.grid = Float32Array.from(terrain.heights);
    this.y0 = terrain.elevOrigin;

    this.n = Math.round((2 * CORE_HALF) / CORE_CELL) + 1;
    this.core = new Float32Array(this.n * this.n);
    for (let iz = 0; iz < this.n; iz++) {
      for (let ix = 0; ix < this.n; ix++) {
        this.core[iz * this.n + ix] = this.dem(-CORE_HALF + ix * CORE_CELL, -CORE_HALF + iz * CORE_CELL);
      }
    }
  }

  // Bicubic DEM height relative to the campus centre elevation.
  dem(x, z) {
    const t = this.t;
    let u = (x - t.xMin) / this.dx;
    let v = (z - t.zMin) / this.dz;
    u = clamp(u, 0, this.cols - 1.001);
    v = clamp(v, 0, this.rows - 1.001);
    const j = Math.floor(u);
    const i = Math.floor(v);
    const fu = u - j;
    const fv = v - i;
    const col = [0, 0, 0, 0];
    for (let r = -1; r <= 2; r++) {
      const ii = clamp(i + r, 0, this.rows - 1) * this.cols;
      const p = (c) => this.grid[ii + clamp(j + c, 0, this.cols - 1)];
      col[r + 1] = cubic(p(-1), p(0), p(1), p(2), fu);
    }
    return cubic(col[0], col[1], col[2], col[3], fv) - this.y0;
  }

  inCore(x, z, margin = 0) {
    return Math.abs(x) <= CORE_HALF - margin && Math.abs(z) <= CORE_HALF - margin;
  }

  // Final ground height (includes building pads inside the core).
  h(x, z) {
    if (!this.inCore(x, z, CORE_CELL)) return this.dem(x, z);
    const fx = (x + CORE_HALF) / CORE_CELL;
    const fz = (z + CORE_HALF) / CORE_CELL;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const n = this.n;
    const a = this.core[iz * n + ix];
    const b = this.core[iz * n + ix + 1];
    const c = this.core[(iz + 1) * n + ix];
    const d = this.core[(iz + 1) * n + ix + 1];
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
  }

  // Terrain slope magnitude (rise / run) near a point.
  slope(x, z) {
    const e = 1.5;
    const gx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
    const gz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  // Hillside model: terrain stays natural outside buildings; inside a footprint it is cut
  // down to the building's main floor level. b.base = main floor elevation, b.groundMin /
  // b.groundMax = lowest / highest natural ground along the walls (the difference is the
  // exposed podium on the downhill side).
  carveBuildingPads(buildings) {
    const n = this.n;
    for (const b of buildings) {
      const ring = b.ring;
      const nv = ring.length / 2;
      const samples = [];
      for (let i = 0; i < nv; i++) {
        const ax = ring[i * 2];
        const az = ring[i * 2 + 1];
        const bx = ring[((i + 1) % nv) * 2];
        const bz = ring[((i + 1) % nv) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.round(len / 6));
        for (let k = 0; k < steps; k++) samples.push(this.dem(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps));
      }
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const v of samples) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      b.groundMin = min;
      b.groundMax = max;
      b.base = b.baseOverride !== undefined ? b.baseOverride : sum / samples.length;
      const bb = ringBBox(ring);
      const ix0 = Math.max(0, Math.floor((bb.minX + CORE_HALF) / CORE_CELL));
      const ix1 = Math.min(n - 1, Math.ceil((bb.maxX + CORE_HALF) / CORE_CELL));
      const iz0 = Math.max(0, Math.floor((bb.minZ + CORE_HALF) / CORE_CELL));
      const iz1 = Math.min(n - 1, Math.ceil((bb.maxZ + CORE_HALF) / CORE_CELL));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = -CORE_HALF + iz * CORE_CELL;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -CORE_HALF + ix * CORE_CELL;
          if (!pointInRing(x, z, ring)) continue;
          if (distToRing(x, z, ring) < 0.9) continue;
          const idx = iz * n + ix;
          if (this.core[idx] > b.base - 0.06) this.core[idx] = b.base - 0.06;
        }
      }
    }
  }

  // Level the ground to y inside radius r, blending back to the surrounding ground over `blend`.
  padCircle(x, z, r, blend, y) {
    const n = this.n;
    const reach = r + blend;
    const ix0 = Math.max(0, Math.floor((x - reach + CORE_HALF) / CORE_CELL));
    const ix1 = Math.min(n - 1, Math.ceil((x + reach + CORE_HALF) / CORE_CELL));
    const iz0 = Math.max(0, Math.floor((z - reach + CORE_HALF) / CORE_CELL));
    const iz1 = Math.min(n - 1, Math.ceil((z + reach + CORE_HALF) / CORE_CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const vx = -CORE_HALF + ix * CORE_CELL;
        const vz = -CORE_HALF + iz * CORE_CELL;
        const d = Math.hypot(vx - x, vz - z);
        if (d >= reach) continue;
        const w = d <= r ? 1 : 1 - smoothstep(0, blend, d - r);
        const idx = iz * n + ix;
        this.core[idx] = this.core[idx] * (1 - w) + y * w;
      }
    }
  }
}
