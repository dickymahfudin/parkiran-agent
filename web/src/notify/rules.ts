// Notification wording and chime scheduling, kept pure for tests.
import type { PublicSession } from "../../../shared/src/protocol.ts";

/** At most one system notification per session in this window. */
export const NOTIFY_EVERY_MS = 60_000;
/** The chime repeats while a need is open and unacknowledged. */
export const CHIME_EVERY_MS = 25_000;

const TITLE: Record<NonNullable<PublicSession["need"]>["kind"], string> = {
  permission: "needs permission",
  question: "has a question",
  input: "needs input",
};

export function notificationTitle(s: PublicSession): string {
  return `${s.project ?? "Claude Code"} ${s.need ? TITLE[s.need.kind] : ""}`.trim();
}

/** Pure scheduling rule, unit tested: should this session chime now? */
export function shouldChime(s: PublicSession, acknowledgedSince: number | undefined, lastChime: number | undefined, now: number): boolean {
  if (!s.need || acknowledgedSince === s.need.since) return false;
  return lastChime === undefined || lastChime < s.need.since || now - lastChime >= CHIME_EVERY_MS;
}
