import { useEffect, useState } from "react";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { requestNotificationPermission } from "../notify/notifier.ts";
import { lookFor } from "../scene/characters/identity.ts";
import { SCENE_PARTS, serverNow, useApp } from "../state/store.ts";
import { Icon, ParkingMark } from "./icons.tsx";
import { MOOD_COLOR, MOOD_NAME, NEED_ICON, cueLine, type StateLabel, formatAge, formatDuration, moodCounts, shortId, stateLabel } from "./labels.ts";

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
  const friends = Object.keys(s.subagents).length;
  const tool = s.currentTool ?? s.lastTool;
  return (
    <button type="button" className={`session-row mood-${label.mood}${selected ? " selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <Avatar s={s} />
      <span className="session-main">
        <span className="project">{s.project ?? "?"}</span>
        {s.branch && <span className="branch">{s.branch}</span>}
      </span>
      <StateChip label={label} />
      <span className="session-meta">
        {tool && <span className="tool">{tool}</span>}
        <span>{s.toolCalls} calls</span>
        {friends > 0 && <span>+{friends} subagent</span>}
        <span>{formatAge(now - s.lastEventAt)}</span>
      </span>
    </button>
  );
}

function Summary({ list, now }: { list: PublicSession[]; now: number }) {
  return (
    <div className="summary" aria-label="Sessions by state">
      {moodCounts(list, now).map(({ mood, count }) => (
        <span key={mood} className={`summary-chip mood-${mood}`}>
          <span className="dot" style={{ background: MOOD_COLOR[mood] }} />
          <b>{count}</b> {MOOD_NAME[mood]}
        </span>
      ))}
    </div>
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
  const rows: [string, string][] = [
    ["Branch", s.branch ?? "–"],
    ["Tool", s.currentTool ? `${s.currentTool} (running)` : (s.lastTool ?? "–")],
    ["Tool calls", String(s.toolCalls)],
    ["Session duration", formatDuration(now - s.startedAt)],
    ["Last event", `${s.lastEvent} · ${formatAge(now - s.lastEventAt)}`],
    ["Subagents", String(Object.keys(s.subagents).length)],
    ["Session ID", shortId(s.id)],
  ];
  return (
    <section className="panel detail-panel" aria-label="Session details">
      <header>
        <Avatar s={s} />
        <div className="detail-heading">
          <h2 className="detail-title">{s.project ?? "?"}</h2>
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
    </section>
  );
}

/** Sessions waiting on the user, front and centre until they are handled; clicking one flies the camera there. */
function Attention({ list, now }: { list: PublicSession[]; now: number }) {
  const acknowledged = useApp((st) => st.acknowledged);
  const select = useApp((st) => st.select);
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
              <b>{s.project ?? "Claude Code"}</b> {NEED_PHRASE[need.kind]}
              {need.toolName && need.kind === "permission" && <span className="attention-tool"> · {need.toolName}</span>}
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

/** The time the lot is lit for (the scene follows the local clock), with a sun or a moon. */
function SceneClock({ override }: { override: string | null }) {
  const d = new Date(serverNow());
  const [h, m] = override ? override.split(":").map(Number) : [d.getHours(), d.getMinutes()];
  const day = h! >= DAY_FROM_H && h! < NIGHT_FROM_H;
  return (
    <span className="scene-clock" title="Scene time (follows your clock)">
      <Icon name={day ? "day" : "night"} />
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
    </span>
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
          <button type="button" aria-pressed={cameraMode === "cinematic"} onClick={() => set.setCameraMode("cinematic")} title="Slow automatic camera">
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
      {!import.meta.env.DEV && !compact && <SceneClock override={timeOverride} />}
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
                <b>{sessions[e.cue.sessionId]?.project ?? shortId(e.cue.sessionId)}</b> {line.text}
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
      <section className="panel sessions-panel" aria-label="Sessions">
        <header>
          <ParkingMark />
          <h1>Parkiran Agent</h1>
          <span className={`connection ${connection}`} title={connectionError ?? undefined}>
            <span className="dot" />
            {CONNECTION_TEXT[connection]}
          </span>
        </header>
        {connectionError && <p className="error">{connectionError}</p>}
        {assetErrors.map((e) => (
          <p key={e} className="error">
            asset failed to load: {e}
          </p>
        ))}
        {list.length === 0 ? (
          <EmptyLot />
        ) : (
          <>
            {!compact && <Summary list={list} now={now} />}
            <div className="session-list">
              {list.map((s) => (
                <SessionRow key={s.id} s={s} now={now} selected={s.id === selectedId} onSelect={() => select(s.id === selectedId ? null : s.id)} />
              ))}
            </div>
          </>
        )}
      </section>
      <Attention list={list} now={now} />
      <Toolbar />
      {selected && !compact && <Detail s={selected} now={now} onClose={() => select(null)} />}
      {!compact && <EventFeed now={now} />}
      <Loader />
    </div>
  );
}
