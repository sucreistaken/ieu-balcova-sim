// 2D collision against wall segments and circular obstacles, using a uniform grid hash.

const CELL = 16;

export class Collision {
  constructor() {
    this.cells = new Map();
    this.segments = [];
    this.circles = [];
  }

  _key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }

  _cellList(ix, iz, create) {
    const k = this._key(ix, iz);
    let l = this.cells.get(k);
    if (!l && create) {
      l = [];
      this.cells.set(k, l);
    }
    return l;
  }

  addSegment(s) {
    const i = this.segments.length;
    this.segments.push(s);
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL);
    const x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELL);
    const z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) this._cellList(ix, iz, true).push(i);
  }

  addCircle(c) {
    const i = -1 - this.circles.length;
    this.circles.push(c);
    const ix = Math.floor(c.x / CELL);
    const iz = Math.floor(c.z / CELL);
    this._cellList(ix, iz, true).push(i);
  }

  // Push a circle (x, z, r) out of everything nearby. Returns { x, z, hit }.
  resolve(x, z, r) {
    let hit = false;
    for (let pass = 0; pass < 3; pass++) {
      const ix0 = Math.floor((x - r) / CELL);
      const ix1 = Math.floor((x + r) / CELL);
      const iz0 = Math.floor((z - r) / CELL);
      const iz1 = Math.floor((z + r) / CELL);
      let moved = false;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const list = this._cellList(ix, iz, false);
          if (!list) continue;
          for (const i of list) {
            if (i >= 0) {
              const s = this.segments[i];
              const dx = s.bx - s.ax;
              const dz = s.bz - s.az;
              const l2 = dx * dx + dz * dz;
              let t = l2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const qx = s.ax + dx * t;
              const qz = s.az + dz * t;
              const ox = x - qx;
              const oz = z - qz;
              const d2 = ox * ox + oz * oz;
              if (d2 < r * r) {
                const d = Math.sqrt(d2);
                if (d > 1e-5) {
                  x = qx + (ox / d) * r;
                  z = qz + (oz / d) * r;
                } else {
                  // Exactly on the wall: push along the segment normal.
                  const l = Math.sqrt(l2) || 1;
                  x += (dz / l) * r;
                  z += (-dx / l) * r;
                }
                moved = true;
                hit = true;
              }
            } else {
              const c = this.circles[-1 - i];
              const ox = x - c.x;
              const oz = z - c.z;
              const rr = r + c.r;
              const d2 = ox * ox + oz * oz;
              if (d2 < rr * rr) {
                const d = Math.sqrt(d2) || 1e-4;
                x = c.x + (ox / d) * rr;
                z = c.z + (oz / d) * rr;
                moved = true;
                hit = true;
              }
            }
          }
        }
      }
      if (!moved) break;
    }
    return { x, z, hit };
  }
}
