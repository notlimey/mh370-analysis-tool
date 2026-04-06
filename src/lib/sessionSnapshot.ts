import { setSelectedAnomaly } from "../layers/anomalies";
import {
  renderComparisonOverlay,
  renderDebrisInversionLayer,
  setComparisonOverlayVisible,
  setDebrisInversionVisible,
} from "../layers/debris-inversion";
import { getBeachingClouds, getSelectedOriginIndex, populateDriftClouds, selectOrigin } from "../layers/drift-clouds";
import type { AnalysisConfig } from "../model/config";
import { listSavedPins, replaceSavedPins, type SavedPin } from "../model/pins";
import {
  getStoredAnalystNotes,
  getStoredSessionSnapshot,
  setStoredAnalystNotes,
  setStoredSessionSnapshot,
} from "../model/session";
import { getConfigSnapshot, resetConfig, updateConfig } from "../stores/analysis-config";
import type { EvidenceSelection } from "../stores/evidence";
import { clearEvidence, evidenceSelection, setEvidenceSelection } from "../stores/evidence";
import {
  comparisonVisible,
  inversionResult,
  inversionVisible,
  setComparisonVisible,
  setInversionResult,
  setInversionVisible,
} from "../stores/inversion";
import { DEFAULT_LAYER_VISIBILITY, layerVisibility, toggleLayerVisibility } from "../stores/layer-visibility";
import type { FamilySummary, ModelResultSummary, ModelRunStatus } from "../stores/model-run";
import {
  modelRunState,
  setConfidence,
  setFamilySummary,
  setModelSummary,
  setResultSummary,
  setRunStatus,
} from "../stores/model-run";
import { activeScenarioId, setActiveScenarioId } from "../stores/scenario";
import type { PanelId } from "../stores/ui";
import { activePanel, setActivePanel } from "../stores/ui";
import type { BackendBeachingCloud, InversionResult } from "./backend";
import { getWorkspaceFreshness, restoreWorkspaceFreshness } from "./workspaceState";

export interface ModelExportState {
  confidence: string;
  runStatus: ModelRunStatus;
  resultSummary: ModelResultSummary | null;
  familySummary: FamilySummary | null;
  speedRange: string;
  fuel: string;
  familySpread: string;
}

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
let mapInstance: mapboxgl.Map | null = null;

export function setSessionSnapshotMap(map: mapboxgl.Map): void {
  mapInstance = map;
}

function getMap(): mapboxgl.Map {
  if (!mapInstance) throw new Error("Map not set for session snapshots");
  return mapInstance;
}

function getLatestModelExportState(): ModelExportState {
  return {
    confidence: modelRunState.summary.confidence,
    runStatus: { ...modelRunState.runStatus },
    resultSummary: modelRunState.resultSummary
      ? { ...modelRunState.resultSummary, endpointCounts: { ...modelRunState.resultSummary.endpointCounts } }
      : null,
    familySummary: modelRunState.familySummary
      ? {
          counts: { ...modelRunState.familySummary.counts },
          familySpreadKm: modelRunState.familySummary.familySpreadKm,
          firsByFamily: modelRunState.familySummary.firsByFamily
            ? { ...modelRunState.familySummary.firsByFamily }
            : undefined,
          endpointNarrative: modelRunState.familySummary.endpointNarrative,
        }
      : null,
    speedRange: modelRunState.summary.speedRange,
    fuel: modelRunState.summary.fuel,
    familySpread: modelRunState.summary.familySpread,
  };
}

export function exportSessionSnapshot(): SessionSnapshot {
  const map = getMap();
  const center = map.getCenter();

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    notes: getStoredAnalystNotes(),
    config: getConfigSnapshot(),
    layerVisibility: { ...layerVisibility },
    scenarioId: activeScenarioId(),
    viewport: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
    panelId: activePanel(),
    evidenceSelection: { ...evidenceSelection() },
    selectedAnomalyId: evidenceSelection().kind === "anomaly" ? evidenceSelection().id : null,
    pins: listSavedPins(),
    drift: {
      clouds: getBeachingClouds(),
      selectedOriginIndex: getSelectedOriginIndex(),
    },
    inversion: {
      result: inversionResult(),
      visible: inversionVisible(),
      comparisonVisible: comparisonVisible(),
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
  if (!mapInstance) return;
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

  resetConfig();
  updateConfig(snapshot.config);
  setActiveScenarioId(snapshot.scenarioId ?? null);

  for (const layerId of Object.keys(DEFAULT_LAYER_VISIBILITY)) {
    toggleLayerVisibility(layerId, snapshot.layerVisibility[layerId] ?? DEFAULT_LAYER_VISIBILITY[layerId]);
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

  // Apply visibility to map
  const style = map.getStyle();
  if (style?.layers) {
    for (const [group, visible] of Object.entries(layerVisibility)) {
      const vis = visible ? "visible" : "none";
      for (const layer of style.layers) {
        if (layer.id.startsWith(`${group}-`)) {
          map.setLayoutProperty(layer.id, "visibility", vis);
        }
      }
    }
  }

  populateDriftClouds(map, snapshot.drift?.clouds ?? []);
  selectOrigin(map, snapshot.drift?.selectedOriginIndex ?? null);

  // Restore inversion state
  const invResult = snapshot.inversion?.result ?? null;
  setInversionResult(invResult);
  setInversionVisible(snapshot.inversion?.visible ?? false);
  setComparisonVisible(snapshot.inversion?.comparisonVisible ?? false);
  if (invResult) {
    renderDebrisInversionLayer(map, invResult);
    renderComparisonOverlay(map, invResult);
    setDebrisInversionVisible(map, snapshot.inversion?.visible ?? false);
    setComparisonOverlayVisible(map, snapshot.inversion?.comparisonVisible ?? false);
  }

  // Restore model state
  if (snapshot.model) {
    setRunStatus({
      ...snapshot.model.runStatus,
      startedAt: snapshot.model.runStatus.startedAt ? new Date(snapshot.model.runStatus.startedAt) : undefined,
      finishedAt: snapshot.model.runStatus.finishedAt ? new Date(snapshot.model.runStatus.finishedAt) : undefined,
    });
    if (snapshot.model.resultSummary) {
      setResultSummary(snapshot.model.resultSummary);
    }
    if (snapshot.model.familySummary) {
      setFamilySummary(snapshot.model.familySummary);
    }
    setConfidence(snapshot.model.confidence);
    setModelSummary({
      speedRange: snapshot.model.speedRange,
      fuel: snapshot.model.fuel,
      familySpread: snapshot.model.familySpread,
    });
  }

  restoreWorkspaceFreshness(snapshot.freshness, snapshot.config);

  // Restore evidence selection
  if (snapshot.evidenceSelection?.kind === "anomaly" && snapshot.selectedAnomalyId) {
    setSelectedAnomaly(map, snapshot.selectedAnomalyId);
    setEvidenceSelection({
      kind: "anomaly",
      id: snapshot.selectedAnomalyId,
      title: snapshot.evidenceSelection.title,
      subtitle: snapshot.evidenceSelection.subtitle,
    });
  } else if (snapshot.evidenceSelection?.kind === "info" && snapshot.evidenceSelection.id) {
    setSelectedAnomaly(map, null);
    setEvidenceSelection(snapshot.evidenceSelection);
  } else {
    setSelectedAnomaly(map, null);
    clearEvidence();
  }

  // Restore panel
  const panelId = snapshot.panelId as PanelId | null;
  const validPanels: PanelId[] = ["model", "drift", "layers", "evidence", "export", "sensitivity"];
  if (panelId && validPanels.includes(panelId)) {
    setActivePanel(panelId);
  } else {
    setActivePanel(null);
  }

  setStoredSessionSnapshot(JSON.stringify(snapshot));
}
