import type { Map as MapboxMap } from "mapbox-gl";
import type { BackendArcRing } from "../lib/backend";
import { getArcRings } from "../lib/backend";

/**
 * Northern route ghost layer.
 *
 * Shows what northern flight paths would look like — the mirror of the
 * southern arcs — as faded dashed lines. Used in Chapter 2 (North or South?)
 * to visualize what the BFO evidence ruled out.
 *
 * The BTO arcs are roughly symmetric about the satellite sub-point.
 * We mirror the southern arc segments into the northern hemisphere
 * to show the rejected alternative.
 */

/**
 * Mirror arc ring coordinates into the northern hemisphere.
 * For each arc, take the southern portion (lat < 0) and negate the latitude
 * to create a ghost of what the northern route arcs would look like.
 */
function mirrorArcsNorth(rings: BackendArcRing[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const ring of rings) {
    // The arc rings are full circles. Take the northern half (lat > 0)
    // which already exists, and also create a "ghost" from the southern half
    // reflected. For the report, we just want to show the full northern
    // portion of each ring with a different style.
    const northPoints = ring.points.filter(([, lat]) => lat > 0);
    if (northPoints.length < 2) continue;

    features.push({
      type: "Feature",
      properties: {
        arc: ring.arc,
        time: ring.time_utc,
      },
      geometry: {
        type: "LineString",
        coordinates: northPoints,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** A simple illustrative northern path through the arcs' northern halves. */
function buildNorthernPathLine(rings: BackendArcRing[]): GeoJSON.Feature | null {
  // For each arc, find the point closest to ~65°E longitude in the northern hemisphere
  // This traces an approximate path through Central Asia
  const waypoints: [number, number][] = [];

  const sorted = [...rings].sort((a, b) => a.arc - b.arc);
  for (const ring of sorted) {
    const northPoints = ring.points.filter(([, lat]) => lat > 0);
    if (northPoints.length === 0) continue;

    // Find the point closest to the satellite longitude (64.5°E)
    // to trace a roughly straight northern path
    let bestPoint = northPoints[0];
    let bestDist = Math.abs(northPoints[0][0] - 75);
    for (const pt of northPoints) {
      const dist = Math.abs(pt[0] - 75);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = pt;
      }
    }
    waypoints.push(bestPoint);
  }

  if (waypoints.length < 2) return null;

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: waypoints,
    },
  };
}

export async function loadNorthRouteLayer(map: MapboxMap): Promise<void> {
  const rings = await getArcRings();
  const northArcs = mirrorArcsNorth(rings);
  const northPath = buildNorthernPathLine(rings);

  // Northern arc segments (faded, to show what was ruled out)
  map.addSource("north-route-arcs-source", {
    type: "geojson",
    data: northArcs,
  });

  map.addLayer({
    id: "north-route-arcs",
    type: "line",
    source: "north-route-arcs-source",
    paint: {
      "line-color": "#ef4444",
      "line-opacity": 0.3,
      "line-width": 1.5,
      "line-dasharray": [4, 3],
    },
  });

  map.addLayer({
    id: "north-route-arcs-labels",
    type: "symbol",
    source: "north-route-arcs-source",
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", "Arc ", ["get", "arc"], " (north)"],
      "text-size": 10,
      "text-offset": [0, -0.8],
    },
    paint: {
      "text-color": "#ef4444",
      "text-opacity": 0.4,
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  // Illustrative northern path line
  if (northPath) {
    map.addSource("north-route-path-source", {
      type: "geojson",
      data: northPath,
    });

    map.addLayer({
      id: "north-route-path",
      type: "line",
      source: "north-route-path-source",
      paint: {
        "line-color": "#ef4444",
        "line-opacity": 0.35,
        "line-width": 2,
        "line-dasharray": [6, 4],
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });
  }

  // "Ruled out" label at the center of the northern path
  if (northPath) {
    const coords = (northPath.geometry as GeoJSON.LineString).coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    if (mid) {
      map.addSource("north-route-label-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { label: "Northern route\n(ruled out by BFO)" },
              geometry: { type: "Point", coordinates: mid },
            },
          ],
        },
      });

      map.addLayer({
        id: "north-route-label",
        type: "symbol",
        source: "north-route-label-source",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 13,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-anchor": "center",
        },
        paint: {
          "text-color": "#ef4444",
          "text-opacity": 0.5,
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
        },
      });
    }
  }
}
