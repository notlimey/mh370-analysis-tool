use mh370_lib::config;
use mh370_lib::{run_model_probe, AnalysisConfig};

use mh370_lib::mh370::debris_inversion::{
    load_debris_items, run_joint_inversion_with_progress, sample_7th_arc,
    simulate_beaching_for_items,
};
use mh370_lib::mh370::satellite::SatelliteModel;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let subcommand = args.get(1).map(|s| s.as_str()).unwrap_or("probe");

    match subcommand {
        "beaching" => run_beaching(&args[2..]),
        "beaching-sweep" => run_beaching_sweep(&args[2..]),
        "inversion" => run_inversion(&args[2..]),
        _ => run_probe(&args[1..]),
    }
}

fn load_default_config() -> AnalysisConfig {
    config::load_config()
        .map(|r| r.config)
        .unwrap_or_else(|_| AnalysisConfig::default())
}

/// Run beaching simulation from a single origin point.
/// Usage: model_probe beaching <lat> <lon> [n_particles] [max_days]
fn run_beaching(args: &[String]) {
    let lat: f64 = args
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            eprintln!("Usage: model_probe beaching <lat> <lon> [n_particles] [max_days]");
            std::process::exit(1);
        });
    let lon: f64 = args
        .get(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            eprintln!("Usage: model_probe beaching <lat> <lon> [n_particles] [max_days]");
            std::process::exit(1);
        });
    let n_particles = args.get(2).and_then(|s| s.parse().ok());
    let max_days = args.get(3).and_then(|s| s.parse().ok());

    let items = load_debris_items().expect("failed to load debris items");
    eprintln!(
        "Running beaching simulation from ({lat:.1}°, {lon:.1}°) with {} items, {} particles, {} max days",
        items.len(),
        n_particles.unwrap_or(200),
        max_days.unwrap_or(900),
    );

    let cloud = simulate_beaching_for_items(lat, lon, &items, n_particles, max_days);

    // Print compact summary to stderr
    eprintln!();
    eprintln!("=== BEACHING RESULT ===");
    eprintln!(
        "Origin: {:.1}°S, {:.1}°E",
        cloud.origin_lat.abs(),
        cloud.origin_lon
    );
    eprintln!(
        "Beached: {} / {} ({:.0}%)",
        cloud.beached.len(),
        cloud.beached.len() + cloud.still_drifting.len(),
        cloud.beaching_fraction * 100.0,
    );
    eprintln!();
    eprintln!("Coast contacts / captures:");
    for (coast, contacts) in &cloud.debug_coast_contacts {
        let captures = cloud.debug_coast_captures.get(coast).unwrap_or(&0);
        eprintln!("  {coast}: {contacts} contacts / {captures} captures");
    }
    eprintln!();
    eprintln!(
        "Fit: {:.0}/100 | Spatial: {:.0}/100 | Timing: {:.0}/100",
        cloud.fit_score, cloud.spatial_score, cloud.timing_score,
    );
    eprintln!(
        "Matches: {}/{} — {:?}",
        cloud.match_score, cloud.match_total, cloud.matched_finds,
    );

    // Print full JSON to stdout for piping
    println!(
        "{}",
        serde_json::to_string_pretty(&cloud).expect("failed to serialize")
    );
}

/// Run beaching simulation across the 7th arc (like the app does).
/// Usage: model_probe beaching-sweep [n_origins] [n_particles] [max_days]
fn run_beaching_sweep(args: &[String]) {
    let n_origins: usize = args.first().and_then(|s| s.parse().ok()).unwrap_or(15);
    let n_particles = args.get(1).and_then(|s| s.parse().ok());
    let max_days = args.get(2).and_then(|s| s.parse().ok());

    let config = load_default_config();
    let satellite = SatelliteModel::load().expect("failed to load satellite model");
    let items = load_debris_items().expect("failed to load debris items");
    let arc_points = sample_7th_arc(&satellite, Some(config));
    let step = (arc_points.len() / n_origins).max(1);
    let sampled: Vec<(f64, f64)> = arc_points.iter().step_by(step).copied().collect();

    eprintln!(
        "Sweeping {} origins along 7th arc ({} particles, {} max days)",
        sampled.len(),
        n_particles.unwrap_or(200),
        max_days.unwrap_or(900),
    );

    let mut results = Vec::new();
    for (i, (lat, lon)) in sampled.iter().enumerate() {
        eprint!(
            "\r  [{}/{}] {:.1}°S, {:.1}°E ...",
            i + 1,
            sampled.len(),
            lat.abs(),
            lon
        );
        let cloud = simulate_beaching_for_items(*lat, *lon, &items, n_particles, max_days);
        results.push(cloud);
    }
    eprintln!();

    // Print summary table to stderr
    eprintln!();
    eprintln!("{:<22} {:>5} {:>6} {:>6} {:>6} {:>8}", "Origin", "Beach", "Fit", "Spat", "Time", "Matches");
    eprintln!("{}", "-".repeat(60));
    for cloud in &results {
        let total = cloud.beached.len() + cloud.still_drifting.len();
        eprintln!(
            "{:>7.1}°S, {:>6.1}°E    {:>3}/{:<3} {:>5.0} {:>5.0} {:>5.0} {:>3}/{}  {}",
            cloud.origin_lat.abs(),
            cloud.origin_lon,
            cloud.beached.len(),
            total,
            cloud.fit_score,
            cloud.spatial_score,
            cloud.timing_score,
            cloud.match_score,
            cloud.match_total,
            cloud.matched_finds.join(", "),
        );
    }

    // Print full JSON to stdout
    println!(
        "{}",
        serde_json::to_string_pretty(&results).expect("failed to serialize")
    );
}

/// Run the joint debris inversion.
/// Usage: model_probe inversion
fn run_inversion(args: &[String]) {
    let satellite_peak_lat: f64 = args
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(-34.23);

    let config = load_default_config();
    let satellite = SatelliteModel::load().expect("failed to load satellite model");
    let items = load_debris_items().expect("failed to load debris items");
    let arc_points = sample_7th_arc(&satellite, Some(config));

    eprintln!(
        "Running joint inversion with {} items across {} arc points (satellite peak: {:.2}°)",
        items.len(),
        arc_points.len(),
        satellite_peak_lat,
    );

    let result = run_joint_inversion_with_progress(
        &items,
        &arc_points,
        satellite_peak_lat,
        |pct| {
            if pct % 10 == 0 {
                eprint!("\r  Progress: {pct}%");
            }
        },
    );
    eprintln!();

    eprintln!();
    eprintln!("=== INVERSION RESULT ===");
    eprintln!("Peak: {:.2}°S, {:.2}°E", result.peak_lat.abs(), result.peak_lon);
    eprintln!(
        "68% CI: [{:.1}°, {:.1}°]",
        result.confidence_interval_68.0, result.confidence_interval_68.1
    );
    eprintln!(
        "95% CI: [{:.1}°, {:.1}°]",
        result.confidence_interval_95.0, result.confidence_interval_95.1
    );
    eprintln!("Intersection lat: {:.2}°", result.intersection_lat);
    eprintln!(
        "Items used: {} / excluded: {}",
        result.items_used, result.items_excluded
    );
    eprintln!("Validation: {}", result.validation_message);

    eprintln!();
    eprintln!("Item contributions at peak:");
    for item in &result.item_contributions {
        eprintln!(
            "  {:<30} conf={:.1} like={:.2e} support={}",
            item.label, item.confidence, item.likelihood, item.support_label,
        );
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&result).expect("failed to serialize")
    );
}

/// Original probe behavior for paths/heatmap.
fn run_probe(args: &[String]) {
    let n = args
        .first()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(120);
    let ring_sample_step = args.get(1).and_then(|value| value.parse::<usize>().ok());
    let beam_width = args.get(2).and_then(|value| value.parse::<usize>().ok());
    let ring_points = args.get(3).and_then(|value| value.parse::<usize>().ok());
    let mut config = load_default_config();
    if let Some(step) = ring_sample_step {
        config.ring_sample_step = step;
    }
    if let Some(width) = beam_width {
        config.beam_width = width;
    }
    if let Some(points) = ring_points {
        config.ring_points = points;
    }

    match run_model_probe(Some(config), n) {
        Ok(summary) => match serde_json::to_string_pretty(&summary) {
            Ok(json) => println!("{json}"),
            Err(err) => {
                eprintln!("failed to serialize model probe summary: {err}");
                std::process::exit(1);
            }
        },
        Err(err) => {
            eprintln!("model probe failed: {err}");
            std::process::exit(1);
        }
    }
}
