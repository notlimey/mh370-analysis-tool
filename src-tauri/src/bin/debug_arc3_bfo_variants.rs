use std::f64::consts::PI;

use mh370_lib::mh370::arcs::{build_arc_ring, calibrate_bto_offset_from_dataset};
use mh370_lib::mh370::data::{
    load_dataset, parse_time_utc_seconds, path_scoring_handshakes, resolve_config,
};
use mh370_lib::mh370::geometry::{bearing, haversine, LatLon};
use mh370_lib::mh370::satellite::{sat_state_at_time_s, SatelliteModel};

const KTS_TO_KM_PER_HR: f64 = 1.852;
const EARTH_RADIUS_KM: f64 = 6371.0;
const AIRCRAFT_ALT_KM: f64 = 10.668;
const C_M_S: f64 = 299_792_458.0;
const F_UPLINK_HZ: f64 = 1_626_500_000.0;
const LAST_RADAR: LatLon = LatLon {
    lat: 6.8,
    lon: 97.7,
};
const LAST_RADAR_TIME_UTC: &str = "18:22:00";

#[derive(Clone, Copy)]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vec3 {
    fn dot(self, other: Vec3) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    fn sub(self, other: Vec3) -> Vec3 {
        Vec3 {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }

    fn magnitude(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
}

#[derive(Clone, Copy)]
enum Variant {
    Current,
    RawPositive,
    RawNegative,
    FullPositive,
    PartialPositive(f64),
    PartialNegative(f64),
}

impl Variant {
    fn label(self) -> String {
        match self {
            Variant::Current => "current".to_string(),
            Variant::RawPositive => "raw_positive".to_string(),
            Variant::RawNegative => "raw_negative".to_string(),
            Variant::FullPositive => "full_positive".to_string(),
            Variant::PartialPositive(f) => format!("partial_positive_{f:.2}"),
            Variant::PartialNegative(f) => format!("partial_negative_{f:.2}"),
        }
    }
}

#[derive(Clone)]
struct Candidate {
    lat: f64,
    lon: f64,
    speed_kts: f64,
    heading_deg: f64,
}

fn to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

fn to_ecef(lat_deg: f64, lon_deg: f64, alt_km: f64) -> Vec3 {
    let lat = to_rad(lat_deg);
    let lon = to_rad(lon_deg);
    let r = EARTH_RADIUS_KM + alt_km;
    Vec3 {
        x: r * lat.cos() * lon.cos(),
        y: r * lat.cos() * lon.sin(),
        z: r * lat.sin(),
    }
}

fn range_rate(pos_a: Vec3, vel_a: Vec3, pos_b: Vec3, vel_b: Vec3) -> f64 {
    let dp = pos_a.sub(pos_b);
    let dv = vel_a.sub(vel_b);
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    dp.dot(dv) / r
}

fn aircraft_velocity_ecef(pos: LatLon, heading_deg: f64, speed_kts: f64) -> Vec3 {
    let speed_km_s = speed_kts * 1.852 / 3600.0;
    let lat = to_rad(pos.lat);
    let lon = to_rad(pos.lon);
    let hdg = to_rad(heading_deg);
    let v_north = speed_km_s * hdg.cos();
    let v_east = speed_km_s * hdg.sin();
    Vec3 {
        x: -v_north * lat.sin() * lon.cos() - v_east * lon.sin(),
        y: -v_north * lat.sin() * lon.sin() + v_east * lon.cos(),
        z: v_north * lat.cos(),
    }
}

fn rr_components(
    satellite: &SatelliteModel,
    pos: LatLon,
    heading_deg: f64,
    speed_kts: f64,
    time_s: f64,
    nominal_lat_deg: f64,
    nominal_lon_deg: f64,
    config: &mh370_lib::AnalysisConfig,
) -> Result<(f64, f64), String> {
    let sat = sat_state_at_time_s(satellite, time_s, config)?;
    let sat_pos = to_ecef(sat.lat_deg, sat.lon_deg, sat.alt_km);
    let sat_vel = Vec3 {
        x: sat.vx_km_s,
        y: sat.vy_km_s,
        z: sat.vz_km_s,
    };
    let ac_pos = to_ecef(pos.lat, pos.lon, AIRCRAFT_ALT_KM);
    let ac_vel = aircraft_velocity_ecef(pos, heading_deg, speed_kts);
    let actual_rr = range_rate(sat_pos, sat_vel, ac_pos, ac_vel);
    let nominal_sat = to_ecef(nominal_lat_deg, nominal_lon_deg, 35786.0);
    let comp_rr = range_rate(
        nominal_sat,
        Vec3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
        ac_pos,
        ac_vel,
    );
    Ok((actual_rr * 1000.0, comp_rr * 1000.0))
}

fn predicted_bfo(rr_m_s: f64, sign_negative: bool, bias: f64) -> f64 {
    let coeff = F_UPLINK_HZ / C_M_S;
    if sign_negative {
        -(coeff * rr_m_s) + bias
    } else {
        (coeff * rr_m_s) + bias
    }
}

fn calibrate_bias(
    variant: Variant,
    satellite: &SatelliteModel,
    config: &mh370_lib::AnalysisConfig,
    nominal_lat_deg: f64,
    nominal_lon_deg: f64,
) -> Result<f64, String> {
    let dataset = load_dataset(config)?;
    let ground = dataset
        .inmarsat_handshakes
        .iter()
        .find(|h| h.message_type == "R-Channel Log-on" && h.position_known && h.bfo_hz.is_some())
        .ok_or_else(|| "missing ground handshake".to_string())?;
    let pos = LatLon::new(
        ground.lat.unwrap_or_default(),
        ground.lon.unwrap_or_default(),
    );
    let time_s = parse_time_utc_seconds(&ground.time_utc)?;
    let (actual_rr, comp_rr) = rr_components(
        satellite,
        pos,
        0.0,
        0.0,
        time_s,
        nominal_lat_deg,
        nominal_lon_deg,
        config,
    )?;
    let rr = match variant {
        Variant::Current => actual_rr - comp_rr,
        Variant::RawPositive | Variant::RawNegative => actual_rr,
        Variant::FullPositive => actual_rr - comp_rr,
        Variant::PartialPositive(f) | Variant::PartialNegative(f) => actual_rr - comp_rr * f,
    };
    let predicted_without_bias = match variant {
        Variant::Current | Variant::RawNegative | Variant::PartialNegative(_) => {
            predicted_bfo(rr, true, 0.0)
        }
        _ => predicted_bfo(rr, false, 0.0),
    };
    Ok(ground.bfo_hz.unwrap_or_default() - predicted_without_bias)
}

fn evaluate_variant(
    variant: Variant,
    satellite: &SatelliteModel,
    candidate: &Candidate,
    measured_bfo: f64,
    time_s: f64,
    nominal_lat_deg: f64,
    nominal_lon_deg: f64,
    config: &mh370_lib::AnalysisConfig,
) -> Result<f64, String> {
    let bias = calibrate_bias(variant, satellite, config, nominal_lat_deg, nominal_lon_deg)?;
    let (actual_rr, comp_rr) = rr_components(
        satellite,
        LatLon::new(candidate.lat, candidate.lon),
        candidate.heading_deg,
        candidate.speed_kts,
        time_s,
        nominal_lat_deg,
        nominal_lon_deg,
        config,
    )?;
    let rr = match variant {
        Variant::Current => actual_rr - comp_rr,
        Variant::RawPositive | Variant::RawNegative => actual_rr,
        Variant::FullPositive => actual_rr - comp_rr,
        Variant::PartialPositive(f) | Variant::PartialNegative(f) => actual_rr - comp_rr * f,
    };
    let predicted = match variant {
        Variant::Current | Variant::RawNegative | Variant::PartialNegative(_) => {
            predicted_bfo(rr, true, bias)
        }
        _ => predicted_bfo(rr, false, bias),
    };
    Ok(predicted - measured_bfo)
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

    let arc2 = handshakes
        .first()
        .ok_or_else(|| "missing arc2".to_string())?;
    let arc3 = handshakes
        .get(1)
        .ok_or_else(|| "missing arc3".to_string())?;
    let arc2_ring = build_arc_ring(&satellite, arc2, calibration.offset_us, &config)?;
    let arc3_ring = build_arc_ring(&satellite, arc3, calibration.offset_us, &config)?;
    let arc2_dt = (arc2_ring.time_s - parse_time_utc_seconds(LAST_RADAR_TIME_UTC)?) / 3600.0;
    let arc3_dt = (arc3_ring.time_s - arc2_ring.time_s) / 3600.0;

    let mut arc2_states = Vec::<(LatLon, f64, f64)>::new();
    for [lon, lat] in &arc2_ring.points {
        let candidate = LatLon::new(*lat, *lon);
        let speed_kts = haversine(LAST_RADAR, candidate) / (arc2_dt * KTS_TO_KM_PER_HR);
        if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
            continue;
        }
        let heading_deg = bearing(LAST_RADAR, candidate);
        arc2_states.push((candidate, speed_kts, heading_deg));
    }

    let mut best_north: Option<Candidate> = None;
    let mut best_south: Option<Candidate> = None;
    let mut best_north_residual = f64::INFINITY;
    let mut best_south_residual = f64::INFINITY;

    for (from, previous_speed, previous_heading) in &arc2_states {
        for [lon, lat] in &arc3_ring.points {
            let candidate = LatLon::new(*lat, *lon);
            let speed_kts = haversine(*from, candidate) / (arc3_dt * KTS_TO_KM_PER_HR);
            if speed_kts < config.min_speed_kts || speed_kts > config.max_speed_kts {
                continue;
            }
            let heading_deg = bearing(*from, candidate);
            let speed_ok = (speed_kts - previous_speed).abs();
            let heading_ok = (heading_deg - previous_heading).abs();
            let residual = ((speed_ok / config.speed_consistency_sigma_kts).powi(2)
                + (heading_ok / config.heading_change_sigma_deg).powi(2))
            .sqrt();
            let holder = Candidate {
                lat: candidate.lat,
                lon: candidate.lon,
                speed_kts,
                heading_deg,
            };
            if candidate.lat >= 0.0 && residual < best_north_residual {
                best_north_residual = residual;
                best_north = Some(holder.clone());
            }
            if candidate.lat < 0.0 && residual < best_south_residual {
                best_south_residual = residual;
                best_south = Some(holder);
            }
        }
    }

    let north = best_north.ok_or_else(|| "missing north arc3 candidate".to_string())?;
    let south = best_south.ok_or_else(|| "missing south arc3 candidate".to_string())?;
    let measured_bfo = arc3.bfo_hz.ok_or_else(|| "missing arc3 bfo".to_string())?;
    let time_s = arc3_ring.time_s;
    let variants = [
        Variant::Current,
        Variant::RawPositive,
        Variant::RawNegative,
        Variant::FullPositive,
        Variant::PartialPositive(0.75),
        Variant::PartialPositive(0.50),
        Variant::PartialPositive(0.35),
        Variant::PartialNegative(0.75),
        Variant::PartialNegative(0.50),
        Variant::PartialNegative(0.35),
    ];

    println!("variant,north_residual_hz,south_residual_hz,delta_abs_hz");
    for variant in variants {
        let north_res = evaluate_variant(
            variant,
            &satellite,
            &north,
            measured_bfo,
            time_s,
            config.satellite_nominal_lat_deg,
            config.satellite_nominal_lon_deg,
            &config,
        )?;
        let south_res = evaluate_variant(
            variant,
            &satellite,
            &south,
            measured_bfo,
            time_s,
            config.satellite_nominal_lat_deg,
            config.satellite_nominal_lon_deg,
            &config,
        )?;
        println!(
            "{},{:.1},{:.1},{:.1}",
            variant.label(),
            north_res,
            south_res,
            south_res.abs() - north_res.abs(),
        );
    }

    println!(
        "north_candidate,{:.3},{:.3},{:.1},{:.1}",
        north.lat, north.lon, north.speed_kts, north.heading_deg
    );
    println!(
        "south_candidate,{:.3},{:.3},{:.1},{:.1}",
        south.lat, south.lon, south.speed_kts, south.heading_deg
    );

    Ok(())
}
