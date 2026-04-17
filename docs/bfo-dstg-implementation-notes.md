# BFO Model — DSTG/Holland Implementation Notes

## Date: 2026-04-06
## Status: Implemented and validated

---

## The DSTG/Holland BFO Formula

The BFO (Burst Frequency Offset) is decomposed into six terms per Holland 2017, Eq. (1):

```
BFO = Δf_up + Δf_comp + Δf_down + δf_sat + δf_AFC + δf_bias
```

### Term definitions

| Term | Description | Time-varying? | Source |
|------|-------------|---------------|--------|
| Δf_up | Uplink Doppler (aircraft → satellite) | Yes (aircraft + satellite motion) | Holland Eq. (3) |
| Δf_comp | AES frequency compensation error | Yes (aircraft motion) | Holland Eq. (4) |
| Δf_down | Downlink Doppler (satellite → Perth GES) | Yes (satellite orbital motion) | DSTG Eq. (5.8) |
| δf_sat | Satellite transponder oscillator thermal drift | Yes (eclipse, heater cycling) | Inmarsat-provided |
| δf_AFC | Perth GES Enhanced AFC correction | Yes (24-hr moving average) | Inmarsat-provided |
| δf_bias | SDU oscillator offset | ~Constant per flight | Calibrated from ground logon |

### Holland Eq. (3) — Uplink Doppler

```
Δf_up = (f_up / c) × (v_s - v_x) · (p_x - p_s) / |p_x - p_s|
```

- `f_up` = 1,646,652,500 Hz (L-band uplink)
- `v_s`, `p_s` = satellite velocity and position (ECEF)
- `v_x`, `p_x` = aircraft velocity and position (ECEF)
- Sign: approaching aircraft → negative Δf_up

**Source**: Holland 2017, arXiv:1702.02432, page 4

### Holland Eq. (4) — AES Compensation

```
δf_comp = (f_up / c) × v̂_x · (p̂_x - p̂_s) / |p̂_x - p̂_s|
```

The AES (Aircraft Earth Station / SDU) pre-compensates the transmit frequency using imperfect knowledge:

- **v̂_x**: Aircraft horizontal velocity only (NO vertical speed compensation)
- **p̂_x**: Aircraft position at SEA LEVEL (altitude = 0), not cruise altitude
- **p̂_s**: Nominal satellite at 0°N, 64.5°E, altitude 36,210 km (422 km HIGHER than the standard GEO 35,788 km)

**Source**: DSTG Book page 29; Holland 2017 Eq. (4)

### Downlink Doppler

```
Δf_down = (f_down / c) × v_s · (p_ges - p_s) / |p_ges - p_s|
```

- `f_down` = 3,615,000,000 Hz (C-band downlink)
- Perth GES: -31.802°S, 115.889°E (DSTG Table 2.1)
- Varies ~188 Hz over the flight as satellite orbits

---

## Critical Constants

### Corrected from original implementation

| Constant | Old (wrong) | Correct | Source |
|----------|-------------|---------|--------|
| F_uplink | 1,626,500,000 Hz | **1,646,652,500 Hz** | Holland 2017 p.4; Ashton et al. 2014 |
| AES satellite altitude | 35,786 km | **36,210 km** | DSTG Book p.29 ("422 km higher") |
| AES aircraft altitude | Cruise (10.668 km) | **Sea level (0 km)** | DSTG Book p.29 |
| Downlink frequency | Not modeled | **3,615,000,000 Hz** | Inmarsat I3F1 specs |
| Perth GES | Not modeled | **-31.802°S, 115.889°E** | DSTG Table 2.1 |

### Sign conventions

Holland Eq. (3) and (4) use the same sign convention internally. The sign in Eq. (3) is OPPOSITE to the DSTG Book Eq. (5.7) — see Holland footnote 4. Both produce identical final BFO values.

Our `range_rate(pos_a, vel_a, pos_b, vel_b)` returns `(pos_a - pos_b) · (vel_a - vel_b) / |pos_a - pos_b|`, which is positive when objects separate. Holland uses `(v_s - v_x) · (p_x - p_s)` which equals `-range_rate(sat, aircraft)`.

---

## ATSB Per-Arc Corrections (δf_sat + δf_AFC)

These values were provided by Inmarsat to the Flight Path Reconstruction Group. They are NOT derivable from the satellite ephemeris alone — they depend on:
- Satellite internal oscillator thermal behavior
- Eclipse between 19:19 and 20:26 UTC (causes a kink in the curve)
- AFC receiver algorithm (24-hour moving average, misconfigured positive latitude for Perth)
- Burum (Netherlands) Pilot signal reference

### Tabulated values

| Arc | Time (UTC) | δf_sat + δf_AFC (Hz) |
|-----|------------|---------------------|
| 1 | 18:25:27 | +10.8 |
| 2 | 19:41:02 | -1.2 |
| 3 | 20:41:04 | -1.3 |
| 4 | 21:41:26 | -17.9 |
| 5 | 22:41:21 | -28.5 |
| 6a | 23:14:01 | -33.1 (interpolated) |
| 6b | 00:10:58 | -37.7 |
| 7 | 00:19:29 | -38.0 |

ATSB constant bias (δf_bias): **150 Hz** (Holland 2017). Note: joewragg/ATSB appendix data uses 152.5 Hz (Ashton et al. 2014). The code uses 150 Hz.

**Source**: Holland 2017, arXiv:1702.02432; Ashton et al. 2014, Table 6

---

## Satellite Ephemeris

### The problem

The original embedded ephemeris (`src/data/i3f1_ephemeris.json`) had only 11 points starting at 16:30 UTC. The ground calibration handshake is at 16:00:13 UTC — before the ephemeris start. This forced a sinusoidal fallback model controlled by the configurable `satellite_drift_amplitude_deg` parameter.

The sensitivity analysis showed this parameter shifted the crash location peak by **1,996 km** — the largest single source of model instability.

### The fix

Extended the ephemeris with 2 data points at 16:00 and 16:15 UTC from Henrik Rydberg's PAR5 parametric ephemeris.

**Satellite position at 16:00 UTC, 7 March 2014:**
- Sub-satellite point: **0.960°N, 64.555°E**
- ECEF: x=18118.888, y=38081.754, z=706.675 km
- Velocity: vx=0.002243, vy=-0.000873, vz=0.071251 km/s
- Altitude: ~35,807 km

### PAR5 data provenance

Dr. Henrik Rydberg created a parametric fit to 11 Inmarsat-supplied satellite positions. It provides second-by-second ECEF coordinates from 16:00 UTC through 02:30 UTC.

**Validation:**
- PAR5 at 16:00:13 vs joewragg GMAT propagation: **58 meters** agreement
- PAR5 at 16:30 vs existing ephemeris: **42 meters** agreement

**Source**: https://bitmath.se/org/mh370/satellite-par5-ecef.txt.gz
**Reference**: Duncan Steel, "The locations of Inmarsat-3F1 during the flight of MH370", https://www.duncansteel.com/archives/1240

### Result

After extending the ephemeris, satellite drift amplitude sensitivity dropped from **1,996 km to 0 km**. The sinusoidal fallback is no longer used for any computation.

---

## Validation Results

### Known-position BFO measurements

| Point | Time | Measured | Our Model | Residual |
|-------|------|----------|-----------|----------|
| Gate (16:00, stationary) | 16:00:13 | 88 Hz | 88.0 Hz | 0.0 Hz (calibration point) |
| ACARS (17:07, 472 kts hdg 025°) | 17:07:55 | 132 Hz | 133.1 Hz | **+1.1 Hz** |

The ACARS validation point confirms the DSTG formula is correct — 1.1 Hz residual at a known in-flight state.

### Path scoring residuals

Mean absolute BFO residual across beam search paths: **76.1 Hz** (target: <20 Hz)

The remaining ~76 Hz is dominated by:
1. No vertical speed modeling at any arc (especially Arc 7 descent)
2. Crude single-axis heading search in the beam search
3. The BFO still not distinguishing north vs south (northward penalty does this work)

### Sensitivity analysis progression

| Parameter | Session start | After fuel fix | After BFO+ephemeris |
|-----------|--------------|----------------|---------------------|
| BFO sigma | 2,374 km (#1) | 2,185 km (#1) | 731 km (#4) |
| Sat drift amplitude | 4 km | 39 km | **0 km** (last) |
| Northward penalty | 0 km | 0 km | 2,107 km (#1) |
| Fuel at Arc 1 | 154 km | 193 km | 116 km |

---

## References

1. Holland 2017, "MH370 Burst Frequency Offset Analysis and Implications on Descent Rate at End-of-Flight", arXiv:1702.02432 — https://arxiv.org/abs/1702.02432
2. DSTG Book, Davey et al. 2016, "Bayesian Methods in the Search for MH370", Springer — https://library.oapen.org/bitstream/handle/20.500.12657/27976/1/1002023.pdf
3. Ashton et al. 2014, "The Search for MH370", Journal of Navigation — https://www.cambridge.org/core/journals/journal-of-navigation/article/search-for-mh370/D2D1C4C99E7BFDE35841CFD70081114A
4. Duncan Steel, satellite geometry — https://www.duncansteel.com/archives/1240
5. PAR5 ephemeris (Rydberg) — https://bitmath.se/org/mh370/satellite-par5-ecef.txt.gz
6. Victor Iannello / Radiant Physics — https://mh370.radiantphysics.com/
7. joewragg/MH370 GitHub (ATSB data) — https://github.com/joewragg/MH370
8. Boeing Performance Analysis, Appendix 1.6E — https://www.mh370report.com/pdf/Boeing%20Performance%20Analysis%20Appendix-1.6E.pdf
9. Malaysian Safety Investigation Report — https://reports.aviation-safety.net/2014/20140308-0_B772_9M-MRO.pdf
