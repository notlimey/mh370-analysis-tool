import { getBeachingClouds, getSelectedOriginIndex, selectOrigin } from "../layers/drift-clouds";
import type { AnalysisConfig } from "../model/config";
import { defaultConfig, getConfigSnapshot, updateConfig } from "../stores/analysis-config";
import { DEFAULT_LAYER_VISIBILITY, layerVisibility, toggleLayerVisibility } from "../stores/layer-visibility";
import { activeScenarioId, setActiveScenarioId } from "../stores/scenario";

interface ParsedUrlState {
  lat?: number;
  lon?: number;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  layers?: string[];
  scenarioId?: string | null;
  originIndex?: number | null;
  configOverrides?: Partial<AnalysisConfig>;
}

let syncTimer: number | null = null;
let applyingUrlState = false;
let mapInstance: mapboxgl.Map | null = null;

export function setUrlStateMap(map: mapboxgl.Map): void {
  mapInstance = map;
}

export function applyUrlStateFromHash(): void {
  const parsed = parseUrlState(window.location.hash);
  if (!parsed || !mapInstance) return;

  applyingUrlState = true;
  try {
    if (parsed.configOverrides && Object.keys(parsed.configOverrides).length > 0) {
      updateConfig(parsed.configOverrides);
    }

    if (parsed.scenarioId !== undefined) {
      setActiveScenarioId(parsed.scenarioId);
    }

    if (parsed.layers) {
      const requestedLayers = new Set(parsed.layers);
      for (const layerId of Object.keys(DEFAULT_LAYER_VISIBILITY)) {
        toggleLayerVisibility(layerId, requestedLayers.has(layerId));
      }
    }

    const map = mapInstance;
    const nextView: {
      center?: [number, number];
      zoom?: number;
      bearing?: number;
      pitch?: number;
    } = {};

    if (parsed.lon != null && parsed.lat != null) {
      nextView.center = [parsed.lon, parsed.lat];
    }
    if (parsed.zoom != null) nextView.zoom = parsed.zoom;
    if (parsed.bearing != null) nextView.bearing = parsed.bearing;
    if (parsed.pitch != null) nextView.pitch = parsed.pitch;
    if (Object.keys(nextView).length > 0) {
      map.jumpTo(nextView);
    }

    if (parsed.originIndex != null && getBeachingClouds()[parsed.originIndex]) {
      selectOrigin(map, parsed.originIndex);
    }
  } finally {
    applyingUrlState = false;
  }
}

export function scheduleUrlStateSync(): void {
  if (typeof window === "undefined" || applyingUrlState) return;
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    if (mapInstance) {
      window.history.replaceState(null, "", buildShareableUrl());
    }
  }, 180);
}

export async function copyCurrentUrlStateLink(): Promise<string> {
  const url = buildShareableUrl();
  await navigator.clipboard.writeText(url);
  return url;
}

export function buildShareableUrl(): string {
  if (!mapInstance) return window.location.href;
  const map = mapInstance;
  const center = map.getCenter();
  const params = new URLSearchParams();

  params.set("lat", roundNumber(center.lat, 4));
  params.set("lon", roundNumber(center.lng, 4));
  params.set("z", roundNumber(map.getZoom(), 2));

  const bearing = map.getBearing();
  const pitch = map.getPitch();
  if (Math.abs(bearing) > 0.01) {
    params.set("bearing", roundNumber(bearing, 1));
  }
  if (Math.abs(pitch) > 0.01) {
    params.set("pitch", roundNumber(pitch, 1));
  }

  const activeLayers = Object.keys(layerVisibility).filter((id) => layerVisibility[id]);
  if (activeLayers.length > 0) {
    params.set("layers", activeLayers.join(","));
  }

  const scenarioId = activeScenarioId();
  if (scenarioId) {
    params.set("scenario", scenarioId);
  }

  const originIndex = getSelectedOriginIndex();
  if (originIndex != null) {
    params.set("origin", String(originIndex));
  }

  const configOverrides = getConfigOverrides();
  if (configOverrides.length > 0) {
    params.set("cfg", configOverrides.join(","));
  }

  const hash = params.toString();
  return `${window.location.origin}${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`;
}

function getConfigOverrides(): string[] {
  const config = getConfigSnapshot();
  return (Object.keys(defaultConfig) as Array<keyof typeof defaultConfig>)
    .filter((key) => config[key] !== defaultConfig[key])
    .sort()
    .map((key) => `${key}:${encodeURIComponent(String(config[key]))}`);
}

function parseUrlState(hash: string): ParsedUrlState | null {
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!rawHash) return null;

  const params = new URLSearchParams(rawHash);
  const parsed: ParsedUrlState = {};

  parsed.lat = parseOptionalNumber(params.get("lat"));
  parsed.lon = parseOptionalNumber(params.get("lon"));
  parsed.zoom = parseOptionalNumber(params.get("z"));
  parsed.bearing = parseOptionalNumber(params.get("bearing"));
  parsed.pitch = parseOptionalNumber(params.get("pitch"));

  const layers = params.get("layers");
  if (layers) {
    parsed.layers = layers
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const scenarioId = params.get("scenario");
  if (scenarioId !== null) {
    parsed.scenarioId = scenarioId || null;
  }

  const originIndex = parseOptionalNumber(params.get("origin"));
  if (originIndex != null) {
    parsed.originIndex = Math.max(0, Math.round(originIndex));
  }

  const cfg = params.get("cfg");
  if (cfg) {
    parsed.configOverrides = parseConfigOverrides(cfg);
  }

  return parsed;
}

function parseConfigOverrides(value: string): Partial<AnalysisConfig> {
  const overrides: Partial<AnalysisConfig> = {};
  for (const entry of value.split(",")) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = entry.slice(0, separatorIndex).trim();
    const rawValue = decodeURIComponent(entry.slice(separatorIndex + 1));
    if (!(key in defaultConfig)) continue;
    const defaultValue = defaultConfig[key as keyof typeof defaultConfig];
    if (typeof defaultValue === "number") {
      const numeric = Number(rawValue);
      if (Number.isFinite(numeric)) {
        overrides[key as keyof AnalysisConfig] = numeric as never;
      }
      continue;
    }
    overrides[key as keyof AnalysisConfig] = rawValue as never;
  }
  return overrides;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function roundNumber(value: number, digits: number): string {
  return value
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}
