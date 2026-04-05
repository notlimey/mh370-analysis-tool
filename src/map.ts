import mapboxgl from "mapbox-gl";
import { MAP_CENTER, MAP_ZOOM } from "./constants";

/** Layer visibility state */
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
  searched: true,
  "drift-clouds": false,
};

export const layerVisibility: Record<string, boolean> = {
  ...DEFAULT_LAYER_VISIBILITY,
};

let map: mapboxgl.Map | null = null;

/** Initialize the Mapbox map instance */
export function initMap(): mapboxgl.Map {
	mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

	map = new mapboxgl.Map({
		container: "map",
		style: "mapbox://styles/mapbox/standard-satellite",
		config: {
			basename: {
				lightPreset: "night",
				show3dObjects: false,
			},
		},
		center: MAP_CENTER,
		zoom: MAP_ZOOM,
		projection: "mercator",
	});

	map.addControl(new mapboxgl.NavigationControl(), "top-right");
	map.addControl(new mapboxgl.ScaleControl(), "bottom-right");

	// Mapbox measures the container before the grid layout settles — force a resize
	map.once("style.load", () => map!.resize());
	requestAnimationFrame(() => map!.resize());

	return map;
}

/** Get the current map instance */
export function getMap(): mapboxgl.Map {
	if (!map) throw new Error("Map not initialized");
	return map;
}

/** Re-apply current layerVisibility state to all layer groups on the map.
 *  Call this after adding layers to ensure visibility matches the desired state. */
export function applyLayerVisibility(): void {
	for (const [group, visible] of Object.entries(layerVisibility)) {
		toggleLayer(group, visible);
	}
}

export function resetLayerVisibility(): void {
	for (const [group, visible] of Object.entries(DEFAULT_LAYER_VISIBILITY)) {
		toggleLayer(group, visible);
	}
}

/** Toggle a named layer group on or off */
export function toggleLayer(group: string, visible: boolean): void {
	layerVisibility[group] = visible;
	const m = getMap();
	const visibility = visible ? "visible" : "none";

	// Each layer group may have multiple Mapbox layers
	const style = m.getStyle();
	if (!style?.layers) return;

	for (const layer of style.layers) {
		if (layer.id.startsWith(`${group}-`)) {
			m.setLayoutProperty(layer.id, "visibility", visibility);
		}
	}
}
