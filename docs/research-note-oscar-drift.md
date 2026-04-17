# Research Note: OSCAR Drift Plausibility Check

**Date:** 2026-04-06
**Status:** Complete — approximate model, results inform HYCOM decision

---

## Summary

An approximate debris drift simulation using OSCAR satellite-derived surface
currents was used to test whether the impact zone at ~35.9°S, 90.8°E is
consistent with observed debris recovery locations and timing. A comparison
was run against the ATSB search corridor (~35°S, 93-97°E) to test whether
drift evidence independently favors one origin over the other.

**Result:** Drift evidence is weakly contradictory for the 90.8°E impact zone.
The ATSB corridor produces better timing matches at Reunion — the most
diagnostic single site — with 5 hits bracketing the observed day 508, versus
1 hit from the 90.8°E zone arriving 87 days late. The 90.8°E zone produces
more total arrivals at Mozambique and Rodrigues, but these are large coastal
targets where hit count carries less discriminating power. Neither origin
matches Pemba Island timing. The case for 90.8°E rests on BTO geometry and
BFO constraints, not drift.

---

## Method

### Data source

OSCAR (Ocean Surface Current Analysis Real-time) surface currents from NOAA/JPL,
accessed via CoastWatch ERDDAP (dataset `jplOscar`).

- Resolution: 1/3° spatial, 5-day temporal composites
- Depth: 15 meters (near-surface)
- Domain: 50°E-100°E, 45°S-10°S
- Period: March 2014 - April 2015 (48 available timesteps)
- License: CC BY 4.0

### Data gaps

The OSCAR data on this ERDDAP server has significant temporal gaps:

| Gap | Duration |
|-----|----------|
| 2014-03-07 to 2014-03-23 | 16 days |
| 2014-08-17 to 2014-09-06 | 20 days |
| 2014-11-06 to 2014-12-16 | 40 days |
| 2015-01-16 to 2015-04-17 | 91 days |

The 91-day gap (January-April 2015) covers a critical period of the drift
(days ~315-405 after crash). During gaps, currents are linearly interpolated
between bracketing timesteps.

After April 2015 (day 405), no OSCAR data is available. The simulation falls
back to a synthetic current field model for the remaining ~500 days. This
synthetic model captures large-scale circulation features (South Indian gyre,
SEC, Agulhas) but not mesoscale variability.

### Particle advection

- 1,000 particles per origin, distributed across each uncertainty envelope
- RK4 advection with 4 substeps per day (6-hour timestep)
- Bilinear spatial interpolation + linear temporal interpolation on OSCAR grid
- Wind forcing: latitude-dependent leeway model (0.025 coefficient)
- Stochastic noise: 0.07 m/s current, 0.03 m/s wind (Gaussian per substep)
- Maximum simulation: 900 days (covers all debris finds through day 838)

### Origins compared

| Origin | Latitude | Longitude | Rationale |
|--------|----------|-----------|-----------|
| Our impact zone | 34.8-36.5°S | 90.4-91.8°E | BTO/BFO + glide model result |
| ATSB corridor | 34.0-36.0°S | 93.0-97.0°E | Phase 2 search area (found nothing) |

### Recovery sites checked

All confirmed or probable MH370 debris, with proximity radius scaled to
account for debris mobility after initial beaching and the coarseness of
the current model.

| Site | Location | Observed Day | Radius | Status |
|------|----------|-------------|--------|--------|
| Flaperon | 20.9°S, 55.5°E (Reunion) | 508 | 150 km | Confirmed |
| Trailing edge flap | 15.5°S, 36.0°E (Mozambique) | 726 | 250 km | Confirmed |
| No Step panel | 16.0°S, 36.2°E (Mozambique) | 722 | 250 km | Confirmed |
| Outboard flap | 5.1°S, 39.8°E (Pemba, Tanzania) | 837 | 250 km | Confirmed |
| Panel | 34.0°S, 22.1°E (Mossel Bay, SA) | 660 | 250 km | Suspected |
| Trim panel | 8.5°S, 40.0°E (Tanzania) | 838 | 250 km | Probable |
| Window panel | 19.7°S, 63.4°E (Rodrigues Is.) | 838 | 200 km | Probable |

Timing match criterion: observed recovery day falls within the particle
arrival window ±60 days.

---

## Results

### Side-by-side comparison (1,000 particles per origin)

| Site (obs day) | Our zone: Hits | Arrival range | Timing | ATSB: Hits | Arrival range | Timing |
|---------------|---------------|---------------|--------|-----------|---------------|--------|
| **Flaperon, Reunion (508)** | 1 | 595 | **miss** | 5 | 503-677 | **OK** |
| **Flap, Mozambique (726)** | 222 | 524-887 | OK | 154 | 521-900 | OK |
| **No Step, Mozambique (722)** | 165 | 523-886 | OK | 124 | 536-895 | OK |
| **Outboard flap, Pemba (837)** | 17 | 427-484 | miss | 49 | 409-466 | miss |
| Panel, Mossel Bay (660) | 0 | - | - | 0 | - | - |
| Trim panel, Tanzania (838) | 98 | 423-568 | miss | 107 | 375-549 | miss |
| Window, Rodrigues (838) | 577 | 352-894 | OK | 408 | 299-881 | OK |

**Bold** = confirmed MH370 debris.

### Scorecard

| Metric | Our zone (90.8°E) | ATSB corridor (95°E) |
|--------|-------------------|---------------------|
| Confirmed sites reached | 4/4 | 4/4 |
| Timing-consistent (confirmed) | 2/4 | 3/4 |
| Total confirmed-site hits | 405 | 332 |

### Key observations

**Reunion (most diagnostic site):** The ATSB corridor produces 5 Reunion hits
with the observed day 508 falling within the arrival window (503-677). Our zone
produces only 1 hit, arriving at day 595 — 87 days late, outside the timing
window. This is the strongest single-site discriminator and it favors the ATSB
corridor.

**Mozambique coast:** Our zone produces ~40-45% more arrivals (222 vs 154 for
the flap, 165 vs 124 for the No Step panel). Both origins are timing-consistent.
The higher hit rate from our zone reflects its more westward starting position,
which produces faster transit to the Mozambique Channel. However, Mozambique is
a large coastal target — more arrivals don't necessarily mean better fit.

**Rodrigues Island:** Our zone produces more hits (577 vs 408). This is
expected since Rodrigues lies directly in the westward drift path and our zone
starts further west, putting particles closer to Rodrigues earlier.

**Pemba Island, Tanzania:** Neither origin produces timing-consistent arrivals.
Particles arrive 350-400 days early. This suggests the Pemba debris took a
longer, more circuitous route than the direct drift paths modeled here, possibly
involving recirculation in the Mozambique Channel.

**Mossel Bay, South Africa:** No hits from either origin. This site requires
debris to transit the Agulhas system and round the Cape — a path that is
outside the OSCAR domain (50-100°E) and handled entirely by the synthetic
current fallback. This result is uninformative about the origin longitude.

### The 100-particle false positive

An initial run with 100 particles produced a single Reunion hit from our
zone (day 521, timing OK) and zero from the ATSB corridor. This appeared to
show drift evidence independently favoring our impact zone. At 1,000 particles,
the signal reversed: the ATSB corridor produces more Reunion hits with better
timing. The 100-particle result was noise-dominated — a single lucky trajectory
produced a misleading headline finding. This underscores the need for adequate
particle counts when making discriminating claims.

---

## Interpretation

### What drift evidence says

The approximate OSCAR-based drift model weakly contradicts the 90.8°E impact
zone. On the most diagnostic site (Reunion), the ATSB corridor produces 5
timing-consistent hits versus 1 late hit from the 90.8°E zone. The 90.8°E
zone produces more total arrivals at Mozambique and Rodrigues, but these
are large coastal targets where more arrivals from a more westward origin
is geometrically expected, not evidence of better fit. Overall: weakly
unfavorable for 90.8°E.

### What the case for 90.8°E rests on

The impact zone at 90.8°E is supported by:

1. **BTO arc geometry (hard constraint):** The Arc 7 crossing at 34.8°S, 92.2°E
   is determined by the measured BTO value and satellite position. This is
   geometric — it does not depend on assumptions about aircraft behavior.

2. **BFO Doppler constraint (firm):** The path solver finds positions,
   headings, and speeds on arcs 2–5 that yield ~4 Hz RMS BFO residuals —
   consistent with the DSTG noise floor. This demonstrates internal
   consistency and places the aircraft on a south-southwestward track that
   crosses Arc 7 at the latitude determined by BTO.

3. **Post-Arc-7 glide model (soft):** The westward displacement from the arc
   crossing (92.2°E) to the impact zone (90.8°E) comes from a physics-based
   unpowered glide of ~76 NM. This is a modeled extrapolation, not a
   measurement.

None of these are affected by the drift result. The drift evidence is a
separate, independent test — and the result is that drift weakly contradicts
the 90.8°E zone on the most diagnostic site (Reunion timing). The BTO/BFO
case must stand on its own merits; drift does not provide independent support.

### What would resolve the tension

The Reunion timing signal is at the edge of what this approximate model can
reliably detect. Several limitations could shift the result:

1. **HYCOM reanalysis at 1/12° resolution** with daily or 3-hourly time steps
   would resolve mesoscale eddies that OSCAR (1/3°, 5-day) averages out. Eddy
   interactions dominate individual debris trajectories — the difference between
   a Reunion hit and a miss may be a single eddy encounter.

2. **The 91-day OSCAR gap** (January-April 2015) forces linear interpolation
   over 3 months of Indian Ocean currents that change significantly with season.
   HYCOM has no such gaps.

3. **Per-item leeway coefficients** would better represent the aerodynamic
   differences between a flaperon (high windage) and a flat panel (low windage).
   The uniform 0.025 coefficient used here is a rough average.

4. **Stokes drift** (wave-induced transport) is not included. For debris with
   significant freeboard like the flaperon, Stokes drift can contribute
   meaningfully to the net transport.

Whether these refinements would shift the Reunion signal from neutral to
discriminating is unknown. The approximate check has served its purpose: it
confirms the impact zone is plausible (debris can reach all recovery sites)
but doesn't provide independent directional support.

---

## Data pipeline

### OSCAR data access

- Endpoint: `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar`
- Format: CSV via ERDDAP griddap subsetting
- Variables: `u` (zonal), `v` (meridional) surface currents in m/s
- Grid: 106 latitude x 151 longitude points per timestep
- Cache: JSON file at `src-tauri/.cache/oscar_surface_currents_v2.json` (18 MB)
- First fetch: ~100 seconds (48 HTTP requests to ERDDAP)
- Subsequent runs: <1 second (loads from disk cache)

### Implementation

- `src-tauri/src/mh370/oscar.rs` — ERDDAP fetch, CSV parse, disk cache,
  bilinear spatial + linear temporal interpolation
- `src-tauri/src/mh370/drift_transport.rs` — `OscarFieldProvider` implementing
  `FieldProvider` trait, falls back to synthetic currents outside OSCAR domain
- `src-tauri/src/bin/drift_oscar_check.rs` — CLI comparison binary

### Validation

The OSCAR data pipeline was validated against known circulation:

- South Equatorial Current at 20°S: 3/5 sample points show westward flow
- Impact zone at 36°S, 91°E: current speed 0.08-0.14 m/s (physically reasonable)
- Speeds across the domain: 0.01-0.37 m/s (consistent with open-ocean surface
  currents)

### Reproducibility

```bash
cd src-tauri
cargo run --release --bin drift_oscar_check    # full comparison (~2 min)
cargo test mh370::oscar -- --ignored --nocapture  # data pipeline validation (~100s, network)
```

---

## Source attribution

- **OSCAR surface currents:** Bonjean & Lagerloef (2002), "Diagnostic Model
  and Analysis of the Surface Currents in the Tropical Pacific Ocean", J. Phys.
  Oceanogr. Distributed by NOAA/JPL PO.DAAC via CoastWatch ERDDAP.
- **Debris recovery locations and dates:** ATSB "MH370 — Search and debris
  examination update" (Nov 2016); `mh370_data.json` in this repository.
- **ATSB search boundaries:** ATSB "Definition of Underwater Search Areas"
  (Jun 2014); Ocean Infinity public disclosures.
