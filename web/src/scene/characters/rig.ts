// Brain clip → rigged clip, and brain time → clip time. Pure, so the mapping is unit tested.
import { WALK_SPEED } from "../layout.ts";
import type { Clip } from "./brain.ts";

export interface ClipMeta {
  loop: boolean;
  seconds: number;
}

export interface ClipsJson {
  fps: number;
  clips: Record<string, ClipMeta & { source: string; base?: string }>;
  /** Hips of the seated pose relative to the character root (glTF: Y up, facing +Z). */
  sitHips: [number, number, number];
  /** Ground speed of the planted foot in the walk clip, m/s. */
  walkSpeed: number;
  /** Mouth position in the bind pose (Blender coordinates: Z up, facing −Y). */
  mouth: [number, number, number];
}

/**
 * Either one full-body clip, or legs from one clip and everything above the hips from another; `upperAt` holds the
 * upper half still at that clip time (a pose instead of a motion).
 */
export type RigPlay = { full: string } | { lower: string; upper: string; upperAt?: number };

/** Into the reach of the Interact clip: both forearms forward at the height of a cart's handles. */
const PUSH_POSE_S = 0.8;

const SEATED: Partial<Record<Clip, string>> = {
  think: "think",
  smoke: "smoke",
  sip: "sip",
  chat: "chat",
  frustrated: "frustrated",
  lightUp: "lightUp",
  phone: "phone",
};
const STANDING: Partial<Record<Clip, string>> = {
  think: "smokeStand",
  smoke: "smokeStand",
  sip: "sipStand",
  chat: "talk",
  frustrated: "frustratedStand",
  lightUp: "lightUpStand",
  phone: "phoneStand",
};
const ALWAYS: Partial<Record<Clip, string>> = {
  walk: "walk",
  standIdle: "standIdle",
  sitDown: "sitDown",
  standUp: "standUp",
  sitIdle: "sitIdle",
  type: "type",
  stretch: "stretch",
  patPockets: "patPockets",
  lookAround: "lookAround",
  drag: "drag",
  sigh: "sigh",
  pocketCig: "pocketCig",
  doze: "doze",
  buy: "interact",
  stubOut: "stubOut",
  closeLaptop: "closeLaptop",
  wave: "wave",
};

/**
 * With the kopi in the left hand, the clips that would let that arm hang or rest on the laptop (and tip the cup over)
 * play a variant that holds it upright; walking keeps the legs and carries the cup in front.
 */
const HOLDING_CUP: Partial<Record<Clip, { seated?: string; standing?: string }>> = {
  sitIdle: { seated: "cupSit" },
  smoke: { seated: "cupSmoke" },
  standIdle: { standing: "cupStand" },
};

export type CupHand = "left" | "right";

/**
 * `cup`: the hand holding a kopi, if any. The left one is the usual; the right one only beside the phone (seated, left
 * hand), where the sips take the place of a smoker's drags.
 */
export function rigPlay(clip: Clip, seated: boolean, cup: CupHand | null = null): RigPlay {
  if (clip === "push") return { lower: "walk", upper: "interact", upperAt: PUSH_POSE_S };
  if (cup === "left") {
    if (clip === "walk") return { lower: "walk", upper: "cupStand" };
    const held = HOLDING_CUP[clip]?.[seated ? "seated" : "standing"];
    if (held) return { full: held };
  }
  if (cup === "right" && clip === "phone" && seated) return { full: "phoneCup" };
  const name = (seated ? SEATED[clip] : STANDING[clip]) ?? ALWAYS[clip];
  if (!name) throw new Error(`no rig clip for ${clip}`);
  // The stretch was keyed seated and the wave standing: the other posture plays it from the waist up.
  if (clip === "stretch" && !seated) return { lower: "standIdle", upper: "stretch" };
  if (clip === "wave" && seated) return { lower: "sitIdle", upper: "wave" };
  return { full: name };
}

/** Clip-local time for a brain clip that has been playing `t` seconds. */
export function rigTime(name: string, t: number, meta: ClipsJson, typingRate: number): number {
  const m = meta.clips[name];
  if (!m) throw new Error(`clip ${name} missing from clips.json`);
  let scaled = t;
  if (name === "walk") scaled = t * (WALK_SPEED / meta.walkSpeed);
  else if (name === "type") scaled = t * typingRate;
  if (m.loop) return ((scaled % m.seconds) + m.seconds) % m.seconds;
  return Math.min(scaled, m.seconds - 1e-3);
}

/** Where the seated hips are relative to the root, along the facing direction (m). */
export const sitHipsBack = (meta: ClipsJson): number => -meta.sitHips[2];
