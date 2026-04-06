import type { AnalysisConfig } from "./config";

export interface SavedRunSummary {
  scenarioLabel?: string;
  bestFamily?: string;
  bestScore?: number;
  peakLat?: number;
  peakLon?: number;
  pathCount: number;
  heatmapCount: number;
  fuelFeasibleCount?: number;
  fuelFeasiblePercent?: number;
  searchedOverlapLabel?: string;
  continuationLabel?: string;
  bfoMeanAbsResidualHz?: number;
}

export interface SavedRun {
  id: string;
  scenarioId?: string;
  label?: string;
  timestamp: string;
  config: AnalysisConfig;
  summary: SavedRunSummary;
  notes: string;
}

const STORAGE_KEY = "mh370.savedRuns";

export function listSavedRuns(): SavedRun[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SavedRun[];
    return Array.isArray(parsed) ? parsed.sort((left, right) => right.timestamp.localeCompare(left.timestamp)) : [];
  } catch {
    return [];
  }
}

export function saveRun(run: SavedRun): void {
  const runs = listSavedRuns().filter((existing) => existing.id !== run.id);
  runs.unshift(run);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, 20)));
}

export function getSavedRun(id: string): SavedRun | undefined {
  return listSavedRuns().find((run) => run.id === id);
}

export function listConfigDiffs(
  left: AnalysisConfig,
  right: AnalysisConfig,
): Array<{
  key: keyof AnalysisConfig;
  left: string;
  right: string;
}> {
  return (Object.keys(left) as (keyof AnalysisConfig)[])
    .filter((key) => left[key] !== right[key])
    .map((key) => ({
      key,
      left: String(left[key]),
      right: String(right[key]),
    }));
}
