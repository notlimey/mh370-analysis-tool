import { getResolvedConfig } from "../lib/backend";
import type { BackendResolvedConfig, ConfigSource } from "../lib/backend";
import { getStoredAnalysisConfig, setStoredAnalysisConfig } from "./session";

export interface AnalysisConfig {
  dataset_path: string;
  ring_points: number;
  min_speed_kts: number;
  max_speed_kts: number;
  cruise_altitude_ft: number;
  calibration_altitude_ft: number;
  beam_width: number;
  ring_sample_step: number;
  speed_consistency_sigma_kts: number;
  heading_change_sigma_deg: number;
  northward_leg_sigma_deg: number;
  northward_penalty_weight: number;
  bfo_sigma_hz: number;
  bfo_score_weight: number;
  arc7_vertical_speed_fpm: number;
  satellite_nominal_lon_deg: number;
  satellite_nominal_lat_deg: number;
  satellite_drift_start_lat_offset_deg: number;
  satellite_drift_amplitude_deg: number;
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

export let defaultAnalysisConfig = {} as AnalysisConfig;

let currentAnalysisConfig = {} as AnalysisConfig;
let resolvedConfigState: BackendResolvedConfig = {
  config: {} as AnalysisConfig,
  sources: {},
};
const configChangeListeners: Array<(config: AnalysisConfig) => void> = [];

export async function initConfig(): Promise<AnalysisConfig> {
  const resolved = await getResolvedConfig();
  const storedConfig = getStoredAnalysisConfig();
  resolvedConfigState = {
    config: { ...resolved.config },
    sources: { ...resolved.sources },
  };
  defaultAnalysisConfig = { ...resolved.config };
  currentAnalysisConfig = { ...resolved.config, ...storedConfig };
  setStoredAnalysisConfig(currentAnalysisConfig);
  return getAnalysisConfig();
}

export function onAnalysisConfigChange(listener: (config: AnalysisConfig) => void): void {
  configChangeListeners.push(listener);
}

export function getAnalysisConfig(): AnalysisConfig {
  return { ...currentAnalysisConfig };
}

export function updateAnalysisConfig(patch: Partial<AnalysisConfig>): AnalysisConfig {
  currentAnalysisConfig = { ...currentAnalysisConfig, ...patch };
  setStoredAnalysisConfig(currentAnalysisConfig);
  notifyConfigChangeListeners();
  return getAnalysisConfig();
}

export function resetAnalysisConfig(): AnalysisConfig {
  currentAnalysisConfig = { ...defaultAnalysisConfig };
  setStoredAnalysisConfig(currentAnalysisConfig);
  notifyConfigChangeListeners();
  return getAnalysisConfig();
}

export function getResolvedConfigView(): BackendResolvedConfig {
  const sources: Record<string, ConfigSource> = { ...resolvedConfigState.sources };
  for (const key of Object.keys(currentAnalysisConfig) as (keyof AnalysisConfig)[]) {
    if (currentAnalysisConfig[key] !== defaultAnalysisConfig[key]) {
      sources[key] = "UiOverride";
    }
  }

  return {
    config: getAnalysisConfig(),
    sources,
  };
}

function notifyConfigChangeListeners(): void {
  const config = getAnalysisConfig();
  for (const listener of configChangeListeners) {
    listener(config);
  }
}
