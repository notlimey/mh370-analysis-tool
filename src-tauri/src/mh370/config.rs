use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::data::AnalysisConfig;

const DEFAULT_CONFIG_RELATIVE_PATH: &str = "config/analysis.default.toml";
const LOCAL_CONFIG_RELATIVE_PATH: &str = "config/analysis.local.toml";

macro_rules! analysis_config_fields {
    ($macro:ident) => {
        $macro! {
            dataset_path: String,
            ring_points: usize,
            min_speed_kts: f64,
            max_speed_kts: f64,
            cruise_altitude_ft: f64,
            calibration_altitude_ft: f64,
            beam_width: usize,
            ring_sample_step: usize,
            speed_consistency_sigma_kts: f64,
            heading_change_sigma_deg: f64,
            northward_leg_sigma_deg: f64,
            northward_penalty_weight: f64,
            bfo_sigma_hz: f64,
            bfo_score_weight: f64,
            arc7_vertical_speed_fpm: f64,
            satellite_nominal_lon_deg: f64,
            satellite_nominal_lat_deg: f64,
            satellite_drift_start_lat_offset_deg: f64,
            satellite_drift_amplitude_deg: f64,
            satellite_drift_end_time_utc: String,
            fuel_remaining_at_arc1_kg: f64,
            fuel_baseline_kg_per_hr: f64,
            fuel_baseline_speed_kts: f64,
            fuel_baseline_altitude_ft: f64,
            fuel_speed_exponent: f64,
            fuel_low_altitude_penalty_per_10kft: f64,
            post_arc7_low_speed_kts: f64,
            max_post_arc7_minutes: f64,
            arc7_grid_min_lat: f64,
            arc7_grid_max_lat: f64,
            arc7_grid_points: usize,
            debris_weight_min_lat: f64,
            debris_weight_max_lat: f64,
            slow_family_max_speed_kts: f64,
            perpendicular_family_tolerance_deg: f64,
            endpoint_mode: String,
            descent_before_arc7_minutes: f64,
            descent_rate_fpm: f64,
            glide_wind_correction_kts: f64,
        }
    };
}

macro_rules! define_partial_analysis_config {
    ($( $field:ident : $ty:ty, )*) => {
        #[derive(Debug, Clone, Serialize, Deserialize, Default)]
        #[serde(default)]
        pub struct PartialAnalysisConfig {
            $(pub $field: Option<$ty>,)*
        }

        impl PartialAnalysisConfig {
            pub fn merge_into(
                &self,
                base: &mut AnalysisConfig,
                source: ConfigSource,
                sources: &mut HashMap<String, ConfigSource>,
            ) {
                $(
                    if let Some(value) = &self.$field {
                        base.$field = value.clone();
                        sources.insert(stringify!($field).to_string(), source);
                    }
                )*
            }

            fn field_names() -> &'static [&'static str] {
                &[$(stringify!($field),)*]
            }
        }
    };
}

analysis_config_fields!(define_partial_analysis_config);

/// Read a numeric field from `AnalysisConfig` by name.
/// Returns `Err` for non-numeric or unknown fields.
pub fn get_config_field(config: &AnalysisConfig, field_name: &str) -> Result<f64, String> {
    match field_name {
        "ring_points" => Ok(config.ring_points as f64),
        "beam_width" => Ok(config.beam_width as f64),
        "ring_sample_step" => Ok(config.ring_sample_step as f64),
        "arc7_grid_points" => Ok(config.arc7_grid_points as f64),
        "min_speed_kts" => Ok(config.min_speed_kts),
        "max_speed_kts" => Ok(config.max_speed_kts),
        "cruise_altitude_ft" => Ok(config.cruise_altitude_ft),
        "calibration_altitude_ft" => Ok(config.calibration_altitude_ft),
        "speed_consistency_sigma_kts" => Ok(config.speed_consistency_sigma_kts),
        "heading_change_sigma_deg" => Ok(config.heading_change_sigma_deg),
        "northward_leg_sigma_deg" => Ok(config.northward_leg_sigma_deg),
        "northward_penalty_weight" => Ok(config.northward_penalty_weight),
        "bfo_sigma_hz" => Ok(config.bfo_sigma_hz),
        "bfo_score_weight" => Ok(config.bfo_score_weight),
        "arc7_vertical_speed_fpm" => Ok(config.arc7_vertical_speed_fpm),
        "satellite_nominal_lon_deg" => Ok(config.satellite_nominal_lon_deg),
        "satellite_nominal_lat_deg" => Ok(config.satellite_nominal_lat_deg),
        "satellite_drift_start_lat_offset_deg" => Ok(config.satellite_drift_start_lat_offset_deg),
        "satellite_drift_amplitude_deg" => Ok(config.satellite_drift_amplitude_deg),
        "fuel_remaining_at_arc1_kg" => Ok(config.fuel_remaining_at_arc1_kg),
        "fuel_baseline_kg_per_hr" => Ok(config.fuel_baseline_kg_per_hr),
        "fuel_baseline_speed_kts" => Ok(config.fuel_baseline_speed_kts),
        "fuel_baseline_altitude_ft" => Ok(config.fuel_baseline_altitude_ft),
        "fuel_speed_exponent" => Ok(config.fuel_speed_exponent),
        "fuel_low_altitude_penalty_per_10kft" => Ok(config.fuel_low_altitude_penalty_per_10kft),
        "post_arc7_low_speed_kts" => Ok(config.post_arc7_low_speed_kts),
        "max_post_arc7_minutes" => Ok(config.max_post_arc7_minutes),
        "arc7_grid_min_lat" => Ok(config.arc7_grid_min_lat),
        "arc7_grid_max_lat" => Ok(config.arc7_grid_max_lat),
        "debris_weight_min_lat" => Ok(config.debris_weight_min_lat),
        "debris_weight_max_lat" => Ok(config.debris_weight_max_lat),
        "slow_family_max_speed_kts" => Ok(config.slow_family_max_speed_kts),
        "perpendicular_family_tolerance_deg" => Ok(config.perpendicular_family_tolerance_deg),
        "descent_before_arc7_minutes" => Ok(config.descent_before_arc7_minutes),
        "descent_rate_fpm" => Ok(config.descent_rate_fpm),
        "glide_wind_correction_kts" => Ok(config.glide_wind_correction_kts),
        "dataset_path" | "satellite_drift_end_time_utc" | "endpoint_mode" => {
            Err(format!("field {field_name} is not numeric"))
        }
        _ => Err(format!("unknown config field: {field_name}")),
    }
}

/// Set a numeric field on `AnalysisConfig` by name and return the new value.
/// Returns `Err` for non-numeric or unknown fields.
pub fn set_config_field(
    config: &mut AnalysisConfig,
    field_name: &str,
    value: f64,
) -> Result<f64, String> {
    match field_name {
        "ring_points" => {
            config.ring_points = value as usize;
            Ok(value)
        }
        "beam_width" => {
            config.beam_width = value as usize;
            Ok(value)
        }
        "ring_sample_step" => {
            config.ring_sample_step = value as usize;
            Ok(value)
        }
        "arc7_grid_points" => {
            config.arc7_grid_points = value as usize;
            Ok(value)
        }
        "min_speed_kts" => {
            config.min_speed_kts = value;
            Ok(value)
        }
        "max_speed_kts" => {
            config.max_speed_kts = value;
            Ok(value)
        }
        "cruise_altitude_ft" => {
            config.cruise_altitude_ft = value;
            Ok(value)
        }
        "calibration_altitude_ft" => {
            config.calibration_altitude_ft = value;
            Ok(value)
        }
        "speed_consistency_sigma_kts" => {
            config.speed_consistency_sigma_kts = value;
            Ok(value)
        }
        "heading_change_sigma_deg" => {
            config.heading_change_sigma_deg = value;
            Ok(value)
        }
        "northward_leg_sigma_deg" => {
            config.northward_leg_sigma_deg = value;
            Ok(value)
        }
        "northward_penalty_weight" => {
            config.northward_penalty_weight = value;
            Ok(value)
        }
        "bfo_sigma_hz" => {
            config.bfo_sigma_hz = value;
            Ok(value)
        }
        "bfo_score_weight" => {
            config.bfo_score_weight = value;
            Ok(value)
        }
        "arc7_vertical_speed_fpm" => {
            config.arc7_vertical_speed_fpm = value;
            Ok(value)
        }
        "satellite_nominal_lon_deg" => {
            config.satellite_nominal_lon_deg = value;
            Ok(value)
        }
        "satellite_nominal_lat_deg" => {
            config.satellite_nominal_lat_deg = value;
            Ok(value)
        }
        "satellite_drift_start_lat_offset_deg" => {
            config.satellite_drift_start_lat_offset_deg = value;
            Ok(value)
        }
        "satellite_drift_amplitude_deg" => {
            config.satellite_drift_amplitude_deg = value;
            Ok(value)
        }
        "fuel_remaining_at_arc1_kg" => {
            config.fuel_remaining_at_arc1_kg = value;
            Ok(value)
        }
        "fuel_baseline_kg_per_hr" => {
            config.fuel_baseline_kg_per_hr = value;
            Ok(value)
        }
        "fuel_baseline_speed_kts" => {
            config.fuel_baseline_speed_kts = value;
            Ok(value)
        }
        "fuel_baseline_altitude_ft" => {
            config.fuel_baseline_altitude_ft = value;
            Ok(value)
        }
        "fuel_speed_exponent" => {
            config.fuel_speed_exponent = value;
            Ok(value)
        }
        "fuel_low_altitude_penalty_per_10kft" => {
            config.fuel_low_altitude_penalty_per_10kft = value;
            Ok(value)
        }
        "post_arc7_low_speed_kts" => {
            config.post_arc7_low_speed_kts = value;
            Ok(value)
        }
        "max_post_arc7_minutes" => {
            config.max_post_arc7_minutes = value;
            Ok(value)
        }
        "arc7_grid_min_lat" => {
            config.arc7_grid_min_lat = value;
            Ok(value)
        }
        "arc7_grid_max_lat" => {
            config.arc7_grid_max_lat = value;
            Ok(value)
        }
        "debris_weight_min_lat" => {
            config.debris_weight_min_lat = value;
            Ok(value)
        }
        "debris_weight_max_lat" => {
            config.debris_weight_max_lat = value;
            Ok(value)
        }
        "slow_family_max_speed_kts" => {
            config.slow_family_max_speed_kts = value;
            Ok(value)
        }
        "perpendicular_family_tolerance_deg" => {
            config.perpendicular_family_tolerance_deg = value;
            Ok(value)
        }
        "descent_before_arc7_minutes" => {
            config.descent_before_arc7_minutes = value;
            Ok(value)
        }
        "descent_rate_fpm" => {
            config.descent_rate_fpm = value;
            Ok(value)
        }
        "glide_wind_correction_kts" => {
            config.glide_wind_correction_kts = value;
            Ok(value)
        }
        "dataset_path" | "satellite_drift_end_time_utc" | "endpoint_mode" => {
            Err(format!("field {field_name} is not numeric"))
        }
        _ => Err(format!("unknown config field: {field_name}")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum ConfigSource {
    CompiledDefault,
    DefaultToml,
    LocalToml,
    UiOverride,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedConfig {
    pub config: AnalysisConfig,
    pub sources: HashMap<String, ConfigSource>,
}

impl ResolvedConfig {
    fn compiled_defaults() -> Self {
        let mut sources = HashMap::new();
        for field_name in PartialAnalysisConfig::field_names() {
            sources.insert((*field_name).to_string(), ConfigSource::CompiledDefault);
        }

        Self {
            config: AnalysisConfig::default(),
            sources,
        }
    }

    pub fn source_counts(&self) -> HashMap<ConfigSource, usize> {
        let mut counts = HashMap::new();
        for source in self.sources.values().copied() {
            *counts.entry(source).or_insert(0) += 1;
        }
        counts
    }
}

pub fn load_config() -> Result<ResolvedConfig, String> {
    let cwd = std::env::current_dir().map_err(|err| format!("failed to determine cwd: {err}"))?;
    load_config_from_roots(&[cwd])
}

pub fn load_config_from_roots(roots: &[PathBuf]) -> Result<ResolvedConfig, String> {
    let mut resolved = ResolvedConfig::compiled_defaults();

    if let Some(path) = find_existing_path(roots, DEFAULT_CONFIG_RELATIVE_PATH) {
        apply_toml_file(
            &path,
            &mut resolved,
            ConfigSource::DefaultToml,
            "default config",
        )?;
    }

    if let Some(path) = find_existing_path(roots, LOCAL_CONFIG_RELATIVE_PATH) {
        apply_toml_file(
            &path,
            &mut resolved,
            ConfigSource::LocalToml,
            "local config",
        )?;
    }

    Ok(resolved)
}

fn find_existing_path(roots: &[PathBuf], relative_path: &str) -> Option<PathBuf> {
    roots
        .iter()
        .map(|root| root.join(relative_path))
        .find(|path| path.is_file())
}

fn apply_toml_file(
    path: &Path,
    resolved: &mut ResolvedConfig,
    source: ConfigSource,
    label: &str,
) -> Result<(), String> {
    let contents = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {} {}: {err}", label, path.display()))?;
    let partial: PartialAnalysisConfig = toml::from_str(&contents)
        .map_err(|err| format!("failed to parse {} {}: {err}", label, path.display()))?;
    partial.merge_into(&mut resolved.config, source, &mut resolved.sources);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let unique = format!(
            "mh370-config-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(root.join("config")).unwrap();
        root
    }

    #[test]
    fn partial_merge_only_overwrites_set_fields() {
        let mut config = AnalysisConfig::default();
        let mut sources = ResolvedConfig::compiled_defaults().sources;
        let partial = PartialAnalysisConfig {
            min_speed_kts: Some(365.0),
            beam_width: Some(128),
            ..Default::default()
        };

        partial.merge_into(&mut config, ConfigSource::LocalToml, &mut sources);

        assert_eq!(config.min_speed_kts, 365.0);
        assert_eq!(config.beam_width, 128);
        assert_eq!(
            config.max_speed_kts,
            AnalysisConfig::default().max_speed_kts
        );
        assert_eq!(sources.get("min_speed_kts"), Some(&ConfigSource::LocalToml));
        assert_eq!(
            sources.get("max_speed_kts"),
            Some(&ConfigSource::CompiledDefault)
        );
    }

    #[test]
    fn analysis_config_toml_round_trips() {
        let config = AnalysisConfig::default();
        let serialized = toml::to_string(&config).unwrap();
        let parsed: AnalysisConfig = toml::from_str(&serialized).unwrap();

        assert_eq!(parsed.bfo_sigma_hz, config.bfo_sigma_hz);
        assert_eq!(parsed.beam_width, config.beam_width);
        assert_eq!(parsed.dataset_path, config.dataset_path);
    }

    #[test]
    fn load_config_without_files_returns_compiled_defaults() {
        let root = temp_root("defaults");

        let resolved = load_config_from_roots(&[root.clone()]).unwrap();

        assert_eq!(
            resolved.config.min_speed_kts,
            AnalysisConfig::default().min_speed_kts
        );
        assert_eq!(
            resolved.sources.get("min_speed_kts"),
            Some(&ConfigSource::CompiledDefault)
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_config_with_partial_toml_only_overrides_specified_fields() {
        let root = temp_root("partial");
        let default_toml = root.join(DEFAULT_CONFIG_RELATIVE_PATH);
        fs::write(&default_toml, "min_speed_kts = 365.0\nbfo_sigma_hz = 5.5\n").unwrap();

        let resolved = load_config_from_roots(&[root.clone()]).unwrap();

        assert_eq!(resolved.config.min_speed_kts, 365.0);
        assert_eq!(resolved.config.bfo_sigma_hz, 5.5);
        assert_eq!(
            resolved.config.max_speed_kts,
            AnalysisConfig::default().max_speed_kts
        );
        assert_eq!(
            resolved.sources.get("min_speed_kts"),
            Some(&ConfigSource::DefaultToml)
        );
        assert_eq!(
            resolved.sources.get("max_speed_kts"),
            Some(&ConfigSource::CompiledDefault)
        );

        fs::remove_dir_all(root).unwrap();
    }
}
