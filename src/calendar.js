// calendar.js -- one day record, and the arithmetic a planner actually wants.
//
// astro.js says where the moon and sun were. holidays.js says what the State
// Council decided. This file joins them into the thing the grid draws, and
// then does the only calculation that matters for the brief: given a run of
// days, which of them are actually free, and what would it cost to join two
// free runs together.

import {
  toLunar, solarTermsForYear, cstDayNumber, fromDayNumber,
  ganzhiYear, springFestivalDay, LUNAR_MONTH_NAMES,
} from './astro.js';
import { HOLIDAYS, HOLIDAY_PAPERS, HOLIDAY_YEARS } from './holidays.js';

// --- the status program -------------------------------------------------
// Five roles, and a day is in exactly one. Everything in the interface that
// carries colour carries one of these and nothing else.
export const STATUS = {
  HOLIDAY: 'holiday',   // 休 -- statutory day off, named by the notice
  MAKEUP: 'makeup',     // 班 -- a weekend the notice turns into a working day
  WEEKEND: 'weekend',   // ordinary Saturday or Sunday
  WORKDAY: 'workday',   // ordinary working day
};

/** Is this a day off, once the notice has had its say? */
export const isRest = (s) => s === STATUS.HOLIDAY || s === STATUS.WEEKEND;

// --- festivals ----------------------------------------------------------
const SOLAR_FESTIVALS = {
  '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节',
  '04-01': '愚人节', '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节',
  '07-01': '建党节', '08-01': '建军节', '09-03': '抗战胜利日', '09-10': '教师节',
  '09-18': '九一八', '10-01': '国庆节', '12-13': '国家公祭日', '12-25': '圣诞节',
};

// Keyed by lunar month/day. 除夕 is handled separately: it is the last day of
// 腊月, which is 29 or 30 depending on the year, so it cannot be a fixed key.
const LUNAR_FESTIVALS = {
  '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节',
  '7-7': '七夕', '7-15': '中元节', '8-15': '中秋节', '9-9': '重阳节',
  '12-8': '腊八节', '12-23': '小年',
};

// Festivals big enough to outrank a solar term for the one label a cell shows.
const MAJOR = new Set(['春节', '除夕', '中秋节', '端午节', '元宵节', '国庆节', '元旦', '清明']);

// --- caches -------------------------------------------------------------
// Both are keyed by Gregorian year and built once; a three-month view touches
// at most two years, and scrubbing across a decade stays cheap.
const termsByYear = new Map();
function termsFor(year) {
  let m = termsByYear.get(year);
  if (!m) {
    m = new Map(solarTermsForYear(year).map((t) => [t.day, t]));
    termsByYear.set(year, m);
  }
  return m;
}

const holidayByYear = new Map();
function holidaysFor(year) {
  let m = holidayByYear.get(year);
  if (!m) {
    m = new Map();
    for (const [md, name, off] of HOLIDAYS[year] || []) {
      const [mm, dd] = md.split('-').map(Number);
      m.set(cstDayNumber(year, mm, dd), { name, off: !!off });
    }
    holidayByYear.set(year, m);
  }
  return m;
}

/** True when a published notice covers this year. */
export const hasHolidayData = (year) =>
  year >= HOLIDAY_YEARS.from && year <= HOLIDAY_YEARS.to;

export const holidayPaper = (year) => HOLIDAY_PAPERS[year] || null;

// --- the day record -----------------------------------------------------
const dayCache = new Map();

/**
 * Everything the grid needs about one day, by day number (days since the
 * Unix epoch, read as a civil date in UTC+8).
 */
export function dayInfo(dayNum) {
  let rec = dayCache.get(dayNum);
  if (rec) return rec;

  const { y, m, d } = fromDayNumber(dayNum);
  const lunar = toLunar(y, m, d);
  const term = termsFor(y).get(dayNum) || null;
  const notice = holidaysFor(y).get(dayNum) || null;

  // 1 = Monday .. 7 = Sunday. The epoch (1970-01-01) was a Thursday.
  const weekday = ((dayNum + 3) % 7 + 7) % 7 + 1;
  const isWeekend = weekday >= 6;

  let status;
  if (notice) status = notice.off ? STATUS.HOLIDAY : STATUS.MAKEUP;
  else status = isWeekend ? STATUS.WEEKEND : STATUS.WORKDAY;

  // Festivals, most significant first.
  const festivals = [];
  if (notice && notice.off) festivals.push(notice.name);
  const solarKey = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (SOLAR_FESTIVALS[solarKey]) festivals.push(SOLAR_FESTIVALS[solarKey]);
  if (!lunar.leap) {
    const lk = `${lunar.month}-${lunar.day}`;
    if (LUNAR_FESTIVALS[lk]) festivals.push(LUNAR_FESTIVALS[lk]);
    if (lunar.month === 12 && lunar.day === lunar.monthLength) festivals.push('除夕');
  }
  if (term && term.name === '清明') festivals.push('清明');
  const seen = new Set();
  const unique = festivals.filter((f) => !seen.has(f) && seen.add(f));

  // The single label a dense cell gets: festival, then term, then the lunar
  // month name on 初一, then the lunar day. This is the order every printed
  // Chinese calendar uses, and it is the order that stays readable at 11px.
  const major = unique.find((f) => MAJOR.has(f));
  let label, labelKind;
  if (major) { label = major; labelKind = 'festival'; }
  else if (unique.length) { label = unique[0]; labelKind = 'festival'; }
  else if (term) { label = term.name; labelKind = 'term'; }
  else if (lunar.day === 1) { label = lunar.monthName; labelKind = 'lunar-month'; }
  else { label = lunar.dayName; labelKind = 'lunar-day'; }

  rec = {
    day: dayNum, y, m, d, weekday, isWeekend,
    lunar, term, status,
    holidayName: notice ? notice.name : null,
    festivals: unique,
    label, labelKind,
    known: hasHolidayData(y),
  };
  dayCache.set(dayNum, rec);
  return rec;
}

/** Day records for [from, to] inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(dayInfo(n));
  return out;
}

/** Today, as a day number in UTC+8 regardless of where the browser sits. */
export function todayDayNumber() {
  return Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000);
}

/**
 * Where a day sits between solar terms: which term it is inside, how many
 * days in, and how far to the next. Printed almanacs put this line under the
 * date and it is the one piece of 节气 information that is actually useful --
 * "霜降 第 3 天, 立冬 还有 13 天" tells you where the season is going.
 */
export function termContext(dayNum) {
  const { y } = fromDayNumber(dayNum);
  const all = [
    ...solarTermsForYear(y - 1).slice(-2),
    ...solarTermsForYear(y),
    ...solarTermsForYear(y + 1).slice(0, 2),
  ];
  let cur = null, next = null;
  for (const t of all) {
    if (t.day <= dayNum) cur = t;
    else { next = t; break; }
  }
  return {
    current: cur ? { ...cur, nth: dayNum - cur.day + 1 } : null,
    next: next ? { ...next, inDays: next.day - dayNum } : null,
  };
}

// --- planning arithmetic ------------------------------------------------

/**
 * Maximal runs of consecutive days off inside [from, to].
 * A run may be clipped by the range; `clipped` says so, because a 7-day
 * 国庆 that the view cuts in half should not be reported as 4 days.
 */
export function restRuns(from, to) {
  const runs = [];
  let start = null;
  for (let n = from; n <= to; n++) {
    const rest = isRest(dayInfo(n).status);
    if (rest && start === null) start = n;
    if (!rest && start !== null) { runs.push({ from: start, to: n - 1 }); start = null; }
  }
  if (start !== null) runs.push({ from: start, to });
  return runs.map((r) => ({
    ...r,
    length: r.to - r.from + 1,
    clipped: (r.from === from && isRest(dayInfo(from - 1).status))
      || (r.to === to && isRest(dayInfo(to + 1).status)),
    name: namedRun(r.from, r.to),
  }));
}

function namedRun(from, to) {
  for (let n = from; n <= to; n++) {
    const info = dayInfo(n);
    if (info.holidayName) return info.holidayName;
  }
  return null;
}

/**
 * What a selected span costs and buys.
 * `leave` is the number of working days inside it -- the days you would have
 * to book. `off` is everything else.
 */
export function summarize(from, to) {
  let leave = 0, off = 0, makeup = 0, statutory = 0;
  for (let n = from; n <= to; n++) {
    const s = dayInfo(n).status;
    if (s === STATUS.HOLIDAY) { off++; statutory++; }
    else if (s === STATUS.WEEKEND) off++;
    else { leave++; if (s === STATUS.MAKEUP) makeup++; }
  }
  const total = to - from + 1;
  return { from, to, total, leave, off, makeup, statutory };
}

/**
 * The bridges: gaps of working days short enough to be worth burning leave on.
 *
 * For each gap between two rest runs, booking every working day in it welds
 * the runs on both sides into one break. Returns the trade -- how many days
 * of leave, how many consecutive days off you get -- sorted by the best ratio,
 * which is the number people actually optimise.
 */
export function bridges(from, to, maxLeave = 4) {
  const runs = restRuns(from, to);
  const out = [];
  for (let i = 0; i < runs.length - 1; i++) {
    const a = runs[i], b = runs[i + 1];
    const gapFrom = a.to + 1, gapTo = b.from - 1;
    const cost = gapTo - gapFrom + 1;
    if (cost < 1 || cost > maxLeave) continue;
    // Reach outward past the range edges so a break is reported at full length.
    const left = extend(a.from, -1);
    const right = extend(b.to, +1);
    out.push({
      gapFrom, gapTo, cost,
      from: left, to: right,
      length: right - left + 1,
      name: a.name || b.name || null,
    });
  }
  return out.sort((x, y) => (y.length / y.cost) - (x.length / x.cost) || x.cost - y.cost);
}

/** Walk from `n` in `dir` while the days stay free; return the last free day. */
function extend(n, dir) {
  let cur = n;
  // 400 is a stop, not a limit: nothing real runs that long and it keeps a
  // corrupt data set from spinning here.
  for (let i = 0; i < 400; i++) {
    const next = cur + dir;
    if (!isRest(dayInfo(next).status)) break;
    cur = next;
  }
  return cur;
}

// --- ranges -------------------------------------------------------------
/** First day of the month containing `dayNum`. */
export function monthStart(dayNum) {
  const { y, m } = fromDayNumber(dayNum);
  return cstDayNumber(y, m, 1);
}

/** First day (Monday) of the week containing `dayNum`. */
export function weekStart(dayNum) {
  return dayNum - (dayInfo(dayNum).weekday - 1);
}

/** Add `n` months to the month containing `dayNum`, keeping day 1. */
export function addMonths(dayNum, n) {
  const { y, m } = fromDayNumber(dayNum);
  const total = y * 12 + (m - 1) + n;
  return cstDayNumber(Math.floor(total / 12), (total % 12) + 1, 1);
}

/** Last day of the month containing `dayNum`. */
export function monthEnd(dayNum) {
  return addMonths(dayNum, 1) - 1;
}

export { toLunar, ganzhiYear, springFestivalDay, cstDayNumber, fromDayNumber, LUNAR_MONTH_NAMES };
