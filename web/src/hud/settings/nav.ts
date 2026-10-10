// The settings dialog's categories and the pure parts of moving between them. No DOM, unit tested.

export type CategoryId = "sound" | "notifications" | "display" | "battery" | "street" | "developer";

export interface Category {
  id: CategoryId;
  label: string;
}

const ALL: readonly Category[] = [
  { id: "sound", label: "Sound" },
  { id: "notifications", label: "Notifications" },
  { id: "display", label: "Display" },
  { id: "battery", label: "Battery" },
  { id: "street", label: "Street life" },
  { id: "developer", label: "Developer" },
];

/** The categories this build shows: Developer only in a dev build. */
export function categoriesFor(dev: boolean): readonly Category[] {
  return dev ? ALL : ALL.filter((c) => c.id !== "developer");
}

/** A stored category id → one of `available`; unknown, missing or hidden (Developer in production) → the first. */
export function parseCategory(raw: string | null, available: readonly Category[]): CategoryId {
  const found = available.find((c) => c.id === raw);
  return (found ?? available[0]!).id;
}

/**
 * The index a key moves to in a vertical list of `count` items (wrapping), or null for a key the list ignores.
 * Arrow Up/Down step, Home/End jump to the ends.
 */
export function stepIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Where Tab goes inside a focus trap: the element index to focus instead of the browser's default, or null to let the
 * browser move on. `current` is the focused element's index among the tabbables, -1 when focus is outside them.
 */
export function trapIndex(current: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return null;
}
