mod mh370;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use mh370::airspaces::get_airspaces_geojson as load_airspaces_geojson;
use mh370::anomalies::{get_anomalies as load_anomalies, Anomaly};
use mh370::arcs::{
    calibrate_bto_offset as run_calibrate_bto_offset, generate_arc_rings as run_generate_arc_rings,
    ArcRing, BtoCalibration,
};
use mh370::data::{handshake_views, load_dataset, resolve_config, AnalysisConfig, HandshakeView};
use mh370::debris_inversion::{
    load_debris_items, run_joint_inversion_with_progress, sample_7th_arc,
    simulate_beaching_for_items, simulate_particle_cloud_for_viz, InversionResult,
};
use mh370::drift_beaching::BeachingCloud;
use mh370::drift::{
    get_debris_log as run_get_debris_log, reverse_drift_debris as run_reverse_drift_debris,
    DebrisItem, DebrisLogItem,
};
use mh370::drift_transport::ParticleCloud;
use mh370::drift_validation::validate_drift_model;
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
    last_heatmap_peak: AtomicU64,
    drift_validation_ok: AtomicBool,
}

fn update_heatmap_peak(state: &AppState, points: &[ProbPoint]) {
    if let Some(lat) = points
        .iter()
        .max_by(|left, right| left.probability.partial_cmp(&right.probability).unwrap())
        .map(|point| point.position[1])
    {
        state.last_heatmap_peak.store(lat.to_bits(), Ordering::Relaxed);
    }
}

fn generate_probability_heatmap_and_store_peak(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    let points = run_generate_probability_heatmap(&state.satellite, config)?;
    update_heatmap_peak(&state, &points);
    Ok(points)
}

#[tauri::command]
async fn run_debris_inversion(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<InversionResult, String> {
    let satellite = state.satellite.clone();
    let satellite_peak = f64::from_bits(state.last_heatmap_peak.load(Ordering::Relaxed));
    let validation_ok = state.drift_validation_ok.load(Ordering::Relaxed);
    let config = resolve_config(config);
    let satellite_peak_lat = if satellite_peak == 0.0 {
        -34.23
    } else {
        satellite_peak
    };
    let app_handle = app.clone();

    let mut result =
        tauri::async_runtime::spawn_blocking(move || -> Result<InversionResult, String> {
            let items = load_debris_items()?;
            let arc_points = sample_7th_arc(&satellite, Some(config.clone()));
            Ok(run_joint_inversion_with_progress(
                &items,
                &arc_points,
                satellite_peak_lat,
                |pct| {
                    let _ = app_handle.emit("debris-inversion-progress", pct);
                },
            ))
        })
        .await
        .map_err(|err| format!("debris inversion task failed: {err}"))??;

    result.validation_ok = validation_ok;
    result.validation_message = if validation_ok {
        "✓ Drift model validated against Réunion flaperon find".to_string()
    } else {
        "⚠️ Drift model validation: flaperon test FAILED\nResults shown but leeway coefficients may need tuning.\nTreat debris peak location with caution.".to_string()
    };

    Ok(result)
}

#[tauri::command]
async fn get_drift_particle_clouds(
    state: tauri::State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ParticleCloud>, String> {
    let satellite = state.satellite.clone();
    let config = resolve_config(config);
    tauri::async_runtime::spawn_blocking(move || {
        let items = load_debris_items()?;
        let arc_points = sample_7th_arc(&satellite, Some(config.clone()));
        // Sample clouds at ~2° intervals along the 7th arc for visualization
        let step = (arc_points.len() / 20).max(1);
        let sampled: Vec<(f64, f64)> = arc_points
            .iter()
            .step_by(step)
            .copied()
            .collect();

        // Use flaperon drift time (507 days to Réunion) — it's the most
        // constrained debris item and produces the most meaningful clouds.
        let drift_days = items
            .iter()
            .find(|item| item.item_type == "flaperon")
            .map(|item| item.find_date_days)
            .unwrap_or(507.0);

        let clouds: Vec<ParticleCloud> = sampled
            .into_iter()
            .map(|(lat, lon)| {
                simulate_particle_cloud_for_viz(lat, lon, drift_days, 0.025)
            })
            .collect();

        Ok(clouds)
    })
    .await
    .map_err(|err| format!("particle cloud task failed: {err}"))?
}

/// Parameters for the drift beaching simulation, configurable from the frontend.
#[derive(Debug, Clone, Deserialize)]
struct BeachingParams {
    n_particles: Option<usize>,
    n_origins: Option<usize>,
    max_days: Option<usize>,
}

/// Progress payload sent to frontend during drift simulation.
#[derive(Debug, Clone, Serialize)]
struct BeachingProgress {
    pct: u32,
    origin_index: usize,
    total_origins: usize,
    origin_lat: f64,
}

#[tauri::command]
async fn get_drift_beaching(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    params: Option<BeachingParams>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<BeachingCloud>, String> {
    let satellite = state.satellite.clone();
    let app_handle = app.clone();
    let config = resolve_config(config);
    let params = params.unwrap_or(BeachingParams {
        n_particles: None,
        n_origins: None,
        max_days: None,
    });
    tauri::async_runtime::spawn_blocking(move || {
        let items = load_debris_items()?;
        let arc_points = sample_7th_arc(&satellite, Some(config.clone()));
        let n_origins = params.n_origins.unwrap_or(15);
        let step = (arc_points.len() / n_origins).max(1);
        let sampled: Vec<(f64, f64)> = arc_points
            .iter()
            .step_by(step)
            .copied()
            .collect();

        let total = sampled.len();

        let clouds: Vec<BeachingCloud> = sampled
            .into_iter()
            .enumerate()
            .map(|(i, (lat, lon))| {
                let pct = ((i + 1) as f64 / total as f64 * 100.0) as u32;
                let _ = app_handle.emit("drift-beaching-progress", BeachingProgress {
                    pct,
                    origin_index: i + 1,
                    total_origins: total,
                    origin_lat: lat,
                });
                simulate_beaching_for_items(lat, lon, &items, params.n_particles, params.max_days)
            })
            .collect();

        Ok(clouds)
    })
    .await
    .map_err(|err| format!("beaching simulation failed: {err}"))?
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
    generate_probability_heatmap_and_store_peak(state, config)
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
    generate_probability_heatmap_and_store_peak(state, config)
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
    let satellite = SatelliteModel::load().expect("failed to load embedded I3F1 ephemeris");
    let initial_heatmap_peak = run_generate_probability_heatmap(&satellite, None)
        .ok()
        .and_then(|points| {
            points
                .into_iter()
                .max_by(|left, right| left.probability.partial_cmp(&right.probability).unwrap())
                .map(|point| point.position[1])
        })
        .unwrap_or(-34.23);
    let drift_validation_ok = validate_drift_model();

    let app_state = AppState {
        satellite,
        last_heatmap_peak: AtomicU64::new(initial_heatmap_peak.to_bits()),
        drift_validation_ok: AtomicBool::new(drift_validation_ok),
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
            run_debris_inversion,
            get_drift_particle_clouds,
            get_drift_beaching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
