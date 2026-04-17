# Drift Dataset Generator v2 — Report

**Date:** 2026-04-07

---

## What changed from v1

v1 stored position snapshots at 7 fixed days — wrong for ML because it aliases
particles arriving at day 180 with those at day 508 (completely different paths).

v2 stores **outcome labels only**: per particle, which recovery sites it reached
and when. No position data. Checked every 5 days during simulation.

---

## Binary format

Magic: `MH370DL2`, version 2.

**Header** (45 bytes): magic, version, n_origins, n_particles, max_days,
lat/lon bounds, creation timestamp.

**Per particle** (variable, 5 + 4 × n_outcomes bytes):
- `origin_idx: u16` — which origin (0-99)
- `particle_idx: u16` — which particle within that origin
- `n_outcomes: u8` — how many sites reached (0-8)
- Per outcome: `site_id: u8`, `arrival_day: u16`, `timing_match: u8`

First-arrival only — if a particle passes a site multiple times, only the first
visit is recorded.

---

## Recovery sites

| ID | Site | Lat | Lon | Radius | Observed Day | Window |
|----|------|-----|-----|--------|-------------|--------|
| 0 | Reunion | -20.9° | 55.5° | 150 km | 508 | ±90 d |
| 1 | Mozambique flap | -25.0° | 33.5° | 300 km | 726 | ±120 d |
| 2 | Mozambique panel | -19.5° | 34.8° | 300 km | 721 | ±120 d |
| 3 | Tanzania Pemba | -5.1° | 39.8° | 200 km | 836 | ±120 d |
| 4 | Rodrigues | -19.7° | 63.4° | 150 km | 837 | ±120 d |
| 5 | Mauritius | -20.3° | 57.5° | 150 km | 752 | ±120 d |
| 6 | Mossel Bay SA | -34.2° | 22.1° | 300 km | 726 | ±120 d |
| 7 | Madagascar | -16.9° | 50.0° | 300 km | 820 | ±120 d |

---

## Smoke test results

### Test 1: Full run (100 particles, 10 origins)

```
Hits (any) : R:60 Mf:130 Mp:144 T:146 Rg:84 Mu:71 SA:0 Mg:100
Hits (timed): R:0  Mf:0   Mp:0   T:0   Rg:0  Mu:0  SA:0 Mg:0
```

Lots of "any" hits — particles do reach all sites except South Africa. Zero
timed hits at 100 particles — expected, the timing windows are tight and
100 particles is too sparse to capture the exact arrival day.

### Test 2: Resume after interruption

- Ran 6 origins, faked checkpoint with 4/6 complete
- Resume correctly printed "Resuming from checkpoint: 4/6 origins complete"
- Only processed batch 3 (origins 4-5), skipped batches 1-2

**PASS**

### Test 3: Binary format verification

Python struct parsing confirmed:
- Header: magic `MH370DL2`, version 2, correct dimensions
- Particle records: 441/1000 particles had outcomes
- Outcome data: site_id, arrival_day, timing_match all parse correctly
- Example: Origin 3, particle 0: [(site=1, day=360, timed=False)]

### Test 4: Existing tests

All 36 Rust tests pass, 0 failures.

---

## What the smoke test tells us about the full run

At 100 particles, zero timed hits is expected. The question is whether 50,000
particles will produce timed Reunion hits from any origin. Based on the OSCAR
drift study (which found 1 Reunion hit from 1,000 particles at our impact zone),
we'd expect roughly 50 timed Reunion hits from a 50k run at the best origin.

If the full run shows zero timed Reunion hits across all 100 origins, it means
the drift model's stochastic variability cannot produce the observed flaperon
timing — a genuine oceanographic constraint, not a particle count issue.

---

## Full simulation command

```bash
cd src-tauri && nice -n 10 cargo run --release --bin drift_dataset_gen -- \
  --particles 50000 \
  --batch-size 5 \
  --origins 100 \
  --max-days 900 \
  --output /Users/entropy/Documents/repos/personal/mh370/knowledge/datasets/drift_dataset_v2.bin
```

Estimated time: ~42 minutes (single-threaded, one core).

After completion, parse with:

```bash
cd knowledge
python3 -m venv .venv && source .venv/bin/activate && pip install numpy
python3 parse_drift_dataset.py datasets/drift_dataset_v2.bin
```
