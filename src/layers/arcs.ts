import type { Map as MapboxMap } from "mapbox-gl";
import { type BackendArcRing, getArcRings } from "../lib/backend";

let latestArcRings: BackendArcRing[] = [];

/** Draw BTO arc rings on the map */
export async function loadArcsLayer(map: MapboxMap): Promise<void> {
  const rings: BackendArcRing[] = await getArcRings();
  latestArcRings = rings;

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
          bfo_residual_hz: null,
          bfo_weight: null,
          bfo_fit_label: null,
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

export function getArcRingByArc(arc: number): BackendArcRing | undefined {
  return latestArcRings.find((ring) => ring.arc === arc);
}

export function highlightArc(map: MapboxMap, arcNum: number): void {
  if (!map.getLayer("arcs-lines")) return;

  if (arcNum > 0) {
    map.setPaintProperty("arcs-lines", "line-color", ["case", ["==", ["get", "arc"], arcNum], "#facc15", "#ffffff"]);
    map.setPaintProperty("arcs-lines", "line-opacity", ["case", ["==", ["get", "arc"], arcNum], 1.0, 0.25]);
    map.setPaintProperty("arcs-lines", "line-width", ["case", ["==", ["get", "arc"], arcNum], 3, 1]);
    return;
  }

  map.setPaintProperty("arcs-lines", "line-color", "#ffffff");
  map.setPaintProperty("arcs-lines", "line-opacity", 0.6);
  map.setPaintProperty("arcs-lines", "line-width", 1.5);
}
