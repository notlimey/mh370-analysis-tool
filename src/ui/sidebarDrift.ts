import { getMap } from "../map";
import {
  onOriginSelectionChange,
  getBeachingClouds,
  getSelectedOriginIndex,
  selectOrigin,
  populateDriftClouds,
} from "../layers/drift_clouds";
import { getDriftBeaching, type BackendBeachingCloud, type DriftBeachingProgress, IS_TAURI } from "../lib/backend";
import { getAnalysisConfig } from "../model/config";
import { showDriftConfigModal } from "./driftConfigModal";
import { hideDriftProgress, showDriftProgress, updateDriftProgress } from "./driftProgress";
import { initInversionControls, renderInversionSection } from "./sidebarInversion";
import { markDriftRunCompleted } from "../lib/workspaceState";

const ACTUAL_FIND_NAMES = [
  "Flaperon, Réunion",
  "Flap track, Mozambique",
  "NO STEP panel, Mozambique",
  "Engine cowl, Mozambique",
  "Panel, Mossel Bay SA",
  "Interior, Mauritius",
  "Outboard flap, Tanzania",
  "Window, Rodrigues Is.",
  "Interior, Tanzania",
  "Flap, Mauritius",
  "Panel, Madagascar",
  "Broken O, Madagascar",
  "Panel, Nosy Boraha",
  "Panel, Maputo Mozambique",
];

export function renderDriftPanel(): string {
  const hasResults = getBeachingClouds().length > 0;
  return `
    <div class="sidebar-section">
      <div class="section-heading"><h2>Drift Simulation</h2></div>
      <p class="drift-hint">Run a synthetic debris-drift simulation from candidate crash sites along the 7th arc.</p>
      <div class="drift-callout">Use this to compare origins. Higher fit means the simulated debris beaches closer to the observed places and dates.</div>
      <button id="run-drift-sim-btn" class="btn-primary" style="width:100%">${hasResults ? "Run Again With Settings" : "Run Drift Simulation"}</button>
      <div id="drift-sim-status" class="toggle-note" style="margin-top:8px;">${hasResults ? `Showing ${getBeachingClouds().length} candidate origins from the latest run.` : "No drift simulation run yet."}</div>
    </div>

    <div class="sidebar-section" ${hasResults ? "" : 'style="display:none;"'} id="drift-origins-section">
      <div class="section-heading"><h2>Compare Origins</h2></div>
      <p class="drift-hint">Click an origin to inspect its beaching pattern. Click it again to clear the selection.</p>
      <div id="drift-origin-list" class="drift-origin-list"></div>
    </div>

    <div class="sidebar-section" id="drift-detail-section" style="display:none;">
      <div class="section-heading"><h2>Selected Origin</h2></div>
      <div id="drift-detail" class="drift-detail"></div>
    </div>

    <div class="sidebar-section">
      <div class="section-heading"><h2>Legend</h2></div>
      <div class="drift-legend">
        <div class="drift-legend-row">
          <span class="drift-legend-dot" style="background:#ef4444;border:2px solid #fff;"></span>
          Confirmed MH370 debris find
        </div>
        <div class="drift-legend-row">
          <span class="drift-legend-dot" style="background:#f59e0b;border:2px solid #fff;"></span>
          Probable MH370 debris find
        </div>
        <div class="drift-legend-row">
          <span class="drift-legend-gradient" style="background:linear-gradient(to right, #3b82f6, #22d3ee, #22c55e, #eab308, #f97316, #ef4444);width:60px;height:12px;border-radius:3px;display:inline-block;flex-shrink:0;"></span>
          Beached particle (100d → 900d)
        </div>
        <div class="drift-legend-row">
          <span class="drift-legend-dot" style="background:rgba(180,180,180,0.3);"></span>
          Still drifting after 900 days
        </div>
      </div>
    </div>

    ${renderInversionSection("drift")}
  `;
}

export function wireDriftPanel(): void {
  initInversionControls();

  document.getElementById("run-drift-sim-btn")?.addEventListener("click", () => {
    showDriftConfigModal(async (config) => {
      await handleRunDriftSimulation(config);
    });
  });

  const container = document.getElementById("drift-origin-list");
  container?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-origin-idx]");
    if (!button) return;
    const idx = Number(button.dataset.originIdx);
    const currentIdx = getSelectedOriginIndex();
    const map = getMap();
    selectOrigin(map, currentIdx === idx ? null : idx);
  });

  onOriginSelectionChange((_idx, cloud) => {
    updateDriftOriginList();
    renderDriftDetail(cloud);
  });

  updateDriftOriginList();
}

async function handleRunDriftSimulation(config: { nParticles: number; nOrigins: number; maxDays: number }): Promise<void> {
  const statusEl = document.getElementById("drift-sim-status");
  if (statusEl) statusEl.textContent = "Running simulation...";

  showDriftProgress();

  let unlisten: (() => void) | undefined;
  try {
    if (IS_TAURI) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<DriftBeachingProgress>("drift-beaching-progress", (event) => {
        const p = event.payload;
        updateDriftProgress(
          p.pct,
          `Simulating origin ${p.origin_index}/${p.total_origins} at ${Math.abs(p.origin_lat).toFixed(1)}°S...`,
        );
      });
    }

    const clouds = await getDriftBeaching({
      n_particles: config.nParticles,
      n_origins: config.nOrigins,
      max_days: config.maxDays,
    }, getAnalysisConfig());

    const map = getMap();
    populateDriftClouds(map, clouds);
    markDriftRunCompleted(getAnalysisConfig(), new Date());

    const originsSection = document.getElementById("drift-origins-section");
    if (originsSection) originsSection.style.display = "";
    updateDriftOriginList();

    if (statusEl) statusEl.textContent = `Simulation complete — ${clouds.length} origins, ${config.nParticles} particles per profile.`;
    const runBtn = document.getElementById("run-drift-sim-btn");
    if (runBtn) runBtn.textContent = "Re-run Simulation";
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${err}`;
  } finally {
    unlisten?.();
    hideDriftProgress();
  }
}

function updateDriftOriginList(): void {
  const container = document.getElementById("drift-origin-list");
  if (!container) return;

  const clouds = getBeachingClouds();
  const selectedIdx = getSelectedOriginIndex();

  if (clouds.length === 0) {
    container.innerHTML = '<p class="drift-hint">Click "Configure & Run" above to start a simulation.</p>';
    return;
  }

  container.innerHTML = clouds.map((cloud, i) => {
    const pct = Math.round(cloud.beaching_fraction * 100);
    const isSelected = selectedIdx === i;
    const t = clouds.length > 1 ? i / (clouds.length - 1) : 0.5;
    const hue = Math.round(180 - t * 160);
    const color = `hsl(${hue}, 85%, 55%)`;
    const dimClass = pct === 0 ? " drift-origin-btn--dim" : "";
    const label = pct === 0 ? "still drifting" : `${pct}% · fit ${cloud.fit_score.toFixed(0)}`;
    return `
      <button class="drift-origin-btn${dimClass} ${isSelected ? "drift-origin-btn--active" : ""}" data-origin-idx="${i}">
        <span class="drift-origin-dot" style="background:${color};"></span>
        <span class="drift-origin-label">${Math.abs(cloud.origin_lat).toFixed(1)}°S</span>
        <span class="drift-origin-pct">${label}</span>
      </button>
    `;
  }).join("");
}

function renderDriftDetail(cloud: BackendBeachingCloud | null): void {
  const section = document.getElementById("drift-detail-section");
  const container = document.getElementById("drift-detail");
  if (!section || !container) return;

  if (!cloud) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  const coastCounts: Record<string, { count: number; avgDays: number }> = {};
  for (const bp of cloud.beached) {
    if (!coastCounts[bp.coast]) coastCounts[bp.coast] = { count: 0, avgDays: 0 };
    coastCounts[bp.coast].count++;
    coastCounts[bp.coast].avgDays += bp.days;
  }
  for (const entry of Object.values(coastCounts)) {
    entry.avgDays = Math.round(entry.avgDays / entry.count);
  }

  const total = cloud.beached.length + cloud.still_drifting.length;
  const pctBeached = Math.round(cloud.beaching_fraction * 100);
  const sorted = Object.entries(coastCounts).sort((a, b) => b[1].count - a[1].count);
  const debugRows = Object.entries(cloud.debug_coast_contacts)
    .sort((a, b) => b[1] - a[1])
    .map(([coast, contacts]) => {
      const captures = cloud.debug_coast_captures[coast] ?? 0;
      return `<div class="drift-debug-row"><span>${coast}</span><span>${contacts} contacts / ${captures} captures</span></div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="drift-detail-header">
      <strong>Origin: ${Math.abs(cloud.origin_lat).toFixed(1)}°S, ${cloud.origin_lon.toFixed(1)}°E</strong>
      <span>${pctBeached}% beached (${cloud.beached.length} / ${total})</span>
    </div>
    <div class="drift-coast-breakdown">
      ${sorted.map(([coast, info]) => {
        const barWidth = Math.round((info.count / total) * 100);
        return `
          <div class="drift-coast-row">
            <span class="drift-coast-name">${coast}</span>
            <div class="drift-coast-bar-track">
              <div class="drift-coast-bar" style="width:${barWidth}%"></div>
            </div>
            <span class="drift-coast-stats">${info.count} (~${info.avgDays}d)</span>
          </div>
        `;
      }).join("")}
      ${cloud.still_drifting.length > 0 ? `
        <div class="drift-coast-row">
          <span class="drift-coast-name" style="color:var(--text-muted)">Still drifting</span>
          <div class="drift-coast-bar-track">
            <div class="drift-coast-bar drift-coast-bar--muted" style="width:${Math.round((cloud.still_drifting.length / total) * 100)}%"></div>
          </div>
          <span class="drift-coast-stats">${cloud.still_drifting.length}</span>
        </div>
      ` : ""}
    </div>
    <div class="drift-match-section">
      <strong>Debris Fit: ${cloud.fit_score.toFixed(0)}/100</strong>
      <div class="toggle-note">Spatial ${cloud.spatial_score.toFixed(0)}/100 · Timing ${cloud.timing_score.toFixed(0)}/100 · Strong matches ${cloud.match_score}/${cloud.match_total}</div>
      <div class="drift-match-list">
        ${ACTUAL_FIND_NAMES.map((name) => {
          const matched = cloud.matched_finds.includes(name);
          return `<div class="drift-match-item ${matched ? "drift-match--yes" : "drift-match--no"}">${matched ? "✓" : "✗"} ${name}</div>`;
        }).join("")}
      </div>
    </div>
    ${debugRows ? `
      <div class="drift-match-section">
        <strong>Coast Debug</strong>
        <div class="toggle-note">Raw coast contacts before capture. Use this to see whether South Africa or west Madagascar are being reached at all.</div>
        <div class="drift-debug-list">${debugRows}</div>
      </div>
    ` : ""}
  `;
}
