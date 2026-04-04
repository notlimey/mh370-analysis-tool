import type { FilterSpecification, Map as MapboxMap } from "mapbox-gl";
import { getAnomalies, getAnomalyById, type Anomaly } from "../model/evidence";

function categoryColor(category: string): string {
  switch (category) {
    case "acoustic":
      return "#38bdf8";
    case "satellite_image":
      return "#f97316";
    case "biological":
      return "#22c55e";
    case "signal":
      return "#a78bfa";
    default:
      return "#eab308";
  }
}

export async function loadAnomaliesLayer(
  map: MapboxMap,
  onSelectAnomaly: (id: string) => void,
): Promise<void> {
  const anomalies = await getAnomalies();
  const located = anomalies.filter((item) => item.lat !== null && item.lon !== null);
  const links = buildRelationshipFeatures(located);

  map.addSource("anomalies-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: located.map((item) => ({
        type: "Feature" as const,
        properties: {
          id: item.id,
          title: item.title,
          category: item.category,
          confidence: item.confidence,
          status: item.status,
          summary: item.summary,
          source: item.source,
          implication: item.implication,
          color: categoryColor(item.category),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [item.lon!, item.lat!],
        },
      })),
    },
  });

  map.addSource("anomalies-links-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: links,
    },
  });

  map.addLayer({
    id: "anomalies-links",
    type: "line",
    source: "anomalies-links-source",
    paint: {
      "line-color": ["match", ["get", "relationship"], "supports", "#67e8f9", "#fb7185"],
      "line-opacity": 0.12,
      "line-width": 1.5,
      "line-dasharray": ["match", ["get", "relationship"], "supports", [1, 0], [2, 2]],
    },
  });

  map.addLayer({
    id: "anomalies-links-active",
    type: "line",
    source: "anomalies-links-source",
    filter: ["==", ["get", "sourceId"], "__none__"],
    paint: {
      "line-color": ["match", ["get", "relationship"], "supports", "#67e8f9", "#fb7185"],
      "line-opacity": 0.85,
      "line-width": 2.5,
      "line-dasharray": ["match", ["get", "relationship"], "supports", [1, 0], [2, 2]],
    },
  });

  map.addLayer({
    id: "anomalies-glow",
    type: "circle",
    source: "anomalies-source",
    paint: {
      "circle-radius": ["case", ["==", ["get", "status"], "unexplored"], 12, 8],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.18,
      "circle-blur": 0.6,
    },
  });

  map.addLayer({
    id: "anomalies-markers",
    type: "circle",
    source: "anomalies-source",
    paint: {
      "circle-radius": 5,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addLayer({
    id: "anomalies-active",
    type: "circle",
    source: "anomalies-source",
    filter: ["==", ["get", "id"], "__none__"],
    paint: {
      "circle-radius": 9,
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });

  map.addLayer({
    id: "anomalies-related",
    type: "circle",
    source: "anomalies-source",
    filter: ["==", ["get", "id"], "__none__"],
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: "anomalies-labels",
    type: "symbol",
    source: "anomalies-source",
    layout: {
      "text-field": ["get", "title"],
      "text-size": 10,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  map.on("click", "anomalies-markers", (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id === "string") {
      onSelectAnomaly(id);
    }
  });
}

export function setSelectedAnomaly(map: MapboxMap, id: string | null): void {
  if (!map.getLayer("anomalies-active") || !map.getLayer("anomalies-links-active")) {
    return;
  }

  if (!id) {
    map.setFilter("anomalies-active", ["==", ["get", "id"], "__none__"]);
    map.setFilter("anomalies-related", ["==", ["get", "id"], "__none__"]);
    map.setFilter("anomalies-links-active", ["==", ["get", "sourceId"], "__none__"]);
    return;
  }

  const anomaly = getAnomalyById(id);
  const relatedIds = new Set([...(anomaly?.supports ?? []), ...(anomaly?.conflicts_with ?? [])]);
  map.setFilter("anomalies-active", ["==", ["get", "id"], id]);
  map.setFilter("anomalies-related", idsFilter([...relatedIds]));
  map.setFilter(
    "anomalies-links-active",
    [
      "any",
      ["==", ["get", "sourceId"], id],
      ["==", ["get", "targetId"], id],
    ] as FilterSpecification,
  );
}

function buildRelationshipFeatures(anomalies: Anomaly[]) {
  const byId = new Map(anomalies.map((item) => [item.id, item]));
  const features = [];

  for (const anomaly of anomalies) {
    for (const targetId of anomaly.supports) {
      const target = byId.get(targetId);
      if (!target || target.lat === null || target.lon === null) continue;
      features.push({
        type: "Feature" as const,
        properties: {
          sourceId: anomaly.id,
          targetId,
          relationship: "supports",
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [anomaly.lon!, anomaly.lat!],
            [target.lon, target.lat],
          ],
        },
      });
    }

    for (const targetId of anomaly.conflicts_with) {
      const target = byId.get(targetId);
      if (!target || target.lat === null || target.lon === null) continue;
      features.push({
        type: "Feature" as const,
        properties: {
          sourceId: anomaly.id,
          targetId,
          relationship: "conflicts",
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [anomaly.lon!, anomaly.lat!],
            [target.lon, target.lat],
          ],
        },
      });
    }
  }

  return features;
}

function idsFilter(ids: string[]): FilterSpecification {
  if (ids.length === 0) {
    return ["==", ["get", "id"], "__none__"];
  }
  return ["in", ["get", "id"], ["literal", ids]];
}
