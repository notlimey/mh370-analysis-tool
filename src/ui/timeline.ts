import { getHandshakes, type BackendHandshake } from "../lib/backend";

let handshakes: BackendHandshake[] = [];

/** Initialize the timeline scrubber */
export async function initTimeline(
  onTimeChange: (index: number, arcNum: number) => void
): Promise<void> {
  handshakes = await getHandshakes();

  const container = document.getElementById("timeline");
  if (!container) return;

  container.innerHTML = `
    <div class="timeline-inner">
      <input
        type="range"
        id="timeline-slider"
        min="0"
        max="${handshakes.length - 1}"
        value="0"
        step="1"
      />
      <div class="timeline-info">
        <span id="timeline-time" class="timeline-time">16:00 UTC</span>
        <span id="timeline-arc" class="timeline-arc"></span>
        <span id="timeline-bto" class="timeline-detail">BTO: —</span>
        <span id="timeline-bfo" class="timeline-detail">BFO: —</span>
        <span id="timeline-note" class="timeline-note"></span>
      </div>
    </div>
  `;

  const slider = document.getElementById("timeline-slider") as HTMLInputElement;
  slider.addEventListener("input", () => {
    const idx = parseInt(slider.value, 10);
    updateDisplay(idx);
    const h = handshakes[idx];
    onTimeChange(idx, h?.arc ?? 0);
  });

  updateDisplay(0);
}

function updateDisplay(index: number): void {
  const h = handshakes[index];
  if (!h) return;

  const timeEl = document.getElementById("timeline-time");
  const arcEl = document.getElementById("timeline-arc");
  const btoEl = document.getElementById("timeline-bto");
  const bfoEl = document.getElementById("timeline-bfo");
  const noteEl = document.getElementById("timeline-note");

  if (timeEl) timeEl.textContent = `${h.time_utc} UTC`;
  if (arcEl) {
    arcEl.textContent = h.arc > 0 ? `Arc ${h.arc}` : "";
    arcEl.className = h.arc > 0 ? "timeline-arc active" : "timeline-arc";
  }
  if (btoEl) btoEl.textContent = `BTO: ${h.bto !== null ? `${h.bto} μs` : "—"}`;
  if (bfoEl) bfoEl.textContent = `BFO: ${h.bfo !== null ? `${h.bfo} Hz` : "—"}`;
  if (noteEl) noteEl.textContent = h.note;
}
