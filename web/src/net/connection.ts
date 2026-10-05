import type { ServerMessage } from "../../../shared/src/protocol.ts";
import { useApp } from "../state/store.ts";

declare const __PARKIRAN_SERVER_PORT__: number;

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 8000;

function wsUrl(): string {
  // Typed structurally: this module is also type-checked by the root config (no DOM lib) through the store tests.
  const loc = (globalThis as unknown as { location: { hostname: string; host: string; protocol: string } }).location;
  if (import.meta.env.DEV) return `ws://${loc.hostname}:${__PARKIRAN_SERVER_PORT__}/ws`;
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

/** Keeps one WebSocket to the server alive with backoff; every failure is surfaced in the HUD. */
export function connect(): () => void {
  let ws: WebSocket | null = null;
  let retry = MIN_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const { setConnection, apply } = useApp.getState();

  const open = (): void => {
    setConnection("connecting");
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      retry = MIN_RETRY_MS;
      setConnection("open");
    };
    ws.onmessage = (ev) => {
      try {
        apply(parseServerMessage(JSON.parse(String(ev.data))));
      } catch (err) {
        setConnection("open", `bad message from server: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    ws.onclose = (ev) => {
      if (stopped) return;
      setConnection("closed", ev.code === 1006 ? `server unreachable at ${wsUrl()}` : `closed (${ev.code})`);
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, MAX_RETRY_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
