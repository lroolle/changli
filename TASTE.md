# TASTE.md -- rulings

One entry per real rejection, with the mechanism. A scar without a why is a
ban, and bans fossilize. Delete a scar the moment its expiry arrives.

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
