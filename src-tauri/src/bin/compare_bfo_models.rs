use std::f64::consts::PI;

use mh370_lib::mh370::data::{
    load_dataset, parse_time_utc_seconds, resolve_config, AnalysisConfig,
};
use mh370_lib::mh370::geometry::LatLon;
use mh370_lib::mh370::satellite::{sat_state_at_time_s, SatelliteModel};

const EARTH_RADIUS_KM: f64 = 6371.0;
const AIRCRAFT_ALT_KM: f64 = 10.668;
const C_M_S: f64 = 299_792_458.0;
const F_UPLINK_HZ: f64 = 1_626_500_000.0;

#[derive(Clone, Copy)]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vec3 {
    fn dot(self, other: Vec3) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    fn sub(self, other: Vec3) -> Vec3 {
        Vec3 {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }

    fn magnitude(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
}

#[derive(Clone, Copy)]
enum ModelVariant {
    Raw,
    FullComp,
    PartialComp(f64),
}

impl ModelVariant {
    fn label(self) -> String {
        match self {
            ModelVariant::Raw => "raw".to_string(),
            ModelVariant::FullComp => "full_comp".to_string(),
            ModelVariant::PartialComp(factor) => format!("partial_comp_{factor:.2}"),
        }
    }
}

fn to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

fn to_ecef(lat_deg: f64, lon_deg: f64, alt_km: f64) -> Vec3 {
    let lat = to_rad(lat_deg);
    let lon = to_rad(lon_deg);
    let r = EARTH_RADIUS_KM + alt_km;
    Vec3 {
        x: r * lat.cos() * lon.cos(),
        y: r * lat.cos() * lon.sin(),
        z: r * lat.sin(),
    }
}

fn range_rate(pos_a: Vec3, vel_a: Vec3, pos_b: Vec3, vel_b: Vec3) -> f64 {
    let dp = pos_a.sub(pos_b);
    let dv = vel_a.sub(vel_b);
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    dp.dot(dv) / r
}

fn aircraft_velocity_ecef(pos: LatLon, heading_deg: f64, speed_kts: f64) -> Vec3 {
    let speed_km_s = speed_kts * 1.852 / 3600.0;
    let lat = to_rad(pos.lat);
    let lon = to_rad(pos.lon);
    let hdg = to_rad(heading_deg);
    let v_north = speed_km_s * hdg.cos();
    let v_east = speed_km_s * hdg.sin();
    Vec3 {
        x: -v_north * lat.sin() * lon.cos() - v_east * lon.sin(),
        y: -v_north * lat.sin() * lon.sin() + v_east * lon.cos(),
        z: v_north * lat.cos(),
    }
}

fn satellite_state_ecef(
    satellite: &SatelliteModel,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<(Vec3, Vec3), String> {
    let state = sat_state_at_time_s(satellite, time_s, config)?;
    Ok((
        to_ecef(state.lat_deg, state.lon_deg, state.alt_km),
        Vec3 {
            x: state.vx_km_s,
            y: state.vy_km_s,
            z: state.vz_km_s,
        },
    ))
}

fn uncompensated_rr(
    variant: ModelVariant,
    satellite: &SatelliteModel,
    pos: LatLon,
    heading_deg: f64,
    speed_kts: f64,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<f64, String> {
    let ac_pos = to_ecef(pos.lat, pos.lon, AIRCRAFT_ALT_KM);
    let ac_vel = aircraft_velocity_ecef(pos, heading_deg, speed_kts);
    let (sat_pos, sat_vel) = satellite_state_ecef(satellite, time_s, config)?;
    let actual_rr = range_rate(sat_pos, sat_vel, ac_pos, ac_vel);

    let comp_rr = match variant {
        ModelVariant::Raw => 0.0,
        ModelVariant::FullComp => {
            let nom_sat = to_ecef(
                config.satellite_nominal_lat_deg,
                config.satellite_nominal_lon_deg,
                35786.0,
            );
            range_rate(
                nom_sat,
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                ac_pos,
                ac_vel,
            )
        }
        ModelVariant::PartialComp(factor) => {
            let nom_sat = to_ecef(
                config.satellite_nominal_lat_deg,
                config.satellite_nominal_lon_deg,
                35786.0,
            );
            let full = range_rate(
                nom_sat,
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                ac_pos,
                ac_vel,
            );
            full * factor
        }
    };

    Ok((actual_rr - comp_rr) * 1000.0)
}

fn calibrate_bias(
    variant: ModelVariant,
    satellite: &SatelliteModel,
    config: &AnalysisConfig,
) -> Result<f64, String> {
    let dataset = load_dataset(config)?;
    let ground = dataset
        .inmarsat_handshakes
        .iter()
        .find(|h| h.message_type == "R-Channel Log-on" && h.position_known && h.bfo_hz.is_some())
        .ok_or_else(|| "missing ground calibration handshake".to_string())?;
    let pos = LatLon::new(
        ground.lat.ok_or_else(|| "missing ground lat".to_string())?,
        ground.lon.ok_or_else(|| "missing ground lon".to_string())?,
    );
    let time_s = parse_time_utc_seconds(&ground.time_utc)?;
    let rr = uncompensated_rr(variant, satellite, pos, 0.0, 0.0, time_s, config)?;
    Ok(ground.bfo_hz.unwrap_or_default() - (-(F_UPLINK_HZ / C_M_S) * rr))
}

fn predict_bfo(
    variant: ModelVariant,
    bias: f64,
    satellite: &SatelliteModel,
    pos: LatLon,
    heading_deg: f64,
    speed_kts: f64,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<f64, String> {
    let rr = uncompensated_rr(
        variant,
        satellite,
        pos,
        heading_deg,
        speed_kts,
        time_s,
        config,
    )?;
    Ok(-(F_UPLINK_HZ / C_M_S) * rr + bias)
}

fn main() -> Result<(), String> {
    let config = resolve_config(None);
    let dataset = load_dataset(&config)?;
    let satellite = SatelliteModel::load()?;
    let handshakes: Vec<_> = dataset
        .inmarsat_handshakes
        .iter()
        .filter(|h| h.arc >= 2 && h.bfo_hz.is_some())
        .collect();

    let south_latitudes = [6.0, 0.0, -9.0, -18.0, -26.0, -32.0, -34.0];
    let north_latitudes = [15.0, 22.0, 29.0, 36.0, 43.0, 49.0, 51.0];
    let lon = 93.0;
    let speed_kts = 450.0;
    let variants = [
        ModelVariant::Raw,
        ModelVariant::FullComp,
        ModelVariant::PartialComp(0.75),
        ModelVariant::PartialComp(0.50),
        ModelVariant::PartialComp(0.35),
        ModelVariant::PartialComp(0.20),
        ModelVariant::PartialComp(0.05),
    ];

    println!("variant,south_rms_hz,north_rms_hz,delta_hz");
    for variant in variants {
        let bias = calibrate_bias(variant, &satellite, &config)?;
        let mut south_sum = 0.0;
        let mut north_sum = 0.0;
        let mut count = 0.0;
        for (i, handshake) in handshakes.iter().enumerate().take(south_latitudes.len()) {
            let time_s = parse_time_utc_seconds(&handshake.time_utc)?;
            let measured = handshake.bfo_hz.unwrap_or_default();
            let south = predict_bfo(
                variant,
                bias,
                &satellite,
                LatLon::new(south_latitudes[i], lon),
                180.0,
                speed_kts,
                time_s,
                &config,
            )?;
            let north = predict_bfo(
                variant,
                bias,
                &satellite,
                LatLon::new(north_latitudes[i], lon),
                0.0,
                speed_kts,
                time_s,
                &config,
            )?;
            south_sum += (south - measured).powi(2);
            north_sum += (north - measured).powi(2);
            count += 1.0;
        }
        let south_rms = (south_sum / count).sqrt();
        let north_rms = (north_sum / count).sqrt();
        println!(
            "{},{:.1},{:.1},{:.1}",
            variant.label(),
            south_rms,
            north_rms,
            north_rms - south_rms
        );
    }

    Ok(())
}
