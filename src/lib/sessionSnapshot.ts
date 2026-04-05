import { getMap, layerVisibility, toggleLayer, DEFAULT_LAYER_VISIBILITY } from "../map";
import { getAnalysisConfig, updateAnalysisConfig, resetAnalysisConfig, type AnalysisConfig } from "../model/config";
import { getActiveScenarioId, setActiveScenarioId } from "./scenarioManager";
import { getSelectedOriginIndex, getBeachingClouds, populateDriftClouds, selectOrigin } from "../layers/drift_clouds";
import { listSavedPins, replaceSavedPins, type SavedPin } from "../model/pins";
import { getLatestInversionResult, getInversionVisibilityState, restoreInversionState } from "../ui/sidebarInversion";
import { getLatestModelExportState, restoreModelExportState, type ModelExportState } from "../ui/panels/modelPanel";
import {
  getStoredAnalystNotes,
  getStoredSessionSnapshot,
  setStoredAnalystNotes,
  setStoredSessionSnapshot,
} from "../model/session";
import { getWorkspaceFreshness, restoreWorkspaceFreshness } from "./workspaceState";
import {
  getEvidenceSelection,
  getSelectedAnomalyId,
  openAnomalyDetail,
  openInfoDetail,
  clearEvidenceSelection,
  type EvidenceSelection,
} from "../ui/evidencePanel";
import { setSelectedAnomaly } from "../layers/anomalies";
import { getCurrentPanel, openFlyout, closeFlyout } from "../ui/flyoutShell";
import { setActivePanel } from "../ui/iconRail";
import type { BackendBeachingCloud, InversionResult } from "./backend";

export interface SessionSnapshot {
  version: 1;
  timestamp: string;
  notes: string;
  config: AnalysisConfig;
  layerVisibility: Record<string, boolean>;
  scenarioId: string | null;
  viewport: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  };
  panelId: string | null;
  evidenceSelection: EvidenceSelection;
  selectedAnomalyId: string | null;
  pins: SavedPin[];
  drift: {
    clouds: BackendBeachingCloud[];
    selectedOriginIndex: number | null;
  };
  inversion: {
    result: InversionResult | null;
    visible: boolean;
    comparisonVisible: boolean;
  };
  model: ModelExportState;
  freshness: ReturnType<typeof getWorkspaceFreshness>;
}

let autoSaveTimer: number | null = null;

export function exportSessionSnapshot(): SessionSnapshot {
  const map = getMap();
  const center = map.getCenter();
  const inversionVisibility = getInversionVisibilityState();

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    notes: getStoredAnalystNotes(),
    config: getAnalysisConfig(),
    layerVisibility: { ...layerVisibility },
    scenarioId: getActiveScenarioId(),
    viewport: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
    panelId: getCurrentPanel(),
    evidenceSelection: getEvidenceSelection(),
    selectedAnomalyId: getSelectedAnomalyId(),
    pins: listSavedPins(),
    drift: {
      clouds: getBeachingClouds(),
      selectedOriginIndex: getSelectedOriginIndex(),
    },
    inversion: {
      result: getLatestInversionResult(),
      visible: inversionVisibility.visible,
      comparisonVisible: inversionVisibility.comparisonVisible,
    },
    model: getLatestModelExportState(),
    freshness: getWorkspaceFreshness(),
  };
}

export function downloadSessionSnapshot(): void {
  const snapshot = exportSessionSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mh370-session-${snapshot.timestamp.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function scheduleAutoSaveSessionSnapshot(): void {
  if (typeof window === "undefined") return;
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    persistSessionSnapshot();
  }, 200);
}

export function persistSessionSnapshot(): void {
  setStoredSessionSnapshot(JSON.stringify(exportSessionSnapshot()));
}

export function restoreStoredSessionSnapshot(): boolean {
  const raw = getStoredSessionSnapshot();
  if (!raw) return false;
  const snapshot = JSON.parse(raw) as SessionSnapshot;
  applySessionSnapshot(snapshot);
  return true;
}

export async function importSessionSnapshot(file: File): Promise<void> {
  const raw = await file.text();
  const snapshot = JSON.parse(raw) as SessionSnapshot;
  applySessionSnapshot(snapshot);
}

function applySessionSnapshot(snapshot: SessionSnapshot): void {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported session version: ${String((snapshot as { version?: unknown }).version)}`);
  }

  resetAnalysisConfig();
  updateAnalysisConfig(snapshot.config);
  setActiveScenarioId(snapshot.scenarioId ?? null);

  for (const layerId of Object.keys(DEFAULT_LAYER_VISIBILITY)) {
    toggleLayer(layerId, snapshot.layerVisibility[layerId] ?? DEFAULT_LAYER_VISIBILITY[layerId]);
  }

  replaceSavedPins(snapshot.pins ?? []);
  setStoredAnalystNotes(snapshot.notes ?? "");

  const map = getMap();
  map.jumpTo({
    center: snapshot.viewport.center,
    zoom: snapshot.viewport.zoom,
    bearing: snapshot.viewport.bearing,
    pitch: snapshot.viewport.pitch,
  });

  populateDriftClouds(map, snapshot.drift?.clouds ?? []);
  selectOrigin(map, snapshot.drift?.selectedOriginIndex ?? null);

  restoreInversionState(snapshot.inversion?.result ?? null, {
    visible: snapshot.inversion?.visible ?? false,
    comparisonVisible: snapshot.inversion?.comparisonVisible ?? false,
  });

  restoreModelExportState(snapshot.model);
  restoreWorkspaceFreshness(snapshot.freshness, snapshot.config);

  if (snapshot.evidenceSelection?.kind === "info" && snapshot.evidenceSelection.id) {
    setSelectedAnomaly(map, null);
    openInfoDetail(snapshot.evidenceSelection.id);
  } else if (snapshot.selectedAnomalyId) {
    setSelectedAnomaly(map, snapshot.selectedAnomalyId);
    openAnomalyDetail(snapshot.selectedAnomalyId);
  } else {
    setSelectedAnomaly(map, null);
    clearEvidenceSelection();
  }

  const panelId = snapshot.panelId;
  if (panelId === "model" || panelId === "drift" || panelId === "layers" || panelId === "evidence" || panelId === "export") {
    setActivePanel(panelId);
    openFlyout(panelId);
  } else {
    setActivePanel(null);
    closeFlyout();
  }

  setStoredSessionSnapshot(JSON.stringify(snapshot));
}
