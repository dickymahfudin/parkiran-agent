import { describe, expect, test } from "bun:test";
import type { Clip, Frame } from "./brain.ts";
import { OWNER_SPOT, WarungOwner, isOwnerNight } from "./warungOwner.ts";

function run(o: WarungOwner, seconds: number): { clips: Set<Clip>; last: Frame } {
  const clips = new Set<Clip>();
  let last!: Frame;
  for (let t = 0; t < seconds; t += 1 / 30) {
    last = o.update(1 / 30);
    clips.add(last.clip);
  }
  return { clips, last };
}

describe("Pak Joko", () => {
  test("keeps himself busy behind the counter, never leaving his spot", () => {
    const o = new WarungOwner(7);
    const { clips, last } = run(o, 300);
    expect(clips.has("standIdle")).toBe(true);
    expect([...clips].filter((c) => ["smoke", "sip", "phone", "lookAround"].includes(c)).length).toBeGreaterThanOrEqual(2);
    expect([last.x, last.z]).toEqual([...OWNER_SPOT]);
    expect(last.sit).toBe(0);
  });

  test("serves a buyer with a glass of kopi, then goes back to his routine", () => {
    const o = new WarungOwner(7);
    run(o, 5);
    o.setServing(true);
    const serving = run(o, 2).last;
    expect(serving).toMatchObject({ clip: "buy", props: { cup: true } });
    o.setServing(false);
    expect(run(o, 1).last.clip).not.toBe("buy");
  });

  test("naps on his stool late at night and gets up for a buyer", () => {
    const o = new WarungOwner(7);
    o.setNight(true);
    const napping = run(o, 4).last;
    expect(napping).toMatchObject({ clip: "doze", sit: 1, props: { zzz: true } });
    o.setServing(true);
    const up = run(o, 3).last;
    expect(up).toMatchObject({ clip: "buy", sit: 0 });
    o.setServing(false);
    expect(run(o, 4).last).toMatchObject({ clip: "doze", sit: 1 });
  });

  test("late night is 23:00 to 04:30", () => {
    expect(isOwnerNight(23.2)).toBe(true);
    expect(isOwnerNight(2)).toBe(true);
    expect(isOwnerNight(4.6)).toBe(false);
    expect(isOwnerNight(21)).toBe(false);
  });
});
