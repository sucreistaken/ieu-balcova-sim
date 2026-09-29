// Photo-based massing for the campus blocks.
//
// OpenStreetMap gives good footprints but poor heights (most campus buildings carry a single
// building:levels value, and the big A/K/M polygon merges a tall slab with a low round hall and a
// courtyard). The table below overrides levels, heights, facade styles and adds the landmark
// features seen in public photographs (Wikimedia Commons: "Izmir Ekonomi Universitesi.jpg",
// "Izmir University of Economics at night.jpg", "Izmirekonomiuni.jpg", CC BY-SA) and in the
// satellite view. All numbers are visual estimates from those pictures (+-1 storey), NOT surveyed
// data; every overridden building is marked hsrc = 'foto' so the UI can say so.
//
// Coordinates are local metres (x east, z south) like the rest of the dataset.

import { pointInRing } from './util.js';

// Facade style keys are defined in textures.js. A style may be a string or { def, north }.
export const ARCH = {
  // A, K ve M Bloklar: main slab (brick + cream bands), tall left wing (cream plaster), porch under
  // the white wavy canopy, low courtyard buildings and the round brick hall.
  154001110: {
    label: 'A Blok ana bina',
    levels: 8,
    h: 28,
    // The OSM polygon also covers the open courtyard and the round hall north of the slab; the
    // courtyard is public ground, so everything north of this z is cut away (see applyArch).
    cutNorth: 28.6,
    zones: [
      { id: 'L', rect: [-46, 28.6, -5.5, 95], h: 28, style: 'plasterLit', roof: '#43464b' },
      { id: 'B', rect: [-5.5, 60, 9.6, 95], h: 3.4, style: 'brickLit', roof: '#b3ab9d' },
      { id: 'C1', rect: [-5.5, 28.6, 9.6, 60], h: 25.5, style: { def: 'brickLit', north: 'pierBrickLit' }, roof: '#bdb5a8' },
      { id: 'P', rect: [9.6, 56, 25.6, 76], h: 4.7, style: 'plasterLit', roof: '#f1efe9' },
      { id: 'C2', rect: [9.6, 28.6, 25.6, 56], h: 25.5, style: { def: 'brickLit', north: 'pierBrickLit' }, roof: '#bdb5a8' },
      { id: 'C3', rect: [25.6, 28.6, 82, 95], h: 25.5, style: { def: 'brickLit', north: 'pierBrickLit' }, roof: '#bdb5a8' },
    ],
    fallbackZone: 'C1',
    // The real main entrance sits under the canopy; OSM only maps the two end doors.
    doors: [{ at: [18.3, 73.6], main: true }],
    tower: { x: 17.6, z: 58.2, w: 5.0, d: 4.2, h: 28.8 },
    canopy: { x0: 9.6, z0: 56, x1: 25.6, z1: 76, y: 4.7 },
    roofSign: { x: 6.5, z: 42, len: 30, text: 'İZMİR EKONOMİ ÜNİVERSİTESİ', y: 25.5 },
    extra: [
      {
        id: 900000001,
        name: 'Yuvarlak Salon',
        round: { x: 20.6, z: 4.5, r: 12.6 },
        levels: 2,
        h: 9.6,
        door: { at: [20.6, 17.1] },
        style: 'brick',
        flatRoof: '#c7c1b3',
        info: {
          title: 'Yuvarlak Salon',
          blurb: 'Avludaki kırmızı tuğlalı yuvarlak salon: gri düz çatı, ince beyaz pilastrlar. Havadan fotoğraflarda ve uyduda görülüyor; işlevi resmi kaynaklarda doğrulanamadı.',
          facts: [{ k: 'Kat sayısı', v: '~2 (fotoğraftan)', src: 'foto' }, { k: 'İşlev', v: 'Doğrulanmadı', src: 'tahmin' }],
        },
      },
    ],
    info: {
      blurb: 'Kampüsün en büyük yapısı: tuğla kırmızısı ana gövde, krem bantlar, ortada logolu beyaz kule ve dalgalı beyaz giriş saçağı. Cepheler ve yükseklikler halka açık fotoğraflardan yeniden kuruldu.',
      facts: [
        { k: 'Kat sayısı', v: '~7-8 (OSM: 6)', src: 'foto' },
        { k: 'Geçmiş', v: 'Eski Grand Plaza oteli', src: 'wiki' },
      ],
    },
  },
  // Long hall with a grey metal gable roof and a red brick base (roof ridge runs north-south).
  // The hall proper is the rectangle below (the polygon also has a slanted north wall and an annex at the north-east).
  154001120: { label: 'Medya İletişim', levels: 3, h: 11.5, style: 'brick', gable: { rise: 3.6, color: '#7c848c', rect: [-43.9, -24.2, -17.7, 21.2] } },
  // Tall dorm slab: cream piers with red brick panels, ~11 storeys in the aerial photograph.
  286894950: { label: 'Yurt', levels: 11, h: 35, style: 'pierBrick', flatRoof: '#b7b0a3', info: { facts: [{ k: 'Kat sayısı', v: '~11 (OSM: 5)', src: 'foto' }] } },
  // West-side blocks.
  88435610: {
    label: 'E Blok',
    levels: 7,
    h: 25,
    style: 'plaster',
    info: {
      blurb: 'Yabancı Diller Yüksekokulu (hazırlık programı) binası. Sınıf kodları E 101 - E 609 resmî SFL sınıf listesinden; hangi odanın hangi konumda olduğu bilinmiyor.',
      facts: [
        { k: 'Kat sayısı', v: '7 (SFL oda kodları E 101-E 609)', src: 'sfl' },
        { k: 'Yapı', v: 'Eylül 2015; parsel 1.345 m², toplam inşaat 9.646 m²', src: 'arkiv' },
      ],
    },
  },
  88435600: { label: 'C Blok', levels: 7, h: 28.1, style: 'whiteGrid' },
  637305654: { label: 'D Blok', levels: 5, h: 18.5, style: 'whiteGrid' },
  637305659: { label: 'TESLA', levels: 2, h: 7.4, style: 'plaster', info: { facts: [{ k: 'Hizmete giriş', v: 'Mayıs 2018, 13 araştırma birimi', src: 'kdr' }] } },
  637305652: { label: 'Reklamcılık', levels: 2, h: 7.4, style: 'plaster' },
};

// Extra verified facts for buildings whose shape stays as in OSM.
const INFO_ONLY = {
  637305653: { facts: [{ k: 'Açılış', v: '28 Mayıs 2007; 1.600 kişilik, 11 x 24 m sahne', src: 'ieu' }] },
  637305654: { blurb: 'Kod ön eki D olan stüdyo ve laboratuvarlar Güzel Sanatlar ve Tasarım Fakültesi sayfalarında geçiyor (D 201 CAD Lab, D 301 CAD Lab III, DB 030 Baskı Stüdyosu...). Binanın bu fakülteye ait olduğu kod ön ekinden çıkarımdır.', facts: [{ k: 'Kat kodları', v: 'DB (bodrum), D 0xx zemin, D 1xx-D 3xx', src: 'ieu' }] },
  88435600: { facts: [{ k: 'Laboratuvarlar', v: 'C 302-C 309 (3. kat), C 601-C 609 (6. kat)', src: 'ieu' }] },
};

// ------------------------------------------------------------------ geometry helpers
// Sutherland-Hodgman clip of a flat ring against an axis-aligned rectangle.
export function clipRect(ring, [x0, z0, x1, z1]) {
  let pts = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0]],
    [(p) => p[1] <= z1, (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1]],
  ];
  for (const [inside, cross] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    pts = out;
    if (!pts.length) return [];
  }
  const flat = [];
  for (const p of pts) {
    const n = flat.length;
    if (n >= 2 && Math.hypot(flat[n - 2] - p[0], flat[n - 1] - p[1]) < 1e-4) continue;
    flat.push(p[0], p[1]);
  }
  if (flat.length >= 4 && Math.hypot(flat[0] - flat[flat.length - 2], flat[1] - flat[flat.length - 1]) < 1e-4) flat.length -= 2;
  return flat;
}

export function ringArea(ring) {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

const inRect = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];

// Zone lookup for a building spec (first matching rectangle, else the fallback zone).
export function makeZoneLookup(spec) {
  const zones = spec.zones || [];
  const fallback = zones.find((z) => z.id === spec.fallbackZone) || zones[0];
  return (x, z) => zones.find((q) => inRect(x, z, q.rect)) || fallback;
}

// Style key for a wall facing (nx, nz): { def, north } styles switch on the north side.
export function styleKey(style, nz) {
  if (typeof style === 'string') return style;
  return nz < -0.45 && style.north ? style.north : style.def;
}

// Pieces of the footprint per zone, for flat roofs.
export function zonePieces(ring, spec) {
  const out = [];
  for (const z of spec.zones) {
    const piece = clipRect(ring, z.rect);
    if (piece.length >= 6 && ringArea(piece) > 0.5) out.push({ zone: z, ring: piece });
  }
  return out;
}

// Runs of a 2D edge over which the zone stays the same (sampled every ~0.5 m, offset into the
// building so boundary points pick the inner zone).
export function edgeRuns(ax, az, bx, bz, lookup, step = 0.5) {
  const len = Math.hypot(bx - ax, bz - az);
  const nx = (bz - az) / len;
  const nz = -(bx - ax) / len;
  const n = Math.max(1, Math.ceil(len / step));
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const zone = lookup(ax + (bx - ax) * t - nx * 0.12, az + (bz - az) * t - nz * 0.12);
    if (cur && cur.zone === zone) cur.t1 = (k + 1) / n;
    else {
      cur = { zone, t0: k / n, t1: (k + 1) / n };
      runs.push(cur);
    }
  }
  return runs;
}

// Interior boundaries between zones of different height: [{ax,az,bx,bz,nx,nz,zoneHi,zoneLo}], with
// the wall on the taller zone's side facing (nx, nz) towards the lower zone.
export function stepWalls(ring, spec, lookup) {
  const out = [];
  for (const zone of spec.zones) {
    const [x0, z0, x1, z1] = zone.rect;
    const sides = [
      { ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: -1 },
      { ax: x1, az: z0, bx: x1, bz: z1, nx: 1, nz: 0 },
      { ax: x0, az: z1, bx: x1, bz: z1, nx: 0, nz: 1 },
      { ax: x0, az: z0, bx: x0, bz: z1, nx: -1, nz: 0 },
    ];
    for (const s of sides) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const n = Math.max(1, Math.ceil(len / 0.5));
      let run = null;
      const flush = () => {
        if (run) out.push(run);
        run = null;
      };
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = s.ax + (s.bx - s.ax) * t;
        const pz = s.az + (s.bz - s.az) * t;
        const inX = px - s.nx * 0.15;
        const inZ = pz - s.nz * 0.15;
        const outX = px + s.nx * 0.15;
        const outZ = pz + s.nz * 0.15;
        const inside = pointInRing(inX, inZ, ring) && pointInRing(outX, outZ, ring);
        const other = inside ? lookup(outX, outZ) : null;
        const mine = lookup(inX, inZ);
        if (inside && mine === zone && other !== zone && other.h < zone.h - 0.01) {
          if (run && run.zoneLo === other) {
            run.bx = s.ax + (s.bx - s.ax) * ((k + 1) / n);
            run.bz = s.az + (s.bz - s.az) * ((k + 1) / n);
          } else {
            flush();
            run = {
              ax: s.ax + (s.bx - s.ax) * (k / n),
              az: s.az + (s.bz - s.az) * (k / n),
              bx: s.ax + (s.bx - s.ax) * ((k + 1) / n),
              bz: s.az + (s.bz - s.az) * ((k + 1) / n),
              nx: s.nx,
              nz: s.nz,
              zoneHi: zone,
              zoneLo: other,
            };
          }
        } else flush();
      }
      flush();
    }
  }
  return out;
}

function ringCentroid(ring) {
  let x = 0;
  let z = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    x += ring[i * 2];
    z += ring[i * 2 + 1];
  }
  return [+(x / n).toFixed(2), +(z / n).toFixed(2)];
}

// Nearest ring edge to a point: index and the projected point.
function nearestEdge(ring, px, pz) {
  const n = ring.length / 2;
  let best = { d: Infinity };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < best.d) {
      const len = Math.sqrt(l2);
      best = { d, edge: i, x: qx, z: qz, nx: dz / len, nz: -dx / len };
    }
  }
  return best;
}

function circleRing(cx, cz, r, n = 32) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(+(cx + r * Math.cos(t)).toFixed(2), +(cz + r * Math.sin(t)).toFixed(2));
  }
  return out;
}

const doorAt = (b, at) => {
  const e = nearestEdge(b.ring, at[0], at[1]);
  return { b: b.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), nx: +e.nx.toFixed(3), nz: +e.nz.toFixed(3), edge: e.edge, synthetic: true };
};

// Apply the overrides to the loaded dataset (before any mesh is built).
export function applyArch(data) {
  const info = data.info.places;
  const extras = [];
  for (const b of data.buildings) {
    const spec = ARCH[b.id];
    if (!spec) continue;
    b.arch = spec;
    b.levels = spec.levels;
    b.h = spec.h;
    b.hsrc = 'foto';
    if (spec.cutNorth !== undefined) {
      const ring = clipRect(b.ring, [-1e4, spec.cutNorth, 1e4, 1e4]);
      b.ring = ring;
      b.c = ringCentroid(ring);
      b.area = Math.round(ringArea(ring));
      // Door edge indices refer to the old ring: snap every door to the nearest new edge.
      for (const d of data.doors) {
        if (d.b !== b.id) continue;
        const e = nearestEdge(ring, d.x, d.z);
        d.edge = e.edge;
      }
    }
    for (const d of spec.doors || []) data.doors.push({ ...doorAt(b, d.at), main: !!d.main });
    for (const x of spec.extra || []) {
      const ring = circleRing(x.round.x, x.round.z, x.round.r);
      const nb = {
        id: x.id, name: x.name, cat: 'academic', kind: 'university', amenity: null, levels: x.levels, h: x.h, hsrc: 'foto',
        area: Math.round(ringArea(ring)), c: [x.round.x, x.round.z], ring, holes: [], campus: 1, special: 'roundhall',
        arch: { label: x.name, style: x.style, flatRoof: x.flatRoof },
      };
      extras.push(nb);
      data.doors.push(doorAt(nb, x.door.at));
      info[String(x.id)] = x.info;
    }
    if (spec.info) {
      const cur = info[String(b.id)] || { title: spec.label, facts: [] };
      info[String(b.id)] = { ...cur, blurb: spec.info.blurb || cur.blurb, facts: [...(spec.info.facts || []), ...(cur.facts || []).filter((f) => f.k !== 'Kat sayısı')] };
    }
  }
  data.buildings.push(...extras);
  for (const [id, add] of Object.entries(INFO_ONLY)) {
    const cur = info[id];
    if (!cur) continue;
    info[id] = { ...cur, blurb: add.blurb || cur.blurb, facts: [...(add.facts || []), ...(cur.facts || [])] };
  }
}
