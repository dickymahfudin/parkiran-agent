import type { PublicSession } from "../../../shared/src/protocol.ts";
import { lookFor } from "../scene/characters/identity.ts";
import { Icon } from "./icons.tsx";
import { MOOD_COLOR, type StateLabel } from "./labels.ts";

/** Dark or light text, whichever reads on `hex`. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 0.6 ? "var(--ink-on-bright)" : "var(--text)";
}

/** The character's shirt colour with the project's initial, so a row is easy to match to a person in the lot. */
export function Avatar({ s }: { s: PublicSession }) {
  const shirt = lookFor(s.id).shirtColor;
  return (
    <span className="avatar" style={{ background: shirt, color: inkOn(shirt) }} aria-hidden="true">
      {(s.project ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A session's state as a coloured chip, with its icon when the state has one. */
export function StateChip({ label }: { label: StateLabel }) {
  return (
    <span className="chip" style={{ background: MOOD_COLOR[label.mood] }}>
      {label.icon && <Icon name={label.icon} />}
      {label.text}
    </span>
  );
}
