import type { Map as MapboxMap } from "mapbox-gl";
import { getFIRsForPath } from "../model/airspaces";
import {
  getCandidatePaths,
  type BackendBfoDiagnostic,
  type BackendBfoSummary,
} from "../lib/backend";
import type { AnalysisConfig } from "../model/config";

export interface FlightPath {
  points: [number, number][];
  score: number;
  initial_heading: number;
  headings_deg?: number[];
  family: string;
  fuel_feasible: boolean;
  fuel_remaining_at_arc7_kg: number;
  extra_endurance_minutes?: number;
  extra_range_nm?: number;
  bfo_summary?: BackendBfoSummary;
  bfo_diagnostics?: BackendBfoDiagnostic[];
}

export interface PathAnnotation {
  path: FlightPath;
  firs: string[];
}

const FAMILY_COLORS: Record<string, string> = {
  slow: "#f59e0b",
  perpendicular: "#3b82f6",
  mixed: "#a855f7",
  other: "#6b7280",
};

const FAMILY_ORDER = ["slow", "perpendicular", "mixed", "other"];

export async function fetchCandidatePaths(n = 120, config?: AnalysisConfig): Promise<FlightPath[]> {
  return getCandidatePaths(n, config) as Promise<FlightPath[]>;
}

export async function annotatePaths(paths: FlightPath[]): Promise<PathAnnotation[]> {
  let firsPerPath: string[][];
  try {
    firsPerPath = await Promise.all(paths.map((path) => getFIRsForPath(path.points)));
  } catch (error) {
    console.error("Failed to annotate candidate paths with FIR crossings:", error);
    firsPerPath = paths.map(() => []);
  }
  return paths.map((path, index) => ({ path, firs: firsPerPath[index] }));
}

/** Draw candidate flight paths grouped by family */
export async function loadPathsLayer(
  map: MapboxMap,
  providedPaths?: FlightPath[],
  providedAnnotations?: PathAnnotation[],
): Promise<void> {
  const paths = providedPaths ?? await fetchCandidatePaths(120);
  const annotations = providedAnnotations ?? await annotatePaths(paths);
  const endpointAreaFeatures = buildEndpointAreaFeatures(annotations);
  const continuationAreaFeatures = buildContinuationAreaFeatures(annotations);
  const continuationLineFeatures = buildContinuationLineFeatures(annotations);

  if (endpointAreaFeatures.length > 0) {
    map.addSource("paths-endpoint-areas-source", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: endpointAreaFeatures,
      },
    });

    map.addLayer({
      id: "paths-endpoint-areas-fill",
      type: "fill",
      source: "paths-endpoint-areas-source",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.1,
      },
    });

    map.addLayer({
      id: "paths-endpoint-areas-outline",
      type: "line",
      source: "paths-endpoint-areas-source",
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.8,
        "line-width": 1.5,
      },
    });
  }

  if (continuationAreaFeatures.length > 0) {
    map.addSource("paths-post-arc7-areas-source", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: continuationAreaFeatures,
      },
    });

    map.addLayer({
      id: "paths-post-arc7-areas-fill",
      type: "fill",
      source: "paths-post-arc7-areas-source",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.07,
      },
    });

    map.addLayer({
      id: "paths-post-arc7-areas-outline",
      type: "line",
      source: "paths-post-arc7-areas-source",
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.45,
        "line-width": 1,
        "line-dasharray": [2, 2],
      },
    });
  }

  if (continuationLineFeatures.length > 0) {
    map.addSource("paths-post-arc7-lines-source", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: continuationLineFeatures,
      },
    });

    map.addLayer({
      id: "paths-post-arc7-lines",
      type: "line",
      source: "paths-post-arc7-lines-source",
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.16,
        "line-width": 1.2,
        "line-dasharray": [1.5, 2],
      },
    });
  }

  for (const family of FAMILY_ORDER) {
    const familyPaths = annotations.filter(({ path }) => path.family === family);
    const sourceId = `paths-${family}-source`;
    const layerId = `paths-${family}-lines`;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: familyPaths.map(({ path, firs }) => ({
          type: "Feature" as const,
          properties: {
            score: path.score,
            heading: Math.round(path.initial_heading),
            family: path.family,
            fuel: Math.round(path.fuel_remaining_at_arc7_kg),
            firs: firs.join(", "),
            firCount: firs.length,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: path.points,
          },
        })),
      },
    });

    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": FAMILY_COLORS[family],
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["get", "score"],
          0,
          family === "other" ? 0.08 : 0.12,
          1,
          family === "mixed" ? 0.22 : 0.28,
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["get", "score"],
          0,
          0.5,
          1,
          2.5,
        ],
      },
    });
  }
}

export function getFamilyColor(family: string): string {
  return FAMILY_COLORS[family] ?? FAMILY_COLORS.other;
}

function buildEndpointAreaFeatures(
  annotations: PathAnnotation[],
): GeoJSON.Feature<GeoJSON.Polygon, { family: string; color: string; count: number }>[] {
  return FAMILY_ORDER.flatMap((family) => {
    const familyPaths = annotations
      .filter(({ path }) => path.family === family)
      .sort((left, right) => right.path.score - left.path.score)
      .slice(0, 40);
    const endpoints = familyPaths
      .map(({ path }) => path.points[path.points.length - 1])
      .filter((point): point is [number, number] => Array.isArray(point));
    const hull = convexHull(endpoints);
    if (!hull) return [];

    return [{
      type: "Feature",
      properties: {
        family,
        color: getFamilyColor(family),
        count: endpoints.length,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[...hull, hull[0]]],
      },
    }];
  });
}

function buildContinuationAreaFeatures(
  annotations: PathAnnotation[],
): GeoJSON.Feature<GeoJSON.Polygon, { family: string; color: string; count: number }>[] {
  return FAMILY_ORDER.flatMap((family) => {
    const points = topFamilyPaths(annotations, family)
      .flatMap(({ path }) => {
        const continuation = getContinuation(path);
        if (!continuation) return [];
        return [continuation.from, continuation.to];
      });
    const hull = convexHull(points);
    if (!hull) return [];

    return [{
      type: "Feature",
      properties: {
        family,
        color: getFamilyColor(family),
        count: points.length,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[...hull, hull[0]]],
      },
    }];
  });
}

function buildContinuationLineFeatures(
  annotations: PathAnnotation[],
): GeoJSON.Feature<GeoJSON.LineString, { family: string; color: string; score: number }>[] {
  return FAMILY_ORDER.flatMap((family) => topFamilyPaths(annotations, family)
    .flatMap(({ path }) => {
      const continuation = getContinuation(path);
      if (!continuation) return [];
      return [{
        type: "Feature" as const,
        properties: {
          family,
          color: getFamilyColor(family),
          score: path.score,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [continuation.from, continuation.to],
        },
      }];
    }));
}

function topFamilyPaths(annotations: PathAnnotation[], family: string): PathAnnotation[] {
  return annotations
    .filter(({ path }) => path.family === family)
    .sort((left, right) => right.path.score - left.path.score)
    .slice(0, 40);
}

function getContinuation(path: FlightPath): { from: [number, number]; to: [number, number] } | undefined {
  const from = path.points[path.points.length - 1];
  const heading = path.headings_deg?.[path.headings_deg.length - 1];
  const extraRangeNm = path.extra_range_nm ?? 0;
  if (!from || heading === undefined || extraRangeNm <= 0) {
    return undefined;
  }
  const to = destinationPoint(from, heading, extraRangeNm * 1.852);
  return { from, to };
}

function destinationPoint(origin: [number, number], bearingDeg: number, distanceKm: number): [number, number] {
  const earthRadiusKm = 6371;
  const [lon, lat] = origin;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearingRad = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

function convexHull(points: [number, number][]): [number, number][] | undefined {
  const uniquePoints = Array.from(
    new Map(points.map((point) => [`${point[0].toFixed(6)},${point[1].toFixed(6)}`, point])).values(),
  ).sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  if (uniquePoints.length < 3) {
    return undefined;
  }

  const cross = (origin: [number, number], a: [number, number], b: [number, number]): number => (
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
  );

  const lower: [number, number][] = [];
  for (const point of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: [number, number][] = [];
  for (const point of [...uniquePoints].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : undefined;
}
