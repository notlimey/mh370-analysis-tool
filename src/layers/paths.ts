import type { Map as MapboxMap } from "mapbox-gl";
import { getFIRsForPath } from "../model/airspaces";
import { getCandidatePaths } from "../lib/backend";

export interface FlightPath {
  points: [number, number][];
  score: number;
  initial_heading: number;
  family: string;
  fuel_feasible: boolean;
  fuel_remaining_at_arc7_kg: number;
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

export async function fetchCandidatePaths(n = 120): Promise<FlightPath[]> {
  return getCandidatePaths(n) as Promise<FlightPath[]>;
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
