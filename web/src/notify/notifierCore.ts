// The notifier's bookkeeping, free of DOM types so it can be unit tested under Bun.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { shouldChime, shouldNotify } from "./rules.ts";

/** What the notifier needs from the outside, injectable so the bookkeeping can be unit tested. */
export interface NotifierDeps {
  chime(): void;
  /** Shows a system notification; returns a handle to close it, or null when none was shown. */
  notify(s: PublicSession): { close(): void } | null;
}

export interface NotifierInput {
  sessions: Readonly<Record<string, PublicSession>>;
  acknowledged: Readonly<Record<string, number>>;
  clockOffset: number;
  notificationsEnabled: boolean;
}

/**
 * The per-second bookkeeping: chime while a need is open and unacknowledged, at most one system notification per
 * session per `NOTIFY_EVERY_MS` (also across needs: a session asking five times in a minute notifies once), and the
 * notification on screen closes as soon as the need is handled. State is dropped only when the session leaves.
 */
export function createNotifier(deps: NotifierDeps) {
  const lastChime = new Map<string, number>();
  const lastNotified = new Map<string, number>();
  const shown = new Map<string, { close(): void }>();
  const dismiss = (id: string): void => {
    shown.get(id)?.close();
    shown.delete(id);
  };
  const forget = (id: string): void => {
    lastChime.delete(id);
    lastNotified.delete(id);
    dismiss(id);
  };
  return {
    tick(input: NotifierInput, now: number): void {
      for (const id of new Set([...lastChime.keys(), ...lastNotified.keys(), ...shown.keys()])) if (!input.sessions[id]) forget(id);
      for (const s of Object.values(input.sessions)) {
        if (!s.need) {
          // Handled: the bubble goes, but the rate limit stays so a chatty session cannot flood the notification centre.
          lastChime.delete(s.id);
          dismiss(s.id);
          continue;
        }
        if (!shouldChime(s, input.acknowledged[s.id], lastChime.get(s.id), now + input.clockOffset)) continue;
        lastChime.set(s.id, now + input.clockOffset);
        deps.chime();
        if (input.notificationsEnabled && shouldNotify(lastNotified.get(s.id), now)) {
          lastNotified.set(s.id, now);
          const handle = deps.notify(s);
          dismiss(s.id);
          if (handle) shown.set(s.id, handle);
        }
      }
    },
    stop(): void {
      for (const id of [...shown.keys()]) dismiss(id);
    },
    /** For tests. */
    get tracked(): number {
      return new Set([...lastChime.keys(), ...lastNotified.keys(), ...shown.keys()]).size;
    },
  };
}
