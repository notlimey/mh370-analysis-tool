//! BFO (Burst Frequency Offset) Doppler model for Inmarsat-3F1 ↔ MH370.
//!
//! Implements the DSTG/Holland BFO decomposition:
//!
//!   BFO = Δf_up + Δf_comp + Δf_down + bias
//!
//! Where:
//!   Δf_up   = uplink Doppler (aircraft → satellite)
//!   Δf_comp = AES frequency compensation (SDU pre-correction using nominal sat position)
//!   Δf_down = downlink Doppler (satellite → Perth GES)
//!   bias    = SDU oscillator offset + satellite transponder correction + AFC residual
//!
//! References:
//! - Holland 2017, "MH370 BFO Analysis", arXiv:1702.02432, Equations (1)-(4)
//! - DSTG Book, Davey et al. 2016, Equations (5.5)-(5.9)
//! - Ashton et al. 2014, "The Search for MH370" (Inmarsat)

use std::f64::consts::PI;

use serde::Serialize;

use super::data::{load_dataset, parse_time_utc_seconds, AnalysisConfig};
use super::geometry::LatLon;
use super::satellite::{sat_state_at_time_s, SatelliteModel};

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM: f64 = 6371.0;
const C_M_S: f64 = 299_792_458.0;

// ---------------------------------------------------------------------------
// SDU / system parameters
// ---------------------------------------------------------------------------

/// L-band uplink frequency (Hz).
/// Source: Holland 2017 page 4; Ashton et al. 2014 (Inmarsat).
const F_UPLINK_HZ: f64 = 1_646_652_500.0;

/// C-band downlink frequency from satellite to Perth GES (Hz).
/// Source: Inmarsat-3F1 C-band transponder specifications.
const F_DOWNLINK_HZ: f64 = 3_615_000_000.0;

/// Typical Boeing 777 cruise altitude (km). ~FL350.
const AIRCRAFT_ALT_KM: f64 = 10.668;

/// Satellite altitude used by the AES for Doppler compensation (km).
/// The AES uses a value 422 km higher than the nominal GEO altitude.
/// Source: DSTG Book page 29.
const AES_SATELLITE_ALT_KM: f64 = 36_210.0;

/// Perth Ground Earth Station coordinates.
/// Source: DSTG Table 2.1.
const PERTH_GES_LAT: f64 = -31.802;
const PERTH_GES_LON: f64 = 115.889;

// ---------------------------------------------------------------------------
// ECEF helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
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

fn to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

/// Convert geodetic (lat, lon, altitude) to ECEF (km) using spherical Earth.
///
/// NOTE: WGS84 was attempted but reverted. The satellite module's
/// ecef_to_geodetic uses spherical Earth (R=6371 km), so converting
/// back to ECEF with WGS84 creates a ~14 km inconsistency at 35°S
/// that degraded BFO residuals from ~4 Hz to ~21.5 Hz. A proper fix
/// requires either passing satellite ECEF coordinates directly (avoiding
/// the geodetic round-trip) or converting everything to WGS84 together.
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

// ---------------------------------------------------------------------------
// Satellite state from shared model
// ---------------------------------------------------------------------------

fn satellite_ecef(
    satellite: &SatelliteModel,
    time_s: f64,
    config: &AnalysisConfig,
) -> Result<(Vec3, Vec3), String> {
    let state = sat_state_at_time_s(satellite, time_s, config)?;
    let pos = to_ecef(state.lat_deg, state.lon_deg, state.alt_km);
    let vel = Vec3 {
        x: state.vx_km_s,
        y: state.vy_km_s,
        z: state.vz_km_s,
    };
    Ok((pos, vel))
}

// ---------------------------------------------------------------------------
// Aircraft velocity
// ---------------------------------------------------------------------------

/// Aircraft velocity in ECEF (km/s) from position, heading (deg), ground speed (km/s).
fn aircraft_velocity_ecef(
    lat_deg: f64,
    lon_deg: f64,
    heading_deg: f64,
    speed_km_s: f64,
    vertical_speed_km_s: f64,
) -> Vec3 {
    let lat = to_rad(lat_deg);
    let lon = to_rad(lon_deg);
    let hdg = to_rad(heading_deg);

    let v_north = speed_km_s * hdg.cos();
    let v_east = speed_km_s * hdg.sin();

    let horizontal = Vec3 {
        x: -v_north * lat.sin() * lon.cos() - v_east * lon.sin(),
        y: -v_north * lat.sin() * lon.sin() + v_east * lon.cos(),
        z: v_north * lat.cos(),
    };
    let up = Vec3 {
        x: lat.cos() * lon.cos(),
        y: lat.cos() * lon.sin(),
        z: lat.sin(),
    };

    Vec3 {
        x: horizontal.x + up.x * vertical_speed_km_s,
        y: horizontal.y + up.y * vertical_speed_km_s,
        z: horizontal.z + up.z * vertical_speed_km_s,
    }
}

// ---------------------------------------------------------------------------
// BFO Doppler components (Holland Eq. 3, 4)
// ---------------------------------------------------------------------------

/// Projected range rate along the line of sight (km/s).
/// Positive = objects separating.
#[allow(dead_code)]
fn range_rate(pos_a: Vec3, vel_a: Vec3, pos_b: Vec3, vel_b: Vec3) -> f64 {
    let dp = pos_a.sub(pos_b);
    let dv = vel_a.sub(vel_b);
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    dp.dot(dv) / r
}

/// Holland Eq (3): uplink Doppler (Hz).
///
/// Δf_up = (f_up / c) × (v_s - v_x) · (p_x - p_s) / |p_x - p_s|
///
/// Sign convention: approaching aircraft → negative Δf_up in Holland's
/// formulation, but the AES compensation term (Eq 4) uses the same convention,
/// so the combined BFO is internally consistent.
fn uplink_doppler_hz(
    sat_pos: Vec3,
    sat_vel: Vec3,
    ac_pos: Vec3,
    ac_vel: Vec3,
) -> f64 {
    let dp = ac_pos.sub(sat_pos); // p_x - p_s
    let dv = sat_vel.sub(ac_vel); // v_s - v_x
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_UPLINK_HZ / C_M_S) * dv.dot(dp) / r * 1000.0 // km/s → m/s
}

/// Holland Eq (4): AES frequency compensation (Hz).
///
/// δf_comp = (f_up / c) × v̂_x · (p̂_x - p̂_s) / |p̂_x - p̂_s|
///
/// The AES compensates using:
/// - Aircraft position at SEA LEVEL (not cruise altitude)
/// - Satellite at nominal position (0°N, 64.5°E) at AES_SATELLITE_ALT_KM
/// - Horizontal velocity only (no vertical speed compensation)
///
/// Source: DSTG Book page 29; Holland 2017 Eq. (4).
fn aes_compensation_hz(
    ac_lat: f64,
    ac_lon: f64,
    heading_deg: f64,
    speed_km_s: f64,
    nom_sat_lat: f64,
    nom_sat_lon: f64,
) -> f64 {
    let ac_pos = to_ecef(ac_lat, ac_lon, 0.0); // sea level
    let sat_pos = to_ecef(nom_sat_lat, nom_sat_lon, AES_SATELLITE_ALT_KM);
    let ac_vel = aircraft_velocity_ecef(ac_lat, ac_lon, heading_deg, speed_km_s, 0.0);

    let dp = ac_pos.sub(sat_pos); // p̂_x - p̂_s
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_UPLINK_HZ / C_M_S) * ac_vel.dot(dp) / r * 1000.0
}

/// Downlink Doppler: satellite → Perth GES (Hz).
///
/// The satellite retransmits at C-band. Its orbital motion causes Doppler
/// at the Perth ground station. This term varies as the satellite moves
/// in its inclined orbit.
///
/// Uses the same Holland sign convention: (v_s) · (p_ges - p_s) / |p_ges - p_s|
fn downlink_doppler_hz(sat_pos: Vec3, sat_vel: Vec3) -> f64 {
    let ges_pos = to_ecef(PERTH_GES_LAT, PERTH_GES_LON, 0.0);
    let dp = ges_pos.sub(sat_pos); // p_ges - p_s
    let r = dp.magnitude();
    if r < 1.0 {
        return 0.0;
    }
    (F_DOWNLINK_HZ / C_M_S) * sat_vel.dot(dp) / r * 1000.0
}

// ---------------------------------------------------------------------------
// ATSB/Inmarsat per-arc corrections
// ---------------------------------------------------------------------------

/// Combined satellite transponder oscillator (δf_sat) and Enhanced AFC (δf_AFC)
/// correction, provided by Inmarsat to the MH370 Flight Path Reconstruction Group.
///
/// These values capture the satellite's internal oscillator thermal drift
/// (affected by eclipse, solar angle, heater cycling) and the Perth GES AFC
/// receiver's partial compensation (using a 24-hour moving average of the
/// Burum Pilot signal).
///
/// Source: ATSB via Holland 2017; joewragg/MH370 GitHub (ATSB appendix data).
/// Ref: Holland 2017, arXiv:1702.02432, Section III.
const ATSB_CORRECTIONS: &[(f64, f64)] = &[
    // (time_s after 16:00 UTC epoch, δf_sat + δf_AFC in Hz)
    // Arc 1: 18:25:27 UTC
    (2.0 * 3600.0 + 25.0 * 60.0 + 27.0, 10.8),
    // Arc 2: 19:41:02 UTC
    (3.0 * 3600.0 + 41.0 * 60.0 + 2.0, -1.2),
    // Arc 3: 20:41:04 UTC
    (4.0 * 3600.0 + 41.0 * 60.0 + 4.0, -1.3),
    // Arc 4: 21:41:26 UTC
    (5.0 * 3600.0 + 41.0 * 60.0 + 26.0, -17.9),
    // Arc 5: 22:41:21 UTC
    (6.0 * 3600.0 + 41.0 * 60.0 + 21.0, -28.5),
    // Arc 6 (phone call): 23:14:01 UTC — interpolated between Arc 5 and Arc 6b
    (7.0 * 3600.0 + 14.0 * 60.0 + 1.0, -33.1),
    // Arc 6b: 00:10:58 UTC
    (8.0 * 3600.0 + 10.0 * 60.0 + 58.0, -37.7),
    // Arc 7: 00:19:29 UTC
    (8.0 * 3600.0 + 19.0 * 60.0 + 29.0, -38.0),
];

/// ATSB constant bias (δf_bias): SDU oscillator offset.
/// Source: ATSB via Holland 2017; independently confirmed by Duncan Steel
/// and Richard Godfrey analyses. Published as ~150 Hz; some sources report
/// 149.5-152.5 Hz depending on processing pipeline.
const ATSB_BIAS_HZ: f64 = 150.0;

/// Interpolate the δf_sat + δf_AFC correction at a given time.
/// Uses linear interpolation between the tabulated ATSB values.
/// Clamps to the nearest value outside the tabulated range.
fn interpolate_atsb_correction(time_s: f64) -> f64 {
    if ATSB_CORRECTIONS.is_empty() {
        return 0.0;
    }
    let first = ATSB_CORRECTIONS[0];
    let last = ATSB_CORRECTIONS[ATSB_CORRECTIONS.len() - 1];

    if time_s <= first.0 {
        return first.1;
    }
    if time_s >= last.0 {
        return last.1;
    }

    for window in ATSB_CORRECTIONS.windows(2) {
        let (t0, v0) = window[0];
        let (t1, v1) = window[1];
        if time_s >= t0 && time_s <= t1 {
            let frac = (time_s - t0) / (t1 - t0);
            return v0 + frac * (v1 - v0);
        }
    }
    last.1
}

// ---------------------------------------------------------------------------
// BFO model
// ---------------------------------------------------------------------------

/// BFO model implementing the full DSTG/Holland decomposition with
/// ATSB-provided per-arc corrections.
///
/// BFO = Δf_up + Δf_comp + Δf_down + δf_sat + δf_AFC + δf_bias
///
/// Where δf_sat + δf_AFC are interpolated from ATSB tabulated values
/// and δf_bias is the ATSB constant (150 Hz; Holland 2017).
///
/// Source: Holland 2017, arXiv:1702.02432, Eq. (1)-(4);
///         ATSB correction data via joewragg/MH370.
pub struct BfoModel {
    /// δf_bias: SDU oscillator offset (Hz). Uses ATSB value by default,
    /// or calibrated from ground logon if ATSB value doesn't match.
    bias: f64,
}

impl BfoModel {
    /// Create model using the ATSB/Holland published bias constant.
    ///
    /// The ATSB Flight Path Reconstruction Group determined the SDU oscillator
    /// bias (δf_bias) to be approximately 150 Hz from analysis of 20 prior
    /// flights of 9M-MRO. This value was independently confirmed by Duncan Steel
    /// and Richard Godfrey.
    ///
    /// Using the published constant rather than calibrating from the ground logon
    /// avoids uncertainty in the pre-flight BFO measurement, which comes from
    /// raw SU log processing that varies across analysts by ±15 Hz.
    ///
    /// Source: Holland 2017 (arXiv:1702.02432); DSTG Book (Davey et al. 2016).
    pub fn calibrate(_satellite: &SatelliteModel, _config: &AnalysisConfig) -> Result<Self, String> {
        Ok(BfoModel { bias: ATSB_BIAS_HZ })
    }

    /// Total Doppler contribution (Hz) = Δf_up + Δf_comp + Δf_down.
    fn total_doppler_hz(
        satellite: &SatelliteModel,
        lat: f64,
        lon: f64,
        heading_deg: f64,
        speed_kts: f64,
        vertical_speed_fpm: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let speed_km_s = speed_kts * 1.852 / 3600.0;
        let vertical_speed_km_s = vertical_speed_fpm * 0.0003048 / 60.0;

        let ac_pos = to_ecef(lat, lon, AIRCRAFT_ALT_KM);
        let ac_vel = aircraft_velocity_ecef(lat, lon, heading_deg, speed_km_s, vertical_speed_km_s);
        let (sat_pos, sat_vel) = satellite_ecef(satellite, time_s, config)?;

        let delta_f_up = uplink_doppler_hz(sat_pos, sat_vel, ac_pos, ac_vel);
        let delta_f_comp = aes_compensation_hz(
            lat,
            lon,
            heading_deg,
            speed_km_s,
            config.satellite_nominal_lat_deg,
            config.satellite_nominal_lon_deg,
        );

        let delta_f_down = downlink_doppler_hz(sat_pos, sat_vel);

        Ok(delta_f_up + delta_f_comp + delta_f_down)
    }

    /// Predict BFO (Hz) for a given aircraft state.
    ///
    /// BFO = Δf_up + Δf_comp + Δf_down + (δf_sat + δf_AFC) + δf_bias
    pub fn predict(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        config: &AnalysisConfig,
        vertical_speed_fpm: f64,
    ) -> Result<f64, String> {
        let doppler = Self::total_doppler_hz(
            satellite, pos.lat, pos.lon, heading_deg, speed_kts, vertical_speed_fpm,
            time_s, config,
        )?;
        let correction = interpolate_atsb_correction(time_s);
        Ok(doppler + correction + self.bias)
    }

    /// BFO residual: predicted - measured (Hz).
    pub fn residual(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        measured_bfo: f64,
        config: &AnalysisConfig,
        vertical_speed_fpm: f64,
    ) -> Result<f64, String> {
        Ok(self.predict(satellite, pos, heading_deg, speed_kts, time_s, config, vertical_speed_fpm)?
            - measured_bfo)
    }

    /// Compute a full BFO stepthrough with component breakdown.
    ///
    /// Returns every intermediate value in the BFO prediction chain so it can
    /// be displayed transparently in the UI.
    pub fn stepthrough(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        heading_deg: f64,
        speed_kts: f64,
        time_s: f64,
        config: &AnalysisConfig,
        vertical_speed_fpm: f64,
        measured_bfo: Option<f64>,
        arc: u8,
        time_utc: &str,
    ) -> Result<BfoStepthrough, String> {
        let speed_km_s = speed_kts * 1.852 / 3600.0;
        let vertical_speed_km_s = vertical_speed_fpm * 0.0003048 / 60.0;

        let ac_pos = to_ecef(pos.lat, pos.lon, AIRCRAFT_ALT_KM);
        let ac_vel = aircraft_velocity_ecef(
            pos.lat, pos.lon, heading_deg, speed_km_s, vertical_speed_km_s,
        );
        let (sat_pos, sat_vel) = satellite_ecef(satellite, time_s, config)?;

        let uplink_hz = uplink_doppler_hz(sat_pos, sat_vel, ac_pos, ac_vel);
        let comp_hz = aes_compensation_hz(
            pos.lat,
            pos.lon,
            heading_deg,
            speed_km_s,
            config.satellite_nominal_lat_deg,
            config.satellite_nominal_lon_deg,
        );
        let downlink_hz = downlink_doppler_hz(sat_pos, sat_vel);
        let afc_correction_hz = interpolate_atsb_correction(time_s);
        let predicted = uplink_hz + comp_hz + downlink_hz + afc_correction_hz + self.bias;

        let residual_hz = measured_bfo.map(|m| predicted - m);

        let (is_in_sample, validation_note) = validation_note_for_arc(arc);

        Ok(BfoStepthrough {
            arc,
            arc_time: time_utc.to_string(),
            measured_bfo_hz: measured_bfo,
            uplink_doppler_hz: uplink_hz,
            aes_compensation_hz: comp_hz,
            downlink_doppler_hz: downlink_hz,
            afc_correction_hz,
            bias_hz: self.bias,
            predicted_bfo_hz: predicted,
            residual_hz,
            is_in_sample,
            validation_note: validation_note.to_string(),
        })
    }

    /// Score a candidate point on the 7th arc by finding the best-matching heading.
    pub fn score_7th_arc_point(
        &self,
        satellite: &SatelliteModel,
        pos: LatLon,
        measured_bfo: f64,
        time_s: f64,
        config: &AnalysisConfig,
    ) -> Result<f64, String> {
        let mut best_residual = f64::MAX;

        for hdg_i in 0..=100 {
            let heading = 150.0 + hdg_i as f64;
            for spd_i in 0..7 {
                let speed = 400.0 + spd_i as f64 * 20.0;
                let r = self
                    .residual(satellite, pos, heading, speed, time_s, measured_bfo, config, 0.0)?
                    .abs();
                if r < best_residual {
                    best_residual = r;
                }
            }
        }

        let sigma = config.bfo_sigma_hz;
        Ok((-best_residual.powi(2) / (2.0 * sigma * sigma)).exp())
    }
}

// ---------------------------------------------------------------------------
// BFO Stepthrough — full component breakdown for transparency
// ---------------------------------------------------------------------------

/// Full BFO prediction broken into every intermediate component.
///
/// Designed for display in the UI so researchers can inspect each term
/// in the Holland/DSTG decomposition and understand exactly what drives
/// the predicted value.
#[derive(Debug, Clone, Serialize)]
pub struct BfoStepthrough {
    pub arc: u8,
    pub arc_time: String,
    pub measured_bfo_hz: Option<f64>,
    /// Holland Eq (3): Doppler from satellite-aircraft relative motion
    pub uplink_doppler_hz: f64,
    /// Holland Eq (4): SDU frequency pre-compensation using nominal sat position
    pub aes_compensation_hz: f64,
    /// Downlink Doppler: satellite orbital motion → Perth GES
    pub downlink_doppler_hz: f64,
    /// δf_sat + δf_AFC: Inmarsat-provided per-arc correction
    /// Source: ATSB via Holland 2017 Section III
    pub afc_correction_hz: f64,
    /// δf_bias: SDU oscillator offset (150 Hz)
    /// Source: ATSB; confirmed by DSTG, Duncan Steel, Richard Godfrey
    pub bias_hz: f64,
    /// Sum of all components
    pub predicted_bfo_hz: f64,
    /// predicted - measured (None if no measured value)
    pub residual_hz: Option<f64>,
    /// True if the path solver optimized position to minimize this residual
    pub is_in_sample: bool,
    /// Human-readable note on the validation status of this arc
    pub validation_note: String,
}

fn validation_note_for_arc(arc: u8) -> (bool, &'static str) {
    match arc {
        0 => (false, "Pre-flight — BFO data quality poor (raw SU log processing varies ±15 Hz across analysts). Not used in path scoring."),
        1 => (false, "SDU reboot — OCXO oscillator settling produces transient BFO. Flagged unreliable by SATCOM working group (Holland 2017 Sec V-A). Not used in path scoring."),
        2 | 3 | 4 | 5 => (true, "In-sample — solver optimized aircraft position, heading, and speed to minimize this residual. The ~4 Hz fit reflects optimization, not independent validation."),
        6 => (true, "In-sample (C-channel) — uses ATSB channel correction. Solver optimized position for this arc."),
        7 => (true, "In-sample — large residual expected under level-flight assumption. Aircraft was descending after engine flameout. Scored via descent envelope constraint, not absolute BFO fit."),
        _ => (true, "In-sample — solver optimized position to minimize this residual."),
    }
}
