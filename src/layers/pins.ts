import type { Map as MapboxMap, GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import { listSavedPins, type SavedPin } from "../model/pins";

const SOURCE_ID = "pins-source";
let pinPlacementEnabled = false;
let pinPlacementHandler: ((coordinates: [number, number]) => void) | null = null;
let clickBound = false;

export function loadPinsLayer(map: MapboxMap): void {
  const pins = listSavedPins();

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: pinsToFeatureCollection(pins),
    });
  } else {
    refreshPinsLayer(map);
  }

  if (!map.getLayer("pins-markers")) {
    map.addLayer({
      id: "pins-markers",
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 5,
        "circle-color": "#f8fafc",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 1.5,
      },
    });
  }

  if (!map.getLayer("pins-labels")) {
    map.addLayer({
      id: "pins-labels",
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#e5e5e5",
        "text-halo-color": "#000000",
        "text-halo-width": 1.25,
      },
    });
  }

  bindPlacementClick(map);
}

export function refreshPinsLayer(map: MapboxMap): void {
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData(pinsToFeatureCollection(listSavedPins()));
}

export function setPinPlacementMode(
  map: MapboxMap,
  enabled: boolean,
  onPlace: ((coordinates: [number, number]) => void) | null,
): void {
  pinPlacementEnabled = enabled;
  pinPlacementHandler = onPlace;
  map.getCanvas().style.cursor = enabled ? "crosshair" : "";
}

function bindPlacementClick(map: MapboxMap): void {
  if (clickBound) return;
  clickBound = true;
  map.on("click", (event: MapMouseEvent) => {
    if (!pinPlacementEnabled || !pinPlacementHandler) return;
    pinPlacementHandler([event.lngLat.lng, event.lngLat.lat]);
  });
}

function pinsToFeatureCollection(pins: SavedPin[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature" as const,
      properties: { id: pin.id, label: pin.label },
      geometry: {
        type: "Point" as const,
        coordinates: pin.coordinates,
      },
    })),
  };
}
