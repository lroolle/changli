#!/usr/bin/env python3
"""Generate src/ephemeris.js from the JPL DE440s ephemeris.

Why a generated table and not the runtime astronomy in src/astro.js: the
Meeus ch. 25 solar series carries a -208 s systematic bias with a ~245 s
spread, which is invisible except when a 节气 lands within minutes of
midnight Beijing time. Over 1900-2100 that is a handful of dates -- but they
are dates the calendar draws a label on, and they would silently disagree
with every published Chinese calendar.

So the boundaries are computed once here, against the real ephemeris, and
shipped as two compact strings. src/astro.js keeps its own computation for
years outside the table and as the thing this file is checked against.

Requires: skyfield.  Run:  python3 test/gen-ephemeris.py

The two facts encoded:
  新月  the instant of conjunction in ecliptic longitude, reduced to the
        civil date in UTC+8 -- the day a 农历 month begins
  节气  the instant the Sun's apparent longitude reaches a multiple of 15
        degrees, likewise reduced to UTC+8
"""

import datetime as dt
import os
from pathlib import Path

from skyfield.api import Loader
from skyfield import almanac
from skyfield.framelib import ecliptic_frame

Y0, Y1 = 1900, 2100
UNIX_EPOCH_JD = 2440587.5
CST = dt.timedelta(hours=8)

# Keep the 32 MB kernel out of the repo: it is a build input, not source.
_cache = Path(os.environ.get("SKYFIELD_CACHE", Path.home() / ".cache" / "skyfield"))
_cache.mkdir(parents=True, exist_ok=True)
_loader = Loader(str(_cache))
ts = _loader.timescale()
eph = _loader("de440s.bsp")
earth, sun, moon = eph["earth"], eph["sun"], eph["moon"]


def sun_lon(t):
    _, lon, _ = earth.at(t).observe(sun).apparent().frame_latlon(ecliptic_frame)
    return lon.degrees % 360


def cst_day_numbers(t):
    """Skyfield Time (possibly an array) -> day numbers since epoch, in UTC+8."""
    out = []
    stamps = t.utc_datetime()
    if isinstance(stamps, dt.datetime):
        stamps = [stamps]
    for s in stamps:
        out.append(((s + CST).date() - dt.date(1970, 1, 1)).days)
    return out


def new_moons():
    """Every new moon in the range, as a UTC+8 day number."""
    days = []
    for y in range(Y0 - 1, Y1 + 2, 10):
        t0 = ts.utc(y, 1, 1)
        t1 = ts.utc(min(y + 10, Y1 + 2), 1, 1)
        t, phase = almanac.find_discrete(t0, t1, almanac.moon_phases(eph))
        for ti, ph in zip(t, phase):
            if ph == 0:  # new moon
                days.extend(cst_day_numbers(ti))
    return sorted(set(days))


def solar_terms():
    """Every 15-degree solar longitude crossing, as (day number, longitude)."""

    def term_index(t):
        return (sun_lon(t) / 15).astype(int)

    term_index.step_days = 8.0

    out = []
    for y in range(Y0 - 1, Y1 + 2, 10):
        t0 = ts.utc(y, 1, 1)
        t1 = ts.utc(min(y + 10, Y1 + 2), 1, 1)
        t, idx = almanac.find_discrete(t0, t1, term_index)
        for ti, ii in zip(t, idx):
            lon = (int(ii) * 15) % 360
            out.append((cst_day_numbers(ti)[0], lon))
    out = sorted(set(out))
    # find_discrete returns the index *after* the crossing; that is the term.
    return out


def encode(deltas, lo, hi, label):
    for d in deltas:
        if not (lo <= d <= hi):
            raise SystemExit(f"{label}: delta {d} outside [{lo},{hi}]")
    return "".join(chr(48 + d - lo) for d in deltas)


def main():
    print("computing new moons ...")
    nm = new_moons()
    nm_deltas = [b - a for a, b in zip(nm, nm[1:])]
    nm_str = encode(nm_deltas, 29, 30, "new moon")

    print("computing solar terms ...")
    st = solar_terms()
    st_days = [d for d, _ in st]
    st_deltas = [b - a for a, b in zip(st_days, st_days[1:])]
    st_str = encode(st_deltas, 14, 16, "solar term")
    first_lon = st[0][1]
    first_index = int(round(((first_lon - 315) % 360) / 15)) % 24

    out = Path(__file__).resolve().parent.parent / "src" / "ephemeris.js"
    out.write_text(f"""// ephemeris.js -- GENERATED. Do not edit by hand.
//
// Regenerate:  python3 test/gen-ephemeris.py   (needs skyfield)
// Source:      JPL DE440s, via Skyfield.
//
// Two runs of boundaries, each reduced to the civil date in UTC+8, which is
// where the 农历 is defined:
//
//   NEW_MOONS    the day each lunar month begins (朔)
//   SOLAR_TERM   the day the Sun reaches each multiple of 15 degrees (节气)
//
// Deltas only: lunar months are 29 or 30 days, solar terms 14 to 16 days
// apart, so each boundary costs one character. Covering {Y0}-{Y1} in ~{(len(nm_str)+len(st_str))//1024} KB.
//
// src/astro.js computes the same quantities from Meeus and is used outside
// this range; test/verify.js checks the two against each other.

/** Day number (days since 1970-01-01, UTC+8) of the first tabulated new moon. */
export const NEW_MOON_BASE = {nm[0]};
/** One char per month: '0' = 29 days, '1' = 30 days. */
export const NEW_MOON_DELTAS = '{nm_str}';

/** Day number of the first tabulated solar term. */
export const SOLAR_TERM_BASE = {st_days[0]};
/** Index into SOLAR_TERMS (0 = 立春) of that first term. */
export const SOLAR_TERM_FIRST_INDEX = {first_index};
/** One char per term: '0' = 14 days, '1' = 15, '2' = 16. */
export const SOLAR_TERM_DELTAS = '{st_str}';

export const EPHEMERIS_RANGE = {{ from: {Y0}, to: {Y1}, source: 'JPL DE440s' }};
""", encoding="utf-8")
    print(f"wrote {out}")
    print(f"  new moons:   {len(nm)}  ({len(nm_str)} chars)")
    print(f"  solar terms: {len(st_days)}  ({len(st_str)} chars)")


if __name__ == "__main__":
    main()
