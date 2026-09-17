# TASTE.md -- rulings

One entry per real rejection, with the mechanism. A scar without a why is a
ban, and bans fossilize. Delete a scar the moment its expiry arrives.

## 2026-09-16 rejected: chrome that scrolls away on an endless sheet

Why: making `flow` scroll forever quietly broke two things that had been fine
when the view was a bounded page. The ribbon -- the whole year at a glance, and
the handle you drag to travel -- scrolled off after one flick, so the minimap
was gone exactly when there was finally something to navigate. Worse, the mark
bar went with it: selecting days four screens into next year left the labels a
thousand pixels above the fold, so the reader dragged, saw nothing happen, and
concluded marking was broken. It was, in the only sense that counts.

Reuse: when a surface becomes endless, every control that acts on it has to be
re-sited. Sticky keeps an element's place in the flow, so pinning the mark bar
costs no shift -- the reason its height was already reserved. Offsets stack
masthead -> ribbon -> mark bar -> weekday header and are measured at runtime,
never hardcoded, because each bar changes height with the viewport.

Expires: never. The trade is real -- the stack costs about 270px of a 900px
viewport -- and it is the right trade: nine rows you can act on beat thirteen
you cannot.

## 2026-09-16 rejected: the mark bar that appears when you select

Why: the bar holding the label chips was hidden until days were selected --
correct-looking, and a correctness bug. It sits above the sheet, so un-hiding it
on the first pointerdown pushed every row down by its own height, mid-drag,
under a pointer that had not moved. A drag from 9月7日 to 9月16日 selected three
days: the rows had travelled a row's worth while the reader held still.

Reuse: the bar is always present and swaps its contents -- hint when idle,
span and chips when acting. Anything above the grid that can appear must
instead reserve its space. Same family as the 2026-08-24 re-render scar: **the
surface must not move under a drag**, whether it is rebuilt or merely reflowed.

Expires: never.

## 2026-09-16 rejected: compensating every prepend on the scrolling sheet

Why: the sheet inserts weeks above the viewport when the reader scrolls up and
corrects the scroll by the height it inserted. Two things were wrong with doing
that unconditionally.

First, the browser already does it: `overflow-anchor` is on by default, so both
compensators fired and every prepend shoved the sheet down eight rows -- 今天
pressed from 2027 landed two months late. `.gsheet` now sets
`overflow-anchor: none`; the compensator that knows what it inserted is the one
that keeps the job.

Second, correcting the scroll is only right when the insertion lands *above*
what the reader is looking at. While the sheet's first row is still on screen
the insertion point is on screen too, and compensating for it walks the view
backwards a chunk at a time: a jump to the top of a year-long sheet landed in
May instead of at the first row. Backward extension now waits until the sheet's
top edge has left the screen.

Reuse: for any virtualised list, state which side of the viewport an insertion
lands on before deciding to correct for it, and check whether the platform is
already correcting. Two fixes for one problem is a bug, not a belt and braces.

Expires: never.

## 2026-09-16 rejected: a colour per label for personal marks

Why: the first shape for marks gave 年假 / 病假 / 出差 a hue each, because that
is what every calendar app does. On this sheet it broke the one promise the
whole surface is built on -- four status roles carry every drop of colour -- and
it broke it worse than the 节气 blue did: six hues, none of which means work or
rest, laid over four that do. A reader scanning a quarter for red would have
been filtering seven chromatic signals to find the one that means 休.

The second shape made marks a fifth status role with one accent tint. That
fails differently and more quietly: it makes *your* leave and *the state's*
holiday the same kind of fact. They are not. One is published in a notice you
can link to; the other is a decision you made this morning and can undo.

Reuse: marks are drawn in a different **material**, not a different colour --
graphite over print, in a lane every cell reserves, with the label written at
the run's start and again on each Monday it continues into. Runs get a brace at
their ends so ten marked cells read as one ten-day thing. This is what the
2026-08-24 节气 ruling meant by "must earn a token in the program, not a stray
colour": `--mark-ink/-rule/-field/-edge`, neutral, no hue, in both themes.

Expires: never for the hue. The material may be revisited if marks ever need to
carry a second dimension (a status of their own -- requested, approved) that
ink strength cannot hold.

## 2026-08-24 rejected: the month band painted on the cells

Why: `box-shadow: inset 0 0 0 100vmax` on alternating months painted *over*
the cell's status background, so 中秋 (an odd month) rendered a weaker red
than 国庆 (an even one). The same statutory holiday looked like two different
things depending on which month it fell in -- the status program broke on
parity, of all things.

Reuse: the month band belongs on the gutter lane, not on the cells. Anything
that carries the status program owns its background outright.

Expires: never -- this is the load-bearing rule of the status program.

## 2026-08-24 rejected: a fifth hue for 节气

Why: solar-term labels were `--info` blue, which read fine but made the
promise ("four status roles carry every drop of colour") false, and put a
hue on the page that meant neither work nor rest. A reader scanning for red
now had to filter two chromatic signals.

Reuse: distinguish an information class by face and ink strength before
reaching for a hue. A block-printed almanac has two inks; so does this.

Expires: if a genuinely orthogonal, user-actionable data class arrives that
cannot be carried by typography (personal events, say), revisit -- but it
must earn a token in the program, not a stray colour.

## 2026-08-24 rejected: "月" appended to the numeral on the 1st

Why: meant to mark "the month turned over here". Rendered as `1月`, which in
Chinese reads as *January*. A label that means the opposite of what it says
is worse than no label.

Reuse: check CJK affixes as strings a reader will parse, not as decoration.
The gutter label and the stepped rule already carried this.

Expires: never.

## 2026-08-24 rejected: full grid re-render on pointermove

Why: dragging a selection rebuilt `#grid.innerHTML` every move, which
destroyed the element under the cursor; the next pointermove landed on
nothing and the selection silently stopped short of where the user dragged.
It looked like a UI polish issue and was a correctness bug.

Reuse: a drag must never rebuild the surface it is being dragged across.
Selection updates attributes on existing nodes (`paint()`); only a range or
view change calls `render()`.

Expires: never.

## 2026-08-24 rejected: the Espenak-Meeus delta-T polynomial

Why: it assumes delta-T keeps climbing. The Earth's rotation sped up after
2020 and delta-T has sat near 69 s instead, so the polynomial over-predicts
by ~35 s at 2057 -- enough to move the new moon of 2057-09-28 (23:59:58 by
that model, 00:00:44 the next day by JPL) across midnight and shift a whole
lunar month by a day.

Reuse: for anything reduced to a *civil date* in a fixed zone, the error that
matters is the one near midnight. Prefer a measured table to a fitted curve,
and test the knife-edge cases explicitly.

Expires: when IERS publishes observations that move the table -- regenerate,
do not re-fit.
