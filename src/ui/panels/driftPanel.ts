import type { PanelModule } from "../flyoutShell";
import { renderDriftPanel as renderDriftContent, wireDriftPanel } from "../sidebarDrift";

export function createDriftPanel(): PanelModule {
  return {
    render() {
      return renderDriftContent();
    },
    wire() {
      wireDriftPanel();
    },
  };
}
