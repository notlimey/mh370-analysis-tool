use mh370_lib::mh370::paths::sample_candidate_paths;
use mh370_lib::mh370::satellite::SatelliteModel;
use mh370_lib::AnalysisConfig;

fn main() {
    let satellite = SatelliteModel::load().expect("failed to load satellite");

    for bfo_weight in [0.25, 0.5, 1.0, 2.0, 4.0] {
        for heading_sigma in [40.0, 80.0, 160.0, 360.0] {
            for beam_width in [128, 256, 512, 1024, 2048] {
                let mut config = AnalysisConfig::default();
                config.bfo_score_weight = bfo_weight;
                config.heading_change_sigma_deg = heading_sigma;
                config.beam_width = beam_width;

                let paths = sample_candidate_paths(&satellite, 1, Some(config.clone()))
                    .expect("failed to sample paths");
                let best = paths.first().expect("no paths returned");
                let endpoint = best.points.last().copied().unwrap_or([0.0, 0.0]);

                println!(
                "bfo_weight={:.2} heading_sigma={:.0} beam_width={} endpoint=({:.2},{:.2}) family={} bfo_mean={:.1}",
                bfo_weight,
                heading_sigma,
                beam_width,
                endpoint[1],
                endpoint[0],
                best.family,
                best.bfo_summary.mean_abs_residual_hz.unwrap_or(-1.0),
            );
            }
        }
    }
}
