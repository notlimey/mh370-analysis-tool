# MH370 Satellite Data Analysis: A Geometric Finding for Expert Review

**Date:** 2026-04-07
**Author:** Computer scientist, no aviation investigation background
**Tool:** [github.com/notlimey/mh370-analysis-tool](https://github.com/notlimey/mh370-analysis-tool)

---

## Context and Framing

The author is a computer scientist with no background in aviation accident investigation. This work was developed with significant LLM assistance (Claude); the methodology and reasoning have been reviewed by the author, and the four critical path calculations — BTO arc geometry, BFO residual sign and magnitude, glide range arithmetic, and drift seed coordinates — have been independently verified by hand. The codebase is open-source and the interactive tool allows independent parameter verification. The goal is not to claim a solution but to present a specific geometric finding, together with an honest assessment of its limitations, for expert review.

---

## The Core Finding

The BTO arc crossing places the aircraft at **34.81S, 92.21E** on the 7th arc — just outside the ATSB Phase 2 western boundary (93E). Combined with a physics-based post-Arc-7 glide model (FL308 starting altitude, 15:1 L/D, 76 NM range along the solver's best-fit heading of 224.2 true), the projected impact zone is **35.9S, 90.8E**. A sweep of the full heading (+/-15 deg) and altitude (FL202-FL321) parameter space produces impact longitudes of 90.8-91.7E — the entire uncertainty envelope is west of all searched areas: ATSB Phase 2 (93-98E), Ocean Infinity 2018 (93.5-97E), and Ocean Infinity 2025-2026 (95-100E). The rest of this document explains how this was derived and why it might be wrong.

---

## BTO Geometry

BTO (Burst Timing Offset) is a round-trip propagation delay between the aircraft and the Inmarsat-3F1 satellite. Each handshake's BTO determines a ring of constant slant range on the Earth's surface. This is a hard geometric constraint — it does not depend on assumptions about aircraft behavior, speed, or heading.

The BTO calibration uses the known-position ground logon at KLIA (16:00:13 UTC), where the aircraft's location on the gate is independently confirmed. The calibrated BTO-to-range conversion then places the aircraft on a specific arc at each subsequent handshake time. BTO measurement noise is +/-29 us for R1200 messages (DSTG Book, Table 10.1), corresponding to ~4.3 km range uncertainty — small relative to the arc length.

The 7th arc (00:19:29 UTC) is the final constraint. The path solver, working forward through arcs 2-6b with BFO scoring, crosses the 7th arc at approximately 34.8S, 92.2E. This crossing latitude is determined jointly by BTO geometry and BFO-constrained heading/speed, but the arc ring itself — the locus of possible positions — is purely geometric.

| Parameter | Value | Source |
|-----------|-------|--------|
| BTO noise sigma | 29 us (R1200) | DSTG Book Table 10.1 |
| BFO noise sigma | 4.3 Hz | DSTG empirical (20 prior flights of 9M-MRO) |
| BFO bias | 150 Hz (fixed) | ATSB / Holland 2017 |
| Uplink frequency | 1,646.6525 MHz | Holland 2017 / Ashton et al. 2014 |
| AES satellite altitude | 36,210 km | DSTG Book p. 29 |
| Perth GES | 31.802S, 115.889E | DSTG Table 2.1 |

The 7th arc crossing at 92.2E is itself just outside the ATSB Phase 2 search boundary (93E). Even without any glide model, the arc crossing is in unsearched territory.

---

## BFO Constraint

Burst Frequency Offset encodes Doppler shift from aircraft-satellite relative motion. The model implements the Holland/DSTG five-component decomposition:

```
BFO = delta_f_up + delta_f_comp + delta_f_down + delta_f_afc + delta_f_bias
```

where delta_f_up is the uplink Doppler from aircraft motion (the dominant signal), delta_f_comp is the SDU's partial compensation using the satellite's nominal (not actual drifted) position at sea level, delta_f_down is the downlink Doppler from satellite orbital motion at the Perth GES, delta_f_afc is the Inmarsat-provided transponder/AFC correction per arc, and delta_f_bias is the 150 Hz oscillator offset derived by the ATSB from 20 prior flights of 9M-MRO.

On level-flight arcs (2-5 and 6b), the path solver achieves ~4 Hz RMS BFO residuals. This is consistent with the DSTG empirical noise floor of 4.3 Hz.

**The critical caveat:** The path solver (beam search) evaluates hundreds of candidate positions on each arc, scoring by BFO residual among other criteria, and keeps the top-scoring candidates. The ~4 Hz result means the solver found positions where BFO predictions closely match measurements. The solver was designed to find these positions. This is analogous to reporting R-squared on a fitted regression — it demonstrates internal consistency, not predictive accuracy at positions the solver did not optimize for.

Independent validation against known MH370 positions is not possible from public data. The pre-flight BFO values (gate logon, takeoff) suffer from data quality issues in SU log processing (+/-15 Hz across analysts). The ACARS point at 17:07:55 shows a -12.8 Hz residual but uses an approximate position (the actual FMS-reported coordinates were never publicly released). The 18:28 handshake positions are Kalman filter predictions from 18:01, not radar fixes. There are no published data points where both position and BFO are independently known and reliable for MH370 after departure.

The DSTG validated their implementation of the same BFO decomposition against 20 prior flights of 9M-MRO where ACARS provided known positions — achieving 0.18 Hz mean, 4.3 Hz sigma. That validation dataset is the definitive test, but it is not publicly available. We adopt the DSTG's 4.3 Hz sigma on the basis of their validation, not ours.

---

## Post-Arc-7 Glide Model

At Arc 7 (00:19:29 UTC), the aircraft's SDU rebooted — proving engine flameout, since the SDU is powered by the left main AC bus and would only reboot via APU auto-start after both engines lost fuel. The measured BFO of 182 Hz at Arc 7 implies a descent rate between 2,900 and 14,800 fpm (Holland 2017, Tables IV and VII), spanning the range from best-glide clean configuration to high-speed steep spiral.

The glide model parameters:

- **Starting altitude:** FL308 (derived from cruise FL350 minus ~1 minute of unpowered descent at 4,200 fpm, where Holland 2017 Section VI-A establishes the SDU outage was "about one minute")
- **Glide ratio:** 15:1 (conservative; clean 777 achieves 17-18:1)
- **Direction:** Along the path solver's final heading (224.2 true)
- **Range:** 76 NM (141 km) at the central altitude estimate

The heading x altitude sensitivity:

| Heading | FL321 | FL308 | FL270 | FL202 |
|---------|-------|-------|-------|-------|
| 209 deg | 91.42E | 91.45E | 91.55E | 91.72E |
| 224 deg (base) | 91.08E | 91.13E | 91.26E | 91.50E |
| 239 deg | 90.82E | 90.88E | 91.04E | 91.34E |

Impact longitude is insensitive to heading — +/-15 deg changes it by only +/-0.3 deg — because at 224 true (roughly southwest), heading variations rotate the displacement vector without dramatically changing the east-west projection.

**This is the weakest link in the chain.** The DSTG explicitly chose not to model a directional post-Arc-7 glide. They applied a radially symmetric descent kernel (15 NM uniform disc + 30 NM sigma Gaussian falloff) centered on Arc 7 particle positions — acknowledging that the post-flameout trajectory is too uncertain for directional modeling. The ATSB's Boeing 777 simulator studies showed that uncontrolled 777s frequently enter spiral dives rather than stable glides. A spiral dive would collapse the impact point back toward the arc crossing at ~92E — still outside the primary searched corridor, but by a much smaller margin.

---

## Drift Evidence

The drift analysis progressed through two stages, and the progression matters.

**Stage 1: OSCAR currents with synthetic wind.** A 1,000-particle simulation per origin using OSCAR satellite-derived surface currents (1/3 deg, 5-day composites) and a latitude-dependent synthetic wind climatology. Result: zero timing-matched Reunion hits from the impact zone. The ATSB corridor outperformed on Reunion timing (5 hits bracketing the observed day 508 versus 1 late hit from 90.8E). This was reported honestly as "weakly contradictory" for the 90.8E zone.

**Stage 2: OSCAR currents with ERA5 monthly-mean wind.** The only change was replacing the synthetic wind with ERA5 reanalysis (0.25 deg, monthly means, March 2014 - August 2015). The particle count was increased to 5,000,000 (50,000 per origin x 100 origins along the 7th arc). Result:

- **113,842 timing-matched Reunion hits** across all particles (2.28% rate)
- The synthetic wind model produced **zero** from the same particle count
- Best-performing origin: **35.8S, 90.9E** (8.0% timed hit rate) — within 0.1 deg of the BTO/BFO-derived impact zone
- Our zone (90-92E, 34-37S) produces **1.88x the Reunion timed hit rate** of the ATSB corridor (93-98E)

| Zone | Origins | Avg timed hits/origin | Best origin | Best rate |
|------|---------|----------------------|-------------|-----------|
| Our zone (90-92E, 34-37S) | 7 | 2,863 | 35.8S, 90.9E | 8.0% |
| ATSB corridor (93-98E) | 24 | 1,519 | 30.8S, 96.8E | 4.5% |

The single change — monthly ERA5 spatial structure replacing synthetic climatology — was sufficient. Even at monthly resolution (not capturing individual storms), real east-west wind gradients across the Indian Ocean route debris from 35.8S to Reunion within the observed 508-day timeframe.

**Limitations of the drift result:** Monthly means miss synoptic variability (storms, blocking events). OSCAR at 1/3 deg misses mesoscale eddies that dominate individual particle trajectories. The leeway coefficient is fixed at 0.025 for all debris types, while the flaperon (high windage) likely has a higher effective coefficient than flat panels. OSCAR has a 91-day data gap (January-April 2015) bridged by linear interpolation. This result is supportive but not definitive — it provides a discriminating signal, not proof.

---

## Honest Caveats

1. **The glide model is the load-bearing assumption.** The claim that the impact zone is in unsearched territory depends on the directional glide displacing the impact 1.3-2.2 deg west of the arc crossing. Remove the glide and the result converges to ~92E — at the ATSB Phase 2 boundary, not deep within it, but no longer clearly unsearched. The DSTG used a symmetric descent kernel instead of a directional glide for exactly this reason. Boeing 777 simulator studies show uncontrolled aircraft frequently enter spiral dives, not stable glides. A controlled glide requires either an active pilot or a particularly favorable autopilot/trim state at flameout.

2. **BFO validation is in-sample.** The path solver optimizes position, heading, and speed on each arc to minimize BFO residuals. The ~4 Hz RMS result demonstrates that the solver can find internally consistent solutions — it does not demonstrate that the BFO model produces accurate predictions at arbitrary positions. Independent validation against known MH370 positions is not possible from publicly available data. The DSTG's 4.3 Hz sigma (from their 20-flight study) is adopted on trust.

3. **ERA5 wind is monthly mean.** The drift result transformed from contradictory to supportive with a single modeling change (wind field). This sensitivity to wind representation suggests the result could shift again with higher-resolution data. Monthly means cannot capture the synoptic events (cyclones, sustained wind anomalies) that may dominate individual debris trajectories over 500+ days.

4. **95% LLM-generated codebase.** The implementation was largely written by Claude. The four critical path calculations (BTO arc geometry, BFO residual computation, glide range arithmetic, drift seed coordinates) have been verified by hand against source equations. The full codebase has not been independently reviewed. The tool is open-source for this reason.

---

## Open Questions

- **Does HYCOM at 1/12 deg daily resolution confirm the drift result?** OSCAR at 1/3 deg with a 91-day gap is a coarse test. HYCOM resolves mesoscale eddies that may dominate individual trajectories. Whether this strengthens, confirms, or overturns the ERA5 result is unknown.

- **Can the Arc 7 BFO constrain the glide altitude?** The measured BFO of 182 Hz implies a specific descent rate at each candidate position. Rather than using a fixed 1-minute pre-descent assumption, the descent rate could be derived from the BFO residual at each candidate's Arc 7 crossing, coupling the BFO constraint to the glide model and potentially narrowing the altitude uncertainty.

- **What do the barnacle temperature constraints imply?** The impact zone at 35.9S is at the lower bound of Lepas anatifera colonization temperature (SST ~17-19C at 35S in March 2014). Debris from 30-33S would encounter 20-22C water immediately, more naturally consistent with the observed biofouling. This is a 2-5 deg latitude tension that the current model does not resolve.

---

## Interactive Tool and Reproducibility

The analysis is implemented in an open-source desktop application built with Tauri 2 (Rust backend, SolidJS frontend, Mapbox GL visualization). Every parameter — BFO bias, noise sigma, glide ratio, descent envelope, speed range, fuel load — is configurable through the interface. The BFO stepthrough panel displays each Doppler component and its source for any candidate path. The drift simulation is reproducible with the commands documented in `docs/research-note-era5-drift.md` (requires a Copernicus CDS account for ERA5 data). Reviewers can change any assumption and recompute. The tool is available at [github.com/notlimey/mh370-analysis-tool](https://github.com/notlimey/mh370-analysis-tool).

---

## Data Sources and Attribution

- **BFO measured values:** joewragg/MH370 FinalData.csv (R-Channel processed); Holland 2017 Table III (Arc 7 values)
- **BFO model:** Holland 2017, arXiv:1702.02432, Equations (1)-(6)
- **BFO bias:** ATSB published constant, 150 Hz (Holland 2017; DSTG Book)
- **BFO noise:** DSTG Book (Davey et al. 2016), Table 5.1: sigma = 4.3 Hz empirical
- **BTO noise:** DSTG Book, Table 10.1: sigma = 29 us (R1200)
- **Descent rate bounds:** Holland 2017, Tables IV, VI, VII
- **SDU outage duration:** Holland 2017, Section VI-A ("about one minute")
- **DSTG methodology:** Davey et al. 2016, "Bayesian Methods in the Search for MH370", SpringerOpen. ISBN 978-981-10-0379-0
- **Glide performance:** Boeing 777-200ER performance data; L/D ratio from aircraft performance literature
- **Searched areas:** ATSB reports; Ocean Infinity public disclosures
- **ERA5 wind:** Hersbach et al. (2020), "The ERA5 global reanalysis", Q.J.R. Meteorol. Soc., 146, 1999-2049. DOI: 10.1002/qj.3803. CDS dataset DOI: 10.24381/cds.f17050d7. Copernicus License.
- **OSCAR currents:** Bonjean & Lagerloef (2002), "Diagnostic Model and Analysis of the Surface Currents in the Tropical Pacific Ocean", J. Phys. Oceanogr. Distributed by NOAA/JPL PO.DAAC via CoastWatch ERDDAP. CC BY 4.0.
- **Barnacle/SST:** Godfrey analysis (radiantphysics.com); Lepas anatifera temperature requirements from marine biology literature
- **Debris recovery data:** ATSB "MH370 — Search and debris examination update" (Nov 2016)
