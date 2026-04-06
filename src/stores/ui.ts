import { createSignal } from "solid-js";

export type PanelId = "model" | "drift" | "layers" | "evidence" | "export" | "sensitivity";

const [activePanel, setActivePanel] = createSignal<PanelId | null>(null);
const [loaderVisible, setLoaderVisible] = createSignal(true);
const [loaderText, setLoaderText] = createSignal("Loading analysis data");

export { activePanel, loaderText, loaderVisible, setActivePanel, setLoaderText, setLoaderVisible };
