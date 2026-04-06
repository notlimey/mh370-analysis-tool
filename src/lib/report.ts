import type { AnalysisConfig } from "../model/config";
import type { SavedRun } from "../model/runs";
import { listConfigDiffs } from "../model/runs";

export interface ReportSummary {
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

export function generateRunReport(label: string, config: AnalysisConfig, summary: ReportSummary, notes = ""): string {
  const nonDefaultLines = Object.entries(config).map(([key, value]) => `${key} = ${String(value)}`);

  return [
    `# ${label}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    notes ? `Notes: ${notes}` : undefined,
    "",
    "## Summary",
    summary.scenarioLabel ? `Scenario: ${summary.scenarioLabel}` : undefined,
    `Best family: ${summary.bestFamily ?? "No viable path"}`,
    `Best score: ${summary.bestScore?.toFixed(3) ?? "--"}`,
    `Peak probability: ${formatPeak(summary.peakLat, summary.peakLon)}`,
    `Path count: ${summary.pathCount}`,
    `Heatmap points: ${summary.heatmapCount}`,
    summary.fuelFeasibleCount != null
      ? `Fuel-feasible paths: ${summary.fuelFeasibleCount}${summary.fuelFeasiblePercent != null ? ` (${summary.fuelFeasiblePercent.toFixed(0)}%)` : ""}`
      : undefined,
    `BFO mean residual: ${summary.bfoMeanAbsResidualHz?.toFixed(1) ?? "--"} Hz`,
    `Searched overlap: ${summary.searchedOverlapLabel ?? "--"}`,
    `Continuation share: ${summary.continuationLabel ?? "--"}`,
    "",
    "## Config",
    ...nonDefaultLines,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generateComparisonReport(left: SavedRun | null, right: SavedRun | null): string {
  if (!left || !right) {
    return "Select two saved runs to compare.";
  }

  const configDiffs = listConfigDiffs(left.config, right.config).map(
    (diff) => `${String(diff.key)}: ${diff.left} -> ${diff.right}`,
  );
  const resultDiffs = [
    diffLine("scenarioLabel", left.summary.scenarioLabel, right.summary.scenarioLabel),
    diffLine("bestFamily", left.summary.bestFamily, right.summary.bestFamily),
    diffLine("bestScore", left.summary.bestScore, right.summary.bestScore),
    diffLine(
      "peak",
      formatPeak(left.summary.peakLat, left.summary.peakLon),
      formatPeak(right.summary.peakLat, right.summary.peakLon),
    ),
    diffLine("pathCount", left.summary.pathCount, right.summary.pathCount),
    diffLine("fuelFeasibleCount", left.summary.fuelFeasibleCount, right.summary.fuelFeasibleCount),
    diffLine("fuelFeasiblePercent", left.summary.fuelFeasiblePercent, right.summary.fuelFeasiblePercent),
    diffLine("bfoMeanAbsResidualHz", left.summary.bfoMeanAbsResidualHz, right.summary.bfoMeanAbsResidualHz),
    diffLine("searchedOverlap", left.summary.searchedOverlapLabel, right.summary.searchedOverlapLabel),
    diffLine("continuation", left.summary.continuationLabel, right.summary.continuationLabel),
  ].filter((line): line is string => Boolean(line));

  return [
    `# Compare ${left.id} vs ${right.id}`,
    "",
    "## Summary",
    `Left best family: ${left.summary.bestFamily ?? "No viable path"}`,
    `Right best family: ${right.summary.bestFamily ?? "No viable path"}`,
    `Left peak: ${formatPeak(left.summary.peakLat, left.summary.peakLon)}`,
    `Right peak: ${formatPeak(right.summary.peakLat, right.summary.peakLon)}`,
    "",
    "## Result Diffs",
    ...(resultDiffs.length > 0 ? resultDiffs : ["No result diffs"]),
    "",
    "## Config Diffs",
    ...(configDiffs.length > 0 ? configDiffs : ["No config diffs"]),
  ].join("\n");
}

function diffLine(label: string, left: unknown, right: unknown): string | null {
  if (left === right) return null;
  return `${label}: ${String(left ?? "--")} -> ${String(right ?? "--")}`;
}

function formatPeak(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "--";
  return `~${lat.toFixed(1)}S, ${lon.toFixed(1)}E`;
}
