import { beforeEach, describe, expect, test } from "bun:test";
import { useApp } from "../state/store.ts";
import { MAX_RETRY_MS, MIN_RETRY_MS, connect, type SocketLike } from "./connection.ts";

class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const delays: number[] = [];
  const pending: (() => void)[] = [];
  const stop = connect({
    makeSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    schedule: (fn, ms) => {
      delays.push(ms);
      pending.push(fn);
      return pending.length - 1;
    },
    cancel: (handle) => {
      pending[handle as number] = () => undefined;
    },
  });
  const fire = () => pending.shift()?.();
  return { sockets, delays, fire, stop, last: () => sockets[sockets.length - 1]! };
}

beforeEach(() => {
  (globalThis as { location?: unknown }).location = { host: "127.0.0.1:4757", protocol: "http:" };
  useApp.setState({ connection: "connecting", connectionError: null });
});

describe("connect", () => {
  test("opens a socket on the page's own origin and reports the status", () => {
    const h = harness();
    expect(h.last().url).toBe("ws://127.0.0.1:4757/ws");
    expect(useApp.getState().connection).toBe("connecting");
    h.last().onopen?.({});
    expect(useApp.getState().connection).toBe("open");
    h.stop();
    expect(h.last().closed).toBe(true);
  });

  test("backs off 500 ms → 8 s on repeated failures and stops reconnecting once stopped", () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      h.last().onclose?.({ code: 1006 });
      expect(useApp.getState().connection).toBe("closed");
      expect(useApp.getState().connectionError).toContain("server unreachable");
      h.fire();
    }
    expect(h.delays).toEqual([MIN_RETRY_MS, 1000, 2000, 4000, MAX_RETRY_MS, MAX_RETRY_MS]);
    expect(h.sockets.length).toBe(7);
    h.stop();
    h.last().onclose?.({ code: 1000 });
    expect(h.sockets.length).toBe(7);
  });

  test("a good frame resets the backoff and clears an earlier bad-message error", () => {
    const h = harness();
    h.last().onclose?.({ code: 1006 });
    h.fire();
    h.last().onclose?.({ code: 1006 });
    h.fire();
    expect(h.delays).toEqual([500, 1000]);
    h.last().onopen?.({});
    h.last().onmessage?.({ data: JSON.stringify({ type: "recap", serverTime: 1 }) });
    expect(useApp.getState().connectionError).toContain('unknown message type "recap"');
    h.last().onmessage?.({ data: JSON.stringify({ type: "cues", serverTime: 1, cues: [] }) });
    expect(useApp.getState().connectionError).toBeNull();
    h.last().onclose?.({ code: 1001 });
    expect(h.delays[2]).toBe(MIN_RETRY_MS);
    expect(useApp.getState().connectionError).toBe("closed (1001)");
    h.stop();
  });
});
