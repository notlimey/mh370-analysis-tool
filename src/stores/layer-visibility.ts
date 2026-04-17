import { createStore } from "solid-js/store";
import { getStoredLayerVisibility, setStoredLayerVisibility } from "../model/session";

export const DEFAULT_LAYER_VISIBILITY: Record<string, boolean> = {
  flightpath: true,
  anomalies: false,
  airspaces: false,
  magnetic: false,
  holidays: false,
  priority: false,
  arcs: true,
  paths: true,
  heatmap: false,
  debris: false,
  points: true,
  pins: true,
  searched: true,
  "eof-compare": false,
  "drift-clouds": false,
  "best-path": false,
  "north-route": false,
  "radar-track": false,
};

// Only restore stored keys that exist in defaults — prevents stale keys (e.g. "sonar")
// from leaking back in after being removed from the group system.
const stored = getStoredLayerVisibility() ?? {};
const filtered = Object.fromEntries(Object.entries(stored).filter(([key]) => key in DEFAULT_LAYER_VISIBILITY));
const initial = { ...DEFAULT_LAYER_VISIBILITY, ...filtered };
const [layerVisibility, setLayerVisibility] = createStore<Record<string, boolean>>(initial);

export { layerVisibility };

export function toggleLayerVisibility(group: string, visible: boolean): void {
  setLayerVisibility(group, visible);
  setStoredLayerVisibility({ ...layerVisibility });
}

export function resetLayerVisibilityDefaults(): void {
  for (const [group, visible] of Object.entries(DEFAULT_LAYER_VISIBILITY)) {
    setLayerVisibility(group, visible);
  }
  setStoredLayerVisibility({ ...layerVisibility });
}

/** BFO inspection preset: arcs + paths + points only. */
const BFO_INSPECTION_LAYERS: Record<string, boolean> = {
  flightpath: false,
  anomalies: false,
  airspaces: false,
  magnetic: false,
  holidays: false,
  priority: false,
  arcs: true,
  paths: true,
  heatmap: false,
  debris: false,
  points: true,
  pins: false,
  searched: false,
  "eof-compare": false,
  "drift-clouds": false,
  "best-path": false,
  "north-route": false,
  "radar-track": false,
};

let savedBeforeBfo: Record<string, boolean> | null = null;

export function applyBfoInspectionPreset(): void {
  savedBeforeBfo = { ...layerVisibility };
  for (const [group, visible] of Object.entries(BFO_INSPECTION_LAYERS)) {
    setLayerVisibility(group, visible);
  }
}

export function restorePreviousLayerVisibility(): void {
  if (!savedBeforeBfo) return;
  for (const [group, visible] of Object.entries(savedBeforeBfo)) {
    setLayerVisibility(group, visible);
  }
  savedBeforeBfo = null;
}
