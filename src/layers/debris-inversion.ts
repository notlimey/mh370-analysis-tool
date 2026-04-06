import type { Map as MapboxMap } from "mapbox-gl";

export interface OriginCandidate {
  lat: number;
  lon: number;
  log_likelihood: number;
  normalized_prob: number;
  contributing_items: number;
}

export interface InversionResult {
  candidates: OriginCandidate[];
  peak_lat: number;
  peak_lon: number;
  confidence_interval_68: [number, number];
  confidence_interval_95: [number, number];
  satellite_peak_lat: number;
  intersection_lat: number;
  items_used: number;
  items_excluded: number;
  validation_ok?: boolean;
  validation_message?: string;
}

const INVERSION_SOURCE_ID = "debris-inversion-source";
const COMPARISON_SOURCE_ID = "debris-comparison-source";
const INVERSION_LAYER_IDS = ["debris-inversion-line", "debris-inversion-peaks"];
const COMPARISON_LAYER_IDS = ["debris-comparison-lines", "debris-comparison-labels"];

export function renderDebrisInversionLayer(map: MapboxMap, result: InversionResult): void {
  removeLayers(map, INVERSION_LAYER_IDS, INVERSION_SOURCE_ID);

  map.addSource(INVERSION_SOURCE_ID, {
    type: "geojson",
    lineMetrics: true,
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: result.candidates.map((candidate) => [candidate.lon, candidate.lat]),
          },
        },
        {
          type: "Feature",
          properties: {
            label: `Debris peak ${Math.abs(result.peak_lat).toFixed(1)}°S`,
          },
          geometry: {
            type: "Point",
            coordinates: [result.peak_lon, result.peak_lat],
          },
        },
      ],
    },
  });

  map.addLayer({
    id: "debris-inversion-line",
    type: "line",
    source: INVERSION_SOURCE_ID,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-width": 6,
      "line-opacity": 0.85,
      "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#1d4ed8", 0.5, "#f97316", 1, "#ef4444"],
    },
  });

  map.addLayer({
    id: "debris-inversion-peaks",
    type: "symbol",
    source: INVERSION_SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#fdba74",
      "text-halo-color": "#111827",
      "text-halo-width": 1,
    },
  });
}

export function renderComparisonOverlay(map: MapboxMap, result: InversionResult): void {
  removeLayers(map, COMPARISON_LAYER_IDS, COMPARISON_SOURCE_ID);

  const satelliteSegment = segmentForLatBand(
    result.candidates,
    result.satellite_peak_lat - 1.0,
    result.satellite_peak_lat + 1.0,
  );
  const debrisSegment = segmentForLatBand(
    result.candidates,
    result.confidence_interval_68[0],
    result.confidence_interval_68[1],
  );
  const intersectionSegment = segmentForLatBand(
    result.candidates,
    result.intersection_lat - 0.6,
    result.intersection_lat + 0.6,
  );

  map.addSource(COMPARISON_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        featureFromSegment("Satellite-only peak", satelliteSegment, "#60a5fa"),
        featureFromSegment("Debris-only peak", debrisSegment, "#fb923c"),
        featureFromSegment("Intersection zone", intersectionSegment, "#4ade80"),
      ],
    },
  });

  map.addLayer({
    id: "debris-comparison-lines",
    type: "line",
    source: COMPARISON_SOURCE_ID,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 10,
      "line-opacity": 0.75,
    },
  });

  map.addLayer({
    id: "debris-comparison-labels",
    type: "symbol",
    source: COMPARISON_SOURCE_ID,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"],
      "text-size": 11,
    },
    paint: {
      "text-color": "#f8fafc",
      "text-halo-color": "#111827",
      "text-halo-width": 1,
    },
  });
}

export function setDebrisInversionVisible(map: MapboxMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const layerId of [...INVERSION_LAYER_IDS, ...COMPARISON_LAYER_IDS]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

export function setComparisonOverlayVisible(map: MapboxMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const layerId of COMPARISON_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

function removeLayers(map: MapboxMap, layerIds: string[], sourceId: string): void {
  for (const layerId of [...layerIds].reverse()) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function segmentForLatBand(candidates: OriginCandidate[], minLat: number, maxLat: number): [number, number][] {
  const points = candidates
    .filter((candidate) => candidate.lat >= minLat && candidate.lat <= maxLat)
    .map((candidate) => [candidate.lon, candidate.lat] as [number, number]);
  if (points.length >= 2) {
    return points;
  }
  const fallback = candidates
    .slice()
    .sort((left, right) => Math.abs(left.lat - minLat) - Math.abs(right.lat - minLat))
    .slice(0, 2)
    .map((candidate) => [candidate.lon, candidate.lat] as [number, number]);
  return fallback.length >= 2 ? fallback : points;
}

function featureFromSegment(
  label: string,
  coordinates: [number, number][],
  color: string,
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: { label, color },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}
