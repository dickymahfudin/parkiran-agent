import type { ServerMessage } from "../../../shared/src/protocol.ts";
import { useApp } from "../state/store.ts";

declare const __PARKIRAN_SERVER_PORT__: number;

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 8000;

function wsUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:${__PARKIRAN_SERVER_PORT__}/ws`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
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
        apply(JSON.parse(String(ev.data)) as ServerMessage);
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
