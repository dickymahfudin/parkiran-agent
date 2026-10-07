import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DRAGS, SIT_S, STAND_S } from "./clips.ts";
import type { ClipsJson } from "./rig.ts";

const CLIPS_JSON = join(import.meta.dir, "..", "..", "..", "public", "assets", "character", "clips.json");
const meta: ClipsJson | null = existsSync(CLIPS_JSON) ? (JSON.parse(readFileSync(CLIPS_JSON, "utf8")) as ClipsJson) : null;

describe("shared clip timing", () => {
  test("sit down and stand up last as long as their clips", () => {
    expect(SIT_S).toBeGreaterThan(0);
    expect(STAND_S).toBeGreaterThan(0);
    if (!meta) return;
    expect(Math.abs(meta.clips.sitDown!.seconds - SIT_S)).toBeLessThan(0.01);
    expect(Math.abs(meta.clips.standUp!.seconds - STAND_S)).toBeLessThan(0.01);
  });

  test("every drag window ends before its exhale starts, inside the clip", () => {
    for (const [name, { drag, exhale }] of Object.entries(DRAGS)) {
      expect(drag[0]).toBeGreaterThanOrEqual(0);
      expect(drag[1]).toBeGreaterThan(drag[0]);
      expect(exhale[0]).toBeGreaterThanOrEqual(drag[1]);
      expect(exhale[1]).toBeGreaterThan(exhale[0]);
      if (meta) {
        const clip = meta.clips[name];
        expect(clip, `${name} is in clips.json`).toBeDefined();
        expect(exhale[1]).toBeLessThanOrEqual(clip!.seconds);
      }
    }
  });
});
