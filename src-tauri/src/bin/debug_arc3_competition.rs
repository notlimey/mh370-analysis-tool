use mh370_lib::mh370::arcs::{build_arc_ring, calibrate_bto_offset_from_dataset};
use mh370_lib::mh370::bfo::BfoModel;
use mh370_lib::mh370::data::{
    load_dataset, parse_time_utc_seconds, path_scoring_handshakes, resolve_config,
};
use mh370_lib::mh370::geometry::{bearing, haversine, LatLon};
use mh370_lib::mh370::satellite::SatelliteModel;

const KTS_TO_KM_PER_HR: f64 = 1.852;
const LAST_RADAR: LatLon = LatLon {
    lat: 6.8,
    lon: 97.7,
};
const LAST_RADAR_TIME_UTC: &str = "18:22:00";

#[derive(Clone)]
struct PathState {
    points: Vec<LatLon>,
    speeds_kts: Vec<f64>,
    headings_deg: Vec<f64>,
    log_score: f64,
}

#[derive(Clone)]
struct CandidateBreakdown {
    lat: f64,
    lon: f64,
    speed_kts: f64,
    heading_deg: f64,
    speed_log: f64,
    heading_log: f64,
    bfo_log: f64,
    total_log: f64,
    bfo_residual_hz: Option<f64>,
}

fn heading_difference_deg(a: f64, b: f64) -> f64 {
    let mut diff = (a - b).abs() % 360.0;
    if diff > 180.0 {
        diff = 360.0 - diff;
    }
    diff
}

fn gaussian_score(value: f64, sigma: f64) -> f64 {
    (-value.powi(2) / (2.0 * sigma.powi(2))).exp().max(1e-12)
}

fn bfo_reliability_weight(reliability: Option<&str>) -> f64 {
    match reliability {
        Some("GOOD") => 1.0,
        Some("GOOD_BTO_UNCERTAIN_BFO") => 0.35,
        _ => 0.0,
    }
}

fn main() -> Result<(), String> {
    let config = resolve_config(None);
    let dataset = load_dataset(&config)?;
    let satellite = SatelliteModel::load()?;
    let calibration = calibrate_bto_offset_from_dataset(&satellite, &dataset, &config)?;
    let handshakes = path_scoring_handshakes(&dataset)
        .into_iter()
        .filter(|handshake| handshake.arc >= 2)
        .collect::<Vec<_>>();
    let bfo_model = BfoModel::calibrate(&satellite, &config)?;

    let mut states = vec![PathState {
        points: vec![LAST_RADAR],
        speeds_kts: Vec::new(),
        headings_deg: Vec::new(),
        log_score: 0.0,
    }];
    let mut current_time_s = parse_time_utc_seconds(LAST_RADAR_TIME_UTC)?;

    let arc2 = handshakes
        .first()
        .ok_or_else(|| "missing arc 2 handshake".to_string())?;
    let arc2_ring = build_arc_ring(&satellite, arc2, calibration.offset_us, &config)?;
    let arc2_dt_hours = (arc2_ring.time_s - current_time_s) / 3600.0;
    let mut arc2_states = Vec::new();
    for state in &states {
        let from = *state.points.last().unwrap_or(&LAST_RADAR);
        for [lon, lat] in &arc2_ring.points {
            let candidate = LatLon::new(*lat, *lon);
            let leg_distance_km = haversine(from, candidate);
            let speed_kts = leg_distance_km / (arc2_dt_hours * KTS_TO_KM_PER_HR);
            if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                continue;
            }
            let heading_deg = bearing(from, candidate);
            let mut next_state = state.clone();
            next_state.points.push(candidate);
            next_state.speeds_kts.push(speed_kts);
            next_state.headings_deg.push(heading_deg);
            if let Some(measured_bfo) = arc2.bfo_hz {
                let weight = bfo_reliability_weight(arc2.reliability.as_deref());
                if weight > 0.0 {
                    let residual = bfo_model
                        .residual(
                            &satellite,
                            candidate,
                            heading_deg,
                            speed_kts,
                            arc2_ring.time_s,
                            measured_bfo,
                            &config,
                            0.0,
                        )?
                        .abs();
                    next_state.log_score += config.bfo_score_weight
                        * gaussian_score(residual, config.bfo_sigma_hz)
                            .powf(weight)
                            .ln();
                }
            }
            arc2_states.push(next_state);
        }
    }
    arc2_states.sort_by(|left, right| right.log_score.partial_cmp(&left.log_score).unwrap());
    arc2_states.truncate(config.beam_width.max(1));
    current_time_s = arc2_ring.time_s;
    states = arc2_states;

    let arc3 = handshakes
        .get(1)
        .ok_or_else(|| "missing arc 3 handshake".to_string())?;
    let arc3_ring = build_arc_ring(&satellite, arc3, calibration.offset_us, &config)?;
    let arc3_dt_hours = (arc3_ring.time_s - current_time_s) / 3600.0;

    let mut north_candidates = Vec::new();
    let mut south_candidates = Vec::new();

    for state in &states {
        let from = *state.points.last().unwrap_or(&LAST_RADAR);
        for [lon, lat] in &arc3_ring.points {
            let candidate = LatLon::new(*lat, *lon);
            let leg_distance_km = haversine(from, candidate);
            let speed_kts = leg_distance_km / (arc3_dt_hours * KTS_TO_KM_PER_HR);
            if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                continue;
            }

            let heading_deg = bearing(from, candidate);
            let speed_log = if let Some(previous_speed_kts) = state.speeds_kts.last() {
                gaussian_score(
                    speed_kts - previous_speed_kts,
                    config.speed_consistency_sigma_kts,
                )
                .ln()
            } else {
                0.0
            };
            let heading_log = if let Some(previous_heading_deg) = state.headings_deg.last() {
                0.35 * gaussian_score(
                    heading_difference_deg(heading_deg, *previous_heading_deg),
                    config.heading_change_sigma_deg,
                )
                .ln()
            } else {
                0.0
            };

            let mut bfo_log = 0.0;
            let mut bfo_residual_hz = None;
            if let Some(measured_bfo) = arc3.bfo_hz {
                let weight = bfo_reliability_weight(arc3.reliability.as_deref());
                if weight > 0.0 {
                    let residual = bfo_model.residual(
                        &satellite,
                        candidate,
                        heading_deg,
                        speed_kts,
                        arc3_ring.time_s,
                        measured_bfo,
                        &config,
                        0.0,
                    )?;
                    bfo_residual_hz = Some(residual);
                    bfo_log = config.bfo_score_weight
                        * gaussian_score(residual.abs(), config.bfo_sigma_hz)
                            .powf(weight)
                            .ln();
                }
            }

            let total_log = state.log_score + speed_log + heading_log + bfo_log;
            let breakdown = CandidateBreakdown {
                lat: candidate.lat,
                lon: candidate.lon,
                speed_kts,
                heading_deg,
                speed_log,
                heading_log,
                bfo_log,
                total_log,
                bfo_residual_hz,
            };

            if candidate.lat >= 0.0 {
                north_candidates.push(breakdown);
            } else {
                south_candidates.push(breakdown);
            }
        }
    }

    north_candidates.sort_by(|left, right| right.total_log.partial_cmp(&left.total_log).unwrap());
    south_candidates.sort_by(|left, right| right.total_log.partial_cmp(&left.total_log).unwrap());

    println!("top north arc3 candidates");
    println!(
        "lat,lon,speed_kts,heading_deg,speed_log,heading_log,bfo_log,total_log,bfo_residual_hz"
    );
    for candidate in north_candidates.iter().take(10) {
        println!(
            "{:.3},{:.3},{:.1},{:.1},{:.3},{:.3},{:.3},{:.3},{:.1}",
            candidate.lat,
            candidate.lon,
            candidate.speed_kts,
            candidate.heading_deg,
            candidate.speed_log,
            candidate.heading_log,
            candidate.bfo_log,
            candidate.total_log,
            candidate.bfo_residual_hz.unwrap_or(f64::NAN),
        );
    }

    println!("top south arc3 candidates");
    println!(
        "lat,lon,speed_kts,heading_deg,speed_log,heading_log,bfo_log,total_log,bfo_residual_hz"
    );
    for candidate in south_candidates.iter().take(10) {
        println!(
            "{:.3},{:.3},{:.1},{:.1},{:.3},{:.3},{:.3},{:.3},{:.1}",
            candidate.lat,
            candidate.lon,
            candidate.speed_kts,
            candidate.heading_deg,
            candidate.speed_log,
            candidate.heading_log,
            candidate.bfo_log,
            candidate.total_log,
            candidate.bfo_residual_hz.unwrap_or(f64::NAN),
        );
    }

    Ok(())
}
