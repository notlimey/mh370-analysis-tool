# Drift Dataset Generator — Setup Report

**Date:** 2026-04-07

---

## What was built

### `src-tauri/src/bin/drift_dataset_gen.rs`

CLI binary that generates a large-scale drift simulation dataset. Features:

- **Arguments:** `--particles`, `--batch-size`, `--origins`, `--max-days`, `--output`
- **Origin grid:** Subsamples the 7th arc via `sample_7th_arc()` to N evenly-spaced origins
- **Snapshots:** Records particle positions at 7 timescales (180, 360, 508, 660, 726, 838, 900 days) covering all major debris find dates
- **Checkpoint/resume:** Saves completed origin indices as JSON after each batch. On restart, skips completed origins. Checkpoint deleted on full completion.
- **Binary output format:** Compact little-endian format (header + per-origin blocks of f32 lat/lon pairs). ~4 bytes per coordinate.
- **Terminal status:** Batch progress, ETA, origin count, file size

### `knowledge/parse_drift_dataset.py`

Python parser that reads the binary format and exports to numpy `.npz`:
- Reads header (magic, dimensions, snapshot days)
- Reads origin blocks (tolerant of partial files from interrupted runs)
- Exports: `origin_lats`, `origin_lons`, `positions` (shape: origins × snapshots × particles × 2), `snapshot_days`

### `knowledge/datasets/.gitignore`

Ignores `*.bin`, `*.checkpoint`, `*.npz` — keeps the directory in git but not the data.

---

## Smoke Test Results

### Test 1: Full run (100 particles, 10 origins, batch-size 2)

```
Origins:    10
Particles:  100
Max days:   900
Batch size: 2

Batch 1/5: 21.5s (includes HYCOM/OSCAR data loading)
Batch 2-5: 0.1s each (data cached in memory)
Total: 21.8s
Output: 0.1 MB
```

**PASS** — completed successfully, checkpoint cleaned up.

### Test 2: Resume after interruption

1. Ran 6 origins to completion (full file: 33,682 bytes)
2. Deleted output file, created fake checkpoint claiming origins 0-1 complete
3. Re-ran: correctly skipped batch 1, processed only batches 2-3
4. Printed "Resuming from checkpoint: 2/6 origins complete"

**PASS** — checkpoint logic works correctly.

### Test 3: Existing tests

All 36 Rust tests pass, 0 failures, 2 ignored (network-dependent).

---

## Performance Estimate for Full Run

From the smoke test: ~16s for data loading + ~0.05s per origin at 100 particles.

At 50,000 particles per origin, particle simulation dominates. Rough scaling:
- 50,000 particles × 900 days × 4 substeps/day = 180M particle-steps per origin
- 100 particles × 900 days × 4 substeps = 360K particle-steps → 0.05s
- Scale factor: ~500x → ~25s per origin at 50k particles
- 100 origins × 25s = ~42 minutes total

File size: 100 origins × 7 snapshots × 50,000 particles × 8 bytes = ~280 MB

---

## Command for Full Simulation

```bash
cd src-tauri && cargo run --release --bin drift_dataset_gen -- \
  --particles 50000 \
  --batch-size 5 \
  --origins 100 \
  --max-days 900 \
  --output /Users/entropy/Documents/repos/personal/mh370/knowledge/datasets/drift_dataset.bin
```

Estimated time: ~42 minutes. Estimated file size: ~280 MB.

If interrupted (Ctrl-C), re-run the same command to resume from the last completed batch.

After completion, parse to numpy:

```bash
cd knowledge && python parse_drift_dataset.py datasets/drift_dataset.bin
```
