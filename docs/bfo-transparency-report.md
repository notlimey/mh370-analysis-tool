# BFO Transparency Implementation Report

**Date:** 2026-04-07

---

## Verification Results

### Rust tests
- **36 passed, 0 failed, 2 ignored** (ignored: network-dependent OSCAR tests)
- No regressions from BFO stepthrough additions

### Frontend build
- `pnpm build` succeeds cleanly (tsc + vite)
- BfoPanel component compiles with no type errors

### Backend stepthrough endpoint
- `get_bfo_stepthroughs` Tauri command registered and compiles
- `compute_bfo_stepthroughs` runs the path solver with n=10, extracts the best
  path, and computes per-arc component breakdowns
- Returns `Vec<BfoStepthrough>` with all 7 fields per arc

---

## What Was Implemented

### Task 1 — BFO Stepthrough Data (Backend)

**File:** `src-tauri/src/mh370/bfo.rs`

- Added `BfoStepthrough` struct with full component breakdown:
  `uplink_doppler_hz`, `aes_compensation_hz`, `downlink_doppler_hz`,
  `afc_correction_hz`, `bias_hz`, `predicted_bfo_hz`, `residual_hz`
- Added `is_in_sample` boolean and `validation_note` per arc
- Added `BfoModel::stepthrough()` method that exposes individual Doppler
  components (previously computed internally but not returned)
- Added `validation_note_for_arc()` with honest per-arc notes:
  - Arc 0: Pre-flight data quality
  - Arc 1: SDU reboot OCXO settling
  - Arcs 2-5: In-sample solver fit
  - Arc 6: C-channel, in-sample
  - Arc 7: Descent not modeled, large residual expected

**File:** `src-tauri/src/mh370/paths.rs`

- Added `compute_bfo_stepthroughs()` public function
- Runs path solver (n=10), takes best path, generates stepthroughs for each arc

**File:** `src-tauri/src/lib.rs`

- Added `get_bfo_stepthroughs` Tauri command
- Registered in invoke handler

### Task 2 — BFO Stepthrough UI Panel

**File:** `src/components/panels/BfoPanel.tsx`

- Prominent callout box at top with the transparency statement
- "Load BFO Stepthrough" button (Tauri-only, deferred loading)
- Full component table: Arc, Time, Measured, Uplink, AES Comp, Downlink, AFC,
  Bias, Predicted, Residual
- Color-coded residuals: green (<4.3 Hz), yellow (4.3-10 Hz), red (>10 Hz)
- Per-arc validation notes with in-sample/not-scored badges
- Equation chain reference section
- Level-flight RMS summary line

**File:** `src/stores/ui.ts` — Added "bfo" to PanelId union type
**File:** `src/components/layout/IconRail.tsx` — Added BFO Model button
**File:** `src/components/layout/FlyoutShell.tsx` — Added BfoPanel route
**File:** `src/style.css` — Added `.bfo-table` styles

### Task 3 — Documentation

**File:** `docs/research-note-bfo-model-transparency.md`

Five sections as specified:
1. Model equations with Holland equation numbers
2. Component breakdown with sources
3. Validation status — honest account of in-sample fit vs independent validation
4. Known limitations (spherical Earth, Arc 7 descent, AFC adoption, fixed bias)
5. What would constitute proper validation (three tiers)

### Task 4 — infoContent.ts

**File:** `src/lib/infoContent.ts`

Added `section:bfo` entry with three sections:
- What the residuals mean (in-sample fit, not independent test)
- Why independent validation isn't possible (no public known-position + BFO data)
- What this means for results (model is sound, implementation unverified against MH370)

### Task 5 — This Report

All verification checks pass. The implementation is complete.

---

## Design Decisions

1. **Deferred loading:** The stepthrough panel loads data on-click, not on panel
   open. This avoids running the path solver (which takes several seconds) just
   to display the BFO panel.

2. **n=10 for stepthrough:** The stepthrough only needs the best path. Running
   n=10 is sufficient to identify it without the full n=120 computation.

3. **Validation notes are hardcoded per arc, not computed:** The notes describe
   the fundamental nature of each arc's validation status, which doesn't change
   with model parameters. This is deliberate — computed notes would obscure the
   fixed epistemic limitation.

4. **The callout box is the first thing visible:** Before any data loads, the
   transparency statement is already on screen. A researcher opening this panel
   sees the limitation disclosure before seeing any numbers.
