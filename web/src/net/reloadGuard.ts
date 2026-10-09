// "Reload once for a new build": a page opened before a rebuild asks for chunks the rebuild deleted. A second failure
// within a minute is a real error and surfaces instead of reloading in a loop.

export const RELOADED_AT = "parkiran:reloaded-for-new-build";
export const RELOAD_GUARD_MS = 60_000;

/** The part of `sessionStorage` used here; reading or writing it can throw (Safari with all cookies blocked). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Whether to reload now, and records that it did. Without usable storage the time is kept in memory instead: the guard
 * then only covers this page, which still stops a loop (a reload starts a new page, which waits for its own error).
 */
export function createReloadGuard(storage: () => KeyValueStore) {
  let memory = 0;
  // The later of the two: storage that reads fine but refuses writes would otherwise always look "never reloaded".
  const read = (): number => {
    try {
      return Math.max(memory, Number(storage().getItem(RELOADED_AT) ?? 0));
    } catch {
      return memory;
    }
  };
  const write = (at: number): void => {
    memory = at;
    try {
      storage().setItem(RELOADED_AT, String(at));
    } catch {
      // Kept in memory above.
    }
  };
  return (now: number): boolean => {
    if (now - read() < RELOAD_GUARD_MS) return false;
    write(now);
    return true;
  };
}
