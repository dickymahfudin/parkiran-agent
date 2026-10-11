import { create } from "zustand";
import type { ClientConfig, PublicSession, ServerMessage, UsageSnapshot } from "../../../shared/src/protocol.ts";
import type { Cue } from "../../../shared/src/session.ts";
import { isClockTime } from "../../../shared/src/sun.ts";
import { assignTwinNumbers } from "../hud/labels.ts";
import { isTimeMode, presetTime, type TimeMode } from "../scene/env/timeOfDay.ts";
import { SETTINGS_KEY, applySettings, parseSettings, type Settings, type SettingsPatch } from "./settings.ts";
import { keepSelection, nextClockOffset, pruneAcknowledged } from "./sync.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface CueEntry {
  cue: Cue;
  at: number;
  seq: number;
}

const MAX_CUE_LOG = 40;

export type CameraMode = "orbit" | "cinematic";

/** The right-hand inspector's tabs: the event feed, or the selected session. */
export type InspectorTab = "events" | "session";

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

function savedSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseSettings(null);
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; the change still applies for this visit.
  }
}

/** The selected session left (ended, or gone after a reconnect): its tab would only say "click a person", so the
 * inspector goes back to the events, as closing the session does. A tab picked with nothing selected stays. */
function tabAfterSync(state: Pick<AppState, "selectedId" | "inspectorTab">, selectedId: string | null): InspectorTab {
  return state.selectedId !== null && selectedId === null ? "events" : state.inspectorTab;
}

function urlTime(raw: string | null): string | null {
  if (raw === null) return null;
  if (isClockTime(raw)) return raw;
  console.warn(`ignoring ?time=${raw}: expected HH:MM`);
  return null;
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
  /** Viewer settings from the settings panel (battery, food carts, traffic, name tags, single sounds). */
  settings: Settings;
  updateSettings(patch: SettingsPatch): void;
  /** The settings panel is open (not stored). */
  settingsOpen: boolean;
  setSettingsOpen(open: boolean): void;
  /** Rendering light because the window is in the background (set by the frame limiter, not stored). */
  powerSave: boolean;
  setPowerSave(on: boolean): void;
  /** The inspector (event feed and session tabs) folded to its header (per browser). */
  eventsCollapsed: boolean;
  /** The inspector's open tab (not stored): selecting a session opens "session", clearing it goes back to "events". */
  inspectorTab: InspectorTab;
  setInspectorTab(tab: InspectorTab): void;
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
  setEventsCollapsed(on: boolean): void;
  acknowledge(sessionId: string): void;
}

const initialSettings = savedSettings();

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
  // A malformed `?time=` (the toolbar clock showed "NaN:undefined") falls back to the saved mode.
  timeOverride: urlTime(params.get("time")) ?? presetTime(savedTimeMode()),
  assetErrors: [],
  readyParts: [],
  // `?cinematic`, or the "Start in cinematic" setting.
  cameraMode: params.has("cinematic") || initialSettings.startCinematic ? "cinematic" : "orbit",
  viewResets: 0,
  // `?compact` forces it on for that page; otherwise the last choice in this browser.
  compact: params.has("compact") || pref("compact", false),
  audioEnabled: pref("audio", true),
  audioUnlocked: false,
  // On by default: the browser's permission prompt comes with the first click on the page.
  notificationsEnabled: pref("notifications", true),
  sessionsCollapsed: pref("sessionsCollapsed", false),
  eventsCollapsed: pref("eventsCollapsed", false),
  inspectorTab: "events",
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  settings: initialSettings,
  updateSettings: (patch) =>
    set((st) => {
      const settings = applySettings(st.settings, patch);
      saveSettings(settings);
      return { settings };
    }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  powerSave: false,
  setPowerSave: (powerSave) => set({ powerSave }),
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
      // The best offset so far: one late frame must not move "now" backwards (the ages would flicker).
      const clockOffset = nextClockOffset(state.clockOffset, msg.serverTime - Date.now(), msg.type === "hello");
      switch (msg.type) {
        case "hello": {
          // A reconnect or a server restart: whatever the old world had selected or acknowledged may be gone.
          const sessions = Object.fromEntries(msg.sessions.map((s) => [s.id, s]));
          const selectedId = keepSelection(state.selectedId, sessions);
          return {
            clockOffset,
            config: msg.config,
            usage: msg.usage,
            sessions,
            selectedId,
            inspectorTab: tabAfterSync(state, selectedId),
            acknowledged: pruneAcknowledged(state.acknowledged, sessions),
            twins: assignTwinNumbers(state.twins, msg.sessions),
          };
        }
        case "sessions": {
          const sessions = { ...state.sessions };
          for (const s of msg.updated) sessions[s.id] = s;
          for (const id of msg.removed) delete sessions[id];
          const selectedId = keepSelection(state.selectedId, sessions);
          return {
            clockOffset,
            sessions,
            selectedId,
            inspectorTab: tabAfterSync(state, selectedId),
            acknowledged: msg.removed.length > 0 ? pruneAcknowledged(state.acknowledged, sessions) : state.acknowledged,
            twins: assignTwinNumbers(state.twins, Object.values(sessions)),
          };
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
      return {
        selectedId,
        // A row, a character, the attention banner or a notification: whatever selects shows the session.
        inspectorTab: selectedId ? "session" : "events",
        acknowledged: need && selectedId ? { ...st.acknowledged, [selectedId]: need.since } : st.acknowledged,
      };
    }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  resetView: () => set((st) => ({ viewResets: st.viewResets + 1, selectedId: null, inspectorTab: "events", cameraMode: "orbit" })),
  setCompact: (compact) => {
    savePref("compact", compact);
    set({ compact });
  },
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
  setEventsCollapsed: (eventsCollapsed) => {
    savePref("eventsCollapsed", eventsCollapsed);
    set({ eventsCollapsed });
  },
  acknowledge: (sessionId) =>
    set((st) => {
      const need = st.sessions[sessionId]?.need;
      return need ? { acknowledged: { ...st.acknowledged, [sessionId]: need.since } } : st;
    }),
}));

export const serverNow = (): number => Date.now() + useApp.getState().clockOffset;
