# DESIGN.md -- the material

Read this before touching anything under `index.html`, `assets/app.css`
or `src/ui.js`. `TASTE.md` holds prior rulings; this file holds the
material. The one-line test for any UI change: **a change that makes the
surface prettier and the task harder must fail.**

## Direction

World: **節氣盤 unrolled** (the 24-solar-term wheel, cut and laid flat)
on material **industry**, re-seeded as "almanac paper and one red ink".
Roll key `3edd49ea`; assigned candidate #6 of 7; chosen 2026-08-24
because the job is to let one person read a whole planning horizon at
once, and a wheel's concentric rings become stacked lanes over a
continuous run of days -- which is exactly the thing month cards cannot
do.

Hand rejected:

| Challenger | Verdict | What was kept |
|---|---|---|
| Patent Drawing Sheets (graphic) | declined | line discipline: two hairline weights and no fills except the one status tint; the 班 section hatching |
| Bamboo Slip Scroll (竹简, interaction) | declined | the cord as alignment: full-width rules lacing independent columns into one sheet, which is why weeks run unbroken across months |
| Games Pictogram Program (atmosphere) | competitive | the role program: a closed set of status roles, each meaning exactly one thing, identical in every view and stated in a legend |

The five-block promise (THESIS / OWN-WORLD / STORY / FIRST VIEWPORT /
FORM) lives in `index.html`'s first body comment. This file records the
material the promise was kept with, written at finish from the built
surface.

Scene: someone at a desk mid-afternoon with three tabs open, trying to
answer "when can I actually take a week off" before a call starts.

## Surface and mode

**operate.** Density is a feature. Expression lives in the rules, the
numerals and the two inks -- never over state or affordance.

Protected functions (must not break, ever):

- the 休 / 班 distinction, and the fact that each traces to a published notice
- the lunar date on every cell
- the ability to see more than one month without paging
- today's position
- keyboard traversal and selection
- a mark, once written, survives a reload -- it is the only thing here the
  reader authored
- nothing leaves the machine: an export is built in the tab and handed to the
  browser as a file

## The material

Tokens live in `assets/tokens.css`. App code uses tokens only; a raw
hex or `oklch()` outside that file is a defect.

| Dimension | Value | Law |
|---|---|---|
| Color seed | hue 240 (cool 历书 paper), neutrals C 0.005-0.023 | Light is almanac stock; dark is the 苏州石刻天文图 stone rubbing -- two printings of one tradition, not an inversion. Never chroma 0, never pure black or white. |
| Strategy | restrained | Colour appears only on the four status roles. The page is ink on paper plus one red. |
| Accent | `--accent: oklch(0.545 0.185 30)` (朱砂 vermillion) | One accent: statutory holidays, today, selection, focus-adjacent affordances. |
| Type | almanac `Songti SC` stack / body `PingFang SC` stack / mono system | No webfont: a CJK face costs 5-20 MB and this tool must open offline and instantly, so the stacks are named explicitly and the world is carried by rules, scale and the two inks. Ratio 1.2, base 15px. CJK leading 1.75. |
| Radius | `--radius: 0.125rem`, one corner language | This is a ruled sheet; corners are nearly square. |
| Surfaces | 1px + 2px rules and tone steps | Structure before shadow. Shadow only on the rail; regions are ruled, never floated. |
| Motion | 60 / 120 / 200 ms, `cubic-bezier(0.2,0,0,1)` | Mechanical. The ribbon tracks the pointer 1:1 with no easing. Reduced motion cuts everything. |
| Marks | `--mark-ink / -rule / -field / -edge`, neutral, no hue | The sheet is printed; a mark is the reader's hand. Graphite over print, in a lane every cell reserves. It earns a token family, never a colour. See TASTE.md 2026-09-16. |

## The status program

Four roles. **Nothing else in the interface is allowed to carry colour.**

| Role | Token | Means | Drawn as |
|---|---|---|---|
| `holiday` | `--st-holiday-*` | 休 -- statutory day off, named by the State Council notice | vermillion field, vermillion numeral, 休 badge |
| `makeup` | `--st-makeup-*` | 班 -- a weekend the notice turns into a working day | neutral field under 45-degree section hatching, 班 badge |
| `weekend` | `--st-weekend-*` | ordinary Saturday or Sunday | quiet tinted field |
| `workday` | `--st-workday-*` | everything else | bare paper |

A personal mark is **not** a fifth role. It is a different material in its own
lane -- see the Marks row above -- so that a day can be both 休 and 年假 without
either fact dimming the other.

A 节气 is **not** a fifth colour. It earns emphasis with the almanac
face at full ink strength; ordinary lunar days sit back at `--fg-3`.
A block-printed almanac has exactly two inks and so does this.

## Structure

The calendar is **one continuous CSS grid**: a gutter column plus seven
weekday columns, and every row is a real consecutive week.

- No padding cells and no blanks in `flow` layout. 8/31 and 9/1 are adjacent.
- A month boundary is a **stepped 2px rule** running from the 1st to the end
  of its row, plus a label in the gutter. A month boundary genuinely falls
  mid-week; a card would have to lie about that with a row of blanks.
- The gutter is the 月建 lane -- the ribbon's month ring stood on end. It
  carries the alternating month band so the cells never have to, which is
  what keeps the four status colours meaning exactly one thing each.
- A week row belongs to whichever month owns its **Thursday**. That is the
  rule that makes the band agree with the label instead of fighting it.
- `blocks` layout exists for people who want the familiar month card and
  reuses the same cells; it is the only place a blank pad cell may appear.
- The chrome **stays**: masthead, ribbon, mark bar and weekday header are all
  sticky, stacked in that order, and the sheet glides beneath them. On an
  endless surface anything that scrolls away is gone exactly when it is wanted
  -- the ribbon is how a whole year is read and how the reader travels, and the
  mark bar is how a selection becomes a mark. A selection made four screens
  down is useless if its labels stayed at the top of the document. Offsets are
  measured into `--masthead-h` / `--chrome-h` / `--sheet-top` by `ui.js`,
  because each bar's height changes with the viewport.
- Every cell reserves a **lane** at its bottom edge (`--lane`) whether or not it
  carries a mark. A ruled diary leaves one; here it also means writing a label
  never grows a row, which the scrolling sheet depends on.
- `flow` is a **spine**, not a page: weeks are inserted at whichever end the
  reader approaches and pruned from the other, and the nav -- title, ribbon
  window, ledger, 拼假 -- follows what is on screen rather than a page number.
  The visible span is found by binary search over the rows, because a week
  carrying a month rule is 2px taller than its neighbours and a uniform-height
  guess drifts into naming the wrong month. Extensions insert; they never
  rebuild, because a drag may be in flight across the sheet.

## Data, and what may be claimed

Two different kinds of truth, and the interface must not blur them.

- **Astronomy is computed.** 农历 months and 节气 come from JPL DE440s via
  `src/ephemeris.js` (generated, 1900-2100), with `src/astro.js` as the
  Meeus fallback outside that range. Verified day-for-day against an
  independent implementation across 1970-2070.
- **Holidays are policy.** 休 / 班 come from the State Council's annual
  notice via `src/holidays.js`, and every year links to its gov.cn
  document in the legend. A year with no notice published shows "尚未公布"
  and refuses to compute 拼假. **Never infer a statutory holiday.**

## Check before shipping a UI change

- every value traces to a token in `assets/tokens.css`; no raw hex or `oklch()` outside it
- contrast measured, not eyeballed, in **both** themes
- 390 / 768 / 1440 captured; no horizontal scroll at 390; touch targets >= 44px
- `node test/verify.js` passes -- a UI change should never move a date
- the four status roles still mean exactly one thing each
- a mark changes no row's height: write one on a day and nothing below it moves
- `node test/verify-marks.mjs` passes -- the run algebra keeps both edges, and
  an exported all-day event still ends the day *after* it ends
