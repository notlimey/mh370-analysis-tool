import { getMap, toggleLayer, layerVisibility } from "../map";
import { exportPathsGeojson, exportProbabilityGeojson } from "../lib/backend";
import { SONAR_SOURCES, setSonarGroupOpacity, setSonarLayerVisible } from "../layers/sonar";
import {
  defaultAnalysisConfig,
  getAnalysisConfig,
  resetAnalysisConfig,
  updateAnalysisConfig,
} from "../model/config";
import { getFamilyColor } from "../layers/paths";

interface LayerToggle {
  id: string;
  label: string;
}

interface SidebarCallbacks {
  onRunModel: () => void;
  onConfigChange?: () => void;
}

interface FamilySummary {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily?: Record<string, string[]>;
}

const LAYER_TOGGLES: LayerToggle[] = [
  { id: "flightpath", label: "Known Flight Path" },
  { id: "anomalies", label: "Anomaly Markers" },
  { id: "airspaces", label: "2014 Airspaces" },
  { id: "magnetic", label: "EMAG2 Magnetic" },
  { id: "arcs", label: "BTO Arc Rings" },
  { id: "heatmap", label: "Probability Heatmap" },
  { id: "paths", label: "Candidate Paths" },
  { id: "debris", label: "Debris & Drift" },
  { id: "holidays", label: "Data Holidays" },
  { id: "priority", label: "Priority Gaps" },
  { id: "points", label: "Key Points" },
  { id: "searched", label: "Searched Areas" },
];

const NUMERIC_FIELDS = [
  { key: "min_speed_kts", label: "Min speed", step: 5 },
  { key: "max_speed_kts", label: "Max speed", step: 5 },
  { key: "beam_width", label: "Beam width", step: 1 },
  { key: "ring_sample_step", label: "Ring sample step", step: 1 },
  { key: "satellite_drift_amplitude_deg", label: "Sat drift amplitude", step: 0.1 },
  { key: "fuel_remaining_at_arc1_kg", label: "Fuel at arc 1", step: 100 },
  { key: "fuel_baseline_kg_per_hr", label: "Fuel burn baseline", step: 100 },
  { key: "max_post_arc7_minutes", label: "Post-arc 7 mins", step: 1 },
  { key: "debris_weight_min_lat", label: "Debris min lat", step: 0.5 },
  { key: "debris_weight_max_lat", label: "Debris max lat", step: 0.5 },
] as const;

export function initSidebar({ onRunModel, onConfigChange }: SidebarCallbacks): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h1>MH370 Tracker</h1>
      <p class="subtitle">Flight path analysis & probability mapping</p>
    </div>

    <div class="sidebar-section">
      <h2>Layers</h2>
      <div id="layer-toggles"></div>
    </div>

    <div class="sidebar-section">
      <h2>Search Coverage</h2>
      <div id="sonar-toggles" class="sonar-toggles"></div>
      <label class="slider-row">
        <span>Sonar opacity</span>
        <input id="sonar-opacity" type="range" min="0" max="100" step="5" value="85" />
      </label>
    </div>

    <div class="sidebar-section">
      <h2>Model</h2>
      <div class="model-info">
        <div id="confidence-display">
          <span class="label">Highest probability zone</span>
          <span class="value" id="confidence-value">—</span>
        </div>
        <div id="assumptions-display">
          <span class="label">Speed range</span>
          <span class="value" id="speed-range-value">—</span>
          <span class="label">Arc 7 fuel</span>
          <span class="value" id="sat-drift-value">—</span>
          <span class="label">Family spread</span>
          <span class="value" id="family-spread-value">—</span>
        </div>
      </div>
      <div class="tauri-only">
      <div class="model-controls" id="model-controls"></div>
      <div class="button-row">
        <button id="reset-model-btn" class="btn-secondary">Reset</button>
        <button id="run-model-btn" class="btn-primary">Run Model</button>
      </div>
      <div class="button-row export-row">
        <button id="export-probability-btn" class="btn-secondary">Export Heatmap</button>
        <button id="export-paths-btn" class="btn-secondary">Export Paths</button>
      </div>
      </div>
    </div>

    <div class="sidebar-section">
      <h2>Path Families</h2>
      <div id="family-legend" class="family-legend"></div>
      <div id="family-firs" class="family-firs"></div>
    </div>

    <div class="sidebar-section">
      <h2>Flight Path Legend</h2>
      <div class="legend">
        <div class="legend-item">
          <span class="legend-line" style="background:#facc15"></span>
          Confirmed (ATC radar)
        </div>
        <div class="legend-item">
          <span class="legend-line legend-dashed" style="background:#f97316"></span>
          Military radar
        </div>
        <div class="legend-item">
          <span class="legend-line legend-dotted" style="background:#fb7185"></span>
          Probable (inferred)
        </div>
      </div>
    </div>

    <div class="sidebar-section">
      <h2>Info</h2>
      <p class="info-text">
        BTO is the primary constraint here. Satellite state, fuel, and post-arc-7 continuation stay configurable because small assumption shifts can move the endpoint by hundreds of kilometres.
      </p>
    </div>
  `;

  const togglesContainer = document.getElementById("layer-toggles")!;
  for (const toggle of LAYER_TOGGLES) {
    const checked = layerVisibility[toggle.id] ? "checked" : "";
    const div = document.createElement("div");
    div.className = "toggle-row";
    div.innerHTML = `
      <label>
        <input type="checkbox" data-layer="${toggle.id}" ${checked} />
        ${toggle.label}
      </label>
      ${toggle.id === "priority" ? '<div id="priority-note" class="toggle-note">Enable Probability Heatmap first to compute priority gaps.</div>' : ""}
    `;
    togglesContainer.appendChild(div);
  }

  togglesContainer.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    const layer = target.dataset.layer;
    if (layer) {
      if (layer === "priority" && target.checked && !layerVisibility.heatmap) {
        target.checked = false;
        updatePriorityHint();
        window.alert("Enable Probability Heatmap first to compute priority gaps.");
        return;
      }
      toggleLayer(layer, target.checked);
      if (layer === "heatmap" && !target.checked && layerVisibility.priority) {
        const priorityToggle = document.querySelector<HTMLInputElement>('input[data-layer="priority"]');
        if (priorityToggle) {
          priorityToggle.checked = false;
        }
        toggleLayer("priority", false);
      }
      updatePriorityHint();
    }
  });

  renderSonarControls();

  renderModelControls(onConfigChange);
  refreshAssumptionDisplay();
  renderFamilyLegend({ counts: {} });
  updatePriorityHint();

  document.getElementById("run-model-btn")?.addEventListener("click", onRunModel);
  document.getElementById("reset-model-btn")?.addEventListener("click", () => {
    resetAnalysisConfig();
    syncModelControls();
    refreshAssumptionDisplay();
    onConfigChange?.();
  });
  document.getElementById("export-probability-btn")?.addEventListener("click", exportProbability);
  document.getElementById("export-paths-btn")?.addEventListener("click", exportPaths);
}

function updatePriorityHint(): void {
  const note = document.getElementById("priority-note");
  if (!note) return;
  note.style.display = layerVisibility.heatmap ? "none" : "block";
}

function renderSonarControls(): void {
  const container = document.getElementById("sonar-toggles");
  if (!container) return;

  container.innerHTML = SONAR_SOURCES.map((source) => `
    <label class="sonar-row">
      <input type="checkbox" data-sonar-id="${source.id}" ${source.defaultOn ? "checked" : ""} />
      <span>${source.label}</span>
    </label>
    <div class="sonar-desc">${source.description}</div>
  `).join("");

  container.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const sonarId = target.dataset.sonarId;
    if (!sonarId) return;
    try {
      setSonarLayerVisible(getMap(), sonarId, target.checked);
    } catch (err) {
      console.error("Failed to toggle sonar layer:", err);
    }
  });

  const slider = document.getElementById("sonar-opacity") as HTMLInputElement | null;
  slider?.addEventListener("input", () => {
    const opacity = Number(slider.value) / 100;
    try {
      setSonarGroupOpacity(getMap(), opacity);
    } catch (err) {
      console.error("Failed to set sonar opacity:", err);
    }
  });
}

function renderModelControls(onConfigChange?: () => void): void {
  const controls = document.getElementById("model-controls");
  if (!controls) return;

  const config = getAnalysisConfig();
  controls.innerHTML = NUMERIC_FIELDS.map(({ key, label, step }) => `
    <label class="control-row">
      <span>${label}</span>
      <input type="number" data-config-key="${key}" step="${step}" value="${config[key]}" />
    </label>
  `).join("");

  controls.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const key = target.dataset.configKey as keyof typeof config | undefined;
    if (!key) return;
    const nextValue = Number(target.value);
    if (!Number.isFinite(nextValue)) return;
    updateAnalysisConfig({ [key]: nextValue });
    refreshAssumptionDisplay();
    onConfigChange?.();
  });
}

function syncModelControls(): void {
  const config = getAnalysisConfig();
  for (const { key } of NUMERIC_FIELDS) {
    const input = document.querySelector<HTMLInputElement>(`input[data-config-key="${key}"]`);
    if (input) {
      input.value = String(config[key]);
    }
  }
}

function refreshAssumptionDisplay(): void {
  const config = getAnalysisConfig();
  const speedRange = document.getElementById("speed-range-value");
  const satDrift = document.getElementById("sat-drift-value");
  if (speedRange) {
    speedRange.textContent = `${config.min_speed_kts}–${config.max_speed_kts} kts`;
  }
  if (satDrift) {
    satDrift.textContent = "Pending model run";
  }
}

async function exportProbability(): Promise<void> {
  const path = window.prompt("Export probability GeoJSON to:", `${defaultAnalysisConfig.dataset_path.replace("mh370_data.json", "mh370_probability.geojson")}`);
  if (!path) return;
  try {
    const result = await exportProbabilityGeojson(path);
    if (result) window.alert(String(result));
  } catch (err) {
    console.error("Failed to export probability GeoJSON:", err);
  }
}

async function exportPaths(): Promise<void> {
  const path = window.prompt("Export candidate paths GeoJSON to:", `${defaultAnalysisConfig.dataset_path.replace("mh370_data.json", "mh370_paths.geojson")}`);
  if (!path) return;
  try {
    const result = await exportPathsGeojson(path);
    if (result) window.alert(String(result));
  } catch (err) {
    console.error("Failed to export path GeoJSON:", err);
  }
}

export function updateConfidence(value: string): void {
  const el = document.getElementById("confidence-value");
  if (el) el.textContent = value;
}

export function updateModelSummary(summary: {
  family?: string;
  fuel?: string;
  endpoint?: string;
  familySpreadKm?: number;
}): void {
  const speedRange = document.getElementById("speed-range-value");
  const satDrift = document.getElementById("sat-drift-value");
  const familySpread = document.getElementById("family-spread-value");
  if (speedRange && summary.family) {
    speedRange.textContent = `${getAnalysisConfig().min_speed_kts}–${getAnalysisConfig().max_speed_kts} kts / ${summary.family}`;
  }
  if (satDrift && summary.fuel) {
    satDrift.textContent = summary.fuel;
  }
  if (familySpread && summary.familySpreadKm !== undefined) {
    familySpread.textContent = `${Math.round(summary.familySpreadKm)} km`;
  }
  if (summary.endpoint) {
    updateConfidence(summary.endpoint);
  }
}

export function renderFamilyLegend(summary: FamilySummary): void {
  const legend = document.getElementById("family-legend");
  const firsPanel = document.getElementById("family-firs");
  if (!legend) return;

  const descriptions: Record<string, string> = {
    slow: "slow flight, farther from the arc",
    perpendicular: "tangential motion, near-zero BTO change",
    mixed: "combined speed and heading effects",
    other: "remaining feasible paths",
  };

  const families = ["slow", "perpendicular", "mixed", "other"];
  legend.innerHTML = families.map((family) => {
    const count = summary.counts[family] ?? 0;
    return `
      <div class="family-row">
        <span class="swatch" style="background:${getFamilyColor(family)}"></span>
        <span class="label">${family}</span>
        <span class="count">${count}</span>
        <span class="desc">${descriptions[family]}</span>
      </div>
    `;
  }).join("");

  if (!firsPanel) return;
  firsPanel.innerHTML = families.map((family) => {
    const firs = summary.firsByFamily?.[family] ?? [];
    const sensitive = firs.filter((fir) => fir === "VTBB" || fir === "WIIF");
    return `
      <div class="family-fir-row">
        <span class="family-fir-name">${family}</span>
        <span class="family-fir-list">${firs.length > 0 ? firs.join(", ") : "No FIR crossings"}</span>
        ${sensitive.length > 0 ? `<span class="family-fir-flag">Sensitive: ${sensitive.join(", ")}</span>` : ""}
      </div>
    `;
  }).join("");
}

export function getDefaultAnalysisConfig() {
  return { ...defaultAnalysisConfig };
}
