import type { PanelModule } from "../flyoutShell";
import { openInfoDetail } from "../evidencePanel";

export function createEvidenceBrowsePanel(): PanelModule {
  return {
    render() {
      return `
        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Anomalies</h2></div>
          <div class="info-text">
            Click anomaly markers on the map to view detailed evidence in the right panel.
          </div>
          <div class="evidence-marker-legend" style="margin-top:10px">
            <div class="legend-item"><span class="legend-swatch" style="background:#4a9eff"></span> Acoustic</div>
            <div class="legend-item"><span class="legend-swatch" style="background:#f97316"></span> Satellite</div>
            <div class="legend-item"><span class="legend-swatch" style="background:#22c55e"></span> Biological</div>
            <div class="legend-item"><span class="legend-swatch" style="background:#a855f7"></span> Signal processing</div>
          </div>
        </div>

        <div class="sidebar-section-inner">
          <div class="section-heading"><h2>Guides</h2></div>
          <div class="info-text" style="margin-bottom:6px">
            Click any <b>i</b> button on layer toggles or config fields to open detailed guides.
          </div>
          <button class="btn-secondary guide-btn" data-info-id="overview:methodology" style="margin-bottom:4px">Methodology Overview</button>
          <button class="btn-secondary guide-btn" data-info-id="overview:data-sources">Data Sources</button>
        </div>
      `;
    },
    wire() {
      document.querySelectorAll<HTMLElement>(".guide-btn[data-info-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openInfoDetail(btn.dataset.infoId!);
        });
      });
    },
  };
}
