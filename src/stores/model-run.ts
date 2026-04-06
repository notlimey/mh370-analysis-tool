import { createStore } from "solid-js/store";

export interface ModelRunStatus {
  state: "idle" | "running" | "completed" | "failed";
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  pathCount?: number;
  heatmapCount?: number;
  bestFamily?: string;
  bfoDiagnosticCount?: number;
  bfoAvailable?: boolean;
  error?: string;
}

export interface ModelResultSummary {
  scenarioLabel?: string;
  bestFamily?: string;
  bestScore?: number;
  endpointCounts: Record<string, number>;
  fuelFeasibleCount?: number;
  fuelFeasiblePercent?: number;
  bfoMeanAbsResidualHz?: number;
  bestEndpointLat?: number;
  bestEndpointLon?: number;
  peakLat?: number;
  peakLon?: number;
  searchedOverlapLabel?: string;
  continuationLabel?: string;
  pathCount: number;
  heatmapCount: number;
}

export interface FamilySummary {
  counts: Record<string, number>;
  familySpreadKm?: number;
  firsByFamily?: Record<string, string[]>;
  endpointNarrative?: string;
}

export interface ModelSummaryData {
  confidence: string;
  speedRange: string;
  fuel: string;
  familySpread: string;
}

interface ModelRunState {
  runStatus: ModelRunStatus;
  resultSummary: ModelResultSummary | null;
  familySummary: FamilySummary | null;
  summary: ModelSummaryData;
}

const [modelRunState, setModelRunState] = createStore<ModelRunState>({
  runStatus: { state: "idle" },
  resultSummary: null,
  familySummary: null,
  summary: {
    confidence: "\u2014",
    speedRange: "\u2014",
    fuel: "\u2014",
    familySpread: "\u2014",
  },
});

export { modelRunState };

export function setRunStatus(status: ModelRunStatus): void {
  setModelRunState("runStatus", status);
}

export function setResultSummary(summary: ModelResultSummary): void {
  setModelRunState("resultSummary", summary);
}

export function setFamilySummary(summary: FamilySummary): void {
  setModelRunState("familySummary", summary);
}

export function setConfidence(value: string): void {
  setModelRunState("summary", "confidence", value);
}

export function setModelSummary(data: Partial<ModelSummaryData>): void {
  setModelRunState("summary", (prev) => ({ ...prev, ...data }));
}
