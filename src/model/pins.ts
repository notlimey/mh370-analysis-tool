export interface SavedPin {
  id: string;
  label: string;
  coordinates: [number, number];
}

const STORAGE_KEY = "mh370.savedPins";

export function listSavedPins(): SavedPin[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SavedPin[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePin(coordinates: [number, number], label?: string): SavedPin {
  const pins = listSavedPins();
  const pin: SavedPin = {
    id: `pin-${Date.now()}`,
    label: label?.trim() || `Point ${pins.length + 1}`,
    coordinates,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...pins, pin]));
  return pin;
}

export function updatePin(id: string, updates: Partial<Pick<SavedPin, "label" | "coordinates">>): void {
  const pins = listSavedPins().map((pin) => (pin.id === id ? { ...pin, ...updates } : pin));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

export function removePin(id: string): void {
  const pins = listSavedPins().filter((pin) => pin.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

export function replaceSavedPins(pins: SavedPin[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}
