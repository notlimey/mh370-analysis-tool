use std::f64::consts::PI;
use std::sync::Once;

use serde::Deserialize;

use super::data::AnalysisConfig;
use super::geometry::LatLon;

const EARTH_RADIUS_KM: f64 = 6_371.0;
const GEO_RADIUS_KM: f64 = 42_164.0;
const DEFAULT_PEAK_UTC_HOURS: f64 = 19.5;
#[allow(dead_code)]
const DEFAULT_EQUATOR_CROSSING_UTC_HOURS: f64 = 25.5;
const OSCILLATION_PERIOD_HOURS: f64 = 24.0;
const EMBEDDED_EPHEMERIS_JSON: &str = include_str!("../../../src/data/i3f1_ephemeris.json");

static BELOW_RANGE_WARNING: Once = Once::new();
static ABOVE_RANGE_WARNING: Once = Once::new();

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct SatState {
    pub utc_hours: f64,
    pub x_km: f64,
    pub y_km: f64,
    pub z_km: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct SatStateGeodetic {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_km: f64,
    pub vx_km_s: f64,
    pub vy_km_s: f64,
    pub vz_km_s: f64,
}

#[derive(Debug, Clone)]
pub struct SatelliteModel {
    ephemeris: Vec<SatState>,
}

impl SatelliteModel {
    pub fn load() -> Result<Self, String> {
        let ephemeris: Vec<SatState> = serde_json::from_str(EMBEDDED_EPHEMERIS_JSON)
            .map_err(|err| format!("failed to parse embedded I3F1 ephemeris: {err}"))?;
        validate_ephemeris(&ephemeris)?;
        Ok(Self { ephemeris })
    }

    pub fn sat_state_at(&self, utc_hours: f64, config: &AnalysisConfig) -> SatStateGeodetic {
        let first = self
            .ephemeris
            .first()
            .expect("validated ephemeris has points");
        let last = self
            .ephemeris
            .last()
            .expect("validated ephemeris has points");

        if utc_hours < first.utc_hours {
            BELOW_RANGE_WARNING.call_once(|| {
                eprintln!(
                    "warning: satellite ephemeris starts at {:.3} UTC hours; falling back to sinusoidal model before that range",
                    first.utc_hours
                );
            });
            return fallback_state(utc_hours, config);
        }

        if utc_hours > last.utc_hours {
            ABOVE_RANGE_WARNING.call_once(|| {
                eprintln!(
                    "warning: satellite ephemeris ends at {:.3} UTC hours; falling back to sinusoidal model after that range",
                    last.utc_hours
                );
            });
            return fallback_state(utc_hours, config);
        }

        interpolate_ephemeris(utc_hours, &self.ephemeris)
    }
}

pub fn sat_state_at_time_s(
    satellite: &SatelliteModel,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<SatStateGeodetic, String> {
    let utc_hours = seconds_to_utc_hours(time_s);
    sat_state_at_utc_hours(satellite, utc_hours, config)
}

pub fn sat_state_at_utc_hours(
    satellite: &SatelliteModel,
    utc_hours: f64,
    config: &AnalysisConfig,
) -> Result<SatStateGeodetic, String> {
    Ok(satellite.sat_state_at(utc_hours, config))
}

pub fn satellite_subpoint(
    satellite: &SatelliteModel,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<LatLon, String> {
    let state = sat_state_at_time_s(satellite, time_s, config)?;
    Ok(LatLon::new(state.lat_deg, state.lon_deg))
}

pub fn seconds_to_utc_hours(time_s: f64) -> f64 {
    16.0 + time_s / 3600.0
}

fn sat_position_approx(utc_hours: f64, config: &AnalysisConfig) -> (f64, f64, f64) {
    let amplitude_deg = config.satellite_drift_amplitude_deg.max(0.1);
    let amplitude_km = GEO_RADIUS_KM * amplitude_deg.to_radians().sin();
    let omega = 2.0 * PI / OSCILLATION_PERIOD_HOURS;
    let z_km = amplitude_km * (omega * (utc_hours - DEFAULT_PEAK_UTC_HOURS)).cos();
    let lon_rad = config.satellite_nominal_lon_deg.to_radians();
    let x_km = GEO_RADIUS_KM * lon_rad.cos();
    let y_km = GEO_RADIUS_KM * lon_rad.sin();
    (x_km, y_km, z_km)
}

fn sat_velocity_approx(utc_hours: f64, config: &AnalysisConfig) -> (f64, f64, f64) {
    let amplitude_deg = config.satellite_drift_amplitude_deg.max(0.1);
    let amplitude_km = GEO_RADIUS_KM * amplitude_deg.to_radians().sin();
    let omega = 2.0 * PI / OSCILLATION_PERIOD_HOURS;
    let vz_km_per_hour =
        -amplitude_km * omega * (omega * (utc_hours - DEFAULT_PEAK_UTC_HOURS)).sin();
    (0.0, 0.0, vz_km_per_hour / 3600.0)
}

fn fallback_state(utc_hours: f64, config: &AnalysisConfig) -> SatStateGeodetic {
    let (x_km, y_km, z_km) = sat_position_approx(utc_hours, config);
    let (vx, vy, vz) = sat_velocity_approx(utc_hours, config);
    ecef_to_geodetic(x_km, y_km, z_km, vx, vy, vz)
}

fn interpolate_ephemeris(utc_hours: f64, ephemeris: &[SatState]) -> SatStateGeodetic {
    if utc_hours <= ephemeris[0].utc_hours {
        let state = ephemeris[0];
        return ecef_to_geodetic(
            state.x_km, state.y_km, state.z_km, state.vx, state.vy, state.vz,
        );
    }
    if utc_hours >= ephemeris[ephemeris.len() - 1].utc_hours {
        let state = ephemeris[ephemeris.len() - 1];
        return ecef_to_geodetic(
            state.x_km, state.y_km, state.z_km, state.vx, state.vy, state.vz,
        );
    }

    let idx = ephemeris.partition_point(|state| state.utc_hours <= utc_hours);
    let idx = idx.min(ephemeris.len() - 1).max(1);
    let s0 = ephemeris[idx - 1];
    let s1 = ephemeris[idx];
    let dt_hours = (s1.utc_hours - s0.utc_hours).max(f64::EPSILON);
    let t = (utc_hours - s0.utc_hours) / dt_hours;

    let interpolate_axis = |p0: f64, p1: f64, v0_km_s: f64, v1_km_s: f64| {
        cubic_hermite_axis(p0, p1, v0_km_s, v1_km_s, dt_hours, t)
    };

    ecef_to_geodetic(
        interpolate_axis(s0.x_km, s1.x_km, s0.vx, s1.vx).0,
        interpolate_axis(s0.y_km, s1.y_km, s0.vy, s1.vy).0,
        interpolate_axis(s0.z_km, s1.z_km, s0.vz, s1.vz).0,
        interpolate_axis(s0.x_km, s1.x_km, s0.vx, s1.vx).1,
        interpolate_axis(s0.y_km, s1.y_km, s0.vy, s1.vy).1,
        interpolate_axis(s0.z_km, s1.z_km, s0.vz, s1.vz).1,
    )
}

fn cubic_hermite_axis(
    p0: f64,
    p1: f64,
    v0_km_s: f64,
    v1_km_s: f64,
    dt_hours: f64,
    t: f64,
) -> (f64, f64) {
    let m0 = v0_km_s * 3600.0;
    let m1 = v1_km_s * 3600.0;
    let t2 = t * t;
    let t3 = t2 * t;

    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;

    let position = h00 * p0 + h10 * dt_hours * m0 + h01 * p1 + h11 * dt_hours * m1;

    let dh00 = 6.0 * t2 - 6.0 * t;
    let dh10 = 3.0 * t2 - 4.0 * t + 1.0;
    let dh01 = -6.0 * t2 + 6.0 * t;
    let dh11 = 3.0 * t2 - 2.0 * t;
    let velocity_km_per_hour =
        (dh00 * p0 + dh10 * dt_hours * m0 + dh01 * p1 + dh11 * dt_hours * m1) / dt_hours;

    (position, velocity_km_per_hour / 3600.0)
}

fn ecef_to_geodetic(x: f64, y: f64, z: f64, vx: f64, vy: f64, vz: f64) -> SatStateGeodetic {
    let lon_deg = y.atan2(x).to_degrees();
    let r_xy = (x * x + y * y).sqrt();
    let lat_deg = z.atan2(r_xy).to_degrees();
    let alt_km = (x * x + y * y + z * z).sqrt() - EARTH_RADIUS_KM;

    SatStateGeodetic {
        lat_deg,
        lon_deg,
        alt_km,
        vx_km_s: vx,
        vy_km_s: vy,
        vz_km_s: vz,
    }
}

fn validate_ephemeris(ephemeris: &[SatState]) -> Result<(), String> {
    if ephemeris.len() < 2 {
        return Err("embedded ephemeris contained fewer than two usable states".to_string());
    }
    for window in ephemeris.windows(2) {
        if window[1].utc_hours <= window[0].utc_hours {
            return Err("embedded ephemeris utc_hours must be strictly increasing".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> AnalysisConfig {
        AnalysisConfig::default()
    }

    fn test_model() -> SatelliteModel {
        SatelliteModel::load().unwrap()
    }

    #[test]
    fn ephemeris_at_peak_northerly() {
        let state = sat_state_at_utc_hours(&test_model(), 19.5, &test_config());
        let state = state.unwrap();
        assert!(state.lat_deg > 1.0);
        assert!(state.lat_deg < 2.0);
    }

    #[test]
    fn ephemeris_at_equatorial_crossing() {
        let state = sat_state_at_utc_hours(
            &test_model(),
            DEFAULT_EQUATOR_CROSSING_UTC_HOURS,
            &test_config(),
        )
        .unwrap();
        assert!(state.lat_deg.abs() < 0.1);
        assert!(state.vz_km_s < 0.0);
    }

    #[test]
    fn ephemeris_continuity() {
        let model = test_model();
        let s1 = sat_state_at_utc_hours(&model, 20.0, &test_config()).unwrap();
        let s2 = sat_state_at_utc_hours(&model, 20.001, &test_config()).unwrap();
        let delta_lat = (s2.lat_deg - s1.lat_deg).abs();
        assert!(delta_lat < 0.001);
    }

    #[test]
    fn spline_hits_ephemeris_knots_exactly() {
        let model = test_model();
        let state = model.sat_state_at(24.167, &test_config());

        assert!((state.vx_km_s - 0.00160).abs() < 1e-9);
        assert!((state.vy_km_s + 0.00151).abs() < 1e-9);
        assert!((state.vz_km_s + 0.08188).abs() < 1e-9);
    }
}
