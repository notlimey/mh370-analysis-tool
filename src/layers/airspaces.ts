import type { Map as MapboxMap } from "mapbox-gl";
import { getAirspacesGeoJson } from "../model/airspaces";

const SOURCE_ID = "airspaces-source";
const LAYER_FILL = "airspaces-fill";
const LAYER_OUTLINE = "airspaces-outline";
const LAYER_LABELS = "airspaces-labels";

export async function loadAirspacesLayer(map: MapboxMap): Promise<void> {
  const geojson = await getAirspacesGeoJson();

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: geojson,
  });

  map.addLayer({
    id: LAYER_FILL,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": [
        "match",
        ["get", "analytical_importance"],
        "VERY HIGH",
        0.07,
        "HIGH",
        0.05,
        "MEDIUM",
        0.03,
        0.02,
      ],
    },
  });

  map.addLayer({
    id: LAYER_OUTLINE,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": ["get", "color"],
      "line-width": [
        "match",
        ["get", "type"],
        "ADIZ",
        2,
        "FIR",
        1.5,
        1,
      ],
      "line-dasharray": [
        "match",
        ["get", "type"],
        "ADIZ",
        ["literal", [2, 2]],
        "SECTOR",
        ["literal", [6, 4]],
        ["literal", [4, 3]],
      ],
      "line-opacity": 0.8,
    },
  });

  map.addLayer({
    id: LAYER_LABELS,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "text-field": ["concat", ["get", "icao"], "\n", ["get", "name"]],
      "text-size": 10,
      "text-anchor": "center",
      "text-max-width": 10,
    },
    paint: {
      "text-color": ["get", "color"],
      "text-opacity": 0.9,
      "text-halo-color": "rgba(0, 0, 0, 0.8)",
      "text-halo-width": 1.5,
    },
  });
}
