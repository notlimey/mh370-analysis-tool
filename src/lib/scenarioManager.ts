import { setSelectedAnomaly } from "../layers/anomalies";
import type { ScenarioPreset } from "../model/scenarios";
import { resetConfig, updateConfig } from "../stores/analysis-config";
import { clearEvidence } from "../stores/evidence";
import {
  DEFAULT_LAYER_VISIBILITY,
  resetLayerVisibilityDefaults,
  toggleLayerVisibility,
} from "../stores/layer-visibility";
import { setActiveScenarioId } from "../stores/scenario";

export function applyScenario(
  map: mapboxgl.Map,
  scenario: ScenarioPreset,
  callbacks: {
    onConfigChange?: () => void;
    syncModelControls?: () => void;
    syncLayerToggles?: () => void;
  },
): void {
  setActiveScenarioId(scenario.id);

  // 1. Apply config overrides
  resetConfig();
  updateConfig(scenario.configOverrides);
  callbacks.syncModelControls?.();

  // 2. Apply full layer visibility state
  for (const [layer, defaultVisible] of Object.entries(DEFAULT_LAYER_VISIBILITY)) {
    const visible = scenario.layerVisibility[layer] ?? defaultVisible;
    toggleLayerVisibility(layer, visible);
    // Apply to map
    const style = map.getStyle();
    if (style?.layers) {
      const vis = visible ? "visible" : "none";
      for (const mapLayer of style.layers) {
        if (mapLayer.id.startsWith(`${layer}-`)) {
          map.setLayoutProperty(mapLayer.id, "visibility", vis);
        }
      }
    }
  }
  callbacks.syncLayerToggles?.();

  // 3. Fly to scenario viewport
  map.flyTo({
    center: scenario.viewport.center,
    zoom: scenario.viewport.zoom,
    duration: 1800,
  });

  // 4. Highlight relevant anomalies
  if (scenario.relevantAnomalyIds.length > 0) {
    setSelectedAnomaly(map, scenario.relevantAnomalyIds[0]);
  } else {
    setSelectedAnomaly(map, null);
  }

  // 5. Trigger config change
  callbacks.onConfigChange?.();
}

export function clearScenario(
  map: mapboxgl.Map,
  callbacks: {
    syncModelControls?: () => void;
    syncLayerToggles?: () => void;
  },
): void {
  setActiveScenarioId(null);
  resetConfig();
  resetLayerVisibilityDefaults();
  // Apply to map
  const style = map.getStyle();
  if (style?.layers) {
    for (const [group, visible] of Object.entries(DEFAULT_LAYER_VISIBILITY)) {
      const vis = visible ? "visible" : "none";
      for (const layer of style.layers) {
        if (layer.id.startsWith(`${group}-`)) {
          map.setLayoutProperty(layer.id, "visibility", vis);
        }
      }
    }
  }
  setSelectedAnomaly(map, null);
  clearEvidence();
  callbacks.syncModelControls?.();
  callbacks.syncLayerToggles?.();
}
