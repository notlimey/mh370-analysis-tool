import { invoke } from "@tauri-apps/api/core";

interface AirspaceProperties {
  id: string;
  name: string;
  icao: string;
  type: string;
}

type AirspaceFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, AirspaceProperties>;

let airspacesCache: GeoJSON.FeatureCollection | null = null;

export async function getAirspacesGeoJson(): Promise<GeoJSON.FeatureCollection> {
  if (airspacesCache) {
    return airspacesCache;
  }
  airspacesCache = await invoke<GeoJSON.FeatureCollection>("get_airspaces");
  return airspacesCache;
}

export async function getFIRsForPath(points: [number, number][]): Promise<string[]> {
  const geojson = await getAirspacesGeoJson();
  const crossed = new Set<string>();

  for (const feature of geojson.features as AirspaceFeature[]) {
    if (!feature.properties || feature.properties.type !== "FIR") continue;
    if (!feature.geometry) continue;

    const matches = points.some(([lon, lat]) => pointInGeometry(lon, lat, feature.geometry));
    if (matches) {
      crossed.add(feature.properties.icao);
    }
  }

  return Array.from(crossed);
}

function pointInGeometry(lon: number, lat: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(lon, lat, geometry.coordinates[0] as [number, number][]);
  }

  return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon[0] as [number, number][]));
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
