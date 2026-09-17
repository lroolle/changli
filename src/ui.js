// ui.js -- the surface.
//
// One idea runs through all of it: the visible range is a pair of day numbers,
// and every view is a different way of drawing the same continuous run. The
// unit and count only decide where the run starts and stops; they never chop
// it into cards. That is why 8/31 and 9/1 land side by side.
//
// Three things the reader does here, and the order matters: they scroll a
// continuous sheet (the spine), they select runs of days on it, and they write
// a label across what they selected (a mark). Selection is transient and lives
// in memory; a mark is durable and lives in localStorage; an export is a file
// they own. Nothing here ever leaves the machine on its own.

import {
  dayInfo, todayDayNumber, cstDayNumber, fromDayNumber,
  monthStart, monthEnd, addMonths, weekStart,
  summarize, bridges, restRuns, termContext, ganzhiYear,
  hasHolidayData, holidayPaper, STATUS, isRest,
} from './calendar.js';
import { EPHEMERIS_RANGE } from './ephemeris.js';
import {
  LABELS, labelOf, labelName, normalize, addRun, subtractRun, toggleRun,
  runsContain, runAt, totalDays, runLength,
  putMarks, clearRuns, markIndex, totals, marksWithin,
  loadMarks, saveMarks,
} from './marks.js';
import { icsFromMarks, icsFromStatutory } from './ics.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const COUNTS = { day: [1, 3, 7, 14], week: [1, 2, 4, 8], month: [1, 2, 3, 6, 12] };

/** Text from a mark's note reaches the DOM; it is the reader's, so it escapes. */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- state --------------------------------------------------------------
const today = todayDayNumber();
const state = {
  unit: 'month',
  count: 3,
  anchor: monthStart(today),
  layout: 'flow',
  focus: today,          // the day the rail describes
  runs: [],              // selection: sorted, merged, non-overlapping runs
  marks: [],             // durable, labelled runs
  spine: null,           // { from, to } -- the weeks currently in the DOM
  view: null,            // { from, to } -- the weeks actually on screen
  ribbonYear: fromDayNumber(today).y,
  theme: localStorage.getItem('changli-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
};

state.marks = loadMarks(localStorage);
let markIdx = markIndex(state.marks);

function commitMarks(next) {
  state.marks = next;
  markIdx = markIndex(next);
  saveMarks(localStorage, next);
  paintMarks();
  renderMarksCard();
  renderLedger();
  renderRibbon();
}

// --- the spine: one sheet, scrolled ------------------------------------
// The flow layout is not a page of N months; it is a continuous sheet that
// grows at whichever end the reader approaches. `spine` is what exists in the
// DOM, `view` is what their eyes are on, and the nav follows `view`.

const SPINE_CHUNK = 8;     // weeks added per extension
const SPINE_MAX = 260;     // weeks kept in the DOM -- five years, then prune
const RUNWAY = 1400;       // px of unseen sheet kept ahead of the scroll

const scrolling = () => state.layout === 'flow' && state.unit !== 'day';

/** The page: what the anchor and 数量 say. The bounded layouts use it whole,
 *  and the scrolling sheet uses it to decide where to start and how far a
 *  press of ‹ or › travels. */
function pageRange() {
  const { unit, count, anchor } = state;
  if (unit === 'day') return { from: anchor, to: anchor + count - 1 };
  if (unit === 'week') {
    const from = weekStart(anchor);
    return { from, to: from + count * 7 - 1 };
  }
  const from = monthStart(anchor);
  return { from, to: addMonths(from, count) - 1 };
}

/** What the reader is looking at -- the span every statistic is about. */
function range() {
  return scrolling() && state.view ? state.view : pageRange();
}

/** Move the range by whole units. */
function step(dir) {
  const { unit, count } = state;
  if (scrolling()) {
    const from = range().from;
    const target = unit === 'week'
      ? weekStart(from) + dir * count * 7
      : addMonths(monthStart(from), dir * count);
    goTo(target);
    return;
  }
  if (unit === 'day') state.anchor += dir * count;
  else if (unit === 'week') state.anchor = weekStart(state.anchor) + dir * count * 7;
  else state.anchor = addMonths(state.anchor, dir * count);
  render();
}

/** Put `day` in front of the reader, moving as little as possible. */
function reveal(day) {
  if (scrolling()) {
    const v = range();
    if (day < v.from || day > v.to) goTo(day);
    return;
  }
  let guard = 0;
  while (day < pageRange().from && guard++ < 400) step(-1);
  while (day > pageRange().to && guard++ < 400) step(1);
}

// --- formatting ---------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (n) => { const { y, m, d } = fromDayNumber(n); return `${y}-${pad2(m)}-${pad2(d)}`; };
const mdOf = (n) => { const { m, d } = fromDayNumber(n); return `${m}月${d}日`; };

function rangeTitle(from, to) {
  const a = fromDayNumber(from), b = fromDayNumber(to);
  if (a.y === b.y && a.m === b.m) return `${a.y} 年 ${a.m} 月`;
  if (a.y === b.y) return `${a.y} 年 ${a.m} — ${b.m} 月`;
  return `${a.y} 年 ${a.m} 月 — ${b.y} 年 ${b.m} 月`;
}

/**
 * "9月28日 — 10月7日". With several runs it is the reach of the whole
 * selection, first day to last: the count of pieces is already said by
 * whatever labels this text, and saying it twice reads as a stutter.
 */
function spanText(runs) {
  if (!runs.length) return '';
  const from = runs[0].from, to = runs[runs.length - 1].to;
  return from === to ? mdOf(from) : `${mdOf(from)} — ${mdOf(to)}`;
}

// --- render: the grid ---------------------------------------------------
function cellHTML(n, opts) {
  const info = dayInfo(n);
  const mk = markIdx.get(n);
  const attrs = [
    `data-day="${n}"`,
    `data-st="${info.status}"`,
  ];
  if (n === today) attrs.push('data-today="1"');
  if (opts.monthStart) attrs.push('data-mstart="1"');
  if (opts.monthRule) attrs.push('data-mrule="1"');
  if (opts.outside) attrs.push('data-outside="1"');
  if (state.focus === n) attrs.push('data-cursor="1"');
  if (runsContain(state.runs, n)) {
    attrs.push('data-sel="1"');
    const r = runAt(state.runs, n);
    if (n === r.from) attrs.push('data-sel-start="1"');
    if (n === r.to) attrs.push('data-sel-end="1"');
  }
  if (mk) {
    attrs.push(`data-mark="${mk.label}"`);
    if (n === mk.from) attrs.push('data-mark-start="1"');
    if (n === mk.to) attrs.push('data-mark-end="1"');
  }

  let mark = '';
  if (info.status === STATUS.HOLIDAY) mark = '<i class="d-mark rest" aria-hidden="true">休</i>';
  else if (info.status === STATUS.MAKEUP) mark = '<i class="d-mark work" aria-hidden="true">班</i>';

  const aria = [
    isoOf(n), WEEKDAYS[info.weekday - 1],
    info.lunar.monthName + info.lunar.dayName,
    info.status === STATUS.HOLIDAY ? `休假 ${info.holidayName}`
      : info.status === STATUS.MAKEUP ? `调休上班 ${info.holidayName}`
      : info.isWeekend ? '周末' : '工作日',
    ...info.festivals,
    mk ? `标记 ${labelName(mk)}` : '',
  ].filter(Boolean).join(' ');

  return `<div class="cell" role="gridcell" tabindex="-1" ${attrs.join(' ')} aria-label="${esc(aria)}">
    ${mark}<b class="d-num">${info.d}</b>
    <span class="d-label is-${info.labelKind}">${info.label}</span>
    ${mk ? `<span class="d-tag">${esc(tagTextFor(n, mk, info))}</span>` : ''}
  </div>`;
}

/**
 * A mark's label is written at the start of its run, and again on the Monday
 * of every row it continues into.
 *
 * A run of leave usually spans two or three week rows. Labelling only the
 * first cell leaves the rest of the run as an unexplained grey lane; labelling
 * every cell is a stutter. A continued footnote is the printed convention and
 * it is the one that reads.
 */
function tagTextFor(n, mk, info) {
  return n === mk.from || info.weekday === 1 ? labelName(mk) : '';
}

function headerHTML(withGutter) {
  const cells = WEEKDAYS.map((w, i) =>
    `<span class="${i >= 5 ? 'we' : ''}">${w}</span>`).join('');
  return (withGutter ? '<div class="gh-gutter"></div>' : '') + `<div class="gh" role="row">${cells}</div>`;
}

/**
 * One week row: the gutter cell plus seven days.
 *
 * Returned as a unit so the sheet can be *extended* rather than rebuilt. A
 * drag must never rebuild the surface it is being dragged across (TASTE.md,
 * 2026-08-24), and neither must a scroll -- insertAdjacentHTML leaves every
 * existing node, and every pointer capture on it, exactly where it was.
 */
function weekRowHTML(w, prevMonth, opts = {}) {
  // A week row belongs to whichever month owns its Thursday -- the rule that
  // makes the band agree with the label instead of fighting it.
  const band = dayInfo(w + 3);
  const label = band.m === prevMonth ? '' : `${band.m}月`;
  let html = `<div class="gutter" role="rowheader" data-week="${w}" data-month="${band.m}" `
    + `data-band="${band.m % 2}">${label ? `<b>${label}</b>` : ''}</div>`;
  let past = false;
  for (let i = 0; i < 7; i++) {
    const n = w + i;
    const first = dayInfo(n).d === 1;
    if (first) past = true;
    html += cellHTML(n, {
      monthStart: first,
      monthRule: past && !opts.firstRow,
      outside: opts.from !== undefined && (n < opts.from || n > opts.to),
    });
  }
  return { html, month: band.m };
}

/** The continuous sheet: whole weeks, no gaps, month boundaries as rules. */
function renderFlow(from, to) {
  const start = weekStart(from);
  const end = weekStart(to) + 6;
  let html = `<div class="gsheet" role="grid">${headerHTML(true)}`;
  let prevMonth = null;
  for (let w = start; w <= end; w += 7) {
    const row = weekRowHTML(w, prevMonth, { firstRow: w === start });
    html += row.html;
    prevMonth = row.month;
  }
  return html + '</div>';
}

/** The familiar month card, for people who want it. Same cells inside. */
function renderBlocks(from, to) {
  let html = '<div class="blocks">';
  let m = monthStart(from);
  while (m <= to) {
    const first = dayInfo(m);
    const last = monthEnd(m);
    html += `<section class="block"><h3 class="block-h">${first.y} 年 ${first.m} 月</h3>`;
    html += `<div class="gsheet" role="grid">${headerHTML(false)}`;
    for (let i = 1; i < first.weekday; i++) html += '<div class="pad"></div>';
    for (let n = m; n <= last; n++) {
      html += cellHTML(n, { monthStart: false, outside: n < from || n > to });
    }
    html += '</div></section>';
    m = addMonths(m, 1);
  }
  return html + '</div>';
}

/** The 撕历 page, one row per day. */
function renderDays(from, to) {
  let html = '<div class="daylist" role="list">';
  for (let n = from; n <= to; n++) {
    const info = dayInfo(n);
    const tc = termContext(n);
    const mk = markIdx.get(n);
    const attrs = [`data-day="${n}"`, `data-st="${info.status}"`];
    if (n === today) attrs.push('data-today="1"');
    if (runsContain(state.runs, n)) attrs.push('data-sel="1"');
    if (mk) attrs.push(`data-mark="${mk.label}"`);
    const mark = info.status === STATUS.HOLIDAY ? '<span class="d-mark rest">休</span>'
      : info.status === STATUS.MAKEUP ? '<span class="d-mark work">班</span>' : '';
    const fests = info.festivals.length
      ? `<span class="dr-fest">${info.festivals.join(' · ')}</span>` : '';
    const term = info.term ? `<span class="dr-term">${info.term.name}</span>`
      : tc.current ? `<span class="dr-term">${tc.current.name} 第 ${tc.current.nth} 天</span>` : '';
    const tag = mk ? `<span class="dr-tag">${esc(labelName(mk))}</span>` : '';
    html += `<div class="dayrow" role="listitem" tabindex="-1" ${attrs.join(' ')}>
      <span class="dr-date">
        <b class="dr-n">${info.d}</b>
        <span class="dr-wd">${info.m}月<br>周${WEEKDAYS[info.weekday - 1]}</span>
      </span>
      <span class="dr-mid">
        <span class="dr-lunar">${info.lunar.monthName}${info.lunar.dayName}</span>
        ${term}${fests}${tag}
      </span>
      <span class="dr-mark">${mark}</span>
    </div>`;
  }
  return html + '</div>';
}

// --- render: the ribbon (the 節氣盤 unrolled) ----------------------------
function renderRibbon() {
  const svg = $('#ribbon-svg');
  const year = state.ribbonYear;
  const y0 = cstDayNumber(year, 1, 1);
  const y1 = cstDayNumber(year + 1, 1, 1) - 1;
  const days = y1 - y0 + 1;

  const W = svg.clientWidth || svg.parentElement.clientWidth || 900;
  const H = parseFloat(getComputedStyle(svg).height) || 104;
  const PAD = 1;
  const x = (n) => PAD + ((n - y0) / days) * (W - PAD * 2);
  const wide = W > 560;

  // four lanes, the concentric rings laid flat. The fourth is the reader's own.
  const L1 = { y: 2, h: 14 };                 // 月建
  const L2 = { y: 20, h: H - 20 - 30 };       // 節氣
  const L3 = { y: H - 28, h: 18 };            // 休/班
  const L4 = { y: H - 8, h: 5 };              // 标记

  const p = [];
  p.push(`<rect class="rb-lane-bg" x="0" y="0" width="${W}" height="${H}"/>`);

  // lane 1: months
  for (let m = 1; m <= 12; m++) {
    const a = x(cstDayNumber(year, m, 1));
    const b = x(m === 12 ? y1 + 1 : cstDayNumber(year, m + 1, 1));
    if (m % 2 === 0) p.push(`<rect x="${a}" y="${L1.y}" width="${b - a}" height="${L1.h}" fill="var(--surface-2)"/>`);
    p.push(`<line class="rb-rule" x1="${a}" y1="${L1.y}" x2="${a}" y2="${L1.y + L1.h}"/>`);
    if (b - a > 16) {
      p.push(`<text class="rb-month-label" x="${(a + b) / 2}" y="${L1.y + 10.5}" text-anchor="middle">${m}</text>`);
    }
  }

  // lane 2: the 24 terms, at their real (unequal) spacing
  const terms = [];
  for (let n = y0; n <= y1; n++) {
    const info = dayInfo(n);
    if (info.term) terms.push(info.term);
  }
  p.push(`<line class="rb-rule" x1="${PAD}" y1="${L2.y + L2.h}" x2="${W - PAD}" y2="${L2.y + L2.h}"/>`);

  // Ticks for all 24; labels only where they fit. The eight season terms
  // (立/分/至) are placed first and always keep their label, then the rest fill
  // in wherever they do not collide -- so the lane thins out gracefully as the
  // viewport narrows instead of overprinting itself.
  const placed = [];
  const fits = (cx, halfW) =>
    !placed.some(([a, b]) => cx - halfW < b + 3 && cx + halfW > a - 3);
  const drawLabel = (t, major) => {
    const tx = x(t.day);
    const halfW = (t.name.length * 9.5) / 2;
    const cx = Math.min(Math.max(tx, PAD + halfW), W - PAD - halfW);
    if (!fits(cx, halfW)) return false;
    placed.push([cx - halfW, cx + halfW]);
    p.push(`<text class="rb-term-label" x="${cx}" y="${L2.y + L2.h - (major ? 16 : 10)}" text-anchor="middle">${t.name}</text>`);
    return true;
  };

  for (const t of terms) {
    const tx = x(t.day);
    const major = t.index % 3 === 0;
    p.push(`<line class="rb-term-tick ${major ? 'major' : ''}" x1="${tx}" y1="${L2.y + L2.h - (major ? 13 : 7)}" x2="${tx}" y2="${L2.y + L2.h}"/>`);
  }
  for (const t of terms) if (t.index % 3 === 0) drawLabel(t, true);
  if (wide) for (const t of terms) if (t.index % 3 !== 0) drawLabel(t, false);

  // lane 3: the statutory year
  if (!hasHolidayData(year)) {
    p.push(`<rect class="rb-unknown" x="${PAD}" y="${L3.y}" width="${W - PAD * 2}" height="${L3.h}"/>`);
    p.push(`<text class="rb-month-label" x="${W / 2}" y="${L3.y + 13}" text-anchor="middle">${year} 年放假安排尚未公布</text>`);
  } else {
    // Only runs the notice actually names. An ordinary weekend at year scale
    // is noise, and this lane is meant to read as the statutory year.
    for (const run of restRuns(y0, y1)) {
      if (!run.name) continue;
      const a = x(run.from), b = x(run.to + 1);
      const w = Math.max(b - a, 3);
      p.push(`<rect class="rb-holiday" x="${a}" y="${L3.y}" width="${w}" height="${L3.h}"/>`);
      if (w > 6) p.push(`<rect class="rb-holiday-edge" x="${a}" y="${L3.y}" width="${w}" height="${L3.h}"/>`);
      const short = run.name.length > 2 ? run.name.slice(0, 2) : run.name;
      if (w > 24) {
        p.push(`<text class="rb-holiday-name" x="${a + w / 2}" y="${L3.y + 12.5}" text-anchor="middle">${short}</text>`);
      }
    }
    for (let n = y0; n <= y1; n++) {
      if (dayInfo(n).status !== STATUS.MAKEUP) continue;
      p.push(`<rect class="rb-makeup" x="${x(n)}" y="${L3.y + L3.h - 5}" width="${Math.max(x(n + 1) - x(n), 1.5)}" height="5"/>`);
    }
  }

  // lane 4: the reader's marks, at year scale. This is the answer to "how much
  // leave have I actually spent" before any number is read.
  for (const m of marksWithin(state.marks, y0, y1)) {
    const a = x(m.from), b = x(m.to + 1);
    p.push(`<rect class="rb-mark" x="${a}" y="${L4.y}" width="${Math.max(b - a, 2)}" height="${L4.h}"/>`);
  }

  // today
  if (today >= y0 && today <= y1) {
    p.push(`<line class="rb-today" x1="${x(today)}" y1="0" x2="${x(today)}" y2="${H}"/>`);
  }

  // the window: what the grid below is showing
  const r = range();
  const wa = x(Math.max(r.from, y0));
  const wb = x(Math.min(r.to, y1) + 1);
  if (r.to >= y0 && r.from <= y1) {
    p.push(`<rect class="rb-window" id="rb-window" x="${wa}" y="1" width="${Math.max(wb - wa, 3)}" height="${H - 2}" rx="2"/>`);
    p.push(`<rect class="rb-window-grip" id="rb-grip-a" x="${wa}" y="1" width="2" height="${H - 2}"/>`);
    p.push(`<rect class="rb-window-grip" id="rb-grip-b" x="${wb - 2}" y="1" width="2" height="${H - 2}"/>`);
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = p.join('');
  $('#ribbon-desc').textContent =
    `${year} 年概览：24 节气与法定假期分布，当前视图为 ${isoOf(r.from)} 至 ${isoOf(r.to)}。`;
  svg._x = x; svg._y0 = y0; svg._y1 = y1; svg._W = W;
}

/**
 * Move the window rect without redrawing the ribbon.
 *
 * Scrolling the sheet moves this window on every frame. Rebuilding 24 term
 * labels and a year of holiday runs at 60 Hz would make the sheet stutter, and
 * the ribbon is supposed to track 1:1 (DESIGN.md, motion).
 */
function moveRibbonWindow() {
  const svg = $('#ribbon-svg');
  const win = $('#rb-window');
  if (!svg._x || !win) return;
  const r = range();
  if (r.to < svg._y0 || r.from > svg._y1) return;
  const a = svg._x(Math.max(r.from, svg._y0));
  const b = svg._x(Math.min(r.to, svg._y1) + 1);
  const w = Math.max(b - a, 3);
  win.setAttribute('x', a);
  win.setAttribute('width', w);
  $('#rb-grip-a')?.setAttribute('x', a);
  $('#rb-grip-b')?.setAttribute('x', a + w - 2);
}

// --- render: the rail ---------------------------------------------------
function renderDayCard() {
  const n = state.focus;
  const info = dayInfo(n);
  const tc = termContext(n);
  const gz = ganzhiYear(info.lunar.year);
  const mk = markIdx.get(n);
  const el = $('#day-card');
  el.dataset.st = info.status;
  if (n === today) el.dataset.today = '1'; else delete el.dataset.today;

  const statusText = info.status === STATUS.HOLIDAY
    ? `<span class="tag-rest">休 · ${info.holidayName}</span>`
    : info.status === STATUS.MAKEUP
      ? `<span class="tag-work">班 · ${info.holidayName}调休</span>`
      : info.isWeekend ? '周末' : '工作日';

  const diff = n - today;
  const rel = diff === 0 ? '今天' : diff > 0 ? `${diff} 天后` : `${-diff} 天前`;

  const rows = [
    ['农历', `${info.lunar.monthName}${info.lunar.dayName}`],
    ['干支', `${gz.stem}${gz.branch}年 · 生肖${gz.zodiac}`],
    ['状态', statusText],
  ];
  if (info.festivals.length) rows.push(['节日', info.festivals.join(' · ')]);
  if (tc.current) {
    const nx = tc.next ? `，距 ${tc.next.name} ${tc.next.inDays} 天` : '';
    rows.push(['节气', `${tc.current.name} 第 ${tc.current.nth} 天${nx}`]);
  }
  if (mk) {
    rows.push(['标记', `<span class="tag-mark">${esc(labelName(mk))}</span>`
      + `<span class="dc-mark-span"> · ${mdOf(mk.from)}—${mdOf(mk.to)} · ${runLength(mk)} 天</span>`]);
  }

  el.innerHTML = `
    <div class="dc-top">
      <b class="dc-n">${info.d}</b>
      <span>
        <span class="dc-wd">星期${WEEKDAYS[info.weekday - 1]}</span><br>
        <span class="dc-ymd">${isoOf(n)} · ${rel}</span>
      </span>
    </div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/**
 * The ledger totals the *selected days*, not the span they sit in.
 *
 * With disjoint runs the two differ: three separate long weekends are 9 days,
 * and the distance from the first to the last is 40. Summing per run is the
 * only answer that stays true when the selection is in pieces.
 */
function sumRuns(runs) {
  const acc = { total: 0, off: 0, statutory: 0, leave: 0, makeup: 0 };
  for (const r of runs) {
    const s = summarize(r.from, r.to);
    acc.total += s.total; acc.off += s.off;
    acc.statutory += s.statutory; acc.leave += s.leave; acc.makeup += s.makeup;
  }
  return acc;
}

function renderLedger() {
  const sel = state.runs;
  const runs = sel.length ? sel : [range()];
  const s = sumRuns(runs);
  const scope = sel.length
    ? (sel.length > 1 ? `已选 ${sel.length} 段` : '已选区间')
    : '当前视图';
  const rows = [
    ['天数', `${s.total}`, false],
    ['休息', `${s.off}`, true],
    ['其中法定', `${s.statutory}`, false],
    ['需上班', `${s.leave}`, false],
  ];
  if (s.makeup) rows.push(['其中调休班', `${s.makeup}`, false]);

  const longest = runs
    .flatMap((r) => restRuns(r.from, r.to))
    .reduce((a, b) => (b.length > (a?.length || 0) ? b : a), null);

  const marked = marksWithin(state.marks, runs[0].from, runs[runs.length - 1].to)
    .filter((m) => runs.some((r) => m.from <= r.to && m.to >= r.from));
  const markDays = totalDays(marked.map((m) => {
    const r = runs.find((x) => m.from <= x.to && m.to >= x.from);
    return { from: Math.max(m.from, r.from), to: Math.min(m.to, r.to) };
  }));

  $('#ledger').innerHTML =
    `<p class="lg-span">${scope} · ${spanText(runs)}</p>` +
    rows.map(([k, v, hot]) =>
      `<div class="lg-row"><span class="lg-k">${k}</span><span class="lg-v${hot ? ' hot' : ''}" data-num>${v}</span></div>`).join('') +
    (longest ? `<div class="lg-row"><span class="lg-k">最长连休</span><span class="lg-v" data-num>${longest.length} 天${longest.clipped ? '+' : ''}</span></div>` : '') +
    (markDays ? `<div class="lg-row"><span class="lg-k">已标记</span><span class="lg-v" data-num>${markDays} 天</span></div>` : '');
}

function renderBridges() {
  const r = range();
  const list = bridges(r.from, r.to).slice(0, 5);
  const el = $('#bridges');
  if (!hasHolidayData(fromDayNumber(r.from).y) && !hasHolidayData(fromDayNumber(r.to).y)) {
    el.innerHTML = '<p class="empty">该年度放假安排尚未公布，无法计算。</p>';
    return;
  }
  if (!list.length) {
    el.innerHTML = '<p class="empty">这段时间里没有值得拼的假期。</p>';
    return;
  }
  el.innerHTML = list.map((b) => `
    <button type="button" class="bridge" data-from="${b.from}" data-to="${b.to}"
            data-gap-from="${b.gapFrom}" data-gap-to="${b.gapTo}">
      <span class="br-top">请 <b>${b.cost}</b> 天 → 连休 <b>${b.length}</b> 天</span>
      <span class="br-sub">${mdOf(b.from)} — ${mdOf(b.to)}　请假 ${mdOf(b.gapFrom)}${b.cost > 1 ? ` — ${mdOf(b.gapTo)}` : ''}${b.name ? ` · ${b.name}` : ''}</span>
    </button>`).join('');
}

/**
 * The marks card: what the reader has spent, and the two ways out of here.
 *
 * Export writes a file; subscribe hands the calendar app a URL it re-reads on
 * its own. They are not the same promise and the card must not blur them --
 * marks are on this machine and a file is a copy, while the statutory feed is
 * served and really does keep itself current.
 */
function renderMarksCard() {
  const el = $('#marks-body');
  const t = totals(state.marks);
  const feed = feedBase();

  const totalsHTML = t.length
    ? `<div class="mk-totals">${t.map((row) => {
        const l = labelOf(row.label);
        return `<span class="mk-total"><b>${l.name}</b><span data-num>${row.days}</span> 天</span>`;
      }).join('')}</div>`
    : '<p class="empty">还没有标记。在日历上拖选几天，再选一个标签。</p>';

  const recent = [...state.marks].sort((a, b) => b.from - a.from).slice(0, 6);
  const listHTML = recent.length ? `<ul class="mk-list">${recent.map((m) => `
    <li>
      <button type="button" class="mk-run" data-goto="${m.from}" data-from="${m.from}" data-to="${m.to}">
        <span class="mk-run-label">${esc(labelName(m))}</span>
        <span class="mk-run-span">${mdOf(m.from)}${m.to !== m.from ? ` — ${mdOf(m.to)}` : ''}</span>
        <span class="mk-run-days" data-num>${runLength(m)} 天</span>
      </button>
      <button type="button" class="mk-del" data-del-from="${m.from}" data-del-to="${m.to}"
              aria-label="删除标记 ${esc(labelName(m))}">✕</button>
    </li>`).join('')}</ul>` : '';

  const more = state.marks.length > recent.length
    ? `<p class="mk-more">另有 ${state.marks.length - recent.length} 段较早的标记。</p>` : '';

  el.innerHTML = totalsHTML + listHTML + more + `
    <div class="mk-acts">
      <button type="button" class="btn" data-act="export-marks"${state.marks.length ? '' : ' disabled'}>导出我的标记 .ics</button>
      <button type="button" class="btn" data-act="export-gov">导出本视图法定假日</button>
    </div>
    <p class="mk-sub">订阅后日历会自己更新：
      <a href="${feed.webcal}/feed/cn-holidays.ics">法定节假日</a> ·
      <a href="${feed.webcal}/feed/cn-terms.ics">节气与传统节日</a>
      <button type="button" class="linkish" data-act="copy-feed"
              data-url="${feed.https}/feed/cn-holidays.ics">复制链接</button>
    </p>
    <p class="mk-note">标记只存在这台设备的浏览器里，导出的 .ics 是一份副本，不会同步回来。</p>`;
}

/** Where the subscribable feeds live -- this deployment, not a hardcoded host. */
function feedBase() {
  const origin = location.origin.replace(/\/$/, '');
  return { https: origin, webcal: origin.replace(/^https?:/, 'webcal:') };
}

function renderProvenance() {
  const r = range();
  const years = new Set();
  for (let y = fromDayNumber(r.from).y; y <= fromDayNumber(r.to).y; y++) years.add(y);
  const links = [...years].map((y) => {
    const url = holidayPaper(y);
    return url ? `<a href="${url}" target="_blank" rel="noopener">${y} 年国务院通知</a>` : null;
  }).filter(Boolean);
  const missing = [...years].filter((y) => !hasHolidayData(y));
  $('#prov').innerHTML =
    `休/班 依据：${links.length ? links.join('、') : '—'}。` +
    (missing.length ? `<br>${missing.join('、')} 年安排尚未公布，仅按周末推算。` : '') +
    `<br>农历与节气由 JPL DE440s 星历推算（${EPHEMERIS_RANGE.from}–${EPHEMERIS_RANGE.to}），时区固定 UTC+8。`;
}

/**
 * The mark bar: what you do with a selection, next to the selection.
 *
 * It is always here, and it swaps its contents rather than appearing.
 *
 * The first version showed it only once days were selected, which reads well
 * and is wrong: the bar sits above the sheet, so un-hiding it on the first
 * pointerdown pushed every cell down by its height -- mid-drag, under the
 * pointer. A drag that started on 9月7日 and ended on 9月16日 selected three
 * days, because the rows had moved a row's worth while the pointer stood
 * still. Same family as the 2026-08-24 re-render scar: the surface must not
 * move under a drag. Holding the space also gives the gesture hint somewhere
 * to live -- where the actions will be, rather than under the grid.
 */
function renderMarkBar() {
  const sel = state.runs;
  const hint = $('#mb-hint');
  const live = $('#mb-live');
  hint.hidden = !!sel.length;
  live.hidden = !sel.length;
  if (!sel.length) return;

  const days = totalDays(sel);
  $('#mb-span').innerHTML =
    `<b data-num>${days}</b> 天 · <span class="mb-when">${spanText(sel)}</span>`;

  // 清除标记 appears only when there is something to clear.
  const anyMarked = sel.some((r) => {
    for (let n = r.from; n <= r.to; n++) if (markIdx.has(n)) return true;
    return false;
  });
  $('#mb-clear').hidden = !anyMarked;
}

function buildChips() {
  $('#mb-chips').innerHTML = LABELS.map((l, i) => `
    <button type="button" class="chip" data-label="${l.key}" data-kind="${l.kind}">
      ${l.name}<kbd>${i + 1}</kbd>
    </button>`).join('') + `
    <button type="button" class="chip chip-custom" data-label="event" data-custom="1">自定义…</button>`;
}

/**
 * Update only what selection changes: the cell attributes and the rail.
 *
 * The grid must NOT be rebuilt here. Replacing innerHTML mid-drag destroys the
 * element under the pointer, the next pointermove lands on nothing, and the
 * selection silently stops short of where the user dragged.
 */
function flag(el, name, on) {
  if (on) el.setAttribute(name, '1');
  else el.removeAttribute(name);
}

function paint() {
  const runs = state.runs;
  for (const el of $$('#grid [data-day]')) {
    const n = Number(el.dataset.day);
    const r = runAt(runs, n);
    // setAttribute, not toggleAttribute: toggleAttribute writes an empty value
    // and every selector in app.css matches on ="1".
    flag(el, 'data-sel', !!r);
    flag(el, 'data-sel-start', !!r && n === r.from);
    flag(el, 'data-sel-end', !!r && n === r.to);
    flag(el, 'data-cursor', n === state.focus);
  }
  renderDayCard();
  renderLedger();
  renderMarkBar();
}

/**
 * Marks change the cells in place too.
 *
 * Re-rendering the sheet after a label would throw away the scroll position on
 * an infinite surface, which is the one thing a reader cannot get back. Every
 * cell already reserves the mark lane, so writing a label never reflows a row.
 */
function paintMarks() {
  for (const el of $$('#grid [data-day]')) {
    const n = Number(el.dataset.day);
    const mk = markIdx.get(n);
    if (!mk) {
      el.removeAttribute('data-mark');
      el.removeAttribute('data-mark-start');
      el.removeAttribute('data-mark-end');
      el.querySelector('.d-tag, .dr-tag')?.remove();
      continue;
    }
    el.setAttribute('data-mark', mk.label);
    flag(el, 'data-mark-start', n === mk.from);
    flag(el, 'data-mark-end', n === mk.to);
    // A cell writes into its reserved lane; a 撕历 row writes into its middle
    // column. Same fact, two surfaces, and neither borrows the other's element.
    const row = el.classList.contains('dayrow');
    const cls = row ? 'dr-tag' : 'd-tag';
    let tag = el.querySelector('.' + cls);
    if (!tag) {
      tag = document.createElement('span');
      tag.className = cls;
      (row ? el.querySelector('.dr-mid') : el).appendChild(tag);
    }
    // textContent, not innerHTML: the note is the reader's text.
    tag.textContent = row ? labelName(mk) : tagTextFor(n, mk, dayInfo(n));
  }
  renderDayCard();
  renderMarkBar();
}

// --- render -------------------------------------------------------------
let raf = 0;
function render(opts = {}) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const grid = $('#grid');
    if (state.unit === 'day') {
      const r = pageRange();
      state.view = null;
      grid.innerHTML = renderDays(r.from, r.to);
    } else if (state.layout === 'blocks') {
      const r = pageRange();
      state.view = null;
      grid.innerHTML = renderBlocks(r.from, r.to);
    } else {
      // the scrolling sheet: start from the page, then let the reader travel
      const p = pageRange();
      // No leading pad: the sheet begins where the reader asked it to and
      // grows backwards only when they scroll up. Padding the top would mean
      // scrolling down on first paint, past the masthead and the ribbon.
      state.spine = {
        from: weekStart(p.from),
        to: weekStart(p.to) + SPINE_CHUNK * 7 + 6,
      };
      grid.innerHTML = renderFlow(state.spine.from, state.spine.to);
      state.view = { from: p.from, to: p.to };
    }

    paintTitle();
    $('#grid-note').textContent = scrolling()
      ? '连续排布：向下滚动即可一直往后翻，月份之间只有一条粗线。'
      : '';

    renderRibbon();
    renderDayCard();
    renderLedger();
    renderBridges();
    renderMarksCard();
    renderMarkBar();
    renderProvenance();
    syncControls();

    if (scrolling() && opts.scrollTo !== undefined) {
      scrollRowToTop(weekStart(opts.scrollTo));
      syncView();
    }
  });
}

function paintTitle() {
  const r = range();
  $('.range-title-main').textContent = rangeTitle(r.from, r.to);
  $('.range-title-sub').textContent =
    `${r.to - r.from + 1} 天 · ${isoOf(r.from)} — ${isoOf(r.to)}`;
}

function syncControls() {
  for (const b of $$('[data-unit]')) {
    b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit));
  }
  for (const b of $$('[data-layout]')) {
    b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout));
    b.disabled = state.unit === 'day';
  }
  $('.ribbon-year').textContent = `${state.ribbonYear} 年`;
  document.documentElement.dataset.theme = state.theme;

  const steps = $('.count-steps');
  const want = COUNTS[state.unit];
  if (steps.dataset.unit !== state.unit) {
    steps.dataset.unit = state.unit;
    steps.innerHTML = want.map((c) =>
      `<button type="button" class="btn seg" data-count="${c}">${c}</button>`).join('');
  }
  for (const b of steps.querySelectorAll('[data-count]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.count) === state.count));
  }
}

// --- the scrolling sheet ------------------------------------------------

const sheetEl = () => $('#grid .gsheet');
const rowEl = (week) => $(`#grid .gutter[data-week="${week}"]`);

/** Where the sticky header stops covering the sheet. */
function headerBottom() {
  const gh = $('#grid .gh');
  if (!gh) return 0;
  const box = gh.getBoundingClientRect();
  return box.bottom;
}

/**
 * Extend the sheet at one end.
 *
 * Insert, never rebuild: existing rows keep their identity, so a drag in
 * progress and the pointer capture on it both survive. Prepending also moves
 * everything below it down, so the scroll position is corrected by exactly the
 * height that was added -- otherwise the sheet jumps under the reader's eyes.
 */
function extendSpine(dir) {
  const sheet = sheetEl();
  if (!sheet || !state.spine) return false;

  if (dir > 0) {
    const from = state.spine.to + 1;
    const to = from + SPINE_CHUNK * 7 - 1;
    let prevMonth = dayInfo(state.spine.to - 6 + 3).m;
    let html = '';
    for (let w = from; w <= to; w += 7) {
      const row = weekRowHTML(w, prevMonth);
      html += row.html;
      prevMonth = row.month;
    }
    sheet.insertAdjacentHTML('beforeend', html);
    state.spine.to = to;
  } else {
    const to = state.spine.from - 1;
    const from = to - SPINE_CHUNK * 7 + 1;
    const firstRow = rowEl(state.spine.from);
    let html = '';
    let prevMonth = null;
    for (let w = from; w <= to; w += 7) {
      const row = weekRowHTML(w, prevMonth, { firstRow: w === from });
      html += row.html;
      prevMonth = row.month;
    }
    // Insert, then put the scroll back by exactly what was added. `.gsheet`
    // sets overflow-anchor: none so the browser does not also try.
    const before = sheet.offsetHeight;
    sheet.querySelector('.gh').insertAdjacentHTML('afterend', html);
    scrollBy(0, sheet.offsetHeight - before);
    state.spine.from = from;
    // The row that used to be first may now repeat the month above it.
    if (firstRow) {
      const repeats = Number(firstRow.dataset.month) === prevMonth;
      firstRow.innerHTML = repeats ? '' : `<b>${firstRow.dataset.month}月</b>`;
    }
  }
  pruneSpine(dir);
  return true;
}

/** Keep the sheet finite. Trim the end the reader is travelling away from. */
function pruneSpine(dir) {
  const sheet = sheetEl();
  const weeks = (state.spine.to - state.spine.from + 1) / 7;
  if (!sheet || weeks <= SPINE_MAX) return;
  const drop = Math.ceil(weeks - SPINE_MAX);
  if (dir > 0) {
    const before = sheet.offsetHeight;
    for (let i = 0; i < drop; i++) {
      const w = state.spine.from + i * 7;
      const row = rowEl(w);
      if (!row) break;
      for (let k = 0; k < 7; k++) row.nextElementSibling?.remove();
      row.remove();
    }
    state.spine.from += drop * 7;
    scrollBy(0, sheet.offsetHeight - before);
    const head = rowEl(state.spine.from);
    if (head && !head.firstChild) head.innerHTML = `<b>${head.dataset.month}月</b>`;
  } else {
    for (let i = 0; i < drop; i++) {
      const w = state.spine.to - 6 - i * 7;
      const row = rowEl(w);
      if (!row) break;
      for (let k = 0; k < 7; k++) row.nextElementSibling?.remove();
      row.remove();
    }
    state.spine.to -= drop * 7;
  }
}

/**
 * Put a week under the header. Instantly, never smoothly.
 *
 * A smooth scroll up the sheet crosses the top runway on its way, the scroll
 * handler extends the spine backwards, and the compensating scrollBy that
 * keeps the sheet from jumping cancels the animation and undoes the travel --
 * 今天 pressed from 2027 grew the sheet by three chunks and stayed where it
 * was. An instant scroll lands before any of that can fire, and the sheet is
 * mechanical by design anyway: the ribbon tracks the pointer 1:1, and this
 * moves the same way.
 */
function scrollRowToTop(week) {
  const row = rowEl(week);
  if (!row) return;
  const top = row.getBoundingClientRect().top + scrollY - headerBottom() + 1;
  scrollTo({ top: Math.max(top, 0), behavior: 'auto' });
}

/**
 * Travel to a day: rebuild the sheet around it and put its week at the top.
 *
 * The spine grows by *scrolling*; asking for a date rebuilds it. Walking there
 * eight weeks at a time is both slower and inexact -- each extension fires the
 * scroll handler, which prepends and compensates, and the arrival drifts by
 * however many rows got inserted on the way. A rebuild starts the sheet at the
 * destination with no leading pad, so the target week is the first row and
 * nothing can push it around.
 */
function goTo(day) {
  state.anchor = anchorFor(day);
  render({ scrollTo: day });
}

/**
 * Glide: the same travel, but cheap enough to do on every pointermove.
 *
 * Dragging the ribbon asks for a new date sixty times a second. Rebuilding the
 * sheet each time is both wasteful and visibly stuttery, and the ribbon is
 * supposed to track the pointer 1:1. So when the target week is already in the
 * DOM -- which it is for most of a drag, the spine being far wider than the
 * viewport -- just scroll to it. Only a drag that leaves the built sheet pays
 * for a rebuild.
 */
function glideTo(day) {
  if (!scrolling()) {
    const a = anchorFor(day);
    if (a !== state.anchor) { state.anchor = a; render(); }
    return;
  }
  const week = weekStart(day);
  if (rowEl(week)) { scrollRowToTop(week); syncView(); }
  else goTo(day);
}

/**
 * What is on screen, from the scroll position.
 *
 * Binary search over the rows rather than dividing by a row height: a week
 * containing a month boundary carries the 2px stepped rule and is that much
 * taller than its neighbours, and over two hundred rows a uniform-height guess
 * drifts by half a row -- which shows up as a title naming the wrong month.
 * Nine rect reads per scroll frame, not two hundred.
 */
function rowIndexAt(docY, rows) {
  let lo = 0, hi = rows - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const el = rowEl(state.spine.from + mid * 7);
    if (!el) break;
    if (el.getBoundingClientRect().top + scrollY <= docY) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

function syncView() {
  if (!scrolling() || !state.spine) return;
  const sheet = sheetEl();
  const first = rowEl(state.spine.from);
  if (!sheet || !first) return;

  const rows = (state.spine.to - state.spine.from + 1) / 7;
  // Clamped at 0: below 720px the header is not sticky, and once it has
  // scrolled away its rect bottom is negative.
  const topIdx = rowIndexAt(scrollY + Math.max(headerBottom(), 0), rows);
  const botIdx = rowIndexAt(scrollY + innerHeight - 1, rows);

  const from = state.spine.from + topIdx * 7;
  const to = state.spine.from + botIdx * 7 + 6;
  const prev = state.view;
  state.view = { from, to };
  if (!prev || prev.from !== from || prev.to !== to) {
    paintTitle();
    moveRibbonWindow();
    const year = fromDayNumber(from).y;
    if (year !== state.ribbonYear) { state.ribbonYear = year; renderRibbon(); syncControls(); }
    if (!prev || fromDayNumber(prev.from).m !== fromDayNumber(from).m
      || fromDayNumber(prev.from).y !== fromDayNumber(from).y) {
      // The expensive half -- only when the month under the reader changes.
      if (!state.runs.length) renderLedger();
      renderBridges();
      renderProvenance();
    }
  }
}

let scrollRaf = 0;
addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!scrolling() || !state.spine) return;
    const sheet = sheetEl();
    if (!sheet) return;
    const box = sheet.getBoundingClientRect();
    // A drag is a promise to the cells under the pointer; extend below it (new
    // nodes only) but never prune or shift the sheet while it is held.
    if (box.bottom < innerHeight + RUNWAY) extendSpine(1);
    // Backwards only once the sheet's top edge has left the screen. Correcting
    // the scroll by the height inserted is right only when the insertion lands
    // *above* what the reader is looking at; while the first row is still
    // visible the insertion point is on screen, and compensating for it walks
    // the view backwards a chunk at a time -- a jump to the top of a year-long
    // sheet landed five months early. Above the fold, there is also nothing to
    // build runway for: getting there is navigation, not scrolling.
    if (!drag && box.top < 0 && box.top > -RUNWAY) extendSpine(-1);
    syncView();
  });
}, { passive: true });

// --- selection ----------------------------------------------------------
function setSelection(runs) {
  state.runs = normalize(runs);
  paint();
}

const selectRun = (a, b) => setSelection([{ from: Math.min(a, b), to: Math.max(a, b) }]);

/** The run of days that reads as one thing at `day` -- what a double-click means. */
function naturalRun(day) {
  const mk = markIdx.get(day);
  if (mk) return { from: mk.from, to: mk.to };
  const info = dayInfo(day);
  if (isRest(info.status)) {
    let a = day, b = day;
    while (isRest(dayInfo(a - 1).status)) a--;
    while (isRest(dayInfo(b + 1).status)) b++;
    return { from: a, to: b };
  }
  let a = day, b = day;
  while (!isRest(dayInfo(a - 1).status)) a--;
  while (!isRest(dayInfo(b + 1).status)) b++;
  return { from: a, to: b };
}

let drag = null;
let edgeScroll = 0, edgeRaf = 0;

/** Keep scrolling while the pointer sits near the top or bottom of the view. */
function runEdgeScroll() {
  if (!drag || !edgeScroll) { edgeRaf = 0; return; }
  scrollBy(0, edgeScroll);
  edgeRaf = requestAnimationFrame(runEdgeScroll);
}
function setEdgeScroll(clientY) {
  const M = 72;
  const top = clientY - M;
  const bottom = clientY - (innerHeight - M);
  edgeScroll = top < 0 ? Math.max(top / 3, -28)
    : bottom > 0 ? Math.min(bottom / 3, 28) : 0;
  if (edgeScroll && !edgeRaf) edgeRaf = requestAnimationFrame(runEdgeScroll);
}

function dayFromEvent(e) {
  const cell = e.target.closest('[data-day]');
  return cell ? Number(cell.dataset.day) : null;
}

$('#grid').addEventListener('pointerdown', (e) => {
  // A month label in the gutter selects its month -- the row header is the
  // month's handle, and it is already the thing the eye uses to find one.
  const gut = e.target.closest('.gutter');
  if (gut && e.button === 0) {
    e.preventDefault();
    const mid = Number(gut.dataset.week) + 3;
    selectRun(monthStart(mid), addMonths(monthStart(mid), 1) - 1);
    state.focus = monthStart(mid);
    paint();
    return;
  }

  const n = dayFromEvent(e);
  if (n === null || e.button !== 0) return;
  e.preventDefault();
  $('#grid').focus({ preventScroll: true });

  if (e.shiftKey) {
    // Extend from the cursor, keeping any other runs already selected.
    const rest = state.runs.filter((r) => !(state.focus >= r.from && state.focus <= r.to));
    setSelection([...rest, { from: Math.min(state.focus, n), to: Math.max(state.focus, n) }]);
    return;
  }

  // ⌘ / Ctrl adds to the selection instead of replacing it; on a day that is
  // already selected it takes that day's run back out, which is the one
  // gesture every file manager and canvas shares.
  const additive = e.metaKey || e.ctrlKey;
  drag = {
    start: n,
    moved: false,
    additive,
    base: additive ? state.runs.map((r) => ({ ...r })) : [],
    toggled: additive && runsContain(state.runs, n),
  };
  state.focus = n;
  if (additive) setSelection(toggleRun(state.runs, n, n));
  else selectRun(n, n);
});

addEventListener('pointermove', (e) => {
  if (!drag) return;
  setEdgeScroll(e.clientY);
  const n = dayFromEvent(e);
  if (n === null || (n === drag.start && !drag.moved)) return;
  if (n !== drag.start) drag.moved = true;
  if (!drag.moved) return;
  const run = { from: Math.min(drag.start, n), to: Math.max(drag.start, n) };
  state.focus = n;
  setSelection(drag.additive
    ? (drag.toggled ? subtractRun(drag.base, run.from, run.to) : addRun(drag.base, run))
    : [run]);
});

addEventListener('pointerup', () => { drag = null; edgeScroll = 0; });
addEventListener('pointercancel', () => { drag = null; edgeScroll = 0; });

$('#grid').addEventListener('dblclick', (e) => {
  const n = dayFromEvent(e);
  if (n === null) return;
  e.preventDefault();
  const run = naturalRun(n);
  setSelection(e.metaKey || e.ctrlKey ? addRun(state.runs, run) : [run]);
});

// --- keyboard -----------------------------------------------------------
$('#grid').addEventListener('keydown', (e) => {
  const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key in STEP) {
    e.preventDefault();
    const next = state.focus + (state.unit === 'day' ? Math.sign(STEP[e.key]) : STEP[e.key]);
    if (e.shiftKey) {
      // Grow the run the cursor is in, leaving any other runs alone.
      const cur = runAt(state.runs, state.focus);
      const rest = state.runs.filter((r) => r !== cur);
      const from = cur ? cur.from : state.focus;
      setSelection([...rest, { from: Math.min(from, next), to: Math.max(from, next) }]);
    } else {
      state.runs = [];
    }
    state.focus = next;
    const v = range();
    if (next < v.from || next > v.to) { reveal(next); if (!scrolling()) render(); else paint(); }
    else paint();
    return;
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const r = range();
    state.focus = e.key === 'Home' ? r.from : r.to;
    paint(); return;
  }
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    step(e.key === 'PageUp' ? -1 : 1);
    return;
  }
  if (e.key === 'Escape') { setSelection([]); return; }
  if (e.key === 't' || e.key === 'T') {
    goToToday(); return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectRun(state.focus, state.focus);
    return;
  }
});

/**
 * 1-6 write a label across the selection; 0 or Delete takes it back off.
 *
 * On the document, not on the grid: accepting a 拼假 suggestion selects days
 * but leaves focus on the button in the rail, and a shortcut that works only
 * when you happen to have clicked the grid last is a shortcut that looks
 * broken. The selection is the subject, so the selection is the condition.
 */
addEventListener('keydown', (e) => {
  if (!state.runs.length || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (/^[1-6]$/.test(e.key)) {
    e.preventDefault();
    applyLabel(LABELS[Number(e.key) - 1].key);
  } else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    commitMarks(clearRuns(state.marks, state.runs));
  }
});

function goToToday() {
  state.focus = today;
  state.ribbonYear = fromDayNumber(today).y;
  if (scrolling()) { goTo(today); paint(); }
  else { state.anchor = anchorFor(today); state.runs = []; render(); }
}

function anchorFor(day) {
  if (state.unit === 'week') return weekStart(day);
  if (state.unit !== 'month') return day;
  // 12 months means "the year", so snap to January rather than starting the
  // year on whatever month happened to be in view.
  if (state.count === 12) return cstDayNumber(fromDayNumber(day).y, 1, 1);
  return monthStart(day);
}

// --- marking ------------------------------------------------------------
function applyLabel(key, note = '') {
  if (!state.runs.length) return;
  commitMarks(putMarks(state.marks, state.runs, { label: key, note }));
}

// --- export -------------------------------------------------------------
/**
 * A download, not an upload.
 *
 * The whole export path runs in this tab: the ICS text is built from the same
 * engine that drew the grid, wrapped in a Blob, and handed to the browser. No
 * request leaves the machine, which is the only way a calendar of someone's
 * sick days can honestly be offered.
 */
function download(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function say(msg) {
  const el = $('#grid-note');
  el.textContent = msg;
  clearTimeout(say._t);
  say._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

// --- controls -----------------------------------------------------------
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    if (chip.dataset.custom) {
      const note = prompt('写点什么？（留空则用「纪念」）', '');
      if (note === null) return;
      applyLabel('event', note.trim().slice(0, 40));
    } else {
      applyLabel(chip.dataset.label);
    }
    return;
  }

  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.act === 'prev') step(-1);
  if (btn.dataset.act === 'next') step(1);
  if (btn.dataset.act === 'today') goToToday();
  if (btn.dataset.act === 'year-prev') { state.ribbonYear--; renderRibbon(); syncControls(); }
  if (btn.dataset.act === 'year-next') { state.ribbonYear++; renderRibbon(); syncControls(); }
  if (btn.dataset.act === 'theme') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('changli-theme', state.theme);
    document.documentElement.dataset.theme = state.theme;
    renderRibbon();
  }
  if (btn.dataset.act === 'unmark') {
    commitMarks(clearRuns(state.marks, state.runs));
  }
  if (btn.dataset.act === 'export-marks') {
    download('长历-我的标记.ics', icsFromMarks(state.marks));
    say(`已导出 ${state.marks.length} 段标记。在日历 App 里打开这个文件即可导入。`);
  }
  if (btn.dataset.act === 'export-gov') {
    const r = range();
    const y0 = fromDayNumber(r.from).y, y1 = fromDayNumber(r.to).y;
    download(`长历-法定节假日-${y0}${y1 !== y0 ? `—${y1}` : ''}.ics`, icsFromStatutory(y0, y1));
    say(`已导出 ${y0}${y1 !== y0 ? `—${y1}` : ''} 年的休与班。`);
  }
  if (btn.dataset.act === 'copy-feed') {
    navigator.clipboard?.writeText(btn.dataset.url)
      .then(() => say('订阅链接已复制。在 Google 日历里选「从网址添加日历」。'))
      .catch(() => say(btn.dataset.url));
  }
  if (btn.dataset.delFrom) {
    commitMarks(clearRuns(state.marks, [{
      from: Number(btn.dataset.delFrom), to: Number(btn.dataset.delTo),
    }]));
  }
  if (btn.dataset.goto) {
    const from = Number(btn.dataset.from), to = Number(btn.dataset.to);
    state.focus = from;
    setSelection([{ from, to }]);
    reveal(from);
    $('#grid').focus({ preventScroll: true });
  }
  if (btn.dataset.unit) {
    // Keep the day the user was looking at, not the corner of the old view --
    // switching from a quarter to a week should not throw you into last month.
    const r = range();
    const keep = state.focus >= r.from && state.focus <= r.to ? state.focus : r.from;
    state.unit = btn.dataset.unit;
    if (!COUNTS[state.unit].includes(state.count)) {
      state.count = state.unit === 'month' ? 3 : state.unit === 'week' ? 4 : 7;
    }
    state.anchor = anchorFor(keep);
    render();
  }
  if (btn.dataset.count) {
    const r = range();
    const keep = state.focus >= r.from && state.focus <= r.to ? state.focus : r.from;
    state.count = Number(btn.dataset.count);
    state.anchor = anchorFor(keep);
    render();
  }
  if (btn.dataset.layout) {
    const r = range();
    state.anchor = anchorFor(state.focus >= r.from && state.focus <= r.to ? state.focus : r.from);
    state.layout = btn.dataset.layout;
    render();
  }

  const bridge = e.target.closest('.bridge');
  if (bridge) {
    // Accepting a 拼假 suggestion selects the days you would burn, not the
    // whole run: the leave is what you are about to mark, and the connected
    // rest around it is what it buys.
    const gapFrom = Number(bridge.dataset.gapFrom), gapTo = Number(bridge.dataset.gapTo);
    setSelection([{ from: gapFrom, to: gapTo }]);
    state.focus = gapFrom;
    reveal(Number(bridge.dataset.from));
    $('#grid').focus({ preventScroll: true });
    paint();
  }
});

// --- ribbon drag --------------------------------------------------------
{
  const svg = $('#ribbon-svg');
  let rdrag = null;

  const dayAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const frac = (clientX - box.left) / box.width;
    const span = svg._y1 - svg._y0 + 1;
    return svg._y0 + Math.round(frac * span);
  };

  svg.addEventListener('pointerdown', (e) => {
    const r = range();
    const day = dayAt(e.clientX);
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
    // Grab inside the window: carry it. Outside: jump the window here first.
    const inside = day >= r.from && day <= r.to;
    rdrag = { offset: inside ? day - r.from : 0 };
    if (!inside) glideTo(day);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!rdrag) return;
    glideTo(dayAt(e.clientX) - rdrag.offset);
  });

  const endDrag = (e) => {
    if (!rdrag) return;
    rdrag = null;
    svg.classList.remove('dragging');
    if (e && e.pointerId != null && svg.hasPointerCapture?.(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
}

/**
 * Measure the fixed chrome: masthead, then masthead + ribbon.
 *
 * The weekday header and the month label stick *below* the ribbon, and the
 * ribbon's height changes with the viewport (the svg is shorter on a phone,
 * the controls wrap). Hardcoding the offsets meant the header either floated
 * over the ribbon or left a gap under it, so they are measured and published
 * as --masthead-h / --chrome-h.
 */
function measureChrome() {
  const masthead = $('.masthead');
  const ribbon = $('.ribbon-wrap');
  const root = document.documentElement;
  // Static below 720px: the offsets are only meaningful while they are sticky.
  const stuck = getComputedStyle(masthead).position === 'sticky';
  const mh = stuck ? masthead.offsetHeight : 0;
  const chrome = stuck ? mh + ribbon.offsetHeight : 0;
  root.style.setProperty('--masthead-h', `${mh}px`);
  root.style.setProperty('--chrome-h', `${chrome}px`);
  // The sheet's own header stacks below the mark bar, which pins in both
  // layouts -- on a phone it is the only way to reach the labels at all.
  root.style.setProperty('--sheet-top',
    `${chrome + ($('#markbar')?.offsetHeight || 0)}px`);
}

// keep the ribbon honest when the viewport changes
let ro;
if (window.ResizeObserver) {
  ro = new ResizeObserver(() => { renderRibbon(); measureChrome(); });
  ro.observe($('#ribbon'));
  ro.observe($('.masthead'));
  // the bar changes height when the chips wrap at a narrow width
  ro.observe($('#markbar'));
}
addEventListener('resize', measureChrome);

buildChips();
measureChrome();
render();
