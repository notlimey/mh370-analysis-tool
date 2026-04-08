import type { Map as MapboxMap } from "mapbox-gl";
import type { Chapter, ChapterMapState, ChapterStep } from "../stores/report";
import { setIsTransitioning } from "../stores/report";

/**
 * Map state transition engine.
 *
 * Reads a chapter's declarative map state and executes the transition:
 * fly-to, ease-to, or jump. Handles layer visibility changes.
 * Processes multi-step choreography sequentially.
 */

// ─── Known layer group prefixes ─────────────────────────────────────────────

/**
 * All known layer group names. Must match the prefixes used in layer IDs
 * (e.g. group "arcs" matches layers "arcs-lines", "arcs-labels").
 *
 * Multi-word groups like "radar-track", "drift-clouds", "eof-compare"
 * need explicit listing — we can't derive them from a first-dash split.
 */
const KNOWN_GROUPS = [
  "arcs",
  "anomalies",
  "airspaces",
  "magnetic",
  "holidays",
  "paths",
  "heatmap",
  "priority",
  "debris",
  "points",
  "pins",
  "searched",
  "eof-compare",
  "flightpath",
  "drift-clouds",
  "radar-track",
  "best-path",
  "north-route",
];

// ─── Layer visibility ───────────────────────────────────────────────────────

/** Hide all layers, then show only the requested groups. */
function applyReportLayers(map: MapboxMap, layerGroups: string[]): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const group of KNOWN_GROUPS) {
    const visible = layerGroups.includes(group);
    const visibility = visible ? "visible" : "none";
    const prefix = `${group}-`;
    for (const layer of style.layers) {
      if (layer.id.startsWith(prefix)) {
        try {
          map.setLayoutProperty(layer.id, "visibility", visibility);
        } catch {
          // Layer may not support visibility
        }
      }
    }
  }
}

// ─── Map movement ───────────────────────────────────────────────────────────

function executeMapMovement(map: MapboxMap, state: ChapterMapState): Promise<void> {
  return new Promise((resolve) => {
    const options = {
      center: state.center,
      zoom: state.zoom,
      pitch: state.pitch ?? 0,
      bearing: state.bearing ?? 0,
      duration: state.duration,
    };

    if (state.animation === "jump") {
      map.jumpTo(options);
      resolve();
      return;
    }

    // For very short moves (same position), resolve quickly
    const currentCenter = map.getCenter();
    const dist = Math.abs(currentCenter.lng - state.center[0]) + Math.abs(currentCenter.lat - state.center[1]);
    const zoomDiff = Math.abs(map.getZoom() - state.zoom);
    if (dist < 0.01 && zoomDiff < 0.1) {
      resolve();
      return;
    }

    let resolved = false;
    const onEnd = () => {
      if (resolved) return;
      resolved = true;
      map.off("moveend", onEnd);
      resolve();
    };
    map.on("moveend", onEnd);

    if (state.animation === "fly_to") {
      map.flyTo({ ...options, essential: true });
    } else {
      map.easeTo({ ...options });
    }

    // Safety timeout
    setTimeout(onEnd, state.duration + 1000);
  });
}

// ─── Step execution ─────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeStep(map: MapboxMap, step: ChapterStep, signal: AbortSignal): Promise<void> {
  if (step.delay && step.delay > 0) {
    await wait(step.delay);
    if (signal.aborted) return;
  }
  if (step.mapState.layers) {
    applyReportLayers(map, step.mapState.layers);
  }
  await executeMapMovement(map, step.mapState);
  if (signal.aborted) return;
  step.mapState.onEnter?.();
}

// ─── Main transition ────────────────────────────────────────────────────────

let abortController: AbortController | null = null;

/**
 * Transition the map to the state defined by a chapter.
 * Handles the primary map state, then executes any choreography steps.
 * Aborts any in-progress transition before starting.
 */
export async function transitionToChapter(map: MapboxMap, chapter: Chapter): Promise<void> {
  // Abort previous transition
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  const signal = abortController.signal;

  setIsTransitioning(true);

  try {
    // Apply layers for the primary state
    if (chapter.mapState.layers) {
      applyReportLayers(map, chapter.mapState.layers);
    }

    // Execute primary map movement
    await executeMapMovement(map, chapter.mapState);
    if (signal.aborted) return;

    chapter.mapState.onEnter?.();

    // Execute choreography steps
    if (chapter.steps) {
      for (const step of chapter.steps) {
        if (signal.aborted) return;
        await executeStep(map, step, signal);
      }
    }
  } finally {
    if (!signal.aborted) {
      setIsTransitioning(false);
    }
  }
}

/**
 * Restore the map to the explore-mode default state.
 */
export function restoreExploreState(_map: MapboxMap): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  setIsTransitioning(false);
}
