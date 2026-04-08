import type { Component } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { type BackendBfoStepthrough, getBfoStepthroughs, IS_TAURI } from "../../lib/backend";
import { applyBfoInspectionPreset, restorePreviousLayerVisibility } from "../../stores/layer-visibility";
import { applyLayerVisibility } from "../map/MapContainer";

function residualColor(residual: number | null): string {
  if (residual == null) return "var(--text-muted)";
  const abs = Math.abs(residual);
  if (abs < 4.3) return "#22c55e"; // green — within DSTG sigma
  if (abs < 10) return "#f59e0b"; // yellow — elevated
  return "#ef4444"; // red — large
}

function formatHz(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

const BfoPanel: Component = () => {
  const map = useMap();
  const [stepthroughs, setStepthroughs] = createSignal<BackendBfoStepthrough[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  onMount(() => {
    applyBfoInspectionPreset();
    const m = map();
    if (m) applyLayerVisibility(m);
  });

  onCleanup(() => {
    restorePreviousLayerVisibility();
    const m = map();
    if (m) applyLayerVisibility(m);
  });

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBfoStepthroughs();
      setStepthroughs(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const levelFlightArcs = () => stepthroughs().filter((s) => [2, 3, 4, 5, 6].includes(s.arc));
  const levelFlightRms = () => {
    const arcs = levelFlightArcs();
    const residuals = arcs.map((s) => s.residual_hz).filter((r): r is number => r != null);
    if (residuals.length === 0) return null;
    const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);
    return rms;
  };

  return (
    <div class="sidebar-section-inner">
      {/* Callout box */}
      <div
        class="info-text"
        style="background: var(--surface-raised); border-left: 3px solid var(--accent); padding: 10px 12px; margin-bottom: 14px; font-size: 12px; line-height: 1.5"
      >
        BFO residuals of ~4 Hz on arcs 2-5 reflect <strong>in-sample solver fit</strong> — the path solver optimizes
        aircraft position to minimize these residuals. This is not independent validation. The DSTG's 4.3 Hz sigma was
        derived from 20 historical flights of 9M-MRO with known radar positions, a dataset not publicly available.
        Independent validation against known positions is not possible from public data.
      </div>

      <Show
        when={IS_TAURI}
        fallback={<div class="info-text">BFO stepthrough requires the Tauri backend (desktop mode).</div>}
      >
        <Show when={!loaded()}>
          <button class="btn-primary" type="button" onClick={handleLoad} disabled={loading()}>
            {loading() ? "Computing..." : "Load BFO Stepthrough"}
          </button>
        </Show>
      </Show>

      <Show when={error()}>
        <div class="info-text" style="color: var(--error)">
          {error()}
        </div>
      </Show>

      <Show when={loaded() && stepthroughs().length > 0}>
        {/* Summary line */}
        <Show when={levelFlightRms() != null}>
          <div style="margin-bottom: 10px; font-size: 12px">
            Level-flight arcs (2-5, 6b) RMS: <strong>{levelFlightRms()!.toFixed(1)} Hz</strong>
            <span style="color: var(--text-muted)"> (in-sample)</span>
          </div>
        </Show>

        {/* Stepthrough table */}
        <div style="overflow-x: auto">
          <table class="bfo-table">
            <thead>
              <tr>
                <th>Arc</th>
                <th>Time</th>
                <th>Measured</th>
                <th title="Holland Eq (3): Doppler from aircraft-satellite relative motion">Uplink</th>
                <th title="Holland Eq (4): SDU pre-compensation using nominal satellite position">AES Comp</th>
                <th title="Doppler from satellite orbital motion to Perth GES">Downlink</th>
                <th title="Inmarsat-provided per-arc correction (delta_f_sat + delta_f_AFC)">AFC</th>
                <th title="SDU oscillator bias (150 Hz)">Bias</th>
                <th>Predicted</th>
                <th>Residual</th>
              </tr>
            </thead>
            <tbody>
              <For each={stepthroughs()}>
                {(step) => (
                  <tr>
                    <td>{step.arc}</td>
                    <td style="font-size: 11px; white-space: nowrap">{step.arc_time}</td>
                    <td>{step.measured_bfo_hz != null ? step.measured_bfo_hz.toFixed(0) : "\u2014"}</td>
                    <td style="font-size: 11px">{step.uplink_doppler_hz.toFixed(1)}</td>
                    <td style="font-size: 11px">{step.aes_compensation_hz.toFixed(1)}</td>
                    <td style="font-size: 11px">{step.downlink_doppler_hz.toFixed(1)}</td>
                    <td style="font-size: 11px">{step.afc_correction_hz.toFixed(1)}</td>
                    <td style="font-size: 11px">{step.bias_hz.toFixed(0)}</td>
                    <td>{step.predicted_bfo_hz.toFixed(1)}</td>
                    <td style={`color: ${residualColor(step.residual_hz)}; font-weight: 600`}>
                      {formatHz(step.residual_hz)} Hz
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        {/* Validation notes per arc */}
        <div class="section-heading" style="margin-top: 16px">
          <h2>Validation Notes</h2>
        </div>
        <div style="font-size: 12px; line-height: 1.6">
          <For each={stepthroughs()}>
            {(step) => (
              <div style="margin-bottom: 6px">
                <strong>Arc {step.arc}</strong>
                <span
                  style={`margin-left: 6px; padding: 1px 5px; border-radius: 3px; font-size: 10px; background: ${step.is_in_sample ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)"}; color: ${step.is_in_sample ? "#ef4444" : "#22c55e"}`}
                >
                  {step.is_in_sample ? "in-sample" : "not scored"}
                </span>
                <div style="color: var(--text-muted); margin-top: 2px">{step.validation_note}</div>
              </div>
            )}
          </For>
        </div>

        {/* Equation reference */}
        <div class="section-heading" style="margin-top: 16px">
          <h2>Equation Chain</h2>
        </div>
        <div style="font-size: 12px; line-height: 1.6; color: var(--text-muted)">
          <div>
            BFO = <em>uplink</em> + <em>AES comp</em> + <em>downlink</em> + <em>AFC</em> + <em>bias</em>
          </div>
          <div style="margin-top: 4px">
            Uplink: Holland 2017 Eq (3) &mdash; aircraft-satellite Doppler at L-band (1646.6 MHz)
          </div>
          <div>AES comp: Holland Eq (4) &mdash; SDU pre-correction using nominal sat position at sea level</div>
          <div>Downlink: satellite motion Doppler at C-band (3615 MHz) to Perth GES</div>
          <div>AFC: Inmarsat-provided satellite oscillator + GES AFC correction per arc</div>
          <div>Bias: 150 Hz fixed (ATSB/DSTG, from 20 prior flights of 9M-MRO)</div>
        </div>

        {/* Reload button */}
        <Show when={IS_TAURI}>
          <div style="margin-top: 14px">
            <button class="btn-secondary" type="button" onClick={handleLoad} disabled={loading()}>
              Reload
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default BfoPanel;
