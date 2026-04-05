import type { PanelModule } from "../flyoutShell";
import {
  IS_TAURI,
  runSensitivitySweep,
  type SensitivityProgress,
  type SensitivityResult,
  type SweepParameter,
  type ParameterSweepResult,
} from "../../lib/backend";
import { getAnalysisConfig } from "../../model/config";

/** Built-in default sweep parameters matching the Rust defaults. */
const DEFAULT_PARAMETERS: (SweepParameter & { label: string; group: string })[] = [
  { field_name: "fuel_remaining_at_arc1_kg", sigma: 2000, label: "Fuel at Arc 1 (kg)", group: "Fuel" },
  { field_name: "fuel_baseline_kg_per_hr", sigma: 500, label: "Fuel burn rate (kg/hr)", group: "Fuel" },
  { field_name: "fuel_speed_exponent", sigma: 0.15, label: "Fuel speed exponent", group: "Fuel" },
  { field_name: "post_arc7_low_speed_kts", sigma: 30, label: "Post-Arc 7 speed (kts)", group: "Fuel" },
  { field_name: "max_post_arc7_minutes", sigma: 15, label: "Post-Arc 7 endurance (min)", group: "Fuel" },
  { field_name: "speed_consistency_sigma_kts", sigma: 10, label: "Speed sigma (kts)", group: "Scoring" },
  { field_name: "heading_change_sigma_deg", sigma: 20, label: "Heading sigma (deg)", group: "Scoring" },
  { field_name: "northward_penalty_weight", sigma: 0.5, label: "Northward penalty weight", group: "Scoring" },
  { field_name: "northward_leg_sigma_deg", sigma: 0.5, label: "Northward sigma (deg)", group: "Scoring" },
  { field_name: "bfo_sigma_hz", sigma: 3, label: "BFO sigma (Hz)", group: "BFO" },
  { field_name: "bfo_score_weight", sigma: 0.3, label: "BFO score weight", group: "BFO" },
  { field_name: "cruise_altitude_ft", sigma: 5000, label: "Cruise altitude (ft)", group: "Aircraft" },
  { field_name: "min_speed_kts", sigma: 30, label: "Min speed (kts)", group: "Aircraft" },
  { field_name: "max_speed_kts", sigma: 30, label: "Max speed (kts)", group: "Aircraft" },
  { field_name: "satellite_drift_amplitude_deg", sigma: 0.3, label: "Sat drift amplitude (deg)", group: "Satellite" },
];

type SweepState = "idle" | "running" | "completed" | "failed";

let sweepState: SweepState = "idle";
let sweepResult: SensitivityResult | null = null;
let sweepError: string | null = null;
let stepsPerSide = 3;
let selectedFields: Set<string> = new Set(DEFAULT_PARAMETERS.map((p) => p.field_name));
let unlisten: (() => void) | null = null;

function formatLatLon(lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null) return "\u2014";
  const latH = lat < 0 ? "S" : "N";
  const lonH = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}\u00b0${latH}, ${Math.abs(lon).toFixed(2)}\u00b0${lonH}`;
}

function renderParameterCheckboxes(): string {
  const groups = new Map<string, typeof DEFAULT_PARAMETERS>();
  for (const p of DEFAULT_PARAMETERS) {
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }

  let html = "";
  for (const [group, params] of groups) {
    html += `<div class="sens-param-group"><div class="sens-param-group-label">${group}</div>`;
    for (const p of params) {
      const checked = selectedFields.has(p.field_name) ? "checked" : "";
      html += `
        <label class="sens-param-row">
          <input type="checkbox" data-field="${p.field_name}" ${checked}>
          <span class="sens-param-label">${p.label}</span>
          <input type="number" class="sens-sigma-input" data-sigma-field="${p.field_name}" value="${p.sigma}" step="any" title="Sigma (perturbation per step)">
        </label>`;
    }
    html += `</div>`;
  }
  return html;
}

function renderTornadoChart(sweeps: ParameterSweepResult[]): string {
  if (sweeps.length === 0) return `<div class="info-text">No results to display.</div>`;

  const maxShift = Math.max(...sweeps.map((s) => s.peak_shift_km), 1);

  let rows = "";
  for (const sweep of sweeps) {
    const param = DEFAULT_PARAMETERS.find((p) => p.field_name === sweep.field_name);
    const label = param?.label ?? sweep.field_name;

    // Find the trial with the largest negative delta and largest positive delta
    const negTrials = sweep.trials.filter((t) => t.delta_from_base < 0);
    const posTrials = sweep.trials.filter((t) => t.delta_from_base > 0);
    const maxNegShift = negTrials.length > 0 ? Math.max(...negTrials.map((t) => t.distance_from_base_km)) : 0;
    const maxPosShift = posTrials.length > 0 ? Math.max(...posTrials.map((t) => t.distance_from_base_km)) : 0;
    const negPct = (maxNegShift / maxShift) * 50;
    const posPct = (maxPosShift / maxShift) * 50;

    rows += `
      <div class="tornado-row">
        <div class="tornado-label" title="${sweep.field_name}">${label}</div>
        <div class="tornado-bar-container">
          <div class="tornado-bar-neg" style="width:${negPct}%"></div>
          <div class="tornado-bar-center"></div>
          <div class="tornado-bar-pos" style="width:${posPct}%"></div>
        </div>
        <div class="tornado-value">${sweep.peak_shift_km.toFixed(0)} km</div>
      </div>`;
  }

  return `<div class="tornado-chart">${rows}</div>`;
}

function renderResults(): string {
  if (!sweepResult) return "";
  const r = sweepResult;
  return `
    <div class="sens-results">
      <div class="sens-results-header">
        <div class="results-grid">
          <span class="label">Base peak</span>
          <span class="value">${formatLatLon(r.base_peak_lat, r.base_peak_lon)}</span>
          <span class="label">Base paths</span>
          <span class="value">${r.base_path_count} (${r.base_fuel_feasible_count} fuel-feasible)</span>
          <span class="label">Trials run</span>
          <span class="value">${r.total_trials}</span>
        </div>
      </div>
      <div class="section-heading" style="margin-top:12px"><h2>Peak Shift by Parameter</h2></div>
      ${renderTornadoChart(r.sweeps)}
    </div>`;
}

async function runSweep(): Promise<void> {
  if (!IS_TAURI) return;
  sweepState = "running";
  sweepResult = null;
  sweepError = null;
  applyState();

  const parameters: SweepParameter[] = DEFAULT_PARAMETERS
    .filter((p) => selectedFields.has(p.field_name))
    .map((p) => {
      const sigmaInput = document.querySelector<HTMLInputElement>(`[data-sigma-field="${p.field_name}"]`);
      const sigma = sigmaInput ? parseFloat(sigmaInput.value) || p.sigma : p.sigma;
      return { field_name: p.field_name, sigma };
    });

  if (parameters.length === 0) {
    sweepState = "failed";
    sweepError = "No parameters selected";
    applyState();
    return;
  }

  // Listen for progress
  try {
    if (IS_TAURI) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten?.();
      unlisten = (await listen<SensitivityProgress>("sensitivity-sweep-progress", (event) => {
        const p = event.payload;
        updateProgress(p.pct, p.parameter, p.trial, p.total_trials);
      })) as unknown as () => void;
    }
  } catch {
    // Non-critical
  }

  try {
    const config = getAnalysisConfig();
    sweepResult = await runSensitivitySweep({ parameters, steps_per_side: stepsPerSide }, config);
    sweepState = "completed";
  } catch (err) {
    sweepState = "failed";
    sweepError = err instanceof Error ? err.message : String(err);
  } finally {
    unlisten?.();
    unlisten = null;
  }

  applyState();
}

function updateProgress(pct: number, parameter: string, trial: number, total: number): void {
  const bar = document.getElementById("sens-progress-fill");
  const status = document.getElementById("sens-progress-status");
  const pctEl = document.getElementById("sens-progress-pct");
  if (bar) bar.style.width = `${pct}%`;
  if (status) {
    const param = DEFAULT_PARAMETERS.find((p) => p.field_name === parameter);
    status.textContent = `${param?.label ?? parameter} (${trial}/${total})`;
  }
  if (pctEl) pctEl.textContent = `${pct}%`;
}

function applyState(): void {
  const runBtn = document.getElementById("sens-run-btn") as HTMLButtonElement | null;
  const progressEl = document.getElementById("sens-progress-section");
  const resultsEl = document.getElementById("sens-results-section");
  const errorEl = document.getElementById("sens-error");

  if (runBtn) {
    runBtn.disabled = sweepState === "running";
    runBtn.textContent = sweepState === "running" ? "Running..." : "Run Sensitivity Sweep";
  }

  if (progressEl) {
    progressEl.style.display = sweepState === "running" ? "" : "none";
  }

  if (errorEl) {
    errorEl.style.display = sweepState === "failed" ? "" : "none";
    if (sweepError) errorEl.textContent = sweepError;
  }

  if (resultsEl) {
    if (sweepState === "completed" && sweepResult) {
      resultsEl.innerHTML = renderResults();
      resultsEl.style.display = "";
    } else {
      resultsEl.style.display = "none";
    }
  }
}

function exportResults(): void {
  if (!sweepResult) return;
  const blob = new Blob([JSON.stringify(sweepResult, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sensitivity_sweep_${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function createSensitivityPanel(): PanelModule {
  return {
    render() {
      const tauriClass = IS_TAURI ? "" : " tauri-only";
      return `
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Parameters</h2></div>
          <div class="sens-controls">
            <div class="sens-select-actions">
              <button id="sens-select-all" class="btn-link">Select all</button>
              <button id="sens-select-none" class="btn-link">Select none</button>
            </div>
            <div class="sens-param-list">
              ${renderParameterCheckboxes()}
            </div>
            <div class="sens-steps-row">
              <label>
                Steps per side:
                <input type="number" id="sens-steps" value="${stepsPerSide}" min="1" max="5" style="width:50px">
              </label>
              <span class="sens-steps-hint">(${stepsPerSide * 2} trials per param)</span>
            </div>
          </div>
        </div>

        <div class="sidebar-section-inner${tauriClass}">
          <button id="sens-run-btn" class="btn-primary" style="width:100%"${sweepState === "running" ? " disabled" : ""}>
            ${sweepState === "running" ? "Running..." : "Run Sensitivity Sweep"}
          </button>
        </div>

        <div id="sens-progress-section" class="sidebar-section-inner" style="display:${sweepState === "running" ? "" : "none"}">
          <div class="sens-progress">
            <div class="drift-progress-bar-track">
              <div class="drift-progress-bar-fill" id="sens-progress-fill" style="width:0%"></div>
            </div>
            <div id="sens-progress-status" class="sens-progress-status">Starting...</div>
            <div id="sens-progress-pct" class="sens-progress-pct">0%</div>
          </div>
        </div>

        <div id="sens-error" class="sidebar-section-inner info-text" style="display:${sweepState === "failed" ? "" : "none"};color:var(--danger,#ef4444)">
          ${sweepError ?? ""}
        </div>

        <div id="sens-results-section" style="display:${sweepState === "completed" && sweepResult ? "" : "none"}">
          ${sweepState === "completed" && sweepResult ? renderResults() : ""}
        </div>

        ${sweepState === "completed" && sweepResult ? `
        <div class="sidebar-section-inner">
          <button id="sens-export-btn" class="btn-secondary" style="width:100%">Export Results (JSON)</button>
        </div>` : ""}
      `;
    },

    wire() {
      // Checkbox toggle
      document.querySelectorAll<HTMLInputElement>(".sens-param-list input[type='checkbox']").forEach((cb) => {
        cb.addEventListener("change", () => {
          const field = cb.dataset.field;
          if (!field) return;
          if (cb.checked) selectedFields.add(field);
          else selectedFields.delete(field);
        });
      });

      // Select all / none
      document.getElementById("sens-select-all")?.addEventListener("click", () => {
        DEFAULT_PARAMETERS.forEach((p) => selectedFields.add(p.field_name));
        document.querySelectorAll<HTMLInputElement>(".sens-param-list input[type='checkbox']").forEach((cb) => cb.checked = true);
      });
      document.getElementById("sens-select-none")?.addEventListener("click", () => {
        selectedFields.clear();
        document.querySelectorAll<HTMLInputElement>(".sens-param-list input[type='checkbox']").forEach((cb) => cb.checked = false);
      });

      // Steps
      document.getElementById("sens-steps")?.addEventListener("change", (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        if (val >= 1 && val <= 5) stepsPerSide = val;
        const hint = document.querySelector<HTMLElement>(".sens-steps-hint");
        if (hint) hint.textContent = `(${stepsPerSide * 2} trials per param)`;
      });

      // Run
      document.getElementById("sens-run-btn")?.addEventListener("click", () => { runSweep(); });

      // Export
      document.getElementById("sens-export-btn")?.addEventListener("click", exportResults);
    },

    onOpen() {
      applyState();
    },
  };
}
