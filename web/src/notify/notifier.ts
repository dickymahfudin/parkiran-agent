// Browser notifications + chime when a session needs you. Purely a viewer: acknowledging (clicking the
// character) only silences the repeating chime; the real session state never changes from here.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/sound.ts";
import { sessionName } from "../hud/labels.ts";
import { chimeEveryMs, inQuietHours } from "../state/settings.ts";
import { useApp } from "../state/store.ts";
import { createNotifier } from "./notifierCore.ts";
import { notificationTitle } from "./rules.ts";

function systemNotify(s: PublicSession): { close(): void } | null {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;
  // Only when you are elsewhere; on the page the bubble and chime are enough.
  if (document.visibilityState === "visible" && document.hasFocus()) return null;
  const name = s.project ? sessionName(s, useApp.getState().twins) : undefined;
  const n = new Notification(notificationTitle(s, name), { body: s.branch ? `branch ${s.branch}` : "", tag: `parkiran-${s.id}`, silent: true });
  n.onclick = () => {
    window.focus();
    useApp.getState().select(s.id);
    n.close();
  };
  return n;
}

export async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  await Notification.requestPermission();
}

export function startNotifier(): () => void {
  const notifier = createNotifier({ chime: () => sound.chime(), notify: systemNotify });
  const timer = setInterval(() => {
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
  }, 1000);
  return () => {
    clearInterval(timer);
    notifier.stop();
  };
}
