use std::f64::consts::PI;
use std::fs;
use std::sync::{Mutex, OnceLock};

use super::data::AnalysisConfig;
use super::geometry::LatLon;

const EARTH_RADIUS_KM: f64 = 6_371.0;
const GEO_RADIUS_KM: f64 = 42_164.0;
const DEFAULT_PEAK_UTC_HOURS: f64 = 19.5;
#[allow(dead_code)]
const DEFAULT_EQUATOR_CROSSING_UTC_HOURS: f64 = 25.5;
const OSCILLATION_PERIOD_HOURS: f64 = 24.0;

#[derive(Debug, Clone, Copy)]
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

pub const EPHEMERIS: &[SatState] = &[];

static EPHEMERIS_CACHE: OnceLock<Mutex<std::collections::HashMap<String, Result<Vec<SatState>, String>>>> = OnceLock::new();

pub fn sat_state_at_time_s(time_s: f64, config: &AnalysisConfig) -> Result<SatStateGeodetic, String> {
    let utc_hours = seconds_to_utc_hours(time_s);
    sat_state_at_utc_hours(utc_hours, config)
}

pub fn sat_state_at_utc_hours(utc_hours: f64, config: &AnalysisConfig) -> Result<SatStateGeodetic, String> {
    if let Some(ephemeris) = load_ephemeris_file(config)? {
        Ok(interpolate_ephemeris(utc_hours, &ephemeris))
    } else if EPHEMERIS.len() >= 2 {
        Ok(interpolate_ephemeris(utc_hours, EPHEMERIS))
    } else {
        let (x_km, y_km, z_km) = sat_position_approx(utc_hours, config);
        let (vx, vy, vz) = sat_velocity_approx(utc_hours, config);
        Ok(ecef_to_geodetic(x_km, y_km, z_km, vx, vy, vz))
    }
}

pub fn satellite_subpoint(time_s: f64, config: &AnalysisConfig) -> Result<LatLon, String> {
    let state = sat_state_at_time_s(time_s, config)?;
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
    let vz_km_per_hour = -amplitude_km * omega * (omega * (utc_hours - DEFAULT_PEAK_UTC_HOURS)).sin();
    (0.0, 0.0, vz_km_per_hour / 3600.0)
}

fn interpolate_ephemeris(utc_hours: f64, ephemeris: &[SatState]) -> SatStateGeodetic {
    let idx = ephemeris.partition_point(|state| state.utc_hours <= utc_hours);
    let idx = idx.min(ephemeris.len() - 1).max(1);
    let s0 = ephemeris[idx - 1];
    let s1 = ephemeris[idx];
    let t = if (s1.utc_hours - s0.utc_hours).abs() <= f64::EPSILON {
        0.0
    } else {
        (utc_hours - s0.utc_hours) / (s1.utc_hours - s0.utc_hours)
    };
    let lerp = |a: f64, b: f64| a + t * (b - a);

    ecef_to_geodetic(
        lerp(s0.x_km, s1.x_km),
        lerp(s0.y_km, s1.y_km),
        lerp(s0.z_km, s1.z_km),
        lerp(s0.vx, s1.vx),
        lerp(s0.vy, s1.vy),
        lerp(s0.vz, s1.vz),
    )
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

fn load_ephemeris_file(config: &AnalysisConfig) -> Result<Option<Vec<SatState>>, String> {
    if config.satellite_ephemeris_path.trim().is_empty() {
        return Ok(None);
    }

    let cache = EPHEMERIS_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    let mut cache_guard = cache.lock().map_err(|_| "failed to lock ephemeris cache".to_string())?;
    if let Some(cached) = cache_guard.get(&config.satellite_ephemeris_path) {
        return cached.clone().map(Some);
    }

    let parsed = parse_ephemeris_file(&config.satellite_ephemeris_path);
    cache_guard.insert(config.satellite_ephemeris_path.clone(), parsed.clone());
    parsed.map(Some)
}

fn parse_ephemeris_file(path: &str) -> Result<Vec<SatState>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("failed to read satellite ephemeris file {}: {err}", path))?;
    let mut states = Vec::new();

    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed
            .split(|ch: char| ch == ',' || ch.is_whitespace())
            .filter(|part| !part.is_empty())
            .collect();
        if parts.len() < 7 {
            return Err(format!("invalid ephemeris row {} in {}: expected 7 columns", index + 1, path));
        }

        let values: Result<Vec<f64>, String> = parts
            .iter()
            .take(7)
            .map(|part| {
                part.parse::<f64>()
                    .map_err(|err| format!("invalid ephemeris value '{}' in {} row {}: {err}", part, path, index + 1))
            })
            .collect();
        let values = values?;

        states.push(SatState {
            utc_hours: values[0],
            x_km: values[1],
            y_km: values[2],
            z_km: values[3],
            vx: values[4],
            vy: values[5],
            vz: values[6],
        });
    }

    if states.len() >= 2 {
        Ok(states)
    } else {
        Err(format!("ephemeris file {} contained fewer than two usable states", path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> AnalysisConfig {
        AnalysisConfig::default()
    }

    #[test]
    fn ephemeris_at_peak_northerly() {
        let state = sat_state_at_utc_hours(19.5, &test_config());
        let state = state.unwrap();
        assert!(state.lat_deg > 1.0);
        assert!(state.lat_deg < 2.0);
    }

    #[test]
    fn ephemeris_at_equatorial_crossing() {
        let state = sat_state_at_utc_hours(DEFAULT_EQUATOR_CROSSING_UTC_HOURS, &test_config()).unwrap();
        assert!(state.lat_deg.abs() < 0.1);
        assert!(state.vz_km_s < 0.0);
    }

    #[test]
    fn ephemeris_continuity() {
        let s1 = sat_state_at_utc_hours(20.0, &test_config()).unwrap();
        let s2 = sat_state_at_utc_hours(20.001, &test_config()).unwrap();
        let delta_lat = (s2.lat_deg - s1.lat_deg).abs();
        assert!(delta_lat < 0.001);
    }
}
