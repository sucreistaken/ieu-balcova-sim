// Paints top-down ground textures (land cover, roads, footpaths) from the OSM dataset.
// One high resolution canvas covers the fine core around the campus, a second lower
// resolution canvas covers the whole regional DEM extent.

import * as THREE from 'three';
import { rng } from './util.js';

const AREA_COL = {
  urban: '#9b9787',
  farmland: '#9a9358',
  scrub: '#70794f',
  forest: '#4b5b36',
  grass: '#7d9250',
  orchard: '#7f8c48',
  cemetery: '#7f8f62',
  institution: '#b8b09f',
  park: '#739450',
  sports: '#5f915a',
  pitch: '#59935a',
  playground: '#a58d6c',
  parking: '#6e7073',
  water: '#4a7fa5',
};

// Campus green areas read as pine groves / gardens rather than lawn.
const NAME_COL = {
  'IEU Arka Bahçe': '#6b6a43',
  'IEU Kedili Park': '#6f7c48',
  'IEU Çiçeklik': '#8d9a52',
  'IEU Çiçeklik 2': '#87964c',
  'IEU Çiçeklik 3': '#87964c',
  'IEU Çiçeklik 4': '#8d9a52',
};

const ROAD_STYLE = {
  primary: { asphalt: '#4b4e53', walk: 2.0, mark: true },
  primary_link: { asphalt: '#4b4e53', walk: 1.2, mark: false },
  secondary: { asphalt: '#4d5055', walk: 2.0, mark: true },
  secondary_link: { asphalt: '#4d5055', walk: 1.2, mark: false },
  tertiary: { asphalt: '#52555a', walk: 1.8, mark: true },
  unclassified: { asphalt: '#575a5f', walk: 1.4, mark: false },
  residential: { asphalt: '#585b60', walk: 1.4, mark: false },
  living_street: { asphalt: '#5c5f63', walk: 1.2, mark: false },
  service: { asphalt: '#62656a', walk: 0.6, mark: false },
  track: { asphalt: '#8b7a5c', walk: 0, mark: false },
};
const WALK_TYPES = new Set(['footway', 'path', 'pedestrian', 'cycleway']);

function noiseTile(size, seed, contrast) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (r() - 0.5) * contrast;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tracePoly(ctx, arr, close) {
  ctx.beginPath();
  for (let i = 0; i < arr.length; i += 2) {
    if (i === 0) ctx.moveTo(arr[i], arr[i + 1]);
    else ctx.lineTo(arr[i], arr[i + 1]);
  }
  if (close) ctx.closePath();
}

// mode: 'core' (fine, with building aprons) | 'far' (regional)
export function paintGround(data, bounds, size, mode, slopeFn) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const sx = size / (bounds.xMax - bounds.xMin);
  const sy = size / (bounds.zMax - bounds.zMin);
  const base = () => ctx.setTransform(sx, 0, 0, sy, -bounds.xMin * sx, -bounds.zMin * sy);
  const px = 1 / Math.min(sx, sy); // metres per pixel
  base();

  // Untagged ground: dry olive grass.
  ctx.fillStyle = '#8d8a74';
  ctx.fillRect(bounds.xMin, bounds.zMin, bounds.xMax - bounds.xMin, bounds.zMax - bounds.zMin);

  // Steep untagged hillside reads as pine forest (regional texture only).
  if (mode === 'far' && slopeFn) {
    const res = 200;
    const small = document.createElement('canvas');
    small.width = small.height = res;
    const sg = small.getContext('2d');
    const img = sg.createImageData(res, res);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = bounds.xMin + ((i + 0.5) / res) * (bounds.xMax - bounds.xMin);
        const z = bounds.zMin + ((j + 0.5) / res) * (bounds.zMax - bounds.zMin);
        const s = slopeFn(x, z);
        const t = Math.min(1, Math.max(0, (s - 0.16) / 0.22));
        const k = (j * res + i) * 4;
        img.data[k] = 141 + (58 - 141) * t;
        img.data[k + 1] = 138 + (84 - 138) * t;
        img.data[k + 2] = 116 + (46 - 116) * t;
        img.data[k + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, size, size);
    base();
  }

  for (const a of data.areas) {
    ctx.fillStyle = NAME_COL[a.name] || AREA_COL[a.kind] || '#8d8a74';
    tracePoly(ctx, a.r, true);
    ctx.fill();
  }

  // Campus plaza tone.
  ctx.fillStyle = '#a49c8a';
  tracePoly(ctx, data.campusRing, true);
  ctx.fill();
  // Named green areas sit on top of the plaza tone.
  for (const a of data.areas) {
    if (!NAME_COL[a.name]) continue;
    ctx.fillStyle = NAME_COL[a.name];
    tracePoly(ctx, a.r, true);
    ctx.fill();
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const vehicular = data.roads.filter((r) => ROAD_STYLE[r.t] && !r.tunnel);
  const walkways = data.roads.filter((r) => WALK_TYPES.has(r.t));
  const steps = data.roads.filter((r) => r.t === 'steps');

  // Sidewalk bands first so junctions merge, then asphalt.
  for (const r of vehicular) {
    const st = ROAD_STYLE[r.t];
    if (st.walk <= 0) continue;
    ctx.strokeStyle = '#a8a396';
    ctx.lineWidth = r.w + st.walk * 2;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  for (const r of vehicular) {
    ctx.strokeStyle = ROAD_STYLE[r.t].asphalt;
    ctx.lineWidth = r.w;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  for (const r of walkways) {
    ctx.strokeStyle = '#cbc2b0';
    ctx.lineWidth = Math.max(r.w, 1.6);
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (const r of steps) {
    ctx.strokeStyle = '#d6ccb4';
    ctx.lineWidth = Math.max(r.w, 1.8);
    ctx.setLineDash([0.32, 0.3]);
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (mode === 'core') {
    ctx.strokeStyle = '#ece8dc';
    ctx.lineWidth = 0.14;
    ctx.setLineDash([2.6, 3.6]);
    for (const r of vehicular) {
      if (!ROAD_STYLE[r.t].mark || r.oneway) continue;
      tracePoly(ctx, r.p, false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#d9d5c8';
    ctx.lineWidth = 0.12;
    for (const r of vehicular) {
      if (!ROAD_STYLE[r.t].mark || r.w < 6) continue;
      // Edge lines on wider roads.
      const p = r.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i];
        const dz = p[i + 3] - p[i + 1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * (r.w / 2 - 0.35);
        const nz = (dx / l) * (r.w / 2 - 0.35);
        for (const s of [1, -1]) {
          ctx.beginPath();
          ctx.moveTo(p[i] + nx * s, p[i + 1] + nz * s);
          ctx.lineTo(p[i + 2] + nx * s, p[i + 3] + nz * s);
          ctx.stroke();
        }
      }
    }
  }

  // Building aprons and under-building ground.
  for (const b of data.buildings) {
    tracePoly(ctx, b.ring, true);
    if (mode === 'core') {
      ctx.strokeStyle = b.campus ? '#c7bfae' : '#a39e92';
      ctx.lineWidth = b.campus ? 2.4 : 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.fillStyle = '#8b877e';
    ctx.fill();
  }

  // Pitch outlines.
  if (mode === 'core') {
    ctx.strokeStyle = '#e9e9df';
    ctx.lineWidth = 0.15;
    for (const a of data.areas) {
      if (a.kind !== 'pitch' && a.kind !== 'sports') continue;
      tracePoly(ctx, a.r, true);
      ctx.stroke();
    }
  }

  // Fine grain + broad mottling so the ground never looks flat.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'soft-light';
  const fine = ctx.createPattern(noiseTile(256, 7, mode === 'core' ? 130 : 90), 'repeat');
  const fineScale = mode === 'core' ? 1.6 : 0.7;
  ctx.setTransform(fineScale, 0, 0, fineScale, 0, 0);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = fine;
  ctx.fillRect(0, 0, size / fineScale, size / fineScale);
  const broad = ctx.createPattern(noiseTile(64, 21, 150), 'repeat');
  const broadScale = mode === 'core' ? 22 : 9;
  ctx.setTransform(broadScale, 0, 0, broadScale, 0, 0);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = broad;
  ctx.fillRect(0, 0, size / broadScale, size / broadScale);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  void px;

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: tex, canvas: cv };
}


// Mask of paved (plaza, sidewalk, footway) areas for the paver pattern shader.
// R = paved, G = asphalt. Covers the fine core, 1 texel = 2 * half / size metres.
export function paintPavedMask(data, half, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const k = size / (2 * half);
  ctx.setTransform(k, 0, 0, k, half * k, half * k);
  ctx.fillStyle = '#000';
  ctx.fillRect(-half, -half, 2 * half, 2 * half);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#f00';
  tracePoly(ctx, data.campusRing, true);
  ctx.fill();
  for (const a of data.areas) {
    if (!/^IEU /.test(a.name || '') && !['grass', 'park', 'forest', 'orchard', 'scrub'].includes(a.kind)) continue;
    ctx.fillStyle = '#000';
    tracePoly(ctx, a.r, true);
    ctx.fill();
  }
  const veh = data.roads.filter((r) => ROAD_STYLE[r.t] && !r.tunnel);
  for (const r of veh) {
    const st = ROAD_STYLE[r.t];
    if (st.walk <= 0) continue;
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = r.w + st.walk * 2;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  for (const r of data.roads) {
    if (!WALK_TYPES.has(r.t) && r.t !== 'steps') continue;
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = Math.max(r.w, 1.6) + 0.4;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  for (const r of veh) {
    ctx.strokeStyle = r.t === 'service' ? '#f00' : '#0f0';
    ctx.lineWidth = r.w;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}


// High resolution mask of the campus building footprints (white inside). The terrain shader
// discards fragments inside them so uphill ground never pokes through interior floors.
export function paintHoleMask(data, rect, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const sx = size / rect.w;
  const sz = size / rect.h;
  ctx.setTransform(sx, 0, 0, sz, -rect.x * sx, -rect.z * sz);
  ctx.fillStyle = '#000';
  ctx.fillRect(rect.x, rect.z, rect.w, rect.h);
  for (const b of data.buildings) {
    if (!b.campus) continue;
    ctx.fillStyle = '#fff';
    tracePoly(ctx, b.ring, true);
    ctx.fill();
    ctx.fillStyle = '#000';
    for (const h of b.holes) {
      tracePoly(ctx, h, true);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
