import { describe, expect, test } from "bun:test";
import { CART_PASS_MS, CART_PATH, CART_SLOT_MS, cartAt, cartClear, cartPassAt, isCartHour } from "./foodCart.ts";

describe("food carts", () => {
  test("one pass per 10-minute slot at most, the same for everyone", () => {
    let busy = 0;
    const kinds = new Set<string>();
    for (let t = 0; t < 12 * CART_SLOT_MS; t += 5000) {
      const p = cartPassAt(t);
      if (!p) continue;
      busy += 5000;
      kinds.add(p.kind);
      expect(cartPassAt(t)).toEqual(p);
      expect(Math.floor(p.start / CART_SLOT_MS)).toBe(Math.floor(t / CART_SLOT_MS));
    }
    expect(busy / 12).toBeCloseTo(CART_PASS_MS, -4);
    expect(kinds).toEqual(new Set(["bakso", "nasgor"]));
  });

  test("walks the whole far pavement at a slow pace", () => {
    const pass = { kind: "bakso", dir: 1, start: 0 } as const;
    expect(cartAt(pass, 0).z).toBe(CART_PATH.z0);
    expect(cartAt(pass, 10_000).z).toBeCloseTo(CART_PATH.z0 + 8);
    expect(cartAt({ ...pass, dir: -1 }, CART_PASS_MS).z).toBeCloseTo(CART_PATH.z0);
  });

  test("only in the evening and at night, and never in the road or through a tree", () => {
    expect(isCartHour(19)).toBe(true);
    expect(isCartHour(0.5)).toBe(true);
    expect(isCartHour(12)).toBe(false);
    expect(isCartHour(2)).toBe(false);
    expect(cartClear()).toBe(true);
  });
});
