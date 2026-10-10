// Stable look per session: the same id always produces the same person; ids differ visibly.

export type ShirtStyle = "tee" | "polo";
export type LegStyle = "shorts" | "trunks" | "pants";
export type HairStyle = "short01" | "short02" | "short04";
export type PrintStyle = "plain" | "stripe" | "chest" | "pocket";
/** Something on the head besides hair, picked per session. */
export type Accessory = "peci" | "glasses";
/** What someone smokes, if anything: kretek (lighter, lit tip, smoke), a vape (thick white clouds), or nothing. */
export type Habit = "kretek" | "vape" | "none";

export interface Look {
  skin: string;
  shirt: ShirtStyle;
  shirtColor: string;
  print: PrintStyle;
  printColor: string;
  legs: LegStyle;
  legsColor: string;
  hair: HairStyle;
  hairColor: string;
  cap: string | null;
  accessory: Accessory | null;
  habit: Habit;
  sandals: string;
  /** Uniform scale around 1 (height variation). */
  scale: number;
  seed: number;
}

export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i]! - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Kaos colours commonly seen at a warung, plus a few loud ones.
const SHIRT_COLORS = ["#1d1f22", "#e9e6df", "#1f2f4f", "#6e1d22", "#4a5a35", "#c8a03a", "#7c8186", "#b8322b", "#2456a6", "#2f6f6a", "#e07a2e", "#5b3a6e"];
const LEG_COLORS: Record<LegStyle, string[]> = {
  shorts: ["#22262c", "#3b4a5c", "#5e5243", "#2e3d2a", "#6b6f75", "#1f3b63"],
  trunks: ["#b7a27f", "#3b4a5c", "#7a3b2e", "#6b6f75", "#2e5d73"],
  pants: ["#2a4a77", "#34557f", "#1e2633", "#3d3f44", "#5a4d3c"],
};
const HAIR_COLORS = ["#121212", "#1b1714", "#241b15", "#2e2219"];
// Dark, faded caps; bright white ones read as a shell on the head at this distance.
const CAP_COLORS = ["#1d1f22", "#8e2a25", "#2456a6", "#4a5a35", "#6b5135"];
const SANDAL_COLORS = ["#1d2a8a", "#1f7a3a", "#202020", "#b8322b", "#e0e0e0"];
// Skin range from light tan to deep sawo matang.
const SKIN_LIGHT = "#e2b48c";
const SKIN_DARK = "#8e5b3c";

/** 70 % smoke kretek, 25 % vape, 5 % do not smoke; separate from the look's own random rolls. */
export function seededHabit(id: string): Habit {
  const roll = hash32(`habit:${id}`) % 100;
  return roll < 70 ? "kretek" : roll < 95 ? "vape" : "none";
}

/** 10 % wear a peci, 30 % glasses, the rest nothing; per session, separate from the look's own random rolls. */
export function accessoryFor(id: string): Accessory | null {
  const roll = hash32(`accessory:${id}`) % 100;
  return roll < 10 ? "peci" : roll < 40 ? "glasses" : null;
}

export function lookFor(id: string): Look {
  const seed = hash32(id);
  const r = rng(seed);
  const shirt: ShirtStyle = r() < 0.25 ? "polo" : "tee";
  const legsRoll = r();
  const legs: LegStyle = legsRoll < 0.45 ? "shorts" : legsRoll < 0.65 ? "trunks" : "pants";
  const shirtColor = pick(r, SHIRT_COLORS);
  let printColor = pick(r, ["#e9e6df", "#c8a03a", "#b8322b", "#1d1f22"]);
  if (printColor === shirtColor) printColor = shirtColor === "#e9e6df" ? "#1d1f22" : "#e9e6df";
  const skin = mix(SKIN_LIGHT, SKIN_DARK, 0.15 + r() * 0.75);
  const print = shirt === "polo" ? "plain" : pick(r, ["plain", "plain", "stripe", "chest", "pocket"] as const);
  const legsColor = pick(r, LEG_COLORS[legs]);
  const hair = pick(r, ["short01", "short02", "short04"] as const);
  const hairColor = pick(r, HAIR_COLORS);
  const accessory = accessoryFor(id);
  // A peci takes the place of a cap.
  const cap = r() < 0.2 && accessory !== "peci" ? pick(r, CAP_COLORS) : null;
  return {
    skin,
    shirt,
    shirtColor,
    print,
    printColor,
    legs,
    legsColor,
    // Fuller hair pokes through a cap; under one, everybody has the cropped cut.
    hair: cap || accessory === "peci" ? "short04" : hair,
    hairColor,
    cap,
    accessory,
    habit: seededHabit(id),
    sandals: pick(r, SANDAL_COLORS),
    scale: 0.96 + r() * 0.08,
    seed,
  };
}
