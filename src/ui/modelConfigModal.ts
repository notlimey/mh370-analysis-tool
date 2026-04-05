import { defaultAnalysisConfig, getAnalysisConfig, resetAnalysisConfig, updateAnalysisConfig, type AnalysisConfig } from "../model/config";
import { syncModelAssumptionsFromConfig } from "./panels/modelPanel";

type EditableField = {
  key: keyof AnalysisConfig;
  label: string;
  step: number;
  description: string;
};

const EDITABLE_FIELDS: EditableField[] = [
  { key: "min_speed_kts", label: "Min speed (kts)", step: 5, description: "Lower bound for candidate groundspeed." },
  { key: "max_speed_kts", label: "Max speed (kts)", step: 5, description: "Upper bound for candidate groundspeed." },
  { key: "max_post_arc7_minutes", label: "Post-Arc 7 minutes", step: 1, description: "Allowed continuation after the final handshake." },
  { key: "debris_weight_min_lat", label: "Debris min lat", step: 0.5, description: "Lower latitude edge for the debris weighting band." },
  { key: "debris_weight_max_lat", label: "Debris max lat", step: 0.5, description: "Upper latitude edge for the debris weighting band." },
  { key: "fuel_remaining_at_arc1_kg", label: "Fuel at Arc 1 (kg)", step: 100, description: "Starting fuel used by the post-radar model." },
];

let modalEl: HTMLElement | null = null;

export function showModelConfigModal(): void {
  if (modalEl) return;

  const config = getAnalysisConfig();
  const backdrop = document.createElement("div");
  backdrop.className = "drift-modal-backdrop";
  backdrop.innerHTML = `
    <div class="drift-modal">
      <h3>Configure Model</h3>
      <p class="drift-modal-intro">Adjust a few high-leverage assumptions, then rerun the model to refresh paths and the heatmap.</p>
      <div class="drift-modal-fields">
        ${EDITABLE_FIELDS.map((field) => `
          <div class="drift-modal-field">
            <label for="model-cfg-${field.key}">${field.label}</label>
            <span class="drift-modal-desc">${field.description}</span>
            <input id="model-cfg-${field.key}" type="number" step="${field.step}" value="${config[field.key]}" />
          </div>
        `).join("")}
      </div>
      <div class="drift-modal-buttons">
        <button id="model-cfg-reset" class="btn-secondary">Reset Defaults</button>
        <button id="model-cfg-cancel" class="btn-secondary">Cancel</button>
        <button id="model-cfg-save" class="btn-primary">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  modalEl = backdrop;

  document.getElementById("model-cfg-cancel")?.addEventListener("click", hideModelConfigModal);
  document.getElementById("model-cfg-reset")?.addEventListener("click", () => {
    resetAnalysisConfig();
    syncModelAssumptionsFromConfig();
    for (const field of EDITABLE_FIELDS) {
      const input = document.getElementById(`model-cfg-${field.key}`) as HTMLInputElement | null;
      if (input) input.value = String(defaultAnalysisConfig[field.key]);
    }
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) hideModelConfigModal();
  });

  document.getElementById("model-cfg-save")?.addEventListener("click", () => {
    const patch: Partial<AnalysisConfig> = {};
    for (const field of EDITABLE_FIELDS) {
      const input = document.getElementById(`model-cfg-${field.key}`) as HTMLInputElement | null;
      if (!input) continue;
      const value = Number(input.value);
      if (!Number.isFinite(value)) continue;
      patch[field.key] = value as never;
    }

    updateAnalysisConfig(patch);
    syncModelAssumptionsFromConfig();
    hideModelConfigModal();
  });
}

export function hideModelConfigModal(): void {
  if (!modalEl) return;
  modalEl.remove();
  modalEl = null;
}
