use std::fs;

use serde::{Deserialize, Serialize};

pub const DEFAULT_DATASET_PATH: &str = "/Users/entropy/Downloads/mh370_data.json";
pub const ANALYSIS_EPOCH_HOUR_UTC: u32 = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisConfig {
    pub dataset_path: String,
    pub satellite_ephemeris_path: String,
    pub ring_points: usize,
    pub min_speed_kts: f64,
    pub max_speed_kts: f64,
    pub cruise_altitude_ft: f64,
    pub calibration_altitude_ft: f64,
    pub beam_width: usize,
    pub ring_sample_step: usize,
    pub speed_consistency_sigma_kts: f64,
    pub heading_change_sigma_deg: f64,
    pub satellite_nominal_lon_deg: f64,
    pub satellite_nominal_lat_deg: f64,
    pub satellite_drift_start_lat_offset_deg: f64,
    pub satellite_drift_end_lat_offset_deg: f64,
    pub satellite_drift_end_time_utc: String,
    pub fuel_remaining_at_arc1_kg: f64,
    pub fuel_baseline_kg_per_hr: f64,
    pub fuel_baseline_speed_kts: f64,
    pub fuel_baseline_altitude_ft: f64,
    pub fuel_speed_exponent: f64,
    pub fuel_low_altitude_penalty_per_10kft: f64,
    pub post_arc7_low_speed_kts: f64,
    pub max_post_arc7_minutes: f64,
    pub arc7_grid_min_lat: f64,
    pub arc7_grid_max_lat: f64,
    pub arc7_grid_points: usize,
    pub debris_weight_min_lat: f64,
    pub debris_weight_max_lat: f64,
    pub slow_family_max_speed_kts: f64,
    pub perpendicular_family_tolerance_deg: f64,
}

impl Default for AnalysisConfig {
    fn default() -> Self {
        Self {
            dataset_path: DEFAULT_DATASET_PATH.to_string(),
            satellite_ephemeris_path: String::new(),
            ring_points: 360,
            min_speed_kts: 350.0,
            max_speed_kts: 520.0,
            cruise_altitude_ft: 35_000.0,
            calibration_altitude_ft: 0.0,
            beam_width: 256,
            ring_sample_step: 10,
            speed_consistency_sigma_kts: 35.0,
            heading_change_sigma_deg: 80.0,
            satellite_nominal_lon_deg: 64.5,
            satellite_nominal_lat_deg: 0.0,
            satellite_drift_start_lat_offset_deg: 0.0,
            satellite_drift_end_lat_offset_deg: -1.6,
            satellite_drift_end_time_utc: "00:19:29.416".to_string(),
            fuel_remaining_at_arc1_kg: 33_500.0,
            fuel_baseline_kg_per_hr: 6_500.0,
            fuel_baseline_speed_kts: 471.0,
            fuel_baseline_altitude_ft: 35_000.0,
            fuel_speed_exponent: 1.35,
            fuel_low_altitude_penalty_per_10kft: 0.12,
            post_arc7_low_speed_kts: 420.0,
            max_post_arc7_minutes: 57.0,
            arc7_grid_min_lat: -45.0,
            arc7_grid_max_lat: -10.0,
            arc7_grid_points: 180,
            debris_weight_min_lat: -38.0,
            debris_weight_max_lat: -32.0,
            slow_family_max_speed_kts: 390.0,
            perpendicular_family_tolerance_deg: 20.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatelliteData {
    pub id: String,
    pub orbit: String,
    pub longitude_deg: f64,
    pub latitude_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AircraftData {
    pub registration: String,
    #[serde(rename = "type")]
    pub aircraft_type: String,
    pub typical_cruise_speed_kts: f64,
    pub typical_cruise_altitude_ft: f64,
    pub typical_fuel_flow_kg_per_hr: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownPosition {
    pub time_utc: String,
    pub source: String,
    pub lat: f64,
    pub lon: f64,
    pub altitude_ft: Option<f64>,
    pub speed_kts: Option<f64>,
    pub heading_deg: Option<f64>,
    pub fuel_remaining_kg: Option<f64>,
    pub note: Option<String>,
    pub reliability: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InmarsatHandshake {
    pub arc: u8,
    pub time_utc: String,
    pub bto_us: Option<f64>,
    pub bfo_hz: Option<f64>,
    pub message_type: String,
    pub note: Option<String>,
    #[serde(default)]
    pub position_known: bool,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub reliability: Option<String>,
    pub flag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmedDebris {
    pub item: String,
    pub found_date: String,
    pub location: String,
    pub lat: f64,
    pub lon: f64,
    pub confirmed_mh370: serde_json::Value,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchZone {
    pub id: String,
    pub searcher: String,
    pub period: String,
    pub area_km2: f64,
    pub arc_latitude_range: String,
    pub result: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mh370Dataset {
    pub satellite: SatelliteData,
    pub aircraft: AircraftData,
    pub known_positions: Vec<KnownPosition>,
    pub inmarsat_handshakes: Vec<InmarsatHandshake>,
    pub confirmed_debris: Vec<ConfirmedDebris>,
    pub searched_zones: Vec<SearchZone>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandshakeView {
    pub arc: u8,
    pub time_utc: String,
    pub time_s: f64,
    pub bto: Option<f64>,
    pub bfo: Option<f64>,
    pub reliability: Option<String>,
    pub flag: Option<String>,
    pub position_known: bool,
    pub note: String,
}

pub fn resolve_config(config: Option<AnalysisConfig>) -> AnalysisConfig {
    config.unwrap_or_default()
}

pub fn load_dataset(config: &AnalysisConfig) -> Result<Mh370Dataset, String> {
    let raw = fs::read_to_string(&config.dataset_path)
        .map_err(|err| format!("failed to read {}: {err}", config.dataset_path))?;
    serde_json::from_str(&raw).map_err(|err| format!("failed to parse dataset JSON: {err}"))
}

pub fn parse_time_utc_seconds(time_utc: &str) -> Result<f64, String> {
    let mut parts = time_utc.split(':');
    let hour = parts
        .next()
        .ok_or_else(|| format!("missing hour in time {time_utc}"))?
        .parse::<u32>()
        .map_err(|err| format!("invalid hour in time {time_utc}: {err}"))?;
    let minute = parts
        .next()
        .ok_or_else(|| format!("missing minute in time {time_utc}"))?
        .parse::<u32>()
        .map_err(|err| format!("invalid minute in time {time_utc}: {err}"))?;
    let second = parts
        .next()
        .unwrap_or("0")
        .parse::<f64>()
        .map_err(|err| format!("invalid second in time {time_utc}: {err}"))?;

    let mut hour_value = hour as f64;
    if hour < ANALYSIS_EPOCH_HOUR_UTC {
        hour_value += 24.0;
    }

    Ok((hour_value - ANALYSIS_EPOCH_HOUR_UTC as f64) * 3600.0 + minute as f64 * 60.0 + second)
}

pub fn handshake_views(dataset: &Mh370Dataset) -> Result<Vec<HandshakeView>, String> {
    dataset
        .inmarsat_handshakes
        .iter()
        .map(|handshake| {
            Ok(HandshakeView {
                arc: handshake.arc,
                time_utc: handshake.time_utc.clone(),
                time_s: parse_time_utc_seconds(&handshake.time_utc)?,
                bto: handshake.bto_us,
                bfo: handshake.bfo_hz,
                reliability: handshake.reliability.clone(),
                flag: handshake.flag.clone(),
                position_known: handshake.position_known,
                note: handshake.note.clone().unwrap_or_default(),
            })
        })
        .collect()
}

pub fn nearest_known_altitude_ft(dataset: &Mh370Dataset, time_s: f64, default_altitude_ft: f64) -> f64 {
    dataset
        .known_positions
        .iter()
        .filter_map(|position| {
            let position_time_s = parse_time_utc_seconds(&position.time_utc).ok()?;
            let altitude_ft = position.altitude_ft?;
            Some(((position_time_s - time_s).abs(), altitude_ft))
        })
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
        .map(|(_, altitude_ft)| altitude_ft)
        .unwrap_or(default_altitude_ft)
}

pub fn good_bto_handshakes<'a>(dataset: &'a Mh370Dataset) -> Vec<&'a InmarsatHandshake> {
    dataset
        .inmarsat_handshakes
        .iter()
        .filter(|handshake| {
            handshake.bto_us.is_some()
                && !matches!(handshake.flag.as_deref(), Some("CRITICAL_ANOMALY"))
                && matches!(
                    handshake.reliability.as_deref(),
                    Some("GOOD") | Some("GOOD_BTO_UNCERTAIN_BFO") | Some("UNRELIABLE_BFO")
                )
        })
        .collect()
}

pub fn primary_arc_handshakes<'a>(dataset: &'a Mh370Dataset) -> Vec<&'a InmarsatHandshake> {
    let mut selected = Vec::new();
    for arc in 1..=7 {
        let best = dataset
            .inmarsat_handshakes
            .iter()
            .filter(|handshake| handshake.arc == arc && handshake.bto_us.is_some())
            .filter(|handshake| !matches!(handshake.flag.as_deref(), Some("CRITICAL_ANOMALY")))
            .filter(|handshake| {
                matches!(
                    handshake.reliability.as_deref(),
                    Some("GOOD") | Some("GOOD_BTO_UNCERTAIN_BFO") | Some("UNRELIABLE_BFO")
                )
            })
            .max_by(|left, right| {
                let left_time = parse_time_utc_seconds(&left.time_utc).unwrap_or_default();
                let right_time = parse_time_utc_seconds(&right.time_utc).unwrap_or_default();
                left_time.partial_cmp(&right_time).unwrap()
            });

        if let Some(handshake) = best {
            selected.push(handshake);
        }
    }
    selected
}
