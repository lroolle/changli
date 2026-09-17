// ics.js -- the file Google Calendar and Apple Calendar can actually read.
//
// RFC 5545, and the three details that decide whether a calendar app accepts a
// file or silently drops half of it:
//
//   1. All-day events are DATE values, and DTEND is *exclusive*. A holiday
//      running 10月1日—10月7日 ends on the 8th. Off by one here and every
//      exported vacation is a day short, which is exactly the class of bug
//      this project exists to stop.
//   2. Lines fold at 75 octets, not 75 characters. 春节 is three octets a
//      character; folding by character splits a codepoint down the middle and
//      the importer shows mojibake or refuses the file.
//   3. CRLF, everywhere, including the last line.
//
// Pure text in, pure text out -- no DOM, so the tests can read what ships.

import { fromDayNumber } from './astro.js';
import { dayInfo, restRuns, summarize, cstDayNumber, STATUS } from './calendar.js';
import { labelName, runLength } from './marks.js';

const CRLF = '\r\n';
const DOMAIN = 'changli.claw-lab.com';

const pad2 = (n) => String(n).padStart(2, '0');

/** A day number as an iCalendar DATE. */
export function icsDate(dayNum) {
  const { y, m, d } = fromDayNumber(dayNum);
  return `${y}${pad2(m)}${pad2(d)}`;
}

/** TEXT escaping: backslash first, or it escapes the escapes. */
export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold one content line to 75 octets, continuing with a single leading space.
 *
 * Measured in UTF-8 octets and cut on a character boundary: a CJK calendar
 * folds mid-word constantly, and a byte-blind fold corrupts the file.
 */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;                       // continuation lines lose one to the space
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = ch;
      curBytes = n;
      limit = 74;
    } else {
      cur += ch;
      curBytes += n;
    }
  }
  out.push(cur);
  return out[0] + out.slice(1).map((s) => CRLF + ' ' + s).join('');
}

const line = (key, value) => foldLine(`${key}:${value}`);

/** A UTC timestamp for DTSTAMP. Injectable so a test can pin it. */
export function stampNow(date = new Date()) {
  const p = (n) => pad2(n);
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
    + `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

/**
 * One all-day VEVENT.
 *
 * `busy` decides TRANSP. Leave you booked is time you cannot be scheduled
 * over; a published holiday or a 节气 is information and must not black out
 * the reader's availability to everyone who can see their calendar.
 */
export function vevent({ uid, from, to, summary, description = '', stamp, busy = false, categories = '' }) {
  const rows = [
    'BEGIN:VEVENT',
    line('UID', uid),
    line('DTSTAMP', stamp),
    line('DTSTART;VALUE=DATE', icsDate(from)),
    line('DTEND;VALUE=DATE', icsDate(to + 1)),   // exclusive
    line('SUMMARY', escapeText(summary)),
  ];
  if (description) rows.push(line('DESCRIPTION', escapeText(description)));
  if (categories) rows.push(line('CATEGORIES', escapeText(categories)));
  rows.push(line('TRANSP', busy ? 'OPAQUE' : 'TRANSPARENT'));
  rows.push('END:VEVENT');
  return rows;
}

/**
 * Wrap events in a VCALENDAR.
 *
 * X-WR-CALNAME is what Google and Apple actually show in the sidebar; without
 * it a subscribed feed is called by its URL. REFRESH-INTERVAL and
 * X-PUBLISHED-TTL are the two spellings of "check daily" that the two vendors
 * read -- a subscription that never refreshes is not a subscription.
 */
export function calendarDoc({ name, description, events, ttl = 'P1D' }) {
  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    line('PRODID', `-//changli//长历 ${DOMAIN}//CN`),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    line('X-WR-CALNAME', escapeText(name)),
    line('X-WR-CALDESC', escapeText(description)),
    'X-WR-TIMEZONE:Asia/Shanghai',
    line('REFRESH-INTERVAL;VALUE=DURATION', ttl),
    line('X-PUBLISHED-TTL', ttl),
    ...events,
    'END:VCALENDAR',
  ];
  return rows.join(CRLF) + CRLF;
}

// --- the three calendars ------------------------------------------------

/**
 * What the reader marked. One event per run, and the description carries what
 * the run cost -- the number a planner wants when the event resurfaces in
 * their work calendar three months later.
 */
export function icsFromMarks(marks, { stamp = stampNow() } = {}) {
  const events = marks.flatMap((m) => {
    const s = summarize(m.from, m.to);
    const parts = [
      `共 ${runLength(m)} 天`,
      `需请假 ${s.leave} 天`,
      `其中法定假 ${s.statutory} 天`,
    ];
    return vevent({
      uid: `mark-${m.from}-${m.to}-${m.label}@${DOMAIN}`,
      from: m.from,
      to: m.to,
      summary: labelName(m),
      description: `长历 · ${parts.join(' · ')}`,
      categories: '长历标记',
      stamp,
      busy: true,
    });
  });
  return calendarDoc({
    name: '长历 · 我的标记',
    description: '在长历上标记的假期与日程。导出于本机，不会自动更新。',
    events,
  });
}

/**
 * The statutory year: every run of consecutive days off the notice creates,
 * and every 班 day it takes back.
 *
 * Runs come from the same engine the grid draws, so the feed says 连休 7 天
 * when the reader actually gets seven days -- not "国庆节 10月1日—3日" plus a
 * weekend the importer cannot see. Unnamed runs (a plain weekend) are left
 * out: a subscriber knows where Saturday is.
 */
export function icsFromStatutory(fromYear, toYear, { stamp = stampNow() } = {}) {
  const from = cstDayNumber(fromYear, 1, 1);
  const to = cstDayNumber(toYear + 1, 1, 1) - 1;
  const events = [];

  for (const run of restRuns(from, to)) {
    if (!run.name) continue;
    events.push(...vevent({
      uid: `rest-${run.from}-${run.to}@${DOMAIN}`,
      from: run.from,
      to: run.to,
      summary: `${run.name} · 休 ${run.length} 天`,
      description: '国务院办公厅节假日安排。长历 changli.claw-lab.com',
      categories: '法定假日',
      stamp,
    }));
  }

  for (let n = from; n <= to; n++) {
    const info = dayInfo(n);
    if (info.status !== STATUS.MAKEUP) continue;
    events.push(...vevent({
      uid: `makeup-${n}@${DOMAIN}`,
      from: n,
      to: n,
      summary: `调休上班${info.holidayName ? ` · ${info.holidayName}` : ''}`,
      description: '按国务院通知，这个周末需要上班。长历 changli.claw-lab.com',
      categories: '调休',
      stamp,
    }));
  }
  return calendarDoc({
    name: '中国法定节假日 · 长历',
    description: '休与班，逐年依据国务院办公厅通知。changli.claw-lab.com',
    events,
  });
}

/**
 * The sky: 24 节气 and the traditional festivals.
 *
 * Kept apart from the statutory feed on purpose -- DESIGN.md's two kinds of
 * truth. Astronomy is computed and stable for two centuries; policy is
 * published one year at a time. A reader should be able to subscribe to the
 * part that cannot change without also subscribing to the part that can.
 */
export function icsFromSky(fromYear, toYear, { stamp = stampNow() } = {}) {
  const from = cstDayNumber(fromYear, 1, 1);
  const to = cstDayNumber(toYear + 1, 1, 1) - 1;
  const events = [];
  for (let n = from; n <= to; n++) {
    const info = dayInfo(n);
    const names = [];
    if (info.term) names.push(info.term.name);
    for (const f of info.festivals) if (!names.includes(f)) names.push(f);
    if (!names.length) continue;
    events.push(...vevent({
      uid: `sky-${n}@${DOMAIN}`,
      from: n,
      to: n,
      summary: names.join(' · '),
      description: `农历${info.lunar.monthName}${info.lunar.dayName}。节气由 JPL DE440s 推算。`,
      categories: '节气与传统节日',
      stamp,
    }));
  }
  return calendarDoc({
    name: '节气与传统节日 · 长历',
    description: '24 节气与传统节日，农历由 JPL DE440s 星历推算。changli.claw-lab.com',
    events,
  });
}
