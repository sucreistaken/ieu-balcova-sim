// Campus calendar and daily rhythm, driven by data/real.json (official class period starts,
// academic calendar, opening hours). Pure logic, no rendering.
//
// What is real: period start times, term/exam/holiday dates, the SFL class windows and the
// opening hours of the listed businesses. What is modelled: how busy the campus is at a given
// time of a given kind of day, and the 45 min lesson + 10 min break split (end times are not
// published).

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const pad = (n) => String(n).padStart(2, '0');

export const dateKey = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
};
export const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
export const fmtDate = (date) => `${DAYS[weekdayOf(date)]} ${date.d} ${MONTHS[date.m - 1]} ${date.y}`;
export const fmtShort = (date) => `${DAYS[weekdayOf(date)]} ${date.d} ${MONTHS[date.m - 1]}`;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const DAY_LABEL = {
  term: 'Ders günü',
  makeup: 'Telafi cumartesisi',
  exam: 'Sınav haftası',
  holiday: 'Resmî tatil',
  weekend: 'Hafta sonu',
  break: 'Dönem arası',
  summer: 'Yaz tatili',
};

const inRange = (key, from, to) => key >= from && key <= to;

export class Schedule {
  constructor(real) {
    this.real = real;
    const p = real && real.periods;
    this.starts = ((p && p.starts) || ['08:30', '09:25', '10:20', '11:15', '12:10', '13:05', '14:00', '14:55', '15:50']).map(toMin);
    this.lesson = (p && p.lessonMinutes) || 45;
    this.cal = real && real.calendar;
    this.sfl = real && real.sfl ? real.sfl.windows : [];
    this.hours = (real && real.hours) || {};
  }

  // Kind of day: what the campus is doing on this date.
  dayInfo(date) {
    const key = dateKey(date);
    const wd = weekdayOf(date);
    const c = this.cal;
    let type;
    let label = '';
    if (!c) type = wd === 0 || wd === 6 ? 'weekend' : 'term';
    else {
      const holiday = c.holidays.find((h) => inRange(key, h.from, h.to));
      const makeup = c.makeups.find((m) => m.date === key);
      const exam = c.exams.find((e) => inRange(key, e.from, e.to));
      const term = c.terms.find((t) => t.from && t.to && inRange(key, t.from, t.to));
      if (holiday) {
        type = 'holiday';
        label = holiday.name;
      } else if (makeup) {
        type = 'makeup';
        label = makeup.name;
      } else if (wd === 0 || wd === 6) type = 'weekend';
      else if (exam) {
        type = 'exam';
        label = exam.name;
      } else if (term) type = 'term';
      else type = date.m >= 6 && date.m <= 8 ? 'summer' : 'break';
    }
    return { key, wd, type, label, text: DAY_LABEL[type] };
  }

  // Where in the class-period grid a time of day falls.
  period(hours) {
    const t = hours * 60;
    const S = this.starts;
    if (t < S[0]) return { n: 0, phase: 'before', toNext: S[0] - t, toEnd: 0 };
    for (let i = 0; i < S.length; i++) {
      const end = S[i] + this.lesson;
      if (t < end) return { n: i + 1, phase: 'class', toEnd: end - t, toNext: (S[i + 1] ?? end) - t };
      const next = S[i + 1];
      if (next === undefined) break;
      if (t < next) return { n: i + 1, phase: 'break', toEnd: 0, toNext: next - t };
    }
    return { n: S.length, phase: 'after', toNext: 0, toEnd: 0 };
  }

  // How busy the campus is (0..1) for a kind of day and a time.
  crowdLevel(info, hours) {
    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const h = hours;
    const night = 0.03;
    // Shape of an ordinary teaching day: early staff, arrival wave, daytime plateau, evening drain.
    const teaching = () => {
      let v = night + 0.17 * smooth(6, 7.6, h) + 0.4 * smooth(7.6, 8.5, h);
      v -= 0.12 * smooth(8.5, 9, h) * (1 - smooth(16.5, 17.5, h));
      const lunch = smooth(11.6, 12.2, h) * (1 - smooth(13.4, 14.2, h));
      v += 0.22 * lunch;
      v -= 0.55 * smooth(16.6, 18.6, h);
      v += 0.1 * smooth(18.6, 19.4, h) * (1 - smooth(21, 23, h));
      v = Math.max(night, v);
      const p = this.period(h);
      // Bells: corridors and paths swell for a few minutes around every period change.
      if (p.n > 0 && p.phase === 'break') v *= 1.55;
      if (p.phase === 'before' && p.toNext < 12) v *= 1.5;
      if (p.phase === 'class' && p.toEnd < 3) v *= 1.15;
      if (p.phase === 'class' && p.toEnd >= 3) v *= 0.82;
      return Math.min(1, v);
    };
    switch (info.type) {
      case 'term':
        return teaching();
      case 'makeup':
        return teaching() * 0.55;
      case 'exam': {
        // Fewer bells, more studying: a flatter, longer day.
        const base = night + 0.5 * smooth(8, 9.2, h) * (1 - smooth(17, 20, h)) + 0.22 * smooth(19, 20, h) * (1 - smooth(23, 24, h));
        return Math.min(1, base);
      }
      case 'weekend':
        return night + 0.14 * smooth(9.5, 11, h) * (1 - smooth(17, 20, h));
      case 'holiday':
        return night + 0.03 * smooth(10, 12, h) * (1 - smooth(16, 18, h));
      case 'summer':
        return night + 0.1 * smooth(8, 9.5, h) * (1 - smooth(16, 18, h));
      default:
        return night + 0.18 * smooth(8, 9.5, h) * (1 - smooth(16.5, 18, h));
    }
  }

  // How full the inside of a building is: { seats, corridor } as fractions (0..1).
  indoorLevel(info, hours, cat) {
    const h = hours;
    const p = this.period(h);
    const teaching = info.type === 'term' || info.type === 'makeup';
    if (cat === 'food') {
      const lunch = h >= 11.9 && h < 14;
      const base = this.crowdLevel(info, h);
      return { seats: lunch && teaching ? 0.85 : Math.min(0.7, base * 0.9), corridor: 0 };
    }
    if (cat === 'dorm') {
      const night = h >= 21 || h < 8;
      return { seats: night ? 0.55 : h < 17 ? 0.15 : 0.4, corridor: night ? 0.3 : 0.2 };
    }
    if (cat === 'venue') return { seats: 0.1, corridor: 0 };
    if (teaching) {
      if (p.phase === 'class') return { seats: 0.55, corridor: p.toEnd < 4 ? 0.7 : 0.1 };
      if (p.phase === 'break') return { seats: 0.25, corridor: 1 };
      if (p.phase === 'before') return { seats: 0.1, corridor: p.toNext < 30 ? 0.6 : 0.05 };
      return { seats: h < 18.5 ? 0.15 : h < 22 ? 0.04 : 0.004, corridor: h < 18 ? 0.25 : 0.03 };
    }
    if (info.type === 'exam') return h >= 9 && h < 20 ? { seats: 0.5, corridor: 0.3 } : { seats: h < 23 ? 0.05 : 0.004, corridor: 0.03 };
    if (info.type === 'weekend') return { seats: h >= 10 && h < 18 ? 0.06 : 0.004, corridor: 0.05 };
    if (info.type === 'holiday') return { seats: 0, corridor: 0.01 };
    return { seats: 0.05, corridor: 0.08 };
  }

  // Opening hours of a listed business, or null when nothing is published.
  openState(name, info, hours) {
    const e = this.hours[name];
    if (!e) return null;
    const slot = info.wd === 0 ? e.sunday : info.wd === 6 ? e.saturday : e.weekday;
    if (!slot) return { open: false, from: null, to: null };
    const t = hours * 60;
    const fmt = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    return { open: t >= slot[0] && t < slot[1], from: fmt(slot[0]), to: fmt(slot[1]) };
  }

  // SFL preparatory groups (levels A, B, C) currently in class, from the official announcement.
  sflInSession(info, hours) {
    if (info.type !== 'term' && info.type !== 'makeup') return { A: false, B: false, C: false };
    const t = hours * 60;
    const out = { A: false, B: false, C: false };
    for (const w of this.sfl) {
      if (!w.days.includes(info.wd)) continue;
      if (t >= toMin(w.from) && t < toMin(w.to)) out[w.level] = true;
    }
    return out;
  }
}
