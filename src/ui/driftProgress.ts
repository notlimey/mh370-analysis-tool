let overlayEl: HTMLElement | null = null;

export function showDriftProgress(): void {
  if (overlayEl) return;

  const el = document.createElement("div");
  el.className = "drift-progress-overlay";
  el.innerHTML = `
    <div class="drift-progress-content">
      <div class="drift-progress-spinner"></div>
      <div class="drift-progress-status" id="drift-progress-status">Starting simulation...</div>
      <div class="drift-progress-bar-track">
        <div class="drift-progress-bar-fill" id="drift-progress-fill" style="width:0%"></div>
      </div>
      <div class="drift-progress-pct" id="drift-progress-pct">0%</div>
    </div>
  `;

  // Insert into #app container so it overlays the map
  const app = document.getElementById("app");
  if (app) {
    app.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
  overlayEl = el;
}

export function updateDriftProgress(pct: number, statusText: string): void {
  const fill = document.getElementById("drift-progress-fill");
  const status = document.getElementById("drift-progress-status");
  const pctEl = document.getElementById("drift-progress-pct");
  if (fill) fill.style.width = `${pct}%`;
  if (status) status.textContent = statusText;
  if (pctEl) pctEl.textContent = `${pct}%`;
}

export function hideDriftProgress(): void {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}
