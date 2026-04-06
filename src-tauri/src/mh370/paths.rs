use serde::Serialize;

use super::arcs::{bto_to_slant_range_km, build_arc_ring, calibrate_bto_offset_from_dataset};
use super::bfo::BfoModel;
use super::data::{
    load_dataset, parse_time_utc_seconds, path_scoring_handshakes, resolve_config, AnalysisConfig,
    Mh370Dataset,
};
use super::geometry::{bearing, haversine, LatLon};
use super::satellite::{satellite_subpoint, SatelliteModel};

const KTS_TO_KM_PER_HR: f64 = 1.852;

pub const LAST_RADAR: LatLon = LatLon {
    lat: 6.8,
    lon: 97.7,
};
pub const LAST_RADAR_TIME_UTC: &str = "18:22:00";

#[derive(Debug, Clone)]
struct PathState {
    points: Vec<LatLon>,
    speeds_kts: Vec<f64>,
    headings_deg: Vec<f64>,
    log_score: f64,
    speed_log_score: f64,
    heading_log_score: f64,
    northward_log_score: f64,
    bfo_log_score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlightPath {
    pub points: Vec<[f64; 2]>,
    pub score: f64,
    pub initial_heading: f64,
    pub speeds_kts: Vec<f64>,
    pub headings_deg: Vec<f64>,
    pub legs: Vec<LegDiagnostic>,
    pub total_distance_km: f64,
    pub family: String,
    pub arc67_metrics: Arc67Metrics,
    pub fuel_feasible: bool,
    pub fuel_remaining_at_arc7_kg: f64,
    pub extra_endurance_minutes: f64,
    pub extra_range_nm: f64,
    pub bfo_summary: BfoSummary,
    pub bfo_diagnostics: Vec<BfoDiagnostic>,
    pub speed_log_score: f64,
    pub heading_log_score: f64,
    pub northward_log_score: f64,
    pub bfo_log_score: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BfoSummary {
    pub used_count: usize,
    pub total_count: usize,
    pub mean_abs_residual_hz: Option<f64>,
    pub max_abs_residual_hz: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BfoDiagnostic {
    pub arc: u8,
    pub time_utc: String,
    pub measured_bfo_hz: Option<f64>,
    pub predicted_bfo_hz: Option<f64>,
    pub residual_hz: Option<f64>,
    pub reliability: Option<String>,
    pub used_in_score: bool,
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LegDiagnostic {
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub distance_km: f64,
    pub speed_kts: f64,
    pub heading_deg: f64,
    pub speed_residual_kts: f64,
    pub heading_change_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Arc67Metrics {
    pub bearing_to_satellite_deg: f64,
    pub heading_relative_to_satellite_deg: f64,
    pub effective_radial_speed_kts: f64,
    pub expected_bto_change_km_in_8_5_min: f64,
    pub expected_bto_change_us_in_8_5_min: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FuelSummary {
    pub path_count_before: usize,
    pub path_count_after: usize,
    pub low_speed_reference_minutes: f64,
    pub low_speed_reference_range_nm: f64,
    pub paths: Vec<FlightPath>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathSamplingStep {
    pub arc: u8,
    pub time_utc: String,
    pub input_states: usize,
    pub ring_point_count: usize,
    pub min_speed_kts: Option<f64>,
    pub max_speed_kts: Option<f64>,
    pub speed_feasible_candidates: usize,
    pub output_states: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathSamplingDebug {
    pub steps: Vec<PathSamplingStep>,
}

pub fn sample_candidate_paths(
    satellite: &SatelliteModel,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    sample_candidate_paths_from_dataset(satellite, &dataset, n, &config)
}

pub fn apply_fuel_filter(
    satellite: &SatelliteModel,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<FuelSummary, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    let all_paths = sample_candidate_paths_from_dataset(satellite, &dataset, n, &config)?;
    let filtered_paths: Vec<FlightPath> = all_paths
        .iter()
        .filter(|path| path.fuel_feasible)
        .cloned()
        .collect();

    let low_speed_reference_minutes = filtered_paths
        .iter()
        .map(|path| path.extra_endurance_minutes)
        .fold(0.0_f64, f64::max)
        .min(config.max_post_arc7_minutes);
    let low_speed_reference_range_nm = filtered_paths
        .iter()
        .map(|path| path.extra_range_nm)
        .fold(0.0_f64, f64::max);

    Ok(FuelSummary {
        path_count_before: all_paths.len(),
        path_count_after: filtered_paths.len(),
        low_speed_reference_minutes,
        low_speed_reference_range_nm,
        paths: filtered_paths,
    })
}

pub fn sample_candidate_paths_from_dataset(
    satellite: &SatelliteModel,
    dataset: &Mh370Dataset,
    n: usize,
    config: &AnalysisConfig,
) -> Result<Vec<FlightPath>, String> {
    let calibration = calibrate_bto_offset_from_dataset(satellite, dataset, config)?;
    let path_handshakes: Vec<&super::data::InmarsatHandshake> = path_scoring_handshakes(dataset)
        .into_iter()
        .filter(|handshake| handshake.arc >= 2)
        .collect();
    let last_radar_time_s = parse_time_utc_seconds(LAST_RADAR_TIME_UTC)?;
    let bfo_model = BfoModel::calibrate(satellite, config)?;

    if path_handshakes.len() < 6 {
        return Err("expected at least six path-constraining handshakes in dataset".to_string());
    }

    let mut states = vec![PathState {
        points: vec![LAST_RADAR],
        speeds_kts: Vec::new(),
        headings_deg: Vec::new(),
        log_score: 0.0,
        speed_log_score: 0.0,
        heading_log_score: 0.0,
        northward_log_score: 0.0,
        bfo_log_score: 0.0,
    }];

    let mut current_time_s = last_radar_time_s;
    for handshake in &path_handshakes {
        let ring = build_arc_ring(satellite, handshake, calibration.offset_us, config)?;
        let dt_hours = (ring.time_s - current_time_s) / 3600.0;
        if dt_hours <= 0.0 {
            return Err(format!("non-positive leg duration for {}", ring.time_utc));
        }

        let ring_points = sampled_points(&ring.points, config.ring_sample_step);
        let mut next_states = Vec::new();

        for state in &states {
            let from = *state.points.last().unwrap_or(&LAST_RADAR);
            for [lon, lat] in &ring_points {
                let candidate = LatLon::new(*lat, *lon);
                let leg_distance_km = haversine(from, candidate);
                let speed_kts = leg_distance_km / (dt_hours * KTS_TO_KM_PER_HR);
                if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                    continue;
                }

                let heading_deg = bearing(from, candidate);
                let speed_score = if let Some(previous_speed_kts) = state.speeds_kts.last() {
                    gaussian_score(
                        speed_kts - previous_speed_kts,
                        config.speed_consistency_sigma_kts,
                    )
                } else {
                    1.0
                };
                let heading_score = if let Some(previous_heading_deg) = state.headings_deg.last() {
                    gaussian_score(
                        heading_difference_deg(heading_deg, *previous_heading_deg),
                        config.heading_change_sigma_deg,
                    )
                } else {
                    1.0
                };
                let northward_delta_deg = (candidate.lat - from.lat).max(0.0);
                let northward_score = if config.northward_penalty_weight > 0.0 {
                    gaussian_score(northward_delta_deg, config.northward_leg_sigma_deg.max(0.1))
                } else {
                    1.0
                };
                let bfo_score = score_bfo_handshake(
                    &bfo_model,
                    satellite,
                    handshake,
                    candidate,
                    heading_deg,
                    speed_kts,
                    ring.time_s,
                    config,
                )?;

                let mut next_state = state.clone();
                next_state.points.push(candidate);
                next_state.speeds_kts.push(speed_kts);
                next_state.headings_deg.push(heading_deg);
                let speed_log = speed_score.ln();
                let heading_log = 0.35 * heading_score.ln();
                let northward_log = config.northward_penalty_weight * northward_score.ln();
                let bfo_log = config.bfo_score_weight * bfo_score.ln();
                next_state.speed_log_score += speed_log;
                next_state.heading_log_score += heading_log;
                next_state.northward_log_score += northward_log;
                next_state.bfo_log_score += bfo_log;
                next_state.log_score += speed_log + heading_log + northward_log + bfo_log;
                next_states.push(next_state);
            }
        }

        if next_states.is_empty() {
            return Ok(Vec::new());
        }

        next_states.sort_by(|left, right| right.log_score.partial_cmp(&left.log_score).unwrap());
        next_states.truncate(config.beam_width.max(n.max(1)));
        states = next_states;
        current_time_s = ring.time_s;
    }

    let arc7_handshake = path_handshakes
        .last()
        .ok_or_else(|| "missing arc 7 handshake".to_string())?;
    let arc7_time_s = parse_time_utc_seconds(&arc7_handshake.time_utc)?;
    let arc7_satellite = satellite_subpoint(satellite, arc7_time_s, config)?;
    let arc7_bto = arc7_handshake
        .bto_us
        .ok_or_else(|| "missing BTO for arc 7 handshake".to_string())?;
    let arc7_slant_range_km = bto_to_slant_range_km(arc7_bto, calibration.offset_us);

    let mut paths: Vec<FlightPath> = states
        .into_iter()
        .map(|state| -> Result<FlightPath, String> {
            let initial_heading = state.headings_deg.first().copied().unwrap_or(0.0);
            let total_distance_km = state
                .points
                .windows(2)
                .map(|segment| haversine(segment[0], segment[1]))
                .sum::<f64>();
            let fuel = evaluate_fuel(&state.speeds_kts, total_distance_km, config);
            let arc67_metrics = compute_arc67_metrics(&state, arc7_satellite);
            let family = classify_arc7_family(&state, &arc67_metrics, arc7_slant_range_km, config);
            let bfo_diagnostics =
                build_bfo_diagnostics(&bfo_model, satellite, &path_handshakes, &state, config)?;
            let bfo_summary = summarize_bfo_diagnostics(&bfo_diagnostics);

            Ok(FlightPath {
                points: state
                    .points
                    .iter()
                    .map(|point| [point.lon, point.lat])
                    .collect(),
                score: state.log_score.exp(),
                initial_heading,
                speeds_kts: state.speeds_kts.clone(),
                headings_deg: state.headings_deg.clone(),
                legs: build_leg_diagnostics(&state),
                total_distance_km,
                family,
                arc67_metrics,
                fuel_feasible: fuel.fuel_feasible,
                fuel_remaining_at_arc7_kg: fuel.fuel_remaining_at_arc7_kg,
                extra_endurance_minutes: fuel.extra_endurance_minutes,
                extra_range_nm: fuel.extra_range_nm,
                bfo_summary,
                bfo_diagnostics,
                speed_log_score: state.speed_log_score,
                heading_log_score: state.heading_log_score,
                northward_log_score: state.northward_log_score,
                bfo_log_score: state.bfo_log_score,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    paths.sort_by(|left, right| right.score.partial_cmp(&left.score).unwrap());
    paths.truncate(n.max(1));
    normalize_scores(&mut paths);
    Ok(paths)
}

pub fn debug_path_sampling(
    satellite: &SatelliteModel,
    config: Option<AnalysisConfig>,
) -> Result<PathSamplingDebug, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    let calibration = calibrate_bto_offset_from_dataset(satellite, &dataset, &config)?;
    let path_handshakes: Vec<&super::data::InmarsatHandshake> = path_scoring_handshakes(&dataset)
        .into_iter()
        .filter(|handshake| handshake.arc >= 2)
        .collect();
    let last_radar_time_s = parse_time_utc_seconds(LAST_RADAR_TIME_UTC)?;
    let bfo_model = BfoModel::calibrate(satellite, &config)?;

    if path_handshakes.len() < 6 {
        return Err("expected at least six path-constraining handshakes in dataset".to_string());
    }

    let mut steps = Vec::new();
    let mut states = vec![PathState {
        points: vec![LAST_RADAR],
        speeds_kts: Vec::new(),
        headings_deg: Vec::new(),
        log_score: 0.0,
        speed_log_score: 0.0,
        heading_log_score: 0.0,
        northward_log_score: 0.0,
        bfo_log_score: 0.0,
    }];
    let mut current_time_s = last_radar_time_s;

    for handshake in &path_handshakes {
        let ring = build_arc_ring(satellite, handshake, calibration.offset_us, &config)?;
        let dt_hours = (ring.time_s - current_time_s) / 3600.0;
        if dt_hours <= 0.0 {
            return Err(format!("non-positive leg duration for {}", ring.time_utc));
        }

        let ring_points = sampled_points(&ring.points, config.ring_sample_step);
        let input_states = states.len();
        let mut speed_feasible_candidates = 0;
        let mut min_speed_kts = None;
        let mut max_speed_kts = None;
        let mut next_states = Vec::new();

        for state in &states {
            let from = *state.points.last().unwrap_or(&LAST_RADAR);
            for [lon, lat] in &ring_points {
                let candidate = LatLon::new(*lat, *lon);
                let leg_distance_km = haversine(from, candidate);
                let speed_kts = leg_distance_km / (dt_hours * KTS_TO_KM_PER_HR);
                min_speed_kts =
                    Some(min_speed_kts.map_or(speed_kts, |value: f64| value.min(speed_kts)));
                max_speed_kts =
                    Some(max_speed_kts.map_or(speed_kts, |value: f64| value.max(speed_kts)));
                if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                    continue;
                }
                speed_feasible_candidates += 1;

                let heading_deg = bearing(from, candidate);
                let speed_score = if let Some(previous_speed_kts) = state.speeds_kts.last() {
                    gaussian_score(
                        speed_kts - previous_speed_kts,
                        config.speed_consistency_sigma_kts,
                    )
                } else {
                    1.0
                };
                let heading_score = if let Some(previous_heading_deg) = state.headings_deg.last() {
                    gaussian_score(
                        heading_difference_deg(heading_deg, *previous_heading_deg),
                        config.heading_change_sigma_deg,
                    )
                } else {
                    1.0
                };
                let northward_delta_deg = (candidate.lat - from.lat).max(0.0);
                let northward_score = if config.northward_penalty_weight > 0.0 {
                    gaussian_score(northward_delta_deg, config.northward_leg_sigma_deg.max(0.1))
                } else {
                    1.0
                };
                let bfo_score = score_bfo_handshake(
                    &bfo_model,
                    satellite,
                    handshake,
                    candidate,
                    heading_deg,
                    speed_kts,
                    ring.time_s,
                    &config,
                )?;

                let mut next_state = state.clone();
                next_state.points.push(candidate);
                next_state.speeds_kts.push(speed_kts);
                next_state.headings_deg.push(heading_deg);
                let speed_log = speed_score.ln();
                let heading_log = 0.35 * heading_score.ln();
                let northward_log = config.northward_penalty_weight * northward_score.ln();
                let bfo_log = config.bfo_score_weight * bfo_score.ln();
                next_state.speed_log_score += speed_log;
                next_state.heading_log_score += heading_log;
                next_state.northward_log_score += northward_log;
                next_state.bfo_log_score += bfo_log;
                next_state.log_score += speed_log + heading_log + northward_log + bfo_log;
                next_states.push(next_state);
            }
        }

        next_states.sort_by(|left, right| right.log_score.partial_cmp(&left.log_score).unwrap());
        next_states.truncate(config.beam_width.max(1));
        steps.push(PathSamplingStep {
            arc: handshake.arc,
            time_utc: ring.time_utc.clone(),
            input_states,
            ring_point_count: ring_points.len(),
            min_speed_kts,
            max_speed_kts,
            speed_feasible_candidates,
            output_states: next_states.len(),
        });

        if next_states.is_empty() {
            break;
        }

        states = next_states;
        current_time_s = ring.time_s;
    }

    Ok(PathSamplingDebug { steps })
}

#[derive(Debug, Clone, Copy)]
struct FuelEvaluation {
    fuel_feasible: bool,
    fuel_remaining_at_arc7_kg: f64,
    extra_endurance_minutes: f64,
    extra_range_nm: f64,
}

fn evaluate_fuel(
    speeds_kts: &[f64],
    total_distance_km: f64,
    config: &AnalysisConfig,
) -> FuelEvaluation {
    use super::performance::fuel_flow;

    let average_speed_kts = if speeds_kts.is_empty() {
        config.fuel_baseline_speed_kts
    } else {
        speeds_kts.iter().sum::<f64>() / speeds_kts.len() as f64
    };
    let average_speed_km_hr = average_speed_kts * KTS_TO_KM_PER_HR;
    let flight_hours = if average_speed_km_hr > 0.0 {
        total_distance_km / average_speed_km_hr
    } else {
        0.0
    };

    let speed_factor =
        (average_speed_kts / config.fuel_baseline_speed_kts).powf(config.fuel_speed_exponent);
    let altitude_delta_10kft =
        (config.fuel_baseline_altitude_ft - config.cruise_altitude_ft) / 10_000.0;
    let altitude_factor =
        1.0 + altitude_delta_10kft.max(0.0) * config.fuel_low_altitude_penalty_per_10kft;

    // Weight-corrected fuel burn: as the aircraft burns fuel, it gets lighter,
    // and the fuel flow rate decreases. We integrate this using N steps to
    // approximate the continuous weight reduction.
    //
    // Validated against ATSB data: Boeing 777-200ER burns 33,500 kg over
    // ~5.875 hours = 5,702 kg/hr average, NOT the 6,500 kg/hr initial rate.
    // Source: Boeing Performance Analysis, Appendix 1.6E.
    //
    // Weight-sensitivity coefficient: fuel flow decreases ~0.045 kg/hr per kg
    // of weight reduction, derived from Boeing reference points:
    //   6,500 kg/hr at 207,000 kg → 5,000 kg/hr at 174,000 kg.
    let initial_weight_kg = config.fuel_remaining_at_arc1_kg + super::performance::airframe::ZFW_KG;
    let nominal_burn_rate = config.fuel_baseline_kg_per_hr * speed_factor * altitude_factor;

    // Integrate fuel burn over N steps, adjusting for weight reduction each step.
    const N_STEPS: usize = 20;
    let dt = flight_hours / N_STEPS as f64;
    let mut fuel_remaining = config.fuel_remaining_at_arc1_kg;
    let mut current_weight = initial_weight_kg;

    for _ in 0..N_STEPS {
        // Scale burn rate by current weight relative to the reference weight.
        // At reference weight, weight_correction = 1.0.
        // As weight drops, burn rate drops proportionally.
        let weight_correction = 1.0
            - fuel_flow::WEIGHT_SENSITIVITY_KG_HR_PER_KG
                * (fuel_flow::WEIGHT_SENSITIVITY_REF_KG - current_weight)
                / fuel_flow::WEIGHT_SENSITIVITY_REF_FLOW_KG_HR;
        let step_burn_rate = nominal_burn_rate * weight_correction.max(0.5);
        let fuel_burned = step_burn_rate * dt;
        fuel_remaining -= fuel_burned;
        current_weight -= fuel_burned;
    }

    let fuel_remaining_at_arc7_kg = fuel_remaining;
    let fuel_feasible = fuel_remaining_at_arc7_kg >= 0.0;

    // Post-Arc 7: use the lighter weight for the low-speed burn rate
    let low_speed_nominal = config.fuel_baseline_kg_per_hr
        * (config.post_arc7_low_speed_kts / config.fuel_baseline_speed_kts)
            .powf(config.fuel_speed_exponent)
        * altitude_factor;
    let weight_at_arc7 = super::performance::airframe::ZFW_KG + fuel_remaining_at_arc7_kg.max(0.0);
    let low_weight_correction = 1.0
        - fuel_flow::WEIGHT_SENSITIVITY_KG_HR_PER_KG
            * (fuel_flow::WEIGHT_SENSITIVITY_REF_KG - weight_at_arc7)
            / fuel_flow::WEIGHT_SENSITIVITY_REF_FLOW_KG_HR;
    let low_speed_burn_rate = low_speed_nominal * low_weight_correction.max(0.5);

    let extra_endurance_minutes = if fuel_remaining_at_arc7_kg > 0.0 && low_speed_burn_rate > 0.0 {
        (fuel_remaining_at_arc7_kg / low_speed_burn_rate * 60.0).min(config.max_post_arc7_minutes)
    } else {
        0.0
    };
    let extra_range_nm = extra_endurance_minutes / 60.0 * config.post_arc7_low_speed_kts;

    FuelEvaluation {
        fuel_feasible,
        fuel_remaining_at_arc7_kg,
        extra_endurance_minutes,
        extra_range_nm,
    }
}

fn classify_arc7_family(
    state: &PathState,
    metrics: &Arc67Metrics,
    arc7_slant_range_km: f64,
    config: &AnalysisConfig,
) -> String {
    let Some(last_speed_kts) = state.speeds_kts.last().copied() else {
        return "unknown".to_string();
    };

    let relative_angle = metrics.heading_relative_to_satellite_deg;
    let expected_bto_change_km = metrics.expected_bto_change_km_in_8_5_min;
    let bto_stability_ratio = if arc7_slant_range_km > 0.0 {
        expected_bto_change_km / arc7_slant_range_km
    } else {
        0.0
    };

    if last_speed_kts <= config.slow_family_max_speed_kts {
        "slow".to_string()
    } else if (relative_angle - 90.0).abs() <= config.perpendicular_family_tolerance_deg {
        "perpendicular".to_string()
    } else if bto_stability_ratio <= 0.003 {
        "mixed".to_string()
    } else {
        "other".to_string()
    }
}

fn build_leg_diagnostics(state: &PathState) -> Vec<LegDiagnostic> {
    state
        .points
        .windows(2)
        .enumerate()
        .map(|(index, segment)| {
            let distance_km = haversine(segment[0], segment[1]);
            let speed_kts = state.speeds_kts.get(index).copied().unwrap_or_default();
            let heading_deg = state.headings_deg.get(index).copied().unwrap_or_default();
            let speed_residual_kts = if index == 0 {
                0.0
            } else {
                speed_kts
                    - state
                        .speeds_kts
                        .get(index - 1)
                        .copied()
                        .unwrap_or(speed_kts)
            };
            let heading_change_deg = if index == 0 {
                0.0
            } else {
                heading_difference_deg(
                    heading_deg,
                    state
                        .headings_deg
                        .get(index - 1)
                        .copied()
                        .unwrap_or(heading_deg),
                )
            };

            LegDiagnostic {
                from: [segment[0].lon, segment[0].lat],
                to: [segment[1].lon, segment[1].lat],
                distance_km,
                speed_kts,
                heading_deg,
                speed_residual_kts,
                heading_change_deg,
            }
        })
        .collect()
}

fn compute_arc67_metrics(state: &PathState, satellite: LatLon) -> Arc67Metrics {
    let last_speed_kts = state.speeds_kts.last().copied().unwrap_or_default();
    let last_heading_deg = state.headings_deg.last().copied().unwrap_or_default();
    let arc7_point = state.points.last().copied().unwrap_or(LAST_RADAR);
    let bearing_to_satellite_deg = bearing(arc7_point, satellite);
    let heading_relative_to_satellite_deg =
        heading_difference_deg(last_heading_deg, bearing_to_satellite_deg);
    let effective_radial_speed_kts =
        last_speed_kts * heading_relative_to_satellite_deg.to_radians().cos().abs();
    let expected_bto_change_km_in_8_5_min =
        effective_radial_speed_kts * KTS_TO_KM_PER_HR * (8.5 / 60.0);
    let expected_bto_change_us_in_8_5_min =
        expected_bto_change_km_in_8_5_min * 2.0 / 299_792.458 * 1_000_000.0;

    Arc67Metrics {
        bearing_to_satellite_deg,
        heading_relative_to_satellite_deg,
        effective_radial_speed_kts,
        expected_bto_change_km_in_8_5_min,
        expected_bto_change_us_in_8_5_min,
    }
}

fn score_bfo_handshake(
    model: &BfoModel,
    satellite: &SatelliteModel,
    handshake: &super::data::InmarsatHandshake,
    pos: LatLon,
    heading_deg: f64,
    speed_kts: f64,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<f64, String> {
    let Some(measured_bfo) = handshake.bfo_hz else {
        return Ok(1.0);
    };

    let reliability_weight = bfo_reliability_weight(handshake);
    if reliability_weight <= 0.0 {
        return Ok(1.0);
    }

    let vertical_speed_fpm = vertical_speed_for_handshake(handshake.arc, config);
    let residual = model
        .residual(
            satellite,
            pos,
            heading_deg,
            speed_kts,
            time_s,
            measured_bfo,
            config,
            vertical_speed_fpm,
        )?
        .abs();
    Ok(gaussian_score(residual, config.bfo_sigma_hz).powf(reliability_weight))
}

fn vertical_speed_for_handshake(arc: u8, config: &AnalysisConfig) -> f64 {
    if arc == 7 {
        config.arc7_vertical_speed_fpm
    } else {
        0.0
    }
}

fn bfo_reliability_weight(handshake: &super::data::InmarsatHandshake) -> f64 {
    match handshake.reliability.as_deref() {
        Some("GOOD") => 1.0,
        Some("GOOD_BTO_UNCERTAIN_BFO") => 0.35,
        _ => 0.0,
    }
}

fn build_bfo_diagnostics(
    model: &BfoModel,
    satellite: &SatelliteModel,
    handshakes: &[&super::data::InmarsatHandshake],
    state: &PathState,
    config: &AnalysisConfig,
) -> Result<Vec<BfoDiagnostic>, String> {
    handshakes
        .iter()
        .zip(state.points.iter().skip(1))
        .zip(state.headings_deg.iter())
        .zip(state.speeds_kts.iter())
        .map(|(((handshake, pos), heading_deg), speed_kts)| {
            let reliability = handshake.reliability.clone();
            let reliability_weight = bfo_reliability_weight(handshake);
            let used_in_score = reliability_weight > 0.0 && handshake.bfo_hz.is_some();
            let skip_reason = if handshake.bfo_hz.is_none() {
                Some("No measured BFO".to_string())
            } else if !used_in_score {
                Some(match handshake.reliability.as_deref() {
                    Some(reliability) => format!("Excluded by reliability: {reliability}"),
                    None => "Excluded by reliability: unknown".to_string(),
                })
            } else {
                None
            };
            let time_s = parse_time_utc_seconds(&handshake.time_utc)?;
            let vertical_speed_fpm = vertical_speed_for_handshake(handshake.arc, config);
            let predicted_bfo_hz = if handshake.bfo_hz.is_some() {
                Some(model.predict(
                    satellite,
                    *pos,
                    *heading_deg,
                    *speed_kts,
                    time_s,
                    config,
                    vertical_speed_fpm,
                )?)
            } else {
                None
            };
            let residual_hz = match (predicted_bfo_hz, handshake.bfo_hz) {
                (Some(predicted), Some(measured)) => Some(predicted - measured),
                _ => None,
            };

            Ok(BfoDiagnostic {
                arc: handshake.arc,
                time_utc: handshake.time_utc.clone(),
                measured_bfo_hz: handshake.bfo_hz,
                predicted_bfo_hz,
                residual_hz,
                reliability,
                used_in_score,
                skip_reason,
            })
        })
        .collect()
}

fn summarize_bfo_diagnostics(diagnostics: &[BfoDiagnostic]) -> BfoSummary {
    let used_residuals: Vec<f64> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.used_in_score)
        .filter_map(|diagnostic| diagnostic.residual_hz.map(f64::abs))
        .collect();

    let mean_abs_residual_hz = if used_residuals.is_empty() {
        None
    } else {
        Some(used_residuals.iter().sum::<f64>() / used_residuals.len() as f64)
    };
    let max_abs_residual_hz = used_residuals.iter().copied().reduce(f64::max);

    BfoSummary {
        used_count: used_residuals.len(),
        total_count: diagnostics.len(),
        mean_abs_residual_hz,
        max_abs_residual_hz,
    }
}

fn sampled_points(points: &[[f64; 2]], sample_step: usize) -> Vec<[f64; 2]> {
    let step = sample_step.max(1);
    let mut sampled: Vec<[f64; 2]> = points.iter().step_by(step).copied().collect();
    if let Some(last) = points.last() {
        if sampled.last().copied() != Some(*last) {
            sampled.push(*last);
        }
    }
    sampled
}

fn gaussian_score(value: f64, sigma: f64) -> f64 {
    if sigma <= 0.0 {
        return 1.0;
    }
    (-value.powi(2) / (2.0 * sigma.powi(2))).exp().max(1e-12)
}

fn heading_difference_deg(left: f64, right: f64) -> f64 {
    ((left - right + 180.0).rem_euclid(360.0) - 180.0).abs()
}

fn normalize_scores(paths: &mut [FlightPath]) {
    let Some(max_score) = paths.iter().map(|path| path.score).reduce(f64::max) else {
        return;
    };
    let Some(min_score) = paths.iter().map(|path| path.score).reduce(f64::min) else {
        return;
    };
    let range = max_score - min_score;
    if range <= f64::EPSILON {
        for path in paths {
            path.score = 1.0;
        }
        return;
    }
    for path in paths {
        path.score = (path.score - min_score) / range;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mh370::data::InmarsatHandshake;

    fn test_satellite() -> SatelliteModel {
        SatelliteModel::load().unwrap()
    }

    #[test]
    fn default_sampler_produces_candidate_paths() {
        let satellite = test_satellite();
        let paths =
            sample_candidate_paths(&satellite, 10, Some(AnalysisConfig::default())).unwrap();

        assert!(!paths.is_empty());
        assert!(paths[0].bfo_summary.total_count > 0);
    }

    fn base_state(speed_kts: f64, heading_deg: f64, arc7_point: LatLon) -> PathState {
        PathState {
            points: vec![LAST_RADAR, arc7_point],
            speeds_kts: vec![speed_kts],
            headings_deg: vec![heading_deg],
            log_score: 0.0,
            speed_log_score: 0.0,
            heading_log_score: 0.0,
            northward_log_score: 0.0,
            bfo_log_score: 0.0,
        }
    }

    #[test]
    fn classifies_slow_arc67_family() {
        let config = AnalysisConfig::default();
        let satellite = LatLon::new(-1.6, 64.5);
        let state = base_state(370.0, 180.0, LatLon::new(-35.0, 93.0));
        let metrics = compute_arc67_metrics(&state, satellite);

        let family = classify_arc7_family(&state, &metrics, 6_000.0, &config);
        assert_eq!(family, "slow");
    }

    #[test]
    fn classifies_perpendicular_arc67_family() {
        let config = AnalysisConfig::default();
        let satellite = LatLon::new(-1.6, 64.5);
        let arc7_point = LatLon::new(-35.0, 93.0);
        let bearing_to_satellite = bearing(arc7_point, satellite);
        let state = base_state(470.0, (bearing_to_satellite + 90.0) % 360.0, arc7_point);
        let metrics = compute_arc67_metrics(&state, satellite);

        let family = classify_arc7_family(&state, &metrics, 6_000.0, &config);
        assert_eq!(family, "perpendicular");
        assert!(metrics.expected_bto_change_us_in_8_5_min < 20.0);
    }

    #[test]
    fn fuel_model_allows_remaining_endurance_after_arc7() {
        let config = AnalysisConfig::default();
        let speeds = vec![420.0; 6];
        let fuel = evaluate_fuel(&speeds, 3_600.0, &config);

        assert!(fuel.fuel_feasible);
        assert!(fuel.fuel_remaining_at_arc7_kg > 0.0);
        assert!(fuel.extra_endurance_minutes > 0.0);
        assert!(fuel.extra_endurance_minutes <= config.max_post_arc7_minutes);
        assert!(fuel.extra_range_nm > 0.0);
    }

    #[test]
    fn fuel_model_matches_atsb_validated_average() {
        // ATSB-validated: 33,500 kg burned over ~5.875 hours at LRC (~471 kts).
        // The weight-corrected model should produce a flight-average burn rate
        // close to the ATSB value of ~5,702 kg/hr.
        // Source: Boeing Performance Analysis, Appendix 1.6E.
        let mut config = AnalysisConfig::default();
        config.fuel_remaining_at_arc1_kg = 33_500.0; // Boeing estimate
        let speeds = vec![471.0; 6]; // LRC speed
        let distance_km = 471.0 * KTS_TO_KM_PER_HR * 5.875; // ~5,120 km
        let fuel = evaluate_fuel(&speeds, distance_km, &config);

        // Should be close to feasible (within ±2,000 kg of zero)
        assert!(
            fuel.fuel_remaining_at_arc7_kg.abs() < 2_000.0,
            "fuel remaining {} should be close to zero for ATSB-validated path",
            fuel.fuel_remaining_at_arc7_kg,
        );

        // Effective average burn rate should be close to 5,702 kg/hr
        let fuel_used = config.fuel_remaining_at_arc1_kg - fuel.fuel_remaining_at_arc7_kg;
        let effective_avg = fuel_used / 5.875;
        assert!(
            (effective_avg - 5_702.0).abs() < 500.0,
            "effective average {} should be near ATSB 5,702 kg/hr",
            effective_avg,
        );
    }

    #[test]
    fn fuel_feasible_at_moderate_speed_and_distance() {
        // A path at 460 kts covering 5,000 km should be fuel-feasible
        // with the updated default of 34,500 kg starting fuel.
        let config = AnalysisConfig::default();
        let speeds = vec![460.0; 6];
        let fuel = evaluate_fuel(&speeds, 5_000.0, &config);

        assert!(
            fuel.fuel_feasible,
            "460 kts / 5000 km path should be feasible with 34,500 kg, got {} kg remaining",
            fuel.fuel_remaining_at_arc7_kg,
        );
    }

    #[test]
    fn bfo_scoring_downweights_uncertain_handshakes() {
        let config = AnalysisConfig::default();
        let satellite = test_satellite();
        let model = BfoModel::calibrate(&satellite, &config).unwrap();
        let good = InmarsatHandshake {
            arc: 2,
            time_utc: "19:41:02.906".to_string(),
            bto_us: Some(14_060.0),
            bfo_hz: Some(182.0),
            message_type: "Hourly handshake".to_string(),
            note: None,
            position_known: false,
            lat: None,
            lon: None,
            reliability: Some("GOOD".to_string()),
            flag: None,
        };
        let uncertain = InmarsatHandshake {
            reliability: Some("GOOD_BTO_UNCERTAIN_BFO".to_string()),
            ..good.clone()
        };

        let weighted = score_bfo_handshake(
            &model,
            &satellite,
            &good,
            LatLon::new(-35.0, 93.0),
            180.0,
            470.0,
            parse_time_utc_seconds("19:41:02.906").unwrap(),
            &config,
        )
        .unwrap();
        let uncertain_score = score_bfo_handshake(
            &model,
            &satellite,
            &uncertain,
            LatLon::new(-35.0, 93.0),
            180.0,
            470.0,
            parse_time_utc_seconds("19:41:02.906").unwrap(),
            &config,
        )
        .unwrap();

        assert!(weighted < 1.0);
        assert!(uncertain_score < 1.0);
        assert!(uncertain_score > weighted);
    }

    #[test]
    fn bfo_diagnostics_capture_used_and_skipped_handshakes() {
        let config = AnalysisConfig::default();
        let satellite = test_satellite();
        let model = BfoModel::calibrate(&satellite, &config).unwrap();
        let handshakes = vec![
            InmarsatHandshake {
                arc: 2,
                time_utc: "19:41:02.906".to_string(),
                bto_us: Some(14_060.0),
                bfo_hz: Some(182.0),
                message_type: "Hourly handshake".to_string(),
                note: None,
                position_known: false,
                lat: None,
                lon: None,
                reliability: Some("GOOD".to_string()),
                flag: None,
            },
            InmarsatHandshake {
                arc: 3,
                time_utc: "20:41:05.000".to_string(),
                bto_us: Some(14_400.0),
                bfo_hz: Some(170.0),
                message_type: "Hourly handshake".to_string(),
                note: None,
                position_known: false,
                lat: None,
                lon: None,
                reliability: Some("UNRELIABLE_BFO".to_string()),
                flag: None,
            },
        ];
        let state = PathState {
            points: vec![
                LAST_RADAR,
                LatLon::new(-30.0, 94.0),
                LatLon::new(-35.0, 93.0),
            ],
            speeds_kts: vec![470.0, 465.0],
            headings_deg: vec![190.0, 185.0],
            log_score: 0.0,
            speed_log_score: 0.0,
            heading_log_score: 0.0,
            northward_log_score: 0.0,
            bfo_log_score: 0.0,
        };

        let handshake_refs: Vec<&InmarsatHandshake> = handshakes.iter().collect();
        let diagnostics =
            build_bfo_diagnostics(&model, &satellite, &handshake_refs, &state, &config).unwrap();
        let summary = summarize_bfo_diagnostics(&diagnostics);

        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].used_in_score);
        assert!(diagnostics[0].predicted_bfo_hz.is_some());
        assert!(diagnostics[0].residual_hz.is_some());
        assert_eq!(diagnostics[0].skip_reason, None);

        assert!(!diagnostics[1].used_in_score);
        assert_eq!(
            diagnostics[1].skip_reason.as_deref(),
            Some("Excluded by reliability: UNRELIABLE_BFO")
        );

        assert_eq!(summary.used_count, 1);
        assert_eq!(summary.total_count, 2);
        assert!(summary.mean_abs_residual_hz.is_some());
        assert!(summary.max_abs_residual_hz.is_some());
    }

    #[test]
    fn applies_vertical_speed_only_to_arc7() {
        let mut config = AnalysisConfig::default();
        config.arc7_vertical_speed_fpm = 2_000.0;

        assert_eq!(vertical_speed_for_handshake(6, &config), 0.0);
        assert_eq!(vertical_speed_for_handshake(7, &config), 2_000.0);
    }
}
