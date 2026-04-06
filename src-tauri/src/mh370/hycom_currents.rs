use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

const CACHE_VERSION: u32 = 1;
const LAT_MIN: f64 = -45.0;
const LAT_MAX: f64 = -10.0;
const LON_MIN: f64 = 20.0;
const LON_MAX: f64 = 120.0;
const GRID_STRIDE: usize = 12;
const SURFACE_DEPTH_INDEX: usize = 0;
const REANALYSIS_BASE: &str = "https://tds.hycom.org/thredds/dodsC/GLBv0.08/expt_53.X/data";

static CACHE: OnceLock<Option<HycomCache>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HycomCache {
    version: u32,
    lats: Vec<f64>,
    lons: Vec<f64>,
    months: Vec<MonthlyCurrentGrid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MonthlyCurrentGrid {
    sample_year: i32,
    sample_month: u32,
    lat_len: usize,
    lon_len: usize,
    u: Vec<f32>,
    v: Vec<f32>,
}

pub fn hycom_current_at(day_index: usize, lat: f64, lon: f64) -> Option<(f64, f64)> {
    let cache = CACHE.get_or_init(|| load_or_build_cache().ok());
    cache.as_ref()?.sample(day_index, lat, lon)
}

impl HycomCache {
    fn sample(&self, day_index: usize, lat: f64, lon: f64) -> Option<(f64, f64)> {
        if !(LAT_MIN..=LAT_MAX).contains(&lat) || !(LON_MIN..=LON_MAX).contains(&lon) {
            return None;
        }

        let (year, month, day) = date_from_day_index(day_index);
        let sample_year = if year <= 2015 { year } else { 2015 };
        let grid = self
            .months
            .iter()
            .find(|grid| grid.sample_year == sample_year && grid.sample_month == month)?;

        let current = bilinear_sample(
            &self.lats,
            &self.lons,
            &grid.u,
            &grid.v,
            grid.lat_len,
            grid.lon_len,
            lat,
            lon,
        )?;

        let Some((next_year, next_month)) = next_month(sample_year, month) else {
            return Some(current);
        };
        let Some(next_grid) = self
            .months
            .iter()
            .find(|grid| grid.sample_year == next_year && grid.sample_month == next_month)
        else {
            return Some(current);
        };
        let Some(next) = bilinear_sample(
            &self.lats,
            &self.lons,
            &next_grid.u,
            &next_grid.v,
            next_grid.lat_len,
            next_grid.lon_len,
            lat,
            lon,
        ) else {
            return Some(current);
        };

        let month_days = days_in_month(sample_year, month).max(1) as f64;
        let t = ((day as f64 - 1.0) / month_days).clamp(0.0, 1.0);
        Some((lerp(current.0, next.0, t), lerp(current.1, next.1, t)))
    }
}

fn load_or_build_cache() -> Result<HycomCache, String> {
    let cache_path = cache_path()?;
    if let Ok(raw) = fs::read_to_string(&cache_path) {
        let cache: HycomCache = serde_json::from_str(&raw).map_err(|err| {
            format!(
                "failed to parse HYCOM cache {}: {err}",
                cache_path.display()
            )
        })?;
        if cache.version == CACHE_VERSION {
            return Ok(cache);
        }
    }

    let cache = build_cache()?;
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "failed to create HYCOM cache directory {}: {err}",
                parent.display()
            )
        })?;
    }
    let serialized = serde_json::to_string(&cache)
        .map_err(|err| format!("failed to serialize HYCOM cache: {err}"))?;
    fs::write(&cache_path, serialized).map_err(|err| {
        format!(
            "failed to write HYCOM cache {}: {err}",
            cache_path.display()
        )
    })?;
    Ok(cache)
}

fn build_cache() -> Result<HycomCache, String> {
    let coord_text = fetch_text(&format!(
        "{REANALYSIS_BASE}/2014.ascii?lat[0:3250],lon[0:4499],time[0:2856]"
    ))?;
    let all_lats = parse_1d_f64_section(&coord_text, "lat")?;
    let all_lons = parse_1d_f64_section(&coord_text, "lon")?;

    let lat_range = index_range(&all_lats, LAT_MIN, LAT_MAX)?;
    let lon_range = index_range(&all_lons, LON_MIN, LON_MAX)?;
    let sampled_lats = stride_slice(&all_lats, lat_range.0, lat_range.1, GRID_STRIDE);
    let sampled_lons = stride_slice(&all_lons, lon_range.0, lon_range.1, GRID_STRIDE);

    let mut months = Vec::new();
    for (year, month) in monthly_samples() {
        let year_text = fetch_text(&format!(
            "{REANALYSIS_BASE}/{year}.ascii?time[0:{}]",
            year_time_len(year) - 1
        ))?;
        let times = parse_1d_f64_section(&year_text, "time")?;
        let target_hour = hours_since_2000(year, month, 15, 12);
        let time_index = nearest_index(&times, target_hour)
            .ok_or_else(|| format!("missing HYCOM time index for {year}-{month:02}"))?;

        let query = format!(
            "{REANALYSIS_BASE}/{year}.ascii?lat[{lat_start}:{lat_stride}:{lat_end}],lon[{lon_start}:{lon_stride}:{lon_end}],water_u[{time_index}:1:{time_index}][{depth}:1:{depth}][{lat_start}:{lat_stride}:{lat_end}][{lon_start}:{lon_stride}:{lon_end}],water_v[{time_index}:1:{time_index}][{depth}:1:{depth}][{lat_start}:{lat_stride}:{lat_end}][{lon_start}:{lon_stride}:{lon_end}]",
            lat_start = lat_range.0,
            lat_stride = GRID_STRIDE,
            lat_end = lat_range.1,
            lon_start = lon_range.0,
            lon_stride = GRID_STRIDE,
            lon_end = lon_range.1,
            depth = SURFACE_DEPTH_INDEX,
        );
        let text = fetch_text(&query)?;
        let u = parse_2d_i16_grid(&text, "water_u.water_u")?;
        let v = parse_2d_i16_grid(&text, "water_v.water_v")?;
        months.push(MonthlyCurrentGrid {
            sample_year: year,
            sample_month: month,
            lat_len: sampled_lats.len(),
            lon_len: sampled_lons.len(),
            u: u.into_iter().map(scale_velocity).collect(),
            v: v.into_iter().map(scale_velocity).collect(),
        });
    }

    Ok(HycomCache {
        version: CACHE_VERSION,
        lats: sampled_lats,
        lons: sampled_lons,
        months,
    })
}

fn cache_path() -> Result<PathBuf, String> {
    let base =
        std::env::current_dir().map_err(|err| format!("failed to get current dir: {err}"))?;
    Ok(base
        .join("src-tauri")
        .join(".cache")
        .join("hycom_surface_currents_v1.json"))
}

fn fetch_text(url: &str) -> Result<String, String> {
    ureq::get(url)
        .call()
        .map_err(|err| format!("HYCOM request failed for {url}: {err}"))?
        .into_string()
        .map_err(|err| format!("HYCOM response decode failed for {url}: {err}"))
}

fn parse_1d_f64_section(text: &str, name: &str) -> Result<Vec<f64>, String> {
    let body = extract_section(text, &format!("{name}["))?;
    let mut values = Vec::new();
    for part in body.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        values.push(
            trimmed
                .parse::<f64>()
                .map_err(|err| format!("failed to parse {name} value '{trimmed}': {err}"))?,
        );
    }
    Ok(values)
}

fn parse_2d_i16_grid(text: &str, name: &str) -> Result<Vec<i16>, String> {
    let body = extract_section(text, &format!("{name}["))?;
    let mut values = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((_, rest)) = trimmed.split_once(',') else {
            continue;
        };
        for part in rest.split(',') {
            let value = part.trim();
            if value.is_empty() {
                continue;
            }
            values.push(
                value
                    .parse::<i16>()
                    .map_err(|err| format!("failed to parse {name} grid value '{value}': {err}"))?,
            );
        }
    }
    Ok(values)
}

fn extract_section<'a>(text: &'a str, prefix: &str) -> Result<&'a str, String> {
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        if line.trim_start().starts_with(prefix) {
            let mut section = String::new();
            for body_line in &mut lines {
                if body_line.trim().is_empty() {
                    break;
                }
                section.push_str(body_line);
                section.push('\n');
            }
            return Ok(Box::leak(section.into_boxed_str()));
        }
    }
    Err(format!("failed to find HYCOM section {prefix}"))
}

fn index_range(values: &[f64], min: f64, max: f64) -> Result<(usize, usize), String> {
    let start = values
        .iter()
        .position(|value| *value >= min)
        .ok_or_else(|| format!("no HYCOM index found for min {min}"))?;
    let end = values
        .iter()
        .rposition(|value| *value <= max)
        .ok_or_else(|| format!("no HYCOM index found for max {max}"))?;
    Ok((start, end))
}

fn stride_slice(values: &[f64], start: usize, end: usize, stride: usize) -> Vec<f64> {
    let mut out = Vec::new();
    let mut index = start;
    while index <= end {
        out.push(values[index]);
        index = index.saturating_add(stride);
        if stride == 0 {
            break;
        }
    }
    if out.last().copied() != Some(values[end]) {
        out.push(values[end]);
    }
    out
}

fn scale_velocity(raw: i16) -> f32 {
    if raw <= -30000 {
        f32::NAN
    } else {
        raw as f32 * 0.001
    }
}

fn nearest_index(values: &[f64], target: f64) -> Option<usize> {
    values
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (*left - target)
                .abs()
                .partial_cmp(&(*right - target).abs())
                .unwrap()
        })
        .map(|(index, _)| index)
}

fn bilinear_sample(
    lats: &[f64],
    lons: &[f64],
    u: &[f32],
    v: &[f32],
    lat_len: usize,
    lon_len: usize,
    lat: f64,
    lon: f64,
) -> Option<(f64, f64)> {
    let lat_hi = lats.iter().position(|value| *value >= lat)?;
    let lon_hi = lons.iter().position(|value| *value >= lon)?;
    let lat_lo = lat_hi.saturating_sub(1);
    let lon_lo = lon_hi.saturating_sub(1);
    let lat0 = *lats.get(lat_lo)?;
    let lat1 = *lats.get(lat_hi)?;
    let lon0 = *lons.get(lon_lo)?;
    let lon1 = *lons.get(lon_hi)?;
    let tx = if (lon1 - lon0).abs() < 1e-9 {
        0.0
    } else {
        ((lon - lon0) / (lon1 - lon0)).clamp(0.0, 1.0)
    };
    let ty = if (lat1 - lat0).abs() < 1e-9 {
        0.0
    } else {
        ((lat - lat0) / (lat1 - lat0)).clamp(0.0, 1.0)
    };

    let i00 = lat_lo * lon_len + lon_lo;
    let i01 = lat_lo * lon_len + lon_hi;
    let i10 = lat_hi * lon_len + lon_lo;
    let i11 = lat_hi * lon_len + lon_hi;
    if i11 >= u.len() || i11 >= v.len() || lat_lo >= lat_len || lat_hi >= lat_len {
        return None;
    }

    let u00 = *u.get(i00)? as f64;
    let u01 = *u.get(i01)? as f64;
    let u10 = *u.get(i10)? as f64;
    let u11 = *u.get(i11)? as f64;
    let v00 = *v.get(i00)? as f64;
    let v01 = *v.get(i01)? as f64;
    let v10 = *v.get(i10)? as f64;
    let v11 = *v.get(i11)? as f64;
    if [u00, u01, u10, u11, v00, v01, v10, v11]
        .iter()
        .any(|value| !value.is_finite())
    {
        return None;
    }

    let u0 = lerp(u00, u01, tx);
    let u1 = lerp(u10, u11, tx);
    let v0 = lerp(v00, v01, tx);
    let v1 = lerp(v10, v11, tx);
    Some((lerp(u0, u1, ty), lerp(v0, v1, ty)))
}

fn monthly_samples() -> Vec<(i32, u32)> {
    let mut samples = Vec::new();
    for month in 3..=12 {
        samples.push((2014, month));
    }
    for month in 1..=12 {
        samples.push((2015, month));
    }
    samples
}

fn year_time_len(year: i32) -> usize {
    match year {
        2014 => 2857,
        2015 => 2920,
        _ => 2920,
    }
}

fn hours_since_2000(year: i32, month: u32, day: u32, hour: u32) -> f64 {
    let epoch = gregorian_to_jdn(2000, 1, 1);
    let target = gregorian_to_jdn(year, month, day);
    ((target - epoch) as f64) * 24.0 + hour as f64
}

fn date_from_day_index(day_index: usize) -> (i32, u32, u32) {
    let mut year = 2014;
    let mut month = 3;
    let mut day = 8_u32 + day_index as u32;
    loop {
        let dim = days_in_month(year, month);
        if day <= dim {
            return (year, month, day);
        }
        day -= dim;
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
}

fn next_month(year: i32, month: u32) -> Option<(i32, u32)> {
    if year == 2015 && month == 12 {
        return None;
    }
    if month == 12 {
        Some((year + 1, 1))
    } else {
        Some((year, month + 1))
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn gregorian_to_jdn(year: i32, month: u32, day: u32) -> i32 {
    let a = (14 - month as i32) / 12;
    let y = year + 4800 - a;
    let m = month as i32 + 12 * a - 3;
    day as i32 + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
