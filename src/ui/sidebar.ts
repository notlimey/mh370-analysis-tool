import { getMap, toggleLayer, layerVisibility } from "../map";
import { exportPathsGeojson, exportProbabilityGeojson } from "../lib/backend";
import { zoomToPriorityGaps } from "../layers/priority";
import { SONAR_SOURCES, setSonarGroupOpacity, setSonarLayerVisible } from "../layers/sonar";
import {
  defaultAnalysisConfig,
  getAnalysisConfig,
  resetAnalysisConfig,
  updateAnalysisConfig,
} from "../model/config";
import { getFamilyColor } from "../layers/paths";
import { ensureModelSummaryPanel, updateModelSummaryPanel } from "./modelSummary";
import { openInfoDetail } from "./evidencePanel";
import { SCENARIOS, type ScenarioPreset } from "../model/scenarios";
import { applyScenario, clearScenario } from "../lib/scenarioManager";
import { wireDriftPanel, renderDriftPanel } from "./sidebarDrift";
import { initInversionControls, renderInversionSection } from "./sidebarInversion";

interface LayerToggle {
  id: string;
  label: string;
  infoId: string;
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
  { id: "flightpath", label: "Known Flight Path", infoId: "layer:flightpath" },
  { id: "anomalies", label: "Anomaly Markers", infoId: "layer:anomalies" },
  { id: "airspaces", label: "2014 Airspaces", infoId: "layer:airspaces" },
  { id: "magnetic", label: "EMAG2 Magnetic", infoId: "layer:magnetic" },
  { id: "arcs", label: "BTO Arc Rings", infoId: "layer:arcs" },
  { id: "heatmap", label: "Probability Heatmap", infoId: "layer:heatmap" },
  { id: "paths", label: "Candidate Paths", infoId: "layer:paths" },
  { id: "debris", label: "Debris & Drift", infoId: "layer:debris" },
  { id: "holidays", label: "Data Holidays", infoId: "layer:holidays" },
  { id: "priority", label: "Priority Gaps", infoId: "layer:priority" },
  { id: "points", label: "Key Points", infoId: "layer:points" },
  { id: "searched", label: "Searched Areas", infoId: "layer:searched" },
  { id: "drift-clouds", label: "Drift Beaching Sim", infoId: "layer:drift-clouds" },
];

const NUMERIC_FIELDS = [
  { key: "min_speed_kts", label: "Min speed", step: 5, infoId: "config:min_speed_kts" },
  { key: "max_speed_kts", label: "Max speed", step: 5, infoId: "config:max_speed_kts" },
  { key: "beam_width", label: "Beam width", step: 1, infoId: "config:beam_width" },
  { key: "ring_sample_step", label: "Ring sample step", step: 1, infoId: "config:ring_sample_step" },
  { key: "satellite_drift_amplitude_deg", label: "Sat drift amplitude", step: 0.1, infoId: "config:satellite_drift_amplitude_deg" },
  { key: "fuel_remaining_at_arc1_kg", label: "Fuel at arc 1", step: 100, infoId: "config:fuel_remaining_at_arc1_kg" },
  { key: "fuel_baseline_kg_per_hr", label: "Fuel burn baseline", step: 100, infoId: "config:fuel_baseline_kg_per_hr" },
  { key: "max_post_arc7_minutes", label: "Post-arc 7 mins", step: 1, infoId: "config:max_post_arc7_minutes" },
  { key: "debris_weight_min_lat", label: "Debris min lat", step: 0.5, infoId: "config:debris_weight_min_lat" },
  { key: "debris_weight_max_lat", label: "Debris max lat", step: 0.5, infoId: "config:debris_weight_max_lat" },
] as const;

const PRIORITY_GAP_FOCUS_PRESET: Record<string, boolean> = {
  flightpath: false,
  anomalies: false,
  airspaces: false,
  magnetic: false,
  arcs: false,
  heatmap: true,
  paths: false,
  debris: false,
  holidays: false,
  priority: true,
  points: false,
  searched: true,
  sonar: false,
};

let sidebarCallbacks: SidebarCallbacks | null = null;
let sidebarInfoClickBound = false;

export function initSidebar(callbacks: SidebarCallbacks): void {
  sidebarCallbacks = callbacks;
  bindSidebarInfoClick();
  renderSidebar(null);
}

function bindSidebarInfoClick(): void {
  if (sidebarInfoClickBound) return;
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  sidebar.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-info-id]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const infoId = button.dataset.infoId;
    if (infoId) openInfoDetail(infoId);
  });
  sidebarInfoClickBound = true;
}

function renderSidebar(scenario: ScenarioPreset | null): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const isDrift = scenario?.id === "drift_analysis";

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h1>MH370 Tracker</h1>
      <p class="subtitle">Flight path analysis & probability mapping</p>
    </div>

    <div class="sidebar-section">
      <div class="section-heading"><h2>Scenario</h2></div>
      <select id="scenario-dropdown" class="scenario-dropdown">
        <option value="">— Select scenario —</option>
        ${SCENARIOS.map((s) => `<option value="${s.id}" ${scenario?.id === s.id ? "selected" : ""}>${s.name}</option>`).join("")}
      </select>
      ${scenario ? `<div id="scenario-narrative" class="scenario-narrative">${scenario.narrative}</div>` : ""}
    </div>

    ${isDrift ? renderDriftPanel() : renderStandardPanels()}
  `;

  wireScenarioDropdown();

  if (isDrift) {
    wireDriftPanel();
  } else {
    wireStandardPanels();
  }
}

// ── Scenario dropdown ──────────────────────────────────────────────

function wireScenarioDropdown(): void {
  const dropdown = document.getElementById("scenario-dropdown") as HTMLSelectElement | null;
  dropdown?.addEventListener("change", () => {
    const id = dropdown.value;
    if (!id) {
      clearScenario({
        syncModelControls,
        syncLayerToggles,
      });
      renderSidebar(null);
      sidebarCallbacks?.onConfigChange?.();
      sidebarCallbacks?.onRunModel();
      return;
    }
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) return;

    applyScenario(scenario, {
      onConfigChange: () => {
        sidebarCallbacks?.onConfigChange?.();
        // Re-render sidebar with new scenario BEFORE running model
        renderSidebar(scenario);
        sidebarCallbacks?.onRunModel();
      },
      syncModelControls: () => {},
      syncLayerToggles,
    });
  });
}

// ── Standard panels (non-drift scenarios) ──────────────────────────

function renderStandardPanels(): string {
  return `
    <div class="sidebar-section">
      <div class="section-heading"><h2>Layers</h2><button class="info-icon-button" type="button" data-info-id="section:layers" aria-label="About Layers">i</button></div>
      <div class="button-row">
        <button id="focus-priority-btn" class="btn-secondary">Focus Priority Gaps</button>
        <button class="info-icon-button button-info" type="button" data-info-id="layer:priority" aria-label="About Priority Gaps">i</button>
      </div>
      <div id="layer-toggles"></div>
    </div>

    <div class="sidebar-section">
      <div class="section-heading"><h2>Search Coverage</h2><button class="info-icon-button" type="button" data-info-id="section:search" aria-label="About Search Coverage">i</button></div>
      <div id="sonar-toggles" class="sonar-toggles"></div>
      <label class="slider-row">
        <span class="field-with-info"><span>Sonar opacity</span><button class="info-icon-button" type="button" data-info-id="control:sonar-opacity" aria-label="About Sonar Opacity">i</button></span>
        <input id="sonar-opacity" type="range" min="0" max="100" step="5" value="85" />
      </label>
    </div>

    <div class="sidebar-section">
      <div class="section-heading"><h2>Model</h2><button class="info-icon-button" type="button" data-info-id="section:model" aria-label="About Model">i</button></div>
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
      <div class="button-row info-action-row">
        <button class="info-icon-button button-info" type="button" data-info-id="action:reset-model" aria-label="About Reset">i</button>
        <button class="info-icon-button button-info" type="button" data-info-id="action:run-model" aria-label="About Run Model">i</button>
      </div>
      <div class="button-row info-action-row export-row">
        <button class="info-icon-button button-info" type="button" data-info-id="action:export-heatmap" aria-label="About Export Heatmap">i</button>
        <button class="info-icon-button button-info" type="button" data-info-id="action:export-paths" aria-label="About Export Paths">i</button>
      </div>
      </div>
    </div>

    ${renderInversionSection("standard")}

    <div class="sidebar-section">
      <div class="section-heading"><h2>Path Families</h2><button class="info-icon-button" type="button" data-info-id="section:path-families" aria-label="About Path Families">i</button></div>
      <div id="family-legend" class="family-legend"></div>
      <div id="family-firs" class="family-firs"></div>
    </div>

    <div class="sidebar-section">
      <div class="section-heading"><h2>Flight Path Legend</h2><button class="info-icon-button" type="button" data-info-id="section:legend" aria-label="About Flight Path Legend">i</button></div>
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
      <div class="section-heading"><h2>Info</h2><button class="info-icon-button" type="button" data-info-id="section:info" aria-label="About Info">i</button></div>
      <p class="info-text">
        BTO is the primary constraint here. Satellite state, fuel, and post-arc-7 continuation stay configurable because small assumption shifts can move the endpoint by hundreds of kilometres.
      </p>
    </div>
  `;
}

function wireStandardPanels(): void {
  if (!sidebarCallbacks) return;
  const { onRunModel, onConfigChange } = sidebarCallbacks;
  const togglesContainer = document.getElementById("layer-toggles")!;
  for (const toggle of LAYER_TOGGLES) {
    const checked = layerVisibility[toggle.id] ? "checked" : "";
    const div = document.createElement("div");
    div.className = "toggle-row";
    div.innerHTML = `
      <label class="toggle-main">
        <input type="checkbox" data-layer="${toggle.id}" ${checked} />
        <span>${toggle.label}</span>
      </label>
      <button class="info-icon-button" type="button" data-info-id="${toggle.infoId}" aria-label="About ${toggle.label}">i</button>
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
        if (priorityToggle) priorityToggle.checked = false;
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
  ensureModelSummaryPanel();
  updateModelSummaryPanel({});
  initInversionControls();

  document.getElementById("focus-priority-btn")?.addEventListener("click", focusPriorityGaps);
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

// ── Shared utilities ───────────────────────────────────────────────

function updatePriorityHint(): void {
  const note = document.getElementById("priority-note");
  if (!note) return;
  note.style.display = layerVisibility.heatmap ? "none" : "block";
}

function focusPriorityGaps(): void {
  const map = getMap();
  for (const [layer, visible] of Object.entries(PRIORITY_GAP_FOCUS_PRESET)) {
    toggleLayer(layer, visible);
  }
  syncLayerToggles();
  updatePriorityHint();
  zoomToPriorityGaps(map);
}

function syncLayerToggles(): void {
  for (const toggle of LAYER_TOGGLES) {
    const input = document.querySelector<HTMLInputElement>(`input[data-layer="${toggle.id}"]`);
    if (input) input.checked = Boolean(layerVisibility[toggle.id]);
  }
}

function renderSonarControls(): void {
  const container = document.getElementById("sonar-toggles");
  if (!container) return;

  container.innerHTML = SONAR_SOURCES.map((source) => `
    <div class="sonar-row">
      <label class="toggle-main">
        <input type="checkbox" data-sonar-id="${source.id}" ${source.defaultOn ? "checked" : ""} />
        <span>${source.label}</span>
      </label>
      <button class="info-icon-button" type="button" data-info-id="sonar:${source.id}" aria-label="About ${source.label}">i</button>
    </div>
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
  controls.innerHTML = NUMERIC_FIELDS.map(({ key, label, step, infoId }) => `
    <label class="control-row">
      <span class="field-with-info"><span>${label}</span><button class="info-icon-button" type="button" data-info-id="${infoId}" aria-label="About ${label}">i</button></span>
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
    if (input) input.value = String(config[key]);
  }
}

function refreshAssumptionDisplay(): void {
  const config = getAnalysisConfig();
  const speedRange = document.getElementById("speed-range-value");
  const satDrift = document.getElementById("sat-drift-value");
  if (speedRange) speedRange.textContent = `${config.min_speed_kts}–${config.max_speed_kts} kts`;
  if (satDrift) satDrift.textContent = "Pending model run";
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

// ── Public API (used by main.ts) ───────────────────────────────────

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
  if (satDrift && summary.fuel) satDrift.textContent = summary.fuel;
  if (familySpread && summary.familySpreadKm !== undefined) {
    familySpread.textContent = `${Math.round(summary.familySpreadKm)} km`;
  }
  if (summary.endpoint) updateConfidence(summary.endpoint);
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
