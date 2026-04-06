export function formatLatLon(lat: number, lon: number, digits = 1): string {
  const latHemisphere = lat < 0 ? "S" : "N";
  const lonHemisphere = lon < 0 ? "W" : "E";
  return `~${Math.abs(lat).toFixed(digits)}${latHemisphere}, ${Math.abs(lon).toFixed(digits)}${lonHemisphere}`;
}

export function formatLatLonDeg(lat?: number, lon?: number, digits = 2): string {
  if (lat == null || lon == null) return "\u2014";
  const latHemisphere = lat < 0 ? "S" : "N";
  const lonHemisphere = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(digits)}\u00b0${latHemisphere}, ${Math.abs(lon).toFixed(digits)}\u00b0${lonHemisphere}`;
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function centroid(points: [number, number][]): [number, number] | undefined {
  if (points.length === 0) return undefined;
  const sums = points.reduce<[number, number]>((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return [sums[0] / points.length, sums[1] / points.length];
}

export function longitudinalKm(from: [number, number], to: [number, number]): number {
  const averageLatRad = (((from[1] + to[1]) / 2) * Math.PI) / 180;
  return (to[0] - from[0]) * 111.32 * Math.cos(averageLatRad);
}

export function latitudinalKm(from: [number, number], to: [number, number]): number {
  return (to[1] - from[1]) * 111.32;
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
