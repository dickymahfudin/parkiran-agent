import { create } from "zustand";
import type { ClientConfig, PublicSession, ServerMessage, UsageSnapshot } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";
import { assignTwinNumbers } from "../hud/labels.ts";
import { isTimeMode, presetTime, type TimeMode } from "../scene/env/timeOfDay.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface CueEntry {
  cue: Cue;
  at: number;
  seq: number;
}

const MAX_CUE_LOG = 40;

export type CameraMode = "orbit" | "cinematic";

/** Scene parts that load assets; the loading screen lifts once each has mounted (or failed). */
export const SCENE_PARTS = ["sky", "ground", "walls", "warung", "furniture", "vehicles", "characters"] as const;
export type ScenePart = (typeof SCENE_PARTS)[number];

export function isScenePart(value: string): value is ScenePart {
  return (SCENE_PARTS as readonly string[]).includes(value);
}

// No `location` outside a browser (unit tests run under Bun without the DOM lib).
const params = new URLSearchParams((globalThis as { location?: { search: string } }).location?.search ?? "");

/** Per-viewer preferences; storage can be unavailable (private mode), so failures fall back to defaults. */
function pref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`parkiran:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: boolean | string): void {
  try {
    localStorage.setItem(`parkiran:${key}`, typeof value === "string" ? value : value ? "1" : "0");
  } catch {
    // Not persisted; the toggle still works for this visit.
  }
}

function savedTimeMode(): TimeMode {
  try {
    const v = localStorage.getItem("parkiran:timeMode");
    return isTimeMode(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

interface AppState {
  connection: ConnectionStatus;
  connectionError: string | null;
  /** Server clock minus local clock, so ages/durations use one time base. */
  clockOffset: number;
  config: ClientConfig | null;
  usage: UsageSnapshot | null;
  sessions: Record<string, PublicSession>;
  cueLog: CueEntry[];
  cueSeq: number;
  selectedId: string | null;
  /** Twin number per session id for sessions sharing a project and branch (`assignTwinNumbers`). */
  twins: ReadonlyMap<string, number>;
  /** Fixed scene clock, "HH:MM": a time-of-day preset, `?time=` or the dev input; null follows the local clock. */
  timeOverride: string | null;
  assetErrors: string[];
  readyParts: ScenePart[];
  cameraMode: CameraMode;
  /** Bumped by "Reset view" (button, R key, double-click on empty ground); the camera rig eases back to the default angle. */
  viewResets: number;
  /** Second-monitor mode: fixed angle, lower resolution, small HUD (?compact). */
  compact: boolean;
  /** User preference; sound only plays once the page has had a click (browser autoplay rule). */
  audioEnabled: boolean;
  audioUnlocked: boolean;
  notificationsEnabled: boolean;
  /** The session list folded down to its header and summary (remembered in this browser). */
  sessionsCollapsed: boolean;
  /** Needs the user has seen (clicked the character): session id → need.since. Stops the repeating sound only. */
  acknowledged: Record<string, number>;
  setConnection(status: ConnectionStatus, error?: string | null): void;
  setTimeOverride(value: string | null): void;
  /** Picks a time-of-day preset (or auto) and remembers it in this browser. */
  setTimeMode(mode: TimeMode): void;
  reportAssetError(message: string): void;
  markReady(part: ScenePart): void;
  apply(msg: ServerMessage): void;
  select(id: string | null): void;
  setCameraMode(mode: CameraMode): void;
  resetView(): void;
  setCompact(on: boolean): void;
  setAudioEnabled(on: boolean): void;
  unlockAudio(): void;
  setNotificationsEnabled(on: boolean): void;
  setSessionsCollapsed(on: boolean): void;
  acknowledge(sessionId: string): void;
}

export const useApp = create<AppState>((set) => ({
  connection: "connecting",
  connectionError: null,
  clockOffset: 0,
  config: null,
  usage: null,
  sessions: {},
  cueLog: [],
  cueSeq: 0,
  selectedId: null,
  twins: new Map(),
  timeOverride: params.get("time") ?? presetTime(savedTimeMode()),
  assetErrors: [],
  readyParts: [],
  cameraMode: params.has("cinematic") ? "cinematic" : "orbit",
  viewResets: 0,
  compact: params.has("compact"),
  audioEnabled: pref("audio", true),
  audioUnlocked: false,
  notificationsEnabled: pref("notifications", true),
  sessionsCollapsed: pref("sessionsCollapsed", false),
  acknowledged: {},

  setTimeOverride: (timeOverride) => set({ timeOverride }),
  setTimeMode: (mode) => {
    savePref("timeMode", mode);
    set({ timeOverride: presetTime(mode) });
  },
  reportAssetError: (message) => set((st) => (st.assetErrors.includes(message) ? st : { assetErrors: [...st.assetErrors, message] })),
  markReady: (part) => set((st) => (st.readyParts.includes(part) ? st : { readyParts: [...st.readyParts, part] })),

  setConnection: (connection, error = null) => set({ connection, connectionError: error }),

  apply: (msg) =>
    set((state) => {
      const clockOffset = msg.serverTime - Date.now();
      switch (msg.type) {
        case "hello":
          return {
            clockOffset,
            config: msg.config,
            usage: msg.usage,
            sessions: Object.fromEntries(msg.sessions.map((s) => [s.id, s])),
            twins: assignTwinNumbers(state.twins, msg.sessions),
          };
        case "sessions": {
          const sessions = { ...state.sessions };
          for (const s of msg.updated) sessions[s.id] = s;
          for (const id of msg.removed) delete sessions[id];
          const selectedId = state.selectedId && sessions[state.selectedId] ? state.selectedId : null;
          return { clockOffset, sessions, selectedId, twins: assignTwinNumbers(state.twins, Object.values(sessions)) };
        }
        case "cues": {
          let seq = state.cueSeq;
          const added = msg.cues.map((cue) => ({ cue, at: msg.serverTime, seq: ++seq }));
          return { clockOffset, cueSeq: seq, cueLog: [...added.reverse(), ...state.cueLog].slice(0, MAX_CUE_LOG) };
        }
        case "usage":
          return { clockOffset, usage: msg.usage };
        default:
          // A message type this build does not know (server newer than the cached page): keep the state. Returning
          // nothing here would make zustand replace the whole state with `undefined`.
          return { clockOffset };
      }
    }),

  select: (selectedId) =>
    set((st) => {
      const need = selectedId ? st.sessions[selectedId]?.need : null;
      return { selectedId, acknowledged: need && selectedId ? { ...st.acknowledged, [selectedId]: need.since } : st.acknowledged };
    }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  resetView: () => set((st) => ({ viewResets: st.viewResets + 1, selectedId: null, cameraMode: "orbit" })),
  setCompact: (compact) => set({ compact }),
  setAudioEnabled: (audioEnabled) => {
    savePref("audio", audioEnabled);
    set({ audioEnabled });
  },
  unlockAudio: () => set({ audioUnlocked: true }),
  setNotificationsEnabled: (notificationsEnabled) => {
    savePref("notifications", notificationsEnabled);
    set({ notificationsEnabled });
  },
  setSessionsCollapsed: (sessionsCollapsed) => {
    savePref("sessionsCollapsed", sessionsCollapsed);
    set({ sessionsCollapsed });
  },
  acknowledge: (sessionId) =>
    set((st) => {
      const need = st.sessions[sessionId]?.need;
      return need ? { acknowledged: { ...st.acknowledged, [sessionId]: need.since } } : st;
    }),
}));

export const serverNow = (): number => Date.now() + useApp.getState().clockOffset;
