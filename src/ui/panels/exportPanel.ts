import type { PanelModule } from "../flyoutShell";
import { refreshCurrentPanel } from "../flyoutShell";
import { exportPathsGeojson, exportProbabilityGeojson, getProbabilityHeatmap, IS_TAURI } from "../../lib/backend";
import { defaultAnalysisConfig, getAnalysisConfig } from "../../model/config";
import { getCandidatePaths } from "../../lib/backend";
import { listSavedRuns, saveRun, type SavedRun } from "../../model/runs";
import { getMap, layerVisibility, toggleLayer } from "../../map";
import { generateRunReport } from "../report";
import type { ReportSummary } from "../report";
import { copyCurrentUrlStateLink } from "../../lib/urlState";
import { copyAnalysisContextForAi } from "../../lib/contextExport";
import { downloadSessionSnapshot, importSessionSnapshot } from "../../lib/sessionSnapshot";
import { scheduleAutoSaveSessionSnapshot } from "../../lib/sessionSnapshot";
import { getStoredAnalystNotes, setStoredAnalystNotes } from "../../model/session";
import { SCENARIOS, type ScenarioPreset } from "../../model/scenarios";
import { SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "../../constants";
import { getEofScenarioColor, loadEofComparisonOverlay, setEofComparisonOverlays, type EofScenarioOverlay } from "../../layers/eofComparison";

const EOF_SCENARIO_IDS = ["eof_spiral_dive", "eof_ghost_flight", "eof_active_glide"] as const;

export function createExportPanel(): PanelModule {
  return {
    render() {
      const tauriClass = IS_TAURI ? "" : " tauri-only";
      const runs = listSavedRuns();
      const runRows = runs.length > 0
        ? runs.map((r) => `
          <button class="saved-run-btn" data-run-id="${r.id}">
            <span class="run-timestamp">${new Date(r.timestamp).toLocaleString()}</span>
            <span class="run-summary">${r.summary?.bestFamily ?? "?"} &middot; ${r.summary?.pathCount ?? 0} paths</span>
          </button>`).join("")
        : '<div class="info-text">No saved runs yet.</div>';

      return `
        <div class="sidebar-section-inner${tauriClass}">
          <div class="section-heading"><h2>Export Data</h2></div>
          <button id="copy-link-btn" class="btn-secondary" style="margin-bottom:6px">Copy Link</button>
          <button id="copy-ai-context-btn" class="btn-secondary" style="margin-bottom:6px">Copy Context for AI</button>
          <button id="export-probability-btn" class="btn-secondary" style="margin-bottom:6px">Export Heatmap GeoJSON</button>
          <button id="export-paths-btn" class="btn-secondary">Export Paths GeoJSON</button>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Workspace Notes</h2></div>
          <textarea id="analyst-notes" class="generated-report" placeholder="What are you seeing? What feels off? What do you want help reasoning about?">${escapeHtml(getStoredAnalystNotes())}</textarea>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Session Snapshot</h2></div>
          <div class="button-row" style="margin-bottom:8px">
            <button id="export-session-btn" class="btn-secondary">Export Session</button>
            <button id="import-session-btn" class="btn-secondary">Import Session</button>
          </div>
          <input id="import-session-input" type="file" accept="application/json,.json,.mh370-session.json" style="display:none" />
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Run History</h2></div>
          <div class="button-row" style="margin-bottom:8px">
            <button id="save-run-btn" class="btn-secondary">Save Run</button>
            <button id="generate-report-btn" class="btn-secondary">Generate Report</button>
          </div>
          <div id="saved-runs-list" class="saved-runs-list">${runRows}</div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>EOF Scenario Comparison</h2></div>
          <div class="button-row" style="margin-bottom:8px">
            <button id="run-eof-comparison-btn" class="btn-secondary">Run EOF Scenario Set</button>
            <button id="toggle-eof-overlay-btn" class="btn-secondary">${layerVisibility["eof-compare"] ? "Hide Overlay" : "Show Overlay"}</button>
          </div>
          <div class="legend" style="margin-bottom:8px">
            ${getEofScenarios().map((scenario) => `<div class="legend-item"><span class="legend-swatch" style="background:${getEofScenarioColor(scenario.id)}"></span> ${scenario.name}</div>`).join("")}
          </div>
          <div id="eof-scenario-results" class="generated-report" style="white-space:pre-wrap">${escapeHtml(renderStoredEofSummary())}</div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Generated Report</h2></div>
          <button id="copy-report-btn" class="btn-secondary" style="margin-bottom:6px">Copy Report</button>
          <textarea id="generated-report" class="generated-report" readonly placeholder="Generate a report to see it here."></textarea>
        </div>
      `;
    },

    wire() {
      document.getElementById("copy-link-btn")?.addEventListener("click", async () => {
        try {
          await copyCurrentUrlStateLink();
        } catch (err) {
          alert(`Copy failed: ${err}`);
        }
      });

      document.getElementById("copy-ai-context-btn")?.addEventListener("click", async () => {
        try {
          await copyAnalysisContextForAi();
        } catch (err) {
          alert(`Copy failed: ${err}`);
        }
      });

      document.getElementById("analyst-notes")?.addEventListener("input", (event) => {
        setStoredAnalystNotes((event.target as HTMLTextAreaElement).value);
        scheduleAutoSaveSessionSnapshot();
      });

      document.getElementById("export-session-btn")?.addEventListener("click", () => {
        try {
          downloadSessionSnapshot();
        } catch (err) {
          alert(`Export failed: ${err}`);
        }
      });

      document.getElementById("import-session-btn")?.addEventListener("click", () => {
        document.getElementById("import-session-input")?.dispatchEvent(new MouseEvent("click"));
      });

      document.getElementById("import-session-input")?.addEventListener("change", async (event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
          await importSessionSnapshot(file);
          refreshCurrentPanel();
          scheduleAutoSaveSessionSnapshot();
        } catch (err) {
          alert(`Import failed: ${err}`);
        } finally {
          input.value = "";
        }
      });

      document.getElementById("export-probability-btn")?.addEventListener("click", async () => {
        try {
          const path = await exportProbabilityGeojson("mh370_heatmap.geojson", getAnalysisConfig());
          alert(`Exported to ${path}`);
        } catch (err) {
          alert(`Export failed: ${err}`);
        }
      });

      document.getElementById("export-paths-btn")?.addEventListener("click", async () => {
        try {
          const path = await exportPathsGeojson("mh370_paths.geojson", getAnalysisConfig());
          alert(`Exported to ${path}`);
        } catch (err) {
          alert(`Export failed: ${err}`);
        }
      });

      document.getElementById("save-run-btn")?.addEventListener("click", () => {
        // TODO: build a proper SavedRun from current state
        console.log("Save run - needs implementation with current model state");
        refreshCurrentPanel();
      });

      document.getElementById("run-eof-comparison-btn")?.addEventListener("click", async () => {
        const output = document.getElementById("eof-scenario-results");
        const button = document.getElementById("run-eof-comparison-btn") as HTMLButtonElement | null;
        if (!output || !button) return;
        button.disabled = true;
        output.textContent = "Running EOF scenarios...";
        try {
          const results = await runEofScenarioSet();
          output.textContent = formatEofScenarioResults(results);
          loadEofComparisonOverlay(getMap());
          toggleLayer("eof-compare", true);
          refreshCurrentPanel();
        } catch (err) {
          output.textContent = `EOF scenario run failed: ${String(err)}`;
        } finally {
          button.disabled = false;
        }
      });

      document.getElementById("toggle-eof-overlay-btn")?.addEventListener("click", () => {
        const nextVisible = !layerVisibility["eof-compare"];
        toggleLayer("eof-compare", nextVisible);
        refreshCurrentPanel();
      });

      document.getElementById("generate-report-btn")?.addEventListener("click", () => {
        const config = getAnalysisConfig();
        const stub: ReportSummary = { pathCount: 0, heatmapCount: 0 };
        const report = generateRunReport("Current Run", config, stub);
        const ta = document.getElementById("generated-report") as HTMLTextAreaElement | null;
        if (ta) ta.value = report;
      });

      document.getElementById("copy-report-btn")?.addEventListener("click", () => {
        const ta = document.getElementById("generated-report") as HTMLTextAreaElement | null;
        if (ta?.value) {
          navigator.clipboard.writeText(ta.value);
        }
      });
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getEofScenarios(): ScenarioPreset[] {
  return EOF_SCENARIO_IDS
    .map((id) => SCENARIOS.find((scenario) => scenario.id === id) ?? null)
    .filter((scenario): scenario is ScenarioPreset => scenario !== null);
}

function renderStoredEofSummary(): string {
  const runs = listSavedRuns().filter((run) => run.scenarioId != null && EOF_SCENARIO_IDS.includes(run.scenarioId as typeof EOF_SCENARIO_IDS[number]));
  if (runs.length === 0) {
    return "Run the EOF scenario set to generate and save Spiral, Ghost Flight, and Active Glide comparisons.";
  }
  return formatEofScenarioResults(runs.slice(0, 3));
}

async function runEofScenarioSet(): Promise<SavedRun[]> {
  const scenarios = getEofScenarios();
  const results: SavedRun[] = [];
  const overlays: EofScenarioOverlay[] = [];
  for (const scenario of scenarios) {
    const config = { ...defaultAnalysisConfig, ...scenario.configOverrides };
    const [paths, heatmap] = await Promise.all([
      getCandidatePaths(120, config),
      getProbabilityHeatmap(config),
    ]);
    const bestPath = paths[0];
    const peak = heatmap
      .filter((point) => Number.isFinite(point.probability))
      .sort((a, b) => b.probability - a.probability)[0];
    const fuelFeasibleCount = paths.filter((path) => path.fuel_feasible).length;
    const fuelFeasiblePercent = paths.length > 0 ? (fuelFeasibleCount / paths.length) * 100 : undefined;
    const run: SavedRun = {
      id: `scenario-${scenario.id}-${Date.now()}-${results.length}`,
      scenarioId: scenario.id,
      label: scenario.name,
      timestamp: new Date().toISOString(),
      config,
      summary: {
        scenarioLabel: scenario.name,
        bestFamily: bestPath?.family,
        bestScore: bestPath?.score,
        peakLat: peak?.position[1],
        peakLon: peak?.position[0],
        pathCount: paths.length,
        heatmapCount: heatmap.length,
        fuelFeasibleCount,
        fuelFeasiblePercent,
        searchedOverlapLabel: summarizeEndpointOverlap(paths),
        continuationLabel: summarizeContinuation(paths),
        bfoMeanAbsResidualHz: bestPath?.bfo_summary?.mean_abs_residual_hz,
      },
      notes: `Auto-generated EOF scenario run for ${scenario.name}`,
    };
    saveRun(run);
    results.push(run);
    overlays.push({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      color: getEofScenarioColor(scenario.id),
      heatmap,
    });
  }
  setEofComparisonOverlays(overlays);
  return results;
}

function formatEofScenarioResults(runs: SavedRun[]): string {
  return runs.map((run) => {
    const peak = run.summary.peakLat != null && run.summary.peakLon != null
      ? `${Math.abs(run.summary.peakLat).toFixed(1)}${run.summary.peakLat < 0 ? "S" : "N"}, ${Math.abs(run.summary.peakLon).toFixed(1)}${run.summary.peakLon < 0 ? "W" : "E"}`
      : "No finite heatmap peak";
    const fuel = run.summary.fuelFeasibleCount != null && run.summary.fuelFeasiblePercent != null
      ? `${run.summary.fuelFeasibleCount} (${run.summary.fuelFeasiblePercent.toFixed(0)}%)`
      : "--";
    const bfo = run.summary.bfoMeanAbsResidualHz != null ? `${run.summary.bfoMeanAbsResidualHz.toFixed(1)} Hz` : "--";
    return [
      `${run.summary.scenarioLabel ?? run.label ?? run.id}`,
      `  Best family: ${run.summary.bestFamily ?? "No viable path"}`,
      `  Paths: ${run.summary.pathCount}`,
      `  Heatmap points: ${run.summary.heatmapCount}`,
      `  Peak: ${peak}`,
      `  Fuel-feasible: ${fuel}`,
      `  BFO residual: ${bfo}`,
    ].join("\n");
  }).join("\n\n");
}

function summarizeEndpointOverlap(paths: Array<{ fuel_feasible: boolean; points: [number, number][] }>): string {
  const searchPolygons = [SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026];
  const endpoints = paths
    .filter((path) => path.fuel_feasible)
    .map((path) => path.points[path.points.length - 1])
    .filter((point): point is [number, number] => Array.isArray(point));
  if (endpoints.length === 0) {
    return "No fuel-feasible endpoints";
  }
  const insideCount = endpoints.filter((point) => searchPolygons.some((polygon) => pointInPolygon(point, polygon))).length;
  return `${insideCount}/${endpoints.length} in searched area`;
}

function summarizeContinuation(paths: Array<{ extra_endurance_minutes?: number; extra_range_nm?: number; points: [number, number][] }>): string {
  const visible = paths.filter((path) => Array.isArray(path.points[path.points.length - 1]));
  if (visible.length === 0) {
    return "No visible endpoints";
  }
  const continuationCount = visible.filter((path) => (path.extra_endurance_minutes ?? 0) > 0 || (path.extra_range_nm ?? 0) > 0).length;
  return `${continuationCount}/${visible.length} with continuation`;
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
