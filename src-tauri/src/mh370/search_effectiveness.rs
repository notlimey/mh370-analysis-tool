//! Search effectiveness model: overlays the probability heatmap against
//! AusSeabed sonar coverage footprints to compute the probability-weighted
//! detection probability (P_detect) and coverage breakdown.
//!
//! The core question: given that the search did not find the aircraft, how
//! much of our predicted impact zone was actually searched at sufficient
//! resolution to detect debris? P_detect < 50% means the non-detection is
//! weak evidence against our zone.
//!
//! # Coverage data
//!
//! Sonar footprint polygons extracted from the AusSeabed WMS server
//! (CC BY 4.0, Governments of Australia, Malaysia and PRC, 2018).
//! See `public/data/sonar_coverage/README.md` for extraction method.
//!
//! # Detection probability model
//!
//! Per-sensor flat-terrain Pd for a Boeing 777 debris field
//! (major structural pieces ≥ 1 m, spread over ~1–5 km²):
//!
//! | Coverage type     | Pd   | Rationale                                         |
//! |-------------------|------|---------------------------------------------------|
//! | None              | 0.00 | Unsearched                                        |
//! | Bathymetry 150m   | 0.00 | Terrain mapping; cannot resolve 1-m debris        |
//! | Deep Tow 5m       | 0.75 | Conservative flat-terrain estimate                |
//! | AUV 5m            | 0.80 | Tighter altitude control → more consistent Pd     |
//! | SAS (Go Phoenix)  | 0.85 | Synthetic aperture; best effective resolution     |
//!
//! These are *flat-terrain* values. Achieved Pd in rough terrain is lower.
//! A terrain-slope correction requires per-survey altitude logs and seafloor
//! bathymetry integration — flagged as a future enhancement.
//!
//! Source for operational parameters: ATSB, "The Operational Search for MH370"
//! (Oct 2017), Section 4.
//! TODO: Source specific per-instrument Pd values from ATSB/Fugro technical
//! reports to replace the current conservative flat-terrain estimates.

use serde::Serialize;
use serde_json::Value;

// Sonar coverage GeoJSON — extracted from AusSeabed WMS on 2026-04-08.
// CC BY 4.0, Governments of Australia, Malaysia and PRC, 2018.
const DEEPTOW_GEOJSON: &str =
    include_str!("../../../public/data/sonar_coverage/deeptow_coverage.geojson");
const AUV_GEOJSON: &str = include_str!("../../../public/data/sonar_coverage/auv_coverage.geojson");
const GOPHOENIX_GEOJSON: &str =
    include_str!("../../../public/data/sonar_coverage/gophoenix_coverage.geojson");
const BATHYMETRY_GEOJSON: &str =
    include_str!("../../../public/data/sonar_coverage/bathymetry_coverage.geojson");

/// Best-available coverage type at a point, ordered by detection capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum CoverageType {
    None,
    Bathymetry150m,
    DeepTow5m,
    Auv5m,
    Sas5m,
}

impl CoverageType {
    pub const ALL: [CoverageType; 5] = [
        CoverageType::None,
        CoverageType::Bathymetry150m,
        CoverageType::DeepTow5m,
        CoverageType::Auv5m,
        CoverageType::Sas5m,
    ];

    /// Index into a 5-element array, matching the order of `ALL`.
    pub fn idx(self) -> usize {
        match self {
            CoverageType::None => 0,
            CoverageType::Bathymetry150m => 1,
            CoverageType::DeepTow5m => 2,
            CoverageType::Auv5m => 3,
            CoverageType::Sas5m => 4,
        }
    }

    /// Flat-terrain detection probability for a 777-scale debris field.
    ///
    /// ATSB "Operational Search for MH370" Oct 2017, §4 (operational context).
    /// TODO: Replace with instrument-specific Pd from Fugro/OI technical reports.
    pub fn detection_probability(self) -> f64 {
        match self {
            CoverageType::None => 0.00,
            CoverageType::Bathymetry150m => 0.00,
            CoverageType::DeepTow5m => 0.75,
            CoverageType::Auv5m => 0.80,
            CoverageType::Sas5m => 0.85,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            CoverageType::None => "No coverage",
            CoverageType::Bathymetry150m => "Bathymetry 150m",
            CoverageType::DeepTow5m => "Deep Tow 5m",
            CoverageType::Auv5m => "AUV 5m",
            CoverageType::Sas5m => "SAS (Go Phoenix) 5m",
        }
    }

    /// True if this coverage type is capable of detecting debris.
    pub fn can_detect(self) -> bool {
        self >= CoverageType::DeepTow5m
    }
}

// ---------------------------------------------------------------------------
// GeoJSON polygon loading
// ---------------------------------------------------------------------------

type Ring = Vec<[f64; 2]>; // [lon, lat] pairs

struct CoveragePolygon {
    coverage: CoverageType,
    ring: Ring,
}

/// Ray-casting point-in-polygon test for a flat [lon, lat] polygon ring.
fn point_in_ring(px: f64, py: f64, ring: &[[f64; 2]]) -> bool {
    let n = ring.len();
    let mut inside = false;
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let xi = ring[i][0];
        let yi = ring[i][1];
        let xj = ring[j][0];
        let yj = ring[j][1];
        if ((yi > py) != (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn parse_ring(arr: &[Value]) -> Ring {
    arr.iter()
        .filter_map(|pt| {
            let coords = pt.as_array()?;
            let lon = coords.first()?.as_f64()?;
            let lat = coords.get(1)?.as_f64()?;
            Some([lon, lat])
        })
        .collect()
}

fn load_polygons(json_str: &str, coverage: CoverageType) -> Vec<CoveragePolygon> {
    let val: Value = serde_json::from_str(json_str).expect("invalid coverage GeoJSON");
    let features = match val["features"].as_array() {
        Some(f) => f,
        None => return vec![],
    };

    let mut polys = Vec::new();
    for feature in features {
        let geom = &feature["geometry"];
        match geom["type"].as_str().unwrap_or("") {
            "Polygon" => {
                if let Some(outer) = geom["coordinates"].as_array().and_then(|c| c.first()) {
                    if let Some(arr) = outer.as_array() {
                        polys.push(CoveragePolygon {
                            coverage,
                            ring: parse_ring(arr),
                        });
                    }
                }
            }
            "MultiPolygon" => {
                if let Some(polys_arr) = geom["coordinates"].as_array() {
                    for poly in polys_arr {
                        if let Some(outer) = poly.as_array().and_then(|p| p.first()) {
                            if let Some(arr) = outer.as_array() {
                                polys.push(CoveragePolygon {
                                    coverage,
                                    ring: parse_ring(arr),
                                });
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    polys
}

// ---------------------------------------------------------------------------
// SearchCoverage
// ---------------------------------------------------------------------------

/// Loaded set of all sonar coverage polygons, queryable by point.
pub struct SearchCoverage {
    polygons: Vec<CoveragePolygon>,
}

impl SearchCoverage {
    /// Load all coverage layers from embedded GeoJSON.
    pub fn load() -> Self {
        let mut polygons = Vec::new();
        // Load in ascending Pd order so the loop below can break early when
        // a higher-quality layer has already been found.
        polygons.extend(load_polygons(
            BATHYMETRY_GEOJSON,
            CoverageType::Bathymetry150m,
        ));
        polygons.extend(load_polygons(DEEPTOW_GEOJSON, CoverageType::DeepTow5m));
        polygons.extend(load_polygons(AUV_GEOJSON, CoverageType::Auv5m));
        polygons.extend(load_polygons(GOPHOENIX_GEOJSON, CoverageType::Sas5m));
        Self { polygons }
    }

    /// Returns the highest-quality coverage type at a given (lon, lat) point.
    pub fn coverage_at(&self, lon: f64, lat: f64) -> CoverageType {
        let mut best = CoverageType::None;
        for poly in &self.polygons {
            // Short-circuit once we've reached SAS (highest tier).
            if best == CoverageType::Sas5m {
                break;
            }
            if poly.coverage > best && point_in_ring(lon, lat, &poly.ring) {
                best = poly.coverage;
            }
        }
        best
    }

    /// Returns breakdown of polygon counts by type (for debugging / summary).
    pub fn polygon_counts(&self) -> [(CoverageType, usize); 4] {
        let types = [
            CoverageType::Bathymetry150m,
            CoverageType::DeepTow5m,
            CoverageType::Auv5m,
            CoverageType::Sas5m,
        ];
        types.map(|t| {
            let n = self.polygons.iter().filter(|p| p.coverage == t).count();
            (t, n)
        })
    }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/// Per-coverage-type statistics for a heatmap.
#[derive(Debug, Clone, Serialize)]
pub struct CoverageBreakdown {
    pub label: &'static str,
    pub detection_probability: f64,
    /// Fraction of total probability mass in this coverage zone.
    pub probability_fraction: f64,
    /// Probability-weighted contribution to overall P(detect).
    pub pd_contribution: f64,
}

/// Full search effectiveness result.
#[derive(Debug, Serialize)]
pub struct SearchEffectivenessResult {
    pub breakdown: Vec<CoverageBreakdown>,
    /// Fraction of probability mass in any detection-capable zone.
    pub p_in_searched_zone: f64,
    /// E[Pd | in any detection-capable zone].
    pub pd_given_in_searched: f64,
    /// P(detect) — unconditional, integrated over the heatmap.
    pub p_detect: f64,
    /// 1 - P(detect).
    pub p_missed: f64,
    pub total_points: usize,
}

/// Analyze `points` (each element is `[lon, lat, score]`) against `coverage`.
///
/// `score` values need not be normalised — only their ratios matter.
pub fn analyze(coverage: &SearchCoverage, points: &[[f64; 3]]) -> SearchEffectivenessResult {
    let total_score: f64 = points.iter().map(|p| p[2]).sum();

    if total_score == 0.0 || points.is_empty() {
        let breakdown = CoverageType::ALL
            .iter()
            .map(|&ct| CoverageBreakdown {
                label: ct.label(),
                detection_probability: ct.detection_probability(),
                probability_fraction: 0.0,
                pd_contribution: 0.0,
            })
            .collect();
        return SearchEffectivenessResult {
            breakdown,
            p_in_searched_zone: 0.0,
            pd_given_in_searched: 0.0,
            p_detect: 0.0,
            p_missed: 1.0,
            total_points: 0,
        };
    }

    // Accumulate probability mass by coverage type index.
    let mut mass = [0.0f64; 5];
    for pt in points {
        let cov = coverage.coverage_at(pt[0], pt[1]);
        mass[cov.idx()] += pt[2] / total_score;
    }

    let breakdown: Vec<CoverageBreakdown> = CoverageType::ALL
        .iter()
        .map(|&ct| {
            let frac = mass[ct.idx()];
            let pd = ct.detection_probability();
            CoverageBreakdown {
                label: ct.label(),
                detection_probability: pd,
                probability_fraction: frac,
                pd_contribution: frac * pd,
            }
        })
        .collect();

    let p_detect: f64 = breakdown.iter().map(|b| b.pd_contribution).sum();
    let p_in_searched: f64 = breakdown
        .iter()
        .zip(CoverageType::ALL.iter())
        .filter(|(_, &ct)| ct.can_detect())
        .map(|(b, _)| b.probability_fraction)
        .sum();
    let pd_sum_searched: f64 = breakdown
        .iter()
        .zip(CoverageType::ALL.iter())
        .filter(|(_, &ct)| ct.can_detect())
        .map(|(b, _)| b.pd_contribution)
        .sum();
    let pd_given_in_searched = if p_in_searched > 0.0 {
        pd_sum_searched / p_in_searched
    } else {
        0.0
    };

    SearchEffectivenessResult {
        breakdown,
        p_in_searched_zone: p_in_searched,
        pd_given_in_searched,
        p_detect,
        p_missed: 1.0 - p_detect,
        total_points: points.len(),
    }
}

// ---------------------------------------------------------------------------
// Geographic sub-zone helper
// ---------------------------------------------------------------------------

/// Summary stats for a longitude-bounded sub-zone of the heatmap.
#[derive(Debug, Serialize)]
pub struct ZoneSummary {
    pub label: &'static str,
    pub lon_min: f64,
    pub lon_max: f64,
    /// Fraction of total probability mass in this band.
    pub probability_fraction: f64,
    /// Fraction of *this band's* mass that has detection-capable coverage.
    pub fraction_covered: f64,
    /// P(detect) integrated over this band (= fraction_covered × avg_Pd_in_band).
    pub pd_in_band: f64,
}

pub fn zone_summaries(
    coverage: &SearchCoverage,
    points: &[[f64; 3]],
    bands: &[(&'static str, f64, f64)],
) -> Vec<ZoneSummary> {
    let total: f64 = points.iter().map(|p| p[2]).sum();
    if total == 0.0 {
        return vec![];
    }

    bands
        .iter()
        .map(|&(label, lon_min, lon_max)| {
            let band_pts: Vec<&[f64; 3]> = points
                .iter()
                .filter(|p| p[0] >= lon_min && p[0] < lon_max)
                .collect();

            let band_mass: f64 = band_pts.iter().map(|p| p[2]).sum::<f64>() / total;
            let band_pd_mass: f64 = band_pts
                .iter()
                .map(|p| coverage.coverage_at(p[0], p[1]).detection_probability() * p[2])
                .sum::<f64>()
                / total;
            let covered_mass: f64 = band_pts
                .iter()
                .filter(|p| coverage.coverage_at(p[0], p[1]).can_detect())
                .map(|p| p[2])
                .sum::<f64>()
                / total;

            let fraction_covered = if band_mass > 0.0 {
                covered_mass / band_mass
            } else {
                0.0
            };

            ZoneSummary {
                label,
                lon_min,
                lon_max,
                probability_fraction: band_mass,
                fraction_covered,
                pd_in_band: band_pd_mass,
            }
        })
        .collect()
}
