use serde_json::Value;
use std::fs;

const AIRSPACES_GEOJSON_PATH: &str = "/Users/entropy/Documents/repos/personal/mh370/src/data/airspaces_2014.geojson";

pub fn get_airspaces_geojson() -> Result<Value, String> {
    let raw = fs::read_to_string(AIRSPACES_GEOJSON_PATH)
        .map_err(|err| format!("failed to read airspaces GeoJSON {}: {err}", AIRSPACES_GEOJSON_PATH))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse airspaces GeoJSON {}: {err}", AIRSPACES_GEOJSON_PATH))
}
