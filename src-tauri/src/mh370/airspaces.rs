use serde_json::Value;

const AIRSPACES_GEOJSON: &str = include_str!("../../../src/data/airspaces_2014.geojson");

pub fn get_airspaces_geojson() -> Result<Value, String> {
    serde_json::from_str(AIRSPACES_GEOJSON)
        .map_err(|err| format!("failed to parse embedded airspaces GeoJSON: {err}"))
}
