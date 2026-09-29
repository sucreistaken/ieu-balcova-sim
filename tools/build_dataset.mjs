// Builds data/campus.json from the raw OSM / DEM / website extracts in data/.
// Usage: node tools/build_dataset.mjs
//
// Local frame: origin = campus centre, +x = east, +z = south (so north = -z),
// +y = up (elevation above the origin). All lengths in metres.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// ---------------------------------------------------------------- projection

const LAT0 = 38.3887;
const LON0 = 27.0445;
const phi = (LAT0 * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const proj = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ geometry

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
};

const centroid = (ring) => {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
};

const pointInRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const closestOnSegment = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + dx * t, az + dz * t, t];
};

// Closest point on a ring's boundary: { x, z, d, i } (i = edge index).
const closestOnRing = (px, pz, ring) => {
  let best = { d: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const [qx, qz] = closestOnSegment(px, pz, ax, az, bx, bz);
    const d = Math.hypot(px - qx, pz - qz);
    if (d < best.d) best = { x: qx, z: qz, d, i };
  }
  return best;
};

const stripClosing = (pts) => {
  const out = pts.slice();
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02) out.pop();
  }
  return out;
};

const geomToPts = (g) => g.map((p) => proj(p.lat, p.lon));

// Join open ways into closed rings (multipolygon assembly).
const joinWays = (ways) => {
  const eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
  const pool = ways.map((w) => w.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let changed = true;
    while (changed && !eq(cur[0], cur[cur.length - 1])) {
      changed = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const end = cur[cur.length - 1];
        if (eq(end, w[0])) cur = cur.concat(w.slice(1));
        else if (eq(end, w[w.length - 1])) cur = cur.concat(w.slice(0, -1).reverse());
        else if (eq(cur[0], w[w.length - 1])) cur = w.slice(0, -1).concat(cur);
        else if (eq(cur[0], w[0])) cur = w.slice(1).reverse().concat(cur);
        else continue;
        pool.splice(i, 1);
        changed = true;
        break;
      }
    }
    rings.push(stripClosing(cur));
  }
  return rings;
};

const flat = (ring) => ring.flatMap(([x, z]) => [r2(x), r2(z)]);

// Deterministic pseudo random in [0, 1) from an integer seed.
const rand = (seed) => {
  let t = (seed * 2654435761) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------- input

const tier1 = readJson('data/osm_tier1.json').elements;
const tier2 = readJson('data/osm_tier2.json').elements;
const landcover = readJson('data/osm_landcover.json').elements;
const aerial = readJson('data/osm_aerialway.json').elements;
const coast = readJson('data/osm_coast.json').elements;
const relations = readJson('data/osm_relations.json').elements;
const dem = readJson('data/dem_world.json');
const info = readJson('data/campus_info.json');
const depts = readJson('data/departments_raw.json');
const labs = readJson('data/labs.json');

// Campus boundary = OSM amenity=university way (Balcova campus).
const campusWay = readJson('data/osm_raw.json').elements.find((e) => e.id === 181081996);
const campusRing = stripClosing(geomToPts(campusWay.geometry));

// ------------------------------------------------------------------ buildings

const LEVEL_H = { academic: 3.7, dorm: 3.1, residential: 3.0, commercial: 3.6, default: 3.1 };

const categorize = (t) => {
  const b = t.building;
  if (b === 'university' || b === 'college') return 'academic';
  if (b === 'dormitory') return 'dorm';
  if (b === 'school' || b === 'kindergarten') return 'school';
  if (b === 'hospital' || b === 'clinic') return 'health';
  if (b === 'mosque' || b === 'religious' || b === 'church') return 'religious';
  if (b === 'transportation') return 'transport';
  if (['commercial', 'retail', 'supermarket', 'office'].includes(b)) return 'commercial';
  if (['industrial', 'warehouse', 'service'].includes(b)) return 'industrial';
  if (['roof', 'canopy', 'carport', 'garage', 'garages', 'shed', 'hut', 'kiosk', 'greenhouse'].includes(b))
    return 'minor';
  if (['apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house'].includes(b))
    return 'residential';
  if (t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'restaurant') return 'food';
  if (t.amenity === 'theatre') return 'venue';
  if (t.amenity === 'school') return 'school';
  return 'generic';
};

const estimateHeight = (t, cat, area, id) => {
  const tagH = parseFloat(String(t.height || '').replace(',', '.'));
  const lvl = parseFloat(t['building:levels']);
  const roofLvl = parseFloat(t['roof:levels']) || 0;
  const perLevel = LEVEL_H[cat] || LEVEL_H.default;
  if (Number.isFinite(lvl)) {
    return { levels: lvl, h: lvl * perLevel + roofLvl * 2.2, src: 'osm' };
  }
  if (Number.isFinite(tagH) && tagH >= 3) return { levels: Math.max(1, Math.round(tagH / perLevel)), h: tagH, src: 'osm' };
  const rnd = rand(id);
  let levels;
  if (cat === 'minor') levels = 1;
  else if (cat === 'food') levels = 1;
  else if (cat === 'transport') levels = 2;
  else if (cat === 'religious') levels = 2;
  else if (cat === 'industrial') levels = 1 + Math.floor(rnd * 2);
  else if (cat === 'commercial') levels = 1 + Math.floor(rnd * 3);
  else if (cat === 'academic') levels = area > 1500 ? 5 : 4;
  else if (cat === 'dorm') levels = 5;
  else if (cat === 'school') levels = 3;
  else if (area < 45) levels = 1;
  else if (area < 110) levels = 2 + Math.floor(rnd * 2);
  else if (area < 220) levels = 3 + Math.floor(rnd * 3);
  else levels = 4 + Math.floor(rnd * 3);
  const h = cat === 'minor' ? 3 : levels * (LEVEL_H[cat] || LEVEL_H.default);
  return { levels, h, src: 'est' };
};

const buildings = [];
const pushBuilding = (id, tags, outer, holes = []) => {
  const ring = stripClosing(outer);
  if (ring.length < 3) return;
  let ccw = ring;
  // Outer rings: positive shoelace area in (x, z). Holes: negative.
  if (signedArea(ccw) < 0) ccw = ccw.slice().reverse();
  const holeRings = holes.map((h) => {
    const hr = stripClosing(h);
    return signedArea(hr) > 0 ? hr.slice().reverse() : hr;
  });
  const area = Math.abs(signedArea(ccw));
  if (area < 4) return;
  const cat = categorize(tags);
  const est = estimateHeight(tags, cat, area, id);
  const [cx, cz] = centroid(ccw);
  buildings.push({
    id,
    name: tags.name || null,
    cat,
    kind: tags.building,
    amenity: tags.amenity || null,
    levels: est.levels,
    h: r2(est.h),
    hsrc: est.src,
    area: Math.round(area),
    c: [r2(cx), r2(cz)],
    ring: flat(ccw),
    holes: holeRings.map(flat),
    campus: 0,
  });
};

for (const e of tier1) {
  if (e.type !== 'way' || !e.tags || !e.tags.building) continue;
  pushBuilding(e.id, e.tags, geomToPts(e.geometry));
}

for (const rel of relations) {
  const outer = [];
  const inner = [];
  for (const m of rel.members) {
    if (!m.geometry) continue;
    (m.role === 'inner' ? inner : outer).push(geomToPts(m.geometry));
  }
  const outers = joinWays(outer);
  const inners = joinWays(inner);
  outers.forEach((o, i) => pushBuilding(rel.id * 10 + i, rel.tags, o, i === 0 ? inners : []));
}

// Campus membership: centroid inside the campus polygon (+12 m tolerance).
for (const b of buildings) {
  const [cx, cz] = b.c;
  const inside = pointInRing(cx, cz, campusRing);
  const near = closestOnRing(cx, cz, campusRing).d < 12;
  b.campus = inside || (near && (b.cat === 'academic' || b.cat === 'dorm')) ? 1 : 0;
}

// Explicit OSM-side corrections/notes.
for (const b of buildings) {
  if (b.name === 'Reklamcılık') {
    // OSM says height=2, which is almost certainly a levels value for a 246 m2 building.
    b.levels = 2;
    b.h = 7.4;
    b.hsrc = 'est';
    b.note = 'OSM height=2 kaydi kat sayisi gibi yorumlandi (2 kat).';
  } else if (b.amenity === 'theatre') {
    // Open-air amphitheatre: rendered as terraced seating, not an enclosed block.
    b.special = 'amphitheatre';
    b.h = 2.4;
    b.levels = 1;
    b.hsrc = 'est';
  } else if (b.kind === 'mosque') {
    b.special = 'mosque';
  } else if (b.campus && !b.name && b.cat === 'generic') {
    // Unnamed small structures inside the campus polygon: pavilions / stage annexes.
    b.cat = 'minor';
    b.levels = 1;
    b.h = 3.6;
    b.hsrc = 'est';
  }
}

// --------------------------------------------------------------------- far LOD

const b1 = { minLat: 38.381, maxLat: 38.394, minLon: 27.035, maxLon: 27.0545 };
const far = [];
for (const e of tier2) {
  const bb = e.bounds;
  const lat = (bb.minlat + bb.maxlat) / 2;
  const lon = (bb.minlon + bb.maxlon) / 2;
  if (lat > b1.minLat && lat < b1.maxLat && lon > b1.minLon && lon < b1.maxLon) continue;
  const [x0, z0] = proj(bb.maxlat, bb.minlon);
  const [x1, z1] = proj(bb.minlat, bb.maxlon);
  const w = x1 - x0;
  const d = z1 - z0;
  if (w < 3 || d < 3) continue;
  const t = e.tags || {};
  const lvl = parseFloat(t['building:levels']);
  const h = Number.isFinite(lvl) ? lvl * 3.1 : 7 + Math.floor(rand(e.id) * 4) * 3.1;
  far.push([r2((x0 + x1) / 2), r2((z0 + z1) / 2), r2(w * 0.86), r2(d * 0.86), r2(h)]);
}

// ---------------------------------------------------------------- roads/paths

const ROAD_W = {
  motorway: 14,
  trunk: 13,
  primary: 11,
  primary_link: 6,
  secondary: 9,
  secondary_link: 6,
  tertiary: 7,
  tertiary_link: 5,
  unclassified: 5.5,
  residential: 5.5,
  living_street: 4.5,
  service: 3.8,
  track: 3,
  pedestrian: 4,
  footway: 2.2,
  path: 1.6,
  steps: 2.2,
  cycleway: 2,
};

const roads = [];
for (const e of tier1) {
  if (e.type !== 'way' || !e.tags || !e.tags.highway) continue;
  const hw = e.tags.highway;
  if (!ROAD_W[hw]) continue;
  const pts = geomToPts(e.geometry);
  roads.push({
    id: e.id,
    t: hw,
    name: e.tags.name || null,
    w: parseFloat(e.tags.width) || ROAD_W[hw],
    oneway: e.tags.oneway === 'yes' ? 1 : 0,
    bridge: e.tags.bridge ? 1 : 0,
    tunnel: e.tags.tunnel ? 1 : 0,
    p: flat(pts),
  });
}

// -------------------------------------------------------------------- areas

const AREA_KIND = (t) => {
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (['grass', 'meadow', 'grassland'].includes(t.landuse) || t.natural === 'grassland') return 'grass';
  if (['park', 'garden', 'recreation_ground'].includes(t.leisure) || t.landuse === 'recreation_ground') return 'park';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'sports_centre') return 'sports';
  if (t.landuse === 'orchard') return 'orchard';
  if (t.landuse === 'farmland') return 'farmland';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.amenity === 'parking') return 'parking';
  if (t.natural === 'water') return 'water';
  if (['residential', 'commercial', 'industrial', 'retail'].includes(t.landuse)) return 'urban';
  if (['university', 'school', 'hospital'].includes(t.amenity)) return 'institution';
  return null;
};

const areas = [];
const seenArea = new Set();
for (const e of [...tier1, ...landcover]) {
  if (e.type !== 'way' || !e.tags || e.tags.building || e.tags.highway) continue;
  if (seenArea.has(e.id)) continue;
  const kind = AREA_KIND(e.tags);
  if (!kind) continue;
  seenArea.add(e.id);
  const pts = stripClosing(geomToPts(e.geometry));
  if (pts.length < 3) continue;
  const ring = signedArea(pts) < 0 ? pts.slice().reverse() : pts;
  areas.push({ id: e.id, kind, name: e.tags.name || null, r: flat(ring), area: Math.round(Math.abs(signedArea(ring))) });
}
// Draw big / low-priority areas first.
const AREA_ORDER = ['urban', 'farmland', 'scrub', 'forest', 'grass', 'orchard', 'cemetery', 'institution', 'park',
  'sports', 'pitch', 'playground', 'parking', 'water'];
areas.sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind) || b.area - a.area);

// ---------------------------------------------------------------------- POIs

const poiCat = (t) => {
  if (t.amenity === 'library') return 'library';
  if (['cafe', 'fast_food', 'restaurant', 'bar', 'internet_cafe'].includes(t.amenity)) return 'food';
  if (t.amenity === 'pharmacy') return 'pharmacy';
  if (t.amenity === 'parking') return 'parking';
  if (t.aerialway === 'station') return 'teleferik';
  if (t.tourism === 'attraction' && /teleferik/i.test(t.name || '')) return 'teleferik';
  if (t.highway === 'bus_stop') return 'bus';
  if (t.tourism === 'hotel') return 'dorm';
  if (t.amenity === 'theatre') return 'venue';
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'toilets') return 'wc';
  if (t.amenity === 'drinking_water') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'green';
  if (t.building === 'mosque' || t.amenity === 'place_of_worship') return 'religious';
  return null;
};

const pois = [];
const poiSeen = new Set();
const addPoi = (id, t, x, z) => {
  const cat = poiCat(t);
  if (!cat) return;
  const key = `${id}`;
  if (poiSeen.has(key)) return;
  poiSeen.add(key);
  pois.push({ id, name: t.name || t['name:en'] || null, cat, x: r2(x), z: r2(z), tags: pickTags(t) });
};
function pickTags(t) {
  const keep = ['opening_hours', 'cuisine', 'brand', 'phone', 'website', 'operator', 'capacity', 'fee', 'wheelchair'];
  const o = {};
  for (const k of keep) if (t[k]) o[k] = t[k];
  return o;
}
for (const e of tier1) {
  if (!e.tags) continue;
  if (e.type === 'node') {
    const [x, z] = proj(e.lat, e.lon);
    addPoi(e.id, e.tags, x, z);
  } else if (e.type === 'way' && !e.tags.highway && e.geometry) {
    if (e.tags.name || e.tags.amenity) {
      const [cx, cz] = centroid(stripClosing(geomToPts(e.geometry)));
      addPoi(e.id, e.tags, cx, cz);
    }
  }
}
for (const e of readJson('data/osm_raw.json').elements) {
  if (e.type === 'node' && e.tags) {
    const [x, z] = proj(e.lat, e.lon);
    addPoi(e.id, e.tags, x, z);
  }
}

// ----------------------------------------------------------------- gondola

const gLine = aerial.find((e) => e.type === 'way' && e.tags.aerialway === 'gondola');
const gondola = {
  name: 'Balçova Teleferik',
  line: flat(geomToPts(gLine.geometry)),
  stations: aerial
    .filter((e) => e.type === 'node' && e.tags.aerialway === 'station')
    .map((e) => ({ name: e.tags.name, ...(() => { const [x, z] = proj(e.lat, e.lon); return { x: r2(x), z: r2(z) }; })() })),
  pylons: aerial.filter((e) => e.type === 'node' && e.tags.aerialway === 'pylon').map((e) => flat([proj(e.lat, e.lon)])),
};

// --------------------------------------------------------------- coastline

const coastLines = coast
  .filter((e) => e.type === 'way')
  .map((e) => flat(geomToPts(e.geometry)));

// ---------------------------------------------------------------- terrain

// EU-DEM grid (row 0 = south) -> local frame with row 0 = north (smallest z).
const demRows = dem.rows;
const demCols = dem.cols;
const grid = new Float32Array(demRows * demCols);
for (let i = 0; i < demRows; i++) {
  for (let j = 0; j < demCols; j++) {
    grid[(demRows - 1 - i) * demCols + j] = dem.values[i * demCols + j];
  }
}
// One 3x3 [1 2 1] blur pass to suppress DSM noise from buildings/trees.
const blurred = new Float32Array(grid.length);
for (let i = 0; i < demRows; i++) {
  for (let j = 0; j < demCols; j++) {
    let s = 0;
    let wsum = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= demRows || jj >= demCols) continue;
        const w = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
        s += grid[ii * demCols + jj] * w;
        wsum += w;
      }
    }
    blurred[i * demCols + j] = s / wsum;
  }
}
const [xMin, zMax] = proj(dem.lat0, dem.lon0);
const [xMax, zMin] = proj(dem.lat1, dem.lon1);
const terrain = {
  rows: demRows,
  cols: demCols,
  xMin: r2(xMin),
  xMax: r2(xMax),
  zMin: r2(zMin),
  zMax: r2(zMax),
  source: dem.source,
  heights: Array.from(blurred, (v) => Math.round(v * 10) / 10),
};
// Elevation at the origin (bilinear) to express y relative to the campus centre.
const sampleBilinear = (x, z) => {
  const u = ((x - terrain.xMin) / (terrain.xMax - terrain.xMin)) * (demCols - 1);
  const v = ((z - terrain.zMin) / (terrain.zMax - terrain.zMin)) * (demRows - 1);
  const j = Math.max(0, Math.min(demCols - 2, Math.floor(u)));
  const i = Math.max(0, Math.min(demRows - 2, Math.floor(v)));
  const fu = u - j;
  const fv = v - i;
  const h = (ii, jj) => blurred[ii * demCols + jj];
  return (
    h(i, j) * (1 - fu) * (1 - fv) + h(i, j + 1) * fu * (1 - fv) + h(i + 1, j) * (1 - fu) * fv + h(i + 1, j + 1) * fu * fv
  );
};
terrain.elevOrigin = r2(sampleBilinear(0, 0));

// -------------------------------------------------------------- walk graph

const NAV_TYPES = new Set(['footway', 'path', 'steps', 'pedestrian', 'service', 'residential', 'unclassified',
  'track', 'living_street', 'tertiary', 'cycleway']);
const NAV_RADIUS = 330;
const navKey = (x, z) => `${Math.round(x * 4)},${Math.round(z * 4)}`;
const navNodes = [];
const navIndex = new Map();
const navEdges = [];
const navNode = (x, z) => {
  const k = navKey(x, z);
  let i = navIndex.get(k);
  if (i === undefined) {
    i = navNodes.length;
    navNodes.push([x, z]);
    navIndex.set(k, i);
  }
  return i;
};
for (const r of roads) {
  if (!NAV_TYPES.has(r.t) || r.tunnel) continue;
  const pts = [];
  for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
  for (let i = 0; i + 1 < pts.length; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    if (Math.hypot(mx, mz) > NAV_RADIUS) continue;
    const a = navNode(pts[i][0], pts[i][1]);
    const b = navNode(pts[i + 1][0], pts[i + 1][1]);
    if (a === b) continue;
    const pedestrian = ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(r.t);
    navEdges.push([a, b, pedestrian ? 0 : 1, r.w]);
  }
}
// Keep only the connected component that contains the campus.
const adj = navNodes.map(() => []);
navEdges.forEach(([a, b], ei) => {
  adj[a].push(ei);
  adj[b].push(ei);
});
const comp = new Int32Array(navNodes.length).fill(-1);
let compCount = 0;
const compSize = [];
for (let s = 0; s < navNodes.length; s++) {
  if (comp[s] >= 0) continue;
  const stack = [s];
  comp[s] = compCount;
  let n = 0;
  while (stack.length) {
    const u = stack.pop();
    n++;
    for (const ei of adj[u]) {
      const [a, b] = navEdges[ei];
      const v = a === u ? b : a;
      if (comp[v] < 0) {
        comp[v] = compCount;
        stack.push(v);
      }
    }
  }
  compSize.push(n);
  compCount++;
}
let campusComp = -1;
let bestD = Infinity;
navNodes.forEach(([x, z], i) => {
  const d = Math.hypot(x, z);
  if (d < bestD) {
    bestD = d;
    campusComp = comp[i];
  }
});
const keep = navNodes.map((_, i) => comp[i] === campusComp);
const remap = new Map();
const nav = { nodes: [], edges: [] };
navNodes.forEach(([x, z], i) => {
  if (!keep[i]) return;
  remap.set(i, nav.nodes.length);
  nav.nodes.push([r2(x), r2(z)]);
});
for (const [a, b, kind, w] of navEdges) {
  if (keep[a] && keep[b]) nav.edges.push([remap.get(a), remap.get(b), kind, w]);
}

// ----------------------------------------------------------------- doors

const doors = [];
const campusBuildings = buildings.filter((b) => b.campus && b.cat !== 'minor');
const ringOf = (b) => {
  const out = [];
  for (let i = 0; i < b.ring.length; i += 2) out.push([b.ring[i], b.ring[i + 1]]);
  return out;
};
for (const b of campusBuildings) {
  const ring = ringOf(b);
  const cand = [];
  for (const [x, z] of nav.nodes) {
    const c = closestOnRing(x, z, ring);
    if (c.d < 22) cand.push({ ...c, px: x, pz: z });
  }
  cand.sort((p, q) => p.d - q.d);
  const chosen = [];
  for (const c of cand) {
    if (chosen.length >= 3) break;
    if (chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 14)) continue;
    // Skip corners: keep doors at least 2 m from the edge ends.
    const a = ring[c.i];
    const bb = ring[(c.i + 1) % ring.length];
    if (Math.hypot(c.x - a[0], c.z - a[1]) < 2 || Math.hypot(c.x - bb[0], c.z - bb[1]) < 2) continue;
    chosen.push(c);
  }
  for (const c of chosen) {
    const a = ring[c.i];
    const bb = ring[(c.i + 1) % ring.length];
    let nx = -(bb[1] - a[1]);
    let nz = bb[0] - a[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (pointInRing(c.x + nx * 0.6, c.z + nz * 0.6, ring)) {
      nx = -nx;
      nz = -nz;
    }
    doors.push({ b: b.id, x: r2(c.x), z: r2(c.z), nx: r2(nx), nz: r2(nz), edge: c.i });
  }
}

// Every enterable building gets at least one door (two for larger ones), placed on the edge
// that faces the open campus area and is not next to another building.
{
  const allRings = buildings.map((q) => ({ id: q.id, ring: ringOf(q) }));
  for (const b of campusBuildings) {
    const have = doors.filter((d) => d.b === b.id);
    const want = b.area > 800 ? 2 : 1;
    if (have.length >= want) continue;
    const ring = ringOf(b);
    const cand = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 5) continue;
      let nx = (c[1] - a[1]) / len;
      let nz = -(c[0] - a[0]) / len;
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[1] + c[1]) / 2;
      if (pointInRing(mx + nx * 0.6, mz + nz * 0.6, ring)) {
        nx = -nx;
        nz = -nz;
      }
      const ox = mx + nx * 1.6;
      const oz = mz + nz * 1.6;
      if (!pointInRing(ox, oz, campusRing)) continue;
      if (allRings.some((q) => q.id !== b.id && (pointInRing(ox, oz, q.ring) || closestOnRing(ox, oz, q.ring).d < 1.4))) continue;
      if (have.some((d) => Math.hypot(d.x - mx, d.z - mz) < 12)) continue;
      cand.push({ i, mx, mz, nx, nz, score: Math.hypot(ox, oz) });
    }
    cand.sort((p, q) => p.score - q.score);
    for (const c of cand.slice(0, want - have.length)) {
      doors.push({ b: b.id, x: r2(c.mx), z: r2(c.mz), nx: r2(c.nx), nz: r2(c.nz), edge: c.i });
    }
  }
}

// ------------------------------------------------------------------ output

const out = {
  meta: {
    name: info.university.name,
    campus: info.university.campus,
    address: info.university.address,
    generatedAt: new Date().toISOString(),
    origin: { lat: LAT0, lon: LON0 },
    frame: '+x east, +z south (north = -z), +y up; metres',
    projection: { mPerDegLat: r2(M_LAT), mPerDegLon: r2(M_LON) },
    sources: info.sources,
    notes: info.notes,
    stats: {
      buildings: buildings.length,
      campusBuildings: buildings.filter((b) => b.campus).length,
      farBuildings: far.length,
      roads: roads.length,
      areas: areas.length,
      pois: pois.length,
      navNodes: nav.nodes.length,
      navEdges: nav.edges.length,
      doors: doors.length,
    },
  },
  campusRing: flat(campusRing),
  terrain,
  buildings,
  far,
  roads,
  areas,
  pois,
  gondola,
  coast: coastLines,
  nav,
  doors,
  info: {
    university: info.university,
    places: info.places,
    facilities: info.facilities,
    transport: info.transport,
    academicUnits: depts,
    labs,
  },
};

fs.writeFileSync(path.join(ROOT, 'data/campus.json'), JSON.stringify(out));
const size = (fs.statSync(path.join(ROOT, 'data/campus.json')).size / 1024 / 1024).toFixed(2);
console.log('wrote data/campus.json', size, 'MB');
console.log(out.meta.stats, 'elevOrigin', terrain.elevOrigin);
console.log('campus buildings:');
for (const b of buildings.filter((q) => q.campus)) {
  console.log(' ', b.id, b.name || '(unnamed)', b.cat, `levels=${b.levels}`, `h=${b.h}(${b.hsrc})`, `area=${b.area}`, `c=${b.c}`);
}
console.log('doors', doors.length, 'campus components', compCount, 'kept nodes', nav.nodes.length);
