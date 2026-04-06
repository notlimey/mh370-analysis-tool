# MH370 Analysis Tool — Roadmap

**Last updated:** 2026-04-06

---

## Completed

### BFO Physics (2026-04-06)

- **Data correction.** Fixed measured BFO values that were shuffled between
  arcs in the dataset. Verified against joewragg/MH370 FinalData.csv and
  Holland 2017 (arXiv:1702.02432). Residuals dropped from 76 Hz to 49 Hz.

- **Calibration fix.** Switched from uncertain gate BFO calibration (188 Hz
  bias) to ATSB published constant (150 Hz). Residuals dropped from 49 Hz
  to 22 Hz. Level-flight arcs (2–5, 6b) now at ~4 Hz RMS.

- **BFO sigma tightening.** Changed default from 7 Hz to 4.3 Hz (DSTG
  empirical value from 20 prior 9M-MRO flights). Now justified by residual
  quality. Peak location stable under tightening — confirms BFO is a real
  constraint, not noise.

- **DSTG validation.** Verified model reproduces DSTG results: peak within
  their 32–39°S concentration zone, BFO residuals within their noise model,
  north/south ambiguity correctly resolved by BFO.

### End-of-Flight Model (2026-04-06)

- **Arc 7 descent constraint (Option E).** Instead of fitting Arc 7 BFO as
  absolute measurement, model computes implied descent rate from BFO delta
  and checks against Holland's aerodynamic envelope (2,900–14,800 fpm).
  Eliminates the ~73 Hz level-flight residual that was penalizing all Arc 7
  candidates equally.

- **Glide model replacement.** Replaced fuel-based powered continuation
  (420 kts, up to 57 min) with physics-based unpowered glide (15:1 L/D,
  FL308, zero thrust). The old model was physically impossible — powered
  flight after engine flameout.

- **Heading sensitivity sweep.** Swept ±15° around the path solver's final
  heading (224.2° true) across all altitude scenarios. Impact longitude
  varies only 90.8–91.7°E. Heading is not a significant uncertainty.

### Research Documentation (2026-04-06)

- `docs/bfo-reference-data.md` — Verified BFO values with full source
  attribution
- `docs/dstg-validation.md` — DSTG model assumptions and comparison
- `docs/research-note-arc7-impact-zone.md` — Preliminary finding with
  uncertainty envelope, open tensions, next steps

### Frontend Migration (2026-04-06)

- Full rewrite from vanilla TypeScript to SolidJS
- Reactive stores, component architecture, Biome linting
- 10,248 → 8,635 lines (16% reduction with more features)
- Mapbox GL code-split (app bundle 1,966 KB → 188 KB)

---

## In Progress

### HYCOM Drift Modeling

**Status:** Not started. Next major phase.

Integrate HYCOM ocean reanalysis data for March 2014 – July 2015. For each
candidate crash latitude, simulate debris drift with real currents and
compute:

- Arrival timing at Reunion, Mozambique, Tanzania, South Africa
- SST exposure along each drift path
- Whether Lepas barnacle colonization is thermally viable

This resolves both the barnacle tension and the simplified-drift limitation.
It's also the primary validation against observed debris: if drift from our
impact zone can't deliver the flaperon to Reunion in ~508 days, the zone
needs revision.

### Altitude-from-BFO Coupling

**Status:** Identified, not implemented.

The Arc 7 BFO residual implies a specific descent rate for each candidate
position. Rather than using a fixed 1-minute pre-descent at 4,200 fpm,
compute the descent rate from the BFO at each candidate's Arc 7 crossing
and derive the altitude from that. This couples BFO to the glide model,
reducing altitude uncertainty from the current FL202–FL321 range.

---

## Future

### Barnacle / SST Integration

**Depends on:** HYCOM drift modeling.

Use SST along computed drift paths to evaluate whether Lepas colonization
is thermally viable for each candidate origin latitude. Currently a
qualitative tension (Godfrey's analysis mildly favors ~30°S vs our 34.8°S).
HYCOM would make this quantitative.

### Option D: Horizontal BFO Decomposition

**Status:** Deprioritized. Still valid.

Decompose BFO into horizontal and vertical Doppler components. Score only
the horizontal component at all arcs, making the model robust to minor
altitude changes during cruise. Currently unnecessary because level-flight
arcs already achieve ~4 Hz residuals, but would be the right approach if
altitude modeling is added.

### Cruise Altitude Model

**Status:** Not started. Low priority.

Currently the model assumes FL350 for the entire flight. A realistic model
would allow altitude changes (the DSTG models altitude as an OU process
with range 25,000–43,000 ft). This matters if Option D is implemented,
since altitude affects BFO through the elevation angle to the satellite.

### Forward Flight Simulation

**Status:** Conceptual.

Replace the current arc-hopping path sampler with a forward-integrated
flight simulation using autopilot modes (constant heading, constant track,
waypoint navigation). Would produce more physically realistic path families
and enable proper fuel integration over time rather than distance.

### Side-by-Side Run Comparison

**Status:** Frontend infrastructure exists (SavedRun), no visual comparison.

Save two model runs and diff them on the map — split heatmaps, overlay
path families. Useful for sensitivity testing and scenario comparison.

---

## Current Model Output

| Metric | Value |
|--------|-------|
| Arc 7 crossing | 34.81°S, 92.21°E |
| Impact zone (central) | 35.9°S, 90.8°E |
| Impact longitude range | 90.8–91.7°E |
| Impact latitude range | ~35.5–36.5°S |
| BFO RMS (arcs 2–5, 6b) | ~4 Hz |
| Best path family | Perpendicular |
| Final heading | 224.2° true |
| Glide range (FL308, 15:1) | 76 NM (141 km) |
| Distance from ATSB search | ~1.3–2.2° west (130–200 km) |
| All searched areas | Impact zone is outside all |
