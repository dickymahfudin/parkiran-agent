import { describe, expect, test } from "bun:test";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { createNotifier } from "./notifierCore.ts";
import { CHIME_EVERY_MS, NOTIFY_EVERY_MS } from "./rules.ts";

const session = (id: string, since: number | null): PublicSession =>
  ({
    id,
    project: "warung-app",
    branch: "main",
    need: since === null ? null : { kind: "permission", toolName: "Bash", toolUseId: null, agentId: null, since, reminded: false },
  }) as unknown as PublicSession;

function harness() {
  let chimes = 0;
  const shown: { id: string; closed: boolean }[] = [];
  const notifier = createNotifier({
    chime: () => chimes++,
    notify: (s) => {
      const n = { id: s.id, closed: false };
      shown.push(n);
      return { close: () => void (n.closed = true) };
    },
  });
  const tick = (sessions: PublicSession[], now: number, enabled = true) =>
    notifier.tick({ sessions: Object.fromEntries(sessions.map((s) => [s.id, s])), acknowledged: {}, clockOffset: 0, notificationsEnabled: enabled }, now);
  return { notifier, tick, shown, chimes: () => chimes };
}

describe("createNotifier", () => {
  test("a new need chimes and notifies once; the notification closes when the need is handled", () => {
    const h = harness();
    h.tick([session("a", 1000)], 1000);
    expect(h.chimes()).toBe(1);
    expect(h.shown).toEqual([{ id: "a", closed: false }]);
    h.tick([session("a", 1000)], 2000);
    expect(h.chimes()).toBe(1);
    h.tick([session("a", null)], 3000);
    expect(h.shown[0]!.closed).toBe(true);
  });

  test("at most one system notification per session per window, even across several needs; the chime still sounds", () => {
    const h = harness();
    h.tick([session("a", 1000)], 1000);
    h.tick([session("a", null)], 2000);
    h.tick([session("a", 5000)], 5000);
    h.tick([session("a", null)], 6000);
    h.tick([session("a", 9000)], 9000);
    expect(h.chimes()).toBe(3);
    expect(h.shown.length).toBe(1);
    h.tick([session("a", null)], 10_000);
    const later = 1000 + NOTIFY_EVERY_MS;
    h.tick([session("a", later)], later);
    expect(h.shown.length).toBe(2);
  });

  test("the chime repeats every 25 s while unacknowledged; nothing is shown with notifications off", () => {
    const h = harness();
    h.tick([session("a", 1000)], 1000, false);
    h.tick([session("a", 1000)], 1000 + CHIME_EVERY_MS, false);
    expect(h.chimes()).toBe(2);
    expect(h.shown).toEqual([]);
  });

  test("a session that leaves is forgotten (its notification closed) and starts fresh when it comes back", () => {
    const h = harness();
    h.tick([session("a", 1000)], 1000);
    h.tick([], 2000);
    expect(h.shown[0]!.closed).toBe(true);
    expect(h.notifier.tracked).toBe(0);
    h.tick([session("a", 3000)], 3000);
    expect(h.shown.length).toBe(2);
    h.notifier.stop();
    expect(h.shown[1]!.closed).toBe(true);
  });
});
