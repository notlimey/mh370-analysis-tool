use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use serde::Serialize;

use super::hycom_currents::hycom_current_at;

pub const DEGREES_PER_KM_LAT: f64 = 1.0 / 111.32;
const CURRENT_NOISE_MPS: f64 = 0.07;
const WIND_NOISE_MPS: f64 = 0.03;
const N_PARTICLES: usize = 24;
const N_PARTICLES_VIZ: usize = 150;
const VIZ_CURRENT_NOISE_MPS: f64 = 0.05;
const VIZ_WIND_NOISE_MPS: f64 = 0.02;
const VIZ_DRIFT_DAYS: f64 = 300.0;
const CRASH_MONTH: u32 = 3;
pub const TRANSPORT_SUBSTEPS_PER_DAY: usize = 4;
const ENSEMBLE_SUBSTEPS_PER_DAY: usize = 2;

#[derive(Debug, Clone, Copy)]
pub struct Particle {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct DriftState {
    pub lat: f64,
    pub lon: f64,
    pub month: u32,
    pub day_index: usize,
    pub leeway_coeff: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct DriftVector {
    pub u_current: f64,
    pub v_current: f64,
    pub u_wind: f64,
    pub v_wind: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct NoiseConfig {
    pub current_noise_mps: f64,
    pub wind_noise_mps: f64,
}

pub trait FieldProvider {
    fn forcing(&self, state: DriftState) -> DriftVector;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct HybridFieldProvider;

impl FieldProvider for HybridFieldProvider {
    fn forcing(&self, state: DriftState) -> DriftVector {
        let (u_current, v_current) = hycom_current_at(state.day_index, state.lat, state.lon)
            .unwrap_or_else(|| synthetic_current_field_at(state.lat, state.lon, state.month));
        let (u_wind, v_wind) = wind_field_at(state.lat, state.lon, state.leeway_coeff, state.month);
        DriftVector {
            u_current,
            v_current,
            u_wind,
            v_wind,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ParticleCloud {
    pub origin_lat: f64,
    pub origin_lon: f64,
    pub n_days: f64,
    pub particles: Vec<[f64; 2]>,
    pub hull: Vec<[f64; 2]>,
}

pub fn simulate_particle_cloud_for_viz(
    origin_lat: f64,
    origin_lon: f64,
    leeway_coeff: f64,
) -> ParticleCloud {
    let seed = hash_seed(origin_lat, origin_lon, VIZ_DRIFT_DAYS);
    let particles =
        simulate_ensemble_viz(origin_lat, origin_lon, VIZ_DRIFT_DAYS, leeway_coeff, seed);
    let points: Vec<[f64; 2]> = particles.iter().map(|p| [p.lon, p.lat]).collect();
    let hull = convex_hull(&points);
    ParticleCloud {
        origin_lat,
        origin_lon,
        n_days: VIZ_DRIFT_DAYS,
        particles: points,
        hull,
    }
}

pub fn simulate_ensemble(
    origin_lat: f64,
    origin_lon: f64,
    n_days: f64,
    leeway_coeff: f64,
    seed: u64,
) -> Vec<Particle> {
    simulate_ensemble_n(
        origin_lat,
        origin_lon,
        n_days,
        leeway_coeff,
        seed,
        N_PARTICLES,
    )
}

pub fn simulate_ensemble_n(
    origin_lat: f64,
    origin_lon: f64,
    n_days: f64,
    leeway_coeff: f64,
    seed: u64,
    n: usize,
) -> Vec<Particle> {
    let provider = HybridFieldProvider;
    let total_days = n_days.max(1.0).round() as usize;
    let mut rng = SmallRng::seed_from_u64(seed);
    let mut particles: Vec<Particle> = (0..n)
        .map(|_| Particle {
            lat: origin_lat,
            lon: origin_lon,
        })
        .collect();

    for day in 0..total_days {
        for particle in &mut particles {
            for substep in 0..ENSEMBLE_SUBSTEPS_PER_DAY {
                advance_particle(
                    particle,
                    &provider,
                    day,
                    substep,
                    ENSEMBLE_SUBSTEPS_PER_DAY,
                    leeway_coeff,
                    NoiseConfig {
                        current_noise_mps: CURRENT_NOISE_MPS,
                        wind_noise_mps: WIND_NOISE_MPS,
                    },
                    &mut rng,
                );
            }
        }
    }

    particles
}

fn simulate_ensemble_viz(
    origin_lat: f64,
    origin_lon: f64,
    n_days: f64,
    leeway_coeff: f64,
    seed: u64,
) -> Vec<Particle> {
    let provider = HybridFieldProvider;
    let total_days = n_days.max(1.0).round() as usize;
    let mut rng = SmallRng::seed_from_u64(seed);
    let mut particles: Vec<Particle> = (0..N_PARTICLES_VIZ)
        .map(|_| Particle {
            lat: origin_lat,
            lon: origin_lon,
        })
        .collect();

    for day in 0..total_days {
        for particle in &mut particles {
            for substep in 0..TRANSPORT_SUBSTEPS_PER_DAY {
                advance_particle(
                    particle,
                    &provider,
                    day,
                    substep,
                    TRANSPORT_SUBSTEPS_PER_DAY,
                    leeway_coeff,
                    NoiseConfig {
                        current_noise_mps: VIZ_CURRENT_NOISE_MPS,
                        wind_noise_mps: VIZ_WIND_NOISE_MPS,
                    },
                    &mut rng,
                );
            }
        }
    }

    particles
}

pub fn month_from_day(day: usize) -> u32 {
    ((CRASH_MONTH - 1 + (day as u32) / 30) % 12) + 1
}

fn monsoon_phase(month: u32) -> f64 {
    (2.0 * std::f64::consts::PI * (month as f64 - 4.0) / 12.0).sin()
}

fn sec_strength(month: u32) -> f64 {
    1.0 + 0.15 * monsoon_phase(month)
}

pub fn synthetic_current_field_at(lat: f64, lon: f64, month: u32) -> (f64, f64) {
    let mp = monsoon_phase(month);
    let sec_s = sec_strength(month);

    let mut u_sum = -0.05 * 0.35;
    let mut v_sum = 0.02 * 0.35;
    let mut weight_sum = 0.35;

    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        smooth_cap(lat, -42.0, 2.0),
        0.18,
        0.0,
    );
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        smooth_window(lat, -42.0, -36.0, 2.0),
        lerp(0.18, -0.02, ((lat + 42.0) / 6.0).clamp(0.0, 1.0)),
        lerp(0.0, 0.04, ((lat + 42.0) / 6.0).clamp(0.0, 1.0)),
    );

    let gyre_weight = smooth_window(lat, -39.0, -24.0, 2.5);
    let gyre_t = ((lat + 38.0) / 13.0).clamp(0.0, 1.0);
    let gyre_s = 1.0 + 0.08 * mp;
    let (gyre_u, gyre_v) = if lon > 80.0 {
        (
            lerp(-0.04, -0.08, gyre_t) * gyre_s,
            lerp(0.03, 0.05, gyre_t) * gyre_s,
        )
    } else {
        (
            lerp(-0.05, -0.12, gyre_t) * gyre_s,
            lerp(0.02, 0.04, gyre_t) * gyre_s,
        )
    };
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        gyre_weight,
        gyre_u,
        gyre_v,
    );

    let sec_weight = smooth_window(lat, -27.0, -9.0, 2.5) * smooth_window(lon, 58.0, 105.0, 5.0);
    let sec_t = ((lat + 26.0) / 16.0).clamp(0.0, 1.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        sec_weight,
        lerp(-0.06, -0.12, sec_t) * sec_s,
        lerp(0.01, 0.02, sec_t),
    );

    let east_mad_weight =
        smooth_window(lat, -28.0, -14.0, 2.0) * smooth_window(lon, 46.0, 55.0, 2.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        east_mad_weight,
        -0.06 * (1.0 + 0.1 * mp),
        -0.12 * (1.0 + 0.1 * mp),
    );

    let north_mad_weight =
        smooth_window(lat, -16.0, -7.0, 2.0) * smooth_window(lon, 42.0, 57.0, 3.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        north_mad_weight,
        -0.12 * (1.0 + 0.2 * mp),
        0.06 * (1.0 + 0.2 * mp),
    );

    let deflection_weight =
        smooth_window(lat, -28.0, -11.0, 2.0) * smooth_window(lon, 52.0, 63.0, 2.0);
    let split = smooth_step(lat, -20.0, -16.0);
    let proximity = ((62.0 - lon) / 9.0).clamp(0.0, 1.0);
    let north_u = lerp(-0.12, -0.08, proximity) * sec_s;
    let north_v = lerp(0.02, 0.08, proximity) * sec_s;
    let south_u = lerp(-0.10, -0.05, proximity) * sec_s;
    let south_v = lerp(0.0, -0.08, proximity) * sec_s;
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        deflection_weight,
        lerp(south_u, north_u, split),
        lerp(south_v, north_v, split),
    );

    let reunion_weight =
        smooth_window(lat, -24.0, -17.0, 1.5) * smooth_window(lon, 52.0, 66.0, 2.5);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        reunion_weight,
        -0.08 * sec_s,
        0.01,
    );

    let moz_weight = smooth_window(lat, -27.0, -11.0, 2.5) * smooth_window(lon, 33.0, 45.0, 2.0);
    let moz_t = ((lat + 26.0) / 14.0).clamp(0.0, 1.0);
    let moz_seasonal = 1.0 + 0.1 * mp;
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        moz_weight,
        lerp(-0.08, -0.12, moz_t) * moz_seasonal,
        lerp(-0.14, -0.05, moz_t) * moz_seasonal,
    );

    let west_mad_weight =
        smooth_window(lat, -26.0, -12.0, 2.0) * smooth_window(lon, 41.0, 49.0, 1.8);
    let west_mad_t = ((lat + 26.0) / 14.0).clamp(0.0, 1.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        west_mad_weight,
        lerp(-0.04, -0.09, west_mad_t) * (1.0 + 0.08 * mp),
        lerp(-0.10, -0.02, west_mad_t) * (1.0 + 0.05 * mp),
    );

    let agulhas_weight = smooth_window(lat, -37.0, -23.5, 2.8) * smooth_cap(46.0 - lon, 14.0, 3.0);
    let cape_turn = smooth_cap(35.0 - lon, 3.5, 1.2) * smooth_cap(-29.5 - lat, 3.5, 1.2);
    let cape_leak = smooth_cap(31.0 - lon, 3.0, 1.2) * smooth_cap(-32.8 - lat, 2.4, 1.2);
    let leakage = cape_turn.max(cape_leak);
    let agulhas_u = lerp(-0.09, -0.17, leakage);
    let agulhas_v = lerp(-0.07, -0.01, leakage);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        agulhas_weight,
        agulhas_u,
        agulhas_v,
    );

    // Agulhas leakage: westward transport along South Africa's south coast (~18-30°E)
    // Models debris carried around Cape Agulhas and along the south coast to Mossel Bay
    let sa_south_coast_weight = smooth_window(lat, -36.5, -33.0, 1.5)
        * smooth_window(lon, 17.0, 30.0, 2.0);
    let sa_coast_t = ((lon - 18.0) / 12.0).clamp(0.0, 1.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        sa_south_coast_weight,
        lerp(-0.06, -0.12, sa_coast_t),
        lerp(0.01, -0.02, sa_coast_t),
    );

    let eacc_weight = smooth_window(lat, -15.0, -1.0, 2.0) * smooth_window(lon, 35.0, 43.0, 2.0);
    let base_strength = ((lat + 14.0) / 12.0).clamp(0.0, 1.0);
    let v_base = lerp(-0.02, 0.12, (mp + 1.0) / 2.0) * (1.0 - base_strength * 0.4);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        eacc_weight,
        -0.03,
        v_base,
    );

    // North Madagascar → EACC transition: SEC northern branch rounds Madagascar's tip
    // and feeds northwestward into the East African coast toward Tanzania
    let nmad_eacc_weight = smooth_window(lat, -15.0, -8.0, 2.0)
        * smooth_window(lon, 42.0, 52.0, 2.5);
    let nmad_t = ((lat + 14.0) / 6.0).clamp(0.0, 1.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        nmad_eacc_weight,
        lerp(-0.10, -0.06, nmad_t) * (1.0 + 0.15 * mp),
        lerp(0.04, 0.08, nmad_t) * (1.0 + 0.15 * mp),
    );

    let equatorial_weight = smooth_step(lat, -11.0, -8.0);
    add_regime(
        &mut u_sum,
        &mut v_sum,
        &mut weight_sum,
        equatorial_weight,
        -0.04 + 0.04 * mp.max(0.0),
        0.01,
    );

    (u_sum / weight_sum, v_sum / weight_sum)
}

pub fn wind_field_at(lat: f64, _lon: f64, leeway_coeff: f64, month: u32) -> (f64, f64) {
    let mp = monsoon_phase(month);
    let trade_mod = 1.0 + 0.12 * mp;

    if lat >= -28.0 {
        // SE trade winds: WNW-directed forcing on debris (wind from ESE)
        let wind = 9.0 * leeway_coeff * trade_mod;
        (-wind * 0.75, wind * 0.30)
    } else if lat >= -37.0 {
        // Transition zone: trades fade into mid-latitude westerlies
        let t = ((lat + 37.0) / 9.0).clamp(0.0, 1.0);
        let trade = 8.0 * leeway_coeff * trade_mod;
        let westerly = 10.0 * leeway_coeff;
        let u = lerp(westerly * 0.5, -trade * 0.65, t);
        let v = lerp(-westerly * 0.1, trade * 0.25, t);
        (u, v)
    } else {
        // Roaring Forties: strong westerlies, slight equatorward Ekman drift
        let wind = 11.0 * leeway_coeff;
        (wind * 0.5, -wind * 0.1)
    }
}

pub fn box_muller(rng: &mut SmallRng) -> (f64, f64) {
    let u1: f64 = rng.gen::<f64>().max(1e-15);
    let u2: f64 = rng.gen::<f64>();
    let r = (-2.0_f64 * u1.ln()).sqrt();
    let theta = 2.0 * std::f64::consts::PI * u2;
    (r * theta.cos(), r * theta.sin())
}

pub fn hash_seed(lat: f64, lon: f64, days: f64) -> u64 {
    let bits = lat.to_bits() ^ lon.to_bits().rotate_left(32) ^ days.to_bits().rotate_left(16);
    bits.wrapping_mul(0x517cc1b727220a95)
}

pub fn km_to_lat(km: f64) -> f64 {
    km * DEGREES_PER_KM_LAT
}

pub fn km_to_lon(lat: f64, km: f64) -> f64 {
    km / (111.32 * lat.to_radians().cos().abs().max(0.2))
}

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

pub fn advance_particle(
    particle: &mut Particle,
    provider: &impl FieldProvider,
    day: usize,
    substep: usize,
    substeps_per_day: usize,
    leeway_coeff: f64,
    noise: NoiseConfig,
    rng: &mut SmallRng,
) {
    let month = month_from_day(day);
    let dt_days = 1.0 / substeps_per_day.max(1) as f64;
    let forcing = provider.forcing(DriftState {
        lat: particle.lat,
        lon: particle.lon,
        month,
        day_index: day,
        leeway_coeff,
    });

    let noise_scale = dt_days.sqrt();
    let (n1, n2) = box_muller(rng);
    let (n3, n4) = box_muller(rng);
    let u_total = forcing.u_current
        + forcing.u_wind
        + n1 * noise.current_noise_mps * noise_scale
        + n3 * noise.wind_noise_mps * noise_scale;
    let v_total = forcing.v_current
        + forcing.v_wind
        + n2 * noise.current_noise_mps * noise_scale
        + n4 * noise.wind_noise_mps * noise_scale;

    let seconds = 86_400.0 * dt_days;
    let east_km = u_total * seconds / 1000.0;
    let north_km = v_total * seconds / 1000.0;

    particle.lat += km_to_lat(north_km);
    particle.lon += km_to_lon(particle.lat, east_km);
    particle.lat = particle.lat.clamp(-60.0, 10.0);

    let _ = substep;
}

fn add_regime(u_sum: &mut f64, v_sum: &mut f64, weight_sum: &mut f64, weight: f64, u: f64, v: f64) {
    if weight <= 0.0 {
        return;
    }
    *u_sum += weight * u;
    *v_sum += weight * v;
    *weight_sum += weight;
}

fn smooth_step(value: f64, start: f64, end: f64) -> f64 {
    if start >= end {
        return 0.0;
    }
    let t = ((value - start) / (end - start)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn smooth_window(value: f64, min: f64, max: f64, edge: f64) -> f64 {
    if min >= max {
        return 0.0;
    }
    let rise = smooth_step(value, min - edge, min + edge);
    let fall = 1.0 - smooth_step(value, max - edge, max + edge);
    (rise * fall).clamp(0.0, 1.0)
}

fn smooth_cap(value: f64, threshold: f64, edge: f64) -> f64 {
    1.0 - smooth_step(value, threshold - edge, threshold + edge)
}

fn convex_hull(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap()
            .then(a[1].partial_cmp(&b[1]).unwrap())
    });

    let mut hull: Vec<[f64; 2]> = Vec::new();
    for &p in &sorted {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower_len = hull.len();
    for &p in sorted.iter().rev().skip(1) {
        while hull.len() > lower_len && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0
        {
            hull.pop();
        }
        hull.push(p);
    }
    hull
}

fn cross(o: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}
