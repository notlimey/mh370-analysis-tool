import { getMap, toggleLayer, layerVisibility } from "../map";
import type { GeoJSONSource, LngLatBoundsLike } from "mapbox-gl";
import { exportPathsGeojson, exportProbabilityGeojson } from "../lib/backend";
import type { BackendBfoDiagnostic, BackendBfoSummary } from "../lib/backend";
import { getArcRingByArc, highlightArc } from "../layers/arcs";
import { zoomToPriorityGaps } from "../layers/priority";
import { SONAR_SOURCES, setSonarGroupOpacity, setSonarLayerVisible } from "../layers/sonar";
import {
  defaultAnalysisConfig,
  getAnalysisConfig,
  getResolvedConfigView,
  resetAnalysisConfig,
  updateAnalysisConfig,
} from "../model/config";
import type { AnalysisConfig } from "../model/config";
import { getFamilyColor } from "../layers/paths";
import { loadPinsLayer, refreshPinsLayer, setPinPlacementMode } from "../layers/pins";
import { ensureModelSummaryPanel, updateModelSummaryPanel } from "./modelSummary";
import { openInfoDetail } from "./evidencePanel";
import { SCENARIOS, type ScenarioPreset } from "../model/scenarios";
import { getSavedRun, listConfigDiffs, listSavedRuns, saveRun } from "../model/runs";
import { listSavedPins, removePin, savePin, updatePin } from "../model/pins";
import type { SavedRun } from "../model/runs";
import { applyScenario, clearScenario, getActiveScenarioId } from "../lib/scenarioManager";
import { wireDriftPanel, renderDriftPanel } from "./sidebarDrift";
import { initInversionControls, renderInversionSection } from "./sidebarInversion";
import { generateComparisonReport, generateRunReport } from "./report";

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
  endpointNarrative?: string;
}

interface ModelRunStatus {
  state: "idle" | "running" | "completed" | "failed";
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  pathCount?: number;
  heatmapCount?: number;
  bestFamily?: string;
  bfoDiagnosticCount?: number;
  bfoAvailable?: boolean;
  error?: string;
}

interface ModelResultSummary {
  bestFamily?: string;
  bestScore?: number;
  endpointCounts: Record<string, number>;
  fuelFeasiblePercent?: number;
  bfoMeanAbsResidualHz?: number;
  bestEndpointLat?: number;
  bestEndpointLon?: number;
  peakLat?: number;
  peakLon?: number;
  searchedOverlapLabel?: string;
  continuationLabel?: string;
  pathCount: number;
  heatmapCount: number;
}

interface RunChange {
  type: "config" | "result";
  label: string;
  detail: string;
}

interface ConfigFieldMeta {
  key: keyof AnalysisConfig;
  description: string;
}

const CONFIG_FIELD_META: ConfigFieldMeta[] = [
  { key: "dataset_path", description: "Dataset JSON path; empty uses the embedded dataset." },
  { key: "ring_points", description: "Points generated around each BTO ring before path sampling." },
  { key: "ring_sample_step", description: "Subsampling stride applied to ring points during path generation." },
  { key: "beam_width", description: "Best partial paths kept after each handshake step." },
  { key: "min_speed_kts", description: "Minimum allowed inter-arc groundspeed." },
  { key: "max_speed_kts", description: "Maximum allowed inter-arc groundspeed." },
  { key: "speed_consistency_sigma_kts", description: "Gaussian sigma for speed-change penalty between legs." },
  { key: "heading_change_sigma_deg", description: "Gaussian sigma for heading-change penalty between legs." },
  { key: "bfo_sigma_hz", description: "Gaussian sigma used for BFO residual weighting." },
  { key: "bfo_score_weight", description: "Linear weight of the BFO term in total path score." },
  { key: "cruise_altitude_ft", description: "Assumed cruise altitude for the aircraft state." },
  { key: "calibration_altitude_ft", description: "Altitude assumed during BTO calibration." },
  { key: "satellite_nominal_lon_deg", description: "Nominal sub-satellite longitude." },
  { key: "satellite_nominal_lat_deg", description: "Nominal sub-satellite latitude baseline." },
  { key: "satellite_drift_start_lat_offset_deg", description: "Start offset for the satellite latitude drift model." },
  { key: "satellite_drift_amplitude_deg", description: "Amplitude of the sinusoidal satellite latitude drift correction." },
  { key: "satellite_drift_end_time_utc", description: "End time anchoring the satellite drift interpolation." },
  { key: "fuel_remaining_at_arc1_kg", description: "Fuel assumed remaining at Arc 1." },
  { key: "fuel_baseline_kg_per_hr", description: "Baseline burn rate at the reference speed and altitude." },
  { key: "fuel_baseline_speed_kts", description: "Reference speed for fuel burn scaling." },
  { key: "fuel_baseline_altitude_ft", description: "Reference altitude for fuel burn scaling." },
  { key: "fuel_speed_exponent", description: "Exponent controlling how burn rate scales with speed." },
  { key: "fuel_low_altitude_penalty_per_10kft", description: "Extra burn penalty per 10 kft below reference altitude." },
  { key: "post_arc7_low_speed_kts", description: "Continuation speed used when converting remaining fuel to range." },
  { key: "max_post_arc7_minutes", description: "Maximum minutes of flight beyond Arc 7." },
  { key: "arc7_grid_min_lat", description: "Southern latitude bound for Arc 7 heatmap sampling." },
  { key: "arc7_grid_max_lat", description: "Northern latitude bound for Arc 7 heatmap sampling." },
  { key: "arc7_grid_points", description: "Number of latitude samples along Arc 7." },
  { key: "debris_weight_min_lat", description: "Southern bound of the debris-consistency latitude band." },
  { key: "debris_weight_max_lat", description: "Northern bound of the debris-consistency latitude band." },
  { key: "slow_family_max_speed_kts", description: "Threshold for labeling Arc 6 to 7 speed as slow." },
  { key: "perpendicular_family_tolerance_deg", description: "Angular tolerance for the perpendicular-to-satellite label." },
];

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
  { id: "pins", label: "Saved Pins", infoId: "layer:points" },
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
let lastCompletedConfig: AnalysisConfig | null = null;
let lastCompletedResult: ModelResultSummary | null = null;
let latestResultSummary: ModelResultSummary | null = null;
let latestRunChanges: RunChange[] = [];
let selectedComparisonLeft = "";
let selectedComparisonRight = "";
let pinPlacementArmed = false;

export function initSidebar(callbacks: SidebarCallbacks): void {
  sidebarCallbacks = callbacks;
  bindSidebarInfoClick();
  const initialScenario = SCENARIOS.find((scenario) => scenario.id === getActiveScenarioId()) ?? null;
  renderSidebar(initialScenario);
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

    <details class="sidebar-section workflow-section">
      <summary class="workflow-summary">Scenario</summary>
      <div class="workflow-body">
      <select id="scenario-dropdown" class="scenario-dropdown">
        <option value="">— Select scenario —</option>
        ${SCENARIOS.map((s) => `<option value="${s.id}" ${scenario?.id === s.id ? "selected" : ""}>${s.name}</option>`).join("")}
      </select>
      ${scenario ? `<div id="scenario-narrative" class="scenario-narrative">${scenario.narrative}</div>` : ""}
      </div>
    </details>

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
    <details class="sidebar-section workflow-section" open>
      <summary class="workflow-summary">Model Inputs</summary>
      <div class="workflow-body">
      <div class="section-heading"><h2>Inputs</h2><button class="info-icon-button" type="button" data-info-id="section:model" aria-label="About Model">i</button></div>
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
      <div class="button-row info-action-row">
        <button class="info-icon-button button-info" type="button" data-info-id="action:reset-model" aria-label="About Reset">i</button>
        <button class="info-icon-button button-info" type="button" data-info-id="action:run-model" aria-label="About Run Model">i</button>
      </div>
      </div>
      <div class="sidebar-section-inner tauri-only">
        <details class="config-inspector" id="config-inspector" data-config-inspector>
          <summary>Config Inspector</summary>
          <div class="config-inspector-note">Current run baseline plus any UI overrides applied in this session.</div>
          <div id="config-inspector-table"></div>
        </details>
      </div>
      </div>
    </details>

    <details class="sidebar-section workflow-section" open>
      <summary class="workflow-summary">Model Results</summary>
      <div class="workflow-body">
        <div id="model-changes" class="model-changes" hidden></div>
        <div id="model-results-summary" class="model-results-summary">Run the model to populate the current result summary.</div>
        <div id="model-run-status" class="model-run-status">
          <div class="model-run-status-title">Run status</div>
          <div id="model-run-status-summary" class="model-run-status-summary">Not run yet.</div>
          <div id="model-run-status-detail" class="model-run-status-detail"></div>
        </div>
        <div id="model-summary-panel" class="sidebar-section-inner model-summary-panel" hidden></div>
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>BFO Fit</h2></div>
          <div id="bfo-fit-summary" class="toggle-note" style="margin:0;">Run the model to inspect BFO fit for the best path.</div>
          <div id="bfo-fit-list" class="bfo-fit-list"></div>
        </div>
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Path Families</h2><button class="info-icon-button" type="button" data-info-id="section:path-families" aria-label="About Path Families">i</button></div>
          <div id="family-legend" class="family-legend"></div>
          <div id="family-endpoint-note" class="toggle-note family-endpoint-note"></div>
          <div id="family-firs" class="family-firs"></div>
        </div>
      </div>
    </details>

    <details class="sidebar-section workflow-section">
      <summary class="workflow-summary">Evidence Layers</summary>
      <div class="workflow-body">
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Map Layers</h2><button class="info-icon-button" type="button" data-info-id="section:layers" aria-label="About Layers">i</button></div>
        <div class="button-row">
          <button id="focus-priority-btn" class="btn-secondary">Focus Priority Gaps</button>
          <button class="info-icon-button button-info" type="button" data-info-id="layer:priority" aria-label="About Priority Gaps">i</button>
        </div>
        <div id="layer-toggles"></div>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Pins</h2></div>
        <div class="button-row">
          <button id="add-pin-btn" class="btn-secondary">Add Pin</button>
        </div>
        <div id="saved-pins-list" class="saved-pins-list"></div>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Search Coverage</h2><button class="info-icon-button" type="button" data-info-id="section:search" aria-label="About Search Coverage">i</button></div>
        <div id="sonar-toggles" class="sonar-toggles"></div>
        <label class="slider-row">
          <span class="field-with-info"><span>Sonar opacity</span><button class="info-icon-button" type="button" data-info-id="control:sonar-opacity" aria-label="About Sonar Opacity">i</button></span>
          <input id="sonar-opacity" type="range" min="0" max="100" step="5" value="85" />
        </label>
      </div>
      ${renderInversionSection("standard")}
      <div class="sidebar-section-inner">
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
      </div>
    </details>

    <details class="sidebar-section workflow-section">
      <summary class="workflow-summary">Export / History</summary>
      <div class="workflow-body">
      <div class="sidebar-section-inner tauri-only">
        <div class="button-row export-row">
          <button id="export-probability-btn" class="btn-secondary">Export Heatmap</button>
          <button id="export-paths-btn" class="btn-secondary">Export Paths</button>
        </div>
        <div class="button-row info-action-row export-row">
          <button class="info-icon-button button-info" type="button" data-info-id="action:export-heatmap" aria-label="About Export Heatmap">i</button>
          <button class="info-icon-button button-info" type="button" data-info-id="action:export-paths" aria-label="About Export Paths">i</button>
        </div>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Run History</h2></div>
        <div class="button-row">
          <button id="save-run-btn" class="btn-secondary">Save Run</button>
          <button id="generate-report-btn" class="btn-secondary">Generate Report</button>
          <button id="copy-report-btn" class="btn-secondary">Copy Report</button>
        </div>
        <div id="saved-runs-list" class="saved-runs-list"></div>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Run Comparison</h2></div>
        <div class="compare-controls">
          <select id="compare-left-select" class="scenario-dropdown"></select>
          <select id="compare-right-select" class="scenario-dropdown"></select>
        </div>
        <div id="run-comparison-table" class="run-comparison-table">Select two saved runs to compare.</div>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Generated Report</h2></div>
        <textarea id="generated-report" class="generated-report" readonly>Generate a report from the current run or compare two saved runs.</textarea>
      </div>
      <div class="sidebar-section-inner">
        <div class="section-heading"><h2>Notes</h2><button class="info-icon-button" type="button" data-info-id="section:info" aria-label="About Info">i</button></div>
        <p class="info-text">
          BTO is the primary constraint here. Satellite state, fuel, and post-arc-7 continuation stay configurable because small assumption shifts can move the endpoint by hundreds of kilometres.
        </p>
        <div class="toggle-note">Run history is not saved yet. Exports now carry the analysis config used for that run.</div>
      </div>
      </div>
    </details>
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
  renderBfoDiagnostics();
  renderModelResultsSummary();
  renderConfigInspector();
  renderSavedRuns();
  renderSavedPins();
  updateModelRunStatus({ state: "idle" });
  updatePriorityHint();
  ensureModelSummaryPanel();
  updateModelSummaryPanel({});
  initInversionControls();

  document.getElementById("focus-priority-btn")?.addEventListener("click", focusPriorityGaps);
  document.getElementById("add-pin-btn")?.addEventListener("click", () => {
    togglePinPlacement();
  });
  document.getElementById("run-model-btn")?.addEventListener("click", onRunModel);
  document.getElementById("save-run-btn")?.addEventListener("click", () => {
    saveCurrentRun();
    renderSavedRuns();
    renderRunComparison();
  });
  document.getElementById("generate-report-btn")?.addEventListener("click", () => {
    renderGeneratedReport();
  });
  document.getElementById("copy-report-btn")?.addEventListener("click", () => {
    void copyGeneratedReport();
  });
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
    renderConfigInspector();
    onConfigChange?.();
  });
}

function syncModelControls(): void {
  const config = getAnalysisConfig();
  for (const { key } of NUMERIC_FIELDS) {
    const input = document.querySelector<HTMLInputElement>(`input[data-config-key="${key}"]`);
    if (input) input.value = String(config[key]);
  }
  renderConfigInspector();
  renderRunComparison();
  renderGeneratedReport();
}

function refreshAssumptionDisplay(): void {
  const config = getAnalysisConfig();
  const speedRange = document.getElementById("speed-range-value");
  const satDrift = document.getElementById("sat-drift-value");
  if (speedRange) speedRange.textContent = `${config.min_speed_kts}–${config.max_speed_kts} kts`;
  if (satDrift) satDrift.textContent = "Pending model run";
}

function renderConfigInspector(): void {
  const table = document.getElementById("config-inspector-table");
  if (!table) return;

  const resolved = getResolvedConfigView();
  table.innerHTML = `
    <div class="config-inspector-grid">
      ${CONFIG_FIELD_META.map(({ key, description }) => {
        const value = resolved.config[key];
        const source = resolved.sources[key] ?? "CompiledDefault";
        const overridden = source !== "CompiledDefault";
        return `
          <div class="config-inspector-row ${overridden ? "config-inspector-row--overridden" : ""}">
            <div class="config-inspector-field">${key}</div>
            <div class="config-inspector-value">${formatConfigValue(value)}</div>
            <div class="config-inspector-source"><span class="config-source-badge config-source-badge--${source}">${formatConfigSource(source)}</span></div>
            <div class="config-inspector-description">${description}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatConfigValue(value: AnalysisConfig[keyof AnalysisConfig]): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 0 ? value : "(embedded default)";
  return String(value);
}

function formatConfigSource(source: string): string {
  switch (source) {
    case "CompiledDefault":
      return "default";
    case "DefaultToml":
      return "toml";
    case "LocalToml":
      return "local";
    case "UiOverride":
      return "ui";
    default:
      return source;
  }
}

function renderSavedRuns(): void {
  const container = document.getElementById("saved-runs-list");
  if (!container) return;

  const runs = listSavedRuns();
  if (runs.length === 0) {
    container.innerHTML = '<div class="toggle-note">No saved runs yet.</div>';
    return;
  }

  container.innerHTML = runs.map((run) => `
    <button class="saved-run-row" type="button" data-run-id="${run.id}">
      <span class="saved-run-time">${formatSavedRunTime(run.timestamp)}</span>
      <span class="saved-run-title">${run.summary.bestFamily ?? "No viable path"}</span>
      <span class="saved-run-meta">${run.summary.pathCount} paths · ${formatOptionalLatLon(run.summary.peakLat, run.summary.peakLon)}</span>
      <span class="saved-run-notes">${run.notes || "No notes"}</span>
    </button>
  `).join("");

  container.querySelectorAll<HTMLButtonElement>(".saved-run-row[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const runId = button.dataset.runId;
      if (!runId) return;
      restoreSavedRun(runId);
    });
  });
}

function renderSavedPins(): void {
  const container = document.getElementById("saved-pins-list");
  if (!container) return;

  const pins = listSavedPins();
  if (pins.length === 0) {
    container.innerHTML = '<div class="toggle-note">No saved pins yet.</div>';
    return;
  }

  container.innerHTML = pins.map((pin) => `
    <div class="saved-pin-row">
      <input class="saved-pin-label" type="text" data-pin-id="${pin.id}" value="${escapeHtml(pin.label)}" />
      <button class="saved-pin-remove" type="button" data-pin-remove-id="${pin.id}">Remove</button>
      <div class="saved-pin-coordinates">${pin.coordinates[1].toFixed(3)}, ${pin.coordinates[0].toFixed(3)}</div>
    </div>
  `).join("");

  container.querySelectorAll<HTMLInputElement>(".saved-pin-label[data-pin-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.pinId;
      if (!id) return;
      updatePin(id, { label: input.value.trim() || input.defaultValue });
      reloadPinsUiAndLayer();
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".saved-pin-remove[data-pin-remove-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.pinRemoveId;
      if (!id) return;
      removePin(id);
      reloadPinsUiAndLayer();
    });
  });
}

function togglePinPlacement(): void {
  pinPlacementArmed = !pinPlacementArmed;
  const map = getMap();
  const button = document.getElementById("add-pin-btn") as HTMLButtonElement | null;
  if (button) {
    button.textContent = pinPlacementArmed ? "Click Map…" : "Add Pin";
  }
  setPinPlacementMode(map, pinPlacementArmed, pinPlacementArmed ? (coordinates) => {
    const label = window.prompt("Label for pin:", `Point ${listSavedPins().length + 1}`) ?? "";
    savePin(coordinates, label);
    pinPlacementArmed = false;
    if (button) button.textContent = "Add Pin";
    reloadPinsUiAndLayer();
  } : null);
}

function reloadPinsUiAndLayer(): void {
  const map = getMap();
  loadPinsLayer(map);
  refreshPinsLayer(map);
  renderSavedPins();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRunComparison(): void {
  const leftSelect = document.getElementById("compare-left-select") as HTMLSelectElement | null;
  const rightSelect = document.getElementById("compare-right-select") as HTMLSelectElement | null;
  const table = document.getElementById("run-comparison-table");
  if (!leftSelect || !rightSelect || !table) return;

  const runs = listSavedRuns();
  const options = ['<option value="">Select run</option>', ...runs.map((run) => (
    `<option value="${run.id}">${formatSavedRunTime(run.timestamp)} · ${run.summary.bestFamily ?? "No viable path"}</option>`
  ))].join("");
  leftSelect.innerHTML = options;
  rightSelect.innerHTML = options;
  if (selectedComparisonLeft) leftSelect.value = selectedComparisonLeft;
  if (selectedComparisonRight) rightSelect.value = selectedComparisonRight;

  leftSelect.onchange = () => {
    selectedComparisonLeft = leftSelect.value;
    renderRunComparison();
    renderGeneratedReport();
  };
  rightSelect.onchange = () => {
    selectedComparisonRight = rightSelect.value;
    renderRunComparison();
    renderGeneratedReport();
  };

  const left = selectedComparisonLeft ? getSavedRun(selectedComparisonLeft) ?? null : null;
  const right = selectedComparisonRight ? getSavedRun(selectedComparisonRight) ?? null : null;
  table.innerHTML = buildComparisonTable(left, right);
}

function buildComparisonTable(left: SavedRun | null, right: SavedRun | null): string {
  if (!left || !right) {
    return "Select two saved runs to compare.";
  }

  const summaryRows = [
    ["Best family", left.summary.bestFamily ?? "No viable path", right.summary.bestFamily ?? "No viable path"],
    ["Best score", left.summary.bestScore?.toFixed(3) ?? "--", right.summary.bestScore?.toFixed(3) ?? "--"],
    ["Peak", formatOptionalLatLon(left.summary.peakLat, left.summary.peakLon), formatOptionalLatLon(right.summary.peakLat, right.summary.peakLon)],
    ["Path count", String(left.summary.pathCount), String(right.summary.pathCount)],
    ["BFO residual", formatOptionalHz(left.summary.bfoMeanAbsResidualHz), formatOptionalHz(right.summary.bfoMeanAbsResidualHz)],
    ["Searched overlap", left.summary.searchedOverlapLabel ?? "--", right.summary.searchedOverlapLabel ?? "--"],
    ["Continuation", left.summary.continuationLabel ?? "--", right.summary.continuationLabel ?? "--"],
  ];
  const configDiffs = listConfigDiffs(left.config, right.config);

  const summaryMarkup = summaryRows.map(([label, leftValue, rightValue]) => `
    <div class="run-comparison-row">
      <span class="run-comparison-label">${label}</span>
      <span class="run-comparison-value">${leftValue}</span>
      <span class="run-comparison-value">${rightValue}</span>
    </div>
  `).join("");

  const configMarkup = configDiffs.length === 0
    ? '<div class="toggle-note">No config diffs.</div>'
    : configDiffs.map((diff) => `
      <div class="run-comparison-row run-comparison-row--config">
        <span class="run-comparison-label">${String(diff.key)}</span>
        <span class="run-comparison-value">${diff.left}</span>
        <span class="run-comparison-value">${diff.right}</span>
      </div>
    `).join("");

  return `
    <div class="run-comparison-group-title">Result Diffs</div>
    ${summaryMarkup}
    <div class="run-comparison-group-title">Config Diffs</div>
    ${configMarkup}
  `;
}

function renderGeneratedReport(): void {
  const report = document.getElementById("generated-report") as HTMLTextAreaElement | null;
  if (!report) return;

  const left = selectedComparisonLeft ? getSavedRun(selectedComparisonLeft) ?? null : null;
  const right = selectedComparisonRight ? getSavedRun(selectedComparisonRight) ?? null : null;
  if (left && right) {
    report.value = generateComparisonReport(left, right);
    return;
  }
  if (latestResultSummary) {
    report.value = generateRunReport(
      "Current Run",
      getAnalysisConfig(),
      latestResultSummary,
      "Generated from the current in-app state.",
    );
    return;
  }
  report.value = "Generate a report from the current run or compare two saved runs.";
}

async function copyGeneratedReport(): Promise<void> {
  const report = document.getElementById("generated-report") as HTMLTextAreaElement | null;
  if (!report || !report.value.trim()) return;

  try {
    await navigator.clipboard.writeText(report.value);
  } catch {
    report.select();
    document.execCommand("copy");
    report.setSelectionRange(0, 0);
  }
}

function saveCurrentRun(): void {
  if (!latestResultSummary) {
    window.alert("Run the model once before saving a run snapshot.");
    return;
  }

  const notes = window.prompt("Notes for this run:", "") ?? "";
  saveRun({
    id: `run-${Date.now()}`,
    timestamp: new Date().toISOString(),
    config: getAnalysisConfig(),
    summary: {
      bestFamily: latestResultSummary.bestFamily,
      bestScore: latestResultSummary.bestScore,
      peakLat: latestResultSummary.peakLat,
      peakLon: latestResultSummary.peakLon,
      pathCount: latestResultSummary.pathCount,
      heatmapCount: latestResultSummary.heatmapCount,
      searchedOverlapLabel: latestResultSummary.searchedOverlapLabel,
      continuationLabel: latestResultSummary.continuationLabel,
      bfoMeanAbsResidualHz: latestResultSummary.bfoMeanAbsResidualHz,
    },
    notes,
  });
}

function restoreSavedRun(id: string): void {
  const run = getSavedRun(id);
  if (!run) return;

  resetAnalysisConfig();
  updateAnalysisConfig(run.config);
  syncModelControls();
  refreshAssumptionDisplay();
  renderConfigInspector();
  sidebarCallbacks?.onConfigChange?.();
  sidebarCallbacks?.onRunModel();
}

function formatSavedRunTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function exportProbability(): Promise<void> {
  const path = window.prompt("Export probability GeoJSON to:", `${defaultAnalysisConfig.dataset_path.replace("mh370_data.json", "mh370_probability.geojson")}`);
  if (!path) return;
  try {
    const result = await exportProbabilityGeojson(path, getAnalysisConfig());
    if (result) window.alert(String(result));
  } catch (err) {
    console.error("Failed to export probability GeoJSON:", err);
  }
}

async function exportPaths(): Promise<void> {
  const path = window.prompt("Export candidate paths GeoJSON to:", `${defaultAnalysisConfig.dataset_path.replace("mh370_data.json", "mh370_paths.geojson")}`);
  if (!path) return;
  try {
    const result = await exportPathsGeojson(path, getAnalysisConfig());
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
  bfoSummary?: BackendBfoSummary;
  bfoDiagnostics?: BackendBfoDiagnostic[];
  noPaths?: boolean;
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
  const bfoFallback = summary.noPaths
    ? "No candidate paths matched the current model settings, so there is no BFO fit to show. Try Reset and rerun."
    : summary.family && !summary.bfoSummary
      ? "No BFO diagnostics came back for the best path. If you are running `pnpm tauri dev`, restart it so the Rust backend reloads."
      : undefined;
  renderBfoDiagnostics(summary.bfoSummary, summary.bfoDiagnostics, bfoFallback);
  if (summary.endpoint) updateConfidence(summary.endpoint);
}

export function updateModelResultsSummary(summary: ModelResultSummary): void {
  latestResultSummary = summary;
  latestRunChanges = buildRunChanges(lastCompletedConfig, getAnalysisConfig(), lastCompletedResult, summary);
  renderModelResultsSummary();
  lastCompletedConfig = getAnalysisConfig();
  lastCompletedResult = summary;
}

function renderModelResultsSummary(): void {
  const container = document.getElementById("model-results-summary");
  const changes = document.getElementById("model-changes");
  if (!container || !changes) return;

  if (!latestResultSummary) {
    container.textContent = "Run the model to populate the current result summary.";
    changes.hidden = true;
    changes.innerHTML = "";
    return;
  }

  const peak = formatOptionalLatLon(latestResultSummary.peakLat, latestResultSummary.peakLon);
  const bestEndpoint = formatOptionalLatLon(latestResultSummary.bestEndpointLat, latestResultSummary.bestEndpointLon);
  const endpointCounts = Object.entries(latestResultSummary.endpointCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([family, count]) => `${family} ${count}`)
    .join(" · ") || "No endpoints";
  const fuelFeasible = latestResultSummary.fuelFeasiblePercent !== undefined
    ? `${latestResultSummary.fuelFeasiblePercent.toFixed(0)}%`
    : "--";
  const bfoResidual = latestResultSummary.bfoMeanAbsResidualHz !== undefined
    ? `${latestResultSummary.bfoMeanAbsResidualHz.toFixed(1)} Hz`
    : "--";
  const bestScore = latestResultSummary.bestScore !== undefined
    ? latestResultSummary.bestScore.toFixed(3)
    : "--";

  container.innerHTML = `
    <div class="model-results-grid">
      <div class="model-results-label">Best-fit family</div>
      <div class="model-results-value">${latestResultSummary.bestFamily ?? "No viable path"} · score ${bestScore}</div>
      <div class="model-results-label">Endpoint count by family</div>
      <div class="model-results-value">${endpointCounts}</div>
      <div class="model-results-label">Fuel-feasible paths</div>
      <div class="model-results-value">${fuelFeasible}</div>
      <div class="model-results-label">BFO mean residual</div>
      <div class="model-results-value">${bfoResidual}</div>
      <div class="model-results-label">Peak probability</div>
      <div class="model-results-value">${peak}</div>
      <div class="model-results-label">Best path endpoint</div>
      <div class="model-results-value">${bestEndpoint}</div>
      <div class="model-results-label">Searched overlap</div>
      <div class="model-results-value">${latestResultSummary.searchedOverlapLabel ?? "--"}</div>
      <div class="model-results-label">Continuation share</div>
      <div class="model-results-value">${latestResultSummary.continuationLabel ?? "--"}</div>
    </div>
  `;

  if (latestRunChanges.length === 0) {
    changes.hidden = true;
    changes.innerHTML = "";
    return;
  }

  changes.hidden = false;
  changes.innerHTML = latestRunChanges.slice(0, 8).map((change) => `
    <span class="model-change-chip model-change-chip--${change.type}" title="${change.detail}">${change.label}</span>
  `).join("");
}

function buildRunChanges(
  previousConfig: AnalysisConfig | null,
  currentConfig: AnalysisConfig,
  previousResult: ModelResultSummary | null,
  currentResult: ModelResultSummary,
): RunChange[] {
  const changes: RunChange[] = [];

  if (previousConfig) {
    for (const key of Object.keys(currentConfig) as (keyof AnalysisConfig)[]) {
      if (previousConfig[key] === currentConfig[key]) continue;
      changes.push({
        type: "config",
        label: String(key),
        detail: `${String(previousConfig[key])} -> ${String(currentConfig[key])}`,
      });
    }
  }

  if (previousResult) {
    if (previousResult.bestFamily !== currentResult.bestFamily) {
      changes.push({
        type: "result",
        label: "best family",
        detail: `${previousResult.bestFamily ?? "none"} -> ${currentResult.bestFamily ?? "none"}`,
      });
    }
    if (previousResult.peakLat !== currentResult.peakLat || previousResult.peakLon !== currentResult.peakLon) {
      changes.push({
        type: "result",
        label: "peak location",
        detail: `${formatOptionalLatLon(previousResult.peakLat, previousResult.peakLon)} -> ${formatOptionalLatLon(currentResult.peakLat, currentResult.peakLon)}`,
      });
    }
    if (previousResult.fuelFeasiblePercent !== currentResult.fuelFeasiblePercent) {
      changes.push({
        type: "result",
        label: "fuel feasible",
        detail: `${formatOptionalPercent(previousResult.fuelFeasiblePercent)} -> ${formatOptionalPercent(currentResult.fuelFeasiblePercent)}`,
      });
    }
    if (previousResult.bfoMeanAbsResidualHz !== currentResult.bfoMeanAbsResidualHz) {
      changes.push({
        type: "result",
        label: "BFO residual",
        detail: `${formatOptionalHz(previousResult.bfoMeanAbsResidualHz)} -> ${formatOptionalHz(currentResult.bfoMeanAbsResidualHz)}`,
      });
    }
  }

  return changes;
}

function formatOptionalLatLon(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "--";
  const latHemisphere = lat < 0 ? "S" : "N";
  const lonHemisphere = lon < 0 ? "W" : "E";
  return `~${Math.abs(lat).toFixed(1)}${latHemisphere}, ${Math.abs(lon).toFixed(1)}${lonHemisphere}`;
}

function formatOptionalPercent(value?: number): string {
  if (value === undefined) return "--";
  return `${value.toFixed(0)}%`;
}

function formatOptionalHz(value?: number): string {
  if (value === undefined) return "--";
  return `${value.toFixed(1)} Hz`;
}

function renderBfoDiagnostics(
  summary?: BackendBfoSummary,
  diagnostics: BackendBfoDiagnostic[] = [],
  fallbackMessage?: string,
): void {
  const summaryEl = document.getElementById("bfo-fit-summary");
  const listEl = document.getElementById("bfo-fit-list");
  if (!summaryEl || !listEl) return;

  if (!summary) {
    summaryEl.textContent = fallbackMessage ?? "Run the model to inspect BFO fit for the best path.";
    listEl.innerHTML = "";
    updateArcBfoAnnotations([]);
    return;
  }

  updateArcBfoAnnotations(diagnostics);
  const meanResidual = formatHz(summary.mean_abs_residual_hz);
  const maxResidual = formatHz(summary.max_abs_residual_hz);
  summaryEl.textContent = `${summary.used_count}/${summary.total_count} primary arc handshakes used. Mean |residual| ${meanResidual}. Max ${maxResidual}.`;
  listEl.innerHTML = diagnostics.map((diagnostic) => {
    const statusClass = diagnostic.used_in_score ? "bfo-fit-row--used" : "bfo-fit-row--skipped";
    const residual = diagnostic.residual_hz === null || diagnostic.residual_hz === undefined
      ? "--"
      : `${diagnostic.residual_hz >= 0 ? "+" : ""}${diagnostic.residual_hz.toFixed(1)} Hz`;
    const predicted = diagnostic.predicted_bfo_hz === null || diagnostic.predicted_bfo_hz === undefined
      ? "--"
      : `${diagnostic.predicted_bfo_hz.toFixed(1)} Hz`;
    const measured = diagnostic.measured_bfo_hz === null || diagnostic.measured_bfo_hz === undefined
      ? "--"
      : `${diagnostic.measured_bfo_hz.toFixed(1)} Hz`;
    const weight = diagnostic.used_in_score && diagnostic.residual_hz !== null && diagnostic.residual_hz !== undefined
      ? bfoWeightForResidual(diagnostic.residual_hz)
      : undefined;
    const fitLabel = diagnostic.residual_hz === null || diagnostic.residual_hz === undefined
      ? "unscored"
      : bfoFitLabel(diagnostic.residual_hz);
    const meta = diagnostic.used_in_score
      ? `Weight ${weight?.toFixed(2) ?? "--"}${diagnostic.reliability ? ` · ${diagnostic.reliability}` : ""} · ${fitLabel}`
      : diagnostic.skip_reason ?? "Skipped";

    return `
      <button class="bfo-fit-row ${statusClass}" type="button" data-arc="${diagnostic.arc}">
        <div class="bfo-fit-row-head">
          <span class="bfo-fit-arc">Arc ${diagnostic.arc}</span>
          <span class="bfo-fit-time">${diagnostic.time_utc} UTC</span>
        </div>
        <div class="bfo-fit-metrics">
          <span>Measured ${measured}</span>
          <span>Predicted ${predicted}</span>
          <span>Residual ${residual}</span>
        </div>
        <div class="bfo-fit-meta">${meta}</div>
      </button>
    `;
  }).join("");

  listEl.querySelectorAll<HTMLButtonElement>(".bfo-fit-row[data-arc]").forEach((button) => {
    button.addEventListener("click", () => {
      const arc = Number(button.dataset.arc ?? 0);
      focusArcFromBfoRow(arc);
    });
  });
}

function bfoWeightForResidual(residualHz: number): number {
  const sigma = getAnalysisConfig().bfo_sigma_hz;
  return Math.exp(-(residualHz ** 2) / (2 * sigma * sigma));
}

function bfoFitLabel(residualHz: number): string {
  const magnitude = Math.abs(residualHz);
  if (magnitude < 3) return "good";
  if (magnitude <= 7) return "marginal";
  return "poor";
}

function updateArcBfoAnnotations(diagnostics: BackendBfoDiagnostic[]): void {
  const map = getMap();
  const source = map.getSource("arcs-source") as GeoJSONSource & { _data?: GeoJSON.FeatureCollection } | undefined;
  const data = source?._data;
  if (!data || data.type !== "FeatureCollection") return;

  const byArc = new Map(diagnostics.map((diagnostic) => [diagnostic.arc, diagnostic]));
  const nextData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: data.features.map((feature) => {
      const diagnostic = byArc.get(Number(feature.properties?.arc ?? 0));
      return {
        ...feature,
        properties: {
          ...feature.properties,
          bfo_residual_hz: diagnostic?.residual_hz ?? null,
          bfo_weight: diagnostic?.residual_hz === null || diagnostic?.residual_hz === undefined
            ? null
            : bfoWeightForResidual(diagnostic.residual_hz),
          bfo_fit_label: diagnostic?.residual_hz === null || diagnostic?.residual_hz === undefined
            ? null
            : bfoFitLabel(diagnostic.residual_hz),
        },
      };
    }),
  };
  source.setData(nextData);
}

function focusArcFromBfoRow(arc: number): void {
  const map = getMap();
  highlightArc(map, arc);
  const ring = getArcRingByArc(arc);
  if (!ring) return;
  const bounds = ring.points.reduce<[number, number, number, number]>((acc, [lon, lat]) => [
    Math.min(acc[0], lon),
    Math.min(acc[1], lat),
    Math.max(acc[2], lon),
    Math.max(acc[3], lat),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]] as LngLatBoundsLike, {
    padding: 48,
    duration: 700,
  });
}

function formatHz(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(1)} Hz`;
}

export function updateModelRunStatus(status: ModelRunStatus): void {
  const summaryEl = document.getElementById("model-run-status-summary");
  const detailEl = document.getElementById("model-run-status-detail");
  if (!summaryEl || !detailEl) return;

  if (status.state === "idle") {
    summaryEl.textContent = "Not run yet.";
    detailEl.textContent = "No completed model run in this session.";
    return;
  }

  if (status.state === "running") {
    summaryEl.textContent = `Running model${status.startedAt ? ` since ${formatClock(status.startedAt)}` : "..."}`;
    detailEl.textContent = "Refreshing paths, heatmap, and derived summaries.";
    return;
  }

  if (status.state === "failed") {
    summaryEl.textContent = `Run failed${status.finishedAt ? ` at ${formatClock(status.finishedAt)}` : ""}.`;
    detailEl.textContent = status.error ?? "Unknown model run error.";
    return;
  }

  const ranAt = status.finishedAt ? formatClock(status.finishedAt) : "unknown time";
  const duration = status.durationMs !== undefined ? `${(status.durationMs / 1000).toFixed(1)}s` : "--";
  summaryEl.textContent = `Completed at ${ranAt} in ${duration}.`;
  detailEl.textContent = [
    `${status.pathCount ?? 0} paths`,
    `${status.heatmapCount ?? 0} heatmap points`,
    status.bestFamily ? `best family ${status.bestFamily}` : undefined,
    `BFO diagnostics ${status.bfoAvailable ? `${status.bfoDiagnosticCount ?? 0} rows` : "missing"}`,
  ].filter(Boolean).join(" · ");
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function renderFamilyLegend(summary: FamilySummary): void {
  const legend = document.getElementById("family-legend");
  const endpointNote = document.getElementById("family-endpoint-note");
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

  if (endpointNote) {
    endpointNote.textContent = summary.endpointNarrative ?? "";
    endpointNote.style.display = summary.endpointNarrative ? "block" : "none";
  }

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
