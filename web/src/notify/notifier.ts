// Browser notifications + chime when a session needs you. Purely a viewer: acknowledging (clicking the
// character) only silences the repeating chime; the real session state never changes from here.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/sound.ts";
import { useApp } from "../state/store.ts";
import { NOTIFY_EVERY_MS, notificationTitle, shouldChime } from "./rules.ts";

function systemNotify(s: PublicSession): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Only when you are elsewhere; on the page the bubble and chime are enough.
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const n = new Notification(notificationTitle(s), { body: s.branch ? `branch ${s.branch}` : "", tag: `parkiran-${s.id}`, silent: true });
  n.onclick = () => {
    window.focus();
    useApp.getState().select(s.id);
    n.close();
  };
}

export async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  await Notification.requestPermission();
}

export function startNotifier(): () => void {
  const lastChime = new Map<string, number>();
  const lastNotified = new Map<string, number>();
  const timer = setInterval(() => {
    const st = useApp.getState();
    const now = Date.now();
    for (const s of Object.values(st.sessions)) {
      if (!s.need) {
        lastChime.delete(s.id);
        continue;
      }
      if (!shouldChime(s, st.acknowledged[s.id], lastChime.get(s.id), now + st.clockOffset)) continue;
      lastChime.set(s.id, now + st.clockOffset);
      sound.chime();
      const notified = lastNotified.get(s.id);
      if (st.notificationsEnabled && (notified === undefined || now - notified >= NOTIFY_EVERY_MS)) {
        lastNotified.set(s.id, now);
        systemNotify(s);
      }
    }
  }, 1000);
  return () => clearInterval(timer);
}
