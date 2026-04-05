# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MH370 flight path analysis and probability mapping tool. Tauri 2 desktop app with a Rust backend for satellite/BTO computations and a TypeScript + Mapbox GL frontend for visualization. Also builds as a read-only web snapshot (no Rust backend).

## Commands

```bash
# Install frontend deps
pnpm install

# Run Tauri desktop app (frontend + Rust backend)
pnpm tauri dev

# Frontend dev server only (no Rust backend)
pnpm dev

# Build frontend (also runs tsc for type checking)
pnpm build

# Build web-only snapshot (static, no Tauri)
BUILD_TARGET=web pnpm build:web

# Rust check/test
cd src-tauri && cargo check
cd src-tauri && cargo test
cd src-tauri && cargo test -- --nocapture          # with stdout
cd src-tauri && cargo test mh370::paths::tests::classifies_slow_arc67_family  # single test

# Rust format
cd src-tauri && cargo fmt
cd src-tauri && cargo fmt --check
```

**Validation flow:** backend changes: `cd src-tauri && cargo check && cargo test`. Frontend changes: `pnpm build`. Cross-stack: both.

No frontend test runner or JS linter configured. TypeScript correctness is enforced by `tsc` via `pnpm build`. Use `pnpm`, not `npm`.

## Architecture

**Dual-mode frontend:** `src/lib/backend.ts` detects Tauri (`IS_TAURI`) at runtime. In Tauri mode, it calls Rust commands via `invoke()`. In browser mode, it loads pre-exported JSON/GeoJSON snapshots from `public/data/`.

**Backend pipeline (Rust, `src-tauri/src/mh370/`):**
- `data.rs` — Inmarsat handshake records, `AnalysisConfig`, dataset loading
- `satellite.rs` — I3F1 ephemeris interpolation (cubic Hermite spline on embedded JSON), sinusoidal fallback outside range
- `arcs.rs` — BTO calibration from known-position pings, BTO-to-slant-range-to-surface-distance, arc ring generation
- `bfo.rs` — BFO scoring (soft weight, not yet integrated for path scoring)
- `paths.rs` — Candidate path sampling through arc crossings, fuel model, path family classification (slow/perpendicular/mixed/other)
- `probability.rs` — Bayesian heatmap along 7th arc
- `drift.rs` — Debris reverse drift model
- `debris_inversion.rs` — Joint debris origin inversion with drift validation
- `export.rs` — GeoJSON export for paths and probability

**Frontend layers (`src/layers/`):** Each layer module adds Mapbox sources/layers with prefixed IDs (e.g., `arcs-`, `debris-`, `heatmap-`). New layer groups must be added to `LAYER_PREFIXES` in `src/main.ts` and `layerVisibility` in `src/map.ts`.

**State:** `src/model/config.ts` holds the client-side `AnalysisConfig` that gets passed to Rust commands. `src-tauri/src/lib.rs` holds `AppState` with the `SatelliteModel` (loaded once at startup) and atomic state for heatmap peak/drift validation.

**Key design principle:** Every assumption the official ATSB searches hardcoded is a configurable parameter here via `AnalysisConfig`. If a new modeling assumption could shift the answer by ~100 NM or more, it belongs in config.

## Conventions

- `strict: true` TypeScript with `noUnusedLocals`/`noUnusedParameters`
- Rust uses `Result<_, String>` for Tauri-facing functions; `serde` for serialization
- Mapbox layer/source IDs prefixed by feature group
- UI is vanilla DOM + event listeners, not React
- Keep frontend/backend data contracts aligned — update both sides together for cross-stack changes
- Avoid hard-coding geospatial assumptions; prefer config fields
- `import type` for type-only imports; `interface` for object shapes
