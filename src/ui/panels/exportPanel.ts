import type { PanelModule } from "../flyoutShell";
import { refreshCurrentPanel } from "../flyoutShell";
import { exportPathsGeojson, exportProbabilityGeojson, IS_TAURI } from "../../lib/backend";
import { getAnalysisConfig } from "../../model/config";
import { listSavedRuns } from "../../model/runs";
import { generateRunReport } from "../report";
import type { ReportSummary } from "../report";
import { copyCurrentUrlStateLink } from "../../lib/urlState";
import { copyAnalysisContextForAi } from "../../lib/contextExport";
import { downloadSessionSnapshot, importSessionSnapshot } from "../../lib/sessionSnapshot";
import { scheduleAutoSaveSessionSnapshot } from "../../lib/sessionSnapshot";
import { getStoredAnalystNotes, setStoredAnalystNotes } from "../../model/session";

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
