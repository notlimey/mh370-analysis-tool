import type { Map as MapboxMap } from "mapbox-gl";
import { getArcRings, type BackendArcRing } from "../lib/backend";

/** Draw BTO arc rings on the map */
export async function loadArcsLayer(map: MapboxMap): Promise<void> {
  const rings: BackendArcRing[] = await getArcRings();

  map.addSource("arcs-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: rings.map((ring) => ({
        type: "Feature" as const,
        properties: {
          arc: ring.arc,
          time: ring.time_utc,
          range_km: Math.round(ring.range_km),
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [...ring.points, ring.points[0]], // close the ring
        },
      })),
    },
  });

  map.addLayer({
    id: "arcs-lines",
    type: "line",
    source: "arcs-source",
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.6,
      "line-width": 1.5,
      "line-dasharray": [4, 3],
    },
  });

  map.addLayer({
    id: "arcs-labels",
    type: "symbol",
    source: "arcs-source",
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", "Arc ", ["get", "arc"], " — ", ["get", "time"]],
      "text-size": 11,
      "text-offset": [0, -0.8],
    },
    paint: {
      "text-color": "#cccccc",
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });
}
