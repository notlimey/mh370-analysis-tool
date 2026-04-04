/** Last primary radar contact: 6.8N, 97.7E at 18:22 UTC */
export const LAST_RADAR: [number, number] = [97.7, 6.8];

/** Inmarsat-3F1 sub-satellite point */
export const SATELLITE: [number, number] = [64.5, 0.0];

/** KLIA departure point */
export const KLIA: [number, number] = [101.71, 2.75];

/** Initial map center: Southern Indian Ocean */
export const MAP_CENTER: [number, number] = [90, -20];

/** Initial zoom level */
export const MAP_ZOOM = 3;

/**
 * Approximate bounding polygons for searched areas.
 * Coordinates as [lon, lat] rings.
 */
export const SEARCHED_2014_2017: [number, number][] = [
  [93.0, -20.0],
  [93.0, -39.0],
  [98.0, -39.0],
  [98.0, -20.0],
  [93.0, -20.0],
];

export const SEARCHED_2018: [number, number][] = [
  [93.5, -28.0],
  [93.5, -36.0],
  [97.0, -36.0],
  [97.0, -28.0],
  [93.5, -28.0],
];

export const SEARCHED_2025_2026: [number, number][] = [
  [95.0, -30.0],
  [95.0, -36.0],
  [100.0, -36.0],
  [100.0, -30.0],
  [95.0, -30.0],
];
