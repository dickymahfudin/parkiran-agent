import type { ServerMessage } from "../../../shared/src/protocol.ts";
import { useApp } from "../state/store.ts";

export const MIN_RETRY_MS = 500;
export const MAX_RETRY_MS = 8000;

/** The page's own origin: the server serves the page in production, Vite proxies `/ws` to it in dev. */
export function wsUrl(): string {
  // Typed structurally: this module is also type-checked by the root config (no DOM lib) through the tests.
  const loc = (globalThis as unknown as { location: { host: string; protocol: string } }).location;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<ServerMessage["type"]>(["hello", "sessions", "cues", "usage"]);

/** Shape check before the store sees a frame: an unknown type is reported in the HUD instead of applied. */
export function parseServerMessage(value: unknown): ServerMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
  const msg = value as { type?: unknown; serverTime?: unknown };
  if (typeof msg.type !== "string" || !KNOWN_TYPES.has(msg.type)) throw new Error(`unknown message type ${JSON.stringify(msg.type)}`);
  if (typeof msg.serverTime !== "number" || !Number.isFinite(msg.serverTime)) throw new Error("missing serverTime");
  return value as ServerMessage;
}

/** The part of a WebSocket this module uses, so tests can hand in a fake. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  close(): void;
}

export interface ConnectOptions {
  makeSocket?: (url: string) => SocketLike;
  /** Timer to reconnect after `ms`; returns a handle for `cancel`. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Keeps one WebSocket to the server alive with backoff; every failure is surfaced in the HUD. */
export function connect(options: ConnectOptions = {}): () => void {
  const makeSocket = options.makeSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let ws: SocketLike | null = null;
  let retry = MIN_RETRY_MS;
  let timer: unknown = null;
  let stopped = false;
  const { setConnection, apply } = useApp.getState();

  const open = (): void => {
    setConnection("connecting");
    ws = makeSocket(wsUrl());
    ws.onopen = () => {
      setConnection("open");
    };
    ws.onmessage = (ev) => {
      try {
        apply(parseServerMessage(JSON.parse(String(ev.data))));
        // A real frame proves the server is the one we expect: the backoff restarts from the minimum (an upgrade that
        // is accepted and closed at once would otherwise reconnect every 500 ms for good).
        retry = MIN_RETRY_MS;
        if (useApp.getState().connectionError !== null) setConnection("open");
      } catch (err) {
        setConnection("open", `bad message from server: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    ws.onclose = (ev) => {
      if (stopped) return;
      setConnection("closed", ev.code === 1006 ? `server unreachable at ${wsUrl()}` : `closed (${ev.code})`);
      timer = schedule(open, retry);
      retry = Math.min(retry * 2, MAX_RETRY_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    ws?.close();
  };
}
