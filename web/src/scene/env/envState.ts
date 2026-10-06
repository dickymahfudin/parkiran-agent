import * as THREE from "three";
import { applyTimeOverride, atLotClock, sunPosition } from "../../../../shared/src/sun.ts";
import { useApp } from "../../state/store.ts";
import { lightingFor, type Lighting } from "./dayNight.ts";
import { SceneTimeEase } from "./timeOfDay.ts";

export const DEFAULT_LAT = -6.2;
export const DEFAULT_LON = 106.8;

/** Lighting shared by every scene object, recomputed once per frame by <DayNight/>. */
export const envState: { lighting: Lighting; date: Date; keyDir: THREE.Vector3 } = {
  lighting: lightingFor({ elevation: 45, azimuth: 90 }),
  date: new Date(),
  keyDir: new THREE.Vector3(0, 1, 0),
};

export function sceneDate(now = new Date()): Date {
  const override = useApp.getState().timeOverride;
  return (override && applyTimeOverride(now, override)) || now;
}

/** World direction for an azimuth (deg from north, clockwise) and elevation. North is −Z, east is +X. */
export function directionFrom(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  const e = THREE.MathUtils.degToRad(elevationDeg);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

const timeEase = new SceneTimeEase();

export function updateEnvState(): Lighting {
  const wall = Date.now();
  // A new time of day (preset, auto, dev input) eases the sun round the clock instead of jumping.
  const date = new Date(timeEase.step(sceneDate(new Date(wall)).getTime(), useApp.getState().timeOverride ?? "auto", wall));
  const cfg = useApp.getState().config;
  const lon = cfg?.lon ?? DEFAULT_LON;
  // Everything else in the scene (presets, Pak Joko's nap, the food carts, the toolbar clock) reads the local hour, so
  // the sun is computed for that same hour at the lot: no mismatch when the viewer's time zone is not the lot's.
  const sun = sunPosition(atLotClock(date, lon), cfg?.lat ?? DEFAULT_LAT, lon);
  const lighting = lightingFor(sun);
  envState.date = date;
  envState.lighting = lighting;
  directionFrom(lighting.key.azimuth, lighting.key.elevation, envState.keyDir);
  return lighting;
}
