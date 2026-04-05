# Fuel Model — Validation Against Boeing 777-200ER Data

## Date: 2026-04-06
## Status: Implemented and validated

---

## The Problem

The original fuel model used a flat burn rate of 6,500 kg/hr (the instantaneous rate at initial aircraft weight ~207,000 kg). This overestimated total fuel consumption by ~14%, resulting in **0 out of 256 paths being fuel-feasible**.

---

## Boeing 777-200ER Reference Data

### Fuel flow at different weights (FL350, M0.84)

| Weight (kg) | Fuel Flow (kg/hr) | Source |
|-------------|-------------------|--------|
| ~216,370 (heavy) | 6,790 | Boeing ref via aircraftinvestigation.info |
| ~207,000 (Arc 1) | 6,500 | Boeing ref (our baseline) |
| ~191,000 (mid-flight) | ~6,000 | Weight-interpolated |
| ~174,000 (Arc 7) | ~5,000 | Weight-interpolated |
| Flight average | **5,702** | ATSB: 33,500 kg / 5.875 hrs |

### MH370 fuel state

| Waypoint | Fuel (kg) | Source |
|----------|-----------|--------|
| Departure (KUL) | 49,100 | Load sheet, Malaysian Safety Investigation Report |
| Last ACARS (17:07) | 43,800 | FQIS (left 24,900 + right 24,800) |
| Arc 1 (18:25) — Boeing | 33,500 | Boeing segment analysis, Appendix 1.6E |
| Arc 1 (18:25) — Independent | 34,500 | DrB/Godfrey estimate (34,490-34,571) |
| Fuel exhaustion (~00:17:30) | 0 | ATSB |

### Timing

- Right engine fuel exhaustion: ~00:17:30 UTC
- Left engine: ~9.5 minutes later (~00:27:00)
- APU autostart: ~00:18:30
- Last satellite logon: 00:19:29 (Arc 7)
- Total flight from Arc 1: ~5 hours 52 minutes

---

## The Fix: Weight-Corrected Burn Rate

### Physics

As the aircraft burns fuel, it gets lighter, and fuel flow decreases. The model now integrates burn over 20 steps with a linear weight correction:

```
weight_correction = 1.0 - SENSITIVITY × (REF_WEIGHT - current_weight) / REF_FLOW
step_burn_rate = nominal_rate × speed_factor × altitude_factor × weight_correction
```

### Calibrated coefficient

- `WEIGHT_SENSITIVITY`: 0.050 kg/hr per kg
- `REF_WEIGHT`: 207,000 kg
- `REF_FLOW`: 6,500 kg/hr
- Calibrated to reproduce ATSB flight average of 5,702 kg/hr

### Default config changes

- `fuel_remaining_at_arc1_kg`: 33,500 → **34,500** (independent analyst estimate)
- `fuel_baseline_kg_per_hr`: 6,500 (unchanged — this is the initial-weight rate)

### Result

- **Before**: 0/256 paths fuel-feasible
- **After**: 27-181/256 paths fuel-feasible (depending on BFO model version)
- ATSB cross-validation test passes: flight average within 500 kg/hr of 5,702

---

## Speed-Fuel Relationship

The power-law exponent of 1.35 is used: `burn_rate ∝ (speed / baseline)^1.35`

At cruise speeds, drag = parasitic (~V²) + induced (~1/V²). In the 350-520 kts range, the net exponent is approximately 1.5-2.0. The 1.35 value is on the low side but defensible for the narrow speed band.

### Max feasible range at different speeds (34,500 kg fuel)

| Speed (kts) | Max Range (km) | Flight Time (hrs) |
|-------------|----------------|-------------------|
| 420 | 5,390 | 6.9 |
| 460 | 5,221 | 6.1 |
| 471 (LRC) | 5,178 | 5.9 |
| 490 | 5,107 | 5.6 |
| 500 | 5,071 | 5.5 |

---

## References

1. Boeing Performance Analysis, Appendix 1.6E — https://www.mh370report.com/pdf/Boeing%20Performance%20Analysis%20Appendix-1.6E.pdf
2. Malaysian Safety Investigation Report — https://reports.aviation-safety.net/2014/20140308-0_B772_9M-MRO.pdf
3. DrB / Radiant Physics — https://mh370.radiantphysics.com/2019/06/30/a-comprehensive-survey-of-possible-mh370-paths/
4. Aircraft Commerce Issue 60, "777 Fuel Burn Performance"
5. aircraftinvestigation.info — https://www.aircraftinvestigation.info/airplanes/777-200ER.html
