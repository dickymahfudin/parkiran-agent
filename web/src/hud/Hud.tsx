import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { TIME_PRESETS, modeOf, type TimeMode } from "../scene/env/timeOfDay.ts";
import { SCENE_PARTS, serverNow, useApp } from "../state/store.ts";
import { Icon, ParkingMark } from "./icons.tsx";
import { Inspector, PHONE_QUERY } from "./Inspector.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ShortcutsSheet } from "./ShortcutsSheet.tsx";
import {
  DENSE_FROM,
  MOOD_COLOR,
  MOOD_NAME,
  NEED_ICON,
  type IconName,
  formatAge,
  formatToolName,
  moodCounts,
  orderSessions,
  sessionName,
  stateLabel,
  type Mood,
} from "./labels.ts";
import { Avatar, StateChip } from "./parts.tsx";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    // Nobody reads the clock of a hidden page; it catches up within a tick of coming back.
    const id = setInterval(() => !document.hidden && setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const CONNECTION_TEXT = { connecting: "connecting…", open: "live", closed: "offline" } as const;
const NEED_PHRASE = { permission: "needs permission", question: "has a question", input: "needs input" } as const;
const MAX_ATTENTION = 3;

function SessionRow({ s, now, selected, onSelect }: { s: PublicSession; now: number; selected: boolean; onSelect(): void }) {
  const label = stateLabel(s, now);
  const twins = useApp((st) => st.twins);
  const friends = Object.keys(s.subagents).length;
  const tool = s.currentTool ?? s.lastTool;
  return (
    <button
      type="button"
      className={`session-row mood-${label.mood}${selected ? " selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      data-session={s.id}
    >
      <Avatar s={s} />
      <span className="session-main">
        <span className="project">{sessionName(s, twins)}</span>
        {s.branch && <span className="branch">{s.branch}</span>}
      </span>
      <StateChip label={label} />
      <span className="session-meta">
        {tool && (
          <span className="tool" title={tool}>
            {formatToolName(tool)}
          </span>
        )}
        <span>{s.toolCalls} calls</span>
        {friends > 0 && <span>+{friends} subagent</span>}
        <span>{formatAge(now - s.lastEventAt)}</span>
      </span>
      <span className="row-age">{formatAge(now - s.lastEventAt)}</span>
    </button>
  );
}

/** Counts per state; each chip also filters the list to that state (click again for all). */
function Summary({ list, now, filter, onFilter }: { list: PublicSession[]; now: number; filter: Mood | null; onFilter(mood: Mood | null): void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> would bring its own box and legend styling
    <div className="summary" role="group" aria-label="Sessions by state (click to filter)">
      {moodCounts(list, now).map(({ mood, count }) => (
        <button
          key={mood}
          type="button"
          className={`summary-chip mood-${mood}`}
          aria-pressed={filter === mood}
          onClick={() => onFilter(filter === mood ? null : mood)}
          title={filter === mood ? "Show all sessions" : `Show only ${MOOD_NAME[mood]}`}
        >
          <span className="dot" style={{ background: MOOD_COLOR[mood] }} />
          <b>{count}</b> {MOOD_NAME[mood]}
        </button>
      ))}
    </div>
  );
}

/**
 * The session list: needs you first, one line per session once there are many, scrolling inside a panel of capped
 * height, filterable by state and foldable down to its summary.
 */
function SessionList({ list, now, compact }: { list: PublicSession[]; now: number; compact: boolean }) {
  const selectedId = useApp((st) => st.selectedId);
  const select = useApp((st) => st.select);
  const collapsed = useApp((st) => st.sessionsCollapsed);
  const [filter, setFilter] = useState<Mood | null>(null);
  const ordered = orderSessions(list);
  const shown = filter ? ordered.filter((s) => stateLabel(s, now).mood === filter) : ordered;
  // A filter whose state has emptied lets go by itself.
  useEffect(() => {
    if (filter && !list.some((s) => stateLabel(s, now).mood === filter)) setFilter(null);
  }, [filter, list, now]);
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-session="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  // A second click on the selected row closes its session, but only while the session shows: from the Events tab it
  // brings the session back up instead (a phone always shows it).
  const toggle = (id: string) => {
    const showing = useApp.getState().inspectorTab === "session" || matchMedia(PHONE_QUERY).matches;
    select(id === selectedId && showing ? null : id);
  };
  return (
    <>
      {!compact && <Summary list={list} now={now} filter={filter} onFilter={setFilter} />}
      {!collapsed && (
        <div className="session-list">
          {shown.map((s) => (
            <SessionRow key={s.id} s={s} now={now} selected={s.id === selectedId} onSelect={() => toggle(s.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function EmptyLot() {
  return (
    <div className="empty">
      <p className="empty-title" lang="id">
        Parkiran sepi.
      </p>
      <p>Start a Claude Code session and someone pulls in with a laptop.</p>
      <p className="empty-hint">
        Nothing showing up? Run <code>bun run install-hooks</code> once.
      </p>
    </div>
  );
}

/** Sessions waiting on the user, front and centre until they are handled; clicking one flies the camera there. */
function Attention({ list, now }: { list: PublicSession[]; now: number }) {
  const acknowledged = useApp((st) => st.acknowledged);
  const select = useApp((st) => st.select);
  const twins = useApp((st) => st.twins);
  const waiting = list.filter((s) => s.need).sort((a, b) => a.need!.since - b.need!.since);
  if (waiting.length === 0) return null;
  // Not a live region: the ages below change every second. NeedAnnouncer speaks each new need once.
  return (
    <div className="attention">
      {waiting.slice(0, MAX_ATTENTION).map((s) => {
        const need = s.need!;
        const seen = acknowledged[s.id] === need.since;
        return (
          <button key={s.id} type="button" className={`attention-item${seen ? " seen" : ""}`} onClick={() => select(s.id)} title="Show in the lot">
            <span className="attention-icon">
              <Icon name={NEED_ICON[need.kind]} />
            </span>
            <span>
              <b>{s.project ? sessionName(s, twins) : "Claude Code"}</b> {NEED_PHRASE[need.kind]}
              {need.toolName && need.kind === "permission" && <span className="attention-tool"> · {formatToolName(need.toolName)}</span>}
            </span>
            <span className="attention-age" aria-hidden="true">
              {formatAge(now - need.since)}
            </span>
          </button>
        );
      })}
      {waiting.length > MAX_ATTENTION && <span className="attention-more">+{waiting.length - MAX_ATTENTION} more</span>}
    </div>
  );
}

/** One sentence per new need, for screen readers; nothing else in the HUD is live (ages tick every second). */
function NeedAnnouncer({ list }: { list: PublicSession[] }) {
  const twins = useApp((st) => st.twins);
  const latest = list.filter((s) => s.need).sort((a, b) => b.need!.since - a.need!.since)[0];
  const key = latest ? `${latest.id}:${latest.need!.since}` : "";
  const [said, setSaid] = useState({ key: "", text: "" });
  useEffect(() => {
    if (key && key !== said.key && latest)
      setSaid({ key, text: `${latest.project ? sessionName(latest, twins) : "Claude Code"} ${NEED_PHRASE[latest.need!.kind]}` });
  }, [key, said.key, latest, twins]);
  return (
    <output className="sr-only" aria-live="polite">
      {said.text}
    </output>
  );
}

const DAY_FROM_H = 6;
const NIGHT_FROM_H = 18;
const MODE_ICON: Record<TimeMode, IconName> = { auto: "auto", pagi: "morning", siang: "day", sore: "evening", malam: "night" };
const TIME_OPTIONS: readonly { mode: TimeMode; label: string; hint: string }[] = [
  { mode: "auto", label: "Auto", hint: "follows your clock" },
  ...TIME_PRESETS.map((p) => ({ mode: p.mode, label: p.label, hint: p.time })),
];

/**
 * The time the lot is lit for, and the time-of-day menu: Auto follows the local clock, Pagi / Siang / Sore / Malam hold
 * the lot at that time. The choice is remembered in this browser.
 */
function TimeControl({ override }: { override: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mode = modeOf(override);
  const d = new Date(serverNow());
  const [h, m] = override ? override.split(":").map(Number) : [d.getHours(), d.getMinutes()];
  const day = h! >= DAY_FROM_H && h! < NIGHT_FROM_H;
  const current = TIME_OPTIONS.find((o) => o.mode === mode);
  useEffect(() => {
    if (!open) return;
    // Focus goes into the menu (on the current choice) and comes back to the clock when it closes.
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    clock.current?.focus();
  };
  const pick = (next: TimeMode) => {
    useApp.getState().setTimeMode(next);
    close();
  };
  const moveFocus = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : items.length - 1;
    e.preventDefault();
    items[to]?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only delegate keyboard navigation to the menu buttons inside
    <div
      className="time-control"
      ref={root}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") moveFocus(e);
      }}
      onBlur={(e) => {
        // Tabbing away closes the menu; focus is already elsewhere, so it stays there.
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={clock}
        className="scene-clock"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={mode === "auto" ? "Scene time follows your clock. Click for Pagi, Siang, Sore or Malam" : "Scene time is fixed. Click to change"}
      >
        <Icon name={mode && mode !== "auto" ? MODE_ICON[mode] : day ? "day" : "night"} />
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
        <span className="time-mode">{current?.label ?? "Custom"}</span>
      </button>
      {open && (
        <div className="time-menu panel" role="menu" aria-label="Time of day" ref={menu}>
          {TIME_OPTIONS.map((o) => (
            <button key={o.mode} type="button" role="menuitemradio" aria-checked={mode === o.mode} onClick={() => pick(o.mode)}>
              <Icon name={MODE_ICON[o.mode]} />
              <span className="time-option">{o.label}</span>
              <span className="time-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The view toolbar, in three groups: the camera [Orbit | Cinematic][Reset] · the scene clock · [Sound][Settings].
 * Compact mode keeps the last group only.
 */
function Toolbar() {
  const cameraMode = useApp((st) => st.cameraMode);
  const compact = useApp((st) => st.compact);
  const audioEnabled = useApp((st) => st.audioEnabled);
  const audioUnlocked = useApp((st) => st.audioUnlocked);
  const timeOverride = useApp((st) => st.timeOverride);
  const settingsOpen = useApp((st) => st.settingsOpen);
  const set = useApp.getState();
  return (
    <div className="panel toolbar" role="toolbar" aria-label="View">
      {!compact && (
        <>
          <div className="toolbar-group">
            <div className="segmented">
              <button type="button" aria-pressed={cameraMode === "orbit"} onClick={() => set.setCameraMode("orbit")} title="Drag to orbit, scroll to zoom">
                Orbit
              </button>
              <button
                type="button"
                aria-pressed={cameraMode === "cinematic"}
                onClick={() => set.setCameraMode("cinematic")}
                title="Director: the camera goes where things happen"
              >
                Cinematic
              </button>
            </div>
            <button
              type="button"
              className="tool-icon"
              onClick={() => set.resetView()}
              title="Reset view (R, or double-click the ground)"
              aria-label="Reset view"
            >
              <Icon name="reset" />
            </button>
          </div>
          <span className="toolbar-sep" aria-hidden="true" />
          <TimeControl override={timeOverride} />
          <span className="toolbar-sep" aria-hidden="true" />
        </>
      )}
      <div className="toolbar-group">
        <button
          type="button"
          className="tool-icon"
          aria-pressed={audioEnabled}
          onClick={() => set.setAudioEnabled(!audioEnabled)}
          title={audioUnlocked ? (audioEnabled ? "Sound on" : "Sound off") : "Sound starts after your first click"}
          aria-label="Sound"
        >
          <Icon name={audioEnabled ? "soundOn" : "soundOff"} />
        </button>
        <button
          type="button"
          className="tool-icon settings-button"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-pressed={settingsOpen}
          onClick={() => set.setSettingsOpen(!settingsOpen)}
          title="Settings (,). Press ? for all shortcuts"
          aria-label="Settings"
        >
          <Icon name="settings" />
        </button>
      </div>
    </div>
  );
}

/** Never keep the scene hidden behind the loader for longer than this, whatever is still loading. */
const LOADING_MAX_MS = 30_000;

/** Covers the scene while models and textures stream in, instead of a lot that pops together piece by piece. */
function Loader() {
  const ready = useApp((st) => st.readyParts.length);
  const [timedOut, setTimedOut] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), LOADING_MAX_MS);
    return () => clearTimeout(id);
  }, []);
  const done = timedOut || ready >= SCENE_PARTS.length;
  useEffect(() => {
    // With `prefers-reduced-motion` the fade is off and `transitionend` never fires: lift the cover on a timer too.
    if (!done) return;
    const id = setTimeout(() => setGone(true), 1200);
    return () => clearTimeout(id);
  }, [done]);
  if (gone) return null;
  const progress = (ready / SCENE_PARTS.length) * 100;
  return (
    <div className={`loader${done ? " done" : ""}`} onTransitionEnd={(e) => done && e.target === e.currentTarget && setGone(true)}>
      <ParkingMark />
      <p className="loader-title">Parkiran Agent</p>
      <p className="loader-sub" lang="id">
        Ke kantor cabang…
      </p>
      <div className="loader-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Loading the scene">
        <span style={{ width: `${Math.max(6, progress)}%` }} />
      </div>
    </div>
  );
}

export function Hud() {
  const now = useNow(1000);
  const connection = useApp((st) => st.connection);
  const connectionError = useApp((st) => st.connectionError);
  const sessions = useApp((st) => st.sessions);
  const select = useApp((st) => st.select);
  const assetErrors = useApp((st) => st.assetErrors);
  const compact = useApp((st) => st.compact);
  const collapsed = useApp((st) => st.sessionsCollapsed);
  const list = Object.values(sessions).sort((a, b) => a.startedAt - b.startedAt);

  // Closing the session (its close button, Esc) clears the selection, which takes the inspector back to Events, and
  // sends the focus back to the session's row, so keyboard users do not land on <body>.
  const closeDetail = useCallback(() => {
    const id = useApp.getState().selectedId;
    select(null);
    if (id) document.querySelector<HTMLElement>(`[data-session="${CSS.escape(id)}"]`)?.focus();
  }, [select]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useApp.getState().selectedId) closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetail]);

  return (
    <div className="hud">
      <section className={`panel sessions-panel${list.length >= DENSE_FROM ? " dense" : ""}${collapsed ? " collapsed" : ""}`} aria-label="Sessions">
        <header>
          <ParkingMark />
          <h1>Parkiran Agent</h1>
          <span className={`connection ${connection}`} title={connectionError ?? undefined}>
            <span className="dot" />
            {CONNECTION_TEXT[connection]}
          </span>
          {list.length > 0 && (
            <button
              type="button"
              className="icon-button fold"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show the session list" : "Fold the session list"}
              title={collapsed ? "Show the session list" : "Fold the session list (the summary stays)"}
              onClick={() => useApp.getState().setSessionsCollapsed(!collapsed)}
            >
              <Icon name={collapsed ? "expandList" : "collapse"} />
            </button>
          )}
        </header>
        {connectionError && <p className="error">{connectionError}</p>}
        {assetErrors.map((e) => (
          <p key={e} className="error">
            asset failed to load: {e}
          </p>
        ))}
        {list.length === 0 ? <EmptyLot /> : <SessionList list={list} now={now} compact={compact} />}
      </section>
      <Attention list={list} now={now} />
      <NeedAnnouncer list={list} />
      <Toolbar />
      {/* Before the settings: the settings popover opens over the inspector's top. */}
      {!compact && <Inspector now={now} onCloseSession={closeDetail} />}
      <SettingsPanel />
      <ShortcutsSheet />
      <Loader />
    </div>
  );
}
