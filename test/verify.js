// verify.js -- anchors the computed calendar to facts that exist outside it.
//
// Run: node test/verify.js
//
// The astronomy in src/astro.js is only worth having if it is right, and
// "it looked right in October" is not a check. Three kinds of anchor here:
// published 春节 dates, published leap months (including 2033, the case that
// breaks naive implementations), and the four dates legible in the reference
// screenshots this project was briefed from.

import {
  toLunar, springFestivalDay, leapMonthOf, solarTermsForYear,
  fromDayNumber, cstDayNumber, ganzhiYear, LUNAR_MONTH_NAMES,
} from '../src/astro.js';

let pass = 0, fail = 0;
const failures = [];

function check(label, actual, expected) {
  if (String(actual) === String(expected)) { pass++; return; }
  fail++;
  failures.push(`${label}\n    expected ${expected}\n    actual   ${actual}`);
}

const iso = (dayNum) => {
  const { y, m, d } = fromDayNumber(dayNum);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// --- 1. 春节 (正月初一), published dates -------------------------------
const SPRING_FESTIVAL = {
  1990: '1990-01-27', 1991: '1991-02-15', 1992: '1992-02-04', 1993: '1993-01-23',
  1994: '1994-02-10', 1995: '1995-01-31', 1996: '1996-02-19', 1997: '1997-02-07',
  1998: '1998-01-28', 1999: '1999-02-16', 2000: '2000-02-05', 2001: '2001-01-24',
  2002: '2002-02-12', 2003: '2003-02-01', 2004: '2004-01-22', 2005: '2005-02-09',
  2006: '2006-01-29', 2007: '2007-02-18', 2008: '2008-02-07', 2009: '2009-01-26',
  2010: '2010-02-14', 2011: '2011-02-03', 2012: '2012-01-23', 2013: '2013-02-10',
  2014: '2014-01-31', 2015: '2015-02-19', 2016: '2016-02-08', 2017: '2017-01-28',
  2018: '2018-02-16', 2019: '2019-02-05', 2020: '2020-01-25', 2021: '2021-02-12',
  2022: '2022-02-01', 2023: '2023-01-22', 2024: '2024-02-10', 2025: '2025-01-29',
  2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13',
  2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11', 2033: '2033-01-31',
  2034: '2034-02-19', 2035: '2035-02-08',
};
for (const [y, want] of Object.entries(SPRING_FESTIVAL)) {
  check(`春节 ${y}`, iso(springFestivalDay(Number(y))), want);
}

// --- 2. leap months, published -----------------------------------------
// 2033 is the standard trap: the leap is 闰冬月 (month 11), and table-driven
// implementations that assume a leap never touches month 11 get it wrong.
const LEAP_MONTHS = {
  1990: 5, 1993: 3, 1995: 8, 1998: 5, 2001: 4, 2004: 2, 2006: 7, 2009: 5,
  2012: 4, 2014: 9, 2017: 6, 2020: 4, 2023: 2, 2025: 6, 2028: 5, 2031: 3,
  2033: 11, 2036: 6,
  // and a sample that must have none
  2024: 0, 2026: 0, 2027: 0, 2030: 0,
};
for (const [y, want] of Object.entries(LEAP_MONTHS)) {
  check(`闰月 ${y}`, leapMonthOf(Number(y)), want);
}

// --- 3. the reference screenshots this project was briefed from ---------
// Legible in Xnip2026-08-24_21-18-15.jpg and _21-27-31.jpg (bmcx.com).
const SCREENSHOT_LUNAR = {
  '2026-09-11': '八月初一',
  '2026-09-25': '八月十五',   // 中秋节
  '2026-10-10': '九月初一',
  '2026-10-18': '九月初九',   // 重阳节
  '2026-10-25': '九月十六',
};
for (const [date, want] of Object.entries(SCREENSHOT_LUNAR)) {
  const [y, m, d] = date.split('-').map(Number);
  const l = toLunar(y, m, d);
  check(`农历 ${date}`, l.monthName + l.dayName, want);
}

// --- 4. solar terms, from the same screenshots -------------------------
const SCREENSHOT_TERMS = {
  '2026-09-07': '白露', '2026-09-23': '秋分',
  '2026-10-08': '寒露', '2026-10-23': '霜降',
};
const terms2026 = new Map(solarTermsForYear(2026).map((t) => [iso(t.day), t.name]));
for (const [date, want] of Object.entries(SCREENSHOT_TERMS)) {
  check(`节气 ${date}`, terms2026.get(date), want);
}
check('2026 has 24 terms', solarTermsForYear(2026).length, 24);

// --- 4b. knife-edge cases, settled against JPL DE440s ------------------
// Every one of these is a boundary that lands within minutes of midnight in
// Beijing, where a lower-precision ephemeris tips to the wrong calendar day.
// They cost real debugging once; they are anchors now.
const KNIFE_EDGE_TERMS = {
  '2008-05-21': '小满',   // JPL 00:00:53 CST
  '2014-03-06': '惊蛰',   // JPL 00:02:15
  '2016-07-07': '小暑',   // JPL 00:03:22
  '2045-07-07': '小暑',   // JPL 00:08:10
  '2047-03-06': '惊蛰',   // JPL 00:05:24
  '2051-03-20': '春分',   // JPL 23:59:22 the previous evening
};
for (const [date, want] of Object.entries(KNIFE_EDGE_TERMS)) {
  const [y] = date.split('-').map(Number);
  const hit = solarTermsForYear(y).find((t) => iso(t.day) === date);
  check(`节气 knife-edge ${date}`, hit && hit.name, want);
}

// 2057-09-29 00:00:44 CST: the new moon that starts 九月 falls 44 seconds
// after midnight, so 八月 runs 30 days. Meeus plus the Espenak-Meeus delta-T
// put it at 23:59:58 the day before and shifted a whole month by one day.
{
  const l = toLunar(2057, 9, 28);
  check('2057-09-28 is 八月三十', l.monthName + l.dayName, '八月三十');
  const l2 = toLunar(2057, 9, 29);
  check('2057-09-29 is 九月初一', l2.monthName + l2.dayName, '九月初一');
}

// --- 5. structural invariants over a long span -------------------------
// Cheap, and they catch whole classes of arithmetic error at once.
for (let y = 1950; y <= 2100; y++) {
  const terms = solarTermsForYear(y);
  if (terms.length !== 24) {
    fail++; failures.push(`solar terms ${y}: got ${terms.length}, want 24`);
  } else pass++;

  const sf = springFestivalDay(y);
  const { m, d } = fromDayNumber(sf);
  // 春节 can only fall between Jan 21 and Feb 21.
  const inWindow = (m === 1 && d >= 21) || (m === 2 && d <= 21);
  if (!inWindow) {
    fail++; failures.push(`春节 ${y} outside Jan 21 - Feb 21: ${iso(sf)}`);
  } else pass++;
}

// Every day over 30 years must map to a lunar day of 1..30 in a 29/30-day
// month, and consecutive days must advance by exactly one lunar day.
{
  let prev = null, walkOk = true, lenOk = true;
  const start = cstDayNumber(2000, 1, 1), end = cstDayNumber(2030, 12, 31);
  for (let n = start; n <= end; n++) {
    const { y, m, d } = fromDayNumber(n);
    const l = toLunar(y, m, d);
    if (l.day < 1 || l.day > 30 || l.monthLength < 29 || l.monthLength > 30) {
      lenOk = false;
      failures.push(`bad lunar day at ${iso(n)}: day ${l.day} of ${l.monthLength}`);
      break;
    }
    if (prev) {
      const expectedDay = prev.day === prev.monthLength ? 1 : prev.day + 1;
      if (l.day !== expectedDay) {
        walkOk = false;
        failures.push(`lunar day jumped at ${iso(n)}: ${prev.day}/${prev.monthLength} -> ${l.day}`);
        break;
      }
    }
    prev = l;
  }
  lenOk ? pass++ : fail++;
  walkOk ? pass++ : fail++;
}

// --- 6. 干支 / 生肖 -----------------------------------------------------
check('2026 生肖', ganzhiYear(2026).zodiac, '马');
check('2026 干支', ganzhiYear(2026).stem + ganzhiYear(2026).branch, '丙午');
check('1984 干支', ganzhiYear(1984).stem + ganzhiYear(1984).branch, '甲子');
check('2024 生肖', ganzhiYear(2024).zodiac, '龙');

// --- report -------------------------------------------------------------
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures.slice(0, 25)) console.log('  FAIL  ' + f);
  if (failures.length > 25) console.log(`  ... and ${failures.length - 25} more`);
  process.exit(1);
}
console.log('  all anchors hold\n');
