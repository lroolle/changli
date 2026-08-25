// ui.js -- the surface.
//
// One idea runs through all of it: the visible range is a pair of day numbers,
// and every view is a different way of drawing the same continuous run. The
// unit and count only decide where the run starts and stops; they never chop
// it into cards. That is why 8/31 and 9/1 land side by side.

import {
  dayInfo, todayDayNumber, cstDayNumber, fromDayNumber,
  monthStart, monthEnd, addMonths, weekStart,
  summarize, bridges, restRuns, termContext, ganzhiYear,
  hasHolidayData, holidayPaper, STATUS, isRest,
} from './calendar.js';
import { EPHEMERIS_RANGE } from './ephemeris.js';

const $ = (sel, root = document) => root.querySelector(sel);
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const COUNTS = { day: [1, 3, 7, 14], week: [1, 2, 4, 8], month: [1, 2, 3, 6, 12] };

// --- state --------------------------------------------------------------
const today = todayDayNumber();
const state = {
  unit: 'month',
  count: 3,
  anchor: monthStart(today),
  layout: 'flow',
  focus: today,          // the day the rail describes
  sel: null,             // { from, to } or null
  ribbonYear: fromDayNumber(today).y,
  theme: localStorage.getItem('changli-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
};

/** The visible run of days, [from, to]. */
function range() {
  const { unit, count, anchor } = state;
  if (unit === 'day') return { from: anchor, to: anchor + count - 1 };
  if (unit === 'week') {
    const from = weekStart(anchor);
    return { from, to: from + count * 7 - 1 };
  }
  const from = monthStart(anchor);
  return { from, to: addMonths(from, count) - 1 };
}

/** Move the range by whole units. */
function step(dir) {
  const { unit, count } = state;
  if (unit === 'day') state.anchor += dir * count;
  else if (unit === 'week') state.anchor = weekStart(state.anchor) + dir * count * 7;
  else state.anchor = addMonths(state.anchor, dir * count);
  render();
}

/** Put `day` inside the visible range, moving the range as little as needed. */
function reveal(day) {
  let guard = 0;
  while (day < range().from && guard++ < 400) step(-1);
  while (day > range().to && guard++ < 400) step(1);
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

// --- render: the grid ---------------------------------------------------
function cellHTML(n, opts) {
  const info = dayInfo(n);
  const attrs = [
    `data-day="${n}"`,
    `data-st="${info.status}"`,
  ];
  if (n === today) attrs.push('data-today="1"');
  if (opts.monthStart) attrs.push('data-mstart="1"');
  if (opts.monthRule) attrs.push('data-mrule="1"');
  if (opts.outside) attrs.push('data-outside="1"');
  if (state.focus === n) attrs.push('data-cursor="1"');
  if (state.sel && n >= state.sel.from && n <= state.sel.to) {
    attrs.push('data-sel="1"');
    if (n === state.sel.from) attrs.push('data-sel-start="1"');
    if (n === state.sel.to) attrs.push('data-sel-end="1"');
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
  ].join(' ');

  return `<div class="cell" role="gridcell" tabindex="-1" ${attrs.join(' ')} aria-label="${aria}">
    ${mark}<b class="d-num">${info.d}</b>
    <span class="d-label is-${info.labelKind}">${info.label}</span>
  </div>`;
}

function headerHTML(withGutter) {
  const cells = WEEKDAYS.map((w, i) =>
    `<span class="${i >= 5 ? 'we' : ''}">${w}</span>`).join('');
  return (withGutter ? '<div class="gh-gutter"></div>' : '') + `<div class="gh" role="row">${cells}</div>`;
}

/** The continuous sheet: whole weeks, no gaps, month boundaries as rules. */
function renderFlow(from, to) {
  const start = weekStart(from);
  const end = weekStart(to) + 6;
  let html = `<div class="gsheet" role="grid">${headerHTML(true)}`;
  let lastBand = null;
  for (let w = start; w <= end; w += 7) {
    // A week row belongs to whichever month owns its Thursday -- the rule that
    // makes the band agree with the label instead of fighting it.
    const band = dayInfo(w + 3);
    const label = band.m === lastBand ? '' : `${band.m}月`;
    lastBand = band.m;
    html += `<div class="gutter" role="rowheader" data-band="${band.m % 2}">${label ? `<b>${label}</b>` : ''}</div>`;
    let past = false;
    for (let i = 0; i < 7; i++) {
      const n = w + i;
      const first = dayInfo(n).d === 1;
      if (first) past = true;
      html += cellHTML(n, {
        monthStart: first,
        monthRule: past && w !== start,
        outside: n < from || n > to,
      });
    }
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
    const attrs = [`data-day="${n}"`, `data-st="${info.status}"`];
    if (n === today) attrs.push('data-today="1"');
    if (state.sel && n >= state.sel.from && n <= state.sel.to) attrs.push('data-sel="1"');
    const mark = info.status === STATUS.HOLIDAY ? '<span class="d-mark rest">休</span>'
      : info.status === STATUS.MAKEUP ? '<span class="d-mark work">班</span>' : '';
    const fests = info.festivals.length
      ? `<span class="dr-fest">${info.festivals.join(' · ')}</span>` : '';
    const term = info.term ? `<span class="dr-term">${info.term.name}</span>`
      : tc.current ? `<span class="dr-term">${tc.current.name} 第 ${tc.current.nth} 天</span>` : '';
    html += `<div class="dayrow" role="listitem" tabindex="-1" ${attrs.join(' ')}>
      <span class="dr-date">
        <b class="dr-n">${info.d}</b>
        <span class="dr-wd">${info.m}月<br>周${WEEKDAYS[info.weekday - 1]}</span>
      </span>
      <span class="dr-mid">
        <span class="dr-lunar">${info.lunar.monthName}${info.lunar.dayName}</span>
        ${term}${fests}
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

  // three lanes, the concentric rings laid flat
  const L1 = { y: 2, h: 14 };                 // 月建
  const L2 = { y: 20, h: H - 20 - 26 };       // 節氣
  const L3 = { y: H - 24, h: 20 };            // 休/班

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
    p.push(`<text class="rb-month-label" x="${W / 2}" y="${L3.y + 14}" text-anchor="middle">${year} 年放假安排尚未公布</text>`);
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
        p.push(`<text class="rb-holiday-name" x="${a + w / 2}" y="${L3.y + 13.5}" text-anchor="middle">${short}</text>`);
      }
    }
    for (let n = y0; n <= y1; n++) {
      if (dayInfo(n).status !== STATUS.MAKEUP) continue;
      p.push(`<rect class="rb-makeup" x="${x(n)}" y="${L3.y + L3.h - 5}" width="${Math.max(x(n + 1) - x(n), 1.5)}" height="5"/>`);
    }
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
    p.push(`<rect class="rb-window-grip" x="${wa}" y="1" width="2" height="${H - 2}"/>`);
    p.push(`<rect class="rb-window-grip" x="${wb - 2}" y="1" width="2" height="${H - 2}"/>`);
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = p.join('');
  $('#ribbon-desc').textContent =
    `${year} 年概览：24 节气与法定假期分布，当前视图为 ${isoOf(r.from)} 至 ${isoOf(r.to)}。`;
  svg._x = x; svg._y0 = y0; svg._y1 = y1; svg._W = W;
}

// --- render: the rail ---------------------------------------------------
function renderDayCard() {
  const n = state.focus;
  const info = dayInfo(n);
  const tc = termContext(n);
  const gz = ganzhiYear(info.lunar.year);
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

function renderLedger() {
  const r = state.sel || range();
  const s = summarize(r.from, r.to);
  const scope = state.sel ? '已选区间' : '当前视图';
  const rows = [
    ['天数', `${s.total}`, false],
    ['休息', `${s.off}`, true],
    ['其中法定', `${s.statutory}`, false],
    ['需上班', `${s.leave}`, false],
  ];
  if (s.makeup) rows.push(['其中调休班', `${s.makeup}`, false]);
  const longest = restRuns(r.from, r.to).reduce((a, b) => (b.length > (a?.length || 0) ? b : a), null);
  $('#ledger').innerHTML =
    `<p class="lg-span">${scope} · ${mdOf(r.from)} — ${mdOf(r.to)}</p>` +
    rows.map(([k, v, hot]) =>
      `<div class="lg-row"><span class="lg-k">${k}</span><span class="lg-v${hot ? ' hot' : ''}" data-num>${v}</span></div>`).join('') +
    (longest ? `<div class="lg-row"><span class="lg-k">最长连休</span><span class="lg-v" data-num>${longest.length} 天${longest.clipped ? '+' : ''}</span></div>` : '');
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
  const sel = state.sel;
  for (const el of document.querySelectorAll('#grid [data-day]')) {
    const n = Number(el.dataset.day);
    const inSel = !!sel && n >= sel.from && n <= sel.to;
    // setAttribute, not toggleAttribute: toggleAttribute writes an empty value
    // and every selector in app.css matches on ="1".
    flag(el, 'data-sel', inSel);
    flag(el, 'data-sel-start', inSel && n === sel.from);
    flag(el, 'data-sel-end', inSel && n === sel.to);
    flag(el, 'data-cursor', n === state.focus);
  }
  renderDayCard();
  renderLedger();
}

// --- render -------------------------------------------------------------
let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const r = range();
    const grid = $('#grid');
    if (state.unit === 'day') grid.innerHTML = renderDays(r.from, r.to);
    else if (state.layout === 'blocks') grid.innerHTML = renderBlocks(r.from, r.to);
    else grid.innerHTML = renderFlow(r.from, r.to);

    $('.range-title-main').textContent = rangeTitle(r.from, r.to);
    $('.range-title-sub').textContent =
      `${r.to - r.from + 1} 天 · ${isoOf(r.from)} — ${isoOf(r.to)}`;

    const note = state.unit === 'month' && state.count > 1 && state.layout === 'flow'
      ? '跨月连续排布：月份之间只有一条粗线，没有断行。'
      : '';
    $('#grid-note').textContent = note;

    renderRibbon();
    renderDayCard();
    renderLedger();
    renderBridges();
    renderProvenance();
    syncControls();
  });
}

function syncControls() {
  for (const b of document.querySelectorAll('[data-unit]')) {
    b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit));
  }
  for (const b of document.querySelectorAll('[data-layout]')) {
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

// --- selection ----------------------------------------------------------
function setSelection(a, b) {
  state.sel = { from: Math.min(a, b), to: Math.max(a, b) };
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
  const n = dayFromEvent(e);
  if (n === null || e.button !== 0) return;
  e.preventDefault();
  $('#grid').focus({ preventScroll: true });
  if (e.shiftKey) {
    setSelection(state.focus, n);
    paint();
    return;
  }
  drag = { start: n, moved: false };
  state.focus = n;
  state.sel = null;
  paint();
});

addEventListener('pointermove', (e) => {
  if (!drag) return;
  setEdgeScroll(e.clientY);
  const n = dayFromEvent(e);
  if (n === null || n === drag.start && !drag.moved) return;
  if (n !== drag.start) drag.moved = true;
  if (drag.moved) { setSelection(drag.start, n); state.focus = n; paint(); }
});

addEventListener('pointerup', () => { drag = null; edgeScroll = 0; });
addEventListener('pointercancel', () => { drag = null; edgeScroll = 0; });

// --- keyboard -----------------------------------------------------------
$('#grid').addEventListener('keydown', (e) => {
  const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key in STEP) {
    e.preventDefault();
    const next = state.focus + (state.unit === 'day' ? Math.sign(STEP[e.key]) : STEP[e.key]);
    if (e.shiftKey) setSelection(state.sel ? state.sel.from : state.focus, next);
    else state.sel = null;
    state.focus = next;
    const r = range();
    if (next < r.from || next > r.to) { reveal(next); render(); } else paint();
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
  if (e.key === 'Escape') { state.sel = null; paint(); return; }
  if (e.key === 't' || e.key === 'T') {
    state.focus = today; state.anchor = anchorFor(today); state.ribbonYear = fromDayNumber(today).y;
    render(); return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setSelection(state.focus, state.focus);
    paint();
  }
});

function anchorFor(day) {
  if (state.unit === 'week') return weekStart(day);
  if (state.unit !== 'month') return day;
  // 12 months means "the year", so snap to January rather than starting the
  // year on whatever month happened to be in view.
  if (state.count === 12) return cstDayNumber(fromDayNumber(day).y, 1, 1);
  return monthStart(day);
}

// --- controls -----------------------------------------------------------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.act === 'prev') step(-1);
  if (btn.dataset.act === 'next') step(1);
  if (btn.dataset.act === 'today') {
    state.focus = today;
    state.anchor = anchorFor(today);
    state.ribbonYear = fromDayNumber(today).y;
    state.sel = null;
    render();
  }
  if (btn.dataset.act === 'year-prev') { state.ribbonYear--; render(); }
  if (btn.dataset.act === 'year-next') { state.ribbonYear++; render(); }
  if (btn.dataset.act === 'theme') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('changli-theme', state.theme);
    render();
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
  if (btn.dataset.layout) { state.layout = btn.dataset.layout; render(); }

  const bridge = e.target.closest('.bridge');
  if (bridge) {
    setSelection(Number(bridge.dataset.from), Number(bridge.dataset.to));
    state.focus = Number(bridge.dataset.gapFrom);
    reveal(state.sel.from);
    render();
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
    rdrag = { offset: day >= r.from && day <= r.to ? day - r.from : 0 };
    if (!(day >= r.from && day <= r.to)) {
      state.anchor = anchorFor(day);
      render();
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!rdrag) return;
    const target = dayAt(e.clientX) - rdrag.offset;
    const a = anchorFor(target);
    if (a !== state.anchor) { state.anchor = a; render(); }
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

// keep the ribbon honest when the viewport changes
let ro;
if (window.ResizeObserver) {
  ro = new ResizeObserver(() => renderRibbon());
  ro.observe($('#ribbon'));
}

render();
