// Procedural human: mesh, skeleton, hair/clothing/accessory variants and procedural animation
// clips baked into vertex-animation textures (see humanrender.js). Everything is generated in
// code, so no external character assets are needed.

import * as THREE from 'three';

const D = Math.PI / 180;

// -------------------------------------------------------------------- skeleton
// +x is the character's left, +y up, the character faces +z.
export const BONES = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 0, pos: [0, 0.93, 0] },
  { name: 'spine', parent: 1, pos: [0, 1.05, 0] },
  { name: 'chest', parent: 2, pos: [0, 1.22, 0] },
  { name: 'neck', parent: 3, pos: [0, 1.47, 0] },
  { name: 'head', parent: 4, pos: [0, 1.54, 0] },
  { name: 'clavL', parent: 3, pos: [0.05, 1.42, 0] },
  { name: 'upperArmL', parent: 6, pos: [0.19, 1.41, 0] },
  { name: 'lowerArmL', parent: 7, pos: [0.225, 1.14, 0] },
  { name: 'handL', parent: 8, pos: [0.245, 0.89, 0] },
  { name: 'clavR', parent: 3, pos: [-0.05, 1.42, 0] },
  { name: 'upperArmR', parent: 10, pos: [-0.19, 1.41, 0] },
  { name: 'lowerArmR', parent: 11, pos: [-0.225, 1.14, 0] },
  { name: 'handR', parent: 12, pos: [-0.245, 0.89, 0] },
  { name: 'thighL', parent: 1, pos: [0.085, 0.92, 0] },
  { name: 'shinL', parent: 14, pos: [0.09, 0.5, 0.01] },
  { name: 'footL', parent: 15, pos: [0.09, 0.09, 0] },
  { name: 'thighR', parent: 1, pos: [-0.085, 0.92, 0] },
  { name: 'shinR', parent: 17, pos: [-0.09, 0.5, 0.01] },
  { name: 'footR', parent: 18, pos: [-0.09, 0.09, 0] },
];
export const B = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// Zone codes (vertex attribute) decide the colour and visibility per instance.
export const ZONE = { SKIN: 0, TORSO: 1, ARM: 2, LEG: 3, SHOE: 4, NECK: 5, HAIR: 6, ACC: 7, EYE: 8, BROW: 9, LIPS: 10, SKIRT: 11, WRAP: 12 };
// Accessory variants (bit index in the flags).
export const ACC = { BACKPACK: 0, GLASSES: 1, CUP: 2, BOOK: 3, PHONE: 4, SHOULDERBAG: 5 };
export const HAIR_STYLES = 5; // 0 short, 1 long, 2 ponytail, 3 buzz, 4 none

// --------------------------------------------------------------------- builder
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.info = []; // zone, param, variant, vid
    this.bones = [];
    this.weights = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vert(p, zone, param, variant, bw) {
    const id = this.count;
    this.pos.push(p[0], p[1], p[2]);
    this.info.push(zone, param, variant, id);
    const b = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    let sum = 0;
    bw.slice(0, 4).forEach(([bone, weight], i) => {
      b[i] = bone;
      w[i] = weight;
      sum += weight;
    });
    for (let i = 0; i < 4; i++) w[i] /= sum || 1;
    this.bones.push(...b);
    this.weights.push(...w);
    return id;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Weights along a chain of bones split at joint distances (blend half width h).
function chainWeights(s, bones, joints, h) {
  const w = [];
  for (let i = 0; i < bones.length; i++) {
    const lo = i === 0 ? 0 : smooth(joints[i - 1] - h, joints[i - 1] + h, s);
    const hi = i === bones.length - 1 ? 0 : smooth(joints[i] - h, joints[i] + h, s);
    const v = lo - hi + (i === 0 ? 1 : 0);
    if (v > 0.001) w.push([bones[i], v]);
  }
  return w;
}

// Loft rings [{c, rx, rz, dir, bw, param}] into a closed tube; caps add rounded ends.
function loft(mb, rings, { zone, variant = 0, seg = 10, capStart = false, capEnd = false, flip = false }) {
  const start = mb.count;
  const ids = [];
  for (const r of rings) {
    const d = norm(r.dir || [0, 1, 0]);
    let ref = Math.abs(d[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(sub(ref, mul(d, dot(ref, d))));
    const e2 = cross(d, e1);
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const p = add(r.c, add(mul(e1, r.rx * Math.cos(a)), mul(e2, r.rz * Math.sin(a))));
      ring.push(mb.vert(p, zone, r.param ?? 0, variant, r.bw));
    }
    ids.push(ring);
  }
  // Decide winding once: outward normal of the first quad.
  const p0 = mb.pos.slice(ids[0][0] * 3, ids[0][0] * 3 + 3);
  const p1 = mb.pos.slice(ids[0][1] * 3, ids[0][1] * 3 + 3);
  const q0 = mb.pos.slice(ids[1][0] * 3, ids[1][0] * 3 + 3);
  const n0 = cross(sub(p1, p0), sub(q0, p0));
  const out0 = sub(p0, rings[0].c);
  const flipFaces = (dot(n0, out0) < 0) !== flip;
  for (let i = 0; i + 1 < ids.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = ids[i][k];
      const b = ids[i][(k + 1) % seg];
      const c = ids[i + 1][(k + 1) % seg];
      const d = ids[i + 1][k];
      if (!flipFaces) {
        mb.tri(a, b, c);
        mb.tri(a, c, d);
      } else {
        mb.tri(a, c, b);
        mb.tri(a, d, c);
      }
    }
  }
  const cap = (ring, r, atStart) => {
    const centre = mb.vert(r.c, zone, r.param ?? 0, variant, r.bw);
    for (let k = 0; k < seg; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % seg];
      const facing = atStart ? flipFaces : !flipFaces;
      if (facing) mb.tri(centre, a, b);
      else mb.tri(centre, b, a);
    }
  };
  if (capStart) cap(ids[0], rings[0], true);
  if (capEnd) cap(ids[ids.length - 1], rings[rings.length - 1], false);
  return { start, end: mb.count };
}

// Ellipsoid as a loft of rings around the y axis.
function ellipsoid(mb, c, rx, ry, rz, bw, { zone, param = 0, variant = 0, seg = 10, rings = 6, yaw = 0 }) {
  const rs = [];
  for (let i = 0; i <= rings; i++) {
    const t = -Math.PI / 2 + (i / rings) * Math.PI;
    const k = Math.cos(t);
    const y = Math.sin(t);
    rs.push({ c: [c[0], c[1] + y * ry, c[2]], rx: Math.max(0.0005, rx * k), rz: Math.max(0.0005, rz * k), dir: [0, 1, 0], bw, param });
  }
  void yaw;
  return loft(mb, rs, { zone, variant, seg, capStart: true, capEnd: true });
}

function boxMesh(mb, c, sx, sy, sz, bw, { zone, param = 0, variant = 0 }) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces = [
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
    [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]],
    [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]],
    [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]],
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]],
  ];
  for (const f of faces) {
    const ids = f.map((p) => mb.vert(add(c, p), zone, param, variant, bw));
    mb.tri(ids[0], ids[1], ids[2]);
    mb.tri(ids[0], ids[2], ids[3]);
  }
}

// ------------------------------------------------------------------- the body
export function buildHumanMesh() {
  const mb = new MeshBuilder();
  const W = (bone) => [[B[bone], 1]];

  // Torso: pelvis -> chest -> neck base.
  const torso = [
    [0.80, 0.105, 0.070, [['pelvis', 1]]],
    [0.86, 0.158, 0.092, [['pelvis', 1]]],
    [0.94, 0.175, 0.106, [['pelvis', 1]]],
    [1.02, 0.16, 0.106, [['pelvis', 0.6], ['spine', 0.4]]],
    [1.10, 0.148, 0.100, [['spine', 1]]],
    [1.19, 0.158, 0.104, [['spine', 0.5], ['chest', 0.5]]],
    [1.28, 0.176, 0.112, [['chest', 1]]],
    [1.36, 0.190, 0.108, [['chest', 1]]],
    [1.41, 0.172, 0.100, [['chest', 0.9], ['neck', 0.1]]],
    [1.445, 0.118, 0.080, [['chest', 0.7], ['neck', 0.3]]],
    [1.47, 0.066, 0.060, [['neck', 0.6], ['chest', 0.4]]],
  ].map(([y, rx, rz, bw], i) => ({ c: [0, y, rz > 0.1 ? 0.004 : 0], rx, rz, dir: [0, 1, 0], bw: bw.map(([n, w]) => [B[n], w]), param: y }));
  loft(mb, torso, { zone: ZONE.TORSO, seg: 14 });

  // Neck.
  const neck = [1.44, 1.48, 1.52, 1.56].map((y, i) => ({ c: [0, y, 0.008], rx: 0.05, rz: 0.052, dir: [0, 1, 0], bw: [[B.neck, 1 - i * 0.2], [B.head, i * 0.2]], param: (y - 1.44) / 0.12 }));
  loft(mb, neck, { zone: ZONE.NECK, seg: 10 });

  // Head profile (chin -> crown).
  const headRings = [
    [1.532, 0.030, 0.040, 0.030],
    [1.548, 0.052, 0.060, 0.022],
    [1.572, 0.069, 0.078, 0.016],
    [1.600, 0.078, 0.089, 0.011],
    [1.630, 0.081, 0.094, 0.008],
    [1.665, 0.080, 0.094, 0.006],
    [1.700, 0.074, 0.088, 0.004],
    [1.733, 0.056, 0.068, 0.0],
    [1.752, 0.020, 0.028, -0.004],
  ].map(([y, rx, rz, z]) => ({ c: [0, y, z], rx, rz, dir: [0, 1, 0], bw: W('head'), param: y }));
  loft(mb, headRings, { zone: ZONE.SKIN, seg: 16, capStart: true, capEnd: true });

  // Face details.
  for (const s of [-1, 1]) {
    ellipsoid(mb, [s * 0.031, 1.647, 0.089], 0.0105, 0.0085, 0.006, W('head'), { zone: ZONE.EYE, seg: 8, rings: 4 });
    boxMesh(mb, [s * 0.032, 1.676, 0.090], 0.032, 0.0055, 0.008, W('head'), { zone: ZONE.BROW });
    ellipsoid(mb, [s * 0.082, 1.636, 0.0], 0.007, 0.022, 0.013, W('head'), { zone: ZONE.SKIN, seg: 8, rings: 4 });
  }
  ellipsoid(mb, [0, 1.618, 0.096], 0.011, 0.02, 0.016, W('head'), { zone: ZONE.SKIN, seg: 8, rings: 4 });
  ellipsoid(mb, [0, 1.583, 0.087], 0.023, 0.0055, 0.008, W('head'), { zone: ZONE.LIPS, seg: 8, rings: 3 });

  // Legs and arms as chains.
  const pathRings = (pts, radii, bones, joints, seg, param0 = 0) => {
    // pts: polyline [[x,y,z]...]; returns ring list sampled every ~0.05 m.
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + len(sub(pts[i], pts[i - 1])));
    const total = lens[lens.length - 1];
    const rings = [];
    const n = Math.max(3, Math.round(total / 0.05));
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * total;
      let i = 1;
      while (i < pts.length - 1 && lens[i] < s) i++;
      const t = (s - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
      const c = add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t));
      const dir = norm(sub(pts[i], pts[i - 1]));
      // radii interpolate over the whole path
      const u = s / total;
      let r = radii[0];
      for (let j = 1; j < radii.length; j++) {
        const a = (j - 1) / (radii.length - 1);
        const b = j / (radii.length - 1);
        if (u >= a && u <= b) {
          const f = (u - a) / (b - a);
          r = [radii[j - 1][0] + (radii[j][0] - radii[j - 1][0]) * f, radii[j - 1][1] + (radii[j][1] - radii[j - 1][1]) * f];
        }
      }
      rings.push({ c, rx: r[0], rz: r[1], dir, bw: chainWeights(s, bones, joints, h), param: param0 + u });
    }
    return rings;
  };
  const h = 0.05;
  for (const side of [1, -1]) {
    const L = side > 0 ? 'L' : 'R';
    const bp = (n) => BONES[B[n]].pos;
    const thighPts = [[side * 0.085, 0.93, 0], [side * 0.088, 0.71, 0.005], [side * 0.09, 0.5, 0.008], [side * 0.09, 0.3, 0.0], [side * 0.09, 0.105, 0]];
    const jl = [len(sub(thighPts[2], thighPts[0]))];
    const legRings = pathRings(
      thighPts,
      [[0.088, 0.09], [0.078, 0.082], [0.058, 0.06], [0.052, 0.062], [0.034, 0.036]],
      [B[`thigh${L}`], B[`shin${L}`]],
      jl,
      10,
    );
    loft(mb, legRings, { zone: ZONE.LEG, seg: 10 });
    // Shoe.
    const shoe = [
      [-0.055, 0.036, 0.040, 0.05],
      [-0.01, 0.040, 0.046, 0.052],
      [0.05, 0.042, 0.038, 0.048],
      [0.10, 0.040, 0.030, 0.038],
      [0.155, 0.028, 0.020, 0.028],
    ].map(([z, rx, ry, y]) => ({ c: [side * 0.09, y, z], rx, rz: ry, dir: [0, 0, 1], bw: W(`foot${L}`), param: 1 }));
    loft(mb, shoe, { zone: ZONE.SHOE, seg: 10, capStart: true, capEnd: true });
    // Arm.
    const armPts = [[side * 0.185, 1.415, 0], [side * 0.205, 1.28, 0], [side * 0.225, 1.14, 0.005], [side * 0.235, 1.015, 0.005], [side * 0.245, 0.9, 0.006]];
    const aj = [len(sub(armPts[2], armPts[0]))];
    const armRings = pathRings(
      armPts,
      [[0.052, 0.052], [0.046, 0.046], [0.038, 0.038], [0.032, 0.032], [0.026, 0.026]],
      [B[`upperArm${L}`], B[`lowerArm${L}`]],
      aj,
      10,
    );
    // Shoulder joins the torso: blend the top of the arm into the chest.
    armRings.forEach((r, i) => {
      if (i < 2) r.bw = [[B[`upperArm${L}`], 0.75], [B.chest, 0.25]];
    });
    loft(mb, armRings, { zone: ZONE.ARM, seg: 10 });
    // Rounded shoulder that covers the arm opening and softens the torso to arm step.
    ellipsoid(mb, [side * 0.184, 1.384, 0.0], 0.054, 0.050, 0.056, [[B[`upperArm${L}`], 0.8], [B.chest, 0.2]], { zone: ZONE.ARM, param: 0, seg: 10, rings: 5 });
    // Hand.
    const hand = [
      [0.9, 0.028, 0.017],
      [0.865, 0.038, 0.019],
      [0.83, 0.040, 0.018],
      [0.795, 0.033, 0.015],
      [0.775, 0.018, 0.011],
    ].map(([y, rx, rz]) => ({ c: [side * 0.248, y, 0.008], rx, rz, dir: [0, -1, 0], bw: W(`hand${L}`), param: 1 }));
    loft(mb, hand, { zone: ZONE.ARM, seg: 8, capEnd: true });
    void bp;
  }

  // Hair variants around the head. Each set carries its variant id and is culled in the
  // shader unless the instance uses it.
  const cap = (scale, yMin, yFront, variant, extra = 0) => {
    const rs = [
      [1.598, 0.078, 0.089, 0.011],
      [1.630, 0.081, 0.094, 0.008],
      [1.665, 0.080, 0.094, 0.006],
      [1.700, 0.074, 0.088, 0.004],
      [1.733, 0.056, 0.068, 0.0],
      [1.755, 0.022, 0.03, -0.004],
    ];
    const rings = rs
      .filter((r) => r[0] >= yMin)
      .map(([y, rx, rz, z]) => ({ c: [0, y + extra, z - 0.004], rx: rx * scale, rz: rz * scale, dir: [0, 1, 0], bw: W('head'), param: y }));
    const range = loft(mb, rings, { zone: ZONE.HAIR, variant, seg: 18, capEnd: true });
    // Remove the front of the cap below the hairline (face opening).
    const keep = [];
    for (let i = 0; i < mb.idx.length; i += 3) keep.push(i);
    void keep;
    void range;
    void yFront;
  };
  // A cleaner way to get a hairline: build the cap from ring arcs that skip the face.
  const hairCap = (variant, scale, yBottomBack, yBottomFront, volume = 0) => {
    const rs = [
      [1.560, 0.062, 0.074, 0.010],
      [1.598, 0.078, 0.089, 0.011],
      [1.630, 0.081, 0.094, 0.008],
      [1.665, 0.080, 0.094, 0.006],
      [1.700, 0.074, 0.088, 0.004],
      [1.733, 0.056, 0.068, 0.0],
      [1.755, 0.022, 0.03, -0.004],
    ];
    const seg = 20;
    const ids = [];
    const used = [];
    rs.forEach(([y, rx, rz, z], ri) => {
      const row = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const front = Math.sin(a); // +z is front in this parametrisation
        const yBottom = front > 0.2 ? yBottomFront : yBottomBack;
        const px = Math.cos(a) * rx * scale * (1 + volume);
        const pz = z + front * rz * scale * (1 + volume * 0.6);
        row.push(y >= yBottom - 0.001 ? mb.vert([px, y, pz], ZONE.HAIR, y, variant, W('head')) : -1);
      }
      ids.push(row);
      used.push(y);
    });
    for (let i = 0; i + 1 < ids.length; i++) {
      for (let k = 0; k < seg; k++) {
        const a = ids[i][k];
        const b = ids[i][(k + 1) % seg];
        const c = ids[i + 1][(k + 1) % seg];
        const d = ids[i + 1][k];
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          mb.tri(a, c, b);
          mb.tri(a, d, c);
        }
      }
    }
    const top = ids[ids.length - 1];
    const centre = mb.vert([0, 1.758, -0.004], ZONE.HAIR, 1.758, variant, W('head'));
    for (let k = 0; k < seg; k++) if (top[k] >= 0 && top[(k + 1) % seg] >= 0) mb.tri(centre, top[(k + 1) % seg], top[k]);
  };
  void cap;
  hairCap(0, 1.06, 1.60, 1.685); // short
  hairCap(1, 1.07, 1.56, 1.680, 0.02); // long: base
  hairCap(2, 1.06, 1.60, 1.680); // ponytail: base
  hairCap(3, 1.015, 1.65, 1.700); // buzz
  // Long hair falls to the shoulders behind the head.
  {
    const rings = [1.62, 1.55, 1.48, 1.40, 1.33].map((y, i) => ({ c: [0, y, -0.062 - i * 0.004], rx: 0.088 - i * 0.004, rz: 0.03, dir: [0, -1, 0], bw: i < 2 ? W('head') : [[B.head, 0.6], [B.neck, 0.4]], param: y }));
    loft(mb, rings, { zone: ZONE.HAIR, variant: 1, seg: 10, capEnd: true });
  }
  // Ponytail tail.
  {
    const rings = [[1.72, -0.07], [1.68, -0.105], [1.62, -0.125], [1.55, -0.12], [1.50, -0.105]].map(([y, z], i) => ({ c: [0, y, z], rx: 0.026 - i * 0.003, rz: 0.026 - i * 0.003, dir: [0, -1, -0.4], bw: W('head'), param: y }));
    loft(mb, rings, { zone: ZONE.HAIR, variant: 2, seg: 8, capEnd: true });
  }

  // Wraps: hood (variant 0) and headscarf (variant 1).
  {
    const rings = [1.66, 1.62, 1.57, 1.52, 1.47].map((y, i) => ({ c: [0, y, -0.055 - i * 0.004], rx: 0.115 - i * 0.008, rz: 0.06 - i * 0.004, dir: [0, -1, 0], bw: i < 2 ? W('head') : [[B.head, 0.5], [B.neck, 0.5]], param: y }));
    loft(mb, rings, { zone: ZONE.WRAP, variant: 0, seg: 12, capStart: true, capEnd: true });
    // Headscarf: cap that covers hair, forehead framed, falling over neck and shoulders.
    const scarf = [];
    const seg = 20;
    const rs = [
      [1.350, 0.218, 0.146, -0.006],
      [1.400, 0.198, 0.136, -0.006],
      [1.450, 0.150, 0.118, -0.006],
      [1.505, 0.108, 0.104, -0.004],
      [1.565, 0.098, 0.102, 0.0],
      [1.605, 0.092, 0.100, 0.004],
      [1.640, 0.090, 0.101, 0.006],
      [1.680, 0.086, 0.097, 0.005],
      [1.720, 0.070, 0.082, 0.0],
      [1.750, 0.04, 0.05, -0.004],
    ];
    const ids = [];
    rs.forEach(([y, rx, rz, z]) => {
      const row = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const front = Math.sin(a);
        const cx = Math.cos(a);
        // Face opening: skip the front arc between chin and hairline.
        const isFace = front > 0.35 && Math.abs(cx) < 0.62 && y > 1.535 && y < 1.695;
        row.push(isFace ? -1 : mb.vert([cx * rx, y, z + front * rz], ZONE.WRAP, y, 1, y < 1.42 ? [[B.chest, 0.8], [B.neck, 0.2]] : y < 1.55 ? [[B.head, 0.5], [B.neck, 0.5]] : W('head')));
      }
      ids.push(row);
    });
    for (let i = 0; i + 1 < ids.length; i++) {
      for (let k = 0; k < seg; k++) {
        const a = ids[i][k];
        const b = ids[i][(k + 1) % seg];
        const c = ids[i + 1][(k + 1) % seg];
        const d = ids[i + 1][k];
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          mb.tri(a, c, b);
          mb.tri(a, d, c);
        }
      }
    }
    const top = ids[ids.length - 1];
    const centre = mb.vert([0, 1.756, -0.004], ZONE.WRAP, 1.756, 1, W('head'));
    for (let k = 0; k < seg; k++) if (top[k] >= 0 && top[(k + 1) % seg] >= 0) mb.tri(centre, top[(k + 1) % seg], top[k]);
    void scarf;
  }

  // Skirt (cone around the thighs).
  {
    const rings = [0.96, 0.84, 0.72, 0.60, 0.50].map((y, i) => ({ c: [0, y, 0.002], rx: 0.185 + i * 0.03, rz: 0.13 + i * 0.024, dir: [0, -1, 0], bw: i < 2 ? W('pelvis') : [[B.pelvis, 0.5], [B.thighL, 0.25], [B.thighR, 0.25]], param: y }));
    loft(mb, rings, { zone: ZONE.SKIRT, seg: 14, capStart: false });
  }

  // Accessories.
  const accBW = (n) => W(n);
  // backpack + straps
  boxMesh(mb, [0, 1.20, -0.155], 0.30, 0.38, 0.13, accBW('chest'), { zone: ZONE.ACC, variant: ACC.BACKPACK });
  for (const s of [-1, 1]) boxMesh(mb, [s * 0.10, 1.29, 0.005], 0.035, 0.28, 0.20, accBW('chest'), { zone: ZONE.ACC, variant: ACC.BACKPACK });
  // shoulder bag: body at the hip on the left side plus a strap
  boxMesh(mb, [0.26, 0.98, 0.0], 0.10, 0.24, 0.30, accBW('pelvis'), { zone: ZONE.ACC, variant: ACC.SHOULDERBAG });
  // glasses
  for (const s of [-1, 1]) {
    boxMesh(mb, [s * 0.032, 1.647, 0.099], 0.040, 0.004, 0.004, accBW('head'), { zone: ZONE.ACC, variant: ACC.GLASSES });
    boxMesh(mb, [s * 0.032, 1.630, 0.099], 0.040, 0.004, 0.004, accBW('head'), { zone: ZONE.ACC, variant: ACC.GLASSES });
    boxMesh(mb, [s * 0.052, 1.638, 0.099], 0.004, 0.028, 0.004, accBW('head'), { zone: ZONE.ACC, variant: ACC.GLASSES });
    boxMesh(mb, [s * 0.012, 1.638, 0.099], 0.004, 0.028, 0.004, accBW('head'), { zone: ZONE.ACC, variant: ACC.GLASSES });
    boxMesh(mb, [s * 0.078, 1.645, 0.05], 0.004, 0.004, 0.09, accBW('head'), { zone: ZONE.ACC, variant: ACC.GLASSES });
  }
  // cup in the left hand, book and phone in the right hand
  loft(mb, [0.79, 0.85, 0.89].map((y, i) => ({ c: [0.262, y, 0.03], rx: 0.03 + i * 0.006, rz: 0.03 + i * 0.006, dir: [0, 1, 0], bw: W('handL'), param: 0 })), { zone: ZONE.ACC, variant: ACC.CUP, seg: 10, capStart: true, capEnd: true });
  boxMesh(mb, [-0.262, 0.83, 0.05], 0.15, 0.022, 0.21, accBW('handR'), { zone: ZONE.ACC, variant: ACC.BOOK });
  boxMesh(mb, [-0.262, 0.84, 0.04], 0.07, 0.008, 0.14, accBW('handR'), { zone: ZONE.ACC, variant: ACC.PHONE });

  return mb;
}

// ------------------------------------------------------------------ animation
const rot = (x = 0, y = 0, z = 0) => [x, y, z];
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const wrap01 = (x) => x - Math.floor(x);

function neutral() {
  const p = { rootPos: [0, 0, 0], rootYaw: 0 };
  for (const b of BONES) p[b.name] = rot();
  return p;
}

// Semantic helpers: forward flexion of a limb hanging down = negative rotation about X.
const F = (a) => rot(-a, 0, 0);

function legPose(p, side, ph, amp, kneeAmp) {
  const L = side > 0 ? 'L' : 'R';
  const thigh = amp * Math.cos(2 * Math.PI * ph) - 0.04;
  const knee = 0.28 * bump(ph, 0.12, 0.09) + kneeAmp * bump(ph, 0.72, 0.13) + 0.04;
  p[`thigh${L}`] = F(thigh);
  p[`shin${L}`] = rot(knee, 0, 0);
  p[`foot${L}`] = F(-(thigh - knee) * 0.75 + 0.18 * bump(ph, 0.02, 0.05) - 0.3 * bump(ph, 0.6, 0.08));
}

const CLIPS = {
  idle: {
    frames: 72, fps: 12, loop: true, nominal: 0,
    pose(t, T) {
      const p = neutral();
      const w = (2 * Math.PI * t) / T;
      p.pelvis = rot(0, 0.03 * Math.sin(w), 0.025 * Math.sin(w * 2));
      p.rootPos = [0.006 * Math.sin(w * 2), 0, 0];
      p.spine = rot(0.015 * Math.sin(w * 3), -0.02 * Math.sin(w * 2), -0.02 * Math.sin(w * 2));
      p.chest = rot(0.012 * Math.sin(w * 3 + 0.4), 0, 0);
      p.head = rot(0.03 * Math.sin(w * 2), 0.22 * Math.sin(w), 0);
      p.upperArmL = rot(0.02 * Math.sin(w * 3), 0, 0.06 + 0.02 * Math.sin(w * 2));
      p.upperArmR = rot(0.02 * Math.sin(w * 3 + 1), 0, -0.06 - 0.02 * Math.sin(w * 2));
      p.lowerArmL = F(0.18);
      p.lowerArmR = F(0.18);
      p.thighL = rot(0, 0, 0.02);
      p.thighR = rot(0, 0, -0.02);
      return p;
    },
    T: 6,
  },
  walk: {
    frames: 32, fps: 32, loop: true, nominal: 1.4,
    T: 1.0,
    pose(t, T) {
      const p = neutral();
      const ph = wrap01(t / T);
      const w = 2 * Math.PI * ph;
      legPose(p, 1, ph, 0.42, 1.0);
      legPose(p, -1, wrap01(ph + 0.5), 0.42, 1.0);
      p.rootPos = [0.012 * Math.sin(w), -0.022 * Math.cos(2 * w) - 0.012, 0];
      p.pelvis = rot(0.02, 0.11 * Math.sin(w), 0.04 * Math.sin(w));
      p.spine = rot(0.05, -0.08 * Math.sin(w), -0.03 * Math.sin(w));
      p.chest = rot(0.02, -0.1 * Math.sin(w), 0);
      p.head = rot(0.0, 0.03 * Math.sin(w), 0);
      const aL = -0.42 * Math.cos(w);
      p.upperArmL = rot(-aL, 0, 0.05);
      p.upperArmR = rot(aL, 0, -0.05);
      p.lowerArmL = F(0.28 + 0.22 * Math.max(0, -aL / 0.42));
      p.lowerArmR = F(0.28 + 0.22 * Math.max(0, aL / 0.42));
      return p;
    },
  },
  run: {
    frames: 24, fps: 36, loop: true, nominal: 3.4,
    T: 0.66,
    pose(t, T) {
      const p = neutral();
      const ph = wrap01(t / T);
      const w = 2 * Math.PI * ph;
      legPose(p, 1, ph, 0.7, 1.7);
      legPose(p, -1, wrap01(ph + 0.5), 0.7, 1.7);
      p.rootPos = [0.01 * Math.sin(w), -0.05 * Math.cos(2 * w) - 0.05, 0];
      p.pelvis = rot(0.12, 0.16 * Math.sin(w), 0.04 * Math.sin(w));
      p.spine = rot(0.1, -0.12 * Math.sin(w), 0);
      p.chest = rot(0.06, -0.14 * Math.sin(w), 0);
      const aL = -0.75 * Math.cos(w);
      p.upperArmL = rot(-aL, 0, 0.1);
      p.upperArmR = rot(aL, 0, -0.1);
      p.lowerArmL = F(1.25);
      p.lowerArmR = F(1.25);
      return p;
    },
  },
  talk: {
    frames: 90, fps: 15, loop: true, nominal: 0,
    T: 6,
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T);
      const w = (2 * Math.PI * t) / T;
      const g = 0.5 + 0.5 * Math.sin(w * 3);
      p.upperArmR = rot(-0.7 - 0.25 * g, 0, -0.35);
      p.lowerArmR = F(1.35 + 0.35 * Math.sin(w * 6));
      p.handR = rot(0.3 * Math.sin(w * 6), 0, 0.2 * Math.sin(w * 3));
      p.upperArmL = rot(-0.25 - 0.15 * Math.sin(w * 2 + 1), 0, 0.15);
      p.lowerArmL = F(0.9 + 0.3 * Math.sin(w * 4));
      p.head = rot(0.04 + 0.05 * Math.sin(w * 6), 0.2 * Math.sin(w * 1), 0);
      return p;
    },
  },
  phone: {
    frames: 60, fps: 12, loop: true, nominal: 0,
    T: 5,
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T);
      const w = (2 * Math.PI * t) / T;
      p.upperArmR = rot(-0.75, 0, -0.1);
      p.lowerArmR = F(1.75);
      p.handR = rot(0.5, 0, 0);
      p.upperArmL = rot(-0.15, 0, 0.1);
      p.lowerArmL = F(0.6);
      p.head = rot(0.42 + 0.03 * Math.sin(w * 4), 0.05 * Math.sin(w), 0);
      p.chest = rot(0.08, 0, 0);
      p.handR = rot(0.5 + 0.06 * Math.sin(w * 8), 0, 0);
      return p;
    },
  },
  wave: {
    frames: 30, fps: 15, loop: true, nominal: 0,
    T: 2,
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T * 3);
      const w = (2 * Math.PI * t) / T;
      p.upperArmR = rot(-0.2, 0, -2.5);
      p.lowerArmR = rot(0, 0, 0.7 * Math.sin(w * 3) + 0.2);
      p.handR = rot(0, 0, 0.3 * Math.sin(w * 3));
      p.head = rot(0.0, 0.25, 0);
      return p;
    },
  },
  carry: {
    frames: 32, fps: 32, loop: true, nominal: 1.4,
    T: 1.0,
    pose(t, T) {
      const p = CLIPS.walk.pose(t, T);
      p.upperArmL = rot(-0.65, 0, 0.35);
      p.upperArmR = rot(-0.65, 0, -0.35);
      p.lowerArmL = F(1.9);
      p.lowerArmR = F(1.9);
      p.handL = rot(0.3, 0, 0);
      p.handR = rot(0.3, 0, 0);
      p.chest = rot(-0.02, 0, 0);
      return p;
    },
  },
  drink: {
    frames: 72, fps: 12, loop: true, nominal: 0,
    T: 6,
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T);
      const u = wrap01(t / T);
      const up = smooth(0.25, 0.42, u) * (1 - smooth(0.55, 0.72, u));
      p.upperArmL = rot(-0.45 - 0.3 * up, 0, 0.25 - 0.1 * up);
      p.lowerArmL = F(1.55 + 0.75 * up);
      p.handL = rot(0.5 * up, 0, 0);
      p.head = rot(-0.1 * up + 0.03, 0.15, 0);
      return p;
    },
  },
  work: {
    frames: 60, fps: 15, loop: true, nominal: 0,
    T: 4,
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T * 2);
      const w = (2 * Math.PI * t) / T;
      p.upperArmL = rot(-0.65, 0, 0.2);
      p.upperArmR = rot(-0.6 + 0.08 * Math.sin(w * 2), 0, -0.2);
      p.lowerArmL = F(1.15 + 0.15 * Math.sin(w * 2));
      p.lowerArmR = F(1.2 + 0.2 * Math.sin(w * 2 + 1));
      p.head = rot(0.25, 0.3 * Math.sin(w), 0);
      p.chest = rot(0.06, 0.15 * Math.sin(w), 0);
      return p;
    },
  },
  lecture: {
    frames: 90, fps: 12, loop: true, nominal: 0,
    T: 8,
    pose(t, T) {
      const p = CLIPS.talk.pose(t, T * 0.75);
      const w = (2 * Math.PI * t) / T;
      p.pelvis = rot(0, 0.25 * Math.sin(w), 0.03);
      p.chest = rot(0, -0.1 * Math.sin(w), 0);
      p.head = rot(0.03, 0.4 * Math.sin(w), 0);
      return p;
    },
  },
};

// Root drop of a seated person: the seat surface is SEAT_HEIGHT above the floor.
export const SEAT_HEIGHT = 0.47;
const SIT_DROP = 0.36;

// Walk cycle with the right hand holding a phone in front of the chest.
CLIPS.walkPhone = {
  frames: 32, fps: 32, loop: true, nominal: 1.4, T: 1.0,
  pose(t, T) {
    const p = CLIPS.walk.pose(t, T);
    const w = (2 * Math.PI * t) / T;
    p.upperArmR = rot(-0.75, 0, -0.1);
    p.lowerArmR = F(1.75);
    p.handR = rot(0.5, 0, 0);
    p.chest = rot(0.06, -0.05 * Math.sin(w), 0);
    p.head = rot(0.33, 0.03 * Math.sin(w), 0);
    return p;
  },
};

function sitBase(t, T) {
  const p = CLIPS.idle.pose(t, T);
  const w = (2 * Math.PI * t) / T;
  p.rootPos = [0, -SIT_DROP, 0];
  p.pelvis = rot(0.02, 0.02 * Math.sin(w), 0.01 * Math.sin(w * 2));
  p.thighL = rot(-1.42, 0, 0.09);
  p.thighR = rot(-1.42, 0, -0.09);
  p.shinL = rot(1.44, 0, 0);
  p.shinR = rot(1.44, 0, 0);
  p.footL = rot(-0.05, 0, 0);
  p.footR = rot(-0.05, 0, 0);
  p.spine = rot(0.07 + 0.012 * Math.sin(w * 3), 0, 0);
  p.chest = rot(0.04, 0, 0);
  p.upperArmL = rot(-0.35, 0, 0.12);
  p.upperArmR = rot(-0.35, 0, -0.12);
  p.lowerArmL = F(1.35);
  p.lowerArmR = F(1.35);
  return p;
}

Object.assign(CLIPS, {
  sit: {
    frames: 72, fps: 12, loop: true, nominal: 0, T: 6,
    pose(t, T) {
      return sitBase(t, T);
    },
  },
  sitWrite: {
    frames: 72, fps: 15, loop: true, nominal: 0, T: 4,
    pose(t, T) {
      const p = sitBase(t, T * 1.5);
      const w = (2 * Math.PI * t) / T;
      p.upperArmR = rot(-0.6, 0, -0.1);
      p.lowerArmR = F(1.45 + 0.05 * Math.sin(w * 6));
      p.handR = rot(0.1 * Math.sin(w * 9), 0, 0.15 * Math.sin(w * 7));
      p.upperArmL = rot(-0.5, 0, 0.1);
      p.lowerArmL = F(1.3);
      p.spine = rot(0.16, 0, 0);
      p.head = rot(0.5 + 0.03 * Math.sin(w * 2), 0.08 * Math.sin(w), 0);
      return p;
    },
  },
  sitPhone: {
    frames: 60, fps: 12, loop: true, nominal: 0, T: 5,
    pose(t, T) {
      const p = sitBase(t, T);
      const w = (2 * Math.PI * t) / T;
      p.upperArmR = rot(-0.8, 0, -0.1);
      p.lowerArmR = F(1.8);
      p.handR = rot(0.5 + 0.06 * Math.sin(w * 8), 0, 0);
      p.upperArmL = rot(-0.4, 0, 0.1);
      p.lowerArmL = F(1.2);
      p.head = rot(0.45, 0.04 * Math.sin(w), 0);
      p.spine = rot(0.14, 0, 0);
      return p;
    },
  },
  sitType: {
    frames: 60, fps: 15, loop: true, nominal: 0, T: 4,
    pose(t, T) {
      const p = sitBase(t, T);
      const w = (2 * Math.PI * t) / T;
      p.upperArmL = rot(-0.7, 0, 0.12);
      p.upperArmR = rot(-0.7, 0, -0.12);
      p.lowerArmL = F(1.15 + 0.03 * Math.sin(w * 10));
      p.lowerArmR = F(1.15 + 0.03 * Math.sin(w * 13));
      p.handL = rot(0.15 * Math.sin(w * 11), 0, 0);
      p.handR = rot(0.15 * Math.sin(w * 9 + 1), 0, 0);
      p.spine = rot(0.14, 0, 0);
      p.head = rot(0.3 + 0.04 * Math.sin(w), 0.1 * Math.sin(w * 0.5), 0);
      return p;
    },
  },
  sitTalk: {
    frames: 90, fps: 15, loop: true, nominal: 0, T: 6,
    pose(t, T) {
      const p = sitBase(t, T);
      const w = (2 * Math.PI * t) / T;
      p.upperArmR = rot(-0.55 - 0.2 * Math.sin(w * 3), 0, -0.3);
      p.lowerArmR = F(1.5 + 0.3 * Math.sin(w * 6));
      p.head = rot(0.03 + 0.05 * Math.sin(w * 6), 0.25 * Math.sin(w), 0);
      return p;
    },
  },
  sitRead: {
    frames: 60, fps: 10, loop: true, nominal: 0, T: 6,
    pose(t, T) {
      const p = sitBase(t, T);
      const w = (2 * Math.PI * t) / T;
      p.upperArmL = rot(-0.7, 0, 0.35);
      p.upperArmR = rot(-0.7, 0, -0.35);
      p.lowerArmL = F(1.85);
      p.lowerArmR = F(1.85);
      p.spine = rot(0.12, 0, 0);
      p.head = rot(0.38 + 0.04 * Math.sin(w * 2), 0.06 * Math.sin(w), 0);
      return p;
    },
  },
  sitGround: {
    frames: 72, fps: 12, loop: true, nominal: 0, T: 6,
    // Sitting on the floor with the legs out in front, leaning back on the hands.
    pose(t, T) {
      const p = CLIPS.idle.pose(t, T);
      const w = (2 * Math.PI * t) / T;
      p.rootPos = [0, -0.80, 0];
      p.thighL = rot(-1.53, 0, 0.16);
      p.thighR = rot(-1.53, 0, -0.16);
      p.shinL = rot(0.03, 0, 0);
      p.shinR = rot(0.03, 0, 0);
      p.footL = rot(-0.1, 0, 0);
      p.footR = rot(-0.1, 0, 0);
      p.pelvis = rot(-0.12, 0, 0);
      p.spine = rot(-0.1, 0, 0);
      p.chest = rot(-0.05, 0, 0);
      p.upperArmL = rot(0.55, 0, 0.18);
      p.upperArmR = rot(0.55, 0, -0.18);
      p.lowerArmL = F(0.05);
      p.lowerArmR = F(0.05);
      p.head = rot(0.03 * Math.sin(w * 2), 0.3 * Math.sin(w), 0);
      return p;
    },
  },
});

export const CLIP_NAMES = Object.keys(CLIPS);
export const CLIP_DEFS = CLIPS;

// -------------------------------------------------------------------- baking
function eulerMatrix(r) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
}

// Forward kinematics of a pose -> skinning matrices per bone.
function skinMatrices(pose, bind, inv) {
  const world = new Array(BONES.length);
  const out = new Array(BONES.length);
  BONES.forEach((bone, i) => {
    const local = new THREE.Matrix4();
    const parentPos = bone.parent >= 0 ? BONES[bone.parent].pos : [0, 0, 0];
    const off = [bone.pos[0] - parentPos[0], bone.pos[1] - parentPos[1], bone.pos[2] - parentPos[2]];
    local.makeTranslation(off[0], off[1], off[2]);
    if (i === 0) {
      local.makeTranslation(pose.rootPos[0], pose.rootPos[1], pose.rootPos[2]);
      local.multiply(new THREE.Matrix4().makeRotationY(pose.rootYaw));
    } else if (i === 1) {
      local.makeTranslation(off[0], off[1], off[2]);
      local.multiply(eulerMatrix(pose[bone.name]));
    } else {
      local.multiply(eulerMatrix(pose[bone.name]));
    }
    world[i] = bone.parent >= 0 ? new THREE.Matrix4().multiplyMatrices(world[bone.parent], local) : local;
    out[i] = new THREE.Matrix4().multiplyMatrices(world[i], inv[i]);
  });
  void bind;
  return out;
}

// Builds the render geometry plus baked animation textures.
export function buildHuman() {
  const mb = buildHumanMesh();
  const V = mb.count;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mb.pos, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(mb.info, 4));
  geo.setIndex(mb.idx);
  geo.computeVertexNormals();
  const bindNormals = geo.attributes.normal.array;

  // Bind matrices (pure translations to joint positions) and inverses.
  const bind = BONES.map((b) => new THREE.Matrix4().makeTranslation(b.pos[0], b.pos[1], b.pos[2]));
  const inv = bind.map((m) => m.clone().invert());

  // Rows: each frame stores V texels; wide textures wrap into multiple rows.
  const TEX_W = 2048;
  const rowsPerFrame = Math.ceil(V / TEX_W);
  const clips = {};
  let frameCursor = 0;
  for (const name of CLIP_NAMES) {
    const def = CLIPS[name];
    clips[name] = { name, start: frameCursor, frames: def.frames, fps: def.fps, loop: def.loop, nominal: def.nominal, duration: def.frames / def.fps };
    frameCursor += def.frames;
  }
  const totalFrames = frameCursor;
  const rows = totalFrames * rowsPerFrame;
  const posData = new Uint16Array(TEX_W * rows * 4);
  const nrmData = new Uint16Array(TEX_W * rows * 4);
  const H = THREE.DataUtils.toHalfFloat;

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const name of CLIP_NAMES) {
    const def = CLIPS[name];
    const clip = clips[name];
    for (let f = 0; f < def.frames; f++) {
      const t = (f / def.frames) * (def.T ?? def.frames / def.fps);
      const pose = def.pose(t, def.T ?? def.frames / def.fps);
      const mats = skinMatrices(pose, bind, inv);
      const base = (clip.start + f) * rowsPerFrame * TEX_W;
      for (let i = 0; i < V; i++) {
        acc.set(0, 0, 0);
        accN.set(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const w = mb.weights[i * 4 + k];
          if (w <= 0) continue;
          const m = mats[mb.bones[i * 4 + k]];
          v.set(mb.pos[i * 3], mb.pos[i * 3 + 1], mb.pos[i * 3 + 2]).applyMatrix4(m);
          acc.addScaledVector(v, w);
          nm.setFromMatrix4(m);
          n.set(bindNormals[i * 3], bindNormals[i * 3 + 1], bindNormals[i * 3 + 2]).applyMatrix3(nm);
          accN.addScaledVector(n, w);
        }
        accN.normalize();
        const o = (base + i) * 4;
        posData[o] = H(acc.x);
        posData[o + 1] = H(acc.y);
        posData[o + 2] = H(acc.z);
        posData[o + 3] = H(1);
        nrmData[o] = H(accN.x);
        nrmData[o + 1] = H(accN.y);
        nrmData[o + 2] = H(accN.z);
        nrmData[o + 3] = H(0);
      }
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, TEX_W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { geometry: geo, posTex: mk(posData), nrmTex: mk(nrmData), texWidth: TEX_W, rowsPerFrame, clips, vertexCount: V, totalFrames };
}
