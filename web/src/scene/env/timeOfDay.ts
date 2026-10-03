// Time-of-day mode: follow the local clock (auto) or hold the lot at a fixed time of day. Pure, unit tested.

export type TimeMode = "auto" | "pagi" | "siang" | "sore" | "malam";

export interface TimePreset {
  mode: Exclude<TimeMode, "auto">;
  label: string;
  /** "HH:MM", the same format as `?time=`. */
  time: string;
}

export const TIME_PRESETS: readonly TimePreset[] = [
  { mode: "pagi", label: "Pagi", time: "07:00" },
  { mode: "siang", label: "Siang", time: "12:00" },
  { mode: "sore", label: "Sore", time: "17:30" },
  { mode: "malam", label: "Malam", time: "21:00" },
];

const MODES: ReadonlySet<string> = new Set(["auto", ...TIME_PRESETS.map((p) => p.mode)]);

export const isTimeMode = (value: unknown): value is TimeMode => typeof value === "string" && MODES.has(value);

/** The fixed scene time of a mode; null for auto (the local clock). */
export const presetTime = (mode: TimeMode): string | null => TIME_PRESETS.find((p) => p.mode === mode)?.time ?? null;

/** The mode an override stands for: "auto" without one, null for a custom time (dev input, `?time=`). */
export function modeOf(override: string | null): TimeMode | null {
  if (override === null) return "auto";
  return TIME_PRESETS.find((p) => p.time === override)?.mode ?? null;
}

const DAY_MS = 24 * 60 * 60_000;
export const TIME_EASE_MS = 1500;

/** Signed shortest way round the clock from one time of day to another, in ms (−12 h … 12 h). */
export function clockDelta(ms: number): number {
  const d = ((ms % DAY_MS) + DAY_MS) % DAY_MS;
  return d > DAY_MS / 2 ? d - DAY_MS : d;
}

/**
 * Eases the scene clock when the time-of-day source changes (auto → Malam, Pagi → Siang …): the sun travels the
 * short way round the clock instead of jumping. The clock running on by itself never starts a transition.
 */
export class SceneTimeEase {
  private source: string | null = null;
  private lag = 0;
  private startedAt = 0;
  private shown = 0;

  /** `target`: the time the scene should show (ms since epoch); `source`: what it comes from; `now`: wall clock. */
  step(target: number, source: string, now: number): number {
    if (this.source !== null && source !== this.source) {
      this.lag = clockDelta(target - this.shown);
      this.startedAt = now;
    }
    this.source = source;
    const k = Math.min(1, Math.max(0, (now - this.startedAt) / TIME_EASE_MS));
    this.shown = target - this.lag * (1 - k * k * (3 - 2 * k));
    return this.shown;
  }
}
