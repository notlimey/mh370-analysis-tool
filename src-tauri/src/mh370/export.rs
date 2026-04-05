use std::path::Path;

use serde_json::json;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::data::{load_dataset, resolve_config, AnalysisConfig};
use super::debris_inversion::{load_debris_items, run_joint_inversion, sample_7th_arc};
use super::paths::{sample_candidate_paths_from_dataset, FlightPath};
use super::probability::{generate_probability_heatmap_from_dataset, ProbPoint};
use super::satellite::SatelliteModel;

pub fn export_probability_geojson(
    satellite: &SatelliteModel,
    path: String,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    let points = generate_probability_heatmap_from_dataset(satellite, &dataset, &config)?;
    let geojson = probability_to_geojson(&points, &config);
    let serialized = serde_json::to_string_pretty(&geojson)
        .map_err(|err| format!("serialization failed: {err}"))?;
    std::fs::write(&path, serialized).map_err(|err| format!("write failed: {err}"))?;
    Ok(format!(
        "Exported {} probability points to {}",
        points.len(),
        path
    ))
}

pub fn export_paths_geojson(
    satellite: &SatelliteModel,
    path: String,
    n: usize,
    config: Option<AnalysisConfig>,
) -> Result<String, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    let paths = sample_candidate_paths_from_dataset(satellite, &dataset, n, &config)?;
    let geojson = paths_to_geojson(&paths, &config);
    let serialized = serde_json::to_string_pretty(&geojson)
        .map_err(|err| format!("serialization failed: {err}"))?;
    std::fs::write(&path, serialized).map_err(|err| format!("write failed: {err}"))?;
    Ok(format!(
        "Exported {} candidate paths to {}",
        paths.len(),
        path
    ))
}

pub fn export_debris_inversion_snapshot(
    satellite: &SatelliteModel,
    output_dir: &Path,
) -> Result<(), String> {
    let items = load_debris_items()?;
    let arc_points = sample_7th_arc(satellite, None);
    let result = run_joint_inversion(&items, &arc_points, -34.23);
    let path = output_dir.join("debris_inversion_result.json");
    let serialized = serde_json::to_string_pretty(&result)
        .map_err(|err| format!("serialization failed: {err}"))?;
    std::fs::write(path, serialized).map_err(|err| format!("write failed: {err}"))
}

pub fn probability_to_geojson(points: &[ProbPoint], config: &AnalysisConfig) -> serde_json::Value {
    let summary = probability_summary(points);
    json!({
        "type": "FeatureCollection",
        "generated_at": generated_at_iso8601(),
        "config": config,
        "summary": summary,
        "features": points.iter().map(|point| {
            json!({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": point.position,
                },
                "properties": {
                    "probability": point.probability,
                    "probability_pct": point.probability * 100.0,
                    "path_density": point.path_density,
                    "fuel_weight": point.fuel_weight,
                    "debris_weight": point.debris_weight,
                }
            })
        }).collect::<Vec<_>>(),
        "metadata": {
            "total_points": points.len(),
            "sum_check": points.iter().map(|point| point.probability).sum::<f64>(),
        }
    })
}

pub fn paths_to_geojson(paths: &[FlightPath], config: &AnalysisConfig) -> serde_json::Value {
    let summary = paths_summary(paths);
    json!({
        "type": "FeatureCollection",
        "generated_at": generated_at_iso8601(),
        "config": config,
        "summary": summary,
        "features": paths.iter().enumerate().map(|(index, path)| {
            let average_speed_kts = if path.speeds_kts.is_empty() {
                0.0
            } else {
                path.speeds_kts.iter().sum::<f64>() / path.speeds_kts.len() as f64
            };
            json!({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": path.points,
                },
                "properties": {
                    "id": index,
                    "score": path.score,
                    "family": path.family,
                    "fuel_feasible": path.fuel_feasible,
                    "fuel_remaining_at_arc7_kg": path.fuel_remaining_at_arc7_kg,
                    "estimated_speed_kts": average_speed_kts,
                }
            })
        }).collect::<Vec<_>>()
    })
}

fn probability_summary(points: &[ProbPoint]) -> serde_json::Value {
    let peak = points
        .iter()
        .max_by(|left, right| left.probability.partial_cmp(&right.probability).unwrap());

    json!({
        "peak_probability_lat": peak.map(|point| point.position[1]),
        "peak_probability_lon": peak.map(|point| point.position[0]),
        "point_count": points.len(),
    })
}

fn paths_summary(paths: &[FlightPath]) -> serde_json::Value {
    let best = paths.first();
    let mean_bfo_residual = best.and_then(|path| path.bfo_summary.mean_abs_residual_hz);
    json!({
        "best_family": best.map(|path| path.family.clone()),
        "best_score": best.map(|path| path.score),
        "path_count": paths.len(),
        "bfo_mean_abs_residual_hz": mean_bfo_residual,
    })
}

fn generated_at_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geojson_export_valid_structure() {
        let points = vec![
            ProbPoint {
                position: [92.0, -35.0],
                probability: 0.05,
                path_density: 1.0,
                fuel_weight: 0.5,
                debris_weight: 0.25,
            },
            ProbPoint {
                position: [93.0, -36.0],
                probability: 0.03,
                path_density: 0.8,
                fuel_weight: 0.4,
                debris_weight: 0.2,
            },
        ];
        let json = probability_to_geojson(&points, &AnalysisConfig::default());
        assert_eq!(json["type"], "FeatureCollection");
        assert!(json["generated_at"].is_string());
        assert!(json["config"].is_object());
        assert!(json["summary"].is_object());
        assert_eq!(json["features"].as_array().unwrap().len(), 2);
        assert!(json["features"][0]["properties"]["probability"].is_number());
    }
}
