import { createSignal } from "solid-js";

export interface EvidenceSelection {
  kind: "none" | "anomaly" | "info";
  id: string | null;
  title?: string;
  subtitle?: string;
}

const [evidenceSelection, setEvidenceSelection] = createSignal<EvidenceSelection>({
  kind: "none",
  id: null,
});

export { evidenceSelection, setEvidenceSelection };

export function clearEvidence(): void {
  setEvidenceSelection({ kind: "none", id: null });
}
