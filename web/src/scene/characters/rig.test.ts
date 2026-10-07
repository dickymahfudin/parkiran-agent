import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIP_SEAT_Y, SIT_ROOT_BACK, WALK_SPEED } from "../layout.ts";
import type { Clip } from "./brain.ts";
import { rigPlay, rigTime, sitHipsBack, type ClipsJson } from "./rig.ts";

const ALL_CLIPS: Clip[] = [
  "walk",
  "standIdle",
  "sitDown",
  "standUp",
  "sitIdle",
  "type",
  "think",
  "smoke",
  "sip",
  "stretch",
  "chat",
  "frustrated",
  "patPockets",
  "lookAround",
  "lightUp",
  "drag",
  "sigh",
  "pocketCig",
  "doze",
  "buy",
  "stubOut",
  "closeLaptop",
  "wave",
  "phone",
  "push",
];

const CLIPS_JSON = join(import.meta.dir, "..", "..", "..", "public", "assets", "character", "clips.json");
const meta: ClipsJson | null = existsSync(CLIPS_JSON) ? (JSON.parse(readFileSync(CLIPS_JSON, "utf8")) as ClipsJson) : null;

const names = (play: ReturnType<typeof rigPlay>) => ("full" in play ? [play.full] : [play.lower, play.upper]);

const fake: ClipsJson = {
  fps: 24,
  clips: { walk: { loop: true, seconds: 1.3, source: "x" }, type: { loop: true, seconds: 5, source: "x" }, sigh: { loop: false, seconds: 1.6, source: "x" } },
  sitHips: [0, 0.54, -0.28],
  walkSpeed: 1,
  mouth: [0, -0.15, 1.47],
};

describe("rig clip mapping", () => {
  test("every brain clip maps to a rig clip in both postures", () => {
    for (const c of ALL_CLIPS) for (const seated of [true, false]) expect(names(rigPlay(c, seated)).length).toBeGreaterThan(0);
  });

  test("seated and standing variants differ where the arms rest differently", () => {
    expect(rigPlay("smoke", true)).toEqual({ full: "smoke" });
    expect(rigPlay("smoke", false)).toEqual({ full: "smokeStand" });
    expect(rigPlay("chat", false)).toEqual({ full: "talk" });
    expect(rigPlay("stretch", false)).toEqual({ lower: "standIdle", upper: "stretch" });
    // The wave was keyed standing: seated, the legs stay on the seat.
    expect(rigPlay("wave", true)).toEqual({ lower: "sitIdle", upper: "wave" });
    expect(rigPlay("wave", false)).toEqual({ full: "wave" });
    // A street vendor walks with both hands held forward on the cart.
    expect(rigPlay("push", false)).toMatchObject({ lower: "walk", upper: "interact" });
  });

  test("a kopi in the left hand stays upright: resting, smoking, standing and walking hold it", () => {
    expect(rigPlay("sitIdle", true, "left")).toEqual({ full: "cupSit" });
    expect(rigPlay("smoke", true, "left")).toEqual({ full: "cupSmoke" });
    expect(rigPlay("standIdle", false, "left")).toEqual({ full: "cupStand" });
    expect(rigPlay("walk", false, "left")).toEqual({ lower: "walk", upper: "cupStand" });
    expect(rigPlay("sip", true, "left")).toEqual({ full: "sip" });
    expect(rigPlay("sip", false, "left")).toEqual({ full: "sipStand" });
    // Beside the phone the kopi is in the right hand, sipped in place of a drag.
    expect(rigPlay("phone", true, "right")).toEqual({ full: "phoneCup" });
    // Without a cup nothing changes.
    expect(rigPlay("sitIdle", true)).toEqual({ full: "sitIdle" });
    expect(rigPlay("walk", false)).toEqual({ full: "walk" });
  });

  test("walk plays faster to match the scene walk speed; typing follows the tool rate; one-shots clamp", () => {
    expect(rigTime("walk", 1, fake, 1)).toBeCloseTo((WALK_SPEED / fake.walkSpeed) % 1.3, 5);
    expect(rigTime("type", 2, fake, 1.7)).toBeCloseTo(3.4, 5);
    expect(rigTime("type", 4, fake, 1.7)).toBeCloseTo(6.8 - 5, 5);
    expect(rigTime("sigh", 9, fake, 1)).toBeLessThan(1.6);
  });

  test.skipIf(meta === null)("clips.json has every mapped clip and matches the layout's sitting constants", () => {
    const m = meta!;
    for (const c of ALL_CLIPS)
      for (const seated of [true, false])
        for (const cup of [null, "left", "right"] as const) for (const n of names(rigPlay(c, seated, cup))) expect(m.clips[n]).toBeDefined();
    expect(sitHipsBack(m)).toBeCloseTo(SIT_ROOT_BACK, 2);
    // Sitting clips put the hips about 9 cm above the seat they were made for.
    expect(m.sitHips[1] - CLIP_SEAT_Y).toBeGreaterThan(0.07);
    expect(m.sitHips[1] - CLIP_SEAT_Y).toBeLessThan(0.11);
  });
});
