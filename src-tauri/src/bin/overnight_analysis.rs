//! Overnight analysis: beam width sweep, descent timing sweep, BFO validation.
//! Outputs markdown tables for docs/overnight-report.md.

use mh370_lib::mh370::bfo::BfoModel;
use mh370_lib::mh370::data::{load_dataset, AnalysisConfig};
use mh370_lib::mh370::geometry::LatLon;
use mh370_lib::mh370::paths::sample_candidate_paths;
use mh370_lib::mh370::probability::generate_probability_heatmap;
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::{config, run_model_probe};

fn load_default_config() -> AnalysisConfig {
    config::load_config()
        .map(|r| r.config)
        .unwrap_or_else(|_| AnalysisConfig::default())
}

fn main() {
    let satellite = SatelliteModel::load().expect("failed to load satellite model");

    println!("# Overnight Analysis Report");
    println!();
    println!("**Date:** {}", chrono_date());
    println!();

    // ── 1. Beam width sensitivity sweep ──
    println!("## 1. Beam Width Sensitivity Sweep");
    println!();
    run_beam_width_sweep(&satellite);

    // ── 2. Descent timing sensitivity ──
    println!("## 2. Descent Timing Sensitivity");
    println!();
    run_descent_timing_sweep(&satellite);

    // ── 3. Independent BFO validation ──
    println!("## 3. Independent BFO Validation on Known Positions");
    println!();
    run_bfo_validation(&satellite);

    // ── 4. WGS84 impact assessment ──
    println!("## 4. WGS84 Ellipsoid Impact Assessment");
    println!();
    run_wgs84_assessment(&satellite);
}

fn chrono_date() -> String {
    // Simple date without chrono crate
    "2026-04-06".to_string()
}

fn run_beam_width_sweep(satellite: &SatelliteModel) {
    println!("Running path solver at beam widths 100, 200, 400, 800.");
    println!();
    println!("| Beam Width | Peak Lat | Peak Lon | Arc 7 Crossing Lat | Arc 7 Crossing Lon | Path Count | BFO RMS (Hz) |");
    println!("|-----------|----------|----------|-------------------|-------------------|------------|-------------|");

    for beam_width in [100, 200, 400, 800] {
        let mut config = load_default_config();
        config.beam_width = beam_width;

        match run_model_probe(Some(config), 120) {
            Ok(summary) => {
                println!(
                    "| {} | {:.2}° | {:.2}° | {:.2}° | {:.2}° | {} | {:.1} |",
                    beam_width,
                    summary.peak_lat.unwrap_or(f64::NAN),
                    summary.peak_lon.unwrap_or(f64::NAN),
                    summary.best_arc7_lat.unwrap_or(f64::NAN),
                    summary.best_arc7_lon.unwrap_or(f64::NAN),
                    summary.path_count,
                    summary.bfo_mean_abs_residual_hz.unwrap_or(f64::NAN),
                );
            }
            Err(err) => {
                eprintln!("  beam_width={beam_width} FAILED: {err}");
                println!("| {beam_width} | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR |");
            }
        }
    }
    println!();
}

fn run_descent_timing_sweep(satellite: &SatelliteModel) {
    println!("Sweeping pre-Arc-7 descent duration from 0.5 to 8.5 minutes.");
    println!("Uses configurable `descent_before_arc7_minutes` and `descent_rate_fpm`.");
    println!();
    println!("| Descent (min) | Altitude at Arc 7 | Glide Range (NM) | Impact Lon (approx) |");
    println!("|--------------|-------------------|-----------------|-------------------|");

    let base_config = load_default_config();

    for half_min in 1..=17 {
        let minutes = half_min as f64 * 0.5;
        let descent_ft = minutes * base_config.descent_rate_fpm;
        let altitude_ft = (base_config.cruise_altitude_ft - descent_ft).max(0.0);
        let altitude_nm = altitude_ft / 6076.0;
        let glide_range_nm = altitude_nm * 15.0; // 15:1 glide ratio
        // Approximate impact longitude: arc crossing at ~92.2°E, heading ~224° true
        // At 35°S, 1° longitude ≈ 91.7 km. Glide km = glide_range_nm * 1.852
        let glide_km = glide_range_nm * 1.852;
        // Heading 224° has a westward component: sin(224° - 180°) = sin(44°) ≈ 0.695
        let westward_km = glide_km * (44.0_f64.to_radians().sin());
        let lon_shift = westward_km / 91.7;
        let impact_lon = 92.2 - lon_shift;
        let fl = (altitude_ft / 100.0).round();

        println!(
            "| {:.1} | FL{:.0} ({:.0} ft) | {:.1} | {:.2}°E |",
            minutes, fl, altitude_ft, glide_range_nm, impact_lon,
        );
    }
    println!();

    // Now run the actual solver at a few key descent values to verify
    println!("### Solver verification at key descent times");
    println!();
    println!("| Descent (min) | Solver Peak Lat | Solver Peak Lon |");
    println!("|--------------|----------------|----------------|");

    for minutes in [0.5, 1.0, 3.0, 5.0, 8.5] {
        let mut config = load_default_config();
        config.descent_before_arc7_minutes = minutes;

        match run_model_probe(Some(config), 60) {
            Ok(summary) => {
                println!(
                    "| {:.1} | {:.2}° | {:.2}° |",
                    minutes,
                    summary.peak_lat.unwrap_or(f64::NAN),
                    summary.peak_lon.unwrap_or(f64::NAN),
                );
            }
            Err(err) => {
                eprintln!("  descent={minutes} FAILED: {err}");
                println!("| {minutes:.1} | ERROR | ERROR |");
            }
        }
    }
    println!();
}

fn run_bfo_validation(satellite: &SatelliteModel) {
    let config = load_default_config();
    let bfo_model = BfoModel::calibrate(satellite, &config).expect("BFO calibration failed");

    println!("BFO predictions at known aircraft positions (no solver optimization).");
    println!("These positions are from radar/gate data where the aircraft location is independently known.");
    println!();

    // Known positions with measured BFO values
    // Source: bfo-reference-data.md
    struct KnownPoint {
        label: &'static str,
        time_utc: &'static str,
        lat: f64,
        lon: f64,
        heading_deg: f64,
        speed_kts: f64,
        measured_bfo: f64,
    }

    let known_points = [
        KnownPoint {
            label: "Gate logon (16:00:13)",
            time_utc: "16:00:13.406",
            lat: 3.12,
            lon: 101.69,
            heading_deg: 0.0,    // Stationary
            speed_kts: 0.0,      // Stationary
            measured_bfo: 87.0,  // SU log processed
        },
        KnownPoint {
            label: "Takeoff (16:42:04)",
            time_utc: "16:42:04.408",
            lat: 3.12,   // KLIA
            lon: 101.69,
            heading_deg: 330.0,  // Approx runway heading
            speed_kts: 160.0,    // Approx rotation speed
            measured_bfo: 144.0, // SU log processed
        },
        KnownPoint {
            label: "ACARS (17:07:55)",
            time_utc: "17:07:55.587",
            lat: 5.5,     // Approx enroute position
            lon: 103.5,
            heading_deg: 25.0,   // Heading toward Beijing
            speed_kts: 471.0,    // Cruise
            measured_bfo: 130.0, // ATSB appendix
        },
    ];

    println!("| Position | Time | Measured BFO | Predicted BFO | Residual | Status |");
    println!("|----------|------|-------------|--------------|---------|--------|");

    for kp in &known_points {
        let time_s = mh370_lib::mh370::data::parse_time_utc_seconds(kp.time_utc)
            .expect("failed to parse time");
        let pos = LatLon::new(kp.lat, kp.lon);

        match bfo_model.predict(
            satellite,
            pos,
            kp.heading_deg,
            kp.speed_kts,
            time_s,
            &config,
            0.0,
        ) {
            Ok(predicted) => {
                let residual = predicted - kp.measured_bfo;
                let status = if residual.abs() < 7.0 { "PASS" } else { "REVIEW" };
                println!(
                    "| {} | {} | {:.0} Hz | {:.1} Hz | {:+.1} Hz | {} |",
                    kp.label, kp.time_utc, kp.measured_bfo, predicted, residual, status,
                );
            }
            Err(err) => {
                println!(
                    "| {} | {} | {:.0} Hz | ERROR | -- | {} |",
                    kp.label, kp.time_utc, kp.measured_bfo, err,
                );
            }
        }
    }
    println!();
    println!("**Interpretation:** These residuals use fixed known positions without any");
    println!("optimization. If they fall within ±7 Hz (DSTG inflated sigma), the BFO model");
    println!("is independently validated. If they exceed ~15 Hz, the model has a systematic issue.");
    println!();
}

fn run_wgs84_assessment(satellite: &SatelliteModel) {
    println!("The BFO Doppler model now uses WGS84 ellipsoid instead of spherical Earth.");
    println!("Comparing predicted BFO at known path positions to assess the shift.");
    println!();

    let config = load_default_config();
    let bfo_model = BfoModel::calibrate(satellite, &config).expect("BFO calibration failed");

    // Test at several positions along the 7th arc
    let test_positions = [
        (-25.0, 96.0, "25°S (northern 7th arc)"),
        (-30.0, 94.0, "30°S (mid 7th arc)"),
        (-35.0, 92.0, "35°S (our impact zone)"),
        (-40.0, 89.0, "40°S (southern 7th arc)"),
    ];

    println!("| Position | Heading | Speed | Predicted BFO (WGS84) | Note |");
    println!("|----------|---------|-------|----------------------|------|");

    for (lat, lon, label) in &test_positions {
        let time_s = mh370_lib::mh370::data::parse_time_utc_seconds("00:19:29.416")
            .expect("failed to parse time");
        let pos = LatLon::new(*lat, *lon);

        match bfo_model.predict(satellite, pos, 200.0, 450.0, time_s, &config, 0.0) {
            Ok(predicted) => {
                println!(
                    "| {} | 200° | 450 kts | {:.1} Hz | {} |",
                    label, predicted, "WGS84",
                );
            }
            Err(err) => {
                println!("| {} | 200° | 450 kts | ERROR | {} |", label, err);
            }
        }
    }
    println!();
    println!("**Note:** The spherical model used R=6371 km everywhere. WGS84 uses the prime");
    println!("vertical radius of curvature N(lat), which is 6378 km at the equator and");
    println!("6399 km at the poles. At 35°S, the difference is ~14 km in effective radius.");
    println!("This shifts the aircraft ECEF position slightly, changing the line-of-sight");
    println!("vector to the satellite and thus the Doppler prediction.");
    println!();
}
