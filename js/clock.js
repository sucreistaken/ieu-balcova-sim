// Simulation clock: date and hour of day, on top of the sky's time of day. Rolls the date at
// midnight and tells listeners when the kind of day changes.

import { addDays, dateKey } from './schedule.js';

export class SimClock {
  constructor({ sky, schedule, date }) {
    this.sky = sky;
    this.schedule = schedule;
    this.date = date;
    this.info = schedule.dayInfo(date);
    this.timeScale = 20; // simulated seconds per real second
    this.listeners = [];
  }

  get hours() {
    return this.sky.hours;
  }

  onDayChange(fn) {
    this.listeners.push(fn);
  }

  _refresh() {
    this.info = this.schedule.dayInfo(this.date);
    for (const fn of this.listeners) fn(this.info, this.date);
  }

  setDate(date) {
    this.date = { ...date };
    this._refresh();
  }

  setHours(h) {
    this.sky.setTime(h);
  }

  // Advance by simulated hours, rolling the date over midnight.
  advance(dh) {
    let h = this.sky.hours + dh;
    let rolled = false;
    while (h >= 24) {
      h -= 24;
      this.date = addDays(this.date, 1);
      rolled = true;
    }
    this.sky.setTime(h);
    if (rolled) this._refresh();
  }

  get key() {
    return dateKey(this.date);
  }
}
