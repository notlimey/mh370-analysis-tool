import type { Map as MapboxMap } from "mapbox-gl";
import holidaysGeoJson from "../data/data_holidays.json";

export const HOLIDAYS_SOURCE_ID = "holidays-source";

export function loadHolidaysLayer(map: MapboxMap): void {
  map.addSource(HOLIDAYS_SOURCE_ID, {
    type: "geojson",
    data: holidaysGeoJson as GeoJSON.FeatureCollection,
  });

  map.addLayer({
    id: "holidays-fill",
    type: "fill",
    source: HOLIDAYS_SOURCE_ID,
    paint: {
      "fill-color": [
        "match",
        ["get", "priority"],
        "HIGH",
        "#f59e0b",
        "MEDIUM",
        "#fbbf24",
        "#fcd34d",
      ],
      "fill-opacity": 0.18,
    },
  });

  map.addLayer({
    id: "holidays-outline",
    type: "line",
    source: HOLIDAYS_SOURCE_ID,
    paint: {
      "line-color": "#f59e0b",
      "line-width": 1.8,
      "line-opacity": 0.9,
      "line-dasharray": [2, 2],
    },
  });
}
