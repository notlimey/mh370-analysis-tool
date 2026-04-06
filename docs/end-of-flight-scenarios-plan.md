# End-of-Flight Scenario Modeling — Implementation Plan

## Date: 2026-04-06
## Status: Planned (not yet implemented)

---

## Motivation

The current model assumes level flight (vertical_speed = 0) at all arcs and a generic post-Arc 7 glide. This is physically inconsistent:

- The BFO jump from 182 Hz to 252 Hz (+70 Hz) between 00:19:29 and 00:19:37 UTC indicates rapid descent
- The end-of-flight scenario (spiral, ghost flight, active glide) determines the impact point distance from Arc 7
- Different scenarios produce distinct probability hotspots — comparing them reveals which assumptions drive the result

---

## Three Scenarios

### Scenario A — Spiral / Dive

**Physics**: Fuel exhaustion → loss of control → uncontrolled spiral dive

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Vertical speed at Arc 7 | ~8,000 fpm descent | Holland 2017 analysis of +70 Hz BFO jump |
| Post-Arc 7 endurance | ~0 minutes | Rapid impact after fuel exhaustion |
| Post-Arc 7 range | 0-15 NM | Nearly vertical trajectory |
| Impact distance from Arc 7 | 15-20 NM | Minimal horizontal travel |

**BFO effect**: ~44 Hz additional Doppler from vertical speed at Arc 7

### Scenario B — Ghost Flight / Drift

**Physics**: Autopilot-engaged flight → fuel exhaustion → unpowered glide → uncontrolled water impact

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Vertical speed at Arcs 2-6 | 0 fpm | Level autopilot cruise |
| Vertical speed at Arc 7 | ~2,000 fpm descent | Early stages of uncontrolled descent |
| Post-Arc 7 endurance | 10-15 minutes | Short unpowered glide |
| Post-Arc 7 speed | 250-350 kts | Decelerating without thrust |
| Impact distance from Arc 7 | 20-40 NM | Limited glide range |

**BFO effect**: ~11 Hz additional Doppler from modest descent at Arc 7

### Scenario C — Active Glide

**Physics**: Pilot-controlled descent and ditching attempt

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Vertical speed at Arcs 2-6 | 0 fpm | Level cruise (may be pilot-controlled) |
| Vertical speed at Arc 7 | ~1,000-2,000 fpm | Controlled initial descent |
| Post-Arc 7 endurance | 30-60 minutes | Extended controlled glide |
| Post-Arc 7 speed | 200-300 kts | Optimized glide speed for 777 |
| Impact distance from Arc 7 | 60-120 NM | Maximum glide range |

**BFO effect**: ~5-11 Hz additional Doppler from gentle descent at Arc 7

---

## Implementation Plan

### Step 1: Add vertical speed to BFO scoring

The `score_bfo_handshake()` function in `paths.rs` currently passes `vertical_speed_fpm: 0.0`. For Arc 7 (and optionally Arc 6), pass the scenario-specific descent rate.

The BFO model already accepts `vertical_speed_fpm` — the plumbing exists, it's just always called with 0.

### Step 2: Add scenario config parameters

New `AnalysisConfig` fields:

```toml
# End-of-flight scenario
eof_scenario = "ghost"  # "spiral", "ghost", or "glide"
eof_vertical_speed_fpm_arc7 = 2000.0
eof_post_arc7_minutes = 12.0
eof_post_arc7_speed_kts = 300.0
```

Or alternatively, make three preset configs and run them via the sensitivity/comparison system.

### Step 3: Run all three scenarios

For each scenario:
1. Set the vertical speed and post-Arc 7 parameters
2. Run the full pipeline (arcs → paths → heatmap)
3. Record the peak location, fuel-feasible count, BFO residuals
4. Export the heatmap for comparison

### Step 4: Compare results

Produce a comparison view showing:
- Three heatmaps overlaid or side-by-side
- Peak locations and how they differ
- Which scenario has the best BFO fit
- Which scenario is consistent with debris evidence

---

## Vertical Speed → BFO Doppler Conversion

At FL350, an aircraft descending at rate `v_fpm` (feet per minute) contributes additional BFO:

```
v_vertical_km_s = v_fpm × 0.0003048 / 60.0  (fpm → km/s)
Δf_vertical ≈ (f_up / c) × v_vertical × cos(elevation) × 1000  (Hz)
```

Where elevation angle from aircraft to satellite is ~20-25° at the southern Indian Ocean locations.

| Descent Rate (fpm) | Vertical Speed (m/s) | Approx BFO Contribution (Hz) |
|--------------------|---------------------|------------------------------|
| 1,000 | 5.1 | ~5 |
| 2,000 | 10.2 | ~11 |
| 4,000 | 20.3 | ~22 |
| 8,000 | 40.6 | ~44 |
| 15,000 | 76.2 | ~83 |

The +70 Hz BFO jump in 8 seconds at 00:19:37 corresponds to ~6,000-15,000 fpm descent rate onset, depending on heading and satellite geometry.

**Source**: Holland 2017, Section V, "Implications on Descent Rate"

---

## Expected Impact on BFO Residuals

Adding vertical speed at Arc 7 should reduce the mean BFO residual by:
- Scenario A (8,000 fpm): ~30-44 Hz reduction at Arc 7
- Scenario B (2,000 fpm): ~8-11 Hz reduction at Arc 7
- Scenario C (1,000 fpm): ~4-5 Hz reduction at Arc 7

Since Arc 7 is one of 7 scored arcs, the mean residual reduction would be roughly 1/7th of the per-arc improvement.

---

## Open Questions

1. **Should vertical speed affect Arc 6 as well?** The aircraft may have begun altitude changes before the final arc. The 23:14 phone call attempt might indicate crew activity.

2. **Which scenario is most consistent with debris condition?** Flaperon damage pattern suggests high-energy water impact (spiral/dive) rather than controlled ditching.

3. **Does the post-Arc 7 glide range change the heatmap meaningfully?** If the heatmap is anchored to Arc 7 crossings, the post-Arc 7 range only shifts the impact point along the path, not the heatmap peak.

---

## References

1. Holland 2017, "MH370 BFO Analysis — Implications on Descent Rate", arXiv:1702.02432, Section V
2. ATSB, "MH370 — Definition of Underwater Search Areas", Dec 2015
3. Boeing 777-200ER glide performance data
4. Flaperon damage analysis — Malaysian Safety Investigation Report, Appendix 1.12
