import fs from 'node:fs';
import { generateLayout } from '../js/layout.js';
const d = JSON.parse(fs.readFileSync(new URL('../data/campus.json', import.meta.url), 'utf8'));
const target = process.argv[2];
for (const b of d.buildings.filter((q) => q.campus && q.name)) {
  const doors = d.doors.filter((x) => x.b === b.id);
  const t0 = performance.now();
  const L = generateLayout(b, doors, {});
  const dt = (performance.now() - t0).toFixed(0);
  console.log(b.name, 'area', b.area, 'grid', L.W + 'x' + L.H, 'ms', dt, JSON.stringify(L.stats), 'theta', (L.theta * 180 / Math.PI).toFixed(1));
  if (target && b.name === target) {
    const rows = [];
    for (let j = 0; j < L.H; j++) {
      let s = '';
      for (let i = 0; i < L.W; i++) {
        const z = L.zone[j * L.W + i];
        s += z === 0 ? ' ' : z === 1 ? '.' : z < 10 ? '#' : String.fromCharCode(65 + (z % 26));
      }
      rows.push(s);
    }
    console.log(rows.join('\n'));
  }
}
