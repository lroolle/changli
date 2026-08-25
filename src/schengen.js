// schengen.js -- the 90/180 rule, counted the way a border guard counts it.
//
// The rule: on any given day you may not have spent more than 90 days inside
// the Schengen area during the preceding 180 days, that day included. It is a
// *rolling* window, not an allowance that resets on a date, and that is what
// almost everyone gets wrong -- including people who lose a flight over it.
//
// Two more details people get wrong:
//   - the day you arrive and the day you leave BOTH count, in full
//   - the window is 180 days back from the day being tested, so your budget
//     recovers gradually, one day at a time, as old stays fall out the back
//
// Deterministic, exact, and unit-testable. See test/verify-rules.mjs.

import { dayNumber, fromDayNumber, toISO, fromISO } from './rules.js';

export const SCHENGEN_LIMIT = 90;
export const SCHENGEN_WINDOW = 180;

/**
 * The 27 Schengen states (2026). Not the same set as the EU: Ireland is in the
 * EU and outside Schengen; Switzerland, Norway, Iceland and Liechtenstein are
 * in Schengen and outside the EU. Confusing the two is the other classic error.
 */
export const SCHENGEN_STATES = [
  'AT', 'BE', 'BG', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HR', 'HU', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SE', 'SI', 'SK',
];

export const inSchengen = (code) => SCHENGEN_STATES.includes(String(code).toUpperCase());

/** Normalise [{from,to,where?}] (ISO strings or day numbers) to day numbers. */
function normalise(stays) {
  return stays
    .map((s) => {
      const from = typeof s.from === 'number' ? s.from : fromISO(s.from);
      const to = typeof s.to === 'number' ? s.to : fromISO(s.to ?? s.from);
      if (to < from) throw new Error(`stay ends before it starts: ${toISO(from)} .. ${toISO(to)}`);
      return { from, to, where: s.where || null };
    })
    .sort((a, b) => a.from - b.from);
}

/** Every day inside the stays, deduplicated (overlapping trips count once). */
function occupiedDays(stays) {
  const set = new Set();
  for (const s of stays) for (let n = s.from; n <= s.to; n++) set.add(n);
  return set;
}

/**
 * Days used in the 180-day window ending on `on` (inclusive).
 * Returns { used, remaining, window: {from, to}, compliant }.
 */
export function usageOn(stays, on) {
  const day = typeof on === 'number' ? on : fromISO(on);
  const occupied = occupiedDays(normalise(stays));
  const windowFrom = day - SCHENGEN_WINDOW + 1;
  let used = 0;
  for (let n = windowFrom; n <= day; n++) if (occupied.has(n)) used++;
  return {
    date: toISO(day),
    used,
    remaining: Math.max(0, SCHENGEN_LIMIT - used),
    limit: SCHENGEN_LIMIT,
    window: { from: toISO(windowFrom), to: toISO(day) },
    compliant: used <= SCHENGEN_LIMIT,
  };
}

/** Day-by-day usage across a range -- what the calendar layer draws. */
export function timeline(stays, from, to) {
  const a = typeof from === 'number' ? from : fromISO(from);
  const b = typeof to === 'number' ? to : fromISO(to);
  const occupied = occupiedDays(normalise(stays));
  const out = [];
  // Rolling count instead of re-summing 180 days per day.
  let used = 0;
  for (let n = a - SCHENGEN_WINDOW + 1; n < a; n++) if (occupied.has(n)) used++;
  for (let n = a; n <= b; n++) {
    if (occupied.has(n)) used++;
    const dropped = n - SCHENGEN_WINDOW;
    if (occupied.has(dropped)) used--;
    out.push({
      date: toISO(n),
      inside: occupied.has(n),
      used,
      remaining: Math.max(0, SCHENGEN_LIMIT - used),
      compliant: used <= SCHENGEN_LIMIT,
    });
  }
  return out;
}

/**
 * If you entered on `start` and stayed continuously, how many days could you
 * stay before breaching? Returns the last compliant day and the count.
 */
export function maxStayFrom(stays, start, lookahead = 400) {
  const from = typeof start === 'number' ? start : fromISO(start);
  const base = normalise(stays);
  const occupied = occupiedDays(base);
  let used = 0;
  for (let n = from - SCHENGEN_WINDOW + 1; n < from; n++) if (occupied.has(n)) used++;

  let days = 0;
  for (let n = from; n < from + lookahead; n++) {
    // this candidate day is spent inside
    let next = used + 1;
    const dropped = n - SCHENGEN_WINDOW;
    if (occupied.has(dropped)) next--;
    if (next > SCHENGEN_LIMIT) break;
    used = next;
    days++;
  }
  return {
    from: toISO(from),
    days,
    lastDay: days ? toISO(from + days - 1) : null,
    mustLeaveBy: toISO(from + days),
  };
}

/**
 * The soonest day on or after `from` when you would have at least `want` days
 * of budget available. This is the "when can I come back" answer.
 */
export function nextWindow(stays, from, want = 1, lookahead = 400) {
  const a = typeof from === 'number' ? from : fromISO(from);
  const occupied = occupiedDays(normalise(stays));
  let used = 0;
  for (let n = a - SCHENGEN_WINDOW + 1; n <= a; n++) if (occupied.has(n)) used++;
  for (let n = a; n < a + lookahead; n++) {
    if (n > a) {
      if (occupied.has(n)) used++;
      const dropped = n - SCHENGEN_WINDOW;
      if (occupied.has(dropped)) used--;
    }
    if (SCHENGEN_LIMIT - used >= want) {
      return { date: toISO(n), in: n - a, availableDays: SCHENGEN_LIMIT - used };
    }
  }
  return null;
}

/** A whole-picture answer for an agent or a panel. */
export function report(stays, on) {
  const day = typeof on === 'number' ? on : fromISO(on);
  const now = usageOn(stays, day);
  const norm = normalise(stays);
  const totalTrips = norm.length;
  const future = norm.filter((s) => s.from > day);
  return {
    ...now,
    trips: totalTrips,
    plannedAhead: future.length,
    maxStayIfEnteringToday: maxStayFrom(stays, day),
    nextTimeYouHave: {
      any: nextWindow(stays, day, 1),
      aWeek: nextWindow(stays, day, 7),
      aMonth: nextWindow(stays, day, 30),
    },
    note: 'Arrival and departure days both count in full. The 180-day window '
      + 'rolls: budget returns one day at a time as old stays age out.',
  };
}
