import "./style.css";
import { applyLayerVisibility, initMap } from "./map";
import { highlightArc, loadArcsLayer } from "./layers/arcs";
import { loadAnomaliesLayer } from "./layers/anomalies";
import { loadAirspacesLayer } from "./layers/airspaces";
import { loadHolidaysLayer } from "./layers/holidays";
import { loadMagneticLayer } from "./layers/magnetic";
import { loadSonarLayers } from "./layers/sonar";
import { annotatePaths, fetchCandidatePaths, loadPathsLayer, type FlightPath, type PathAnnotation } from "./layers/paths";
import { loadPriorityGapsLayer } from "./layers/priority";
import { loadHeatmapLayer } from "./layers/heatmap";
import { hasEofComparisonOverlays, loadEofComparisonOverlay } from "./layers/eofComparison";
import { loadDebrisLayer } from "./layers/debris";
import { loadPointsLayer } from "./layers/points";
import { loadPinsLayer } from "./layers/pins";
import { loadFlightPathLayer } from "./layers/flightpath";
import { initDriftCloudsLayer, onDriftOriginStateChange } from "./layers/drift_clouds";
import { initIconRail, setActivePanel } from "./ui/iconRail";
import { registerPanel, openFlyout, closeFlyout, setOnClose } from "./ui/flyoutShell";
import { createModelPanel, setModelCallbacks, updateConfidence, updateModelSummary, updateModelResultsSummary, updateModelRunStatus, renderFamilyLegend } from "./ui/panels/modelPanel";
import { createLayersPanel } from "./ui/panels/layersPanel";
import { createDriftPanel } from "./ui/panels/driftPanel";
import { createEvidenceBrowsePanel } from "./ui/panels/evidenceBrowsePanel";
import { createExportPanel } from "./ui/panels/exportPanel";
import { createSensitivityPanel } from "./ui/panels/sensitivityPanel";
import { getSelectedAnomalyId, initEvidencePanel, onEvidenceSelectionChange, openAnomalyDetail } from "./ui/evidencePanel";
import { initTimeline } from "./ui/timeline";
import { setupPopups } from "./popups";
import type { Map as MapboxMap } from "mapbox-gl";
import { getProbabilityHeatmap, IS_TAURI, type BackendProbPoint } from "./lib/backend";
import { setSelectedAnomaly } from "./layers/anomalies";
import { getAnalysisConfig, initConfig } from "./model/config";
import { onAnalysisConfigChange } from "./model/config";
import { SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "./constants";
import { applyUrlStateFromHash, scheduleUrlStateSync } from "./lib/urlState";
import { onLayerVisibilityChange } from "./map";
import { onActiveScenarioChange } from "./lib/scenarioManager";
import { markModelRunCompleted, markWorkspaceInputsChanged } from "./lib/workspaceState";
import { showModelConfigModal } from "./ui/modelConfigModal";
import {
  downloadSessionSnapshot,
  persistSessionSnapshot,
  restoreStoredSessionSnapshot,
  scheduleAutoSaveSessionSnapshot,
} from "./lib/sessionSnapshot";
import { copyAnalysisContextForAi } from "./lib/contextExport";

interface LayerLoadSummary {
  pathCount: number;
  heatmapCount: number;
  bestFamily?: string;
  bfoDiagnosticCount: number;
  bfoAvailable: boolean;
}

interface FamilySummary {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily: Record<string, string[]>;
  endpointNarrative?: string;
}

function formatLatLon(lat: number, lon: number, digits = 1): string {
  const latHemisphere = lat < 0 ? "S" : "N";
  const lonHemisphere = lon < 0 ? "W" : "E";
  return `~${Math.abs(lat).toFixed(digits)}${latHemisphere}, ${Math.abs(lon).toFixed(digits)}${lonHemisphere}`;
}

function createLoader(): HTMLElement {
  const el = document.createElement("div");
  el.id = "loader";
  el.className = "loader-overlay";
  el.innerHTML = '<div class="loader-content"><div class="loader-spinner"></div><span class="loader-text">Loading analysis data</span></div>';
  document.getElementById("app")!.appendChild(el);
  return el;
}

function setLoaderText(text: string): void {
  const el = document.querySelector<HTMLElement>("#loader .loader-text");
  if (el) el.textContent = text;
}

const LAYER_PREFIXES = [
  "arcs-",
  "anomalies-",
  "airspaces-",
  "magnetic-",
  "sonar-",
  "holidays-",
  "paths-",
  "heatmap-",
  "priority-",
  "debris-",
  "points-",
  "pins-",
  "searched-",
  "eof-compare-",
  "flightpath-",
  "drift-clouds-",
];

/** Remove all app layers and sources from the map */
function removeAllLayers(map: MapboxMap): void {
  const style = map.getStyle();
  if (!style) return;

  // Remove layers first (they reference sources)
  for (const layer of [...(style.layers || [])].reverse()) {
    if (LAYER_PREFIXES.some((p) => layer.id.startsWith(p))) {
      try { map.removeLayer(layer.id); } catch { /* already removed */ }
    }
  }

  // Then remove sources
  for (const sourceId of Object.keys(style.sources || {})) {
    if (LAYER_PREFIXES.some((p) => sourceId.startsWith(p))) {
      try { map.removeSource(sourceId); } catch { /* already removed */ }
    }
  }
}

/**
 * Load all layers in z-order (bottom to top):
 * searched areas → heatmap → arcs → candidate paths → debris → flight path → key points
 */

async function loadAllLayers(map: MapboxMap): Promise<LayerLoadSummary> {
  // Static layers first (no async)
  loadPointsLayer(map);
  loadPinsLayer(map);
  const config = getAnalysisConfig();

  const [heatmap, paths] = await Promise.all([
    getProbabilityHeatmap(config),
    fetchCandidatePaths(120, config),
  ]) as [BackendProbPoint[], FlightPath[]];
  const pathAnnotations = await annotatePaths(paths);

  // Async data layers
  await loadMagneticLayer(map);
  await loadAirspacesLayer(map);
  loadHolidaysLayer(map);
  await loadAnomaliesLayer(map, (id) => {
    setSelectedAnomaly(map, id);
    openAnomalyDetail(id);
  });
  await loadArcsLayer(map);
  loadSonarLayers(map);
  await loadPathsLayer(map, paths, pathAnnotations);
  await loadHeatmapLayer(map, heatmap);
  if (hasEofComparisonOverlays()) {
    loadEofComparisonOverlay(map);
  }
  loadPriorityGapsLayer(map, heatmap);
  await loadDebrisLayer(map);
  initDriftCloudsLayer(map);

  const selectedAnomalyId = getSelectedAnomalyId();
  if (selectedAnomalyId) {
    setSelectedAnomaly(map, selectedAnomalyId);
  }

  // Flight path on top so the trace is clearly visible
  loadFlightPathLayer(map);

  // Re-apply visibility state — layers are added with default visibility,
  // so if a scenario set some groups to hidden before the reload, enforce it now.
  applyLayerVisibility();

  // Update confidence display
  if (heatmap.length > 0) {
    const maxProb = Math.max(...heatmap.map((p) => p.probability));
    const maxPoint = heatmap.find((p) => p.probability === maxProb);
    if (maxPoint) {
      updateConfidence(formatLatLon(maxPoint.position[1], maxPoint.position[0]));
    }
  }

  const bestPath = paths[0];
  const bestEndpoint = bestPath?.points[bestPath.points.length - 1];
  const summary = summarizeFamilies(pathAnnotations);
  const peakPoint = heatmap
    .slice()
    .sort((left, right) => right.probability - left.probability)[0];
  const fuelFeasibleCount = paths.filter((path) => path.fuel_feasible).length;
  const overlapSummary = summarizeEndpointOverlap(paths);
  const continuationSummary = summarizeContinuationContribution(paths);
  renderFamilyLegend(summary);
  updateModelResultsSummary({
    bestFamily: bestPath?.family,
    bestScore: bestPath?.score,
    endpointCounts: summary.counts,
    fuelFeasibleCount,
    fuelFeasiblePercent: paths.length > 0 ? (fuelFeasibleCount / paths.length) * 100 : undefined,
    bfoMeanAbsResidualHz: bestPath?.bfo_summary?.mean_abs_residual_hz,
    bestEndpointLat: bestEndpoint?.[1],
    bestEndpointLon: bestEndpoint?.[0],
    peakLat: peakPoint?.position[1],
    peakLon: peakPoint?.position[0],
    searchedOverlapLabel: overlapSummary,
    continuationLabel: continuationSummary,
    pathCount: paths.length,
    heatmapCount: heatmap.length,
  });
  if (bestPath) {
    updateModelSummary({
      family: bestPath.family,
      fuel: bestPath.fuel_remaining_at_arc7_kg !== undefined
        ? `${Math.round(bestPath.fuel_remaining_at_arc7_kg)} kg @ arc 7`
        : undefined,
      familySpreadKm: summary.familySpreadKm,
      bfoSummary: bestPath.bfo_summary,
      bfoDiagnostics: bestPath.bfo_diagnostics,
    });
  } else {
    updateModelSummary({ noPaths: true });
  }

  return {
    pathCount: paths.length,
    heatmapCount: heatmap.length,
    bestFamily: bestPath?.family,
    bfoDiagnosticCount: bestPath?.bfo_diagnostics?.length ?? 0,
    bfoAvailable: Boolean(bestPath?.bfo_summary),
  };
}

function summarizeFamilies(pathAnnotations: PathAnnotation[]): FamilySummary {
  const paths = pathAnnotations.map(({ path }) => path);
  const counts: Record<string, number> = {};
  const firsByFamily: Record<string, Set<string>> = {};
  const endpointsByFamily: Record<string, [number, number][]> = {};
  for (const { path, firs } of pathAnnotations) {
    counts[path.family] = (counts[path.family] ?? 0) + 1;
    if (!firsByFamily[path.family]) {
      firsByFamily[path.family] = new Set<string>();
    }
    if (!endpointsByFamily[path.family]) {
      endpointsByFamily[path.family] = [];
    }
    for (const fir of firs) {
      firsByFamily[path.family].add(fir);
    }
    const endpoint = path.points[path.points.length - 1];
    if (endpoint) {
      endpointsByFamily[path.family].push(endpoint);
    }
  }

  const slow = paths.find((path) => path.family === "slow");
  const perpendicular = paths.find((path) => path.family === "perpendicular");
  const familySpreadKm = slow && perpendicular
    ? haversineKm(slow.points[slow.points.length - 1], perpendicular.points[perpendicular.points.length - 1])
    : undefined;

  const endpointNarrative = describeEndpointShape(counts, endpointsByFamily);

  return {
    counts,
    familySpreadKm,
    firsByFamily: Object.fromEntries(
      Object.entries(firsByFamily).map(([family, firs]) => [family, Array.from(firs).sort()]),
    ),
    endpointNarrative,
  };
}

function describeEndpointShape(
  counts: Record<string, number>,
  endpointsByFamily: Record<string, [number, number][]>,
): string | undefined {
  const rankedFamilies = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  if (rankedFamilies.length === 0) return undefined;

  const dominantFamily = rankedFamilies[0][0];
  const dominantCentroid = centroid(endpointsByFamily[dominantFamily] ?? []);
  if (!dominantCentroid) return undefined;

  let northeastTail:
    | { family: string; distanceKm: number; eastKm: number; northKm: number }
    | undefined;
  for (const [family] of rankedFamilies.slice(1)) {
    const familyCentroid = centroid(endpointsByFamily[family] ?? []);
    if (!familyCentroid) continue;
    const eastKm = longitudinalKm(dominantCentroid, familyCentroid);
    const northKm = latitudinalKm(dominantCentroid, familyCentroid);
    if (eastKm <= 0 || northKm <= 0) continue;
    const distanceKm = Math.hypot(eastKm, northKm);
    if (!northeastTail || distanceKm > northeastTail.distanceKm) {
      northeastTail = { family, distanceKm, eastKm, northKm };
    }
  }

  if (northeastTail && northeastTail.distanceKm >= 15) {
    return `${capitalize(northeastTail.family)} endpoints form the visible northeast tail, centered about ${Math.round(northeastTail.distanceKm)} km from the main ${dominantFamily} cluster.`;
  }

  return `${capitalize(dominantFamily)} endpoints dominate this run, so the visible stretch is mostly spread within one family rather than a separate branch.`;
}

function centroid(points: [number, number][]): [number, number] | undefined {
  if (points.length === 0) return undefined;
  const sums = points.reduce<[number, number]>(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  return [sums[0] / points.length, sums[1] / points.length];
}

function longitudinalKm(from: [number, number], to: [number, number]): number {
  const averageLatRad = ((from[1] + to[1]) / 2) * Math.PI / 180;
  return (to[0] - from[0]) * 111.32 * Math.cos(averageLatRad);
}

function latitudinalKm(from: [number, number], to: [number, number]): number {
  return (to[1] - from[1]) * 111.32;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function summarizeEndpointOverlap(paths: FlightPath[]): string {
  const searchPolygons = [SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026];
  const endpoints = paths
    .filter((path) => path.fuel_feasible)
    .map((path) => path.points[path.points.length - 1])
    .filter((point): point is [number, number] => Array.isArray(point));

  if (endpoints.length === 0) {
    return "No fuel-feasible endpoints";
  }

  const insideCount = endpoints.filter((point) => searchPolygons.some((polygon) => pointInPolygon(point, polygon))).length;
  return `${insideCount}/${endpoints.length} fuel-feasible endpoints in searched area (${Math.round((insideCount / endpoints.length) * 100)}%)`;
}

function summarizeContinuationContribution(paths: FlightPath[]): string {
  const endpoints = paths.filter((path) => Array.isArray(path.points[path.points.length - 1]));
  if (endpoints.length === 0) {
    return "No visible endpoints";
  }

  const continuationCount = endpoints.filter((path) => (path.extra_endurance_minutes ?? 0) > 0 || (path.extra_range_nm ?? 0) > 0).length;
  const constrainedCount = endpoints.length - continuationCount;
  return `${continuationCount}/${endpoints.length} visible endpoints include post-Arc-7 continuation (${Math.round((continuationCount / endpoints.length) * 100)}%); ${constrainedCount} remain handshake-constrained.`;
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

async function main(): Promise<void> {
  if (!IS_TAURI) {
    document.body.classList.add("browser-mode");
    const banner = document.createElement("div");
    banner.className = "browser-banner";
    banner.innerHTML = 'Read-only snapshot — download the desktop app to adjust model parameters and recompute <a href="https://github.com/notlimey/mh370-analysis-tool" target="_blank" rel="noreferrer">GitHub repo</a>';
    document.body.appendChild(banner);
  }

  await initConfig();

  const map = initMap();
  applyUrlStateFromHash();

  onLayerVisibilityChange(() => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });
  onAnalysisConfigChange((config) => {
    scheduleUrlStateSync();
    markWorkspaceInputsChanged(config);
    scheduleAutoSaveSessionSnapshot();
  });
  onActiveScenarioChange(() => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });
  onDriftOriginStateChange(() => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });
  map.on("moveend", () => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });
  map.on("rotateend", () => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });
  map.on("pitchend", () => {
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });

  await initEvidencePanel({
    onSelectAnomaly: (id) => {
      setSelectedAnomaly(map, id);
      if (id) {
        openAnomalyDetail(id);
      }
    },
  });

  onEvidenceSelectionChange(() => {
    scheduleAutoSaveSessionSnapshot();
  });

  const loader = document.getElementById("loader");

  map.on("load", async () => {
    try {
      setLoaderText("Loading analysis data");
      const summary = await loadAllLayers(map);
      setupPopups(map);
      updateModelRunStatus({
        state: "completed",
        finishedAt: new Date(),
        pathCount: summary.pathCount,
        heatmapCount: summary.heatmapCount,
        bestFamily: summary.bestFamily,
        bfoDiagnosticCount: summary.bfoDiagnosticCount,
        bfoAvailable: summary.bfoAvailable,
      });
      markModelRunCompleted(getAnalysisConfig(), new Date());
      if (!window.location.hash) {
        restoreStoredSessionSnapshot();
      }
      scheduleAutoSaveSessionSnapshot();
    } catch (err) {
      console.error("Failed to load layers:", err);
      updateModelRunStatus({
        state: "failed",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    loader?.classList.add("hidden");
    loader?.addEventListener("transitionend", () => loader.remove(), { once: true });

    await initTimeline((_index, arcNum) => {
      highlightArc(map, arcNum);
    });
  });

  // Register flyout panels
  registerPanel("model", createModelPanel());
  registerPanel("drift", createDriftPanel());
  registerPanel("layers", createLayersPanel());
  registerPanel("evidence", createEvidenceBrowsePanel());
  registerPanel("export", createExportPanel());
  registerPanel("sensitivity", createSensitivityPanel());

  // Wire icon rail toggle
  initIconRail((panel) => {
    if (panel) {
      openFlyout(panel);
    } else {
      closeFlyout();
    }
    scheduleAutoSaveSessionSnapshot();
  });
  setOnClose(() => {
    setActivePanel(null);
    scheduleAutoSaveSessionSnapshot();
  });

  // Wire model callbacks
  setModelCallbacks({
    onRunModel: async () => {
      const runLoader = document.getElementById("loader") ?? createLoader();
      const startedAt = new Date();
      updateModelRunStatus({ state: "running", startedAt });
      setLoaderText("Running model");
      runLoader.classList.remove("hidden");
      try {
        removeAllLayers(map);
        const summary = await loadAllLayers(map);
        setupPopups(map);
        updateModelRunStatus({
          state: "completed",
          startedAt,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          pathCount: summary.pathCount,
          heatmapCount: summary.heatmapCount,
          bestFamily: summary.bestFamily,
          bfoDiagnosticCount: summary.bfoDiagnosticCount,
          bfoAvailable: summary.bfoAvailable,
        });
        markModelRunCompleted(getAnalysisConfig(), new Date());
        scheduleAutoSaveSessionSnapshot();
      } catch (err) {
        console.error("Failed to reload layers:", err);
        updateModelRunStatus({
          state: "failed",
          startedAt,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      runLoader.classList.add("hidden");
    },
    onConfigureModel: () => {
      showModelConfigModal();
    },
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyAnalysisContextForAi();
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      downloadSessionSnapshot();
    }
  });

  window.addEventListener("beforeunload", () => {
    persistSessionSnapshot();
  });

}

main();
