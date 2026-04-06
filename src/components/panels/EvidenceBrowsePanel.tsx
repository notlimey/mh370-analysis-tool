import type { Component } from "solid-js";
import { getInfoContent } from "../../lib/infoContent";
import { setEvidenceSelection } from "../../stores/evidence";

const EvidenceBrowsePanel: Component = () => {
  return (
    <>
      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Anomalies</h2>
        </div>
        <div class="info-text">Click anomaly markers on the map to view detailed evidence in the right panel.</div>
        <div class="evidence-marker-legend" style="margin-top:10px">
          <div class="legend-item">
            <span class="legend-swatch" style="background:#4a9eff" />
            Acoustic
          </div>
          <div class="legend-item">
            <span class="legend-swatch" style="background:#f97316" />
            Satellite
          </div>
          <div class="legend-item">
            <span class="legend-swatch" style="background:#22c55e" />
            Biological
          </div>
          <div class="legend-item">
            <span class="legend-swatch" style="background:#a855f7" />
            Signal processing
          </div>
        </div>
      </div>

      <div class="sidebar-section-inner">
        <div class="section-heading">
          <h2>Guides</h2>
        </div>
        <div class="info-text" style="margin-bottom:6px">
          Click any <b>i</b> button on layer toggles or config fields to open detailed guides.
        </div>
        <button
          class="btn-secondary guide-btn"
          type="button"
          style="margin-bottom:4px"
          onClick={() => {
            const info = getInfoContent("overview:methodology");
            if (info)
              setEvidenceSelection({
                kind: "info",
                id: "overview:methodology",
                title: info.title,
                subtitle: info.subtitle,
              });
          }}
        >
          Methodology Overview
        </button>
        <button
          class="btn-secondary guide-btn"
          type="button"
          onClick={() => {
            const info = getInfoContent("overview:data-sources");
            if (info)
              setEvidenceSelection({
                kind: "info",
                id: "overview:data-sources",
                title: info.title,
                subtitle: info.subtitle,
              });
          }}
        >
          Data Sources
        </button>
      </div>
    </>
  );
};

export default EvidenceBrowsePanel;
