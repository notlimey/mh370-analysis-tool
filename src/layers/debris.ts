import { invoke } from "@tauri-apps/api/core";
import type { Map as MapboxMap } from "mapbox-gl";
import { getAnalysisConfig } from "../model/config";

interface DebrisDriftItem {
  name: string;
  found_location: [number, number];
  date_found: string;
  days_adrift: number;
  drift_line: [number, number][];
}

interface DebrisLogItem {
  id: string;
  item_description: string;
  find_date: string;
  find_location_name: string;
  lat: number;
  lon: number;
  confirmation: string;
  confirmed_by?: string;
  barnacle_analysis_done: boolean;
  barnacle_analysis_available: boolean;
  oldest_barnacle_age_estimate?: string;
  initial_water_temp_from_barnacle?: number;
  used_in_drift_models: string[];
  notes: string;
}

const PROBABLE_SOURCE: [number, number] = [94, -35];

export async function loadDebrisLayer(map: MapboxMap): Promise<void> {
  const [debris, debrisLog] = await Promise.all([
    invoke("get_debris_drift", { config: getAnalysisConfig() }),
    invoke("get_debris_log", { config: getAnalysisConfig() }),
  ]) as [DebrisDriftItem[], DebrisLogItem[]];

  map.addSource("debris-drift-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: debris.map((d) => ({
        type: "Feature" as const,
        properties: {
          name: d.name,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: d.drift_line,
        },
      })),
    },
  });

  map.addLayer({
    id: "debris-drift-lines",
    type: "line",
    source: "debris-drift-source",
    paint: {
      "line-color": "#4ade80",
      "line-opacity": 0.45,
      "line-width": 1.5,
      "line-dasharray": [2, 2],
    },
  });

  map.addSource("debris-corridor-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: debrisLog.map((item) => ({
        type: "Feature" as const,
        properties: {
          id: item.id,
          confirmation: item.confirmation,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [item.lon, item.lat],
            PROBABLE_SOURCE,
          ],
        },
      })),
    },
  });

  map.addLayer({
    id: "debris-corridor-lines",
    type: "line",
    source: "debris-corridor-source",
    paint: {
      "line-color": "#86efac",
      "line-opacity": 0.2,
      "line-width": 1,
      "line-dasharray": ["case", ["==", ["get", "confirmation"], "confirmed"], [1, 0], [3, 2]],
    },
  });

  map.addSource("debris-points-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: debrisLog.map((item) => ({
        type: "Feature" as const,
        properties: {
          id: item.id,
          name: item.item_description,
          date: item.find_date,
          location: item.find_location_name,
          confirmation: item.confirmation,
          confirmed_by: item.confirmed_by ?? "",
          barnacles: item.barnacle_analysis_done ? "analyzed" : "not analyzed",
          temp: item.initial_water_temp_from_barnacle ?? "",
          notes: item.notes,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [item.lon, item.lat],
        },
      })),
    },
  });

  map.addLayer({
    id: "debris-markers",
    type: "circle",
    source: "debris-points-source",
    paint: {
      "circle-radius": 6,
      "circle-color": [
        "match",
        ["get", "confirmation"],
        "confirmed",
        "#4ade80",
        "probable",
        "#a3e635",
        "suspected",
        "#facc15",
        "#94a3b8",
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addLayer({
    id: "debris-labels",
    type: "symbol",
    source: "debris-points-source",
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#4ade80",
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });
}
