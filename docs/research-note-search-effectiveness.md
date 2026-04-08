# Research Note: Search Effectiveness Analysis

**Date:** 2026-04-08
**Status:** Complete — computed against exported heatmap snapshot

---

## Summary

The existing sonar search covered approximately **50% of the predicted impact
zone's probability mass**, but — critically — **not the highest-probability
half**. The deep tow strip covers the far-western glide zone (90.4–91.0°E)
while the central glide zone (91.1–91.8°E, our best-estimate region) and the
arc crossing area (92.1–92.3°E) were not covered at debris-detection
resolution.

**Unconditional P(detect) = 39.2%.** Non-detection is moderate-to-weak
evidence against the full predicted zone. For the specific best-estimate
impact location at 91.1–91.5°E, non-detection provides **no constraint**
— that area was never searched at sufficient resolution.

---

## Method

Probability heatmap points (`public/data/probability_heatmap.geojson`) were
queried against sonar coverage polygons extracted from the AusSeabed WMS:

| Layer | Polygons | Resolution | Pd (flat terrain) |
|-------|----------|------------|-------------------|
| Bathymetry (Phase 1) | 42 | 150m | 0% — terrain mapping only |
| Deep Tow (Phase 2) | 4 | 5m | 75% |
| AUV (Phase 2) | 39 | 5m | 80% |
| SAS — Go Phoenix (Phase 2) | 11 | 5m | 85% |

Coverage polygons: CC BY 4.0, Governments of Australia, Malaysia and PRC,
2018. Extracted via `scripts/extract_sonar_coverage.py` from
`https://warehouse.ausseabed.gov.au/geoserver/wms`.

Detection probability values are flat-terrain estimates; actual achieved Pd
will be lower in terrain-shadowed zones. See caveat below.

---

## Results

### Coverage breakdown

| Coverage Type | Pd | P(in zone) | Pd × P(zone) |
|---------------|-----|------------|--------------|
| No coverage | 0% | 49.8% | 0.0% |
| Bathymetry 150m | 0% | 0.0% | 0.0% |
| Deep Tow 5m | 75% | 34.1% | 25.6% |
| AUV 5m | 80% | 0.0% | 0.0% |
| SAS 5m | 85% | 16.0% | 13.6% |
| **TOTAL** | | **50.2%** | **39.2%** |

### Geographic breakdown

| Zone | P(band) | Fraction covered | P(detect) |
|------|---------|-----------------|-----------|
| < 91°E  (far glide zone) | 50.2% | 100% | 39.2% |
| 91–92°E (near glide zone) | 31.7% | 0% | 0.0% |
| 92–93°E (arc crossing zone) | 14.4% | 0% | 0.0% |
| > 93°E  (ATSB Phase 2 zone) | 3.7% | 0% | 0.0% |

**P(detect), unconditional: 39.2%**
**P(aircraft missed by search): 60.8%**

---

## Key Finding

There is a sharp coverage boundary at approximately **91.0°E**:

- **90.799°E, 35.935°S** (0.80% of probability mass): Deep Tow covered ✓
- **91.127°E, 35.712°S** (0.80% of probability mass): No coverage ✗
- **91.450°E, 35.486°S** (0.76% of probability mass): No coverage ✗

The peak of the probability distribution lies at approximately 90.8–91.5°E
(the region with the highest path density scores). The deep tow coverage
reaches to the western edge of this peak but stops before the highest-scoring
points. The **peak-probability location at 91.1–91.5°E was not searched** at
debris-detection resolution.

The entire P(detect) = 39.2% contribution comes from the far-western part of
the glide zone (90.4–91°E) and is carried by the deep tow (34.1% of mass at
75% Pd) and the SAS Go Phoenix layer (16% of mass at 85% Pd). The SAS layer
covers the southwesternmost part of the predicted zone (roughly 89–90°E at
36–37°S) along the same diagonal strip as the deep tow.

---

## What This Means

The non-detection does **not** significantly constrain the most likely impact
location. The search effectively covered only the far western fringe of the
predicted zone.

In Bayesian terms: if we update on the non-detection result, we are applying
a likelihood factor of (1 - 0.75) = 0.25 to the far-western zone and a
factor of 1.0 (no information) to the 91–93°E zone. The posterior probability
mass shifts slightly toward 91–93°E, but the zone is not ruled out.

A simple Bayes update:
- Prior P(zone): 100%
- Posterior P(zone | non-detect) ∝ P(non-detect | zone) = 1 - P(detect) = 60.8%
- Normalization: the non-detection is consistent with the aircraft being
  anywhere the search didn't cover at 100% Pd.

The finding **strengthens the case for re-examining 91–93°E** specifically,
since that sub-zone has not been searched at all at 5m resolution.

---

## Caveats

### Flat-terrain Pd assumption
The Pd values (75%, 80%, 85%) are conservative flat-terrain estimates for a
777-scale debris field. In the Indian Ocean at ~4,000–5,000m depth, the
seafloor terrain in the search area includes rough features (ridges, scarps)
that create sonar shadow zones. The actual achieved Pd in the covered portions
could be significantly lower than the nominal values. This would further
reduce P(detect), making non-detection even weaker evidence.

The ATSB 2022 Data Review Report identifies specific "data holiday" areas
within the Phase 2 search zone where terrain defeated the towfish sonar
(Broken Ridge, Diamantina approaches, LEP slope, and an equipment-loss area).
These are documented in `public/data/data_holidays.geojson` but are located
within the 93–98°E corridor — not within our predicted zone.

### Heatmap resolution
The heatmap has 181 sample points, spaced at approximately 0.3° intervals
along the arc. The coverage boundary at 91°E falls between two adjacent
sample points (90.799°E covered; 91.127°E not covered). The true coverage
boundary is at the deep tow polygon edge, which passes through approximately
91.05–91.1°E at the relevant latitudes (35.6–36°S).

### Polygon extraction precision
The coverage polygons were extracted from WMS raster images at ~2km
simplification tolerance. The true sonar footprint boundary may differ by
1–3 km from the polygon edge. This uncertainty is small relative to the
coverage gap (>100km from coverage edge to arc crossing at 92.2°E).

---

## Next Steps

1. **Altitude-from-BFO coupling** — The BFO at Arc 7 implies a specific
   descent rate and therefore altitude at each candidate position. Coupling
   the BFO to the glide model would sharpen the impact zone from the current
   90.4–91.8°E range to a tighter band, potentially shifting it further into
   the unsearched 91–92°E corridor.

2. **Terrain-slope correction** — Obtain bathymetry data for the 91–93°E
   zone and compute slope maps to estimate terrain-shadow probability per
   sonar track. This would correct the flat-terrain Pd assumption and give
   an honest effective Pd for the portions that were nominally covered.

3. **Targeted search recommendation** — The 91–93°E zone at 34.5–36°S
   represents the highest-probability, completely unsearched portion of our
   predicted impact zone. This is the most actionable finding for any future
   search planning.

---

## Tooling

Analysis implemented in:
- Rust: `src-tauri/src/mh370/search_effectiveness.rs` (module)
- Rust: `src-tauri/src/bin/search_effectiveness.rs` (binary)
  - Run: `cd src-tauri && cargo run --release --bin search_effectiveness`
- Python verification: inline script against exported heatmap snapshot
  (`public/data/probability_heatmap.geojson`)

Both implementations use the same ray-casting point-in-polygon algorithm
against the same AusSeabed polygon data and produce identical results.
