import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import type { BackendBeachingCloud, BackendBeachedParticle } from "../lib/backend";

const SOURCE_BEACHED = "drift-clouds-beached";
const SOURCE_ORIGINS = "drift-clouds-origins";
const SOURCE_TRACES = "drift-clouds-traces";
const SOURCE_ACTUAL = "drift-clouds-actual-finds";
const SOURCE_DRIFTING = "drift-clouds-drifting";

// Actual confirmed/probable MH370 debris find locations for comparison
const ACTUAL_FINDS: { name: string; lon: number; lat: number; confirmed: boolean }[] = [
  { name: "Flaperon — Réunion", lon: 55.5, lat: -20.9, confirmed: true },
  { name: "Flap track — Mozambique", lon: 33.5, lat: -25.0, confirmed: false },
  { name: "NO STEP panel — Mozambique", lon: 34.8, lat: -19.5, confirmed: false },
  { name: "Engine cowl — Mozambique", lon: 35.4, lat: -17.9, confirmed: false },
  { name: "Panel — Mossel Bay, SA", lon: 22.1, lat: -34.2, confirmed: false },
  { name: "Interior — Mauritius", lon: 57.5, lat: -20.3, confirmed: false },
  { name: "Outboard flap — Tanzania", lon: 39.8, lat: -5.1, confirmed: true },
  { name: "Window — Rodrigues Is.", lon: 63.4, lat: -19.7, confirmed: false },
  { name: "Interior — Tanzania", lon: 40.0, lat: -8.5, confirmed: false },
  { name: "Flap — Mauritius", lon: 57.5, lat: -20.3, confirmed: true },
  { name: "Panel — Madagascar", lon: 49.8, lat: -16.0, confirmed: false },
  { name: "Broken O — Madagascar", lon: 47.6, lat: -13.4, confirmed: false },
  { name: "Panel — Nosy Boraha, Madagascar", lon: 50.0, lat: -16.9, confirmed: false },
  { name: "Panel — Maputo, Mozambique", lon: 32.9, lat: -25.9, confirmed: false },
];

/** Module state */
let allClouds: BackendBeachingCloud[] = [];
let selectedOriginIdx: number | null = null;

/** Listeners for selection changes (used by drift sidebar panel) */
type SelectionListener = (idx: number | null, cloud: BackendBeachingCloud | null) => void;
const selectionListeners: SelectionListener[] = [];
const stateSelectionListeners: SelectionListener[] = [];

export function onOriginSelectionChange(listener: SelectionListener): void {
  // Clear previous listeners to avoid stacking on sidebar re-renders
  selectionListeners.length = 0;
  selectionListeners.push(listener);
}

export function onDriftOriginStateChange(listener: SelectionListener): void {
  stateSelectionListeners.push(listener);
}

export function getBeachingClouds(): BackendBeachingCloud[] {
  return allClouds;
}

export function getSelectedOriginIndex(): number | null {
  return selectedOriginIdx;
}

export function selectOrigin(map: MapboxMap, idx: number | null): void {
  selectedOriginIdx = idx;
  rebuildDynamicSources(map);
  notifyListeners();
}

function notifyListeners(): void {
  const cloud = selectedOriginIdx !== null ? allClouds[selectedOriginIdx] ?? null : null;
  for (const listener of selectionListeners) {
    listener(selectedOriginIdx, cloud);
  }
  for (const listener of stateSelectionListeners) {
    listener(selectedOriginIdx, cloud);
  }
}

/** Color for a cloud index */
function cloudColor(idx: number, total: number): string {
  const t = total > 1 ? idx / (total - 1) : 0.5;
  const hue = Math.round(180 - t * 160); // cyan → orange
  return `hsl(${hue}, 85%, 55%)`;
}

/** Initialize map sources, layers, and interaction handlers — no data fetch. */
export function initDriftCloudsLayer(map: MapboxMap): void {
  // --- Static source: actual finds (always visible) ---
  const actualFeatures: GeoJSON.Feature[] = ACTUAL_FINDS.map((f) => ({
    type: "Feature" as const,
    properties: { name: f.name, confirmed: f.confirmed },
    geometry: { type: "Point" as const, coordinates: [f.lon, f.lat] },
  }));

  map.addSource(SOURCE_ACTUAL, {
    type: "geojson",
    data: { type: "FeatureCollection", features: actualFeatures },
  });

  // --- Dynamic sources ---
  map.addSource(SOURCE_ORIGINS, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(SOURCE_BEACHED, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(SOURCE_TRACES, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(SOURCE_DRIFTING, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // --- Layers ---
  map.addLayer({
    id: "drift-clouds-traces",
    type: "line",
    source: SOURCE_TRACES,
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": 0.5,
      "line-width": 1.5,
      "line-dasharray": [6, 4],
    },
  });

  map.addLayer({
    id: "drift-clouds-drifting",
    type: "circle",
    source: SOURCE_DRIFTING,
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        3, ["case", ["get", "selected"], 3.5, 2],
        6, ["case", ["get", "selected"], 5, 3],
        9, ["case", ["get", "selected"], 8, 4],
      ],
      "circle-color": ["get", "color"],
      "circle-opacity": ["case", ["get", "selected"], 0.6, 0.3],
      "circle-stroke-color": [
        "case", ["get", "selected"], "rgba(255,255,255,0.3)", "rgba(255,255,255,0.1)",
      ],
      "circle-stroke-width": ["case", ["get", "selected"], 1, 0.5],
    },
  });

  map.addLayer({
    id: "drift-clouds-beached",
    type: "circle",
    source: SOURCE_BEACHED,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 6, 6, 9, 10],
      "circle-color": [
        "interpolate", ["linear"], ["get", "days"],
        100, "#3b82f6",  // blue — fast arrival
        250, "#22d3ee",  // cyan
        400, "#22c55e",  // green
        550, "#eab308",  // yellow
        700, "#f97316",  // orange
        900, "#ef4444",  // red — slow arrival
      ],
      "circle-opacity": 0.8,
      "circle-stroke-color": "rgba(0,0,0,0.3)",
      "circle-stroke-width": 0.5,
    },
  });

  map.addLayer({
    id: "drift-clouds-origins",
    type: "circle",
    source: SOURCE_ORIGINS,
    paint: {
      "circle-radius": ["case", ["get", "selected"], 9, 6],
      "circle-color": ["get", "color"],
      "circle-stroke-color": ["case", ["get", "selected"], "#facc15", "#ffffff"],
      "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
    },
  });

  map.addLayer({
    id: "drift-clouds-actual",
    type: "circle",
    source: SOURCE_ACTUAL,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 9, 9, 13],
      "circle-color": ["case", ["get", "confirmed"], "#ef4444", "#f59e0b"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "drift-clouds-actual-labels",
    type: "symbol",
    source: SOURCE_ACTUAL,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 10,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-max-width": 12,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  map.addLayer({
    id: "drift-clouds-labels",
    type: "symbol",
    source: SOURCE_ORIGINS,
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["case", ["get", "selected"], 12, 10],
      "text-offset": [0, -1.4],
      "text-anchor": "bottom",
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  // Click handler — select/deselect origin
  map.on("click", "drift-clouds-origins", (e) => {
    if (!e.features || e.features.length === 0) return;
    // Mapbox serializes properties as strings — parse idx back to number
    const clickedIdx = Number(e.features[0].properties?.idx);
    if (!Number.isFinite(clickedIdx)) return;
    if (selectedOriginIdx === clickedIdx) {
      selectedOriginIdx = null;
    } else {
      selectedOriginIdx = clickedIdx;
    }
    rebuildDynamicSources(map);
    notifyListeners();
  });

  map.on("mouseenter", "drift-clouds-origins", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "drift-clouds-origins", () => {
    map.getCanvas().style.cursor = "";
  });

  // Hover popup for beached particles — shows coast + transit days
  const beachPopup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: "mh370-popup",
    maxWidth: "200px",
  });

  map.on("mouseenter", "drift-clouds-beached", (e) => {
    if (!e.features?.length) return;
    map.getCanvas().style.cursor = "pointer";
    const props = e.features[0].properties;
    if (!props) return;
    beachPopup
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${props.coast}</strong><br>${props.days} days`)
      .addTo(map);
  });
  map.on("mousemove", "drift-clouds-beached", (e) => {
    if (e.features?.length) beachPopup.setLngLat(e.lngLat);
  });
  map.on("mouseleave", "drift-clouds-beached", () => {
    map.getCanvas().style.cursor = "";
    beachPopup.remove();
  });

  rebuildDynamicSources(map);
  notifyListeners();
}

/** Inject simulation results into already-initialized map layers. */
export function populateDriftClouds(map: MapboxMap, clouds: BackendBeachingCloud[]): void {
  allClouds = clouds;
  selectedOriginIdx = null;
  rebuildDynamicSources(map);
  notifyListeners();
}

function rebuildDynamicSources(map: MapboxMap): void {
  const originFeatures: GeoJSON.Feature[] = [];
  const beachedFeatures: GeoJSON.Feature[] = [];
  const traceFeatures: GeoJSON.Feature[] = [];
  const driftingFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < allClouds.length; i++) {
    const cloud = allClouds[i];
    const color = cloudColor(i, allClouds.length);
    const isSelected = selectedOriginIdx === i;
    const showBeaching = selectedOriginIdx === null || selectedOriginIdx === i;
    const pctBeached = Math.round(cloud.beaching_fraction * 100);

    // Origin marker — always shown
    originFeatures.push({
      type: "Feature",
      properties: {
        idx: i,
        selected: isSelected,
        origin_lat: cloud.origin_lat,
        label: isSelected
          ? `${Math.abs(cloud.origin_lat).toFixed(1)}°S — ${pctBeached}% beached — ${cloud.match_score}/${cloud.match_total} finds`
          : `${Math.abs(cloud.origin_lat).toFixed(1)}°S (${cloud.match_score}/${cloud.match_total})`,
        color: selectedOriginIdx !== null && !isSelected ? "rgba(128,128,128,0.4)" : color,
      },
      geometry: { type: "Point", coordinates: [cloud.origin_lon, cloud.origin_lat] },
    });

    if (!showBeaching) continue;

    for (const bp of cloud.beached) {
      beachedFeatures.push({
        type: "Feature",
        properties: { color, days: Math.round(bp.days), coast: bp.coast },
        geometry: { type: "Point", coordinates: [bp.lon, bp.lat] },
      });
    }

    for (const [lon, lat] of cloud.still_drifting) {
      driftingFeatures.push({
        type: "Feature",
        properties: { color, selected: isSelected },
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    }

    // Trace line to centroid of still-drifting particles (so user can find them)
    if (cloud.still_drifting.length > 0 && isSelected) {
      const centLon = cloud.still_drifting.reduce((s, p) => s + p[0], 0) / cloud.still_drifting.length;
      const centLat = cloud.still_drifting.reduce((s, p) => s + p[1], 0) / cloud.still_drifting.length;
      traceFeatures.push({
        type: "Feature",
        properties: { color, coast: "Still drifting", count: cloud.still_drifting.length },
        geometry: {
          type: "LineString",
          coordinates: [[cloud.origin_lon, cloud.origin_lat], [centLon, centLat]],
        },
      });
    }

    const coastGroups = groupByCoast(cloud);
    for (const [coast, particles] of Object.entries(coastGroups)) {
      if (!isSelected) continue;
      if (particles.length === 0) continue;
      const centLon = particles.reduce((s, p) => s + p.lon, 0) / particles.length;
      const centLat = particles.reduce((s, p) => s + p.lat, 0) / particles.length;
      traceFeatures.push({
        type: "Feature",
        properties: { color, coast, count: particles.length },
        geometry: {
          type: "LineString",
          coordinates: [[cloud.origin_lon, cloud.origin_lat], [centLon, centLat]],
        },
      });
    }
  }

  (map.getSource(SOURCE_ORIGINS) as GeoJSONSource | undefined)
    ?.setData({ type: "FeatureCollection", features: originFeatures });
  (map.getSource(SOURCE_BEACHED) as GeoJSONSource | undefined)
    ?.setData({ type: "FeatureCollection", features: beachedFeatures });
  (map.getSource(SOURCE_TRACES) as GeoJSONSource | undefined)
    ?.setData({ type: "FeatureCollection", features: traceFeatures });
  (map.getSource(SOURCE_DRIFTING) as GeoJSONSource | undefined)
    ?.setData({ type: "FeatureCollection", features: driftingFeatures });
}

function groupByCoast(cloud: BackendBeachingCloud): Record<string, BackendBeachedParticle[]> {
  const groups: Record<string, BackendBeachedParticle[]> = {};
  for (const bp of cloud.beached) {
    if (!groups[bp.coast]) groups[bp.coast] = [];
    groups[bp.coast].push(bp);
  }
  return groups;
}

export function removeDriftCloudsLayer(map: MapboxMap): void {
  const layers = [
    "drift-clouds-labels",
    "drift-clouds-actual-labels",
    "drift-clouds-actual",
    "drift-clouds-origins",
    "drift-clouds-beached",
    "drift-clouds-drifting",
    "drift-clouds-traces",
  ];
  for (const id of layers) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch { /* already removed */ }
    }
  }
  for (const id of [SOURCE_BEACHED, SOURCE_ORIGINS, SOURCE_TRACES, SOURCE_ACTUAL, SOURCE_DRIFTING]) {
    if (map.getSource(id)) {
      try { map.removeSource(id); } catch { /* already removed */ }
    }
  }
  allClouds = [];
  selectedOriginIdx = null;
}
