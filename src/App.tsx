import type { Component } from "solid-js";
import { createEffect, onCleanup, onMount } from "solid-js";
import "./style.css";
import EvidencePanel from "./components/evidence/EvidencePanel";
import BrowserBanner from "./components/layout/BrowserBanner";
import FlyoutShell from "./components/layout/FlyoutShell";
import IconRail from "./components/layout/IconRail";
import Loader from "./components/layout/Loader";
import Timeline from "./components/layout/Timeline";
import MapContainer from "./components/map/MapContainer";
import { MapProvider } from "./contexts/map-context";
import { IS_TAURI } from "./lib/backend";
import { copyAnalysisContextForAi } from "./lib/contextExport";
import {
  downloadSessionSnapshot,
  persistSessionSnapshot,
  scheduleAutoSaveSessionSnapshot,
} from "./lib/sessionSnapshot";
import { applyUrlStateFromHash, scheduleUrlStateSync } from "./lib/urlState";
import { markWorkspaceInputsChanged } from "./lib/workspaceState";
import { analysisConfig, initAnalysisConfig } from "./stores/analysis-config";
import { layerVisibility } from "./stores/layer-visibility";
import { activeScenarioId } from "./stores/scenario";
import { setActivePanel } from "./stores/ui";

const App: Component = () => {
  // Initialize config before render
  onMount(async () => {
    await initAnalysisConfig();
    applyUrlStateFromHash();

    if (!IS_TAURI) {
      document.body.classList.add("browser-mode");
    }
  });

  // Sync URL and auto-save on state changes
  createEffect(() => {
    // Track reactive dependencies
    void JSON.stringify(analysisConfig);
    scheduleUrlStateSync();
    markWorkspaceInputsChanged({ ...analysisConfig } as Parameters<typeof markWorkspaceInputsChanged>[0]);
    scheduleAutoSaveSessionSnapshot();
  });

  createEffect(() => {
    void JSON.stringify(layerVisibility);
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });

  createEffect(() => {
    void activeScenarioId();
    scheduleUrlStateSync();
    scheduleAutoSaveSessionSnapshot();
  });

  // Keyboard shortcuts
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setActivePanel(null);
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyAnalysisContextForAi();
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      downloadSessionSnapshot();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("beforeunload", persistSessionSnapshot);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("beforeunload", persistSessionSnapshot);
  });

  return (
    <MapProvider>
      <IconRail />
      <FlyoutShell />
      <MapContainer />
      <Loader />
      <BrowserBanner />
      <EvidencePanel />
      <Timeline />
    </MapProvider>
  );
};

export default App;
