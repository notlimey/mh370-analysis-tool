//! BFO validation tool implementing the DSTG/Holland formula exactly.
//!
//! Computes BFO at all known-position points using both the current model
//! and the corrected DSTG formula, showing the effect of each fix.
//!
//! References:
//! - Holland 2017, "MH370 BFO Analysis", arXiv:1702.02432, Eq. (1)-(4)
//! - DSTG Book, Davey et al. 2016, Eq. (5.5)-(5.9)

use std::f64::consts::PI;

use mh370_lib::mh370::data::{load_dataset, parse_time_utc_seconds, resolve_config};
use mh370_lib::mh370::satellite::{sat_state_at_time_s, SatelliteModel};

const C_M_S: f64 = 299_792_458.0;
const EARTH_RADIUS_KM: f64 = 6371.0;

// Current (possibly wrong) constants
const F_UP_CURRENT: f64 = 1_626_500_000.0;
const AES_SAT_ALT_CURRENT: f64 = 35_786.0;

// Corrected constants per Holland/DSTG
// Source: Holland 2017, arXiv:1702.02432, page 4; Inmarsat/Ashton et al. 2014
const F_UP_HOLLAND: f64 = 1_646_652_500.0;
// Source: DSTG Book page 29: "422 km higher than the nominal 35788.12 km"
const AES_SAT_ALT_HOLLAND: f64 = 36_210.0;
// Downlink C-band frequency
const F_DOWN: f64 = 3_615_000_000.0;
// Perth GES coordinates (DSTG Table 2.1)
const PERTH_LAT: f64 = -31.802;
const PERTH_LON: f64 = 115.889;

#[derive(Clone, Copy)]
struct Vec3 { x: f64, y: f64, z: f64 }

impl Vec3 {
    fn dot(self, o: Vec3) -> f64 { self.x*o.x + self.y*o.y + self.z*o.z }
    fn sub(self, o: Vec3) -> Vec3 { Vec3 { x: self.x-o.x, y: self.y-o.y, z: self.z-o.z } }
    fn mag(self) -> f64 { (self.x*self.x + self.y*self.y + self.z*self.z).sqrt() }
}

fn to_ecef(lat_deg: f64, lon_deg: f64, alt_km: f64) -> Vec3 {
    let lat = lat_deg * PI / 180.0;
    let lon = lon_deg * PI / 180.0;
    let r = EARTH_RADIUS_KM + alt_km;
    Vec3 { x: r*lat.cos()*lon.cos(), y: r*lat.cos()*lon.sin(), z: r*lat.sin() }
}

fn aircraft_vel_ecef(lat_deg: f64, lon_deg: f64, hdg_deg: f64, speed_km_s: f64) -> Vec3 {
    let lat = lat_deg * PI / 180.0;
    let lon = lon_deg * PI / 180.0;
    let hdg = hdg_deg * PI / 180.0;
    let vn = speed_km_s * hdg.cos();
    let ve = speed_km_s * hdg.sin();
    Vec3 {
        x: -vn * lat.sin() * lon.cos() - ve * lon.sin(),
        y: -vn * lat.sin() * lon.sin() + ve * lon.cos(),
        z: vn * lat.cos(),
    }
}

/// Holland Eq (3): uplink Doppler
/// Delta_F_up = (F_up/c) * (v_s - v_x) · (p_x - p_s) / |p_x - p_s|
fn uplink_doppler(f_up: f64, sat_pos: Vec3, sat_vel: Vec3, ac_pos: Vec3, ac_vel: Vec3) -> f64 {
    let dp = ac_pos.sub(sat_pos); // p_x - p_s (aircraft - satellite)
    let dv = sat_vel.sub(ac_vel); // v_s - v_x (satellite vel - aircraft vel)
    let r = dp.mag();
    if r < 1.0 { return 0.0; }
    (f_up / C_M_S) * dv.dot(dp) / r * 1000.0 // km/s -> m/s
}

/// Holland Eq (4): AES compensation
/// delta_f_comp = (F_up/c) * v_hat_x · (p_hat_x - p_hat_s) / |p_hat_x - p_hat_s|
/// v_hat_x = aircraft horizontal velocity (no vertical)
/// p_hat_x = aircraft position at SEA LEVEL
/// p_hat_s = nominal satellite at 0N, 64.5E, altitude per AES
fn aes_compensation(
    f_up: f64,
    ac_lat: f64, ac_lon: f64,
    hdg_deg: f64, speed_km_s: f64,
    nom_sat_lat: f64, nom_sat_lon: f64, nom_sat_alt_km: f64,
) -> f64 {
    // AES uses sea-level aircraft position (DSTG book page 29)
    let ac_pos_hat = to_ecef(ac_lat, ac_lon, 0.0);
    // AES uses nominal satellite position
    let sat_pos_hat = to_ecef(nom_sat_lat, nom_sat_lon, nom_sat_alt_km);
    // AES uses horizontal-only velocity (no vertical speed)
    let ac_vel_hat = aircraft_vel_ecef(ac_lat, ac_lon, hdg_deg, speed_km_s);

    let dp = ac_pos_hat.sub(sat_pos_hat); // p_hat_x - p_hat_s
    let r = dp.mag();
    if r < 1.0 { return 0.0; }
    (f_up / C_M_S) * ac_vel_hat.dot(dp) / r * 1000.0
}

/// Downlink Doppler: satellite -> Perth GES
/// Same sign convention as Holland: (v_s) · (p_ges - p_s) / |p_ges - p_s|
fn downlink_doppler(f_down: f64, sat_pos: Vec3, sat_vel: Vec3) -> f64 {
    let ges_pos = to_ecef(PERTH_LAT, PERTH_LON, 0.0);
    let dp = ges_pos.sub(sat_pos); // p_ges - p_s
    let r = dp.mag();
    if r < 1.0 { return 0.0; }
    (f_down / C_M_S) * sat_vel.dot(dp) / r * 1000.0
}

struct BfoResult {
    delta_f_up: f64,
    delta_f_comp: f64,
    delta_f_down: f64,
    total_doppler: f64,
    bias: f64,
    predicted: f64,
}

fn compute_bfo(
    satellite: &SatelliteModel,
    config: &mh370_lib::AnalysisConfig,
    f_up: f64,
    aes_sat_alt: f64,
    include_downlink: bool,
    ac_lat: f64, ac_lon: f64,
    ac_alt_km: f64,
    hdg_deg: f64, speed_kts: f64,
    time_s: f64,
    bias: f64,
) -> BfoResult {
    let speed_km_s = speed_kts * 1.852 / 3600.0;

    let state = sat_state_at_time_s(satellite, time_s, config).unwrap();
    let sat_pos = to_ecef(state.lat_deg, state.lon_deg, state.alt_km);
    let sat_vel = Vec3 { x: state.vx_km_s, y: state.vy_km_s, z: state.vz_km_s };

    let ac_pos = to_ecef(ac_lat, ac_lon, ac_alt_km);
    let ac_vel = aircraft_vel_ecef(ac_lat, ac_lon, hdg_deg, speed_km_s);

    let delta_f_up = uplink_doppler(f_up, sat_pos, sat_vel, ac_pos, ac_vel);
    let delta_f_comp = aes_compensation(
        f_up, ac_lat, ac_lon, hdg_deg, speed_km_s,
        config.satellite_nominal_lat_deg, config.satellite_nominal_lon_deg, aes_sat_alt,
    );
    let delta_f_down = if include_downlink {
        downlink_doppler(F_DOWN, sat_pos, sat_vel)
    } else {
        0.0
    };

    let total_doppler = delta_f_up + delta_f_comp + delta_f_down;
    let predicted = total_doppler + bias;

    BfoResult { delta_f_up, delta_f_comp, delta_f_down, total_doppler, bias, predicted }
}

fn main() {
    let config = resolve_config(None);
    let satellite = SatelliteModel::load().unwrap();

    // Known-position BFO measurements
    struct CalPoint { label: &'static str, time: &'static str, lat: f64, lon: f64, alt_km: f64, hdg: f64, speed: f64, bfo: f64 }
    let points = vec![
        CalPoint { label: "Gate (16:00)", time: "16:00:13.406", lat: 3.12, lon: 101.69, alt_km: 0.0, hdg: 0.0, speed: 0.0, bfo: 88.0 },
        CalPoint { label: "Takeoff (16:42)", time: "16:42:04.408", lat: 3.12, lon: 101.69, alt_km: 0.3, hdg: 320.0, speed: 170.0, bfo: 142.0 },
        CalPoint { label: "ACARS (17:07)", time: "17:07:55.587", lat: 5.27, lon: 102.79, alt_km: 10.668, hdg: 25.0, speed: 472.0, bfo: 132.0 },
    ];

    struct ModelConfig {
        label: &'static str,
        f_up: f64,
        aes_sat_alt: f64,
        include_downlink: bool,
    }
    let models = vec![
        ModelConfig { label: "Current model", f_up: F_UP_CURRENT, aes_sat_alt: AES_SAT_ALT_CURRENT, include_downlink: false },
        ModelConfig { label: "Fix freq only", f_up: F_UP_HOLLAND, aes_sat_alt: AES_SAT_ALT_CURRENT, include_downlink: false },
        ModelConfig { label: "Fix freq+AES alt", f_up: F_UP_HOLLAND, aes_sat_alt: AES_SAT_ALT_HOLLAND, include_downlink: false },
        ModelConfig { label: "Full DSTG", f_up: F_UP_HOLLAND, aes_sat_alt: AES_SAT_ALT_HOLLAND, include_downlink: true },
    ];

    for model in &models {
        println!("\n=== {} ===", model.label);
        println!("  F_up={:.3} MHz, AES_sat_alt={:.0} km, downlink={}",
                 model.f_up / 1e6, model.aes_sat_alt, model.include_downlink);

        // Calibrate bias from gate point
        let gate = &points[0];
        let gate_time_s = parse_time_utc_seconds(gate.time).unwrap();
        let gate_result = compute_bfo(
            &satellite, &config, model.f_up, model.aes_sat_alt, model.include_downlink,
            gate.lat, gate.lon, gate.alt_km, gate.hdg, gate.speed, gate_time_s, 0.0,
        );
        let bias = gate.bfo - gate_result.total_doppler;
        println!("  Bias from gate: {:.1} Hz (gate doppler: up={:.1} comp={:.1} down={:.1})",
                 bias, gate_result.delta_f_up, gate_result.delta_f_comp, gate_result.delta_f_down);

        println!("  {:20} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
                 "Point", "Meas", "Pred", "Resid", "dF_up", "dF_comp", "dF_down", "bias");
        println!("  {}", "-".repeat(80));

        for point in &points {
            let time_s = parse_time_utc_seconds(point.time).unwrap();
            let r = compute_bfo(
                &satellite, &config, model.f_up, model.aes_sat_alt, model.include_downlink,
                point.lat, point.lon, point.alt_km, point.hdg, point.speed, time_s, bias,
            );
            let residual = r.predicted - point.bfo;
            println!("  {:20} {:8.1} {:8.1} {:8.1} {:8.1} {:8.1} {:8.1} {:8.1}",
                     point.label, point.bfo, r.predicted, residual,
                     r.delta_f_up, r.delta_f_comp, r.delta_f_down, bias);
        }

        // Now test against south track arcs
        let dataset = load_dataset(&config).unwrap();
        let arc_handshakes: Vec<_> = dataset.inmarsat_handshakes.iter()
            .filter(|h| h.arc >= 2 && h.bfo_hz.is_some())
            .collect();
        let south_lats = [-6.0_f64, -12.0, -18.0, -24.0, -28.0, -33.0, -35.0];

        println!("\n  South track (hdg=185, spd=465 kts):");
        println!("  {:5} {:>12} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
                 "Arc", "Time", "Meas", "Pred", "Resid", "dF_up", "dF_comp", "dF_down");
        println!("  {}", "-".repeat(85));

        let mut sum_sq = 0.0;
        for (i, h) in arc_handshakes.iter().enumerate() {
            if i >= south_lats.len() { break; }
            let time_s = parse_time_utc_seconds(&h.time_utc).unwrap();
            let measured = h.bfo_hz.unwrap();
            let r = compute_bfo(
                &satellite, &config, model.f_up, model.aes_sat_alt, model.include_downlink,
                south_lats[i], 93.0, 10.668, 185.0, 465.0, time_s, bias,
            );
            let residual = r.predicted - measured;
            sum_sq += residual * residual;
            println!("  {:5} {:>12} {:8.1} {:8.1} {:8.1} {:8.1} {:8.1} {:8.1}",
                     h.arc, h.time_utc, measured, r.predicted, residual,
                     r.delta_f_up, r.delta_f_comp, r.delta_f_down);
        }
        println!("  RMS: {:.1} Hz", (sum_sq / arc_handshakes.len().min(south_lats.len()) as f64).sqrt());
    }
}
