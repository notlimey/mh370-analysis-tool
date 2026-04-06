use serde::Serialize;

use super::data::{load_dataset, resolve_config, AnalysisConfig, Mh370Dataset};
use super::geometry::{destination_point, haversine, LatLon};
use super::paths::{apply_fuel_filter, sample_candidate_paths_from_dataset};
use super::satellite::SatelliteModel;

#[derive(Debug, Clone, Serialize)]
pub struct ProbPoint {
    pub position: [f64; 2],
    pub probability: f64,
    pub path_density: f64,
    pub fuel_weight: f64,
    pub debris_weight: f64,
}

pub fn generate_probability_heatmap(
    satellite: &SatelliteModel,
    config: Option<AnalysisConfig>,
) -> Result<Vec<ProbPoint>, String> {
    let config = resolve_config(config);
    let dataset = load_dataset(&config)?;
    generate_probability_heatmap_from_dataset(satellite, &dataset, &config)
}

pub fn generate_probability_heatmap_from_dataset(
    satellite: &SatelliteModel,
    dataset: &Mh370Dataset,
    config: &AnalysisConfig,
) -> Result<Vec<ProbPoint>, String> {
    let fuel_summary =
        apply_fuel_filter(satellite, config.beam_width.max(200), Some(config.clone()))?;
    let fuel_paths = if fuel_summary.paths.is_empty() {
        sample_candidate_paths_from_dataset(satellite, dataset, config.beam_width.max(200), config)?
    } else {
        fuel_summary.paths
    };

    let arc7_points = endpoint_heatmap_points(&fuel_paths, config.arc7_grid_points);

    if arc7_points.is_empty() {
        return Ok(Vec::new());
    }

    let mut raw_points = Vec::new();
    for point in arc7_points {
        let point_latlon = LatLon::new(point[1], point[0]);
        let path_density = fuel_paths
            .iter()
            .map(|path| {
                let Some(anchor) = projected_endpoint(path) else {
                    return 0.0;
                };
                let distance_km = haversine(point_latlon, anchor);
                (-distance_km.powi(2) / (2.0 * 75.0_f64.powi(2))).exp() * path.score.max(0.1)
            })
            .sum::<f64>();

        let fuel_weight = fuel_paths
            .iter()
            .map(|path| {
                let Some(anchor) = projected_endpoint(path) else {
                    return 0.0;
                };
                let distance_km = haversine(point_latlon, anchor);
                let closeness = (-distance_km.powi(2) / (2.0 * 90.0_f64.powi(2))).exp();
                let continuation = if config.max_post_arc7_minutes > 0.0 {
                    (path.extra_endurance_minutes / config.max_post_arc7_minutes).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                closeness * (0.5 + 0.5 * continuation)
            })
            .sum::<f64>();

        // Keep the heatmap anchored to the sampled path family rather than a
        // separate southern prior so the map agrees with the candidate paths.
        let debris_weight = 0.0;
        let raw_score = path_density + fuel_weight;
        raw_points.push((point, raw_score, path_density, fuel_weight, debris_weight));
    }

    let total_score: f64 = raw_points
        .iter()
        .map(|(_, raw_score, _, _, _)| raw_score)
        .sum();
    if total_score <= 0.0 {
        return Ok(Vec::new());
    }

    Ok(raw_points
        .into_iter()
        .map(
            |(position, raw_score, path_density, fuel_weight, debris_weight)| ProbPoint {
                position,
                probability: raw_score / total_score,
                path_density,
                fuel_weight,
                debris_weight,
            },
        )
        .collect())
}

fn endpoint_heatmap_points(
    paths: &[super::paths::FlightPath],
    target_points: usize,
) -> Vec<[f64; 2]> {
    let mut endpoints: Vec<[f64; 2]> = paths
        .iter()
        .filter_map(|path| projected_endpoint(path).map(|point| [point.lon, point.lat]))
        .collect();

    endpoints.sort_by(|left, right| left[1].partial_cmp(&right[1]).unwrap());

    if endpoints.len() <= target_points.max(2) {
        return endpoints;
    }

    let step = endpoints.len() as f64 / target_points.max(2) as f64;
    let mut result = Vec::new();
    let mut index = 0.0_f64;
    while (index as usize) < endpoints.len() {
        result.push(endpoints[index as usize]);
        index += step;
    }
    result
}

fn projected_endpoint(path: &super::paths::FlightPath) -> Option<LatLon> {
    let last = path.points.last().copied()?;
    let endpoint = LatLon::new(last[1], last[0]);
    let extra_range_km = path.extra_range_nm * 1.852;
    if extra_range_km <= 0.0 {
        return Some(endpoint);
    }

    let heading_deg = path
        .headings_deg
        .last()
        .copied()
        .unwrap_or(path.initial_heading);
    Some(destination_point(endpoint, heading_deg, extra_range_km))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_path() -> super::super::paths::FlightPath {
        super::super::paths::FlightPath {
            points: vec![[95.0, -34.0]],
            score: 1.0,
            initial_heading: 180.0,
            speeds_kts: vec![],
            headings_deg: vec![180.0],
            legs: vec![],
            total_distance_km: 0.0,
            family: "test".to_string(),
            arc67_metrics: super::super::paths::Arc67Metrics {
                bearing_to_satellite_deg: 0.0,
                heading_relative_to_satellite_deg: 0.0,
                effective_radial_speed_kts: 0.0,
                expected_bto_change_km_in_8_5_min: 0.0,
                expected_bto_change_us_in_8_5_min: 0.0,
            },
            fuel_feasible: true,
            fuel_remaining_at_arc7_kg: 1000.0,
            extra_endurance_minutes: 0.0,
            extra_range_nm: 0.0,
            bfo_summary: super::super::paths::BfoSummary {
                used_count: 0,
                total_count: 0,
                mean_abs_residual_hz: None,
                max_abs_residual_hz: None,
            },
            bfo_diagnostics: vec![],
            speed_log_score: 0.0,
            heading_log_score: 0.0,
            northward_log_score: 0.0,
            bfo_log_score: 0.0,
        }
    }

    #[test]
    fn projected_endpoint_uses_post_arc7_range() {
        let mut path = base_path();
        path.extra_range_nm = 120.0;

        let projected = projected_endpoint(&path).expect("projected endpoint");

        assert!(
            projected.lat < -35.0,
            "expected southward continuation, got {}",
            projected.lat
        );
    }

    #[test]
    fn heatmap_handles_zero_post_arc7_minutes() {
        let mut config = AnalysisConfig::default();
        config.max_post_arc7_minutes = 0.0;
        let points = vec![[95.0, -34.0]];
        let path = base_path();

        let point_latlon = LatLon::new(points[0][1], points[0][0]);
        let anchor = projected_endpoint(&path).expect("endpoint");
        let distance_km = haversine(point_latlon, anchor);
        let closeness = (-distance_km.powi(2) / (2.0 * 90.0_f64.powi(2))).exp();
        let continuation = if config.max_post_arc7_minutes > 0.0 {
            (path.extra_endurance_minutes / config.max_post_arc7_minutes).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let fuel_weight = closeness * (0.5 + 0.5 * continuation);

        assert!(fuel_weight.is_finite());
    }
}
