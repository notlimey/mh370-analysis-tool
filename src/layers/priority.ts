import type { Map as MapboxMap } from "mapbox-gl";
import holidaysGeoJson from "../data/data_holidays.json";

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
  const cutoffIndex = Math.max(0, Math.floor(sorted.length * 0.3) - 1);
  const threshold = sorted[cutoffIndex]?.probability ?? sorted[0].probability;

  const features = heatmap
    .filter((point) => point.probability >= threshold)
    .filter((point) => isNearHoliday(point.position, 5))
    .map((point, index) => ({
      type: "Feature" as const,
      properties: {
        id: `priority_gap_${index + 1}`,
        probability: point.probability,
        label: "Unsearched high-probability zone",
      },
      geometry: squareAround(point.position, 0.18),
    }));

  return { type: "FeatureCollection", features };
}

function isNearHoliday(position: [number, number], thresholdKm: number): boolean {
  const [lon, lat] = position;
  return holidaysGeoJson.features.some((feature) => {
    if (feature.geometry.type !== "Polygon") return false;
    const ring = feature.geometry.coordinates[0] as [number, number][];
    return pointInPolygon(lon, lat, ring) || distanceToPolygonKm(position, ring) <= thresholdKm;
  });
}

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

function distanceToPolygonKm(point: [number, number], polygon: [number, number][]): number {
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length - 1; i += 1) {
    minDistance = Math.min(minDistance, distanceToSegmentKm(point, polygon[i], polygon[i + 1]));
  }
  return minDistance;
}

function distanceToSegmentKm(point: [number, number], start: [number, number], end: [number, number]): number {
  const [px, py] = project(point);
  const [sx, sy] = project(start);
  const [ex, ey] = project(end);
  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSquared));
  const closestX = sx + t * dx;
  const closestY = sy + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

function project([lon, lat]: [number, number]): [number, number] {
  const latScale = 111.32;
  const lonScale = 111.32 * Math.cos(lat * Math.PI / 180);
  return [lon * lonScale, lat * latScale];
}
