use mh370_lib::mh370::paths::sample_candidate_paths;
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::AnalysisConfig;

fn main() -> Result<(), String> {
    let satellite = SatelliteModel::load()?;
    for (label, config, n) in [
        ("default", AnalysisConfig::default(), 2000usize),
        (
            "wide_search",
            AnalysisConfig {
                beam_width: 4096,
                ..AnalysisConfig::default()
            },
            10000usize,
        ),
    ] {
        let paths = sample_candidate_paths(&satellite, n, Some(config))?;

        let best_north = paths
            .iter()
            .filter(|path| {
                path.points
                    .last()
                    .map(|point| point[1] > 0.0)
                    .unwrap_or(false)
            })
            .max_by(|left, right| left.score.partial_cmp(&right.score).unwrap());
        let best_south = paths
            .iter()
            .filter(|path| {
                path.points
                    .last()
                    .map(|point| point[1] < 0.0)
                    .unwrap_or(false)
            })
            .max_by(|left, right| left.score.partial_cmp(&right.score).unwrap());

        println!("scenario={label}");
        println!("family,score,endpoint_lat,endpoint_lon,speed_log,heading_log,bfo_log,bfo_mean_abs_hz,fuel_remaining_kg");

        if let Some(path) = best_north {
            let endpoint = path.points.last().copied().unwrap_or([0.0, 0.0]);
            println!(
                "north,{:.6},{:.3},{:.3},{:.3},{:.3},{:.3},{:.3},{:.1}",
                path.score,
                endpoint[1],
                endpoint[0],
                path.speed_log_score,
                path.heading_log_score,
                path.bfo_log_score,
                path.bfo_summary.mean_abs_residual_hz.unwrap_or(-1.0),
                path.fuel_remaining_at_arc7_kg,
            );
        }

        if let Some(path) = best_south {
            let endpoint = path.points.last().copied().unwrap_or([0.0, 0.0]);
            println!(
                "south,{:.6},{:.3},{:.3},{:.3},{:.3},{:.3},{:.3},{:.1}",
                path.score,
                endpoint[1],
                endpoint[0],
                path.speed_log_score,
                path.heading_log_score,
                path.bfo_log_score,
                path.bfo_summary.mean_abs_residual_hz.unwrap_or(-1.0),
                path.fuel_remaining_at_arc7_kg,
            );
        } else {
            println!("south,none,none,none,none,none,none,none,none");
        }
    }

    Ok(())
}
