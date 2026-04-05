export interface DebrisSummaryState {
  debrisPeakLat?: number;
  satellitePeakLat?: number;
  intersectionLat?: number;
}

const PANEL_ID = "model-summary-panel";

export function ensureModelSummaryPanel(): void {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const sidebar = document.getElementById("sidebar");
  if (!sidebar) {
    return;
  }

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "sidebar-section model-summary-panel";
  sidebar.appendChild(panel);
  updateModelSummaryPanel({});
}

export function updateModelSummaryPanel(state: DebrisSummaryState): void {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }

  const hasValues = [state.debrisPeakLat, state.satellitePeakLat, state.intersectionLat].some(
    (value) => value !== undefined && Number.isFinite(value),
  );

  panel.toggleAttribute("hidden", !hasValues);
  if (!hasValues) {
    panel.innerHTML = "";
    return;
  }

  panel.innerHTML = `
    <div class="section-heading"><h2>Model Summary</h2></div>
    <div class="model-summary-grid">
      <div class="model-summary-label">Debris inversion</div>
      <div class="model-summary-value">${formatLat(state.debrisPeakLat)}</div>
      <div class="model-summary-label">Satellite peak</div>
      <div class="model-summary-value">${formatLat(state.satellitePeakLat)}</div>
      <div class="model-summary-label">Intersection</div>
      <div class="model-summary-value">${formatLat(state.intersectionLat)}</div>
    </div>
  `;
}

function formatLat(lat?: number): string {
  if (lat === undefined || !Number.isFinite(lat)) {
    return "--.-°S";
  }
  return `${Math.abs(lat).toFixed(1)}°S`;
}
