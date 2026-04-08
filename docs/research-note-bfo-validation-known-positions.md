# Research Note: BFO Validation on Known Positions

**Date:** 2026-04-07
**Status:** Inconclusive — data quality limits prevent clean validation

---

## Objective

Test whether the BFO Doppler model produces accurate predictions at positions
where the aircraft location is independently known (from gate position, radar,
or ACARS), without any solver optimization. This addresses the concern that the
~4 Hz RMS residuals on arcs 2–5 are an in-sample artifact of the beam search
optimizing position/heading/speed to minimize BFO residuals.

---

## Method

The BFO model (`bfo.rs`) predicts BFO using the full Holland/DSTG decomposition:
BFO = delta_f_up + delta_f_comp + delta_f_down + corrections + bias. We evaluate
this at three known positions with no optimization — the positions are fixed from
independent sources.

---

## Results

| Position | Time (UTC) | Lat | Lon | Heading | Speed | Measured BFO | Predicted BFO | Residual |
|----------|-----------|-----|-----|---------|-------|-------------|--------------|---------|
| KLIA gate | 16:00:13 | 3.12°N | 101.69°E | 0° | 0 kts | 87 Hz | 60.6 Hz | -26.4 Hz |
| Takeoff | 16:42:04 | 3.12°N | 101.69°E | 330° | 160 kts | 144 Hz | 84.1 Hz | -59.9 Hz |
| ACARS | 17:07:55 | 5.5°N | 103.5°E | 25° | 471 kts | 130 Hz | 117.2 Hz | -12.8 Hz |

---

## Analysis

### Pre-flight points (gate, takeoff): data quality issue

The measured BFO values of 87 Hz and 144 Hz come from raw SU log frequency
offsets processed through an uncertain pipeline. The raw values (~14820 Hz)
require channel corrections that vary by ±15 Hz across analysts (documented
in `docs/bfo-reference-data.md`). The 87 Hz value is from a different processing
chain than the R-Channel handshakes used for path scoring.

The 60 Hz discrepancy at takeoff is too large to be a model error alone — it
strongly suggests the measured value is unreliable or the position/speed
assumptions are wrong (the aircraft may have been airborne and accelerating,
not at the gate position with rotation speed).

**These points cannot validate or invalidate the model** due to measurement
uncertainty.

### ACARS point (17:07:55): position-dependent, likely within noise

**Update 2026-04-07:** The -12.8 Hz residual reported above used an approximate
position (5.5°N, 103.5°E). Using the ACARS-reported position (5.27°N, 102.79°E)
from the dataset, the residual drops to +1.1 Hz — well within the 4.3 Hz noise
floor. The true FMS coordinates were never publicly released, so neither position
is exact, but the residual is position-dependent rather than indicative of a
systematic model error. Additionally, no per-arc δf_sat + δf_AFC correction is
tabulated for 17:07 (those begin at Arc 1), adding further uncertainty.

The heading (25°) and speed (471 kts) are reasonable cruise assumptions
but not independently verified at this exact moment.

---

## Why a clean validation is harder than expected

Review of the DSTG Book (Chapter 4, page 21) reveals that the 18:28 positions
are **not independently known from radar**:

> "The 18:22 radar observation was not used quantitatively because the latitude
> and longitude derived from it are likely to be less accurate at long range...
> the numerical values were not used. Instead, a prior was defined at 18:01 at
> the penultimate radar point using the output of the Kalman filter."

This means:

1. **18:22 last radar fix** — Position is in our dataset (6.8°N, 97.7°E) but
   the DSTG rejected it as quantitatively unreliable due to long-range angular
   errors. The nearest BFO (18:25:27) is flagged UNRELIABLE_BFO due to OCXO
   settling.

2. **18:28:05 and 18:28:14** — Reliable BFO (R1200, σ=29μs BTO, used per DSTG
   Table 10.1). But the aircraft position at 18:28 is the Kalman filter
   prediction forward from 18:01 — not from radar. No published source gives
   exact lat/lon at 18:28.

3. **18:39:55 C-channel** — BFO only (no BTO). Position entirely model-derived.
   The aircraft had already turned south by this time.

4. **ACARS at 17:07:55** — The FMS-reported position was not released publicly.

**There are no published data points where both position and BFO are independently
known and reliable for the MH370 accident flight after departure.** The DSTG
validated their BFO model against 20 prior flights of 9M-MRO (Chapter 9) where
ACARS provided known positions — achieving 0.18 Hz mean, 4.3 Hz sigma. That
validation dataset is the definitive test, but it is not publicly available.

### What could still be done

- **Validation flights:** If the DSTG's 20-flight validation dataset were available,
  running our BFO model against it would provide a clean independent test.
- **Approximate 18:01 position from Fig 4.3:** The Kalman filter output at 18:01
  could be estimated from the radar track map, then propagated to 18:28 at
  filtered speed. This gives a model-derived (but independent-model) position.

---

## Conclusion

The independent validation is inconclusive — and not because of model quality,
but because the data needed for a clean test does not exist in the public record.

The pre-flight BFO values are too unreliable. The ACARS point shows -12.8 Hz
but uses an approximate position. The 18:28 points (best BFO quality) have no
published position. The DSTG's own validation used a non-public dataset of
20 prior flights.

The ~4 Hz RMS on arcs 2–5 remains an in-sample result. This does not mean the
model is wrong — the DSTG achieved similar residuals with the same BFO
decomposition — but the evidence for *our* implementation's accuracy is weaker
than a residual number alone suggests.

---

## Sources

- **Measured BFO values:** `docs/bfo-reference-data.md` (cross-referenced sources)
- **BFO model:** Holland 2017, arXiv:1702.02432, Equations (1)-(6)
- **DSTG noise model:** Davey et al. 2016, empirical sigma = 4.3 Hz, modeling sigma = 7 Hz
- **SU log processing uncertainty:** Holland 2017 Section V; Radiant Physics analysis
