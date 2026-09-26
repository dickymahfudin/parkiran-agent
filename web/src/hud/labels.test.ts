import { describe, expect, test } from "bun:test";
import { formatRupiah, parkingFee } from "./labels.ts";

const HOUR = 3_600_000;

describe("parking meter", () => {
  test("charges Rp 2.000 for the first started hour and Rp 1.000 for every hour after, per session", () => {
    const now = 10 * HOUR;
    const fee = parkingFee([{ startedAt: now - 5 * 60_000 }, { startedAt: now - 2.5 * HOUR }], now);
    expect(fee.rupiah).toBe(2000 + 2000 + 2 * 1000);
    expect(fee.sessions).toBe(2);
    expect(fee.parkedMs).toBe(5 * 60_000 + 2.5 * HOUR);
  });

  test("an empty lot costs nothing", () => {
    expect(parkingFee([], 0)).toEqual({ rupiah: 0, sessions: 0, parkedMs: 0 });
  });

  test("formats rupiah with dots", () => {
    expect(formatRupiah(12000)).toBe("Rp 12.000");
    expect(formatRupiah(0)).toBe("Rp 0");
  });
});
