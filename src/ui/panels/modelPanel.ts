import type { PanelModule } from "../flyoutShell";
import { IS_TAURI } from "../../lib/backend";
import { getFamilyColor } from "../../layers/paths";
import { getAnalysisConfig } from "../../model/config";

export interface ModelRunStatus {
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

export interface ModelResultSummary {
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

export interface FamilySummary {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily?: Record<string, string[]>;
  endpointNarrative?: string;
}

export interface ModelExportState {
  confidence: string;
  runStatus: ModelRunStatus;
  resultSummary: ModelResultSummary | null;
  familySummary: FamilySummary | null;
  speedRange: string;
  fuel: string;
  familySpread: string;
}

// Cached state so updates work even when panel is closed
let cachedConfidence = "\u2014";
let cachedRunStatus: ModelRunStatus = { state: "idle" };
let cachedResultSummary: ModelResultSummary | null = null;
let cachedFamilySummary: FamilySummary | null = null;
let cachedSpeedRange = "\u2014";
let cachedFuel = "\u2014";
let cachedFamilySpread = "\u2014";

function formatLatLon(lat?: number, lon?: number, digits = 2): string {
  if (lat == null || lon == null) return "\u2014";
  const latHemisphere = lat < 0 ? "S" : "N";
  const lonHemisphere = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(digits)}\u00b0${latHemisphere}, ${Math.abs(lon).toFixed(digits)}\u00b0${lonHemisphere}`;
}

let onRunModel: (() => void) | null = null;
let onConfigureModel: (() => void) | null = null;

export function setModelCallbacks(callbacks: {
  onRunModel: () => void;
  onConfigureModel: () => void;
}): void {
  onRunModel = callbacks.onRunModel;
  onConfigureModel = callbacks.onConfigureModel;
}

export function updateConfidence(value: string): void {
  cachedConfidence = value;
  const el = document.getElementById("confidence-value");
  if (el) el.textContent = value;
}

export function updateModelSummary(summary: {
  family?: string;
  fuel?: string;
  familySpreadKm?: number;
  bfoSummary?: { used_count: number; total_count: number; mean_abs_residual_hz?: number };
  bfoDiagnostics?: unknown[];
  noPaths?: boolean;
  speedRange?: string;
  familySpread?: string;
}): void {
  if (summary.noPaths) {
    cachedSpeedRange = "\u2014";
    cachedFuel = "No paths";
    cachedFamilySpread = "\u2014";
  } else {
    if (summary.speedRange) cachedSpeedRange = summary.speedRange;
    cachedFuel = summary.fuel ?? cachedFuel;
    if (summary.familySpread) {
      cachedFamilySpread = summary.familySpread;
    } else if (summary.familySpreadKm != null) {
      cachedFamilySpread = `${summary.familySpreadKm.toFixed(0)} km`;
    }
  }
  const sr = document.getElementById("speed-range-value");
  const fv = document.getElementById("sat-drift-value");
  const fs = document.getElementById("family-spread-value");
  if (sr) sr.textContent = cachedSpeedRange;
  if (fv) fv.textContent = cachedFuel;
  if (fs) fs.textContent = cachedFamilySpread;
}

export function syncModelAssumptionsFromConfig(): void {
  const config = getAnalysisConfig();
  cachedSpeedRange = `${config.min_speed_kts}-${config.max_speed_kts} kts`;
  if (cachedRunStatus.state !== "completed") {
    cachedFuel = "Pending model run";
  }
  const sr = document.getElementById("speed-range-value");
  const fv = document.getElementById("sat-drift-value");
  if (sr) sr.textContent = cachedSpeedRange;
  if (fv) fv.textContent = cachedFuel;
}

export function updateModelRunStatus(status: ModelRunStatus): void {
  cachedRunStatus = status;
  applyRunStatus();
}

export function updateModelResultsSummary(summary: ModelResultSummary): void {
  cachedResultSummary = summary;
  applyResultsSummary();
}

export function renderFamilyLegend(summary: FamilySummary): void {
  cachedFamilySummary = summary;
  applyFamilyLegend();
}

export function getLatestModelExportState(): ModelExportState {
  return {
    confidence: cachedConfidence,
    runStatus: { ...cachedRunStatus },
    resultSummary: cachedResultSummary ? { ...cachedResultSummary, endpointCounts: { ...cachedResultSummary.endpointCounts } } : null,
    familySummary: cachedFamilySummary
      ? {
          counts: { ...cachedFamilySummary.counts },
          familySpreadKm: cachedFamilySummary.familySpreadKm,
          firsByFamily: cachedFamilySummary.firsByFamily ? { ...cachedFamilySummary.firsByFamily } : undefined,
          endpointNarrative: cachedFamilySummary.endpointNarrative,
        }
      : null,
    speedRange: cachedSpeedRange,
    fuel: cachedFuel,
    familySpread: cachedFamilySpread,
  };
}

export function restoreModelExportState(state: ModelExportState): void {
  cachedConfidence = state.confidence;
  cachedRunStatus = {
    ...state.runStatus,
    startedAt: state.runStatus.startedAt ? new Date(state.runStatus.startedAt) : undefined,
    finishedAt: state.runStatus.finishedAt ? new Date(state.runStatus.finishedAt) : undefined,
  };
  cachedResultSummary = state.resultSummary
    ? { ...state.resultSummary, endpointCounts: { ...state.resultSummary.endpointCounts } }
    : null;
  cachedFamilySummary = state.familySummary
    ? {
        counts: { ...state.familySummary.counts },
        familySpreadKm: state.familySummary.familySpreadKm,
        firsByFamily: state.familySummary.firsByFamily ? { ...state.familySummary.firsByFamily } : undefined,
        endpointNarrative: state.familySummary.endpointNarrative,
      }
    : null;
  cachedSpeedRange = state.speedRange;
  cachedFuel = state.fuel;
  cachedFamilySpread = state.familySpread;
  applyRunStatus();
  applyResultsSummary();
  applyFamilyLegend();
}

export function createModelPanel(): PanelModule {
  return {
    render() {
      const tauriClass = IS_TAURI ? "" : " tauri-only";
      return `
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Overview</h2></div>
          <div class="model-info">
            <div id="confidence-display">
              <span class="label">Highest probability zone</span>
              <span class="value" id="confidence-value">${cachedConfidence}</span>
            </div>
            <div id="assumptions-display">
              <span class="label">Speed range</span>
              <span class="value" id="speed-range-value">${cachedSpeedRange}</span>
              <span class="label">Arc 7 fuel</span>
              <span class="value" id="sat-drift-value">${cachedFuel}</span>
              <span class="label">Family spread</span>
              <span class="value" id="family-spread-value">${cachedFamilySpread}</span>
            </div>
          </div>
          <div class="button-row${tauriClass}" style="margin-top:8px">
            <button id="configure-model-btn" class="btn-secondary">Configure</button>
            <button id="run-model-btn" class="btn-primary">Run Model</button>
          </div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Run Status</h2></div>
          <div id="model-run-status" class="model-run-status">
            <div id="model-run-status-summary">Not run yet.</div>
            <div id="model-run-status-detail"></div>
          </div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Results</h2></div>
          <div id="model-results-summary" class="model-results-summary">
            <div class="info-text">Run the model to populate results.</div>
          </div>
        </div>

        <div id="model-summary-panel" class="sidebar-section-inner model-summary-panel" hidden></div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Path Families</h2></div>
          <div id="family-legend" class="family-legend"></div>
          <div id="family-endpoint-note" class="toggle-note family-endpoint-note"></div>
          <div id="family-firs" class="family-firs"></div>
        </div>
      `;
    },

    wire() {
      document.getElementById("run-model-btn")?.addEventListener("click", () => onRunModel?.());
      document.getElementById("configure-model-btn")?.addEventListener("click", () => onConfigureModel?.());
    },

    onOpen() {
      applyRunStatus();
      applyResultsSummary();
      applyFamilyLegend();
    },
  };
}

function applyRunStatus(): void {
  const summary = document.getElementById("model-run-status-summary");
  const detail = document.getElementById("model-run-status-detail");
  if (!summary) return;
  const s = cachedRunStatus;
  switch (s.state) {
    case "idle":
      summary.textContent = "Not run yet.";
      if (detail) detail.textContent = "";
      break;
    case "running":
      summary.textContent = "Running...";
      if (detail) detail.textContent = "";
      break;
    case "completed": {
      const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : "";
      summary.textContent = `Completed ${dur ? `in ${dur}` : ""}`;
      if (detail) detail.textContent = `${s.pathCount ?? 0} paths, ${s.heatmapCount ?? 0} heatmap points`;
      break;
    }
    case "failed":
      summary.textContent = `Failed: ${s.error ?? "unknown error"}`;
      if (detail) detail.textContent = "";
      break;
  }
}

function applyResultsSummary(): void {
  const el = document.getElementById("model-results-summary");
  if (!el || !cachedResultSummary) return;
  const r = cachedResultSummary;
  const endpointMismatch = r.bestEndpointLat != null && r.peakLat != null
    ? Math.sign(r.bestEndpointLat) !== Math.sign(r.peakLat) || Math.abs(r.bestEndpointLat - r.peakLat) > 10
    : false;
  const warnings = [
    r.bfoMeanAbsResidualHz != null && r.bfoMeanAbsResidualHz > 40
      ? `BFO fit is weak (${r.bfoMeanAbsResidualHz.toFixed(1)} Hz), so the best path is not tightly constrained.`
      : null,
    endpointMismatch
      ? "Best path endpoint and heatmap peak diverge. Treat the heatmap as a broad density view, not confirmation of the blue path."
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  el.innerHTML = `
    <div class="results-grid">
      <span class="label">Best family</span><span class="value">${r.bestFamily ?? "\u2014"}</span>
      <span class="label">Peak</span><span class="value">${formatLatLon(r.peakLat, r.peakLon)}</span>
      <span class="label">Best endpoint</span><span class="value">${formatLatLon(r.bestEndpointLat, r.bestEndpointLon)}</span>
      <span class="label">Paths</span><span class="value">${r.pathCount}</span>
      <span class="label">Heatmap</span><span class="value">${r.heatmapCount} points</span>
      ${r.fuelFeasiblePercent != null ? `<span class="label">Fuel feasible</span><span class="value">${r.fuelFeasiblePercent.toFixed(0)}%</span>` : ""}
      ${r.bfoMeanAbsResidualHz != null ? `<span class="label">BFO residual</span><span class="value">${r.bfoMeanAbsResidualHz.toFixed(1)} Hz</span>` : ""}
      ${r.searchedOverlapLabel ? `<span class="label">Search overlap</span><span class="value">${r.searchedOverlapLabel}</span>` : ""}
    </div>
    ${warnings.length > 0 ? `<div class="info-text" style="margin-top:10px">${warnings.join(" ")}</div>` : ""}
  `;
}

function applyFamilyLegend(): void {
  const el = document.getElementById("family-legend");
  if (!el || !cachedFamilySummary) return;
  const s = cachedFamilySummary;
  const families = ["slow", "perpendicular", "mixed", "other"];
  el.innerHTML = families
    .filter((f) => (s.counts[f] ?? 0) > 0)
    .map((f) => {
      const color = getFamilyColor(f);
      const count = s.counts[f] ?? 0;
      return `<div class="family-row"><span class="family-swatch" style="background:${color}"></span><span class="family-name">${f}</span><span class="family-count">${count}</span></div>`;
    }).join("");
  const noteEl = document.getElementById("family-endpoint-note");
  if (noteEl) noteEl.textContent = s.endpointNarrative ?? "";
}
