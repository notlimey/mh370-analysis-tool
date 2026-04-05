mod mh370;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use mh370::airspaces::get_airspaces_geojson as load_airspaces_geojson;
use mh370::anomalies::{get_anomalies as load_anomalies, Anomaly};
use mh370::arcs::{
    calibrate_bto_offset as run_calibrate_bto_offset, generate_arc_rings as run_generate_arc_rings,
    ArcRing, BtoCalibration,
};
use mh370::config as mh370_config;
use mh370::config::ResolvedConfig;
use mh370::data::{handshake_views, load_dataset, HandshakeView};
use mh370::debris_inversion::{
    load_debris_items, run_joint_inversion_with_progress, sample_7th_arc,
    simulate_beaching_for_items, simulate_particle_cloud_for_viz, InversionResult,
};
use mh370::drift::{
    get_debris_log as run_get_debris_log, reverse_drift_debris as run_reverse_drift_debris,
    DebrisItem, DebrisLogItem,
};
use mh370::drift_beaching::BeachingCloud;
use mh370::drift_transport::ParticleCloud;
use mh370::drift_validation::validate_drift_model;
use mh370::export::{
    export_paths_geojson as run_export_paths_geojson,
    export_probability_geojson as run_export_probability_geojson,
};
use mh370::paths::{
    apply_fuel_filter as run_apply_fuel_filter, debug_path_sampling as run_debug_path_sampling,
    sample_candidate_paths as run_sample_candidate_paths, FlightPath, FuelSummary,
    PathSamplingDebug,
};
use mh370::probability::{
    generate_probability_heatmap as run_generate_probability_heatmap, ProbPoint,
};
use mh370::satellite::SatelliteModel;
use serde_json::Value;

pub use mh370::config;
pub use mh370::data::AnalysisConfig;

struct AppState {
    satellite: SatelliteModel,
    resolved_config: Mutex<ResolvedConfig>,
    last_heatmap_peak: AtomicU64,
    drift_validation_ok: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelProbeSummary {
    pub path_count: usize,
    pub heatmap_count: usize,
    pub best_family: Option<String>,
    pub best_score: Option<f64>,
    pub best_fuel_remaining_at_arc7_kg: Option<f64>,
    pub bfo_used_count: Option<usize>,
    pub bfo_total_count: Option<usize>,
    pub bfo_mean_abs_residual_hz: Option<f64>,
    pub peak_lat: Option<f64>,
    pub peak_lon: Option<f64>,
    pub sampling_debug: PathSamplingDebug,
}

pub fn run_model_probe(
    config: Option<AnalysisConfig>,
    n: usize,
) -> Result<ModelProbeSummary, String> {
    let satellite = SatelliteModel::load().map_err(|err| err.to_string())?;
    let paths = run_sample_candidate_paths(&satellite, n, config.clone())?;
    let heatmap = run_generate_probability_heatmap(&satellite, config.clone())?;
    let sampling_debug = run_debug_path_sampling(&satellite, config)?;
    let heatmap_peak = heatmap
        .iter()
        .max_by(|left, right| left.probability.partial_cmp(&right.probability).unwrap())
        .map(|point| (point.position[1], point.position[0]));
    let best_path = paths.first();

    Ok(ModelProbeSummary {
        path_count: paths.len(),
        heatmap_count: heatmap.len(),
        best_family: best_path.map(|path| path.family.clone()),
        best_score: best_path.map(|path| path.score),
        best_fuel_remaining_at_arc7_kg: best_path.map(|path| path.fuel_remaining_at_arc7_kg),
        bfo_used_count: best_path.map(|path| path.bfo_summary.used_count),
        bfo_total_count: best_path.map(|path| path.bfo_summary.total_count),
        bfo_mean_abs_residual_hz: best_path.and_then(|path| path.bfo_summary.mean_abs_residual_hz),
        peak_lat: heatmap_peak.map(|(lat, _)| lat),
        peak_lon: heatmap_peak.map(|(_, lon)| lon),
        sampling_debug,
    })
}

fn update_heatmap_peak(state: &AppState, points: &[ProbPoint]) {
    if let Some(lat) = points
        .iter()
        .max_by(|left, right| left.probability.partial_cmp(&right.probability).unwrap())
        .map(|point| point.position[1])
    {
        state
            .last_heatmap_peak
            .store(lat.to_bits(), Ordering::Relaxed);
    }
}

fn effective_config(state: &AppState, config: Option<AnalysisConfig>) -> AnalysisConfig {
    config.unwrap_or_else(|| state.resolved_config.lock().unwrap().config.clone())
}

fn generate_probability_heatmap_and_store_peak(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    let points =
        run_generate_probability_heatmap(&state.satellite, Some(effective_config(&state, config)))?;
    update_heatmap_peak(&state, &points);
    Ok(points)
}

#[tauri::command]
async fn run_debris_inversion(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<InversionResult, String> {
    let satellite = state.satellite.clone();
    let satellite_peak = f64::from_bits(state.last_heatmap_peak.load(Ordering::Relaxed));
    let validation_ok = state.drift_validation_ok.load(Ordering::Relaxed);
    let config = effective_config(&state, config);
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
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ParticleCloud>, String> {
    let satellite = state.satellite.clone();
    let config = effective_config(&state, config);
    tauri::async_runtime::spawn_blocking(move || {
        let items = load_debris_items()?;
        let arc_points = sample_7th_arc(&satellite, Some(config.clone()));
        // Sample clouds at ~2° intervals along the 7th arc for visualization
        let step = (arc_points.len() / 20).max(1);
        let sampled: Vec<(f64, f64)> = arc_points.iter().step_by(step).copied().collect();

        // Use flaperon drift time (507 days to Réunion) — it's the most
        // constrained debris item and produces the most meaningful clouds.
        let drift_days = items
            .iter()
            .find(|item| item.item_type == "flaperon")
            .map(|item| item.find_date_days)
            .unwrap_or(507.0);

        let clouds: Vec<ParticleCloud> = sampled
            .into_iter()
            .map(|(lat, lon)| simulate_particle_cloud_for_viz(lat, lon, drift_days, 0.025))
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
    state: State<'_, AppState>,
    params: Option<BeachingParams>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<BeachingCloud>, String> {
    let satellite = state.satellite.clone();
    let app_handle = app.clone();
    let config = effective_config(&state, config);
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
        let sampled: Vec<(f64, f64)> = arc_points.iter().step_by(step).copied().collect();

        let total = sampled.len();

        let clouds: Vec<BeachingCloud> = sampled
            .into_iter()
            .enumerate()
            .map(|(i, (lat, lon))| {
                let pct = ((i + 1) as f64 / total as f64 * 100.0) as u32;
                let _ = app_handle.emit(
                    "drift-beaching-progress",
                    BeachingProgress {
                        pct,
                        origin_index: i + 1,
                        total_origins: total,
                        origin_lat: lat,
                    },
                );
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
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ArcRing>, String> {
    run_generate_arc_rings(&state.satellite, Some(effective_config(&state, config)))
}

#[tauri::command]
fn get_candidate_paths(
    state: State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    run_sample_candidate_paths(&state.satellite, n, Some(effective_config(&state, config)))
}

#[tauri::command]
fn get_probability_heatmap(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    generate_probability_heatmap_and_store_peak(state, config)
}

#[tauri::command]
fn get_debris_drift(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<DebrisItem>, String> {
    run_reverse_drift_debris(Some(effective_config(&state, config)))
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
fn get_debris_log(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<DebrisLogItem>, String> {
    run_get_debris_log(Some(effective_config(&state, config)))
}

#[tauri::command]
fn get_handshakes(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<HandshakeView>, String> {
    let config = effective_config(&state, config);
    let dataset = load_dataset(&config)?;
    handshake_views(&dataset)
}

#[tauri::command]
fn calibrate_bto_offset(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<BtoCalibration, String> {
    run_calibrate_bto_offset(&state.satellite, Some(effective_config(&state, config)))
}

#[tauri::command]
fn generate_arc_rings(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ArcRing>, String> {
    run_generate_arc_rings(&state.satellite, Some(effective_config(&state, config)))
}

#[tauri::command]
fn sample_candidate_paths(
    state: State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    run_sample_candidate_paths(&state.satellite, n, Some(effective_config(&state, config)))
}

#[tauri::command]
fn apply_fuel_filter(
    state: State<'_, AppState>,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<FuelSummary, String> {
    run_apply_fuel_filter(&state.satellite, n, Some(effective_config(&state, config)))
}

#[tauri::command]
fn generate_probability_heatmap(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    generate_probability_heatmap_and_store_peak(state, config)
}

#[tauri::command]
fn reverse_drift_debris(
    state: State<'_, AppState>,
    config: Option<AnalysisConfig>,
) -> Result<Vec<DebrisItem>, String> {
    run_reverse_drift_debris(Some(effective_config(&state, config)))
}

#[tauri::command]
fn export_probability_geojson(
    state: State<'_, AppState>,
    path: String,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    run_export_probability_geojson(
        &state.satellite,
        path,
        Some(effective_config(&state, config)),
    )
}

#[tauri::command]
fn export_paths_geojson(
    state: State<'_, AppState>,
    path: String,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    run_export_paths_geojson(
        &state.satellite,
        path,
        n,
        Some(effective_config(&state, config)),
    )
}

#[tauri::command]
fn get_resolved_config(state: State<'_, AppState>) -> ResolvedConfig {
    state.resolved_config.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let satellite = SatelliteModel::load().expect("failed to load embedded I3F1 ephemeris");
            let mut roots = Vec::new();
            if let Ok(resource_dir) = app.path().resource_dir() {
                roots.push(resource_dir);
            }
            if let Ok(cwd) = std::env::current_dir() {
                roots.push(cwd);
            }

            let resolved_config =
                mh370_config::load_config_from_roots(&roots).map_err(std::io::Error::other)?;
            let initial_heatmap_peak =
                run_generate_probability_heatmap(&satellite, Some(resolved_config.config.clone()))
                    .ok()
                    .and_then(|points| {
                        points
                            .into_iter()
                            .max_by(|left, right| {
                                left.probability.partial_cmp(&right.probability).unwrap()
                            })
                            .map(|point| point.position[1])
                    })
                    .unwrap_or(-34.23);
            let drift_validation_ok = validate_drift_model();

            app.manage(AppState {
                satellite,
                resolved_config: Mutex::new(resolved_config),
                last_heatmap_peak: AtomicU64::new(initial_heatmap_peak.to_bits()),
                drift_validation_ok: AtomicBool::new(drift_validation_ok),
            });

            Ok(())
        })
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
            get_resolved_config,
            run_debris_inversion,
            get_drift_particle_clouds,
            get_drift_beaching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
