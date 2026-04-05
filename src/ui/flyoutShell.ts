import type { PanelId } from "./iconRail";

export interface PanelModule {
  render(): string;
  wire(): void;
  /** Called when the panel opens and cached state should be applied. */
  onOpen?(): void;
}

let panels: Record<string, PanelModule> = {};
let currentPanel: PanelId | null = null;
let onCloseCallback: (() => void) | null = null;

export function setOnClose(cb: () => void): void {
  onCloseCallback = cb;
}

export function registerPanel(id: PanelId, module: PanelModule): void {
  panels[id] = module;
}

export function openFlyout(panelId: PanelId): void {
  const el = getFlyoutEl();
  if (!el) return;

  const panel = panels[panelId];
  if (!panel) {
    console.warn(`No panel registered for "${panelId}"`);
    return;
  }

  // If switching panels, re-render
  if (currentPanel !== panelId) {
    el.innerHTML = `
      <div class="flyout-header">
        <h2 class="flyout-title">${panelTitle(panelId)}</h2>
        <button class="flyout-close" aria-label="Close panel">&times;</button>
      </div>
      <div class="flyout-body">${panel.render()}</div>
    `;
    panel.wire();
    el.querySelector(".flyout-close")?.addEventListener("click", () => {
      closeFlyout();
      onCloseCallback?.();
    });
  }

  currentPanel = panelId;
  el.classList.add("open");
  panel.onOpen?.();
}

export function closeFlyout(): void {
  const el = getFlyoutEl();
  if (!el) return;
  el.classList.remove("open");
  currentPanel = null;
}

export function getCurrentPanel(): PanelId | null {
  return currentPanel;
}

export function refreshCurrentPanel(): void {
  if (currentPanel) {
    const panel = panels[currentPanel];
    if (panel) {
      const body = getFlyoutEl()?.querySelector(".flyout-body");
      if (body) {
        body.innerHTML = panel.render();
        panel.wire();
        panel.onOpen?.();
      }
    }
  }
}

function getFlyoutEl(): HTMLElement | null {
  return document.getElementById("flyout-panel");
}

function panelTitle(id: PanelId): string {
  switch (id) {
    case "model": return "Model";
    case "drift": return "Drift Analysis";
    case "layers": return "Layers";
    case "evidence": return "Evidence";
    case "export": return "Export & History";
    case "sensitivity": return "Sensitivity Analysis";
  }
}
