import { getBeachingClouds, getSelectedOriginIndex } from "../layers/drift-clouds";
import { listSavedPins } from "../model/pins";
import { getScenarioById } from "../model/scenarios";
import { getStoredAnalystNotes } from "../model/session";
import { defaultConfig, getConfigSnapshot } from "../stores/analysis-config";
import { evidenceSelection } from "../stores/evidence";
import { getInversionVisibilityState, inversionResult } from "../stores/inversion";
import { layerVisibility } from "../stores/layer-visibility";
import { modelRunState } from "../stores/model-run";
import { activeScenarioId } from "../stores/scenario";
import { activePanel } from "../stores/ui";
import { getWorkspaceFreshness } from "./workspaceState";

let mapInstance: mapboxgl.Map | null = null;

export function setContextExportMap(map: mapboxgl.Map): void {
  mapInstance = map;
}

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
  const config = getConfigSnapshot();
  const overrides = (Object.keys(defaultConfig) as Array<keyof typeof defaultConfig>).filter(
    (key) => config[key] !== defaultConfig[key],
  );
  return overrides.map((key) => `- ${formatConfigLabel(String(key))}: ${formatConfigValue(config[key])}`);
}

function buildModelResultsSection(): string[] {
  const state = modelRunState;
  if (!state.resultSummary && state.runStatus.state !== "failed" && state.summary.confidence === "\u2014") {
    return [];
  }

  const lines: string[] = [];
  if (state.summary.confidence && state.summary.confidence !== "\u2014") {
    lines.push(`- Heatmap peak: ${state.summary.confidence}`);
  }
  if (state.resultSummary?.bestFamily) {
    const score = state.resultSummary.bestScore != null ? ` (score: ${state.resultSummary.bestScore.toFixed(2)})` : "";
    lines.push(`- Best path family: ${state.resultSummary.bestFamily}${score}`);
  }
  if (state.resultSummary) {
    lines.push(`- Paths: ${state.resultSummary.pathCount}, Heatmap points: ${state.resultSummary.heatmapCount}`);
    if (state.resultSummary.bfoMeanAbsResidualHz != null) {
      lines.push(`- BFO mean residual: ${state.resultSummary.bfoMeanAbsResidualHz.toFixed(1)} Hz`);
    }
    if (state.resultSummary.searchedOverlapLabel) {
      lines.push(`- Search overlap: ${state.resultSummary.searchedOverlapLabel}`);
    }
    if (state.resultSummary.continuationLabel) {
      lines.push(`- Continuation: ${state.resultSummary.continuationLabel}`);
    }
  }
  const freshness = getWorkspaceFreshness().model;
  if (!freshness.hasResult) {
    lines.push("- Model state: not run yet");
  } else if (freshness.isStale) {
    lines.push("- Model state: stale relative to current configuration");
  }
  if (state.runStatus.state === "failed" && state.runStatus.error) {
    lines.push(`- Last run failed: ${state.runStatus.error}`);
  }
  return lines;
}

function buildDriftSection(): string[] {
  const clouds = getBeachingClouds();
  if (clouds.length === 0) return [];

  const selectedIndex = getSelectedOriginIndex();
  const selectedCloud = selectedIndex != null ? (clouds[selectedIndex] ?? null) : null;
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
  lines.push(
    `- Fit: ${selectedCloud.fit_score.toFixed(0)}/100, Spatial: ${selectedCloud.spatial_score.toFixed(0)}/100, Timing: ${selectedCloud.timing_score.toFixed(0)}/100`,
  );
  if (selectedCloud.matched_finds.length > 0) {
    lines.push(`- Matched debris: ${selectedCloud.matched_finds.join(", ")}`);
  }
  return lines;
}

function buildInversionSection(): string[] {
  const result = inversionResult();
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
  if (!mapInstance) return [];
  const map = mapInstance;
  const bounds = map.getBounds();
  if (!bounds) return [];
  const activeLayers = Object.keys(layerVisibility).filter((id) => layerVisibility[id]);
  const pins = listSavedPins();
  const lines = [
    `- Bounds: [${formatLat(bounds.getSouth())} to ${formatLat(bounds.getNorth())}, ${formatLon(bounds.getWest())} to ${formatLon(bounds.getEast())}]`,
    `- Active layers: ${activeLayers.join(", ") || "none"}`,
  ];

  const scenarioId = activeScenarioId();
  if (scenarioId) {
    const scenarioStatus = getScenarioWorkspaceStatus(scenarioId);
    lines.push(
      `- Scenario: ${scenarioId}${scenarioStatus.matchesPreset ? " (matches preset)" : " (workspace diverged from preset)"}`,
    );
  }
  const panelId = activePanel();
  if (panelId) {
    lines.push(`- Open panel: ${panelId}`);
  }
  const es = evidenceSelection();
  if (es.kind === "anomaly") {
    lines.push(`- Selected anomaly: ${es.title ?? es.id}`);
  }
  if (es.kind === "info") {
    lines.push(`- Open guide: ${es.title ?? es.id}`);
  }
  if (pins.length > 0) {
    lines.push(
      `- Pins: ${pins.map((pin) => `"${pin.label}" at ${formatLat(pin.coordinates[1])}, ${formatLon(pin.coordinates[0])}`).join("; ")}`,
    );
  }
  return lines;
}

function buildRawDataSection(): string {
  const result = inversionResult();
  const selectedOriginIndex = getSelectedOriginIndex();
  const clouds = getBeachingClouds();
  const selectedCloud = selectedOriginIndex != null ? (clouds[selectedOriginIndex] ?? null) : null;

  const payload = {
    scenarioId: activeScenarioId(),
    analystNotes: getStoredAnalystNotes(),
    configOverrides: getNonDefaultConfigObject(),
    model: modelRunState.resultSummary,
    runStatus: modelRunState.runStatus,
    familySummary: modelRunState.familySummary,
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
    inversion: result
      ? {
          peakLat: result.peak_lat,
          peakLon: result.peak_lon,
          confidenceInterval68: result.confidence_interval_68,
          confidenceInterval95: result.confidence_interval_95,
          intersectionLat: result.intersection_lat,
          itemsUsed: result.items_used,
          topItemContributions: result.item_contributions.slice(0, 8),
          topCandidates: result.candidates.slice(0, 8),
          visibility: getInversionVisibilityState(),
        }
      : null,
    freshness: getWorkspaceFreshness(),
    viewport: {
      activeLayers: Object.keys(layerVisibility).filter((id) => layerVisibility[id]),
      pins: listSavedPins(),
      currentPanel: activePanel(),
      evidenceSelection: evidenceSelection(),
      selectedAnomalyId: evidenceSelection().kind === "anomaly" ? evidenceSelection().id : null,
    },
  };

  return JSON.stringify(payload, null, 2);
}

function getNonDefaultConfigObject(): Partial<Record<string, unknown>> {
  const config = getConfigSnapshot();
  return Object.fromEntries(
    (Object.keys(defaultConfig) as Array<keyof typeof defaultConfig>)
      .filter((key) => config[key] !== defaultConfig[key])
      .map((key) => [key, config[key]]),
  );
}

function summarizeCoasts(cloud: ReturnType<typeof getBeachingClouds>[number]): string {
  const counts = new Map<string, number>();
  for (const particle of cloud.beached) {
    counts.set(particle.coast, (counts.get(particle.coast) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
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
  return `${Math.abs(lat).toFixed(1)}\u00b0${lat < 0 ? "S" : "N"}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(1)}\u00b0${lon < 0 ? "W" : "E"}`;
}

function buildWarningsSection(): string[] {
  const warnings: string[] = [];
  const scenarioId = activeScenarioId();
  const freshness = getWorkspaceFreshness();
  const result = modelRunState.resultSummary;
  const invResult = inversionResult();
  const invVis = getInversionVisibilityState();
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
  if (invResult && !invVis.visible && !invVis.comparisonVisible) {
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
    warnings.push(
      `- BFO residual is very high (${result.bfoMeanAbsResidualHz.toFixed(1)} Hz), so the current best path fit is weak.`,
    );
  }
  return warnings;
}

function getScenarioWorkspaceStatus(scenarioId: string): { matchesPreset: boolean } {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) return { matchesPreset: false };
  const config = getConfigSnapshot();
  const configMismatch = Object.entries(scenario.configOverrides).some(
    ([key, value]) => config[key as keyof typeof config] !== value,
  );
  const layerMismatch = Object.entries(scenario.layerVisibility).some(([key, value]) => layerVisibility[key] !== value);
  return { matchesPreset: !configMismatch && !layerMismatch };
}
