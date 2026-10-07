import { describe, expect, test } from "bun:test";
import { OWNER_STOOL } from "./characters/warungOwner.ts";
import {
  AWNING_POLES,
  BENCH_Y,
  CAR_HALF_LENGTH,
  CAR_LENGTH,
  CLIP_SEAT_Y,
  COUNTER,
  DESPAWN_POINT,
  SEAT_PLACES,
  SIT_ROOT_BACK,
  SPAWN_POINT,
  STANDING_SPOTS,
  STOOL_Y,
  WARUNG_STOOLS,
  assignStandingSpots,
  assignWarungStools,
  clearToStand,
  planPath,
  solidAt,
  type Vec2,
} from "./layout.ts";

/** Seated knees stick out about this far in front of the hip joint. */
const KNEE_AHEAD = 0.45;

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

function clearance(path: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistance(p, path[i - 1]!, path[i]!));
  return best;
}

const seats = Object.values(SEAT_PLACES);

describe("walk paths", () => {
  for (const seat of seats) {
    const routes: [string, Vec2[]][] = [
      ["from the street", planPath(SPAWN_POINT, seat.approach, seat.node)],
      ["from the counter", planPath(COUNTER.point, seat.approach, seat.node, COUNTER.node)],
      ["leaving", planPath(seat.approach, DESPAWN_POINT, "street", seat.node)],
      ["to the counter", planPath(seat.approach, COUNTER.point, COUNTER.node, seat.node)],
    ];
    test(`${seat.id}: never cut through someone seated or an awning pole`, () => {
      for (const [, path] of routes) {
        for (const other of seats) {
          if (other.id === seat.id) continue;
          const fwd: Vec2 = [Math.sin(other.yaw), Math.cos(other.yaw)];
          const hip: Vec2 = [other.hip[0], other.hip[2]];
          const knee: Vec2 = [hip[0] + fwd[0] * KNEE_AHEAD, hip[1] + fwd[1] * KNEE_AHEAD];
          const feet: Vec2 = [hip[0] + fwd[0] * SIT_ROOT_BACK, hip[1] + fwd[1] * SIT_ROOT_BACK];
          for (const p of [hip, knee, feet]) expect(clearance(path, p)).toBeGreaterThan(0.3);
        }
        for (const pole of AWNING_POLES) expect(clearance(path, pole)).toBeGreaterThan(0.25);
      }
    });
  }
});

describe("standing spots", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `session-${i}`);
  // Everyone prefers the same spot: the worst case for collisions.
  const sameSpot = () => 4;
  const walks = seats.flatMap((seat) => [planPath(SPAWN_POINT, seat.approach, seat.node), planPath(seat.approach, COUNTER.point, COUNTER.node, seat.node)]);

  test("every spot is clear of sitters, vehicles and furniture, apart from the others and off the walking lanes", () => {
    for (const spot of STANDING_SPOTS) {
      expect(clearToStand(spot.point)).toBe(true);
      for (const other of STANDING_SPOTS)
        if (other !== spot) expect(Math.hypot(spot.point[0] - other.point[0], spot.point[1] - other.point[1])).toBeGreaterThan(1.5);
      for (const path of walks) expect(clearance(path, spot.point)).toBeGreaterThan(0.45);
    }
  });

  test("every spot is reached in a straight line from its graph node without walking through anything", () => {
    for (const spot of STANDING_SPOTS) {
      const route = planPath(SPAWN_POINT, spot.point, spot.node);
      const [a, b] = [route[route.length - 2]!, route[route.length - 1]!];
      for (let t = 0; t <= 1; t += 0.05) expect(solidAt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 0.2)).toBe(false);
    }
  });

  test("with more people than spots, nobody stands inside someone else or the furniture", () => {
    const spots = [...assignStandingSpots(ids, sameSpot).values()];
    for (let i = 0; i < spots.length; i++) {
      expect(clearToStand(spots[i]!.point)).toBe(true);
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.point[0] - spots[j]!.point[0], spots[i]!.point[1] - spots[j]!.point[1])).toBeGreaterThan(0.6);
      }
    }
    expect(new Set(spots.slice(0, STANDING_SPOTS.length).map((s) => s.point.join()))).toHaveProperty("size", STANDING_SPOTS.length);
  });

  test("earlier arrivals keep their place when someone new comes", () => {
    const before = assignStandingSpots(ids.slice(0, 20), (id) => id.length * 7);
    const after = assignStandingSpots(ids.slice(0, 21), (id) => id.length * 7);
    for (const [id, spot] of before) expect(after.get(id)).toEqual(spot);
  });
});

describe("warung stools for a coffee break", () => {
  test("every stool exists, and the counter spot keeps clear of their sitters", () => {
    for (const id of WARUNG_STOOLS) {
      const s = SEAT_PLACES[id]!;
      expect(s.style).toBe("stool");
      expect(Math.hypot(s.hip[0] - COUNTER.point[0], s.hip[2] - COUNTER.point[1])).toBeGreaterThan(0.6);
    }
  });

  test("hands out free stools nearest the counter first, skips homes and keeps earlier hand-outs", () => {
    const current = new Map<string, string>();
    assignWarungStools(["a", "b"], new Set(["stool-2"]), current);
    expect(Object.fromEntries(current)).toEqual({ a: "stool-1", b: "stool-3" });
    assignWarungStools(["c", "a", "b"], new Set(["stool-2"]), current);
    expect(Object.fromEntries(current)).toEqual({ a: "stool-1", b: "stool-3", c: "stool-4" });
  });

  test("takes a stool back when it becomes a home or its drinker goes back", () => {
    const current = new Map<string, string>([
      ["a", "stool-2"],
      ["b", "stool-1"],
    ]);
    assignWarungStools(["b"], new Set(["stool-1"]), current);
    expect(Object.fromEntries(current)).toEqual({ b: "stool-2" });
  });

  test("nobody gets a stool when all four are homes", () => {
    const current = new Map<string, string>();
    assignWarungStools(["a"], new Set(WARUNG_STOOLS), current);
    expect(current.size).toBe(0);
  });
});

describe("re-planning a walk midway", () => {
  test("someone halfway along an edge carries on instead of turning back to the node just passed", () => {
    // Between the curb and the gate, heading for a back bench: the old route went back to the curb first.
    const seat = SEAT_PLACES["bench-1a"]!;
    const path = planPath([-7.6, 4.6], seat.approach, seat.node);
    const first = path[1]!;
    expect(first[0]).toBeGreaterThan(-7.6);
  });
});

describe("shared geometry constants", () => {
  test("one source for car lengths and seat heights", () => {
    expect(CAR_LENGTH.sedan).toBe(2 * CAR_HALF_LENGTH.sedan);
    expect(CAR_LENGTH.hatch).toBe(2 * CAR_HALF_LENGTH.hatch);
    expect(CAR_LENGTH).toEqual({ sedan: 4.45, hatch: 3.8 });
    for (const seat of seats) {
      if (seat.style === "bench") expect(seat.hip[1]).toBe(BENCH_Y);
      if (seat.style === "stool") expect(seat.hip[1]).toBe(STOOL_Y);
      if (seat.style === "hood") expect(seat.hip[1]).toBeGreaterThan(CLIP_SEAT_Y);
    }
    // Pak Joko's stool is one of the warung's, and the clips' reference seat is lower than any real bench here.
    expect(OWNER_STOOL[1]).toBe(STOOL_Y);
    expect(CLIP_SEAT_Y).toBeLessThanOrEqual(BENCH_Y);
  });
});
