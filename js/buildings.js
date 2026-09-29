// Building meshes from OSM footprints: facade-textured walls, flat or pitched roofs,
// foundations, doors, signs, special shapes (amphitheatre, mosque) and distant LOD boxes.

import * as THREE from 'three';
import { CORE_HALF } from './heightfield.js';
import { getFacadeTextures, makeDoorTexture, makeDoorEmissive, makeSignTexture, makeRoofTexture, makeLogoTexture, makeRoofLetters } from './textures.js';
import { styleKey, edgeRuns, makeZoneLookup, zonePieces, stepWalls } from './campus_arch.js';
import { hash01, rng, pointInRing, ringBBox, convexity, distToRing, clamp } from './util.js';

const TILE = 150;
const TILE_COUNT = Math.ceil((2 * CORE_HALF) / TILE);

class Bucket {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const tint = (hex, k = 1) => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};

const WALL_TINTS = ['#ffffff', '#f7ecd8', '#f1dfc9', '#ebe5dc', '#f4e4da', '#e8edef', '#f9f3e3', '#efe0c8'];
const TILE_ROOF_TINTS = ['#a8533a', '#b25b3d', '#9c4b34', '#bb6746', '#a15a3f'];

function styleFor(b) {
  if (b.arch) {
    const st = b.arch.style || (b.arch.zones && b.arch.zones[0].style) || 'campus';
    return typeof st === 'string' ? st : st.def;
  }
  if (b.campus) return 'campus';
  switch (b.cat) {
    case 'commercial':
    case 'food':
      return 'commercial';
    case 'industrial':
    case 'minor':
      return 'plain';
    case 'academic':
    case 'school':
    case 'health':
      return 'campus';
    default:
      return hash01(b.id) < 0.45 ? 'apartmentWarm' : 'apartment';
  }
}

export function buildBuildings(data, hf, scene) {
  const tex = getFacadeTextures();
  const roofTex = makeRoofTexture();
  roofTex.repeat.set(1, 1);

  const wallMats = {};
  for (const name of Object.keys(tex)) {
    if (name === 'tile') continue;
    wallMats[name] = new THREE.MeshStandardMaterial({
      map: tex[name].map,
      emissiveMap: tex[name].emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    });
  }
  const materials = {
    roof: new THREE.MeshStandardMaterial({ map: roofTex, vertexColors: true, roughness: 0.95 }),
    roofTile: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    skirt: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    parapet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    equip: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 }),
  };
  const wallKey = (s) => `wall:${s}`;
  const matFor = (key) => (key.startsWith('wall:') ? wallMats[key.slice(5)] : materials[key]);

  const tiles = new Map();
  const bucketOf = (cx, cz, key) => {
    const tx = clamp(Math.floor((cx + CORE_HALF) / TILE), 0, TILE_COUNT - 1);
    const tz = clamp(Math.floor((cz + CORE_HALF) / TILE), 0, TILE_COUNT - 1);
    const tk = `${tx},${tz}`;
    let t = tiles.get(tk);
    if (!t) {
      t = new Map();
      tiles.set(tk, t);
    }
    let b = t.get(key);
    if (!b) {
      b = new Bucket();
      t.set(key, b);
    }
    return b;
  };

  const detailed = [];
  const far = [];
  for (const b of data.buildings) {
    const bb = ringBBox(b.ring);
    if (bb.minX < -CORE_HALF + 14 || bb.maxX > CORE_HALF - 14 || bb.minZ < -CORE_HALF + 14 || bb.maxZ > CORE_HALF - 14) {
      far.push(b);
    } else detailed.push(b);
  }
  // Doors per building. The entrance nearest the main plaza defines the main floor elevation.
  const bById = new Map(detailed.map((b) => [b.id, b]));
  const doorsByBuilding = new Map();
  for (const d of data.doors) {
    const b = bById.get(d.b);
    if (!b) continue;
    if (!doorsByBuilding.has(b.id)) doorsByBuilding.set(b.id, []);
    doorsByBuilding.get(b.id).push(d);
  }
  for (const [id, list] of doorsByBuilding) {
    list.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    // A door flagged main (the real front entrance of a photo-based spec) defines floor 0.
    const d = list.find((q) => q.main) || list[0];
    bById.get(id).baseOverride = hf.dem(d.x + d.nx * 0.8, d.z + d.nz * 0.8);
  }
  hf.carveBuildingPads(detailed);

  const walls = []; // collision segments
  const campus = []; // campus building records for picking / labels
  const doorMeshes = [];
  const extras = new THREE.Group();
  extras.name = 'building-extras';
  const doorTex = makeDoorTexture();
  const doorEmi = makeDoorEmissive();
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, emissiveMap: doorEmi, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.6 });
  const signMats = [];

  const upFace = (bk, x, y, z, u, v, c) => bk.vert(x, y, z, 0, 1, 0, u, v, c);

  function addRoofFlat(bk, ring, holes, y, c, uvScale = 1 / 6) {
    const toV = (r) => {
      const out = [];
      for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1]));
      return out;
    };
    const contour = toV(ring);
    const holeV = holes.map(toV);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
    const all = contour.concat(...holeV);
    const base = bk.pos.length / 3;
    for (const p of all) upFace(bk, p.x, y, p.y, p.x * uvScale, p.y * uvScale, c);
    for (const [i, j, k] of tris) {
      const ax = all[i].x;
      const az = all[i].y;
      const cross = (all[j].y - az) * (all[k].x - ax) - (all[j].x - ax) * (all[k].y - az);
      if (cross >= 0) bk.tri(base + i, base + j, base + k);
      else bk.tri(base + i, base + k, base + j);
    }
  }

  // Facade walls from yBot to y1. Window rows are aligned to floors counted from yRef (main floor).
  // cutsByEdge: Map(edge index -> [{ s0, s1, fy, h }]) leaves door openings in those edges.
  function addWalls(bk, ring, yBot, y1, yRef, floorH, c0, c1, uOffset = 0, cutsByEdge = null, zctx = null) {
    const n = ring.length / 2;
    let u = uOffset;
    const cells = tex.tile.cells;
    const vOf = (y) => (y - yRef) / floorH / cells;
    const colAt = (y) => {
      const t = clamp((y - yBot) / Math.max(0.01, y1 - yBot), 0, 1);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const nb = Math.max(1, Math.round(len / tex.tile.bayW));
      const u0 = u / cells;
      const uSpan = nb / cells;
      u += nb;
      const cuts = cutsByEdge && cutsByEdge.get(i);
      const pieces = [];
      if (!cuts) pieces.push([0, len, yBot, y1]);
      else {
        let cur = 0;
        for (const c of cuts) {
          pieces.push([cur, c.s0, yBot, y1]);
          pieces.push([c.s0, c.s1, yBot, c.fy]);
          pieces.push([c.s0, c.s1, c.fy + c.h, y1]);
          cur = c.s1;
        }
        pieces.push([cur, len, yBot, y1]);
      }
      const emit = (target, ta, tb, yb, yt) => {
        const pax = ax + (bx - ax) * ta;
        const paz = az + (bz - az) * ta;
        const pbx = ax + (bx - ax) * tb;
        const pbz = az + (bz - az) * tb;
        const ua = u0 + uSpan * ta;
        const ub = u0 + uSpan * tb;
        // Vertex order (b_bot, a_bot, a_top, b_top) faces outward for positively wound rings.
        const i0 = target.vert(pbx, yb, pbz, nx, 0, nz, ub, vOf(yb), colAt(yb));
        const i1 = target.vert(pax, yb, paz, nx, 0, nz, ua, vOf(yb), colAt(yb));
        const i2 = target.vert(pax, yt, paz, nx, 0, nz, ua, vOf(yt), colAt(yt));
        const i3 = target.vert(pbx, yt, pbz, nx, 0, nz, ub, vOf(yt), colAt(yt));
        target.tri(i0, i1, i2);
        target.tri(i0, i2, i3);
      };
      for (const [s0, s1, yb, yt] of pieces) {
        if (s1 - s0 < 0.02 || yt - yb < 0.02) continue;
        const t0 = s0 / len;
        const t1 = s1 / len;
        if (!zctx) {
          emit(bk, t0, t1, yb, yt);
          continue;
        }
        // Zoned building: split the piece where the zone (height and facade style) changes.
        const runs = edgeRuns(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, zctx.lookup);
        for (const run of runs) {
          const top = yt >= y1 - 1e-6 ? Math.min(yt, zctx.top(run.zone)) : yt;
          if (top - yb < 0.02) continue;
          emit(zctx.bucketFor(run.zone, nz), t0 + (t1 - t0) * run.t0, t0 + (t1 - t0) * run.t1, yb, top);
        }
      }
    }
  }

  function addPlainWalls(bk, ring, y0, y1, c) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const i0 = bk.vert(bx, y0, bz, nx, 0, nz, 0, 0, c);
      const i1 = bk.vert(ax, y0, az, nx, 0, nz, 1, 0, c);
      const i2 = bk.vert(ax, y1, az, nx, 0, nz, 1, 1, c);
      const i3 = bk.vert(bx, y1, bz, nx, 0, nz, 0, 1, c);
      bk.tri(i0, i1, i2);
      bk.tri(i0, i2, i3);
    }
  }

  function addPitchedRoof(bk, ring, cx, cz, y, rise, c) {
    const n = ring.length / 2;
    const eave = 0.4;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const dx = ring[i * 2] - cx;
      const dz = ring[i * 2 + 1] - cz;
      const l = Math.hypot(dx, dz) || 1;
      pts.push([ring[i * 2] + (dx / l) * eave, ring[i * 2 + 1] + (dz / l) * eave]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [pts[i][0], y - 0.15, pts[i][1]];
      const b = [pts[j][0], y - 0.15, pts[j][1]];
      const p = [cx, y + rise, cz];
      // Face normal, flipped to point up.
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = p[0] - a[0];
      const vy = p[1] - a[1];
      const vz = p[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const flip = ny < 0;
      if (flip) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const shade = 0.88 + 0.12 * ny;
      const cc = [c[0] * shade, c[1] * shade, c[2] * shade];
      const i0 = bk.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, cc);
      const i1 = bk.vert(b[0], b[1], b[2], nx, ny, nz, 1, 0, cc);
      const i2 = bk.vert(p[0], p[1], p[2], nx, ny, nz, 0.5, 1, cc);
      if (flip) bk.tri(i0, i2, i1);
      else bk.tri(i0, i1, i2);
    }
  }

  // Gable roof over the footprint's oriented bounding box; ridge runs along the longer side.
  function addGableRoof(roofB, gableB, ring, y, rise, cRoof, cWall) {
    const n = ring.length / 2;
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      mx += ring[i * 2];
      mz += ring[i * 2 + 1];
    }
    mx /= n;
    mz /= n;
    // Minimum-area oriented rectangle of the footprint (1 degree steps).
    let bestArea = Infinity;
    let a = 0;
    for (let deg = 0; deg < 180; deg++) {
      const t = (deg * Math.PI) / 180;
      const cs = Math.cos(t);
      const sn = Math.sin(t);
      let lo = Infinity;
      let hi = -Infinity;
      let lo2 = Infinity;
      let hi2 = -Infinity;
      for (let i = 0; i < n; i++) {
        const dx = ring[i * 2] - mx;
        const dz = ring[i * 2 + 1] - mz;
        const pu = dx * cs + dz * sn;
        const pv = -dx * sn + dz * cs;
        lo = Math.min(lo, pu);
        hi = Math.max(hi, pu);
        lo2 = Math.min(lo2, pv);
        hi2 = Math.max(hi2, pv);
      }
      const area = (hi - lo) * (hi2 - lo2);
      if (area < bestArea) {
        bestArea = area;
        a = t;
      }
    }
    let ux = Math.cos(a);
    let uz = Math.sin(a);
    let vx = -uz;
    let vz = ux;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = ring[i * 2] - mx;
      const dz = ring[i * 2 + 1] - mz;
      const pu = dx * ux + dz * uz;
      const pv = dx * vx + dz * vz;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
    }
    // Ridge along the longer extent.
    if (u1 - u0 < v1 - v0) {
      [ux, uz, vx, vz] = [vx, vz, -ux, -uz];
      [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
    }
    const over = 0.6;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const hl = (u1 - u0) / 2 + over;
    const hw = (v1 - v0) / 2 + over;
    const P = (du, dv, yy) => [mx + ux * (cu + du) + vx * (cv + dv), yy, mz + uz * (cu + du) + vz * (cv + dv)];
    const slope = (p0, p1, p2, p3, c) => {
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1];
      let ny = e1[2] * e2[0] - e1[0] * e2[2];
      let nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const up = ny >= 0;
      if (!up) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const shade = 0.86 + 0.14 * ny;
      const cc = [c[0] * shade, c[1] * shade, c[2] * shade];
      const ids = [p0, p1, p2, p3].map((p) => roofB.vert(p[0], p[1], p[2], nx, ny, nz, 0, 0, cc));
      if (up) {
        roofB.tri(ids[0], ids[1], ids[2]);
        roofB.tri(ids[0], ids[2], ids[3]);
      } else {
        roofB.tri(ids[0], ids[2], ids[1]);
        roofB.tri(ids[0], ids[3], ids[2]);
      }
    };
    const eave = y - 0.15;
    const ridge = y + rise;
    slope(P(-hl, -hw, eave), P(hl, -hw, eave), P(hl, 0, ridge), P(-hl, 0, ridge), cRoof);
    slope(P(hl, hw, eave), P(-hl, hw, eave), P(-hl, 0, ridge), P(hl, 0, ridge), cRoof);
    // Gable end triangles close the wall up to the ridge.
    for (const e of [-1, 1]) {
      const du = e * (hl - over);
      const pts = [P(du, -(hw - over), y), P(du, hw - over, y), P(du, 0, y + rise * (hw - over) / hw)];
      const nx = ux * e;
      const nz = uz * e;
      const ids = pts.map((p) => gableB.vert(p[0], p[1], p[2], nx, 0, nz, 0, 0, cWall));
      const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
      const e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
      const gx = e1[1] * e2[2] - e1[2] * e2[1];
      const gz = e1[0] * e2[1] - e1[1] * e2[0];
      if (gx * nx + gz * nz >= 0) gableB.tri(ids[0], ids[1], ids[2]);
      else gableB.tri(ids[0], ids[2], ids[1]);
    }
  }

  function addBox(bk, x, y, z, w, h, d, c) {
    const hw = w / 2;
    const hd = d / 2;
    const faces = [
      [[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd], [0, 0, 1]],
      [[hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [0, 0, -1]],
      [[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [1, 0, 0]],
      [[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-1, 0, 0]],
      [[-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd], [0, 1, 0]],
    ];
    for (const f of faces) {
      const n = f[4];
      const shade = n[1] > 0 ? 1.05 : 0.92 + 0.08 * Math.abs(n[0]);
      const cc = [c[0] * shade, c[1] * shade, c[2] * shade];
      const ids = [];
      for (let k = 0; k < 4; k++) ids.push(bk.vert(x + f[k][0], y + f[k][1], z + f[k][2], n[0], n[1], n[2], k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0, cc));
      bk.tri(ids[0], ids[1], ids[2]);
      bk.tri(ids[0], ids[2], ids[3]);
    }
  }

  function addRoofProps(bk, b, ring, y1, r, count, big) {
    let placed = 0;
    for (let tries = 0; tries < 30 && placed < count; tries++) {
      const bb = ringBBox(ring);
      const x = bb.minX + r() * (bb.maxX - bb.minX);
      const z = bb.minZ + r() * (bb.maxZ - bb.minZ);
      const w = big ? 2 + r() * 4 : 1.2 + r() * 1.6;
      const d = big ? 2 + r() * 4 : 1.2 + r() * 1.6;
      const h = big ? 1.4 + r() * 2.4 : 0.8 + r() * 1.2;
      const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => pointInRing(x + (sx * w) / 2, z + (sz * d) / 2, ring)) &&
        distToRing(x, z, ring) > Math.max(w, d) / 2 + 0.8;
      if (!ok) continue;
      const g = 0.62 + r() * 0.2;
      addBox(bk, x, y1, z, w, h, d, [g, g, g * 0.97]);
      placed++;
    }
  }

  const holesOf = (b) => b.holes || [];

  // Landmark features of the photo-based campus specs: logo tower, canopy, rooftop lettering.
  const logoTex = makeLogoTexture();
  const archMats = {
    white: new THREE.MeshStandardMaterial({ color: '#f1eee6', roughness: 0.85 }),
    logo: new THREE.MeshStandardMaterial({ map: logoTex, emissiveMap: logoTex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.7 }),
    pole: new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.4, metalness: 0.6 }),
    flag: new THREE.MeshStandardMaterial({ color: '#d0202a', roughness: 0.8, side: THREE.DoubleSide }),
    letters: null,
  };
  function addArchFeatures(b, y0) {
    const a = b.arch;
    const add = (mesh, shadow = true) => {
      mesh.castShadow = shadow;
      extras.add(mesh);
      return mesh;
    };
    if (a.tower) {
      const t = a.tower;
      const body = add(new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), archMats.white));
      body.position.set(t.x, y0 - 0.3 + t.h / 2, t.z);
      const crown = add(new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.9, 1.5, t.d + 0.9), archMats.white));
      crown.position.set(t.x, y0 - 0.3 + t.h - 0.75, t.z);
      // Emblem panels on all four sides just below the crown.
      const ly = y0 - 0.3 + t.h - 3.4;
      for (const [dx, dz, ry] of [[0, t.d / 2 + 0.47, 0], [0, -(t.d / 2 + 0.47), Math.PI], [t.w / 2 + 0.47, 0, Math.PI / 2], [-(t.w / 2 + 0.47), 0, -Math.PI / 2]]) {
        const panel = add(new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), archMats.logo), false);
        panel.position.set(t.x + dx, ly, t.z + dz);
        panel.rotation.y = ry;
      }
      const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 9, 8), archMats.pole), false);
      pole.position.set(t.x, y0 - 0.3 + t.h + 4.5, t.z);
      const flag = add(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.25), archMats.flag), false);
      flag.position.set(t.x + 0.98, y0 - 0.3 + t.h + 8.2, t.z);
    }
    if (a.canopy) {
      const c = a.canopy;
      const w = c.x1 - c.x0 + 1.6;
      const d = c.z1 - c.z0 + 2.4;
      const slab = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.34, d), archMats.white));
      slab.position.set((c.x0 + c.x1) / 2, y0 + c.y + 0.17, (c.z0 + c.z1) / 2 + 0.7);
      for (const cxp of [c.x0 + 3.6, c.x1 - 3.6]) {
        const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, c.y, 14), archMats.white));
        col.position.set(cxp, y0 + c.y / 2, c.z1 + 0.6);
      }
    }
    if (a.roofSign) {
      const r = a.roofSign;
      if (!archMats.letters) {
        archMats.letters = new THREE.MeshStandardMaterial({ map: makeRoofLetters(r.text), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 });
      }
      const h = r.len / 16;
      const sign = add(new THREE.Mesh(new THREE.PlaneGeometry(r.len, h), archMats.letters), false);
      sign.position.set(r.x, y0 + r.y + 0.7 + h / 2, r.z);
      sign.rotation.y = Math.PI; // letters read from the north, like the real rooftop sign
    }
  }

  for (const b of detailed) {
    const ring = b.ring;
    const holes = holesOf(b);
    const cx = b.c[0];
    const cz = b.c[1];
    const r = rng(b.id >>> 0);
    if (b.special === 'amphitheatre') b.h = 7;
    const y0 = b.base;
    // Natural ground along the walls: the downhill side exposes a podium below the main floor.
    const yBot = Math.min(b.groundMin, y0) - 0.35;
    const y1 = y0 + b.h;
    b.y0 = y0;
    b.yBot = yBot;
    b.yTop = y1;
    b.floorH = b.h / Math.max(1, b.levels);
    b.podiumFloors = Math.max(0, Math.round((y0 - b.groundMin) / b.floorH));
    b.fMin = -b.podiumFloors;
    b.fMax = Math.max(0, b.levels - 1);
    // Door openings: floor level, position along the edge.
    const cutsByEdge = new Map();
    for (const d of doorsByBuilding.get(b.id) || []) {
      const g = hf.dem(d.x + d.nx * 0.8, d.z + d.nz * 0.8);
      d.k = clamp(Math.round((g - y0) / b.floorH), b.fMin, b.fMax);
      d.fy = y0 + d.k * b.floorH;
      const ax = ring[d.edge * 2];
      const az = ring[d.edge * 2 + 1];
      d.s = Math.hypot(d.x - ax, d.z - az);
      const list = cutsByEdge.get(d.edge) || [];
      list.push({ s0: d.s - 0.95, s1: d.s + 0.95, fy: d.fy, h: 2.55 });
      cutsByEdge.set(d.edge, list);
    }
    for (const list of cutsByEdge.values()) list.sort((p, q) => p.s0 - q.s0);

    const style = styleFor(b);
    const isCampusStyle = style === 'campus';
    const wt = isCampusStyle || b.arch ? (b.cat === 'dorm' && !b.arch ? '#f5ead4' : '#ffffff') : WALL_TINTS[Math.floor(hash01(b.id + 3) * WALL_TINTS.length)];
    const k = 0.94 + hash01(b.id + 11) * 0.1;
    const cBot = tint(wt, 0.82 * k);
    const cTop = tint(wt, 1.0 * k);

    const wallB = bucketOf(cx, cz, wallKey(style));
    const podium = y0 - yBot;
    const uOff = Math.floor(hash01(b.id + 5) * 4);
    const zoned = b.arch && b.arch.zones;
    const zctx = zoned
      ? { lookup: makeZoneLookup(b.arch), top: (z) => y0 + z.h, bucketFor: (z, nzz) => bucketOf(cx, cz, wallKey(styleKey(z.style, nzz))) }
      : null;
    if (podium > 1.6) {
      // Exposed podium floors get windows too.
      addWalls(wallB, ring, yBot, y1, y0, b.floorH, cBot, cTop, uOff, cutsByEdge, zctx);
    } else {
      addWalls(wallB, ring, y0, y1, y0, b.floorH, cBot, cTop, uOff, cutsByEdge, zctx);
      addPlainWalls(bucketOf(cx, cz, 'skirt'), ring, yBot, y0 + 0.02, tint('#8e8a80'));
    }
    if (zoned) {
      // Steps between zones of different height (the taller zone's wall above the lower roof).
      for (const w of stepWalls(ring, b.arch, zctx.lookup)) {
        let { ax, az, bx, bz } = w;
        if ((bx - ax) * -w.nz + (bz - az) * w.nx < 0) [ax, az, bx, bz] = [bx, bz, ax, az];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const nb = Math.max(1, Math.round(len / tex.tile.bayW));
        const yb = y0 + w.zoneLo.h;
        const yt = y0 + w.zoneHi.h;
        const target = zctx.bucketFor(w.zoneHi, w.nz);
        const vv = (y) => (y - y0) / b.floorH / tex.tile.cells;
        const uu = nb / tex.tile.cells;
        const c0 = cBot;
        const i0 = target.vert(bx, yb, bz, w.nx, 0, w.nz, uu, vv(yb), c0);
        const i1 = target.vert(ax, yb, az, w.nx, 0, w.nz, 0, vv(yb), c0);
        const i2 = target.vert(ax, yt, az, w.nx, 0, w.nz, 0, vv(yt), cTop);
        const i3 = target.vert(bx, yt, bz, w.nx, 0, w.nz, uu, vv(yt), cTop);
        target.tri(i0, i1, i2);
        target.tri(i0, i2, i3);
      }
    }
    for (const h of holes) {
      // Courtyard: inner walls face into the hole (ring is reversed, so they face the courtyard).
      addWalls(wallB, h, y0, y1, y0, b.floorH, cBot, cTop);
    }

    // Roof.
    const tall = b.h > 6;
    const canPitch = !b.campus && (b.cat === 'residential' || b.cat === 'generic') && b.area <= 300 && !holes.length &&
      b.h <= 15 && hash01(b.id + 9) < 0.5 && convexity(ring) > 0.9;
    if (b.special === 'amphitheatre') {
      const mb = bucketOf(cx, cz, 'metal');
      const scales = [1.0, 0.86, 0.66, 0.42, 0.16];
      const rises = [0, 0.55, 1.15, 1.65, 1.95];
      const white = [0.9, 0.92, 0.93];
      const layers = scales.map((s, i) => ({ y: y1 + rises[i], pts: ring.map((v, idx) => (idx % 2 === 0 ? cx + (v - cx) * s : cz + (v - cz) * s)) }));
      const nPts = ring.length / 2;
      for (let li = 0; li < layers.length - 1; li++) {
        const A = layers[li];
        const B = layers[li + 1];
        for (let i = 0; i < nPts; i++) {
          const j = (i + 1) % nPts;
          const p0 = [A.pts[i * 2], A.y, A.pts[i * 2 + 1]];
          const p1 = [A.pts[j * 2], A.y, A.pts[j * 2 + 1]];
          const p2 = [B.pts[j * 2], B.y, B.pts[j * 2 + 1]];
          const p3 = [B.pts[i * 2], B.y, B.pts[i * 2 + 1]];
          const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
          const e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
          let nx = e1[1] * e2[2] - e1[2] * e2[1];
          let ny = e1[2] * e2[0] - e1[0] * e2[2];
          let nz = e1[0] * e2[1] - e1[1] * e2[0];
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          const up = ny >= 0;
          if (!up) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          const ids = [p0, p1, p2, p3].map((p) => mb.vert(p[0], p[1], p[2], nx, ny, nz, 0, 0, white));
          if (up) {
            mb.tri(ids[0], ids[1], ids[2]);
            mb.tri(ids[0], ids[2], ids[3]);
          } else {
            mb.tri(ids[0], ids[2], ids[1]);
            mb.tri(ids[0], ids[3], ids[2]);
          }
        }
      }
      // Cap.
      const top = layers[layers.length - 1];
      const capIds = [];
      for (let i = 0; i < nPts; i++) capIds.push(mb.vert(top.pts[i * 2], top.y, top.pts[i * 2 + 1], 0, 1, 0, 0, 0, white));
      const cap = THREE.ShapeUtils.triangulateShape(capIds.map((_, i) => new THREE.Vector2(top.pts[i * 2], top.pts[i * 2 + 1])), []);
      for (const [i, j, kk] of cap) {
        const cr = (top.pts[j * 2 + 1] - top.pts[i * 2 + 1]) * (top.pts[kk * 2] - top.pts[i * 2]) - (top.pts[j * 2] - top.pts[i * 2]) * (top.pts[kk * 2 + 1] - top.pts[i * 2 + 1]);
        if (cr >= 0) mb.tri(capIds[i], capIds[j], capIds[kk]);
        else mb.tri(capIds[i], capIds[kk], capIds[j]);
      }
    } else if (zoned) {
      for (const piece of zonePieces(ring, b.arch)) {
        addRoofFlat(bucketOf(cx, cz, 'roof'), piece.ring, [], y0 + piece.zone.h, tint(piece.zone.roof));
        if (piece.zone.h > 20) addRoofProps(bucketOf(cx, cz, 'equip'), b, piece.ring, y0 + piece.zone.h, r, 3, true);
      }
    } else if (b.arch && b.arch.gable) {
      // A flat roof under the whole footprint keeps nothing open; the gable covers the hall rectangle.
      addRoofFlat(bucketOf(cx, cz, 'roof'), ring, holes, y1, tint('#8a8f95'));
      const gr = b.arch.gable.rect;
      const gRing = gr ? [gr[0], gr[1], gr[2], gr[1], gr[2], gr[3], gr[0], gr[3]] : ring;
      addGableRoof(bucketOf(cx, cz, 'metal'), bucketOf(cx, cz, 'skirt'), gRing, y1, b.arch.gable.rise, tint(b.arch.gable.color), tint('#cdb9a8'));
    } else if (canPitch) {
      const c = tint(TILE_ROOF_TINTS[Math.floor(hash01(b.id + 21) * TILE_ROOF_TINTS.length)], 0.9 + hash01(b.id + 23) * 0.2);
      addPitchedRoof(bucketOf(cx, cz, 'roofTile'), ring, cx, cz, y1, 1.4 + hash01(b.id + 27) * 1.2, c);
    } else {
      const gr = b.campus ? 0.95 : 0.85 + hash01(b.id + 31) * 0.2;
      addRoofFlat(bucketOf(cx, cz, 'roof'), ring, holes, y1, b.arch && b.arch.flatRoof ? tint(b.arch.flatRoof) : [gr, gr, gr * 0.96]);
      if (tall) {
        // Parapet band.
        const pk = bucketOf(cx, cz, 'parapet');
        addPlainWalls(pk, ring, y1, y1 + 0.7, tint(b.campus ? '#e2d9c6' : '#d9d3c4'));
        for (const h of holes) addPlainWalls(pk, h, y1, y1 + 0.7, tint('#d9d3c4'));
      }
      if (b.area > 120 && tall) {
        addRoofProps(bucketOf(cx, cz, 'equip'), b, ring, y1, r, b.campus ? 5 : b.area > 400 ? 3 : 2, b.area > 300);
      }
    }

    if (b.special === 'mosque') {
      const bb = ringBBox(ring);
      const rad = Math.max(3, Math.min(bb.maxX - bb.minX, bb.maxZ - bb.minZ) * 0.36);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(rad, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: '#8f9aa0', roughness: 0.5, metalness: 0.3 }),
      );
      dome.position.set(cx, y1 + 0.05, cz);
      dome.castShadow = true;
      extras.add(dome);
      const mx = ring[0] + (ring[0] - cx) * 0.05;
      const mz = ring[1] + (ring[1] - cz) * 0.05;
      const mg = hf.h(mx, mz);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 26, 12), new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.8 }));
      shaft.position.set(mx, mg + 13, mz);
      const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 12), new THREE.MeshStandardMaterial({ color: '#dcd8cc', roughness: 0.8 }));
      ring2.position.set(mx, mg + 19.5, mz);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 5, 12), new THREE.MeshStandardMaterial({ color: '#7d8a90', roughness: 0.5, metalness: 0.3 }));
      cone.position.set(mx, mg + 28.5, mz);
      for (const m of [shaft, ring2, cone]) {
        m.castShadow = true;
        extras.add(m);
      }
    }

    if (b.arch) addArchFeatures(b, y0);

    // Collision segments (outer ring with door gaps + courtyard rings).
    const addSegs = (rg, cuts) => {
      const n = rg.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = rg[i * 2];
        const az = rg[i * 2 + 1];
        const bx = rg[j * 2];
        const bz = rg[j * 2 + 1];
        const list = cuts && cuts.get(i);
        if (!list) {
          walls.push({ ax, az, bx, bz, id: b.id });
          continue;
        }
        const len = Math.hypot(bx - ax, bz - az) || 1;
        let cur = 0;
        const at = (t) => [ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len];
        for (const c of list) {
          const [x0, z0] = at(cur);
          const [x1, z1] = at(c.s0);
          if (c.s0 - cur > 0.05) walls.push({ ax: x0, az: z0, bx: x1, bz: z1, id: b.id });
          cur = c.s1;
        }
        const [x0, z0] = at(cur);
        if (len - cur > 0.05) walls.push({ ax: x0, az: z0, bx, bz, id: b.id });
      }
    };
    addSegs(ring, cutsByEdge);
    holes.forEach((h) => addSegs(h, null));

    if (b.campus) campus.push(b);
  }

  // Door frames and canopies; level the ground in front of each entrance to the floor level.
  const frameMat = new THREE.MeshStandardMaterial({ color: '#3b4048', roughness: 0.55, metalness: 0.3 });
  for (const list of doorsByBuilding.values()) {
    for (const d of list) {
      const yaw = Math.atan2(d.nx, d.nz);
      const fy = d.fy;
      const px = d.x - d.nx * 0.16;
      const pz = d.z - d.nz * 0.16;
      // Local x runs along the wall (tangent), local z along the outward normal.
      const tx = -d.nz;
      const tz = d.nx;
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.36), frameMat);
        jamb.position.set(px + tx * 0.99 * side, fy + 1.3, pz + tz * 0.99 * side);
        jamb.rotation.y = yaw;
        extras.add(jamb);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.16, 0.36), frameMat);
      lintel.position.set(px, fy + 2.62, pz);
      lintel.rotation.y = yaw;
      extras.add(lintel);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 1.5), canopyMat);
      canopy.position.set(d.x + d.nx * 0.75, fy + 2.95, d.z + d.nz * 0.75);
      canopy.rotation.y = yaw;
      canopy.castShadow = true;
      extras.add(canopy);
      hf.padCircle(d.x + d.nx * 1.6, d.z + d.nz * 1.6, 2.3, 4.5, fy - 0.02);
    }
  }
  for (const b of campus) {
    const list = doorsByBuilding.get(b.id);
    if (!b.name || !list || !list.length) continue;
    const d = list[0];
    const sm = new THREE.MeshBasicMaterial({ map: makeSignTexture(b.name.replace(' ve ', ' & ')), toneMapped: false });
    signMats.push(sm);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), sm);
    sign.position.set(d.x + d.nx * 0.06, d.fy + 3.85, d.z + d.nz * 0.06);
    sign.rotation.y = Math.atan2(d.nx, d.nz);
    extras.add(sign);
  }

  // Flush buckets into per-tile meshes.
  const root = new THREE.Group();
  root.name = 'buildings';
  for (const [, t] of tiles) {
    for (const [key, bk] of t) {
      if (!bk.idx.length) continue;
      const mesh = new THREE.Mesh(bk.geometry(), matFor(key));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
  root.add(extras);
  scene.add(root);

  // Far LOD boxes (tier 2 plus tier-1 buildings that fell outside the fine core).
  const farItems = data.far.map((f) => f);
  for (const b of far) {
    const bb = ringBBox(b.ring);
    farItems.push([(bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, (bb.maxX - bb.minX) * 0.9, (bb.maxZ - bb.minZ) * 0.9, b.h]);
  }
  const farGroup = buildFar(farItems, hf);
  scene.add(farGroup);

  function setNight(k) {
    for (const m of Object.values(wallMats)) m.emissiveIntensity = k * 0.95;
    doorMat.emissiveIntensity = k * 1.2;
    archMats.logo.emissiveIntensity = k * 0.9;
    // The white tower and canopy catch the same orange floodlight.
    archMats.white.emissive.set('#ff8a3a');
    archMats.white.emissiveIntensity = k * 0.32;
  }

  // Ray march the view direction against campus footprints (2D) for the info card.
  function pick(origin, dir, maxDist = 90) {
    let best = null;
    const step = 1.2;
    for (let s = 2; s <= maxDist; s += step) {
      const x = origin.x + dir.x * s;
      const z = origin.z + dir.z * s;
      const y = origin.y + dir.y * s;
      for (const b of campus) {
        const bb = b.bb || (b.bb = ringBBox(b.ring));
        if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
        if (y < (b.yBot ?? b.y0) - 1 || y > b.yTop + 1) continue;
        if (pointInRing(x, z, b.ring)) {
          best = b;
          break;
        }
      }
      if (best) return { building: best, dist: s };
    }
    return null;
  }

  return { root, walls, campus, all: detailed, doorsByBuilding, setNight, pick, materials, wallMats, far: farGroup };
}

function buildFar(items, hf) {
  const group = new THREE.Group();
  group.name = 'far-buildings';
  const TILE_F = 500;
  const tiles = new Map();
  for (const it of items) {
    const tk = `${Math.floor(it[0] / TILE_F)},${Math.floor(it[1] / TILE_F)}`;
    let a = tiles.get(tk);
    if (!a) {
      a = [];
      tiles.set(tk, a);
    }
    a.push(it);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  // Procedural windows from world position so distant blocks are not plain boxes.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarWorld;\nvarying float vFarUp;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 fm = modelMatrix * instanceMatrix;
        vFarWorld = (fm * vec4(position, 1.0)).xyz;
        vFarUp = (fm * vec4(normal, 0.0)).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarWorld;\nvarying float vFarUp;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vFarUp) < 0.2) {
          float wx = fract((vFarWorld.x + vFarWorld.z) / 3.4);
          float wy = fract(vFarWorld.y / 3.2);
          float win = step(0.22, wx) * step(wx, 0.78) * step(0.3, wy) * step(wy, 0.82);
          diffuseColor.rgb *= mix(1.0, 0.42, win);
        }`,
      );
  };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = ['#efe6d4', '#e6d8c0', '#f3efe6', '#e2ddd2', '#ead5c4', '#dfe3e4', '#f0e4c8'];
  for (const [, arr] of tiles) {
    const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((it, i) => {
      const [x, z, w, d, h] = it;
      const hw = w / 2;
      const hd = d / 2;
      const ground = Math.min(hf.dem(x - hw, z - hd), hf.dem(x + hw, z - hd), hf.dem(x - hw, z + hd), hf.dem(x + hw, z + hd));
      dummy.position.set(x, ground - 1.5, z);
      dummy.scale.set(w, h + 1.5, d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(palette[Math.floor(hash01(Math.floor(x * 7) + Math.floor(z * 13)) * palette.length)]);
      color.multiplyScalar(0.9 + hash01(i * 7 + 3) * 0.15);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    group.add(mesh);
  }
  return group;
}
