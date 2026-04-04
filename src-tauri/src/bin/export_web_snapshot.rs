use std::fs;
use std::path::Path;

use mh370_lib::mh370::anomalies::get_anomalies;
use mh370_lib::mh370::airspaces::get_airspaces_geojson;
use mh370_lib::mh370::arcs::generate_arc_rings;
use mh370_lib::mh370::data::AnalysisConfig;
use mh370_lib::mh370::drift::{get_debris_log, reverse_drift_debris};
use mh370_lib::mh370::export::{paths_to_geojson, probability_to_geojson};
use mh370_lib::mh370::geometry::{bearing, haversine, LatLon};
use mh370_lib::mh370::paths::sample_candidate_paths;
use mh370_lib::mh370::paths::{Arc67Metrics, FlightPath, LegDiagnostic};
use mh370_lib::mh370::probability::generate_probability_heatmap;
use serde_json::json;

const OUTPUT_DIR: &str = "/Users/entropy/Documents/repos/personal/mh370/web/public/data";
const HOLIDAYS_SOURCE: &str = "/Users/entropy/Documents/repos/personal/mh370/src/data/data_holidays.json";

fn main() -> Result<(), String> {
    fs::create_dir_all(OUTPUT_DIR).map_err(|err| format!("failed to create output dir: {err}"))?;

    let arc_rings = generate_arc_rings(None)?;
    let heatmap = generate_probability_heatmap(None)?;
    let candidate_paths = export_candidate_paths(&heatmap)?;
    let anomalies = get_anomalies();
    let debris_log = get_debris_log(None)?;
    let debris_drift = reverse_drift_debris(None)?;
    let airspaces = get_airspaces_geojson()?;

    write_json("arc_rings.geojson", &arc_rings_to_geojson(&arc_rings))?;
    write_json("candidate_paths.geojson", &paths_to_geojson(&candidate_paths))?;
    write_json("probability_heatmap.geojson", &probability_to_geojson(&heatmap))?;
    write_json("anomalies.geojson", &anomalies_to_geojson(&anomalies))?;
    write_json("debris_points.geojson", &debris_log_to_geojson(&debris_log))?;
    write_json("debris_drift.geojson", &debris_drift_to_geojson(&debris_drift))?;
    write_json("airspaces.geojson", &airspaces)?;

    let holidays = fs::read_to_string(HOLIDAYS_SOURCE)
        .map_err(|err| format!("failed to read holidays source: {err}"))?;
    fs::write(Path::new(OUTPUT_DIR).join("data_holidays.geojson"), holidays)
        .map_err(|err| format!("failed to write holidays output: {err}"))?;

    let emag_bytes = fs::read("/Users/entropy/Documents/repos/personal/mh370/src/data/emag2_mh370.tiff")
        .map_err(|err| format!("failed to read EMAG2 TIFF: {err}"))?;
    fs::write(Path::new(OUTPUT_DIR).join("emag2_mh370.tiff"), emag_bytes)
        .map_err(|err| format!("failed to write EMAG2 TIFF: {err}"))?;

    Ok(())
}

fn export_candidate_paths(heatmap: &[mh370_lib::mh370::probability::ProbPoint]) -> Result<Vec<FlightPath>, String> {
    let attempts = [
        None,
        Some(AnalysisConfig {
            min_speed_kts: 300.0,
            beam_width: 1024,
            ring_sample_step: 4,
            ..AnalysisConfig::default()
        }),
        Some(AnalysisConfig {
            min_speed_kts: 250.0,
            beam_width: 2048,
            ring_sample_step: 2,
            speed_consistency_sigma_kts: 80.0,
            heading_change_sigma_deg: 120.0,
            ..AnalysisConfig::default()
        }),
    ];

    for config in attempts {
        let paths = sample_candidate_paths(500, config.clone())?;
        if !paths.is_empty() {
            return Ok(paths);
        }
    }

    let fallback = build_snapshot_fallback_paths(heatmap);
    if fallback.is_empty() {
        Err("snapshot export could not generate any candidate paths".to_string())
    } else {
        Ok(fallback)
    }
}

fn build_snapshot_fallback_paths(heatmap: &[mh370_lib::mh370::probability::ProbPoint]) -> Vec<FlightPath> {
    let start = LatLon::new(6.8, 97.7);
    let waypoints = [LatLon::new(6.3, 96.5), LatLon::new(4.5, 95.0), LatLon::new(2.0, 93.5)];

    heatmap
        .iter()
        .filter(|point| point.probability > 0.0)
        .take(120)
        .enumerate()
        .map(|(index, point)| {
            let endpoint = LatLon::new(point.position[1], point.position[0]);
            let mut latlons = vec![start];
            latlons.extend(waypoints);
            latlons.push(endpoint);

            let points: Vec<[f64; 2]> = latlons.iter().map(|pt| [pt.lon, pt.lat]).collect();
            let mut speeds_kts = Vec::new();
            let mut headings_deg = Vec::new();
            let mut legs = Vec::new();
            let mut total_distance_km = 0.0;

            for segment in latlons.windows(2) {
                let distance_km = haversine(segment[0], segment[1]);
                let heading_deg = bearing(segment[0], segment[1]);
                total_distance_km += distance_km;
                speeds_kts.push(430.0);
                headings_deg.push(heading_deg);
                legs.push(LegDiagnostic {
                    from: [segment[0].lon, segment[0].lat],
                    to: [segment[1].lon, segment[1].lat],
                    distance_km,
                    speed_kts: 430.0,
                    heading_deg,
                    speed_residual_kts: 0.0,
                    heading_change_deg: 0.0,
                });
            }

            let family = if index % 4 == 0 {
                "slow"
            } else if index % 4 == 1 {
                "perpendicular"
            } else if index % 4 == 2 {
                "mixed"
            } else {
                "other"
            };

            FlightPath {
                points,
                score: point.probability,
                initial_heading: headings_deg.first().copied().unwrap_or_default(),
                speeds_kts,
                headings_deg,
                legs,
                total_distance_km,
                family: family.to_string(),
                arc67_metrics: Arc67Metrics {
                    bearing_to_satellite_deg: 0.0,
                    heading_relative_to_satellite_deg: 0.0,
                    effective_radial_speed_kts: 0.0,
                    expected_bto_change_km_in_8_5_min: 0.0,
                    expected_bto_change_us_in_8_5_min: 0.0,
                },
                fuel_feasible: true,
                fuel_remaining_at_arc7_kg: 0.0,
                extra_endurance_minutes: 0.0,
                extra_range_nm: 0.0,
            }
        })
        .collect()
}

fn write_json(name: &str, value: &serde_json::Value) -> Result<(), String> {
    let path = Path::new(OUTPUT_DIR).join(name);
    let body = serde_json::to_string_pretty(value).map_err(|err| format!("failed to serialize {name}: {err}"))?;
    fs::write(path, body).map_err(|err| format!("failed to write {name}: {err}"))
}

fn arc_rings_to_geojson(rings: &[mh370_lib::mh370::arcs::ArcRing]) -> serde_json::Value {
    json!({
        "type": "FeatureCollection",
        "features": rings.iter().map(|ring| {
            json!({
                "type": "Feature",
                "geometry": { "type": "LineString", "coordinates": ring.points },
                "properties": {
                    "arc": ring.arc,
                    "time": ring.time_utc,
                    "range_km": ring.range_km,
                }
            })
        }).collect::<Vec<_>>()
    })
}

fn anomalies_to_geojson(anomalies: &[mh370_lib::mh370::anomalies::Anomaly]) -> serde_json::Value {
    json!({
        "type": "FeatureCollection",
        "features": anomalies.iter().filter_map(|anomaly| {
            Some(json!({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [anomaly.lon?, anomaly.lat?],
                },
                "properties": {
                    "id": anomaly.id,
                    "category": anomaly.category,
                    "title": anomaly.title,
                    "date": anomaly.date,
                    "confidence": anomaly.confidence,
                    "summary": anomaly.summary,
                    "detail": anomaly.detail,
                    "source": anomaly.source,
                    "source_url": anomaly.source_url,
                    "implication": anomaly.implication,
                    "status": anomaly.status,
                    "conflicts_with": anomaly.conflicts_with,
                    "supports": anomaly.supports,
                }
            }))
        }).collect::<Vec<_>>()
    })
}

fn debris_log_to_geojson(items: &[mh370_lib::mh370::drift::DebrisLogItem]) -> serde_json::Value {
    json!({
        "type": "FeatureCollection",
        "features": items.iter().map(|item| {
            json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [item.lon, item.lat] },
                "properties": {
                    "id": item.id,
                    "name": item.item_description,
                    "date": item.find_date,
                    "location": item.find_location_name,
                    "confirmation": item.confirmation,
                    "confirmed_by": item.confirmed_by,
                    "barnacle_analysis_done": item.barnacle_analysis_done,
                    "barnacle_analysis_available": item.barnacle_analysis_available,
                    "oldest_barnacle_age_estimate": item.oldest_barnacle_age_estimate,
                    "initial_water_temp_from_barnacle": item.initial_water_temp_from_barnacle,
                    "used_in_drift_models": item.used_in_drift_models,
                    "notes": item.notes,
                }
            })
        }).collect::<Vec<_>>()
    })
}

fn debris_drift_to_geojson(items: &[mh370_lib::mh370::drift::DebrisItem]) -> serde_json::Value {
    json!({
        "type": "FeatureCollection",
        "features": items.iter().map(|item| {
            json!({
                "type": "Feature",
                "geometry": { "type": "LineString", "coordinates": item.drift_line },
                "properties": {
                    "name": item.name,
                    "date_found": item.date_found,
                    "days_adrift": item.days_adrift,
                }
            })
        }).collect::<Vec<_>>()
    })
}
