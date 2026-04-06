use serde::{Deserialize, Serialize};

use super::config::{get_config_field, set_config_field};
use super::data::{load_dataset, resolve_config, AnalysisConfig};
use super::geometry::{haversine, LatLon};
use super::paths::sample_candidate_paths_from_dataset;
use super::probability::generate_probability_heatmap_from_dataset;
use super::satellite::SatelliteModel;

/// A single parameter to sweep, with absolute perturbation per step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepParameter {
    pub field_name: String,
    /// Absolute perturbation per step (e.g. step k uses base + k * sigma).
    pub sigma: f64,
}

/// Request payload for a sensitivity sweep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitivityRequest {
    /// Parameters to sweep. If empty, uses the built-in default set.
    pub parameters: Vec<SweepParameter>,
    /// Number of steps on each side of baseline (e.g. 3 = 7 trials: -3σ .. +3σ).
    pub steps_per_side: usize,
}

/// Result of a single trial (one parameter value).
#[derive(Debug, Clone, Serialize)]
pub struct SweepTrial {
    pub value: f64,
    pub delta_from_base: f64,
    pub peak_lat: Option<f64>,
    pub peak_lon: Option<f64>,
    pub peak_probability: Option<f64>,
    pub fuel_feasible_count: usize,
    pub total_path_count: usize,
    pub distance_from_base_km: f64,
}

/// Results for one swept parameter.
#[derive(Debug, Clone, Serialize)]
pub struct ParameterSweepResult {
    pub field_name: String,
    pub base_value: f64,
    pub trials: Vec<SweepTrial>,
    /// Maximum peak shift across all trials for this parameter (km).
    pub peak_shift_km: f64,
}

/// Full sensitivity sweep result.
#[derive(Debug, Clone, Serialize)]
pub struct SensitivityResult {
    pub base_peak_lat: Option<f64>,
    pub base_peak_lon: Option<f64>,
    pub base_path_count: usize,
    pub base_fuel_feasible_count: usize,
    /// Sweeps sorted by peak_shift_km descending (most sensitive first).
    pub sweeps: Vec<ParameterSweepResult>,
    pub total_trials: usize,
}

/// Built-in default parameters with reasonable sigma values.
pub fn default_sweep_parameters() -> Vec<SweepParameter> {
    vec![
        SweepParameter { field_name: "fuel_remaining_at_arc1_kg".into(), sigma: 2000.0 },
        SweepParameter { field_name: "fuel_baseline_kg_per_hr".into(), sigma: 500.0 },
        SweepParameter { field_name: "fuel_speed_exponent".into(), sigma: 0.15 },
        SweepParameter { field_name: "speed_consistency_sigma_kts".into(), sigma: 10.0 },
        SweepParameter { field_name: "heading_change_sigma_deg".into(), sigma: 20.0 },
        SweepParameter { field_name: "northward_penalty_weight".into(), sigma: 0.5 },
        SweepParameter { field_name: "northward_leg_sigma_deg".into(), sigma: 0.5 },
        SweepParameter { field_name: "bfo_sigma_hz".into(), sigma: 3.0 },
        SweepParameter { field_name: "bfo_score_weight".into(), sigma: 0.3 },
        SweepParameter { field_name: "cruise_altitude_ft".into(), sigma: 5000.0 },
        SweepParameter { field_name: "min_speed_kts".into(), sigma: 30.0 },
        SweepParameter { field_name: "max_speed_kts".into(), sigma: 30.0 },
        SweepParameter { field_name: "satellite_drift_amplitude_deg".into(), sigma: 0.3 },
        SweepParameter { field_name: "post_arc7_low_speed_kts".into(), sigma: 30.0 },
        SweepParameter { field_name: "max_post_arc7_minutes".into(), sigma: 15.0 },
    ]
}

/// Run a single trial: modify one config field, run pipeline, extract peak.
fn run_trial(
    satellite: &SatelliteModel,
    base_config: &AnalysisConfig,
    field_name: &str,
    value: f64,
    base_peak: Option<LatLon>,
) -> Result<SweepTrial, String> {
    let base_value = get_config_field(base_config, field_name)?;
    let mut config = base_config.clone();
    set_config_field(&mut config, field_name, value)?;

    let dataset = load_dataset(&config)?;
    let paths = sample_candidate_paths_from_dataset(
        satellite,
        &dataset,
        config.beam_width.max(200),
        &config,
    )?;

    let total_path_count = paths.len();
    let fuel_feasible_count = paths.iter().filter(|p| p.fuel_feasible).count();

    let heatmap = generate_probability_heatmap_from_dataset(satellite, &dataset, &config)?;

    let peak = heatmap
        .iter()
        .max_by(|a, b| a.probability.partial_cmp(&b.probability).unwrap());

    let peak_lat = peak.map(|p| p.position[1]);
    let peak_lon = peak.map(|p| p.position[0]);
    let peak_probability = peak.map(|p| p.probability);

    let distance_from_base_km = match (base_peak, peak_lat, peak_lon) {
        (Some(base), Some(lat), Some(lon)) => haversine(base, LatLon::new(lat, lon)),
        _ => 0.0,
    };

    Ok(SweepTrial {
        value,
        delta_from_base: value - base_value,
        peak_lat,
        peak_lon,
        peak_probability,
        fuel_feasible_count,
        total_path_count,
        distance_from_base_km,
    })
}

/// Run the full sensitivity sweep.
///
/// `on_progress` is called after each trial with (completed_trials, total_trials, current_field_name).
pub fn run_sensitivity_sweep<F>(
    satellite: &SatelliteModel,
    request: &SensitivityRequest,
    base_config: Option<AnalysisConfig>,
    mut on_progress: F,
) -> Result<SensitivityResult, String>
where
    F: FnMut(usize, usize, &str),
{
    let config = resolve_config(base_config);
    let parameters = if request.parameters.is_empty() {
        default_sweep_parameters()
    } else {
        request.parameters.clone()
    };
    let steps = request.steps_per_side.max(1);
    let total_trials = parameters.len() * steps * 2; // symmetric: -N..-1, +1..+N

    // Run baseline
    let dataset = load_dataset(&config)?;
    let base_paths = sample_candidate_paths_from_dataset(
        satellite,
        &dataset,
        config.beam_width.max(200),
        &config,
    )?;
    let base_heatmap = generate_probability_heatmap_from_dataset(satellite, &dataset, &config)?;

    let base_peak_point = base_heatmap
        .iter()
        .max_by(|a, b| a.probability.partial_cmp(&b.probability).unwrap());
    let base_peak_lat = base_peak_point.map(|p| p.position[1]);
    let base_peak_lon = base_peak_point.map(|p| p.position[0]);
    let base_peak_latlon = match (base_peak_lat, base_peak_lon) {
        (Some(lat), Some(lon)) => Some(LatLon::new(lat, lon)),
        _ => None,
    };
    let base_path_count = base_paths.len();
    let base_fuel_feasible_count = base_paths.iter().filter(|p| p.fuel_feasible).count();

    let mut completed = 0;
    let mut sweeps = Vec::new();

    for param in &parameters {
        let base_value = get_config_field(&config, &param.field_name)?;
        let mut trials = Vec::new();
        let mut max_shift = 0.0_f64;

        // Negative steps: -N, -(N-1), ..., -1; then positive: +1, ..., +N
        for k in (1..=steps).rev() {
            let value = base_value - k as f64 * param.sigma;
            let trial = run_trial(satellite, &config, &param.field_name, value, base_peak_latlon)?;
            max_shift = max_shift.max(trial.distance_from_base_km);
            trials.push(trial);
            completed += 1;
            on_progress(completed, total_trials, &param.field_name);
        }
        for k in 1..=steps {
            let value = base_value + k as f64 * param.sigma;
            let trial = run_trial(satellite, &config, &param.field_name, value, base_peak_latlon)?;
            max_shift = max_shift.max(trial.distance_from_base_km);
            trials.push(trial);
            completed += 1;
            on_progress(completed, total_trials, &param.field_name);
        }

        sweeps.push(ParameterSweepResult {
            field_name: param.field_name.clone(),
            base_value,
            trials,
            peak_shift_km: max_shift,
        });
    }

    // Sort by sensitivity (most impactful first)
    sweeps.sort_by(|a, b| b.peak_shift_km.partial_cmp(&a.peak_shift_km).unwrap_or(std::cmp::Ordering::Equal));

    Ok(SensitivityResult {
        base_peak_lat,
        base_peak_lon,
        base_path_count,
        base_fuel_feasible_count,
        sweeps,
        total_trials,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_sweep_parameters_are_all_valid() {
        let config = AnalysisConfig::default();
        for param in default_sweep_parameters() {
            let value = get_config_field(&config, &param.field_name);
            assert!(
                value.is_ok(),
                "default sweep parameter '{}' not found in config: {:?}",
                param.field_name,
                value.err()
            );
        }
    }

    #[test]
    fn get_set_config_field_roundtrips() {
        let mut config = AnalysisConfig::default();
        let original = get_config_field(&config, "bfo_sigma_hz").unwrap();
        set_config_field(&mut config, "bfo_sigma_hz", 12.0).unwrap();
        assert_eq!(get_config_field(&config, "bfo_sigma_hz").unwrap(), 12.0);
        set_config_field(&mut config, "bfo_sigma_hz", original).unwrap();
        assert_eq!(get_config_field(&config, "bfo_sigma_hz").unwrap(), original);
    }

    #[test]
    fn non_numeric_fields_return_error() {
        let config = AnalysisConfig::default();
        assert!(get_config_field(&config, "dataset_path").is_err());
        assert!(get_config_field(&config, "satellite_drift_end_time_utc").is_err());
    }

    #[test]
    fn unknown_field_returns_error() {
        let config = AnalysisConfig::default();
        assert!(get_config_field(&config, "nonexistent_field").is_err());
    }
}
