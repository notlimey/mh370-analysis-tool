//! Search effectiveness analysis: what fraction of our predicted impact zone
//! was covered by sonar at sufficient resolution to detect debris, and what
//! is the unconditional P(detect)?
//!
//! The non-detection in the existing search is evidence against our zone only
//! in proportion to P(detect). If P(detect) is low, non-detection tells us
//! little about whether the aircraft is actually there.
//!
//! Run: cd src-tauri && cargo run --release --bin search_effectiveness

use mh370_lib::mh370::config;
use mh370_lib::mh370::data::{resolve_config, AnalysisConfig};
use mh370_lib::mh370::probability::generate_probability_heatmap;
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::mh370::search_effectiveness::{analyze, zone_summaries, SearchCoverage};

fn main() {
    println!("=== MH370 Search Effectiveness Analysis ===");
    println!();
    println!("Overlays the probability heatmap against AusSeabed sonar coverage");
    println!("footprints to compute the probability-weighted detection probability.");
    println!("Coverage: CC BY 4.0, Governments of Australia, Malaysia and PRC, 2018.");
    println!();

    let base_config = config::load_config()
        .map(|r| r.config)
        .unwrap_or_else(|_| AnalysisConfig::default());
    let config = resolve_config(Some(base_config));

    let satellite = SatelliteModel::load().expect("failed to load satellite model");

    eprint!("Loading sonar coverage polygons... ");
    let coverage = SearchCoverage::load();
    let counts = coverage.polygon_counts();
    eprintln!("done.");
    eprintln!("  Polygons loaded:");
    for (ct, n) in &counts {
        eprintln!("    {:22} {n}", ct.label());
    }
    eprintln!();

    eprint!("Generating probability heatmap... ");
    let heatmap =
        generate_probability_heatmap(&satellite, Some(config.clone())).expect("heatmap failed");
    let points: Vec<[f64; 3]> = heatmap
        .iter()
        .filter(|p| p.path_density_score.is_finite() && p.path_density_score > 0.0)
        .map(|p| [p.position[0], p.position[1], p.path_density_score])
        .collect();
    eprintln!("{} points with positive density.", points.len());
    eprintln!();

    // -----------------------------------------------------------------------
    // Full coverage breakdown
    // -----------------------------------------------------------------------
    let result = analyze(&coverage, &points);

    println!("=== Coverage Breakdown ===");
    println!();
    println!(
        "  {:<24} {:>6}  {:>10}  {:>12}",
        "Coverage Type", "Pd", "P(in zone)", "Pd × P(zone)"
    );
    println!("  {}", "-".repeat(58));
    for b in &result.breakdown {
        println!(
            "  {:<24} {:>5.0}%  {:>9.1}%  {:>11.1}%",
            b.label,
            b.detection_probability * 100.0,
            b.probability_fraction * 100.0,
            b.pd_contribution * 100.0,
        );
    }
    println!("  {}", "-".repeat(58));
    println!(
        "  {:<24}        {:>9.1}%  {:>11.1}%",
        "TOTAL",
        result.p_in_searched_zone * 100.0,
        result.p_detect * 100.0,
    );
    println!();

    // -----------------------------------------------------------------------
    // Key statistics
    // -----------------------------------------------------------------------
    println!("=== Key Statistics ===");
    println!();
    println!(
        "  P(aircraft in any searched zone):    {:>5.1}%",
        result.p_in_searched_zone * 100.0,
    );
    println!(
        "  E[Pd | aircraft in searched zone]:   {:>5.1}%",
        result.pd_given_in_searched * 100.0,
    );
    println!();
    println!(
        "  P(detect) — unconditional:           {:>5.1}%",
        result.p_detect * 100.0,
    );
    println!(
        "  P(aircraft missed by search):        {:>5.1}%",
        result.p_missed * 100.0,
    );
    println!();

    // -----------------------------------------------------------------------
    // Geographic breakdown by longitude band
    // -----------------------------------------------------------------------
    let bands: &[(&str, f64, f64)] = &[
        ("< 91°E  (far glide zone)", f64::NEG_INFINITY, 91.0),
        ("91–92°E (near glide zone)", 91.0, 92.0),
        ("92–93°E (arc crossing zone)", 92.0, 93.0),
        ("> 93°E  (outside our zone)", 93.0, f64::INFINITY),
    ];
    let zones = zone_summaries(&coverage, &points, bands);

    println!("=== Geographic Breakdown by Longitude Band ===");
    println!();
    println!(
        "  {:<30} {:>8}  {:>9}  {:>8}",
        "Zone", "P(band)", "Covered", "P(detect)"
    );
    println!("  {}", "-".repeat(62));
    for z in &zones {
        println!(
            "  {:<30} {:>7.1}%  {:>8.1}%  {:>7.1}%",
            z.label,
            z.probability_fraction * 100.0,
            z.fraction_covered * 100.0,
            z.pd_in_band * 100.0,
        );
    }
    println!();

    // -----------------------------------------------------------------------
    // Interpretation
    // -----------------------------------------------------------------------
    println!("=== Interpretation ===");
    println!();
    let pd = result.p_detect;
    if pd < 0.20 {
        println!(
            "  P(detect) = {:.0}%. The existing search covered very little of the",
            pd * 100.0
        );
        println!("  predicted zone at debris-detection resolution. Non-detection is");
        println!("  weak evidence against the impact zone — the search was not sensitive");
        println!("  enough there to provide a meaningful negative result.");
    } else if pd < 0.50 {
        println!(
            "  P(detect) = {:.0}%. The existing search covered a moderate fraction",
            pd * 100.0
        );
        println!("  of the predicted zone. Non-detection provides some constraint but");
        println!("  does not come close to ruling out the impact zone.");
    } else if pd < 0.75 {
        println!(
            "  P(detect) = {:.0}%. Substantial fraction of the zone was searched.",
            pd * 100.0
        );
        println!("  Non-detection is meaningful but the impact zone is not ruled out.");
    } else {
        println!(
            "  P(detect) = {:.0}%. Most of the predicted zone was covered at",
            pd * 100.0
        );
        println!("  debris-detection resolution. Non-detection is significant evidence");
        println!("  against the zone, or detection probability estimates are too high.");
    }

    println!();
    println!("Note: Pd values are flat-terrain estimates. Terrain-shadowed zones,");
    println!("equipment outages, and rough seafloor reduce actual achieved Pd.");
    println!("A terrain-slope correction requires per-survey altitude logs");
    println!("and seafloor bathymetry integration (future enhancement).");
}
