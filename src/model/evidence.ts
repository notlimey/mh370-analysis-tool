import { getAnomalies as loadAnomalies } from "../lib/backend";

export interface Anomaly {
  id: string;
  category: string;
  lat: number | null;
  lon: number | null;
  title: string;
  date: string;
  confidence: string;
  summary: string;
  detail: string;
  source: string;
  source_url?: string;
  implication: string;
  status: string;
  conflicts_with: string[];
  supports: string[];
}

let anomalyCache: Anomaly[] | null = null;

export async function getAnomalies(): Promise<Anomaly[]> {
  if (anomalyCache) {
    return anomalyCache;
  }
  anomalyCache = (await loadAnomalies()) as Anomaly[];
  return anomalyCache;
}

export function getAnomalyById(id: string): Anomaly | undefined {
  return anomalyCache?.find((item) => item.id === id);
}
