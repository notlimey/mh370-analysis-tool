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
//! 16:00 UTC ground handshake (aircraft stationary at KLIA).

use std::f64::consts::PI;

use super::geometry::LatLon;

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM: f64 = 6371.0;
const C_M_S: f64 = 299_792_458.0; // speed of light, m/s

// ---------------------------------------------------------------------------
// Inmarsat-3F1 orbital parameters
// ---------------------------------------------------------------------------

/// Sub-satellite longitude (degrees east). Nearly geostationary.
const SAT_LON_DEG: f64 = 64.5;

/// Geostationary orbit radius from Earth centre (km).
const SAT_ORBIT_RADIUS_KM: f64 = 42_164.0;

/// Orbital inclination (degrees). The satellite had drifted slightly off-equator.
const SAT_INCLINATION_DEG: f64 = 1.65;
const SAT_INCLINATION_RAD: f64 = SAT_INCLINATION_DEG * PI / 180.0;

/// Angular velocity (rad/s). One sidereal day ≈ 86164 s.
const OMEGA: f64 = 2.0 * PI / 86_164.0;

// ---------------------------------------------------------------------------
// SDU parameters
// ---------------------------------------------------------------------------

/// L-band uplink frequency used by MH370's SDU (Hz).
const F_UPLINK_HZ: f64 = 1_626_500_000.0;

/// Typical Boeing 777 cruise altitude (km). ~FL350.
const AIRCRAFT_ALT_KM: f64 = 10.668;

// ---------------------------------------------------------------------------
// Calibration reference: KLIA ground point at 16:00 UTC
// ---------------------------------------------------------------------------

const KLIA: LatLon = LatLon {
    lat: 2.75,
    lon: 101.71,
};
/// BFO measured at 16:00 UTC with aircraft stationary on ground.
const BFO_GROUND: f64 = 142.0;

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
// Satellite ephemeris
// ---------------------------------------------------------------------------

/// Satellite ECEF position at time `t_s` (seconds since 16:00 UTC Mar 7).
/// `t_ref` is the epoch offset — the time when the satellite crosses the
/// equator going northbound.
fn satellite_position(t_s: f64, t_ref: f64) -> Vec3 {
    let phase = OMEGA * (t_s - t_ref);
    let lat_deg = SAT_INCLINATION_DEG * phase.sin();
    let sat_alt = SAT_ORBIT_RADIUS_KM - EARTH_RADIUS_KM;
    to_ecef(lat_deg, SAT_LON_DEG, sat_alt)
}

/// Satellite ECEF velocity at time `t_s` (km/s).
fn satellite_velocity(t_s: f64, t_ref: f64) -> Vec3 {
    let phase = OMEGA * (t_s - t_ref);
    let lat_rad = SAT_INCLINATION_RAD * phase.sin();
    let dlat_dt = SAT_INCLINATION_RAD * OMEGA * phase.cos(); // rad/s

    let lon = to_rad(SAT_LON_DEG);
    let r = SAT_ORBIT_RADIUS_KM;

    // d/dt of ECEF position with lat(t) varying, lon and r constant:
    //   dx/dt = -r sin(lat) cos(lon) dlat/dt
    //   dy/dt = -r sin(lat) sin(lon) dlat/dt
    //   dz/dt =  r cos(lat) dlat/dt
    Vec3 {
        x: -r * lat_rad.sin() * lon.cos() * dlat_dt,
        y: -r * lat_rad.sin() * lon.sin() * dlat_dt,
        z: r * lat_rad.cos() * dlat_dt,
    }
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
    /// Satellite epoch offset (seconds since 16:00 UTC, when sat crosses equator northbound).
    t_ref: f64,
    /// Combined bias: SDU oscillator + satellite compensation + downlink Doppler.
    bias: f64,
}

impl BfoModel {
    /// Calibrate the model from known data points.
    ///
    /// Uses the 16:00 ground point (aircraft stationary) and 16:41 early-flight
    /// point (known position, heading NE ~25°, speed ~450 kts) to solve for
    /// `t_ref` and `bias`.
    pub fn calibrate() -> Self {
        // Known aircraft states for calibration: (pos, heading_deg, speed_kts, time_s, measured_bfo)
        let cal_points: &[(LatLon, f64, f64, f64, f64)] = &[
            (KLIA, 0.0, 0.0, 0.0, 142.0),                             // 16:00 ground
            (LatLon::new(3.5, 102.2), 25.0, 450.0, 2460.0, 175.0),    // 16:41 climbing
            (LatLon::new(5.7, 103.0), 25.0, 470.0, 4020.0, 142.0),    // 17:07 cruise
        ];

        let mut best_t_ref = 0.0_f64;
        let mut best_error = f64::MAX;

        // Grid search over one orbital period for t_ref
        let steps = 8616;
        for i in 0..steps {
            let t_ref = -86164.0 + (i as f64) * 20.0;

            // Derive bias from ground point (speed = 0, so only satellite Doppler)
            let rr_ground = Self::raw_range_rate(KLIA, 0.0, 0.0, 0.0, t_ref);
            let bias = BFO_GROUND - (F_UPLINK_HZ / C_M_S) * rr_ground;

            // Total squared error across all calibration points
            let error: f64 = cal_points
                .iter()
                .map(|&(pos, hdg, spd, t, measured)| {
                    let rr = Self::raw_range_rate(pos, hdg, spd, t, t_ref);
                    let predicted = (F_UPLINK_HZ / C_M_S) * rr + bias;
                    (predicted - measured).powi(2)
                })
                .sum();

            if error < best_error {
                best_error = error;
                best_t_ref = t_ref;
            }
        }

        // Recompute bias at best t_ref
        let rr_ground = Self::raw_range_rate(KLIA, 0.0, 0.0, 0.0, best_t_ref);
        let bias = BFO_GROUND - (F_UPLINK_HZ / C_M_S) * rr_ground;

        BfoModel {
            t_ref: best_t_ref,
            bias,
        }
    }

    /// Raw range rate (m/s) for a given aircraft state and t_ref.
    fn raw_range_rate(
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        t_ref: f64,
    ) -> f64 {
        let speed_km_s = speed_kts * 1.852 / 3600.0;

        let ac_pos = to_ecef(pos.lat, pos.lon, AIRCRAFT_ALT_KM);
        let ac_vel = aircraft_velocity_ecef(pos, heading_deg, speed_km_s);
        let sat_pos = satellite_position(time_s, t_ref);
        let sat_vel = satellite_velocity(time_s, t_ref);

        // range_rate in km/s → convert to m/s
        range_rate(ac_pos, ac_vel, sat_pos, sat_vel) * 1000.0
    }

    /// Predict BFO (Hz) for a given aircraft state.
    pub fn predict(
        &self,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
    ) -> f64 {
        let rr = Self::raw_range_rate(pos, heading_deg, speed_kts, time_s, self.t_ref);
        (F_UPLINK_HZ / C_M_S) * rr + self.bias
    }

    /// BFO residual: predicted - measured (Hz).
    pub fn residual(
        &self,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        measured_bfo: f64,
    ) -> f64 {
        self.predict(pos, heading_deg, speed_kts, time_s) - measured_bfo
    }

    /// Score a candidate point on the 7th arc by finding the best-matching heading.
    ///
    /// Scans southward headings (150–250°), computes BFO residual at each,
    /// and returns a score in [0, 1] where 1 = perfect BFO match.
    /// Also takes a speed range to scan over.
    pub fn score_7th_arc_point(
        &self,
        pos: LatLon,
        measured_bfo: f64,
        time_s: f64,
    ) -> f64 {
        let mut best_residual = f64::MAX;

        // Scan headings and speeds
        for hdg_i in 0..100 {
            let heading = 150.0 + hdg_i as f64;
            for spd_i in 0..7 {
                let speed = 400.0 + spd_i as f64 * 20.0;
                let r = self.residual(pos, heading, speed, time_s, measured_bfo).abs();
                if r < best_residual {
                    best_residual = r;
                }
            }
        }

        // Convert residual to score: Gaussian with σ ≈ 7 Hz (typical BFO noise)
        let sigma = 7.0;
        (-best_residual.powi(2) / (2.0 * sigma * sigma)).exp()
    }
}
