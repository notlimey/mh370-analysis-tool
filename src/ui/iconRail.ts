export type PanelId = "model" | "drift" | "layers" | "evidence" | "export" | "sensitivity";

interface RailButton {
  id: PanelId;
  label: string;
  svg: string;
}

const BUTTONS: RailButton[] = [
  {
    id: "model",
    label: "Model",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 17,10 5,17"/></svg>`,
  },
  {
    id: "drift",
    label: "Drift",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10c2-3 4-3 6 0s4 3 6 0s4-3 6 0"/><path d="M2 15c2-3 4-3 6 0s4 3 6 0"/></svg>`,
  },
  {
    id: "layers",
    label: "Layers",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 7l8 5 8-5-8-5z"/><path d="M2 12l8 5 8-5"/><path d="M2 17l8 5 8-5"/></svg>`,
  },
  {
    id: "evidence",
    label: "Evidence",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M13.5 13.5L18 18"/></svg>`,
  },
  {
    id: "export",
    label: "Export",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M3 15v2h14v-2"/></svg>`,
  },
  {
    id: "sensitivity",
    label: "Sensitivity",
    svg: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h2v-6H3z"/><path d="M7 17h2V8H7z"/><path d="M11 17h2V4h-2z"/><path d="M15 17h2v-9h-2z"/></svg>`,
  },
];

let activePanel: PanelId | null = null;
let onToggle: ((panel: PanelId | null) => void) | null = null;

export function getActivePanel(): PanelId | null {
  return activePanel;
}

export function setActivePanel(panel: PanelId | null): void {
  activePanel = panel;
  syncActiveState();
}

export function initIconRail(toggle: (panel: PanelId | null) => void): void {
  onToggle = toggle;
  const rail = document.getElementById("icon-rail");
  if (!rail) return;

  rail.innerHTML = `
    <div class="rail-logo">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="var(--accent)" stroke-width="1.5"><circle cx="11" cy="11" r="9"/><path d="M11 5v6l4 3"/></svg>
    </div>
    ${BUTTONS.map(
      (btn) => `
      <button class="rail-btn" data-panel="${btn.id}" title="${btn.label}" aria-label="${btn.label}">
        ${btn.svg}
        <span class="rail-label">${btn.label}</span>
      </button>
    `
    ).join("")}
  `;

  rail.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".rail-btn");
    if (!btn) return;
    const panel = btn.dataset.panel as PanelId;
    if (panel === activePanel) {
      activePanel = null;
    } else {
      activePanel = panel;
    }
    syncActiveState();
    onToggle?.(activePanel);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activePanel) {
      activePanel = null;
      syncActiveState();
      onToggle?.(null);
    }
  });
}

function syncActiveState(): void {
  const rail = document.getElementById("icon-rail");
  if (!rail) return;
  for (const btn of rail.querySelectorAll<HTMLElement>(".rail-btn")) {
    const isActive = btn.dataset.panel === activePanel;
    btn.classList.toggle("rail-btn--active", isActive);
  }
}
