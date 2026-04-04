# Anomaly, Debris, and Drift Follow-Up

This note captures the next map-layer expansion beyond the current BTO, path, fuel, and heatmap pipeline.

## Goal

Turn the map from a path-only visualization into an evidence graph that can show:

- unexplored anomalies
- confirmed and suspected debris finds
- reverse-drift corridors and later particle simulations

## Proposed New Layers

### Layer 6: Anomaly Markers

Add clickable anomaly markers with category-specific styling.

```ts
type AnomalyCategory =
  | "acoustic"
  | "satellite_image"
  | "biological"
  | "signal"
  | "eyewitness";

interface Anomaly {
  id: string;
  category: AnomalyCategory;
  lat: number | null;
  lon: number | null;
  title: string;
  date: string;
  confidence: "high" | "medium" | "low" | "unknown";
  summary: string;
  detail: string;
  source: string;
  source_url?: string;
  implication: string;
  status: "unexplored" | "dismissed" | "active" | "refuted";
  conflicts_with?: string[];
  supports?: string[];
}
```

Behavior:

- show a pulsing marker treatment for `unexplored`
- clicking a marker opens a right-side detail panel
- if `supports` references another anomaly, highlight both and draw a faint connection line
- if `conflicts_with` references another anomaly, render those links in a contrasting style

## Proposed Debris Log Layer

Add distinct markers for each debris item and a companion log view.

```ts
interface DebrisLogItem {
  id: string;
  item_description: string;
  find_date: string;
  find_location_name: string;
  lat: number;
  lon: number;
  confirmation: "confirmed" | "probable" | "suspected" | "unverified";
  confirmed_by?: string;
  barnacle_analysis_done: boolean;
  barnacle_analysis_available: boolean;
  oldest_barnacle_age_estimate?: string;
  initial_water_temp_from_barnacle?: number;
  used_in_drift_models: string[];
  notes: string;
}
```

Behavior:

- marker popup shows item description, date, location, and confirmation status
- draw a faint great-circle line from each debris item back toward a probable source corridor near the 7th arc
- confirmed items use solid styling; suspected items use dashed styling

## Proposed Drift Layer

### Mode A: Static Corridors

Show semi-transparent polygons or broad corridor bands for reverse-drift source regions.

### Mode B: Interactive Particle Simulation

Allow the user to drag a release point on the 7th arc and simulate particle drift forward.

Initial backend shape:

```rust
pub struct DriftParticle {
    pub lat: f64,
    pub lon: f64,
    pub age_days: u32,
}

pub fn step_particle(p: &DriftParticle) -> DriftParticle {
    // phase 1: latitude-band mean currents
    // phase 2: real current grids / drifter data
}
```

Suggested command surface:

```rust
#[tauri::command]
fn get_anomalies() -> Vec<Anomaly>

#[tauri::command]
fn get_debris_log() -> Vec<DebrisLogItem>

#[tauri::command]
fn run_drift_simulation(
    origin_lat: f64,
    origin_lon: f64,
    duration_days: u32,
    n_particles: usize,
) -> Vec<DriftParticle>
```

## Seed Anomalies To Add

Seed data to capture in the app next:

- `java_anomaly`
- `barnacle_large_specimens`
- `thermal_plume_aqua_modis`
- `sdu_temperature_fingerprint`
- `rx_power_dropoff`
- `cloud_trail_modis`
- `cocos_island_seismometer`

These should be stored as structured data rather than embedded directly in UI code.

## UI Panel Shape

Right-side click panel should include:

- category icon and label
- title
- date
- confidence
- status
- short summary
- expandable technical detail
- implication for search
- corroborates / conflicts section
- source link

## Suggested Implementation Order

1. Add static anomaly and debris seed data with new commands.
2. Add anomaly markers and debris markers as new layers.
3. Add evidence-link highlighting for support/conflict relationships.
4. Add static reverse-drift corridors.
5. Add interactive particle drift as a separate iteration.

## Reason To Defer

These layers are valuable, but they should sit on top of the current uncertainty-first path model instead of replacing it. The current priority remains making the BTO, fuel, and arc6/arc7 assumptions inspectable and testable.

## Additional Future Research Tracks

These are longer-horizon research directions to preserve for later investigation and possible app modules.

### 1. Pilot Intent From Flight Simulator Forensics

Use the leaked simulator waypoint fragments to infer the optimization objective behind the route.

- reconstruct candidate waypoint sets
- test objective functions such as radar avoidance, search avoidance, or deep-seabed targeting
- extrapolate the likely real-flight continuation if the simulator session was a rehearsal

### 2. Debris Buoyancy As A Hidden Clock

Model each debris item's surfacing delay instead of assuming everything became surface-drifting at impact.

- build per-item buoyancy decay / surfacing models
- combine with reverse drift
- use staggered surfacing time as additional location information

### 3. Passenger Phone Network Pings

Treat failed tower connection attempts as geometric constraints if tower, timing, and signal strength data can ever be obtained.

### 4. Lightning Database As A Negative Constraint

Check whether lightning strike fields show an aircraft-shaped disturbance or gap along candidate paths.

### 5. Ocean Floor Magnetic Anomaly Prioritization

Use magnetometer search planning for terrain where sonar quality is poor.

### 6. Water Column Decomposition Chemistry

Cross-reference Argo float chemistry and temperature anomalies against candidate crash corridors.

### 7. AI Reprocessing Of Public Sonar Archive

Reprocess the released Geoscience Australia sonar archive with modern CV models trained on debris-field signatures rather than intact wreck outlines.

### 8. ADS-B Ghost Detection From Amateur RF Logs

Look for raw 1090 MHz carrier or last-transponder traces in amateur receiver archives across the blackout corridor.

### 9. CFD On Flaperon Damage

Use impact simulation to constrain water-entry angle, speed, and control-surface state from the published damage pattern.

### 10. Joint Bayesian Inversion Of All Debris Items

Model all debris items as one shared-origin system rather than independent reverse-drift cases.

## Priority Future Builds

Best candidates for future Tauri app modules using public data first:

1. AI reprocessing of the released sonar archive.
2. Joint Bayesian inversion across all debris items.
3. Per-item buoyancy decay combined with drift.
