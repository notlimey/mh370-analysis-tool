import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { getFamilyColor } from "../../layers/paths";
import { IS_TAURI } from "../../lib/backend";
import { formatLatLonDeg } from "../../lib/geo";
import { scheduleAutoSaveSessionSnapshot } from "../../lib/sessionSnapshot";
import { markModelRunCompleted } from "../../lib/workspaceState";
import { setupPopups } from "../../popups";
import { getConfigSnapshot } from "../../stores/analysis-config";
import { modelRunState, setRunStatus } from "../../stores/model-run";
import { setLoaderText, setLoaderVisible } from "../../stores/ui";
import { loadAllLayers, removeAllLayers } from "../map/MapContainer";
import ModelConfigModal from "../modals/ModelConfigModal";

const FAMILIES = ["slow", "perpendicular", "mixed", "other"];

const ModelPanel: Component = () => {
  const map = useMap();
  const [configModalOpen, setConfigModalOpen] = createSignal(false);

  const handleRunModel = async () => {
    const m = map();
    if (!m) return;
    const startedAt = new Date();
    setRunStatus({ state: "running", startedAt });
    setLoaderText("Running model");
    setLoaderVisible(true);
    try {
      removeAllLayers(m);
      const summary = await loadAllLayers(m, () => {});
      setupPopups(m);
      setRunStatus({
        state: "completed",
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        pathCount: summary.pathCount,
        heatmapCount: summary.heatmapCount,
        bestFamily: summary.bestFamily,
        bfoDiagnosticCount: summary.bfoDiagnosticCount,
        bfoAvailable: summary.bfoAvailable,
      });
      markModelRunCompleted(getConfigSnapshot(), new Date());
      scheduleAutoSaveSessionSnapshot();
    } catch (err) {
      console.error("Failed to reload layers:", err);
      setRunStatus({
        state: "failed",
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    setLoaderVisible(false);
  };

  const runStatus = () => modelRunState.runStatus;
  const results = () => modelRunState.resultSummary;
  const family = () => modelRunState.familySummary;
  const summary = () => modelRunState.summary;

  const runStatusText = () => {
    const s = runStatus();
    switch (s.state) {
      case "idle":
        return "Not run yet.";
      case "running":
        return "Running...";
      case "completed": {
        const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : "";
        return `Completed${dur ? ` in ${dur}` : ""}`;
      }
      case "failed":
        return `Failed: ${s.error ?? "unknown error"}`;
    }
  };

  const runStatusDetail = () => {
    const s = runStatus();
    if (s.state === "completed") return `${s.pathCount ?? 0} paths, ${s.heatmapCount ?? 0} heatmap points`;
    return "";
  };

  const warnings = () => {
    const r = results();
    if (!r) return [];
    const w: string[] = [];
    if (r.bfoMeanAbsResidualHz != null && r.bfoMeanAbsResidualHz > 40) {
      w.push(`BFO fit is weak (${r.bfoMeanAbsResidualHz.toFixed(1)} Hz), so the best path is not tightly constrained.`);
    }
    const endpointMismatch =
      r.bestEndpointLat != null &&
      r.peakLat != null &&
      (Math.sign(r.bestEndpointLat) !== Math.sign(r.peakLat) || Math.abs(r.bestEndpointLat - r.peakLat) > 10);
    if (endpointMismatch) {
      w.push(
        "Best path endpoint and heatmap peak diverge. Treat the heatmap as a broad density view, not confirmation of the blue path.",
      );
    }
    return w;
  };

  return (
    <>
      <ModelConfigModal open={configModalOpen()} onClose={() => setConfigModalOpen(false)} />
      <div class="sidebar-section-inner">
        {/* Overview */}
        <div class="section-heading">
          <h2>Overview</h2>
        </div>
        <div class="model-info">
          <div id="confidence-display">
            <span class="label">Highest probability zone</span>
            <span class="value">{summary().confidence}</span>
          </div>
          <div id="assumptions-display">
            <span class="label">Speed range</span>
            <span class="value">{summary().speedRange}</span>
            <span class="label">Arc 7 fuel</span>
            <span class="value">{summary().fuel}</span>
            <span class="label">Family spread</span>
            <span class="value">{summary().familySpread}</span>
          </div>
        </div>
        <Show when={IS_TAURI}>
          <div class="button-row" style="margin-top:8px">
            <button class="btn-secondary" type="button" onClick={() => setConfigModalOpen(true)}>
              Configure
            </button>
            <button class="btn-primary" type="button" onClick={handleRunModel}>
              Run Model
            </button>
          </div>
        </Show>

        {/* Run Status */}
        <div class="sidebar-section-inner">
          <div class="section-heading">
            <h2>Run Status</h2>
          </div>
          <div class="model-run-status">
            <div>{runStatusText()}</div>
            <Show when={runStatusDetail()}>
              <div>{runStatusDetail()}</div>
            </Show>
          </div>
        </div>

        {/* Results */}
        <div class="sidebar-section-inner">
          <div class="section-heading">
            <h2>Results</h2>
          </div>
          <Show when={results()} fallback={<div class="info-text">Run the model to populate results.</div>}>
            {(r) => (
              <>
                <div class="results-grid">
                  <span class="label">Best family</span>
                  <span class="value">{r().bestFamily ?? "\u2014"}</span>
                  <span class="label">Peak</span>
                  <span class="value">{formatLatLonDeg(r().peakLat, r().peakLon)}</span>
                  <span class="label">Best endpoint</span>
                  <span class="value">{formatLatLonDeg(r().bestEndpointLat, r().bestEndpointLon)}</span>
                  <span class="label">Paths</span>
                  <span class="value">{r().pathCount}</span>
                  <span class="label">Heatmap</span>
                  <span class="value">{r().heatmapCount} points</span>
                  <Show when={r().fuelFeasiblePercent != null}>
                    <span class="label">Fuel feasible</span>
                    <span class="value">{r().fuelFeasiblePercent!.toFixed(0)}%</span>
                  </Show>
                  <Show when={r().bfoMeanAbsResidualHz != null}>
                    <span class="label">BFO residual</span>
                    <span class="value">{r().bfoMeanAbsResidualHz!.toFixed(1)} Hz</span>
                  </Show>
                  <Show when={r().searchedOverlapLabel}>
                    <span class="label">Search overlap</span>
                    <span class="value">{r().searchedOverlapLabel}</span>
                  </Show>
                </div>
                <Show when={warnings().length > 0}>
                  <div class="info-text" style="margin-top:10px">
                    {warnings().join(" ")}
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>

        {/* Path Families */}
        <div class="sidebar-section-inner">
          <div class="section-heading">
            <h2>Path Families</h2>
          </div>
          <div class="family-legend">
            <Show when={family()}>
              {(fam) => (
                <For each={FAMILIES.filter((f) => (fam().counts[f] ?? 0) > 0)}>
                  {(f) => (
                    <div class="family-row">
                      <span class="family-swatch" style={`background:${getFamilyColor(f)}`} />
                      <span class="family-name">{f}</span>
                      <span class="family-count">{fam().counts[f] ?? 0}</span>
                    </div>
                  )}
                </For>
              )}
            </Show>
          </div>
          <Show when={family()?.endpointNarrative}>
            <div class="toggle-note family-endpoint-note">{family()!.endpointNarrative}</div>
          </Show>
        </div>
      </div>
    </>
  );
};

export default ModelPanel;
