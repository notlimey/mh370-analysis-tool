# Research Note: Arc 7 Impact Zone Estimate

**Date:** 2026-04-06
**Status:** Preliminary — ERA5 drift analysis supports impact zone (35.8°S best Reunion origin, 1.88× ATSB corridor)

---

## Finding

The MH370 satellite data, when modeled with corrected BFO values and a
physics-based post-Arc-7 glide model, places the probable impact zone at
approximately **35.9°S, 90.8°E** — roughly 200 km west of the western boundary
of the ATSB Phase 2 underwater search area (93–98°E). The aircraft crosses
the 7th BTO arc at approximately 34.8°S, 92.2°E, which is itself just outside
the searched corridor. The westward displacement from the arc to the impact
point is produced by an unpowered glide of 55–79 NM after engine flameout,
along the aircraft's final heading of approximately 200° true. The entire
plausible impact longitude range (90.4–91.8°E) lies west of any area searched
to date.

---

## Method

### Hard constraints (geometry, not assumptions)

**BTO arc rings.** Each hourly handshake's Burst Timing Offset determines a
ring of constant slant range from the Inmarsat-3F1 satellite. The 7th arc
(00:19:29 UTC) fixes the aircraft to a specific curve on the Earth's surface.
The BTO calibration uses the known-position ground logon at 16:00:13 UTC.
BTO measurement noise is ±29 μs for R1200 messages (DSTG Book, Table 10.1),
corresponding to ~4.3 km range uncertainty.

**BFO scoring.** Burst Frequency Offset encodes Doppler from aircraft motion
relative to the satellite. After correcting measured BFO values against
primary sources (joewragg/MH370 FinalData.csv; Holland 2017
arXiv:1702.02432) and adopting the ATSB published oscillator bias of 150 Hz,
the path solver finds candidate paths with ~4 Hz RMS BFO residuals on
level-flight arcs (2–5 and 6b). This reflects the solver's optimization
over position, heading, and speed on each arc — it demonstrates internal
consistency with the DSTG empirical noise floor of 4.3 Hz, not independent
validation of the model. BFO is scored with σ = 4.3 Hz. The BFO at Arc 7
is handled separately (see below).

### Soft constraints (physically grounded assumptions)

**Arc 7 descent envelope.** At Arc 7, the aircraft was descending after engine
flameout. Rather than fitting the Arc 7 BFO as an absolute measurement
(which produces a ~73 Hz residual under level-flight assumption), the model
computes the implied descent rate from the BFO delta between the level-flight
trend and the measured value of 182 Hz. Candidates whose implied descent
rate falls outside the aerodynamic envelope of 2,900–14,800 fpm (Holland
2017, Tables IV and VII) are penalized. This envelope reflects the range from
best-glide clean configuration to high-speed steep spiral, accounting for
phugoid oscillation at a single time point.

**Post-Arc-7 glide model.** After Arc 7, the aircraft is modeled as an
unpowered glide:

- Zero thrust (engines flamed out; SDU reboot at 00:19:29 proves this)
- Glide ratio 15:1 (conservative; clean 777 achieves 17–18:1)
- Starting altitude derived from cruise FL350 minus ~1 minute of unpowered
  descent at the central rate of 4,200 fpm (Holland 2017, Section VI-A
  establishes the SDU outage was "about one minute")
- Glide direction along the aircraft's final heading from the path solver

**Speed and heading scoring.** Candidate paths are scored for speed
consistency (σ = 35 kts between legs), heading continuity, and northward
penalty. Speed range: 350–520 kts. These are softer than BTO/BFO but shape
which arc crossing points survive the beam search.

**Fuel model.** Integrated weight-corrected fuel burn from Arc 1 fuel load
(34,500 kg) through Arc 7. Paths that exhaust fuel before Arc 7 are
penalized. The fuel model uses a power-law speed correction validated against
Boeing 777-200ER performance data.

### Key parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| BFO bias | 150 Hz (fixed) | ATSB/Holland 2017 |
| BFO noise σ | 4.3 Hz | DSTG empirical (20 prior flights of 9M-MRO) |
| BTO noise σ | 29 μs (R1200) | DSTG Book Table 10.1 |
| Glide ratio | 15:1 | Conservative 777 clean config |
| Descent before Arc 7 | ~1 min at 4,200 fpm | Holland 2017 Sec VI-A |
| Descent envelope | 2,900–14,800 fpm | Holland 2017 Tables IV/VII |
| Uplink frequency | 1,646.6525 MHz | Holland 2017 / Ashton et al. 2014 |
| AES satellite altitude | 36,210 km | DSTG Book p. 29 |
| Perth GES | 31.802°S, 115.889°E | DSTG Table 2.1 |

---

## Uncertainty Envelope

The primary uncertainty in impact longitude comes from the altitude at Arc 7
crossing, which depends on how long before 00:19:29 the engines flamed out
and how fast the aircraft was descending during that interval.

| Descent rate | Pre-Arc-7 descent | Altitude at Arc 7 | Glide range | Impact longitude |
|-------------|-------------------|-------------------|-------------|-----------------|
| 2,900 fpm | 1 min | FL321 | 79 NM (147 km) | ~90.4°E |
| 4,200 fpm | 1 min | FL308 | 76 NM (141 km) | ~90.8°E |
| 8,000 fpm | 1 min | FL270 | 67 NM (123 km) | ~91.2°E |
| 14,800 fpm | 1 min | FL202 | 50 NM (92 km) | ~91.8°E |

The impact latitude is approximately 35.5–36.5°S across this range.

**The entire longitude range (90.4–91.8°E) is west of any area searched by
ATSB Phase 2 (93–98°E), Ocean Infinity 2018 (93.5–97°E), or Ocean Infinity
2025–2026 (95–100°E).**

The arc crossing point at 92.2°E is also just west of the ATSB Phase 2
boundary (93°E), so even if the glide model is completely wrong and the
aircraft impacted at the arc crossing, it would still be outside the primary
searched corridor.

### Heading sensitivity (quantified)

The path solver's best-fit final heading is **224.2° true** (southwest). A
±15° sweep of the glide heading, combined with all four altitude scenarios,
produces impact longitudes ranging from **90.8°E to 91.7°E**:

| Heading | FL321 | FL308 | FL270 | FL202 |
|---------|-------|-------|-------|-------|
| 209° | 91.42 | 91.45 | 91.55 | 91.72 |
| 224° (base) | 91.08 | 91.13 | 91.26 | 91.50 |
| 239° | 90.82 | 90.88 | 91.04 | 91.34 |

The impact longitude is insensitive to heading — ±15° changes it by only
±0.3°. This is because at 224° true (roughly southwest), heading variations
rotate the displacement vector but don't dramatically change the east-west
projection.

**The entire heading × altitude parameter space places the impact at
90.8–91.7°E, which is 1.3–2.2° west of the ATSB Phase 2 search boundary
(93°E).** No reasonable combination puts the impact inside any searched area.

### Other uncertainties

- **Glide ratio:** 15:1 is conservative. If 17:1 (clean config optimum), glide
  range increases ~13%, pushing impact ~0.15° further west.
- **Arc crossing latitude:** The beam search places the best path at 34.8°S,
  but the probability distribution along the arc has width. The DSTG
  concentrates probability between 32–39°S.
- **Wind:** The glide model assumes still air. Prevailing westerlies at 35°S
  would reduce the westward ground displacement, pushing impact slightly
  east.

---

## Open Tensions

### Barnacle evidence mildly favors a more northern origin

The MH370 flaperon found on Reunion Island carried active Lepas anatifera
(goose barnacle) colonies. Lepas require water temperatures >18°C for
colonization. Godfrey's drift analysis (radiantphysics.com) found that debris
from ~30°S passes through 19–25°C water en route to Reunion and arrives with
barnacles, while debris taking different paths to East Africa passes through
>25°C equatorial water where barnacles die.

SST at 35°S in March 2014 is approximately 17–19°C — borderline for Lepas
colonization at the crash site. Debris from 35°S would need to drift
northwest for 2–4 weeks before entering water warm enough for colonization.
This is plausible but less comfortable than a 30–33°S origin where initial
SST is 20–22°C and barnacles could colonize immediately.

**Assessment:** The barnacle evidence does not rule out 35°S but it does not
strongly support it. A crash at 30–33°S would be more naturally consistent
with the observed biofouling. This is a 2–5° latitude tension, corresponding
to roughly 220–550 km along the 7th arc.

### Drift evidence is supportive (ERA5 wind, quantified)

A 5,000,000-particle drift simulation using OSCAR currents with ERA5 monthly-
mean 10m wind reanalysis produces **113,842 timing-matched Reunion hits**. The
best-performing origin is at **35.8°S, 90.9°E** (8.0% timed hit rate) — within
0.1° of the BTO/BFO-derived impact zone. Our zone (90-92°E, 34-37°S) produces
**1.88× the Reunion timed hit rate** of the ATSB corridor (93-98°E).

This is the first independent line of evidence that favors our impact zone over
the searched corridor. The key improvement was replacing the synthetic wind
climatology with ERA5 reanalysis — even at monthly resolution, the spatial and
temporal structure of real wind patterns is sufficient to route debris from
35.8°S to Reunion within the observed timeframe. See
`docs/research-note-era5-drift.md` for full methodology and results.

The earlier OSCAR-only result (with synthetic wind) produced zero Reunion timed
hits — that was a wind model limitation, not an oceanographic constraint. See
`docs/research-note-oscar-drift.md` for that analysis.

### Glide heading — resolved

~~The impact longitude is sensitive to the final heading.~~ A ±15° heading
sweep shows only ±0.3° longitude sensitivity. The base heading is 224.2°
true. Across the full heading × altitude parameter space, impact longitude
stays within 90.8–91.7°E. **Heading is not a significant source of
uncertainty for the impact longitude.**

### Pre-Arc-7 descent timing

Holland's "about one minute" SDU outage is the best available estimate, but
it assumes Hypothesis 1 (fuel exhaustion → APU auto-start). Under
Hypothesis 2 (momentary power loss from other cause), the descent could have
started earlier, reducing altitude at Arc 7 and shortening the glide.

### DSTG used different approach

The DSTG did not model post-Arc-7 glide. They applied a descent kernel
(15 NM uniform disc + 30 NM σ Gaussian falloff) centered on the Arc 7
particle positions. Their kernel is radially symmetric, while our glide model
is directional (along the final heading). The DSTG approach produces a
wider, more circular search zone; ours produces a narrower, directionally
displaced zone.

---

## Next Steps

### 1. HYCOM drift modeling (primary)

Integrate HYCOM ocean reanalysis data for the March 2014 – July 2015 period.
For each candidate crash latitude along the 7th arc, simulate debris drift
using realistic currents and compute:

- Arrival timing at Reunion, Mozambique, Tanzania, South Africa
- SST exposure along each drift path
- Whether Lepas colonization is thermally viable

This resolves both the barnacle tension and the simplified-drift limitation
simultaneously.

### 2. Altitude sensitivity via BFO descent rate

The BFO at Arc 7 (182 Hz) implies a specific descent rate for each candidate
position. Rather than using a fixed 1-minute pre-descent, compute the
descent rate implied by the BFO residual at each candidate's Arc 7 crossing
point and derive the altitude from that. This couples the BFO constraint
to the glide model, reducing the altitude uncertainty.

### 3. Cross-validation against known debris timing

Check whether our impact zone at ~35.9°S, 90.8°E is consistent with the
observed debris arrival dates:

- Flaperon at Reunion: found 2015-07-29 (~508 days after crash)
- Flap at Mozambique: found 2016-03-03 (~727 days)
- Panel at South Africa: found 2015-12-28 (~661 days)

If HYCOM drift from 35.9°S, 90.8°E cannot deliver debris to these locations
in the observed timeframes, the impact zone needs revision.

---

## Data Sources and Attribution

- **BFO measured values:** joewragg/MH370 FinalData.csv (R-Channel processed);
  Holland 2017 Table III (Arc 7 values)
- **BFO model:** Holland 2017, arXiv:1702.02432, Equations (1)–(6)
- **ATSB corrections:** Holland 2017 Section III; ATSB via joewragg
- **BFO bias:** ATSB published constant, 150 Hz (Holland 2017; DSTG Book)
- **BFO noise:** DSTG Book (Davey et al. 2016), Table 5.1: σ = 4.3 Hz empirical
- **Descent rate bounds:** Holland 2017, Tables IV, VI, VII
- **SDU outage duration:** Holland 2017, Section VI-A ("about one minute")
- **Barnacle/SST:** Godfrey analysis (radiantphysics.com); Lepas anatifera
  temperature requirements from marine biology literature
- **Searched areas:** ATSB reports; Ocean Infinity public disclosures
- **DSTG methodology:** Davey et al. 2016, "Bayesian Methods in the Search
  for MH370", SpringerOpen. ISBN 978-981-10-0379-0
- **Glide performance:** Boeing 777-200ER performance data; L/D ratio from
  aircraft performance literature
