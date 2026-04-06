# DSTG Validation Reference

This document records the DSTG model assumptions and results for validation of our tool.

## Source

Davey, S., Gordon, N., Holland, I., Rutten, M., Williams, J.
"Bayesian Methods in the Search for MH370"
SpringerOpen, 2016. ISBN 978-981-10-0379-0.
Open access: https://link.springer.com/book/10.1007/978-981-10-0379-0

## DSTG Model Assumptions

### Speed
- Mach number prior: **uniform [0.73, 0.84]**
- At FL350, Mach 0.73 ≈ 430 kts TAS, Mach 0.84 ≈ 495 kts TAS
- Posterior strongly prefers higher end of range (Fig 10.6)
- Ground speed depends on wind; model uses GFS wind data interpolated in time/lat/lon/altitude

### Altitude
- Uniform prior: **25,000 to 43,000 ft**
- Modeled as OU (Ornstein-Uhlenbeck) process with changes at maneuver points

### Maneuvers
- OU process for speed, heading, and altitude
- Mach OU: β=1.058×10⁻², q=1.09×10⁻³
- Mean maneuver time τ: Jeffreys prior (0.1 to 10 hours)
- Posterior: 97% have τ > 1 hour, 83% have τ > 2 hours
- Most paths make ≤1 turn after 18:28
- Turn angle: uniform ±180° (at maneuver points only)

### Autopilot Modes
Five prescribed modes, aircraft does not change between them (except one
possible switch from lateral navigation to constant heading):
1. Constant magnetic heading
2. Constant true heading
3. Constant magnetic track
4. Constant true track
5. Lateral navigation (waypoint following)

### BTO Model
- R1200 messages: σ = **29 μs**
- Anomalous R1200 (18:25:34, 00:19:37): σ = **43 μs**
- R600 messages (00:19:29): σ = **63 μs**
- BTO bias: constant per flight, calibrated from pre-departure

### BFO Model (Chapter 5, Equations 5.5-5.9)
- **BFO noise σ = 7 Hz** (inflated from empirical 4.3 Hz to account for bias drift)
- Empirical BFO error from 20 prior flights: mean = 0.18 Hz, σ = 4.3 Hz
- BFO error bounds: [-28, +18] Hz (from 2,501 observed valid in-flight values)
- **Bias modeled as unknown constant** with prior mean from tarmac, σ = 25 Hz
- Bias estimated via Rao-Blackwellised particle filter (not fixed)
- Uses actual SDU Doppler compensation software for validation flights

### BFO Measurements Used
From DSTG Table 10.1:

| Time (UTC) | Type | BTO used | BFO used |
|---|---|---|---|
| 18:25:34 | Anomalous R1200 | Yes (σ=43μs) | No* |
| 18:28:05, 18:28:14 | R1200 | Yes (σ=29μs) | Yes |
| 18:39:55 | C-channel | No | Yes |
| 19:41:02 - 22:41:21 | R1200 | Yes (σ=29μs) | Yes |
| 23:15:02 | C-channel | No | Yes |
| 00:10:59 | R1200 | Yes (σ=29μs) | Yes |
| 00:19:29 | R600 | Yes (σ=63μs) | No* |
| 00:19:37 | Anomalous R1200 | Yes (σ=43μs) | No* |

\*"Available but cannot be used" — SDU oscillator transient (18:25) or descent signature (00:19).

### Key Finding on BFO's Role (Section 10.1)
> "The main effect of including BFO data is to resolve the ambiguity about the
> manoeuvre after 18:28. The BFO data does not significantly change the shape
> of the Southern mode of the pdf."

The **C-channel BFO at 18:39** is the critical measurement — it proves the aircraft
turned south. The hourly handshake BFOs (19:41-00:11) provide incremental
constraint on heading/speed but do not dramatically reshape the probability
distribution along the 7th arc.

### Fuel Model
- Assumption: **infinite fuel** during path generation
- Fuel constraints applied as post-filter censoring of impossible trajectories
- "Analysis of candidate trajectories has indicated that the majority are feasible"
- Viable Mach range (0.73-0.84) was informed by fuel consumption limits

### End-of-Flight / Descent Kernel
- 15 nm uniform disc + Gaussian falloff (σ=30 nm) beyond
- Applied as convolution with particle positions at 00:19
- Based on flight simulator studies of uncontrolled descents (ATSB)
- "High likelihood of reaching zero altitude within 15 nm of beginning of descent"

## DSTG Results

### Probability Peak
- The PDF in Figure 10.10 shows the predicted surface location
- Indicative search area (November 2015): approximately 100,000 km²
- 99%, 95%, and 90% confidence regions shown in Figure 10.10
- The PDF is concentrated along the 7th arc between roughly 32°S and 39°S
- The exact peak latitude is not given as a single number (it's a distribution)

### Residual Measurement Errors (Section 10.3)
- BTO residuals: within ±1σ for most arcs, larger at 00:19:29 and 00:19:37
  (these two are inconsistent with each other — opposite sign residuals)
- BFO residuals: "statistically consistent with the empirical error model" (±7 Hz)
- Figure 10.7 shows marginal distributions of residual errors

### Posterior Speed
- Posterior strongly prefers Mach 0.82-0.84 (upper end of prior)
- Consistent with "most likely speeds for the aircraft over long durations"

### Posterior Heading
- Single turn between 18:28 and 18:39 (confirmed by BFO)
- After turn: approximately 185-200° true heading (roughly south-southwest)
- Very few genuine turns after the initial turn

## Validation Against Our Model

### What to compare

1. **BFO residuals at arcs 2-6b**: Should be within ±7 Hz for a good path.
   Our current performance: ~4 Hz RMS. **PASS**

2. **Speed range**: DSTG uses Mach 0.73-0.84 (≈430-495 kts TAS at FL350).
   Our default: 350-520 kts. Wider than DSTG — deliberate choice to not
   pre-constrain. The solver should naturally prefer the DSTG range.

3. **Probability peak latitude**: DSTG concentrates between ~32°S and ~39°S.
   Our current peak: ~37.8°S. **Within DSTG range.**

4. **BFO bias**: DSTG estimates via particle filter with prior σ=25 Hz.
   We use fixed ATSB constant (150 Hz). Simpler but produces good residuals.

5. **Arc 7 BFO**: DSTG does NOT use it. We use it as a descent constraint
   (envelope filter). This is a deliberate enhancement beyond the DSTG approach.

### Differences from DSTG (deliberate)

| Aspect | DSTG | Our Tool | Rationale |
|--------|------|----------|-----------|
| BFO bias | Particle filter estimated | Fixed 150 Hz | Simpler, good enough for ~4 Hz residuals |
| Arc 7 BFO | Excluded | Descent envelope constraint | Extracts useful info without fitting noise |
| Fuel | Infinite, post-censored | Integrated fuel model | More physically constrained |
| Speed | Mach 0.73-0.84 | 350-520 kts | Wider prior, let data constrain |
| Autopilot modes | 5 specific modes | Free heading/speed at each arc | More general, less physically specific |
| Descent kernel | 15nm + Gaussian | Post-arc-7 continuation model | Similar intent, different implementation |
