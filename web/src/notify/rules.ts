// Notification wording and chime scheduling, kept pure for tests.
import type { PublicSession } from "../../../shared/src/protocol.ts";

/** At most one system notification per session in this window. */
export const NOTIFY_EVERY_MS = 60_000;
/** The chime repeats while a need is open and unacknowledged (the default; the settings may pick 60 s or once). */
export const CHIME_EVERY_MS = 25_000;

const TITLE: Record<NonNullable<PublicSession["need"]>["kind"], string> = {
  permission: "needs permission",
  question: "has a question",
  input: "needs input",
};

/** `name`: the session's display name (twins carry `#2`), else its project. */
export function notificationTitle(s: PublicSession, name = s.project ?? "Claude Code"): string {
  return `${name} ${s.need ? TITLE[s.need.kind] : ""}`.trim();
}

/**
 * Pure scheduling rule, unit tested: is this session due a chime beat now? Always on a new need; then every `everyMs`,
 * or never again when `everyMs` is null ("once").
 */
export function shouldChime(
  s: PublicSession,
  acknowledgedSince: number | undefined,
  lastChime: number | undefined,
  now: number,
  everyMs: number | null = CHIME_EVERY_MS,
): boolean {
  if (!s.need || acknowledgedSince === s.need.since) return false;
  if (lastChime === undefined || lastChime < s.need.since) return true;
  return everyMs !== null && now - lastChime >= everyMs;
}

/** Pure rate limit, unit tested: may a system notification be shown now, given when the last one for the session was? */
export function shouldNotify(lastNotified: number | undefined, now: number): boolean {
  return lastNotified === undefined || now - lastNotified >= NOTIFY_EVERY_MS;
}
