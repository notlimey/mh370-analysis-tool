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

    println!("arc,time,input_states,feasible_candidates,surviving_states,north_survivors,south_survivors,best_lat,best_lon,best_score");

    for handshake in &handshakes {
        let ring = build_arc_ring(&satellite, handshake, calibration.offset_us, &config)?;
        let dt_hours = (ring.time_s - current_time_s) / 3600.0;
        let mut next_states = Vec::new();
        let mut feasible_candidates = 0usize;

        for state in &states {
            let from = *state.points.last().unwrap_or(&LAST_RADAR);
            for [lon, lat] in &ring.points {
                let candidate = LatLon::new(*lat, *lon);
                let leg_distance_km = haversine(from, candidate);
                let speed_kts = leg_distance_km / (dt_hours * KTS_TO_KM_PER_HR);
                if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                    continue;
                }
                feasible_candidates += 1;

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

                let mut bfo_score = 1.0;
                if let Some(measured_bfo) = handshake.bfo_hz {
                    let weight = bfo_reliability_weight(handshake.reliability.as_deref());
                    if weight > 0.0 {
                        let residual = bfo_model
                            .residual(
                                &satellite,
                                candidate,
                                heading_deg,
                                speed_kts,
                                ring.time_s,
                                measured_bfo,
                                &config,
                                0.0,
                            )?
                            .abs();
                        bfo_score = gaussian_score(residual, config.bfo_sigma_hz).powf(weight);
                    }
                }

                let mut next_state = state.clone();
                next_state.points.push(candidate);
                next_state.speeds_kts.push(speed_kts);
                next_state.headings_deg.push(heading_deg);
                next_state.log_score += speed_score.ln()
                    + 0.35 * heading_score.ln()
                    + config.bfo_score_weight * bfo_score.ln();
                next_states.push(next_state);
            }
        }

        next_states.sort_by(|left, right| right.log_score.partial_cmp(&left.log_score).unwrap());
        next_states.truncate(config.beam_width.max(1));

        let north_survivors = next_states
            .iter()
            .filter(|state| {
                state
                    .points
                    .last()
                    .map(|point| point.lat > 0.0)
                    .unwrap_or(false)
            })
            .count();
        let south_survivors = next_states
            .iter()
            .filter(|state| {
                state
                    .points
                    .last()
                    .map(|point| point.lat < 0.0)
                    .unwrap_or(false)
            })
            .count();
        let best = next_states.first();
        let best_lat = best
            .and_then(|state| state.points.last().map(|point| point.lat))
            .unwrap_or(0.0);
        let best_lon = best
            .and_then(|state| state.points.last().map(|point| point.lon))
            .unwrap_or(0.0);
        let best_score = best
            .map(|state| state.log_score)
            .unwrap_or(f64::NEG_INFINITY);

        println!(
            "{},{},{},{},{},{},{},{:.3},{:.3},{:.3}",
            handshake.arc,
            handshake.time_utc,
            states.len(),
            feasible_candidates,
            next_states.len(),
            north_survivors,
            south_survivors,
            best_lat,
            best_lon,
            best_score,
        );

        states = next_states;
        current_time_s = ring.time_s;
    }

    Ok(())
}
