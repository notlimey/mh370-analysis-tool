use super::drift_beaching::{coastline_lon, is_on_land, BeachedParticle};
use super::drift_transport::{hash_seed, simulate_ensemble, Particle};

const MIN_LIKELIHOOD: f64 = 1e-300;
const KDE_BANDWIDTH_KM: f64 = 120.0;
const MATCH_THRESHOLD_KM: f64 = 200.0;
const SPATIAL_SIGMA_KM: f64 = 180.0;
const TIMING_SIGMA_DAYS: f64 = 90.0;
const MATCH_LIKELIHOOD_THRESHOLD: f64 = 0.20;

#[derive(Debug, Clone)]
pub struct DriftObservation {
    pub lat: f64,
    pub lon: f64,
    pub day: f64,
    pub confidence: f64,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct MatchScoreSummary {
    pub match_score: u32,
    pub match_total: u32,
    pub matched_finds: Vec<String>,
    pub fit_score: f64,
    pub spatial_score: f64,
    pub timing_score: f64,
}

pub fn drift_likelihood(
    origin_lat: f64,
    origin_lon: f64,
    target_lat: f64,
    target_lon: f64,
    n_days: f64,
    leeway_coeff: f64,
) -> f64 {
    drift_likelihood_with_sigma(
        origin_lat,
        origin_lon,
        target_lat,
        target_lon,
        n_days,
        leeway_coeff,
        item_type_uncertainty_km("unknown"),
    )
}

pub fn drift_likelihood_with_sigma(
    origin_lat: f64,
    origin_lon: f64,
    target_lat: f64,
    target_lon: f64,
    n_days: f64,
    leeway_coeff: f64,
    item_sigma_km: f64,
) -> f64 {
    if !n_days.is_finite() || n_days <= 0.0 {
        return 0.0;
    }

    let seed = hash_seed(origin_lat, origin_lon, n_days);
    let mut particles = simulate_ensemble(origin_lat, origin_lon, n_days, leeway_coeff, seed);
    for particle in &mut particles {
        if is_on_land(particle.lat, particle.lon) {
            particle.lon = particle.lon.max(coastline_lon(particle.lat));
        }
    }
    kde_density_at(&particles, target_lat, target_lon, item_sigma_km).max(MIN_LIKELIHOOD)
}

pub fn compute_match_score(
    beached: &[BeachedParticle],
    observations: &[DriftObservation],
) -> MatchScoreSummary {
    let usable: Vec<&DriftObservation> = observations
        .iter()
        .filter(|observation| observation.day > 0.0 && observation.confidence > 0.0)
        .collect();
    if usable.is_empty() {
        return MatchScoreSummary {
            match_score: 0,
            match_total: 0,
            matched_finds: Vec::new(),
            fit_score: 0.0,
            spatial_score: 0.0,
            timing_score: 0.0,
        };
    }

    let mut matched_finds = Vec::new();
    let mut weighted_fit = 0.0;
    let mut weighted_spatial = 0.0;
    let mut weighted_timing = 0.0;
    let mut total_weight = 0.0;

    for observation in &usable {
        let mut best_fit = 0.0;
        let mut best_spatial = 0.0;
        let mut best_timing = 0.0;
        let mut binary_match = false;

        for beached_particle in beached {
            let distance_km = particle_distance_km(
                beached_particle.lat,
                beached_particle.lon,
                observation.lat,
                observation.lon,
            );
            let day_diff = (beached_particle.days - observation.day).abs();
            let spatial = gaussian_score(distance_km, SPATIAL_SIGMA_KM);
            let timing = gaussian_score(day_diff, TIMING_SIGMA_DAYS);
            let fit = spatial * timing;
            if fit > best_fit {
                best_fit = fit;
                best_spatial = spatial;
                best_timing = timing;
            }
            if distance_km < MATCH_THRESHOLD_KM {
                binary_match = true;
            }
        }

        if best_fit >= MATCH_LIKELIHOOD_THRESHOLD || (binary_match && best_timing >= 0.35) {
            matched_finds.push(observation.label.clone());
        }

        weighted_fit += observation.confidence * best_fit;
        weighted_spatial += observation.confidence * best_spatial;
        weighted_timing += observation.confidence * best_timing;
        total_weight += observation.confidence;
    }

    let denom = total_weight.max(1e-9);
    MatchScoreSummary {
        match_score: matched_finds.len() as u32,
        match_total: usable.len() as u32,
        matched_finds,
        fit_score: 100.0 * weighted_fit / denom,
        spatial_score: 100.0 * weighted_spatial / denom,
        timing_score: 100.0 * weighted_timing / denom,
    }
}

fn kde_density_at(
    particles: &[Particle],
    target_lat: f64,
    target_lon: f64,
    item_sigma_km: f64,
) -> f64 {
    if particles.is_empty() {
        return 0.0;
    }
    let bandwidth_km = (KDE_BANDWIDTH_KM.powi(2) + item_sigma_km.powi(2)).sqrt();
    let bandwidth_sq = bandwidth_km.powi(2);
    let norm = 1.0 / (2.0 * std::f64::consts::PI * bandwidth_sq * particles.len() as f64);
    let mut density = 0.0;
    for particle in particles {
        let delta_lat_km = (target_lat - particle.lat) * 111.32;
        let delta_lon_km =
            (target_lon - particle.lon) * 111.32 * particle.lat.to_radians().cos().abs().max(0.2);
        let dist_sq = delta_lat_km.powi(2) + delta_lon_km.powi(2);
        density += (-0.5 * dist_sq / bandwidth_sq).exp();
    }
    norm * density
}

pub fn item_type_uncertainty_km(item_type: &str) -> f64 {
    match item_type {
        "flaperon" => 100.0,
        "panel" => 150.0,
        "interior" => 200.0,
        "foam" => 250.0,
        _ => 300.0,
    }
}

pub fn debris_item_label(id: &str, location: Option<&str>) -> String {
    match id {
        "item_01_flaperon_reunion" => "Flaperon, Réunion".to_string(),
        "item_02_flap_track_mozambique" => "Flap track, Mozambique".to_string(),
        "item_03_no_step_mozambique" => "NO STEP panel, Mozambique".to_string(),
        "item_04_engine_cowl_mozambique" => "Engine cowl, Mozambique".to_string(),
        "item_05_panel_mossel_bay" => "Panel, Mossel Bay SA".to_string(),
        "item_06_interior_panel_mauritius" => "Interior, Mauritius".to_string(),
        "item_07_outboard_flap_tanzania" => "Outboard flap, Tanzania".to_string(),
        "item_08_window_rodrigues" => "Window, Rodrigues Is.".to_string(),
        "item_09_interior_tanzania" => "Interior, Tanzania".to_string(),
        "item_10_flap_mauritius" => "Flap, Mauritius".to_string(),
        "item_11_panel_madagascar" => "Panel, Madagascar".to_string(),
        "item_12_broken_o_madagascar" => "Broken O, Madagascar".to_string(),
        "item_13_panel_nosy_boraha" => "Panel, Nosy Boraha".to_string(),
        "item_14_panel_maputo" => "Panel, Maputo Mozambique".to_string(),
        _ => location.unwrap_or(id).to_string(),
    }
}

fn gaussian_score(delta: f64, sigma: f64) -> f64 {
    (-0.5 * (delta / sigma).powi(2)).exp()
}

fn particle_distance_km(lat_a: f64, lon_a: f64, lat_b: f64, lon_b: f64) -> f64 {
    let dlat = (lat_a - lat_b) * 111.32;
    let dlon = (lon_a - lon_b) * 111.32 * lat_b.to_radians().cos().abs().max(0.2);
    (dlat * dlat + dlon * dlon).sqrt()
}
