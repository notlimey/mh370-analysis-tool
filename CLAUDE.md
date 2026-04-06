# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MH370 flight path analysis and probability mapping tool. Tauri 2 desktop app with a Rust backend for satellite/BTO computations and a SolidJS + Mapbox GL frontend for visualization. Also builds as a read-only web snapshot (no Rust backend).

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

# Lint and format (Biome)
pnpm check                    # check for issues
pnpm format                   # auto-fix issues
pnpm lint                     # lint only

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

TypeScript correctness is enforced by `tsc` via `pnpm build`. Biome handles linting and formatting. Use `pnpm`, not `npm`.

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

**Frontend (SolidJS, `src/`):**
- `index.tsx` → `App.tsx` — Entry point, root component with layout grid and context providers
- `stores/` — Reactive state via `createStore`/`createSignal` (analysis-config, layer-visibility, model-run, scenario, evidence, inversion, ui)
- `contexts/map-context.tsx` — Mapbox Map instance shared via SolidJS context
- `components/layout/` — IconRail, FlyoutShell, Loader, BrowserBanner, Timeline
- `components/panels/` — ModelPanel, DriftPanel, LayersPanel, EvidenceBrowsePanel, ExportPanel, SensitivityPanel
- `components/evidence/EvidencePanel.tsx` — Right-side anomaly/info detail panel
- `components/modals/ModelConfigModal.tsx` — Config editing modal
- `components/map/MapContainer.tsx` — Mapbox init, layer loading pipeline, exports `loadAllLayers`/`removeAllLayers`

**Layers (`src/layers/`):** Each layer module adds Mapbox sources/layers with prefixed IDs (e.g., `arcs-`, `debris-`, `heatmap-`). New layer groups must be added to `LAYER_PREFIXES` in `MapContainer.tsx` and `DEFAULT_LAYER_VISIBILITY` in `stores/layer-visibility.ts`.

**State:** Reactive stores in `src/stores/` replace the old module-level variables. `src/model/config.ts` defines the `AnalysisConfig` type. `src-tauri/src/lib.rs` holds `AppState` with the `SatelliteModel` (loaded once at startup) and atomic state for heatmap peak/drift validation.

**Key design principle:** Every assumption the official ATSB searches hardcoded is a configurable parameter here via `AnalysisConfig`. If a new modeling assumption could shift the answer by ~100 NM or more, it belongs in config.

## Conventions

- SolidJS with `jsx: "preserve"` and `jsxImportSource: "solid-js"`
- `strict: true` TypeScript with `noUnusedLocals`/`noUnusedParameters`
- Biome for linting and formatting (line width 120, double quotes, semicolons)
- Component files: `PascalCase.tsx`; everything else: `kebab-case.ts`
- Stores: `createStore` for complex state, `createSignal` for simple flags
- Never destructure store values at component top level (breaks SolidJS reactivity)
- Rust uses `Result<_, String>` for Tauri-facing functions; `serde` for serialization
- Mapbox layer/source IDs prefixed by feature group
- Keep frontend/backend data contracts aligned — update both sides together for cross-stack changes
- Avoid hard-coding geospatial assumptions; prefer config fields
- `import type` for type-only imports; `interface` for object shapes
- Layer modules stay imperative (Mapbox GL is imperative); they receive the map instance as an argument

## Research Integrity

This is a research tool — traceability matters. Every externally-sourced constant, dataset, or formula must be attributable.

- **Attribution required:** Every externally-sourced constant, dataset, or formula must have a comment citing the source (paper, report, or document name + section/table). Example: `// ATSB "Definition of Underwater Search Areas" §3.2, Table 4`
- **Data files:** Include a top-level `source` or `attribution` field in JSON data files, or a comment header in other formats, identifying where the data came from.
- **Reference docs:** When verified data is gathered from external sources, record it in `docs/` with full attribution (document title, author/org, date, specific section/table). See `docs/bfo-reference-data.md` as the template.
- **When in doubt, ask:** If a constant or value cannot be traced to a specific source, flag it rather than guessing. A `// TODO: source needed` is better than an unattributed magic number.
- **Units — metric:** Use meters, kilometers, kilograms, and seconds throughout. Nautical miles and feet may appear in aviation-domain inputs/outputs but must be converted to metric at the boundary. Annotate unit in variable names or comments where ambiguity is possible (e.g., `altitude_m`, `range_km`).
- **Validation against known data:** New physics or math code must include tests that validate against known reference points (e.g., KLIA ground pings where aircraft position is known, published BTO/BFO values from official reports). A formula without a validation test is incomplete.
- **Sensitivity awareness:** When changing a formula, constant, or model behavior, consider whether the change could shift results by ~100 NM or more. If so, it should be a configurable parameter in `AnalysisConfig`, not a hardcoded value.
- **CLI-runnable analysis:** All analysis, computation, and data validation must be runnable via `cargo run` / `cargo test` without requiring the Tauri app or frontend. This allows quick iteration, testing, and verification from the command line. When adding new analysis capabilities, ensure they are accessible as Rust library functions or binary entry points, not only as Tauri commands.

## Key Reference Documents

- **ATSB** — "Definition of Underwater Search Areas" (Jun 2014), "MH370 — Search and debris examination update" (Nov 2016)
- **DSTG** — "Bayesian Methods in the Search for MH370" (Dec 2015) — the primary statistical framework
- **Inmarsat** — "MH370 Signalling Unit Log Interpretation" — BTO/BFO definitions, satellite handshake protocol
- **SSWG** — Holland "Debris Drift Analysis" reports — reverse drift modelling methodology

## Reference Data

- `docs/bfo-reference-data.md` — Verified BFO values, sources, attribution, and the bug that was found (wrong BFO values in dataset). Consult this before modifying BFO-related code.
- `docs/dstg-validation.md` — DSTG model assumptions (speed, altitude, BFO/BTO sigmas, maneuver model) and comparison with our tool. Use this to verify our model reproduces known results.
- `docs/research-note-arc7-impact-zone.md` — Preliminary finding: impact zone at ~35.9°S, 90.8°E, west of all searched areas. Includes uncertainty envelope, open tensions (barnacles, HYCOM), and next steps.
- `docs/roadmap.md` — Project roadmap: completed work, in-progress items, future constraints, and current model output.
