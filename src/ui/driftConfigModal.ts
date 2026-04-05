export interface DriftSimConfig {
  nParticles: number;
  nOrigins: number;
  maxDays: number;
}

type OnRunCallback = (config: DriftSimConfig) => void;

let modalEl: HTMLElement | null = null;

export function showDriftConfigModal(onRun: OnRunCallback): void {
  if (modalEl) return; // already open

  const backdrop = document.createElement("div");
  backdrop.className = "drift-modal-backdrop";
  backdrop.innerHTML = `
    <div class="drift-modal">
      <h3>Configure Drift Simulation</h3>
      <p class="drift-modal-intro">
        Monte Carlo simulation of debris drift from candidate crash sites along the 7th arc.
        Higher values = better accuracy, longer computation.
      </p>

      <div class="drift-modal-field">
        <label for="drift-cfg-particles">Particles per origin</label>
        <span class="drift-modal-desc">Number of simulated debris pieces per crash site. More = smoother probability estimate.</span>
        <select id="drift-cfg-particles">
          <option value="50">50 (fast preview)</option>
          <option value="100">100</option>
          <option value="200" selected>200 (default)</option>
          <option value="500">500</option>
          <option value="1000">1000 (high accuracy)</option>
        </select>
      </div>

      <div class="drift-modal-field">
        <label for="drift-cfg-origins">Origin points on 7th arc</label>
        <span class="drift-modal-desc">How many crash-site candidates to test along the satellite arc.</span>
        <select id="drift-cfg-origins">
          <option value="5">5 (sparse)</option>
          <option value="10">10</option>
          <option value="15" selected>15 (default)</option>
          <option value="25">25</option>
          <option value="50">50 (dense)</option>
        </select>
      </div>

      <div class="drift-modal-field">
        <label for="drift-cfg-days">Max drift days</label>
        <span class="drift-modal-desc">How long to simulate. Flaperon reached Reunion in ~507 days.</span>
        <select id="drift-cfg-days">
          <option value="300">300 (~10 months)</option>
          <option value="600">600 (~20 months)</option>
          <option value="900" selected>900 (~2.5 years)</option>
          <option value="1200">1200 (~3.3 years)</option>
        </select>
      </div>

      <div class="drift-modal-estimate" id="drift-cfg-estimate">
        Estimated time: ~15 seconds
      </div>

      <div class="drift-modal-buttons">
        <button id="drift-cfg-cancel" class="btn-secondary">Cancel</button>
        <button id="drift-cfg-run" class="btn-primary">Run Simulation</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  modalEl = backdrop;

  // Estimated time calculation
  const updateEstimate = () => {
    const p = Number((document.getElementById("drift-cfg-particles") as HTMLSelectElement).value);
    const o = Number((document.getElementById("drift-cfg-origins") as HTMLSelectElement).value);
    const d = Number((document.getElementById("drift-cfg-days") as HTMLSelectElement).value);
    // Baseline: 200 particles * 15 origins * 900 days ≈ 15s
    const baselineOps = 200 * 15 * 900;
    const ops = p * o * d;
    const estimate = Math.max(1, Math.round((ops / baselineOps) * 15));
    const el = document.getElementById("drift-cfg-estimate");
    if (el) {
      const warning = estimate > 60 ? ' <span style="color:#f59e0b;">⚠ This may take a while</span>' : "";
      el.innerHTML = `Estimated time: ~${estimate} seconds${warning}`;
    }
  };

  document.getElementById("drift-cfg-particles")?.addEventListener("change", updateEstimate);
  document.getElementById("drift-cfg-origins")?.addEventListener("change", updateEstimate);
  document.getElementById("drift-cfg-days")?.addEventListener("change", updateEstimate);

  // Cancel
  document.getElementById("drift-cfg-cancel")?.addEventListener("click", () => {
    hideDriftConfigModal();
  });

  // Close on backdrop click
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hideDriftConfigModal();
  });

  // Run
  document.getElementById("drift-cfg-run")?.addEventListener("click", () => {
    const config: DriftSimConfig = {
      nParticles: Number((document.getElementById("drift-cfg-particles") as HTMLSelectElement).value),
      nOrigins: Number((document.getElementById("drift-cfg-origins") as HTMLSelectElement).value),
      maxDays: Number((document.getElementById("drift-cfg-days") as HTMLSelectElement).value),
    };
    hideDriftConfigModal();
    onRun(config);
  });
}

export function hideDriftConfigModal(): void {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}
