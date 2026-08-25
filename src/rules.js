// rules.js -- the solver. Deterministic, jurisdiction-aware, no model involved.
//
// This is the part that must never be a language model. "When is my flight"
// and "how many leave days does this cost" are exact questions with exact
// answers; an LLM would be slower, dearer, and wrong sometimes. The agent's
// job is to read intent and explain results. The arithmetic is here.
//
// Three things every other calendar gets wrong:
//
//   1. A weekend is not always Saturday and Sunday. Israel and much of the
//      Gulf rest on Friday and Saturday; Nepal rests on Saturday alone.
//   2. Some states turn a weekend into a working day. CN 调休 and TW 補班 are
//      real obligations, and an API that only lists holidays will tell you a
//      working Saturday is free.
//   3. A national holiday is often not national. Heilige Drei Könige is a
//      holiday in Bayern and a normal Tuesday in Berlin.
//
// A jurisdiction doc from data/jurisdictions/ carries all three.

const MS_DAY = 86400000;

export const STATUS = {
  HOLIDAY: 'holiday',   // a statutory day off
  MAKEUP: 'makeup',     // a weekend the state made a working day
  WEEKEND: 'weekend',   // an ordinary rest day for this jurisdiction
  WORKDAY: 'workday',
};

export const isRest = (s) => s === STATUS.HOLIDAY || s === STATUS.WEEKEND;

/** Civil date -> days since the Unix epoch. */
export const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / MS_DAY);

/** Days since epoch -> { y, m, d }. */
export function fromDayNumber(n) {
  const t = new Date(n * MS_DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const toISO = (n) => {
  const { y, m, d } = fromDayNumber(n);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return dayNumber(y, m, d);
};

/** ISO weekday, 1 = Monday .. 7 = Sunday. The epoch was a Thursday. */
export const weekdayOf = (n) => ((n + 3) % 7 + 7) % 7 + 1;

/**
 * Bind a jurisdiction document (optionally narrowed to a region) into a set
 * of queries. `region` is a subdivision code such as "DE-BY" or "US-CA";
 * holidays tagged with regions apply only to the ones listed.
 */
export function jurisdiction(doc, region = null) {
  const weekend = new Set(doc.weekend || [6, 7]);
  const byDay = new Map();

  for (const [year, days] of Object.entries(doc.years || {})) {
    for (const entry of days) {
      if (entry.r && region && !entry.r.includes(region)) continue;
      // A nationally-unspecified view keeps regional holidays but marks them,
      // so "is this a day off" stays answerable without a region chosen.
      const [mm, dd] = entry.d.split('-').map(Number);
      const n = dayNumber(Number(year), mm, dd);
      const prev = byDay.get(n);
      // A rest entry always wins over a work entry on the same date.
      if (!prev || (prev.t === 'work' && entry.t === 'rest')) {
        byDay.set(n, { ...entry, regional: !!entry.r });
      }
    }
  }

  const coverage = doc.coverage || { from: -Infinity, to: Infinity };
  const covers = (n) => {
    const { y } = fromDayNumber(n);
    return y >= coverage.from && y <= coverage.to;
  };

  function statusOf(n) {
    const hit = byDay.get(n);
    if (hit) return hit.t === 'rest' ? STATUS.HOLIDAY : STATUS.MAKEUP;
    return weekend.has(weekdayOf(n)) ? STATUS.WEEKEND : STATUS.WORKDAY;
  }

  function dayInfo(n) {
    const hit = byDay.get(n) || null;
    return {
      day: n,
      date: toISO(n),
      weekday: weekdayOf(n),
      status: statusOf(n),
      rest: isRest(statusOf(n)),
      holiday: hit ? hit.n : null,
      regional: hit ? hit.regional : false,
      known: covers(n),
    };
  }

  /** Maximal runs of consecutive rest days in [from, to]. */
  function restRuns(from, to) {
    const runs = [];
    let start = null;
    for (let n = from; n <= to; n++) {
      const rest = isRest(statusOf(n));
      if (rest && start === null) start = n;
      if (!rest && start !== null) { runs.push([start, n - 1]); start = null; }
    }
    if (start !== null) runs.push([start, to]);
    return runs.map(([a, b]) => ({
      from: a, to: b, length: b - a + 1,
      fromDate: toISO(a), toDate: toISO(b),
      name: namedIn(a, b),
      clipped: (a === from && isRest(statusOf(from - 1)))
        || (b === to && isRest(statusOf(to + 1))),
    }));
  }

  function namedIn(a, b) {
    for (let n = a; n <= b; n++) {
      const hit = byDay.get(n);
      if (hit && hit.t === 'rest') return hit.n;
    }
    return null;
  }

  /** What a span costs and buys. `leave` is the working days inside it. */
  function summarize(from, to) {
    let leave = 0, off = 0, statutory = 0, makeup = 0;
    for (let n = from; n <= to; n++) {
      const s = statusOf(n);
      if (s === STATUS.HOLIDAY) { off++; statutory++; }
      else if (s === STATUS.WEEKEND) off++;
      else { leave++; if (s === STATUS.MAKEUP) makeup++; }
    }
    const runs = restRuns(from, to);
    const longest = runs.reduce((a, r) => (r.length > (a?.length || 0) ? r : a), null);
    return {
      from: toISO(from), to: toISO(to),
      total: to - from + 1, leave, off, statutory, makeup,
      longestBreak: longest ? longest.length : 0,
      unknownYears: unknownYearsIn(from, to),
    };
  }

  function unknownYearsIn(from, to) {
    const out = [];
    for (let y = fromDayNumber(from).y; y <= fromDayNumber(to).y; y++) {
      if (y < coverage.from || y > coverage.to) out.push(y);
    }
    return out;
  }

  /**
   * 拼假. Gaps of working days short enough to be worth booking: burn the whole
   * gap and the rest runs on both sides weld into one break. Sorted by return
   * on leave -- days off per day burned -- which is what people actually optimise.
   */
  function bridges(from, to, maxLeave = 4) {
    const runs = restRuns(from, to);
    const out = [];
    for (let i = 0; i < runs.length - 1; i++) {
      const a = runs[i], b = runs[i + 1];
      const gapFrom = a.to + 1, gapTo = b.from - 1;
      const cost = gapTo - gapFrom + 1;
      if (cost < 1 || cost > maxLeave) continue;
      const left = reach(a.from, -1);
      const right = reach(b.to, +1);
      const burn = [];
      for (let n = gapFrom; n <= gapTo; n++) burn.push(toISO(n));
      out.push({
        cost, burn,
        from: toISO(left), to: toISO(right),
        length: right - left + 1,
        ratio: +((right - left + 1) / cost).toFixed(2),
        name: a.name || b.name || null,
      });
    }
    return out.sort((x, y) => y.ratio - x.ratio || x.cost - y.cost);
  }

  /** Walk while days stay free; 400 is a runaway stop, not a real limit. */
  function reach(n, dir) {
    let cur = n;
    for (let i = 0; i < 400; i++) {
      if (!isRest(statusOf(cur + dir))) break;
      cur += dir;
    }
    return cur;
  }

  /** The next statutory holiday at or after `from`. */
  function nextHoliday(from, limit = 400) {
    for (let n = from; n < from + limit; n++) {
      const hit = byDay.get(n);
      if (hit && hit.t === 'rest') {
        const run = restRuns(n, Math.min(n + 30, from + limit))[0];
        return { date: toISO(n), name: hit.n, in: n - from, run };
      }
    }
    return null;
  }

  return {
    code: doc.code,
    name: doc.name,
    weekend: [...weekend],
    regions: doc.regions || null,
    region,
    coverage,
    sources: doc.sources || [],
    statusOf, dayInfo, restRuns, summarize, bridges, nextHoliday,
  };
}

/**
 * Which jurisdiction is free when, across several at once. The question a
 * distributed team actually has: when can all of us take the same week off,
 * and who is already gone.
 */
export function overlap(jurisdictions, from, to) {
  const days = [];
  for (let n = from; n <= to; n++) {
    const free = jurisdictions.filter((j) => isRest(j.statusOf(n)));
    days.push({
      date: toISO(n),
      freeIn: free.map((j) => j.code),
      workingIn: jurisdictions.filter((j) => !isRest(j.statusOf(n))).map((j) => j.code),
      allFree: free.length === jurisdictions.length,
    });
  }
  // A run ends on the last all-free day, not on the day that broke it.
  const allFreeRuns = [];
  let start = null, last = null;
  for (const d of days) {
    if (d.allFree) { if (start === null) start = d.date; last = d.date; }
    else if (start !== null) { allFreeRuns.push([start, last]); start = null; }
  }
  if (start !== null) allFreeRuns.push([start, last]);
  return { days, allFreeRuns };
}
