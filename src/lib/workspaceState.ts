import type { AnalysisConfig } from "../model/config";
import { getConfigSnapshot } from "../stores/analysis-config";

interface FreshnessState {
  hasResult: boolean;
  isStale: boolean;
  lastCompletedAt: string | null;
}

interface WorkspaceFreshnessSnapshot {
  model: FreshnessState;
  drift: FreshnessState;
  inversion: FreshnessState;
}

let modelInputSignature: string | null = null;
let driftInputSignature: string | null = null;
let inversionInputSignature: string | null = null;

let freshness: WorkspaceFreshnessSnapshot = {
  model: { hasResult: false, isStale: false, lastCompletedAt: null },
  drift: { hasResult: false, isStale: false, lastCompletedAt: null },
  inversion: { hasResult: false, isStale: false, lastCompletedAt: null },
};

export function markModelRunCompleted(config: AnalysisConfig = getConfigSnapshot(), completedAt = new Date()): void {
  modelInputSignature = createConfigSignature(config);
  freshness.model = {
    hasResult: true,
    isStale: false,
    lastCompletedAt: completedAt.toISOString(),
  };
}

export function markDriftRunCompleted(config: AnalysisConfig = getConfigSnapshot(), completedAt = new Date()): void {
  driftInputSignature = createConfigSignature(config);
  freshness.drift = {
    hasResult: true,
    isStale: false,
    lastCompletedAt: completedAt.toISOString(),
  };
}

export function markInversionRunCompleted(
  config: AnalysisConfig = getConfigSnapshot(),
  completedAt = new Date(),
): void {
  inversionInputSignature = createConfigSignature(config);
  freshness.inversion = {
    hasResult: true,
    isStale: false,
    lastCompletedAt: completedAt.toISOString(),
  };
}

export function markWorkspaceInputsChanged(config: AnalysisConfig = getConfigSnapshot()): void {
  const currentSignature = createConfigSignature(config);
  if (freshness.model.hasResult && modelInputSignature !== currentSignature) {
    freshness.model = { ...freshness.model, isStale: true };
  }
  if (freshness.drift.hasResult && driftInputSignature !== currentSignature) {
    freshness.drift = { ...freshness.drift, isStale: true };
  }
  if (freshness.inversion.hasResult && inversionInputSignature !== currentSignature) {
    freshness.inversion = { ...freshness.inversion, isStale: true };
  }
}

export function getWorkspaceFreshness(): WorkspaceFreshnessSnapshot {
  return {
    model: { ...freshness.model },
    drift: { ...freshness.drift },
    inversion: { ...freshness.inversion },
  };
}

export function restoreWorkspaceFreshness(
  next: WorkspaceFreshnessSnapshot,
  config: AnalysisConfig = getConfigSnapshot(),
): void {
  const signature = createConfigSignature(config);
  freshness = {
    model: { ...next.model },
    drift: { ...next.drift },
    inversion: { ...next.inversion },
  };
  modelInputSignature = freshness.model.hasResult ? signature : null;
  driftInputSignature = freshness.drift.hasResult ? signature : null;
  inversionInputSignature = freshness.inversion.hasResult ? signature : null;
}

function createConfigSignature(config: AnalysisConfig): string {
  return JSON.stringify(config);
}
