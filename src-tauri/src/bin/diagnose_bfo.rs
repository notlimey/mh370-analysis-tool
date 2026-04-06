use mh370_lib::mh370::bfo::BfoModel;
use mh370_lib::mh370::data::{load_dataset, parse_time_utc_seconds, resolve_config};
use mh370_lib::mh370::geometry::LatLon;
use mh370_lib::mh370::satellite::{satellite_subpoint, SatelliteModel};

fn main() {
    let config = resolve_config(None);
    let dataset = load_dataset(&config).unwrap();
    let satellite = SatelliteModel::load().unwrap();
    let time_s_calib = parse_time_utc_seconds("16:00:13.406").unwrap();

    let handshakes: Vec<_> = dataset
        .inmarsat_handshakes
        .iter()
        .filter(|h| h.arc >= 2 && h.bfo_hz.is_some())
        .collect();

    // Approximate south track (actual path roughly)
    let south_latitudes = [6.0, 0.0, -9.0, -18.0, -26.0, -32.0, -34.0];
    let south_heading = 180.0;

    // Approximate north track
    let north_latitudes = [15.0, 22.0, 29.0, 36.0, 43.0, 49.0, 51.0];
    let north_heading = 0.0;

    let speed_kts = 450.0;
    let lon = 93.0; // Rough longitude for both

    let mut config = config.clone();

    println!("Diagnosing BFO: South vs North Tracks");
    for &comp in &[true, false] {
        if !comp {
            println!("NO AES COMPENSATION");
            config.satellite_nominal_lat_deg =
                satellite_subpoint(&satellite, time_s_calib, &config)
                    .unwrap()
                    .lat;
            config.satellite_nominal_lon_deg =
                satellite_subpoint(&satellite, time_s_calib, &config)
                    .unwrap()
                    .lon;
        } else {
            println!("WITH AES COMPENSATION (Nominal sat position: 0N, 64.5E)");
            config.satellite_nominal_lat_deg = 0.0;
            config.satellite_nominal_lon_deg = 64.5;
        }
        let model = BfoModel::calibrate(&satellite, &config).unwrap();

        println!("------------------------------------------------------------");
        println!(
            "Arc | Time       | Measured | Predicted South | Res South | Predicted North | Res North"
        );

        let mut sum_sq_south = 0.0;
        let mut sum_sq_north = 0.0;

        for (i, handshake) in handshakes.iter().enumerate() {
            if i >= south_latitudes.len() {
                break;
            }

            let time_s = parse_time_utc_seconds(&handshake.time_utc).unwrap();
            let measured = handshake.bfo_hz.unwrap();

            let pos_s = LatLon::new(south_latitudes[i], lon);
            let pred_s = model
                .predict(
                    &satellite,
                    pos_s,
                    south_heading,
                    speed_kts,
                    time_s,
                    &config,
                    0.0,
                )
                .unwrap();
            let res_s = pred_s - measured;
            sum_sq_south += res_s * res_s;

            let pos_n = LatLon::new(north_latitudes[i], lon);
            let pred_n = model
                .predict(
                    &satellite,
                    pos_n,
                    north_heading,
                    speed_kts,
                    time_s,
                    &config,
                    0.0,
                )
                .unwrap();
            let res_n = pred_n - measured;
            sum_sq_north += res_n * res_n;

            println!(
                "{:3} | {} | {:8.1} | {:15.1} | {:9.1} | {:15.1} | {:9.1}",
                handshake.arc, handshake.time_utc, measured, pred_s, res_s, pred_n, res_n
            );
        }

        println!("------------------------------------------------------------");
        println!(
            "RMS Residual South: {:.1} Hz",
            (sum_sq_south / handshakes.len() as f64).sqrt()
        );
        println!(
            "RMS Residual North: {:.1} Hz",
            (sum_sq_north / handshakes.len() as f64).sqrt()
        );
    }
}
