import type { Component } from "solid-js";
import { createEffect, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
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
import { appMode, setAppMode } from "./stores/report";
import { activeScenarioId } from "./stores/scenario";
import { methodologyOpen, setActivePanel, setMethodologyOpen } from "./stores/ui";

const MethodologyView = lazy(() => import("./components/methodology/MethodologyView"));
const ReportView = lazy(() => import("./components/report/ReportView"));

const App: Component = () => {
  // Initialize config before render
  onMount(async () => {
    await initAnalysisConfig();
    applyUrlStateFromHash();

    if (!IS_TAURI) {
      document.body.classList.add("browser-mode");
    }

    // Tauri desktop app goes straight to explore mode
    if (IS_TAURI) {
      setAppMode("explore");
    }
  });

  // Sync body class with app mode
  createEffect(() => {
    const mode = appMode();
    if (mode === "report") {
      document.body.classList.add("report-mode");
    } else {
      document.body.classList.remove("report-mode");
    }
  });

  // Sync URL and auto-save on state changes
  createEffect(() => {
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
      if (methodologyOpen()) {
        setMethodologyOpen(false);
      } else {
        setActivePanel(null);
      }
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

  const inReport = () => appMode() === "report";
  const inExplore = () => appMode() === "explore";

  return (
    <MapProvider>
      {/* Report mode: narrative panel alongside the map */}
      <Show when={inReport()}>
        <Suspense>
          <ReportView />
        </Suspense>
      </Show>

      {/* Explore mode: full tool UI */}
      <Show when={inExplore()}>
        <div style={{ display: methodologyOpen() ? "none" : "contents" }}>
          <IconRail />
          <FlyoutShell />
          <BrowserBanner />
          <EvidencePanel />
          <Timeline />
        </div>
        <Show when={methodologyOpen()}>
          <Suspense>
            <MethodologyView />
          </Suspense>
        </Show>
      </Show>

      {/* Map and loader are always present */}
      <MapContainer />
      <Loader />
    </MapProvider>
  );
};

export default App;
