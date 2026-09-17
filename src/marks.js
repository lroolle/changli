// marks.js -- runs of days, and what the reader writes on them.
//
// The sheet is printed: the State Council decides 休/班, the sky decides 农历
// and 节气. A mark is the other kind of fact -- what *you* decided. That is why
// a mark is never a fifth status colour: it is a run of days with a label
// written across it, kept on this machine, and exported as a file you own.
//
// A mark is a *run*, not a day. "年假 9月28日—10月7日" is one thing a person
// decided once; ten separate day-marks would be ten things the interface then
// has to re-assemble every time it draws or exports. 拼假 already speaks in
// runs, so accepting a 拼假 suggestion is a mark with no translation step.
//
// Everything here is pure and DOM-free. The run algebra is the part that
// silently loses a day at a boundary, so test/verify-marks.mjs holds it to the
// same standard as the astronomy.

/**
 * The built-in labels.
 *
 * Six, in the order a working person reaches for them. Each is carried by its
 * own characters, not by a colour -- which is what lets marks sit on the same
 * sheet as the four status roles without competing with them.
 *
 * `kind` is what the label means to the ledger:
 *   leave  spends days from an allowance -- the ledger totals these
 *   work   a working day spent somewhere else; it is not time off
 *   note   a day worth remembering; costs nothing
 */
export const LABELS = [
  { key: 'annual',   name: '年假',  kind: 'leave' },
  { key: 'comp',     name: '调休',  kind: 'leave' },
  { key: 'sick',     name: '病假',  kind: 'leave' },
  { key: 'personal', name: '事假',  kind: 'leave' },
  { key: 'travel',   name: '出差',  kind: 'work'  },
  { key: 'event',    name: '纪念',  kind: 'note'  },
];

export const LABEL_KEYS = LABELS.map((l) => l.key);
export const labelOf = (key) => LABELS.find((l) => l.key === key) || null;
export const labelName = (mark) =>
  (mark.note || '').trim() || (labelOf(mark.label)?.name ?? '标记');

// --- run algebra --------------------------------------------------------
// A run is { from, to } in day numbers, inclusive at both ends. Runs in a list
// are kept sorted, non-overlapping and non-touching, so "the marks" and "the
// selection" are always in one canonical shape and equality is cheap.

export const runLength = (r) => r.to - r.from + 1;
export const totalDays = (runs) => runs.reduce((n, r) => n + runLength(r), 0);
export const runsContain = (runs, day) =>
  runs.some((r) => day >= r.from && day <= r.to);

/** The run containing `day`, or null. */
export const runAt = (runs, day) =>
  runs.find((r) => day >= r.from && day <= r.to) || null;

/**
 * Sort, merge and return a canonical list.
 *
 * Touching counts as overlapping: 9月28—30 followed by 10月1—7 is one run of
 * leave, and a reader who dragged twice meant one thing. `same` decides
 * whether two neighbours may merge at all -- selection runs always may, marks
 * only when they carry the same label, or 年假 would swallow the 出差 next to it.
 */
export function normalize(runs, same = () => true) {
  const sorted = [...runs]
    .filter((r) => Number.isInteger(r.from) && Number.isInteger(r.to) && r.to >= r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1 && same(last, r)) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

const sameLabel = (a, b) => a.label === b.label && (a.note || '') === (b.note || '');

/** Add a run, merging it into whatever it touches. */
export const addRun = (runs, run, same) => normalize([...runs, run], same);

/**
 * Remove [from, to] from every run.
 *
 * A cut through the middle of a run leaves two runs -- this is the operation
 * that loses a day if either edge is off by one, so both halves are written
 * explicitly rather than derived.
 */
export function subtractRun(runs, from, to) {
  const out = [];
  for (const r of runs) {
    if (to < r.from || from > r.to) { out.push({ ...r }); continue; }
    if (from > r.from) out.push({ ...r, to: from - 1 });
    if (to < r.to) out.push({ ...r, from: to + 1 });
  }
  return out;
}

/** Fully covered -> remove it; otherwise add it. The additive-click rule. */
export function toggleRun(runs, from, to) {
  const covered = [];
  for (let n = from; n <= to; n++) covered.push(runsContain(runs, n));
  return covered.every(Boolean) ? subtractRun(runs, from, to) : addRun(runs, { from, to });
}

// --- the mark store -----------------------------------------------------

/**
 * Write a mark over [from, to].
 *
 * A day carries exactly one mark. Writing over days that already carry one
 * replaces them -- the alternative is stacked labels on a 4.4rem cell, which
 * cannot be drawn honestly and cannot be exported without inventing a rule for
 * which one wins. Replace is the rule a paper diary uses: you cross out and
 * write again.
 */
export function putMark(marks, { from, to, label, note = '' }) {
  const a = Math.min(from, to), b = Math.max(from, to);
  const cleared = subtractRun(marks, a, b);
  return normalize([...cleared, { from: a, to: b, label, note }], sameLabel);
}

/** Write the same label over several runs at once -- one selection, one act. */
export function putMarks(marks, runs, { label, note = '' }) {
  return runs.reduce((acc, r) => putMark(acc, { ...r, label, note }), marks);
}

export function clearMarks(marks, from, to) {
  return subtractRun(marks, Math.min(from, to), Math.max(from, to));
}

export const clearRuns = (marks, runs) =>
  runs.reduce((acc, r) => clearMarks(acc, r.from, r.to), marks);

export const markAt = (marks, day) => runAt(marks, day);

/** day number -> mark, for drawing a grid cell without scanning the list. */
export function markIndex(marks) {
  const index = new Map();
  for (const m of marks) for (let n = m.from; n <= m.to; n++) index.set(n, m);
  return index;
}

/**
 * Days and runs per label, in LABELS order.
 *
 * Only labels actually used are returned: an empty row that says 病假 0 天 is
 * a suggestion, and the ledger is supposed to report, not suggest.
 */
export function totals(marks) {
  const by = new Map();
  for (const m of marks) {
    const cur = by.get(m.label) || { label: m.label, days: 0, runs: 0 };
    cur.days += runLength(m);
    cur.runs += 1;
    by.set(m.label, cur);
  }
  return LABEL_KEYS.map((k) => by.get(k)).filter(Boolean);
}

/** Marks overlapping [from, to], clipped to it. For the ledger of a view. */
export function marksWithin(marks, from, to) {
  return marks
    .filter((m) => m.to >= from && m.from <= to)
    .map((m) => ({ ...m, from: Math.max(m.from, from), to: Math.min(m.to, to) }));
}

// --- persistence --------------------------------------------------------
export const STORE_KEY = 'changli-marks-v1';

/**
 * Read marks back, refusing anything that is not exactly the shape we wrote.
 *
 * A corrupt or hand-edited entry must cost the reader their marks, never their
 * calendar: every failure path here returns a usable list and the grid still
 * draws. localStorage is also the one API that throws on read in private mode.
 */
export function loadMarks(store) {
  try {
    const raw = store?.getItem(STORE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const clean = data
      .filter((m) => m && Number.isInteger(m.from) && Number.isInteger(m.to) && m.to >= m.from)
      .filter((m) => LABEL_KEYS.includes(m.label))
      .map((m) => ({
        from: m.from,
        to: m.to,
        label: m.label,
        note: typeof m.note === 'string' ? m.note.slice(0, 80) : '',
      }));
    return normalize(clean, sameLabel);
  } catch {
    return [];
  }
}

export function saveMarks(store, marks) {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(marks));
    return true;
  } catch {
    return false;   // quota or private mode: the session still works
  }
}
