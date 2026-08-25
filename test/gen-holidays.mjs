// gen-holidays.mjs -- refresh src/holidays.js from the published notices.
//
// Run: node test/gen-holidays.mjs [firstYear] [lastYear]
//
// The State Council publishes the next year's 节假日安排 around November. Until
// it does, that year has no schedule and this script writes none -- an empty
// year is the honest answer, and the UI says so rather than assuming every
// Monday is a workday.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = (y) =>
  `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`;

const here = dirname(fileURLToPath(import.meta.url));
const first = Number(process.argv[2] || 2015);
const last = Number(process.argv[3] || new Date().getUTCFullYear() + 1);

const years = {};
const papers = {};

for (let y = first; y <= last; y++) {
  process.stdout.write(`  ${y} ... `);
  let doc;
  try {
    const res = await fetch(SRC(y));
    if (!res.ok) { console.log(`skipped (HTTP ${res.status})`); continue; }
    doc = await res.json();
  } catch (err) {
    console.log(`skipped (${err.message})`);
    continue;
  }
  if (!doc.days || !doc.days.length) { console.log('no notice published yet'); continue; }
  years[y] = doc.days.map((d) => [d.date.slice(5), d.name, d.isOffDay ? 1 : 0]);
  if (doc.papers && doc.papers.length) papers[y] = doc.papers[0];
  console.log(`${doc.days.length} days`);
}

const covered = Object.keys(years).map(Number).sort((a, b) => a - b);
if (!covered.length) {
  console.error('nothing fetched; leaving src/holidays.js alone');
  process.exit(1);
}

const chunk = (rows) => {
  const cells = rows.map(([md, n, o]) => `['${md}','${n}',${o}]`);
  const lines = [];
  for (let i = 0; i < cells.length; i += 3) lines.push('    ' + cells.slice(i, i + 3).join(', ') + ',');
  return lines.join('\n');
};

const out = `// holidays.js -- GENERATED. Do not edit by hand.
//
// Regenerate:  node test/gen-holidays.mjs   (re-fetches from the source below)
// Source:      github.com/NateScarlet/holiday-cn, which transcribes the
//              State Council's annual 节假日安排 notice. Every year carries
//              the gov.cn document it came from, in HOLIDAY_PAPERS.
//
// These dates are policy, not astronomy: they are announced each year, they
// are not derivable, and a year with no notice yet published is absent here
// rather than guessed. 休 = a statutory day off; 班 = a Saturday or Sunday
// that the notice makes a working day to pay for one.
//
//   ['MM-DD', name, 1]  statutory day off (休)
//   ['MM-DD', name, 0]  makeup working day (班)

export const HOLIDAYS = {
${covered.map((y) => `  ${y}: [\n${chunk(years[y])}\n  ],`).join('\n')}
};

/** The gov.cn notice each year's schedule was transcribed from. */
export const HOLIDAY_PAPERS = {
${covered.filter((y) => papers[y]).map((y) => `  ${y}: '${papers[y]}',`).join('\n')}
};

/** Years with a published notice. Outside this, status is unknown, not 'workday'. */
export const HOLIDAY_YEARS = { from: ${covered[0]}, to: ${covered[covered.length - 1]} };
`;

const dest = join(here, '..', 'src', 'holidays.js');
writeFileSync(dest, out, 'utf8');
console.log(`\nwrote ${dest}  (${covered[0]}-${covered[covered.length - 1]})`);
