import type { Map as MapboxMap } from "mapbox-gl";
import type { BackendProbPoint } from "../lib/backend";

export interface EofScenarioOverlay {
  scenarioId: string;
  scenarioName: string;
  color: string;
  heatmap: BackendProbPoint[];
}

const SOURCE_ID = "eof-compare-source";
const PEAK_SOURCE_ID = "eof-compare-peaks-source";

const SCENARIO_COLORS: Record<string, string> = {
  eof_spiral_dive: "#ef4444",
  eof_ghost_flight: "#f59e0b",
  eof_active_glide: "#22c55e",
};

let overlays: EofScenarioOverlay[] = [];

export function getEofScenarioColor(scenarioId: string): string {
  return SCENARIO_COLORS[scenarioId] ?? "#ffffff";
}

export function setEofComparisonOverlays(next: EofScenarioOverlay[]): void {
  overlays = next;
}

export function hasEofComparisonOverlays(): boolean {
  return overlays.length > 0;
}

export function loadEofComparisonOverlay(map: MapboxMap): void {
  clearEofComparisonOverlay(map);
  if (overlays.length === 0) return;

  const features = overlays.flatMap((overlay) => {
    const maxProb = Math.max(...overlay.heatmap.map((point) => point.path_density_score), 0.001);
    return overlay.heatmap
      .filter((point) => Number.isFinite(point.path_density_score))
      .map((point) => ({
        type: "Feature" as const,
        properties: {
          scenarioId: overlay.scenarioId,
          scenarioName: overlay.scenarioName,
          color: overlay.color,
          weight: point.path_density_score / maxProb,
        },
        geometry: {
          type: "Point" as const,
          coordinates: point.position,
        },
      }));
  });

  const peakFeatures = overlays.flatMap((overlay) => {
    const peak = overlay.heatmap
      .filter((point) => Number.isFinite(point.path_density_score))
      .sort((left, right) => right.path_density_score - left.path_density_score)[0];
    if (!peak) return [];
    return [
      {
        type: "Feature" as const,
        properties: {
          scenarioId: overlay.scenarioId,
          scenarioName: overlay.scenarioName,
          color: overlay.color,
          label: overlay.scenarioName,
        },
        geometry: {
          type: "Point" as const,
          coordinates: peak.position,
        },
      },
    ];
  });

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features,
    },
  });

  map.addLayer({
    id: "eof-compare-heat",
    type: "heatmap",
    source: SOURCE_ID,
    paint: {
      "heatmap-weight": ["get", "weight"],
      "heatmap-intensity": 0.8,
      "heatmap-radius": 28,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 1, "rgba(255,255,255,0.9)"],
      "heatmap-opacity": [
        "match",
        ["get", "scenarioId"],
        "eof_spiral_dive",
        0.45,
        "eof_ghost_flight",
        0.38,
        "eof_active_glide",
        0.34,
        0.3,
      ],
    },
  });

  map.addLayer({
    id: "eof-compare-points",
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 0, 2, 1, 10],
      "circle-color": ["get", "color"],
      "circle-opacity": ["interpolate", ["linear"], ["get", "weight"], 0, 0.02, 1, 0.18],
      "circle-stroke-width": 0,
    },
  });

  map.addSource(PEAK_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: peakFeatures,
    },
  });

  map.addLayer({
    id: "eof-compare-peaks",
    type: "circle",
    source: PEAK_SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addLayer({
    id: "eof-compare-labels",
    type: "symbol",
    source: PEAK_SOURCE_ID,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "rgba(0,0,0,0.9)",
      "text-halo-width": 1.2,
    },
  });
}

export function clearEofComparisonOverlay(map: MapboxMap): void {
  for (const layerId of ["eof-compare-labels", "eof-compare-peaks", "eof-compare-points", "eof-compare-heat"]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  for (const sourceId of [PEAK_SOURCE_ID, SOURCE_ID]) {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  }
}
