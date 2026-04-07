import { createStore } from "solid-js/store";
import { getStoredLayerVisibility, setStoredLayerVisibility } from "../model/session";

export const DEFAULT_LAYER_VISIBILITY: Record<string, boolean> = {
  flightpath: true,
  anomalies: false,
  airspaces: false,
  magnetic: false,
  sonar: true,
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
};

const initial = { ...DEFAULT_LAYER_VISIBILITY, ...(getStoredLayerVisibility() ?? {}) };
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
  sonar: false,
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
