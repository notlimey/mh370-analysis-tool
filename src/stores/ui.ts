import { createSignal } from "solid-js";

export type PanelId = "model" | "drift" | "layers" | "evidence" | "export" | "sensitivity" | "bfo";

const [activePanel, setActivePanel] = createSignal<PanelId | null>(null);
const [loaderVisible, setLoaderVisible] = createSignal(true);
const [loaderText, setLoaderText] = createSignal("Loading analysis data");
const [methodologyOpen, setMethodologyOpen] = createSignal(false);
/** True once all map layers have finished loading. */
const [mapReady, setMapReady] = createSignal(false);

export {
  activePanel,
  loaderText,
  loaderVisible,
  mapReady,
  methodologyOpen,
  setActivePanel,
  setLoaderText,
  setLoaderVisible,
  setMapReady,
  setMethodologyOpen,
};
