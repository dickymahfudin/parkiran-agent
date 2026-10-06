// Browser notifications + chime when a session needs you. Purely a viewer: acknowledging (clicking the
// character) only silences the repeating chime; the real session state never changes from here.
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { sound } from "../audio/sound.ts";
import { sessionName } from "../hud/labels.ts";
import { useApp } from "../state/store.ts";
import { NOTIFY_EVERY_MS, notificationTitle, shouldChime } from "./rules.ts";

function systemNotify(s: PublicSession, shown: Map<string, Notification>): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Only when you are elsewhere; on the page the bubble and chime are enough.
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const name = s.project ? sessionName(s, useApp.getState().twins) : undefined;
  const n = new Notification(notificationTitle(s, name), { body: s.branch ? `branch ${s.branch}` : "", tag: `parkiran-${s.id}`, silent: true });
  n.onclick = () => {
    window.focus();
    useApp.getState().select(s.id);
    n.close();
  };
  n.onclose = () => {
    if (shown.get(s.id) === n) shown.delete(s.id);
  };
  shown.get(s.id)?.close();
  shown.set(s.id, n);
}

export async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  await Notification.requestPermission();
}

export function startNotifier(): () => void {
  const lastChime = new Map<string, number>();
  const lastNotified = new Map<string, number>();
  /** The system notification on screen per session, closed as soon as the need is handled or the session leaves. */
  const shown = new Map<string, Notification>();
  const forget = (id: string): void => {
    lastChime.delete(id);
    lastNotified.delete(id);
    shown.get(id)?.close();
    shown.delete(id);
  };
  const timer = setInterval(() => {
    const st = useApp.getState();
    const now = Date.now();
    for (const id of new Set([...lastChime.keys(), ...lastNotified.keys(), ...shown.keys()])) if (!st.sessions[id]) forget(id);
    for (const s of Object.values(st.sessions)) {
      if (!s.need) {
        forget(s.id);
        continue;
      }
      if (!shouldChime(s, st.acknowledged[s.id], lastChime.get(s.id), now + st.clockOffset)) continue;
      lastChime.set(s.id, now + st.clockOffset);
      sound.chime();
      const notified = lastNotified.get(s.id);
      if (st.notificationsEnabled && (notified === undefined || now - notified >= NOTIFY_EVERY_MS)) {
        lastNotified.set(s.id, now);
        systemNotify(s, shown);
      }
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    for (const n of shown.values()) n.close();
    shown.clear();
  };
}
