use mh370_lib::config;
use mh370_lib::{run_model_probe, AnalysisConfig};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n = args
        .get(1)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(120);
    let ring_sample_step = args.get(2).and_then(|value| value.parse::<usize>().ok());
    let beam_width = args.get(3).and_then(|value| value.parse::<usize>().ok());
    let ring_points = args.get(4).and_then(|value| value.parse::<usize>().ok());
    let mut config = config::load_config()
        .map(|resolved| resolved.config)
        .unwrap_or_else(|_| AnalysisConfig::default());
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
