// verify-marks.mjs -- anchors for the run algebra and the exported file.
//
// Run: node test/verify-marks.mjs
//
// Two things are worth this much testing. The run algebra is where a day goes
// missing at a boundary, silently, and only shows up as a vacation one day
// short. The ICS is a contract with software we cannot debug -- Google and
// Apple accept or drop the file with no error the reader will ever see -- so
// the exclusive DTEND, the octet fold and the CRLF are checked as bytes.

import {
  normalize, addRun, subtractRun, toggleRun, runsContain, totalDays, runLength,
  putMark, putMarks, clearMarks, markIndex, totals, marksWithin,
  loadMarks, saveMarks, STORE_KEY, LABELS, labelName,
} from '../src/marks.js';
import {
  icsDate, escapeText, foldLine, vevent, calendarDoc,
  icsFromMarks, icsFromStatutory, icsFromSky,
} from '../src/ics.js';
import { cstDayNumber, dayInfo, STATUS } from '../src/calendar.js';

let pass = 0, fail = 0;
const failures = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; return; }
  fail++;
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
};

const D = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return cstDayNumber(y, m, d);
};
const STAMP = '20260916T000000Z';

// --- 1. run algebra: the boundaries, by hand ----------------------------
{
  const a = { from: D('2026-09-28'), to: D('2026-09-30') };
  const b = { from: D('2026-10-01'), to: D('2026-10-07') };

  // Touching runs are one run: dragging twice to say one vacation is one thing.
  const merged = normalize([b, a]);
  check('touching runs merge', merged.length, 1);
  check('...over the whole span', totalDays(merged), 10);

  // A one-day gap is two runs. This is the case that must not merge.
  const gapped = normalize([a, { from: D('2026-10-02'), to: D('2026-10-07') }]);
  check('a one-day gap stays two runs', gapped.length, 2);

  check('runLength counts both ends', runLength(a), 3);
  check('runsContain hits the last day', runsContain([a], D('2026-09-30')), true);
  check('runsContain misses the day after', runsContain([a], D('2026-10-01')), false);

  // A cut through the middle leaves two runs and loses exactly the cut.
  const cut = subtractRun([{ from: D('2026-10-01'), to: D('2026-10-07') }],
    D('2026-10-03'), D('2026-10-04'));
  check('a middle cut leaves two runs', cut.length, 2);
  check('...left half ends the day before', cut[0].to, D('2026-10-02'));
  check('...right half starts the day after', cut[1].from, D('2026-10-05'));
  check('...and exactly two days are gone', totalDays(cut), 5);

  // Trimming an edge must not eat the neighbour day.
  const trimmed = subtractRun([a], a.from, a.from);
  check('trimming the first day keeps the rest', [trimmed[0].from, trimmed[0].to],
    [D('2026-09-29'), D('2026-09-30')]);

  // A cut that misses entirely changes nothing.
  check('a disjoint cut is a no-op', subtractRun([a], D('2026-11-01'), D('2026-11-02')), [a]);

  // toggle: fully covered removes, partially covered adds.
  check('toggle removes a covered run', toggleRun([a], a.from, a.to), []);
  check('toggle adds a partly covered run',
    totalDays(toggleRun([a], D('2026-09-29'), D('2026-10-02'))), 5);

  // Zero-width and inverted runs are dropped, not stored as negatives.
  check('an inverted run is dropped', normalize([{ from: 10, to: 5 }]), []);
}

// --- 2. marks: one day carries exactly one label ------------------------
{
  const annual = { from: D('2026-10-08'), to: D('2026-10-12'), label: 'annual' };
  let marks = putMark([], annual);
  check('a mark is stored as one run', marks.length, 1);

  // Writing over the middle replaces those days and splits the old mark.
  marks = putMark(marks, { from: D('2026-10-10'), to: D('2026-10-10'), label: 'sick' });
  check('an overwrite splits the run', marks.length, 3);
  check('...and no day is counted twice', totalDays(marks), 5);
  const idx = markIndex(marks);
  check('the overwritten day carries the new label', idx.get(D('2026-10-10')).label, 'sick');
  check('the day before keeps the old one', idx.get(D('2026-10-09')).label, 'annual');

  // Same-label neighbours merge; different labels never do.
  let two = putMark([], { from: D('2026-11-02'), to: D('2026-11-03'), label: 'annual' });
  two = putMark(two, { from: D('2026-11-04'), to: D('2026-11-05'), label: 'annual' });
  check('touching marks with one label merge', two.length, 1);
  two = putMark(two, { from: D('2026-11-06'), to: D('2026-11-06'), label: 'travel' });
  check('a different label does not merge', two.length, 2);

  // A note is part of identity: two 纪念 runs with different notes stay apart.
  let noted = putMark([], { from: D('2026-12-01'), to: D('2026-12-01'), label: 'event', note: '入职' });
  noted = putMark(noted, { from: D('2026-12-02'), to: D('2026-12-02'), label: 'event', note: '生日' });
  check('different notes do not merge', noted.length, 2);
  check('labelName prefers the note', labelName(noted[0]), '入职');
  check('labelName falls back to the label', labelName({ label: 'annual' }), '年假');

  // One selection, several runs, one act.
  const many = putMarks([], [
    { from: D('2027-01-01'), to: D('2027-01-03') },
    { from: D('2027-02-01'), to: D('2027-02-02') },
  ], { label: 'annual' });
  check('one label over several runs', many.length, 2);
  check('...totals both', totals(many)[0].days, 5);
  check('totals reports runs too', totals(many)[0].runs, 2);
  check('unused labels are not reported', totals(many).length, 1);

  check('clearing removes the days', totalDays(clearMarks(many, D('2027-01-01'), D('2027-01-03'))), 2);
  check('marksWithin clips to the window',
    marksWithin(many, D('2027-01-02'), D('2027-01-31'))[0],
    { from: D('2027-01-02'), to: D('2027-01-03'), label: 'annual', note: '' });
}

// --- 3. persistence refuses anything it did not write -------------------
{
  const store = (() => {
    let v = null;
    return { getItem: () => v, setItem: (_k, val) => { v = val; } };
  })();

  const marks = putMark([], { from: D('2026-10-01'), to: D('2026-10-03'), label: 'annual' });
  check('save reports success', saveMarks(store, marks), true);
  check('round-trip is identical', loadMarks(store), marks);

  const bad = (json) => loadMarks({ getItem: () => json });
  check('garbage yields no marks', bad('not json'), []);
  check('a bare object yields no marks', bad('{"from":1}'), []);
  check('an unknown label is dropped', bad('[{"from":1,"to":2,"label":"vacation"}]'), []);
  check('a non-integer day is dropped', bad('[{"from":1.5,"to":2,"label":"annual"}]'), []);
  check('an inverted mark is dropped', bad('[{"from":9,"to":2,"label":"annual"}]'), []);
  check('empty storage yields no marks', loadMarks({ getItem: () => null }), []);
  // localStorage throws on read in some private modes; the calendar must live.
  check('a throwing store yields no marks',
    loadMarks({ getItem: () => { throw new Error('denied'); } }), []);
  check('a throwing store fails the save honestly',
    saveMarks({ setItem: () => { throw new Error('quota'); } }, marks), false);
  check('the key is versioned', STORE_KEY, 'changli-marks-v1');
}

// --- 4. the ICS primitives, as bytes ------------------------------------
{
  check('a day number becomes a DATE', icsDate(D('2026-10-01')), '20261001');
  check('escaping does backslash first', escapeText('a\\b;c,d'), 'a\\\\b\\;c\\,d');
  check('newlines become \\n', escapeText('a\nb'), 'a\\nb');

  // Folding is measured in octets. A line of 30 CJK characters is 90 octets
  // and must fold; folding by character would not have.
  const cjk = 'SUMMARY:' + '春'.repeat(30);
  const folded = foldLine(cjk);
  check('a 98-octet CJK line folds', folded.includes('\r\n '), true);
  const enc = new TextEncoder();
  check('...every physical line fits in 75 octets',
    folded.split('\r\n').every((l) => enc.encode(l).length <= 75), true);
  check('...and unfolding restores the original',
    folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), cjk);
  check('a short line is left alone', foldLine('UID:x'), 'UID:x');

  // DTEND is exclusive: a 7-day holiday ends on the 8th.
  const ev = vevent({
    uid: 'u@test', from: D('2026-10-01'), to: D('2026-10-07'),
    summary: '国庆节', stamp: STAMP,
  }).join('\r\n');
  check('DTSTART is the first day', ev.includes('DTSTART;VALUE=DATE:20261001'), true);
  check('DTEND is the day after the last', ev.includes('DTEND;VALUE=DATE:20261008'), true);
  check('information does not block availability', ev.includes('TRANSP:TRANSPARENT'), true);
  check('booked leave does', vevent({
    uid: 'u@test', from: D('2026-10-01'), to: D('2026-10-01'),
    summary: '年假', stamp: STAMP, busy: true,
  }).join('\r\n').includes('TRANSP:OPAQUE'), true);

  const doc = calendarDoc({ name: 'n', description: 'd', events: ev.split('\r\n') });
  check('every line ends CRLF', doc.split('\r\n').length - 1, doc.split('\n').length - 1);
  check('the document ends with CRLF', doc.endsWith('\r\n'), true);
  check('no bare LF survives', /[^\r]\n/.test(doc), false);
  check('it opens and closes', [doc.startsWith('BEGIN:VCALENDAR'), doc.trimEnd().endsWith('END:VCALENDAR')], [true, true]);
  check('a subscriber is told to refresh', doc.includes('REFRESH-INTERVAL;VALUE=DURATION:P1D'), true);
}

// --- 5. the three calendars carry the real dates ------------------------
{
  // The 拼假 answer from the README, exported: 9月28日 leave through 10月7日.
  const marks = putMark([], { from: D('2026-09-28'), to: D('2026-10-07'), label: 'annual' });
  const ics = icsFromMarks(marks, { stamp: STAMP });
  check('a mark exports one event', ics.match(/BEGIN:VEVENT/g).length, 1);
  check('...starting the day leave starts', ics.includes('DTSTART;VALUE=DATE:20260928'), true);
  check('...ending the day after it ends', ics.includes('DTEND;VALUE=DATE:20261008'), true);
  check('...named by its label', ics.includes('SUMMARY:年假'), true);
  check('...and it says what the run cost', ics.includes('共 10 天'), true);
  check('a mark UID is stable across exports',
    icsFromMarks(marks, { stamp: '20270101T000000Z' }).includes(
      ics.match(/UID:(.+)\r\n/)[1]), true);

  // The statutory feed, for a year the notice covers.
  const gov = icsFromStatutory(2026, 2026, { stamp: STAMP });
  check('the statutory feed has events', gov.match(/BEGIN:VEVENT/g).length > 8, true);
  check('国庆 appears as a named run', /SUMMARY:国庆节 · 休 \d 天/.test(gov), true);
  check('the 2026-09-20 makeup Sunday is in it', gov.includes('DTSTART;VALUE=DATE:20260920'), true);
  check('...as 调休上班', gov.includes('SUMMARY:调休上班'), true);
  check('a published holiday does not block availability', gov.includes('TRANSP:OPAQUE'), false);
  // Every makeup day the engine knows is exported, none invented.
  let makeups = 0;
  for (let n = D('2026-01-01'); n <= D('2026-12-31'); n++) {
    if (dayInfo(n).status === STATUS.MAKEUP) makeups++;
  }
  check('every makeup day is exported', gov.match(/SUMMARY:调休上班/g).length, makeups);

  // The sky feed: 24 terms a year, always.
  const sky = icsFromSky(2026, 2026, { stamp: STAMP });
  check('all 24 terms are in the sky feed',
    ['立春', '春分', '夏至', '秋分', '冬至', '大寒'].every((t) => sky.includes(t)), true);
  check('the sky feed carries the lunar date', sky.includes('DESCRIPTION:农历'), true);
  check('the two truths stay in separate files', sky.includes('调休上班'), false);
}

// --- 6. the labels are a closed set -------------------------------------
{
  check('six built-in labels', LABELS.length, 6);
  check('every label has a kind', LABELS.every((l) => ['leave', 'work', 'note'].includes(l.kind)), true);
  check('keys are unique', new Set(LABELS.map((l) => l.key)).size, LABELS.length);
  check('names are short enough for a cell', LABELS.every((l) => l.name.length <= 2), true);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL  ' + f);
  process.exit(1);
}
console.log('  marks hold their edges, and the file says what it means\n');
