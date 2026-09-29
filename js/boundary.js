// Campus boundary: railing fence along the OSM campus polygon, gate pillars with boom
// barriers where service roads cross it, and the clamp that keeps the player inside.

import * as THREE from 'three';
import { pointInRing, distToRing } from './util.js';
import { makeSignTexture } from './textures.js';

function segIntersect(a, b, c, d) {
  const s1x = b[0] - a[0];
  const s1y = b[1] - a[1];
  const s2x = d[0] - c[0];
  const s2y = d[1] - c[1];
  const den = -s2x * s1y + s1x * s2y;
  if (Math.abs(den) < 1e-9) return null;
  const s = (-s1y * (a[0] - c[0]) + s1x * (a[1] - c[1])) / den;
  const t = (s2x * (a[1] - c[1]) - s2y * (a[0] - c[0])) / den;
  if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return [a[0] + t * s1x, a[1] + t * s1y];
  return null;
}

function fenceTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.fillRect(0, 4, 128, 7);
  g.fillRect(0, 116, 128, 6);
  for (let x = 4; x < 128; x += 16) g.fillRect(x, 0, 5, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function closestOnRing(x, z, ring) {
  let best = { d: Infinity, x, z };
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best.d) best = { d, x: qx, z: qz };
  }
  return best;
}

export function buildBoundary({ data, hf, buildings, scene }) {
  const ring = data.campusRing;
  const n = ring.length / 2;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([ring[i * 2], ring[i * 2 + 1]]);

  // Gates: where any road crosses the boundary.
  const gates = [];
  for (const r of data.roads) {
    if (['footway', 'steps', 'path'].includes(r.t)) continue;
    const p = [];
    for (let i = 0; i < r.p.length; i += 2) p.push([r.p[i], r.p[i + 1]]);
    for (let i = 0; i + 1 < p.length; i++) {
      for (let j = 0; j < n; j++) {
        const hit = segIntersect(p[i], p[i + 1], pts[j], pts[(j + 1) % n]);
        if (!hit) continue;
        if (gates.some((g) => Math.hypot(g.x - hit[0], g.z - hit[1]) < 5)) continue;
        // Gate axis along the boundary edge.
        const ex = pts[(j + 1) % n][0] - pts[j][0];
        const ez = pts[(j + 1) % n][1] - pts[j][1];
        const el = Math.hypot(ex, ez) || 1;
        gates.push({ x: hit[0], z: hit[1], ax: ex / el, az: ez / el, w: r.w + 1.4, road: r.id });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'boundary';
  const fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    color: '#39463f',
    roughness: 0.55,
    metalness: 0.5,
  });
  const postGeo = new THREE.BoxGeometry(0.1, 2, 0.1);
  postGeo.translate(0, 1, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: '#2f3a34', roughness: 0.6, metalness: 0.4 });

  const inGate = (x, z) => gates.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + 0.3);
  const inBuilding = (x, z) => {
    for (const b of buildings.campus) {
      const bb = b.bb || (b.bb = bboxOf(b.ring));
      if (x < bb.minX - 0.6 || x > bb.maxX + 0.6 || z < bb.minZ - 0.6 || z > bb.maxZ + 0.6) continue;
      if (pointInRing(x, z, b.ring) || distToRing(x, z, b.ring) < 0.7) return true;
    }
    return false;
  };

  const pos = [];
  const uv = [];
  const idx = [];
  const posts = [];
  const H = 1.75;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const x0 = a[0] + (b[0] - a[0]) * t0;
      const z0 = a[1] + (b[1] - a[1]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1;
      const z1 = a[1] + (b[1] - a[1]) * t1;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if (inGate(mx, mz) || inBuilding(mx, mz)) continue;
      const y0 = hf.h(x0, z0) - 0.05;
      const y1 = hf.h(x1, z1) - 0.05;
      const base = pos.length / 3;
      pos.push(x0, y0, z0, x1, y1, z1, x1, y1 + H, z1, x0, y0 + H, z0);
      const u = ((len / steps) * 1) / 2;
      uv.push(0, 0, u, 0, u, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      posts.push([x0, y0, z0]);
      if (k === steps - 1) posts.push([x1, y1, z1]);
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fg.setIndex(idx);
  fg.computeVertexNormals();
  const fence = new THREE.Mesh(fg, fenceMat);
  fence.castShadow = true;
  group.add(fence);
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  const d = new THREE.Object3D();
  posts.forEach((p, i) => {
    d.position.set(p[0], p[1], p[2]);
    d.updateMatrix();
    postMesh.setMatrixAt(i, d.matrix);
  });
  postMesh.castShadow = true;
  group.add(postMesh);

  // Gate pillars, plaques and boom barriers.
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.85 });
  const boomMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.5 });
  const plaqueMat = new THREE.MeshBasicMaterial({ map: makeSignTexture('İzmir Ekonomi Üniversitesi', { w: 1024, h: 96 }), toneMapped: false });
  const booms = [];
  for (const g of gates) {
    const y = hf.h(g.x, g.z);
    const half = g.w / 2;
    for (const s of [-1, 1]) {
      const px = g.x + g.ax * (half + 0.35) * s;
      const pz = g.z + g.az * (half + 0.35) * s;
      const py = hf.h(px, pz);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.5, 0.7), pillarMat);
      pillar.position.set(px, py + 1.75, pz);
      pillar.rotation.y = Math.atan2(g.ax, g.az);
      pillar.castShadow = true;
      group.add(pillar);
    }
    // Sign beam across the gate, readable from both sides.
    const beamY = y + 3.15;
    const beamLen = g.w + 1.4;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.7, 0.5), pillarMat);
    beam.position.set(g.x, beamY, g.z);
    beam.rotation.y = Math.atan2(g.ax, g.az) - Math.PI / 2;
    beam.castShadow = true;
    group.add(beam);
    for (const side of [-1, 1]) {
      const nx = -g.az * side;
      const nz = g.ax * side;
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(beamLen - 0.4, 0.5), plaqueMat);
      plaque.position.set(g.x + nx * 0.26, beamY, g.z + nz * 0.26);
      plaque.rotation.y = Math.atan2(nx, nz);
      group.add(plaque);
    }
    // Boom barrier pivoting at one pillar.
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, g.w, 8), boomMat);
    boom.geometry.rotateZ(Math.PI / 2);
    const pivot = new THREE.Group();
    pivot.position.set(g.x - g.ax * half, y + 1.05, g.z - g.az * half);
    pivot.rotation.y = Math.atan2(-g.az, g.ax);
    boom.position.set(g.w / 2, 0, 0);
    pivot.add(boom);
    group.add(pivot);
    booms.push({ pivot, open: 0 });
  }
  scene.add(group);

  let allowOutside = false;
  function setAllowOutside(v) {
    allowOutside = v;
  }
  function update(dt) {
    for (const b of booms) {
      const target = allowOutside ? 1 : 0;
      b.open += (target - b.open) * Math.min(1, dt * 2.5);
      b.pivot.rotation.z = b.open * 1.3;
    }
  }

  // Keep the player inside the polygon. Returns true when a correction was applied.
  function clamp(pos) {
    if (allowOutside) return false;
    if (pointInRing(pos.x, pos.z, ring)) return false;
    const q = closestOnRing(pos.x, pos.z, ring);
    const dx = q.x - pos.x;
    const dz = q.z - pos.z;
    const l = Math.hypot(dx, dz) || 1;
    pos.x = q.x + (dx / l) * 0.45;
    pos.z = q.z + (dz / l) * 0.45;
    return true;
  }

  return { group, gates, clamp, update, setAllowOutside, get allowOutside() { return allowOutside; } };
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = (x / 16) % 2 ? '#f4f4f0' : '#c93a2f';
    g.fillRect(x, 0, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function bboxOf(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]);
    maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]);
    maxZ = Math.max(maxZ, ring[i + 1]);
  }
  return { minX, maxX, minZ, maxZ };
}
