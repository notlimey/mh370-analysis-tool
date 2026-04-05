//! BFO (Burst Frequency Offset) Doppler model for Inmarsat-3F1 ↔ MH370.
//!
//! Implements the DSTG/Holland BFO decomposition:
//!
//!   BFO = Δf_up + Δf_comp + Δf_down + bias
//!
//! Where:
//!   Δf_up   = uplink Doppler (aircraft → satellite)
//!   Δf_comp = AES frequency compensation (SDU pre-correction using nominal sat position)
//!   Δf_down = downlink Doppler (satellite → Perth GES)
//!   bias    = SDU oscillator offset + satellite transponder correction + AFC residual
//!
//! References:
//! - Holland 2017, "MH370 BFO Analysis", arXiv:1702.02432, Equations (1)-(4)
//! - DSTG Book, Davey et al. 2016, Equations (5.5)-(5.9)
//! - Ashton et al. 2014, "The Search for MH370" (Inmarsat)

use std::f64::consts::PI;

use super::data::{load_dataset, parse_time_utc_seconds, AnalysisConfig};
use super::geometry::LatLon;
use super::satellite::{sat_state_at_time_s, SatelliteModel};

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM: f64 = 6371.0;
const C_M_S: f64 = 299_792_458.0;

// ---------------------------------------------------------------------------
// SDU / system parameters
// ---------------------------------------------------------------------------

/// L-band uplink frequency (Hz).
/// Source: Holland 2017 page 4; Ashton et al. 2014 (Inmarsat).
const F_UPLINK_HZ: f64 = 1_646_652_500.0;

/// C-band downlink frequency from satellite to Perth GES (Hz).
/// Source: Inmarsat-3F1 C-band transponder specifications.
const F_DOWNLINK_HZ: f64 = 3_615_000_000.0;

/// Typical Boeing 777 cruise altitude (km). ~FL350.
const AIRCRAFT_ALT_KM: f64 = 10.668;

/// Satellite altitude used by the AES for Doppler compensation (km).
/// The AES uses a value 422 km higher than the nominal GEO altitude.
/// Source: DSTG Book page 29.
const AES_SATELLITE_ALT_KM: f64 = 36_210.0;

/// Perth Ground Earth Station coordinates.
/// Source: DSTG Table 2.1.
const PERTH_GES_LAT: f64 = -31.802;
const PERTH_GES_LON: f64 = 115.889;

// ---------------------------------------------------------------------------
// ECEF helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
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

fn to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

/// Convert geodetic (lat, lon, altitude) to ECEF (km).
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

// ---------------------------------------------------------------------------
// Satellite state from shared model
// ---------------------------------------------------------------------------

fn satellite_ecef(
    satellite: &SatelliteModel,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<(Vec3, Vec3), String> {
    let state = sat_state_at_time_s(satellite, time_s, config)?;
    let pos = to_ecef(state.lat_deg, state.lon_deg, state.alt_km);
    let vel = Vec3 {
        x: state.vx_km_s,
        y: state.vy_km_s,
        z: state.vz_km_s,
    };
    Ok((pos, vel))
}

// ---------------------------------------------------------------------------
// Aircraft velocity
// ---------------------------------------------------------------------------

/// Aircraft velocity in ECEF (km/s) from position, heading (deg), ground speed (km/s).
fn aircraft_velocity_ecef(
    lat_deg: f64,
    lon_deg: f64,
    heading_deg: f64,
    speed_km_s: f64,
    vertical_speed_km_s: f64,
) -> Vec3 {
    let lat = to_rad(lat_deg);
    let lon = to_rad(lon_deg);
    let hdg = to_rad(heading_deg);

    let v_north = speed_km_s * hdg.cos();
    let v_east = speed_km_s * hdg.sin();

    let horizontal = Vec3 {
        x: -v_north * lat.sin() * lon.cos() - v_east * lon.sin(),
        y: -v_north * lat.sin() * lon.sin() + v_east * lon.cos(),
        z: v_north * lat.cos(),
    };
    let up = Vec3 {
        x: lat.cos() * lon.cos(),
        y: lat.cos() * lon.sin(),
        z: lat.sin(),
    };

    Vec3 {
        x: horizontal.x + up.x * vertical_speed_km_s,
        y: horizontal.y + up.y * vertical_speed_km_s,
        z: horizontal.z + up.z * vertical_speed_km_s,
    }
}

// ---------------------------------------------------------------------------
// BFO Doppler components (Holland Eq. 3, 4)
// ---------------------------------------------------------------------------

/// Projected range rate along the line of sight (km/s).
/// Positive = objects separating.
#[allow(dead_code)]
fn range_rate(pos_a: Vec3, vel_a: Vec3, pos_b: Vec3, vel_b: Vec3) -> f64 {
    let dp = pos_a.sub(pos_b);
    let dv = vel_a.sub(vel_b);
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    dp.dot(dv) / r
}

/// Holland Eq (3): uplink Doppler (Hz).
///
/// Δf_up = (f_up / c) × (v_s - v_x) · (p_x - p_s) / |p_x - p_s|
///
/// Sign convention: approaching aircraft → negative Δf_up in Holland's
/// formulation, but the AES compensation term (Eq 4) uses the same convention,
/// so the combined BFO is internally consistent.
fn uplink_doppler_hz(
    sat_pos: Vec3,
    sat_vel: Vec3,
    ac_pos: Vec3,
    ac_vel: Vec3,
) -> f64 {
    let dp = ac_pos.sub(sat_pos); // p_x - p_s
    let dv = sat_vel.sub(ac_vel); // v_s - v_x
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_UPLINK_HZ / C_M_S) * dv.dot(dp) / r * 1000.0 // km/s → m/s
}

/// Holland Eq (4): AES frequency compensation (Hz).
///
/// δf_comp = (f_up / c) × v̂_x · (p̂_x - p̂_s) / |p̂_x - p̂_s|
///
/// The AES compensates using:
/// - Aircraft position at SEA LEVEL (not cruise altitude)
/// - Satellite at nominal position (0°N, 64.5°E) at AES_SATELLITE_ALT_KM
/// - Horizontal velocity only (no vertical speed compensation)
///
/// Source: DSTG Book page 29; Holland 2017 Eq. (4).
fn aes_compensation_hz(
    ac_lat: f64,
    ac_lon: f64,
    heading_deg: f64,
    speed_km_s: f64,
    nom_sat_lat: f64,
    nom_sat_lon: f64,
) -> f64 {
    let ac_pos = to_ecef(ac_lat, ac_lon, 0.0); // sea level
    let sat_pos = to_ecef(nom_sat_lat, nom_sat_lon, AES_SATELLITE_ALT_KM);
    let ac_vel = aircraft_velocity_ecef(ac_lat, ac_lon, heading_deg, speed_km_s, 0.0);

    let dp = ac_pos.sub(sat_pos); // p̂_x - p̂_s
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_UPLINK_HZ / C_M_S) * ac_vel.dot(dp) / r * 1000.0
}

/// Downlink Doppler: satellite → Perth GES (Hz).
///
/// The satellite retransmits at C-band. Its orbital motion causes Doppler
/// at the Perth ground station. This term varies as the satellite moves
/// in its inclined orbit.
///
/// Uses the same Holland sign convention: (v_s) · (p_ges - p_s) / |p_ges - p_s|
fn downlink_doppler_hz(sat_pos: Vec3, sat_vel: Vec3) -> f64 {
    let ges_pos = to_ecef(PERTH_GES_LAT, PERTH_GES_LON, 0.0);
    let dp = ges_pos.sub(sat_pos); // p_ges - p_s
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_DOWNLINK_HZ / C_M_S) * sat_vel.dot(dp) / r * 1000.0
}

// ---------------------------------------------------------------------------
// BFO model
// ---------------------------------------------------------------------------

/// Calibrated BFO model.
///
/// Implements Holland 2017 Eq. (1):
///   BFO = Δf_up + Δf_comp + Δf_down + bias
///
/// The bias absorbs: SDU oscillator offset (δf_bias), satellite transponder
/// frequency variation (δf_sat), and AFC correction (δf_AFC). These are
/// approximately constant over the flight.
pub struct BfoModel {
    bias: f64,
}

impl BfoModel {
    /// Calibrate using the 16:00:13 ground logon (aircraft stationary at KLIA gate).
    pub fn calibrate(satellite: &SatelliteModel, config: &AnalysisConfig) -> Result<Self, String> {
        let dataset = load_dataset(config)?;
        let handshake = dataset
            .inmarsat_handshakes
            .iter()
            .find(|handshake| {
                handshake.position_known
                    && handshake.bto_us.is_some()
                    && handshake.bfo_hz.is_some()
                    && handshake.message_type == "R-Channel Log-on"
            })
            .ok_or_else(|| "missing ground BFO calibration handshake".to_string())?;
        let lat = handshake
            .lat
            .ok_or_else(|| "missing lat for ground BFO calibration".to_string())?;
        let lon = handshake
            .lon
            .ok_or_else(|| "missing lon for ground BFO calibration".to_string())?;
        let time_s = parse_time_utc_seconds(&handshake.time_utc)?;
        let measured_bfo = handshake.bfo_hz.unwrap_or_default();

        let doppler = Self::total_doppler_hz(
            satellite, lat, lon, 0.0, 0.0, 0.0, time_s, config,
        )?;
        let bias = measured_bfo - doppler;
        Ok(BfoModel { bias })
    }

    /// Total Doppler contribution (Hz) = Δf_up + Δf_comp + Δf_down.
    fn total_doppler_hz(
        satellite: &SatelliteModel,
        lat: f64,
        lon: f64,
        heading_deg: f64,
        speed_kts: f64,
        vertical_speed_fpm: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let speed_km_s = speed_kts * 1.852 / 3600.0;
        let vertical_speed_km_s = vertical_speed_fpm * 0.0003048 / 60.0;

        let ac_pos = to_ecef(lat, lon, AIRCRAFT_ALT_KM);
        let ac_vel = aircraft_velocity_ecef(lat, lon, heading_deg, speed_km_s, vertical_speed_km_s);
        let (sat_pos, sat_vel) = satellite_ecef(satellite, time_s, config)?;

        let delta_f_up = uplink_doppler_hz(sat_pos, sat_vel, ac_pos, ac_vel);
        let delta_f_comp = aes_compensation_hz(
            lat,
            lon,
            heading_deg,
            speed_km_s,
            config.satellite_nominal_lat_deg,
            config.satellite_nominal_lon_deg,
        );
        let delta_f_down = downlink_doppler_hz(sat_pos, sat_vel);

        Ok(delta_f_up + delta_f_comp + delta_f_down)
    }

    /// Predict BFO (Hz) for a given aircraft state.
    pub fn predict(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        config: &AnalysisConfig,
        vertical_speed_fpm: f64,
    ) -> Result<f64, String> {
        let doppler = Self::total_doppler_hz(
            satellite, pos.lat, pos.lon, heading_deg, speed_kts, vertical_speed_fpm,
            time_s, config,
        )?;
        Ok(doppler + self.bias)
    }

    /// BFO residual: predicted - measured (Hz).
    pub fn residual(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        measured_bfo: f64,
        config: &AnalysisConfig,
        vertical_speed_fpm: f64,
    ) -> Result<f64, String> {
        Ok(self.predict(satellite, pos, heading_deg, speed_kts, time_s, config, vertical_speed_fpm)?
            - measured_bfo)
    }

    /// Score a candidate point on the 7th arc by finding the best-matching heading.
    pub fn score_7th_arc_point(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        measured_bfo: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let mut best_residual = f64::MAX;

        for hdg_i in 0..=100 {
            let heading = 150.0 + hdg_i as f64;
            for spd_i in 0..7 {
                let speed = 400.0 + spd_i as f64 * 20.0;
                let r = self
                    .residual(satellite, pos, heading, speed, time_s, measured_bfo, config, 0.0)?
                    .abs();
                if r < best_residual {
                    best_residual = r;
                }
            }
        }

        let sigma = config.bfo_sigma_hz;
        Ok((-best_residual.powi(2) / (2.0 * sigma * sigma)).exp())
    }
}
