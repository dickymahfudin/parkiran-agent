// What a name tag over a head shows, and how the name-tags setting trims it. Pure, unit tested; drawn by Person.tsx.
import type { NameTags } from "../../state/settings.ts";
import type { IconName } from "../../hud/labels.ts";

export interface TagInfo {
  /** Project name with its twin number (sessions), or the subagent type (friends). */
  title: string;
  subtitle: string | null;
  color: string;
  /** State text; null shows no state at all. */
  text: string | null;
  icon: IconName | null;
}

/**
 * Off: no tag. Name: the title and the colour dot only (no branch, no state). Full: everything. The need bubble, the
 * Zzz and the done badge are not part of the tag and show in every mode.
 */
export function trimTag(tag: TagInfo | null, mode: NameTags): TagInfo | null {
  if (tag === null || mode === "off") return null;
  if (mode === "name") return { title: tag.title, subtitle: null, color: tag.color, text: null, icon: null };
  return tag;
}

export const sameTag = (a: TagInfo | null, b: TagInfo | null): boolean =>
  a === b || (a !== null && b !== null && a.title === b.title && a.subtitle === b.subtitle && a.color === b.color && a.text === b.text && a.icon === b.icon);
