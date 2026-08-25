# 长历 changli

**A calendar that knows the rules.**

Everyone's time is governed by rules their software does not know. 调休 that
turns a Saturday into a workday. Bavaria's holidays being different from
Berlin's. Taiwan's 補班. Egypt resting on Friday. Schengen's 90-in-180 rolling
window. A calendar that knows these can answer questions no calendar can:

```
$ changli plan-leave CN 2026-08-01 2026-10-31
  Burn 3 days (Sep 28, 29, 30) -> 13 consecutive days off, Sep 25 to Oct 7.
```

Two halves: a **continuous calendar** you can actually plan a quarter in, and a
**deterministic rules engine** over 47 jurisdictions, exposed to agents over MCP.

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

## Regenerating data

```
npm run data:jurisdictions    # 47 jurisdictions from three sources
npm run data:holidays         # CN, from the published notices
python3 test/gen-ephemeris.py # JPL DE440s (needs skyfield)
```

The ephemeris regenerates byte-identical. Holiday sources are cited per year in
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
src/ui.js             views, selection, the ribbon
data/jurisdictions/   the rules corpus, 47 jurisdictions
mcp/server.mjs        MCP server, 8 tools, zero deps
DESIGN.md             the material contract — read before touching the UI
docs/product-brief.md where this is going
```

## Status

The web UI currently renders the CN calendar; the multi-jurisdiction engine is
complete, tested and reachable through MCP and the JS API, and is being wired
into the UI next. See `docs/product-brief.md`.

## Credits

CN holidays transcribed by [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)
from 国务院办公厅 notices · TW by [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar)
· the rest from [date.nager.at](https://date.nager.at) · ephemeris JPL DE440s via
[Skyfield](https://rhodesmill.org/skyfield/) · algorithms from Jean Meeus,
*Astronomical Algorithms*, 2nd ed.

MIT.
