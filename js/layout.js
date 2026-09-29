// Procedural floor-plan layout for a building footprint (no rendering code).
//
// The footprint is rasterised in a frame aligned with its dominant wall direction. Corridors,
// stair cores and rooms are zones on that grid; partitions are the boundaries between zones;
// doors are opened so that every zone is reachable. The same layout is reused on every floor.
//
// Coordinates: world (x, z) metres. Oriented frame: pu along u = (cos t, sin t), pv along
// v = (-sin t, cos t). Grid cell (i, j) covers pu in [ou + i*cell, ou + (i+1)*cell].

import { pointInRing, distToRing } from './util.js';

export const CELL = 0.5;
const WALL_CLEAR = 0.38; // cell centres must be this far from the outer walls
const CORR_W = 2.6;
const ROOM_DEPTH = 6.8;

const rngFrom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export function generateLayout(b, exteriorDoors, opts = {}) {
  const ring = b.ring;
  const holes = b.holes || [];
  const roomWidth = opts.roomWidth || 7.5;
  const rand = rngFrom(b.id >>> 0);

  // ----------------------------------------------------------- frame
  let cx = 0;
  let cz = 0;
  const nv = ring.length / 2;
  for (let i = 0; i < nv; i++) {
    const j = (i + 1) % nv;
    const dx = ring[j * 2] - ring[i * 2];
    const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    cx += len * Math.cos(4 * a);
    cz += len * Math.sin(4 * a);
  }
  const theta = Math.atan2(cz, cx) / 4;
  const ux = Math.cos(theta);
  const uz = Math.sin(theta);
  const vx = -uz;
  const vz = ux;
  const toU = (x, z) => x * ux + z * uz;
  const toV = (x, z) => x * vx + z * vz;
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < nv; i++) {
    const pu = toU(ring[i * 2], ring[i * 2 + 1]);
    const pv = toV(ring[i * 2], ring[i * 2 + 1]);
    uMin = Math.min(uMin, pu);
    uMax = Math.max(uMax, pu);
    vMin = Math.min(vMin, pv);
    vMax = Math.max(vMax, pv);
  }
  const ou = uMin - 1;
  const ov = vMin - 1;
  const W = Math.ceil((uMax - uMin + 2) / CELL) + 1;
  const H = Math.ceil((vMax - vMin + 2) / CELL) + 1;
  const toWorld = (pu, pv) => [pu * ux + pv * vx, pu * uz + pv * vz];
  const cellCenter = (i, j) => toWorld(ou + (i + 0.5) * CELL, ov + (j + 0.5) * CELL);

  // ------------------------------------------------------ inside mask
  const inside = new Uint8Array(W * H);
  let insideCount = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const [x, z] = cellCenter(i, j);
      if (!pointInRing(x, z, ring)) continue;
      let inHole = false;
      for (const h of holes) if (pointInRing(x, z, h)) inHole = true;
      if (inHole) continue;
      if (distToRing(x, z, ring) < WALL_CLEAR) continue;
      let ok = true;
      for (const h of holes) if (distToRing(x, z, h) < WALL_CLEAR) ok = false;
      if (!ok) continue;
      inside[j * W + i] = 1;
      insideCount++;
    }
  }

  const zone = new Int32Array(W * H); // 0 = outside
  const ZONE_CORR = 1;
  const isInside = (i, j) => i >= 0 && j >= 0 && i < W && j < H && inside[j * W + i] === 1;

  // ---------------------------------------------------------- corridors
  const smallWidth = !!opts.forceOpen || vMax - vMin < 9.5 || b.area < 350;
  const corr = new Uint8Array(W * H);
  let vc = 0;
  let cnt = 0;
  let ucSum = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!inside[j * W + i]) continue;
      vc += ov + (j + 0.5) * CELL;
      ucSum += ou + (i + 0.5) * CELL;
      cnt++;
    }
  }
  vc /= cnt || 1;
  const uc = ucSum / (cnt || 1);
  const S = 2 * ROOM_DEPTH + CORR_W;
  const parallel = Math.max(1, Math.round((vMax - vMin) / S));
  const lobbyCircles = [];
  if (!opts.forceOpen) {
    for (const d of exteriorDoors) {
      // Lobby centre 1.6 m inside the door.
      lobbyCircles.push({ x: d.x - d.nx * 1.6, z: d.z - d.nz * 1.6, r: 3.6 });
    }
  }
  if (!smallWidth) {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!inside[j * W + i]) continue;
        const pu = ou + (i + 0.5) * CELL;
        const pv = ov + (j + 0.5) * CELL;
        let d = (pv - vc) % S;
        if (d > S / 2) d -= S;
        if (d < -S / 2) d += S;
        let on = Math.abs(d) < CORR_W / 2;
        if (!on && parallel >= 2 && Math.abs(((pu - uc) % 34) > 17 ? ((pu - uc) % 34) - 34 : ((pu - uc) % 34)) < CORR_W / 2) on = true;
        if (on) corr[j * W + i] = 1;
      }
    }
  }
  // Lobbies: open floor around every entrance.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!inside[j * W + i]) continue;
      const [x, z] = cellCenter(i, j);
      for (const c of lobbyCircles) {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) {
          corr[j * W + i] = 1;
          break;
        }
      }
    }
  }
  for (let k = 0; k < W * H; k++) if (corr[k] && inside[k]) zone[k] = ZONE_CORR;
  const lobbyMask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!inside[j * W + i]) continue;
      const [x, z] = cellCenter(i, j);
      for (const c of lobbyCircles) {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) lobbyMask[j * W + i] = 1;
      }
    }
  }

  // -------------------------------------------------------------- cores
  const cores = [];
  const wantCores = insideCount * CELL * CELL > 3500 ? 3 : insideCount * CELL * CELL > 1000 ? 2 : 1;
  if (!smallWidth) {
    const coreV = Math.round(3.6 / CELL);
    const coreU = Math.round(5.2 / CELL);
    const cands = [];
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        if (zone[j * W + i] !== ZONE_CORR || lobbyMask[j * W + i]) continue;
        for (const s of [1, -1]) {
          // Try a core rectangle adjacent to this corridor cell on side s (in v).
          const j0 = s > 0 ? j + Math.round(CORR_W / 2 / CELL) + 1 : j - Math.round(CORR_W / 2 / CELL) - coreV;
          const i0 = i - (coreU >> 1);
          let ok = true;
          for (let jj = j0; jj < j0 + coreV && ok; jj++) {
            for (let ii = i0; ii < i0 + coreU; ii++) {
              if (!isInside(ii, jj) || zone[jj * W + ii] !== 0) {
                ok = false;
                break;
              }
            }
          }
          if (!ok) continue;
          // The corridor must actually touch the core's long side.
          let touch = 0;
          const jb = s > 0 ? j0 - 1 : j0 + coreV;
          for (let ii = i0; ii < i0 + coreU; ii++) if (zone[jb * W + ii] === ZONE_CORR) touch++;
          if (touch < coreU * 0.8) continue;
          cands.push({ i0, j0, score: Math.abs(ou + (i + 0.5) * CELL - uc) + rand() * 2, pu: ou + (i0 + coreU / 2) * CELL, pv: ov + (j0 + coreV / 2) * CELL, s });
        }
      }
    }
    cands.sort((a, c) => c.score - a.score);
    for (const c of cands) {
      if (cores.length >= wantCores) break;
      if (cores.some((q) => Math.hypot(q.pu - c.pu, q.pv - c.pv) < 26)) continue;
      const id = 2 + cores.length;
      for (let jj = c.j0; jj < c.j0 + coreV; jj++) for (let ii = c.i0; ii < c.i0 + coreU; ii++) zone[jj * W + ii] = id;
      cores.push({ id, ...c, w: coreU, h: coreV });
    }
    // Fallback: no valid candidate, still create one core from the first free block corner.
  }

  // -------------------------------------------------------------- rooms
  let nextId = 10;
  const blockOf = new Int32Array(W * H).fill(-1);
  const blocks = [];
  const stack = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!inside[k] || zone[k] !== 0 || blockOf[k] >= 0) continue;
      const id = blocks.length;
      const cells = [];
      stack.push(k);
      blockOf[k] = id;
      while (stack.length) {
        const q = stack.pop();
        cells.push(q);
        const qi = q % W;
        const qj = (q / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = qi + di;
          const nj = qj + dj;
          if (!isInside(ni, nj)) continue;
          const nk = nj * W + ni;
          if (zone[nk] !== 0 || blockOf[nk] >= 0) continue;
          blockOf[nk] = id;
          stack.push(nk);
        }
      }
      blocks.push(cells);
    }
  }
  const roomCellSize = Math.max(6, Math.round(roomWidth / CELL));
  for (const cells of blocks) {
    let i0 = Infinity;
    let i1 = -Infinity;
    let j0 = Infinity;
    let j1 = -Infinity;
    for (const k of cells) {
      const i = k % W;
      const j = (k / W) | 0;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
    }
    const alongU = i1 - i0 >= j1 - j0;
    const len = (alongU ? i1 - i0 : j1 - j0) + 1;
    const n = Math.max(1, Math.round(len / roomCellSize));
    const slices = new Map();
    for (const k of cells) {
      const i = k % W;
      const j = (k / W) | 0;
      const s = Math.min(n - 1, Math.floor(((alongU ? i - i0 : j - j0) * n) / len));
      let arr = slices.get(s);
      if (!arr) slices.set(s, (arr = []));
      arr.push(k);
    }
    // Connected components within each slice become rooms.
    for (const [, arr] of slices) {
      const inSlice = new Set(arr);
      const seen = new Set();
      for (const start of arr) {
        if (seen.has(start)) continue;
        const id = nextId++;
        const st = [start];
        seen.add(start);
        while (st.length) {
          const q = st.pop();
          zone[q] = id;
          const qi = q % W;
          const qj = (q / W) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = qi + di;
            const nj = qj + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const nk = nj * W + ni;
            if (inSlice.has(nk) && !seen.has(nk)) {
              seen.add(nk);
              st.push(nk);
            }
          }
        }
      }
    }
  }

  const zoneStats = () => {
    const stats = new Map();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const z = zone[j * W + i];
        if (z < 10) continue;
        let s = stats.get(z);
        if (!s) stats.set(z, (s = { id: z, count: 0, i0: Infinity, i1: -Infinity, j0: Infinity, j1: -Infinity, sx: 0, sz: 0 }));
        s.count++;
        s.i0 = Math.min(s.i0, i);
        s.i1 = Math.max(s.i1, i);
        s.j0 = Math.min(s.j0, j);
        s.j1 = Math.max(s.j1, j);
        s.sx += i;
        s.sz += j;
      }
    }
    return stats;
  };

  // Merge very small rooms into their best neighbour.
  {
    const stats = zoneStats();
    for (const s of stats.values()) {
      if (s.count >= 24) continue;
      const share = new Map();
      for (let j = s.j0; j <= s.j1; j++) {
        for (let i = s.i0; i <= s.i1; i++) {
          if (zone[j * W + i] !== s.id) continue;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = (j + dj) * W + (i + di);
            if (i + di < 0 || j + dj < 0 || i + di >= W || j + dj >= H) continue;
            const z = zone[nk];
            if (z > 0 && z !== s.id) share.set(z, (share.get(z) || 0) + 1);
          }
        }
      }
      let best = 0;
      let bc = 0;
      for (const [z, c] of share) {
        if (z >= 2 && z !== 0 && c > bc && !(z >= 2 && z < 10)) {
          best = z;
          bc = c;
        }
      }
      if (!best && share.has(ZONE_CORR)) best = ZONE_CORR;
      if (best) {
        for (let j = s.j0; j <= s.j1; j++) for (let i = s.i0; i <= s.i1; i++) if (zone[j * W + i] === s.id) zone[j * W + i] = best;
      }
    }
  }

  // Optional merges (open areas such as the library).
  const merged = [];
  if (opts.merge && opts.merge.length) {
    const stats = zoneStats();
    for (const m of opts.merge) {
      const ids = [];
      for (const s of stats.values()) {
        const [x, z] = cellCenter(s.sx / s.count, s.sz / s.count);
        if (Math.hypot(x - m.x, z - m.z) < m.r) ids.push(s.id);
      }
      if (ids.length > 1) {
        const target = ids[0];
        for (let k = 0; k < zone.length; k++) if (ids.includes(zone[k])) zone[k] = target;
        merged.push({ id: target, type: m.type });
      } else if (ids.length === 1) merged.push({ id: ids[0], type: m.type });
    }
  }

  // -------------------------------------------------- boundaries and doors
  const open = new Set(); // keys "H,i,j" / "V,i,j" of opened wall edges
  const edgeKey = (axis, i, j) => `${axis},${i},${j}`;
  // Collect boundary edges per unordered zone pair.
  const pairEdges = new Map();
  const zAt = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : zone[j * W + i]);
  const pushEdge = (a, c, e) => {
    const key = a < c ? `${a}|${c}` : `${c}|${a}`;
    let arr = pairEdges.get(key);
    if (!arr) pairEdges.set(key, (arr = []));
    arr.push(e);
  };
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i <= W; i++) {
      const here = zAt(i, j);
      const up = zAt(i, j - 1);
      const left = zAt(i - 1, j);
      if (i < W && here !== up && here > 0 && up > 0) pushEdge(here, up, { axis: 'H', i, j });
      if (j < H && here !== left && here > 0 && left > 0) pushEdge(here, left, { axis: 'V', i, j });
    }
  }
  const openDoor = (edges) => {
    // Pick the middle of the longest straight run and open two edges (1.0 m).
    const runs = new Map();
    for (const e of edges) {
      const k = e.axis === 'H' ? `H${e.j}` : `V${e.i}`;
      let arr = runs.get(k);
      if (!arr) runs.set(k, (arr = []));
      arr.push(e);
    }
    let best = null;
    for (const arr of runs.values()) {
      arr.sort((p, q) => (p.axis === 'H' ? p.i - q.i : p.j - q.j));
      // Split into contiguous pieces.
      let piece = [arr[0]];
      const flush = () => {
        if (!best || piece.length > best.length) best = piece.slice();
      };
      for (let k = 1; k < arr.length; k++) {
        const prev = arr[k - 1];
        const cur = arr[k];
        const contiguous = cur.axis === 'H' ? cur.i === prev.i + 1 : cur.j === prev.j + 1;
        if (contiguous) piece.push(cur);
        else {
          flush();
          piece = [cur];
        }
      }
      flush();
    }
    if (!best || best.length < 3) return null;
    const mid = Math.floor(best.length / 2);
    const a = best[mid - 1];
    const c = best[mid];
    open.add(edgeKey(a.axis, a.i, a.j));
    open.add(edgeKey(c.axis, c.i, c.j));
    return { axis: a.axis, i: a.i, j: a.j, i2: c.i, j2: c.j };
  };
  const doorList = []; // { axis, i, j, i2, j2, a, b }
  const reached = new Set([ZONE_CORR]);
  const zoneIds = new Set();
  for (let k = 0; k < zone.length; k++) if (zone[k] > 0) zoneIds.add(zone[k]);
  // First pass: every zone that borders the corridor gets a door to it.
  for (const z of zoneIds) {
    if (z === ZONE_CORR) continue;
    const key = z < ZONE_CORR ? `${z}|${ZONE_CORR}` : `${ZONE_CORR}|${z}`;
    const edges = pairEdges.get(key);
    if (!edges) continue;
    const d = openDoor(edges);
    if (d) {
      d.a = z;
      d.b = ZONE_CORR;
      doorList.push(d);
      reached.add(z);
    }
  }
  // Second pass: connect the rest through reachable neighbours.
  let progress = true;
  while (progress) {
    progress = false;
    for (const z of zoneIds) {
      if (reached.has(z)) continue;
      let bestKey = null;
      let bestLen = 0;
      for (const [key, edges] of pairEdges) {
        const [a, c] = key.split('|').map(Number);
        const other = a === z ? c : c === z ? a : -1;
        if (other < 0 || !reached.has(other)) continue;
        if (edges.length > bestLen) {
          bestLen = edges.length;
          bestKey = key;
        }
      }
      if (!bestKey) continue;
      const d = openDoor(pairEdges.get(bestKey));
      if (d) {
        const [a, c] = bestKey.split('|').map(Number);
        d.a = z;
        d.b = a === z ? c : a;
        doorList.push(d);
        reached.add(z);
        progress = true;
      }
    }
  }

  // ------------------------------------------------------ wall segments
  const wallsOriented = []; // { axis, c (fixed coord), a, b (range) } in metres (oriented)
  // Horizontal edges (constant pv): runs along i.
  for (let j = 0; j <= H; j++) {
    let start = -1;
    for (let i = 0; i <= W; i++) {
      let wall = false;
      if (i < W) {
        const here = zAt(i, j);
        const up = zAt(i, j - 1);
        wall = here !== up && here > 0 && up > 0 && !open.has(edgeKey('H', i, j));
      }
      if (wall && start < 0) start = i;
      if (!wall && start >= 0) {
        wallsOriented.push({ axis: 'H', c: ov + j * CELL, a: ou + start * CELL, b: ou + i * CELL, ci: j, ai: start, bi: i });
        start = -1;
      }
    }
  }
  for (let i = 0; i <= W; i++) {
    let start = -1;
    for (let j = 0; j <= H; j++) {
      let wall = false;
      if (j < H) {
        const here = zAt(i, j);
        const left = zAt(i - 1, j);
        wall = here !== left && here > 0 && left > 0 && !open.has(edgeKey('V', i, j));
      }
      if (wall && start < 0) start = j;
      if (!wall && start >= 0) {
        wallsOriented.push({ axis: 'V', c: ou + i * CELL, a: ov + start * CELL, b: ov + j * CELL, ci: i, ai: start, bi: j });
        start = -1;
      }
    }
  }
  // Extend ends that meet the outer wall until they touch it.
  const extend = (x, z, dx, dz) => {
    let t = 0;
    while (t < 1.1) {
      const nx = x + dx * (t + 0.05);
      const nz = z + dz * (t + 0.05);
      if (!pointInRing(nx, nz, ring) || distToRing(nx, nz, ring) < 0.33) break;
      t += 0.05;
    }
    return t;
  };
  const walls = [];
  for (const w of wallsOriented) {
    let [ax, az] = w.axis === 'H' ? toWorld(w.a, w.c) : toWorld(w.c, w.a);
    let [bx, bz] = w.axis === 'H' ? toWorld(w.b, w.c) : toWorld(w.c, w.b);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const ex = dx / len;
    const ez = dz / len;
    // Is the cell just beyond each end outside the footprint?
    const outsideBeyond = (endA) => {
      let i;
      let j;
      if (w.axis === 'H') {
        i = endA ? w.ai - 1 : w.bi;
        j = w.ci;
        return !isInside(i, j) || !isInside(i, j - 1);
      }
      i = w.ci;
      j = endA ? w.ai - 1 : w.bi;
      return !isInside(i, j) || !isInside(i - 1, j);
    };
    if (outsideBeyond(true)) {
      const t = extend(ax, az, -ex, -ez);
      ax -= ex * t;
      az -= ez * t;
    }
    if (outsideBeyond(false)) {
      const t = extend(bx, bz, ex, ez);
      bx += ex * t;
      bz += ez * t;
    }
    walls.push({ ax, az, bx, bz, axis: w.axis });
  }

  // ------------------------------------------------------------- doors
  const doors = doorList.map((d) => {
    // Door centre = midpoint of the two opened edges.
    let px;
    let pv;
    if (d.axis === 'H') {
      const i = Math.min(d.i, d.i2);
      px = ou + (i + 1) * CELL;
      pv = ov + d.j * CELL;
      const [x, z] = toWorld(px, pv);
      return { x, z, nx: vx, nz: vz, tx: ux, tz: uz, a: d.a, b: d.b };
    }
    const j = Math.min(d.j, d.j2);
    px = ou + d.i * CELL;
    pv = ov + (j + 1) * CELL;
    const [x, z] = toWorld(px, pv);
    return { x, z, nx: ux, nz: uz, tx: vx, tz: vz, a: d.a, b: d.b };
  });

  // ------------------------------------------------------- room summary
  const stats = zoneStats();
  const rooms = [];
  for (const s of stats.values()) {
    const [x, z] = cellCenter(s.sx / s.count, s.sz / s.count);
    const bboxCells = (s.i1 - s.i0 + 1) * (s.j1 - s.j0 + 1);
    const door = doors.find((d) => d.a === s.id) || doors.find((d) => d.b === s.id) || null;
    rooms.push({
      id: s.id,
      x, z,
      area: s.count * CELL * CELL,
      count: s.count,
      i0: s.i0, i1: s.i1, j0: s.j0, j1: s.j1,
      fill: s.count / bboxCells,
      door,
      merged: merged.find((m) => m.id === s.id) || null,
      // Oriented extents in metres.
      uMin: ou + s.i0 * CELL,
      uMax: ou + (s.i1 + 1) * CELL,
      vMin: ov + s.j0 * CELL,
      vMax: ov + (s.j1 + 1) * CELL,
    });
  }

  const coreOut = cores.map((c) => {
    const [x, z] = toWorld(c.pu, c.pv);
    const door = doors.find((d) => d.a === c.id || d.b === c.id) || null;
    return { id: c.id, x, z, pu: c.pu, pv: c.pv, door };
  });

  const corridorCells = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (zone[j * W + i] === ZONE_CORR) corridorCells.push(j * W + i);

  return {
    theta, ux, uz, vx, vz, ou, ov, W, H, cell: CELL,
    zone, inside, walls, doors, rooms, cores: coreOut,
    corridorCells,
    toWorld,
    cellCenter,
    cellAt(x, z) {
      const i = Math.floor((toU(x, z) - ou) / CELL);
      const j = Math.floor((toV(x, z) - ov) / CELL);
      if (i < 0 || j < 0 || i >= W || j >= H) return 0;
      return zone[j * W + i];
    },
    stats: { cells: insideCount, walls: walls.length, doors: doors.length, rooms: rooms.length, cores: cores.length, unreached: [...zoneIds].filter((z) => !reached.has(z)).length },
  };
}
