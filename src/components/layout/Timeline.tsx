import type { Component } from "solid-js";
import { createResource, createSignal, Show } from "solid-js";
import { useMap } from "../../contexts/map-context";
import { highlightArc } from "../../layers/arcs";
import { getHandshakes } from "../../lib/backend";

const Timeline: Component = () => {
  const map = useMap();
  const [handshakes] = createResource(getHandshakes);
  const [index, setIndex] = createSignal(0);

  const current = () => {
    const hs = handshakes();
    if (!hs || hs.length === 0) return null;
    return hs[index()];
  };

  const handleInput = (e: Event) => {
    const idx = parseInt((e.target as HTMLInputElement).value, 10);
    setIndex(idx);
    const h = handshakes()?.[idx];
    const m = map();
    if (h && m) highlightArc(m, h.arc);
  };

  return (
    <div id="timeline">
      <Show when={handshakes()}>
        {(hs) => (
          <div class="timeline-inner">
            <input type="range" min="0" max={hs().length - 1} value={index()} step="1" onInput={handleInput} />
            <div class="timeline-info">
              <span class="timeline-time">{current()?.time_utc ?? ""} UTC</span>
              <span class={`timeline-arc${current()?.arc && current()!.arc > 0 ? " active" : ""}`}>
                {current()?.arc && current()!.arc > 0 ? `Arc ${current()!.arc}` : ""}
              </span>
              <span class="timeline-detail">
                BTO: {current()?.bto != null ? `${current()!.bto} \u03bcs` : "\u2014"}
              </span>
              <span class="timeline-detail">BFO: {current()?.bfo != null ? `${current()!.bfo} Hz` : "\u2014"}</span>
              <span class="timeline-note">{current()?.note ?? ""}</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default Timeline;
