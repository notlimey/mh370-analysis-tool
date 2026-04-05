use std::collections::BTreeMap;

use rand::rngs::SmallRng;
use rand::Rng;
use rand::SeedableRng;
use serde::Serialize;

use super::drift_transport::{
    advance_particle, hash_seed, lerp, HybridFieldProvider, NoiseConfig, Particle,
    TRANSPORT_SUBSTEPS_PER_DAY,
};

const N_PARTICLES_BEACH: usize = 200;
const BEACHING_MAX_DAYS: usize = 900;
const BEACH_CURRENT_NOISE_MPS: f64 = 0.04;
const BEACH_WIND_NOISE_MPS: f64 = 0.02;

#[derive(Debug, Clone)]
pub struct DriftProfile {
    pub leeway_coeff: f64,
    pub current_noise_scale: f64,
    pub wind_noise_scale: f64,
    pub capture_bias: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BeachedParticle {
    pub lon: f64,
    pub lat: f64,
    pub days: f64,
    pub coast: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BeachingCloud {
    pub origin_lat: f64,
    pub origin_lon: f64,
    pub beached: Vec<BeachedParticle>,
    pub still_drifting: Vec<[f64; 2]>,
    pub beaching_fraction: f64,
    pub fit_score: f64,
    pub spatial_score: f64,
    pub timing_score: f64,
    pub match_score: u32,
    pub match_total: u32,
    pub matched_finds: Vec<String>,
    pub debug_coast_contacts: BTreeMap<String, u32>,
    pub debug_coast_captures: BTreeMap<String, u32>,
}

pub fn simulate_beaching_for_profiles(
    origin_lat: f64,
    origin_lon: f64,
    profiles: &[DriftProfile],
    n_particles: Option<usize>,
    max_days: Option<usize>,
    match_score: impl Fn(&[BeachedParticle]) -> super::drift_scoring::MatchScoreSummary,
) -> BeachingCloud {
    let n_particles = n_particles.unwrap_or(N_PARTICLES_BEACH);
    let max_days = max_days.unwrap_or(BEACHING_MAX_DAYS);
    let mut beached: Vec<BeachedParticle> = Vec::new();
    let mut still_drifting: Vec<[f64; 2]> = Vec::new();
    let mut coast_contacts: BTreeMap<String, u32> = BTreeMap::new();
    let mut coast_captures: BTreeMap<String, u32> = BTreeMap::new();

    let profiles = if profiles.is_empty() {
        vec![default_profile()]
    } else {
        profiles.to_vec()
    };

    let base_particles = n_particles / profiles.len();
    let remainder = n_particles % profiles.len();

    for (index, profile) in profiles.iter().enumerate() {
        let particle_count = base_particles + usize::from(index < remainder);
        if particle_count == 0 {
            continue;
        }

        let seed = hash_seed(
            origin_lat,
            origin_lon,
            max_days as f64 + profile.leeway_coeff * 1000.0 + index as f64,
        );
        let (
            mut subgroup_beached,
            mut subgroup_still_drifting,
            subgroup_contacts,
            subgroup_captures,
        ) = simulate_beaching_group(
            origin_lat,
            origin_lon,
            profile,
            particle_count,
            max_days,
            seed,
        );
        beached.append(&mut subgroup_beached);
        still_drifting.append(&mut subgroup_still_drifting);
        merge_counts(&mut coast_contacts, subgroup_contacts);
        merge_counts(&mut coast_captures, subgroup_captures);
    }

    let beaching_fraction = beached.len() as f64 / n_particles as f64;
    let score = match_score(&beached);

    BeachingCloud {
        origin_lat,
        origin_lon,
        beached,
        still_drifting,
        beaching_fraction,
        fit_score: score.fit_score,
        spatial_score: score.spatial_score,
        timing_score: score.timing_score,
        match_score: score.match_score,
        match_total: score.match_total,
        matched_finds: score.matched_finds,
        debug_coast_contacts: coast_contacts,
        debug_coast_captures: coast_captures,
    }
}

fn simulate_beaching_group(
    origin_lat: f64,
    origin_lon: f64,
    profile: &DriftProfile,
    n_particles: usize,
    max_days: usize,
    seed: u64,
) -> (
    Vec<BeachedParticle>,
    Vec<[f64; 2]>,
    BTreeMap<String, u32>,
    BTreeMap<String, u32>,
) {
    let mut rng = SmallRng::seed_from_u64(seed);
    let provider = HybridFieldProvider;
    let mut active: Vec<(Particle, bool, f64, f64)> = (0..n_particles)
        .map(|_| {
            (
                Particle {
                    lat: origin_lat,
                    lon: origin_lon,
                },
                true,
                origin_lat,
                origin_lon,
            )
        })
        .collect();
    let mut beached: Vec<BeachedParticle> = Vec::new();
    let mut coast_contacts: BTreeMap<String, u32> = BTreeMap::new();
    let mut coast_captures: BTreeMap<String, u32> = BTreeMap::new();

    for day in 1..=max_days {
        for (particle, still_active, prev_lat, prev_lon) in &mut active {
            if !*still_active {
                continue;
            }

            *prev_lat = particle.lat;
            *prev_lon = particle.lon;

            for substep in 0..TRANSPORT_SUBSTEPS_PER_DAY {
                advance_particle(
                    particle,
                    &provider,
                    day,
                    substep,
                    TRANSPORT_SUBSTEPS_PER_DAY,
                    profile.leeway_coeff,
                    NoiseConfig {
                        current_noise_mps: BEACH_CURRENT_NOISE_MPS * profile.current_noise_scale,
                        wind_noise_mps: BEACH_WIND_NOISE_MPS * profile.wind_noise_scale,
                    },
                    &mut rng,
                );

                let hit = land_check(particle.lat, particle.lon);
                if hit.is_land() {
                    let coast_name = hit.coast_name().to_string();
                    *coast_contacts.entry(coast_name.clone()).or_insert(0) += 1;
                    let (beach_lat, beach_lon) =
                        shoreline_point(hit, *prev_lat, *prev_lon, particle.lat, particle.lon);
                    if rng.gen::<f64>() <= coastal_capture_probability(hit, profile) {
                        *coast_captures.entry(coast_name.clone()).or_insert(0) += 1;
                        beached.push(BeachedParticle {
                            lon: beach_lon,
                            lat: beach_lat,
                            days: (day - 1) as f64
                                + (substep + 1) as f64 / TRANSPORT_SUBSTEPS_PER_DAY as f64,
                            coast: coast_name,
                        });
                        *still_active = false;
                        break;
                    }

                    let (reset_lat, reset_lon) =
                        push_particle_offshore(hit, *prev_lat, *prev_lon, beach_lat, beach_lon);
                    particle.lat = reset_lat;
                    particle.lon = reset_lon;
                }
            }
        }
    }

    let still_drifting = active
        .iter()
        .filter(|(_, active, _, _)| *active)
        .map(|(particle, _, _, _)| [particle.lon, particle.lat])
        .collect();

    (beached, still_drifting, coast_contacts, coast_captures)
}

#[derive(Clone, Copy, Debug)]
enum LandHit {
    None,
    AfricaEast,
    AfricaSouth,
    MadagascarEast,
    MadagascarWest,
    Reunion,
    Mauritius,
    WesternAustralia,
    Indonesia,
}

impl LandHit {
    fn is_land(&self) -> bool {
        !matches!(self, LandHit::None)
    }

    fn coast_name(&self) -> &'static str {
        match self {
            LandHit::None => "",
            LandHit::AfricaEast => "East Africa",
            LandHit::AfricaSouth => "South Africa",
            LandHit::MadagascarEast => "Madagascar (east)",
            LandHit::MadagascarWest => "Madagascar (west)",
            LandHit::Reunion => "Réunion",
            LandHit::Mauritius => "Mauritius",
            LandHit::WesternAustralia => "Western Australia",
            LandHit::Indonesia => "Indonesia",
        }
    }

    fn base_capture_probability(&self) -> f64 {
        match self {
            LandHit::None => 0.0,
            LandHit::Reunion => 0.82,
            LandHit::Mauritius => 0.78,
            LandHit::MadagascarEast => 0.62,
            LandHit::MadagascarWest => 0.62,
            LandHit::AfricaEast => 0.38,
            LandHit::AfricaSouth => 0.46,
            LandHit::WesternAustralia => 0.24,
            LandHit::Indonesia => 0.44,
        }
    }
}

fn coastal_capture_probability(hit: LandHit, profile: &DriftProfile) -> f64 {
    let windage_proxy = ((profile.leeway_coeff - 0.018) / 0.010).clamp(0.0, 1.0);
    let windage_adjustment = lerp(-0.06, 0.08, windage_proxy);
    (hit.base_capture_probability() + windage_adjustment + profile.capture_bias).clamp(0.05, 0.95)
}

fn default_profile() -> DriftProfile {
    DriftProfile {
        leeway_coeff: 0.025,
        current_noise_scale: 1.0,
        wind_noise_scale: 1.0,
        capture_bias: 0.0,
    }
}

fn push_particle_offshore(
    hit: LandHit,
    prev_lat: f64,
    prev_lon: f64,
    beach_lat: f64,
    beach_lon: f64,
) -> (f64, f64) {
    let offshore_km = 18.0;
    match hit {
        LandHit::AfricaEast => (beach_lat, beach_lon + lon_offset_km(beach_lat, offshore_km)),
        LandHit::AfricaSouth => (beach_lat - lat_offset_km(offshore_km), beach_lon),
        LandHit::MadagascarEast => (beach_lat, beach_lon + lon_offset_km(beach_lat, offshore_km)),
        LandHit::MadagascarWest => (beach_lat, beach_lon - lon_offset_km(beach_lat, offshore_km)),
        LandHit::Reunion | LandHit::Mauritius => {
            let lat_delta = beach_lat - prev_lat;
            let lon_delta = beach_lon - prev_lon;
            let scale = (lat_delta * lat_delta + lon_delta * lon_delta).sqrt();
            if scale > 1e-9 {
                (
                    beach_lat + lat_delta / scale * lat_offset_km(offshore_km),
                    beach_lon + lon_delta / scale * lon_offset_km(beach_lat, offshore_km),
                )
            } else {
                (prev_lat, prev_lon)
            }
        }
        LandHit::WesternAustralia => (beach_lat, beach_lon - lon_offset_km(beach_lat, offshore_km)),
        LandHit::Indonesia => (beach_lat - lat_offset_km(offshore_km), beach_lon),
        LandHit::None => (beach_lat, beach_lon),
    }
}

fn shoreline_point(
    hit: LandHit,
    prev_lat: f64,
    prev_lon: f64,
    hit_lat: f64,
    hit_lon: f64,
) -> (f64, f64) {
    match hit {
        LandHit::AfricaEast => {
            let lat = clamp_between(prev_lat, hit_lat, hit_lat);
            (lat, africa_east_coast_lon(lat) + 0.02)
        }
        LandHit::AfricaSouth => {
            if hit_lon > 18.0 && hit_lon < 28.0 {
                let lon = clamp_between(prev_lon, hit_lon, hit_lon);
                (south_africa_south_coast_lat(lon) - 0.02, lon)
            } else {
                (clamp_between(prev_lat, hit_lat, hit_lat), 18.4)
            }
        }
        LandHit::MadagascarEast => {
            let lat = clamp_between(prev_lat, hit_lat, hit_lat).clamp(-25.8, -11.7);
            (lat, madagascar_east_coast(lat) - 0.02)
        }
        LandHit::MadagascarWest => {
            let lat = clamp_between(prev_lat, hit_lat, hit_lat).clamp(-25.8, -11.7);
            (lat, madagascar_west_coast(lat) + 0.02)
        }
        LandHit::WesternAustralia => {
            let lat = clamp_between(prev_lat, hit_lat, hit_lat).clamp(-34.8, -15.2);
            (lat, australia_west_coast_lon(lat) - 0.02)
        }
        LandHit::Reunion | LandHit::Mauritius | LandHit::Indonesia | LandHit::None => {
            ((prev_lat + hit_lat) / 2.0, (prev_lon + hit_lon) / 2.0)
        }
    }
}

fn clamp_between(a: f64, b: f64, fallback: f64) -> f64 {
    let min = a.min(b);
    let max = a.max(b);
    fallback.clamp(min, max)
}

fn merge_counts(target: &mut BTreeMap<String, u32>, source: BTreeMap<String, u32>) {
    for (key, value) in source {
        *target.entry(key).or_insert(0) += value;
    }
}

fn lat_offset_km(km: f64) -> f64 {
    km / 111.32
}

fn lon_offset_km(lat: f64, km: f64) -> f64 {
    km / (111.32 * lat.to_radians().cos().abs().max(0.2))
}

pub fn is_on_land(lat: f64, lon: f64) -> bool {
    land_check(lat, lon).is_land()
}

pub fn coastline_lon(lat: f64) -> f64 {
    africa_east_coast_lon(lat)
}

fn land_check(lat: f64, lon: f64) -> LandHit {
    if lat > -21.8 && lat < -20.3 && lon > 54.8 && lon < 56.2 {
        return LandHit::Reunion;
    }
    if lat > -20.9 && lat < -19.6 && lon > 56.9 && lon < 58.2 {
        return LandHit::Mauritius;
    }
    if lat > -12.6 && lat < -11.2 && lon > 43.0 && lon < 44.6 {
        return LandHit::AfricaEast;
    }
    if lat > -5.2 && lat < -4.0 && lon > 55.0 && lon < 56.2 {
        return LandHit::AfricaEast;
    }
    if lat > -26.0 && lat < -11.5 && lon > 42.5 && lon < 50.8 {
        let west = madagascar_west_coast(lat);
        let east = madagascar_east_coast(lat);
        if lon >= west && lon <= east {
            return if lon < (west + east) / 2.0 {
                LandHit::MadagascarWest
            } else {
                LandHit::MadagascarEast
            };
        }
    }
    if lat > -2.0 && lat < 12.0 && lon < 52.0 && lon < somalia_coast_lon(lat) {
        return LandHit::AfricaEast;
    }
    if lat > 10.0 && lat < 16.0 && lon > 43.0 && lon < 55.0 {
        return LandHit::AfricaEast;
    }
    if lat > 16.0 && lat < 25.0 && lon > 53.0 && lon < 60.0 {
        return LandHit::AfricaEast;
    }
    if lat > 5.0 && lat < 12.0 && lon > 76.0 && lon < 82.0 {
        return LandHit::AfricaEast;
    }
    if lat > -30.0 && lat < 0.0 && lon < africa_east_coast_lon(lat) {
        return LandHit::AfricaEast;
    }
    if lat > -34.5 && lat <= -30.0 {
        let east_coast = lerp(30.0, 28.0, ((lat + 30.0) / -4.5).clamp(0.0, 1.0));
        if lon < east_coast {
            return LandHit::AfricaSouth;
        }
    }
    if lat > -35.5
        && lat <= -33.0
        && lon > 18.0
        && lon < 28.0
        && lat > south_africa_south_coast_lat(lon)
    {
        return LandHit::AfricaSouth;
    }
    if lat > -34.0 && lat < -30.0 && lon > 17.0 && lon < 19.0 {
        return LandHit::AfricaSouth;
    }
    if lat > -35.0 && lat < -15.0 && lon > australia_west_coast_lon(lat) && lon > 113.0 {
        return LandHit::WesternAustralia;
    }
    if lat > -40.0
        && lat < -31.0
        && lon > 115.0
        && lon < 150.0
        && lat > australia_south_coast_lat(lon)
    {
        return LandHit::WesternAustralia;
    }
    if lat > -10.0 && lon > 100.0 && lat < 5.0 {
        return LandHit::Indonesia;
    }
    LandHit::None
}

fn madagascar_west_coast(lat: f64) -> f64 {
    if lat > -14.0 {
        lerp(49.0, 46.5, ((lat + 14.0) / -2.0).clamp(0.0, 1.0))
    } else if lat > -19.0 {
        lerp(46.5, 43.5, ((lat + 14.0) / -5.0).clamp(0.0, 1.0))
    } else if lat > -23.0 {
        43.5
    } else {
        lerp(43.5, 45.0, ((lat + 23.0) / -2.5).clamp(0.0, 1.0))
    }
}

fn madagascar_east_coast(lat: f64) -> f64 {
    if lat > -14.0 {
        lerp(49.3, 50.0, ((lat + 14.0) / -2.0).clamp(0.0, 1.0))
    } else if lat > -19.0 {
        50.0
    } else if lat > -23.0 {
        lerp(50.0, 49.0, ((lat + 19.0) / -4.0).clamp(0.0, 1.0))
    } else {
        lerp(49.0, 47.0, ((lat + 23.0) / -2.5).clamp(0.0, 1.0))
    }
}

fn somalia_coast_lon(lat: f64) -> f64 {
    if lat < 0.0 {
        41.5
    } else if lat < 2.0 {
        lerp(41.5, 45.0, (lat / 2.0).clamp(0.0, 1.0))
    } else if lat < 5.0 {
        lerp(45.0, 47.0, ((lat - 2.0) / 3.0).clamp(0.0, 1.0))
    } else if lat < 10.0 {
        lerp(47.0, 49.5, ((lat - 5.0) / 5.0).clamp(0.0, 1.0))
    } else {
        lerp(49.5, 51.5, ((lat - 10.0) / 2.0).clamp(0.0, 1.0))
    }
}

fn africa_east_coast_lon(lat: f64) -> f64 {
    if lat < -30.0 {
        lerp(32.0, 30.0, ((lat + 30.0) / -5.0).clamp(0.0, 1.0))
    } else if lat < -25.0 {
        lerp(32.5, 35.5, ((lat + 30.0) / 5.0).clamp(0.0, 1.0))
    } else if lat < -15.0 {
        lerp(35.5, 40.5, ((lat + 25.0) / 10.0).clamp(0.0, 1.0))
    } else if lat < -8.0 {
        lerp(40.5, 40.0, ((lat + 15.0) / 7.0).clamp(0.0, 1.0))
    } else if lat < -2.0 {
        lerp(40.0, 41.5, ((lat + 8.0) / 6.0).clamp(0.0, 1.0))
    } else {
        41.5
    }
}

fn australia_west_coast_lon(lat: f64) -> f64 {
    if lat < -30.0 {
        115.5
    } else if lat < -22.0 {
        lerp(115.5, 113.5, ((lat + 30.0) / 8.0).clamp(0.0, 1.0))
    } else {
        lerp(113.5, 114.5, ((lat + 22.0) / 7.0).clamp(0.0, 1.0))
    }
}

fn australia_south_coast_lat(lon: f64) -> f64 {
    if lon < 130.0 {
        -33.5
    } else if lon < 140.0 {
        lerp(-33.5, -37.0, ((lon - 130.0) / 10.0).clamp(0.0, 1.0))
    } else {
        -38.0
    }
}

fn south_africa_south_coast_lat(lon: f64) -> f64 {
    if lon < 20.0 {
        -34.3
    } else if lon < 23.0 {
        lerp(-34.5, -34.0, ((lon - 20.0) / 3.0).clamp(0.0, 1.0))
    } else {
        lerp(-34.0, -33.5, ((lon - 23.0) / 5.0).clamp(0.0, 1.0))
    }
}
