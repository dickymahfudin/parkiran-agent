import type { IngestEvent } from "../../shared/src/events.ts";
import { toPublicSession, type PublicSession } from "../../shared/src/protocol.ts";
import { reduce, tick } from "../../shared/src/reducer.ts";
import { EMPTY_WORLD, type Cue, type ReducerConfig, type World } from "../../shared/src/session.ts";
import { ReorderBuffer } from "./reorder.ts";

export const REORDER_HOLD_MS = 150;
const MAX_SESSIONS = 64;

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

  constructor(
    private readonly config: ReducerConfig,
    private readonly log: (msg: string) => void = () => undefined,
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
      const r = reduce(world, ev, this.config);
      world = r.world;
      cues.push(...r.cues);
    }
    this.commit(world, cues);
  }

  tick(now: number): void {
    const r = tick(this.world, now, this.config);
    if (r.world !== this.world || r.cues.length > 0) this.commit(r.world, r.cues);
  }

  sessions(): PublicSession[] {
    return Object.values(this.world.sessions).map(toPublicSession);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(world: World, cues: Cue[]): void {
    const before = this.world.sessions;
    const updated = Object.values(world.sessions).filter((s) => before[s.id] !== s);
    const removed = Object.keys(before).filter((id) => !world.sessions[id]);
    this.world = world;
    if (updated.length === 0 && removed.length === 0 && cues.length === 0) return;
    const change: Change = { updated: updated.map(toPublicSession), removed, cues };
    for (const l of this.listeners) l(change);
  }
}
