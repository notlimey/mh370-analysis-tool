import { createSignal } from "solid-js";

export type PanelId = "model" | "drift" | "layers" | "evidence" | "export" | "sensitivity" | "bfo";

const [activePanel, setActivePanel] = createSignal<PanelId | null>(null);
const [loaderVisible, setLoaderVisible] = createSignal(true);
const [loaderText, setLoaderText] = createSignal("Loading analysis data");
const [methodologyOpen, setMethodologyOpen] = createSignal(false);

export {
  activePanel,
  loaderText,
  loaderVisible,
  methodologyOpen,
  setActivePanel,
  setLoaderText,
  setLoaderVisible,
  setMethodologyOpen,
};
