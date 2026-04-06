import { createStore } from "solid-js/store";
import type { BackendResolvedConfig, ConfigSource } from "../lib/backend";
import { getResolvedConfig } from "../lib/backend";
import type { AnalysisConfig } from "../model/config";
import { getStoredAnalysisConfig, setStoredAnalysisConfig } from "../model/session";

const [analysisConfig, setAnalysisConfig] = createStore<AnalysisConfig>({} as AnalysisConfig);
const [defaultConfig, setDefaultConfig] = createStore<AnalysisConfig>({} as AnalysisConfig);
const [resolvedSources, setResolvedSources] = createStore<Record<string, ConfigSource>>({});

export { analysisConfig, defaultConfig };

export async function initAnalysisConfig(): Promise<AnalysisConfig> {
  const resolved = await getResolvedConfig();
  const stored = getStoredAnalysisConfig();
  setResolvedSources(resolved.sources);
  setDefaultConfig(resolved.config);
  const merged = { ...resolved.config, ...stored };
  setAnalysisConfig(merged);
  setStoredAnalysisConfig(merged as AnalysisConfig);
  return { ...merged } as AnalysisConfig;
}

export function updateConfig(patch: Partial<AnalysisConfig>): void {
  setAnalysisConfig(patch);
  const snapshot = { ...analysisConfig } as AnalysisConfig;
  setStoredAnalysisConfig(snapshot);
}

export function resetConfig(): void {
  const defaults = { ...defaultConfig } as AnalysisConfig;
  setAnalysisConfig(defaults);
  setStoredAnalysisConfig(defaults);
}

export function getConfigSnapshot(): AnalysisConfig {
  return { ...analysisConfig } as AnalysisConfig;
}

export function getResolvedConfigView(): BackendResolvedConfig {
  const sources: Record<string, ConfigSource> = { ...resolvedSources };
  for (const key of Object.keys(analysisConfig) as (keyof AnalysisConfig)[]) {
    if (analysisConfig[key] !== defaultConfig[key]) {
      sources[key] = "UiOverride";
    }
  }
  return { config: getConfigSnapshot(), sources };
}
