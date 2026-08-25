// astro.js -- solar terms and the Chinese lunisolar calendar, computed.
//
// Not a lookup table. Months come from real new-moon instants and terms from
// real solar longitude, both reduced to UTC+8, which is what GB/T 33661-2017
// says the 农历 actually is. A table would be smaller; it would also be a
// silent liar the moment one of its 200 hex constants was mistyped. Every
// number below traces to Meeus, *Astronomical Algorithms* 2nd ed., and the
// whole thing is checked against known 春节 dates in test/verify.js.
//
//   ch. 25  solar coordinates      -> 节气
//   ch. 49  phases of the moon     -> 朔 (new moon) -> month starts
//   ch. 10  dynamical time (delta-T from an IERS-anchored table, see below)

import {
  NEW_MOON_BASE, NEW_MOON_DELTAS,
  SOLAR_TERM_BASE, SOLAR_TERM_FIRST_INDEX, SOLAR_TERM_DELTAS,
  EPHEMERIS_RANGE,
} from './ephemeris.js';

const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD);
const J2000 = 2451545.0;
const MS_DAY = 86400000;
const SYNODIC = 29.530588861;

/** UTC+8 is fixed for the 农历 by standard -- never the viewer's zone. */
export const CST_OFFSET_MS = 8 * 3600 * 1000;

/** Wrap into [0, 360). */
function norm360(d) {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Wrap into [-180, 180). */
function norm180(d) {
  return ((d % 360) + 540) % 360 - 180;
}

// --- delta-T: TT - UT1, in seconds -------------------------------------
// Sampled from the IERS-based model that Skyfield ships (observed through
// 2024, IERS long-term extrapolation after), linearly interpolated.
//
// The obvious choice here is the Espenak & Meeus polynomial set, and it is
// wrong for anything ahead of us: it assumes delta-T keeps climbing, but the
// Earth's rotation sped up after 2020 and delta-T has sat near 69 s instead.
// By 2057 the polynomial over-predicts by ~35 s. That is invisible except at
// a month boundary landing within a minute of midnight -- which is exactly
// what happens on 2057-09-28, so the polynomial got that date wrong. See
// test/verify.js.
const DELTA_T_TABLE = [
  [1900, -1.98], [1910, 11.14], [1920, 21.62], [1930, 24.42], [1940, 24.42],
  [1950, 28.93], [1960, 33.07], [1962, 33.62], [1964, 34.44], [1966, 35.95],
  [1968, 37.95], [1970, 39.93], [1972, 42.14], [1974, 44.48], [1976, 46.46],
  [1978, 48.53], [1980, 50.54], [1982, 52.17], [1984, 53.79], [1986, 54.87],
  [1988, 55.82], [1990, 56.86], [1992, 58.31], [1994, 59.98], [1996, 61.63],
  [1998, 62.97], [2000, 63.83], [2002, 64.30], [2004, 64.57], [2006, 64.85],
  [2008, 65.46], [2010, 66.07], [2012, 66.60], [2014, 67.28], [2016, 68.10],
  [2018, 68.97], [2020, 69.36], [2022, 69.29], [2024, 69.18], [2026, 69.11],
  [2028, 69.08], [2030, 69.08], [2035, 69.26], [2040, 69.72], [2045, 70.45],
  [2050, 71.44], [2055, 72.70], [2060, 74.23], [2065, 76.02], [2070, 78.08],
  [2075, 80.40], [2080, 82.98], [2085, 85.83], [2090, 88.94], [2095, 92.30],
  [2100, 95.93],
];

/** TT - UT1 in seconds, for a fractional year. */
export function deltaT(year, month = 6) {
  const y = year + (month - 0.5) / 12;
  const first = DELTA_T_TABLE[0], last = DELTA_T_TABLE[DELTA_T_TABLE.length - 1];
  // Outside the table, fall back to the Espenak & Meeus parabola. Nothing this
  // app renders lives out here; the branch exists so the function is total.
  if (y <= first[0] || y >= last[0]) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  for (let i = 1; i < DELTA_T_TABLE.length; i++) {
    const [y1, d1] = DELTA_T_TABLE[i];
    if (y <= y1) {
      const [y0, d0] = DELTA_T_TABLE[i - 1];
      return d0 + (d1 - d0) * ((y - y0) / (y1 - y0));
    }
  }
  return last[1];
}

// --- sun: apparent longitude, degrees (Meeus ch. 25) --------------------
export function solarApparentLongitude(jde) {
  const T = (jde - J2000) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const omega = 125.04 - 1934.136 * T;
  // -0.00569 aberration, -0.00478 sin(omega) nutation in longitude
  return norm360(L0 + C - 0.00569 - 0.00478 * sin(omega));
}

/**
 * JDE at which apparent solar longitude equals `target` degrees, for the
 * crossing nearest `nearJde`. Fixed-point on mean motion (0.9856 deg/day);
 * dLambda/dt never changes sign so this converges in a handful of passes.
 */
export function solarLongitudeJDE(target, nearJde) {
  let jde = nearJde;
  for (let i = 0; i < 50; i++) {
    const diff = norm180(target - solarApparentLongitude(jde));
    if (Math.abs(diff) < 1e-9) break;
    jde += diff / 0.9856473;
  }
  return jde;
}

// --- moon: instant of new moon (Meeus ch. 49, Table 49.A) ---------------
// [coefficient, power of E, multiple of M', multiple of F, multiple of M]
const NEW_MOON_TERMS = [
  [-0.40720, 0, 1, 0, 0],
  [0.17241, 1, 0, 0, 1],
  [0.01608, 0, 2, 0, 0],
  [0.01039, 0, 0, 2, 0],
  [0.00739, 1, 1, 0, -1],
  [-0.00514, 1, 1, 0, 1],
  [0.00208, 2, 0, 0, 2],
  [-0.00111, 0, 1, -2, 0],
  [-0.00057, 0, 1, 2, 0],
  [0.00056, 1, 2, 0, 1],
  [-0.00042, 0, 3, 0, 0],
  [0.00042, 1, 0, 2, 1],
  [0.00038, 1, 0, -2, 1],
  [-0.00024, 1, 2, 0, -1],
  [-0.00007, 0, 1, 0, 2],
  [0.00004, 0, 2, -2, 0],
  [0.00004, 0, 0, 0, 3],
  [0.00003, 0, 1, -2, 1],
  [0.00003, 0, 2, 2, 0],
  [-0.00003, 0, 1, 2, 1],
  [0.00003, 0, 1, 2, -1],
  [-0.00002, 0, 1, -2, -1],
  [-0.00002, 0, 3, 0, 1],
  [0.00002, 0, 4, 0, 0],
];
const OMEGA_TERM = -0.00017;

// Planetary arguments A1..A14 (Meeus p. 351): [coefficient, const, k-rate, T^2-rate]
const NEW_MOON_PLANETARY = [
  [0.000325, 299.77, 0.107408, -0.009173], [0.000165, 251.88, 0.016321, 0],
  [0.000164, 251.83, 26.651886, 0], [0.000126, 349.42, 36.412478, 0],
  [0.000110, 84.66, 18.206239, 0], [0.000062, 141.74, 53.303771, 0],
  [0.000060, 207.14, 2.453732, 0], [0.000056, 154.84, 7.306860, 0],
  [0.000047, 34.52, 27.261239, 0], [0.000042, 207.19, 0.121824, 0],
  [0.000040, 291.34, 1.844379, 0], [0.000037, 161.72, 24.198154, 0],
  [0.000035, 239.56, 25.513099, 0], [0.000023, 331.55, 3.592518, 0],
];

/** JDE (TT) of the k-th new moon; k = 0 is the new moon of 2000 Jan 6. */
export function newMoonJDE(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + SYNODIC * k
    + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;

  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;   // sun anomaly
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2
    + 0.00001238 * T3 - 0.000000058 * T4;                                  // moon anomaly
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2
    - 0.00000227 * T3 + 0.000000011 * T4;                                  // arg. of latitude
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  for (const [coef, ePow, cMp, cF, cM] of NEW_MOON_TERMS) {
    jde += coef * Math.pow(E, ePow) * sin(cMp * Mp + cF * F + cM * M);
  }
  jde += OMEGA_TERM * sin(omega);

  for (const [coef, c0, ck, ct2] of NEW_MOON_PLANETARY) {
    jde += coef * sin(c0 + ck * k + ct2 * T * T);
  }
  return jde;
}

// --- calendar plumbing --------------------------------------------------
/** JD (UT) -> the civil date in UTC+8, as days since the Unix epoch. */
export function jdUTtoCstDayNumber(jdUT) {
  const unixMs = (jdUT - 2440587.5) * MS_DAY;
  return Math.floor((unixMs + CST_OFFSET_MS) / MS_DAY);
}

/** Days since epoch (UTC+8 civil day) -> JD (UT) at that day's 00:00 CST. */
function cstDayNumberToJdUT(n) {
  return 2440587.5 + n - 8 / 24;
}

/** Civil UTC+8 date -> days since epoch. */
export function cstDayNumber(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_DAY);
}

/** Days since epoch -> {y, m, d} in UTC+8. */
export function fromDayNumber(n) {
  const dt = new Date(n * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function jdeToJdUT(jde, approxYear) {
  return jde - deltaT(approxYear) / 86400;
}

const newMoonCache = new Map();
/** Day number (UTC+8) on which new moon k falls. Tabulated where possible. */
function newMoonDayNumber(k) {
  const i = k - NM_K0;
  if (i >= 0 && i < NM_DAYS.length) return NM_DAYS[i];
  let v = newMoonCache.get(k);
  if (v === undefined) {
    const jde = newMoonJDE(k);
    v = jdUTtoCstDayNumber(jdeToJdUT(jde, 2000 + k / 12.3685));
    newMoonCache.set(k, v);
  }
  return v;
}

/** Day number (UTC+8) of the solar-term crossing of `deg` nearest `nearJde`. */
function solarTermDayNumber(deg, nearJde, approxYear) {
  const jde = solarLongitudeJDE(deg, nearJde);
  return jdUTtoCstDayNumber(jdeToJdUT(jde, approxYear));
}

// --- the tabulated ephemeris ------------------------------------------
// src/ephemeris.js carries every new moon and solar term from 1900 to 2100,
// computed against JPL DE440s. Inside that window we read; outside it we fall
// back to the Meeus code above, which is good to a few seconds on the moon
// but carries a ~4 minute spread on the sun -- enough to move a 节气 across
// midnight roughly once a decade. See test/gen-ephemeris.py.

function decodeRun(base, deltas, lo) {
  const out = new Array(deltas.length + 1);
  out[0] = base;
  for (let i = 0; i < deltas.length; i++) {
    out[i + 1] = out[i] + (deltas.charCodeAt(i) - 48 + lo);
  }
  return out;
}

const NM_DAYS = decodeRun(NEW_MOON_BASE, NEW_MOON_DELTAS, 29);
const ST_DAYS = decodeRun(SOLAR_TERM_BASE, SOLAR_TERM_DELTAS, 14);
// Meeus new-moon index k of NM_DAYS[0]; k = 0 is the new moon of 2000-01-06.
const NM_K0 = Math.round((NEW_MOON_BASE - 10962) / SYNODIC);

/** Largest j with ST_DAYS[j] <= day, or -1. */
function termIndexAtOrBefore(day) {
  let lo = 0, hi = ST_DAYS.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ST_DAYS[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Which of the 24 terms sits at tabulated position j. 0 = 立春. */
const termOrdinal = (j) => (SOLAR_TERM_FIRST_INDEX + j) % 24;

// --- 二十四节气 ---------------------------------------------------------
// Index 0 is 立春 (solar longitude 315). The 中气 (major terms, which drive
// the leap rule) are the odd indices: 雨水 at 330, 春分 at 0, and so on.
export const SOLAR_TERMS = [
  '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降',
  '立冬', '小雪', '大雪', '冬至', '小寒', '大寒',
];

/** Longitude (deg) of solar term `i`, where 0 = 立春 at 315. */
export function termLongitude(i) {
  return norm360(315 + 15 * i);
}

/** True when the tabulated ephemeris covers this Gregorian year. */
export function inEphemerisRange(year) {
  return year >= EPHEMERIS_RANGE.from && year <= EPHEMERIS_RANGE.to;
}

/**
 * Every solar term whose UTC+8 date falls in Gregorian `year`.
 * Returns [{ day, index, name, longitude }] ascending.
 */
export function solarTermsForYear(year) {
  const from = cstDayNumber(year, 1, 1);
  const to = cstDayNumber(year + 1, 1, 1);
  if (inEphemerisRange(year)) {
    const out = [];
    let j = termIndexAtOrBefore(from);
    if (j < 0) j = 0;
    if (ST_DAYS[j] < from) j++;
    for (; j < ST_DAYS.length && ST_DAYS[j] < to; j++) {
      const idx = termOrdinal(j);
      out.push({ day: ST_DAYS[j], index: idx, name: SOLAR_TERMS[idx], longitude: termLongitude(idx) });
    }
    return out;
  }
  return computeSolarTermsForYear(year);
}

/** The Meeus fallback, used outside the tabulated range. */
function computeSolarTermsForYear(year) {
  const out = [];
  const startJd = cstDayNumberToJdUT(cstDayNumber(year, 1, 1));
  const endDay = cstDayNumber(year + 1, 1, 1);
  let lon = Math.ceil(solarApparentLongitude(startJd + deltaT(year) / 86400) / 15) * 15;
  let guess = startJd;
  for (let n = 0; n < 30; n++) {
    const target = norm360(lon);
    const day = solarTermDayNumber(target, guess, year);
    if (day >= endDay) break;
    const idx = ((Math.round((target - 315) / 15) % 24) + 24) % 24;
    if (day >= cstDayNumber(year, 1, 1)) {
      out.push({ day, index: idx, name: SOLAR_TERMS[idx], longitude: target });
    }
    lon += 15;
    guess = cstDayNumberToJdUT(day) + 15.2;
  }
  out.sort((a, b) => a.day - b.day);
  return out;
}

// --- 农历 ---------------------------------------------------------------
export const LUNAR_MONTH_NAMES = [
  '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月',
];
const LUNAR_DAY_TENS = ['初', '十', '廿', '三'];
const LUNAR_DIGITS = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function lunarDayName(d) {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  return LUNAR_DAY_TENS[Math.floor(d / 10)] + LUNAR_DIGITS[d % 10];
}

/** Day number of the 冬至 (longitude 270, term index 21) falling in `year`. */
function winterSolsticeDay(year) {
  if (inEphemerisRange(year)) {
    // 冬至 is always Dec 21-23; look just inside December.
    let j = termIndexAtOrBefore(cstDayNumber(year, 12, 24));
    while (j >= 0 && termOrdinal(j) !== 21) j--;
    if (j >= 0) return ST_DAYS[j];
  }
  const seed = cstDayNumberToJdUT(cstDayNumber(year, 12, 22));
  return solarTermDayNumber(270, seed, year);
}

/** Does a 中气 (odd term index) fall inside this lunar month? */
function monthContainsMajorTerm(month, approxYear) {
  const end = month.start + month.length;
  if (inEphemerisRange(approxYear)) {
    let j = termIndexAtOrBefore(month.start);
    if (j < 0) j = 0;
    if (ST_DAYS[j] < month.start) j++;
    for (; j < ST_DAYS.length && ST_DAYS[j] < end; j++) {
      if (termOrdinal(j) % 2 === 1) return true;
    }
    return false;
  }
  const jdStart = cstDayNumberToJdUT(month.start) + deltaT(approxYear) / 86400;
  const lon = solarApparentLongitude(jdStart);
  const nextMajor = Math.ceil(lon / 30 - 1e-9) * 30;
  const day = solarTermDayNumber(norm360(nextMajor), jdStart, approxYear);
  return day >= month.start && day < end;
}

/**
 * The months of the *suì* running from the 11th month containing the 冬至 of
 * `startYear` to (not including) the next such month.
 *
 * Rule, per GB/T 33661-2017: month 11 is whichever lunar month contains the
 * winter solstice. If 13 months fall before the next month 11, the leap is the
 * first of them containing no 中气 (a major term, longitude a multiple of 30).
 * The leap takes the number of the month it follows.
 *
 * The sui therefore numbers 11, 12, 1, 2 ... 10.
 */
function buildSui(startYear) {
  const ws1 = winterSolsticeDay(startYear);
  const ws2 = winterSolsticeDay(startYear + 1);

  // Walk to the new moon at or before ws1, from a deliberately low seed.
  let k = Math.floor((ws1 - 10962) / SYNODIC) - 3;
  while (newMoonDayNumber(k + 1) <= ws1) k++;
  while (newMoonDayNumber(k) > ws1) k--;
  const kStart = k;

  let kEnd = kStart;
  while (newMoonDayNumber(kEnd + 1) <= ws2) kEnd++;

  const count = kEnd - kStart; // 12 in a common sui, 13 in a leap one
  const months = [];
  for (let i = 0; i < count; i++) {
    const start = newMoonDayNumber(kStart + i);
    months.push({
      k: kStart + i,
      start,
      length: newMoonDayNumber(kStart + i + 1) - start,
    });
  }

  let leapIndex = -1;
  if (count === 13) {
    // Month 11 contains 冬至 by construction, so it can never be the leap.
    for (let i = 1; i < count; i++) {
      if (!monthContainsMajorTerm(months[i], startYear)) { leapIndex = i; break; }
    }
  }

  let num = 11;
  for (let i = 0; i < count; i++) {
    if (i === leapIndex) {
      months[i].month = months[i - 1].month; // leap repeats the previous number
      months[i].leap = true;
    } else {
      months[i].month = ((num - 1) % 12) + 1;
      months[i].leap = false;
      num++;
    }
  }
  return months;
}

const suiCache = new Map();
function suiFor(startYear) {
  if (!suiCache.has(startYear)) suiCache.set(startYear, buildSui(startYear));
  return suiCache.get(startYear);
}

/** Within a sui, the months before 正月 belong to the earlier 农历 year. */
function isBeforeZhengyue(months, target) {
  for (const m of months) {
    if (m === target) return true;
    if (m.month === 1 && !m.leap) return false;
  }
  return false;
}

/**
 * Gregorian (UTC+8) -> 农历.
 * `year` is the 农历 year, which turns over at 正月初一, not at 冬至.
 */
export function toLunar(gy, gm, gd) {
  const day = cstDayNumber(gy, gm, gd);
  for (const sy of [gy - 1, gy, gy - 2]) {
    const months = suiFor(sy);
    const last = months[months.length - 1];
    if (day < months[0].start || day >= last.start + last.length) continue;
    for (const m of months) {
      if (day < m.start || day >= m.start + m.length) continue;
      const d = day - m.start + 1;
      return {
        year: isBeforeZhengyue(months, m) ? sy : sy + 1,
        month: m.month,
        day: d,
        leap: m.leap,
        monthLength: m.length,
        monthName: (m.leap ? '闰' : '') + LUNAR_MONTH_NAMES[m.month - 1],
        dayName: lunarDayName(d),
      };
    }
  }
  throw new Error(`lunar conversion out of range: ${gy}-${gm}-${gd}`);
}

/** Every lunar month belonging to 农历 year `ly`, in order. */
function monthsOfLunarYear(ly) {
  const out = [];
  for (const sy of [ly - 1, ly]) {
    for (const m of suiFor(sy)) {
      const y = isBeforeZhengyue(suiFor(sy), m) ? sy : sy + 1;
      if (y === ly) out.push(m);
    }
  }
  return out;
}

/** Gregorian day number (UTC+8) of 正月初一 for 农历 year `ly`. */
export function springFestivalDay(ly) {
  for (const m of suiFor(ly - 1)) if (m.month === 1 && !m.leap) return m.start;
  throw new Error(`no 正月 found for ${ly}`);
}

/** The leap month number for 农历 year `ly`, or 0 when there is none. */
export function leapMonthOf(ly) {
  for (const m of monthsOfLunarYear(ly)) if (m.leap) return m.month;
  return 0;
}

// --- 干支 / 生肖 --------------------------------------------------------
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
export const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

/** 干支 for a 农历 year. 1984 was 甲子, index 0. */
export function ganzhiYear(ly) {
  const i = ((ly - 1984) % 60 + 60) % 60;
  return { stem: STEMS[i % 10], branch: BRANCHES[i % 12], zodiac: ZODIAC[i % 12] };
}
