import type { PanelModule } from "../flyoutShell";
import { getMap, toggleLayer, layerVisibility } from "../../map";
import { SONAR_SOURCES, setSonarGroupOpacity, setSonarLayerVisible } from "../../layers/sonar";
import { refreshPinsLayer, setPinPlacementMode } from "../../layers/pins";
import { listSavedPins, removePin, savePin, updatePin } from "../../model/pins";
import { zoomToPriorityGaps } from "../../layers/priority";
import { openInfoDetail } from "../evidencePanel";
import { initInversionControls, renderInversionSection } from "../sidebarInversion";

interface LayerToggle {
  id: string;
  label: string;
  infoId: string;
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
  { id: "pins", label: "Saved Pins", infoId: "layer:points" },
  { id: "searched", label: "Searched Areas", infoId: "layer:searched" },
  { id: "drift-clouds", label: "Drift Beaching Sim", infoId: "layer:drift-clouds" },
];

const PRIORITY_GAP_FOCUS_PRESET: Record<string, boolean> = {
  flightpath: false, anomalies: false, airspaces: false, magnetic: false,
  arcs: false, heatmap: true, paths: false, debris: false,
  holidays: false, priority: true, points: false, searched: true, sonar: false,
};

let pinPlacementArmed = false;

function renderLayerToggles(): string {
  return LAYER_TOGGLES.map((toggle) => {
    const checked = layerVisibility[toggle.id] ? "checked" : "";
    const priorityNote = toggle.id === "priority"
      ? `<div id="priority-note" class="toggle-note" ${layerVisibility.heatmap ? 'style="display:none"' : ""}>Enable Probability Heatmap first to see coverage gaps.</div>`
      : "";
    return `
      <div class="toggle-row">
        <label class="toggle-main">
          <input type="checkbox" data-layer="${toggle.id}" ${checked} />
          <span>${toggle.label}</span>
        </label>
        <button class="info-btn" data-info-id="${toggle.infoId}" title="Info">i</button>
      </div>${priorityNote}`;
  }).join("");
}

function renderSonarControls(): string {
  const rows = SONAR_SOURCES.map((src) => `
    <div class="toggle-row">
      <label class="toggle-main">
        <input type="checkbox" data-sonar-group="${src.id}" checked />
        <span>${src.label}</span>
      </label>
      <button class="info-btn" data-info-id="sonar:${src.id}" title="Info">i</button>
    </div>
    <div class="toggle-note">${src.description}</div>
  `).join("");
  return `${rows}
    <label class="slider-row">
      <span>Sonar opacity</span>
      <input id="sonar-opacity" type="range" min="0" max="100" step="5" value="85" />
    </label>`;
}

function renderSavedPins(): string {
  const pins = listSavedPins();
  if (pins.length === 0) return '<div class="info-text">No pins saved yet.</div>';
  return pins.map((pin) => `
    <div class="pin-row" data-pin-id="${pin.id}">
      <input class="pin-label-input" type="text" value="${pin.label}" data-pin-id="${pin.id}" />
      <span class="pin-coords">${pin.coordinates[1].toFixed(4)}, ${pin.coordinates[0].toFixed(4)}</span>
      <button class="btn-remove-pin" data-pin-id="${pin.id}" title="Remove">&times;</button>
    </div>
  `).join("");
}

export function createLayersPanel(): PanelModule {
  return {
    render() {
      return `
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Map Layers</h2></div>
          <button id="focus-priority-btn" class="btn-secondary" style="margin-bottom:8px">Focus Priority Gaps</button>
          <div id="layer-toggles">${renderLayerToggles()}</div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Pins</h2></div>
          <button id="add-pin-btn" class="btn-secondary" style="margin-bottom:8px">${pinPlacementArmed ? "Click Map to Place Pin..." : "Add Pin"}</button>
          <div id="saved-pins-list" class="saved-pins-list">${renderSavedPins()}</div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Search Coverage</h2></div>
          <div id="sonar-toggles" class="sonar-toggles">${renderSonarControls()}</div>
        </div>

        <div class="sidebar-section-inner">
          ${renderInversionSection("standard")}
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Flight Path Legend</h2></div>
          <div class="legend">
            <div class="legend-item"><span class="legend-swatch" style="background:#facc15"></span> Confirmed (ATC radar)</div>
            <div class="legend-item"><span class="legend-swatch" style="background:#f97316;opacity:0.7"></span> Military radar</div>
            <div class="legend-item"><span class="legend-swatch" style="background:#f472b6;opacity:0.5"></span> Probable (inferred)</div>
          </div>
        </div>
      `;
    },

    wire() {
      const map = getMap();

      // Layer toggles
      document.querySelectorAll<HTMLInputElement>("#layer-toggles input[data-layer]").forEach((cb) => {
        cb.addEventListener("change", () => {
          toggleLayer(cb.dataset.layer!, cb.checked);
          const note = document.getElementById("priority-note");
          if (note) note.style.display = layerVisibility.heatmap ? "none" : "";
        });
      });

      // Focus priority
      document.getElementById("focus-priority-btn")?.addEventListener("click", () => {
        for (const [id, vis] of Object.entries(PRIORITY_GAP_FOCUS_PRESET)) {
          toggleLayer(id, vis);
        }
        syncLayerToggles();
        zoomToPriorityGaps(map);
      });

      // Pins
      document.getElementById("add-pin-btn")?.addEventListener("click", () => {
        pinPlacementArmed = !pinPlacementArmed;
        const btn = document.getElementById("add-pin-btn");
        if (btn) btn.textContent = pinPlacementArmed ? "Click Map to Place Pin..." : "Add Pin";
        setPinPlacementMode(map, pinPlacementArmed, (coordinates) => {
          savePin(coordinates);
          pinPlacementArmed = false;
          const b = document.getElementById("add-pin-btn");
          if (b) b.textContent = "Add Pin";
          refreshPinsLayer(map);
          const list = document.getElementById("saved-pins-list");
          if (list) list.innerHTML = renderSavedPins();
          wirePinActions();
        });
      });
      wirePinActions();

      // Sonar controls
      document.querySelectorAll<HTMLInputElement>("[data-sonar-group]").forEach((cb) => {
        cb.addEventListener("change", () => {
          setSonarLayerVisible(map, cb.dataset.sonarGroup!, cb.checked);
        });
      });
      document.getElementById("sonar-opacity")?.addEventListener("input", (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value) / 100;
        setSonarGroupOpacity(map, val);
      });

      // Info buttons
      document.querySelectorAll<HTMLElement>(".info-btn[data-info-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openInfoDetail(btn.dataset.infoId!);
        });
      });

      // Inversion controls
      initInversionControls();
    },
  };
}

function wirePinActions(): void {
  const map = getMap();
  document.querySelectorAll<HTMLInputElement>(".pin-label-input").forEach((input) => {
    input.addEventListener("change", () => {
      updatePin(input.dataset.pinId!, { label: input.value });
    });
  });
  document.querySelectorAll<HTMLElement>(".btn-remove-pin").forEach((btn) => {
    btn.addEventListener("click", () => {
      removePin(btn.dataset.pinId!);
      refreshPinsLayer(map);
      const list = document.getElementById("saved-pins-list");
      if (list) list.innerHTML = renderSavedPins();
      wirePinActions();
    });
  });
}

function syncLayerToggles(): void {
  document.querySelectorAll<HTMLInputElement>("#layer-toggles input[data-layer]").forEach((cb) => {
    cb.checked = !!layerVisibility[cb.dataset.layer!];
  });
}
