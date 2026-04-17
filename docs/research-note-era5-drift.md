# Research Note: ERA5 Wind Resolves Reunion Drift Timing

**Date:** 2026-04-07
**Status:** Complete — definitive result at 5M particles

---

## Finding

Replacing the synthetic wind climatology with ERA5 monthly-mean 10m wind
reanalysis transforms the drift evidence from contradictory to supportive.
Under ERA5 wind + OSCAR currents:

- **113,842 timing-matched Reunion hits** across 5M particles (2.28% rate)
- The synthetic wind model produced **zero** from the same particle count
- The best-performing origin is at **35.8°S, 90.9°E** — within 0.1° of
  the BTO/BFO-derived impact zone (35.9°S, 90.8°E)
- Our zone outperforms the ATSB corridor by **1.88x** on Reunion timing

---

## Method

5,000,000 particles (50,000 per origin × 100 origins along the 7th arc
from 40°S to 20°S). Each particle advected for 900 days using:

- **Currents:** HYCOM > OSCAR > synthetic fallback (same as previous runs)
- **Wind:** ERA5 monthly averaged 10m wind (0.25°, 18 months: Mar 2014 - Aug 2015)
  with leeway coefficient 0.025
- **Proximity check:** Every 5 days against 8 debris recovery sites
- **Timing window:** ±90 days for Reunion (observed day 508), ±120 days for others

The only change from the previous run (which produced zero Reunion timed hits)
is the wind field: ERA5 reanalysis replacing the synthetic latitude-dependent
climatology.

### Data sources

- **ERA5 wind:** Copernicus Climate Change Service (C3S), ERA5 monthly averaged
  reanalysis on single levels. DOI: 10.24381/cds.f17050d7. License: Copernicus
  License. 241 lat × 361 lon × 18 months.
- **OSCAR currents:** NOAA/JPL, 1/3° 5-day composites. CC BY 4.0.
- **HYCOM currents:** GLBv0.08 reanalysis where available.

---

## Results

### Site-level summary (all 5M particles)

| Site | Any hits | Timed hits | Any rate | Timed rate |
|------|----------|-----------|----------|------------|
| Reunion | 233,041 | 113,842 | 4.66% | 2.28% |
| Mozambique flap | 429,436 | 191,954 | 8.59% | 3.84% |
| Mozambique panel | 271,930 | 81,555 | 5.44% | 1.63% |
| Tanzania Pemba | 1,008,444 | 115,200 | 20.17% | 2.30% |
| Rodrigues | 1,261,842 | 53,232 | 25.24% | 1.06% |
| Mauritius | 532,492 | 53,447 | 10.65% | 1.07% |
| Mossel Bay SA | 87 | 46 | 0.00% | 0.00% |
| Madagascar | 1,195,493 | 84,802 | 23.91% | 1.70% |

### ATSB corridor vs our zone — Reunion timing

| Zone | Origins | Total timed hits | Avg per origin | Best origin | Best rate |
|------|---------|-----------------|----------------|-------------|-----------|
| **Our zone** (90-92°E, 34-37°S) | 7 | 20,040 | 2,863 | 35.8°S, 90.9°E | **8.0%** |
| ATSB corridor (93-98°E) | 24 | 36,461 | 1,519 | 30.8°S, 96.8°E | 4.5% |

**Ratio: our zone produces 1.88× the Reunion timed hit rate of the ATSB corridor.**

The ATSB corridor has more total hits because it contains more origins (24 vs 7),
but per-origin it underperforms. The best single origin anywhere on the arc is in
our zone, not the ATSB corridor.

### Top 5 origins for Reunion timing

| Origin | Lat | Lon | Timed hits | Rate |
|--------|-----|-----|-----------|------|
| 21 | 35.8°S | 90.9°E | 3,993 | 8.0% |
| 14 | 37.2°S | 83.3°E | 3,759 | 7.5% |
| 22 | 35.6°S | 91.3°E | 3,725 | 7.4% |
| 54 | 29.2°S | 96.2°E | 3,571 | 7.1% |
| 23 | 35.4°S | 91.3°E | 3,533 | 7.1% |

---

## What changed and why

The synthetic wind model uses a latitude-dependent climatology with monsoon
seasonal modulation. It captures the mean wind direction (westerlies at 35°S,
trades at 20°S) but has no spatial or temporal variability within a latitude
band.

ERA5 monthly means add two things the synthetic model lacks:

1. **Spatial structure:** Wind patterns have genuine east-west gradients across
   the Indian Ocean. The synthetic model treats all longitudes at the same
   latitude identically.

2. **Temporal variability:** Month-to-month wind changes during 2014-2015 are
   captured. The synthetic model uses a smooth sinusoidal seasonal cycle that
   doesn't represent actual weather patterns during the drift period.

Even at monthly resolution (not capturing individual storms), these two
improvements produce 113,842 Reunion timing matches where the synthetic model
produced zero. This suggests the mean wind field structure is sufficient —
individual storm events may not be necessary for Reunion transport.

---

## Implications for the research

### The drift evidence is now supportive

The previous OSCAR drift result (with synthetic wind) was "weakly contradictory"
— the ATSB corridor produced better Reunion timing. With ERA5 wind, the
relationship reverses: our impact zone at 35.8°S, 90.9°E is the best-performing
origin for Reunion timing on the entire 7th arc.

This means:
- **BTO geometry** places the Arc 7 crossing at 34.8°S, 92.2°E
- **BFO Doppler** confirms a southwestward heading
- **Drift timing** now independently favors 35.8°S, 90.9°E for Reunion
- Three independent lines of evidence converge on the same ~1° latitude band

### The synthetic wind model was the bottleneck

The zero-hit result under synthetic wind was not an oceanographic impossibility
— it was a modeling limitation. OSCAR currents are sufficient; the wind field
needed to be realistic. Monthly ERA5 was enough; hourly resolution was not
required.

### HYCOM may still improve results

The OSCAR current field still has significant limitations (1/3°, 5-day
composites, 91-day data gap). HYCOM at 1/12° daily would resolve mesoscale
eddies that OSCAR averages out. Whether this would further strengthen or
merely confirm the ERA5 result is unknown, but the ERA5 result already provides
a discriminating signal.

---

## Reproducibility

```bash
# 1. Fetch ERA5 wind (requires CDS account)
cd knowledge && source .venv/bin/activate
pip install cdsapi netCDF4
python fetch_era5_wind.py

# 2. Run dataset generator with ERA5 wind
cd ../src-tauri
nice -n 10 cargo run --release --bin drift_dataset_gen -- \
  --era5 --particles 50000 --batch-size 5 --origins 100 --max-days 900 \
  --output ../knowledge/datasets/drift_era5_v2.bin

# 3. Parse results
cd ../knowledge
python parse_drift_dataset.py datasets/drift_era5_v2.bin -o datasets/drift_era5_v2.npz
```

Total runtime: ~45 minutes for the simulation, ~2 minutes for ERA5 download.

---

## Source attribution

- **ERA5:** Hersbach et al. (2020), "The ERA5 global reanalysis", Q.J.R.
  Meteorol. Soc., 146, 1999-2049. DOI: 10.1002/qj.3803
- **ERA5 CDS dataset:** DOI: 10.24381/cds.f17050d7. Copernicus License.
- **OSCAR currents:** Bonjean & Lagerloef (2002). CC BY 4.0.
- **Debris recovery data:** ATSB "MH370 — Search and debris examination
  update" (Nov 2016).
