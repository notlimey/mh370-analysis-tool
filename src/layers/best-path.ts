import type { Map as MapboxMap } from "mapbox-gl";
import type { FlightPath } from "./paths";

/**
 * Best-path highlight layer.
 *
 * Draws the top-scoring candidate path as a bold, distinct line
 * separate from the 120 faded candidate paths. This is what the
 * report refers to as "our model's best estimate."
 */

/** Load the best-path layer from the top candidate path. */
export function loadBestPathLayer(map: MapboxMap, paths: FlightPath[]): void {
  if (paths.length === 0) return;

  const best = paths[0]; // paths are sorted by score, highest first
  const endpoint = best.points[best.points.length - 1];

  // Best path line
  map.addSource("best-path-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {
        family: best.family,
        score: best.score,
      },
      geometry: {
        type: "LineString",
        coordinates: best.points,
      },
    },
  });

  map.addLayer({
    id: "best-path-line",
    type: "line",
    source: "best-path-source",
    paint: {
      "line-color": "#ffffff",
      "line-width": 3,
      "line-opacity": 0.9,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  // Glow effect underneath
  map.addLayer(
    {
      id: "best-path-glow",
      type: "line",
      source: "best-path-source",
      paint: {
        "line-color": "#4a9eff",
        "line-width": 8,
        "line-opacity": 0.3,
        "line-blur": 4,
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    },
    "best-path-line",
  );

  // Arc 7 crossing marker — where the best-fit path intersects the 7th arc.
  // This is NOT the crash site. The impact zone is 90.8–92.2°E depending on
  // post-arc glide vs spiral dive (see research-summary.md §Post-Arc-7).
  if (endpoint) {
    map.addSource("best-path-endpoint-source", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              label: `Arc 7 crossing\n${Math.abs(endpoint[1]).toFixed(1)}°S, ${endpoint[0].toFixed(1)}°E`,
            },
            geometry: {
              type: "Point",
              coordinates: endpoint,
            },
          },
        ],
      },
    });

    // Outer ring
    map.addLayer({
      id: "best-path-impact-ring",
      type: "circle",
      source: "best-path-endpoint-source",
      paint: {
        "circle-radius": 12,
        "circle-color": "transparent",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    // Inner dot
    map.addLayer({
      id: "best-path-impact-dot",
      type: "circle",
      source: "best-path-endpoint-source",
      paint: {
        "circle-radius": 5,
        "circle-color": "#ff4444",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });

    // Label
    map.addLayer({
      id: "best-path-impact-label",
      type: "symbol",
      source: "best-path-endpoint-source",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, 2.2],
        "text-anchor": "top",
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1.5,
      },
    });
  }
}
