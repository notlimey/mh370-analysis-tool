import type { AnalysisConfig } from "./config";

export interface SavedRunSummary {
  bestFamily?: string;
  bestScore?: number;
  peakLat?: number;
  peakLon?: number;
  pathCount: number;
  heatmapCount: number;
}

export interface SavedRun {
  id: string;
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
    return Array.isArray(parsed)
      ? parsed.sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      : [];
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
