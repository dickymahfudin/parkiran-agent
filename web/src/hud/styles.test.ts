import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "styles.css"), "utf8");

describe("styles", () => {
  // The build's CSS minifier (lightningcss) treats a later -webkit- declaration as overriding an earlier standard one
  // and drops the standard one, which Chrome needs: the HUD panels lost their blur in production.
  test("-webkit-backdrop-filter comes before backdrop-filter in every rule", () => {
    for (const rule of css.match(/[^{}]+\{[^}]*\}/g) ?? []) {
      const prefixed = rule.indexOf("-webkit-backdrop-filter");
      if (prefixed < 0) continue;
      const standard = /(?<!-webkit-)backdrop-filter/.exec(rule)?.index ?? -1;
      expect(standard).toBeGreaterThan(prefixed);
    }
  });
});
