//! Multi-site drift comparison: impact zone vs ATSB search corridor.
//!
//! Runs identical particle simulations from two origins and compares debris
//! arrival matches. Tests whether drift evidence discriminates between
//! our impact zone (~35.9°S, 90.8°E) and the ATSB search corridor (~35°S, 95°E).
//!
//! Run: cargo run --bin drift_oscar_check

use mh370_lib::mh370::drift_transport::{
    advance_particle, hash_seed, NoiseConfig, OscarFieldProvider, Particle,
};
use rand::rngs::SmallRng;
use rand::SeedableRng;

const N_PARTICLES: usize = 1000;
const MAX_DAYS: usize = 900;
const SUBSTEPS_PER_DAY: usize = 4;
const LEEWAY_COEFF: f64 = 0.025;
const CURRENT_NOISE_MPS: f64 = 0.07;
const WIND_NOISE_MPS: f64 = 0.03;

struct Origin {
    label: &'static str,
    lat_min: f64,
    lat_max: f64,
    lon_min: f64,
    lon_max: f64,
}

const ORIGINS: &[Origin] = &[
    // Our impact zone: Arc 7 crossing + glide displacement
    Origin {
        label: "Our impact zone (90.4-91.8°E)",
        lat_min: -36.5,
        lat_max: -34.8,
        lon_min: 90.4,
        lon_max: 91.8,
    },
    // ATSB Phase 2 search corridor center: ~35°S along 93-97°E
    // This is the area that was actually searched and found nothing
    Origin {
        label: "ATSB corridor (93-97°E)",
        lat_min: -36.0,
        lat_max: -34.0,
        lon_min: 93.0,
        lon_max: 97.0,
    },
];

struct RecoverySite {
    name: &'static str,
    lat: f64,
    lon: f64,
    observed_day: usize,
    radius_km: f64,
    confirmed: bool,
}

// Source: mh370_data.json, ATSB "MH370 Search and debris examination update" (Nov 2016)
const SITES: &[RecoverySite] = &[
    RecoverySite {
        name: "Flaperon, Reunion",
        lat: -20.9,
        lon: 55.5,
        observed_day: 508,
        radius_km: 150.0,
        confirmed: true,
    },
    RecoverySite {
        name: "Flap, Mozambique",
        lat: -15.5,
        lon: 36.0,
        observed_day: 726,
        radius_km: 250.0,
        confirmed: true,
    },
    RecoverySite {
        name: "No Step panel, Mozambique",
        lat: -16.0,
        lon: 36.2,
        observed_day: 722,
        radius_km: 250.0,
        confirmed: true,
    },
    RecoverySite {
        name: "Outboard flap, Pemba Tanzania",
        lat: -5.1,
        lon: 39.8,
        observed_day: 837,
        radius_km: 250.0,
        confirmed: true,
    },
    RecoverySite {
        name: "Panel, Mossel Bay SA",
        lat: -34.0,
        lon: 22.1,
        observed_day: 660,
        radius_km: 250.0,
        confirmed: false,
    },
    RecoverySite {
        name: "Trim panel, Tanzania",
        lat: -8.5,
        lon: 40.0,
        observed_day: 838,
        radius_km: 250.0,
        confirmed: false,
    },
    RecoverySite {
        name: "Window, Rodrigues Is.",
        lat: -19.7,
        lon: 63.4,
        observed_day: 838,
        radius_km: 200.0,
        confirmed: false,
    },
];

struct SiteResult {
    hits: usize,
    arrival_min: Option<usize>,
    arrival_max: Option<usize>,
    closest_km: f64,
    timing_ok: bool,
}

fn run_simulation(origin: &Origin) -> Vec<SiteResult> {
    let provider = OscarFieldProvider;
    let noise = NoiseConfig {
        current_noise_mps: CURRENT_NOISE_MPS,
        wind_noise_mps: WIND_NOISE_MPS,
    };

    // Distribute particles using a jittered grid across the envelope.
    // Use a base grid and add per-particle noise so we get uniform coverage
    // without clustering at grid nodes.
    let n_particles = N_PARTICLES;
    let grid_side = (n_particles as f64).sqrt().ceil() as usize;
    let mut base_rng = SmallRng::seed_from_u64(hash_seed(
        origin.lat_min,
        origin.lon_min,
        n_particles as f64,
    ));

    let mut particles: Vec<Particle> = Vec::with_capacity(n_particles);
    for i in 0..n_particles {
        let row = i / grid_side;
        let col = i % grid_side;
        // Base grid position + small jitter from the per-particle RNG
        let lat_frac = (row as f64 + 0.5) / grid_side as f64;
        let lon_frac = (col as f64 + 0.5) / grid_side as f64;
        let lat = origin.lat_min + (origin.lat_max - origin.lat_min) * lat_frac.min(1.0);
        let lon = origin.lon_min + (origin.lon_max - origin.lon_min) * lon_frac.min(1.0);
        particles.push(Particle { lat, lon });
    }

    let mut rngs: Vec<SmallRng> = (0..n_particles)
        .map(|i| {
            let seed = hash_seed(particles[i].lat, particles[i].lon, i as f64);
            SmallRng::seed_from_u64(seed)
        })
        .collect();

    // Per-site tracking
    let mut arrivals: Vec<Vec<(usize, usize)>> = SITES.iter().map(|_| Vec::new()).collect();
    let mut closest: Vec<f64> = SITES.iter().map(|_| f64::MAX).collect();

    for day in 0..MAX_DAYS {
        for idx in 0..n_particles {
            for substep in 0..SUBSTEPS_PER_DAY {
                advance_particle(
                    &mut particles[idx],
                    &provider,
                    day,
                    substep,
                    SUBSTEPS_PER_DAY,
                    LEEWAY_COEFF,
                    noise,
                    &mut rngs[idx],
                );
            }
        }

        for (si, site) in SITES.iter().enumerate() {
            for (pid, particle) in particles.iter().enumerate() {
                let dist = distance_km(particle.lat, particle.lon, site.lat, site.lon);
                if dist < closest[si] {
                    closest[si] = dist;
                }
                if dist < site.radius_km && !arrivals[si].iter().any(|(id, _)| *id == pid) {
                    arrivals[si].push((pid, day + 1));
                }
            }
        }
    }

    // Build results
    SITES
        .iter()
        .enumerate()
        .map(|(si, site)| {
            let hits = arrivals[si].len();
            let arrival_min = arrivals[si].iter().map(|(_, d)| *d).min();
            let arrival_max = arrivals[si].iter().map(|(_, d)| *d).max();
            let timing_ok = if let (Some(lo), Some(hi)) = (arrival_min, arrival_max) {
                site.observed_day >= lo.saturating_sub(60) && site.observed_day <= hi + 60
            } else {
                false
            };
            SiteResult {
                hits,
                arrival_min,
                arrival_max,
                closest_km: closest[si],
                timing_ok,
            }
        })
        .collect()
}

fn main() {
    let n_particles = N_PARTICLES;
    eprintln!("=== OSCAR Drift Comparison: Impact Zone vs ATSB Corridor ===\n");
    eprintln!("Particles per origin: {n_particles}, max days: {MAX_DAYS}");
    eprintln!(
        "Leeway: {LEEWAY_COEFF}, noise: {CURRENT_NOISE_MPS}/{WIND_NOISE_MPS} m/s\n"
    );

    // Run both simulations
    let mut all_results: Vec<(&Origin, Vec<SiteResult>)> = Vec::new();
    for origin in ORIGINS {
        eprintln!("--- Running: {} ---", origin.label);
        eprintln!(
            "    {:.1}-{:.1}°S, {:.1}-{:.1}°E",
            -origin.lat_max, -origin.lat_min, origin.lon_min, origin.lon_max
        );
        let results = run_simulation(origin);
        all_results.push((origin, results));
    }

    // Side-by-side comparison
    eprintln!("\n=== Side-by-Side Comparison ===\n");

    // Header
    eprintln!(
        "{:<35} | {:^30} | {:^30}",
        "", ORIGINS[0].label, ORIGINS[1].label
    );
    eprintln!(
        "{:<35} | {:>5} {:>13} {:>8} | {:>5} {:>13} {:>8}",
        "Site (obs day)", "Hits", "Arrival", "Timing", "Hits", "Arrival", "Timing"
    );
    eprintln!("{}", "-".repeat(105));

    let mut score_a = 0u32;
    let mut score_b = 0u32;
    let mut timing_a = 0u32;
    let mut timing_b = 0u32;

    for (si, site) in SITES.iter().enumerate() {
        let ra = &all_results[0].1[si];
        let rb = &all_results[1].1[si];
        let tag = if site.confirmed { "*" } else { " " };

        let range_str = |r: &SiteResult| -> String {
            match (r.arrival_min, r.arrival_max) {
                (Some(lo), Some(hi)) => format!("{lo}-{hi}"),
                _ => "-".to_string(),
            }
        };

        let timing_str = |r: &SiteResult| -> &str {
            if r.timing_ok {
                "OK"
            } else if r.hits > 0 {
                "miss"
            } else {
                "-"
            }
        };

        eprintln!(
            "{tag}{:<30} {:>3} | {:>5} {:>13} {:>8} | {:>5} {:>13} {:>8}",
            site.name,
            site.observed_day,
            ra.hits,
            range_str(ra),
            timing_str(ra),
            rb.hits,
            range_str(rb),
            timing_str(rb),
        );

        if site.confirmed {
            if ra.hits > 0 {
                score_a += 1;
            }
            if rb.hits > 0 {
                score_b += 1;
            }
            if ra.timing_ok {
                timing_a += 1;
            }
            if rb.timing_ok {
                timing_b += 1;
            }
        }
    }

    let total_confirmed = SITES.iter().filter(|s| s.confirmed).count() as u32;
    eprintln!("\n* = officially confirmed MH370 debris\n");
    eprintln!("                                    {:^30} | {:^30}", ORIGINS[0].label, ORIGINS[1].label);
    eprintln!(
        "  Confirmed sites reached:          {:^30} | {:^30}",
        format!("{score_a}/{total_confirmed}"),
        format!("{score_b}/{total_confirmed}")
    );
    eprintln!(
        "  Timing-consistent (confirmed):    {:^30} | {:^30}",
        format!("{timing_a}/{total_confirmed}"),
        format!("{timing_b}/{total_confirmed}")
    );

    // Aggregate hit counts for confirmed sites
    let total_hits_a: usize = SITES
        .iter()
        .enumerate()
        .filter(|(_, s)| s.confirmed)
        .map(|(i, _)| all_results[0].1[i].hits)
        .sum();
    let total_hits_b: usize = SITES
        .iter()
        .enumerate()
        .filter(|(_, s)| s.confirmed)
        .map(|(i, _)| all_results[1].1[i].hits)
        .sum();
    eprintln!(
        "  Total confirmed-site hits:        {:^30} | {:^30}",
        total_hits_a, total_hits_b
    );

    eprintln!("\n=== Assessment ===\n");
    if timing_a > timing_b {
        eprintln!(
            "Drift evidence FAVORS our impact zone ({timing_a} vs {timing_b} timing matches)."
        );
        eprintln!("This is an independent constraint beyond BTO/BFO.");
    } else if timing_a == timing_b {
        eprintln!(
            "Drift evidence does NOT discriminate ({timing_a} vs {timing_b} timing matches)."
        );
        eprintln!("Both origins produce comparable debris matches. Drift corroborates BTO/BFO but adds no independent directional constraint on longitude.");
    } else {
        eprintln!(
            "Drift evidence FAVORS the ATSB corridor ({timing_b} vs {timing_a} timing matches)."
        );
        eprintln!("This is a tension with the BTO/BFO result that places the impact west of the searched area.");
    }
}

fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let dlat = (lat1 - lat2) * 111.32;
    let mid_lat = (lat1 + lat2) / 2.0;
    let dlon = (lon1 - lon2) * 111.32 * mid_lat.to_radians().cos().abs();
    (dlat * dlat + dlon * dlon).sqrt()
}
