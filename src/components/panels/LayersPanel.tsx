import type { Component } from "solid-js";
import { createSignal, For } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { hideRadarTrack, showRadarTrackInstant } from "../../layers/radar-track";
import { SONAR_SOURCES, setSonarLayerVisible } from "../../layers/sonar";
import { COVERAGE_SOURCES, setSonarCoverageVisible } from "../../layers/sonar-coverage";
import { layerVisibility, toggleLayerVisibility } from "../../stores/layer-visibility";

interface LayerToggle {
  group: string;
  label: string;
}

const LAYER_TOGGLES: LayerToggle[] = [
  { group: "flightpath", label: "Flight path" },
  { group: "radar-track", label: "Radar track (animated)" },
  { group: "best-path", label: "Best-fit path + Arc 7 crossing" },
  { group: "arcs", label: "BTO arcs" },
  { group: "north-route", label: "Northern route (ruled out)" },
  { group: "paths", label: "Candidate paths" },
  { group: "heatmap", label: "Path density heatmap" },
  { group: "points", label: "Key points" },
  { group: "pins", label: "Saved pins" },
  { group: "searched", label: "Searched areas" },
  { group: "debris", label: "Debris findings" },
  { group: "drift-clouds", label: "Drift clouds" },
  { group: "anomalies", label: "Anomaly markers" },
  { group: "airspaces", label: "2014 airspaces" },
  { group: "magnetic", label: "Magnetic anomalies" },
  { group: "holidays", label: "Data gaps" },
  { group: "priority", label: "Priority gaps" },
  { group: "eof-compare", label: "EOF comparison" },
];

const LayersPanel: Component = () => {
  const map = useMap();

  const [sonarStates, setSonarStates] = createSignal<Record<string, boolean>>(
    Object.fromEntries(SONAR_SOURCES.map((s) => [s.id, s.defaultOn])),
  );

  const [coverageStates, setCoverageStates] = createSignal<Record<string, boolean>>(
    Object.fromEntries(COVERAGE_SOURCES.map((s) => [s.id, false])),
  );

  const handleToggle = (group: string, checked: boolean) => {
    toggleLayerVisibility(group, checked);
    const m = map();
    if (!m) return;

    if (group === "radar-track") {
      if (checked) showRadarTrackInstant(m);
      else hideRadarTrack(m);
    }

    const style = m.getStyle();
    if (!style?.layers) return;
    const visibility = checked ? "visible" : "none";
    for (const layer of style.layers) {
      if (layer.id.startsWith(`${group}-`)) {
        m.setLayoutProperty(layer.id, "visibility", visibility);
      }
    }
  };

  const handleSonarToggle = (id: string, checked: boolean) => {
    setSonarStates((prev) => ({ ...prev, [id]: checked }));
    const m = map();
    if (!m) return;
    setSonarLayerVisible(m, id, checked);
  };

  const handleCoverageToggle = (id: string, checked: boolean) => {
    setCoverageStates((prev) => ({ ...prev, [id]: checked }));
    const m = map();
    if (!m) return;
    setSonarCoverageVisible(m, id, checked);
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

        <div class="layer-group-heading">Search Coverage (derived)</div>
        <For each={COVERAGE_SOURCES}>
          {(source) => (
            <label class="toggle-row toggle-row-indent">
              <input
                type="checkbox"
                checked={coverageStates()[source.id] ?? false}
                onChange={(e) => handleCoverageToggle(source.id, e.currentTarget.checked)}
              />
              <span>{source.label}</span>
            </label>
          )}
        </For>

        <div class="layer-group-heading">Sonar / Scan Data (WMS raster)</div>
        <For each={SONAR_SOURCES}>
          {(source) => (
            <label class="toggle-row toggle-row-indent">
              <input
                type="checkbox"
                checked={sonarStates()[source.id] ?? false}
                onChange={(e) => handleSonarToggle(source.id, e.currentTarget.checked)}
              />
              <span title={source.description}>{source.label}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  );
};

export default LayersPanel;
