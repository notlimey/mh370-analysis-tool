import mapboxgl from "mapbox-gl";
import type { Component } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { MAP_CENTER, MAP_ZOOM, SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "../../constants";
import { useSetMap } from "../../contexts/map-context";
import { loadAirspacesLayer } from "../../layers/airspaces";
import { loadAnomaliesLayer, setSelectedAnomaly } from "../../layers/anomalies";
// Layer imports
import { loadArcsLayer } from "../../layers/arcs";
import { loadDebrisLayer } from "../../layers/debris";
import { initDriftCloudsLayer } from "../../layers/drift-clouds";
import { hasEofComparisonOverlays, loadEofComparisonOverlay } from "../../layers/eof-comparison";
import { loadFlightPathLayer } from "../../layers/flightpath";
import { loadHeatmapLayer } from "../../layers/heatmap";
import { loadHolidaysLayer } from "../../layers/holidays";
import { loadMagneticLayer } from "../../layers/magnetic";
import type { FlightPath, PathAnnotation } from "../../layers/paths";
import { annotatePaths, fetchCandidatePaths, loadPathsLayer } from "../../layers/paths";
import { loadPinsLayer } from "../../layers/pins";
import { loadPointsLayer } from "../../layers/points";
import { loadPriorityGapsLayer } from "../../layers/priority";
import { loadSonarLayers } from "../../layers/sonar";
import type { BackendProbPoint } from "../../lib/backend";
import { getProbabilityHeatmap } from "../../lib/backend";
import { setContextExportMap } from "../../lib/contextExport";
import {
  capitalize,
  centroid,
  formatLatLon,
  haversineKm,
  latitudinalKm,
  longitudinalKm,
  pointInPolygon,
} from "../../lib/geo";
import {
  restoreStoredSessionSnapshot,
  scheduleAutoSaveSessionSnapshot,
  setSessionSnapshotMap,
} from "../../lib/sessionSnapshot";
import { scheduleUrlStateSync, setUrlStateMap } from "../../lib/urlState";
import { markModelRunCompleted } from "../../lib/workspaceState";
import { setupPopups } from "../../popups";
import { getConfigSnapshot } from "../../stores/analysis-config";
import { evidenceSelection } from "../../stores/evidence";
import { layerVisibility } from "../../stores/layer-visibility";
import type { ModelRunStatus } from "../../stores/model-run";
import {
  setConfidence,
  setFamilySummary,
  setModelSummary,
  setResultSummary,
  setRunStatus,
} from "../../stores/model-run";
import { setLoaderText, setLoaderVisible } from "../../stores/ui";

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

function removeAllLayers(map: mapboxgl.Map): void {
  const style = map.getStyle();
  if (!style) return;
  for (const layer of [...(style.layers || [])].reverse()) {
    if (LAYER_PREFIXES.some((p) => layer.id.startsWith(p))) {
      try {
        map.removeLayer(layer.id);
      } catch {
        /* already removed */
      }
    }
  }
  for (const sourceId of Object.keys(style.sources || {})) {
    if (LAYER_PREFIXES.some((p) => sourceId.startsWith(p))) {
      try {
        map.removeSource(sourceId);
      } catch {
        /* already removed */
      }
    }
  }
}

function applyLayerVisibility(map: mapboxgl.Map): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const [group, visible] of Object.entries(layerVisibility)) {
    const visibility = visible ? "visible" : "none";
    for (const layer of style.layers) {
      if (layer.id.startsWith(`${group}-`)) {
        map.setLayoutProperty(layer.id, "visibility", visibility);
      }
    }
  }
}

interface LayerLoadSummary {
  pathCount: number;
  heatmapCount: number;
  bestFamily?: string;
  bfoDiagnosticCount: number;
  bfoAvailable: boolean;
}

interface FamilySummaryInternal {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily: Record<string, string[]>;
  endpointNarrative?: string;
}

function summarizeFamilies(pathAnnotations: PathAnnotation[]): FamilySummaryInternal {
  const paths = pathAnnotations.map(({ path }) => path);
  const counts: Record<string, number> = {};
  const firsByFamily: Record<string, Set<string>> = {};
  const endpointsByFamily: Record<string, [number, number][]> = {};
  for (const { path, firs } of pathAnnotations) {
    counts[path.family] = (counts[path.family] ?? 0) + 1;
    if (!firsByFamily[path.family]) firsByFamily[path.family] = new Set<string>();
    if (!endpointsByFamily[path.family]) endpointsByFamily[path.family] = [];
    for (const fir of firs) firsByFamily[path.family].add(fir);
    const endpoint = path.points[path.points.length - 1];
    if (endpoint) endpointsByFamily[path.family].push(endpoint);
  }

  const slow = paths.find((p) => p.family === "slow");
  const perpendicular = paths.find((p) => p.family === "perpendicular");
  const familySpreadKm =
    slow && perpendicular
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
    .sort((a, b) => b[1] - a[1]);
  if (rankedFamilies.length === 0) return undefined;

  const dominantFamily = rankedFamilies[0][0];
  const dominantCentroid = centroid(endpointsByFamily[dominantFamily] ?? []);
  if (!dominantCentroid) return undefined;

  let northeastTail: { family: string; distanceKm: number } | undefined;
  for (const [family] of rankedFamilies.slice(1)) {
    const familyCentroid = centroid(endpointsByFamily[family] ?? []);
    if (!familyCentroid) continue;
    const eastKm = longitudinalKm(dominantCentroid, familyCentroid);
    const northKm = latitudinalKm(dominantCentroid, familyCentroid);
    if (eastKm <= 0 || northKm <= 0) continue;
    const distanceKm = Math.hypot(eastKm, northKm);
    if (!northeastTail || distanceKm > northeastTail.distanceKm) {
      northeastTail = { family, distanceKm };
    }
  }

  if (northeastTail && northeastTail.distanceKm >= 15) {
    return `${capitalize(northeastTail.family)} endpoints form the visible northeast tail, centered about ${Math.round(northeastTail.distanceKm)} km from the main ${dominantFamily} cluster.`;
  }
  return `${capitalize(dominantFamily)} endpoints dominate this run, so the visible stretch is mostly spread within one family rather than a separate branch.`;
}

function summarizeEndpointOverlap(paths: FlightPath[]): string {
  const searchPolygons = [SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026];
  const endpoints = paths
    .filter((p) => p.fuel_feasible)
    .map((p) => p.points[p.points.length - 1])
    .filter((pt): pt is [number, number] => Array.isArray(pt));
  if (endpoints.length === 0) return "No fuel-feasible endpoints";
  const insideCount = endpoints.filter((pt) => searchPolygons.some((poly) => pointInPolygon(pt, poly))).length;
  return `${insideCount}/${endpoints.length} fuel-feasible endpoints in searched area (${Math.round((insideCount / endpoints.length) * 100)}%)`;
}

function summarizeContinuationContribution(paths: FlightPath[]): string {
  const endpoints = paths.filter((p) => Array.isArray(p.points[p.points.length - 1]));
  if (endpoints.length === 0) return "No visible endpoints";
  const continuationCount = endpoints.filter(
    (p) => (p.extra_endurance_minutes ?? 0) > 0 || (p.extra_range_nm ?? 0) > 0,
  ).length;
  const constrainedCount = endpoints.length - continuationCount;
  return `${continuationCount}/${endpoints.length} visible endpoints include post-Arc-7 continuation (${Math.round((continuationCount / endpoints.length) * 100)}%); ${constrainedCount} remain handshake-constrained.`;
}

async function loadAllLayers(
  map: mapboxgl.Map,
  onAnomalySelect: (id: string | null) => void,
): Promise<LayerLoadSummary> {
  loadPointsLayer(map);
  loadPinsLayer(map);
  const config = getConfigSnapshot();

  const [heatmap, paths] = (await Promise.all([getProbabilityHeatmap(config), fetchCandidatePaths(120, config)])) as [
    BackendProbPoint[],
    FlightPath[],
  ];
  const pathAnnotations = await annotatePaths(paths);

  await loadMagneticLayer(map);
  await loadAirspacesLayer(map);
  loadHolidaysLayer(map);
  await loadAnomaliesLayer(map, (id) => {
    setSelectedAnomaly(map, id);
    onAnomalySelect(id);
  });
  await loadArcsLayer(map);
  loadSonarLayers(map);
  await loadPathsLayer(map, paths, pathAnnotations);
  await loadHeatmapLayer(map, heatmap);
  if (hasEofComparisonOverlays()) loadEofComparisonOverlay(map);
  loadPriorityGapsLayer(map, heatmap);
  await loadDebrisLayer(map);
  initDriftCloudsLayer(map);

  const sel = evidenceSelection();
  if (sel.kind === "anomaly" && sel.id) setSelectedAnomaly(map, sel.id);

  loadFlightPathLayer(map);
  applyLayerVisibility(map);

  // Update stores with results
  if (heatmap.length > 0) {
    const maxDensity = Math.max(...heatmap.map((p) => p.path_density_score));
    const maxPoint = heatmap.find((p) => p.path_density_score === maxDensity);
    if (maxPoint) setConfidence(formatLatLon(maxPoint.position[1], maxPoint.position[0]));
  }

  const bestPath = paths[0];
  const bestEndpoint = bestPath?.points[bestPath.points.length - 1];
  const summary = summarizeFamilies(pathAnnotations);
  const peakPoint = heatmap.slice().sort((a, b) => b.path_density_score - a.path_density_score)[0];
  const fuelFeasibleCount = paths.filter((p) => p.fuel_feasible).length;
  const overlapSummary = summarizeEndpointOverlap(paths);
  const continuationSummary = summarizeContinuationContribution(paths);

  setFamilySummary(summary);
  setResultSummary({
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
    setModelSummary({
      fuel:
        bestPath.fuel_remaining_at_arc7_kg !== undefined
          ? `${Math.round(bestPath.fuel_remaining_at_arc7_kg)} kg @ arc 7`
          : undefined,
      familySpread: summary.familySpreadKm != null ? `${summary.familySpreadKm.toFixed(0)} km` : "\u2014",
    });
  }

  return {
    pathCount: paths.length,
    heatmapCount: heatmap.length,
    bestFamily: bestPath?.family,
    bfoDiagnosticCount: bestPath?.bfo_diagnostics?.length ?? 0,
    bfoAvailable: Boolean(bestPath?.bfo_summary),
  };
}

export { applyLayerVisibility, LAYER_PREFIXES, loadAllLayers, removeAllLayers };

const MapContainer: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  const setMap = useSetMap();

  onMount(() => {
    if (!containerRef) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef,
      style: "mapbox://styles/mapbox/standard-satellite",
      config: {
        basename: {
          lightPreset: "night",
          show3dObjects: false,
        },
      },
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      projection: "mercator",
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-right");

    map.once("style.load", () => map.resize());
    requestAnimationFrame(() => map.resize());

    setMap(map);
    setSessionSnapshotMap(map);
    setContextExportMap(map);
    setUrlStateMap(map);

    map.on("load", async () => {
      try {
        setLoaderText("Loading analysis data");
        const summary = await loadAllLayers(map, (_id) => {
          // Anomaly selection is handled via store
        });
        setupPopups(map);
        const status: ModelRunStatus = {
          state: "completed",
          finishedAt: new Date(),
          pathCount: summary.pathCount,
          heatmapCount: summary.heatmapCount,
          bestFamily: summary.bestFamily,
          bfoDiagnosticCount: summary.bfoDiagnosticCount,
          bfoAvailable: summary.bfoAvailable,
        };
        setRunStatus(status);
        markModelRunCompleted(getConfigSnapshot(), new Date());
        if (!window.location.hash) restoreStoredSessionSnapshot();
        scheduleAutoSaveSessionSnapshot();
      } catch (err) {
        console.error("Failed to load layers:", err);
        setRunStatus({
          state: "failed",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      setLoaderVisible(false);
    });

    // Sync URL and auto-save on map viewport changes
    const syncOnMove = () => {
      scheduleUrlStateSync();
      scheduleAutoSaveSessionSnapshot();
    };
    map.on("moveend", syncOnMove);
    map.on("rotateend", syncOnMove);
    map.on("pitchend", syncOnMove);
  });

  onCleanup(() => {
    // Map cleanup would go here if needed
  });

  return <div ref={containerRef} id="map" />;
};

export default MapContainer;
