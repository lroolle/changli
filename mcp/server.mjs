#!/usr/bin/env node
// server.mjs -- changli as an MCP server. Zero dependencies.
//
// This is what "agentic native" should mean: not a chat box bolted onto a
// month grid, but the rules engine exposed over a protocol so *any* agent can
// ask real questions and get exact answers.
//
// The answers here are computed by a deterministic solver (src/rules.js), not
// generated. An agent asking "how many leave days does this cost" gets
// arithmetic, not a guess.
//
// Wire it up:
//   claude mcp add changli -- node /abs/path/to/changli/mcp/server.mjs
//
// Transport is newline-delimited JSON-RPC 2.0 over stdio. Nothing may be
// written to stdout except protocol frames -- logs go to stderr.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jurisdiction, overlap, fromISO, toISO, dayNumber } from '../src/rules.js';
import { report as schengenReport, timeline as schengenTimeline, inSchengen } from '../src/schengen.js';
import { dayInfo as cnDayInfo, termContext, ganzhiYear } from '../src/calendar.js';
import { cstDayNumber } from '../src/astro.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'data', 'jurisdictions');

const NAME = 'changli';
const VERSION = '1.0.0';
const PROTOCOL = '2025-06-18';

// --- corpus --------------------------------------------------------------
const cache = new Map();
function load(code) {
  const key = String(code || '').toUpperCase();
  if (cache.has(key)) return cache.get(key);
  let doc;
  try { doc = JSON.parse(readFileSync(join(DATA, `${key}.json`), 'utf8')); }
  catch { throw new Error(`unknown jurisdiction "${code}". Call list_jurisdictions.`); }
  cache.set(key, doc);
  return doc;
}
const bind = (code, region) => jurisdiction(load(code), region || null);
const index = () => JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'));

// --- tools ---------------------------------------------------------------
const S = {
  jurisdiction: { type: 'string', description: 'ISO country code, e.g. CN, DE, US, TW' },
  region: { type: 'string', description: 'Optional subdivision, e.g. DE-BY, US-CA, ES-CT. Regional holidays only apply to the region given.' },
  date: { type: 'string', description: 'ISO date, YYYY-MM-DD' },
};

const TOOLS = [
  {
    name: 'list_jurisdictions',
    description: 'List every jurisdiction in the corpus with its weekend rule, year coverage, region count, and whether it has makeup workdays (调休 / 補班). Start here.',
    inputSchema: { type: 'object', properties: {} },
    run: () => index(),
  },
  {
    name: 'day_info',
    description: 'What one date actually is in one jurisdiction: holiday, makeup workday, weekend or workday, plus the holiday name. For CN it also returns the lunar date, solar term and 干支.',
    inputSchema: {
      type: 'object',
      required: ['jurisdiction', 'date'],
      properties: { jurisdiction: S.jurisdiction, region: S.region, date: S.date },
    },
    run: ({ jurisdiction: code, region, date }) => {
      const j = bind(code, region);
      const info = j.dayInfo(fromISO(date));
      if (String(code).toUpperCase() !== 'CN') return info;
      const [y, m, d] = date.split('-').map(Number);
      const n = cstDayNumber(y, m, d);
      const cn = cnDayInfo(n);
      const tc = termContext(n);
      return {
        ...info,
        lunar: `${cn.lunar.monthName}${cn.lunar.dayName}`,
        lunarYear: cn.lunar.year,
        leapMonth: cn.lunar.leap,
        solarTerm: cn.term ? cn.term.name : null,
        termContext: tc.current
          ? `${tc.current.name} day ${tc.current.nth}${tc.next ? `, ${tc.next.inDays} days to ${tc.next.name}` : ''}`
          : null,
        festivals: cn.festivals,
        ganzhi: (() => { const g = ganzhiYear(cn.lunar.year); return `${g.stem}${g.branch} (${g.zodiac})`; })(),
      };
    },
  },
  {
    name: 'plan_leave',
    description: 'The 拼假 question: which days of leave to book for the longest continuous break. Returns bridges sorted by return on leave (days off per day burned), each with the exact dates to request.',
    inputSchema: {
      type: 'object',
      required: ['jurisdiction', 'from', 'to'],
      properties: {
        jurisdiction: S.jurisdiction, region: S.region,
        from: S.date, to: S.date,
        maxLeave: { type: 'number', description: 'Most leave days willing to burn per bridge. Default 4.' },
      },
    },
    run: ({ jurisdiction: code, region, from, to, maxLeave }) => {
      const j = bind(code, region);
      const a = fromISO(from), b = fromISO(to);
      const summary = j.summarize(a, b);
      const bridges = j.bridges(a, b, maxLeave ?? 4);
      return {
        summary,
        bridges,
        best: bridges[0] || null,
        note: bridges.length
          ? `Best: burn ${bridges[0].cost} day(s) (${bridges[0].burn.join(', ')}) for ${bridges[0].length} consecutive days off.`
          : 'No bridge worth building in this range.',
        unknownYears: summary.unknownYears,
      };
    },
  },
  {
    name: 'count_days',
    description: 'Working days, rest days, statutory holidays and makeup workdays in a span, for one jurisdiction. Use this for leave accounting and project planning.',
    inputSchema: {
      type: 'object',
      required: ['jurisdiction', 'from', 'to'],
      properties: { jurisdiction: S.jurisdiction, region: S.region, from: S.date, to: S.date },
    },
    run: ({ jurisdiction: code, region, from, to }) =>
      bind(code, region).summarize(fromISO(from), fromISO(to)),
  },
  {
    name: 'next_holiday',
    description: 'The next statutory holiday at or after a date, with how many days away it is and how long the resulting break runs.',
    inputSchema: {
      type: 'object',
      required: ['jurisdiction'],
      properties: { jurisdiction: S.jurisdiction, region: S.region, from: S.date },
    },
    run: ({ jurisdiction: code, region, from }) => {
      const j = bind(code, region);
      const start = from ? fromISO(from) : Math.floor(Date.now() / 86400000);
      return j.nextHoliday(start) || { note: 'nothing published within the next 400 days' };
    },
  },
  {
    name: 'team_overlap',
    description: 'Across several jurisdictions at once: which days everyone is free, and who is already away. The question a distributed team actually has before scheduling anything.',
    inputSchema: {
      type: 'object',
      required: ['jurisdictions', 'from', 'to'],
      properties: {
        jurisdictions: {
          type: 'array', items: { type: 'string' },
          description: 'Codes, optionally with a region: ["CN", "DE-BY", "US-CA"]',
        },
        from: S.date, to: S.date,
      },
    },
    run: ({ jurisdictions: codes, from, to }) => {
      const bound = codes.map((spec) => {
        const [code, ...rest] = String(spec).split('-');
        const region = rest.length ? spec : null;
        return bind(code, region);
      });
      const a = fromISO(from), b = fromISO(to);
      const o = overlap(bound, a, b);
      const away = o.days.filter((d) => d.freeIn.length && !d.allFree);
      return {
        jurisdictions: bound.map((j) => ({ code: j.code, region: j.region, weekend: j.weekend })),
        everyoneFree: o.allFreeRuns,
        someoneAway: away.map((d) => ({ date: d.date, awayIn: d.freeIn, workingIn: d.workingIn })),
        note: 'A day free in one place and working in another is where cross-border scheduling goes wrong.',
      };
    },
  },
  {
    name: 'schengen_check',
    description: 'The Schengen 90/180 rule, counted the way a border guard counts it: a rolling 180-day window, arrival and departure days both counting in full. Returns days used, days left, the longest stay you could start today, and when budget returns.',
    inputSchema: {
      type: 'object',
      required: ['stays'],
      properties: {
        stays: {
          type: 'array',
          description: 'Past and planned stays inside the Schengen area.',
          items: {
            type: 'object', required: ['from', 'to'],
            properties: { from: S.date, to: S.date, where: { type: 'string' } },
          },
        },
        on: { type: 'string', description: 'Date to evaluate. Defaults to today.' },
      },
    },
    run: ({ stays, on }) => {
      const day = on || toISO(Math.floor(Date.now() / 86400000));
      const bad = (stays || []).filter((s) => s.where && !inSchengen(s.where));
      const r = schengenReport(stays || [], day);
      if (bad.length) {
        r.warning = `These stays are tagged with non-Schengen countries and should probably not be counted: `
          + bad.map((s) => `${s.where} (${s.from})`).join(', ')
          + '. Ireland is in the EU but not Schengen; Switzerland and Norway are the reverse.';
      }
      return r;
    },
  },
  {
    name: 'schengen_timeline',
    description: 'Day-by-day Schengen usage across a range, for drawing the rolling window or finding the exact day a plan breaches.',
    inputSchema: {
      type: 'object',
      required: ['stays', 'from', 'to'],
      properties: {
        stays: { type: 'array', items: { type: 'object' } },
        from: S.date, to: S.date,
      },
    },
    run: ({ stays, from, to }) => {
      const rows = schengenTimeline(stays || [], from, to);
      const breach = rows.find((r) => !r.compliant);
      return { breach: breach || null, days: rows };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --- JSON-RPC over stdio -------------------------------------------------
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: NAME, version: VERSION },
      instructions:
        'changli answers questions about statutory time: holidays, makeup workdays '
        + '(调休 / 補班), regional holiday differences, leave optimisation (拼假), '
        + 'cross-jurisdiction overlap, the Chinese lunar calendar, and the Schengen '
        + '90/180 rule. Every answer is computed by a deterministic solver, not '
        + 'generated -- treat the numbers as exact. Call list_jurisdictions first '
        + 'to see coverage; a year with no published notice is reported as unknown '
        + 'rather than guessed.',
    });
  }

  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
  if (method === 'ping') return ok(id, {});

  if (method === 'tools/list') {
    return ok(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    const tool = BY_NAME.get(params?.name);
    if (!tool) return err(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const result = tool.run(params.arguments || {});
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
    }
  }

  if (id !== undefined) err(id, -32601, `method not found: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { process.stderr.write(`parse error: ${e.message}\n`); }
  }
});
process.stdin.on('end', () => process.exit(0));
process.stderr.write(`${NAME} ${VERSION} ready (${TOOLS.length} tools)\n`);
