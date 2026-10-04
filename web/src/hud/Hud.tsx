import { useEffect, useRef, useState } from "react";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { requestNotificationPermission } from "../notify/notifier.ts";
import { lookFor } from "../scene/characters/identity.ts";
import { TIME_PRESETS, modeOf, type TimeMode } from "../scene/env/timeOfDay.ts";
import { SCENE_PARTS, serverNow, useApp } from "../state/store.ts";
import { Icon, ParkingMark } from "./icons.tsx";
import { GROUP_COLOR, TIMELINE_COLOR, TIMELINE_LABEL, formatSpan, timelineSegments, timelineTotals, toolMixRows, waitedTotal } from "./insights.ts";
import {
  DENSE_FROM,
  MOOD_COLOR,
  MOOD_NAME,
  NEED_ICON,
  cueLine,
  type IconName,
  type StateLabel,
  formatAge,
  formatDuration,
  formatToolName,
  moodCounts,
  orderSessions,
  sessionName,
  shortId,
  stateLabel,
  type Mood,
} from "./labels.ts";

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

/** Dark or light text, whichever reads on `hex`. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 0.6 ? "#14161b" : "#f4f6f8";
}

/** The character's shirt colour with the project's initial, so a row is easy to match to a person in the lot. */
function Avatar({ s }: { s: PublicSession }) {
  const shirt = lookFor(s.id).shirtColor;
  return (
    <span className="avatar" style={{ background: shirt, color: inkOn(shirt) }} aria-hidden="true">
      {(s.project ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A session's state as a coloured chip, with its icon when the state has one. */
function StateChip({ label }: { label: StateLabel }) {
  return (
    <span className="chip" style={{ background: MOOD_COLOR[label.mood] }}>
      {label.icon && <Icon name={label.icon} />}
      {label.text}
    </span>
  );
}

function SessionRow({ s, now, selected, onSelect }: { s: PublicSession; now: number; selected: boolean; onSelect(): void }) {
  const label = stateLabel(s, now);
  const twins = useApp((st) => st.twins);
  const friends = Object.keys(s.subagents).length;
  const tool = s.currentTool ?? s.lastTool;
  return (
    <button type="button" className={`session-row mood-${label.mood}${selected ? " selected" : ""}`} onClick={onSelect} aria-pressed={selected} data-session={s.id}>
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
  return (
    <>
      {!compact && <Summary list={list} now={now} filter={filter} onFilter={setFilter} />}
      {!collapsed && (
        <div className="session-list">
          {shown.map((s) => (
            <SessionRow key={s.id} s={s} now={now} selected={s.id === selectedId} onSelect={() => select(s.id === selectedId ? null : s.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function EmptyLot() {
  return (
    <div className="empty">
      <p className="empty-title">Parkiran sepi.</p>
      <p>Start a Claude Code session and someone pulls in with a laptop.</p>
      <p className="empty-hint">
        Nothing showing up? Run <code>bun run install-hooks</code> once.
      </p>
    </div>
  );
}

function Detail({ s, now, onClose }: { s: PublicSession; now: number; onClose(): void }) {
  const label = stateLabel(s, now);
  const twins = useApp((st) => st.twins);
  const rows: [string, string][] = [
    ["Branch", s.branch ?? "–"],
    ["Tool", s.currentTool ? `${formatToolName(s.currentTool)} (running)` : s.lastTool ? formatToolName(s.lastTool) : "–"],
    ["Tool calls", String(s.toolCalls)],
    ["Session duration", formatDuration(now - s.startedAt)],
    ["Last event", `${s.lastEvent} · ${formatAge(now - s.lastEventAt)}`],
    ["Subagents", String(Object.keys(s.subagents).length)],
    ["Asked you", `${s.asks}×`],
    ["Waited for you", formatSpan(waitedTotal(s, now))],
    ["Session ID", shortId(s.id)],
  ];
  return (
    <section className="panel detail-panel" aria-label="Session details">
      <header>
        <Avatar s={s} />
        <div className="detail-heading">
          <h2 className="detail-title">{sessionName(s, twins)}</h2>
          <StateChip label={label} />
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="detail-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Insights s={s} now={now} />
    </section>
  );
}

/** The session's last hour as a strip, and its tool mix. Colours always come with a label. */
function Insights({ s, now }: { s: PublicSession; now: number }) {
  const segments = timelineSegments(s.timeline, now);
  const totals = timelineTotals(segments);
  const mix = toolMixRows(s.toolMix);
  return (
    <div className="insights">
      <h3>Last hour</h3>
      <div className="timeline" role="img" aria-label={totals.map((t) => `${TIMELINE_LABEL[t.state]} ${formatSpan(t.ms)}`).join(", ") || "No activity yet"}>
        {segments.map((g) => (
          <span
            key={g.start}
            style={{ left: `${g.start * 100}%`, width: `${g.width * 100}%`, background: TIMELINE_COLOR[g.state] }}
            title={`${TIMELINE_LABEL[g.state]} · ${formatSpan(g.ms)}`}
          />
        ))}
      </div>
      <div className="timeline-axis" aria-hidden="true">
        <span>1 h ago</span>
        <span>now</span>
      </div>
      <ul className="legend">
        {totals.map((t) => (
          <li key={t.state}>
            <i style={{ background: TIMELINE_COLOR[t.state] }} />
            {TIMELINE_LABEL[t.state]} <b>{formatSpan(t.ms)}</b>
          </li>
        ))}
      </ul>
      {mix.length > 0 && (
        <>
          <h3>Tool mix</h3>
          <div className="mix-bar" aria-hidden="true">
            {mix.map((r) => (
              <span key={r.group} style={{ flexGrow: r.count, background: GROUP_COLOR[r.group] }} />
            ))}
          </div>
          <ul className="legend">
            {mix.map((r) => (
              <li key={r.group}>
                <i style={{ background: GROUP_COLOR[r.group] }} />
                {r.label} <b>{r.count}</b>
              </li>
            ))}
          </ul>
        </>
      )}
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
  return (
    <div className="attention" role="status" aria-live="polite">
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
            <span className="attention-age">{formatAge(now - need.since)}</span>
          </button>
        );
      })}
      {waiting.length > MAX_ATTENTION && <span className="attention-more">+{waiting.length - MAX_ATTENTION} more</span>}
    </div>
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
  const mode = modeOf(override);
  const d = new Date(serverNow());
  const [h, m] = override ? override.split(":").map(Number) : [d.getHours(), d.getMinutes()];
  const day = h! >= DAY_FROM_H && h! < NIGHT_FROM_H;
  const current = TIME_OPTIONS.find((o) => o.mode === mode);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (next: TimeMode) => {
    useApp.getState().setTimeMode(next);
    setOpen(false);
  };
  return (
    <div
      className="time-control"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
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
        <div className="time-menu panel" role="menu" aria-label="Time of day">
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

function Toolbar() {
  const cameraMode = useApp((st) => st.cameraMode);
  const compact = useApp((st) => st.compact);
  const audioEnabled = useApp((st) => st.audioEnabled);
  const audioUnlocked = useApp((st) => st.audioUnlocked);
  const notificationsEnabled = useApp((st) => st.notificationsEnabled);
  const timeOverride = useApp((st) => st.timeOverride);
  const set = useApp.getState();
  const notifyBlocked = typeof Notification !== "undefined" && Notification.permission === "denied";
  return (
    <div className="panel toolbar" role="toolbar" aria-label="View">
      {!compact && (
        <div className="segmented">
          <button type="button" aria-pressed={cameraMode === "orbit"} onClick={() => set.setCameraMode("orbit")} title="Drag to orbit, scroll to zoom">
            Orbit
          </button>
          <button type="button" aria-pressed={cameraMode === "cinematic"} onClick={() => set.setCameraMode("cinematic")} title="Director: the camera goes where things happen">
            Cinematic
          </button>
        </div>
      )}
      {!compact && (
        <button type="button" className="tool-icon" onClick={() => set.resetView()} title="Reset view (R, or double-click the ground)" aria-label="Reset view">
          <Icon name="reset" />
        </button>
      )}
      <button
        type="button"
        className="tool-icon"
        aria-pressed={compact}
        onClick={() => set.setCompact(!compact)}
        title={compact ? "Full view" : "Compact mode for a second monitor"}
        aria-label="Compact mode"
      >
        <Icon name={compact ? "expand" : "compact"} />
      </button>
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
        className="tool-icon"
        aria-pressed={notificationsEnabled && !notifyBlocked}
        disabled={notifyBlocked}
        title={notifyBlocked ? "Notifications are blocked by the browser" : "Notify me when a session needs me"}
        aria-label="Notifications"
        onClick={() => {
          set.setNotificationsEnabled(!notificationsEnabled);
          if (!notificationsEnabled) void requestNotificationPermission();
        }}
      >
        <Icon name={notificationsEnabled && !notifyBlocked ? "bellOn" : "bellOff"} />
      </button>
      {!compact && <TimeControl override={timeOverride} />}
      {import.meta.env.DEV && !compact && (
        <label className="time-override" title="Scene time override (dev)">
          <input type="time" value={timeOverride ?? ""} onChange={(e) => set.setTimeOverride(e.target.value || null)} />
          {timeOverride && (
            <button type="button" onClick={() => set.setTimeOverride(null)}>
              live
            </button>
          )}
        </label>
      )}
    </div>
  );
}

type FeedFilter = "all" | "attention";
const ATTENTION_MOODS = new Set(["needs", "trouble"]);

function EventFeed({ now }: { now: number }) {
  const cueLog = useApp((st) => st.cueLog);
  const sessions = useApp((st) => st.sessions);
  const twins = useApp((st) => st.twins);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const lines = cueLog
    .map((e) => ({ e, line: cueLine(e.cue, sessions[e.cue.sessionId]) }))
    .filter(({ line }) => filter === "all" || ATTENTION_MOODS.has(line.mood));
  return (
    <section className="panel cue-panel" aria-label="Events">
      <header>
        <h2>Events</h2>
        <div className="segmented small">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          <button type="button" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
            Needs you
          </button>
        </div>
      </header>
      {lines.length === 0 ? (
        <p className="feed-empty">{filter === "all" ? "Events show up here as sessions work." : "Nothing needs you. Santai dulu."}</p>
      ) : (
        <ol aria-live="polite">
          {lines.map(({ e, line }) => (
            <li key={e.seq} className={`mood-${line.mood}`}>
              <span className="cue-icon" aria-hidden="true">
                <Icon name={line.icon} />
              </span>
              <span className="cue-text">
                <b>{sessions[e.cue.sessionId] ? sessionName(sessions[e.cue.sessionId]!, twins) : shortId(e.cue.sessionId)}</b> {line.text}
              </span>
              <span className="age">{formatAge(now - e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
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
  if (gone) return null;
  const done = timedOut || ready >= SCENE_PARTS.length;
  const progress = (ready / SCENE_PARTS.length) * 100;
  return (
    <div className={`loader${done ? " done" : ""}`} onTransitionEnd={(e) => done && e.target === e.currentTarget && setGone(true)}>
      <ParkingMark />
      <p className="loader-title">Parkiran Agent</p>
      <p className="loader-sub">Ke kantor cabang…</p>
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
  const selectedId = useApp((st) => st.selectedId);
  const select = useApp((st) => st.select);
  const assetErrors = useApp((st) => st.assetErrors);
  const compact = useApp((st) => st.compact);
  const collapsed = useApp((st) => st.sessionsCollapsed);
  const list = Object.values(sessions).sort((a, b) => a.startedAt - b.startedAt);
  const selected = selectedId ? sessions[selectedId] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useApp.getState().selectedId) select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

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
      <Toolbar />
      {selected && !compact && <Detail s={selected} now={now} onClose={() => select(null)} />}
      {!compact && <EventFeed now={now} />}
      <Loader />
    </div>
  );
}
