import type { Map as MapboxMap } from "mapbox-gl";

/**
 * Animated radar track layer for the interactive report.
 *
 * Draws the known MH370 flight path progressively — the line extends
 * from KLIA along the confirmed route, through the turn-back, to the
 * last radar contact. Uses Mapbox line-gradient with a moving trim.
 *
 * Coordinates from Malaysian ICAO Safety Investigation Report (2018) and
 * ATSB "Definition of Underwater Search Areas" (Jun 2014) §2.
 */

// ─── Waypoint data ──────────────────────────────────────────────────────────

interface TrackPoint {
  coordinates: [number, number];
  name: string;
  time_utc: string;
  /** "confirmed" = ATC secondary radar, "military" = primary radar */
  segment: "confirmed" | "military";
}

const TRACK_POINTS: TrackPoint[] = [
  // ATC secondary radar (transponder on)
  { coordinates: [101.71, 2.75], name: "KLIA", time_utc: "16:41", segment: "confirmed" },
  { coordinates: [102.2, 3.5], name: "Climbing FL350", time_utc: "16:46", segment: "confirmed" },
  { coordinates: [103.0, 5.7], name: "Last ACARS", time_utc: "17:07", segment: "confirmed" },
  { coordinates: [103.59, 6.93], name: "IGARI", time_utc: "17:21", segment: "confirmed" },
  // Military primary radar (transponder off)
  { coordinates: [103.3, 6.6], name: "Turn back", time_utc: "17:22", segment: "military" },
  { coordinates: [102.1, 6.3], name: "Re-crossed peninsula", time_utc: "17:30", segment: "military" },
  { coordinates: [102.29, 6.17], name: "Kota Bharu", time_utc: "17:37", segment: "military" },
  { coordinates: [100.27, 5.47], name: "Penang", time_utc: "17:52", segment: "military" },
  { coordinates: [98.95, 5.68], name: "Pulau Perak", time_utc: "18:02", segment: "military" },
  { coordinates: [97.7, 6.8], name: "Last radar contact", time_utc: "18:22", segment: "military" },
];

// IGARI is both end of confirmed and start of military — index 3
const IGARI_INDEX = 3;

// ─── Layer setup ────────────────────────────────────────────────────────────

let animationFrame: number | null = null;

function allCoordinates(): [number, number][] {
  return TRACK_POINTS.map((p) => p.coordinates);
}

/** Load the radar track layers (line + waypoint markers). Initially hidden. */
export function loadRadarTrackLayer(map: MapboxMap): void {
  const coords = allCoordinates();

  // Full track line source
  map.addSource("radar-track-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    },
  });

  // Confirmed segment (solid yellow) — KLIA to IGARI
  map.addSource("radar-track-confirmed-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: coords.slice(0, IGARI_INDEX + 1),
      },
    },
  });

  // Military segment (dashed orange) — IGARI to last radar
  map.addSource("radar-track-military-source", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: coords.slice(IGARI_INDEX),
      },
    },
  });

  map.addLayer({
    id: "radar-track-confirmed",
    type: "line",
    source: "radar-track-confirmed-source",
    paint: {
      "line-color": "#facc15",
      "line-width": 3,
      "line-opacity": 0,
    },
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
  });

  map.addLayer({
    id: "radar-track-military",
    type: "line",
    source: "radar-track-military-source",
    paint: {
      "line-color": "#f97316",
      "line-width": 2.5,
      "line-opacity": 0,
      "line-dasharray": [6, 3],
    },
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
  });

  // Waypoint dots
  map.addSource("radar-track-points-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: TRACK_POINTS.map((pt) => ({
        type: "Feature" as const,
        properties: { name: pt.name, time: pt.time_utc, segment: pt.segment },
        geometry: { type: "Point" as const, coordinates: pt.coordinates },
      })),
    },
  });

  map.addLayer({
    id: "radar-track-dots",
    type: "circle",
    source: "radar-track-points-source",
    paint: {
      "circle-radius": 4,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
      "circle-opacity": 0,
      "circle-stroke-opacity": 0,
    },
    layout: { visibility: "none" },
  });

  map.addLayer({
    id: "radar-track-labels",
    type: "symbol",
    source: "radar-track-points-source",
    layout: {
      "text-field": ["concat", ["get", "name"], "\n", ["get", "time"], " UTC"],
      "text-size": 10,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
      "text-allow-overlap": false,
      visibility: "none",
    },
    paint: {
      "text-color": "#e5e5e5",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
      "text-opacity": 0,
    },
  });
}

// ─── Animation ──────────────────────────────────────────────────────────────

/**
 * Animate the radar track drawing progressively.
 * The line fades in, then the military segment fades in with a pause at IGARI
 * (the turn-back moment).
 *
 * @param totalDurationMs Total animation time
 * @returns Promise that resolves when animation completes
 */
export function animateRadarTrack(map: MapboxMap, totalDurationMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    cancelRadarTrackAnimation();

    // Phase timing (fractions of total duration)
    const confirmedEnd = 0.3; // First 30%: draw confirmed segment
    const pauseEnd = 0.4; // 30-40%: pause at IGARI (the turn-back)
    const militaryEnd = 0.9; // 40-90%: draw military segment
    // 90-100%: fade in labels

    const start = performance.now();

    function frame(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / totalDurationMs, 1);

      // Phase 1: Confirmed segment fades in
      if (t <= confirmedEnd) {
        const phase = t / confirmedEnd;
        map.setPaintProperty("radar-track-confirmed", "line-opacity", phase * 0.9);
        map.setPaintProperty("radar-track-dots", "circle-opacity", phase * 0.8);
        map.setPaintProperty("radar-track-dots", "circle-stroke-opacity", phase * 0.8);
      }

      // Phase 2: Pause at IGARI — confirmed fully visible
      if (t > confirmedEnd && t <= pauseEnd) {
        map.setPaintProperty("radar-track-confirmed", "line-opacity", 0.9);
      }

      // Phase 3: Military segment draws in
      if (t > pauseEnd && t <= militaryEnd) {
        const phase = (t - pauseEnd) / (militaryEnd - pauseEnd);
        map.setPaintProperty("radar-track-military", "line-opacity", phase * 0.85);
      }

      // Phase 4: Labels fade in
      if (t > militaryEnd) {
        const phase = (t - militaryEnd) / (1 - militaryEnd);
        map.setPaintProperty("radar-track-labels", "text-opacity", phase);
      }

      if (t < 1) {
        animationFrame = requestAnimationFrame(frame);
      } else {
        // Ensure final state
        map.setPaintProperty("radar-track-confirmed", "line-opacity", 0.9);
        map.setPaintProperty("radar-track-military", "line-opacity", 0.85);
        map.setPaintProperty("radar-track-dots", "circle-opacity", 0.8);
        map.setPaintProperty("radar-track-dots", "circle-stroke-opacity", 0.8);
        map.setPaintProperty("radar-track-labels", "text-opacity", 1);
        animationFrame = null;
        resolve();
      }
    }

    animationFrame = requestAnimationFrame(frame);
  });
}

/** Show the radar track at full opacity instantly (for returning to a chapter). */
export function showRadarTrackInstant(map: MapboxMap): void {
  cancelRadarTrackAnimation();
  map.setPaintProperty("radar-track-confirmed", "line-opacity", 0.9);
  map.setPaintProperty("radar-track-military", "line-opacity", 0.85);
  map.setPaintProperty("radar-track-dots", "circle-opacity", 0.8);
  map.setPaintProperty("radar-track-dots", "circle-stroke-opacity", 0.8);
  map.setPaintProperty("radar-track-labels", "text-opacity", 1);
}

/** Reset radar track to hidden state. */
export function hideRadarTrack(map: MapboxMap): void {
  cancelRadarTrackAnimation();
  map.setPaintProperty("radar-track-confirmed", "line-opacity", 0);
  map.setPaintProperty("radar-track-military", "line-opacity", 0);
  map.setPaintProperty("radar-track-dots", "circle-opacity", 0);
  map.setPaintProperty("radar-track-dots", "circle-stroke-opacity", 0);
  map.setPaintProperty("radar-track-labels", "text-opacity", 0);
}

export function cancelRadarTrackAnimation(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}
