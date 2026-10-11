// The notifier's loop on the store, without the browser parts (system notifications, sound), so tests run it under Bun.
import { chimeEveryMs, inQuietHours } from "../state/settings.ts";
import { useApp } from "../state/store.ts";
import { createNotifier, type NotifierDeps } from "./notifierCore.ts";

/** Checks every second (that repeats the chime) and on every change to the sessions or acknowledgements. */
export function runNotifier(deps: NotifierDeps): () => void {
  const notifier = createNotifier(deps);
  const check = () => {
    const st = useApp.getState();
    notifier.tick(
      {
        sessions: st.sessions,
        acknowledged: st.acknowledged,
        clockOffset: st.clockOffset,
        notificationsEnabled: st.notificationsEnabled,
        chimeEveryMs: chimeEveryMs(st.settings.chimeRepeat),
        quiet: inQuietHours(new Date(), st.settings.quietHours),
      },
      Date.now(),
    );
  };
  // The timer repeats the chime. A new need must not wait for it: after five minutes hidden and silent, Chrome runs a
  // tab's timers once a minute, while WebSocket messages still arrive at once. So every change to the sessions (or an
  // acknowledgement) checks right away.
  const timer = setInterval(check, 1000);
  const unsubscribe = useApp.subscribe((st, prev) => {
    if (st.sessions !== prev.sessions || st.acknowledged !== prev.acknowledged) check();
  });
  return () => {
    clearInterval(timer);
    unsubscribe();
    notifier.stop();
  };
}
