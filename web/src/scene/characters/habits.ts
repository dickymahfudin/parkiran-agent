// The viewer's habits setting on top of everyone's seeded habit (identity.ts). Pure, unit tested.
import type { HabitMix } from "../../state/settings.ts";
import { Brain, type Home, type Target } from "./brain.ts";
import type { Habit } from "./identity.ts";

/** What someone smokes under the setting: their own habit in the usual mix, nothing, or a vape. */
export function habitFor(seeded: Habit, mix: HabitMix): Habit {
  if (mix === "noSmoking") return "none";
  if (mix === "vapeOnly") return "vape";
  return seeded;
}

export interface CastMember {
  key: string;
  /** The habit the person was given (`lookFor`), before the setting. */
  seeded: Habit;
  /** The habit the person's brain was built with. */
  habit: Habit;
  /** Walking off for good: left as is, there is nothing to rebuild for. */
  leaving: boolean;
}

/**
 * A brain's habit is fixed when it is built, so a change of the setting rebuilds the people whose habit it changes
 * (in place, already at home); everyone else keeps their brain. Keys in cast order.
 */
export function habitRebuilds(cast: Iterable<CastMember>, mix: HabitMix): string[] {
  const keys: string[] = [];
  for (const c of cast) if (!c.leaving && habitFor(c.seeded, mix) !== c.habit) keys.push(c.key);
  return keys;
}

export interface InPlace {
  seed: number;
  home: Home;
  target: Target;
  habit: Habit;
  /** The warung stool of a coffee break under way, if any. */
  visit: Home | null;
  now: number;
}

/**
 * The same person with another habit: a new brain built already at home, on the same seat or standing spot (or the
 * warung stool of a coffee break), in the target's resting state. No walking in, no greeting round.
 */
export function brainInPlace({ seed, home, target, habit, visit, now }: InPlace): Brain {
  const brain = new Brain({ seed, home, atHome: true, target, habit });
  brain.setTarget(target, null, now);
  brain.setVisit(visit);
  brain.settle();
  return brain;
}
