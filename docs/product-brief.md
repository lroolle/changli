# Product brief — a calendar that knows the rules

Status: **brainstorm**, 2026-08-25. Seeded by the one feature in `changli` that
made someone say "really good idea": 拼假 — *burn 3 days of leave, get 13 days
off.* This document works out whether there is a product behind it.

---

## 1. The wedge

Nobody needs another calendar. The category is a graveyard: Sunrise (dead),
Tempo (dead), Woven (dead), Reclaim (absorbed), and a dozen "AI calendars" that
are a chat box stapled to a month grid.

So do not build a calendar. Build the thing no calendar has:

> **Everyone's time is governed by rules their software does not know.**
> 调休 that turns a Saturday into a workday. Bavaria's holidays being different
> from Berlin's. Alsace-Moselle having two that the rest of France does not.
> Taiwan's 補班 days. School terms that differ by canton. Schengen's 90-in-180
> rolling window. Leave that expires on 31 March. 春运. August in France.
>
> A calendar that knows these can answer questions no calendar can.

That is the product. 拼假 is one query against it. There are fifty more.

**Why now, and not three years ago.** Encoding those rules used to be an
unbounded, permanently-stale data-entry job — which is why nobody did it. An
agent can now fetch the 国务院 notice each November, diff each Bundesland's
holiday law, parse a school district PDF, and open a PR when reality moves. The
corpus maintains itself. That is the actual "agentic native" claim, and it is
an infrastructure claim, not a chat-box claim.

## 2. Who this is for

Not "busy professionals." These four:

- **陈, 34, Shanghai, remote for a German SaaS company.** Works a Saturday his
  colleagues do not. Has no idea what Pfingstmontag is or why Munich is closed.
  Wants 国庆 + 5 days to become 16 days in Hokkaido.
- **Marta, 41, Barcelona, kids in Catalan schools, husband works in Munich.**
  Needs the intersection of two school calendars, two employers, two countries.
  Currently does this in a spreadsheet. Everyone in this situation does.
- **Wei-Chen, 29, Taipei founder, EU customers, US investors.** Must not launch
  during 春節 or the second week of August. Learns this by losing a week.
- **The nomad on a Schengen clock.** 90 in 180, rolling, counted wrong by
  everyone, enforced by a border guard. It is a calendar problem and no
  calendar solves it.

What unites them: **their time crosses a border**, and every tool assumes it
does not. The CN 万年历 apps know 调休 and 黄历 but are ad-filled and never sync.
The Western pro calendars sync beautifully and have never heard of 调休.

## 3. One line

**The calendar for people whose time crosses borders.**

Alt framings to test: *"Your time, under every rule that governs it."* ·
*"跨境的时间，都算得清楚。"*

## 4. Wild list

Everything on the table, with a verdict. Ranked by "would this alone make
someone switch calendars."

| # | Idea | Verdict |
|---|---|---|
| 1 | **拼假 / leave optimiser**, multi-jurisdiction, multi-employer. "Cheapest 2 weeks off in 2027." | **keep — the wedge** |
| 2 | **Open rules corpus**, agent-maintained, every entry citing its government source. | **keep — the moat** |
| 3 | **Ambient re-solve.** November: the notice drops, every affected plan re-optimises, one notification: *"国庆 moved. Your October trip now costs 2 fewer leave days."* | **keep — proves agentic** |
| 4 | **Availability weather.** Your EU colleague's agent learns that CN is gone for a week in February; your team learns France is gone in August. Cultural time literacy as a layer. | **keep** |
| 5 | **Schengen / visa day counter** as a first-class calendar layer, with the rolling window drawn. | **keep — cheap, painful, unserved** |
| 6 | **Two-body coordination.** Couples and families as a solved constraint problem, not a shared calendar. | **keep — v2** |
| 7 | **MCP server over your calendar.** Agent-native by *protocol* — any agent can read real availability and write events. Not an AI in the app; the app usable by AI. | **keep — this is the real "agentic native"** |
| 8 | **Counterfactual year.** "Show me 2027 if I move to Berlin." Simulate a jurisdiction change. | keep — demo gold, v2 |
| 9 | **The intention layer.** Store goals ("see my parents 3× a year", "2 weeks off before Q4"), agent maintains them against reality. Calendar as goal-state, not event list. | keep — v2, the long game |
| 10 | **Travel-aware time.** A 12h flight costs a day on each side. 春运 crunch warnings. Jet lag as a real calendar cost. | keep — small, delightful |
| 11 | **The year on one page.** `changli`'s continuous-run thesis as the core UX: months are lanes, not containers. Already built and proven. | **keep — the UX DNA** |
| 12 | Agent-to-agent scheduling negotiation without exposing calendars | park — great, hard, needs a network |
| 13 | Meeting-booking links | **kill** — Calendly owns it |
| 14 | Task management / auto-scheduling todos | **kill** — Motion, Sunsama, and a graveyard |
| 15 | 黄历 宜忌 fortune content | park — huge in CN, but it is the ad-app register; would poison the pro positioning |

## 5. What makes it defensible

Not the UI, and not the model. **The corpus.**

`timerules/` — an open, versioned, MIT-licensed dataset of the rules that govern
time, maintained by scheduled agents, every entry citing its source document.

- CN statutory holidays + 调休 (国务院办公厅 notices) — *`changli` already does this,
  with the gov.cn URL on every year*
- TW 行政院人事行政總處 calendar incl. 補班; HK, MO, SG, MY
- EU public holidays **at regional granularity** — Bundesland, comunidad,
  canton, région, Alsace-Moselle
- US federal + state; UK bank holidays by nation
- School terms where published
- Leave entitlement and carryover/expiry rules by country
- Schengen counting rules; observances (Lunar New Year, Ramadan, Golden Week)

Why open it:

1. **Trust.** "Here is the government notice behind this date" is a claim no
   competitor makes. We built it once already.
2. **Distribution.** Other apps adopt the format; we own the best client.
   `thevibeworks` already runs exactly this pattern — `claude-code-docs`,
   `deepseek-docs`: agent-maintained, auto-syncing, public.
3. **It is the OSS-influence play**, and it costs us nothing we would not build.

The app is the face. The corpus is the asset.

## 6. Architecture, and the part that keeps it cheap

**Deterministic core, LLM at the edges.**

The intelligence is a **constraint solver**, not a language model. Leave
optimisation, Schengen counting, school-term intersection — these are exact
problems with exact answers. Solving them with an LLM would be slower, more
expensive, and *wrong sometimes*, which for "when is my flight" is fatal.

So:

- **Solver (deterministic):** rules + calendars + constraints → optimal plans.
  Fast, free to run, unit-testable. `changli` already proves the shape — 394
  anchors, cross-checked day-for-day against JPL over a century.
- **LLM (thin, at the boundary):** parse intent ("two weeks somewhere warm in
  spring, don't burn more than 5 days"), explain results in the user's
  language, maintain the corpus.

This is what makes "AI for paid users" economically sane: the expensive part is
thin and bounded, the valuable part is nearly free.

**Surfaces**

- **iOS (SwiftUI + EventKit).** The unlock: EventKit gives us iCloud, Google and
  Exchange calendars *for free* if the user already added them in Settings. No
  OAuth, no CalDAV, no verification review for v1.
- **Web.** Google Calendar API (sensitive scope — verification needed, but not
  the restricted-scope security assessment), Microsoft Graph, iCloud via CalDAV
  + app-specific password (Apple offers no OAuth here; it will be clunky and we
  should say so).
- **MCP server.** Ship it day one. It is a weekend of work and it is the entire
  "agentic native" story: any agent, anywhere, reading and writing your real
  availability under real rules.

**Stack bet:** rules engine + solver in Rust or TypeScript, shared by web and
iOS. Corpus as plain files in git, not a database — auditable, diffable,
PR-able, and it is how `thevibeworks` already runs its data repos.

## 7. Money

| Tier | What | Price |
|---|---|---|
| Free | Calendar, sync, the corpus, 拼假 for one jurisdiction | 0 |
| Pro | Agent, multi-jurisdiction, counterfactuals, family coordination, Schengen, ambient re-solve | ~$8/mo, $72/yr · CN ¥25/mo ¥168/yr |
| Teams | Availability weather across a distributed team | later |

CN price sensitivity is real; do not port US pricing. The corpus stays free
forever — it is marketing, not inventory.

## 8. Hard truths

- **Calendar sync is where products die.** Recurrence rules, timezones, DST,
  invitations, delegated calendars. Budget for it as *the* engineering cost.
  iOS-via-EventKit first is the way to not die in v1.
- **The China App Store** needs an ICP filing for server-side content, and IAP
  for payment. This is months, not days. Consider shipping zh-Hant/HK/TW and
  overseas Chinese first, mainland later.
- **GDPR.** Calendar contents are sensitive personal data. Argue for a local-first
  architecture — the solver runs on-device, only the corpus is fetched. That is
  also a *feature* we can market in the EU, and it lowers our costs.
- **The corpus rots silently.** A source that stops being fetched emits no
  signal. Freshness checks and per-source heartbeats from day one, not later.
- **"AI calendar" is a poisoned phrase.** Do not lead with it. Lead with the
  answer no one else can give.

## 9. Sequencing

- **v0 — prove the wedge.** `changli` grows from a CN calendar into a
  multi-jurisdiction leave optimiser on the web. No sync, no accounts. Ship the
  corpus repo alongside. Success = people use it in November when the notices drop.
- **v1 — iOS + sync.** EventKit, the continuous-year UX, 拼假 against your real
  calendar, Schengen layer. MCP server ships here. Pro tier opens.
- **v2 — the agent.** Ambient re-solve, intention layer, two-body coordination,
  counterfactuals, availability weather.

## 10. Naming

`changli` is a good repo and codename; it is opaque outside zh. Consumer brand
is a separate exercise — do not let it block v0.

| Candidate | For | Against |
|---|---|---|
| **changli 长历** | ours, "the long calendar", matches the continuous-year UX | meaningless in EU/US |
| **Ephem** | short, global-typeable, and we literally shipped an ephemeris | opaque in zh |
| **Suishi 岁时** | classical Chinese for "the seasons of the year"; exactly the subject | hard to say in EU |
| **Overlap** | says the thesis — the product finds the overlap between systems | generic, likely taken |

Note: **Sui** alone is out — collides with a large blockchain project.

## 11. Open questions

1. Consumer brand — decide now or after v0?
2. Corpus repo: separate `thevibeworks/timerules`, or grow inside `changli`?
3. Mainland App Store from the start, or zh-Hant + overseas first?
4. Local-first solver (better privacy, harder sync) vs server solver (easier,
   GDPR exposure)?
5. Is v0 a web app, or should the corpus ship first on its own and earn an
   audience before any app?
