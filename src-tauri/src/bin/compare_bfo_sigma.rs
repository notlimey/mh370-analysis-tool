//! Compare model results with BFO sigma = 4.3 Hz vs 7.0 Hz.
//!
//! Run: cd src-tauri && cargo run --release --bin compare_bfo_sigma

use mh370_lib::mh370::config;
use mh370_lib::mh370::data::{load_dataset, resolve_config, AnalysisConfig};
use mh370_lib::mh370::paths::sample_candidate_paths_from_dataset;
use mh370_lib::mh370::probability::generate_probability_heatmap;
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::run_model_probe;

fn main() {
    let base_config = config::load_config()
        .map(|r| r.config)
        .unwrap_or_else(|_| AnalysisConfig::default());

    let satellite = SatelliteModel::load().expect("failed to load satellite model");
    let n = 120;

    let sigmas = [4.3, 5.0, 6.0, 7.0];

    for sigma in sigmas {
        let mut config = base_config.clone();
        config.bfo_sigma_hz = sigma;

        eprintln!("\n============================================================");
        eprintln!("=== BFO σ = {sigma:.1} Hz ===\n");

        // Run model probe for summary
        eprint!("  Running model probe... ");
        let summary = run_model_probe(Some(config.clone()), n).expect("model probe failed");
        eprintln!("done ({} paths)", summary.path_count);

        println!("\n=== BFO σ = {sigma:.1} Hz ===");
        println!(
            "  Heatmap peak:      {:.3}°S, {:.3}°E",
            summary.peak_lat.unwrap_or(f64::NAN).abs(),
            summary.peak_lon.unwrap_or(f64::NAN),
        );
        println!(
            "  Best Arc7 crossing: {:.3}°S, {:.3}°E",
            summary.best_arc7_lat.unwrap_or(f64::NAN).abs(),
            summary.best_arc7_lon.unwrap_or(f64::NAN),
        );
        println!(
            "  Best family: {}  |  BFO MAR: {:.2} Hz",
            summary.best_family.as_deref().unwrap_or("—"),
            summary.bfo_mean_abs_residual_hz.unwrap_or(f64::NAN),
        );

        // Run heatmap to get probability distribution along latitude
        eprint!("  Generating heatmap... ");
        let heatmap =
            generate_probability_heatmap(&satellite, Some(config.clone())).expect("heatmap failed");
        eprintln!("{} points", heatmap.len());

        // Sort by latitude and compute cumulative distribution
        let mut lat_scores: Vec<(f64, f64)> = heatmap
            .iter()
            .filter(|p| p.path_density_score.is_finite() && p.path_density_score > 0.0)
            .map(|p| (p.position[1], p.path_density_score))
            .collect();
        lat_scores.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        let total: f64 = lat_scores.iter().map(|(_, s)| s).sum();
        if total > 0.0 {
            // Find median, 68% CI, and 95% CI
            let mut cumsum = 0.0;
            let mut p025 = f64::NAN;
            let mut p16 = f64::NAN;
            let mut p50 = f64::NAN;
            let mut p84 = f64::NAN;
            let mut p975 = f64::NAN;

            for &(lat, score) in &lat_scores {
                cumsum += score / total;
                if p025.is_nan() && cumsum >= 0.025 {
                    p025 = lat;
                }
                if p16.is_nan() && cumsum >= 0.16 {
                    p16 = lat;
                }
                if p50.is_nan() && cumsum >= 0.50 {
                    p50 = lat;
                }
                if p84.is_nan() && cumsum >= 0.84 {
                    p84 = lat;
                }
                if p975.is_nan() && cumsum >= 0.975 {
                    p975 = lat;
                }
            }

            println!("  Latitude distribution:");
            println!("    Median:  {:.2}°S", p50.abs());
            println!(
                "    68% CI:  [{:.2}°S, {:.2}°S]",
                p16.abs(),
                p84.abs()
            );
            println!(
                "    95% CI:  [{:.2}°S, {:.2}°S]",
                p025.abs(),
                p975.abs()
            );
            println!(
                "    Full range: {:.2}°S to {:.2}°S",
                lat_scores.first().unwrap().0.abs(),
                lat_scores.last().unwrap().0.abs(),
            );
        }

        // Show top 5 paths by score
        eprint!("  Sampling paths for top-5... ");
        let dataset = load_dataset(&resolve_config(Some(config.clone()))).expect("load dataset");
        let paths = sample_candidate_paths_from_dataset(&satellite, &dataset, n, &config)
            .expect("sampling failed");
        eprintln!("{} paths", paths.len());

        println!("  Top 5 paths:");
        for (i, path) in paths.iter().take(5).enumerate() {
            let arc7 = path.points.last().map(|p| (p[1], p[0]));
            println!(
                "    #{}: score={:.4}  arc7={:.2}°S, {:.2}°E  family={}  BFO_MAR={:.1} Hz",
                i + 1,
                path.score,
                arc7.map(|a| a.0.abs()).unwrap_or(f64::NAN),
                arc7.map(|a| a.1).unwrap_or(f64::NAN),
                path.family,
                path.bfo_summary
                    .mean_abs_residual_hz
                    .unwrap_or(f64::NAN),
            );
        }
    }
}
