// gen-ics.mjs -- the subscribable feeds, written to feed/.
//
// Run: node test/gen-ics.mjs
//
// Exporting a file is a copy: it is right once and then drifts. A subscription
// is a URL the calendar app re-reads on its own, which is the only way 2027's
// 调休 reaches someone who subscribed in 2026. That needs a served file, so it
// is generated here and committed, the same way src/ephemeris.js and
// src/holidays.js are -- no build step, and the diff is reviewable.
//
// Two feeds, because DESIGN.md keeps two kinds of truth apart: policy is
// published one year at a time and can change, astronomy is computed and will
// not. A reader can subscribe to the part that cannot change without taking on
// the part that can.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HOLIDAY_YEARS } from '../src/holidays.js';
import { icsFromStatutory, icsFromSky } from '../src/ics.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'feed');

// Pinned, not `new Date()`: with a wall-clock stamp every regeneration rewrites
// every event and the diff says nothing. Bump this when the source data moves.
const DATA_STAMP = '20260101T000000Z';

// The sky is computed, so the window is a choice: far enough ahead that a
// subscriber never runs out, near enough that the file stays small.
const SKY_FROM = 2024;
const SKY_TO = 2035;

const govFrom = HOLIDAY_YEARS.from;
const govTo = HOLIDAY_YEARS.to;

mkdirSync(out, { recursive: true });

const gov = icsFromStatutory(govFrom, govTo, { stamp: DATA_STAMP });
writeFileSync(join(out, 'cn-holidays.ics'), gov);

const sky = icsFromSky(SKY_FROM, SKY_TO, { stamp: DATA_STAMP });
writeFileSync(join(out, 'cn-terms.ics'), sky);

const count = (s) => (s.match(/BEGIN:VEVENT/g) || []).length;
const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1);

console.log(`\n  feed/cn-holidays.ics  ${govFrom}–${govTo}  ${count(gov)} events  ${kb(gov)} KB`);
console.log(`  feed/cn-terms.ics     ${SKY_FROM}–${SKY_TO}  ${count(sky)} events  ${kb(sky)} KB\n`);
console.log('  subscribe with webcal://<host>/feed/cn-holidays.ics\n');
