use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// OSCAR surface current data from CoastWatch ERDDAP (NOAA/JPL).
/// Dataset: jplOscar — 1/3° resolution, 5-day composites, 15m depth.
/// Source: https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.html
/// License: Creative Commons Attribution 4.0 International (CC BY 4.0).

const ERDDAP_BASE: &str = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar";

// Domain: impact zone (~91°E, 36°S) through Reunion (55.5°E, 21°S)
const LAT_MIN: f64 = -45.0;
const LAT_MAX: f64 = -10.0;
const LON_MIN: f64 = 50.0;
const LON_MAX: f64 = 100.0;

// March 2014 through August 2015 covers 508 days (flaperon at Reunion)
const TIME_START: &str = "2014-03-01T00:00:00Z";
const TIME_END: &str = "2015-09-01T00:00:00Z";

// Day offset cutoff: don't fetch timesteps beyond this many days after crash
// 2015-09-01 is day 542 from 2014-03-08
const MAX_DAY_OFFSET: f64 = 545.0;

const CACHE_VERSION: u32 = 2;
const MAX_RETRIES: usize = 2;

static CACHE: OnceLock<Option<OscarCache>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct OscarCache {
    version: u32,
    lats: Vec<f64>,
    lons: Vec<f64>,
    timesteps: Vec<OscarTimestep>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OscarTimestep {
    /// Days since 2014-03-08 (crash date)
    day_offset: f64,
    /// ISO date from ERDDAP
    date: String,
    /// Row-major [lat_index * lon_count + lon_index], east velocity (m/s)
    u: Vec<f32>,
    /// Row-major, north velocity (m/s)
    v: Vec<f32>,
}

/// Get interpolated OSCAR surface current at a position and time.
/// Returns (u_east, v_north) in m/s, or None if outside the domain.
pub fn oscar_current_at(day_index: usize, lat: f64, lon: f64) -> Option<(f64, f64)> {
    let cache = CACHE.get_or_init(|| load_or_build().map_err(|e| eprintln!("OSCAR: {e}")).ok());
    cache.as_ref()?.sample(day_index as f64, lat, lon)
}

impl OscarCache {
    fn sample(&self, day: f64, lat: f64, lon: f64) -> Option<(f64, f64)> {
        if self.timesteps.is_empty() {
            return None;
        }
        if !(LAT_MIN..=LAT_MAX).contains(&lat) || !(LON_MIN..=LON_MAX).contains(&lon) {
            return None;
        }

        // Bracket in time: find first timestep >= day
        let hi_idx = self
            .timesteps
            .iter()
            .position(|t| t.day_offset >= day)
            .unwrap_or(self.timesteps.len() - 1);
        let lo_idx = if hi_idx > 0 && self.timesteps[hi_idx].day_offset > day {
            hi_idx - 1
        } else {
            hi_idx
        };

        let lon_len = self.lons.len();
        let lo = &self.timesteps[lo_idx];
        let s_lo = bilinear(&self.lats, &self.lons, &lo.u, &lo.v, lon_len, lat, lon)?;

        if lo_idx == hi_idx {
            return Some(s_lo);
        }

        let hi = &self.timesteps[hi_idx];
        let s_hi = bilinear(&self.lats, &self.lons, &hi.u, &hi.v, lon_len, lat, lon)?;

        let dt = hi.day_offset - lo.day_offset;
        let t = if dt.abs() < 1e-9 {
            0.0
        } else {
            ((day - lo.day_offset) / dt).clamp(0.0, 1.0)
        };

        Some((
            s_lo.0 + (s_hi.0 - s_lo.0) * t,
            s_lo.1 + (s_hi.1 - s_lo.1) * t,
        ))
    }
}

// ---------------------------------------------------------------------------
// Cache loading / building
// ---------------------------------------------------------------------------

fn load_or_build() -> Result<OscarCache, String> {
    let path = cache_path()?;
    eprintln!("OSCAR: cache path = {}", path.display());
    match fs::read_to_string(&path) {
        Ok(raw) => {
            eprintln!("OSCAR: read {} bytes from cache", raw.len());
            match serde_json::from_str::<OscarCache>(&raw) {
                Ok(cache) if cache.version == CACHE_VERSION => {
                    eprintln!(
                        "OSCAR: loaded cache ({} lat x {} lon x {} timesteps)",
                        cache.lats.len(),
                        cache.lons.len(),
                        cache.timesteps.len()
                    );
                    return Ok(cache);
                }
                Ok(cache) => {
                    eprintln!(
                        "OSCAR: cache version mismatch (got {}, want {CACHE_VERSION})",
                        cache.version
                    );
                }
                Err(e) => {
                    eprintln!("OSCAR: cache parse failed: {e}");
                }
            }
        }
        Err(e) => {
            eprintln!("OSCAR: no cache file: {e}");
        }
    }

    let cache = build_cache()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("OSCAR: failed to create cache dir: {e}"))?;
    }
    let json =
        serde_json::to_string(&cache).map_err(|e| format!("OSCAR: failed to serialize: {e}"))?;
    fs::write(&path, json)
        .map_err(|e| format!("OSCAR: failed to write cache {}: {e}", path.display()))?;
    eprintln!("OSCAR: cache saved to {}", path.display());

    Ok(cache)
}

fn build_cache() -> Result<OscarCache, String> {
    eprintln!("OSCAR: fetching available timestamps...");
    let all_dates = fetch_timestamps()?;

    // Filter to dates within our desired range
    let dates: Vec<String> = all_dates
        .into_iter()
        .filter(|d| {
            let offset = iso_to_day_offset(d);
            offset >= -7.0 && offset <= MAX_DAY_OFFSET
        })
        .collect();

    eprintln!(
        "OSCAR: {} timesteps in range, {} to {}",
        dates.len(),
        dates.first().map(|s| s.as_str()).unwrap_or("?"),
        dates.last().map(|s| s.as_str()).unwrap_or("?")
    );

    // Report gaps > 15 days
    for i in 1..dates.len() {
        let gap = iso_to_day_offset(&dates[i]) - iso_to_day_offset(&dates[i - 1]);
        if gap > 15.0 {
            eprintln!(
                "OSCAR: WARNING: {:.0}-day gap between {} and {}",
                gap,
                &dates[i - 1][..10],
                &dates[i][..10]
            );
        }
    }

    let mut lats: Vec<f64> = Vec::new();
    let mut lons: Vec<f64> = Vec::new();
    let mut timesteps = Vec::new();
    let mut skipped = 0;

    for (i, date) in dates.iter().enumerate() {
        eprintln!(
            "OSCAR: fetching {}/{} ({})",
            i + 1,
            dates.len(),
            &date[..10]
        );

        match fetch_grid_with_retry(date) {
            Ok(grid) => {
                if lats.is_empty() {
                    lats = grid.lats;
                    lons = grid.lons;
                }
                timesteps.push(OscarTimestep {
                    day_offset: iso_to_day_offset(date),
                    date: date.clone(),
                    u: grid.u,
                    v: grid.v,
                });
            }
            Err(e) => {
                eprintln!("OSCAR: skipping {} ({})", &date[..10], e);
                skipped += 1;
            }
        }
    }

    if timesteps.is_empty() {
        return Err("OSCAR: no timesteps fetched successfully".to_string());
    }

    eprintln!(
        "OSCAR: cache built ({} lat x {} lon x {} timesteps, {} skipped)",
        lats.len(),
        lons.len(),
        timesteps.len(),
        skipped
    );

    Ok(OscarCache {
        version: CACHE_VERSION,
        lats,
        lons,
        timesteps,
    })
}

fn cache_path() -> Result<PathBuf, String> {
    let base = std::env::current_dir().map_err(|e| format!("current dir: {e}"))?;
    // When running via `cargo test` or `cargo run`, cwd is src-tauri/
    // When running from the project root, it's the repo root
    let tauri_dir = if base.join("Cargo.toml").exists() {
        base.clone()
    } else {
        base.join("src-tauri")
    };
    Ok(tauri_dir
        .join(".cache")
        .join("oscar_surface_currents_v2.json"))
}

// ---------------------------------------------------------------------------
// ERDDAP fetching
// ---------------------------------------------------------------------------

fn fetch_timestamps() -> Result<Vec<String>, String> {
    let url = format!("{ERDDAP_BASE}.csv?time[({TIME_START}):({TIME_END})]");
    let text = fetch_text(&url)?;
    let mut dates = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if i < 2 {
            continue; // header + units rows
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            dates.push(trimmed.to_string());
        }
    }
    if dates.is_empty() {
        return Err("no timestamps returned from ERDDAP".to_string());
    }
    Ok(dates)
}

struct GridData {
    lats: Vec<f64>,
    lons: Vec<f64>,
    u: Vec<f32>,
    v: Vec<f32>,
}

fn fetch_grid_with_retry(date: &str) -> Result<GridData, String> {
    let url = format!(
        "{ERDDAP_BASE}.csv?u[({date})][(15.0)][({LAT_MIN}):({LAT_MAX})][({LON_MIN}):({LON_MAX})],\
         v[({date})][(15.0)][({LAT_MIN}):({LAT_MAX})][({LON_MIN}):({LON_MAX})]"
    );

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            eprintln!("OSCAR: retry {attempt}/{MAX_RETRIES} for {}", &date[..10]);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }

        match fetch_text(&url) {
            Ok(text) => return parse_grid_csv(&text),
            Err(e) if attempt < MAX_RETRIES => {
                eprintln!("OSCAR: attempt {} failed: {e}", attempt + 1);
            }
            Err(e) => return Err(e),
        }
    }

    unreachable!()
}

fn fetch_text(url: &str) -> Result<String, String> {
    ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| format!("ERDDAP request failed: {url}: {e}"))?
        .into_string()
        .map_err(|e| format!("ERDDAP response decode failed: {e}"))
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

fn parse_grid_csv(text: &str) -> Result<GridData, String> {
    let mut rows: Vec<(f64, f64, f32, f32)> = Vec::new();

    for (i, line) in text.lines().enumerate() {
        if i < 2 {
            continue;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Columns: time, depth, latitude, longitude, u, v
        let mut parts = line.splitn(7, ',');
        let _time = parts.next();
        let _depth = parts.next();
        let lat: f64 = parts
            .next()
            .ok_or("missing lat")?
            .trim()
            .parse()
            .map_err(|e| format!("lat parse: {e}"))?;
        let lon: f64 = parts
            .next()
            .ok_or("missing lon")?
            .trim()
            .parse()
            .map_err(|e| format!("lon parse: {e}"))?;
        // NaN indicates land/missing data. Bilinear interpolation returns None
        // for NaN corners, so the sentinel value doesn't affect results.
        // Use a large sentinel instead of NaN so the cache round-trips through JSON.
        let u = parse_f32_or_sentinel(parts.next().ok_or("missing u")?.trim());
        let v = parse_f32_or_sentinel(parts.next().ok_or("missing v")?.trim());
        rows.push((lat, lon, u, v));
    }

    if rows.is_empty() {
        return Err("OSCAR CSV: no data rows".to_string());
    }

    // ERDDAP returns rows in lat-major, lon-minor order.
    // Determine lon_count by finding where lat first changes.
    let first_lat = rows[0].0;
    let lon_count = rows
        .iter()
        .position(|r| (r.0 - first_lat).abs() > 0.01)
        .unwrap_or(rows.len());
    let lat_count = rows.len() / lon_count;

    if lat_count * lon_count != rows.len() {
        return Err(format!(
            "OSCAR CSV: {} rows is not {}x{} grid",
            rows.len(),
            lat_count,
            lon_count
        ));
    }

    let lons: Vec<f64> = rows[..lon_count].iter().map(|r| r.1).collect();
    let mut lats: Vec<f64> = (0..lat_count).map(|i| rows[i * lon_count].0).collect();
    let mut u: Vec<f32> = rows.iter().map(|r| r.2).collect();
    let mut v: Vec<f32> = rows.iter().map(|r| r.3).collect();

    // ERDDAP returns latitudes in descending order (north to south).
    // Bilinear interpolation requires ascending order. Reverse if needed.
    if lats.len() >= 2 && lats[0] > lats[1] {
        lats.reverse();
        let mut u_rev = Vec::with_capacity(u.len());
        let mut v_rev = Vec::with_capacity(v.len());
        for i in (0..lat_count).rev() {
            let start = i * lon_count;
            u_rev.extend_from_slice(&u[start..start + lon_count]);
            v_rev.extend_from_slice(&v[start..start + lon_count]);
        }
        u = u_rev;
        v = v_rev;
    }

    Ok(GridData { lats, lons, u, v })
}

// Sentinel value for missing/land data. Must be detectable by is_finite() check
// in bilinear interpolation, and must survive JSON round-trip (NaN doesn't).
const MISSING: f32 = 9999.0;

fn parse_f32_or_sentinel(s: &str) -> f32 {
    match s.parse::<f32>() {
        Ok(v) if v.is_finite() => v,
        _ => MISSING,
    }
}

// ---------------------------------------------------------------------------
// Bilinear interpolation
// ---------------------------------------------------------------------------

fn bilinear(
    lats: &[f64],
    lons: &[f64],
    u: &[f32],
    v: &[f32],
    lon_len: usize,
    lat: f64,
    lon: f64,
) -> Option<(f64, f64)> {
    let lat_hi = lats.iter().position(|l| *l >= lat)?;
    let lon_hi = lons.iter().position(|l| *l >= lon)?;
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

    let idx = |li: usize, lo: usize| li * lon_len + lo;
    let i00 = idx(lat_lo, lon_lo);
    let i01 = idx(lat_lo, lon_hi);
    let i10 = idx(lat_hi, lon_lo);
    let i11 = idx(lat_hi, lon_hi);

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
        .any(|x| !x.is_finite() || x.abs() > (MISSING as f64 - 1.0))
    {
        return None;
    }

    let u_interp = lerp(lerp(u00, u01, tx), lerp(u10, u11, tx), ty);
    let v_interp = lerp(lerp(v00, v01, tx), lerp(v10, v11, tx), ty);
    Some((u_interp, v_interp))
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/// Convert ISO date (e.g. "2014-03-07T00:00:00Z") to days since 2014-03-08.
fn iso_to_day_offset(date: &str) -> f64 {
    let date_part = if date.len() >= 10 { &date[..10] } else { date };
    let mut parts = date_part.split('-');
    let year: i32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(2014);
    let month: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(3);
    let day: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(8);

    let crash_jdn = gregorian_to_jdn(2014, 3, 8);
    let this_jdn = gregorian_to_jdn(year, month, day);
    (this_jdn - crash_jdn) as f64
}

fn gregorian_to_jdn(year: i32, month: u32, day: u32) -> i32 {
    let a = (14 - month as i32) / 12;
    let y = year + 4800 - a;
    let m = month as i32 + 12 * a - 3;
    day as i32 + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_to_day_offset_crash_date() {
        assert_eq!(iso_to_day_offset("2014-03-08T00:00:00Z"), 0.0);
    }

    #[test]
    fn iso_to_day_offset_one_year() {
        assert_eq!(iso_to_day_offset("2015-03-08T00:00:00Z"), 365.0);
    }

    #[test]
    fn iso_to_day_offset_flaperon() {
        // Flaperon found 2015-07-29, ~508 days after crash
        let days = iso_to_day_offset("2015-07-29T00:00:00Z");
        assert_eq!(days, 508.0);
    }

    /// Validates the full data pipeline: ERDDAP fetch, CSV parse, grid construction,
    /// bilinear interpolation, temporal interpolation.
    ///
    /// Checks current vectors at multiple latitudes:
    /// - 40°S, 60-80°E: West Wind Drift (generally eastward, 0.05-0.4 m/s)
    /// - 20°S, 60-80°E: South Equatorial Current (generally westward)
    /// - 36°S, 91°E: Near impact zone (should have data, reasonable speed)
    ///
    /// Requires network access. Run with: cargo test oscar -- --ignored --nocapture
    #[test]
    #[ignore]
    fn validates_ocean_circulation() {
        let cache = load_or_build().expect("failed to build OSCAR cache");

        // West Wind Drift at 40°S — generally eastward
        eprintln!("\n--- West Wind Drift (40°S, day 30) ---");
        eprintln!(
            "{:<15} {:>10} {:>10} {:>10}",
            "Location", "u (m/s)", "v (m/s)", "speed"
        );

        for lon in [60.0, 65.0, 70.0, 75.0, 80.0] {
            let (u, v) = cache.sample(30.0, -40.0, lon)
                .unwrap_or_else(|| panic!("no data at 40°S, {lon:.0}°E"));
            let speed = (u * u + v * v).sqrt();
            eprintln!("40°S {lon:.0}°E      {u:>10.4} {v:>10.4} {speed:>10.4}");
            // Physically reasonable speed (open ocean, not a boundary current)
            assert!(speed < 1.0, "unreasonable speed {speed} at 40°S {lon}°E");
        }

        // South Equatorial Current at 20°S — generally westward
        eprintln!("\n--- South Equatorial Current (20°S, day 30) ---");
        let mut sec_westward = 0;
        for lon in [60.0, 65.0, 70.0, 75.0, 80.0] {
            let (u, v) = cache.sample(30.0, -20.0, lon)
                .unwrap_or_else(|| panic!("no data at 20°S, {lon:.0}°E"));
            let speed = (u * u + v * v).sqrt();
            eprintln!("20°S {lon:.0}°E      {u:>10.4} {v:>10.4} {speed:>10.4}");
            if u < 0.0 {
                sec_westward += 1;
            }
        }
        // SEC should be mostly westward at 20°S
        assert!(
            sec_westward >= 3,
            "expected mostly westward SEC at 20°S, got {sec_westward}/5 westward"
        );

        // Impact zone spot check
        eprintln!("\n--- Impact zone (36°S, 91°E, day 0) ---");
        let (u, v) = cache.sample(0.0, -36.0, 91.0)
            .expect("no data at impact zone");
        let speed = (u * u + v * v).sqrt();
        eprintln!("36°S 91°E       {u:>10.4} {v:>10.4} {speed:>10.4}");
        assert!(speed > 0.001, "suspiciously zero current at impact zone");
        assert!(speed < 1.0, "unreasonable speed at impact zone");
    }

    /// Spot-check that the impact zone returns valid current data.
    #[test]
    #[ignore]
    fn impact_zone_has_data() {
        let cache = load_or_build().expect("failed to build OSCAR cache");

        // Impact zone: ~35.9°S, 90.8°E at day 0 (crash date)
        let result = cache.sample(0.0, -35.9, 90.8);
        assert!(
            result.is_some(),
            "no OSCAR data at impact zone (35.9°S, 90.8°E)"
        );
        let (u, v) = result.unwrap();
        let speed = (u * u + v * v).sqrt();
        eprintln!("Impact zone current: u={u:.4}, v={v:.4}, speed={speed:.4} m/s");
        assert!(speed < 1.0, "unreasonably strong current at impact zone");
    }
}
