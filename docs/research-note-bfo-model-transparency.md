# Research Note: BFO Model Transparency

**Date:** 2026-04-07
**Status:** Complete

---

## 1. Model Equations

The BFO model implements the Holland/DSTG decomposition:

```
BFO = delta_f_up + delta_f_comp + delta_f_down + delta_f_afc + delta_f_bias
```

### Component chain

| # | Term | Holland Eq | Description |
|---|------|-----------|-------------|
| 1 | delta_f_up | Eq (3) | Uplink Doppler: frequency shift from aircraft-satellite relative motion at L-band (1646.6525 MHz) |
| 2 | delta_f_comp | Eq (4) | AES compensation: SDU pre-corrects for satellite Doppler using nominal satellite position (0N, 64.5E) at sea level |
| 3 | delta_f_down | Eq (5) | Downlink Doppler: satellite orbital motion causes Doppler at Perth GES at C-band (3615 MHz) |
| 4 | delta_f_afc | Section III | Combined satellite transponder oscillator drift + Perth GES AFC correction, provided per-arc by Inmarsat |
| 5 | delta_f_bias | Section IV | SDU oscillator offset: 150 Hz constant, derived by ATSB from 20 prior flights of 9M-MRO |

**Source:** Holland 2017, "MH370 Burst Frequency Offset Analysis and Implications
on Descent Rate at End-of-Flight", arXiv:1702.02432. Also: DSTG Book (Davey et
al. 2016), Equations (5.5)-(5.9).

---

## 2. Component Breakdown

### Uplink Doppler (delta_f_up)

The dominant signal. Encodes the line-of-sight velocity between aircraft and
satellite. For a southbound aircraft at 35S, this produces BFO values of
~200-260 Hz depending on speed, heading, and satellite position.

**Implementation:** ECEF dot product of relative velocity along line-of-sight
unit vector, scaled by f_uplink/c. Uses spherical Earth ECEF (R=6371 km).

### AES Compensation (delta_f_comp)

The aircraft's SDU partially compensates for satellite Doppler. Critically, it
uses the **nominal** satellite position (not the actual drifted position) and
computes at **sea level** (not cruise altitude). This mismatch between the
SDU's model and reality creates a measurable residual that varies with satellite
drift and aircraft altitude.

**Implementation:** Same ECEF formulation but with aircraft at sea level and
satellite at fixed 0N, 64.5E, 36210 km altitude.

### Downlink Doppler (delta_f_down)

Satellite orbital motion causes Doppler at the Perth GES. This is independent
of the aircraft and varies only with satellite position/velocity. At the time
of the MH370 handshakes, the satellite was in a 1.6-degree inclined orbit.

**Implementation:** ECEF dot product of satellite velocity along satellite-to-GES
unit vector, scaled by f_downlink/c. Perth GES at 31.802S, 115.889E.

### AFC Correction (delta_f_afc)

Inmarsat provided tabulated values for the combined satellite oscillator thermal
drift and Perth GES Enhanced AFC correction at each handshake time. These are
empirical values, not computed from first principles.

**Source:** ATSB via Holland 2017 Section III; joewragg/MH370 GitHub.

| Arc | Time | Correction (Hz) |
|-----|------|----------------|
| 1 | 18:25:27 | +10.8 |
| 2 | 19:41:02 | -1.2 |
| 3 | 20:41:04 | -1.3 |
| 4 | 21:41:26 | -17.9 |
| 5 | 22:41:21 | -28.5 |
| 6 | 23:14:01 | -33.1 (interpolated) |
| 6b | 00:10:58 | -37.7 |
| 7 | 00:19:29 | -38.0 |

### Bias (delta_f_bias)

A constant 150 Hz offset representing the SDU oscillator's frequency error.
Determined by the ATSB from 20 prior flights of 9M-MRO and independently
confirmed by Duncan Steel and Richard Godfrey.

---

## 3. Validation Status

### What in-sample fit means

The path solver (beam search) evaluates hundreds of candidate positions on each
BTO arc ring, scoring each by BFO residual among other criteria. It keeps the
top-scoring candidates and propagates them forward. The ~4 Hz RMS residual on
arcs 2-5 means the solver found positions where the BFO prediction closely
matches measurement. **The solver was designed to find these positions.**

This is analogous to fitting a regression line and reporting R-squared. The
fit quality demonstrates internal consistency but does not prove the model
would predict correctly at positions it didn't optimize for.

### What the DSTG's 4.3 Hz sigma represents

The DSTG (Chapter 9) validated their BFO model against 20 historical flights
of 9M-MRO where the aircraft position was known from ACARS reports at each
handshake time. They achieved:

- Mean residual: 0.18 Hz
- Standard deviation: 4.3 Hz
- Range: -28 to +18 Hz

This is genuine independent validation — known positions, measured BFO, no
optimization. However, this dataset is not publicly available.

### Why independent validation is not possible from public data

We attempted to validate against known-position points for MH370:

| Point | Issue |
|-------|-------|
| Gate logon (16:00:13) | BFO data quality poor — raw SU log processing varies ±15 Hz across analysts |
| Takeoff (16:42:04) | Same data quality issue; position/speed uncertain during takeoff roll |
| ACARS (17:07:55) | Most reliable, but exact FMS-reported position not publicly released |
| Last radar (18:22) | DSTG rejected as quantitatively unreliable at long range |
| 18:28 handshakes | Position is Kalman filter prediction from 18:01, not radar-confirmed |

**Result:** -12.8 Hz residual at the ACARS point (approximate position), -26 Hz
at gate (data quality), -60 Hz at takeoff (data quality + position uncertainty).
See `docs/research-note-bfo-validation-known-positions.md` for full analysis.

### What we can say

- The BFO model uses the same equations and constants as the DSTG
- The model produces residuals consistent with the DSTG noise model on the
  arcs where the solver optimizes (this is expected, not surprising)
- We cannot independently verify our implementation against MH370 data
- The DSTG validated their implementation against non-public data and it worked

---

## 4. Known Limitations

### Spherical Earth model

The ECEF conversions in `bfo.rs` use a spherical Earth (R=6371 km). WGS84 was
attempted but reverted because the satellite module also uses spherical
geodetic conversion, creating a ~14 km coordinate inconsistency that degraded
residuals to ~21.5 Hz. The spherical model is internally consistent.

**Upgrade path:** Pass satellite ECEF coordinates directly to the BFO model,
bypassing the geodetic round-trip. This would allow WGS84 for the aircraft
ECEF conversion without affecting the satellite coordinates.

### Arc 7 descent not modeled in BFO prediction

At Arc 7 (00:19:29), the aircraft was descending after engine flameout. The
BFO prediction assumes level flight, producing a ~73 Hz residual. This is
handled separately via a descent envelope constraint (Holland 2017, Tables
IV/VII: 2900-14800 fpm), not by fitting the BFO directly.

### AFC corrections adopted, not derived

The per-arc corrections (delta_f_sat + delta_f_AFC) are tabulated values
provided by Inmarsat to the ATSB. We adopt them as-is. We do not independently
derive them because they depend on internal satellite telemetry (oscillator
temperature, eclipse timing) that is not publicly available.

### Fixed bias, not estimated

The DSTG estimated bias via a Rao-Blackwellised particle filter with a prior
of sigma=25 Hz. We use the fixed ATSB constant of 150 Hz. This is simpler but
means our model cannot adapt to per-flight bias variation. For MH370, the fixed
constant produces good residuals, so this is not a practical limitation.

---

## 5. What Would Constitute Proper Independent Validation

### Tier 1: Definitive (not currently available)

The DSTG's 20-flight validation dataset. Running our BFO model against flights
where aircraft position is known from ACARS/radar at each handshake time. If
our implementation matches their 4.3 Hz sigma, it is validated.

### Tier 2: Strong (requires data release)

Exact FMS-reported positions from the MH370 ACARS transmissions (16:42-17:07).
These positions are in the Malaysian investigation files but not publicly
released. Even 2-3 verified positions with corresponding BFO values would
provide a meaningful test.

### Tier 3: Approximate (possible now, limited value)

Estimate the 18:01 radar Kalman filter position from DSTG Figure 4.3 and
propagate to 18:28. This gives a model-derived (but independent-model) position
for checking against the 18:28 BFO. Value is limited because the position is
not directly observed.

---

## Sources

- Holland 2017, arXiv:1702.02432 — BFO decomposition, Equations (1)-(6)
- DSTG Book (Davey et al. 2016), ISBN 978-981-10-0379-0 — Equations (5.5)-(5.9),
  validation methodology (Chapter 9), application (Chapter 10)
- Ashton et al. 2014, J. Navigation — original Inmarsat methodology
- ATSB correction data via joewragg/MH370 GitHub
