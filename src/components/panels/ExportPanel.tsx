import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026 } from "../../constants";
import { useMap } from "../../contexts/map-context";
import type { EofScenarioOverlay } from "../../layers/eof-comparison";
import { getEofScenarioColor, loadEofComparisonOverlay, setEofComparisonOverlays } from "../../layers/eof-comparison";
import {
  exportPathsGeojson,
  exportProbabilityGeojson,
  getCandidatePaths,
  getProbabilityHeatmap,
  IS_TAURI,
} from "../../lib/backend";
import { copyAnalysisContextForAi } from "../../lib/contextExport";
import { pointInPolygon } from "../../lib/geo";
import type { ReportSummary } from "../../lib/report";
import { generateRunReport } from "../../lib/report";
import {
  downloadSessionSnapshot,
  importSessionSnapshot,
  scheduleAutoSaveSessionSnapshot,
} from "../../lib/sessionSnapshot";
import { copyCurrentUrlStateLink } from "../../lib/urlState";
import type { SavedRun } from "../../model/runs";
import { listSavedRuns, saveRun } from "../../model/runs";
import type { ScenarioPreset } from "../../model/scenarios";
import { SCENARIOS } from "../../model/scenarios";
import { getStoredAnalystNotes, setStoredAnalystNotes } from "../../model/session";
import { defaultConfig, getConfigSnapshot } from "../../stores/analysis-config";
import { layerVisibility, toggleLayerVisibility } from "../../stores/layer-visibility";

const EOF_SCENARIO_IDS = ["eof_spiral_dive", "eof_ghost_flight", "eof_active_glide"] as const;

function getEofScenarios(): ScenarioPreset[] {
  return EOF_SCENARIO_IDS.map((id) => SCENARIOS.find((s) => s.id === id) ?? null).filter(
    (s): s is ScenarioPreset => s !== null,
  );
}

function formatEofResults(runs: SavedRun[]): string {
  return runs
    .map((run) => {
      const peak =
        run.summary.peakLat != null && run.summary.peakLon != null
          ? `${Math.abs(run.summary.peakLat).toFixed(1)}${run.summary.peakLat < 0 ? "S" : "N"}, ${Math.abs(run.summary.peakLon).toFixed(1)}${run.summary.peakLon < 0 ? "W" : "E"}`
          : "No finite heatmap peak";
      const fuel =
        run.summary.fuelFeasibleCount != null && run.summary.fuelFeasiblePercent != null
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
    })
    .join("\n\n");
}

const ExportPanel: Component = () => {
  const mapAccessor = useMap();
  let importInputRef: HTMLInputElement | undefined;
  const [notes, setNotes] = createSignal(getStoredAnalystNotes());
  const [savedRuns, setSavedRuns] = createSignal(listSavedRuns());
  const [eofRunning, setEofRunning] = createSignal(false);
  const initialEofRuns = listSavedRuns().filter(
    (r) => r.scenarioId != null && (EOF_SCENARIO_IDS as readonly string[]).includes(r.scenarioId),
  );
  const [eofResults, setEofResults] = createSignal(
    initialEofRuns.length > 0
      ? formatEofResults(initialEofRuns.slice(0, 3))
      : "Run the EOF scenario set to generate and save Spiral, Ghost Flight, and Active Glide comparisons.",
  );
  const [reportText, setReportText] = createSignal("");

  const handleCopyLink = async () => {
    try {
      await copyCurrentUrlStateLink();
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleCopyAiContext = async () => {
    try {
      await copyAnalysisContextForAi();
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleNotesInput = (value: string) => {
    setNotes(value);
    setStoredAnalystNotes(value);
    scheduleAutoSaveSessionSnapshot();
  };

  const handleImport = async (file: File) => {
    try {
      await importSessionSnapshot(file);
      scheduleAutoSaveSessionSnapshot();
      setSavedRuns(listSavedRuns());
    } catch (err) {
      console.error("Import failed:", err);
    }
  };

  const handleRunEofScenarios = async () => {
    const m = mapAccessor();
    if (!m) return;
    setEofRunning(true);
    setEofResults("Running EOF scenarios...");
    try {
      const scenarios = getEofScenarios();
      const results: SavedRun[] = [];
      const overlays: EofScenarioOverlay[] = [];
      for (const scenario of scenarios) {
        const config = { ...defaultConfig, ...scenario.configOverrides };
        const [paths, heatmap] = await Promise.all([getCandidatePaths(120, config), getProbabilityHeatmap(config)]);
        const bestPath = paths[0];
        const peak = heatmap
          .filter((p) => Number.isFinite(p.probability))
          .sort((a, b) => b.probability - a.probability)[0];
        const fuelFeasibleCount = paths.filter((p) => p.fuel_feasible).length;
        const fuelFeasiblePercent = paths.length > 0 ? (fuelFeasibleCount / paths.length) * 100 : undefined;
        const searchPolygons = [SEARCHED_2014_2017, SEARCHED_2018, SEARCHED_2025_2026];
        const endpoints = paths
          .filter((p) => p.fuel_feasible)
          .map((p) => p.points[p.points.length - 1])
          .filter((pt): pt is [number, number] => Array.isArray(pt));
        const insideCount = endpoints.filter((pt) => searchPolygons.some((poly) => pointInPolygon(pt, poly))).length;
        const overlapLabel =
          endpoints.length > 0 ? `${insideCount}/${endpoints.length} in searched area` : "No fuel-feasible endpoints";
        const visible = paths.filter((p) => Array.isArray(p.points[p.points.length - 1]));
        const contCount = visible.filter(
          (p) => (p.extra_endurance_minutes ?? 0) > 0 || (p.extra_range_nm ?? 0) > 0,
        ).length;
        const contLabel =
          visible.length > 0 ? `${contCount}/${visible.length} with continuation` : "No visible endpoints";
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
            searchedOverlapLabel: overlapLabel,
            continuationLabel: contLabel,
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
      loadEofComparisonOverlay(m);
      toggleLayerVisibility("eof-compare", true);
      setEofResults(formatEofResults(results));
      setSavedRuns(listSavedRuns());
    } catch (err) {
      setEofResults(`EOF scenario run failed: ${String(err)}`);
    } finally {
      setEofRunning(false);
    }
  };

  const handleGenerateReport = () => {
    const config = getConfigSnapshot();
    const stub: ReportSummary = { pathCount: 0, heatmapCount: 0 };
    setReportText(generateRunReport("Current Run", config, stub));
  };

  return (
    <>
      <Show when={IS_TAURI}>
        <div class="sidebar-section-inner">
          <div class="section-heading">
            <h2>Export Data</h2>
          </div>
          <button class="btn-secondary" type="button" style="margin-bottom:6px" onClick={handleCopyLink}>
            Copy Link
          </button>
          <button class="btn-secondary" type="button" style="margin-bottom:6px" onClick={handleCopyAiContext}>
            Copy Context for AI
          </button>
          <button
            class="btn-secondary"
            type="button"
            style="margin-bottom:6px"
            onClick={() => exportProbabilityGeojson("mh370_heatmap.geojson", getConfigSnapshot())}
          >
            Export Heatmap GeoJSON
          </button>
          <button
            class="btn-secondary"
            type="button"
            onClick={() => exportPathsGeojson("mh370_paths.geojson", getConfigSnapshot())}
          >
            Export Paths GeoJSON
          </button>
        </div>
      </Show>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Workspace Notes</h2>
        </div>
        <textarea
          class="generated-report"
          placeholder="What are you seeing? What feels off? What do you want help reasoning about?"
          value={notes()}
          onInput={(e) => handleNotesInput(e.currentTarget.value)}
        />
      </div>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Session Snapshot</h2>
        </div>
        <div class="button-row" style="margin-bottom:8px">
          <button class="btn-secondary" type="button" onClick={downloadSessionSnapshot}>
            Export Session
          </button>
          <button class="btn-secondary" type="button" onClick={() => importInputRef?.click()}>
            Import Session
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json,.mh370-session.json"
          style="display:none"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) {
              handleImport(file);
              e.currentTarget.value = "";
            }
          }}
        />
      </div>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Run History</h2>
        </div>
        <div class="button-row" style="margin-bottom:8px">
          <button class="btn-secondary" type="button" onClick={() => console.log("Save run - TODO")}>
            Save Run
          </button>
          <button class="btn-secondary" type="button" onClick={handleGenerateReport}>
            Generate Report
          </button>
        </div>
        <div class="saved-runs-list">
          <Show when={savedRuns().length > 0} fallback={<div class="info-text">No saved runs yet.</div>}>
            <For each={savedRuns()}>
              {(r) => (
                <button class="saved-run-btn" type="button">
                  <span class="run-timestamp">{new Date(r.timestamp).toLocaleString()}</span>
                  <span class="run-summary">
                    {r.summary?.bestFamily ?? "?"} &middot; {r.summary?.pathCount ?? 0} paths
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>EOF Scenario Comparison</h2>
        </div>
        <div class="button-row" style="margin-bottom:8px">
          <button class="btn-secondary" type="button" disabled={eofRunning()} onClick={handleRunEofScenarios}>
            {eofRunning() ? "Running..." : "Run EOF Scenario Set"}
          </button>
          <button
            class="btn-secondary"
            type="button"
            onClick={() => {
              const next = !layerVisibility["eof-compare"];
              toggleLayerVisibility("eof-compare", next);
              const m = mapAccessor();
              if (m) {
                const style = m.getStyle();
                if (style?.layers) {
                  for (const layer of style.layers) {
                    if (layer.id.startsWith("eof-compare-")) {
                      m.setLayoutProperty(layer.id, "visibility", next ? "visible" : "none");
                    }
                  }
                }
              }
            }}
          >
            {layerVisibility["eof-compare"] ? "Hide Overlay" : "Show Overlay"}
          </button>
        </div>
        <div class="legend" style="margin-bottom:8px">
          <For each={getEofScenarios()}>
            {(scenario) => (
              <div class="legend-item">
                <span class="legend-swatch" style={`background:${getEofScenarioColor(scenario.id)}`} />
                {scenario.name}
              </div>
            )}
          </For>
        </div>
        <div class="generated-report" style="white-space:pre-wrap">
          {eofResults()}
        </div>
      </div>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Generated Report</h2>
        </div>
        <button
          class="btn-secondary"
          type="button"
          style="margin-bottom:6px"
          onClick={() => {
            if (reportText()) navigator.clipboard.writeText(reportText());
          }}
        >
          Copy Report
        </button>
        <textarea
          class="generated-report"
          readonly
          placeholder="Generate a report to see it here."
          value={reportText()}
        />
      </div>
    </>
  );
};

export default ExportPanel;
