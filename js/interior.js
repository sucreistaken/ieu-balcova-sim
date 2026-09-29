// Interiors: generic floor plans for the campus buildings (corridors, classrooms, labs, offices,
// studios, dorm rooms, library), stair/elevator cores, furniture and signs. Built lazily per
// building and per floor. The layouts are simulation-made, not the real floor plans.

import * as THREE from 'three';
import { generateLayout, CELL } from './layout.js';
import { Collision } from './collision.js';
import { mergeParts, rgb, boxAt, cylAt } from './geo.js';
import { rng, clamp, pointInRing, ringBBox, hash01 } from './util.js';

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Wall texture: one floor high, four window bays wide. Windows are transparent holes.
function wallTexture(withWindows) {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#ece8dd';
    g.fillRect(0, 0, w, h);
    // Wainscot and rail.
    g.fillStyle = '#cdc4b0';
    g.fillRect(0, h * 0.75, w, h * 0.25);
    g.fillStyle = '#b6ab93';
    g.fillRect(0, h * 0.75 - 2, w, 3);
    g.fillStyle = '#d9d3c4';
    g.fillRect(0, h - 6, w, 6);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // Fake ambient occlusion: darker under the ceiling and along the floor, scuffs on the wainscot.
    const ao = g.createLinearGradient(0, 0, 0, h);
    ao.addColorStop(0, 'rgba(70,58,40,0.16)');
    ao.addColorStop(0.1, 'rgba(70,58,40,0)');
    ao.addColorStop(0.84, 'rgba(70,58,40,0)');
    ao.addColorStop(1, 'rgba(70,58,40,0.22)');
    g.fillStyle = ao;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60,48,34,${0.05 + Math.random() * 0.07})`;
      g.fillRect(Math.random() * w, h * 0.78 + Math.random() * h * 0.2, 8 + Math.random() * 30, 1 + Math.random() * 2);
    }
    if (withWindows) {
      for (let c = 0; c < 4; c++) {
        const x0 = c * 128;
        const hx = x0 + 14;
        const hw = 100;
        const hy = 0.18 * h;
        const hh = 0.56 * h;
        g.fillStyle = '#f7f5ef';
        g.fillRect(hx - 6, hy - 6, hw + 12, hh + 12);
        g.clearRect(hx, hy, hw, hh);
        g.fillStyle = '#e9e5d9';
        g.fillRect(hx - 8, hy + hh + 4, hw + 16, 5);
      }
    }
  });
}

// Room door leaf: painted wood, a narrow glass slit and a lever handle on the free edge.
// Round wall clock face.
function clockTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#26282c';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f6f5f0';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#26282c';
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.sin(a) * 46, h / 2 - Math.cos(a) * 46);
      g.lineTo(w / 2 + Math.sin(a) * 54, h / 2 - Math.cos(a) * 54);
      g.stroke();
    }
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.sin(2.1) * 30, h / 2 - Math.cos(2.1) * 30);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.sin(0.6) * 44, h / 2 - Math.cos(0.6) * 44);
    g.stroke();
  }, { repeat: false });
}

function doorLeafTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#a4794c');
    grad.addColorStop(0.5, '#b98a57');
    grad.addColorStop(1, '#a4794c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(70,45,22,${0.04 + Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, 0, 1, h);
    }
    g.strokeStyle = 'rgba(60,38,20,0.55)';
    g.lineWidth = 3;
    g.strokeRect(14, 150, w - 28, 84);
    g.strokeRect(14, 100, w - 28, 40);
    g.fillStyle = '#9bb8c9';
    g.fillRect(w / 2 - 16, 16, 32, 68);
    g.strokeStyle = '#5a4128';
    g.lineWidth = 4;
    g.strokeRect(w / 2 - 16, 16, 32, 68);
    g.fillStyle = '#b9bcc0';
    g.fillRect(w - 26, 128, 16, 6);
    g.fillRect(w - 14, 122, 5, 18);
  }, { repeat: false });
}

function ceilingTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#eeeeea';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = 'rgba(80,80,70,0.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.strokeStyle = '#c5c5bf';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.strokeRect(w / 2, 0, 0, h);
    g.strokeRect(0, h / 2, w, 0);
  });
}

function booksTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#4b3a2a';
    g.fillRect(0, 0, w, h);
    const rows = 6;
    const rh = h / rows;
    const cols = ['#b23a34', '#2f5f8f', '#e0b23a', '#3c7d5a', '#7a4a86', '#d8d2c2', '#c9682e', '#25384f', '#8a2f45'];
    for (let r = 0; r < rows; r++) {
      let x = 6;
      while (x < w - 8) {
        const bw = 8 + Math.random() * 14;
        const bh = rh * (0.62 + Math.random() * 0.28);
        g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        g.fillRect(x, r * rh + (rh - bh) - 6, bw, bh);
        x += bw + 1;
      }
      g.fillStyle = '#6a5138';
      g.fillRect(0, (r + 1) * rh - 6, w, 6);
    }
  }, { repeat: false });
}

function boardTexture(kind) {
  return canvasTex(256, 128, (g, w, h) => {
    if (kind === 'notice') {
      g.fillStyle = '#b48454';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5a3e26';
      g.fillRect(0, 0, w, 6);
      g.fillRect(0, h - 6, w, 6);
      g.fillRect(0, 0, 6, h);
      g.fillRect(w - 6, 0, 6, h);
      const cols = ['#f4f0e4', '#f2d16b', '#e88b8b', '#8fc4e3', '#a8d5a2', '#ffffff'];
      for (let i = 0; i < 9; i++) {
        g.fillStyle = cols[i % cols.length];
        const x = 14 + Math.random() * (w - 70);
        const y = 14 + Math.random() * (h - 56);
        g.fillRect(x, y, 30 + Math.random() * 26, 34 + Math.random() * 14);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let l = 0; l < 3; l++) g.fillRect(x + 4, y + 8 + l * 8, 20, 2);
      }
    } else {
      g.fillStyle = '#f8f9f7';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#c7ccc6';
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.strokeStyle = 'rgba(40,60,120,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(24, 40);
      g.quadraticCurveTo(70, 20, 110, 48);
      g.moveTo(24, 76);
      g.lineTo(150, 76);
      g.moveTo(24, 96);
      g.lineTo(120, 96);
      g.stroke();
    }
  }, { repeat: false });
}

function metalTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#aeb3b8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#8f959b';
    g.fillRect(w / 2 - 1, 0, 2, h);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * w, Math.random() * h, 1, 12);
    }
    g.fillStyle = '#2b2e33';
    g.fillRect(w / 2 - 22, h * 0.45, 6, 22);
    g.fillRect(w / 2 + 16, h * 0.45, 6, 22);
  }, { repeat: false });
}

// --------------------------------------------------------- sign text atlas
class TextAtlas {
  constructor() {
    this.pages = [];
    this.map = new Map();
    this.cw = 256;
    this.ch = 64;
    this.cols = 8;
    this.rows = 16;
  }

  _newPage() {
    const c = document.createElement('canvas');
    c.width = this.cw * this.cols;
    c.height = this.ch * this.rows;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const page = { canvas: c, ctx: c.getContext('2d'), tex, used: 0, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
    this.pages.push(page);
    return page;
  }

  get(text, style = 'plate') {
    const key = `${style}|${text}`;
    let e = this.map.get(key);
    if (e) return e;
    let page = this.pages[this.pages.length - 1];
    if (!page || page.used >= this.cols * this.rows) page = this._newPage();
    const idx = page.used++;
    const cx = (idx % this.cols) * this.cw;
    const cy = Math.floor(idx / this.cols) * this.ch;
    const g = page.ctx;
    const bg = style === 'plate' ? '#1d3a66' : style === 'wc' ? '#2f7fa8' : style === 'core' ? '#2f6b4f' : '#14243b';
    g.fillStyle = bg;
    g.fillRect(cx, cy, this.cw, this.ch);
    g.fillStyle = '#f28c28';
    g.fillRect(cx, cy + this.ch - 5, this.cw, 5);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 34;
    g.font = `700 ${size}px "Barlow Semi Condensed", "Barlow", sans-serif`;
    while (g.measureText(text).width > this.cw - 22 && size > 14) {
      size -= 2;
      g.font = `700 ${size}px "Barlow Semi Condensed", "Barlow", sans-serif`;
    }
    g.fillText(text, cx + this.cw / 2, cy + this.ch / 2 - 2);
    page.tex.needsUpdate = true;
    e = { page, u0: cx / page.canvas.width, u1: (cx + this.cw) / page.canvas.width, v0: 1 - (cy + this.ch) / page.canvas.height, v1: 1 - cy / page.canvas.height };
    this.map.set(key, e);
    return e;
  }
}

// ----------------------------------------------------------- furniture
const wood = rgb('#9a7448');
const woodDark = rgb('#5d4630');
const metal = rgb('#3a3f46');
const white = rgb('#f2f2ee');
const fabric = [rgb('#2f4f7a'), rgb('#7a2f3f'), rgb('#2f6b55'), rgb('#4a4f57'), rgb('#b1782d')];

function furnitureGeometries() {
  const g = {};
  g.desk = mergeParts([
    { geo: boxAt(1.2, 0.04, 0.6, 0, 0.72, 0), color: wood },
    { geo: boxAt(0.04, 0.72, 0.56, -0.56, 0, 0), color: metal },
    { geo: boxAt(0.04, 0.72, 0.56, 0.56, 0, 0), color: metal },
    { geo: boxAt(1.1, 0.3, 0.02, 0, 0.35, -0.26), color: woodDark },
  ], 0.03);
  g.chair = mergeParts([
    { geo: boxAt(0.42, 0.04, 0.42, 0, 0.44, 0), color: fabric[3] },
    { geo: boxAt(0.42, 0.42, 0.04, 0, 0.5, -0.2), color: fabric[3] },
    { geo: boxAt(0.03, 0.44, 0.03, -0.18, 0, 0.18), color: metal },
    { geo: boxAt(0.03, 0.44, 0.03, 0.18, 0, 0.18), color: metal },
    { geo: boxAt(0.03, 0.44, 0.03, -0.18, 0, -0.18), color: metal },
    { geo: boxAt(0.03, 0.44, 0.03, 0.18, 0, -0.18), color: metal },
  ], 0.03);
  g.teacherDesk = mergeParts([
    { geo: boxAt(1.6, 0.05, 0.75, 0, 0.74, 0), color: woodDark },
    { geo: boxAt(0.05, 0.74, 0.7, -0.75, 0, 0), color: woodDark },
    { geo: boxAt(0.05, 0.74, 0.7, 0.75, 0, 0), color: woodDark },
    { geo: boxAt(0.45, 0.3, 0.03, 0.2, 0.79, 0.1), color: rgb('#15171b') },
  ], 0.03);
  g.bench = mergeParts([
    { geo: boxAt(2.4, 0.05, 0.5, 0, 0.75, 0), color: wood },
    { geo: boxAt(0.05, 0.75, 0.46, -1.1, 0, 0), color: metal },
    { geo: boxAt(0.05, 0.75, 0.46, 1.1, 0, 0), color: metal },
    { geo: boxAt(2.4, 0.3, 0.02, 0, 0.42, -0.23), color: woodDark },
  ], 0.03);
  g.labBench = mergeParts([
    { geo: boxAt(2.4, 0.06, 0.9, 0, 0.9, 0), color: rgb('#23272b') },
    { geo: boxAt(2.3, 0.88, 0.8, 0, 0, 0), color: rgb('#b7bcb1') },
    { geo: boxAt(0.5, 0.08, 0.3, -0.7, 0.96, 0), color: rgb('#5a6b7a') },
    { geo: boxAt(0.12, 0.4, 0.12, 0.6, 0.96, 0.15), color: rgb('#d0d5d8') },
  ], 0.04);
  g.stool = mergeParts([
    { geo: cylAt(0.18, 0.18, 0.05, 10, 0, 0.6, 0), color: rgb('#c9682e') },
    { geo: cylAt(0.03, 0.05, 0.6, 6, 0, 0, 0), color: metal },
  ], 0.02);
  g.monitor = mergeParts([
    { geo: boxAt(0.52, 0.32, 0.03, 0, 0.9, 0), color: rgb('#101216') },
    { geo: boxAt(0.05, 0.2, 0.05, 0, 0.78, 0.02), color: metal },
    { geo: boxAt(0.3, 0.02, 0.18, 0, 0.75, 0.16), color: rgb('#2a2d33') },
  ], 0.02);
  g.bed = mergeParts([
    { geo: boxAt(0.95, 0.35, 2.05, 0, 0, 0), color: woodDark },
    { geo: boxAt(0.88, 0.16, 1.95, 0, 0.35, 0), color: rgb('#e8e2d0') },
    { geo: boxAt(0.6, 0.1, 0.3, 0, 0.5, -0.75), color: rgb('#ffffff') },
    { geo: boxAt(0.95, 0.06, 0.6, 0, 0.51, 0.55), color: rgb('#3b5b8a') },
  ], 0.03);
  g.wardrobe = mergeParts([{ geo: boxAt(1.0, 2.0, 0.55, 0, 0, 0), color: rgb('#a8946f') }, { geo: boxAt(0.02, 1.7, 0.02, 0, 0.15, 0.28), color: rgb('#2a2d33') }], 0.03);
  {
    const parts = [{ geo: boxAt(1.0, 2.0, 0.34, 0, 0, 0), color: rgb('#5a452f') }];
    const bookCols = ['#b23a34', '#2f5f8f', '#e0b23a', '#3c7d5a', '#7a4a86', '#d8d2c2', '#c9682e', '#25384f', '#8a2f45'].map(rgb);
    const br = rng(11);
    for (let row = 0; row < 5; row++) {
      let x = -0.44;
      while (x < 0.42) {
        const w = 0.035 + br() * 0.05;
        const h = 0.26 + br() * 0.12;
        parts.push({ geo: boxAt(w, h, 0.24, x + w / 2, 0.12 + row * 0.38, 0.11), color: bookCols[Math.floor(br() * bookCols.length)] });
        x += w + 0.004;
      }
    }
    g.shelf = mergeParts(parts, 0.04);
  }
  g.stage = mergeParts([
    { geo: boxAt(7.0, 0.6, 2.8, 0, 0, 0), color: rgb('#6b5238') },
    { geo: boxAt(7.0, 0.05, 2.8, 0, 0.6, 0), color: rgb('#8a6a46') },
    { geo: boxAt(6.4, 2.6, 0.12, 0, 0.6, -1.3), color: rgb('#2b3a55') },
  ], 0.03);
  g.libTable = mergeParts([
    { geo: boxAt(1.8, 0.05, 0.9, 0, 0.74, 0), color: rgb('#b08a5a') },
    { geo: boxAt(0.06, 0.74, 0.8, -0.85, 0, 0), color: metal },
    { geo: boxAt(0.06, 0.74, 0.8, 0.85, 0, 0), color: metal },
  ], 0.03);
  g.sofa = mergeParts([
    { geo: boxAt(1.9, 0.42, 0.85, 0, 0, 0), color: rgb('#3b5b8a') },
    { geo: boxAt(1.9, 0.5, 0.2, 0, 0.42, -0.32), color: rgb('#33507a') },
    { geo: boxAt(0.2, 0.28, 0.85, -0.85, 0.42, 0), color: rgb('#33507a') },
    { geo: boxAt(0.2, 0.28, 0.85, 0.85, 0.42, 0), color: rgb('#33507a') },
  ], 0.03);
  g.plant = mergeParts([
    { geo: cylAt(0.22, 0.17, 0.4, 8, 0, 0, 0), color: rgb('#8a5a3a') },
    { geo: new THREE.IcosahedronGeometry(0.42, 0).translate(0, 0.85, 0), color: rgb('#3f7f3d') },
    { geo: new THREE.IcosahedronGeometry(0.3, 0).translate(0.18, 1.2, 0.05), color: rgb('#4b8f48') },
  ], 0.08);
  g.softbox = mergeParts([
    { geo: cylAt(0.02, 0.05, 1.7, 6, 0, 0, 0), color: metal },
    { geo: boxAt(0.7, 0.7, 0.2, 0, 1.6, 0), color: white },
  ], 0.02);
  g.camera = mergeParts([
    { geo: cylAt(0.02, 0.05, 1.3, 6, 0, 0, 0), color: metal },
    { geo: boxAt(0.25, 0.2, 0.4, 0, 1.3, 0.1), color: rgb('#15171b') },
    { geo: cylAt(0.08, 0.08, 0.2, 8, 0, 1.36, 0.36).rotateX(Math.PI / 2), color: rgb('#0b0c0f') },
  ], 0.02);
  g.crate = mergeParts([{ geo: boxAt(0.8, 0.6, 0.6, 0, 0, 0), color: rgb('#a58a5e') }], 0.06);
  g.machine = mergeParts([
    { geo: boxAt(1.6, 1.1, 0.9, 0, 0, 0), color: rgb('#c8a52a') },
    { geo: boxAt(0.5, 0.5, 0.5, 0.5, 1.1, 0), color: rgb('#4d5560') },
  ], 0.04);
  g.kiosk = mergeParts([
    { geo: boxAt(1.4, 1.05, 0.5, 0, 0, 0), color: rgb('#1d3a66') },
    { geo: boxAt(1.5, 0.05, 0.6, 0, 1.05, 0), color: rgb('#f2f2ee') },
    { geo: boxAt(0.5, 0.35, 0.04, 0, 1.15, -0.1), color: rgb('#101216') },
  ], 0.02);
  // Ceiling-mounted projector: body, lens and a mounting rod up to the ceiling.
  g.projector = mergeParts([
    { geo: boxAt(0.36, 0.11, 0.28, 0, 2.55, 0), color: rgb('#e8e8e4') },
    { geo: cylAt(0.045, 0.045, 0.06, 10, 0, 2.58, 0.17), color: rgb('#1b1d21') },
    { geo: boxAt(0.05, 0.62, 0.05, 0, 2.66, 0), color: metal },
  ], 0.02);
  g.podium = mergeParts([
    { geo: boxAt(0.7, 1.05, 0.5, 0, 0, 0), color: woodDark },
    { geo: boxAt(0.8, 0.05, 0.6, 0, 1.05, 0), color: wood },
  ], 0.03);
  g.counter = mergeParts([
    { geo: boxAt(3.4, 1.0, 0.7, 0, 0, 0), color: rgb('#3b2a1e') },
    { geo: boxAt(3.5, 0.05, 0.8, 0, 1.0, 0), color: rgb('#d9d4c6') },
    { geo: boxAt(0.5, 0.45, 0.4, -1.0, 1.05, 0), color: rgb('#8a8f94') },
    { geo: boxAt(0.4, 0.4, 0.4, 0.2, 1.05, 0), color: rgb('#15171b') },
    { geo: boxAt(0.4, 0.35, 0.4, 1.0, 1.05, 0), color: rgb('#c9c9c4') },
  ], 0.03);
  g.cafeTable = mergeParts([
    { geo: cylAt(0.32, 0.32, 0.04, 12, 0, 0.72, 0), color: rgb('#d9d4c6') },
    { geo: cylAt(0.04, 0.05, 0.72, 6, 0, 0, 0), color: metal },
    { geo: cylAt(0.22, 0.22, 0.03, 10, 0, 0, 0), color: metal },
  ], 0.02);
  g.benchSeat = mergeParts([
    { geo: boxAt(2.4, 0.06, 0.4, 0, 0.44, 0), color: wood },
    { geo: boxAt(2.4, 0.4, 0.05, 0, 0.5, -0.2), color: wood },
    { geo: boxAt(0.06, 0.44, 0.36, -1.1, 0, 0), color: metal },
    { geo: boxAt(0.06, 0.44, 0.36, 1.1, 0, 0), color: metal },
  ], 0.03);
  return g;
}

// ------------------------------------------------------------ type tables
const TYPE_LABEL = {
  classroom: 'Derslik', lecture: 'Amfi Derslik', lab: 'Laboratuvar', complab: 'Bilgisayar Lab.', office: 'Ofis',
  seminar: 'Seminer Odası', studio: 'Stüdyo', workshop: 'Atölye', dorm: 'Yurt Odası', library: 'Kütüphane',
  storage: 'Depo', wc: 'WC', lounge: 'Ortak Alan', hall: 'Salon', cafe: 'Kafe',
};
const FLOOR_COLOR = {
  corridor: '#cfccc2', classroom: '#7d8fa3', lecture: '#6b7a91', lab: '#b9beb2', complab: '#8f9ba8', office: '#9c9079',
  seminar: '#8c7f9a', studio: '#4f5966', workshop: '#8a8c88', dorm: '#a58e70', library: '#8a6a4a', storage: '#a9a79f',
  wc: '#dfe6ea', lounge: '#b9a98a', hall: '#a9b1b8', cafe: '#8a6a4a', core: '#bdb9ae', lobby: '#dcd6c8',
};

function chooseType(building, room, rand, idxInBuilding) {
  const name = building.name || '';
  const a = room.area;
  if (room.merged && room.merged.type) return room.merged.type;
  if (building.special === 'amphitheatre' || building.special === 'roundhall') return 'hall';
  if (building.cat === 'food') return 'cafe';
  if (building.cat === 'dorm') return a > 48 ? 'lounge' : 'dorm';
  if (name === 'TESLA') return a > 60 ? 'workshop' : rand() < 0.7 ? 'lab' : 'office';
  if (name === 'Medya İletişim') return a > 70 ? 'studio' : a > 30 ? (rand() < 0.5 ? 'studio' : 'classroom') : 'office';
  if (name === 'Reklamcılık') return 'studio';
  if (a >= 85) return rand() < 0.5 ? 'lecture' : 'classroom';
  if (a >= 45) {
    const r = rand();
    return r < 0.5 ? 'classroom' : r < 0.68 ? 'complab' : r < 0.86 ? 'lab' : 'seminar';
  }
  if (a >= 18) return rand() < 0.75 ? 'office' : rand() < 0.5 ? 'seminar' : 'storage';
  return idxInBuilding % 3 === 0 ? 'wc' : 'storage';
}

// ---------------------------------------------------------------- geometry
class Acc {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }

  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Wall quad standing on the floor between (ax, az) and (bx, bz) facing (nx, nz).
function wallQuad(acc, ax, az, bx, bz, y0, y1, nx, nz, u0, u1, v0, v1) {
  // Choose the winding so the face points along (nx, nz).
  const ex = bx - ax;
  const ez = bz - az;
  // Normal of (a_bot, b_bot, b_top) = (b - a) x up = (-ez, 0, ex) -> compare to (nx, nz).
  const dot = ex * nz - ez * nx;
  if (dot >= 0) {
    const i0 = acc.vert(ax, y0, az, nx, 0, nz, u0, v0);
    const i1 = acc.vert(bx, y0, bz, nx, 0, nz, u1, v0);
    const i2 = acc.vert(bx, y1, bz, nx, 0, nz, u1, v1);
    const i3 = acc.vert(ax, y1, az, nx, 0, nz, u0, v1);
    acc.quad(i0, i1, i2, i3);
  } else {
    const i0 = acc.vert(bx, y0, bz, nx, 0, nz, u1, v0);
    const i1 = acc.vert(ax, y0, az, nx, 0, nz, u0, v0);
    const i2 = acc.vert(ax, y1, az, nx, 0, nz, u0, v1);
    const i3 = acc.vert(bx, y1, bz, nx, 0, nz, u1, v1);
    acc.quad(i0, i1, i2, i3);
  }
}

function ringInset(ring, t) {
  const n = ring.length / 2;
  const out = [];
  const normals = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j * 2] - ring[i * 2];
    const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    normals.push([dz / l, -dx / l]);
  }
  for (let i = 0; i < n; i++) {
    const p = normals[(i + n - 1) % n];
    const q = normals[i];
    const dotv = p[0] * q[0] + p[1] * q[1];
    const k = t / Math.max(0.4, 1 + dotv);
    out.push(ring[i * 2] - (p[0] + q[0]) * k, ring[i * 2 + 1] - (p[1] + q[1]) * k);
  }
  return out;
}

// =================================================================== manager
export class Interiors {
  constructor({ scene, data, hf, buildings, crowd, sim }) {
    this.scene = scene;
    this.data = data;
    this.hf = hf;
    this.buildings = buildings;
    this.crowd = crowd;
    this.sim = sim;
    this.cache = new Map();
    this.current = null;
    this.group = new THREE.Group();
    this.group.name = 'interiors';
    scene.add(this.group);
    this.atlas = new TextAtlas();
    this.geo = furnitureGeometries();
    this.mats = this._materials();
    this.enterable = new Set([...buildings.doorsByBuilding.keys()]);
    this.candidates = buildings.campus.filter((b) => this.enterable.has(b.id));
    for (const b of this.candidates) b.bb = b.bb || ringBBox(b.ring);
    this.nightApplied = -1;
  }

  _materials() {
    const winTex = wallTexture(true);
    const plainTex = wallTexture(false);
    const mk = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0.16, ...opts });
    const ceilTex = ceilingTexture();
    const wallWin = mk({ map: winTex, emissiveMap: winTex, alphaTest: 0.5, side: THREE.FrontSide });
    const wallPlain = mk({ map: plainTex, emissiveMap: plainTex });
    const wallBoth = mk({ map: plainTex, emissiveMap: plainTex, side: THREE.DoubleSide });
    const ceiling = mk({ map: ceilTex, emissiveMap: ceilTex, roughness: 0.95 });
    const furn = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.08 });
    const books = new THREE.MeshStandardMaterial({ map: booksTexture(), roughness: 0.9, emissive: '#ffffff', emissiveIntensity: 0.18, emissiveMap: null });
    books.emissiveMap = books.map;
    const notice = new THREE.MeshBasicMaterial({ map: boardTexture('notice'), toneMapped: false });
    const white = new THREE.MeshBasicMaterial({ map: boardTexture('white'), toneMapped: false });
    const elevMap = metalTexture();
    const elev = new THREE.MeshStandardMaterial({ map: elevMap, roughness: 0.35, metalness: 0.6, emissive: '#ffffff', emissiveMap: elevMap, emissiveIntensity: 0.12 });
    const frame = new THREE.MeshStandardMaterial({ color: '#6b563d', roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.05 });
    const leafTex = doorLeafTexture();
    const doorLeaf = mk({ map: leafTex, emissiveMap: leafTex, roughness: 0.6 });
    const clock = new THREE.MeshBasicMaterial({ map: clockTexture(), toneMapped: false });
    const green = new THREE.MeshBasicMaterial({ color: '#2fae5a', toneMapped: false });
    const light = new THREE.MeshBasicMaterial({ color: '#fffbe8', toneMapped: false });
    const lit = [wallWin, wallPlain, wallBoth, ceiling, elev, doorLeaf];
    for (const m of [wallWin, wallPlain, wallBoth, ceiling, furn, books, elev, frame, doorLeaf]) m.envMapIntensity = 0.12;
    return { wallWin, wallPlain, wallBoth, ceiling, furn, books, notice, white, elev, frame, doorLeaf, clock, green, light, lit };
  }

  // ------------------------------------------------------------- helpers
  floorLabel(k) {
    return k === 0 ? 'Zemin kat' : k > 0 ? `${k}. kat` : `Bodrum ${-k}`;
  }

  floorY(b, k) {
    return b.y0 + k * b.floorH;
  }

  _insideBuilding(b, x, z) {
    const bb = b.bb;
    if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return false;
    if (!pointInRing(x, z, b.ring)) return false;
    for (const h of b.holes) if (pointInRing(x, z, h)) return false;
    return true;
  }

  buildingAt(x, z) {
    for (const b of this.candidates) if (this._insideBuilding(b, x, z)) return b;
    return null;
  }

  // ------------------------------------------------------------ per building
  _ensure(b) {
    let I = this.cache.get(b.id);
    if (I) return I;
    const doors = this.buildings.doorsByBuilding.get(b.id) || [];
    const library = this.data.pois.find((p) => p.cat === 'library');
    const opts = {};
    const open = b.area < 350 || b.special === 'amphitheatre' || b.special === 'roundhall' || b.cat === 'food';
    if (open) {
      opts.roomWidth = 400;
      opts.forceOpen = true;
    } else if (b.cat === 'dorm') opts.roomWidth = 4.6;
    if (library && this._insideBuilding(b, library.x, library.z)) opts.merge = [{ x: library.x, z: library.z, r: 17, type: 'library' }];
    const layout = generateLayout(b, doors, opts);
    const rand = rng(b.id >>> 0);
    // Number the rooms and pick their types once per building.
    const rooms = layout.rooms.slice().sort((p, q) => p.uMin - q.uMin || p.vMin - q.vMin);
    const roomInfo = new Map();
    rooms.forEach((room, i) => {
      const type = chooseType(b, room, rand, i);
      roomInfo.set(room.id, { room, type, index: i + 1 });
    });
    const I2 = {
      b, layout, roomInfo, doors,
      collision: new Collision(),
      floors: new Map(),
      group: new THREE.Group(),
      floorTexture: null,
      seed: b.id >>> 0,
    };
    for (const w of layout.walls) I2.collision.addSegment({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz });
    I2.group.visible = false;
    this.group.add(I2.group);
    this.cache.set(b.id, I2);
    I2.floorTexture = this._floorTexture(I2);
    return I2;
  }

  // Room facts of one floor. Where data/real.json has official codes for this floor they are assigned
  // to the rooms in plan order (the real position inside the floor is unknown); every other room gets
  // a generated code in the same scheme. The code's first digit counts floors from the entrance floor.
  _floorInfo(I, k) {
    if (!I.floorInfo) I.floorInfo = new Map();
    let map = I.floorInfo.get(k);
    if (map) return map;
    map = new Map();
    const b = I.b;
    const real = this.data.real && this.data.real.rooms[String(b.id)];
    const prefix = (real && real.prefix) || (b.name ? b.name.charAt(0).toUpperCase() : 'B');
    const digit = k - ((real && real.floorOffset) || 0);
    const list = real && real.floors[String(digit)] ? real.floors[String(digit)] : [];
    const ordered = Array.from(I.roomInfo.values()).sort((p, q) => p.index - q.index);
    const usable = ordered.filter((i) => i.type !== 'wc' && i.type !== 'storage');
    const taken = new Set(list.map((r) => r.code));
    const codeOf = (n) => (digit >= 0 ? `${prefix} ${digit}${String(n).padStart(2, '0')}` : `${prefix}B ${-digit}${String(n).padStart(2, '0')}`);
    let assigned = 0;
    for (const base of ordered) {
      const i = usable.indexOf(base);
      if (i >= 0 && i < list.length) {
        const r = list[i];
        map.set(base.room.id, { ...base, type: r.type, code: r.code, name: r.name, use: r.use, real: !!r.code });
        assigned++;
        continue;
      }
      let n = base.index;
      while (taken.has(codeOf(n))) n++;
      taken.add(codeOf(n));
      map.set(base.room.id, { ...base, code: codeOf(n), name: TYPE_LABEL[base.type] || 'Oda', real: false });
    }
    I.floorInfo.set(k, map);
    return map;
  }

  _floorTexture(I) {
    const L = I.layout;
    const PX = 6;
    const w = Math.ceil(L.W * CELL * PX);
    const h = Math.ceil(L.H * CELL * PX);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = FLOOR_COLOR.corridor;
    g.fillRect(0, 0, w, h);
    const colorOfZone = (z) => {
      if (z === 1) return FLOOR_COLOR.corridor;
      if (z < 10) return FLOOR_COLOR.core;
      const info = I.roomInfo.get(z);
      return FLOOR_COLOR[info ? info.type : 'classroom'] || FLOOR_COLOR.classroom;
    };
    const cellPx = CELL * PX;
    for (let j = 0; j < L.H; j++) {
      for (let i = 0; i < L.W; i++) {
        const z = L.zone[j * L.W + i];
        if (!z) continue;
        g.fillStyle = colorOfZone(z);
        g.fillRect(Math.floor(i * cellPx), Math.floor(j * cellPx), Math.ceil(cellPx) + 1, Math.ceil(cellPx) + 1);
      }
    }
    // Tile joints and carpet grain in oriented space.
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const r = rng(I.seed);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i4 = (y * w + x) * 4;
        const cellI = Math.floor(x / cellPx);
        const cellJ = Math.floor(y / cellPx);
        const z = L.zone[cellJ * L.W + cellI] || 0;
        let f = 1;
        const mx = (x / PX) % 0.6;
        const my = (y / PX) % 0.6;
        const tiled = z === 1 || z < 10;
        if (tiled && (mx < 0.03 || my < 0.03)) f = 0.9;
        f *= 0.97 + r() * 0.06;
        d[i4] *= f;
        d[i4 + 1] *= f;
        d[i4 + 2] *= f;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.16, roughness: 0.55, envMapIntensity: 0.15 });
  }

  // -------------------------------------------------------------- one floor
  _buildFloor(I, k) {
    const { b, layout: L } = I;
    const yf = this.floorY(b, k);
    const H = b.floorH;
    const yc = yf + H - 0.28;
    const group = new THREE.Group();
    const M = this.mats;
    const rand = rng((I.seed * 31 + (k + 20) * 977) >>> 0);
    const worldPoint = (pu, pv) => L.toWorld(pu, pv);

    // ---- slab and ceiling
    const tri = (ring, holes) => {
      const toV = (rg) => {
        const o = [];
        for (let i = 0; i < rg.length; i += 2) o.push(new THREE.Vector2(rg[i], rg[i + 1]));
        return o;
      };
      const contour = toV(ring);
      const hv = holes.map(toV);
      const idx = THREE.ShapeUtils.triangulateShape(contour, hv);
      return { pts: contour.concat(...hv), idx };
    };
    const t = tri(b.ring, b.holes);
    const slabAcc = new Acc();
    const ceilAcc = new Acc();
    const W = L.W * CELL;
    const Hh = L.H * CELL;
    for (const p of t.pts) {
      const pu = p.x * L.ux + p.y * L.uz;
      const pv = p.x * L.vx + p.y * L.vz;
      slabAcc.vert(p.x, yf, p.y, 0, 1, 0, (pu - L.ou) / W, 1 - (pv - L.ov) / Hh);
      ceilAcc.vert(p.x, yc, p.y, 0, -1, 0, p.x / 2.4, p.y / 2.4);
    }
    for (const [i, j, kk] of t.idx) {
      const ax = t.pts[i].x;
      const az = t.pts[i].y;
      const cross = (t.pts[j].y - az) * (t.pts[kk].x - ax) - (t.pts[j].x - ax) * (t.pts[kk].y - az);
      if (cross >= 0) {
        slabAcc.idx.push(i, j, kk);
        ceilAcc.idx.push(i, kk, j);
      } else {
        slabAcc.idx.push(i, kk, j);
        ceilAcc.idx.push(i, j, kk);
      }
    }
    const slab = new THREE.Mesh(slabAcc.build(), I.floorTexture);
    group.add(slab);
    const ceil = new THREE.Mesh(ceilAcc.build(), M.ceiling);
    group.add(ceil);

    // ---- inner faces of the exterior walls (with window holes and door openings)
    const winAcc = new Acc();
    const plainAcc = new Acc();
    const rings = [{ ring: b.ring, outer: true }, ...b.holes.map((h) => ({ ring: h, outer: false }))];
    const doorsOnFloor = I.doors.filter((d) => d.k === k);
    for (const { ring, outer } of rings) {
      const inset = ringInset(ring, 0.32);
      const n = ring.length / 2;
      let bays = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = inset[i * 2];
        const az = inset[i * 2 + 1];
        const bx = inset[j * 2];
        const bz = inset[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const olen = Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]) || 1;
        // Interior normal = opposite of the facade normal.
        const nx = -(ring[j * 2 + 1] - ring[i * 2 + 1]) / olen;
        const nz = (ring[j * 2] - ring[i * 2]) / olen;
        // Ground outside decides whether windows are useful.
        const mx = (ring[i * 2] + ring[j * 2]) / 2 - nx * 1.0;
        const mz = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2 - nz * 1.0;
        const outsideGround = this.hf.dem(mx, mz);
        const acc = outsideGround > yf + 1.0 ? plainAcc : winAcc;
        const nb = Math.max(1, Math.round(len / 3.4));
        const u0 = bays / 4;
        const uSpan = nb / 4;
        bays += nb;
        const cuts = outer ? doorsOnFloor.filter((d) => d.edge === i) : [];
        const pieces = [];
        if (!cuts.length) pieces.push([0, len, yf, yc]);
        else {
          cuts.sort((p, q) => p.s - q.s);
          let cur = 0;
          for (const d of cuts) {
            const s = (d.s / olen) * len;
            pieces.push([cur, s - 0.95, yf, yc]);
            pieces.push([s - 0.95, s + 0.95, yf + 2.55, yc]);
            cur = s + 0.95;
          }
          pieces.push([cur, len, yf, yc]);
        }
        for (const [s0, s1, yb, yt] of pieces) {
          if (s1 - s0 < 0.02 || yt - yb < 0.02) continue;
          const t0 = s0 / len;
          const t1 = s1 / len;
          wallQuad(acc, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, yb, yt, nx, nz, u0 + uSpan * t0, u0 + uSpan * t1, (yb - yf) / H, (yt - yf) / H);
        }
      }
    }
    for (const [acc, mat] of [[winAcc, M.wallWin], [plainAcc, M.wallPlain]]) {
      if (!acc.idx.length) continue;
      const m = new THREE.Mesh(acc.build(), mat);
      group.add(m);
    }

    // ---- partitions, door frames and lintels
    const partAcc = new Acc();
    for (const w of L.walls) {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      if (len < 0.05) continue;
      const nx = (w.bz - w.az) / len;
      const nz = -(w.bx - w.ax) / len;
      const off = 0.07;
      const u1 = len / 13.6;
      const v1 = (yc - yf) / H;
      wallQuad(partAcc, w.ax + nx * off, w.az + nz * off, w.bx + nx * off, w.bz + nz * off, yf, yc, nx, nz, 0, u1, 0, v1);
      wallQuad(partAcc, w.ax - nx * off, w.az - nz * off, w.bx - nx * off, w.bz - nz * off, yf, yc, -nx, -nz, 0, u1, 0, v1);
    }
    const frameBoxes = [];
    const signs = [];
    const coreSet = new Set(L.cores.map((c) => c.id));
    for (const d of L.doors) {
      const hw = 0.5;
      const tx = d.tx;
      const tz = d.tz;
      const lx0 = d.x - tx * hw;
      const lz0 = d.z - tz * hw;
      const lx1 = d.x + tx * hw;
      const lz1 = d.z + tz * hw;
      const nx = d.nx;
      const nz = d.nz;
      // Lintel above the opening (both faces).
      for (const s of [1, -1]) {
        wallQuad(partAcc, lx0 + nx * 0.07 * s, lz0 + nz * 0.07 * s, lx1 + nx * 0.07 * s, lz1 + nz * 0.07 * s, yf + 2.15, yc, nx * s, nz * s, 0, 0.08, 0.58, 1);
      }
      // Underside and jambs.
      frameBoxes.push({ x: lx0, z: lz0, w: 0.08, d: 0.22, h: 2.15, yaw: Math.atan2(nx, nz) });
      frameBoxes.push({ x: lx1, z: lz1, w: 0.08, d: 0.22, h: 2.15, yaw: Math.atan2(nx, nz) });
      // Sign on the corridor side of the wall next to the door.
      const roomZone = d.a === 1 ? d.b : d.a;
      const otherZone = d.a === 1 ? d.a : d.b;
      const info = this._floorInfo(I, k).get(roomZone);
      if (!info || coreSet.has(roomZone) || roomZone === 1) {
        if (coreSet.has(roomZone) || coreSet.has(otherZone)) signs.push({ x: d.x + tx * 0.95, z: d.z + tz * 0.95, nx, nz, text: 'Merdiven / Asansör', style: 'core', d });
        continue;
      }
      const label = info.name || TYPE_LABEL[info.type] || 'Oda';
      signs.push({ x: d.x + tx * 0.95, z: d.z + tz * 0.95, nx, nz, text: info.code ? `${info.code} ${label}` : label, style: info.type === 'wc' ? 'wc' : 'plate', d, roomZone });
    }
    if (partAcc.idx.length) {
      const m = new THREE.Mesh(partAcc.build(), M.wallBoth);
      group.add(m);
    }
    this._frames(group, frameBoxes, yf);
    this._doorLeaves(group, I, k, yf, coreSet);

    // ---- lights
    this._lights(group, L, yc, rand);

    // ---- furniture, signs, boards
    const inst = {};
    const put = (type, x, y, z, yaw, s = 1) => {
      (inst[type] || (inst[type] = [])).push({ x, y, z, yaw, s });
    };
    this._furnish(I, k, yf, yc, rand, put, group);
    this._signs(I, signs, yf, group);
    this._boards(I, k, yf, rand, group);
    this._cores(I, k, yf, yc, group);
    this._lobbies(I, k, yf, put, rand, group);
    I.seats = I.seats || new Map();
    I.seats.set(k, [...(inst.chair || []), ...(inst.benchSeat || [])].filter((q) => q.s === 1));
    I.counters = I.counters || new Map();
    I.counters.set(k, inst.counter || []);
    for (const [type, list] of Object.entries(inst)) {
      const geo = this.geo[type];
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, M.furn, list.length);
      const d = new THREE.Object3D();
      const col = new THREE.Color();
      list.forEach((it, i) => {
        d.position.set(it.x, it.y, it.z);
        d.rotation.set(0, it.yaw, 0);
        d.scale.setScalar(it.s);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        const j = 0.88 + hash01(i * 13 + type.length) * 0.24;
        col.setRGB(j, j, j);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    group.visible = false;
    I.group.add(group);
    I.floors.set(k, group);
    return group;
  }

  // Room door leaves standing open at slightly different angles (the openings stay passable).
  _doorLeaves(group, I, k, yf, coreSet) {
    const L = I.layout;
    const list = [];
    for (const d of L.doors) {
      const roomZone = d.a === 1 ? d.b : d.a;
      if (roomZone === 1 || coreSet.has(roomZone) || !I.roomInfo.get(roomZone)) continue;
      // Unit normal pointing into the room.
      let nx = d.nx;
      let nz = d.nz;
      if (L.cellAt(d.x + nx * 0.7, d.z + nz * 0.7) !== roomZone) {
        nx = -nx;
        nz = -nz;
      }
      const h1 = hash01(Math.floor(d.x * 13.7) * 31 + Math.floor(d.z * 7.3) + k * 5);
      const h2 = hash01(Math.floor(d.x * 5.1) * 17 + Math.floor(d.z * 11.9) + k * 3);
      const hs = h1 < 0.5 ? 1 : -1;
      const tx = d.tx;
      const tz = d.tz;
      const hx = d.x + tx * 0.5 * hs;
      const hz = d.z + tz * 0.5 * hs;
      const th = 1.15 + h2 * 0.35;
      const dx = Math.cos(th) * -hs * tx + Math.sin(th) * nx;
      const dz = Math.cos(th) * -hs * tz + Math.sin(th) * nz;
      list.push({ x: hx, z: hz, yaw: Math.atan2(-dz, dx) });
    }
    if (!list.length) return;
    const geo = new THREE.BoxGeometry(0.9, 2.06, 0.045);
    geo.translate(0.45, 1.03, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.doorLeaf, list.length);
    const o = new THREE.Object3D();
    list.forEach((it, i) => {
      o.position.set(it.x, yf, it.z);
      o.rotation.set(0, it.yaw, 0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  _frames(group, boxes, yf) {
    if (!boxes.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.frame, boxes.length);
    const d = new THREE.Object3D();
    boxes.forEach((bx, i) => {
      d.position.set(bx.x, yf, bx.z);
      d.rotation.set(0, bx.yaw, 0);
      d.scale.set(bx.w, bx.h, bx.d);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  _lights(group, L, yc, rand) {
    const pos = [];
    for (let j = 3; j < L.H; j += 6) {
      for (let i = 3; i < L.W; i += 6) {
        const z = L.zone[j * L.W + i];
        if (!z) continue;
        const [x, zz] = L.cellCenter(i, j);
        pos.push([x, zz]);
      }
    }
    if (!pos.length) return;
    const geo = new THREE.PlaneGeometry(0.6, 1.2);
    geo.rotateX(Math.PI / 2); // face down
    const mesh = new THREE.InstancedMesh(geo, this.mats.light, pos.length);
    const d = new THREE.Object3D();
    pos.forEach(([x, z], i) => {
      d.position.set(x, yc - 0.01, z);
      d.rotation.set(0, Math.atan2(L.ux, L.uz) + Math.PI / 2, 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    void rand;
  }

  _signs(I, signs, yf, group) {
    const byPage = new Map();
    for (const s of signs) {
      const e = this.atlas.get(s.text, s.style);
      let acc = byPage.get(e.page);
      if (!acc) byPage.set(e.page, (acc = new Acc()));
      // Which side is the corridor? The sign goes on the side with zone 1 (or non-room).
      const L = I.layout;
      const zA = L.cellAt(s.x + s.nx * 0.4, s.z + s.nz * 0.4);
      const sideSign = zA === 1 || (zA < 10 && zA > 0) ? 1 : -1;
      const nx = s.nx * sideSign;
      const nz = s.nz * sideSign;
      const w = 0.62;
      const h = 0.155;
      // Viewer's right vector when looking at a face with normal (nx, nz).
      const tx = nz;
      const tz = -nx;
      const cx = s.x + nx * 0.09;
      const cz = s.z + nz * 0.09;
      const y0 = yf + 1.72;
      const a0 = acc.vert(cx - tx * w / 2, y0, cz - tz * w / 2, nx, 0, nz, e.u0, e.v0);
      const a1 = acc.vert(cx + tx * w / 2, y0, cz + tz * w / 2, nx, 0, nz, e.u1, e.v0);
      const a2 = acc.vert(cx + tx * w / 2, y0 + h, cz + tz * w / 2, nx, 0, nz, e.u1, e.v1);
      const a3 = acc.vert(cx - tx * w / 2, y0 + h, cz - tz * w / 2, nx, 0, nz, e.u0, e.v1);
      acc.quad(a0, a1, a2, a3);
    }
    for (const [page, acc] of byPage) {
      const m = new THREE.Mesh(acc.build(), page.mat);
      group.add(m);
    }
  }

  _boards(I, k, yf, rand, group) {
    // Notice boards along corridor walls.
    const L = I.layout;
    const acc = new Acc();
    let count = 0;
    const walls = L.walls.slice().sort(() => rand() - 0.5);
    for (const w of walls) {
      if (count >= 7) break;
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      if (len < 4.5) continue;
      const mx = (w.ax + w.bx) / 2;
      const mz = (w.az + w.bz) / 2;
      const nx = (w.bz - w.az) / len;
      const nz = -(w.bx - w.ax) / len;
      const zA = L.cellAt(mx + nx * 0.4, mz + nz * 0.4);
      const zB = L.cellAt(mx - nx * 0.4, mz - nz * 0.4);
      let s;
      if (zA === 1) s = 1;
      else if (zB === 1) s = -1;
      else continue;
      const bx = mx + nx * s * 0.09 + (w.bx - w.ax) / len * (rand() - 0.5) * (len - 3);
      const bz = mz + nz * s * 0.09 + (w.bz - w.az) / len * (rand() - 0.5) * (len - 3);
      // Skip if a door is close.
      if (L.doors.some((d) => Math.hypot(d.x - bx, d.z - bz) < 1.8)) continue;
      const fx = nx * s;
      const fz = nz * s;
      const tx = fz;
      const tz = -fx;
      const bw = 1.3;
      const bh = 0.9;
      const y0 = yf + 1.05;
      const a0 = acc.vert(bx - tx * bw / 2, y0, bz - tz * bw / 2, fx, 0, fz, 0, 0);
      const a1 = acc.vert(bx + tx * bw / 2, y0, bz + tz * bw / 2, fx, 0, fz, 1, 0);
      const a2 = acc.vert(bx + tx * bw / 2, y0 + bh, bz + tz * bw / 2, fx, 0, fz, 1, 1);
      const a3 = acc.vert(bx - tx * bw / 2, y0 + bh, bz - tz * bw / 2, fx, 0, fz, 0, 1);
      acc.quad(a0, a1, a2, a3);
      count++;
    }
    if (acc.idx.length) group.add(new THREE.Mesh(acc.build(), this.mats.notice));
    void k;
  }

  _cores(I, k, yf, yc, group) {
    const L = I.layout;
    const b = I.b;
    for (const core of L.cores) {
      if (!core.door) continue;
      const d = core.door;
      // Elevator panel on the wall opposite the door.
      const dirX = core.x - d.x;
      const dirZ = core.z - d.z;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const ex = dirX / dl;
      const ez = dirZ / dl;
      const half = Math.abs(ex * L.ux + ez * L.uz) > 0.5 ? 2.6 : 1.8;
      const px = core.x + ex * (half - 0.08);
      const pz = core.z + ez * (half - 0.08);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.2), this.mats.elev);
      plane.position.set(px, yf + 1.1, pz);
      plane.rotation.y = Math.atan2(-ex, -ez);
      group.add(plane);
      // Floor number plate.
      const e = this.atlas.get(`${this.floorLabel(k)}`, 'core');
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), e.page.mat);
      plate.geometry.attributes.uv.setXY(0, e.u0, e.v1);
      plate.geometry.attributes.uv.setXY(1, e.u1, e.v1);
      plate.geometry.attributes.uv.setXY(2, e.u0, e.v0);
      plate.geometry.attributes.uv.setXY(3, e.u1, e.v0);
      plate.position.set(px - ex * 0.02, yf + 2.45, pz - ez * 0.02);
      plate.rotation.y = Math.atan2(-ex, -ez);
      group.add(plate);
    }
    void yc;
    void b;
  }

  _lobbies(I, k, yf, put, rand, group) {
    const b = I.b;
    for (const d of I.doors.filter((q) => q.k === k)) {
      const inx = -d.nx;
      const inz = -d.nz;
      const tx = -d.nz;
      const tz = d.nx;
      // Building name plate over the entrance, inside.
      if (b.name) {
        const e = this.atlas.get(b.name.replace(' ve ', ' & '), 'plate');
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), e.page.mat);
        m.geometry.attributes.uv.setXY(0, e.u0, e.v1);
        m.geometry.attributes.uv.setXY(1, e.u1, e.v1);
        m.geometry.attributes.uv.setXY(2, e.u0, e.v0);
        m.geometry.attributes.uv.setXY(3, e.u1, e.v0);
        m.position.set(d.x + inx * 0.36, yf + 3.0, d.z + inz * 0.36);
        m.rotation.y = Math.atan2(inx, inz);
        group.add(m);
      }
      // Benches, kiosk and plants near the entrance.
      const L = I.layout;
      const spots = [
        { a: 2.4, t: 2.2, type: 'plant', s: 1 },
        { a: 2.4, t: -2.2, type: 'plant', s: 1.1 },
        { a: 3.6, t: 1.5, type: 'sofa', s: 1 },
        { a: 5.4, t: -1.2, type: 'kiosk', s: 1 },
      ];
      for (const sp of spots) {
        const x = d.x + inx * sp.a + tx * sp.t;
        const z = d.z + inz * sp.a + tz * sp.t;
        if (L.cellAt(x, z) !== 1) continue;
        const yaw = sp.type === 'sofa' ? Math.atan2(-inx, -inz) + Math.PI : Math.atan2(inx, inz);
        put(sp.type, x, yf, z, yaw, sp.s);
      }
    }
    void rand;
  }

  // ---------------------------------------------------------------- furniture
  _furnish(I, k, yf, yc, rand, put, group) {
    const L = I.layout;
    const toW = (pu, pv) => L.toWorld(pu, pv);
    const yawOf = (a, b) => {
      // Oriented direction (a along u, b along v) -> world yaw with local +z = that direction.
      const dx = a * L.ux + b * L.vx;
      const dz = a * L.uz + b * L.vz;
      return Math.atan2(dx, dz);
    };
    for (const room of L.rooms) {
      const info = this._floorInfo(I, k).get(room.id);
      if (!info) continue;
      const type = info.type;
      const cu = (room.uMin + room.uMax) / 2;
      const cv = (room.vMin + room.vMax) / 2;
      const halfU = (room.uMax - room.uMin) / 2;
      const halfV = (room.vMax - room.vMin) / 2;
      const inRoom = (pu, pv, r = 0.3) => {
        for (const [du, dv] of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) {
          const [x, z] = toW(pu + du, pv + dv);
          if (L.cellAt(x, z) !== room.id) return false;
        }
        return true;
      };
      const add = (t, pu, pv, yaw, s = 1, y = yf, r = 0.3) => {
        if (!inRoom(pu, pv, r)) return false;
        const [x, z] = toW(pu, pv);
        put(t, x, y, z, yaw, s);
        return true;
      };
      // Front side: opposite the door.
      let front = { ax: 'u', sign: 1 };
      if (room.door) {
        const du = (room.door.x * L.ux + room.door.z * L.uz - cu) / Math.max(1, halfU);
        const dv = (room.door.x * L.vx + room.door.z * L.vz - cv) / Math.max(1, halfV);
        if (Math.abs(du) > Math.abs(dv)) front = { ax: 'u', sign: du > 0 ? -1 : 1 };
        else front = { ax: 'v', sign: dv > 0 ? -1 : 1 };
      }
      const fu = front.ax === 'u' ? front.sign : 0;
      const fv = front.ax === 'v' ? front.sign : 0;
      const frontLen = front.ax === 'u' ? room.uMax - room.uMin : room.vMax - room.vMin;
      const acrossLen = front.ax === 'u' ? room.vMax - room.vMin : room.uMax - room.uMin;
      const frontWall = front.ax === 'u' ? (front.sign > 0 ? room.uMax : room.uMin) : front.sign > 0 ? room.vMax : room.vMin;
      const across0 = front.ax === 'u' ? cv : cu;
      // Position helper in (along-front distance from front wall, across offset).
      const pos = (df, ac) => {
        const f = frontWall - front.sign * df;
        return front.ax === 'u' ? [f, across0 + ac] : [across0 + ac, f];
      };
      const yawFront = yawOf(fu, fv);
      const yawBack = yawOf(-fu, -fv);
      const rectangular = room.fill > 0.72;

      if ((type === 'classroom' || type === 'lecture' || type === 'seminar' || type === 'complab') && rectangular && frontLen > 4 && acrossLen > 3.6) {
        const rowGap = type === 'lecture' ? 1.25 : type === 'seminar' ? 1.6 : 1.4;
        const colStep = type === 'lecture' ? 2.5 : 1.55;
        const cols = Math.max(1, Math.floor((acrossLen - 1.4) / colStep));
        let rows = 0;
        for (let df = 2.6; df < frontLen - 1.0; df += rowGap) {
          for (let c = 0; c < cols; c++) {
            const ac = (c - (cols - 1) / 2) * colStep;
            const [pu, pv] = pos(df, ac);
            if (type === 'lecture') {
              // Long bench with students' chairs behind it.
              add('bench', pu, pv, yawFront, 1);
              for (const off of [-0.8, 0, 0.8]) {
                const [cu2, cv2] = pos(df + 0.65, ac + off);
                add('chair', cu2, cv2, yawFront, 1, yf, 0.2);
              }
            } else {
              add('desk', pu, pv, yawFront, 1);
              if (type === 'complab') {
                const [mu, mv] = pos(df, ac);
                add('monitor', mu, mv, yawFront, 1, yf + 0, 0.2);
              }
              for (const off of [-0.32, 0.32]) {
                const [cu2, cv2] = pos(df + 0.62, ac + off);
                add('chair', cu2, cv2, yawFront, 1, yf, 0.2);
              }
            }
          }
          rows++;
          if (rows > 12) break;
        }
        // Teacher desk and board on the front wall.
        const [tu, tv] = pos(1.15, 0);
        add('teacherDesk', tu, tv, yawFront, 1);
        const [pu2, pv2] = pos(1.45, 0.9);
        add('chair', pu2, pv2, yawBack, 1, yf, 0.2);
        const [bu, bv] = pos(0.16, 0);
        const [bxw, bzw] = toW(bu, bv);
        const bw = Math.min(3.6, acrossLen - 1.2);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.2), this.mats.white);
        board.position.set(bxw, yf + 1.75, bzw);
        board.rotation.y = yawBack;
        group.add(board);
        if (type === 'lecture') {
          const [pu3, pv3] = pos(1.6, -acrossLen / 2 + 1.2);
          add('podium', pu3, pv3, yawBack, 1, yf, 0.3);
        }
        // Wall clock beside the board and a ceiling projector aimed at the front.
        const [clu, clv] = pos(0.05, bw / 2 + 0.45);
        if (inRoom(clu, clv, 0.05)) {
          const [cxw, czw] = toW(clu, clv);
          const clockMesh = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), this.mats.clock);
          clockMesh.position.set(cxw, yf + 2.45, czw);
          clockMesh.rotation.y = yawBack;
          group.add(clockMesh);
        }
        const [pru, prv] = pos(frontLen * 0.5, 0);
        add('projector', pru, prv, yawFront, 1, yf, 0.3);
      } else if (type === 'lab' || type === 'workshop') {
        const alongLong = frontLen >= acrossLen;
        const stepAc = 2.2;
        const cols = Math.max(1, Math.floor((acrossLen - 1.6) / stepAc));
        for (let df = 1.8; df < frontLen - 1.4; df += type === 'workshop' ? 3.2 : 3.0) {
          for (let c = 0; c < cols; c++) {
            const ac = (c - (cols - 1) / 2) * stepAc;
            const [pu, pv] = pos(df, ac);
            if (type === 'workshop') {
              add('machine', pu, pv, yawFront + (rand() < 0.5 ? 0 : Math.PI / 2), 1, yf, 0.6);
            } else {
              add('labBench', pu, pv, yawOf(front.ax === 'u' ? 0 : 1, front.ax === 'u' ? 1 : 0), 1, yf, 0.6);
              const [su, sv] = pos(df + 0.7, ac - 0.6);
              add('stool', su, sv, 0, 1, yf, 0.2);
              const [su2, sv2] = pos(df + 0.7, ac + 0.6);
              add('stool', su2, sv2, 0, 1, yf, 0.2);
            }
          }
        }
        void alongLong;
        for (let n = 0; n < 3; n++) {
          const [cu2, cv2] = pos(0.6 + rand() * 0.6, (rand() - 0.5) * (acrossLen - 1.4));
          add('crate', cu2, cv2, rand() * 6, 1, yf, 0.5);
        }
      } else if (type === 'office' || type === 'storage') {
        if (type === 'office') {
          const [pu, pv] = pos(frontLen * 0.5, 0);
          add('teacherDesk', pu, pv, yawBack, 0.85, yf, 0.6);
          const [cu2, cv2] = pos(frontLen * 0.5 + 0.9, 0);
          add('chair', cu2, cv2, yawFront, 1, yf, 0.2);
          const [mu, mv] = pos(frontLen * 0.5, 0.2);
          add('monitor', mu, mv, yawFront, 1, yf, 0.2);
          const [su, sv] = pos(0.4, acrossLen / 2 - 0.7);
          add('shelf', su, sv, yawBack, 1, yf, 0.4);
          const [pu4, pv4] = pos(0.5, -acrossLen / 2 + 0.5);
          add('plant', pu4, pv4, 0, 1, yf, 0.3);
        } else {
          for (let n = 0; n < 6; n++) {
            const [cu2, cv2] = pos(0.6 + rand() * (frontLen - 1.4), (rand() - 0.5) * (acrossLen - 1.2));
            add('crate', cu2, cv2, rand() * 6, 0.8 + rand() * 0.6, yf, 0.5);
          }
        }
      } else if (type === 'hall') {
        const [su, sv] = pos(1.6, 0);
        add('stage', su, sv, yawBack, 1, yf, 0.9);
        const [pu5, pv5] = pos(3.4, 2.4);
        add('podium', pu5, pv5, yawBack, 1, yf, 0.3);
        const cols = Math.max(1, Math.floor((acrossLen - 1.2) / 2.7));
        for (let df = 4.6; df < frontLen - 0.8; df += 1.15) {
          for (let c = 0; c < cols; c++) {
            const ac = (c - (cols - 1) / 2) * 2.7;
            const [bu2, bv2] = pos(df, ac);
            add('benchSeat', bu2, bv2, yawFront, 1, yf, 0.5);
          }
        }
      } else if (type === 'studio') {
        // Green screen on the front wall, lights, camera and a small desk.
        const [gu, gv] = pos(0.16, 0);
        const [gx, gz] = toW(gu, gv);
        const gw = Math.min(4.6, acrossLen - 1.0);
        if (type === 'studio' && gw > 2) {
          const gs = new THREE.Mesh(new THREE.PlaneGeometry(gw, 2.6), this.mats.green);
          gs.position.set(gx, yf + 1.5, gz);
          gs.rotation.y = yawBack;
          group.add(gs);
        }
        if (rectangular) {
          for (const side of [-1, 1]) {
            const [lu, lv] = pos(2.4, side * Math.min(2.0, acrossLen / 2 - 0.8));
            add('softbox', lu, lv, yawOf(fu, fv), 1, yf, 0.4);
          }
          const [cu2, cv2] = pos(frontLen * 0.6, 0);
          add('camera', cu2, cv2, yawFront + Math.PI, 1, yf, 0.4);
          const [du, dv] = pos(frontLen - 1.4, acrossLen / 2 - 1.2);
          add('libTable', du, dv, yawFront, 0.9, yf, 0.8);
          for (const off of [-0.5, 0.5]) {
            const [ku, kv] = pos(frontLen - 0.7, acrossLen / 2 - 1.2 + off);
            add('chair', ku, kv, yawFront, 1, yf, 0.2);
          }
        }
      } else if (type === 'dorm') {
        // Two beds along the side walls, desks under the window side, wardrobe by the door.
        const across = acrossLen / 2 - 0.65;
        const [b1u, b1v] = pos(frontLen / 2 - 0.1, -across);
        add('bed', b1u, b1v, yawOf(-fu, -fv) + Math.PI, 1, yf, 0.5);
        const [b2u, b2v] = pos(frontLen / 2 - 0.1, across);
        add('bed', b2u, b2v, yawOf(-fu, -fv) + Math.PI, 1, yf, 0.5);
        for (const s of [-1, 1]) {
          const [du, dv] = pos(0.5, s * (acrossLen / 2 - 0.7));
          add('desk', du, dv, yawBack, 0.8, yf, 0.5);
          const [cu2, cv2] = pos(1.1, s * (acrossLen / 2 - 0.7));
          add('chair', cu2, cv2, yawFront, 1, yf, 0.2);
        }
        const [wu, wv] = pos(frontLen - 0.5, 0);
        add('wardrobe', wu, wv, yawFront, 1, yf, 0.5);
      } else if (type === 'library') {
        // Shelf rows along u with reading tables between them.
        for (let pv = room.vMin + 1.0; pv < room.vMax - 0.8; pv += 3.4) {
          for (let pu = room.uMin + 1.0; pu < room.uMax - 1.0; pu += 1.05) {
            const x = 0;
            void x;
            add('shelf', pu, pv, yawOf(0, 1), 1, yf, 0.45);
          }
          const tv = pv + 1.7;
          for (let pu = room.uMin + 1.6; pu < room.uMax - 1.6; pu += 2.4) {
            if (add('libTable', pu, tv, yawOf(1, 0), 1, yf, 0.9)) {
              add('chair', pu - 0.5, tv + 0.65, yawOf(0, -1), 1, yf, 0.2);
              add('chair', pu + 0.5, tv + 0.65, yawOf(0, -1), 1, yf, 0.2);
              add('chair', pu - 0.5, tv - 0.65, yawOf(0, 1), 1, yf, 0.2);
              add('chair', pu + 0.5, tv - 0.65, yawOf(0, 1), 1, yf, 0.2);
            }
          }
        }
      } else if (type === 'lounge') {
        for (let n = 0; n < 3; n++) {
          const [su, sv] = pos(0.9 + n * 1.8, (n % 2 ? -1 : 1) * (acrossLen / 2 - 1.0));
          add('sofa', su, sv, yawFront + (n % 2 ? Math.PI / 2 : -Math.PI / 2), 1, yf, 0.9);
        }
        const [tu, tv] = pos(frontLen / 2, 0);
        add('cafeTable', tu, tv, 0, 1.3, yf, 0.5);
      } else if (type === 'cafe') {
        // Counter along the back wall and tables in the rest of the room.
        const [cu2, cv2] = pos(frontLen - 1.0, 0);
        add('counter', cu2, cv2, yawFront + Math.PI, 1, yf, 1.2);
        for (let df = 1.6; df < frontLen - 3.0; df += 1.9) {
          for (let ac = -acrossLen / 2 + 1.4; ac < acrossLen / 2 - 1.0; ac += 1.9) {
            const [tu, tv] = pos(df, ac);
            if (add('cafeTable', tu, tv, 0, 1, yf, 0.45)) {
              for (const off of [[0.5, 0], [-0.5, 0]]) {
                const [ku, kv] = pos(df + off[0], ac + off[1]);
                add('chair', ku, kv, yawFront, 1, yf, 0.2);
              }
            }
          }
        }
      }
    }
    void yc;
  }

  // ------------------------------------------------------------- lifecycle
  _showFloor(I, k) {
    for (const [fk, g] of I.floors) g.visible = fk === k;
    let g = I.floors.get(k);
    if (!g) g = this._buildFloor(I, k);
    g.visible = true;
  }

  // ------------------------------------------------------- people inside
  _corridorPath(I, ax, az, bx, bz) {
    const L = I.layout;
    const start = this._cellIndex(L, ax, az);
    const goal = this._cellIndex(L, bx, bz);
    if (start < 0 || goal < 0) return null;
    const W = L.W;
    const prev = new Int32Array(L.W * L.H).fill(-2);
    const queue = [start];
    prev[start] = -1;
    let qi = 0;
    let found = false;
    while (qi < queue.length) {
      const c = queue[qi++];
      if (c === goal) {
        found = true;
        break;
      }
      const ci = c % W;
      const cj = (c / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= L.H) continue;
        const nk = nj * W + ni;
        if (prev[nk] !== -2 || L.zone[nk] !== 1) continue;
        prev[nk] = c;
        queue.push(nk);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c >= 0; c = prev[c]) cells.push(c);
    cells.reverse();
    // Waypoints every ~2.5 m, plus the goal.
    const pts = [];
    for (let i = 0; i < cells.length; i += 5) {
      const c = cells[i];
      pts.push(L.cellCenter(c % W, (c / W) | 0));
    }
    const last = cells[cells.length - 1];
    pts.push(L.cellCenter(last % W, (last / W) | 0));
    return pts;
  }

  _cellIndex(L, x, z) {
    const i = Math.floor((x * L.ux + z * L.uz - L.ou) / CELL);
    const j = Math.floor((x * L.vx + z * L.vz - L.ov) / CELL);
    if (i < 0 || j < 0 || i >= L.W || j >= L.H) return -1;
    return j * L.W + i;
  }

  _randomCorridorPoint(I, rand) {
    const L = I.layout;
    const c = L.corridorCells[Math.floor(rand() * L.corridorCells.length)];
    return L.cellCenter(c % L.W, (c / L.W) | 0);
  }

  _populate(I, k) {
    const crowd = this.crowd;
    crowd.clearInterior();
    const L = I.layout;
    const b = I.b;
    const yf = this.floorY(b, k);
    const rand = rng((I.seed * 7 + (k + 9) * 131 + 17) >>> 0);
    const sim = this.sim;
    const info = sim.clock ? sim.clock.info : { type: 'term', wd: 3 };
    const hours = sim.clock ? sim.clock.hours : 12;
    const h = hours;
    const sched = sim.schedule;
    const level = sched ? sched.indoorLevel(info, hours, b.special ? 'venue' : b.cat === 'academic' || b.cat === 'generic' ? 'academic' : b.cat) : { seats: 0.35, corridor: 1 };
    const sfl = sched ? sched.sflInSession(info, hours) : { A: true, B: true, C: true };
    const p = sched ? sched.period(hours) : { phase: 'class', toEnd: 20 };
    const teaching = info.type === 'term' || info.type === 'makeup';
    // A closed cafe stays empty.
    let closed = false;
    if (b.name === 'Starbucks' && sched) {
      const o = sched.openState('Starbucks', info, hours);
      closed = !!(o && !o.open);
    }
    // What people do on a chair depends on where they are: cafes talk, classrooms write.
    const seatPool = b.cat === 'food' ? ['sit', 'sitTalk', 'sitPhone', 'sit', 'sitTalk']
      : b.cat === 'dorm' ? ['sit', 'sitPhone', 'sitTalk', 'sitType']
      : b.special === 'amphitheatre' || b.special === 'roundhall' ? ['sit', 'sitTalk', 'sitPhone']
      : ['sitWrite', 'sitWrite', 'sitPhone', 'sitType', 'sit', 'sitTalk'];
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const floorInfo = this._floorInfo(I, k);
    const seats = (I.seats && I.seats.get(k)) || [];
    // Group the chairs by room so every room can be in session (or empty) on its own.
    const rooms = new Map();
    for (const c of seats) {
      const z = L.cellAt(c.x, c.z);
      if (!rooms.has(z)) rooms.set(z, []);
      rooms.get(z).push(c);
    }
    const SEAT_CAP = 56;
    // First pass: what each room is doing; second pass: place people, scaled to the budget.
    const plans = [];
    let desired = 0;
    for (const [zone, list] of rooms) {
      if (closed) break;
      const fi = floorInfo.get(zone);
      let fill = level.seats;
      let session = false;
      let pool = seatPool;
      if (fi && fi.use && /Hazırlık grubu/.test(fi.use)) {
        // E Blok preparatory classes follow the official SFL windows (levels A, B, C).
        const lvl = (fi.use.match(/grubu ([ABC])/) || [])[1];
        session = !!(lvl && sfl[lvl]);
        fill = session ? 0.9 : 0.02;
        pool = ['sitWrite', 'sitWrite', 'sitWrite', 'sit', 'sit', 'sitPhone'];
      } else if (fi && ['classroom', 'lecture', 'seminar', 'complab', 'lab'].includes(fi.type) && teaching) {
        session = p.phase === 'class' && rand() < 0.55;
        fill = session ? 0.85 : level.seats * 0.3;
        pool = fi.type === 'complab' || fi.type === 'lab' ? ['sitType', 'sitType', 'sitWrite', 'sit'] : ['sitWrite', 'sitWrite', 'sit', 'sit', 'sitPhone'];
      }
      if (fi && fi.type === 'library') {
        // The library's lower floor is open around the clock; the upper floor keeps office hours.
        const open = h >= 8.5 && h < 22 && info.wd !== 0;
        fill = info.type === 'exam' ? (open || k <= 0 ? 0.75 : 0.1) : open ? 0.5 : k <= 0 ? 0.28 : 0;
        pool = ['sitRead', 'sitType', 'sitRead', 'sitWrite', 'sit'];
      }
      const want = Math.round(list.length * fill);
      desired += want;
      plans.push({ zone, list, want, session, pool });
    }
    const scale = desired > SEAT_CAP ? SEAT_CAP / desired : 1;
    let instructors = 0;
    for (const pl of plans) {
      const shuffled = pl.list.slice().sort(() => rand() - 0.5);
      const n = Math.min(shuffled.length, pl.want > 1 ? Math.max(2, Math.round(pl.want * scale)) : pl.want);
      for (let i = 0; i < n; i++) {
        const c = shuffled[i];
        const fx = Math.sin(c.yaw);
        const fz = Math.cos(c.yaw);
        crowd.addInterior({ kind: 'sit', x: c.x + fx * 0.02, z: c.z + fz * 0.02, y: yf, yaw: c.yaw + Math.PI, activity: pick(pl.pool) });
      }
      if (pl.session && n >= 2 && instructors < 10) {
        // The instructor stands in front of the first row, facing the class.
        let fx = 0;
        let fz = 0;
        let cx = 0;
        let cz = 0;
        for (const c of pl.list) {
          fx += Math.sin(c.yaw);
          fz += Math.cos(c.yaw);
          cx += c.x;
          cz += c.z;
        }
        const len = Math.hypot(fx, fz) || 1;
        fx /= len;
        fz /= len;
        cx /= pl.list.length;
        cz /= pl.list.length;
        let reach = 0;
        for (const c of pl.list) reach = Math.max(reach, (c.x - cx) * fx + (c.z - cz) * fz);
        for (const gap of [1.7, 1.3, 0.9]) {
          const x = cx + fx * (reach + gap);
          const z = cz + fz * (reach + gap);
          if (L.cellAt(x, z) === pl.zone && crowd.addInterior({ kind: 'stand', x, z, y: yf, yaw: Math.atan2(fx, fz), activity: 'lecture' })) {
            instructors++;
            break;
          }
        }
      }
    }
    // Baristas behind the counter of the cafe.
    if (!closed) {
      for (const c of (I.counters && I.counters.get(k)) || []) {
        for (const off of [-0.7, 0.7]) {
          const tx = Math.cos(c.yaw);
          const tz = -Math.sin(c.yaw);
          crowd.addInterior({ kind: 'stand', x: c.x - Math.sin(c.yaw) * 0.85 + tx * off, z: c.z - Math.cos(c.yaw) * 0.85 + tz * off, y: yf, yaw: c.yaw + Math.PI, activity: 'work' });
        }
      }
    }
    // Corridor life: walkers and small groups; busy at the bells, quiet during lessons and at night.
    if (L.corridorCells.length > 40 && !closed) {
      const walkers = Math.round(9 * level.corridor);
      const groups = Math.round(4 * level.corridor);
      for (let i = 0; i < walkers; i++) {
        const [sx, sz] = this._randomCorridorPoint(I, rand);
        const pickTarget = (n) => {
          for (let tries = 0; tries < 12; tries++) {
            const [tx, tz] = this._randomCorridorPoint(I, rand);
            const dist = Math.hypot(tx - n.x, tz - n.z);
            if (dist < 8 || dist > 40) continue;
            const path = this._corridorPath(I, n.x, n.z, tx, tz);
            if (path && path.length > 1) {
              n.path = path;
              n.pi = 1;
              return;
            }
          }
          n.path = null;
        };
        const n = crowd.addInterior({ kind: 'walk', x: sx, z: sz, y: yf, yaw: rand() * 6.28, path: null, onArrive: pickTarget });
        if (n) pickTarget(n);
      }
      for (let g = 0; g < groups; g++) {
        const [gx, gz] = this._randomCorridorPoint(I, rand);
        const size = 2 + Math.floor(rand() * 2);
        for (let m = 0; m < size; m++) {
          const a = (m / size) * Math.PI * 2;
          const x = gx + Math.cos(a) * 0.55;
          const z = gz + Math.sin(a) * 0.55;
          if (L.cellAt(x, z) !== 1) continue;
          crowd.addInterior({ kind: 'stand', x, z, y: yf, yaw: Math.atan2(-(gx - x), -(gz - z)) });
        }
      }
    }
  }

  enter(door) {
    // Programmatic entry (prompt from outside): walk the player just inside the door.
    const player = this.sim.player;
    player.teleport(door.x - door.nx * 1.2, door.z - door.nz * 1.2, Math.atan2(door.nx, door.nz));
  }

  _enter(b, player) {
    const I = this._ensure(b);
    let k = Math.round((player.pos.y - b.y0) / b.floorH);
    for (const d of I.doors) {
      if (Math.hypot(d.x - player.pos.x, d.z - player.pos.z) < 5) {
        k = d.k;
        break;
      }
    }
    k = clamp(k, b.fMin, b.fMax);
    this._showFloor(I, k);
    I.group.visible = true;
    this.current = { I, k };
    this._populate(I, k);
    this.sim.sky.setSunScale(0.12);
    player.groundFn = () => this.floorY(b, this.current.k);
    player.interiorCollision = I.collision;
    player.pos.y = this.floorY(b, k);
    player.vel.y = 0;
  }

  _exit(player) {
    if (!this.current) return;
    this.current.I.group.visible = false;
    this.current = null;
    this.crowd.clearInterior();
    this.sim.sky.setSunScale(1);
    player.groundFn = null;
    player.interiorCollision = null;
  }

  exitInstant() {
    const p = this.sim.player;
    this._exit(p);
  }

  changeFloor(delta, player) {
    const cur = this.current;
    if (!cur) return;
    const b = cur.I.b;
    const nk = clamp(cur.k + delta, b.fMin, b.fMax);
    if (nk === cur.k) {
      this.sim.ui.toast(delta > 0 ? 'Bu binanın en üst katındasınız.' : 'Bu binanın en alt katındasınız.');
      return;
    }
    this.sim.ui.fadeThen(() => {
      cur.k = nk;
      this._showFloor(cur.I, nk);
      this._populate(cur.I, nk);
      player.pos.y = this.floorY(b, nk);
      player.vel.y = 0;
    });
  }

  // Interior lighting stays on at night: raise the self-lit share as the sky darkens.
  _applyNight(night) {
    if (Math.abs(night - this.nightApplied) < 0.03) return;
    this.nightApplied = night;
    const e = 0.16 + night * 0.2;
    for (const m of this.mats.lit) m.emissiveIntensity = e;
    this.mats.furn.emissiveIntensity = 0.08 + night * 0.14;
    for (const I of this.cache.values()) I.floorTexture.emissiveIntensity = e;
  }

  update(dt, player) {
    this._applyNight(this.sim.sky.night);
    const b = this.buildingAt(player.pos.x, player.pos.z);
    if (b && (!this.current || this.current.I.b !== b)) {
      if (this.current) this._exit(player);
      this._unpeek();
      this._enter(b, player);
    } else if (!b && this.current) this._exit(player);
    if (!this.current) this._peek(player);
    else this._unpeek();
    void dt;
  }

  // Outside but near an entrance: show that door's floor so the doorway is not see-through.
  _peek(player) {
    let best = null;
    let bd = 16;
    for (const list of this.buildings.doorsByBuilding.values()) {
      for (const d of list) {
        const dist = Math.hypot(d.x - player.pos.x, d.z - player.pos.z);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
    }
    if (!best) return this._unpeek();
    if (this.peeking && this.peeking.door === best) return;
    this._unpeek();
    const b = this.candidates.find((q) => q.id === best.b);
    if (!b) return;
    const I = this._ensure(b);
    this._showFloor(I, best.k);
    I.group.visible = true;
    this.peeking = { door: best, I };
  }

  _unpeek() {
    if (!this.peeking) return;
    if (!this.current || this.current.I !== this.peeking.I) this.peeking.I.group.visible = false;
    this.peeking = null;
  }

  // Build door floors ahead of time, one per timer tick, so entering never stutters.
  warm() {
    const tasks = [];
    for (const list of this.buildings.doorsByBuilding.values()) for (const d of list) tasks.push(d);
    const run = () => {
      const d = tasks.shift();
      if (!d) return;
      const b = this.candidates.find((q) => q.id === d.b);
      if (b) {
        const I = this._ensure(b);
        if (!I.floors.has(d.k)) {
          this._buildFloor(I, d.k);
          I.floors.get(d.k).visible = false;
        }
      }
      setTimeout(run, 60);
    };
    setTimeout(run, 800);
  }

  prompt(player) {
    if (!this.current) return null;
    const { I, k } = this.current;
    const L = I.layout;
    for (const core of L.cores) {
      if (Math.hypot(core.x - player.pos.x, core.z - player.pos.z) < 3.0) {
        const b = I.b;
        const up = k < b.fMax;
        const down = k > b.fMin;
        return {
          actions: {
            KeyE: () => this.changeFloor(up ? 1 : -1, player),
            KeyQ: () => this.changeFloor(-1, player),
          },
          keys: [
            ...(up ? [['E', `Üst kata çık (${this.floorLabel(k + 1)})`]] : []),
            ...(down ? [[up ? 'Q' : 'E', `Alt kata in (${this.floorLabel(k - 1)})`]] : []),
          ],
          text: '',
        };
      }
    }
    return null;
  }

  place() {
    const { I, k } = this.current;
    const p = this.sim.player;
    const zone = I.layout.cellAt(p.pos.x, p.pos.z);
    const info = this._floorInfo(I, k).get(zone);
    const b = I.b;
    const meta = this.data.info.places[String(b.id)];
    const title = `${(meta && meta.title) || b.name}, ${this.floorLabel(k)}`;
    let sub = 'Koridor';
    if (info) sub = `${info.name || TYPE_LABEL[info.type] || 'Oda'} ${info.code}${info.use ? ` (${info.use})` : ''}${info.real ? ' · resmî kod' : ''}`.replace(/\s+/g, ' ').trim();
    else if (zone > 1 && zone < 10) sub = 'Merdiven ve asansör';
    return { title, sub, cat: b.cat === 'dorm' ? 'dorm' : 'academic' };
  }
}
