// Timing of the rigged clips that more than one module needs to know (clips.json, make_animations.py). Pure constants,
// checked against the shipped clips.json in clips.test.ts.

/** Length of the sitDown clip (s), the time a brain spends sitting down. */
export const SIT_S = 1.29;
/** Length of the standUp clip (s). */
export const STAND_S = 1.04;

/**
 * Rig clips with a drag on the cigarette, in clip seconds (make_animations.py): while the hand is at the lips the tip
 * glows and gives off little smoke; once it leaves, the smoke comes back out of the mouth. clips.json carries no such
 * marks, so they live here.
 */
export const DRAGS: Record<string, { drag: readonly [number, number]; exhale: readonly [number, number] }> = {
  smoke: { drag: [1.75, 2.9], exhale: [2.95, 4.4] },
  smokeStand: { drag: [2.45, 3.6], exhale: [3.65, 5.1] },
  think: { drag: [1.95, 2.6], exhale: [2.65, 4.0] },
  drag: { drag: [0.05, 0.6], exhale: [0.65, 1.5] },
  phone: { drag: [4.55, 5.6], exhale: [5.7, 7.1] },
  cupSmoke: { drag: [1.75, 2.9], exhale: [2.95, 4.4] },
};
