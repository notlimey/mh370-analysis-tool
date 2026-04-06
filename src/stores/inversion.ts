import { createSignal } from "solid-js";
import type { InversionResult } from "../lib/backend";

const [inversionResult, setInversionResult] = createSignal<InversionResult | null>(null);
const [inversionVisible, setInversionVisible] = createSignal(false);
const [comparisonVisible, setComparisonVisible] = createSignal(false);

export {
  comparisonVisible,
  inversionResult,
  inversionVisible,
  setComparisonVisible,
  setInversionResult,
  setInversionVisible,
};

export function getInversionVisibilityState(): { visible: boolean; comparisonVisible: boolean } {
  return { visible: inversionVisible(), comparisonVisible: comparisonVisible() };
}
