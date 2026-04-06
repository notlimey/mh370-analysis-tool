import type { Component } from "solid-js";
import { For } from "solid-js";
import type { PanelId } from "../../stores/ui";
import { activePanel, setActivePanel } from "../../stores/ui";

interface RailButton {
  id: PanelId;
  label: string;
  svg: string;
}

const BUTTONS: RailButton[] = [
  {
    id: "model",
    label: "Model",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 17,10 5,17"/></svg>',
  },
  {
    id: "drift",
    label: "Drift",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10c2-3 4-3 6 0s4 3 6 0s4-3 6 0"/><path d="M2 15c2-3 4-3 6 0s4 3 6 0"/></svg>',
  },
  {
    id: "layers",
    label: "Layers",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 7l8 5 8-5-8-5z"/><path d="M2 12l8 5 8-5"/><path d="M2 17l8 5 8-5"/></svg>',
  },
  {
    id: "evidence",
    label: "Evidence",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M13.5 13.5L18 18"/></svg>',
  },
  {
    id: "export",
    label: "Export",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M3 15v2h14v-2"/></svg>',
  },
  {
    id: "sensitivity",
    label: "Sensitivity",
    svg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h2v-6H3z"/><path d="M7 17h2V8H7z"/><path d="M11 17h2V4h-2z"/><path d="M15 17h2v-9h-2z"/></svg>',
  },
];

const IconRail: Component = () => {
  const handleClick = (id: PanelId) => {
    setActivePanel(activePanel() === id ? null : id);
  };

  return (
    <nav id="icon-rail">
      <div class="rail-logo">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="var(--accent)" stroke-width="1.5">
          <circle cx="11" cy="11" r="9" />
          <path d="M11 5v6l4 3" />
        </svg>
      </div>
      <For each={BUTTONS}>
        {(btn) => (
          <button
            class="rail-btn"
            classList={{ "rail-btn--active": activePanel() === btn.id }}
            title={btn.label}
            aria-label={btn.label}
            onClick={() => handleClick(btn.id)}
            type="button"
          >
            <span innerHTML={btn.svg} />
            <span class="rail-label">{btn.label}</span>
          </button>
        )}
      </For>
    </nav>
  );
};

export default IconRail;
