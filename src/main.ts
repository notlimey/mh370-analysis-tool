import "./style.css";
import { initMap } from "./map";
import { loadArcsLayer } from "./layers/arcs";
import { loadAnomaliesLayer } from "./layers/anomalies";
import { loadAirspacesLayer } from "./layers/airspaces";
import { loadHolidaysLayer } from "./layers/holidays";
import { loadMagneticLayer } from "./layers/magnetic";
import { loadSonarLayers } from "./layers/sonar";
import { annotatePaths, fetchCandidatePaths, loadPathsLayer, type FlightPath, type PathAnnotation } from "./layers/paths";
import { loadPriorityGapsLayer } from "./layers/priority";
import { loadHeatmapLayer } from "./layers/heatmap";
import { loadDebrisLayer } from "./layers/debris";
import { loadPointsLayer } from "./layers/points";
import { loadFlightPathLayer } from "./layers/flightpath";
import { initSidebar, renderFamilyLegend, updateConfidence, updateModelSummary } from "./ui/sidebar";
import { getSelectedAnomalyId, initEvidencePanel, openAnomalyDetail } from "./ui/evidencePanel";
import { initTimeline } from "./ui/timeline";
import { setupPopups } from "./popups";
import type { Map as MapboxMap } from "mapbox-gl";
import { invoke } from "@tauri-apps/api/core";
import { getAnalysisConfig } from "./model/config";
import { setSelectedAnomaly } from "./layers/anomalies";

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
  "searched-",
  "flightpath-",
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

async function loadAllLayers(map: MapboxMap): Promise<void> {
  // Static layers first (no async)
  loadPointsLayer(map);

  const [heatmap, paths] = await Promise.all([
    invoke("get_probability_heatmap", { config: getAnalysisConfig() }),
    fetchCandidatePaths(120),
  ]) as [{ position: [number, number]; probability: number }[], FlightPath[]];
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
  loadPriorityGapsLayer(map, heatmap);
  await loadDebrisLayer(map);

  const selectedAnomalyId = getSelectedAnomalyId();
  if (selectedAnomalyId) {
    setSelectedAnomaly(map, selectedAnomalyId);
  }

  // Flight path on top so the trace is clearly visible
  loadFlightPathLayer(map);

  // Update confidence display
  if (heatmap.length > 0) {
    const maxProb = Math.max(...heatmap.map((p) => p.probability));
    const maxPoint = heatmap.find((p) => p.probability === maxProb);
    if (maxPoint) {
      const lat = maxPoint.position[1].toFixed(1);
      const lon = maxPoint.position[0].toFixed(1);
      updateConfidence(`~${lat}S, ${lon}E`);
    }
  }

  const bestPath = paths[0];
  const summary = summarizeFamilies(pathAnnotations);
  renderFamilyLegend(summary);
  if (bestPath) {
    updateModelSummary({
      family: bestPath.family,
      fuel: bestPath.fuel_remaining_at_arc7_kg !== undefined
        ? `${Math.round(bestPath.fuel_remaining_at_arc7_kg)} kg @ arc 7`
        : undefined,
      familySpreadKm: summary.familySpreadKm,
    });
  }
}

function summarizeFamilies(pathAnnotations: PathAnnotation[]): {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily: Record<string, string[]>;
} {
  const paths = pathAnnotations.map(({ path }) => path);
  const counts: Record<string, number> = {};
  const firsByFamily: Record<string, Set<string>> = {};
  for (const { path, firs } of pathAnnotations) {
    counts[path.family] = (counts[path.family] ?? 0) + 1;
    if (!firsByFamily[path.family]) {
      firsByFamily[path.family] = new Set<string>();
    }
    for (const fir of firs) {
      firsByFamily[path.family].add(fir);
    }
  }

  const slow = paths.find((path) => path.family === "slow");
  const perpendicular = paths.find((path) => path.family === "perpendicular");
  const familySpreadKm = slow && perpendicular
    ? haversineKm(slow.points[slow.points.length - 1], perpendicular.points[perpendicular.points.length - 1])
    : undefined;

  return {
    counts,
    familySpreadKm,
    firsByFamily: Object.fromEntries(
      Object.entries(firsByFamily).map(([family, firs]) => [family, Array.from(firs).sort()]),
    ),
  };
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

/** Highlight a specific arc ring (or clear highlight if arcNum is 0) */
function highlightArc(map: MapboxMap, arcNum: number): void {
  if (!map.getLayer("arcs-lines")) return;

  if (arcNum > 0) {
    map.setPaintProperty("arcs-lines", "line-color", [
      "case", ["==", ["get", "arc"], arcNum], "#facc15", "#ffffff",
    ]);
    map.setPaintProperty("arcs-lines", "line-opacity", [
      "case", ["==", ["get", "arc"], arcNum], 1.0, 0.25,
    ]);
    map.setPaintProperty("arcs-lines", "line-width", [
      "case", ["==", ["get", "arc"], arcNum], 3, 1,
    ]);
  } else {
    map.setPaintProperty("arcs-lines", "line-color", "#ffffff");
    map.setPaintProperty("arcs-lines", "line-opacity", 0.6);
    map.setPaintProperty("arcs-lines", "line-width", 1.5);
  }
}

async function main(): Promise<void> {
  const map = initMap();

  await initEvidencePanel({
    onSelectAnomaly: (id) => {
      setSelectedAnomaly(map, id);
      if (id) {
        openAnomalyDetail(id);
      }
    },
  });

  map.on("load", async () => {
    try {
      await loadAllLayers(map);
      setupPopups(map);
    } catch (err) {
      console.error("Failed to load layers:", err);
    }

    await initTimeline((_index, arcNum) => {
      highlightArc(map, arcNum);
    });
  });

  initSidebar({
    onRunModel: async () => {
      try {
        removeAllLayers(map);
        await loadAllLayers(map);
        setupPopups(map);
      } catch (err) {
        console.error("Failed to reload layers:", err);
      }
    },
    onConfigChange: () => {
      updateConfidence("Pending rerun");
    },
  });
}

main();
