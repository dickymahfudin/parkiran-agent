// Street traffic as one simulation: cars and scooters share each lane single file (a scooter beside a car does not fit),
// so every vehicle follows the one ahead with the Intelligent Driver Model instead of driving through it.
import { STREET } from "../layout.ts";

export const ROAD_END = 42;
// Indonesia drives on the left: heading +Z keeps to the +X half of the road.
export const LANES = [
  { x: (STREET.minX + STREET.maxX) / 2 + 1.15, dir: 1 },
  { x: (STREET.minX + STREET.maxX) / 2 - 1.15, dir: -1 },
] as const;
export type LaneIndex = 0 | 1;

/** Half width across mirrors / handlebars and rider, and how far each kind keeps to the kerb side of its lane. */
export const FOOTPRINT = {
  car: { halfWidth: 1.0, kerb: 0 },
  scooter: { halfWidth: 0.38, kerb: 0.6 },
} as const;

/** Where a vehicle of `kind` runs across the street in `lane`. */
export function laneX(lane: LaneIndex, kind: keyof typeof FOOTPRINT): number {
  return LANES[lane].x + LANES[lane].dir * FOOTPRINT[kind].kerb;
}

export interface Vehicle {
  active: boolean;
  lane: LaneIndex;
  /** Centre of the vehicle along the street. */
  z: number;
  speed: number;
  /** Speed it settles at on a free road. */
  cruise: number;
  /** Bumper to bumper (m). */
  length: number;
}

const MAX_ACCEL = 1.6;
const COMFORT_BRAKE = 2.5;
/** Bumper gap kept when stopped behind someone, and the time headway kept while moving. */
const STANDSTILL_GAP = 2.0;
const HEADWAY_S = 1.1;
/** Never closer than this, whatever the integration step did. */
const HARD_GAP = 0.8;
/** A lane takes a new vehicle only when its entrance is this clear. */
const ENTRY_CLEARANCE = 14;
const SUBSTEP_S = 0.05;

export function idleVehicle(length: number): Vehicle {
  return { active: false, lane: 0, z: 0, speed: 0, cruise: 0, length };
}

/** Progress along the lane's direction of travel. */
function progress(v: Vehicle): number {
  return LANES[v.lane].dir * v.z;
}

/** Bumper gap from `v` to the vehicle ahead, or null on an empty lane. */
function leaderOf(v: Vehicle, all: readonly Vehicle[]): Vehicle | null {
  let best: Vehicle | null = null;
  for (const o of all) {
    if (o === v || !o.active || o.lane !== v.lane || progress(o) <= progress(v)) continue;
    if (!best || progress(o) < progress(best)) best = o;
  }
  return best;
}

function bumperGap(follower: Vehicle, leader: Vehicle): number {
  return progress(leader) - progress(follower) - (leader.length + follower.length) / 2;
}

/** Whether a vehicle may enter `lane` at its start without landing on someone. */
export function laneEntryClear(lane: LaneIndex, all: readonly Vehicle[]): boolean {
  const entry = -ROAD_END;
  return all.every((o) => !o.active || o.lane !== lane || progress(o) - entry > ENTRY_CLEARANCE);
}

/** Puts `v` at the start of `lane`, matching the speed of anyone close ahead. Returns false if the entrance is taken. */
export function enter(v: Vehicle, lane: LaneIndex, cruise: number, all: readonly Vehicle[]): boolean {
  if (!laneEntryClear(lane, all)) return false;
  v.active = true;
  v.lane = lane;
  v.z = -LANES[lane].dir * ROAD_END;
  v.cruise = cruise;
  v.speed = cruise;
  const ahead = leaderOf(v, all);
  if (ahead) v.speed = Math.min(cruise, ahead.speed + bumperGap(v, ahead) / 4);
  return true;
}

function idmAccel(v: Vehicle, ahead: Vehicle | null): number {
  const free = 1 - (v.speed / v.cruise) ** 4;
  if (!ahead) return MAX_ACCEL * free;
  const gap = Math.max(bumperGap(v, ahead), 0.01);
  const closing = v.speed - ahead.speed;
  const wanted = STANDSTILL_GAP + Math.max(0, v.speed * HEADWAY_S + (v.speed * closing) / (2 * Math.sqrt(MAX_ACCEL * COMFORT_BRAKE)));
  return MAX_ACCEL * (free - (wanted / gap) ** 2);
}

function substep(all: Vehicle[], dt: number): void {
  // Front to back, so each follower reacts to where its leader has just moved.
  const moving = all.filter((v) => v.active).sort((a, b) => progress(b) - progress(a));
  for (const v of moving) {
    const ahead = leaderOf(v, moving);
    v.speed = Math.max(0, v.speed + idmAccel(v, ahead) * dt);
    v.z += LANES[v.lane].dir * v.speed * dt;
    if (ahead && bumperGap(v, ahead) < HARD_GAP) {
      v.z = LANES[v.lane].dir * (progress(ahead) - (ahead.length + v.length) / 2 - HARD_GAP);
      v.speed = Math.min(v.speed, ahead.speed);
    }
    if (progress(v) > ROAD_END) v.active = false;
  }
}

export function stepTraffic(all: Vehicle[], dt: number): void {
  const n = Math.ceil(dt / SUBSTEP_S);
  for (let i = 0; i < n; i++) substep(all, dt / n);
}

/** Releases one vehicle of a kind onto the street every so often. */
export interface Spawner {
  pool: Vehicle[];
  random: () => number;
  /** Seconds until the next release. */
  next: number;
  /** Release interval and cruise speed, each as [min, random extra]. */
  every: readonly [number, number];
  cruise: readonly [number, number];
}

export function tickSpawner(s: Spawner, all: readonly Vehicle[], dt: number): void {
  s.next -= dt;
  if (s.next > 0) return;
  const free = s.pool.find((v) => !v.active);
  if (!free) {
    s.next = s.every[0] + s.random() * s.every[1];
    return;
  }
  const lane: LaneIndex = s.random() < 0.5 ? 0 : 1;
  const cruise = s.cruise[0] + s.random() * s.cruise[1];
  const entered = enter(free, lane, cruise, all) || enter(free, lane === 0 ? 1 : 0, cruise, all);
  s.next = entered ? s.every[0] + s.random() * s.every[1] : 1;
}
