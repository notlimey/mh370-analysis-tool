import type { Map as MapboxMap } from "mapbox-gl";
import { SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "../constants";

interface ProbPoint {
  position: [number, number];
  probability: number;
}

export function loadPriorityGapsLayer(map: MapboxMap, heatmap: ProbPoint[]): void {
  const priorityGaps = computePriorityGaps(heatmap);

  map.addSource("priority-source", {
    type: "geojson",
    data: priorityGaps,
  });

  map.addLayer({
    id: "priority-fill",
    type: "fill",
    source: "priority-source",
    paint: {
      "fill-color": "#fb7185",
      "fill-opacity": 0.28,
    },
  });

  map.addLayer({
    id: "priority-outline",
    type: "line",
    source: "priority-source",
    paint: {
      "line-color": "#f43f5e",
      "line-width": 2,
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "priority-labels",
    type: "symbol",
    source: "priority-source",
    layout: {
      "text-field": "Unsearched high-probability zone",
      "text-size": 10,
      "text-offset": [0, 0],
    },
    paint: {
      "text-color": "#fecdd3",
      "text-halo-color": "#111827",
      "text-halo-width": 1,
    },
  });
}

function computePriorityGaps(heatmap: ProbPoint[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (heatmap.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const sorted = [...heatmap].sort((a, b) => b.probability - a.probability);
  const cutoffIndex = Math.max(0, Math.floor(sorted.length * 0.2) - 1);
  const threshold = sorted[cutoffIndex]?.probability ?? sorted[0].probability;

  const features = heatmap
    .filter((point) => point.probability >= threshold)
    .filter((point) => !isInsideSearchedArea(point.position))
    .map((point, index) => ({
      type: "Feature" as const,
      properties: {
        id: `priority_gap_${index + 1}`,
        probability: point.probability,
        label: "High-probability area outside searched zones",
      },
      geometry: squareAround(point.position, 0.18),
    }));

  return { type: "FeatureCollection", features };
}

function isInsideSearchedArea(position: [number, number]): boolean {
  const [lon, lat] = position;
  return SEARCHED_RINGS.some((ring) => pointInPolygon(lon, lat, ring));
}

const SEARCHED_RINGS: [number, number][][] = [
  SEARCHED_2014_2017,
  SEARCHED_2018,
  SEARCHED_2025_2026,
];

function squareAround([lon, lat]: [number, number], sizeDeg: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [lon - sizeDeg, lat - sizeDeg],
      [lon + sizeDeg, lat - sizeDeg],
      [lon + sizeDeg, lat + sizeDeg],
      [lon - sizeDeg, lat + sizeDeg],
      [lon - sizeDeg, lat - sizeDeg],
    ]],
  };
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
