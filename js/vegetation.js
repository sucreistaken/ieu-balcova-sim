// Instanced vegetation: pines, broadleaf trees, orange trees, cypresses, shrubs.
// Placement uses a rasterised mask of the OSM land cover so trees stay out of
// buildings, roads and paved plazas.

import * as THREE from 'three';
import { CORE_HALF } from './heightfield.js';
import { rng, smoothstep, clamp, hash01 } from './util.js';
import { mergeParts, rgb } from './geo.js';

const KIND = { none: 0, scrub: 40, grass: 70, orchard: 100, park: 130, garden: 160, forest: 200, cemetery: 230 };
const CAMPUS_GARDENS = new Set(['IEU Arka Bahçe', 'IEU Kedili Park']);
const CAMPUS_ORCHARDS = new Set(['IEU Çiçeklik 2', 'IEU Çiçeklik 3']);
const CAMPUS_MEADOWS = new Set(['IEU Çiçeklik', 'IEU Çiçeklik 4']);

const treeTime = { value: 0 };

function blob(radius, detail, sx, sy, sz, x, y, z, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i);
    const py = p.getY(i);
    const pz = p.getZ(i);
    const k = 1 + (hash01(Math.floor((px + 10) * 37) * 131 + Math.floor((py + 10) * 53) * 17 + Math.floor((pz + 10) * 29) + seed) - 0.5) * 0.28;
    // Smooth canopy shading: the normal of the ellipsoid, not of each facet.
    const nx = px / sx;
    const ny = py / sy;
    const nz = pz / sz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / nl;
    nrm[i * 3 + 1] = ny / nl;
    nrm[i * 3 + 2] = nz / nl;
    p.setXYZ(i, px * sx * k + x, py * sy * k + y, pz * sz * k + z);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

function cyl(r0, r1, h, seg, y) {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.translate(0, y + h / 2, 0);
  return g;
}

function treeGeometries() {
  const bark = rgb('#5a4630');
  const barkLight = rgb('#75593c');
  const pine = mergeParts([
    { geo: cyl(0.3, 0.42, 7, 5, 0), color: bark },
    { geo: blob(3.0, 1, 1.15, 0.6, 1.15, 0.3, 8.4, 0.2, 3), color: rgb('#43693a') },
    { geo: blob(2.0, 0, 1.1, 0.6, 1.1, -1.3, 7.2, -0.6, 8), color: rgb('#4b7541') },
    { geo: blob(1.7, 0, 1.05, 0.6, 1.05, 1.5, 9.3, -0.5, 13), color: rgb('#507b44') },
  ]);
  const broad = mergeParts([
    { geo: cyl(0.26, 0.38, 3.4, 5, 0), color: barkLight },
    { geo: blob(3.1, 1, 1, 0.85, 1, 0, 5.6, 0, 5), color: rgb('#72a34a') },
    { geo: blob(1.9, 0, 1, 0.8, 1, 1.9, 4.6, 0.6, 9), color: rgb('#7db052') },
    { geo: blob(1.7, 0, 1, 0.8, 1, -1.7, 4.9, -0.4, 21), color: rgb('#68984a') },
  ]);
  const orangeParts = [
    { geo: cyl(0.12, 0.2, 1.2, 6, 0), color: bark },
    { geo: blob(1.6, 2, 1, 0.9, 1, 0, 2.3, 0, 2), color: rgb('#4b8d3d') },
  ];
  const fr = rng(4);
  for (let i = 0; i < 9; i++) {
    const a = fr() * Math.PI * 2;
    const el = (fr() - 0.35) * 1.4;
    const rr = 1.55;
    const f = new THREE.IcosahedronGeometry(0.16, 0);
    f.translate(Math.cos(a) * Math.cos(el) * rr, 2.3 + Math.sin(el) * rr * 0.9, Math.sin(a) * Math.cos(el) * rr);
    orangeParts.push({ geo: f, color: rgb('#ee8a1c') });
  }
  const orange = mergeParts(orangeParts);
  const cyp = mergeParts([
    { geo: cyl(0.2, 0.3, 1.2, 6, 0), color: bark },
    { geo: blob(1.1, 1, 1, 3.6, 1, 0, 5.2, 0, 7), color: rgb('#39602d') },
  ]);
  const bush = mergeParts([{ geo: blob(0.75, 1, 1.1, 0.75, 1.1, 0, 0.55, 0, 6), color: rgb('#5f9146') }]);
  // Cheap silhouette for the distant forest: one squashed cone.
  const cone = new THREE.ConeGeometry(2.6, 8, 5);
  cone.translate(0, 5, 0);
  const farPine = mergeParts([{ geo: cone, color: rgb('#436a3a') }]);
  return { pine, broad, orange, cyp, bush, farPine };
}

function makeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeTime;
    // Object-space position for leaf-clump noise on green (foliage) vertices.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos;
        float lh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float ln(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(lh(i), lh(i + vec3(1, 0, 0)), f.x), mix(lh(i + vec3(0, 1, 0)), lh(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(lh(i + vec3(0, 0, 1)), lh(i + vec3(1, 0, 1)), f.x), mix(lh(i + vec3(0, 1, 1)), lh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float foliage = step(diffuseColor.r * 1.02, diffuseColor.g);
          float lf = ln(vObjPos * 2.6) * 0.55 + ln(vObjPos * 7.5) * 0.45;
          diffuseColor.rgb *= mix(1.0, 0.68 + 0.62 * lf, foliage);
        }`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = smoothstep(2.5, 11.0, position.y) * 0.05;
          transformed.x += sin(uTime * 1.5 + iw.x * 0.21 + iw.z * 0.13) * sway * position.y * 0.12;
          transformed.z += cos(uTime * 1.2 + iw.z * 0.19 + iw.x * 0.07) * sway * position.y * 0.1;
        #endif`,
      );
  };
  return m;
}

function paintMasks(data) {
  const size = CORE_HALF * 2;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const kindC = mk();
  const bldC = mk();
  const roadC = mk();
  const setup = (c) => {
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, CORE_HALF, CORE_HALF);
    g.imageSmoothingEnabled = false;
    return g;
  };
  const kg = setup(kindC);
  const bg = setup(bldC);
  const rg = setup(roadC);
  const path = (g, arr, close) => {
    g.beginPath();
    for (let i = 0; i < arr.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, arr[i], arr[i + 1]);
    if (close) g.closePath();
  };
  const kindOf = (a) => {
    if (CAMPUS_GARDENS.has(a.name)) return KIND.garden;
    if (CAMPUS_ORCHARDS.has(a.name)) return KIND.orchard;
    if (CAMPUS_MEADOWS.has(a.name)) return KIND.grass;
    switch (a.kind) {
      case 'forest': return KIND.forest;
      case 'park': return KIND.park;
      case 'grass': return KIND.grass;
      case 'orchard': return KIND.orchard;
      case 'scrub': return KIND.scrub;
      case 'cemetery': return KIND.cemetery;
      default: return 0;
    }
  };
  kg.fillStyle = 'rgb(0,0,0)';
  kg.fillRect(-CORE_HALF, -CORE_HALF, size, size);
  const paintArea = (a) => {
    const k = kindOf(a);
    if (!k) return;
    kg.fillStyle = `rgb(${k},0,0)`;
    path(kg, a.r, true);
    kg.fill();
  };
  for (const a of data.areas) if (!CAMPUS_GARDENS.has(a.name) && !CAMPUS_ORCHARDS.has(a.name) && !CAMPUS_MEADOWS.has(a.name)) paintArea(a);
  // Paved parts / non-tree areas.
  for (const a of data.areas) {
    if (['parking', 'pitch', 'sports', 'playground', 'water'].includes(a.kind)) {
      kg.fillStyle = 'rgb(0,0,0)';
      path(kg, a.r, true);
      kg.fill();
    }
  }
  // Campus plaza has no trees except its named gardens.
  kg.fillStyle = 'rgb(0,0,0)';
  path(kg, data.campusRing, true);
  kg.fill();
  for (const a of data.areas) if (CAMPUS_GARDENS.has(a.name) || CAMPUS_ORCHARDS.has(a.name) || CAMPUS_MEADOWS.has(a.name)) paintArea(a);

  bg.fillStyle = bg.strokeStyle = '#fff';
  bg.lineJoin = 'round';
  for (const b of data.buildings) {
    path(bg, b.ring, true);
    bg.lineWidth = 3.4;
    bg.stroke();
    bg.fill();
  }
  for (const d of data.doors) {
    bg.beginPath();
    bg.arc(d.x + d.nx * 3, d.z + d.nz * 3, 4.5, 0, Math.PI * 2);
    bg.fill();
  }
  rg.strokeStyle = '#fff';
  rg.lineCap = 'round';
  rg.lineJoin = 'round';
  for (const r of data.roads) {
    rg.lineWidth = r.w + (r.t === 'footway' || r.t === 'path' || r.t === 'steps' ? 1.4 : 3.2);
    path(rg, r.p, false);
    rg.stroke();
  }

  const read = (c) => c.getContext('2d').getImageData(0, 0, size, size).data;
  return { size, kind: read(kindC), bld: read(bldC), road: read(roadC) };
}

export function buildVegetation(data, hf, collision, quality = 1) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const geos = treeGeometries();
  const material = makeMaterial();
  const masks = paintMasks(data);
  const r = rng(90210);

  const at = (arr, x, z) => {
    const ix = Math.floor(x + CORE_HALF);
    const iz = Math.floor(z + CORE_HALF);
    if (ix < 0 || iz < 0 || ix >= masks.size || iz >= masks.size) return -1;
    return arr[(iz * masks.size + ix) * 4];
  };
  const blocked = (x, z) => at(masks.bld, x, z) > 0 || at(masks.road, x, z) > 0;

  const items = { pine: [], broad: [], orange: [], cyp: [], bush: [], farPine: [] };
  const trunks = [];
  const add = (type, x, z, scale, rot) => {
    items[type].push({ x, z, s: scale, rot });
    if (type === 'pine' || type === 'broad') trunks.push({ x, z, r: 0.42 * Math.min(1.3, scale) });
  };

  // Grid pass over the fine core.
  const CELL = 5.2;
  for (let z = -CORE_HALF + 4; z < CORE_HALF - 4; z += CELL) {
    for (let x = -CORE_HALF + 4; x < CORE_HALF - 4; x += CELL) {
      const px = x + (r() - 0.5) * CELL * 0.85;
      const pz = z + (r() - 0.5) * CELL * 0.85;
      if (blocked(px, pz)) continue;
      const kind = at(masks.kind, px, pz);
      if (kind < 0) continue;
      let p = 0;
      let type = 'pine';
      if (kind >= KIND.cemetery - 5) {
        p = 0.35;
        type = r() < 0.6 ? 'cyp' : 'broad';
      } else if (kind >= KIND.forest - 5) {
        p = 0.95;
        type = r() < 0.85 ? 'pine' : 'broad';
      } else if (kind >= KIND.garden - 5) {
        p = 0.78;
        type = r() < 0.85 ? 'pine' : 'broad';
      } else if (kind >= KIND.park - 5) {
        p = 0.32;
        type = r() < 0.55 ? 'broad' : 'pine';
      } else if (kind >= KIND.orchard - 5) {
        continue; // handled below on a regular grid
      } else if (kind >= KIND.grass - 5) {
        p = 0.06;
        type = r() < 0.5 ? 'broad' : 'pine';
      } else if (kind >= KIND.scrub - 5) {
        p = 0.22;
        type = 'pine';
      } else {
        // Untagged land: steep hillside becomes pine woodland, gentle land gets garden trees.
        const slope = hf.slope(px, pz);
        p = smoothstep(0.14, 0.34, slope) * 0.85 + 0.035;
        type = slope > 0.2 ? 'pine' : r() < 0.6 ? 'broad' : 'pine';
        if (hf.h(px, pz) < -14) p *= 0.3;
      }
      if (r() > p) continue;
      add(type, px, pz, 0.8 + r() * 0.6, r() * Math.PI * 2);
    }
  }

  // Orange orchards (Ciceklik): regular rows.
  for (const a of data.areas) {
    if (!CAMPUS_ORCHARDS.has(a.name)) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < a.r.length; i += 2) {
      minX = Math.min(minX, a.r[i]);
      maxX = Math.max(maxX, a.r[i]);
      minZ = Math.min(minZ, a.r[i + 1]);
      maxZ = Math.max(maxZ, a.r[i + 1]);
    }
    for (let z = Math.ceil(minZ / 5) * 5; z < maxZ; z += 5) {
      for (let x = Math.ceil(minX / 5) * 5; x < maxX; x += 5) {
        if (!inRing(x, z, a.r)) continue;
        if (blocked(x, z)) continue;
        items.orange.push({ x, z, s: 0.95 + r() * 0.15, rot: r() * 6.28 });
        trunks.push({ x, z, r: 0.25 });
      }
    }
  }

  // Street and path-side trees near the campus.
  const walkTypes = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'service']);
  for (const rd of data.roads) {
    if (!walkTypes.has(rd.t)) continue;
    const p = rd.p;
    let carry = r() * 12;
    let side = 1;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const spacing = rd.t === 'service' ? 13 : 15;
      let d = carry;
      while (d < len) {
        const x = p[i] + (dx / len) * d;
        const z = p[i + 1] + (dz / len) * d;
        const off = rd.w / 2 + (rd.t === 'secondary' ? 3.4 : 2.6);
        const tx = x + nx * off * side;
        const tz = z + nz * off * side;
        if (Math.hypot(tx, tz) < CORE_HALF - 10 && at(masks.bld, tx, tz) === 0 && r() < 0.55 && Math.hypot(tx, tz) < 300) {
          add(r() < 0.75 ? 'broad' : 'cyp', tx, tz, 0.85 + r() * 0.35, r() * 6.28);
        }
        side = -side;
        d += spacing;
      }
      carry = d - len;
    }
  }

  // Shrubs hugging campus building edges.
  for (const b of data.buildings) {
    if (!b.campus || b.cat === 'minor') continue;
    const n = b.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = b.ring[i * 2];
      const az = b.ring[i * 2 + 1];
      const bx = b.ring[j * 2];
      const bz = b.ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 5) continue;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      for (let d = 1.5; d < len - 1; d += 2.6 + r() * 2.5) {
        if (r() < 0.45) continue;
        const x = ax + ((bx - ax) / len) * d + nx * 1.5;
        const z = az + ((bz - az) / len) * d + nz * 1.5;
        if (at(masks.road, x, z) > 0) continue;
        if (data.doors.some((dd) => Math.hypot(dd.x - x, dd.z - z) < 5)) continue;
        items.bush.push({ x, z, s: 0.8 + r() * 0.8, rot: r() * 6.28 });
      }
    }
  }

  // Distant pine forest on the hills beyond the fine core.
  const t = data.terrain;
  const farBoxes = new Set();
  for (const f of data.far) farBoxes.add(`${Math.floor(f[0] / 10)},${Math.floor(f[1] / 10)}`);
  const FAR_CELL = 12;
  for (let z = t.zMin + 6; z < t.zMax - 6; z += FAR_CELL) {
    for (let x = t.xMin + 6; x < t.xMax - 6; x += FAR_CELL) {
      if (Math.abs(x) < CORE_HALF - 6 && Math.abs(z) < CORE_HALF - 6) continue;
      if (Math.hypot(x, z) > 1500) continue;
      const px = x + (r() - 0.5) * FAR_CELL;
      const pz = z + (r() - 0.5) * FAR_CELL;
      const slope = hf.slope(px, pz);
      const p = smoothstep(0.16, 0.36, slope) * 0.9;
      if (r() > p) continue;
      if (farBoxes.has(`${Math.floor(px / 10)},${Math.floor(pz / 10)}`)) continue;
      items.farPine.push({ x: px, z: pz, s: 0.8 + r() * 0.8, rot: r() * 6.28 });
    }
  }

  // Emit instanced meshes per 300 m tile.
  const TILE = 150;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const total = {};
  for (const [type, list] of Object.entries(items)) {
    total[type] = list.length;
    const byTile = new Map();
    for (const it of list) {
      const k = `${Math.floor(it.x / TILE)},${Math.floor(it.z / TILE)}`;
      let a = byTile.get(k);
      if (!a) byTile.set(k, (a = []));
      a.push(it);
    }
    for (const [, arr] of byTile) {
      const mesh = new THREE.InstancedMesh(geos[type], material, arr.length);
      arr.forEach((it, i) => {
        const y = hf.h(it.x, it.z);
        dummy.position.set(it.x, y - 0.08, it.z);
        dummy.rotation.set(0, it.rot, 0);
        dummy.scale.setScalar(it.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const k = 0.85 + hash01(i * 31 + Math.floor(it.x)) * 0.3;
        color.setRGB(k, k * (0.96 + hash01(i * 7) * 0.08), k * 0.97);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = quality > 0 && type !== 'farPine';
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  // Trunk colliders close to the campus.
  for (const tr of trunks) if (Math.hypot(tr.x, tr.z) < 330) collision.addCircle(tr);

  return { group, total, trunks, update: (dt) => (treeTime.value += dt) };
}

function inRing(x, z, ring) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

void clamp;
