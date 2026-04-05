# Roadmap

This roadmap is for turning the current MH370 app from a capable demo into a better research tool.

It is deliberately biased toward:

- inspectability over polish
- explicit uncertainty over false precision
- reproducible runs over ad hoc tweaking
- shared config between Rust and UI

## Current State

The app now has:

- candidate path generation and family classification
- probability heatmap generation
- BFO diagnostics for the best path
- searched-area overlays
- endpoint polygons and post-Arc-7 continuation overlays
- debris inversion and drift-related layers
- a terminal `model_probe` for backend iteration without Tauri

31 fields in `AnalysisConfig` are mirrored across Rust (`data.rs`) and TypeScript (`config.ts`). Only 10 of those 31 fields are exposed in the sidebar UI. The remaining 21 can only be changed programmatically.

Additionally, several hardcoded constants affect model output but are not in `AnalysisConfig` at all:

- **BFO scoring:** `BFO_SIGMA_HZ` (7.0), `BFO_SCORE_WEIGHT` (1.0) in `paths.rs`/`bfo.rs`
- **Drift transport:** `CURRENT_SPEED_KM_PER_DAY` (17.0), noise parameters, particle counts in `drift.rs`/`drift_transport.rs`
- **Inversion anchors:** `REFERENCE_CRASH_LAT/LON`, `ANALYSIS_START_JDN` in `debris_inversion.rs`

The next bottleneck is no longer just modeling. It is the overall research workflow: setup, run, read, compare, and preserve conclusions.

## Priority Order

1. Externalize and document all analysis parameters in Rust-owned config files.
2. Redesign the app flow into a clearer research workflow.
3. Make model outputs easier to interpret and compare.
4. Improve scenario/run reproducibility and exportability.
5. Expand evidence and inversion modules only after the workflow is more inspectable.

---

## Track 1: Externalized Analysis Config

This is the highest-priority engineering task.

### Goal

Move all analysis parameters into an editable TOML file owned by Rust, with:

- one place to inspect every calculation input
- explicit defaults and active values
- comments describing what each property affects
- frontend controls reading from the same source of truth
- saved runs/exported outputs carrying the config used

### Why this matters

Right now the same conceptual config exists in multiple places:

- Rust `AnalysisConfig` with `Default` impl (31 fields)
- frontend `defaultAnalysisConfig` in `config.ts` (31 fields, duplicated defaults)
- UI controls exposing only 10 of 31 fields

That duplication already caused one real regression: backend defaults were fixed while the frontend kept sending stale values.

### Acceptance Criteria

- A user can inspect every analysis parameter without reading Rust source.
- A user can edit a TOML file and see the result after rerunning the model.
- `Reset` means "reset to resolved config baseline", not "reset to stale frontend constants".
- Rust and frontend no longer maintain separate default values.
- Exported results can be traced back to the exact config used.

### File Layout

```text
config/
  analysis.default.toml    # shipped with app, checked into git
  analysis.local.toml      # user overrides, gitignored
```

### Design Decisions

**TOML comments are for humans, not for the UI.** TOML comments are not programmatically accessible. Field descriptions and metadata for the config inspector UI must come from a Rust-side schema struct, not from parsing TOML comments.

**Keep the resolved config response simple.** V1 returns `value` + `source` per field. Descriptions and usage references come from a static `ConfigFieldMeta` map in Rust. Don't ship code-usage references in the response — they belong in the TOML file comments and in docs.

**Drop `satellite_ephemeris_path` for now.** Ephemeris is currently embedded JSON loaded by `SatelliteModel` at startup. There is no code path that reads an external ephemeris file. Add this config key when external ephemeris support is actually built.

**Promote BFO scoring weights to config.** `BFO_SIGMA_HZ` and `BFO_SCORE_WEIGHT` are currently hardcoded constants that meaningfully affect path scoring. Add them to `AnalysisConfig` and the TOML file.

### TOML Shape (V1)

Comments in the TOML are for humans editing the file directly. The `# effect:` lines describe what happens when you change the value. Sections match the conceptual groupings in `AnalysisConfig`.

```toml
# ── Data sources ──────────────────────────────────────

dataset_path = ""
# effect: path to dataset JSON; empty = use embedded dataset


# ── Arc construction & path sampling ──────────────────

ring_points = 720
# effect: points generated around each BTO ring before path sampling

ring_sample_step = 1
# effect: subsampling stride on ring points during candidate-path generation

beam_width = 256
# effect: number of best partial paths kept after each handshake step

min_speed_kts = 350.0
# effect: minimum allowed inter-arc groundspeed (kts)

max_speed_kts = 520.0
# effect: maximum allowed inter-arc groundspeed (kts)

speed_consistency_sigma_kts = 35.0
# effect: Gaussian sigma for speed-change penalty between consecutive legs

heading_change_sigma_deg = 80.0
# effect: Gaussian sigma for heading-change penalty between consecutive legs


# ── BFO scoring ───────────────────────────────────────

bfo_sigma_hz = 7.0
# effect: Gaussian sigma for BFO residual soft weighting

bfo_score_weight = 1.0
# effect: linear scale weight of BFO term in path score


# ── Aircraft state ────────────────────────────────────

cruise_altitude_ft = 35000.0
# effect: assumed cruise altitude; mostly documentary for now

calibration_altitude_ft = 0.0
# effect: altitude assumed during BTO calibration


# ── Satellite state ───────────────────────────────────

satellite_nominal_lon_deg = 64.5
# effect: nominal sub-satellite longitude

satellite_nominal_lat_deg = 0.0
# effect: nominal sub-satellite latitude baseline

satellite_drift_start_lat_offset_deg = 0.0
# effect: start offset for satellite latitude drift model

satellite_drift_amplitude_deg = 1.6
# effect: amplitude of sinusoidal latitude drift correction

satellite_drift_end_time_utc = "00:19:29.416"
# effect: end time anchoring drift interpolation


# ── Fuel model ────────────────────────────────────────

fuel_remaining_at_arc1_kg = 33500.0
# effect: fuel assumed remaining at Arc 1

fuel_baseline_kg_per_hr = 6500.0
# effect: baseline burn rate at reference speed/altitude

fuel_baseline_speed_kts = 471.0
# effect: reference speed for burn rate scaling

fuel_baseline_altitude_ft = 35000.0
# effect: reference altitude for burn rate scaling

fuel_speed_exponent = 1.35
# effect: exponent controlling how burn rate scales with speed

fuel_low_altitude_penalty_per_10kft = 0.12
# effect: extra burn penalty per 10 kft below reference altitude


# ── Post-Arc-7 continuation ──────────────────────────

post_arc7_low_speed_kts = 420.0
# effect: assumed continuation speed for converting remaining fuel to range

max_post_arc7_minutes = 57.0
# effect: maximum minutes of flight beyond Arc 7


# ── Probability heatmap ──────────────────────────────

arc7_grid_min_lat = -45.0
# effect: southern latitude bound for Arc 7 heatmap sampling

arc7_grid_max_lat = -10.0
# effect: northern latitude bound for Arc 7 heatmap sampling

arc7_grid_points = 180
# effect: number of latitude samples along Arc 7


# ── Debris weighting ─────────────────────────────────

debris_weight_min_lat = -38.0
# effect: southern bound of debris-consistency latitude band

debris_weight_max_lat = -32.0
# effect: northern bound of debris-consistency latitude band


# ── Family classification ────────────────────────────

slow_family_max_speed_kts = 390.0
# effect: threshold for labeling Arc 6→7 speed as "slow"

perpendicular_family_tolerance_deg = 20.0
# effect: angular tolerance for "perpendicular to satellite" label
```

### Implementation Steps

#### Step 1.1: Add `toml` crate and config loading

**Files to change:** `src-tauri/Cargo.toml`, new file `src-tauri/src/mh370/config.rs`, `src-tauri/src/mh370/mod.rs`

1. Add `toml = "0.8"` to `[dependencies]` in `Cargo.toml`.
2. Create `src-tauri/src/mh370/config.rs` with:
   - A `load_config()` function that:
     - Starts with `AnalysisConfig::default()` (compiled-in baseline).
     - Looks for `config/analysis.default.toml` relative to the app resource dir (Tauri's `resource_dir`) or CWD for `model_probe`.
     - If found, deserializes it via `toml::from_str` and merges non-default values over the baseline. Since `AnalysisConfig` already derives `Deserialize`, `toml::from_str::<AnalysisConfig>(&contents)` works directly. Use `Option<T>` wrapper fields in a separate `PartialConfig` struct so missing TOML keys don't error — only explicitly set keys override.
     - Then looks for `config/analysis.local.toml` and applies the same merge.
     - Returns a `ResolvedConfig { config: AnalysisConfig, sources: HashMap<String, ConfigSource> }`.
   - A `ConfigSource` enum: `CompiledDefault`, `DefaultToml`, `LocalToml`, `UiOverride`.
   - A `PartialAnalysisConfig` struct (all fields `Option<T>`) with a `merge_into(&self, base: &mut AnalysisConfig)` method that overwrites only `Some` fields.
3. Add `pub mod config;` to `mod.rs`.

**Key detail:** Derive `Deserialize` on `PartialAnalysisConfig` the same way as `AnalysisConfig`. Use `#[serde(default)]` so missing fields become `None`.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PartialAnalysisConfig {
    pub dataset_path: Option<String>,
    pub ring_points: Option<usize>,
    pub min_speed_kts: Option<f64>,
    // ... every field as Option<T>
}

#[derive(Debug, Clone, Copy, Serialize)]
pub enum ConfigSource {
    CompiledDefault,
    DefaultToml,
    LocalToml,
    UiOverride,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedConfig {
    pub config: AnalysisConfig,
    pub sources: HashMap<String, ConfigSource>,
}
```

#### Step 1.2: Add BFO scoring fields to `AnalysisConfig`

**Files to change:** `src-tauri/src/mh370/data.rs`, `src-tauri/src/mh370/paths.rs`, `src-tauri/src/mh370/bfo.rs`, `src/model/config.ts`

1. Add `bfo_sigma_hz: f64` (default 7.0) and `bfo_score_weight: f64` (default 1.0) to `AnalysisConfig`.
2. Replace the hardcoded `BFO_SIGMA_HZ` and `BFO_SCORE_WEIGHT` constants in `paths.rs`/`bfo.rs` with reads from the config.
3. Add matching fields to the TypeScript `AnalysisConfig` interface and `defaultAnalysisConfig`.

#### Step 1.3: Remove `satellite_ephemeris_path` from `AnalysisConfig`

**Files to change:** `src-tauri/src/mh370/data.rs`, `src/model/config.ts`

Remove the field from both sides. There is no code that reads it. Add it back when external ephemeris loading is implemented.

#### Step 1.4: Load config at startup and store in `AppState`

**Files to change:** `src-tauri/src/lib.rs`

1. Call `config::load_config()` in the Tauri `setup` closure, alongside existing `SatelliteModel` init.
2. Store the `ResolvedConfig` in `AppState` behind a `Mutex<ResolvedConfig>`.
3. Add a new Tauri command `get_resolved_config` that returns the current `ResolvedConfig`.

```rust
struct AppState {
    satellite: SatelliteModel,
    resolved_config: Mutex<ResolvedConfig>,
    last_heatmap_peak: AtomicU64,
    drift_validation_ok: AtomicBool,
}
```

#### Step 1.5: Wire config into existing Tauri commands

**Files to change:** `src-tauri/src/lib.rs`

Currently every command accepts `config: Option<AnalysisConfig>`. Change the fallback from `AnalysisConfig::default()` to `state.resolved_config.lock().unwrap().config.clone()`. This means if the UI sends `None`, the TOML-resolved config is used instead of compiled defaults.

#### Step 1.6: New Tauri command for config with sources

**Files to change:** `src-tauri/src/lib.rs`

```rust
#[tauri::command]
fn get_resolved_config(state: State<'_, AppState>) -> ResolvedConfig {
    state.resolved_config.lock().unwrap().clone()
}
```

Register in the `invoke_handler`.

#### Step 1.7: Replace frontend defaults with backend-fetched config

**Files to change:** `src/model/config.ts`, `src/lib/backend.ts`, `src/main.ts`

1. Add `getResolvedConfig()` to `backend.ts` that calls `invoke("get_resolved_config")` in Tauri mode. In browser mode, return a static snapshot (or fall back to the current hardcoded defaults for web-only builds).
2. In `config.ts`, change `defaultAnalysisConfig` from a hardcoded object to a `let` that gets populated at startup from the backend call. Export an `initConfig()` async function that must be called before the app renders.
3. In `main.ts`, call `await initConfig()` early in the init sequence.
4. `resetAnalysisConfig()` now resets to the backend-fetched baseline, not to hardcoded constants.

#### Step 1.8: Attach config to exports

**Files to change:** `src-tauri/src/mh370/export.rs`

1. In `export_probability_geojson` and `export_paths_geojson`, add a top-level `"config"` key to the GeoJSON `FeatureCollection` properties containing the serialized `AnalysisConfig` used for that run.
2. The config comes from the `Option<AnalysisConfig>` parameter, falling back to the resolved config from `AppState`.

#### Step 1.9: Create the default TOML file

**Files to create:** `config/analysis.default.toml`

Use the TOML shape defined above. This file ships with the app and is checked into git. Add `config/analysis.local.toml` to `.gitignore`.

#### Step 1.10: Update `model_probe` to use TOML config

**Files to change:** `src-tauri/src/bin/model_probe.rs`

Call `config::load_config()` and use the resolved config instead of `AnalysisConfig::default()`. This lets researchers iterate on config via TOML edits + `cargo run --bin model_probe` without touching Rust source.

#### Step 1.11: Tests

**Files to change:** new test module in `src-tauri/src/mh370/config.rs`

1. Test that `PartialAnalysisConfig` merge overwrites only set fields.
2. Test that a TOML string round-trips through `AnalysisConfig`.
3. Test that `load_config` with no TOML files returns compiled defaults.
4. Test that `load_config` with a partial TOML only overrides specified fields.

Run: `cd src-tauri && cargo test mh370::config`

#### Step 1.12: Config inspector sidebar section

**Files to change:** `src/ui/sidebar.ts`, `src/style.css`

1. Add a collapsible "Config Inspector" section to the sidebar (below existing controls).
2. On expand, fetch `getResolvedConfig()` and render a table: field name, current value, source badge (`default` / `toml` / `local` / `ui`), and a one-line description.
3. Descriptions come from a static `Record<string, string>` in the frontend, derived from the TOML comments. This is acceptable duplication — it's display-only text, not logic.
4. Highlight fields whose source is not `CompiledDefault` (i.e., fields the user has overridden).

---

## Track 2: Research Workflow Redesign

### Goal

Make the app read like a research tool instead of a layer pile.

### Acceptance Criteria

- A user can understand what changed after rerunning the model.
- A user can distinguish hard constraints from speculative continuation.
- The sidebar reads top-to-bottom like a research session.

### Implementation Steps

#### Step 2.1: Reorganize sidebar sections

**Files to change:** `src/ui/sidebar.ts`, `src/style.css`

Restructure the sidebar into five collapsible sections, in order:

1. **Scenario** — scenario label/notes, dataset selector (future)
2. **Model Inputs** — the existing 10 slider controls + future TOML-exposed fields
3. **Model Results** — best-fit family, endpoint summary, BFO fit, fuel feasibility
4. **Evidence Layers** — searched areas, debris overlays, drift validation, anomalies
5. **Export / History** — export buttons, run metadata, config snapshot

Each section is a `<details>` element with a `<summary>` header. "Model Inputs" and "Model Results" default open; others default closed.

#### Step 2.2: Result summary panel

**Files to change:** `src/ui/sidebar.ts`, `src/lib/backend.ts`

After each model run, display a compact summary in the "Model Results" section:

- Best-fit family name and score
- Endpoint count by family
- Fuel-feasible path percentage
- BFO mean absolute residual
- Peak probability location (lat/lon)

This data is already available from `getCandidatePaths` and `getProbabilityHeatmap` responses — aggregate it client-side.

#### Step 2.3: "What changed" diff after rerun

**Files to change:** `src/ui/sidebar.ts`, `src/model/config.ts`

1. Before each model run, snapshot the current config and result summary.
2. After the run, diff the config and results against the previous snapshot.
3. Display changed fields in a small "Changes" badge at the top of Model Results.

#### Step 2.4: Separate map style from research controls

**Files to change:** `src/ui/sidebar.ts`

Move map style controls (base map toggle, layer visibility checkboxes) into a separate floating panel or a "Map" tab, so they don't interleave with research parameters.

---

## Track 3: Result Interpretation Improvements

### Goal

Make outputs easier to trust or challenge.

### Implementation Steps

#### Step 3.1: Improve BFO panel language

**Files to change:** `src/ui/sidebar.ts` or wherever BFO diagnostics render

For each BFO row, show:
- Raw residual (observed - predicted, in Hz)
- Weight applied (from `bfo_sigma_hz` Gaussian)
- Simple fit label: "good" (< 3 Hz), "marginal" (3–7 Hz), "poor" (> 7 Hz)

#### Step 3.2: Map-linked BFO interactions

**Files to change:** `src/ui/sidebar.ts`, `src/layers/arcs.ts` or `paths.ts`

Clicking a BFO row highlights the corresponding arc on the map and pans to it. Hovering an arc shows a tooltip with the BFO residual.

#### Step 3.3: Endpoint overlap summary

**Files to change:** `src/ui/sidebar.ts`, `src/layers/points.ts`

Count how many fuel-feasible endpoints fall inside vs outside already-searched areas. Display as a fraction: "12/45 endpoints in searched area (27%)".

#### Step 3.4: Continuation vs constrained breakdown

**Files to change:** `src/ui/sidebar.ts`

Show what fraction of the visible endpoint area comes from post-Arc-7 continuation vs direct handshake-constrained endpoints. This makes the speculative component explicit.

---

## Track 4: Reproducibility and Export

### Goal

Treat each run as a reproducible research artifact.

### Implementation Steps

#### Step 4.1: Saved run snapshots

**Files to change:** new `src/model/runs.ts`, `src/ui/sidebar.ts`

1. Define a `SavedRun` type: `{ id, timestamp, config, summary, notes }`.
2. Store runs in `localStorage` (or Tauri filesystem for persistence).
3. Add "Save Run" button in the Export section. Add a run list with click-to-restore.

#### Step 4.2: Config + summary in exported GeoJSON

Already partially addressed by Step 1.8. Additionally:

- Add a `"summary"` key with best family, peak location, path count, BFO mean residual.
- Add a `"generated_at"` ISO timestamp.

#### Step 4.3: Run comparison

**Files to change:** `src/ui/sidebar.ts`, `src/model/runs.ts`

Allow selecting two saved runs. Show a side-by-side table of config diffs and result diffs. This is a table view, not a dual-map view — keep scope small.

#### Step 4.4: Generated report view

**Files to change:** new `src/ui/report.ts`, `src/ui/sidebar.ts`

"Generate Report" button produces a structured text/HTML summary:
- Config used (with non-default values highlighted)
- Best-fit summary and BFO diagnostics
- Searched-area overlap
- Continuation assumptions
- Copyable to clipboard.

---

## Track 5: Evidence and Inversion Expansion

These should follow the config/workflow cleanup, not come first.

### Tasks

1. Better debris inversion inspectability — show per-item contribution to the joint probability.
2. Per-item buoyancy timing model.
3. Joint Bayesian inversion across all debris items.
4. More explicit anomaly-to-model comparison tools.
5. Sonar archive reprocessing track.

No detailed implementation steps yet — scope depends on the state of Tracks 1–4.

---

## Track 6: Documentation Cleanup

### Tasks

1. Update `README.md` to reflect actual BFO usage and current capabilities.
2. Document the meaning of constrained endpoints vs continuation area.
3. Add a `docs/modeling.md` note for the trust hierarchy and main assumptions.
4. Add a `docs/config.md` guide once TOML config lands.

---

## Suggested Implementation Order

1. **Track 1, Steps 1.1–1.5:** Rust config loading, BFO fields, AppState wiring. (`cargo check && cargo test` to validate)
2. **Track 1, Steps 1.6–1.7:** New Tauri command + frontend config fetching. (`pnpm build` to validate)
3. **Track 1, Steps 1.8–1.11:** Exports, TOML file, model_probe, tests.
4. **Track 1, Step 1.12:** Config inspector UI.
5. **Track 2, Steps 2.1–2.2:** Sidebar reorganization and result summary.
6. **Track 3, Steps 3.1–3.3:** BFO panel and endpoint overlap.
7. **Track 2, Steps 2.3–2.4:** Change diff and map style separation.
8. **Track 4:** Saved runs, comparison, reports.
9. **Track 5–6:** Evidence expansion and docs after workflow is stable.

## Immediate Next Batch

If work starts now:

1. `cargo add toml` + create `PartialAnalysisConfig` and `load_config()` in new `config.rs`
2. Add `bfo_sigma_hz` and `bfo_score_weight` to `AnalysisConfig`, remove `satellite_ephemeris_path`
3. Store `ResolvedConfig` in `AppState`, change command fallbacks
4. Create `config/analysis.default.toml`, add `config/analysis.local.toml` to `.gitignore`
5. Add `get_resolved_config` command and wire frontend to fetch it at startup
6. Add config to GeoJSON exports
7. Tests for config loading and merge logic
