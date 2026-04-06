import type { Map as MapboxMap } from "mapbox-gl";
import { KLIA, LAST_RADAR, SATELLITE, SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "../constants";

interface KeyPoint {
  name: string;
  coordinates: [number, number];
  color: string;
}

const KEY_POINTS: KeyPoint[] = [
  { name: "KLIA Departure", coordinates: KLIA, color: "#facc15" },
  { name: "Last Radar", coordinates: LAST_RADAR, color: "#f97316" },
  { name: "Inmarsat-3F1", coordinates: SATELLITE, color: "#a78bfa" },
];

/** Draw key reference points and searched-area polygons */
export function loadPointsLayer(map: MapboxMap): void {
  // Key point markers
  map.addSource("points-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: KEY_POINTS.map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name, color: p.color },
        geometry: {
          type: "Point" as const,
          coordinates: p.coordinates,
        },
      })),
    },
  });

  map.addLayer({
    id: "points-markers",
    type: "circle",
    source: "points-source",
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: "points-labels",
    type: "symbol",
    source: "points-source",
    layout: {
      "text-field": ["get", "name"],
      "text-size": 12,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  // Searched areas
  map.addSource("searched-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature" as const,
          properties: {
            name: "Searched 2014-2017",
            fillColor: "#ef4444",
            outlineColor: "#f87171",
          },
          geometry: { type: "Polygon" as const, coordinates: [SEARCHED_2014_2017] },
        },
        {
          type: "Feature" as const,
          properties: {
            name: "Searched 2018 (Ocean Infinity)",
            fillColor: "#f97316",
            outlineColor: "#fb923c",
          },
          geometry: { type: "Polygon" as const, coordinates: [SEARCHED_2018] },
        },
        {
          type: "Feature" as const,
          properties: {
            name: "Searched 2025-2026",
            fillColor: "#a855f7",
            outlineColor: "#c084fc",
          },
          geometry: { type: "Polygon" as const, coordinates: [SEARCHED_2025_2026] },
        },
      ],
    },
  });

  map.addLayer({
    id: "searched-fill",
    type: "fill",
    source: "searched-source",
    paint: {
      "fill-color": ["get", "fillColor"],
      "fill-opacity": 0.1,
    },
  });

  map.addLayer({
    id: "searched-outline",
    type: "line",
    source: "searched-source",
    paint: {
      "line-color": ["get", "outlineColor"],
      "line-opacity": 0.75,
      "line-width": 1.25,
      "line-dasharray": [3, 2],
    },
  });

  map.addLayer({
    id: "searched-labels",
    type: "symbol",
    source: "searched-source",
    layout: {
      "text-field": ["get", "name"],
      "text-size": 10,
    },
    paint: {
      "text-color": ["get", "outlineColor"],
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });
}
