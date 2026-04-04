mod mh370;

use mh370::airspaces::get_airspaces_geojson as load_airspaces_geojson;
use mh370::anomalies::{get_anomalies as load_anomalies, Anomaly};
use mh370::arcs::{
    calibrate_bto_offset as run_calibrate_bto_offset, generate_arc_rings as run_generate_arc_rings,
    ArcRing, BtoCalibration,
};
use mh370::data::{handshake_views, load_dataset, resolve_config, AnalysisConfig, HandshakeView};
use mh370::drift::{
    get_debris_log as run_get_debris_log, reverse_drift_debris as run_reverse_drift_debris,
    DebrisItem, DebrisLogItem,
};
use mh370::export::{
    export_paths_geojson as run_export_paths_geojson,
    export_probability_geojson as run_export_probability_geojson,
};
use mh370::paths::{
    apply_fuel_filter as run_apply_fuel_filter,
    sample_candidate_paths as run_sample_candidate_paths, FlightPath, FuelSummary,
};
use mh370::probability::{
    generate_probability_heatmap as run_generate_probability_heatmap, ProbPoint,
};
use mh370::satellite::SatelliteModel;
use serde_json::Value;

struct AppState {
    satellite: SatelliteModel,
}

#[tauri::command]
fn get_arc_rings(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ArcRing>, String> {
    run_generate_arc_rings(&state.satellite, config)
}

#[tauri::command]
fn get_candidate_paths(
    state: tauri::State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    run_sample_candidate_paths(&state.satellite, n, config)
}

#[tauri::command]
fn get_probability_heatmap(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    run_generate_probability_heatmap(&state.satellite, config)
}

#[tauri::command]
fn get_debris_drift(config: Option<AnalysisConfig>) -> Result<Vec<DebrisItem>, String> {
    run_reverse_drift_debris(config)
}

#[tauri::command]
fn get_anomalies() -> Vec<Anomaly> {
    load_anomalies()
}

#[tauri::command]
fn get_airspaces() -> Result<Value, String> {
    load_airspaces_geojson()
}

#[tauri::command]
fn get_debris_log(config: Option<AnalysisConfig>) -> Result<Vec<DebrisLogItem>, String> {
    run_get_debris_log(config)
}

#[tauri::command]
fn get_handshakes(config: Option<AnalysisConfig>) -> Result<Vec<HandshakeView>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    handshake_views(&dataset)
}

#[tauri::command]
fn calibrate_bto_offset(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<BtoCalibration, String> {
    run_calibrate_bto_offset(&state.satellite, config)
}

#[tauri::command]
fn generate_arc_rings(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ArcRing>, String> {
    run_generate_arc_rings(&state.satellite, config)
}

#[tauri::command]
fn sample_candidate_paths(
    state: tauri::State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    run_sample_candidate_paths(&state.satellite, n, config)
}

#[tauri::command]
fn apply_fuel_filter(
    state: tauri::State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<FuelSummary, String> {
    run_apply_fuel_filter(&state.satellite, n, config)
}

#[tauri::command]
fn generate_probability_heatmap(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    run_generate_probability_heatmap(&state.satellite, config)
}

#[tauri::command]
fn reverse_drift_debris(config: Option<AnalysisConfig>) -> Result<Vec<DebrisItem>, String> {
    run_reverse_drift_debris(config)
}

#[tauri::command]
fn export_probability_geojson(
    state: tauri::State<'_, AppState>,
    path: String,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    run_export_probability_geojson(&state.satellite, path, config)
}

#[tauri::command]
fn export_paths_geojson(
    state: tauri::State<'_, AppState>,
    path: String,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    run_export_paths_geojson(&state.satellite, path, n, config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        satellite: SatelliteModel::load().expect("failed to load embedded I3F1 ephemeris"),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_arc_rings,
            get_candidate_paths,
            get_probability_heatmap,
            get_debris_drift,
            get_anomalies,
            get_airspaces,
            get_debris_log,
            get_handshakes,
            calibrate_bto_offset,
            generate_arc_rings,
            sample_candidate_paths,
            apply_fuel_filter,
            generate_probability_heatmap,
            reverse_drift_debris,
            export_probability_geojson,
            export_paths_geojson,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
