// Pure mixing rules for the sound engine, unit tested: how much keyboard, how loud the ambience.

/** Key presses per second for one person typing. */
export const KEYS_PER_TYPIST = 3.2;
/** The lot's keyboards together never exceed this: six people typing should read as a busy lot, not a typing pool. */
export const MAX_KEYS_PER_S = 4.5;
/** Ambience level while the window is in the background (you are working elsewhere; the cues stay at full volume). */
export const DUCK_LEVEL = 0.3;

/** Keyboard clicks per second for `typists` people, capped for the whole lot. */
export function keysPerSecond(typists: number): number {
  if (typists <= 0) return 0;
  return Math.min(MAX_KEYS_PER_S, typists * KEYS_PER_TYPIST);
}

/** Gain of the ambience bus (street, keyboards, crickets, engines): off, ducked in the background, or full. */
export function ambienceLevel(on: boolean, ducked: boolean): number {
  if (!on) return 0;
  return ducked ? DUCK_LEVEL : 1;
}
