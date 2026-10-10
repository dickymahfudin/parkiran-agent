// Keyboard shortcuts of the HUD. "R" (reset view) lives in the camera rig, Esc in the HUD and each popover; this file
// decides which key press is a HUD shortcut at all. Pure, unit tested (no DOM needed).

export type HudShortcut = "settings" | "help";

/** The list the "?" sheet shows. */
export const SHORTCUTS: readonly { keys: string; does: string }[] = [
  { keys: "R", does: "Reset the view" },
  { keys: "Esc", does: "Close the session or menu, stop following" },
  { keys: ",", does: "Open or close the settings" },
  { keys: "?", does: "Show this list" },
];

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True while the user types somewhere: a key press there is text, never a shortcut. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as TargetLike;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: unknown;
  /** Set while an input method composes text (Japanese, Chinese…). */
  isComposing?: boolean;
}

/** The HUD shortcut a key press triggers, if any. Shift is allowed ("?" is Shift+/ on most layouts). */
export function shortcutFor(e: KeyLike): HudShortcut | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || isTypingTarget(e.target)) return null;
  if (e.key === ",") return "settings";
  if (e.key === "?") return "help";
  return null;
}
