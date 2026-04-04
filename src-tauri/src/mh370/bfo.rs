//! BFO (Burst Frequency Offset) Doppler model for Inmarsat-3F1 ↔ MH370.
//!
//! The BFO encodes the Doppler shift on the L-band uplink signal caused by
//! relative motion between the aircraft and satellite. By modelling the
//! satellite's orbital motion and predicting BFO for a given aircraft state,
//! we can score candidate paths against measured BFO values.
//!
//! BFO_predicted = (f_uplink / c) × range_rate(aircraft, satellite) + bias
//!
//! The bias absorbs the SDU oscillator offset, satellite frequency compensation,
//! and downlink Doppler to the Perth ground station. It is calibrated from the
//! 16:00:13 UTC ground handshake (aircraft stationary at KLIA).
//!
//! Satellite position and velocity are obtained from the shared satellite model
//! in `satellite.rs`, ensuring consistency with BTO arc calculations.

use std::f64::consts::PI;

use super::data::AnalysisConfig;
use super::geometry::LatLon;
use super::satellite::sat_state_at_time_s;

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM: f64 = 6371.0;
const C_M_S: f64 = 299_792_458.0; // speed of light, m/s

// ---------------------------------------------------------------------------
// SDU parameters
// ---------------------------------------------------------------------------

/// L-band uplink frequency used by MH370's SDU (Hz).
const F_UPLINK_HZ: f64 = 1_626_500_000.0;

/// Typical Boeing 777 cruise altitude (km). ~FL350.
const AIRCRAFT_ALT_KM: f64 = 10.668;

// ---------------------------------------------------------------------------
// Calibration reference: KLIA ground point at 16:00:13 UTC
// ---------------------------------------------------------------------------

const KLIA: LatLon = LatLon {
    lat: 2.75,
    lon: 101.71,
};
/// BFO measured at 16:00:13 UTC logon with aircraft stationary at gate.
/// Source: Malaysian government Inmarsat data release, May 2014.
const BFO_GROUND: f64 = 88.0;

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

/// Get satellite ECEF position and velocity from the shared satellite model.
fn satellite_ecef(time_s: f64, config: &AnalysisConfig) -> Result<(Vec3, Vec3), String> {
    let state = sat_state_at_time_s(time_s, config)?;
    let pos = to_ecef(state.lat_deg, state.lon_deg, state.alt_km);
    // Velocity from satellite.rs is already ECEF km/s
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
fn aircraft_velocity_ecef(pos: LatLon, heading_deg: f64, speed_km_s: f64) -> Vec3 {
    let lat = to_rad(pos.lat);
    let lon = to_rad(pos.lon);
    let hdg = to_rad(heading_deg);

    // Local NED → ECEF rotation
    let v_north = speed_km_s * hdg.cos();
    let v_east = speed_km_s * hdg.sin();

    Vec3 {
        x: -v_north * lat.sin() * lon.cos() - v_east * lon.sin(),
        y: -v_north * lat.sin() * lon.sin() + v_east * lon.cos(),
        z: v_north * lat.cos(),
    }
}

// ---------------------------------------------------------------------------
// Range rate
// ---------------------------------------------------------------------------

/// Rate of change of distance between two objects (km/s).
/// Positive = separating, negative = approaching.
fn range_rate(pos_a: Vec3, vel_a: Vec3, pos_b: Vec3, vel_b: Vec3) -> f64 {
    let dp = pos_a.sub(pos_b);
    let dv = vel_a.sub(vel_b);
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    dp.dot(dv) / r
}

// ---------------------------------------------------------------------------
// BFO model
// ---------------------------------------------------------------------------

/// Calibrated BFO model parameters.
pub struct BfoModel {
    /// Combined bias: SDU oscillator + satellite compensation + downlink Doppler.
    bias: f64,
}

impl BfoModel {
    /// Calibrate the model using the shared satellite model from `satellite.rs`.
    ///
    /// Uses the 16:00:13 ground logon (aircraft stationary at gate) to derive
    /// the combined bias. The satellite position comes from the same model used
    /// for BTO arc calculations, ensuring consistency.
    pub fn calibrate(config: &AnalysisConfig) -> Result<Self, String> {
        let rr = Self::raw_range_rate(KLIA, 0.0, 0.0, 0.0, config)?;
        let bias = BFO_GROUND - (F_UPLINK_HZ / C_M_S) * rr;
        Ok(BfoModel { bias })
    }

    /// Raw range rate (m/s) for a given aircraft state.
    fn raw_range_rate(
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let speed_km_s = speed_kts * 1.852 / 3600.0;

        let ac_pos = to_ecef(pos.lat, pos.lon, AIRCRAFT_ALT_KM);
        let ac_vel = aircraft_velocity_ecef(pos, heading_deg, speed_km_s);
        let (sat_pos, sat_vel) = satellite_ecef(time_s, config)?;

        // range_rate in km/s → convert to m/s
        Ok(range_rate(ac_pos, ac_vel, sat_pos, sat_vel) * 1000.0)
    }

    /// Predict BFO (Hz) for a given aircraft state.
    pub fn predict(
        &self,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let rr = Self::raw_range_rate(pos, heading_deg, speed_kts, time_s, config)?;
        Ok((F_UPLINK_HZ / C_M_S) * rr + self.bias)
    }

    /// BFO residual: predicted - measured (Hz).
    pub fn residual(
        &self,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        measured_bfo: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        Ok(self.predict(pos, heading_deg, speed_kts, time_s, config)? - measured_bfo)
    }

    /// Score a candidate point on the 7th arc by finding the best-matching heading.
    ///
    /// Scans southward headings (150–250°), computes BFO residual at each,
    /// and returns a score in [0, 1] where 1 = perfect BFO match.
    pub fn score_7th_arc_point(
        &self,
        pos: LatLon,
        measured_bfo: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let mut best_residual = f64::MAX;

        // Scan headings 150–250° and speeds 400–520 kts
        for hdg_i in 0..=100 {
            let heading = 150.0 + hdg_i as f64;
            for spd_i in 0..7 {
                let speed = 400.0 + spd_i as f64 * 20.0;
                let r = self.residual(pos, heading, speed, time_s, measured_bfo, config)?.abs();
                if r < best_residual {
                    best_residual = r;
                }
            }
        }

        // Convert residual to score: Gaussian with σ ≈ 7 Hz (typical BFO noise)
        let sigma = 7.0;
        Ok((-best_residual.powi(2) / (2.0 * sigma * sigma)).exp())
    }
}
