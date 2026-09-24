import type { IngestEvent } from "../../shared/src/events.ts";

interface Pending {
  event: IngestEvent;
  arrivedAt: number;
  seq: number;
}

/**
 * Async hooks run as separate processes, so events can arrive out of order (measured: delivery p95 33 ms,
 * Pre→Post as close as 7 ms). Events are held briefly and released sorted by relay spawn time.
 */
export class ReorderBuffer {
  private pending: Pending[] = [];
  private seq = 0;

  constructor(
    private readonly holdMs: number,
    /** Upper bound on holding, for events whose ts is ahead of the server clock. */
    private readonly maxHoldMs: number = holdMs * 4,
  ) {}

  push(event: IngestEvent, arrivedAt: number): void {
    this.pending.push({ event, arrivedAt, seq: this.seq++ });
  }

  drain(now: number): IngestEvent[] {
    const ready: Pending[] = [];
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (p.event.ts <= now - this.holdMs || p.arrivedAt <= now - this.maxHoldMs) ready.push(p);
      else keep.push(p);
    }
    this.pending = keep;
    ready.sort((a, b) => a.event.ts - b.event.ts || a.seq - b.seq);
    return ready.map((p) => p.event);
  }

  get size(): number {
    return this.pending.length;
  }
}
