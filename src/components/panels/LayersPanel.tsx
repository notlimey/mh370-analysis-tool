import type { Component } from "solid-js";
import { For } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { layerVisibility, toggleLayerVisibility } from "../../stores/layer-visibility";

interface LayerToggle {
  group: string;
  label: string;
}

const LAYER_TOGGLES: LayerToggle[] = [
  { group: "flightpath", label: "Flight path" },
  { group: "arcs", label: "BTO arcs" },
  { group: "paths", label: "Candidate paths" },
  { group: "heatmap", label: "Probability heatmap" },
  { group: "points", label: "Key points" },
  { group: "pins", label: "Saved pins" },
  { group: "searched", label: "Searched areas" },
  { group: "debris", label: "Debris findings" },
  { group: "drift-clouds", label: "Drift clouds" },
  { group: "anomalies", label: "Anomaly markers" },
  { group: "sonar", label: "Sonar detections" },
  { group: "airspaces", label: "2014 airspaces" },
  { group: "magnetic", label: "Magnetic anomalies" },
  { group: "holidays", label: "Data gaps" },
  { group: "priority", label: "Priority gaps" },
  { group: "eof-compare", label: "EOF comparison" },
];

const LayersPanel: Component = () => {
  const map = useMap();

  const handleToggle = (group: string, checked: boolean) => {
    toggleLayerVisibility(group, checked);
    const m = map();
    if (!m) return;
    const style = m.getStyle();
    if (!style?.layers) return;
    const visibility = checked ? "visible" : "none";
    for (const layer of style.layers) {
      if (layer.id.startsWith(`${group}-`)) {
        m.setLayoutProperty(layer.id, "visibility", visibility);
      }
    }
  };

  return (
    <div class="sidebar-section-inner">
      <div class="section-heading">
        <h2>Map Layers</h2>
      </div>
      <div class="layer-toggles">
        <For each={LAYER_TOGGLES}>
          {(toggle) => (
            <label class="toggle-row">
              <input
                type="checkbox"
                checked={layerVisibility[toggle.group] ?? false}
                onChange={(e) => handleToggle(toggle.group, e.currentTarget.checked)}
              />
              <span>{toggle.label}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  );
};

export default LayersPanel;
