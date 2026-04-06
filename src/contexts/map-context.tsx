import type { Map as MapboxMap } from "mapbox-gl";
import type { Accessor, ParentComponent } from "solid-js";
import { createContext, createSignal, useContext } from "solid-js";

const MapContext = createContext<{
  map: Accessor<MapboxMap | null>;
  setMap: (m: MapboxMap) => void;
}>();

export const MapProvider: ParentComponent = (props) => {
  const [map, setMap] = createSignal<MapboxMap | null>(null);
  return <MapContext.Provider value={{ map, setMap }}>{props.children}</MapContext.Provider>;
};

export function useMap(): Accessor<MapboxMap | null> {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMap must be used inside MapProvider");
  return ctx.map;
}

export function useSetMap(): (m: MapboxMap) => void {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useSetMap must be used inside MapProvider");
  return ctx.setMap;
}
