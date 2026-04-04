use serde::Serialize;
use std::f64::consts::PI;

const EARTH_RADIUS_KM: f64 = 6371.0;

/// A geographic coordinate in decimal degrees.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

impl LatLon {
    pub fn new(lat: f64, lon: f64) -> Self {
        Self { lat, lon }
    }
}

fn to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

fn to_deg(rad: f64) -> f64 {
    rad * 180.0 / PI
}

/// Haversine distance between two points in kilometres.
pub fn haversine(a: LatLon, b: LatLon) -> f64 {
    let d_lat = to_rad(b.lat - a.lat);
    let d_lon = to_rad(b.lon - a.lon);
    let lat1 = to_rad(a.lat);
    let lat2 = to_rad(b.lat);

    let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * h.sqrt().asin()
}

/// Compute the destination point given origin, bearing (degrees), and distance (km).
pub fn destination_point(origin: LatLon, bearing_deg: f64, dist_km: f64) -> LatLon {
    let d = dist_km / EARTH_RADIUS_KM;
    let brng = to_rad(bearing_deg);
    let lat1 = to_rad(origin.lat);
    let lon1 = to_rad(origin.lon);

    let lat2 = (lat1.sin() * d.cos() + lat1.cos() * d.sin() * brng.cos()).asin();
    let lon2 = lon1 + (brng.sin() * d.sin() * lat1.cos()).atan2(d.cos() - lat1.sin() * lat2.sin());

    LatLon::new(to_deg(lat2), to_deg(lon2))
}

/// Initial bearing from `from` to `to` in degrees [0, 360).
pub fn bearing(from: LatLon, to: LatLon) -> f64 {
    let lat1 = to_rad(from.lat);
    let lat2 = to_rad(to.lat);
    let d_lon = to_rad(to.lon - from.lon);

    let y = d_lon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * d_lon.cos();
    (to_deg(y.atan2(x)) + 360.0) % 360.0
}

/// Generate `n` evenly-spaced points along the great circle from `from` to `to`.
#[allow(dead_code)]
pub fn great_circle_points(from: LatLon, to: LatLon, n: usize) -> Vec<LatLon> {
    if n < 2 {
        return vec![from];
    }

    let d = haversine(from, to) / EARTH_RADIUS_KM;
    let lat1 = to_rad(from.lat);
    let lon1 = to_rad(from.lon);
    let lat2 = to_rad(to.lat);
    let lon2 = to_rad(to.lon);

    (0..n)
        .map(|i| {
            let f = i as f64 / (n - 1) as f64;
            let a = ((1.0 - f) * d).sin() / d.sin();
            let b = (f * d).sin() / d.sin();

            let x = a * lat1.cos() * lon1.cos() + b * lat2.cos() * lon2.cos();
            let y = a * lat1.cos() * lon1.sin() + b * lat2.cos() * lon2.sin();
            let z = a * lat1.sin() + b * lat2.sin();

            let lat = z.atan2((x * x + y * y).sqrt());
            let lon = y.atan2(x);

            LatLon::new(to_deg(lat), to_deg(lon))
        })
        .collect()
}
