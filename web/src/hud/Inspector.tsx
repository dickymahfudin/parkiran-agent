import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import type { PublicSession } from "../../../shared/src/protocol.ts";
import { type InspectorTab, useApp } from "../state/store.ts";
import { Icon } from "./icons.tsx";
import { GROUP_COLOR, TIMELINE_COLOR, TIMELINE_LABEL, formatSpan, timelineSegments, timelineTotals, toolMixRows, waitedTotal } from "./insights.ts";
import {
  type CueLine,
  type FeedGroup,
  feedSubject,
  formatAge,
  formatDuration,
  formatToolName,
  groupFeed,
  sessionName,
  shortId,
  stateLabel,
  unseenAttention,
} from "./labels.ts";
import { Avatar, StateChip } from "./parts.tsx";

type FeedFilter = "all" | "attention";

const TABS: readonly { id: InspectorTab; label: string }[] = [
  { id: "events", label: "Events" },
  { id: "session", label: "Session" },
];
const tabId = (tab: InspectorTab) => `inspector-tab-${tab}`;
const panelId = (tab: InspectorTab) => `inspector-panel-${tab}`;

/**
 * The right-hand column: the event feed and the selected session as two tabs of one panel. Selecting a session (row,
 * character, attention banner, notification) opens the Session tab; closing it goes back to Events (`store.select`).
 *
 * Folds to its header (remembered per browser), like the event feed did. While the events are out of sight (folded,
 * or the Session tab is open) the Events tab counts the "needs you" events that arrived since; the count clears when
 * the events show again. A selected session still opens over a folded inspector, as the detail panel did.
 */
/** Phone width (the same 720 px breakpoint as styles.css): there is no event feed there, only the session sheet. */
export const PHONE_QUERY = "(max-width: 720px)";

function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

export function Inspector({ now, onCloseSession }: { now: number; onCloseSession(): void }) {
  const chosenTab = useApp((st) => st.inspectorTab);
  // On a phone a selected session always shows (its sheet is the only view), whatever tab was left open on a wider screen.
  const phone = usePhoneWidth();
  const selectedForPhone = useApp((st) => (st.selectedId ? !!st.sessions[st.selectedId] : false));
  const tab = phone && selectedForPhone ? "session" : chosenTab;
  const collapsed = useApp((st) => st.eventsCollapsed);
  const sessions = useApp((st) => st.sessions);
  const selectedId = useApp((st) => st.selectedId);
  const cueLog = useApp((st) => st.cueLog);
  const cueSeq = useApp((st) => st.cueSeq);
  const selected = selectedId ? sessions[selectedId] : undefined;
  const tabs = useRef<HTMLDivElement>(null);
  // Starts on the filter chosen in the settings; switching here is for this visit only.
  const [filter, setFilter] = useState<FeedFilter>(() => (useApp.getState().settings.feedFilter === "needsYou" ? "attention" : "all"));

  const peeking = collapsed && tab === "session" && !!selected;
  const open = !collapsed || peeking;
  const eventsShown = open && tab === "events";

  // The newest event when the events went out of sight (or the page loaded with them hidden): only later ones count.
  // Reset during render, not in an effect, so the count never flashes the older events for a frame.
  const [seen, setSeen] = useState({ shown: eventsShown, seq: cueSeq });
  if (seen.shown !== eventsShown) setSeen({ shown: eventsShown, seq: cueSeq });
  const unseen = eventsShown ? 0 : unseenAttention(cueLog, seen.seq, sessions);

  const st = useApp.getState();
  const pick = (next: InspectorTab) => {
    st.setInspectorTab(next);
    // Picking a tab shows it, also on a folded inspector (a selected session shows over the fold by itself).
    if (collapsed && !(next === "session" && selected)) st.setEventsCollapsed(false);
  };
  const toggleFold = () => {
    if (!open) return st.setEventsCollapsed(false);
    // Folding while a session shows goes back to the (folded) events; the selection stays.
    if (tab === "session") st.setInspectorTab("events");
    if (!collapsed) st.setEventsCollapsed(true);
  };
  const onTabKey = (e: ReactKeyboardEvent) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (at - 1 + TABS.length) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    // Home here moves between the tabs; it must not reach the camera's Home (reset view, which clears the selection).
    e.preventDefault();
    e.stopPropagation();
    pick(TABS[to]!.id);
    tabs.current?.querySelector<HTMLElement>(`#${tabId(TABS[to]!.id)}`)?.focus();
  };

  return (
    <section className={`panel inspector${open ? "" : " folded"}${tab === "session" && selected ? " session-open" : ""}`} aria-label="Inspector">
      <header>
        <div className="tabs" role="tablist" aria-label="Inspector" ref={tabs} onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={tab === t.id}
              aria-controls={panelId(t.id)}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => pick(t.id)}
            >
              {t.label}
              {t.id === "events" && unseen > 0 && (
                <span className="feed-unseen" title="Events that need you since the feed was out of sight">
                  {unseen} {unseen === 1 ? "needs you" : "need you"}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button fold"
          aria-expanded={open}
          aria-label={open ? "Fold the inspector" : "Show the inspector"}
          title={open ? "Fold the inspector (the Events tab keeps counting what needs you)" : "Show the inspector"}
          onClick={toggleFold}
        >
          <Icon name={open ? "collapse" : "expandList"} />
        </button>
      </header>
      <div className="inspector-body" role="tabpanel" id={panelId("events")} aria-labelledby={tabId("events")} hidden={!eventsShown}>
        {eventsShown && <EventFeed now={now} filter={filter} onFilter={setFilter} />}
      </div>
      <div className="inspector-body" role="tabpanel" id={panelId("session")} aria-labelledby={tabId("session")} hidden={!(open && tab === "session")}>
        {open && tab === "session" && (selected ? <SessionView s={selected} now={now} onClose={onCloseSession} /> : <SessionEmpty />)}
      </div>
    </section>
  );
}

function SessionEmpty() {
  return <p className="feed-empty inspector-empty">Click a person or a row to see their session.</p>;
}

/** The line's text with its Indonesian part marked for screen readers. */
function CueText({ line }: { line: CueLine }) {
  const i = line.joke ? line.text.indexOf(line.joke) : -1;
  if (!line.joke || i < 0) return <>{line.text}</>;
  return (
    <>
      {line.text.slice(0, i)}
      <span lang="id">{line.joke}</span>
      {line.text.slice(i + line.joke.length)}
    </>
  );
}

/** The event feed, by age, with runs of alike events merged into one counted line (`groupFeed`). */
function EventFeed({ now, filter, onFilter }: { now: number; filter: FeedFilter; onFilter(f: FeedFilter): void }) {
  const cueLog = useApp((st) => st.cueLog);
  const sessions = useApp((st) => st.sessions);
  const twins = useApp((st) => st.twins);
  const sections = groupFeed(cueLog, now, sessions, filter === "attention");
  const nameOf = (id: string) => (sessions[id] ? sessionName(sessions[id], twins) : shortId(id));
  const seenLabels = new Map<string, number>();
  // Lines remount when their minute bucket changes ("2 min ago" → "3 min ago") or a run splits across two buckets.
  // Only news slides in: a line whose newest cue arrived after the last render. Opening the feed animates nothing.
  const newest = cueLog[0]?.seq ?? 0;
  const shownUpTo = useRef(newest);
  const before = shownUpTo.current;
  useEffect(() => {
    shownUpTo.current = Math.max(shownUpTo.current, newest);
  }, [newest]);
  return (
    <>
      <div className="feed-tools">
        <div className="segmented small">
          <button type="button" aria-pressed={filter === "all"} onClick={() => onFilter("all")}>
            All
          </button>
          <button type="button" aria-pressed={filter === "attention"} onClick={() => onFilter("attention")}>
            Needs you
          </button>
        </div>
      </div>
      {sections.length === 0 ? (
        <p className="feed-empty">
          {filter === "all" ? (
            "Events show up here as sessions work."
          ) : (
            <>
              Nothing needs you. <span lang="id">Santai dulu.</span>
            </>
          )}
        </p>
      ) : (
        <div className="feed-list">
          {sections.map((sec) => {
            // Sections come in age order, so a label repeats only if the server clock stepped back; keep keys unique.
            const n = seenLabels.get(sec.label) ?? 0;
            seenLabels.set(sec.label, n + 1);
            return (
              <section key={n ? `${sec.label}#${n}` : sec.label} className="feed-section" aria-label={sec.label}>
                <h3 className="feed-bucket">{sec.label}</h3>
                <ol>
                  {sec.groups.map((g) => (
                    <FeedLine key={g.key} g={g} news={g.key > before} now={now} subject={feedSubject(g, nameOf)} names={g.sessionIds.map(nameOf)} />
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function FeedLine({ g, news, now, subject, names }: { g: FeedGroup; news: boolean; now: number; subject: string; names: string[] }) {
  // Decided once per mount: later renders of the same line keep the class, so its animation is never cut short.
  const [fresh] = useState(news);
  return (
    <li className={`mood-${g.line.mood}${fresh ? " fresh" : ""}`}>
      <span className="cue-icon" aria-hidden="true">
        <Icon name={g.line.icon} />
      </span>
      <span className="cue-text">
        <b title={names.length > 1 ? names.join(", ") : undefined}>{subject}</b> <CueText line={g.line} />
        {g.count > 1 && (
          <span className="cue-count" title={`${g.count} events`}>
            ×{g.count}
          </span>
        )}
      </span>
      <span className="age" aria-hidden="true">
        {formatAge(now - g.at)}
      </span>
    </li>
  );
}

/** The selected session: who and what state, four numbers, its last hour and tool mix, then the small print. */
function SessionView({ s, now, onClose }: { s: PublicSession; now: number; onClose(): void }) {
  const label = stateLabel(s, now);
  const twins = useApp((st) => st.twins);
  const stats: [string, string][] = [
    ["Tool calls", String(s.toolCalls)],
    ["Running for", formatDuration(now - s.startedAt)],
    ["Asked you", `${s.asks}×`],
    ["Waited for you", formatSpan(waitedTotal(s, now))],
  ];
  const facts: [string, string][] = [
    ["Tool", s.currentTool ? `${formatToolName(s.currentTool)} (running)` : s.lastTool ? formatToolName(s.lastTool) : "–"],
    ["Last event", `${s.lastEvent} · ${formatAge(now - s.lastEventAt)}`],
    ["Subagents", String(Object.keys(s.subagents).length)],
    ["Session ID", shortId(s.id)],
  ];
  return (
    <div className="session-view">
      <header className="session-head">
        <Avatar s={s} />
        <div className="detail-heading">
          <h2 className="detail-title">{sessionName(s, twins)}</h2>
          <span className="session-sub">
            {s.branch && <span className="branch">{s.branch}</span>}
            <StateChip label={label} />
          </span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <dl className="stat-grid">
        {stats.map(([k, v]) => (
          <div key={k} className="stat">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Insights s={s} now={now} />
      <dl className="session-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
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
