import { describe, expect, test } from "bun:test";
import { RELOADED_AT, RELOAD_GUARD_MS, createReloadGuard, type KeyValueStore } from "./reloadGuard.ts";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("reload guard", () => {
  test("reloads once, then refuses within the guard window, and again after it", () => {
    const store = memoryStore();
    const guard = createReloadGuard(() => store);
    expect(guard(1_000_000)).toBe(true);
    expect(store.data.get(RELOADED_AT)).toBe("1000000");
    expect(guard(1_000_000 + RELOAD_GUARD_MS - 1)).toBe(false);
    expect(guard(1_000_000 + RELOAD_GUARD_MS)).toBe(true);
  });

  test("blocked storage (it throws) still guards, from memory, instead of throwing", () => {
    const blocked = (): KeyValueStore => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const guard = createReloadGuard(blocked);
    expect(guard(1_000_000)).toBe(true);
    expect(guard(1_000_001)).toBe(false);
  });

  test("a store whose writes throw keeps working the same way", () => {
    const readOnly: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    const guard = createReloadGuard(() => readOnly);
    expect(guard(1_000_000)).toBe(true);
    // Reads keep returning null (the write never landed): the in-memory time must still stop a second reload.
    expect(guard(1_000_001)).toBe(false);
  });
});
