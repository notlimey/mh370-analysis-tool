import type { AnalysisConfig } from "./config";

const STORAGE_KEY = "mh370.sessionState";
const SESSION_SCHEMA_VERSION = 2;

interface SessionState {
  schemaVersion?: number;
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
    const parsed = JSON.parse(raw) as SessionState;
    if (parsed.schemaVersion === SESSION_SCHEMA_VERSION) {
      return parsed;
    }

    // Drop stale model config after schema changes so old tuning does not
    // silently override new backend defaults.
    const migrated: SessionState = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      activeScenarioId: parsed.activeScenarioId ?? null,
      layerVisibility: parsed.layerVisibility,
      analystNotes: parsed.analystNotes,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

function writeSessionState(next: SessionState): void {
  if (typeof window === "undefined") return;
  const current = readSessionState();
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...current,
      ...next,
      schemaVersion: SESSION_SCHEMA_VERSION,
    }),
  );
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
