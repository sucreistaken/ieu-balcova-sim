// Geometry helpers: merge several coloured parts into one BufferGeometry.

import * as THREE from 'three';
import { hash01 } from './util.js';

export const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// parts: [{ geo, color: [r, g, b] }]. Adds a subtle per-vertex tone jitter.
export function mergeParts(parts, jitter = 0.16) {
  const pos = [];
  const nor = [];
  const col = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const j = 1 - jitter / 2 + hash01(Math.floor(p.getX(i) * 91 + p.getY(i) * 47 + p.getZ(i) * 13) & 0xffff) * jitter;
      col.push(color[0] * j, color[1] * j, color[2] * j);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// Box with its base at y = y0 (default 0), centred in x/z, offset by (x, z).
export function boxAt(w, h, d, x = 0, y0 = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y0 + h / 2, z);
  return g;
}

export function cylAt(rTop, rBot, h, seg, x = 0, y0 = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y0 + h / 2, z);
  return g;
}
