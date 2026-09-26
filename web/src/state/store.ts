import { create } from "zustand";
import type { ClientConfig, PublicSession, ServerMessage, UsageSnapshot } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface CueEntry {
  cue: Cue;
  at: number;
  seq: number;
}

const MAX_CUE_LOG = 40;

export type CameraMode = "orbit" | "cinematic";

const params = new URLSearchParams(location.search);

/** Per-viewer preferences; storage can be unavailable (private mode), so failures fall back to defaults. */
function pref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`parkiran:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(`parkiran:${key}`, value ? "1" : "0");
  } catch {
    // Not persisted; the toggle still works for this visit.
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
  /** Dev override of the scene clock, "HH:MM" (from ?time= or the HUD). */
  timeOverride: string | null;
  assetErrors: string[];
  cameraMode: CameraMode;
  /** Bumped by "Reset view" (button, R key, double-click on empty ground); the camera rig eases back to the default angle. */
  viewResets: number;
  /** Second-monitor mode: fixed angle, lower resolution, small HUD (?compact). */
  compact: boolean;
  /** User preference; sound only plays once the page has had a click (browser autoplay rule). */
  audioEnabled: boolean;
  audioUnlocked: boolean;
  notificationsEnabled: boolean;
  /** Needs the user has seen (clicked the character): session id → need.since. Stops the repeating sound only. */
  acknowledged: Record<string, number>;
  setConnection(status: ConnectionStatus, error?: string | null): void;
  setTimeOverride(value: string | null): void;
  reportAssetError(message: string): void;
  apply(msg: ServerMessage): void;
  select(id: string | null): void;
  setCameraMode(mode: CameraMode): void;
  resetView(): void;
  setCompact(on: boolean): void;
  setAudioEnabled(on: boolean): void;
  unlockAudio(): void;
  setNotificationsEnabled(on: boolean): void;
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
  timeOverride: params.get("time"),
  assetErrors: [],
  cameraMode: params.has("cinematic") ? "cinematic" : "orbit",
  viewResets: 0,
  compact: params.has("compact"),
  audioEnabled: pref("audio", true),
  audioUnlocked: false,
  notificationsEnabled: pref("notifications", true),
  acknowledged: {},

  setTimeOverride: (timeOverride) => set({ timeOverride }),
  reportAssetError: (message) => set((st) => (st.assetErrors.includes(message) ? st : { assetErrors: [...st.assetErrors, message] })),

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
          };
        case "sessions": {
          const sessions = { ...state.sessions };
          for (const s of msg.updated) sessions[s.id] = s;
          for (const id of msg.removed) delete sessions[id];
          const selectedId = state.selectedId && sessions[state.selectedId] ? state.selectedId : null;
          return { clockOffset, sessions, selectedId };
        }
        case "cues": {
          let seq = state.cueSeq;
          const added = msg.cues.map((cue) => ({ cue, at: msg.serverTime, seq: ++seq }));
          return { clockOffset, cueSeq: seq, cueLog: [...added.reverse(), ...state.cueLog].slice(0, MAX_CUE_LOG) };
        }
        case "usage":
          return { clockOffset, usage: msg.usage };
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
  acknowledge: (sessionId) =>
    set((st) => {
      const need = st.sessions[sessionId]?.need;
      return need ? { acknowledged: { ...st.acknowledged, [sessionId]: need.since } } : st;
    }),
}));

export const serverNow = (): number => Date.now() + useApp.getState().clockOffset;
