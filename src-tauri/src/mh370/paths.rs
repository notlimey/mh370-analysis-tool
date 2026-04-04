use serde::Serialize;

use super::arcs::{
    bto_to_slant_range_km, build_arc_ring, calibrate_bto_offset_from_dataset,
};
use super::data::{
    load_dataset, parse_time_utc_seconds, primary_arc_handshakes, resolve_config, AnalysisConfig,
    Mh370Dataset,
};
use super::geometry::{bearing, haversine, LatLon};
use super::satellite::satellite_subpoint;

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

pub fn sample_candidate_paths(
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<Vec<FlightPath>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    sample_candidate_paths_from_dataset(&dataset, n, &config)
}

pub fn apply_fuel_filter(
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<FuelSummary, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    let all_paths = sample_candidate_paths_from_dataset(&dataset, n, &config)?;
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
    dataset: &Mh370Dataset,
    n: usize,
    config: &AnalysisConfig,
) -> Result<Vec<FlightPath>, String> {
    let calibration = calibrate_bto_offset_from_dataset(dataset, config)?;
    let primary_handshakes = primary_arc_handshakes(dataset);
    let last_radar_time_s = parse_time_utc_seconds(LAST_RADAR_TIME_UTC)?;

    if primary_handshakes.len() < 7 {
        return Err("expected seven primary BTO arcs in dataset".to_string());
    }

    let mut states = vec![PathState {
        points: vec![LAST_RADAR],
        speeds_kts: Vec::new(),
        headings_deg: Vec::new(),
        log_score: 0.0,
    }];

    let mut current_time_s = last_radar_time_s;
    for handshake in &primary_handshakes {
        let ring = build_arc_ring(handshake, calibration.offset_us, config)?;
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

                let mut next_state = state.clone();
                next_state.points.push(candidate);
                next_state.speeds_kts.push(speed_kts);
                next_state.headings_deg.push(heading_deg);
                next_state.log_score += speed_score.ln() + 0.35 * heading_score.ln();
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

    let arc7_handshake = primary_handshakes
        .last()
        .ok_or_else(|| "missing arc 7 handshake".to_string())?;
    let arc7_time_s = parse_time_utc_seconds(&arc7_handshake.time_utc)?;
    let arc7_satellite = satellite_subpoint(arc7_time_s, config)?;
    let arc7_bto = arc7_handshake
        .bto_us
        .ok_or_else(|| "missing BTO for arc 7 handshake".to_string())?;
    let arc7_slant_range_km = bto_to_slant_range_km(arc7_bto, calibration.offset_us);

    let mut paths: Vec<FlightPath> = states
        .into_iter()
        .map(|state| {
            let initial_heading = state.headings_deg.first().copied().unwrap_or(0.0);
            let total_distance_km = state
                .points
                .windows(2)
                .map(|segment| haversine(segment[0], segment[1]))
                .sum::<f64>();
            let fuel = evaluate_fuel(&state.speeds_kts, total_distance_km, config);
            let arc67_metrics = compute_arc67_metrics(&state, arc7_satellite);
            let family = classify_arc7_family(&state, &arc67_metrics, arc7_slant_range_km, config);

            FlightPath {
                points: state.points.iter().map(|point| [point.lon, point.lat]).collect(),
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
            }
        })
        .collect();

    paths.sort_by(|left, right| right.score.partial_cmp(&left.score).unwrap());
    paths.truncate(n.max(1));
    normalize_scores(&mut paths);
    Ok(paths)
}

#[derive(Debug, Clone, Copy)]
struct FuelEvaluation {
    fuel_feasible: bool,
    fuel_remaining_at_arc7_kg: f64,
    extra_endurance_minutes: f64,
    extra_range_nm: f64,
}

fn evaluate_fuel(speeds_kts: &[f64], total_distance_km: f64, config: &AnalysisConfig) -> FuelEvaluation {
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

    let speed_factor = (average_speed_kts / config.fuel_baseline_speed_kts).powf(config.fuel_speed_exponent);
    let altitude_delta_10kft = (config.fuel_baseline_altitude_ft - config.cruise_altitude_ft) / 10_000.0;
    let altitude_factor = 1.0 + altitude_delta_10kft.max(0.0) * config.fuel_low_altitude_penalty_per_10kft;
    let fuel_burn_rate = config.fuel_baseline_kg_per_hr * speed_factor * altitude_factor;
    let fuel_used = flight_hours * fuel_burn_rate;
    let fuel_remaining_at_arc7_kg = config.fuel_remaining_at_arc1_kg - fuel_used;
    let fuel_feasible = fuel_remaining_at_arc7_kg >= 0.0;

    let low_speed_burn_rate = config.fuel_baseline_kg_per_hr
        * (config.post_arc7_low_speed_kts / config.fuel_baseline_speed_kts)
            .powf(config.fuel_speed_exponent)
        * altitude_factor;
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
                speed_kts - state.speeds_kts.get(index - 1).copied().unwrap_or(speed_kts)
            };
            let heading_change_deg = if index == 0 {
                0.0
            } else {
                heading_difference_deg(
                    heading_deg,
                    state.headings_deg.get(index - 1).copied().unwrap_or(heading_deg),
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
    let heading_relative_to_satellite_deg = heading_difference_deg(last_heading_deg, bearing_to_satellite_deg);
    let effective_radial_speed_kts = last_speed_kts * heading_relative_to_satellite_deg.to_radians().cos().abs();
    let expected_bto_change_km_in_8_5_min = effective_radial_speed_kts * KTS_TO_KM_PER_HR * (8.5 / 60.0);
    let expected_bto_change_us_in_8_5_min = expected_bto_change_km_in_8_5_min * 2.0 / 299_792.458 * 1_000_000.0;

    Arc67Metrics {
        bearing_to_satellite_deg,
        heading_relative_to_satellite_deg,
        effective_radial_speed_kts,
        expected_bto_change_km_in_8_5_min,
        expected_bto_change_us_in_8_5_min,
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

    fn base_state(speed_kts: f64, heading_deg: f64, arc7_point: LatLon) -> PathState {
        PathState {
            points: vec![LAST_RADAR, arc7_point],
            speeds_kts: vec![speed_kts],
            headings_deg: vec![heading_deg],
            log_score: 0.0,
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
}
