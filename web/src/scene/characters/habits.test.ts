import { describe, expect, test } from "bun:test";
import { SEAT_PLACES } from "../layout.ts";
import type { Frame, Home, Target } from "./brain.ts";
import { brainInPlace, habitFor, habitRebuilds, type CastMember } from "./habits.ts";
import type { Habit } from "./identity.ts";

const place = (id: string): Home => {
  const s = SEAT_PLACES[id]!;
  return { point: s.approach, yaw: s.yaw, node: s.node, seat: { hip: s.hip, style: s.style } };
};
const home = place("bench-1a");
const stool = place("stool-2");

function frames(b: ReturnType<typeof brainInPlace>, seconds: number): Frame[] {
  const out: Frame[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) out.push(b.update(1 / 30, 0));
  return out;
}

const HABITS: readonly Habit[] = ["kretek", "vape", "none"];

describe("habits setting", () => {
  test("mixed keeps the seeded habit, no smoking takes it away, vape only hands everyone a vape", () => {
    for (const seeded of HABITS) {
      expect(habitFor(seeded, "mixed")).toBe(seeded);
      expect(habitFor(seeded, "noSmoking")).toBe("none");
      expect(habitFor(seeded, "vapeOnly")).toBe("vape");
    }
  });

  test("a change rebuilds only the people whose habit it changes, never someone walking off", () => {
    const cast: CastMember[] = [
      { key: "a", seeded: "kretek", habit: "kretek", leaving: false },
      { key: "b", seeded: "vape", habit: "vape", leaving: false },
      { key: "c", seeded: "none", habit: "none", leaving: false },
      { key: "d", seeded: "kretek", habit: "kretek", leaving: true },
    ];
    expect(habitRebuilds(cast, "mixed")).toEqual([]);
    expect(habitRebuilds(cast, "noSmoking")).toEqual(["a", "b"]);
    expect(habitRebuilds(cast, "vapeOnly")).toEqual(["a", "c"]);
    // Back to the mix from no smoking: the smokers get their own habit back, the non-smoker stays.
    const quiet = cast.map((c) => ({ ...c, habit: habitFor(c.seeded, "noSmoking") }));
    expect(habitRebuilds(quiet, "mixed")).toEqual(["a", "b"]);
    expect(habitRebuilds(quiet, "noSmoking")).toEqual([]);
  });

  test("a rebuilt person is already in place: seated at home, no walk, no greeting, the new habit's props", () => {
    const work: Target = { kind: "seated", activity: "work", work: "think" };
    const b = brainInPlace({ seed: 1, home, target: work, habit: "none", visit: null, now: 0 });
    const run = frames(b, 20);
    expect(b.takeArrival()).toBe(false);
    expect(run.every((f) => f.clip !== "walk" && f.clip !== "sitDown" && f.clip !== "wave" && f.sit === 1)).toBe(true);
    expect(run.every((f) => f.props.cigarette === "none" && !f.props.lighter)).toBe(true);
    expect(run.at(-1)!.props.laptop).toBe("open");
    expect([run[0]!.x, run[0]!.z]).toEqual([...home.point]);
  });

  test("on a coffee break, the rebuilt person sits on the same warung stool with the kopi", () => {
    const b = brainInPlace({ seed: 1, home, target: { kind: "warung" }, habit: "vape", visit: stool, now: 0 });
    const run = frames(b, 10);
    expect(run.every((f) => f.clip !== "walk" && f.clip !== "buy")).toBe(true);
    expect(run.at(-1)).toMatchObject({ x: stool.point[0], z: stool.point[1], sit: 1, props: { cup: true } });
  });
});
