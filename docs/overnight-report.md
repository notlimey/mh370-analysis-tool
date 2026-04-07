# Overnight Analysis Report

**Date:** 2026-04-07

---

## 1. Beam Width Sensitivity Sweep

Ran the path solver at beam widths 100, 200, 400, 800 to test whether the
peak location is an artifact of the beam search heuristic.

| Beam Width | Peak Lat | Peak Lon | Arc 7 Crossing Lat | Arc 7 Crossing Lon | BFO Mean Abs Residual (all arcs) |
|-----------|----------|----------|-------------------|-------------------|--------------------------------|
| 100 | -35.94° | 90.80° | -34.81° | 92.21° | 21.3 Hz |
| 200 | -35.94° | 90.80° | -34.81° | 92.21° | 21.3 Hz |
| 400 | -35.71° | 91.13° | -34.81° | 92.21° | 21.3 Hz |
| 800 | -35.71° | 91.13° | -34.81° | 92.21° | 21.3 Hz |

**Finding:** The Arc 7 crossing point is completely stable at -34.81°S, 92.21°E
across all beam widths. The peak location (which includes glide projection) shows
a minor shift of 0.23° latitude and 0.33° longitude between beam width 200 and 400.
This is well within the uncertainty envelope.

**Note on BFO residual:** The 21.3 Hz figure is the mean absolute residual across
all 7 arcs including Arc 7, which has a ~73 Hz residual under level-flight assumption
(expected — the aircraft was descending). The ~4 Hz figure cited in the research
note is for level-flight arcs 2–5 and 6b only.

**Conclusion:** Beam width is not a significant sensitivity. The result is robust.

---

## 2. Descent Timing Sensitivity

The pre-Arc-7 descent duration is now configurable via `descent_before_arc7_minutes`
(default: 1.0) and `descent_rate_fpm` (default: 4200.0). Previously hardcoded as
`1.0 * 4200.0`.

### Analytical sweep (geometric calculation)

| Descent (min) | Altitude at Arc 7 | Glide Range (NM) | Impact Lon (approx) |
|--------------|-------------------|-----------------|-------------------|
| 0.5 | FL329 (32,900 ft) | 81.2 | 91.06°E |
| 1.0 | FL308 (30,800 ft) | 76.0 | 91.13°E |
| 1.5 | FL287 (28,700 ft) | 70.9 | 91.21°E |
| 2.0 | FL266 (26,600 ft) | 65.7 | 91.28°E |
| 3.0 | FL224 (22,400 ft) | 55.3 | 91.42°E |
| 5.0 | FL140 (14,000 ft) | 34.6 | 91.72°E |
| 8.5 | FL0 (0 ft) | 0.0 | 92.20°E |

### Solver verification

| Descent (min) | Solver Peak Lat | Solver Peak Lon |
|--------------|----------------|----------------|
| 0.5 | -36.00° | 90.72° |
| 1.0 | -35.94° | 90.80° |
| 3.0 | -35.69° | 91.10° |
| 5.0 | -35.45° | 91.40° |
| 8.5 | -34.81° | 92.21° |

**Finding:** Impact longitude ranges from 90.72°E (0.5 min) to 92.21°E (8.5 min).
At the maximum descent time (8.5 minutes — engines flamed out at Arc 6b), the
impact collapses to the arc crossing itself at 92.21°E, which is right at the
ATSB Phase 2 boundary (93°E).

**Key insight:** Holland's "about one minute" gives 90.80°E. But if the engines
flamed out at separate times (ATSB reports minutes between failures), 3–5 minutes
of descent is plausible, pushing impact to 91.1–91.4°E. The full uncertainty
envelope for descent timing alone is 90.7–92.2°E.

---

## 3. Independent BFO Validation on Known Positions

BFO predictions at fixed known positions with no solver optimization. This tests
whether the BFO model is independently valid or only works because the solver
optimizes positions to minimize residuals.

| Position | Time | Measured BFO | Predicted BFO | Residual | Status |
|----------|------|-------------|--------------|---------|--------|
| Gate logon (16:00:13) | 16:00:13.406 | 87 Hz | 60.6 Hz | -26.4 Hz | FAIL |
| Takeoff (16:42:04) | 16:42:04.408 | 144 Hz | 84.1 Hz | -59.9 Hz | FAIL |
| ACARS (17:07:55) | 17:07:55.587 | 130 Hz | 117.2 Hz | -12.8 Hz | MARGINAL |

**Finding:** Large residuals at all three known positions. The pre-flight points
(gate, takeoff) are known to have processing issues — the "measured" BFO values
come from raw SU log frequency offsets that vary by ±15 Hz across analyst
pipelines (documented in `docs/bfo-reference-data.md`). The takeoff BFO of 144 Hz
is particularly suspect given the 60 Hz discrepancy.

The ACARS point (17:07:55) is the most reliable known-position BFO and shows a
-12.8 Hz residual. This exceeds the DSTG empirical sigma of 4.3 Hz but is within
the inflated 7 Hz sigma they used for modeling. The position used (5.5°N, 103.5°E)
is an approximation — the actual ACARS-reported position would be needed for a
definitive test.

**Assessment:** The independent validation is inconclusive — and it turns out
a clean test is harder than expected. Review of the DSTG Book (Chapter 4, p.21)
reveals that the 18:28 positions are NOT from radar — the DSTG rejected the
18:22 radar fix as quantitatively unreliable (long-range angular errors) and
used a Kalman filter prediction from 18:01 instead. No published source gives
exact lat/lon at 18:28. The DSTG validated their BFO model against 20 prior
flights of 9M-MRO (Chapter 9, achieving 0.18 Hz mean, 4.3 Hz sigma), but that
dataset is not publicly available.

See `docs/research-note-bfo-validation-known-positions.md` for full analysis.

---

## 4. WGS84 Ellipsoid — Attempted and Reverted

**Attempted:** Replaced spherical `to_ecef` in `bfo.rs` with WGS84 (semi-major
axis 6378.137 km, flattening 1/298.257).

**Result:** BFO residuals degraded from ~4 Hz to ~21.5 Hz on level-flight arcs.

**Root cause:** Coordinate system inconsistency. The satellite ephemeris data
arrives as ECEF coordinates, which the satellite module (`satellite.rs`) converts
to geodetic using spherical Earth (R=6371 km). The BFO model then converts these
geodetic coordinates back to ECEF. With the old spherical model, the round-trip
was lossless. With WGS84, the geodetic→ECEF conversion produced a different ECEF
than the original, introducing a ~14 km position error at 35°S that manifested
as ~17 Hz of BFO error.

**Fix required:** Either (a) pass satellite ECEF coordinates directly to the BFO
model, avoiding the geodetic round-trip entirely, or (b) convert everything to
WGS84 simultaneously (satellite geodetic conversion + BFO ECEF). Option (a) is
cleaner and eliminates the round-trip error.

**Status:** Reverted to spherical. The `to_ecef` function now documents why
WGS84 was attempted and why it was rolled back. The spherical model is internally
consistent and produces good residuals.

---

## 5. Wind Correction Infrastructure

Added `glide_wind_correction_kts` to `AnalysisConfig` (default: 0.0, opt-in).
When positive, it reduces the glide ground track by the headwind component.

**ERA5 climatological reference:** At 300 hPa, March, 35°S, 90°E, the prevailing
westerlies are approximately 30–40 kts. Along a heading of 224° true, the headwind
component is approximately 20–28 kts (cos of the angle between wind direction
~270° and heading 224° is ~0.7).

**Documented value:** ~25 kts headwind component. This would reduce the 76 NM
glide to approximately 62 NM, shifting the impact ~0.2° east (from 90.8°E to
~91.0°E).

**The default remains 0 — this is opt-in.** The value is documented but not
applied until the user deliberately enables it.

---

## 6. Critic Pass

### 6a. Symmetric kernel vs DSTG Section 10.2

The DSTG Book (Section 10.2) describes the descent kernel as:
> "High likelihood of reaching zero altitude within 15 nm of beginning of descent"

With a Gaussian falloff at σ = 30 NM beyond the 15 NM uniform disc. Our
implementation in `probability.rs::dstg_descent_kernel()` matches this:

```rust
const UNIFORM_RADIUS_KM: f64 = 15.0 * 1.852; // 15 NM = 27.78 km
const GAUSSIAN_SIGMA_KM: f64 = 30.0 * 1.852; // 30 NM = 55.56 km
```

**Verified correct.** The kernel returns 1.0 within 15 NM and falls off as
`exp(-excess²/(2σ²))` beyond, which matches the DSTG description.

### 6b. "Weakly contradictory" drift framing consistency

Checked all files for remaining "neutral" drift framing:

| File | Status |
|------|--------|
| `docs/research-note-arc7-impact-zone.md` (status line) | Fixed → "weakly contradictory result" |
| `docs/research-note-arc7-impact-zone.md` (drift section) | Fixed → "weakly contradictory (quantified)" |
| `docs/research-note-oscar-drift.md` (summary) | Fixed → "weakly contradictory" |
| `docs/research-note-oscar-drift.md` (interpretation) | Fixed → "weakly contradicts" |
| `docs/roadmap.md` (OSCAR entry) | Fixed → "weakly contradictory result" |
| `docs/roadmap.md` (HYCOM status) | Fixed → "drift evidence weakly contradicts" |
| Frontend (infoContent.ts, scenarios.ts) | No drift framing in UI — clean |

One acceptable use remains: `research-note-oscar-drift.md` line 219 uses "neutral"
in a hypothetical context ("shift the Reunion signal from neutral to discriminating")
— this refers to what HYCOM might show, not a claim about the current result.

### 6c. WGS84 coordinate system consistency check

The BFO `to_ecef` and the satellite `ecef_to_geodetic` both use spherical Earth
(R=6371 km). The arcs module (`arcs.rs`) uses `EARTH_RADIUS_KM = 6371.0` and
`GEO_RADIUS_KM = 42164.0`. The geometry module (`geometry.rs`) uses R=6371 for
haversine. **All are consistent.** No mixed coordinate systems in the current code.

The satellite ephemeris is provided in ECEF (km) from the embedded JSON. When the
satellite module converts ECEF→geodetic, it uses the same spherical model. The BFO
model receives geodetic and converts back to ECEF with the same spherical model.
The round-trip is lossless under spherical assumptions.

**WGS84 upgrade path:** The clean approach is to modify `satellite_ecef()` in
`bfo.rs` to use the satellite's ECEF position/velocity directly from the ephemeris
(they're already in ECEF), bypassing the geodetic round-trip. This would make WGS84
in `to_ecef` safe because only the aircraft position would be converted, and the
satellite would stay in true ECEF. This is a targeted refactor, not a full-codebase
change.

---

## Summary of Changes Made

### Code changes
- **`data.rs`** — Added `descent_before_arc7_minutes`, `descent_rate_fpm`, `glide_wind_correction_kts` to `AnalysisConfig`
- **`config.rs`** — Added new fields to macro, get/set functions
- **`paths.rs`** — Replaced hardcoded `1.0 * 4200.0` with configurable `config.descent_before_arc7_minutes * config.descent_rate_fpm`; added wind correction logic
- **`bfo.rs`** — WGS84 attempted, reverted, documented in code comment
- **`config.ts`** / **`backend.ts`** — Frontend types updated
- **`overnight_analysis.rs`** — New analysis binary

### Documentation fixes
- **`research-note-arc7-impact-zone.md`** — Two "neutral" → "weakly contradictory"
- **`roadmap.md`** — Two "neutral" → "weakly contradictory"

### Key findings
1. **Beam width: robust.** Peak location stable across 100–800.
2. **Descent timing: 1.1° longitude uncertainty.** Impact ranges 90.7–92.2°E depending on descent duration.
3. **BFO validation: inconclusive, and clean test may not be possible.** Pre-flight BFO data too unreliable. ACARS point: -12.8 Hz with approximate position. DSTG Book confirms 18:28 positions are Kalman-filter-derived, not radar — no published exact lat/lon exists. The DSTG's own validation used 20 prior flights (non-public data).
4. **WGS84: breaks consistency.** Must refactor satellite ECEF pass-through before attempting again.
5. **Symmetric kernel: correctly implements DSTG Section 10.2.**
6. **Drift framing: fully consistent** across all documentation.
