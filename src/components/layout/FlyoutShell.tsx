import type { Component } from "solid-js";
import { lazy, Match, Show, Switch } from "solid-js";
import type { PanelId } from "../../stores/ui";
import { activePanel, setActivePanel } from "../../stores/ui";

const ModelPanel = lazy(() => import("../panels/ModelPanel"));
const DriftPanel = lazy(() => import("../panels/DriftPanel"));
const LayersPanel = lazy(() => import("../panels/LayersPanel"));
const EvidenceBrowsePanel = lazy(() => import("../panels/EvidenceBrowsePanel"));
const ExportPanel = lazy(() => import("../panels/ExportPanel"));
const SensitivityPanel = lazy(() => import("../panels/SensitivityPanel"));

function panelTitle(id: PanelId): string {
  switch (id) {
    case "model":
      return "Model";
    case "drift":
      return "Drift Analysis";
    case "layers":
      return "Layers";
    case "evidence":
      return "Evidence";
    case "export":
      return "Export & History";
    case "sensitivity":
      return "Sensitivity Analysis";
  }
}

const FlyoutShell: Component = () => {
  return (
    <div id="flyout-panel" class="flyout-panel" classList={{ open: activePanel() != null }}>
      <Show when={activePanel()}>
        {(panel) => (
          <>
            <div class="flyout-header">
              <h2 class="flyout-title">{panelTitle(panel())}</h2>
              <button class="flyout-close" aria-label="Close panel" type="button" onClick={() => setActivePanel(null)}>
                &times;
              </button>
            </div>
            <div class="flyout-body">
              <Switch>
                <Match when={panel() === "model"}>
                  <ModelPanel />
                </Match>
                <Match when={panel() === "drift"}>
                  <DriftPanel />
                </Match>
                <Match when={panel() === "layers"}>
                  <LayersPanel />
                </Match>
                <Match when={panel() === "evidence"}>
                  <EvidenceBrowsePanel />
                </Match>
                <Match when={panel() === "export"}>
                  <ExportPanel />
                </Match>
                <Match when={panel() === "sensitivity"}>
                  <SensitivityPanel />
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default FlyoutShell;
