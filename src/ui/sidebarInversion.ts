import { getMap } from "../map";
import { runDebrisInversion, type InversionResult, IS_TAURI } from "../lib/backend";
import {
  renderComparisonOverlay,
  renderDebrisInversionLayer,
  setComparisonOverlayVisible,
  setDebrisInversionVisible,
} from "../layers/debris_inversion";
import { getAnalysisConfig } from "../model/config";
import { updateModelSummaryPanel } from "./modelSummary";

let latestInversionResult: InversionResult | null = null;

export function renderInversionSection(mode: "standard" | "drift"): string {
  if (mode === "drift") {
    return `
      <div class="sidebar-section">
        <div class="section-heading"><h2>Inversion Analysis</h2></div>
        <label class="toggle-row">
          <span class="toggle-main">
            <input id="debris-inversion-toggle" type="checkbox" />
            <span>Debris Inversion Result</span>
          </span>
        </label>
        <label class="toggle-row">
          <span class="toggle-main">
            <input id="debris-comparison-toggle" type="checkbox" />
            <span>Satellite vs Debris Comparison</span>
          </span>
        </label>
        <div class="button-row">
          <button id="run-inversion-btn" class="btn-secondary">Run Inversion</button>
        </div>
        ${renderProgressMarkup()}
        <div id="inversion-summary" class="toggle-note" style="margin-top:8px;white-space:pre-line;">No inversion run yet.</div>
      </div>
    `;
  }

  return `
    <div class="sidebar-section">
      <div class="section-heading"><h2>Inversion Analysis</h2><button class="info-icon-button" type="button" data-info-id="section:inversion" aria-label="About Inversion Analysis">i</button></div>
      <label class="toggle-row">
        <span class="toggle-main">
          <input id="debris-inversion-toggle" type="checkbox" />
          <span>Debris Inversion Result</span>
        </span>
        <button class="info-icon-button" type="button" data-info-id="inversion:result" aria-label="About Debris Inversion Result">i</button>
      </label>
      <div class="toggle-note">Joint Bayesian inversion of debris items already present in this repo snapshot.</div>
      <label class="toggle-row">
        <span class="toggle-main">
          <input id="debris-comparison-toggle" type="checkbox" />
          <span>Satellite vs Debris Comparison</span>
        </span>
        <button class="info-icon-button" type="button" data-info-id="inversion:comparison" aria-label="About Satellite vs Debris Comparison">i</button>
      </label>
      <div class="button-row">
        <button id="run-inversion-btn" class="btn-secondary">Run Inversion</button>
        <button class="info-icon-button button-info" type="button" data-info-id="action:run-inversion" aria-label="About Run Inversion">i</button>
      </div>
      ${renderProgressMarkup()}
      <div id="inversion-summary" class="toggle-note" style="margin-top:8px;white-space:pre-line;">No inversion run yet.</div>
    </div>
  `;
}

function renderProgressMarkup(): string {
  return `
    <div id="inversion-progress" style="display:none;margin-top:8px;">
      <div style="height:6px;background:rgba(148,163,184,0.2);border-radius:999px;overflow:hidden;">
        <div id="inversion-progress-bar" style="height:100%;width:0%;background:#f97316;transition:width 160ms linear;"></div>
      </div>
    </div>
  `;
}

export function initInversionControls(): void {
  document.getElementById("run-inversion-btn")?.addEventListener("click", () => {
    void handleRunInversion();
  });
  document.getElementById("debris-inversion-toggle")?.addEventListener("change", () => {
    applyInversionVisibility();
  });
  document.getElementById("debris-comparison-toggle")?.addEventListener("change", () => {
    applyInversionVisibility();
  });
}

async function handleRunInversion(): Promise<void> {
  const button = document.getElementById("run-inversion-btn") as HTMLButtonElement | null;
  let unlisten: (() => void) | null = null;
  if (button) {
    button.disabled = true;
    button.textContent = "Running...";
  }
  setInversionProgressVisible(true);
  setInversionProgressPercent(IS_TAURI ? 0 : 35);

  try {
    if (IS_TAURI) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<number>("debris-inversion-progress", (event) => {
        setInversionProgressPercent(Math.max(0, Math.min(100, Number(event.payload) || 0)));
      });
    }

    const result = await runDebrisInversion(getAnalysisConfig());
    latestInversionResult = result;

    const map = getMap();
    renderDebrisInversionLayer(map, result);
    renderComparisonOverlay(map, result);

    const inversionToggle = document.getElementById("debris-inversion-toggle") as HTMLInputElement | null;
    const comparisonToggle = document.getElementById("debris-comparison-toggle") as HTMLInputElement | null;
    if (inversionToggle && !inversionToggle.checked) inversionToggle.checked = true;
    if (comparisonToggle && !comparisonToggle.checked) comparisonToggle.checked = true;

    setInversionProgressPercent(100);
    applyInversionVisibility();
    updateInversionSummary(result);
    updateModelSummaryPanel({
      debrisPeakLat: result.peak_lat,
      satellitePeakLat: result.satellite_peak_lat,
      intersectionLat: result.intersection_lat,
    });
  } catch (error) {
    const summary = document.getElementById("inversion-summary");
    if (summary) {
      summary.textContent = `Debris inversion failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    console.error("Failed to run debris inversion:", error);
  } finally {
    unlisten?.();
    window.setTimeout(() => setInversionProgressVisible(false), 250);
    if (button) {
      button.disabled = false;
      button.textContent = "Run Inversion";
    }
  }
}

function applyInversionVisibility(): void {
  if (!latestInversionResult) return;
  const map = getMap();
  const inversionVisible = (document.getElementById("debris-inversion-toggle") as HTMLInputElement | null)?.checked ?? false;
  const comparisonVisible = (document.getElementById("debris-comparison-toggle") as HTMLInputElement | null)?.checked ?? false;
  setDebrisInversionVisible(map, inversionVisible);
  setComparisonOverlayVisible(map, comparisonVisible);
}

function updateInversionSummary(result: InversionResult): void {
  const summary = document.getElementById("inversion-summary");
  if (!summary) return;
  const validationLine = result.validation_message ? `${result.validation_message}\n\n` : "";
  summary.textContent = `${validationLine}Debris peak: ${formatSouthLat(result.peak_lat)}\nSatellite peak: ${formatSouthLat(result.satellite_peak_lat)}\nIntersection: ${formatSouthLat(result.intersection_lat)}\nItems used: ${result.items_used}`;
}

function setInversionProgressPercent(progress: number): void {
  const bar = document.getElementById("inversion-progress-bar") as HTMLDivElement | null;
  if (bar) bar.style.width = `${progress}%`;
}

function setInversionProgressVisible(visible: boolean): void {
  const container = document.getElementById("inversion-progress");
  const bar = document.getElementById("inversion-progress-bar") as HTMLDivElement | null;
  if (container) container.style.display = visible ? "block" : "none";
  if (!visible && bar) bar.style.width = "0%";
}

function formatSouthLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}°S`;
}
