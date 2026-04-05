import type { AnalysisConfig } from "./config";

const STORAGE_KEY = "mh370.sessionState";

interface SessionState {
  analysisConfig?: Partial<AnalysisConfig>;
  activeScenarioId?: string | null;
  layerVisibility?: Record<string, boolean>;
  analystNotes?: string;
  lastSessionSnapshot?: string;
}

function readSessionState(): SessionState {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return {};
  }
}

function writeSessionState(next: SessionState): void {
  if (typeof window === "undefined") return;
  const current = readSessionState();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
}

export function getStoredAnalysisConfig(): Partial<AnalysisConfig> | null {
  return readSessionState().analysisConfig ?? null;
}

export function setStoredAnalysisConfig(config: AnalysisConfig): void {
  writeSessionState({ analysisConfig: config });
}

export function getStoredActiveScenarioId(): string | null {
  return readSessionState().activeScenarioId ?? null;
}

export function setStoredActiveScenarioId(activeScenarioId: string | null): void {
  writeSessionState({ activeScenarioId });
}

export function getStoredLayerVisibility(): Record<string, boolean> | null {
  return readSessionState().layerVisibility ?? null;
}

export function setStoredLayerVisibility(layerVisibility: Record<string, boolean>): void {
  writeSessionState({ layerVisibility });
}

export function getStoredAnalystNotes(): string {
  return readSessionState().analystNotes ?? "";
}

export function setStoredAnalystNotes(analystNotes: string): void {
  writeSessionState({ analystNotes });
}

export function getStoredSessionSnapshot(): string | null {
  return readSessionState().lastSessionSnapshot ?? null;
}

export function setStoredSessionSnapshot(snapshot: string): void {
  writeSessionState({ lastSessionSnapshot: snapshot });
}
