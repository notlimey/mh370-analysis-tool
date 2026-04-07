import type { Component } from "solid-js";
import { For } from "solid-js";

interface Source {
  label: string;
  detail?: string;
}

interface SourceCitationProps {
  sources: Source[];
}

const SourceCitation: Component<SourceCitationProps> = (props) => {
  return (
    <aside class="methodology-sources" aria-label="Sources">
      <span class="methodology-sources-label">Sources</span>
      <ul class="methodology-sources-list">
        <For each={props.sources}>
          {(src) => (
            <li>
              <strong>{src.label}</strong>
              {src.detail && <span> — {src.detail}</span>}
            </li>
          )}
        </For>
      </ul>
    </aside>
  );
};

export default SourceCitation;
