// Grid navigation over the campus polygon: 8-neighbour A* with string pulling, so people
// can cross plazas naturally while avoiding buildings, trees, benches and the fence.

import { pointInRing, ringBBox, distToRing, clamp } from './util.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() {
    this.a = [];
  }

  push(node, pri) {
    const a = this.a;
    a.push([node, pri]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[0];
  }

  get size() {
    return this.a.length;
  }
}

export class NavGrid {
  constructor({ ring, buildings, collision, hf, pathLines = [], cell = 3.5 }) {
    this.ring = ring;
    this.collision = collision;
    this.hf = hf;
    this.cell = cell;
    const bb = ringBBox(ring);
    this.x0 = bb.minX - cell;
    this.z0 = bb.minZ - cell;
    this.cols = Math.ceil((bb.maxX - bb.minX) / cell) + 3;
    this.rows = Math.ceil((bb.maxZ - bb.minZ) / cell) + 3;
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.pref = new Uint8Array(n); // 1 = on a mapped footpath (cheaper)
    const blds = buildings
      .map((b) => ({ ring: b.ring, bb: b.bb || ringBBox(b.ring) }))
      .filter((b) => b.bb.maxX > bb.minX - 6 && b.bb.minX < bb.maxX + 6 && b.bb.maxZ > bb.minZ - 6 && b.bb.minZ < bb.maxZ + 6);
    const nearBuilding = (x, z) => {
      for (const b of blds) {
        if (x < b.bb.minX - 1.4 || x > b.bb.maxX + 1.4 || z < b.bb.minZ - 1.4 || z > b.bb.maxZ + 1.4) continue;
        if (pointInRing(x, z, b.ring) || distToRing(x, z, b.ring) < 1.2) return true;
      }
      return false;
    };
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = this.x0 + i * cell;
        const z = this.z0 + j * cell;
        const idx = j * this.cols + i;
        if (!pointInRing(x, z, ring) || distToRing(x, z, ring) < 1.2) continue;
        if (nearBuilding(x, z)) continue;
        if (collision.resolve(x, z, 0.7).hit) continue;
        if (hf.slope(x, z) > 0.7) continue;
        this.walk[idx] = 1;
      }
    }
    // Mark cells close to mapped footpaths as preferred.
    for (const line of pathLines) {
      for (let k = 0; k + 3 < line.length; k += 2) {
        const ax = line[k];
        const az = line[k + 1];
        const bx = line[k + 2];
        const bz = line[k + 3];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len / 1.5));
        for (let s = 0; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps;
          const z = az + ((bz - az) * s) / steps;
          const i = Math.round((x - this.x0) / cell);
          const j = Math.round((z - this.z0) / cell);
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          this.pref[j * this.cols + i] = 1;
        }
      }
    }
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.walkList = [];
    for (let i = 0; i < n; i++) if (this.walk[i]) this.walkList.push(i);
  }

  pos(idx) {
    return [this.x0 + (idx % this.cols) * this.cell, this.z0 + Math.floor(idx / this.cols) * this.cell];
  }

  // Nearest walkable node to a world position.
  nearest(x, z) {
    const ci = Math.round((x - this.x0) / this.cell);
    const cj = Math.round((z - this.z0) / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r < 12; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const idx = j * this.cols + i;
          if (!this.walk[idx]) continue;
          const [px, pz] = this.pos(idx);
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bd) {
            bd = d;
            best = idx;
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  randomNode(rand) {
    return this.walkList[Math.floor(rand() * this.walkList.length)];
  }

  // Clear straight walk between two points (checked every 0.8 m).
  los(ax, az, bx, bz, r = 0.5) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.8));
    for (let s = 1; s < steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      if (!pointInRing(x, z, this.ring) || this.collision.resolve(x, z, r).hit) return false;
    }
    return true;
  }

  // Path in world coordinates from (sx, sz) to (gx, gz), or null.
  findPath(sx, sz, gx, gz) {
    const s = this.nearest(sx, sz);
    const g = this.nearest(gx, gz);
    if (s < 0 || g < 0) return null;
    this.gen++;
    const gen = this.gen;
    const heap = new MinHeap();
    this.g[s] = 0;
    this.stamp[s] = gen;
    this.from[s] = -1;
    heap.push(s, 0);
    const [tx, tz] = this.pos(g);
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 20000) {
      const u = heap.pop();
      if (this.closed[u] === gen) continue;
      this.closed[u] = gen;
      if (u === g) {
        found = true;
        break;
      }
      const ui = u % this.cols;
      const uj = (u / this.cols) | 0;
      for (const [di, dj, w] of DIRS) {
        const vi = ui + di;
        const vj = uj + dj;
        if (vi < 0 || vj < 0 || vi >= this.cols || vj >= this.rows) continue;
        const v = vj * this.cols + vi;
        if (!this.walk[v]) continue;
        if (di !== 0 && dj !== 0 && (!this.walk[uj * this.cols + vi] || !this.walk[vj * this.cols + ui])) continue;
        let cost = w * this.cell;
        cost *= this.pref[v] && this.pref[u] ? 0.65 : 1;
        const ng = this.g[u] + cost;
        if (this.stamp[v] !== gen || ng < this.g[v]) {
          this.g[v] = ng;
          this.stamp[v] = gen;
          this.from[v] = u;
          const [vx, vz] = this.pos(v);
          heap.push(v, ng + Math.hypot(vx - tx, vz - tz) * 0.9);
        }
      }
    }
    if (!found) return null;
    const nodes = [];
    for (let c = g; c >= 0; c = this.from[c]) nodes.push(c);
    nodes.reverse();
    const raw = nodes.map((i) => this.pos(i));
    // Replace the first/last node by the exact endpoints when reachable.
    raw[0] = [sx, sz];
    raw[raw.length - 1] = [gx, gz];
    return this.smooth(raw);
  }

  // String pulling: skip waypoints while the straight line stays clear.
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let cur = 0;
    while (cur < pts.length - 1) {
      let far = cur + 1;
      for (let j = pts.length - 1; j > cur + 1; j--) {
        if (this.los(pts[cur][0], pts[cur][1], pts[j][0], pts[j][1])) {
          far = j;
          break;
        }
      }
      out.push(pts[far]);
      cur = far;
    }
    return out;
  }
}

void clamp;
