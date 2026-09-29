// Compiles the research files in data/research/ into the small data/real.json the simulation
// reads: real room codes per floor, class periods, day types from the academic calendar and
// business hours. Nothing here is invented: every entry keeps the source it came from, and
// values the sources do not state stay null (see the "assumptions" list in the output).
//
//   node tools/build_real.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data/research', f), 'utf8'));
const rooms = read('rooms.json');
const ops = read('operations.json');

// ------------------------------------------------------------------------- rooms
// OSM building ids of the campus blocks (see data/campus.json).
const BLOCK = { E: 88435610, C: 88435600, D: 637305654, TESLA: 637305659, A: 154001110 };

const typeOf = (name) => {
  const n = name.toLowerCase();
  if (/bilgisayar|simülasyon|network|mikroişlemci|oyun ve web|cad|mac lab|open lab|assist|assyst|pc lab/.test(n)) return 'complab';
  if (/stüdyo|studyo/.test(n)) return 'studio';
  if (/atölye|makerlab|baskı/.test(n)) return 'workshop';
  return 'lab';
};

const out = { rooms: {} };
const put = (id, prefix, floor, room) => {
  const b = (out.rooms[id] ||= { prefix, floors: {} });
  (b.floors[floor] ||= []).push(room);
};

// E Blok classrooms (SFL preparatory groups), floor digit taken from the official code.
for (const c of rooms.classrooms) {
  const m = c.usage.match(/sınıfı ([A-Z]{3} \d+)/);
  put(BLOCK.E, 'E', c.floor, { code: c.code, name: 'Derslik', type: 'classroom', use: m ? `Hazırlık grubu ${m[1]}` : 'Hazırlık sınıfı', src: 'sfl' });
}

for (const l of rooms.labs) {
  if (!l.room) continue;
  const room = l.room.replace(/\s+/g, ' ').trim();
  const name = l.name.replace(/\s*\(.*\)\s*$/, '').trim();
  if (/^C \d/.test(room) && /C Blok/.test(l.building)) {
    put(BLOCK.C, 'C', Number(room.split(' ')[1][0]), { code: room, name, type: typeOf(name), src: 'fecs' });
  } else if (/^ML \d/.test(room)) {
    put(BLOCK.TESLA, 'ML', Number(room.split(' ')[1][0]), { code: room, name, type: typeOf(name), src: 'fecs' });
  } else if (/^D/.test(room) && l.building === 'D Blok') {
    const digits = room.replace(/^DB\s*/, '').replace(/^D/, '');
    const floor = room.startsWith('DB') ? -1 : Number(digits[0]);
    put(BLOCK.D, 'D', floor, { code: room, name, type: typeOf(name), src: 'ffad' });
  }
}

// A Blok: the two units with a stated floor (PGDM basement, EKOEGITIM ground floor).
put(BLOCK.A, 'A', -1, { code: '1B18', name: 'PGDM (Psikolojik Danışma)', type: 'office', src: 'pgdm' });
put(BLOCK.A, 'A', -1, { code: '1B19', name: 'PGDM (Psikolojik Danışma)', type: 'office', src: 'pgdm' });
// The unit's room code is not published: no code, only the name and the floor.
put(BLOCK.A, 'A', 0, { code: '', name: 'EKOEĞİTİM (Öğretme ve Öğrenme Merkezi)', type: 'office', src: 'ieu' });

// Sort rooms by code inside each floor.
for (const b of Object.values(out.rooms)) {
  for (const f of Object.keys(b.floors)) b.floors[f].sort((p, q) => p.code.localeCompare(q.code, 'tr', { numeric: true }));
}
// Codes of TESLA start with the floor digit 1 on its lowest level (OSM: 2 levels): assumption.
out.rooms[BLOCK.TESLA].floorOffset = -1;

// ---------------------------------------------------------------------- periods
const starts = rooms.periods.filter((p) => p.startBasis === 'observed').map((p) => p.start);
out.periods = {
  starts,
  lessonMinutes: 45,
  note: 'Başlangıç saatleri OBS ders kayıt ekranından gözlemlendi (55 dakikalık ızgara). Bitiş saatleri ve teneffüs süresi yayımlanmıyor: 45 dk ders, 10 dk teneffüs tahmindir.',
};

// SFL preparatory program windows (official announcement): level -> days -> hours.
out.sfl = {
  source: 'https://sfl.ieu.edu.tr/tr/announcements/type/read/id/13829',
  windows: rooms.periodsNotes.prepProgram2026_27.module1.map((w) => {
    const [from, to] = w.hours.split('-').map((x) => x.replace('.', ':'));
    const days = w.days.split('-').map((d) => ({ Pzt: 1, Sal: 2, Çar: 3, Per: 4, Cum: 5 })[d]);
    return { level: w.level[0], days, from, to };
  }),
};

// -------------------------------------------------------------------- calendar
// Lisans track only (undergraduates), plus the public holidays which apply to everyone.
const cal = ops.calendar.filter((c) => c.track === 'lisans' && (c.term === 'guz' || c.term === 'bahar' || c.term === 'yaz'));
const label = (c) => c.label;
const range = (c) => ({ from: c.start, to: c.end });
const find = (re, term) => cal.filter((c) => c.term === term && re.test(label(c)));
const one = (re, term) => {
  const c = find(re, term)[0];
  return c ? c.start : null;
};
out.calendar = {
  source: 'https://www.ieu.edu.tr/tr/akademik-takvim',
  terms: [
    { name: '2026-27 güz', from: one(/^DERSLERİN BAŞLAMASI/, 'guz'), to: one(/^DERSLERİN SONA ERMESİ/, 'guz') },
    { name: '2026-27 bahar', from: one(/^DERSLERİN BAŞLAMASI/, 'bahar'), to: one(/^DERSLERİN SONA ERMESİ/, 'bahar') },
  ],
  exams: cal.filter((c) => /^(ARA|FİNAL) SINAVLAR/.test(label(c))).map((c) => ({ ...range(c), name: label(c) })),
  holidays: cal.filter((c) => /Resmî Tatil|Bayramı|Tatil/.test(label(c))).map((c) => ({ ...range(c), name: label(c) })),
  makeups: cal.filter((c) => /Telafisi/.test(label(c)) && c.start === c.end).map((c) => ({ date: c.start, name: label(c) })),
};

// ----------------------------------------------------------------------- hours
const toMin = (s) => {
  const m = /(\d{1,2})[:.](\d{2})\s*[–-]\s*(\d{1,2})[:.](\d{2})/.exec(s || '');
  return m ? [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])] : null;
};
out.hours = {};
for (const s of ops.services) {
  const h = s.hours && typeof s.hours === 'object' ? s.hours : null;
  if (!h) continue;
  const entry = { weekday: toMin(h.weekday), saturday: toMin(h.saturday), sunday: toMin(h.sunday), source: s.source };
  if (entry.weekday || entry.saturday || entry.sunday) out.hours[s.name.split(' (')[0]] = entry;
}
out.hours['Kütüphane alt kat (7/24)'] = { weekday: [0, 1440], saturday: [0, 1440], sunday: [0, 1440], source: 'https://kutuphane.ieu.edu.tr/tr' };

out.assumptions = [
  'Oda kodları ve katları resmi kaynaklardan; odaların bina içindeki konumu bilinmiyor, simülasyonda kat içi sıra örnektir.',
  'E Blok sınıf kodlarının kat basamağı (E 1xx = 1. kat) resmi kodlama düzenine göre; simülasyondaki 0. kat bu binanın ilk katı sayıldı.',
  'TESLA (ML) kodlarında kat basamağı 1, en alt kata denk sayıldı (OSM: 2 kat).',
  'Ders bitiş saatleri ve teneffüs süresi kaynaklarda yok: 45 dk ders + 10 dk teneffüs tahmindir.',
  'Kafe ve kantin çalışma saatleri tim.ieu.edu.tr/tr/is-ortaklari sayfasındandır; hangi işletmenin hangi binada olduğu sayfada yazmıyor (yalnız Starbucks OSM adıyla eşleşiyor).',
];
out.generated = new Date().toISOString().slice(0, 10);

fs.writeFileSync(path.join(root, 'data/real.json'), `${JSON.stringify(out)}\n`);
const total = Object.values(out.rooms).reduce((n, b) => n + Object.values(b.floors).reduce((m, f) => m + f.length, 0), 0);
console.log(`data/real.json: ${total} rooms in ${Object.keys(out.rooms).length} buildings, ${out.periods.starts.length} periods, ${out.calendar.holidays.length} holidays, ${Object.keys(out.hours).length} hour entries`);
