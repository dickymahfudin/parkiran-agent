// Viewer settings beyond the old single toggles (sound, notifications, compact keep their own keys): validated with
// defaults, so a stored value from an older or newer build can never break the page. Pure, unit tested.
import { isClockTime } from "../../../shared/src/sun.ts";
import type { CartMode } from "../scene/art/foodCart.ts";

/** When the food-cart vendor comes by (defined with the cart's schedule). */
export type { CartMode };
/** How hard the scene works for smoothness. Saver, the default, never goes above 20 fps. */
export type PowerMode = "saver" | "balanced" | "smooth";
/** The sounds that can be turned off one by one (the master switch is the toolbar's sound button). */
export type SoundCue = "needsYou" | "turnDone" | "lighter" | "cart";
/** What the people (and Pak Joko) smoke: the usual mix, nobody, or vapes only. */
export type HabitMix = "mixed" | "noSmoking" | "vapeOnly";
/** Over each head: nothing, the project name, or name, branch and state. */
export type NameTags = "off" | "name" | "full";
/** How often the needs-you chime repeats while nobody answers. */
export type ChimeRepeat = "25s" | "60s" | "once";
/** Which events the feed shows when the page opens. */
export type FeedFilter = "all" | "needsYou";

export interface QuietHours {
  on: boolean;
  /** "HH:MM", local time. */
  from: string;
  to: string;
}

export interface Settings {
  power: PowerMode;
  cart: CartMode;
  /** Cars and ojek passing on the street. */
  traffic: boolean;
  nameTags: NameTags;
  habits: HabitMix;
  cues: Record<SoundCue, boolean>;
  /** 0…1, on top of the sound switch. */
  volume: number;
  chimeRepeat: ChimeRepeat;
  /** The chime stays silent in this window; the banner and system notifications still come. */
  quietHours: QuietHours;
  /** Open in the cinematic camera (`?cinematic` forces it too). */
  startCinematic: boolean;
  feedFilter: FeedFilter;
}

export const SETTINGS_KEY = "parkiran:settings";

export const DEFAULT_SETTINGS: Settings = {
  power: "saver",
  cart: "evening",
  traffic: true,
  nameTags: "full",
  habits: "mixed",
  cues: { needsYou: true, turnDone: true, lighter: true, cart: true },
  volume: 1,
  chimeRepeat: "25s",
  quietHours: { on: false, from: "22:00", to: "07:00" },
  startCinematic: false,
  feedFilter: "all",
};

const POWER: readonly PowerMode[] = ["saver", "balanced", "smooth"];
const CART: readonly CartMode[] = ["off", "evening", "allDay"];
const CUES: readonly SoundCue[] = ["needsYou", "turnDone", "lighter", "cart"];
const HABITS: readonly HabitMix[] = ["mixed", "noSmoking", "vapeOnly"];
const TAGS: readonly NameTags[] = ["off", "name", "full"];
const REPEAT: readonly ChimeRepeat[] = ["25s", "60s", "once"];
const FEED: readonly FeedFilter[] = ["all", "needsYou"];

const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => ((values as readonly unknown[]).includes(v) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const record = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clock = (v: unknown, fallback: string): string => (typeof v === "string" && isClockTime(v) ? v : fallback);

/** Name tags were an on/off switch before: true meant the full tag. */
function nameTags(v: unknown): NameTags {
  if (v === true) return "full";
  if (v === false) return "off";
  return oneOf(TAGS, v, DEFAULT_SETTINGS.nameTags);
}

/** Stored JSON → settings. Anything missing, unknown or malformed falls back to its default, field by field. */
export function parseSettings(raw: string | null): Settings {
  let obj: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      obj = record(JSON.parse(raw));
    } catch {
      // Corrupt value: defaults below.
    }
  }
  const cues = record(obj.cues);
  const quiet = record(obj.quietHours);
  const d = DEFAULT_SETTINGS;
  return {
    power: oneOf(POWER, obj.power, d.power),
    cart: oneOf(CART, obj.cart, d.cart),
    traffic: bool(obj.traffic, d.traffic),
    nameTags: nameTags(obj.nameTags),
    habits: oneOf(HABITS, obj.habits, d.habits),
    cues: Object.fromEntries(CUES.map((c) => [c, bool(cues[c], d.cues[c])])) as Record<SoundCue, boolean>,
    volume: typeof obj.volume === "number" && Number.isFinite(obj.volume) ? Math.min(1, Math.max(0, obj.volume)) : d.volume,
    chimeRepeat: oneOf(REPEAT, obj.chimeRepeat, d.chimeRepeat),
    quietHours: { on: bool(quiet.on, d.quietHours.on), from: clock(quiet.from, d.quietHours.from), to: clock(quiet.to, d.quietHours.to) },
    startCinematic: bool(obj.startCinematic, d.startCinematic),
    feedFilter: oneOf(FEED, obj.feedFilter, d.feedFilter),
  };
}

export type SettingsPatch = Partial<Omit<Settings, "cues" | "quietHours">> & { cues?: Partial<Record<SoundCue, boolean>>; quietHours?: Partial<QuietHours> };

/** A change from the settings panel: top-level fields replace, `cues` and `quietHours` merge. */
export function applySettings(current: Settings, patch: SettingsPatch): Settings {
  return { ...current, ...patch, cues: { ...current.cues, ...patch.cues }, quietHours: { ...current.quietHours, ...patch.quietHours } };
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** Whether `date` (local time) falls in the quiet window; a window may run past midnight. Off or empty: never. */
export function inQuietHours(date: Date, q: QuietHours): boolean {
  if (!q.on) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutes(q.from);
  const to = minutes(q.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Milliseconds between chimes for one waiting session; null: once only. */
export function chimeEveryMs(repeat: ChimeRepeat): number | null {
  return repeat === "25s" ? 25_000 : repeat === "60s" ? 60_000 : null;
}
