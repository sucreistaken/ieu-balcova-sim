// Procedural canvas textures: building facades (with matching night emissive maps),
// doors, tiling detail normal map, roof gravel, text signs.

import * as THREE from 'three';
import { rng } from './util.js';

const CELL = 128; // px per window cell
const GRID = 4; // window cells per tile side

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finalize(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Facade style descriptors. Each tile is GRID x GRID cells; cell = one bay x one floor.
const STYLES = {
  // Cream concrete with dark ribbon glazing, as seen on the Balcova campus blocks.
  campus: {
    wall: '#ddd2bd', wallShade: '#cfc3ab', frame: '#6f4d3d', glass: ['#566c84', '#627c97', '#4d6177'],
    winW: 0.78, winH: 0.56, winY: 0.26, sill: '#efe8d8', band: '#c9bda4', ribbon: true, lit: 0.34,
  },
  // Off-white residential apartments with balcony slabs.
  apartment: {
    wall: '#ece6d8', wallShade: '#ddd5c4', frame: '#f5f3ee', glass: ['#5a6e85', '#65809b', '#526379'],
    winW: 0.46, winH: 0.5, winY: 0.3, sill: '#d9d1c0', band: '#d6ceba', balcony: true, lit: 0.42,
  },
  apartmentWarm: {
    wall: '#e6d3b4', wallShade: '#d6c19f', frame: '#f4efe6', glass: ['#5a6e85', '#65809b', '#526379'],
    winW: 0.44, winH: 0.52, winY: 0.28, sill: '#cbb894', band: '#d1bd98', balcony: true, lit: 0.4,
  },
  commercial: {
    wall: '#cfcfca', wallShade: '#bdbdb8', frame: '#4e5a66', glass: ['#6a8399', '#7791a8', '#5f778c'],
    winW: 0.86, winH: 0.62, winY: 0.2, sill: '#e1e1dc', band: '#b5b5b0', ribbon: true, lit: 0.3,
  },
  plain: {
    wall: '#cdc7b8', wallShade: '#bcb5a4', frame: '#7d766a', glass: ['#56626f', '#606d7b', '#4b5561'],
    winW: 0.26, winH: 0.22, winY: 0.5, sill: '#ddd7c8', band: '#c0b9a8', lit: 0.12,
  },
  // Photo-based campus styles (see campus_arch.js): custom painters below.
  // Red brick with cream floor bands and small square windows (A Blok slab, Medya Iletisim).
  brick: { custom: 'brick', lit: 0.3 },
  // Cream piers with red brick panels and ribbon windows (A Blok north face, dormitory).
  pierBrick: { custom: 'pierBrick', lit: 0.34 },
  // Cream plaster with small irregular windows (A Blok west wing, E Blok, TESLA).
  plaster: { custom: 'plaster', lit: 0.3 },
  // The floodlit main building: the same styles with an orange night glow over the whole facade.
  brickLit: { custom: 'brick', lit: 0.3, glow: true },
  pierBrickLit: { custom: 'pierBrick', lit: 0.34, glow: true },
  plasterLit: { custom: 'plaster', lit: 0.3, glow: true },
  // White concrete with a regular grid of dark windows (C and D blocks).
  whiteGrid: { custom: 'whiteGrid', lit: 0.36 },
};

export const FACADE_STYLES = Object.keys(STYLES);

// Shared window painter: frame, glass gradient with a soft reflection, sill and night glow.
function paintWindow(g, e, r, x, y, w, h, { frame = '#f1eee6', glass = ['#202b38', '#2e3d4e', '#263444'], sill = '#e6dcc4', lit = 0.3, mullion = false } = {}) {
  g.fillStyle = frame;
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  const grad = g.createLinearGradient(x, y, x + w * 0.7, y + h);
  const gi = Math.floor(r() * 3);
  grad.addColorStop(0, glass[gi]);
  grad.addColorStop(1, glass[(gi + 1) % 3]);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  const k = r();
  if (k < 0.2) {
    g.fillStyle = 'rgba(232,222,196,0.7)';
    g.fillRect(x, y, w, h * (0.3 + r() * 0.5));
  } else if (k < 0.3) {
    g.fillStyle = 'rgba(205,200,186,0.5)';
    g.fillRect(x, y, w * 0.5, h);
  }
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x + w * 0.45, y);
  g.lineTo(x + w * 0.7, y);
  g.lineTo(x + w * 0.25, y + h);
  g.fill();
  if (mullion) {
    g.fillStyle = frame;
    g.fillRect(x + w / 2 - 1.5, y, 3, h);
  }
  g.fillStyle = sill;
  g.fillRect(x - 5, y + h + 3, w + 10, 4);
  if (r() < lit) {
    e.fillStyle = r() < 0.7 ? '#ffd48a' : '#cfe4ff';
    e.globalAlpha = 0.6 + r() * 0.4;
    e.fillRect(x, y, w, h);
    e.globalAlpha = 1;
  }
}

// Brick courses with per-brick tone variation and faint mortar lines.
function paintBrick(g, r, x0, y0, w, h, base = [12, 46, 30]) {
  g.fillStyle = `hsl(${base[0]}, ${base[1]}%, ${base[2]}%)`;
  g.fillRect(x0, y0, w, h);
  const course = 3;
  for (let y = 0; y < h; y += course) {
    const off = ((y / course) % 2) * 6;
    for (let x = -off; x < w; x += 12) {
      g.fillStyle = `hsl(${base[0] + (r() - 0.5) * 8}, ${base[1] + (r() - 0.5) * 12}%, ${base[2] + (r() - 0.5) * 8}%)`;
      g.fillRect(x0 + Math.max(0, x), y0 + y, Math.min(11, w - Math.max(0, x)), course - 1);
    }
  }
}

// Orange floodlight wash of the emissive map (the main building is lit orange at night).
function paintGlow(e, size, strength = 0.32) {
  e.globalCompositeOperation = 'lighter';
  e.fillStyle = `rgba(255,112,28,${strength})`;
  e.fillRect(0, 0, size, size);
  e.globalCompositeOperation = 'source-over';
}

const CUSTOM = {
  brick(g, e, r, size, s) {
    paintBrick(g, r, 0, 0, size, size);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = gx * CELL;
        const y0 = gy * CELL;
        g.fillStyle = '#e6dac0';
        g.fillRect(x0, y0 + CELL - 16, CELL, 16);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(x0, y0 + CELL - 17, CELL, 2);
        paintWindow(g, e, r, x0 + 44, y0 + 30, 40, 48, { lit: s.lit });
      }
    }
    if (s.glow) paintGlow(e, size);
  },
  pierBrick(g, e, r, size, s) {
    paintBrick(g, r, 0, 0, size, size, [10, 44, 29]);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = gx * CELL;
        const y0 = gy * CELL;
        g.fillStyle = '#e9e2d1';
        g.fillRect(x0, y0, 22, CELL);
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(x0 + 22, y0, 2, CELL);
        g.fillStyle = '#e6dac0';
        g.fillRect(x0, y0 + CELL - 12, CELL, 12);
        paintWindow(g, e, r, x0 + 36, y0 + 26, 76, 50, { lit: s.lit, mullion: true, frame: '#e9e2d1' });
      }
    }
    if (s.glow) paintGlow(e, size, 0.36);
  },
  plaster(g, e, r, size, s) {
    g.fillStyle = '#ebe3d1';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 3200; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)';
      g.fillRect(r() * size, r() * size, 1 + r() * 3, 3 + r() * 18);
    }
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = gx * CELL;
        const y0 = gy * CELL;
        g.fillStyle = '#dcd2bc';
        g.fillRect(x0, y0 + CELL - 9, CELL, 9);
        g.fillStyle = 'rgba(0,0,0,0.1)';
        g.fillRect(x0, y0 + CELL - 10, CELL, 1.5);
        if (r() < 0.12) continue;
        paintWindow(g, e, r, x0 + 22 + r() * 44, y0 + 26 + r() * 14, 30 + r() * 8, 38 + r() * 10, { lit: s.lit, frame: '#f6f2e8', sill: '#d8cfba' });
      }
    }
    if (s.glow) paintGlow(e, size, 0.5);
  },
  whiteGrid(g, e, r, size, s) {
    g.fillStyle = '#eeeae0';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 2800; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.028)' : 'rgba(255,255,255,0.05)';
      g.fillRect(r() * size, r() * size, 1 + r() * 2, 3 + r() * 16);
    }
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = gx * CELL;
        const y0 = gy * CELL;
        g.fillStyle = '#d3cfc3';
        g.fillRect(x0, y0 + CELL - 8, CELL, 8);
        paintWindow(g, e, r, x0 + 32, y0 + 24, 64, 60, { lit: s.lit, frame: '#c9c5b8', glass: ['#25323f', '#37485b', '#2d3d4e'], sill: '#d3cfc3', mullion: true });
      }
    }
  },
};

function drawFacade(style, seed) {
  const s = STYLES[style];
  const r = rng(seed);
  const size = CELL * GRID;
  const map = canvas(size, size);
  const emi = canvas(size, size);
  const g = map.getContext('2d');
  const e = emi.getContext('2d');
  if (s.custom) {
    e.fillStyle = '#000';
    e.fillRect(0, 0, size, size);
    CUSTOM[s.custom](g, e, r, size, s);
    return { map: finalize(map), emissive: finalize(emi) };
  }
  g.fillStyle = s.wall;
  g.fillRect(0, 0, size, size);
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);

  // Subtle vertical streaking + wall noise.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)';
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 4 + r() * 22);
  }
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = gx * CELL;
      const y0 = gy * CELL;
      // Floor slab band at the bottom of each cell.
      g.fillStyle = s.band;
      g.fillRect(x0, y0 + CELL - CELL * 0.1, CELL, CELL * 0.1);
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(x0, y0 + CELL - 2, CELL, 2);
      // Window opening.
      const ww = CELL * s.winW;
      const wh = CELL * s.winH;
      const wx = x0 + (CELL - ww) / 2;
      const wy = y0 + CELL * s.winY;
      g.fillStyle = s.frame;
      g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const grad = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
      const gi = Math.floor(r() * 3);
      grad.addColorStop(0, s.glass[gi]);
      grad.addColorStop(1, s.glass[(gi + 1) % 3]);
      g.fillStyle = grad;
      g.fillRect(wx, wy, ww, wh);
      // Curtain or blind occasionally.
      const k = r();
      if (k < 0.22) {
        g.fillStyle = 'rgba(232,222,196,0.75)';
        g.fillRect(wx, wy, ww, wh * (0.35 + r() * 0.5));
      } else if (k < 0.32) {
        g.fillStyle = 'rgba(210,205,190,0.55)';
        g.fillRect(wx, wy, ww * 0.5, wh);
      }
      // Reflection highlight.
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.beginPath();
      g.moveTo(wx, wy + wh);
      g.lineTo(wx + ww * 0.45, wy);
      g.lineTo(wx + ww * 0.7, wy);
      g.lineTo(wx + ww * 0.25, wy + wh);
      g.fill();
      // Mullion.
      if (!s.ribbon && ww > 40) {
        g.fillStyle = s.frame;
        g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
      // Sill.
      g.fillStyle = s.sill;
      g.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);
      if (s.balcony && r() < 0.5) {
        g.fillStyle = 'rgba(70,74,80,0.85)';
        g.fillRect(x0 + 6, y0 + CELL * 0.72, CELL - 12, 4);
        g.fillStyle = 'rgba(90,94,100,0.5)';
        for (let bx = 10; bx < CELL - 10; bx += 9) g.fillRect(x0 + bx, y0 + CELL * 0.72, 2, CELL * 0.18);
      }
      // Night emissive: lit windows.
      if (r() < s.lit) {
        const warm = r() < 0.7 ? '#ffd48a' : '#cfe4ff';
        e.fillStyle = warm;
        e.globalAlpha = 0.6 + r() * 0.4;
        e.fillRect(wx, wy, ww, wh);
        e.globalAlpha = 1;
      }
    }
  }
  return { map: finalize(map), emissive: finalize(emi) };
}

let facadeCache = null;
export function getFacadeTextures() {
  if (facadeCache) return facadeCache;
  facadeCache = {};
  FACADE_STYLES.forEach((name, i) => {
    facadeCache[name] = drawFacade(name, 100 + i * 17);
  });
  facadeCache.tile = { cells: GRID, bayW: 3.4, floorH: 3.4 };
  return facadeCache;
}

export function makeDoorTexture() {
  const c = canvas(256, 320);
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f46';
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#8c6b4f';
  g.fillRect(8, 8, 240, 304);
  const grad = g.createLinearGradient(0, 0, 256, 320);
  grad.addColorStop(0, '#5d7aa0');
  grad.addColorStop(1, '#2b3a52');
  g.fillStyle = grad;
  g.fillRect(20, 20, 100, 280);
  g.fillRect(136, 20, 100, 280);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.beginPath();
  g.moveTo(20, 300);
  g.lineTo(80, 20);
  g.lineTo(104, 20);
  g.lineTo(44, 300);
  g.fill();
  g.fillStyle = '#d7d7d2';
  g.fillRect(112, 150, 8, 60);
  g.fillRect(136, 150, 8, 60);
  return finalize(c, { repeat: false });
}

export function makeDoorEmissive() {
  const c = canvas(256, 320);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#ffe2a8';
  g.globalAlpha = 0.85;
  g.fillRect(20, 20, 100, 280);
  g.fillRect(136, 20, 100, 280);
  return finalize(c, { repeat: false });
}

// Rounded text label texture for building signs.
export function makeSignTexture(text, { bg = '#1c2b47', fg = '#ffffff', accent = '#f28c28', w = 512, h = 128 } = {}) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = accent;
  g.fillRect(0, h - 10, w, 10);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 64;
  g.font = `700 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  while (g.measureText(text).width > w - 40 && size > 20) {
    size -= 2;
    g.font = `700 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  }
  g.fillText(text, w / 2, h / 2 - 4);
  return finalize(c, { repeat: false, aniso: 4 });
}

// Tiling noise height converted to a normal map, for micro detail on the terrain.
export function makeDetailNormal(size = 256, strength = 2.2) {
  const r = rng(5);
  const hgt = new Float32Array(size * size);
  const octave = (freq, amp) => {
    const n = freq + 1;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * freq;
        const fy = (y / size) * freq;
        const x0 = Math.floor(fx) % freq;
        const y0 = Math.floor(fy) % freq;
        const tx = fx - Math.floor(fx);
        const ty = fy - Math.floor(fy);
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % freq;
        const y1 = (y0 + 1) % freq;
        const a = lat[y0 * n + x0];
        const b = lat[y0 * n + x1];
        const c = lat[y1 * n + x0];
        const d = lat[y1 * n + x1];
        hgt[y * size + x] += amp * (a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy);
      }
    }
  };
  octave(8, 1);
  octave(16, 0.6);
  octave(32, 0.35);
  octave(64, 0.2);
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      img.data[k] = (-dx / len) * 127 + 128;
      img.data[k + 1] = (-dy / len) * 127 + 128;
      img.data[k + 2] = (1 / len) * 127 + 128;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finalize(c, { srgb: false });
}

// Gravel / tar roof texture.
export function makeRoofTexture() {
  const size = 256;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#b5b0a4';
  g.fillRect(0, 0, size, size);
  const r = rng(77);
  for (let i = 0; i < 5000; i++) {
    const v = 150 + Math.floor(r() * 70);
    g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.5)`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  return finalize(c);
}

export function makeWaterNormal(size = 256) {
  const t = makeDetailNormal(size, 3.2);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Circular soft glow sprite texture.
export function makeGlowTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.25, 'rgba(255,220,150,0.55)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return finalize(c, { repeat: false, aniso: 1 });
}

// Simplified orange emblem: rounded diamond with a white dotted stem. Not the official artwork.
export function makeLogoTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#f1ede4';
  g.fillRect(0, 0, 256, 256);
  g.save();
  g.translate(128, 128);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#ee6a1e';
  const r = 26;
  const half = 72;
  g.beginPath();
  g.moveTo(-half + r, -half);
  g.lineTo(half - r, -half);
  g.quadraticCurveTo(half, -half, half, -half + r);
  g.lineTo(half, half - r);
  g.quadraticCurveTo(half, half, half - r, half);
  g.lineTo(-half + r, half);
  g.quadraticCurveTo(-half, half, -half, half - r);
  g.lineTo(-half, -half + r);
  g.quadraticCurveTo(-half, -half, -half + r, -half);
  g.fill();
  g.restore();
  g.fillStyle = '#fff5e8';
  g.beginPath();
  g.arc(128, 92, 14, 0, Math.PI * 2);
  g.fill();
  g.fillRect(118, 114, 20, 58);
  g.beginPath();
  g.moveTo(138, 172);
  g.quadraticCurveTo(160, 172, 168, 150);
  g.lineTo(168, 166);
  g.quadraticCurveTo(160, 190, 138, 190);
  g.fill();
  return finalize(c, { repeat: false, aniso: 4 });
}

// White block letters on a transparent background (rooftop lettering).
export function makeRoofLetters(text) {
  const c = canvas(2048, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 2048, 128);
  g.fillStyle = '#f4f2ec';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 96;
  g.font = `600 ${size}px "Barlow Semi Condensed", "Helvetica Neue", Arial, sans-serif`;
  while (g.measureText(text).width > 1980 && size > 24) {
    size -= 4;
    g.font = `600 ${size}px "Barlow Semi Condensed", "Helvetica Neue", Arial, sans-serif`;
  }
  g.fillText(text, 1024, 66);
  return finalize(c, { repeat: false, aniso: 4 });
}

// Brick drum wall: brick courses with slim white pilasters, repeats horizontally.
export function makeDrumTexture() {
  const c = canvas(512, 256);
  const g = c.getContext('2d');
  const r = rng(303);
  paintBrick(g, r, 0, 0, 512, 256, [11, 45, 30]);
  // Ground floor glazing band and upper window ribbon.
  g.fillStyle = 'rgba(30,42,56,0.85)';
  g.fillRect(0, 168, 512, 64);
  g.fillStyle = 'rgba(30,42,56,0.78)';
  g.fillRect(0, 60, 512, 40);
  for (let x = 0; x < 512; x += 64) {
    g.fillStyle = '#efe9dc';
    g.fillRect(x + 28, 0, 8, 256);
  }
  g.fillStyle = '#e6dac0';
  g.fillRect(0, 236, 512, 20);
  g.fillRect(0, 0, 512, 14);
  return finalize(c, { aniso: 4 });
}
