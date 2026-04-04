import type { Map as MapboxMap } from "mapbox-gl";
import { getProbabilityHeatmap, type BackendProbPoint } from "../lib/backend";

/** Draw probability heatmap along the 7th arc */
export async function loadHeatmapLayer(map: MapboxMap, providedPoints?: BackendProbPoint[]): Promise<void> {
  const points: BackendProbPoint[] = providedPoints ?? await getProbabilityHeatmap();

  // Scale probabilities for heatmap intensity
  const maxProb = Math.max(...points.map((p) => p.probability), 0.001);

  map.addSource("heatmap-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature" as const,
        properties: {
          weight: p.probability / maxProb,
        },
        geometry: {
          type: "Point" as const,
          coordinates: p.position,
        },
      })),
    },
  });

  map.addLayer(
    {
      id: "heatmap-heat",
      type: "heatmap",
      source: "heatmap-source",
      paint: {
        "heatmap-weight": ["get", "weight"],
        "heatmap-intensity": 1,
        "heatmap-radius": 30,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          0.2,
          "rgb(178,24,43)",
          0.4,
          "rgb(214,96,77)",
          0.6,
          "rgb(244,165,130)",
          0.8,
          "rgb(253,219,199)",
          1.0,
          "rgb(255,255,178)",
        ],
        "heatmap-opacity": 0.7,
      },
    },
  );
}
