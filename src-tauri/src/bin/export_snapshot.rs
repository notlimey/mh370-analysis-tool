//! Export all snapshot data files for the web build.
//!
//! Generates the JSON/GeoJSON files in public/data/ that the browser-mode
//! frontend loads when running without the Tauri backend.

use std::path::Path;

use mh370_lib::mh370::data::{load_dataset, resolve_config};
use mh370_lib::mh370::export::{
    export_debris_inversion_snapshot, export_paths_geojson, export_probability_geojson,
};
use mh370_lib::mh370::satellite::SatelliteModel;

fn main() {
    let output_dir = Path::new("../public/data");
    if !output_dir.exists() {
        eprintln!("Output directory not found: {}", output_dir.display());
        eprintln!("Run from src-tauri/");
        std::process::exit(1);
    }

    let config = resolve_config(None);
    let satellite = SatelliteModel::load().expect("failed to load satellite model");
    let dataset = load_dataset(&config).expect("failed to load dataset");

    // 1. Handshakes
    eprint!("Exporting handshakes.json... ");
    let handshakes: Vec<serde_json::Value> = dataset
        .inmarsat_handshakes
        .iter()
        .map(|h| {
            serde_json::json!({
                "arc": h.arc,
                "time_utc": h.time_utc,
                "bto": h.bto_us,
                "bfo": h.bfo_hz,
                "note": h.note.clone().unwrap_or_default(),
            })
        })
        .collect();
    let handshakes_json = serde_json::to_string_pretty(&handshakes).unwrap();
    std::fs::write(output_dir.join("handshakes.json"), handshakes_json).unwrap();
    eprintln!("{} handshakes", handshakes.len());

    // 2. Candidate paths
    eprint!("Exporting candidate_paths.geojson... ");
    let result = export_paths_geojson(
        &satellite,
        output_dir.join("candidate_paths.geojson").to_string_lossy().into_owned(),
        120,
        Some(config.clone()),
    );
    match result {
        Ok(msg) => eprintln!("{msg}"),
        Err(err) => eprintln!("FAILED: {err}"),
    }

    // 3. Probability heatmap
    eprint!("Exporting probability_heatmap.geojson... ");
    let result = export_probability_geojson(
        &satellite,
        output_dir.join("probability_heatmap.geojson").to_string_lossy().into_owned(),
        Some(config.clone()),
    );
    match result {
        Ok(msg) => eprintln!("{msg}"),
        Err(err) => eprintln!("FAILED: {err}"),
    }

    // 4. Debris inversion
    eprint!("Exporting debris_inversion_result.json... ");
    match export_debris_inversion_snapshot(&satellite, output_dir) {
        Ok(()) => eprintln!("done"),
        Err(err) => eprintln!("FAILED: {err}"),
    }

    eprintln!("\nSnapshot export complete.");
}
