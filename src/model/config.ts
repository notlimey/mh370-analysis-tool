export interface AnalysisConfig {
  dataset_path: string;
  satellite_ephemeris_path: string;
  ring_points: number;
  min_speed_kts: number;
  max_speed_kts: number;
  cruise_altitude_ft: number;
  calibration_altitude_ft: number;
  beam_width: number;
  ring_sample_step: number;
  speed_consistency_sigma_kts: number;
  heading_change_sigma_deg: number;
  satellite_nominal_lon_deg: number;
  satellite_nominal_lat_deg: number;
  satellite_drift_start_lat_offset_deg: number;
  satellite_drift_end_lat_offset_deg: number;
  satellite_drift_end_time_utc: string;
  fuel_remaining_at_arc1_kg: number;
  fuel_baseline_kg_per_hr: number;
  fuel_baseline_speed_kts: number;
  fuel_baseline_altitude_ft: number;
  fuel_speed_exponent: number;
  fuel_low_altitude_penalty_per_10kft: number;
  post_arc7_low_speed_kts: number;
  max_post_arc7_minutes: number;
  arc7_grid_min_lat: number;
  arc7_grid_max_lat: number;
  arc7_grid_points: number;
  debris_weight_min_lat: number;
  debris_weight_max_lat: number;
  slow_family_max_speed_kts: number;
  perpendicular_family_tolerance_deg: number;
}

export const defaultAnalysisConfig: AnalysisConfig = {
  dataset_path: "/Users/entropy/Downloads/mh370_data.json",
  satellite_ephemeris_path: "",
  ring_points: 360,
  min_speed_kts: 350,
  max_speed_kts: 520,
  cruise_altitude_ft: 35000,
  calibration_altitude_ft: 0,
  beam_width: 256,
  ring_sample_step: 10,
  speed_consistency_sigma_kts: 35,
  heading_change_sigma_deg: 80,
  satellite_nominal_lon_deg: 64.5,
  satellite_nominal_lat_deg: 0,
  satellite_drift_start_lat_offset_deg: 0,
  satellite_drift_end_lat_offset_deg: -1.6,
  satellite_drift_end_time_utc: "00:19:29.416",
  fuel_remaining_at_arc1_kg: 33500,
  fuel_baseline_kg_per_hr: 6500,
  fuel_baseline_speed_kts: 471,
  fuel_baseline_altitude_ft: 35000,
  fuel_speed_exponent: 1.35,
  fuel_low_altitude_penalty_per_10kft: 0.12,
  post_arc7_low_speed_kts: 420,
  max_post_arc7_minutes: 57,
  arc7_grid_min_lat: -45,
  arc7_grid_max_lat: -10,
  arc7_grid_points: 180,
  debris_weight_min_lat: -38,
  debris_weight_max_lat: -32,
  slow_family_max_speed_kts: 390,
  perpendicular_family_tolerance_deg: 20,
};

let currentAnalysisConfig: AnalysisConfig = { ...defaultAnalysisConfig };

export function getAnalysisConfig(): AnalysisConfig {
  return { ...currentAnalysisConfig };
}

export function updateAnalysisConfig(patch: Partial<AnalysisConfig>): AnalysisConfig {
  currentAnalysisConfig = { ...currentAnalysisConfig, ...patch };
  return getAnalysisConfig();
}

export function resetAnalysisConfig(): AnalysisConfig {
  currentAnalysisConfig = { ...defaultAnalysisConfig };
  return getAnalysisConfig();
}
