import { describe, expect, test } from "bun:test";
import { DESPAWN_POINT, NODES, STREET_POLES, TREE_SPOTS } from "../layout.ts";
import { enter, FOOTPRINT, idleVehicle, laneEntryClear, LANES, laneX, ROAD_END, stepTraffic, tickSpawner, type Spawner, type Vehicle } from "./traffic.ts";

function bumperGap(back: Vehicle, front: Vehicle): number {
  const dir = LANES[back.lane].dir;
  return dir * (front.z - back.z) - (front.length + back.length) / 2;
}

describe("street traffic", () => {
  test("a fast scooter catches a slow car and queues behind it instead of driving through", () => {
    const car = idleVehicle(4.45);
    const scooter = idleVehicle(1.95);
    const all = [car, scooter];
    expect(enter(car, 0, 6, all)).toBe(true);
    stepTraffic(all, 3);
    expect(enter(scooter, 0, 11, all)).toBe(true);
    let closest = Infinity;
    for (let t = 0; t < 12; t += 1 / 60) {
      stepTraffic(all, 1 / 60);
      if (!car.active) break;
      closest = Math.min(closest, bumperGap(scooter, car));
    }
    expect(closest).toBeGreaterThan(1.5);
    expect(scooter.speed).toBeLessThan(6.5);
  });

  test("big frame steps (a background tab) still never overlap", () => {
    const car = idleVehicle(4.45);
    const scooter = idleVehicle(1.95);
    const all = [car, scooter];
    enter(car, 1, 6, all);
    stepTraffic(all, 2.5);
    enter(scooter, 1, 11, all);
    for (let i = 0; i < 40 && car.active; i++) {
      stepTraffic(all, 0.5);
      expect(bumperGap(scooter, car)).toBeGreaterThan(0.5);
    }
  });

  test("opposite lanes pass each other freely", () => {
    const north = idleVehicle(4.45);
    const south = idleVehicle(1.95);
    const all = [north, south];
    enter(north, 0, 8, all);
    enter(south, 1, 8, all);
    stepTraffic(all, 4);
    expect(north.speed).toBeCloseTo(8, 0);
    expect(south.speed).toBeCloseTo(8, 0);
  });

  test("a lane takes no new vehicle while its entrance is occupied, and frees up once it drives on", () => {
    const car = idleVehicle(4.45);
    const scooter = idleVehicle(1.95);
    const all = [car, scooter];
    enter(car, 0, 7, all);
    expect(laneEntryClear(0, all)).toBe(false);
    expect(enter(scooter, 0, 9, all)).toBe(false);
    expect(scooter.active).toBe(false);
    expect(laneEntryClear(1, all)).toBe(true);
    stepTraffic(all, 4);
    expect(laneEntryClear(0, all)).toBe(true);
  });

  test("vehicles leave the street at the far end", () => {
    const car = idleVehicle(3.8);
    const all = [car];
    enter(car, 1, 9, all);
    stepTraffic(all, (2 * ROAD_END) / 9 + 2);
    expect(car.active).toBe(false);
  });

  test("the spawner tries the other lane when the first one is blocked", () => {
    const blocker = idleVehicle(4.45);
    const pool = [idleVehicle(1.95)];
    const all = [blocker, ...pool];
    enter(blocker, 0, 7, all);
    const s: Spawner = { pool, random: () => 0.1, next: 0, every: [5, 0], cruise: [8, 0] };
    tickSpawner(s, all, 0.1);
    expect(pool[0]!.active).toBe(true);
    expect(pool[0]!.lane).toBe(1);
    expect(s.next).toBe(5);
  });
});

describe("the street is clear for traffic", () => {
  const POLE_R = 0.14;
  const TRUNK_R = 0.35;
  const bands = ([0, 1] as const).flatMap((lane) =>
    (["car", "scooter"] as const).map((kind) => ({ lane, kind, min: laneX(lane, kind) - FOOTPRINT[kind].halfWidth, max: laneX(lane, kind) + FOOTPRINT[kind].halfWidth })),
  );
  const gap = (x: number, b: { min: number; max: number }) => Math.max(b.min - x, x - b.max);

  test("no pole or tree trunk stands where a car or an ojek passes", () => {
    for (const b of bands) {
      for (const p of STREET_POLES) expect(gap(p.x, b) - POLE_R).toBeGreaterThan(0.05);
      for (const t of TREE_SPOTS) expect(gap(t.x, b) - TRUNK_R).toBeGreaterThan(0.05);
    }
  });

  test("people walk in and out along the gang, never in a lane", () => {
    for (const [x] of [NODES.street!, NODES.curb!, DESPAWN_POINT]) {
      for (const b of bands) expect(gap(x, b)).toBeGreaterThan(0.3);
    }
  });
});
