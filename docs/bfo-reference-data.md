# BFO Reference Data and Sources

This document records the verified BFO (Burst Frequency Offset) values used in this tool,
their sources, and the reasoning behind corrections made.

## Primary Sources

1. **Holland 2017** — "MH370 Burst Frequency Offset Analysis and Implications on Descent Rate at End-of-Flight",
   Ian D. Holland, Defence Science and Technology Group, Australia.
   arXiv:1702.02432. Tables III and V confirm the last two BFO values (182 Hz and -2 Hz).
   Figure 5 plots measured BFOs from 19:41Z to 00:11Z showing a clean linear trend.
   Equations (1)-(6) define the BFO decomposition used in this tool.

2. **DSTG Book** — "Bayesian Methods in the Search for MH370", Davey, Gordon, Holland, Rutten, Williams.
   SpringerOpen, 2016. ISBN 978-981-10-0378-3. Open access.
   Equations (5.5)-(5.9) define the BFO model. BFO noise sigma = 4.3 Hz from 20 prior 9M-MRO flights.

3. **joewragg/MH370 FinalData.csv** — Processed R-Channel handshake data with satellite ephemeris.
   GitHub: https://github.com/joewragg/MH370
   Contains the canonical R-Channel BFO values for arcs 1-7 (the hourly handshakes after SDU reboot).
   Includes satellite ECEF position/velocity and ATSB correction values at each arc.

4. **Inmarsat SU Log** — Ground station log released via CNN/Malaysia.
   GitHub mirror: https://github.com/sladen/inmarsat-9m-mro/master/inmarsat-su-log-redacted.csv
   Contains raw channel frequency offsets (NOT processed BFO). Covers 16:00-17:07 UTC only (redacted).
   Raw frequency offsets (~14820 Hz) require channel correction to produce BFO values.

5. **Ashton et al. 2014** — "The Search for MH370", Inmarsat team.
   Journal of Navigation, vol. 68, no. 1, pp. 1-22, Oct. 2014.
   DOI: 10.1017/S037346331400068X. Original publication of the BFO/BTO methodology.

6. **Radiant Physics / Bobby Ulich** — Comprehensive independent analyses.
   https://mh370.radiantphysics.com/
   Documents the 18:25 SDU reboot BFO sequence: 142, 273, 176, 175, 172, 144, 143 Hz.
   Uses BFO sigma threshold of < 4.3 Hz for path acceptance.

7. **Duncan Steel** — Independent flight path reconstruction.
   https://www.duncansteel.com/archives/1874
   Reports 1.3 Hz RMS BFO residual across 150 BFO values (Flight Path Model V15.1).

## Verified R-Channel BFO Values

These are the processed BFO values for the R-Channel handshakes used in path reconstruction.
Cross-referenced between joewragg FinalData.csv, Holland 2017, and radiantphysics.com.

| Arc | Time (UTC)    | BFO (Hz) | Message Type                              | Source                    |
|-----|---------------|----------|-------------------------------------------|---------------------------|
| 0   | 16:00:13.406  | 87       | R-Channel Log-on Acknowledge              | SU log (raw → processed)  |
| 0   | 16:42:04.408  | 144      | Acknowledge User Data (takeoff)           | SU log (raw → processed)  |
| 0   | 17:07:55.587  | 130      | ACARS transmission                        | ATSB appendix             |
| 1   | 18:25:27.421  | 142      | Log-on Request (SDU reboot)               | joewragg, radiantphysics  |
| 1   | 18:25:34.461  | 273      | Log-on Acknowledge                        | joewragg, radiantphysics  |
| 2   | 19:41:02.906  | 111      | Hourly handshake                          | joewragg                  |
| 3   | 20:41:04.904  | 141      | Hourly handshake                          | joewragg                  |
| 4   | 21:41:26.905  | 168      | Hourly handshake                          | joewragg                  |
| 5   | 22:41:21.906  | 204      | Hourly handshake                          | joewragg                  |
| 6   | 23:14:01.021  | 168      | Unanswered phone call (R-channel)         | ATSB Table 2              |
| 6   | 00:10:58.528  | 252      | Hourly handshake                          | joewragg                  |
| 7   | 00:19:29.416  | 182      | Log-on Request (fuel exhaustion)          | joewragg, Holland Tbl III |
| 7   | 00:19:37.443  | -2       | Log-on Acknowledge (partial, interrupted) | Holland 2017 Table III    |

### Notes on specific values

**Pre-flight points (Arc 0):** The SU log raw "Frequency Offset" values (14820, 14920 Hz) are raw
channel offsets, not processed BFO. The processed BFO values (~87-144 Hz range) come from the
ATSB processing pipeline. These are used only for calibration, not path scoring.
The exact pre-flight BFO values have minor discrepancies across sources (±5 Hz) because
different analysts apply slightly different channel corrections. The values here use the
ATSB-published processed values.

**Arc 1 (18:25:27, SDU reboot):** The first BFO after SDU reboot (142 Hz) is affected by OCXO
oscillator settling (Holland 2017, Section V). The settling sequence is:
142, 273, 176, 175, 172, 144, 143 Hz over the following minutes. The 142 Hz value was
deemed "untrustworthy" by the SATCOM working group due to low C/N0 and non-zero BER
(Holland 2017, Section V-A). The 273 Hz acknowledge value is dominated by oscillator transient.
Both are flagged UNRELIABLE_BFO in our dataset.

**Arc 6 phone call (23:14:01):** This is a C-Channel measurement, not R-Channel.
The C-Channel uses a different carrier frequency. The ATSB applies a channel correction
to make it comparable to R-Channel values. The corrected value of 168 Hz is consistent
with the linear BFO trend from 19:41 to 00:11. Some sources report raw C-Channel values
of 216-217 Hz before correction.

**Arc 7 acknowledge (00:19:37):** Holland 2017 Table III reports -2 Hz. This extremely low
value (vs 182 Hz just 8 seconds earlier) implies rapid descent at 2,900-14,800 fpm
(Holland Table IV). The BFO was also affected by SDU oscillator warm-up drift, with the
recorded value being 17-136 Hz higher than it would have been at steady state
(Holland Section V-B, point 2).

## ATSB Per-Arc Corrections (δf_sat + δf_AFC)

From Holland 2017 Section III and joewragg FinalData.csv:

| Arc | Time (UTC)    | δf_sat + δf_AFC (Hz) |
|-----|---------------|----------------------|
| 1   | 18:25:27      | +10.8                |
| 2   | 19:41:02      | -1.2                 |
| 3   | 20:41:04      | -1.3                 |
| 4   | 21:41:26      | -17.9                |
| 5   | 22:41:21      | -28.5                |
| 6   | 23:14:01      | -33.1 (interpolated) |
| 6b  | 00:10:58      | -37.7                |
| 7   | 00:19:29      | -38.0                |

## Bias (δf_bias)

Holland 2017 and ATSB: **150 Hz** (some sources say 149.5-152.5 Hz).
Our model calibrates this dynamically from the ground logon at 16:00:13 rather than
using a fixed value, which accounts for any residual between the published constant
and the actual measurement at that point.

## Expected BFO Residuals

Published analyses achieve **1-5 Hz RMS** for well-fitting southern paths:
- Duncan Steel V15.1: 1.3 Hz RMS across 150 BFO values
- Bobby Ulich/UGIB: < 4.3 Hz sigma threshold for path acceptance
- DSTG prior flight analysis: 0.18 Hz mean, 4.3 Hz sigma from 20 prior 9M-MRO flights

If our model produces residuals significantly above ~7 Hz RMS for a good southern path,
the physics model or data has an error.

## Bugs Found and Fixed (2026-04-06)

### Bug 1: Wrong BFO measured values in dataset

The original dataset `src/data/mh370_data.json` had incorrect BFO values for nearly
every handshake. The values appeared to have been transcribed from the wrong source
or column, resulting in ~79 Hz RMS residuals that made BFO scoring ineffective.

Corrected values verified against joewragg FinalData.csv and Holland 2017.
Residuals dropped from 76 Hz to 49 Hz.

### Bug 2: Calibration bias from uncertain gate BFO

The model calibrated the SDU oscillator bias by computing the residual at the
16:00:13 ground logon. But the processed BFO value for this pre-flight handshake
is uncertain (varies ±15 Hz across analyst pipelines), and the calibrated bias
(188 Hz) diverged significantly from the ATSB published value of 150 Hz.

Fix: Use the ATSB published bias (150 Hz) directly, as Holland and the DSTG do.
Residuals dropped from 49 Hz to 21.8 Hz mean.
Arcs 2-5 and 6b now achieve 3.7 Hz RMS — consistent with published analyses.

### Remaining residuals

Arc 7 (00:19:29): +73 Hz residual. Expected — aircraft was in rapid descent at
this point, not level flight. Holland 2017 establishes that the measured BFO of
182 Hz was ~72 Hz below the level-flight trend of 254 Hz (Fig 5), implying
descent at 2,900-14,800 fpm. Our model correctly shows this discrepancy when
assuming level flight.

Arc 6 phone call (23:14): High residual in the diagnostic tool because the
test uses crude positions, not actual BTO-constrained positions.
