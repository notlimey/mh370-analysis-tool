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
/** ATSB Phase 2 (2014–2017): ~120,000 km², 39.4°S to 33°S along 7th arc */
export const SEARCHED_2014_2017: [number, number][] = [
  [93.0, -33.0],
  [93.0, -39.4],
  [98.0, -39.4],
  [98.0, -33.0],
  [93.0, -33.0],
];

/** Ocean Infinity 2018 (Jan–Jun): ~112,000 km², 36°S to 24.7°S */
export const SEARCHED_2018: [number, number][] = [
  [93.5, -24.7],
  [93.5, -36.0],
  [97.0, -36.0],
  [97.0, -24.7],
  [93.5, -24.7],
];

/** Ocean Infinity 2025–2026 (Mar 2025–Jan 2026): ~7,571 km² of planned 15,000 km², ~33°S to 25°S */
export const SEARCHED_2025_2026: [number, number][] = [
  [95.0, -25.0],
  [95.0, -33.0],
  [100.0, -33.0],
  [100.0, -25.0],
  [95.0, -25.0],
];
