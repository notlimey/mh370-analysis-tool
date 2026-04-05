const IS_TAURI = "__TAURI__" in window || "__TAURI_INTERNALS__" in window;

export { IS_TAURI };

import type { AnalysisConfig } from "../model/config";

export type ConfigSource = "CompiledDefault" | "DefaultToml" | "LocalToml" | "UiOverride";

export interface BackendResolvedConfig {
  config: AnalysisConfig;
  sources: Record<string, ConfigSource>;
}

const BROWSER_FALLBACK_CONFIG: AnalysisConfig = {
  dataset_path: "",
  ring_points: 720,
  min_speed_kts: 350,
  max_speed_kts: 520,
  cruise_altitude_ft: 35000,
  calibration_altitude_ft: 0,
  beam_width: 256,
  ring_sample_step: 1,
  speed_consistency_sigma_kts: 35,
  heading_change_sigma_deg: 80,
  northward_leg_sigma_deg: 1.5,
  northward_penalty_weight: 2,
  bfo_sigma_hz: 7,
  bfo_score_weight: 1,
  satellite_nominal_lon_deg: 64.5,
  satellite_nominal_lat_deg: 0,
  satellite_drift_start_lat_offset_deg: 0,
  satellite_drift_amplitude_deg: 1.6,
  satellite_drift_end_time_utc: "00:19:29.416",
  fuel_remaining_at_arc1_kg: 34500,
  fuel_baseline_kg_per_hr: 6500,
  fuel_baseline_speed_kts: 471,
  fuel_baseline_altitude_ft: 35000,
  fuel_speed_exponent: 1.35,
  fuel_low_altitude_penalty_per_10kft: 0.12,
  post_arc7_low_speed_kts: 420,
  max_post_arc7_minutes: 57,
  arc7_grid_min_lat: -45,
  arc7_grid_max_lat: -10,
  arc7_grid_points: 180,
  debris_weight_min_lat: -38,
  debris_weight_max_lat: -32,
  slow_family_max_speed_kts: 390,
  perpendicular_family_tolerance_deg: 20,
};

function compiledDefaultSources(): Record<string, ConfigSource> {
  return Object.fromEntries(
    Object.keys(BROWSER_FALLBACK_CONFIG).map((key) => [key, "CompiledDefault"]),
  );
}

export interface BackendHandshake {
  arc: number;
  time_utc: string;
  bto: number | null;
  bfo: number | null;
  note: string;
}

export interface BackendArcRing {
  arc: number;
  time_utc: string;
  range_km: number;
  points: [number, number][];
}

export interface BackendCandidatePath {
  points: [number, number][];
  score: number;
  initial_heading: number;
  headings_deg?: number[];
  family: string;
  fuel_feasible: boolean;
  fuel_remaining_at_arc7_kg: number;
  extra_endurance_minutes?: number;
  extra_range_nm?: number;
  bfo_summary?: BackendBfoSummary;
  bfo_diagnostics?: BackendBfoDiagnostic[];
}

export interface BackendBfoSummary {
  used_count: number;
  total_count: number;
  mean_abs_residual_hz?: number;
  max_abs_residual_hz?: number;
}

export interface BackendBfoDiagnostic {
  arc: number;
  time_utc: string;
  measured_bfo_hz: number | null;
  predicted_bfo_hz: number | null;
  residual_hz: number | null;
  reliability?: string;
  used_in_score: boolean;
  skip_reason?: string;
}

export interface BackendProbPoint {
  position: [number, number];
  probability: number;
  path_density: number;
  fuel_weight: number;
  debris_weight: number;
}

export interface BackendDebrisLogItem {
  id: string;
  item_description: string;
  find_date: string;
  find_location_name: string;
  lat: number;
  lon: number;
  confirmation: string;
  confirmed_by?: string;
  barnacle_analysis_done: boolean;
  barnacle_analysis_available: boolean;
  oldest_barnacle_age_estimate?: string;
  initial_water_temp_from_barnacle?: number;
  used_in_drift_models: string[];
  notes: string;
}

export interface BackendDebrisDriftItem {
  name: string;
  found_location: [number, number];
  date_found: string;
  days_adrift: number;
  drift_line: [number, number][];
}

export interface BackendAnomaly {
  id: string;
  category: string;
  lat: number | null;
  lon: number | null;
  title: string;
  date: string;
  confidence: string;
  summary: string;
  detail: string;
  source: string;
  source_url?: string;
  implication: string;
  status: string;
  conflicts_with: string[];
  supports: string[];
}

export interface InversionOriginCandidate {
  lat: number;
  lon: number;
  log_likelihood: number;
  normalized_prob: number;
  contributing_items: number;
}

export interface InversionItemContribution {
  id: string;
  label: string;
  item_type: string;
  confidence: number;
  uncertainty_km: number;
  likelihood: number;
  weighted_log_likelihood: number;
  contribution_share: number;
  support_label: string;
}

export interface BackendParticleCloud {
  origin_lat: number;
  origin_lon: number;
  n_days: number;
  particles: [number, number][];
  hull: [number, number][];
}

export interface InversionResult {
  candidates: InversionOriginCandidate[];
  peak_lat: number;
  peak_lon: number;
  confidence_interval_68: [number, number];
  confidence_interval_95: [number, number];
  satellite_peak_lat: number;
  intersection_lat: number;
  items_used: number;
  items_excluded: number;
  item_contributions: InversionItemContribution[];
  validation_ok?: boolean;
  validation_message?: string;
}

// ── Sensitivity sweep types ──

export interface SweepParameter {
  field_name: string;
  sigma: number;
}

export interface SensitivityRequest {
  parameters: SweepParameter[];
  steps_per_side: number;
}

export interface SweepTrial {
  value: number;
  delta_from_base: number;
  peak_lat: number | null;
  peak_lon: number | null;
  peak_probability: number | null;
  fuel_feasible_count: number;
  total_path_count: number;
  distance_from_base_km: number;
}

export interface ParameterSweepResult {
  field_name: string;
  base_value: number;
  trials: SweepTrial[];
  peak_shift_km: number;
}

export interface SensitivityResult {
  base_peak_lat: number | null;
  base_peak_lon: number | null;
  base_path_count: number;
  base_fuel_feasible_count: number;
  sweeps: ParameterSweepResult[];
  total_trials: number;
}

export interface SensitivityProgress {
  pct: number;
  parameter: string;
  trial: number;
  total_trials: number;
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function fetchSnapshot<T>(filename: string): Promise<T> {
  const res = await fetch(`./data/${filename}`);
  if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
  return res.json();
}

function headingFromPoints(points: [number, number][]): number {
  if (points.length < 2) return 0;
  const [fromLon, fromLat] = points[0];
  const [toLon, toLat] = points[1];
  const dLon = (toLon - fromLon) * Math.PI / 180;
  const fromLatRad = fromLat * Math.PI / 180;
  const toLatRad = toLat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(toLatRad);
  const x = Math.cos(fromLatRad) * Math.sin(toLatRad)
    - Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export async function getHandshakes(): Promise<BackendHandshake[]> {
  return IS_TAURI
    ? tauriInvoke("get_handshakes")
    : fetchSnapshot("handshakes.json");
}

export async function getResolvedConfig(): Promise<BackendResolvedConfig> {
  if (IS_TAURI) return tauriInvoke("get_resolved_config");
  return {
    config: { ...BROWSER_FALLBACK_CONFIG },
    sources: compiledDefaultSources(),
  };
}

export async function getArcRings(): Promise<BackendArcRing[]> {
  if (IS_TAURI) return tauriInvoke("get_arc_rings");
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("arc_rings.geojson");
  return geojson.features.map((feature) => ({
    arc: Number(feature.properties?.arc ?? 0),
    time_utc: String(feature.properties?.time ?? ""),
    range_km: Number(feature.properties?.range_km ?? 0),
    points: (feature.geometry as GeoJSON.LineString).coordinates as [number, number][],
  }));
}

export async function getCandidatePaths(n = 500, config?: AnalysisConfig): Promise<BackendCandidatePath[]> {
  if (IS_TAURI) return tauriInvoke("get_candidate_paths", config ? { n, config } : { n });
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("candidate_paths.geojson");
  return geojson.features.map((feature) => ({
    points: (feature.geometry as GeoJSON.LineString).coordinates as [number, number][],
    score: Number(feature.properties?.score ?? 0),
    initial_heading: Number(feature.properties?.initial_heading ?? headingFromPoints((feature.geometry as GeoJSON.LineString).coordinates as [number, number][])),
    headings_deg: [],
    family: String(feature.properties?.family ?? "other"),
    fuel_feasible: Boolean(feature.properties?.fuel_feasible),
    fuel_remaining_at_arc7_kg: Number(feature.properties?.fuel_remaining_at_arc7_kg ?? 0),
    extra_endurance_minutes: 0,
    extra_range_nm: 0,
    bfo_summary: undefined,
    bfo_diagnostics: [],
  }));
}

export async function getProbabilityHeatmap(config?: AnalysisConfig): Promise<BackendProbPoint[]> {
  if (IS_TAURI) return tauriInvoke("get_probability_heatmap", config ? { config } : undefined);
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("probability_heatmap.geojson");
  return geojson.features.map((feature) => ({
    position: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
    probability: Number(feature.properties?.probability ?? 0),
    path_density: Number(feature.properties?.path_density ?? 0),
    fuel_weight: Number(feature.properties?.fuel_weight ?? 0),
    debris_weight: Number(feature.properties?.debris_weight ?? 0),
  }));
}

export async function getDebrisLog(): Promise<BackendDebrisLogItem[]> {
  if (IS_TAURI) return tauriInvoke("get_debris_log");
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("debris_points.geojson");
  return geojson.features.map((feature) => ({
    id: String(feature.properties?.id ?? ""),
    item_description: String(feature.properties?.name ?? ""),
    find_date: String(feature.properties?.date ?? ""),
    find_location_name: String(feature.properties?.location ?? ""),
    lat: Number((feature.geometry as GeoJSON.Point).coordinates[1]),
    lon: Number((feature.geometry as GeoJSON.Point).coordinates[0]),
    confirmation: String(feature.properties?.confirmation ?? "unverified"),
    confirmed_by: feature.properties?.confirmed_by ? String(feature.properties.confirmed_by) : undefined,
    barnacle_analysis_done: String(feature.properties?.barnacle_analysis_done ?? "") === "true" || Boolean(feature.properties?.barnacle_analysis_done),
    barnacle_analysis_available: String(feature.properties?.barnacle_analysis_available ?? "") === "true" || Boolean(feature.properties?.barnacle_analysis_available),
    oldest_barnacle_age_estimate: feature.properties?.oldest_barnacle_age_estimate ? String(feature.properties.oldest_barnacle_age_estimate) : undefined,
    initial_water_temp_from_barnacle: feature.properties?.initial_water_temp_from_barnacle ? Number(feature.properties.initial_water_temp_from_barnacle) : undefined,
    used_in_drift_models: [],
    notes: String(feature.properties?.notes ?? ""),
  }));
}

export async function getDebrisDrift(): Promise<BackendDebrisDriftItem[]> {
  if (IS_TAURI) return tauriInvoke("get_debris_drift");
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("debris_drift.geojson");
  return geojson.features.map((feature) => ({
    name: String(feature.properties?.name ?? ""),
    found_location: (feature.geometry as GeoJSON.LineString).coordinates[0] as [number, number],
    date_found: String(feature.properties?.date_found ?? ""),
    days_adrift: Number(feature.properties?.days_adrift ?? 0),
    drift_line: (feature.geometry as GeoJSON.LineString).coordinates as [number, number][],
  }));
}

export async function getAnomalies(): Promise<BackendAnomaly[]> {
  return IS_TAURI
    ? tauriInvoke("get_anomalies")
    : fetchSnapshot("anomalies.json");
}

export async function getAirspaces(): Promise<GeoJSON.FeatureCollection> {
  return IS_TAURI
    ? tauriInvoke("get_airspaces")
    : fetchSnapshot("airspaces.geojson");
}

export async function exportProbabilityGeojson(path: string, config?: AnalysisConfig) {
  if (!IS_TAURI) return;
  return tauriInvoke("export_probability_geojson", config ? { path, config } : { path });
}

export async function exportPathsGeojson(path: string, config?: AnalysisConfig) {
  if (!IS_TAURI) return;
  return tauriInvoke("export_paths_geojson", config ? { path, config } : { path });
}

export async function runDebrisInversion(config?: AnalysisConfig): Promise<InversionResult> {
  if (IS_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("run_debris_inversion", config ? { config } : undefined);
  }

  const res = await fetch("./data/debris_inversion_result.json");
  if (!res.ok) {
    throw new Error("Debris inversion result not available in snapshot");
  }
  return res.json();
}

export async function getDriftParticleClouds(config?: AnalysisConfig): Promise<BackendParticleCloud[]> {
  if (IS_TAURI) {
    return tauriInvoke("get_drift_particle_clouds", config ? { config } : undefined);
  }
  // No snapshot available for particle clouds in browser mode
  return [];
}

export interface BackendBeachedParticle {
  lon: number;
  lat: number;
  days: number;
  coast: string;
}

export interface BackendBeachingCloud {
  origin_lat: number;
  origin_lon: number;
  beached: BackendBeachedParticle[];
  still_drifting: [number, number][];
  beaching_fraction: number;
  fit_score: number;
  spatial_score: number;
  timing_score: number;
  match_score: number;
  match_total: number;
  matched_finds: string[];
  debug_coast_contacts: Record<string, number>;
  debug_coast_captures: Record<string, number>;
}

export interface DriftSimParams {
  n_particles: number;
  n_origins: number;
  max_days: number;
}

export interface DriftBeachingProgress {
  pct: number;
  origin_index: number;
  total_origins: number;
  origin_lat: number;
}

export async function getDriftBeaching(params?: DriftSimParams, config?: AnalysisConfig): Promise<BackendBeachingCloud[]> {
  if (IS_TAURI) {
    return tauriInvoke("get_drift_beaching", {
      ...(params ? { params } : {}),
      ...(config ? { config } : {}),
    });
  }
  return [];
}

export async function runSensitivitySweep(
  request: SensitivityRequest,
  config?: AnalysisConfig,
): Promise<SensitivityResult> {
  if (!IS_TAURI) throw new Error("Sensitivity sweep requires Tauri backend");
  return tauriInvoke("run_sensitivity_sweep", {
    request,
    ...(config ? { config } : {}),
  });
}
