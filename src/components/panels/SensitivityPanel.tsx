import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import type { ParameterSweepResult, SensitivityProgress, SensitivityResult, SweepParameter } from "../../lib/backend";
import { IS_TAURI, runSensitivitySweep } from "../../lib/backend";
import { getConfigSnapshot } from "../../stores/analysis-config";

interface ParamDef extends SweepParameter {
  label: string;
  group: string;
}

const DEFAULT_PARAMETERS: ParamDef[] = [
  { field_name: "fuel_remaining_at_arc1_kg", sigma: 2000, label: "Fuel at Arc 1 (kg)", group: "Fuel" },
  { field_name: "fuel_baseline_kg_per_hr", sigma: 500, label: "Fuel burn rate (kg/hr)", group: "Fuel" },
  { field_name: "fuel_speed_exponent", sigma: 0.15, label: "Fuel speed exponent", group: "Fuel" },
  { field_name: "post_arc7_low_speed_kts", sigma: 30, label: "Post-Arc 7 speed (kts)", group: "Fuel" },
  { field_name: "max_post_arc7_minutes", sigma: 15, label: "Post-Arc 7 endurance (min)", group: "Fuel" },
  { field_name: "speed_consistency_sigma_kts", sigma: 10, label: "Speed sigma (kts)", group: "Scoring" },
  { field_name: "heading_change_sigma_deg", sigma: 20, label: "Heading sigma (deg)", group: "Scoring" },
  { field_name: "northward_penalty_weight", sigma: 0.5, label: "Northward penalty weight", group: "Scoring" },
  { field_name: "northward_leg_sigma_deg", sigma: 0.5, label: "Northward sigma (deg)", group: "Scoring" },
  { field_name: "bfo_sigma_hz", sigma: 3, label: "BFO sigma (Hz)", group: "BFO" },
  { field_name: "bfo_score_weight", sigma: 0.3, label: "BFO score weight", group: "BFO" },
  { field_name: "cruise_altitude_ft", sigma: 5000, label: "Cruise altitude (ft)", group: "Aircraft" },
  { field_name: "min_speed_kts", sigma: 30, label: "Min speed (kts)", group: "Aircraft" },
  { field_name: "max_speed_kts", sigma: 30, label: "Max speed (kts)", group: "Aircraft" },
  { field_name: "satellite_drift_amplitude_deg", sigma: 0.3, label: "Sat drift amplitude (deg)", group: "Satellite" },
];

function formatLatLon(lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null) return "\u2014";
  const latH = lat < 0 ? "S" : "N";
  const lonH = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}\u00b0${latH}, ${Math.abs(lon).toFixed(2)}\u00b0${lonH}`;
}

const SensitivityPanel: Component = () => {
  const [selectedFields, setSelectedFields] = createSignal<Set<string>>(
    new Set(DEFAULT_PARAMETERS.map((p) => p.field_name)),
  );
  const [sigmas, setSigmas] = createSignal<Record<string, number>>(
    Object.fromEntries(DEFAULT_PARAMETERS.map((p) => [p.field_name, p.sigma])),
  );
  const [stepsPerSide, setStepsPerSide] = createSignal(3);
  const [sweepState, setSweepState] = createSignal<"idle" | "running" | "completed" | "failed">("idle");
  const [sweepResult, setSweepResult] = createSignal<SensitivityResult | null>(null);
  const [sweepError, setSweepError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<{ pct: number; text: string } | null>(null);

  const groups = () => {
    const map = new Map<string, ParamDef[]>();
    for (const p of DEFAULT_PARAMETERS) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return Array.from(map.entries());
  };

  const toggleField = (field: string, checked: boolean) => {
    const next = new Set(selectedFields());
    if (checked) next.add(field);
    else next.delete(field);
    setSelectedFields(next);
  };

  const updateSigma = (field: string, value: number) => {
    setSigmas((prev) => ({ ...prev, [field]: value }));
  };

  const handleRun = async () => {
    if (!IS_TAURI) return;
    setSweepState("running");
    setSweepResult(null);
    setSweepError(null);
    setProgress({ pct: 0, text: "Starting..." });

    const parameters: SweepParameter[] = DEFAULT_PARAMETERS.filter((p) => selectedFields().has(p.field_name)).map(
      (p) => ({ field_name: p.field_name, sigma: sigmas()[p.field_name] ?? p.sigma }),
    );

    if (parameters.length === 0) {
      setSweepState("failed");
      setSweepError("No parameters selected");
      setProgress(null);
      return;
    }

    let unlisten: (() => void) | null = null;
    try {
      if (IS_TAURI) {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = (await listen<SensitivityProgress>("sensitivity-sweep-progress", (event) => {
          const p = event.payload;
          const param = DEFAULT_PARAMETERS.find((d) => d.field_name === p.parameter);
          setProgress({ pct: p.pct, text: `${param?.label ?? p.parameter} (${p.trial}/${p.total_trials})` });
        })) as unknown as () => void;
      }
      const result = await runSensitivitySweep({ parameters, steps_per_side: stepsPerSide() }, getConfigSnapshot());
      setSweepResult(result);
      setSweepState("completed");
    } catch (err) {
      setSweepState("failed");
      setSweepError(err instanceof Error ? err.message : String(err));
    } finally {
      unlisten?.();
      setProgress(null);
    }
  };

  const handleExport = () => {
    const result = sweepResult();
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sensitivity_sweep_${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const TornadoChart = (props: { sweeps: ParameterSweepResult[] }) => {
    const maxShift = () => Math.max(...props.sweeps.map((s) => s.peak_shift_km), 1);
    return (
      <div class="tornado-chart">
        <For each={props.sweeps}>
          {(sweep) => {
            const param = DEFAULT_PARAMETERS.find((p) => p.field_name === sweep.field_name);
            const negTrials = sweep.trials.filter((t) => t.delta_from_base < 0);
            const posTrials = sweep.trials.filter((t) => t.delta_from_base > 0);
            const maxNegShift = negTrials.length > 0 ? Math.max(...negTrials.map((t) => t.distance_from_base_km)) : 0;
            const maxPosShift = posTrials.length > 0 ? Math.max(...posTrials.map((t) => t.distance_from_base_km)) : 0;
            const negPct = (maxNegShift / maxShift()) * 50;
            const posPct = (maxPosShift / maxShift()) * 50;
            return (
              <div class="tornado-row">
                <div class="tornado-label" title={sweep.field_name}>
                  {param?.label ?? sweep.field_name}
                </div>
                <div class="tornado-bar-container">
                  <div class="tornado-bar-neg" style={`width:${negPct}%`} />
                  <div class="tornado-bar-center" />
                  <div class="tornado-bar-pos" style={`width:${posPct}%`} />
                </div>
                <div class="tornado-value">{sweep.peak_shift_km.toFixed(0)} km</div>
              </div>
            );
          }}
        </For>
      </div>
    );
  };

  return (
    <>
      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Parameters</h2>
        </div>
        <div class="sens-controls">
          <div class="sens-select-actions">
            <button
              class="btn-link"
              type="button"
              onClick={() => setSelectedFields(new Set(DEFAULT_PARAMETERS.map((p) => p.field_name)))}
            >
              Select all
            </button>
            <button class="btn-link" type="button" onClick={() => setSelectedFields(new Set())}>
              Select none
            </button>
          </div>
          <div class="sens-param-list">
            <For each={groups()}>
              {([group, params]) => (
                <div class="sens-param-group">
                  <div class="sens-param-group-label">{group}</div>
                  <For each={params}>
                    {(p) => (
                      <label class="sens-param-row">
                        <input
                          type="checkbox"
                          checked={selectedFields().has(p.field_name)}
                          onChange={(e) => toggleField(p.field_name, e.currentTarget.checked)}
                        />
                        <span class="sens-param-label">{p.label}</span>
                        <input
                          type="number"
                          class="sens-sigma-input"
                          value={sigmas()[p.field_name] ?? p.sigma}
                          step="any"
                          title="Sigma (perturbation per step)"
                          onInput={(e) =>
                            updateSigma(p.field_name, Number.parseFloat(e.currentTarget.value) || p.sigma)
                          }
                        />
                      </label>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
          <div class="sens-steps-row">
            <label>
              Steps per side:
              <input
                type="number"
                value={stepsPerSide()}
                min="1"
                max="5"
                style="width:50px"
                onInput={(e) => {
                  const val = Number.parseInt(e.currentTarget.value, 10);
                  if (val >= 1 && val <= 5) setStepsPerSide(val);
                }}
              />
            </label>
            <span class="sens-steps-hint">({stepsPerSide() * 2} trials per param)</span>
          </div>
        </div>
      </div>

      <Show when={IS_TAURI}>
        <div class="sidebar-section-inner">
          <button
            class="btn-primary"
            type="button"
            style="width:100%"
            disabled={sweepState() === "running"}
            onClick={handleRun}
          >
            {sweepState() === "running" ? "Running..." : "Run Sensitivity Sweep"}
          </button>
        </div>
      </Show>

      <Show when={progress()}>
        {(prog) => (
          <div class="sidebar-section-inner">
            <div class="sens-progress">
              <div class="drift-progress-bar-track">
                <div class="drift-progress-bar-fill" style={`width:${prog().pct}%`} />
              </div>
              <div class="sens-progress-status">{prog().text}</div>
              <div class="sens-progress-pct">{prog().pct}%</div>
            </div>
          </div>
        )}
      </Show>

      <Show when={sweepState() === "failed" && sweepError()}>
        <div class="sidebar-section-inner info-text" style="color:var(--danger,#ef4444)">
          {sweepError()}
        </div>
      </Show>

      <Show when={sweepState() === "completed" && sweepResult()}>
        {(result) => (
          <>
            <div class="sens-results">
              <div class="sens-results-header">
                <div class="results-grid">
                  <span class="label">Base peak</span>
                  <span class="value">{formatLatLon(result().base_peak_lat, result().base_peak_lon)}</span>
                  <span class="label">Base paths</span>
                  <span class="value">
                    {result().base_path_count} ({result().base_fuel_feasible_count} fuel-feasible)
                  </span>
                  <span class="label">Trials run</span>
                  <span class="value">{result().total_trials}</span>
                </div>
              </div>
              <div class="section-heading" style="margin-top:12px">
                <h2>Peak Shift by Parameter</h2>
              </div>
              <TornadoChart sweeps={result().sweeps} />
            </div>
            <div class="sidebar-section-inner">
              <button class="btn-secondary" type="button" style="width:100%" onClick={handleExport}>
                Export Results (JSON)
              </button>
            </div>
          </>
        )}
      </Show>
    </>
  );
};

export default SensitivityPanel;
