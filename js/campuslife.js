// Life director: turns the calendar and the time of day into what the crowd does. It sets how
// many people are on the paths, whether they head for buildings (bells), cafes (lunch) or the
// library (exams, evenings), and how long they stay inside. Owns no meshes.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class LifeDirector {
  constructor({ crowd, clock, schedule, maxCrowd = 170 }) {
    this.crowd = crowd;
    this.clock = clock;
    this.schedule = schedule;
    this.maxCrowd = maxCrowd;
    this.acc = 1;
    this.state = { level: 0, target: 0, period: null, note: '' };
    crowd.director = this;
    crowd.auto = true;
  }

  // Seconds (real time) an NPC stays inside a building it just entered.
  insideSeconds(rand) {
    const { clock, schedule } = this;
    const scale = Math.max(1, clock.timeScale);
    const type = clock.info.type;
    if (type === 'term' || type === 'makeup') {
      const p = schedule.period(clock.hours);
      // In class: stay until the bell (plus a few minutes of dawdling).
      if (p.phase === 'class') return clamp(((p.toEnd + rand() * 4) * 60) / scale, 8, 900);
      if (p.phase === 'before') return clamp(((p.toNext + p.toEnd + 45 + rand() * 4) * 60) / scale, 8, 900);
      return clamp((20 * 60 + rand() * 600) / scale, 8, 300);
    }
    // Weekends, holidays, exams: people come and go for a while.
    return clamp(((20 + rand() * 80) * 60) / scale, 10, 600);
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < 1) return;
    this.acc = 0;
    const { clock, schedule, crowd } = this;
    const h = clock.hours;
    const info = clock.info;
    const p = schedule.period(h);
    const level = schedule.crowdLevel(info, h);
    const target = Math.round(level * this.maxCrowd);
    this.state = { level, target, period: p, note: info.text };
    if (crowd.auto) crowd.targetAlive = target;

    const teaching = info.type === 'term' || info.type === 'makeup';
    const inClass = teaching && p.phase === 'class' && p.toEnd >= 3;
    const rush = teaching && (p.phase === 'break' || (p.phase === 'before' && p.toNext < 15) || (p.phase === 'class' && p.toEnd < 3));
    const lunch = teaching && h >= 11.9 && h < 14;
    const exam = info.type === 'exam';
    const night = h >= 21.5 || h < 6.5;

    crowd.bias.door = rush ? 0.46 : inClass ? 0.34 : night ? 0.1 : 0.22;
    crowd.bias.spot = lunch ? 0.5 : exam ? 0.32 : 0.26;
    crowd.mix = inClass ? { walker: 0.46, stander: 0.22 } : rush ? { walker: 0.86, stander: 0.09 } : night ? { walker: 0.85, stander: 0.1 } : { walker: 0.62, stander: 0.2 };

    // What people talk about.
    crowd.phraseCtx = info.type === 'holiday' ? 'holiday' : info.type === 'weekend' ? 'weekend'
      : exam ? 'exam' : rush ? 'rush' : lunch ? 'lunch' : h < 9.4 ? 'morning' : h >= 17.5 ? 'evening' : null;

    // Hotspots: cafes follow their real opening hours, the library fills up for exams and at night.
    for (const s of crowd.spots) {
      if (s.name === 'Starbucks') {
        const o = schedule.openState('Starbucks', info, h);
        s.weight = o && !o.open ? 0.15 : lunch ? 4 : 3;
      } else if (s.name === 'library') s.weight = exam ? 6 : night ? 2.5 : 3;
      else if (s.name === 'Subway' || s.name === 'Amfiteatr') s.weight = night ? 0.3 : s.name === 'Subway' && lunch ? 3 : 2;
    }
  }
}
