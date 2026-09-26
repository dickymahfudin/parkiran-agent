// Pure mapping from sun position to the scene's lighting rig. No three.js here so it can be unit tested.
import type { SunPosition } from "../../../../shared/src/sun.ts";

export type SkyBand = "morning" | "noon" | "golden" | "night";

export interface Lighting {
  /** Two HDRI bands and the blend weight of `b` (0…1). */
  sky: { a: SkyBand; b: SkyBand; t: number };
  /** Multiplier on the sky/environment radiance. */
  skyIntensity: number;
  /** Key directional light: the sun by day, the moon at night. */
  key: { elevation: number; azimuth: number; color: [number, number, number]; intensity: number };
  /** 0 = lamps off, 1 = full night lighting (street lamp, warung bulbs, neon). */
  lamps: number;
  fogDensity: number;
  fogColor: [number, number, number];
  /** Tone-mapping exposure: the "eye" adapts to low sun and night instead of crushing shadows to black. */
  exposure: number;
  /** For stars, moths and other night-only life. */
  night: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** Approximate blackbody colour (Tanner Helland's fit), returned in linear-ish 0…1 RGB. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255) as [number, number, number];
}

const MOON_COLOR: [number, number, number] = [0.62, 0.72, 1.0];

export function lightingFor(sun: SunPosition): Lighting {
  const e = sun.elevation;
  const morning = sun.azimuth < 180;
  const lowBand: SkyBand = morning ? "morning" : "golden";

  // Sky bands: night below −6° (civil dusk), low sun up to ~12°, noon above ~28°.
  let sky: Lighting["sky"];
  if (e < -6) sky = { a: "night", b: lowBand, t: smooth(-12, -6, e) * 0.15 };
  else if (e < 4) sky = { a: "night", b: lowBand, t: smooth(-6, 4, e) * 0.85 + 0.15 };
  else if (e < 28) sky = { a: lowBand, b: "noon", t: smooth(10, 28, e) };
  else sky = { a: "noon", b: "noon", t: 0 };

  const day = smooth(-4, 8, e);
  const night = 1 - smooth(-8, 2, e);
  const sunKelvin = mix(1900, 5600, smooth(0, 40, e));
  const sunIntensity = 3.6 * smooth(-1, 22, e) + 0.35 * smooth(-3, 3, e);
  const moonIntensity = 0.32 * night;
  const useMoon = sunIntensity < moonIntensity;

  return {
    sky,
    skyIntensity: mix(0.32, 1.0, day),
    key: useMoon
      ? { elevation: 48, azimuth: (sun.azimuth + 180) % 360, color: MOON_COLOR, intensity: moonIntensity }
      : { elevation: Math.max(e, 1.5), azimuth: sun.azimuth, color: kelvinToRgb(sunKelvin), intensity: sunIntensity },
    lamps: 1 - smooth(-4, 8, e),
    fogDensity: mix(0.004, 0.022, night),
    fogColor: mix3([0.62, 0.68, 0.74], [0.04, 0.06, 0.1], night),
    exposure: mix(1.0, 1.6, 1 - smooth(12, 45, e)),
    night,
  };
}
