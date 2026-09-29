// Site-plan style map drawing (areas, roads, buildings, real DEM contours), shared by the
// minimap, the full map and the start screen.

export const CAT_COLOR = {
  academic: '#1d3a66',
  dorm: '#6b4e8c',
  food: '#e07b1a',
  green: '#2f6b4f',
  transport: '#2f7fa8',
  venue: '#b8452f',
  library: '#0f7d7a',
  gate: '#5b6b7b',
  other: '#5b6b7b',
};

const PLAN = {
  paper: '#e4e8e0',
  urban: '#dcdfd6',
  institution: '#eceee6',
  grass: '#cfdcc2',
  park: '#bfd3b3',
  forest: '#a9c39a',
  garden: '#a9c39a',
  parking: '#d3d5d1',
  water: '#a9c9dc',
  road: '#ffffff',
  roadEdge: '#b4b9b1',
  foot: '#f4f2ea',
  building: '#c4c8c0',
  buildingEdge: '#9da29a',
  campus: '#1d3a66',
  campusRoof: '#2c4d82',
  contour: '#b7a98d',
  contourMajor: '#8f7f62',
  ink: '#14243b',
};

const AREA_FILL = {
  urban: PLAN.urban, institution: PLAN.institution, grass: PLAN.grass, park: PLAN.park, forest: PLAN.forest,
  orchard: PLAN.grass, scrub: PLAN.grass, cemetery: PLAN.grass, parking: PLAN.parking, water: PLAN.water,
  pitch: '#b5d2b3', sports: '#c5d6bf', playground: '#e2d4bb', farmland: PLAN.grass,
};
const NAMED_GARDEN = new Set(['IEU Arka Bahçe', 'IEU Kedili Park']);

// Marching squares over the DEM; returns line segments per level.
export function contourSegments(hf, bounds, cell = 3, interval = 2) {
  const cols = Math.ceil((bounds.xMax - bounds.xMin) / cell) + 1;
  const rows = Math.ceil((bounds.zMax - bounds.zMin) / cell) + 1;
  const h = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) h[j * cols + i] = hf.dem(bounds.xMin + i * cell, bounds.zMin + j * cell) + hf.y0;
  }
  const out = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const first = Math.ceil(lo / interval) * interval;
  for (let level = first; level <= hi; level += interval) {
    const segs = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = h[j * cols + i] - level;
        const b = h[j * cols + i + 1] - level;
        const c = h[(j + 1) * cols + i + 1] - level;
        const d = h[(j + 1) * cols + i] - level;
        const pts = [];
        const edge = (v0, v1, x0, z0, x1, z1) => {
          if ((v0 < 0) !== (v1 < 0)) {
            const t = v0 / (v0 - v1);
            pts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
          }
        };
        const x0 = bounds.xMin + i * cell;
        const z0 = bounds.zMin + j * cell;
        edge(a, b, x0, z0, x0 + cell, z0);
        edge(b, c, x0 + cell, z0, x0 + cell, z0 + cell);
        edge(d, c, x0, z0 + cell, x0 + cell, z0 + cell);
        edge(a, d, x0, z0, x0, z0 + cell);
        if (pts.length === 2) segs.push([pts[0], pts[1]]);
        else if (pts.length === 4) {
          segs.push([pts[0], pts[1]]);
          segs.push([pts[2], pts[3]]);
        }
      }
    }
    out.push({ level, major: level % 10 === 0, segs });
  }
  return out;
}

function tracePoly(ctx, arr, close) {
  ctx.beginPath();
  for (let i = 0; i < arr.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, arr[i], arr[i + 1]);
  if (close) ctx.closePath();
}

// Draws the static base map into ctx. The context must already be transformed so that
// world metres map to pixels; `px` = metres per device pixel (for line widths).
export function drawPlanBase(ctx, data, contours, view, { labelContours = true } = {}) {
  const px = view.px;
  ctx.fillStyle = PLAN.paper;
  ctx.fillRect(view.xMin, view.zMin, view.xMax - view.xMin, view.zMax - view.zMin);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const a of data.areas) {
    ctx.fillStyle = NAMED_GARDEN.has(a.name) ? PLAN.forest : AREA_FILL[a.kind] || PLAN.urban;
    tracePoly(ctx, a.r, true);
    ctx.fill();
  }

  // Contours under roads and buildings.
  if (contours) {
    ctx.lineWidth = px * 0.9;
    for (const lv of contours) {
      ctx.strokeStyle = lv.major ? PLAN.contourMajor : PLAN.contour;
      ctx.lineWidth = px * (lv.major ? 1.5 : 0.8);
      ctx.beginPath();
      for (const [a, b] of lv.segs) {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }

  // Roads: edge then fill.
  const veh = data.roads.filter((r) => !['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(r.t) && !r.tunnel);
  for (const r of veh) {
    ctx.strokeStyle = PLAN.roadEdge;
    ctx.lineWidth = r.w + px * 3;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  for (const r of veh) {
    ctx.strokeStyle = PLAN.road;
    ctx.lineWidth = r.w;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  ctx.setLineDash([px * 4, px * 3]);
  ctx.strokeStyle = '#8f958d';
  ctx.lineWidth = px * 1.1;
  for (const r of data.roads) {
    if (!['footway', 'path', 'steps', 'pedestrian'].includes(r.t)) continue;
    tracePoly(ctx, r.p, false);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Buildings.
  for (const b of data.buildings) {
    tracePoly(ctx, b.ring, true);
    ctx.fillStyle = b.campus ? PLAN.campus : PLAN.building;
    ctx.fill();
    for (const h of b.holes) {
      tracePoly(ctx, h, true);
      ctx.fillStyle = PLAN.institution;
      ctx.fill();
    }
    tracePoly(ctx, b.ring, true);
    ctx.strokeStyle = b.campus ? PLAN.ink : PLAN.buildingEdge;
    ctx.lineWidth = px * (b.campus ? 1.6 : 0.8);
    ctx.stroke();
  }

  // Campus boundary.
  ctx.setLineDash([px * 9, px * 5]);
  ctx.strokeStyle = '#f28c28';
  ctx.lineWidth = px * 2.2;
  tracePoly(ctx, data.campusRing, true);
  ctx.stroke();
  ctx.setLineDash([]);

  if (contours && labelContours) {
    ctx.font = `600 ${px * 11}px "Barlow Semi Condensed", "Barlow", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lv of contours) {
      if (!lv.major || !lv.segs.length) continue;
      // Label a few well-spaced points on each major contour.
      let last = null;
      let count = 0;
      for (let i = 0; i < lv.segs.length && count < 3; i += 1) {
        const [a] = lv.segs[i];
        if (a[0] < view.xMin + 20 || a[0] > view.xMax - 20 || a[1] < view.zMin + 20 || a[1] > view.zMax - 20) continue;
        if (last && Math.hypot(a[0] - last[0], a[1] - last[1]) < 90) continue;
        last = a;
        count++;
        ctx.lineWidth = px * 3;
        ctx.strokeStyle = PLAN.paper;
        ctx.strokeText(String(Math.round(lv.level)), a[0], a[1]);
        ctx.fillStyle = PLAN.contourMajor;
        ctx.fillText(String(Math.round(lv.level)), a[0], a[1]);
      }
    }
  }
}

const SHORT = {
  'A, K ve M Bloklar': 'A K M',
  'Medya İletişim': 'Medya',
  'Yurt Binası': 'Yurt',
  'Reklamcılık': 'Reklam.',
  Amfiteatr: 'Amfi',
  'D blok': 'D',
  'E blok': 'E',
  'C Blok': 'C',
  TESLA: 'TESLA',
  Starbucks: '',
};

export function shortName(b) {
  return SHORT[b.name] !== undefined ? SHORT[b.name] : b.name || '';
}

// Contour art for the start screen: DEM lines in pale ink on the navy ground, campus outlined.
export function drawContourArt(canvas, data, hf) {
  const w = (canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1));
  const h = (canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1));
  const g = canvas.getContext('2d');
  const R = 210; // metres shown vertically
  const s = h / (2 * R);
  const cx = -0.2 * (w / s); // campus sits right of the text panel
  const cz = 0;
  const bounds = { xMin: cx - w / s / 2 - 20, xMax: cx + w / s / 2 + 20, zMin: cz - R - 20, zMax: cz + R + 20 };
  const contours = contourSegments(hf, bounds, 4, 2);
  g.fillStyle = '#14243b';
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(s, s);
  g.translate(-cx, -cz);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const lv of contours) {
    g.strokeStyle = lv.major ? 'rgba(167,188,214,0.5)' : 'rgba(167,188,214,0.2)';
    g.lineWidth = (lv.major ? 1.6 : 0.9) / s;
    g.beginPath();
    for (const [a, b] of lv.segs) {
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(167,188,214,0.16)';
  g.lineWidth = 1.2 / s;
  for (const b of data.buildings) {
    if (b.campus) continue;
    tracePoly(g, b.ring, true);
    g.stroke();
  }
  for (const b of data.buildings) {
    if (!b.campus) continue;
    tracePoly(g, b.ring, true);
    g.fillStyle = 'rgba(242,140,40,0.85)';
    g.fill();
  }
  g.setLineDash([9 / s, 6 / s]);
  g.strokeStyle = '#f28c28';
  g.lineWidth = 2 / s;
  tracePoly(g, data.campusRing, true);
  g.stroke();
  g.restore();
}
