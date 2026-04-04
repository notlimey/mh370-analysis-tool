use serde::Serialize;

use super::data::{load_dataset, resolve_config, AnalysisConfig};

const REFERENCE_CRASH_LAT: f64 = -35.0;
const REFERENCE_CRASH_LON: f64 = 94.0;
const CURRENT_SPEED_KM_PER_DAY: f64 = 17.0;

#[derive(Debug, Clone, Serialize)]
pub struct DebrisItem {
    pub name: String,
    pub found_location: [f64; 2],
    pub date_found: String,
    pub days_adrift: f64,
    pub drift_line: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebrisLogItem {
    pub id: String,
    pub item_description: String,
    pub find_date: String,
    pub find_location_name: String,
    pub lat: f64,
    pub lon: f64,
    pub confirmation: String,
    pub confirmed_by: Option<String>,
    pub barnacle_analysis_done: bool,
    pub barnacle_analysis_available: bool,
    pub oldest_barnacle_age_estimate: Option<String>,
    pub initial_water_temp_from_barnacle: Option<f64>,
    pub used_in_drift_models: Vec<String>,
    pub notes: String,
}

pub fn reverse_drift_debris(config: Option<AnalysisConfig>) -> Result<Vec<DebrisItem>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;

    Ok(dataset
        .confirmed_debris
        .iter()
        .map(|item| {
            let days_adrift = approx_days_since_2014_03_08(&item.found_date);
            let reverse_distance_km = days_adrift * CURRENT_SPEED_KM_PER_DAY;
            let lon_shift_deg = reverse_distance_km / (111.32 * item.lat.to_radians().cos()).abs().max(15.0);
            let source_lon = (item.lon + lon_shift_deg).clamp(REFERENCE_CRASH_LON - 20.0, REFERENCE_CRASH_LON + 20.0);
            let source_lat = REFERENCE_CRASH_LAT + (item.lat - REFERENCE_CRASH_LAT) * 0.15;

            let drift_line = (0..=24)
                .map(|index| {
                    let fraction = index as f64 / 24.0;
                    let lon = item.lon + (source_lon - item.lon) * fraction;
                    let lat = item.lat + (source_lat - item.lat) * fraction;
                    [lon, lat]
                })
                .collect();

            DebrisItem {
                name: item.item.clone(),
                found_location: [item.lon, item.lat],
                date_found: item.found_date.clone(),
                days_adrift,
                drift_line,
            }
        })
        .collect())
}

pub fn get_debris_log(config: Option<AnalysisConfig>) -> Result<Vec<DebrisLogItem>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;

    Ok(dataset
        .confirmed_debris
        .iter()
        .map(|item| DebrisLogItem {
            id: slugify(&item.item),
            item_description: item.item.clone(),
            find_date: item.found_date.clone(),
            find_location_name: item.location.clone(),
            lat: item.lat,
            lon: item.lon,
            confirmation: confirmation_label(&item.confirmed_mh370),
            confirmed_by: match item.confirmed_mh370.as_bool() {
                Some(true) => Some("Official investigation".to_string()),
                _ => None,
            },
            barnacle_analysis_done: item.item.to_lowercase().contains("flaperon"),
            barnacle_analysis_available: !item.item.to_lowercase().contains("flaperon"),
            oldest_barnacle_age_estimate: if item.item.to_lowercase().contains("flaperon") {
                Some("largest specimens withheld".to_string())
            } else {
                None
            },
            initial_water_temp_from_barnacle: if item.item.to_lowercase().contains("flaperon") {
                Some(27.0)
            } else {
                None
            },
            used_in_drift_models: vec!["CSIRO corridor weighting".to_string()],
            notes: item.note.clone().unwrap_or_default(),
        })
        .collect())
}

fn confirmation_label(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Bool(true) => "confirmed".to_string(),
        serde_json::Value::String(label) => label.to_lowercase(),
        _ => "unverified".to_string(),
    }
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Approximate days elapsed since 2014-03-08.
/// Uses 30-day months — error of up to ±3 days over a 2-year span,
/// which at ~17 km/day drift speed corresponds to ~51 km position error.
fn approx_days_since_2014_03_08(date: &str) -> f64 {
    let mut parts = date.split('-');
    let year = parts.next().and_then(|value| value.parse::<i32>().ok()).unwrap_or(2014);
    let month = parts.next().and_then(|value| value.parse::<i32>().ok()).unwrap_or(3);
    let day = parts.next().and_then(|value| value.parse::<i32>().ok()).unwrap_or(8);

    let start_days = 2014 * 365 + 3 * 30 + 8;
    let end_days = year * 365 + month * 30 + day;
    (end_days - start_days) as f64
}
