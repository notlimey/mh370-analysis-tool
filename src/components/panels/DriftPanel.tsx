import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { useMap } from "../../contexts/map-context";
import {
  renderComparisonOverlay,
  renderDebrisInversionLayer,
  setComparisonOverlayVisible,
  setDebrisInversionVisible,
} from "../../layers/debris-inversion";
import {
  getBeachingClouds,
  getSelectedOriginIndex,
  onOriginSelectionChange,
  populateDriftClouds,
  selectOrigin,
} from "../../layers/drift-clouds";
import type { BackendBeachingCloud, DriftBeachingProgress, InversionResult } from "../../lib/backend";
import { getDriftBeaching, IS_TAURI, runDebrisInversion } from "../../lib/backend";
import { markDriftRunCompleted, markInversionRunCompleted } from "../../lib/workspaceState";
import { getConfigSnapshot } from "../../stores/analysis-config";

const ACTUAL_FIND_NAMES = [
  "Flaperon, R\u00e9union",
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

const DriftPanel: Component = () => {
  const mapAccessor = useMap();

  // Drift sim state
  const [driftStatus, setDriftStatus] = createSignal(
    getBeachingClouds().length > 0
      ? `Showing ${getBeachingClouds().length} candidate origins from the latest run.`
      : "No drift simulation run yet.",
  );
  const [hasResults, setHasResults] = createSignal(getBeachingClouds().length > 0);
  const [originList, setOriginList] = createSignal<BackendBeachingCloud[]>(getBeachingClouds());
  const [selectedIdx, setSelectedIdx] = createSignal<number | null>(getSelectedOriginIndex());
  const [selectedCloud, setSelectedCloud] = createSignal<BackendBeachingCloud | null>(null);
  const [driftProgress, setDriftProgress] = createSignal<{ pct: number; text: string } | null>(null);

  // Drift config modal state
  const [showConfigModal, setShowConfigModal] = createSignal(false);
  const [cfgParticles, setCfgParticles] = createSignal(200);
  const [cfgOrigins, setCfgOrigins] = createSignal(15);
  const [cfgDays, setCfgDays] = createSignal(900);

  // Inversion state
  const [inversionResult, setInversionResult] = createSignal<InversionResult | null>(null);
  const [inversionVisible, setInversionVisible] = createSignal(false);
  const [comparisonVisible, setComparisonVisible] = createSignal(false);
  const [inversionRunning, setInversionRunning] = createSignal(false);
  const [inversionSummary, setInversionSummary] = createSignal("No inversion run yet.");

  onOriginSelectionChange((_idx, cloud) => {
    setSelectedIdx(getSelectedOriginIndex());
    setSelectedCloud(cloud);
    setOriginList([...getBeachingClouds()]);
  });

  const estimatedTime = () => {
    const baseOps = 200 * 15 * 900;
    const ops = cfgParticles() * cfgOrigins() * cfgDays();
    return Math.max(1, Math.round((ops / baseOps) * 15));
  };

  const handleRunDrift = async () => {
    const m = mapAccessor();
    if (!m) return;
    setShowConfigModal(false);
    setDriftStatus("Running simulation...");
    setDriftProgress({ pct: 0, text: "Starting simulation..." });

    let unlisten: (() => void) | undefined;
    try {
      if (IS_TAURI) {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<DriftBeachingProgress>("drift-beaching-progress", (event) => {
          const p = event.payload;
          setDriftProgress({
            pct: p.pct,
            text: `Simulating origin ${p.origin_index}/${p.total_origins} at ${Math.abs(p.origin_lat).toFixed(1)}\u00b0S...`,
          });
        });
      }
      const clouds = await getDriftBeaching(
        { n_particles: cfgParticles(), n_origins: cfgOrigins(), max_days: cfgDays() },
        getConfigSnapshot(),
      );
      populateDriftClouds(m, clouds);
      markDriftRunCompleted(getConfigSnapshot(), new Date());
      setOriginList([...clouds]);
      setHasResults(true);
      setDriftStatus(`Simulation complete \u2014 ${clouds.length} origins, ${cfgParticles()} particles per profile.`);
    } catch (err) {
      setDriftStatus(`Error: ${err}`);
    } finally {
      unlisten?.();
      setDriftProgress(null);
    }
  };

  const handleOriginClick = (idx: number) => {
    const m = mapAccessor();
    if (!m) return;
    const currentIdx = getSelectedOriginIndex();
    selectOrigin(m, currentIdx === idx ? null : idx);
  };

  const handleRunInversion = async () => {
    const m = mapAccessor();
    if (!m) return;
    setInversionRunning(true);
    try {
      const result = await runDebrisInversion(getConfigSnapshot());
      setInversionResult(result);
      renderDebrisInversionLayer(m, result);
      renderComparisonOverlay(m, result);
      markInversionRunCompleted(getConfigSnapshot(), new Date());
      setInversionVisible(true);
      setComparisonVisible(true);
      setDebrisInversionVisible(m, true);
      setComparisonOverlayVisible(m, true);
      const validationLine = result.validation_message ? `${result.validation_message}\n\n` : "";
      setInversionSummary(
        `${validationLine}Debris peak: ${Math.abs(result.peak_lat).toFixed(1)}\u00b0S\nSatellite peak: ${Math.abs(result.satellite_peak_lat).toFixed(1)}\u00b0S\nIntersection: ${Math.abs(result.intersection_lat).toFixed(1)}\u00b0S\nItems used: ${result.items_used}`,
      );
    } catch (err) {
      setInversionSummary(`Debris inversion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInversionRunning(false);
    }
  };

  const handleInversionToggle = (kind: "inversion" | "comparison", checked: boolean) => {
    const m = mapAccessor();
    if (!m || !inversionResult()) return;
    if (kind === "inversion") {
      setInversionVisible(checked);
      setDebrisInversionVisible(m, checked);
    } else {
      setComparisonVisible(checked);
      setComparisonOverlayVisible(m, checked);
    }
  };

  return (
    <>
      <div class="sidebar-section">
        <div class="section-heading">
          <h2>Drift Simulation</h2>
        </div>
        <p class="drift-hint">Run a synthetic debris-drift simulation from candidate crash sites along the 7th arc.</p>
        <div class="drift-callout">
          Use this to compare origins. Higher fit means the simulated debris beaches closer to the observed places and
          dates.
        </div>
        <button class="btn-primary" style="width:100%" type="button" onClick={() => setShowConfigModal(true)}>
          {hasResults() ? "Run Again With Settings" : "Run Drift Simulation"}
        </button>
        <div class="toggle-note" style="margin-top:8px;">
          {driftStatus()}
        </div>
      </div>

      {/* Progress overlay */}
      <Show when={driftProgress()}>
        {(prog) => (
          <div class="drift-progress-overlay">
            <div class="drift-progress-content">
              <div class="drift-progress-spinner" />
              <div class="drift-progress-status">{prog().text}</div>
              <div class="drift-progress-bar-track">
                <div class="drift-progress-bar-fill" style={`width:${prog().pct}%`} />
              </div>
              <div class="drift-progress-pct">{prog().pct}%</div>
            </div>
          </div>
        )}
      </Show>

      {/* Config modal */}
      <Show when={showConfigModal()}>
        <div class="drift-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowConfigModal(false)}>
          <div class="drift-modal">
            <h3>Configure Drift Simulation</h3>
            <p class="drift-modal-intro">
              Monte Carlo simulation of debris drift from candidate crash sites along the 7th arc. Higher values =
              better accuracy, longer computation.
            </p>
            <div class="drift-modal-field">
              <label>Particles per origin</label>
              <span class="drift-modal-desc">Number of simulated debris pieces per crash site.</span>
              <select value={cfgParticles()} onChange={(e) => setCfgParticles(Number(e.currentTarget.value))}>
                <option value="50">50 (fast preview)</option>
                <option value="100">100</option>
                <option value="200">200 (default)</option>
                <option value="500">500</option>
                <option value="1000">1000 (high accuracy)</option>
              </select>
            </div>
            <div class="drift-modal-field">
              <label>Origin points on 7th arc</label>
              <span class="drift-modal-desc">How many crash-site candidates to test along the satellite arc.</span>
              <select value={cfgOrigins()} onChange={(e) => setCfgOrigins(Number(e.currentTarget.value))}>
                <option value="5">5 (sparse)</option>
                <option value="10">10</option>
                <option value="15">15 (default)</option>
                <option value="25">25</option>
                <option value="50">50 (dense)</option>
              </select>
            </div>
            <div class="drift-modal-field">
              <label>Max drift days</label>
              <span class="drift-modal-desc">How long to simulate. Flaperon reached Reunion in ~507 days.</span>
              <select value={cfgDays()} onChange={(e) => setCfgDays(Number(e.currentTarget.value))}>
                <option value="300">300 (~10 months)</option>
                <option value="600">600 (~20 months)</option>
                <option value="900">900 (~2.5 years)</option>
                <option value="1200">1200 (~3.3 years)</option>
              </select>
            </div>
            <div class="drift-modal-estimate">
              Estimated time: ~{estimatedTime()} seconds
              <Show when={estimatedTime() > 60}>
                <span style="color:#f59e0b;"> Warning: this may take a while</span>
              </Show>
            </div>
            <div class="drift-modal-buttons">
              <button class="btn-secondary" type="button" onClick={() => setShowConfigModal(false)}>
                Cancel
              </button>
              <button class="btn-primary" type="button" onClick={handleRunDrift}>
                Run Simulation
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Origins list */}
      <Show when={hasResults()}>
        <div class="sidebar-section">
          <div class="section-heading">
            <h2>Compare Origins</h2>
          </div>
          <p class="drift-hint">Click an origin to inspect its beaching pattern. Click again to clear.</p>
          <div class="drift-origin-list">
            <For each={originList()}>
              {(cloud, i) => {
                const pct = Math.round(cloud.beaching_fraction * 100);
                const total = originList().length;
                const t = total > 1 ? i() / (total - 1) : 0.5;
                const hue = Math.round(180 - t * 160);
                const color = `hsl(${hue}, 85%, 55%)`;
                const label = pct === 0 ? "still drifting" : `${pct}% \u00b7 fit ${cloud.fit_score.toFixed(0)}`;
                return (
                  <button
                    class="drift-origin-btn"
                    classList={{
                      "drift-origin-btn--dim": pct === 0,
                      "drift-origin-btn--active": selectedIdx() === i(),
                    }}
                    type="button"
                    onClick={() => handleOriginClick(i())}
                  >
                    <span class="drift-origin-dot" style={`background:${color};`} />
                    <span class="drift-origin-label">{Math.abs(cloud.origin_lat).toFixed(1)}\u00b0S</span>
                    <span class="drift-origin-pct">{label}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Selected origin detail */}
      <Show when={selectedCloud()}>
        {(cloud) => {
          const total = cloud().beached.length + cloud().still_drifting.length;
          const pctBeached = Math.round(cloud().beaching_fraction * 100);
          const coastCounts = () => {
            const counts: Record<string, { count: number; avgDays: number }> = {};
            for (const bp of cloud().beached) {
              if (!counts[bp.coast]) counts[bp.coast] = { count: 0, avgDays: 0 };
              counts[bp.coast].count++;
              counts[bp.coast].avgDays += bp.days;
            }
            for (const entry of Object.values(counts)) {
              entry.avgDays = Math.round(entry.avgDays / entry.count);
            }
            return Object.entries(counts).sort((a, b) => b[1].count - a[1].count);
          };

          return (
            <div class="sidebar-section">
              <div class="section-heading">
                <h2>Selected Origin</h2>
              </div>
              <div class="drift-detail">
                <div class="drift-detail-header">
                  <strong>
                    Origin: {Math.abs(cloud().origin_lat).toFixed(1)}\u00b0S, {cloud().origin_lon.toFixed(1)}\u00b0E
                  </strong>
                  <span>
                    {pctBeached}% beached ({cloud().beached.length} / {total})
                  </span>
                </div>
                <div class="drift-coast-breakdown">
                  <For each={coastCounts()}>
                    {([coast, info]) => (
                      <div class="drift-coast-row">
                        <span class="drift-coast-name">{coast}</span>
                        <div class="drift-coast-bar-track">
                          <div class="drift-coast-bar" style={`width:${Math.round((info.count / total) * 100)}%`} />
                        </div>
                        <span class="drift-coast-stats">
                          {info.count} (~{info.avgDays}d)
                        </span>
                      </div>
                    )}
                  </For>
                  <Show when={cloud().still_drifting.length > 0}>
                    <div class="drift-coast-row">
                      <span class="drift-coast-name" style="color:var(--text-muted)">
                        Still drifting
                      </span>
                      <div class="drift-coast-bar-track">
                        <div
                          class="drift-coast-bar drift-coast-bar--muted"
                          style={`width:${Math.round((cloud().still_drifting.length / total) * 100)}%`}
                        />
                      </div>
                      <span class="drift-coast-stats">{cloud().still_drifting.length}</span>
                    </div>
                  </Show>
                </div>
                <div class="drift-match-section">
                  <strong>Debris Fit: {cloud().fit_score.toFixed(0)}/100</strong>
                  <div class="toggle-note">
                    Spatial {cloud().spatial_score.toFixed(0)}/100 \u00b7 Timing {cloud().timing_score.toFixed(0)}/100
                    \u00b7 Strong matches {cloud().match_score}/{cloud().match_total}
                  </div>
                  <div class="drift-match-list">
                    <For each={ACTUAL_FIND_NAMES}>
                      {(name) => {
                        const matched = cloud().matched_finds.includes(name);
                        return (
                          <div class={`drift-match-item ${matched ? "drift-match--yes" : "drift-match--no"}`}>
                            {matched ? "\u2713" : "\u2717"} {name}
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </Show>

      {/* Legend */}
      <div class="sidebar-section">
        <div class="section-heading">
          <h2>Legend</h2>
        </div>
        <div class="drift-legend">
          <div class="drift-legend-row">
            <span class="drift-legend-dot" style="background:#ef4444;border:2px solid #fff;" />
            Confirmed MH370 debris find
          </div>
          <div class="drift-legend-row">
            <span class="drift-legend-dot" style="background:#f59e0b;border:2px solid #fff;" />
            Probable MH370 debris find
          </div>
          <div class="drift-legend-row">
            <span
              class="drift-legend-gradient"
              style="background:linear-gradient(to right, #3b82f6, #22d3ee, #22c55e, #eab308, #f97316, #ef4444);width:60px;height:12px;border-radius:3px;display:inline-block;flex-shrink:0;"
            />
            Beached particle (100d \u2192 900d)
          </div>
          <div class="drift-legend-row">
            <span class="drift-legend-dot" style="background:rgba(180,180,180,0.3);" />
            Still drifting after 900 days
          </div>
        </div>
      </div>

      {/* Inversion Analysis */}
      <div class="sidebar-section">
        <div class="section-heading">
          <h2>Inversion Analysis</h2>
        </div>
        <label class="toggle-row">
          <span class="toggle-main">
            <input
              type="checkbox"
              checked={inversionVisible()}
              onChange={(e) => handleInversionToggle("inversion", e.currentTarget.checked)}
            />
            <span>Debris Inversion Result</span>
          </span>
        </label>
        <label class="toggle-row">
          <span class="toggle-main">
            <input
              type="checkbox"
              checked={comparisonVisible()}
              onChange={(e) => handleInversionToggle("comparison", e.currentTarget.checked)}
            />
            <span>Satellite vs Debris Comparison</span>
          </span>
        </label>
        <div class="button-row">
          <button class="btn-secondary" type="button" disabled={inversionRunning()} onClick={handleRunInversion}>
            {inversionRunning() ? "Running..." : "Run Inversion"}
          </button>
        </div>
        <div class="toggle-note" style="margin-top:8px;white-space:pre-line;">
          {inversionSummary()}
        </div>
        <Show when={inversionResult()}>
          {(result) => (
            <div class="inversion-contributions">
              <div class="inversion-contributions-title">Peak item contributions</div>
              <For each={result().item_contributions}>
                {(item) => (
                  <div class={`inversion-contribution-row inversion-contribution-row--${item.support_label}`}>
                    <div class="inversion-contribution-head">
                      <span class="inversion-contribution-label">{item.label}</span>
                      <span class="inversion-contribution-badge">{item.support_label}</span>
                    </div>
                    <div class="inversion-contribution-meta">
                      {item.item_type} \u00b7 confidence {item.confidence.toFixed(2)} \u00b7 uncertainty{" "}
                      {Math.round(item.uncertainty_km)} km
                    </div>
                    <div class="inversion-contribution-metrics">
                      <span>Likelihood {item.likelihood.toFixed(3)}</span>
                      <span>Share {item.contribution_share.toFixed(1)}%</span>
                      <span>Weighted log {item.weighted_log_likelihood.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </>
  );
};

export default DriftPanel;
