//! Drift Dataset Generator v2 — Outcome Labels Only
//!
//! Simulates particles from origins along the 7th arc and records which
//! debris recovery sites each particle reaches, and when. No position
//! snapshots — only start position + outcome labels per particle.
//!
//! Binary output format (little-endian, magic "MH370DL2"):
//!
//!   Header:
//!     magic: [u8; 8] = b"MH370DL2"
//!     version: u8 = 2
//!     n_origins: u32
//!     n_particles_per_origin: u32
//!     max_days: u32
//!     seed_lat_min: f32
//!     seed_lat_max: f32
//!     seed_lon_min: f32
//!     seed_lon_max: f32
//!     created_timestamp: u64
//!
//!   Per particle record (variable length):
//!     origin_idx: u16
//!     particle_idx: u16
//!     n_outcomes: u8
//!     outcomes: [Outcome; n_outcomes] where each Outcome is:
//!       site_id: u8
//!       arrival_day: u16
//!       timing_match: u8 (0 or 1)
//!
//! Checkpoint file: JSON with completed origin indices.

use std::fs;
use std::io::{BufWriter, Write};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rand::rngs::SmallRng;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};

use mh370_lib::mh370::debris_inversion::sample_7th_arc;
use mh370_lib::mh370::drift_transport::{
    advance_particle, hash_seed, Era5FieldProvider, FieldProvider, HybridFieldProvider, NoiseConfig,
    Particle, TRANSPORT_SUBSTEPS_PER_DAY,
};
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::{config, AnalysisConfig};

// ---------------------------------------------------------------------------
// Recovery sites — position, radius, observed recovery day, timing window
// ---------------------------------------------------------------------------

struct Site {
    id: u8,
    #[allow(dead_code)]
    name: &'static str,
    short: &'static str,
    lat: f64,
    lon: f64,
    radius_km: f64,
    obs_day: u16,
    window: u16,
}

const SITES: &[Site] = &[
    Site { id: 0, name: "Reunion", short: "R", lat: -20.9, lon: 55.5, radius_km: 150.0, obs_day: 508, window: 90 },
    Site { id: 1, name: "Mozambique flap", short: "Mf", lat: -25.0, lon: 33.5, radius_km: 300.0, obs_day: 726, window: 120 },
    Site { id: 2, name: "Mozambique panel", short: "Mp", lat: -19.5, lon: 34.8, radius_km: 300.0, obs_day: 721, window: 120 },
    Site { id: 3, name: "Tanzania Pemba", short: "T", lat: -5.1, lon: 39.8, radius_km: 200.0, obs_day: 836, window: 120 },
    Site { id: 4, name: "Rodrigues", short: "Rg", lat: -19.7, lon: 63.4, radius_km: 150.0, obs_day: 837, window: 120 },
    Site { id: 5, name: "Mauritius", short: "Mu", lat: -20.3, lon: 57.5, radius_km: 150.0, obs_day: 752, window: 120 },
    Site { id: 6, name: "Mossel Bay SA", short: "SA", lat: -34.2, lon: 22.1, radius_km: 300.0, obs_day: 726, window: 120 },
    Site { id: 7, name: "Madagascar", short: "Mg", lat: -16.9, lon: 50.0, radius_km: 300.0, obs_day: 820, window: 120 },
];

const N_SITES: usize = 8;

const LEEWAY_COEFF: f64 = 0.025;
const CURRENT_NOISE_MPS: f64 = 0.12;
const WIND_NOISE_MPS: f64 = 0.05;
/// Check proximity every CHECK_INTERVAL days (not every substep — too slow).
const CHECK_INTERVAL: usize = 5;

// ---------------------------------------------------------------------------
// Great-circle distance (standalone, no LatLon allocation in hot loop)
// ---------------------------------------------------------------------------

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

// ---------------------------------------------------------------------------
// Outcome tracking per particle
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Outcome {
    site_id: u8,
    arrival_day: u16,
    timing_match: bool,
}

struct ParticleOutcomes {
    outcomes: Vec<Outcome>,
    /// Bitfield: has this site been reached already? (first-arrival only)
    reached: [bool; N_SITES],
}

impl ParticleOutcomes {
    fn new() -> Self {
        Self {
            outcomes: Vec::new(),
            reached: [false; N_SITES],
        }
    }

    fn check(&mut self, lat: f64, lon: f64, day: usize) {
        for site in SITES {
            let idx = site.id as usize;
            if self.reached[idx] {
                continue;
            }
            let dist = haversine_km(lat, lon, site.lat, site.lon);
            if dist <= site.radius_km {
                let arrival_day = day as u16;
                let timing_match = (arrival_day as i32 - site.obs_day as i32).unsigned_abs() as u16
                    <= site.window;
                self.outcomes.push(Outcome {
                    site_id: site.id,
                    arrival_day,
                    timing_match,
                });
                self.reached[idx] = true;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Aggregate hit counters for terminal display
// ---------------------------------------------------------------------------

struct HitCounters {
    any: [u64; N_SITES],
    timed: [u64; N_SITES],
    best_reunion_origin: Option<(f64, f64, u64)>,
}

impl HitCounters {
    fn new() -> Self {
        Self {
            any: [0; N_SITES],
            timed: [0; N_SITES],
            best_reunion_origin: None,
        }
    }

    fn add_origin(&mut self, lat: f64, lon: f64, outcomes: &[ParticleOutcomes]) {
        let mut origin_timed_reunion = 0u64;
        for po in outcomes {
            for &o in &po.outcomes {
                self.any[o.site_id as usize] += 1;
                if o.timing_match {
                    self.timed[o.site_id as usize] += 1;
                    if o.site_id == 0 {
                        origin_timed_reunion += 1;
                    }
                }
            }
        }
        if let Some((_, _, best)) = self.best_reunion_origin {
            if origin_timed_reunion > best {
                self.best_reunion_origin = Some((lat, lon, origin_timed_reunion));
            }
        } else if origin_timed_reunion > 0 {
            self.best_reunion_origin = Some((lat, lon, origin_timed_reunion));
        }
    }

    fn format_row(&self, label: &str, counts: &[u64; N_SITES]) -> String {
        let parts: Vec<String> = SITES
            .iter()
            .map(|s| format!("{}:{}", s.short, counts[s.id as usize]))
            .collect();
        format!("{}: {}", label, parts.join(" "))
    }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct Checkpoint {
    completed_origins: Vec<usize>,
    n_origins: usize,
    n_particles: usize,
    output_path: String,
    version: u8,
}

fn load_checkpoint(path: &str, n_origins: usize, n_particles: usize, output_path: &str) -> Checkpoint {
    if let Ok(data) = fs::read_to_string(path) {
        if let Ok(cp) = serde_json::from_str::<Checkpoint>(&data) {
            if cp.version == 2
                && cp.n_origins == n_origins
                && cp.n_particles == n_particles
                && cp.output_path == output_path
            {
                eprintln!(
                    "Resuming from checkpoint: {}/{} origins complete",
                    cp.completed_origins.len(),
                    n_origins,
                );
                return cp;
            }
            eprintln!("WARNING: checkpoint parameters don't match, starting fresh");
        }
    }
    Checkpoint {
        completed_origins: Vec::new(),
        n_origins,
        n_particles,
        output_path: output_path.to_string(),
        version: 2,
    }
}

fn save_checkpoint(path: &str, checkpoint: &Checkpoint) {
    let json = serde_json::to_string(checkpoint).expect("failed to serialize checkpoint");
    fs::write(path, json).expect("failed to write checkpoint");
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

fn write_header(
    path: &str,
    n_origins: usize,
    n_particles: usize,
    max_days: usize,
    origins: &[(f64, f64)],
) {
    let mut file = fs::File::create(path).expect("failed to create output file");
    file.write_all(b"MH370DL2").unwrap();
    file.write_all(&[2u8]).unwrap(); // version
    file.write_all(&(n_origins as u32).to_le_bytes()).unwrap();
    file.write_all(&(n_particles as u32).to_le_bytes()).unwrap();
    file.write_all(&(max_days as u32).to_le_bytes()).unwrap();

    let lat_min = origins.iter().map(|o| o.0).fold(f64::MAX, f64::min) as f32;
    let lat_max = origins.iter().map(|o| o.0).fold(f64::MIN, f64::max) as f32;
    let lon_min = origins.iter().map(|o| o.1).fold(f64::MAX, f64::min) as f32;
    let lon_max = origins.iter().map(|o| o.1).fold(f64::MIN, f64::max) as f32;

    file.write_all(&lat_min.to_le_bytes()).unwrap();
    file.write_all(&lat_max.to_le_bytes()).unwrap();
    file.write_all(&lon_min.to_le_bytes()).unwrap();
    file.write_all(&lon_max.to_le_bytes()).unwrap();

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    file.write_all(&ts.to_le_bytes()).unwrap();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

fn simulate_origin(
    provider: &impl FieldProvider,
    lat: f64,
    lon: f64,
    n_particles: usize,
    max_days: usize,
) -> Vec<ParticleOutcomes> {
    let seed = hash_seed(lat, lon, max_days as f64);
    let mut rng = SmallRng::seed_from_u64(seed);
    let noise = NoiseConfig {
        current_noise_mps: CURRENT_NOISE_MPS,
        wind_noise_mps: WIND_NOISE_MPS,
    };

    let mut particles: Vec<Particle> = (0..n_particles)
        .map(|_| Particle { lat, lon })
        .collect();
    let mut outcomes: Vec<ParticleOutcomes> = (0..n_particles)
        .map(|_| ParticleOutcomes::new())
        .collect();

    for day in 0..max_days {
        for particle in particles.iter_mut() {
            for substep in 0..TRANSPORT_SUBSTEPS_PER_DAY {
                advance_particle(
                    particle,
                    provider,
                    day,
                    substep,
                    TRANSPORT_SUBSTEPS_PER_DAY,
                    LEEWAY_COEFF,
                    noise,
                    &mut rng,
                );
            }
        }

        // Check proximity every CHECK_INTERVAL days
        if day % CHECK_INTERVAL == 0 || day == max_days - 1 {
            for (i, particle) in particles.iter().enumerate() {
                outcomes[i].check(particle.lat, particle.lon, day);
            }
        }
    }

    outcomes
}

fn write_origin_outcomes(
    writer: &mut impl Write,
    origin_idx: u16,
    outcomes: &[ParticleOutcomes],
) {
    for (particle_idx, po) in outcomes.iter().enumerate() {
        writer.write_all(&origin_idx.to_le_bytes()).unwrap();
        writer.write_all(&(particle_idx as u16).to_le_bytes()).unwrap();
        let n = po.outcomes.len().min(255) as u8;
        writer.write_all(&[n]).unwrap();
        for outcome in po.outcomes.iter().take(n as usize) {
            writer.write_all(&[outcome.site_id]).unwrap();
            writer.write_all(&outcome.arrival_day.to_le_bytes()).unwrap();
            writer.write_all(&[outcome.timing_match as u8]).unwrap();
        }
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

fn parse_arg<T: std::str::FromStr>(args: &[String], flag: &str) -> Option<T> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

fn parse_arg_str(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Quick dump mode: print origin grid and exit
    if args.iter().any(|a| a == "--dump-origins") {
        let n_origins: usize = parse_arg(&args, "--origins").unwrap_or(100);
        let satellite = SatelliteModel::load().expect("failed to load satellite model");
        let config = config::load_config().map(|r| r.config).unwrap_or_default();
        let all = sample_7th_arc(&satellite, Some(config));
        let step = (all.len() as f64 / n_origins as f64).max(1.0);
        println!("origin_idx,lat,lon");
        for i in 0..n_origins {
            let idx = ((i as f64 * step) as usize).min(all.len() - 1);
            let (lat, lon) = all[idx];
            println!("{i},{lat:.4},{lon:.4}");
        }
        return;
    }

    let n_particles: usize = parse_arg(&args, "--particles").unwrap_or(50_000);
    let batch_size: usize = parse_arg(&args, "--batch-size").unwrap_or(5);
    let n_origins: usize = parse_arg(&args, "--origins").unwrap_or(100);
    let max_days: usize = parse_arg(&args, "--max-days").unwrap_or(900);
    let use_era5 = args.iter().any(|a| a == "--era5");
    let output_path = parse_arg_str(&args, "--output")
        .unwrap_or_else(|| "drift_dataset_v2.bin".to_string());
    let checkpoint_path = format!("{}.checkpoint", &output_path);

    eprintln!("=== Drift Dataset Generator v2 (Outcome Labels) ===");
    eprintln!("Origins:    {n_origins}");
    eprintln!("Particles:  {n_particles} per origin");
    eprintln!("Max days:   {max_days}");
    eprintln!("Batch size: {batch_size}");
    eprintln!("Output:     {output_path}");
    eprintln!("Wind:       {}", if use_era5 { "ERA5 reanalysis" } else { "Synthetic climatology" });
    eprintln!("Sites:      {}", SITES.iter().map(|s| s.short).collect::<Vec<_>>().join(", "));
    eprintln!();

    // Load origin grid from 7th arc
    let satellite = SatelliteModel::load().expect("failed to load satellite model");
    let config = config::load_config()
        .map(|r| r.config)
        .unwrap_or_else(|_| AnalysisConfig::default());
    let all_arc_points = sample_7th_arc(&satellite, Some(config));

    if all_arc_points.is_empty() {
        eprintln!("ERROR: no arc points generated");
        std::process::exit(1);
    }

    let step = (all_arc_points.len() as f64 / n_origins as f64).max(1.0);
    let origins: Vec<(f64, f64)> = (0..n_origins)
        .map(|i| {
            let idx = ((i as f64 * step) as usize).min(all_arc_points.len() - 1);
            all_arc_points[idx]
        })
        .collect();

    eprintln!(
        "Arc: {} points, {} sampled | Lat: {:.1}°S to {:.1}°S",
        all_arc_points.len(),
        origins.len(),
        origins.first().unwrap().0.abs(),
        origins.last().unwrap().0.abs(),
    );
    eprintln!();

    // Load or create checkpoint
    let mut checkpoint = load_checkpoint(&checkpoint_path, origins.len(), n_particles, &output_path);

    // Write header if starting fresh
    if checkpoint.completed_origins.is_empty() {
        write_header(&output_path, origins.len(), n_particles, max_days, &origins);
    }

    let total_batches = (origins.len() + batch_size - 1) / batch_size;
    let start_time = Instant::now();
    let mut counters = HitCounters::new();

    // Provider dispatch — we need to monomorphize at the call site
    if use_era5 {
        eprintln!("Using ERA5 wind provider (loading cache on first batch)...");
        let provider = Era5FieldProvider;
        run_batches(&provider, &origins, &mut checkpoint, &mut counters, batch_size, total_batches, n_particles, max_days, &output_path, &checkpoint_path, &start_time);
    } else {
        let provider = HybridFieldProvider;
        run_batches(&provider, &origins, &mut checkpoint, &mut counters, batch_size, total_batches, n_particles, max_days, &output_path, &checkpoint_path, &start_time);
    }

    // Clean up checkpoint on completion
    if checkpoint.completed_origins.len() == origins.len() {
        let _ = fs::remove_file(&checkpoint_path);
        eprintln!("=== COMPLETE ===");
    } else {
        eprintln!(
            "=== INTERRUPTED — {} of {} origins complete ===",
            checkpoint.completed_origins.len(),
            origins.len(),
        );
        eprintln!("Resume with the same command.");
    }

    let file_size = fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
    eprintln!("Output: {} ({:.1} MB)", output_path, file_size as f64 / 1_048_576.0);
    eprintln!("Total time: {:.1}s", start_time.elapsed().as_secs_f64());

    // Final summary
    eprintln!();
    eprintln!("=== Final Hit Summary ===");
    eprintln!("  {}", counters.format_row("Hits (any) ", &counters.any));
    eprintln!("  {}", counters.format_row("Hits (timed)", &counters.timed));
    if let Some((rlat, rlon, rcount)) = counters.best_reunion_origin {
        eprintln!(
            "  Best Reunion: {:.1}°S, {:.1}°E ({} timed hits)",
            rlat.abs(), rlon, rcount,
        );
    } else {
        eprintln!("  No timing-matched Reunion hits from any origin.");
    }
}

fn run_batches(
    provider: &impl FieldProvider,
    origins: &[(f64, f64)],
    checkpoint: &mut Checkpoint,
    counters: &mut HitCounters,
    batch_size: usize,
    total_batches: usize,
    n_particles: usize,
    max_days: usize,
    output_path: &str,
    checkpoint_path: &str,
    start_time: &Instant,
) {
    for batch_idx in 0..total_batches {
        let batch_start = batch_idx * batch_size;
        let batch_end = (batch_start + batch_size).min(origins.len());

        let batch_origins: Vec<usize> = (batch_start..batch_end)
            .filter(|i| !checkpoint.completed_origins.contains(i))
            .collect();

        if batch_origins.is_empty() {
            continue;
        }

        let batch_t = Instant::now();

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&output_path)
            .expect("failed to open output file");
        let mut writer = BufWriter::new(&mut file);

        for &origin_idx in &batch_origins {
            let (lat, lon) = origins[origin_idx];
            let outcomes = simulate_origin(provider, lat, lon, n_particles, max_days);
            counters.add_origin(lat, lon, &outcomes);
            write_origin_outcomes(&mut writer, origin_idx as u16, &outcomes);
            checkpoint.completed_origins.push(origin_idx);
        }

        writer.flush().unwrap();
        drop(writer);
        save_checkpoint(&checkpoint_path, &checkpoint);

        let elapsed = start_time.elapsed().as_secs_f64();
        let done = checkpoint.completed_origins.len();
        let eta_s = if done > 0 {
            elapsed / done as f64 * (origins.len() - done) as f64
        } else {
            0.0
        };
        let elapsed_m = elapsed / 60.0;
        let eta_m = eta_s / 60.0;

        eprintln!(
            "Batch {:03}/{} | Origins {}-{} | Time: {:.1}s | Elapsed: {:.0}m{:02.0}s | ETA: {:.0}m{:02.0}s",
            batch_idx + 1,
            total_batches,
            batch_start,
            batch_end - 1,
            batch_t.elapsed().as_secs_f64(),
            elapsed_m.floor(),
            elapsed % 60.0,
            eta_m.floor(),
            eta_s % 60.0,
        );
        eprintln!("  {}", counters.format_row("Hits (any) ", &counters.any));
        eprintln!("  {}", counters.format_row("Hits (timed)", &counters.timed));
        if let Some((rlat, rlon, rcount)) = counters.best_reunion_origin {
            eprintln!(
                "  Best Reunion origin so far: {:.1}°S, {:.1}°E ({} timed hits)",
                rlat.abs(),
                rlon,
                rcount,
            );
        }
        eprintln!();
    }
}
