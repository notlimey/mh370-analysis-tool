use serde::{Deserialize, Serialize};

use super::arcs::{build_arc_ring, calibrate_bto_offset_from_dataset};
use super::data::{load_dataset, primary_arc_handshakes, resolve_config, AnalysisConfig};
use super::drift_beaching::{simulate_beaching_for_profiles, BeachingCloud, DriftProfile};
use super::drift_scoring::{
    compute_match_score, debris_item_label, drift_likelihood_with_sigma, item_type_uncertainty_km,
    DriftObservation,
};
use super::drift_transport::{
    simulate_particle_cloud_for_viz as build_particle_cloud_for_viz, ParticleCloud,
};
use super::drift_validation::validate_drift_model;
use super::satellite::SatelliteModel;

const DEBRIS_ITEMS_JSON: &str = include_str!("../../../src/data/debris_items_inversion.json");
const ANALYSIS_START_JDN: i32 = 2_456_726;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebrisItem {
    pub id: String,
    #[serde(default)]
    pub description: Option<String>,
    pub find_lat: f64,
    pub find_lon: f64,
    #[serde(default)]
    pub find_date: Option<String>,
    pub find_date_days: f64,
    #[serde(default)]
    pub find_location: Option<String>,
    pub confidence: f64,
    pub leeway_coeff: f64,
    pub item_type: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OriginCandidate {
    pub lat: f64,
    pub lon: f64,
    pub log_likelihood: f64,
    pub normalized_prob: f64,
    pub contributing_items: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InversionResult {
    pub candidates: Vec<OriginCandidate>,
    pub peak_lat: f64,
    pub peak_lon: f64,
    pub confidence_interval_68: (f64, f64),
    pub confidence_interval_95: (f64, f64),
    pub satellite_peak_lat: f64,
    pub intersection_lat: f64,
    pub items_used: u32,
    pub items_excluded: u32,
    pub validation_ok: bool,
    pub validation_message: String,
}

pub fn load_debris_items() -> Result<Vec<DebrisItem>, String> {
    let mut items: Vec<DebrisItem> = serde_json::from_str(DEBRIS_ITEMS_JSON)
        .map_err(|err| format!("failed to parse debris inversion data: {err}"))?;
    for item in &mut items {
        if item.find_date_days <= 0.0 {
            if let Some(find_date) = item.find_date.as_deref() {
                item.find_date_days = days_since_2014_03_08(find_date)?;
            }
        }
        if item.confidence <= 0.0 {
            item.confidence = 0.3;
        }
    }
    Ok(items)
}

pub fn run_joint_inversion(
    items: &[DebrisItem],
    arc_points: &[(f64, f64)],
    satellite_peak_lat: f64,
) -> InversionResult {
    run_joint_inversion_with_progress(items, arc_points, satellite_peak_lat, |_| {})
}

pub fn run_joint_inversion_with_progress<F>(
    items: &[DebrisItem],
    arc_points: &[(f64, f64)],
    satellite_peak_lat: f64,
    mut progress: F,
) -> InversionResult
where
    F: FnMut(u8),
{
    let usable_items: Vec<&DebrisItem> = items
        .iter()
        .filter(|item| item.confidence > 0.0 && item.find_date_days > 0.0)
        .collect();
    let items_excluded = items.len().saturating_sub(usable_items.len()) as u32;

    let mut candidates: Vec<OriginCandidate> = Vec::with_capacity(arc_points.len());
    for (index, &(lat, lon)) in arc_points.iter().enumerate() {
        candidates.push({
            let mut log_likelihood = 0.0;
            let mut contributing_items = 0_u32;
            for item in &usable_items {
                let likelihood = drift_likelihood_with_sigma(
                    lat,
                    lon,
                    item.find_lat,
                    item.find_lon,
                    item.find_date_days,
                    item.leeway_coeff,
                    item_type_uncertainty_km(&item.item_type),
                );
                let weighted_log = item.confidence * likelihood.ln();
                log_likelihood += weighted_log;
                if likelihood > 1e-12 {
                    contributing_items += 1;
                }
            }
            log_likelihood += gaussian_lat_prior_log(lat, -34.0, 5.5);

            OriginCandidate {
                lat,
                lon,
                log_likelihood,
                normalized_prob: 0.0,
                contributing_items,
            }
        });

        if (index + 1) % 10 == 0 || index + 1 == arc_points.len() {
            let pct = (((index + 1) as f64 / arc_points.len().max(1) as f64) * 100.0).round() as u8;
            progress(pct.min(100));
        }
    }

    normalize_candidates(&mut candidates);
    candidates.sort_by(|left, right| left.lat.partial_cmp(&right.lat).unwrap());

    let peak = candidates
        .iter()
        .max_by(|left, right| {
            left.normalized_prob
                .partial_cmp(&right.normalized_prob)
                .unwrap()
        })
        .cloned()
        .unwrap_or(OriginCandidate {
            lat: -34.23,
            lon: 93.78,
            log_likelihood: 0.0,
            normalized_prob: 1.0,
            contributing_items: 0,
        });

    let confidence_interval_68 = confidence_interval(&candidates, 0.68, peak.lat);
    let confidence_interval_95 = confidence_interval(&candidates, 0.95, peak.lat);
    let intersection_lat =
        weighted_intersection_lat(peak.lat, satellite_peak_lat, confidence_interval_68);
    let validation_ok = validate_drift_model();
    let validation_message = if validation_ok {
        "✓ Drift model validated against Réunion flaperon find".to_string()
    } else {
        "⚠️ Drift model validation: flaperon test FAILED\nResults shown but leeway coefficients may need tuning.\nTreat debris peak location with caution.".to_string()
    };

    InversionResult {
        candidates,
        peak_lat: peak.lat,
        peak_lon: peak.lon,
        confidence_interval_68,
        confidence_interval_95,
        satellite_peak_lat,
        intersection_lat,
        items_used: usable_items.len() as u32,
        items_excluded,
        validation_ok,
        validation_message,
    }
}

pub fn sample_7th_arc(
    satellite: &SatelliteModel,
    config: Option<AnalysisConfig>,
) -> Vec<(f64, f64)> {
    let config = resolve_config(config);
    let dataset = match load_dataset(&config) {
        Ok(dataset) => dataset,
        Err(_) => return Vec::new(),
    };
    let handshakes = primary_arc_handshakes(&dataset);
    let Some(arc7) = handshakes.last() else {
        return Vec::new();
    };

    let calibration = match calibrate_bto_offset_from_dataset(satellite, &dataset, &config) {
        Ok(calibration) => calibration,
        Err(_) => return Vec::new(),
    };
    let ring = match build_arc_ring(satellite, arc7, calibration.offset_us, &config) {
        Ok(ring) => ring,
        Err(_) => return Vec::new(),
    };

    let branch: Vec<(f64, f64)> = ring
        .points
        .iter()
        .map(|point| (point[1], point[0]))
        .filter(|(lat, lon)| *lat >= -40.5 && *lat <= -19.5 && *lon >= 70.0 && *lon <= 110.0)
        .collect();

    let mut sampled = Vec::new();
    let mut lat = -40.0;
    while lat <= -20.0 + 1e-9 {
        if let Some((_, lon)) = branch.iter().min_by(|left, right| {
            (left.0 - lat)
                .abs()
                .partial_cmp(&(right.0 - lat).abs())
                .unwrap()
        }) {
            sampled.push((round_to(lat, 1), *lon));
        }
        lat += 0.1;
    }
    sampled
}

pub fn simulate_particle_cloud_for_viz(
    origin_lat: f64,
    origin_lon: f64,
    _n_days: f64,
    leeway_coeff: f64,
) -> ParticleCloud {
    build_particle_cloud_for_viz(origin_lat, origin_lon, leeway_coeff)
}

pub fn simulate_beaching_for_items(
    origin_lat: f64,
    origin_lon: f64,
    items: &[DebrisItem],
    n_particles: Option<usize>,
    max_days: Option<usize>,
) -> BeachingCloud {
    let profiles: Vec<DriftProfile> = items
        .iter()
        .filter(|item| item.confidence > 0.0)
        .map(|item| drift_profile_for_item(item))
        .collect();
    let observations: Vec<DriftObservation> = items
        .iter()
        .filter(|item| item.find_date_days > 0.0 && item.confidence > 0.0)
        .map(|item| DriftObservation {
            lat: item.find_lat,
            lon: item.find_lon,
            day: item.find_date_days,
            confidence: item.confidence,
            label: debris_item_label(&item.id, item.find_location.as_deref()),
        })
        .collect();
    simulate_beaching_for_profiles(
        origin_lat,
        origin_lon,
        &profiles,
        n_particles,
        max_days,
        |beached| compute_match_score(beached, &observations),
    )
}

fn normalize_candidates(candidates: &mut [OriginCandidate]) {
    if candidates.is_empty() {
        return;
    }
    let max_log = candidates
        .iter()
        .map(|candidate| candidate.log_likelihood)
        .fold(f64::NEG_INFINITY, f64::max);
    let sum = candidates
        .iter_mut()
        .map(|candidate| {
            candidate.normalized_prob = (candidate.log_likelihood - max_log).exp();
            candidate.normalized_prob
        })
        .sum::<f64>();
    if sum <= 0.0 {
        let uniform = 1.0 / candidates.len() as f64;
        for candidate in candidates {
            candidate.normalized_prob = uniform;
        }
        return;
    }
    for candidate in candidates {
        candidate.normalized_prob /= sum;
    }
}

fn confidence_interval(
    candidates: &[OriginCandidate],
    target_mass: f64,
    peak_lat: f64,
) -> (f64, f64) {
    let peak_index = candidates
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (left.lat - peak_lat)
                .abs()
                .partial_cmp(&(right.lat - peak_lat).abs())
                .unwrap()
        })
        .map(|(index, _)| index)
        .unwrap_or(0);

    let mut left = peak_index;
    let mut right = peak_index;
    let mut mass = candidates[peak_index].normalized_prob;
    while mass < target_mass && (left > 0 || right + 1 < candidates.len()) {
        let left_prob = if left > 0 {
            candidates[left - 1].normalized_prob
        } else {
            -1.0
        };
        let right_prob = if right + 1 < candidates.len() {
            candidates[right + 1].normalized_prob
        } else {
            -1.0
        };

        if right_prob >= left_prob && right + 1 < candidates.len() {
            right += 1;
            mass += candidates[right].normalized_prob;
        } else if left > 0 {
            left -= 1;
            mass += candidates[left].normalized_prob;
        } else {
            break;
        }
    }
    (candidates[left].lat, candidates[right].lat)
}

fn weighted_intersection_lat(
    debris_peak_lat: f64,
    satellite_peak_lat: f64,
    debris_ci_68: (f64, f64),
) -> f64 {
    let debris_width = (debris_ci_68.1 - debris_ci_68.0).abs().max(0.2);
    let satellite_width = 2.0;
    let debris_weight = 1.0 / debris_width;
    let satellite_weight = 1.0 / satellite_width;
    (debris_peak_lat * debris_weight + satellite_peak_lat * satellite_weight)
        / (debris_weight + satellite_weight)
}

fn gaussian_lat_prior_log(lat: f64, mean_lat: f64, sigma_deg: f64) -> f64 {
    -((lat - mean_lat).powi(2)) / (2.0 * sigma_deg.powi(2))
}

fn round_to(value: f64, decimals: u32) -> f64 {
    let factor = 10_f64.powi(decimals as i32);
    (value * factor).round() / factor
}

fn drift_profile_for_item(item: &DebrisItem) -> DriftProfile {
    match item.item_type.as_str() {
        "flaperon" => DriftProfile {
            leeway_coeff: item.leeway_coeff.max(0.024),
            current_noise_scale: 0.95,
            wind_noise_scale: 1.20,
            capture_bias: 0.10,
        },
        "panel" => DriftProfile {
            leeway_coeff: item.leeway_coeff,
            current_noise_scale: 1.00,
            wind_noise_scale: 0.95,
            capture_bias: 0.02,
        },
        "interior" => DriftProfile {
            leeway_coeff: item.leeway_coeff,
            current_noise_scale: 1.10,
            wind_noise_scale: 0.85,
            capture_bias: -0.04,
        },
        "foam" => DriftProfile {
            leeway_coeff: item.leeway_coeff.max(0.028),
            current_noise_scale: 1.20,
            wind_noise_scale: 1.35,
            capture_bias: 0.12,
        },
        _ => DriftProfile {
            leeway_coeff: item.leeway_coeff,
            current_noise_scale: 1.05,
            wind_noise_scale: 1.00,
            capture_bias: 0.0,
        },
    }
}

pub fn days_since_2014_03_08(date: &str) -> Result<f64, String> {
    let mut parts = date.split('-');
    let year = parts
        .next()
        .ok_or_else(|| format!("missing year in debris date {date}"))?
        .parse::<i32>()
        .map_err(|err| format!("invalid year in debris date {date}: {err}"))?;
    let month = parts
        .next()
        .ok_or_else(|| format!("missing month in debris date {date}"))?
        .parse::<u32>()
        .map_err(|err| format!("invalid month in debris date {date}: {err}"))?;
    let day = parts
        .next()
        .ok_or_else(|| format!("missing day in debris date {date}"))?
        .parse::<u32>()
        .map_err(|err| format!("invalid day in debris date {date}: {err}"))?;
    Ok((gregorian_to_jdn(year, month, day) - ANALYSIS_START_JDN) as f64)
}

fn gregorian_to_jdn(year: i32, month: u32, day: u32) -> i32 {
    let a = (14 - month as i32) / 12;
    let y = year + 4800 - a;
    let m = month as i32 + 12 * a - 3;
    day as i32 + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_satellite() -> SatelliteModel {
        SatelliteModel::load().unwrap()
    }

    #[test]
    fn test_joint_inversion_returns_southern_result() {
        let items = load_debris_items().unwrap();
        let arc_points = sample_7th_arc(&test_satellite(), None);
        let result = run_joint_inversion(&items, &arc_points, -34.23);
        assert!(result.peak_lat <= -25.0);
        assert!(result.peak_lat >= -40.0);
    }

    #[test]
    fn test_confidence_intervals_are_ordered() {
        let items = load_debris_items().unwrap();
        let arc_points = sample_7th_arc(&test_satellite(), None);
        let result = run_joint_inversion(&items, &arc_points, -34.23);
        assert!(result.confidence_interval_68.0 >= result.confidence_interval_95.0);
        assert!(result.confidence_interval_68.1 <= result.confidence_interval_95.1);
    }

    #[test]
    fn test_flaperon_validation() {
        assert!(validate_drift_model());
    }

    #[test]
    fn test_zero_confidence_items_excluded() {
        let items = load_debris_items().unwrap();
        let arc_points = sample_7th_arc(&test_satellite(), None);
        let baseline = run_joint_inversion(&items, &arc_points, -34.23);

        let mut augmented = items.clone();
        augmented.push(DebrisItem {
            id: "ignored".to_string(),
            description: None,
            find_lat: -20.9,
            find_lon: 55.5,
            find_date: Some("2015-07-29".to_string()),
            find_date_days: 507.0,
            find_location: Some("Saint-André, Réunion Island".to_string()),
            confidence: 0.0,
            leeway_coeff: 0.025,
            item_type: "unknown".to_string(),
            status: None,
            source: None,
        });
        let result = run_joint_inversion(&augmented, &arc_points, -34.23);

        assert!((baseline.peak_lat - result.peak_lat).abs() < 1e-9);
        assert!((baseline.intersection_lat - result.intersection_lat).abs() < 1e-9);
    }
}
