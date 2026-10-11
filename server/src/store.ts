import type { IngestEvent } from "../../shared/src/events.ts";
import { toPublicSession, type PublicSession } from "../../shared/src/protocol.ts";
import { reduce, tick } from "../../shared/src/reducer.ts";
import { EMPTY_WORLD, type Cue, type ReducerConfig, type World } from "../../shared/src/session.ts";
import { ReorderBuffer } from "./reorder.ts";

export const REORDER_HOLD_MS = 150;
const MAX_SESSIONS = 64;
/** The same failure is logged at most this often: a tick that keeps failing runs every second. */
const REPEAT_LOG_MS = 60_000;

/** The pure state machine; replaceable in tests to make it fail. */
export interface Reducer {
  reduce: typeof reduce;
  tick: typeof tick;
}

export interface Change {
  updated: PublicSession[];
  removed: string[];
  cues: Cue[];
}

type Listener = (change: Change) => void;

/** Server-side source of truth: buffers ingest, runs the pure reducer, reports what changed. */
export class SessionStore {
  private world: World = EMPTY_WORLD;
  private readonly buffer = new ReorderBuffer(REORDER_HOLD_MS);
  private readonly listeners = new Set<Listener>();
  private lastFailure: { msg: string; at: number } | null = null;

  constructor(
    private readonly config: ReducerConfig,
    private readonly log: (msg: string) => void = () => undefined,
    private readonly reducer: Reducer = { reduce, tick },
  ) {}

  ingest(event: IngestEvent, arrivedAt: number): void {
    this.buffer.push(event, arrivedAt);
  }

  /** Applies buffered events that are old enough. */
  flush(now: number): void {
    const events = this.buffer.drain(now);
    if (events.length === 0) return;
    let world = this.world;
    const cues: Cue[] = [];
    for (const ev of events) {
      if (!world.sessions[ev.sessionId] && Object.keys(world.sessions).length >= MAX_SESSIONS) {
        this.log(`dropping ${ev.event} for new session ${ev.sessionId.slice(0, 8)}: ${MAX_SESSIONS} sessions already tracked`);
        continue;
      }
      try {
        const r = this.reducer.reduce(world, ev, this.config);
        world = r.world;
        cues.push(...r.cues);
      } catch (err) {
        // One event the reducer cannot take costs that event, not the server and every session with it.
        this.failed(`dropping ${ev.event} for ${ev.sessionId.slice(0, 8)}: the reducer threw`, err, now);
      }
    }
    this.commit(world, cues, now);
  }

  tick(now: number): void {
    let r: ReturnType<Reducer["tick"]>;
    try {
      r = this.reducer.tick(this.world, now, this.config);
    } catch (err) {
      // The world stays as it was; the next tick tries again.
      this.failed("tick failed", err, now);
      return;
    }
    if (r.world !== this.world || r.cues.length > 0) this.commit(r.world, r.cues, now);
  }

  sessions(): PublicSession[] {
    return Object.values(this.world.sessions).map(toPublicSession);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(world: World, cues: Cue[], now: number): void {
    const before = this.world.sessions;
    const updated = Object.values(world.sessions).filter((s) => before[s.id] !== s);
    const removed = Object.keys(before).filter((id) => !world.sessions[id]);
    this.world = world;
    if (updated.length === 0 && removed.length === 0 && cues.length === 0) return;
    const change: Change = { updated: updated.map(toPublicSession), removed, cues };
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (err) {
        // A broken subscriber (the WebSocket publish, the cue log) must not stop the others or the server.
        this.failed("a change listener threw", err, now);
      }
    }
  }

  /** Logs a failure with its stack; the same failure (same message) again within a minute stays quiet. */
  private failed(what: string, err: unknown, now: number): void {
    const msg = `${what}: ${err instanceof Error ? err.message : String(err)}`;
    if (this.lastFailure?.msg === msg && now - this.lastFailure.at < REPEAT_LOG_MS) return;
    this.lastFailure = { msg, at: now };
    this.log(err instanceof Error && err.stack ? `${msg}\n${err.stack}` : msg);
  }
}
