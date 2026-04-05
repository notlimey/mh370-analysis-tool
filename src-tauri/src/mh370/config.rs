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
            bfo_sigma_hz: f64,
            bfo_score_weight: f64,
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
