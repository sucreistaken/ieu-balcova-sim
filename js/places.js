// Named places for the teleport list and the map: campus buildings, food, green areas, gates.

import { pointInRing } from './util.js';

const GROUPS = ['Binalar', 'Yeme içme', 'Yeşil alanlar', 'Kampüs kapıları', 'Kampüs dışı'];

// Player yaw so that the view direction is (dx, dz).
export const yawFacing = (dx, dz) => Math.atan2(-dx, -dz);

export function buildPlaces({ data, buildings, navgrid, boundary }) {
  const places = [];
  const info = data.info.places;
  const doorsOf = (id) => data.doors.filter((d) => d.b === id);
  const add = (p) => places.push(p);

  const inFrontOfDoor = (d, dist = 3) => ({
    x: d.x + d.nx * dist,
    z: d.z + d.nz * dist,
    yaw: yawFacing(-d.nx, -d.nz),
  });

  // Campus buildings (with an entrance in front).
  for (const b of buildings.campus) {
    const meta = info[String(b.id)];
    if (!b.name && !meta) continue;
    const doors = doorsOf(b.id);
    let spot;
    if (doors.length) spot = inFrontOfDoor(doors[0]);
    else {
      const n = navgrid.nearest(b.c[0], b.c[1]);
      const [x, z] = navgrid.pos(n);
      spot = { x, z, yaw: yawFacing(b.c[0] - x, b.c[1] - z) };
    }
    const cat = b.cat === 'dorm' ? 'dorm' : b.cat === 'food' ? 'food' : b.special === 'amphitheatre' ? 'venue' : 'academic';
    add({
      id: `b${b.id}`,
      title: (meta && meta.title) || b.name,
      sub: b.cat === 'food' ? 'Yeme içme' : b.cat === 'dorm' ? 'Yurt' : b.special === 'amphitheatre' ? 'Etkinlik alanı' : 'Akademik bina',
      cat,
      group: cat === 'food' ? 'Yeme içme' : 'Binalar',
      buildingId: b.id,
      ...spot,
    });
  }

  // POIs inside the campus (library, Subway).
  const lib = data.pois.find((p) => p.cat === 'library');
  if (lib) {
    let best = null;
    let bd = Infinity;
    for (const d of data.doors) {
      const dd = Math.hypot(d.x - lib.x, d.z - lib.z);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (best) add({ id: 'library', title: 'Kütüphane', sub: 'A, K ve M Blokları içinde (konum OSM işaretine göre)', cat: 'library', group: 'Binalar', buildingId: best.b, ...inFrontOfDoor(best) });
  }
  const subway = data.pois.find((p) => p.name === 'Subway');
  if (subway) {
    const n = navgrid.nearest(subway.x, subway.z);
    const [x, z] = navgrid.pos(n);
    add({ id: 'subway', title: 'Subway', sub: 'Sandviç', cat: 'food', group: 'Yeme içme', x, z, yaw: yawFacing(subway.x - x, subway.z - z) });
  }

  // Green areas.
  for (const name of ['IEU Kedili Park', 'IEU Arka Bahçe', 'IEU Çiçeklik']) {
    const a = data.areas.find((q) => q.name === name);
    if (!a) continue;
    let cx = 0;
    let cz = 0;
    const n = a.r.length / 2;
    for (let i = 0; i < n; i++) {
      cx += a.r[i * 2];
      cz += a.r[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    const node = navgrid.nearest(cx, cz);
    const [x, z] = navgrid.pos(node);
    const meta = info[String(a.id)];
    add({ id: `a${a.id}`, title: (meta && meta.title) || name, sub: 'Yeşil alan', cat: 'green', group: 'Yeşil alanlar', x, z, yaw: yawFacing(cx - x, cz - z) });
  }

  // Gates.
  boundary.gates.forEach((g, i) => {
    // Stand a few metres inside the campus, facing the gate.
    const inward = pointInRing(g.x - g.az * 3, g.z + g.ax * 3, data.campusRing) ? 1 : -1;
    const nx = -g.az * inward;
    const nz = g.ax * inward;
    const x = g.x + nx * 4;
    const z = g.z + nz * 4;
    const names = ['Batı kapısı', 'Kuzey kapısı 1', 'Kuzey kapısı 2'];
    let label = names[i] || `Kapı ${i + 1}`;
    if (Math.abs(g.z) > Math.abs(g.x)) label = g.z < 0 ? `Kuzey kapısı ${i > 1 ? 2 : 1}` : `Güney kapısı`;
    else label = g.x < 0 ? 'Batı kapısı' : 'Doğu kapısı';
    add({ id: `g${i}`, title: label, sub: 'Bariyerli giriş', cat: 'gate', group: 'Kampüs kapıları', x, z, yaw: yawFacing(-nx, -nz) });
  });

  // Outside landmarks (only enabled when leaving the campus is allowed).
  const outside = [
    ['Teleferik alt istasyonu', 'Balçova Aşağı', 'transport', 'Balçova Aşağı'],
    ['Teleferik Kafe', 'Kafe', 'food', 'Teleferik Kafe'],
    ['Mint', 'Kafe', 'food', 'Mint'],
    ['Teleferik Kır Bahçesi', 'Hızlı yemek', 'food', 'Teleferik Kır Bahçesi'],
    ['Balçova Otoparkı', 'Otopark', 'transport', 'Balçova Otoparkı'],
    ['Uğur Cami', 'Cami', 'other', 'Uğur Cami'],
  ];
  for (const [title, sub, cat, poiName] of outside) {
    const p = data.pois.find((q) => q.name === poiName);
    if (!p) continue;
    add({ id: `o${poiName}`, title, sub, cat, group: 'Kampüs dışı', x: p.x, z: p.z + 3, yaw: 0, outside: true });
  }

  places.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  return { places, groups: GROUPS };
}
