import { createSignal } from "solid-js";
import { getStoredActiveScenarioId, setStoredActiveScenarioId } from "../model/session";

const [activeScenarioId, setActiveScenarioIdInternal] = createSignal<string | null>(getStoredActiveScenarioId());

export { activeScenarioId };

export function setActiveScenarioId(id: string | null): void {
  setActiveScenarioIdInternal(id);
  setStoredActiveScenarioId(id);
}
