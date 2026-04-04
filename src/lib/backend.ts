const IS_TAURI = "__TAURI__" in window || "__TAURI_INTERNALS__" in window;

export { IS_TAURI };

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
  family: string;
  fuel_feasible: boolean;
  fuel_remaining_at_arc7_kg: number;
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

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function fetchSnapshot<T>(filename: string): Promise<T> {
  const res = await fetch(`./data/${filename}`);
  if (!res.ok) throw new Error(`Failed to load ${filename}: ${res.status}`);
  return res.json();
}

export async function getHandshakes(): Promise<BackendHandshake[]> {
  return IS_TAURI
    ? tauriInvoke("get_handshakes")
    : fetchSnapshot("handshakes.json");
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

export async function getCandidatePaths(n = 500): Promise<BackendCandidatePath[]> {
  if (IS_TAURI) return tauriInvoke("get_candidate_paths", { n });
  const geojson = await fetchSnapshot<GeoJSON.FeatureCollection>("candidate_paths.geojson");
  return geojson.features.map((feature) => ({
    points: (feature.geometry as GeoJSON.LineString).coordinates as [number, number][],
    score: Number(feature.properties?.score ?? 0),
    initial_heading: 0,
    family: String(feature.properties?.family ?? "other"),
    fuel_feasible: Boolean(feature.properties?.fuel_feasible),
    fuel_remaining_at_arc7_kg: Number(feature.properties?.fuel_remaining_at_arc7_kg ?? 0),
  }));
}

export async function getProbabilityHeatmap(): Promise<BackendProbPoint[]> {
  if (IS_TAURI) return tauriInvoke("get_probability_heatmap");
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

export async function exportProbabilityGeojson(path: string) {
  if (!IS_TAURI) return;
  return tauriInvoke("export_probability_geojson", { path });
}

export async function exportPathsGeojson(path: string) {
  if (!IS_TAURI) return;
  return tauriInvoke("export_paths_geojson", { path });
}
