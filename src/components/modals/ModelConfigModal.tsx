import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import type { AnalysisConfig } from "../../model/config";
import { analysisConfig, getConfigSnapshot, resetConfig, updateConfig } from "../../stores/analysis-config";

interface EditableField {
  key: keyof AnalysisConfig;
  label: string;
  step: number;
  description: string;
}

const EDITABLE_FIELDS: EditableField[] = [
  { key: "min_speed_kts", label: "Min speed (kts)", step: 5, description: "Lower bound for candidate groundspeed." },
  { key: "max_speed_kts", label: "Max speed (kts)", step: 5, description: "Upper bound for candidate groundspeed." },
  {
    key: "max_post_arc7_minutes",
    label: "Post-Arc 7 minutes",
    step: 1,
    description: "Allowed continuation after the final handshake.",
  },
  {
    key: "debris_weight_min_lat",
    label: "Debris min lat",
    step: 0.5,
    description: "Lower latitude edge for the debris weighting band.",
  },
  {
    key: "debris_weight_max_lat",
    label: "Debris max lat",
    step: 0.5,
    description: "Upper latitude edge for the debris weighting band.",
  },
  {
    key: "fuel_remaining_at_arc1_kg",
    label: "Fuel at Arc 1 (kg)",
    step: 100,
    description: "Starting fuel used by the post-radar model.",
  },
];

interface ModelConfigModalProps {
  open: boolean;
  onClose: () => void;
}

const ModelConfigModal: Component<ModelConfigModalProps> = (props) => {
  const [localValues, setLocalValues] = createSignal<Record<string, number>>({});

  const initValues = () => {
    const config = getConfigSnapshot();
    const values: Record<string, number> = {};
    for (const field of EDITABLE_FIELDS) {
      values[field.key] = config[field.key] as number;
    }
    setLocalValues(values);
  };

  const handleApply = () => {
    const patch: Partial<AnalysisConfig> = {};
    for (const field of EDITABLE_FIELDS) {
      const value = localValues()[field.key];
      if (value !== undefined) {
        (patch as Record<string, number>)[field.key] = value;
      }
    }
    updateConfig(patch);
    props.onClose();
  };

  const handleReset = () => {
    resetConfig();
    initValues();
  };

  // Initialize values when opened
  const isOpen = () => {
    if (props.open) initValues();
    return props.open;
  };

  return (
    <Show when={isOpen()}>
      <div class="drift-modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="drift-modal">
          <h3>Configure Model</h3>
          <p class="drift-modal-intro">
            Adjust a few high-leverage assumptions, then rerun the model to refresh paths and the heatmap.
          </p>
          <div class="drift-modal-fields">
            <For each={EDITABLE_FIELDS}>
              {(field) => (
                <div class="drift-modal-field">
                  <label>{field.label}</label>
                  <span class="drift-modal-desc">{field.description}</span>
                  <input
                    type="number"
                    step={field.step}
                    value={localValues()[field.key] ?? (analysisConfig[field.key] as number)}
                    onInput={(e) => {
                      const val = Number.parseFloat(e.currentTarget.value);
                      if (Number.isFinite(val)) {
                        setLocalValues((prev) => ({ ...prev, [field.key]: val }));
                      }
                    }}
                  />
                </div>
              )}
            </For>
          </div>
          <div class="drift-modal-buttons">
            <button class="btn-link" type="button" onClick={handleReset}>
              Reset to defaults
            </button>
            <button class="btn-secondary" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button class="btn-primary" type="button" onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ModelConfigModal;
