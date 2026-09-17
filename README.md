# 长历 changli

**A calendar that knows the rules.** — [changli.claw-lab.com](https://changli.claw-lab.com)

Everyone's time is governed by rules their software does not know. 调休 that
turns a Saturday into a workday. Bavaria's holidays being different from
Berlin's. Taiwan's 補班. Egypt resting on Friday. Schengen's 90-in-180 rolling
window. A calendar that knows these can answer questions no calendar can:

```
$ changli plan-leave CN 2026-08-01 2026-10-31
  Burn 3 days (Sep 28, 29, 30) -> 13 consecutive days off, Sep 25 to Oct 7.
```

Three parts: a **continuous calendar** you can actually plan a quarter in and
scroll forever, **marks** you write on it and export to Google or Apple
Calendar, and a **deterministic rules engine** over 47 jurisdictions, exposed to
agents over MCP.

![the three-month view](docs/shot-1440.png)

## The calendar

Months, weeks and days in **one uninterrupted run** — because planning a quarter
means seeing a quarter, and every calendar that shows one month at a time makes
you hold the other two in your head. 8/31 and 9/1 sit side by side; months are
divided by a rule and a gutter label, never by a gap.

- 1–14 days, 1–8 weeks, or 1–12 months, continuous or as familiar month blocks
- **拼假** — select a span and it tells you exactly which days to book
- 农历, 节气, 干支, 生肖 on every day
- Statutory 休 / 班, each year citing the gov.cn notice it came from
- Fixed UTC+8 wherever the browser is · light and dark · full keyboard
- No build step, no dependencies, no network at runtime

```
python3 -m http.server 8811    # then open http://localhost:8811
```

## Marking, exporting, subscribing

Drag across the days you are taking. Hold <kbd>⌘</kbd> and drag again to add a
second run somewhere else in the year. Double-click any day to select the whole
run it belongs to -- the entire 国庆 break, or the stretch of workdays between
two of them. Click a month in the gutter to take the month.

Then write a label across what you selected: 年假, 调休, 病假, 事假, 出差, 纪念,
or your own text. <kbd>1</kbd>–<kbd>6</kbd> do it from the keyboard, <kbd>0</kbd>
takes it back off. A 拼假 suggestion selects the days you would burn, so
accepting one is two clicks: the suggestion, then the label.

Marks are runs, not days -- "年假 9月28日—10月7日" is one thing you decided once.
They are drawn in graphite in the lane under each day, never in a colour,
because the four status colours on this sheet mean 休 / 班 / 周末 / 工作日 and
nothing else. They live in this browser's localStorage and go nowhere else.

```
导出我的标记 .ics        one all-day event per run, built in the tab
导出本视图法定假日 .ics   the 休/班 of the years you are looking at
```

And two feeds your calendar re-reads on its own, so 2027's 调休 arrives without
you doing anything:

```
webcal://changli.claw-lab.com/feed/cn-holidays.ics   休 runs + every 调休 workday
webcal://changli.claw-lab.com/feed/cn-terms.ics      24 节气 + traditional festivals
```

Policy and astronomy stay in separate feeds on purpose: one is published a year
at a time and can change, the other is computed and will not. Regenerate both
with `npm run data:ics`.

## The rules engine

`src/rules.js` is a deterministic solver — no model involved. "How many leave
days does this cost" is an exact question with an exact answer; an LLM would be
slower, dearer, and wrong sometimes.

Three things every other calendar gets wrong, and this one does not:

| | Why it matters |
|---|---|
| **Weekends are not always Sat+Sun** | Egypt and much of the Gulf rest Fri–Sat; Nepal rests Saturday alone. Hardcoding Sat+Sun is wrong twice a week for a large part of the world. |
| **Some states un-weekend a weekend** | CN 调休 and TW 補班 are real obligations. A holiday API that only lists *holidays* will tell you a working Saturday is free. |
| **A national holiday is often not national** | Heilige Drei Könige is a holiday in Bayern and a normal Tuesday in Berlin. |

**47 jurisdictions**, 2024–2027, with regional granularity where it exists —
16 German Bundesländer, 26 Swiss cantons, 17 Spanish comunidades, 45 US states,
13 Canadian provinces. CN and TW carry makeup workdays; nobody else does.

```js
import { jurisdiction, fromISO } from './src/rules.js';

const by = jurisdiction(await load('DE'), 'DE-BY');   // Bayern
const be = jurisdiction(await load('DE'), 'DE-BE');   // Berlin
by.statusOf(fromISO('2026-01-06'));   // 'holiday'
be.statusOf(fromISO('2026-01-06'));   // 'workday'
```

Also in here: `overlap()` — when is everyone across several jurisdictions free
at once — and `src/schengen.js`, the 90/180 rule counted the way a border guard
counts it (rolling window, arrival *and* departure days counting in full).

## Agent-native

Not a chat box bolted onto a month grid — the engine itself, over MCP:

```
claude mcp add changli -- node /abs/path/to/changli/mcp/server.mjs
```

Eight tools, zero dependencies, stdio JSON-RPC:

`list_jurisdictions` · `day_info` · `plan_leave` · `count_days` ·
`next_holiday` · `team_overlap` · `schengen_check` · `schengen_timeline`

Answers are computed, not generated, so an agent can treat the numbers as exact.

## Accuracy

Two kinds of truth, deliberately kept apart.

**Astronomy is computed.** Lunar months begin at the new moon and 节气 fall at
15° steps of solar longitude, both reduced to the civil date in UTC+8 — which is
what GB/T 33661-2017 says the 农历 actually is. `src/ephemeris.js` is generated
from **JPL DE440s** for 1900–2100; `src/astro.js` implements Meeus directly for
everything outside it.

**Holidays are policy.** Announced each year, not derivable. A year whose notice
has not been published says so and refuses to compute 拼假 rather than guessing.

```
npm test
```

- **394 astronomy anchors** — published 春节 dates 1990–2035, published leap
  months including 2033's 闰冬月 (the case that breaks table-driven
  implementations), a 30-year day-by-day walk, and the knife-edge boundaries
  that land within seconds of midnight in Beijing.
- Cross-checked day-for-day against an independent implementation over
  1970–2070: **0 differences in 36,890 days and 2,424 solar terms.**
- **39 solver anchors**, every one computable by hand. If the solver and a
  pencil disagree, the solver is wrong.
- **77 mark and export anchors**: where a run algebra loses a day at its edges,
  and the three things that decide whether a calendar app accepts a file at all
  -- the exclusive `DTEND`, folding at 75 *octets* rather than characters, and
  CRLF everywhere.

## Running and deploying

```
npm start          # http://localhost:8811 -- no build, no dependencies
npm test           # 394 astronomy anchors + 39 solver anchors
```

The site is three directories of static files, so it deploys as static assets
on Cloudflare Workers -- no build step, no server. It is live at
**[changli.claw-lab.com](https://changli.claw-lab.com)**; `*.workers.dev` is
blocked on mainland networks, so the custom domain is the only address the
audience for a 中国日历 can reach.

```
npm run deploy:check   # print the upload set, change nothing
npm run deploy         # needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit)
```

`.assetsignore` keeps the deploy to what a browser needs -- `index.html`,
`assets/`, `src/`. The rules corpus, MCP server, tests and docs stay in the
repo and off the edge. Pushes to `main` that touch a served file republish
through `.github/workflows/deploy.yml`, which runs `npm test` first.

## Regenerating data

```
npm run data:jurisdictions    # 47 jurisdictions from three sources
npm run data:holidays         # CN, from the published notices
npm run data:ics              # the two subscribable feeds in feed/
python3 test/gen-ephemeris.py # JPL DE440s (needs skyfield)
```

The ephemeris and the feeds both regenerate byte-identical -- the feeds carry a
pinned `DTSTAMP`, so a regeneration with no data change produces no diff. Holiday sources are cited per year in
each jurisdiction file.

## Layout

```
index.html            the calendar; the design promise is its first comment
assets/tokens.css     the only place colour is allowed to exist
src/astro.js          Meeus: solar longitude, new moons, ΔT, the 农历 rules
src/ephemeris.js      GENERATED: JPL boundaries 1900-2100, ~7 KB
src/holidays.js       GENERATED: State Council notices, 2015-2026
src/calendar.js       day records, the status program, 拼假
src/rules.js          the multi-jurisdiction solver
src/schengen.js       the 90/180 rule
src/ui.js             views, selection, the scrolling spine, the ribbon
src/marks.js          run algebra and the mark store -- pure, no DOM
src/ics.js            RFC 5545 out: exclusive DTEND, 75-octet folds, CRLF
feed/*.ics            GENERATED: the subscribable calendars
data/jurisdictions/   the rules corpus, 47 jurisdictions
mcp/server.mjs        MCP server, 8 tools, zero deps
DESIGN.md             the material contract — read before touching the UI
docs/product-brief.md where this is going
```

## Status

The web UI renders the CN calendar, scrolls continuously, and takes marks you
can export or subscribe to. The multi-jurisdiction engine is complete, tested
and reachable through MCP and the JS API, and is being wired into the UI next.
Marks are per-browser; there is no account and no sync back from a calendar
app. See `docs/product-brief.md`.

## Credits

CN holidays transcribed by [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)
from 国务院办公厅 notices · TW by [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar)
· the rest from [date.nager.at](https://date.nager.at) · ephemeris JPL DE440s via
[Skyfield](https://rhodesmill.org/skyfield/) · algorithms from Jean Meeus,
*Astronomical Algorithms*, 2nd ed.

MIT.
