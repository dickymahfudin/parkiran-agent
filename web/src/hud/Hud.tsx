import { useEffect, useState } from "react";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { requestNotificationPermission } from "../notify/notifier.ts";
import { serverNow, useApp } from "../state/store.ts";
import { MOOD_COLOR, cueText, formatAge, formatDuration, formatRupiah, parkingFee, shortId, stateLabel } from "./labels.ts";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const CONNECTION_TEXT = { connecting: "connecting…", open: "connected", closed: "disconnected" } as const;
const CONNECTION_COLOR = { connecting: "#ffd166", open: "#8fd694", closed: "#ff5c5c" } as const;

function SessionRow({ s, now, selected, onSelect }: { s: PublicSession; now: number; selected: boolean; onSelect(): void }) {
  const label = stateLabel(s, now);
  const friends = Object.keys(s.subagents).length;
  return (
    <button type="button" className={`session-row${selected ? " selected" : ""}`} onClick={onSelect}>
      <span className="chip" style={{ background: MOOD_COLOR[label.mood] }}>
        {label.text}
      </span>
      <span className="session-main">
        <span className="project">{s.project ?? "?"}</span>
        {s.branch && <span className="branch">{s.branch}</span>}
      </span>
      <span className="session-meta">
        {s.currentTool ?? s.lastTool ?? "–"} · {s.toolCalls} tool calls{friends > 0 ? ` · ${friends} subagent` : ""} · {formatAge(now - s.lastEventAt)}
      </span>
    </button>
  );
}

function Detail({ s, now, onClose }: { s: PublicSession; now: number; onClose(): void }) {
  const label = stateLabel(s, now);
  const rows: [string, string][] = [
    ["Branch", s.branch ?? "–"],
    ["Status", label.text],
    ["Tool", s.currentTool ? `${s.currentTool} (running)` : (s.lastTool ?? "–")],
    ["Tool calls", String(s.toolCalls)],
    ["Session duration", formatDuration(now - s.startedAt)],
    ["Last event", `${s.lastEvent} · ${formatAge(now - s.lastEventAt)} ago`],
    ["Subagents", String(Object.keys(s.subagents).length)],
    ["Session ID", shortId(s.id)],
  ];
  return (
    <section className="panel detail-panel" aria-label="Session details">
      <header>
        <span className="dot" style={{ background: MOOD_COLOR[label.mood] }} />
        <h2 className="detail-title">{s.project ?? "?"}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          ×
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
          <button type="button" aria-pressed={cameraMode === "orbit"} onClick={() => set.setCameraMode("orbit")}>
            Orbit
          </button>
          <button type="button" aria-pressed={cameraMode === "cinematic"} onClick={() => set.setCameraMode("cinematic")}>
            Cinematic
          </button>
        </div>
      )}
      {!compact && (
        <button type="button" onClick={() => set.resetView()} title="Back to the default angle (R, or double-click empty ground)">
          Reset view
        </button>
      )}
      <button type="button" aria-pressed={compact} onClick={() => set.setCompact(!compact)} title="Compact mode for a second monitor">
        {compact ? "Full" : "Compact"}
      </button>
      <button type="button" aria-pressed={audioEnabled} onClick={() => set.setAudioEnabled(!audioEnabled)} title={audioUnlocked ? "Sound" : "Sound starts after your first click"}>
        {audioEnabled ? "🔊" : "🔇"}
      </button>
      <button
        type="button"
        aria-pressed={notificationsEnabled}
        disabled={notifyBlocked}
        title={notifyBlocked ? "Notifications are blocked by the browser" : "Notify me when a session needs me"}
        onClick={() => {
          set.setNotificationsEnabled(!notificationsEnabled);
          if (!notificationsEnabled) void requestNotificationPermission();
        }}
      >
        {notificationsEnabled && !notifyBlocked ? "🔔" : "🔕"}
      </button>
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

export function Hud() {
  const now = useNow(1000);
  const connection = useApp((st) => st.connection);
  const connectionError = useApp((st) => st.connectionError);
  const usage = useApp((st) => st.usage);
  const sessions = useApp((st) => st.sessions);
  const cueLog = useApp((st) => st.cueLog);
  const selectedId = useApp((st) => st.selectedId);
  const select = useApp((st) => st.select);
  const assetErrors = useApp((st) => st.assetErrors);
  const compact = useApp((st) => st.compact);
  const list = Object.values(sessions).sort((a, b) => a.startedAt - b.startedAt);
  const fee = parkingFee(list, now);
  const selected = selectedId ? sessions[selectedId] : undefined;

  return (
    <div className="hud">
      <section className="panel sessions-panel">
        <header>
          <h1>Parkiran Agent</h1>
          <span className="connection" title={connectionError ?? undefined}>
            <span className="dot" style={{ background: CONNECTION_COLOR[connection] }} />
            {CONNECTION_TEXT[connection]}
          </span>
        </header>
        {connectionError && <p className="error">{connectionError}</p>}
        {assetErrors.map((e) => (
          <p key={e} className="error">
            asset failed to load: {e}
          </p>
        ))}
        <p
          className="meter"
          title={
            usage?.available
              ? "Claude plan usage, 5-hour window"
              : "Claude Desktop shares no plan usage with local tools (only the CLI status line has it), so the meter charges parking instead: Rp 2.000 for the first hour, Rp 1.000 for every hour after, per session."
          }
        >
          Meter parkir:{" "}
          {usage?.available ? `${Math.round(usage.fiveHour?.usedPercentage ?? 0)}% (5 jam)` : `${formatRupiah(fee.rupiah)} · ${fee.sessions} sessions · ${formatDuration(fee.parkedMs)}`}
        </p>
        {list.length === 0 ? (
          <p className="empty">Parkiran sepi. No Claude Code sessions yet.</p>
        ) : (
          list.map((s) => (
            <SessionRow key={s.id} s={s} now={now} selected={s.id === selectedId} onSelect={() => select(s.id === selectedId ? null : s.id)} />
          ))
        )}
      </section>
      <Toolbar />
      {selected && !compact && <Detail s={selected} now={now} onClose={() => select(null)} />}
      {!compact && (
        <section className="panel cue-panel">
          <h2>Events</h2>
          <ol>
            {cueLog.map((e) => {
              const s = sessions[e.cue.sessionId];
              return (
                <li key={e.seq}>
                  <span className="age">{formatAge(now - e.at)}</span> <b>{s?.project ?? shortId(e.cue.sessionId)}</b> {cueText(e.cue)}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
