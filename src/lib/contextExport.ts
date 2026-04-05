import { getMap, layerVisibility } from "../map";
import { getAnalysisConfig, defaultAnalysisConfig } from "../model/config";
import { getActiveScenarioId } from "./scenarioManager";
import { getSelectedOriginIndex, getBeachingClouds } from "../layers/drift_clouds";
import { listSavedPins } from "../model/pins";
import { getLatestModelExportState } from "../ui/panels/modelPanel";
import { getLatestInversionResult } from "../ui/sidebarInversion";
import { getInversionVisibilityState } from "../ui/sidebarInversion";
import { getStoredAnalystNotes } from "../model/session";
import { getEvidenceSelection, getSelectedAnomalyId } from "../ui/evidencePanel";
import { getCurrentPanel } from "../ui/flyoutShell";
import { getScenarioById } from "../model/scenarios";
import { getWorkspaceFreshness } from "./workspaceState";

export async function copyAnalysisContextForAi(): Promise<string> {
  const markdown = buildAnalysisContextMarkdown();
  await navigator.clipboard.writeText(markdown);
  return markdown;
}

export function buildAnalysisContextMarkdown(): string {
  const sections: string[] = ["## MH370 Analysis State"];

  const warnings = buildWarningsSection();
  if (warnings.length > 0) {
    sections.push(["### Warnings", ...warnings].join("\n"));
  }

  const notes = getStoredAnalystNotes().trim();
  if (notes) {
    sections.push(["### Analyst Notes", notes].join("\n"));
  }

  const configuration = buildConfigurationSection();
  if (configuration.length > 0) {
    sections.push(["### Configuration", ...configuration].join("\n"));
  }

  const modelResults = buildModelResultsSection();
  if (modelResults.length > 0) {
    sections.push(["### Model Results", ...modelResults].join("\n"));
  }

  const drift = buildDriftSection();
  if (drift.length > 0) {
    sections.push(["### Drift Simulation", ...drift].join("\n"));
  }

  const inversion = buildInversionSection();
  if (inversion.length > 0) {
    sections.push(["### Inversion", ...inversion].join("\n"));
  }

  const viewport = buildViewportSection();
  if (viewport.length > 0) {
    sections.push(["### Viewport", ...viewport].join("\n"));
  }

  const rawData = buildRawDataSection();
  if (rawData) {
    sections.push(["### Raw Data (JSON)", "```json", rawData, "```"].join("\n"));
  }

  return sections.join("\n\n");
}

function buildConfigurationSection(): string[] {
  const config = getAnalysisConfig();
  const overrides = (Object.keys(defaultAnalysisConfig) as Array<keyof typeof defaultAnalysisConfig>)
    .filter((key) => config[key] !== defaultAnalysisConfig[key]);

  return overrides.map((key) => `- ${formatConfigLabel(String(key))}: ${formatConfigValue(config[key])}`);
}

function buildModelResultsSection(): string[] {
  const model = getLatestModelExportState();
  if (!model.resultSummary && !model.runStatus?.error && !model.confidence) {
    return [];
  }

  const lines: string[] = [];
  if (model.confidence && model.confidence !== "—") {
    lines.push(`- Heatmap peak: ${model.confidence}`);
  }
  if (model.resultSummary?.bestFamily) {
    const score = model.resultSummary.bestScore != null ? ` (score: ${model.resultSummary.bestScore.toFixed(2)})` : "";
    lines.push(`- Best path family: ${model.resultSummary.bestFamily}${score}`);
  }
  if (model.resultSummary) {
    lines.push(`- Paths: ${model.resultSummary.pathCount}, Heatmap points: ${model.resultSummary.heatmapCount}`);
    if (model.resultSummary.bfoMeanAbsResidualHz != null) {
      lines.push(`- BFO mean residual: ${model.resultSummary.bfoMeanAbsResidualHz.toFixed(1)} Hz`);
    }
    if (model.resultSummary.searchedOverlapLabel) {
      lines.push(`- Search overlap: ${model.resultSummary.searchedOverlapLabel}`);
    }
    if (model.resultSummary.continuationLabel) {
      lines.push(`- Continuation: ${model.resultSummary.continuationLabel}`);
    }
  }
  const freshness = getWorkspaceFreshness().model;
  if (!freshness.hasResult) {
    lines.push("- Model state: not run yet");
  } else if (freshness.isStale) {
    lines.push("- Model state: stale relative to current configuration");
  }
  if (model.runStatus?.state === "failed" && model.runStatus.error) {
    lines.push(`- Last run failed: ${model.runStatus.error}`);
  }
  return lines;
}

function buildDriftSection(): string[] {
  const clouds = getBeachingClouds();
  if (clouds.length === 0) return [];

  const selectedIndex = getSelectedOriginIndex();
  const selectedCloud = selectedIndex != null ? clouds[selectedIndex] ?? null : null;
  const lines = [`- Candidate origins: ${clouds.length}`];
  const freshness = getWorkspaceFreshness().drift;
  if (freshness.isStale) {
    lines.push("- Drift state: stale relative to current configuration");
  }

  if (!selectedCloud) {
    lines.push("- Selected origin: none");
    return lines;
  }

  const coastBreakdown = summarizeCoasts(selectedCloud);
  lines.push(`- Selected origin: ${formatLat(selectedCloud.origin_lat)}, ${formatLon(selectedCloud.origin_lon)}`);
  if (coastBreakdown) {
    lines.push(`- Beaching: ${coastBreakdown}`);
  }
  lines.push(`- Fit: ${selectedCloud.fit_score.toFixed(0)}/100, Spatial: ${selectedCloud.spatial_score.toFixed(0)}/100, Timing: ${selectedCloud.timing_score.toFixed(0)}/100`);
  if (selectedCloud.matched_finds.length > 0) {
    lines.push(`- Matched debris: ${selectedCloud.matched_finds.join(", ")}`);
  }
  return lines;
}

function buildInversionSection(): string[] {
  const result = getLatestInversionResult();
  if (!result) return [];

  const freshness = getWorkspaceFreshness().inversion;
  const visibility = getInversionVisibilityState();
  const lines = [
    `- Debris peak: ${formatLat(result.peak_lat)}`,
    `- 68% CI: [${formatLat(result.confidence_interval_68[0])}, ${formatLat(result.confidence_interval_68[1])}]`,
    `- Intersection latitude: ${formatLat(result.intersection_lat)}`,
    `- Items used: ${result.items_used}`,
    `- Visibility: inversion ${visibility.visible ? "on" : "off"}, comparison ${visibility.comparisonVisible ? "on" : "off"}`,
  ];
  if (freshness.isStale) {
    lines.push("- Inversion state: stale relative to current configuration");
  }
  if (result.validation_message) {
    lines.push(`- Validation: ${result.validation_message}`);
  }
  return lines;
}

function buildViewportSection(): string[] {
  const map = getMap();
  const bounds = map.getBounds();
  if (!bounds) return [];
  const activeLayers = Object.keys(layerVisibility).filter((layerId) => layerVisibility[layerId]);
  const pins = listSavedPins();
  const lines = [
    `- Bounds: [${formatLat(bounds.getSouth())} to ${formatLat(bounds.getNorth())}, ${formatLon(bounds.getWest())} to ${formatLon(bounds.getEast())}]`,
    `- Active layers: ${activeLayers.join(", ") || "none"}`,
  ];

  const scenarioId = getActiveScenarioId();
  if (scenarioId) {
    const scenarioStatus = getScenarioWorkspaceStatus(scenarioId);
    lines.push(`- Scenario: ${scenarioId}${scenarioStatus.matchesPreset ? " (matches preset)" : " (workspace diverged from preset)"}`);
  }
  const panelId = getCurrentPanel();
  if (panelId) {
    lines.push(`- Open panel: ${panelId}`);
  }
  const evidenceSelection = getEvidenceSelection();
  if (evidenceSelection.kind === "anomaly") {
    lines.push(`- Selected anomaly: ${evidenceSelection.title ?? evidenceSelection.id}`);
  }
  if (evidenceSelection.kind === "info") {
    lines.push(`- Open guide: ${evidenceSelection.title ?? evidenceSelection.id}`);
  }
  if (pins.length > 0) {
    lines.push(`- Pins: ${pins.map((pin) => `"${pin.label}" at ${formatLat(pin.coordinates[1])}, ${formatLon(pin.coordinates[0])}`).join("; ")}`);
  }
  return lines;
}

function buildRawDataSection(): string {
  const model = getLatestModelExportState();
  const inversion = getLatestInversionResult();
  const selectedOriginIndex = getSelectedOriginIndex();
  const clouds = getBeachingClouds();
  const selectedCloud = selectedOriginIndex != null ? clouds[selectedOriginIndex] ?? null : null;

  const payload = {
    scenarioId: getActiveScenarioId(),
    analystNotes: getStoredAnalystNotes(),
    configOverrides: getNonDefaultConfigObject(),
    model: model.resultSummary,
    runStatus: model.runStatus,
    familySummary: model.familySummary,
    drift: selectedCloud
      ? {
          selectedOriginIndex,
          originLat: selectedCloud.origin_lat,
          originLon: selectedCloud.origin_lon,
          beachingFraction: selectedCloud.beaching_fraction,
          fitScore: selectedCloud.fit_score,
          spatialScore: selectedCloud.spatial_score,
          timingScore: selectedCloud.timing_score,
          matchedFinds: selectedCloud.matched_finds,
        }
      : { candidateOriginCount: clouds.length },
    inversion: inversion
      ? {
          peakLat: inversion.peak_lat,
          peakLon: inversion.peak_lon,
          confidenceInterval68: inversion.confidence_interval_68,
          confidenceInterval95: inversion.confidence_interval_95,
          intersectionLat: inversion.intersection_lat,
          itemsUsed: inversion.items_used,
          topItemContributions: inversion.item_contributions.slice(0, 8),
          topCandidates: inversion.candidates.slice(0, 8),
          visibility: getInversionVisibilityState(),
        }
      : null,
    freshness: getWorkspaceFreshness(),
    viewport: {
      activeLayers: Object.keys(layerVisibility).filter((layerId) => layerVisibility[layerId]),
      pins: listSavedPins(),
      currentPanel: getCurrentPanel(),
      evidenceSelection: getEvidenceSelection(),
      selectedAnomalyId: getSelectedAnomalyId(),
    },
  };

  return JSON.stringify(payload, null, 2);
}

function getNonDefaultConfigObject(): Partial<ReturnType<typeof getAnalysisConfig>> {
  const config = getAnalysisConfig();
  return Object.fromEntries(
    (Object.keys(defaultAnalysisConfig) as Array<keyof typeof defaultAnalysisConfig>)
      .filter((key) => config[key] !== defaultAnalysisConfig[key])
      .map((key) => [key, config[key]]),
  );
}

function summarizeCoasts(cloud: ReturnType<typeof getBeachingClouds>[number]): string {
  const counts = new Map<string, number>();
  for (const particle of cloud.beached) {
    counts.set(particle.coast, (counts.get(particle.coast) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([coast, count]) => `${count} ${coast}`)
    .join(", ");
}

function formatConfigLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\bdeg\b/g, "deg")
    .replace(/\bkts\b/g, "kts")
    .replace(/\bkg\b/g, "kg")
    .replace(/\butc\b/g, "UTC")
    .replace(/\bft\b/g, "ft")
    .replace(/\bsigma\b/g, "sigma")
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function formatConfigValue(value: unknown): string {
  return typeof value === "number" ? String(Number(value.toFixed(3))) : String(value);
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
}

function buildWarningsSection(): string[] {
  const warnings: string[] = [];
  const scenarioId = getActiveScenarioId();
  const freshness = getWorkspaceFreshness();
  const result = getLatestModelExportState().resultSummary;
  const inversion = getLatestInversionResult();
  const inversionVisibility = getInversionVisibilityState();
  const clouds = getBeachingClouds();
  const selectedOriginIndex = getSelectedOriginIndex();

  if (scenarioId) {
    const scenarioStatus = getScenarioWorkspaceStatus(scenarioId);
    if (!scenarioStatus.matchesPreset) {
      warnings.push(`- Current workspace differs from the selected scenario preset (${scenarioId}).`);
    }
  }

  if (layerVisibility["drift-clouds"] && clouds.length === 0) {
    warnings.push("- Drift clouds layer is enabled, but no drift simulation results are loaded.");
  }
  if (clouds.length > 0 && !layerVisibility["drift-clouds"]) {
    warnings.push("- Drift simulation results are loaded, but the drift-clouds layer is currently hidden.");
  }
  if (clouds.length > 0 && selectedOriginIndex == null) {
    warnings.push("- Drift simulation results are loaded, but no drift origin is currently selected.");
  }
  if (freshness.model.hasResult && !layerVisibility.paths && !layerVisibility.heatmap) {
    warnings.push("- Model results are loaded, but both paths and heatmap layers are currently hidden.");
  }
  if (inversion && !inversionVisibility.visible && !inversionVisibility.comparisonVisible) {
    warnings.push("- Inversion results are loaded, but inversion overlays are currently hidden.");
  }

  if (freshness.model.isStale) {
    warnings.push("- Model results are stale relative to the current configuration.");
  }
  if (freshness.drift.isStale) {
    warnings.push("- Drift results are stale relative to the current configuration.");
  }
  if (freshness.inversion.isStale) {
    warnings.push("- Inversion results are stale relative to the current configuration.");
  }
  if (result?.bfoMeanAbsResidualHz != null && result.bfoMeanAbsResidualHz > 50) {
    warnings.push(`- BFO residual is very high (${result.bfoMeanAbsResidualHz.toFixed(1)} Hz), so the current best path fit is weak.`);
  }

  return warnings;
}

function getScenarioWorkspaceStatus(scenarioId: string): { matchesPreset: boolean } {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) {
    return { matchesPreset: false };
  }

  const config = getAnalysisConfig();
  const configMismatch = Object.entries(scenario.configOverrides).some(([key, value]) => config[key as keyof typeof config] !== value);
  const layerMismatch = Object.entries(scenario.layerVisibility).some(([key, value]) => layerVisibility[key] !== value);
  return {
    matchesPreset: !configMismatch && !layerMismatch,
  };
}
