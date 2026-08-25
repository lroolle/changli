// verify-rules.mjs -- anchors for the solver and the Schengen counter.
//
// Run: node test/verify-rules.mjs
//
// Everything here has an answer computable by hand, which is the point: if the
// solver and a pencil disagree, the solver is wrong.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jurisdiction, overlap, fromISO, toISO, STATUS } from '../src/rules.js';
import { usageOn, maxStayFrom, nextWindow, timeline, inSchengen } from '../src/schengen.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (code) =>
  JSON.parse(readFileSync(join(here, '..', 'data', 'jurisdictions', `${code}.json`), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; return; }
  fail++;
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
};

// --- 1. CN: the 拼假 answer this whole project started from --------------
{
  const cn = jurisdiction(load('CN'));
  const from = fromISO('2026-08-01'), to = fromISO('2026-10-31');
  const s = cn.summarize(from, to);
  check('CN 2026 Aug-Oct total', s.total, 92);
  check('CN 2026 Aug-Oct rest days', s.off, 31);
  check('CN 2026 Aug-Oct makeup workdays', s.makeup, 2);

  const best = cn.bridges(from, to)[0];
  check('CN best bridge cost', best.cost, 3);
  check('CN best bridge length', best.length, 13);
  check('CN best bridge span', [best.from, best.to], ['2026-09-25', '2026-10-07']);
  check('CN best bridge burn days', best.burn,
    ['2026-09-28', '2026-09-29', '2026-09-30']);

  // 调休: 2026-09-20 is a Sunday the State Council made a working day.
  check('CN 2026-09-20 is a makeup workday', cn.statusOf(fromISO('2026-09-20')), STATUS.MAKEUP);
  check('CN 2026-10-01 is a holiday', cn.statusOf(fromISO('2026-10-01')), STATUS.HOLIDAY);
  check('CN 2026-10-01 holiday name', cn.dayInfo(fromISO('2026-10-01')).holiday, '国庆节');
}

// --- 2. regional granularity: the claim that no generic API makes --------
{
  const doc = load('DE');
  const by = jurisdiction(doc, 'DE-BY');   // Bayern
  const be = jurisdiction(doc, 'DE-BE');   // Berlin
  const epiphany = fromISO('2026-01-06');
  check('Heilige Drei Könige is a holiday in Bayern', by.statusOf(epiphany), STATUS.HOLIDAY);
  check('...and an ordinary Tuesday in Berlin', be.statusOf(epiphany), STATUS.WORKDAY);

  const frauentag = fromISO('2026-03-08');   // a Sunday in 2026
  check('Frauentag is listed in Berlin', be.dayInfo(frauentag).holiday, 'Internationaler Frauentag');
  check('Frauentag is not listed in Bayern', by.dayInfo(frauentag).holiday, null);
}

// --- 3. weekends are not always Saturday and Sunday ---------------------
// Egypt rests Friday and Saturday. Any engine that hardcodes Sat+Sun reports
// a working Sunday as a day off and a resting Friday as a workday -- wrong
// twice, every week, for a large part of the world.
{
  const eg = jurisdiction(load('EG'));
  check('EG weekend is Fri-Sat', eg.weekend, [5, 6]);
  // 2026-06-05 Fri, 06-06 Sat, 06-07 Sun -- none of them Egyptian holidays.
  check('EG Friday is a rest day', eg.statusOf(fromISO('2026-06-05')), STATUS.WEEKEND);
  check('EG Saturday is a rest day', eg.statusOf(fromISO('2026-06-06')), STATUS.WEEKEND);
  check('EG Sunday is a working day', eg.statusOf(fromISO('2026-06-07')), STATUS.WORKDAY);
  // and the same three days in Germany, for contrast
  const de = jurisdiction(load('DE'), 'DE-BE');
  check('DE Friday is a working day', de.statusOf(fromISO('2026-06-05')), STATUS.WORKDAY);
  check('DE Sunday is a rest day', de.statusOf(fromISO('2026-06-07')), STATUS.WEEKEND);
}

// --- 4. overlap: when is everyone free at once --------------------------
{
  const cn = jurisdiction(load('CN'));
  const de = jurisdiction(load('DE'), 'DE-BE');
  const o = overlap([cn, de], fromISO('2026-10-01'), fromISO('2026-10-07'));
  const oct1 = o.days.find((d) => d.date === '2026-10-01');
  check('2026-10-01 free in CN, working in DE', [oct1.freeIn, oct1.workingIn], [['CN'], ['DE']]);
  const oct3 = o.days.find((d) => d.date === '2026-10-03');   // a Saturday
  check('2026-10-03 free in both', oct3.allFree, true);
  // Oct 3-4 is the weekend both share; Oct 5 is a CN holiday but a German
  // Monday, so the shared run must END on the 4th, not on the day that broke it.
  check('shared free run is Oct 3-4', o.allFreeRuns, [['2026-10-03', '2026-10-04']]);
}

// --- 5. Schengen, counted by hand ---------------------------------------
{
  // 2026-01-01 .. 2026-03-31 is exactly 31 + 28 + 31 = 90 days.
  const stays = [{ from: '2026-01-01', to: '2026-03-31' }];

  check('90 days used on the last day', usageOn(stays, '2026-03-31').used, 90);
  check('...and nothing left', usageOn(stays, '2026-03-31').remaining, 0);
  check('...still compliant at exactly 90', usageOn(stays, '2026-03-31').compliant, true);

  // Entering fresh with no history: 90 days, last day 2026-03-31.
  const max = maxStayFrom([], '2026-01-01');
  check('a fresh 90-day stay', max.days, 90);
  check('...ends 2026-03-31', max.lastDay, '2026-03-31');
  check('...must leave by 2026-04-01', max.mustLeaveBy, '2026-04-01');

  // The window rolls. 2026-01-01 leaves the 180-day window on 2026-06-30
  // (Jan 1 + 180 days), which is the first day one day of budget returns.
  const back = nextWindow(stays, '2026-04-01', 1);
  check('first day of budget returns 2026-06-30', back.date, '2026-06-30');
  check('...and it is exactly one day', back.availableDays, 1);

  // Both travel days count in full: a same-day in-and-out is one day.
  check('a one-day trip costs one day',
    usageOn([{ from: '2026-05-05', to: '2026-05-05' }], '2026-05-05').used, 1);

  // Overlapping trips must not double-count.
  check('overlapping stays count once',
    usageOn([{ from: '2026-05-01', to: '2026-05-10' },
             { from: '2026-05-05', to: '2026-05-15' }], '2026-05-15').used, 15);

  // The rolling timeline must agree with the point query at every step.
  const tl = timeline(stays, '2026-03-01', '2026-07-31');
  let agree = true;
  for (const row of tl) {
    if (row.used !== usageOn(stays, row.date).used) { agree = false; break; }
  }
  check('rolling timeline matches point queries', agree, true);

  check('Ireland is EU but not Schengen', inSchengen('IE'), false);
  check('Switzerland is Schengen but not EU', inSchengen('CH'), true);
}

// --- 6. the corpus does not silently lie --------------------------------
{
  const index = JSON.parse(readFileSync(join(here, '..', 'data', 'jurisdictions', 'index.json'), 'utf8'));
  check('corpus has jurisdictions', index.length > 30, true);
  const withMakeup = index.filter((i) => i.makeupDays > 0).map((i) => i.code).sort();
  check('only CN and TW carry makeup workdays', withMakeup, ['CN', 'TW']);

  const cn = jurisdiction(load('CN'));
  // 2030 is beyond any published notice; the solver must say so, not guess.
  const s = cn.summarize(fromISO('2030-01-01'), fromISO('2030-12-31'));
  check('an unpublished year is reported as unknown', s.unknownYears.includes(2030), true);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL  ' + f);
  process.exit(1);
}
console.log('  solver and pencil agree\n');
