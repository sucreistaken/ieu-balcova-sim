// Street furniture and moving life: lamps, benches, bus shelters, the Balcova gondola,
// traffic, birds and the cats of "Kedili Park".

import * as THREE from 'three';
import { mergeParts, rgb, boxAt, cylAt } from './geo.js';
import { makeGlowTexture } from './textures.js';
import { rng, clamp, TAU, pointInRing, distToRing } from './util.js';

const CAR_COLORS = ['#f2f2f0', '#d7d9dc', '#9aa0a8', '#2a2d33', '#8a2b2b', '#2c4d7c', '#ba9b62', '#e8e6df', '#5f6a63'];

function instanced(geo, mat, list, hf, { yOffset = 0, castShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((it, i) => {
    d.position.set(it.x, (it.y ?? hf.h(it.x, it.z)) + yOffset, it.z);
    d.rotation.set(0, it.yaw || 0, 0);
    d.scale.setScalar(it.s || 1);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildProps({ data, hf, buildings, collision, quality = 1 }) {
  const group = new THREE.Group();
  group.name = 'props';
  const r = rng(4242);
  const nav = data.nav;
  const campusRing = data.campusRing;
  const near = (x, z, d = 260) => Math.hypot(x, z) < d;
  const inCampus = (x, z) => pointInRing(x, z, campusRing);

  // ------------------------------------------------------------- lamps
  const lampGeo = mergeParts([
    { geo: cylAt(0.05, 0.08, 5.4, 6), color: rgb('#3a3e44') },
    { geo: boxAt(1.3, 0.08, 0.08, 0.6, 5.35, 0), color: rgb('#3a3e44') },
    { geo: boxAt(0.55, 0.14, 0.26, 1.2, 5.25, 0), color: rgb('#2b2d31') },
  ], 0.05);
  const lamps = [];
  const lampPositions = [];
  const walkEdgeKinds = new Set([0, 1]);
  const pushLamp = (x, z, yaw) => {
    if (lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 14)) return;
    if (buildings.walls.length && insideAnyBuilding(x, z, buildings)) return;
    lamps.push({ x, z, yaw });
    // Lamp head sits 1.2 m along the arm direction.
    lampPositions.push([x + Math.cos(yaw) * 1.2, hf.h(x, z) + 5.3, z - Math.sin(yaw) * 1.2]);
  };
  for (const [a, b, kind] of nav.edges) {
    if (!walkEdgeKinds.has(kind)) continue;
    const A = nav.nodes[a];
    const B = nav.nodes[b];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 8) continue;
    const dx = (B[0] - A[0]) / len;
    const dz = (B[1] - A[1]) / len;
    const nx = -dz;
    const nz = dx;
    for (let d = 5; d < len; d += 24 + r() * 8) {
      const x = A[0] + dx * d + nx * 2.6;
      const z = A[1] + dz * d + nz * 2.6;
      if (!near(x, z, 300)) continue;
      // Arm points back over the path.
      pushLamp(x, z, Math.atan2(nz, -nx));
    }
  }
  const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  const lampMesh = instanced(lampGeo, lampMat, lamps, hf);
  group.add(lampMesh);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPositions.flat(), 3));
  const glowMat = new THREE.PointsMaterial({
    size: 7,
    map: makeGlowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    color: '#ffd9a0',
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  group.add(glow);
  const headGeo = new THREE.SphereGeometry(0.14, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff0c8', toneMapped: false });
  headMat.color.multiplyScalar(0);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampPositions.length);
  {
    const d = new THREE.Object3D();
    lampPositions.forEach((p, i) => {
      d.position.set(p[0], p[1] - 0.15, p[2]);
      d.updateMatrix();
      heads.setMatrixAt(i, d.matrix);
    });
    heads.instanceMatrix.needsUpdate = true;
    heads.frustumCulled = false;
  }
  group.add(heads);

  // A few real lights that follow the player so lamps pool light on the ground at night.
  const lampLights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight('#ffd6a0', 0, 20, 1.5);
    group.add(l);
    lampLights.push(l);
  }
  let nightK = 0;
  const updateLampLights = (player) => {
    if (nightK < 0.05) {
      for (const l of lampLights) l.intensity = 0;
      return;
    }
    const order = lampPositions.map((p, i) => [Math.hypot(p[0] - player.pos.x, p[2] - player.pos.z), i]).sort((a, b) => a[0] - b[0]);
    lampLights.forEach((l, k) => {
      const e = order[k];
      if (!e || e[0] > 45) {
        l.intensity = 0;
        return;
      }
      const p = lampPositions[e[1]];
      l.position.set(p[0], p[1] - 0.4, p[2]);
      l.intensity = 9 * clamp((nightK - 0.15) * 1.3, 0, 1);
    });
  };

  // ----------------------------------------------------------- benches
  const benchGeo = mergeParts([
    { geo: boxAt(1.6, 0.06, 0.24, 0, 0.44, 0.1), color: rgb('#8d6a43') },
    { geo: boxAt(1.6, 0.06, 0.24, 0, 0.44, -0.16), color: rgb('#8d6a43') },
    { geo: boxAt(1.6, 0.34, 0.05, 0, 0.62, -0.3), color: rgb('#8d6a43') },
    { geo: boxAt(0.06, 0.44, 0.55, -0.72, 0, -0.05), color: rgb('#33373d') },
    { geo: boxAt(0.06, 0.44, 0.55, 0.72, 0, -0.05), color: rgb('#33373d') },
  ], 0.06);
  const benches = [];
  for (const [a, b, kind, w] of nav.edges) {
    if (kind !== 0) continue;
    const A = nav.nodes[a];
    const B = nav.nodes[b];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 16 || !near((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 260)) continue;
    if (r() < 0.5) continue;
    const dx = (B[0] - A[0]) / len;
    const dz = (B[1] - A[1]) / len;
    const side = r() < 0.5 ? 1 : -1;
    const t = 0.3 + r() * 0.4;
    const x = A[0] + dx * len * t + -dz * (w / 2 + 0.7) * side;
    const z = A[1] + dz * len * t + dx * (w / 2 + 0.7) * side;
    if (insideAnyBuilding(x, z, buildings)) continue;
    // Bench faces the path: its front (+z local) points towards the walkway.
    const fx = dz * side;
    const fz = -dx * side;
    benches.push({ x, z, yaw: Math.atan2(fx, fz), h: 0 });
  }
  // A few benches near the campus cafes.
  for (const p of data.pois) {
    if (!['food', 'library'].includes(p.cat) || !inCampus(p.x, p.z)) continue;
    const a = r() * TAU;
    const x = p.x + Math.cos(a) * 4.5;
    const z = p.z + Math.sin(a) * 4.5;
    if (insideAnyBuilding(x, z, buildings)) continue;
    benches.push({ x, z, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), h: 0 });
  }
  const benchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  group.add(instanced(benchGeo, benchMat, benches, hf));
  for (const b of benches) collision.addCircle({ x: b.x, z: b.z, r: 0.55 });

  // ------------------------------------------------------ bus shelters
  const shelterGeo = mergeParts([
    { geo: boxAt(3.2, 0.1, 1.4, 0, 2.5, 0), color: rgb('#3b4a5c') },
    { geo: boxAt(0.08, 2.5, 0.08, -1.5, 0, -0.6), color: rgb('#3b4a5c') },
    { geo: boxAt(0.08, 2.5, 0.08, 1.5, 0, -0.6), color: rgb('#3b4a5c') },
    { geo: boxAt(3.1, 1.6, 0.04, 0, 0.5, -0.66), color: rgb('#9fc4d6') },
    { geo: boxAt(2.4, 0.06, 0.4, 0, 0.45, -0.4), color: rgb('#6b6f75') },
  ], 0.05);
  const shelters = [];
  for (const p of data.pois) {
    if (p.cat !== 'bus') continue;
    // Face the nearest road.
    let best = null;
    let bd = Infinity;
    for (const rd of data.roads) {
      if (['footway', 'steps', 'path'].includes(rd.t)) continue;
      for (let i = 0; i + 1 < rd.p.length / 2; i++) {
        const ax = rd.p[i * 2];
        const az = rd.p[i * 2 + 1];
        const bx = rd.p[i * 2 + 2];
        const bz = rd.p[i * 2 + 3];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const tt = clamp(((p.x - ax) * dx + (p.z - az) * dz) / l2, 0, 1);
        const qx = ax + dx * tt;
        const qz = az + dz * tt;
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (d < bd) {
          bd = d;
          best = { qx, qz };
        }
      }
    }
    if (!best) continue;
    shelters.push({ x: p.x, z: p.z, yaw: Math.atan2(best.qx - p.x, best.qz - p.z) });
  }
  const shelterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  if (shelters.length) group.add(instanced(shelterGeo, shelterMat, shelters, hf));

  // ---------------------------------------------------------- gondola
  const gondola = buildGondola(data, hf, group);

  // -------------------------------------------------------------- cars
  const traffic = buildTraffic(data, hf, group, r);

  // ------------------------------------------------------------- birds
  const birds = buildBirds(hf, group, r);

  // -------------------------------------------------------------- cats
  const cats = buildCats(data, hf, group, r);

  function setNight(k) {
    nightK = k;
    glowMat.opacity = clamp((k - 0.15) * 1.3, 0, 1) * 0.95;
    headMat.color.set('#fff0c8').multiplyScalar(k > 0.2 ? 1 : 0);
    gondola.setNight(k);
    traffic.setNight(k);
  }

  function update(dt, player, sky) {
    updateLampLights(player);
    gondola.update(dt);
    traffic.update(dt, player);
    birds.update(dt);
    cats.update(dt, player);
    void sky;
  }

  return { group, benches, lamps, gondola, traffic, birds, cats, setNight, update };
}

function insideAnyBuilding(x, z, buildings) {
  for (const b of buildings.all) {
    const bb = b.bb || (b.bb = bboxOf(b.ring));
    if (x < bb.minX - 1 || x > bb.maxX + 1 || z < bb.minZ - 1 || z > bb.maxZ + 1) continue;
    if (pointInRing(x, z, b.ring)) return true;
  }
  return false;
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

// ----------------------------------------------------------------- gondola
function buildGondola(data, hf, group) {
  const g = data.gondola;
  const pts = [];
  for (let i = 0; i < g.line.length; i += 2) pts.push([g.line[i], g.line[i + 1]]);
  const gy = (x, z) => hf.h(x, z);
  const steel = new THREE.MeshStandardMaterial({ color: '#8b9299', roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2c2f34', roughness: 0.7, metalness: 0.3 });

  // Stations at both ends and pylons in between.
  const top = [];
  pts.forEach((p, i) => {
    const isEnd = i === 0 || i === pts.length - 1;
    const base = gy(p[0], p[1]);
    const h = isEnd ? 9 : 15 + (i % 2) * 2;
    top.push(new THREE.Vector3(p[0], base + h, p[1]));
    if (!isEnd) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.6, h + 1, 8), steel);
      tower.position.set(p[0], base + h / 2 - 0.5, p[1]);
      tower.castShadow = true;
      group.add(tower);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.35, 0.5), steel);
      arm.position.set(p[0], base + h - 0.2, p[1]);
      arm.rotation.y = Math.atan2(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) + Math.PI / 2;
      group.add(arm);
    }
  });
  // Cable direction and lateral offset for the second (down) cable.
  const dir = new THREE.Vector3().subVectors(top[top.length - 1], top[0]);
  dir.y = 0;
  dir.normalize();
  const lat = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.9);
  const cablePts = (sign) => top.map((t) => t.clone().addScaledVector(lat, sign));
  const upPath = cablePts(-1);
  const downPath = cablePts(1).reverse();
  for (const path of [upPath, downPath]) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const len = a.distanceTo(b);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 5), dark);
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      group.add(cyl);
    }
  }
  // Lower and upper station roofs.
  const stationMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.7 });
  const upperStation = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), stationMat);
  const u = pts[pts.length - 1];
  upperStation.position.set(u[0], gy(u[0], u[1]) + 3, u[1]);
  upperStation.rotation.y = Math.atan2(dir.x, dir.z);
  upperStation.castShadow = true;
  group.add(upperStation);

  // Cabins.
  const cabinBody = mergeParts([
    { geo: boxAt(2.2, 1.7, 2.2, 0, -2.6, 0), color: rgb('#e9edf0') },
    { geo: boxAt(2.24, 0.75, 2.24, 0, -2.2, 0), color: rgb('#5f88a8') },
    { geo: boxAt(0.1, 1.2, 0.1, 0, -1.0, 0), color: rgb('#2c2f34') },
    { geo: boxAt(2.4, 0.16, 2.4, 0, -0.92, 0), color: rgb('#3a4048') },
  ], 0.05);
  const cabinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2, emissive: '#ffe7b0', emissiveIntensity: 0 });
  const total = 6;
  const cabins = new THREE.InstancedMesh(cabinBody, cabinMat, total);
  cabins.castShadow = true;
  cabins.frustumCulled = false;
  group.add(cabins);
  // Path length tables.
  const lengths = (path) => {
    const l = [0];
    for (let i = 1; i < path.length; i++) l.push(l[i - 1] + path[i].distanceTo(path[i - 1]));
    return l;
  };
  const upLen = lengths(upPath);
  const downLen = lengths(downPath);
  const L = upLen[upLen.length - 1];
  const at = (path, len, s, out) => {
    s = clamp(s, 0, len[len.length - 1]);
    let i = 1;
    while (i < len.length - 1 && len[i] < s) i++;
    const t = (s - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return out.copy(path[i - 1]).lerp(path[i], t);
  };
  const state = [];
  for (let i = 0; i < total; i++) state.push({ s: (i % 3) * (L / 3) + (i % 3) * 3, up: i < 3, wait: 0 });
  const dummy = new THREE.Object3D();
  const pos = new THREE.Vector3();
  function update(dt) {
    for (let i = 0; i < total; i++) {
      const c = state[i];
      const remain = Math.min(c.s, L - c.s);
      const speed = c.wait > 0 ? 0 : clamp(1.6 + remain * 0.16, 1.6, 5.2);
      if (c.wait > 0) c.wait -= dt;
      c.s += speed * dt;
      if (c.s >= L) {
        c.s = 0;
        c.up = !c.up;
        c.wait = 6;
      }
      at(c.up ? upPath : downPath, c.up ? upLen : downLen, c.s, pos);
      dummy.position.copy(pos);
      const path = c.up ? upPath : downPath;
      const segDir = new THREE.Vector3().subVectors(path[Math.min(path.length - 1, 1)], path[0]);
      dummy.rotation.set(0, Math.atan2(segDir.x, segDir.z), 0);
      dummy.updateMatrix();
      cabins.setMatrixAt(i, dummy.matrix);
    }
    cabins.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { update, setNight: (k) => (cabinMat.emissiveIntensity = k * 0.7), pathLength: L, cabins };
}

// ----------------------------------------------------------------- traffic
function buildTraffic(data, hf, group, r) {
  // Cars stay on streets outside the campus: any road touching the campus (or within 14 m) is excluded.
  const touchesCampus = (rd) => {
    for (let i = 0; i < rd.p.length; i += 2) {
      if (pointInRing(rd.p[i], rd.p[i + 1], data.campusRing) || distToRing(rd.p[i], rd.p[i + 1], data.campusRing) < 14) return true;
    }
    return false;
  };
  const roads = data.roads.filter((rd) => ['secondary', 'tertiary', 'residential', 'unclassified', 'primary', 'primary_link'].includes(rd.t) && !rd.tunnel && !touchesCampus(rd));
  const carGeo = mergeParts([
    { geo: boxAt(1.8, 0.6, 4.2, 0, 0.35, 0), color: rgb('#ffffff') },
    { geo: boxAt(1.55, 0.55, 2.0, 0, 0.95, -0.2), color: rgb('#5a6f80') },
    { geo: boxAt(0.3, 0.3, 0.3, -0.7, 0.05, 1.35), color: rgb('#1b1c1f') },
    { geo: boxAt(0.3, 0.3, 0.3, 0.7, 0.05, 1.35), color: rgb('#1b1c1f') },
    { geo: boxAt(0.3, 0.3, 0.3, -0.7, 0.05, -1.35), color: rgb('#1b1c1f') },
    { geo: boxAt(0.3, 0.3, 0.3, 0.7, 0.05, -1.35), color: rgb('#1b1c1f') },
    { geo: boxAt(1.4, 0.16, 0.05, 0, 0.6, 2.11), color: rgb('#fff6d8') },
  ], 0.03);
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35, emissive: '#ffe9b8', emissiveIntensity: 0 });
  const N = 26;
  const mesh = new THREE.InstancedMesh(carGeo, carMat, N);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false; // off by default; enabled from the settings panel
  let enabled = false;
  const col = new THREE.Color();
  const cars = [];
  const segs = roads.map((rd) => {
    const pts = [];
    for (let i = 0; i < rd.p.length; i += 2) pts.push([rd.p[i], rd.p[i + 1]]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { rd, pts, len };
  }).filter((s) => s.len > 40 && s.pts.some((p) => Math.hypot(p[0], p[1]) < 330));
  const spawn = (c, playerPos) => {
    for (let tries = 0; tries < 30; tries++) {
      const s = segs[Math.floor(r() * segs.length)];
      const dirFwd = s.rd.oneway ? true : r() < 0.5;
      const dist = r() * s.len;
      const p = sample(s, dist);
      if (Math.hypot(p.x, p.z) > 330) continue;
      if (playerPos && Math.hypot(p.x - playerPos.x, p.z - playerPos.z) < 45) continue;
      c.seg = s;
      c.fwd = dirFwd;
      c.s = dirFwd ? dist : s.len - dist;
      c.speed = 0;
      c.max = (s.rd.t === 'secondary' || s.rd.t === 'primary' ? 9 : 5.5) * (0.75 + r() * 0.4);
      return;
    }
  };
  function sample(seg, s) {
    let acc = 0;
    for (let i = 1; i < seg.pts.length; i++) {
      const a = seg.pts[i - 1];
      const b = seg.pts[i];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + l >= s || i === seg.pts.length - 1) {
        const t = clamp((s - acc) / (l || 1), 0, 1);
        return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / (l || 1), dz: (b[1] - a[1]) / (l || 1) };
      }
      acc += l;
    }
    return { x: 0, z: 0, dx: 0, dz: 1 };
  }
  for (let i = 0; i < N; i++) {
    const c = { seg: null, fwd: true, s: 0, speed: 0, max: 6, x: 0, z: 0, yaw: 0 };
    spawn(c, null);
    cars.push(c);
    col.set(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
    mesh.setColorAt(i, col);
  }
  mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  const dummy = new THREE.Object3D();
  function update(dt, player) {
    if (!enabled) return;
    for (let i = 0; i < N; i++) {
      const c = cars[i];
      if (!c.seg) continue;
      const step = c.speed * dt;
      c.s += c.fwd ? step : -step;
      if (c.s > c.seg.len || c.s < 0) {
        spawn(c, player ? player.pos : null);
        if (!c.seg) continue;
      }
      const p = sample(c.seg, c.s);
      const dx = c.fwd ? p.dx : -p.dx;
      const dz = c.fwd ? p.dz : -p.dz;
      const w = c.seg.rd.w;
      const lane = c.seg.rd.oneway ? 0 : w / 4;
      const x = p.x + -dz * lane;
      const z = p.z + dx * lane;
      // Slow down for the player ahead or standing in the road.
      let target = c.max;
      if (player) {
        const px = player.pos.x - x;
        const pz = player.pos.z - z;
        const ahead = px * dx + pz * dz;
        const side = Math.abs(px * -dz + pz * dx);
        if (ahead > 0 && ahead < 10 && side < 2.4) target = 0;
      }
      c.speed += (target - c.speed) * Math.min(1, dt * 1.8);
      const y = hf.h(x, z);
      const yFront = hf.h(x + dx * 1.6, z + dz * 1.6);
      const yBack = hf.h(x - dx * 1.6, z - dz * 1.6);
      dummy.position.set(x, (yFront + yBack) / 2 + 0.02, z);
      dummy.rotation.set(-Math.atan2(yFront - yBack, 3.2), Math.atan2(dx, dz), 0, 'YXZ');
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      void y;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0, null);
  return {
    update,
    setNight: (k) => (carMat.emissiveIntensity = k * 0.5),
    setEnabled(v) {
      enabled = v;
      mesh.visible = v;
    },
    get enabled() {
      return enabled;
    },
    count: N,
  };
}

// ------------------------------------------------------------------- birds
function buildBirds(hf, group, r) {
  const N = 16;
  const geo = new THREE.BufferGeometry();
  // Two wing triangles and a body triangle; wings flap around the body axis in the shader.
  const v = [
    0, 0, 0.35, 0.9, 0, -0.2, 0, 0, -0.1, // left wing
    0, 0, 0.35, 0, 0, -0.1, -0.9, 0, -0.2, // right wing
    -0.06, 0, 0.42, 0.06, 0, 0.42, 0, 0, -0.35, // body
  ];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute('wing', new THREE.Float32BufferAttribute([0, 1, 0.3, 0, 0.3, 1, 0, 0.3, 0.6].slice(0, 9).map((x) => x), 1));
  geo.computeVertexNormals();
  const uTime = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: '#f4f4f2', side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float wing;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
        transformed.y += abs(position.x) * sin(uTime * 7.0 + ph) * 0.55 * step(0.5, abs(position.x));`,
      );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  group.add(mesh);
  const birds = [];
  for (let i = 0; i < N; i++) {
    birds.push({
      cx: (r() - 0.5) * 320, cz: -60 + (r() - 0.5) * 300, rad: 40 + r() * 110, ang: r() * TAU,
      w: (0.12 + r() * 0.1) * (r() < 0.5 ? 1 : -1), alt: 40 + r() * 70, s: 1 + r() * 0.8,
    });
  }
  const d = new THREE.Object3D();
  return {
    update(dt) {
      uTime.value += dt;
      birds.forEach((b, i) => {
        b.ang += b.w * dt;
        const x = b.cx + Math.cos(b.ang) * b.rad;
        const z = b.cz + Math.sin(b.ang) * b.rad;
        const y = hf.h(x, z) + b.alt + Math.sin(b.ang * 3 + i) * 4;
        d.position.set(x, y, z);
        const vx = -Math.sin(b.ang) * Math.sign(b.w);
        const vz = Math.cos(b.ang) * Math.sign(b.w);
        d.rotation.set(0, Math.atan2(vx, vz), Math.sin(b.ang * 2) * 0.25 * Math.sign(b.w));
        d.scale.setScalar(b.s);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// -------------------------------------------------------------------- cats
function buildCats(data, hf, group, r) {
  const park = data.areas.find((a) => a.name === 'IEU Kedili Park');
  if (!park) return { update() {} };
  const colors = ['#d98a3d', '#6d6f73', '#1f1f22', '#efe9dc', '#b5793f'];
  const bodyGeo = mergeParts([
    { geo: boxAt(0.14, 0.15, 0.36, 0, 0.16, 0), color: rgb('#ffffff') },
    { geo: boxAt(0.12, 0.12, 0.12, 0, 0.22, 0.24), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.05, 0.03, -0.04, 0.34, 0.26), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.05, 0.03, 0.04, 0.34, 0.26), color: rgb('#ffffff') },
    { geo: boxAt(0.04, 0.04, 0.3, 0, 0.26, -0.3), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.12, 0.03, -0.05, 0.05, 0.12), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.12, 0.03, 0.05, 0.05, 0.12), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.12, 0.03, -0.05, 0.05, -0.12), color: rgb('#ffffff') },
    { geo: boxAt(0.03, 0.12, 0.03, 0.05, 0.05, -0.12), color: rgb('#ffffff') },
  ], 0.0);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const N = 5;
  const mesh = new THREE.InstancedMesh(bodyGeo, mat, N);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const c = new THREE.Color();
  const cats = [];
  const [bx, bz] = ringCenter(park.r);
  for (let i = 0; i < N; i++) {
    let x = bx;
    let z = bz;
    for (let t = 0; t < 30; t++) {
      const px = bx + (r() - 0.5) * 40;
      const pz = bz + (r() - 0.5) * 40;
      if (pointInRing(px, pz, park.r)) {
        x = px;
        z = pz;
        break;
      }
    }
    cats.push({ x, z, yaw: r() * TAU, tx: x, tz: z, wait: r() * 6, speed: 0, ph: r() * 6 });
    c.set(colors[i % colors.length]);
    mesh.setColorAt(i, c);
  }
  mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  const d = new THREE.Object3D();
  return {
    count: N,
    update(dt, player) {
      cats.forEach((k, i) => {
        const dx = k.tx - k.x;
        const dz = k.tz - k.z;
        const dist = Math.hypot(dx, dz);
        const pd = Math.hypot(player.pos.x - k.x, player.pos.z - k.z);
        if (pd < 2.2) {
          // Skitter away from the player.
          const fx = (k.x - player.pos.x) / (pd || 1);
          const fz = (k.z - player.pos.z) / (pd || 1);
          k.tx = k.x + fx * 6;
          k.tz = k.z + fz * 6;
          k.wait = 0;
        }
        if (dist < 0.15 || k.wait > 0) {
          k.wait -= dt;
          k.speed = 0;
          if (k.wait <= 0 && dist < 0.15) {
            for (let t = 0; t < 12; t++) {
              const px = k.x + (r() - 0.5) * 12;
              const pz = k.z + (r() - 0.5) * 12;
              if (pointInRing(px, pz, park.r)) {
                k.tx = px;
                k.tz = pz;
                break;
              }
            }
            k.wait = 3 + r() * 8;
            if (r() < 0.5) k.wait = 0;
          }
        } else {
          k.speed += ((pd < 2.2 ? 2.2 : 0.55) - k.speed) * Math.min(1, dt * 4);
          k.x += (dx / dist) * k.speed * dt;
          k.z += (dz / dist) * k.speed * dt;
          k.yaw += (Math.atan2(dx, dz) - k.yaw) * Math.min(1, dt * 5);
        }
        k.ph += dt * (2 + k.speed * 5);
        d.position.set(k.x, hf.h(k.x, k.z) + Math.abs(Math.sin(k.ph)) * 0.012 * (k.speed > 0 ? 1 : 0), k.z);
        d.rotation.set(0, k.yaw, 0);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function ringCenter(ring) {
  let x = 0;
  let z = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    x += ring[i * 2];
    z += ring[i * 2 + 1];
  }
  return [x / n, z / n];
}
