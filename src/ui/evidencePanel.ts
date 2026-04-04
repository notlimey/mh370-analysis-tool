import { getAnomalies, getAnomalyById, type Anomaly } from "../model/evidence";

interface EvidencePanelCallbacks {
  onSelectAnomaly: (id: string | null) => void;
}

let onSelectAnomalyCallback: ((id: string | null) => void) | null = null;
let selectedAnomalyId: string | null = null;

export async function initEvidencePanel(callbacks: EvidencePanelCallbacks): Promise<void> {
  onSelectAnomalyCallback = callbacks.onSelectAnomaly;
  const panel = document.getElementById("evidence-panel");
  if (!panel) return;

  const anomalies = await getAnomalies();
  panel.innerHTML = `
    <div class="evidence-shell">
      <div class="evidence-header">
        <div>
          <h2>Evidence</h2>
          <p>Anomalies, conflicts, and corroborating signals</p>
        </div>
        <button id="evidence-close" class="panel-close" type="button">Close</button>
      </div>
      <div id="evidence-body" class="evidence-body"></div>
      <div class="evidence-footer">
        <span>${anomalies.length} tracked anomalies</span>
      </div>
    </div>
  `;

  document.getElementById("evidence-close")?.addEventListener("click", () => {
    clearEvidenceSelection();
  });

  renderEmptyState();
}

export function openAnomalyDetail(id: string): void {
  const anomaly = getAnomalyById(id);
  if (!anomaly) return;

  selectedAnomalyId = id;
  const panel = document.getElementById("evidence-panel");
  const body = document.getElementById("evidence-body");
  if (!panel || !body) return;

  panel.classList.add("active");
  body.innerHTML = renderAnomaly(anomaly);
  wireRelationButtons(body);
}

export function clearEvidenceSelection(): void {
  selectedAnomalyId = null;
  const panel = document.getElementById("evidence-panel");
  if (panel) {
    panel.classList.remove("active");
  }
  renderEmptyState();
  onSelectAnomalyCallback?.(null);
}

export function getSelectedAnomalyId(): string | null {
  return selectedAnomalyId;
}

function renderEmptyState(): void {
  const body = document.getElementById("evidence-body");
  if (!body) return;

  body.innerHTML = `
    <div class="evidence-empty">
      <span class="evidence-kicker">Map Workspace</span>
      <h3>Select an anomaly</h3>
      <p>Click an anomaly marker to inspect the claim, see what it supports or conflicts with, and trace how it changes the search corridor.</p>
      <ul class="evidence-checklist">
        <li>Blue markers: acoustic evidence</li>
        <li>Orange markers: satellite image interpretations</li>
        <li>Green markers: biological drift clues</li>
        <li>Purple markers: signal-processing anomalies</li>
      </ul>
    </div>
  `;
}

function renderAnomaly(anomaly: Anomaly): string {
  const supports = renderRelationList("Corroborates", anomaly.supports);
  const conflicts = renderRelationList("Conflicts", anomaly.conflicts_with);
  const sourceLink = anomaly.source_url
    ? `<a href="${anomaly.source_url}" target="_blank" rel="noreferrer">Open source</a>`
    : "";

  return `
    <div class="evidence-card">
      <div class="evidence-pill-row">
        <span class="evidence-pill category">${labelize(anomaly.category)}</span>
        <span class="evidence-pill confidence ${anomaly.confidence}">${labelize(anomaly.confidence)}</span>
        <span class="evidence-pill status ${anomaly.status}">${labelize(anomaly.status)}</span>
      </div>
      <h3>${anomaly.title}</h3>
      <div class="evidence-meta">${anomaly.date}</div>
      <p class="evidence-summary">${anomaly.summary}</p>
      <details open>
        <summary>Technical detail</summary>
        <p>${anomaly.detail}</p>
      </details>
      <details open>
        <summary>Implication for search</summary>
        <p>${anomaly.implication}</p>
      </details>
      <details open>
        <summary>Evidence graph</summary>
        ${supports}
        ${conflicts}
      </details>
      <div class="evidence-source">
        <span>${anomaly.source}</span>
        ${sourceLink}
      </div>
    </div>
  `;
}

function renderRelationList(title: string, ids: string[]): string {
  if (ids.length === 0) {
    return `<div class="relation-block"><strong>${title}</strong><p>None linked yet.</p></div>`;
  }

  return `
    <div class="relation-block">
      <strong>${title}</strong>
      <div class="relation-list">
        ${ids
          .map((id) => {
            const linked = getAnomalyById(id);
            return linked
              ? `<button type="button" class="relation-chip" data-anomaly-id="${linked.id}">${linked.title}</button>`
              : `<span class="relation-chip missing">${id}</span>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function wireRelationButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("button[data-anomaly-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.anomalyId;
      if (!id) return;
      onSelectAnomalyCallback?.(id);
      openAnomalyDetail(id);
    });
  });
}

function labelize(value: string): string {
  return value.split("_").join(" ");
}
