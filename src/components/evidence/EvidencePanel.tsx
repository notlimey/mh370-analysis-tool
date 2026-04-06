import type { Component } from "solid-js";
import { createResource, For, Show } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { setSelectedAnomaly } from "../../layers/anomalies";
import type { InfoContent } from "../../lib/infoContent";
import { getInfoContent } from "../../lib/infoContent";
import type { Anomaly } from "../../model/evidence";
import { getAnomalies, getAnomalyById } from "../../model/evidence";
import { clearEvidence, evidenceSelection, setEvidenceSelection } from "../../stores/evidence";

function labelize(value: string): string {
  return value.split("_").join(" ");
}

const EvidencePanel: Component = () => {
  const mapAccessor = useMap();
  const [anomalies] = createResource(getAnomalies);
  const selection = evidenceSelection;

  const handleClose = () => {
    const m = mapAccessor();
    if (m) setSelectedAnomaly(m, null);
    clearEvidence();
  };

  const handleRelationClick = (id: string) => {
    const m = mapAccessor();
    if (m) setSelectedAnomaly(m, id);
    const anomaly = getAnomalyById(id);
    if (anomaly) {
      setEvidenceSelection({
        kind: "anomaly",
        id,
        title: anomaly.title,
        subtitle: anomaly.source,
      });
    }
  };

  const currentAnomaly = (): Anomaly | null => {
    const sel = selection();
    if (sel.kind !== "anomaly" || !sel.id) return null;
    return getAnomalyById(sel.id) ?? null;
  };

  const currentInfo = (): InfoContent | null => {
    const sel = selection();
    if (sel.kind !== "info" || !sel.id) return null;
    return getInfoContent(sel.id);
  };

  return (
    <aside id="evidence-panel" classList={{ active: selection().kind !== "none" }}>
      <div class="evidence-shell">
        <div class="evidence-header">
          <div>
            <h2>Evidence</h2>
            <p>Anomalies, conflicts, and corroborating signals</p>
          </div>
          <button class="panel-close" type="button" onClick={handleClose}>
            Close
          </button>
        </div>
        <div class="evidence-body">
          <Show when={selection().kind === "none"}>
            <div class="evidence-empty">
              <span class="evidence-kicker">Map Workspace</span>
              <h3>Select an anomaly or info icon</h3>
              <p>
                Click an anomaly marker to inspect the claim, or use the info buttons in the sidebar to see what a
                layer, control, or analysis section means.
              </p>
              <ul class="evidence-checklist">
                <li>Blue markers: acoustic evidence</li>
                <li>Orange markers: satellite image interpretations</li>
                <li>Green markers: biological drift clues</li>
                <li>Purple markers: signal-processing anomalies</li>
              </ul>
            </div>
          </Show>

          <Show when={currentAnomaly()}>
            {(anomaly) => (
              <div class="evidence-card">
                <div class="evidence-pill-row">
                  <span class="evidence-pill category">{labelize(anomaly().category)}</span>
                  <span class={`evidence-pill confidence ${anomaly().confidence}`}>
                    {labelize(anomaly().confidence)}
                  </span>
                  <span class={`evidence-pill status ${anomaly().status}`}>{labelize(anomaly().status)}</span>
                </div>
                <h3>{anomaly().title}</h3>
                <div class="evidence-meta">{anomaly().date}</div>
                <p class="evidence-summary">{anomaly().summary}</p>
                <details open>
                  <summary>Technical detail</summary>
                  <p>{anomaly().detail}</p>
                </details>
                <details open>
                  <summary>Implication for search</summary>
                  <p>{anomaly().implication}</p>
                </details>
                <details open>
                  <summary>Evidence graph</summary>
                  <RelationList title="Corroborates" ids={anomaly().supports} onClick={handleRelationClick} />
                  <RelationList title="Conflicts" ids={anomaly().conflicts_with} onClick={handleRelationClick} />
                </details>
                <div class="evidence-source">
                  <span>{anomaly().source}</span>
                  <Show when={anomaly().source_url}>
                    <a href={anomaly().source_url} target="_blank" rel="noreferrer">
                      Open source
                    </a>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={currentInfo()}>
            {(info) => (
              <div class="evidence-card">
                <div class="evidence-pill-row">
                  <span class="evidence-pill category">Guide</span>
                </div>
                <h3>{info().title}</h3>
                <div class="evidence-meta">{info().subtitle}</div>
                <p class="evidence-summary">{info().summary}</p>
                <For each={info().sections}>
                  {(section) => (
                    <details open>
                      <summary>{section.heading}</summary>
                      <p>{section.body}</p>
                    </details>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
        <div class="evidence-footer">
          <span>{anomalies()?.length ?? 0} tracked anomalies</span>
        </div>
      </div>
    </aside>
  );
};

const RelationList: Component<{ title: string; ids: string[]; onClick: (id: string) => void }> = (props) => {
  return (
    <div class="relation-block">
      <strong>{props.title}</strong>
      <Show when={props.ids.length > 0} fallback={<p>None linked yet.</p>}>
        <div class="relation-list">
          <For each={props.ids}>
            {(id) => {
              const linked = getAnomalyById(id);
              return linked ? (
                <button type="button" class="relation-chip" onClick={() => props.onClick(id)}>
                  {linked.title}
                </button>
              ) : (
                <span class="relation-chip missing">{id}</span>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default EvidencePanel;
