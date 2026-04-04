use serde::Serialize;

use super::data::{
    good_bto_handshakes, load_dataset, nearest_known_altitude_ft, parse_time_utc_seconds,
    resolve_config, AnalysisConfig, InmarsatHandshake, Mh370Dataset,
};
use super::geometry::{destination_point, haversine, LatLon};
use super::satellite::satellite_subpoint;

const SPEED_OF_LIGHT_KM_PER_S: f64 = 299_792.458;
const EARTH_RADIUS_KM: f64 = 6_371.0;
const GEO_RADIUS_KM: f64 = 42_164.0;
const FT_TO_KM: f64 = 0.000_304_8;

#[derive(Debug, Clone, Serialize)]
pub struct BtoCalibration {
    pub offset_us: f64,
    pub sample_count: usize,
    pub samples: Vec<BtoCalibrationSample>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BtoCalibrationSample {
    pub time_utc: String,
    pub bto_us: f64,
    pub slant_range_km: f64,
    pub derived_offset_us: f64,
    pub aircraft_position: LatLon,
    pub satellite_subpoint: LatLon,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArcRing {
    pub arc: u8,
    pub time_utc: String,
    pub time_s: f64,
    pub bto_us: f64,
    pub range_km: f64,
    pub surface_distance_km: f64,
    pub satellite_subpoint: [f64; 2],
    pub points: Vec<[f64; 2]>,
}

pub fn calibrate_bto_offset(config: Option<AnalysisConfig>) -> Result<BtoCalibration, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    calibrate_bto_offset_from_dataset(&dataset, &config)
}

pub fn generate_arc_rings(config: Option<AnalysisConfig>) -> Result<Vec<ArcRing>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    generate_arc_rings_from_dataset(&dataset, &config)
}

pub fn calibrate_bto_offset_from_dataset(
    dataset: &Mh370Dataset,
    config: &AnalysisConfig,
) -> Result<BtoCalibration, String> {
    let mut samples = Vec::new();

    for handshake in dataset
        .inmarsat_handshakes
        .iter()
        .filter(|handshake| handshake.position_known && handshake.bto_us.is_some())
    {
        let lat = handshake
            .lat
            .ok_or_else(|| format!("missing lat for calibration handshake {}", handshake.time_utc))?;
        let lon = handshake
            .lon
            .ok_or_else(|| format!("missing lon for calibration handshake {}", handshake.time_utc))?;
        let time_s = parse_time_utc_seconds(&handshake.time_utc)?;
        let altitude_ft = nearest_known_altitude_ft(dataset, time_s, config.calibration_altitude_ft);
        let aircraft_altitude_km = altitude_ft * FT_TO_KM;
        let aircraft_position = LatLon::new(lat, lon);
        let satellite_subpoint = satellite_subpoint(time_s, config)?;
        let slant_range_km = slant_range_km(aircraft_position, aircraft_altitude_km, satellite_subpoint);
        let bto_us = handshake.bto_us.unwrap_or_default();
        let derived_offset_us = bto_us - 2.0 * slant_range_km / SPEED_OF_LIGHT_KM_PER_S * 1_000_000.0;

        samples.push(BtoCalibrationSample {
            time_utc: handshake.time_utc.clone(),
            bto_us,
            slant_range_km,
            derived_offset_us,
            aircraft_position,
            satellite_subpoint,
        });
    }

    if samples.is_empty() {
        return Err("no known-position BTO records available for calibration".to_string());
    }

    let offset_us = samples.iter().map(|sample| sample.derived_offset_us).sum::<f64>() / samples.len() as f64;

    Ok(BtoCalibration {
        offset_us,
        sample_count: samples.len(),
        samples,
    })
}

pub fn generate_arc_rings_from_dataset(
    dataset: &Mh370Dataset,
    config: &AnalysisConfig,
) -> Result<Vec<ArcRing>, String> {
    let calibration = calibrate_bto_offset_from_dataset(dataset, config)?;

    good_bto_handshakes(dataset)
        .into_iter()
        .map(|handshake| build_arc_ring(handshake, calibration.offset_us, config))
        .collect()
}

pub fn build_arc_ring(
    handshake: &InmarsatHandshake,
    calibrated_offset_us: f64,
    config: &AnalysisConfig,
) -> Result<ArcRing, String> {
    let time_s = parse_time_utc_seconds(&handshake.time_utc)?;
    let bto_us = handshake
        .bto_us
        .ok_or_else(|| format!("missing BTO for handshake {}", handshake.time_utc))?;
    let slant_range_km = bto_to_slant_range_km(bto_us, calibrated_offset_us);
    let satellite_subpoint = satellite_subpoint(time_s, config)?;
    let surface_distance_km = slant_range_to_surface_distance_km(slant_range_km, config.cruise_altitude_ft * FT_TO_KM)?;

    let points = (0..config.ring_points.max(12))
        .map(|index| {
            let bearing = 360.0 * index as f64 / config.ring_points.max(12) as f64;
            let point = destination_point(satellite_subpoint, bearing, surface_distance_km);
            [point.lon, point.lat]
        })
        .collect();

    Ok(ArcRing {
        arc: handshake.arc,
        time_utc: handshake.time_utc.clone(),
        time_s,
        bto_us,
        range_km: slant_range_km,
        surface_distance_km,
        satellite_subpoint: [satellite_subpoint.lon, satellite_subpoint.lat],
        points,
    })
}

pub fn bto_to_slant_range_km(bto_us: f64, calibrated_offset_us: f64) -> f64 {
    (bto_us - calibrated_offset_us) * 1e-6 * SPEED_OF_LIGHT_KM_PER_S / 2.0
}

pub fn slant_range_to_surface_distance_km(
    slant_range_km: f64,
    aircraft_altitude_km: f64,
) -> Result<f64, String> {
    let aircraft_radius = EARTH_RADIUS_KM + aircraft_altitude_km;
    let numerator = GEO_RADIUS_KM.powi(2) + aircraft_radius.powi(2) - slant_range_km.powi(2);
    let denominator = 2.0 * GEO_RADIUS_KM * aircraft_radius;
    let cos_theta = (numerator / denominator).clamp(-1.0, 1.0);
    let theta = cos_theta.acos();
    if !theta.is_finite() {
        return Err("failed to derive central angle from slant range".to_string());
    }
    Ok(theta * EARTH_RADIUS_KM)
}

pub fn slant_range_km(
    aircraft_position: LatLon,
    aircraft_altitude_km: f64,
    satellite_subpoint: LatLon,
) -> f64 {
    let central_angle = haversine(aircraft_position, satellite_subpoint) / EARTH_RADIUS_KM;
    let aircraft_radius = EARTH_RADIUS_KM + aircraft_altitude_km;
    (GEO_RADIUS_KM.powi(2) + aircraft_radius.powi(2)
        - 2.0 * GEO_RADIUS_KM * aircraft_radius * central_angle.cos())
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mh370::data::Mh370Dataset;

    fn test_config() -> AnalysisConfig {
        AnalysisConfig {
            ring_points: 36,
            ..AnalysisConfig::default()
        }
    }

    fn test_dataset() -> Mh370Dataset {
        serde_json::from_str(
            r#"{
                "satellite": {"id":"sat","orbit":"geo","longitude_deg":64.5,"latitude_deg":0.0},
                "aircraft": {"registration":"9M-MRO","type":"777","typical_cruise_speed_kts":471.0,"typical_cruise_altitude_ft":35000.0,"typical_fuel_flow_kg_per_hr":6500.0},
                "known_positions": [
                    {"time_utc":"16:00:13.406","source":"gate","lat":3.12,"lon":101.69,"altitude_ft":0},
                    {"time_utc":"16:42:04.408","source":"atc","lat":3.12,"lon":101.69,"altitude_ft":0}
                ],
                "inmarsat_handshakes": [
                    {"arc":0,"time_utc":"16:00:13.406","bto_us":14840.0,"bfo_hz":88.0,"message_type":"logon","position_known":true,"lat":3.12,"lon":101.69},
                    {"arc":0,"time_utc":"16:42:04.408","bto_us":14920.0,"bfo_hz":142.0,"message_type":"ack","position_known":true,"lat":3.12,"lon":101.69},
                    {"arc":1,"time_utc":"18:25:27.421","bto_us":12520.0,"bfo_hz":273.0,"message_type":"request","reliability":"UNRELIABLE_BFO"},
                    {"arc":1,"time_utc":"18:25:34.461","bto_us":11500.0,"bfo_hz":240.0,"message_type":"ack","reliability":"UNRELIABLE_BFO","flag":"CRITICAL_ANOMALY"},
                    {"arc":2,"time_utc":"19:41:02.906","bto_us":14060.0,"bfo_hz":182.0,"message_type":"hourly","reliability":"GOOD"}
                ],
                "confirmed_debris": [],
                "searched_zones": []
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn calibrates_offset_from_known_positions() {
        let dataset = test_dataset();
        let calibration = calibrate_bto_offset_from_dataset(&dataset, &test_config()).unwrap();

        assert_eq!(calibration.sample_count, 2);
        assert!(calibration.offset_us.is_finite());
        assert_ne!(calibration.offset_us.round(), 495_679.0);
    }

    #[test]
    fn excludes_critical_anomaly_arc() {
        let dataset = test_dataset();
        let rings = generate_arc_rings_from_dataset(&dataset, &test_config()).unwrap();

        assert_eq!(rings.len(), 2);
        let arc1_count = rings.iter().filter(|ring| ring.arc == 1).count();
        assert_eq!(arc1_count, 1);
        assert_eq!(rings.iter().find(|ring| ring.arc == 1).unwrap().bto_us, 12_520.0);
    }
}
