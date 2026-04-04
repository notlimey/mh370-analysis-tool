import type { Map } from "mapbox-gl";

/**
 * Known MH370 flight path waypoints.
 *
 * CONFIRMED — tracked by secondary radar (transponder) or primary radar (military).
 * PROBABLE  — high-confidence inference from radar gaps, timing, and satellite data.
 *
 * All coordinates as [lon, lat].
 */

interface Waypoint {
  name: string;
  coordinates: [number, number];
  time_utc: string;
}

// Confirmed by ATC secondary radar (transponder on)
const CONFIRMED_WAYPOINTS: Waypoint[] = [
  { name: "KLIA Runway 32R", coordinates: [101.71, 2.75], time_utc: "16:41" },
  { name: "Climbing FL350", coordinates: [102.2, 3.5], time_utc: "16:46" },
  { name: "Last ACARS", coordinates: [103.0, 5.7], time_utc: "17:07" },
  { name: "IGARI (transponder lost)", coordinates: [103.59, 6.93], time_utc: "17:21" },
];

// Tracked by Malaysian military primary radar (no transponder)
const MILITARY_RADAR_WAYPOINTS: Waypoint[] = [
  { name: "IGARI (transponder lost)", coordinates: [103.59, 6.93], time_utc: "17:21" },
  { name: "Turn back", coordinates: [103.3, 6.6], time_utc: "17:22" },
  { name: "Re-crossed peninsula", coordinates: [102.1, 6.3], time_utc: "17:30" },
  { name: "Kota Bharu", coordinates: [102.29, 6.17], time_utc: "17:37" },
  { name: "Penang", coordinates: [100.27, 5.47], time_utc: "17:52" },
  { name: "Pulau Perak", coordinates: [98.95, 5.68], time_utc: "18:02" },
  { name: "Last radar contact", coordinates: [97.7, 6.8], time_utc: "18:22" },
];

// High-confidence inference: after last radar, before Arc 1
// Based on 3 min gap (18:22→18:25) and Arc 1 BTO distance constraint
const PROBABLE_WAYPOINTS: Waypoint[] = [
  { name: "Last radar contact", coordinates: [97.7, 6.8], time_utc: "18:22" },
  { name: "SDU reboot (Arc 1)", coordinates: [97.3, 6.5], time_utc: "18:25" },
  { name: "Probable initial turn S", coordinates: [95.0, 4.5], time_utc: "~18:40" },
  { name: "Heading south", coordinates: [93.5, 2.0], time_utc: "~19:00" },
];

function waypointsToLine(waypoints: Waypoint[]): [number, number][] {
  return waypoints.map((w) => w.coordinates);
}

function waypointsToPoints(waypoints: Waypoint[]) {
  return waypoints.map((w) => ({
    type: "Feature" as const,
    properties: { name: w.name, time: w.time_utc },
    geometry: {
      type: "Point" as const,
      coordinates: w.coordinates,
    },
  }));
}

/** Draw the known and probable flight path on the map */
export function loadFlightPathLayer(map: Map): void {
  // --- Confirmed path (solid yellow line) ---
  map.addSource("flightpath-confirmed-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: waypointsToLine(CONFIRMED_WAYPOINTS),
      },
    },
  });

  map.addLayer({
    id: "flightpath-confirmed-line",
    type: "line",
    source: "flightpath-confirmed-source",
    paint: {
      "line-color": "#facc15",
      "line-width": 3,
      "line-opacity": 0.9,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  // --- Military radar path (dashed orange line) ---
  map.addSource("flightpath-military-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: waypointsToLine(MILITARY_RADAR_WAYPOINTS),
      },
    },
  });

  map.addLayer({
    id: "flightpath-military-line",
    type: "line",
    source: "flightpath-military-source",
    paint: {
      "line-color": "#f97316",
      "line-width": 2.5,
      "line-opacity": 0.85,
      "line-dasharray": [6, 3],
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  // --- Probable path (dotted red/pink line) ---
  map.addSource("flightpath-probable-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: waypointsToLine(PROBABLE_WAYPOINTS),
      },
    },
  });

  map.addLayer({
    id: "flightpath-probable-line",
    type: "line",
    source: "flightpath-probable-source",
    paint: {
      "line-color": "#fb7185",
      "line-width": 2,
      "line-opacity": 0.7,
      "line-dasharray": [2, 3],
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  // --- Waypoint dots (all three segments, deduplicated) ---
  const allWaypoints = [
    ...CONFIRMED_WAYPOINTS,
    ...MILITARY_RADAR_WAYPOINTS.slice(1), // skip duplicate IGARI
    ...PROBABLE_WAYPOINTS.slice(1), // skip duplicate last radar
  ];

  map.addSource("flightpath-waypoints-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: waypointsToPoints(allWaypoints),
    },
  });

  map.addLayer({
    id: "flightpath-waypoint-dots",
    type: "circle",
    source: "flightpath-waypoints-source",
    paint: {
      "circle-radius": 4,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "flightpath-waypoint-labels",
    type: "symbol",
    source: "flightpath-waypoints-source",
    layout: {
      "text-field": ["concat", ["get", "name"], "\n", ["get", "time"], " UTC"],
      "text-size": 10,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#e5e5e5",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });
}
