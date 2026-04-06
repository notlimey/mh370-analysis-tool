//! Sweep the post-Arc-7 glide heading to quantify impact longitude sensitivity.
//!
//! For the best path from the model, varies the final heading ±15° and computes
//! the projected impact point for each heading, across the altitude uncertainty range.

use mh370_lib::mh370::data::resolve_config;
use mh370_lib::mh370::geometry::{destination_point, LatLon};
use mh370_lib::mh370::paths::sample_candidate_paths;
use mh370_lib::mh370::satellite::SatelliteModel;

fn main() {
    let config = resolve_config(None);
    let satellite = SatelliteModel::load().unwrap();
    let paths = sample_candidate_paths(&satellite, 120, Some(config)).unwrap();

    let best = &paths[0];
    let arc7_point = best.points.last().unwrap();
    let arc7_lat = arc7_point[1];
    let arc7_lon = arc7_point[0];
    let base_heading = best.headings_deg.last().copied().unwrap_or(180.0);

    println!("Arc 7 crossing: {:.2}S, {:.2}E", arc7_lat.abs(), arc7_lon);
    println!("Base heading: {:.1} deg", base_heading);
    println!("Family: {}", best.family);
    println!();

    // Altitude scenarios: (label, altitude_ft_at_arc7)
    let altitudes = [
        ("FL321 (2900 fpm)", 32100.0),
        ("FL308 (4200 fpm)", 30800.0),
        ("FL270 (8000 fpm)", 27000.0),
        ("FL202 (14800 fpm)", 20200.0),
    ];

    let glide_ratio = 15.0;
    let ft_to_nm = 1.0 / 6076.0;

    println!(
        "{:>8}  {:>10}  {:>10}  {:>10}  {:>10}  {:>10}",
        "Heading", "FL321", "FL308", "FL270", "FL202", "Range(FL308)"
    );
    println!("{}", "-".repeat(70));

    let origin = LatLon::new(arc7_lat, arc7_lon);

    for delta in -15..=15 {
        let heading = base_heading + delta as f64;
        let mut lons = Vec::new();

        for &(_, alt_ft) in &altitudes {
            let range_nm = (alt_ft * ft_to_nm) * glide_ratio;
            let range_km = range_nm * 1.852;
            let impact = destination_point(origin, heading, range_km);
            lons.push(impact.lon);
        }

        // Range in km for FL308
        let range_nm_308 = (30800.0 * ft_to_nm) * glide_ratio;
        let range_km_308 = range_nm_308 * 1.852;

        print!("{:8.1}", heading);
        for lon in &lons {
            print!("  {:10.2}", lon);
        }
        println!("  {:10.0} km", range_km_308);
    }

    println!();
    println!("ATSB Phase 2 western boundary: 93.0E");
    println!("All values are impact longitude in degrees East");
}
