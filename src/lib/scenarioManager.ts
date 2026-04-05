import { getMap, toggleLayer, DEFAULT_LAYER_VISIBILITY, resetLayerVisibility } from "../map";
import { updateAnalysisConfig, resetAnalysisConfig } from "../model/config";
import type { ScenarioPreset } from "../model/scenarios";
import { setSelectedAnomaly } from "../layers/anomalies";
import { clearEvidenceSelection } from "../ui/evidencePanel";

let activeScenarioId: string | null = null;

export function getActiveScenarioId(): string | null {
  return activeScenarioId;
}

export function applyScenario(
  scenario: ScenarioPreset,
  callbacks: {
    onConfigChange?: () => void;
    syncModelControls?: () => void;
    syncLayerToggles?: () => void;
  },
): void {
  activeScenarioId = scenario.id;
  const map = getMap();

  // 1. Apply config overrides
  resetAnalysisConfig();
  updateAnalysisConfig(scenario.configOverrides);
  callbacks.syncModelControls?.();

  // 2. Apply full layer visibility state so scenarios do not leak into each other.
  for (const [layer, defaultVisible] of Object.entries(DEFAULT_LAYER_VISIBILITY)) {
    const visible = scenario.layerVisibility[layer] ?? defaultVisible;
    toggleLayer(layer, visible);
  }
  callbacks.syncLayerToggles?.();

  // 3. Fly to scenario viewport
  map.flyTo({
    center: scenario.viewport.center,
    zoom: scenario.viewport.zoom,
    duration: 1800,
  });

  // 4. Highlight relevant anomalies (first one if any)
  if (scenario.relevantAnomalyIds.length > 0) {
    setSelectedAnomaly(map, scenario.relevantAnomalyIds[0]);
  } else {
    setSelectedAnomaly(map, null);
  }

  // 5. Trigger config change so the model can rerun
  callbacks.onConfigChange?.();
}

export function clearScenario(callbacks: {
  syncModelControls?: () => void;
  syncLayerToggles?: () => void;
}): void {
  activeScenarioId = null;
  resetAnalysisConfig();
  resetLayerVisibility();
  const map = getMap();
  setSelectedAnomaly(map, null);
  clearEvidenceSelection();
  callbacks.syncModelControls?.();
  callbacks.syncLayerToggles?.();
}
