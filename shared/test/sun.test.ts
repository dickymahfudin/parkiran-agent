import { describe, expect, test } from "bun:test";
import SunCalc from "suncalc";
import { applyTimeOverride, atLotClock, sunPosition } from "../src/sun.ts";

const JAKARTA = { lat: -6.2, lon: 106.8 };
// Jakarta is UTC+7 all year.
const wib = (iso: string) => new Date(`${iso}+07:00`);

describe("sunPosition (Jakarta)", () => {
  test("near zenith at solar noon around the equinox", () => {
    const p = sunPosition(wib("2026-03-20T11:55:00"), JAKARTA.lat, JAKARTA.lon);
    expect(p.elevation).toBeGreaterThan(80);
  });

  test("rises in the east around 06:00 and sets in the west around 18:00", () => {
    const morning = sunPosition(wib("2026-03-20T06:05:00"), JAKARTA.lat, JAKARTA.lon);
    expect(morning.elevation).toBeGreaterThan(-3);
    expect(morning.elevation).toBeLessThan(5);
    expect(morning.azimuth).toBeGreaterThan(80);
    expect(morning.azimuth).toBeLessThan(100);
    const evening = sunPosition(wib("2026-03-20T18:05:00"), JAKARTA.lat, JAKARTA.lon);
    expect(evening.elevation).toBeLessThan(2);
    expect(evening.azimuth).toBeGreaterThan(260);
    expect(evening.azimuth).toBeLessThan(280);
  });

  test("night is below the horizon", () => {
    expect(sunPosition(wib("2026-10-09T21:00:00"), JAKARTA.lat, JAKARTA.lon).elevation).toBeLessThan(-30);
    expect(sunPosition(wib("2026-10-09T02:00:00"), JAKARTA.lat, JAKARTA.lon).elevation).toBeLessThan(-30);
  });

  test("agrees with SunCalc (independent implementation) across dates, hours and places", () => {
    const places = [JAKARTA, { lat: 51.5, lon: -0.12 }, { lat: -33.9, lon: 151.2 }, { lat: 35.7, lon: 139.7 }];
    // Great-circle separation between the two sun directions (raw azimuth differences blow up near zenith).
    const separation = (el1: number, az1: number, el2: number, az2: number): number => {
      const r = Math.PI / 180;
      const c = Math.sin(el1 * r) * Math.sin(el2 * r) + Math.cos(el1 * r) * Math.cos(el2 * r) * Math.cos((az1 - az2) * r);
      return Math.acos(Math.min(1, Math.max(-1, c))) / r;
    };
    let worst = 0;
    for (const place of places) {
      for (let day = 0; day < 365; day += 23) {
        for (let hour = 0; hour < 24; hour += 1.5) {
          const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000 + hour * 3_600_000);
          const ours = sunPosition(date, place.lat, place.lon);
          const ref = SunCalc.getPosition(date, place.lat, place.lon);
          const refElevation = (ref.altitude * 180) / Math.PI;
          // SunCalc azimuth is measured from south, westward positive.
          const refAzimuth = ((((ref.azimuth * 180) / Math.PI + 180) % 360) + 360) % 360;
          worst = Math.max(worst, separation(ours.elevation, ours.azimuth, refElevation, refAzimuth));
        }
      }
    }
    expect(worst).toBeLessThan(0.3);
  });
});

describe("applyTimeOverride", () => {
  test("parses HH:MM", () => {
    const d = applyTimeOverride(new Date(2026, 9, 9, 3, 4, 5), "17:30")!;
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getDate()]).toEqual([17, 30, 0, 9]);
    expect(applyTimeOverride(new Date(), "25:00")).toBeNull();
    expect(applyTimeOverride(new Date(), "7pm")).toBeNull();
  });
});

describe("atLotClock", () => {
  test("a viewer in the lot's own zone sees the sun as it is", () => {
    const d = wib("2026-03-20T12:00:00");
    expect(atLotClock(d, JAKARTA.lon, 7 * 60).getTime()).toBe(d.getTime());
  });

  test("a viewer three hours ahead at noon sees the lot at its own noon, not at 09:00", () => {
    // 12:00 in Melbourne (UTC+10) is 09:00 in Jakarta: the lot would be lit for the morning.
    const melbourneNoon = new Date("2026-03-20T12:00:00+10:00");
    const raw = sunPosition(melbourneNoon, JAKARTA.lat, JAKARTA.lon);
    const shifted = sunPosition(atLotClock(melbourneNoon, JAKARTA.lon, 10 * 60), JAKARTA.lat, JAKARTA.lon);
    expect(raw.elevation).toBeLessThan(50);
    expect(shifted.elevation).toBeGreaterThan(80);
  });

  test("a viewer behind the lot at night does not get daylight", () => {
    const londonMidnight = new Date("2026-03-20T00:00:00+00:00");
    expect(sunPosition(atLotClock(londonMidnight, JAKARTA.lon, 0), JAKARTA.lat, JAKARTA.lon).elevation).toBeLessThan(-30);
  });
});
