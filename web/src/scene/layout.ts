// World layout in metres. X right, Y up, Z towards the default camera. Street runs along the left (−X) edge.
// yaw 0 faces +Z; forward = (sin yaw, 0, cos yaw).

export type Vec2 = readonly [number, number];
export type SeatStyle = "bench" | "stool" | "hood";

export interface SeatPlace {
  id: string;
  style: SeatStyle;
  /** Hip joint position over the seat (x, z) and the seat surface height (y). */
  hip: readonly [number, number, number];
  yaw: number;
  /** Where the feet are: the character's root while sitting down, seated and standing up. */
  approach: Vec2;
  /** Graph node the approach spot connects to. */
  node: string;
}

export const LOT = { minX: -6.4, maxX: 7.5, minZ: -5.7, maxZ: 5.6 } as const;
export const STREET = { minX: -11.5, maxX: -6.8 } as const;
/** The lot's back wall, and the houses behind it: set back to leave a gap for the toren. */
export const BACK_WALL_Z = LOT.minZ - 0.1;
export const HOUSE_DEPTH = 4;
export const HOUSE_Z = BACK_WALL_Z - 4.2;
export const HOUSE_FRONT_Z = HOUSE_Z + HOUSE_DEPTH / 2;
/** Pedestrians come and go along the gang's street edge, off the road (cars and ojek fill the lanes). */
const FOOTPATH_X = -6.25;
/** Power/lamp poles on the lot-side kerb (base radius 0.14), clear of the near lane's mirrors and ojek. */
export const STREET_POLES = [
  { x: -6.72, z: -6.15 },
  { x: -6.72, z: 6.45 },
  { x: -6.72, z: 19 },
  { x: -6.72, z: -18.7 },
] as const;
/**
 * Tree trunks stand off the road (on the far pavement or behind the lots); canopies may overhang it. Only trees whose
 * shadow can reach the lot (`shadow`) pay for leaves in the shadow pass.
 */
export const TREE_SPOTS = [
  { x: -12.6, z: -9.6, height: 8.5, preset: "Oak Medium", seed: 11, tint: 0x5f8a45, shadow: true },
  { x: 6.8, z: -10.2, height: 7.5, preset: "Ash Medium", seed: 23, tint: 0x6a9a4a, shadow: false },
  { x: -14.5, z: 6.5, height: 9.5, preset: "Oak Large", seed: 37, tint: 0x557f3e, shadow: false },
  { x: -15.5, z: -6.5, height: 8, preset: "Ash Medium", seed: 41, tint: 0x5f8a45, shadow: false },
  { x: 12.5, z: -4.5, height: 7, preset: "Oak Medium", seed: 53, tint: 0x6a9a4a, shadow: true },
] as const;
export const WALK_SPEED = 1.25;

/** Seated hips sit this far behind the feet in the sitting clips (clips.json sitHips, checked by rig.test.ts). */
export const SIT_ROOT_BACK = 0.28;
/** Seat height the sitting clips were made for; higher seats lift the whole character. */
export const CLIP_SEAT_Y = 0.45;
const BENCH_Z = -4.85;
const BENCH_Y = 0.47;
const STOOL_X = 2.45;
const STOOL_Y = 0.445;
// Perched on the rounded front edge of the hood (nose at z ≈ 3.42, 0.5 m high): the legs, stretched to the ground by the
// leg IK, then pass in front of the bumper. Sitting further back on the high hood, legs that reach the ground would have
// to go through it. HOOD_Y is the hood top where the buttocks rest, a few cm behind the hip joint.
export const HOOD_Z = 3.37;
const HOOD_Y = 0.7;
const ahead = (x: number, z: number, yaw: number): Vec2 => [x + Math.sin(yaw) * SIT_ROOT_BACK, z + Math.cos(yaw) * SIT_ROOT_BACK];

export const BENCHES = [
  { x: -3.6, z: BENCH_Z },
  { x: -0.9, z: BENCH_Z },
] as const;

// Parked nose-out; `z` puts each hood's front edge under the hood seat.
export const CARS = [
  { x: -3.8, z: 1.2, yaw: 0, color: "#7d1a1c", model: "sedan", plate: "B 1729 KJT" },
  { x: -0.6, z: 1.52, yaw: 0, color: "#b9bec4", model: "hatch", plate: "B 2481 TZN" },
] as const;

export const COVERED_CAR = { x: 3.7, z: 2.6, yaw: 0.12 } as const;
/** Bumper to bumper, halved, per car model (Vehicles.tsx). */
const CAR_HALF_LENGTH = { sedan: 2.225, hatch: 1.9 } as const;
/** Side by side, nose out, staggered so handlebars and mirrors never meet. */
export const PARKED_SCOOTERS = [
  { x: 1.3, z: 2.2, yaw: 0.06 },
  { x: 2.15, z: 1.95, yaw: -0.04 },
] as const;
export const GEROBAK = { x: 0.75, z: -5.05 } as const;

export const WARUNG = { minX: 3.4, maxX: 7.5, minZ: -5.7, maxZ: -1.7, awningX: 1.55 } as const;
/** Bamboo poles holding the awning's outer edge (x, z). */
export const AWNING_POLES: readonly Vec2[] = [
  [WARUNG.awningX + 0.05, WARUNG.minZ + 0.3],
  [WARUNG.awningX + 0.05, WARUNG.maxZ - 0.3],
];

export const NODES: Record<string, Vec2> = {
  street: [FOOTPATH_X, 12],
  curb: [FOOTPATH_X, 6.2],
  gate: [-6.1, 4.6],
  frontW: [-3.8, 4.6],
  frontGap: [-2.2, 4.6],
  frontM: [-0.6, 4.6],
  frontE: [1.4, 4.6],
  midAisle: [-2.2, 1.2],
  westAisle: [-5.5, 1.0],
  backW: [-5.5, -2.7],
  backM: [-2.2, -2.7],
  backE: [0.9, -2.7],
  warung: [1.45, -1.55],
  // At the serving window between stools 1 and 2, behind their sitters' backs.
  counter: [2.95, -3.95],
  counterIn: [1.15, -3.95],
  // One lane per stool, outside the awning poles: people walk in straight at their own stool instead of cutting
  // diagonally through the knees of whoever already sits on the stools in between.
  stoolIn1: [1.15, -4.55],
  stoolIn2: [1.15, -3.35],
  // Offset from its stool: the awning pole stands right in front of stool 3.
  stoolIn3: [1.15, -2.55],
  stoolIn4: [1.15, -0.6],
};

const EDGES: [string, string][] = [
  ["street", "curb"],
  ["curb", "gate"],
  ["gate", "frontW"],
  ["frontW", "frontGap"],
  ["frontGap", "frontM"],
  ["frontM", "frontE"],
  ["frontGap", "midAisle"],
  ["midAisle", "backM"],
  ["gate", "westAisle"],
  ["westAisle", "backW"],
  ["backW", "backM"],
  ["backM", "backE"],
  ["backE", "warung"],
  ["backE", "counterIn"],
  ["counterIn", "counter"],
  ["counterIn", "stoolIn1"],
  ["counterIn", "stoolIn2"],
  ["backE", "stoolIn1"],
  ["backE", "stoolIn2"],
  ["backE", "stoolIn3"],
  ["warung", "stoolIn4"],
];

/** The counter spot where a compacting character buys kopi; faces the warung. */
export const COUNTER = { point: NODES.counter!, yaw: Math.PI / 2, node: "counter" } as const;

export const SEAT_PLACES: Record<string, SeatPlace> = Object.fromEntries(
  [
    ...BENCHES.flatMap((b, i) =>
      (["a", "b"] as const).map((side) => {
        const x = b.x + (side === "a" ? -0.42 : 0.42);
        return {
          id: `bench-${i + 1}${side}`,
          style: "bench" as const,
          hip: [x, BENCH_Y, b.z + 0.12] as const,
          yaw: 0,
          approach: ahead(x, b.z + 0.12, 0),
          node: i === 0 ? "backW" : "backM",
        };
      }),
    ),
    ...[-4.55, -2.15, -3.35, -0.6].map((z, i) => ({
      id: `stool-${[1, 3, 2, 4][i]}`,
      style: "stool" as const,
      hip: [STOOL_X, STOOL_Y, z] as const,
      yaw: -Math.PI / 2,
      approach: ahead(STOOL_X, z, -Math.PI / 2),
      node: `stoolIn${[1, 3, 2, 4][i]}`,
    })),
    ...CARS.map((c, i) => ({
      id: `hood-${i + 1}`,
      style: "hood" as const,
      hip: [c.x, HOOD_Y, HOOD_Z] as const,
      yaw: 0,
      approach: ahead(c.x, HOOD_Z, 0),
      node: i === 0 ? "frontW" : "frontM",
    })),
  ].map((s) => [s.id, s]),
);

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Small props on the ground a standing person keeps clear of (x, z). */
const PROPS_ON_GROUND: readonly Vec2[] = [
  [-2.25, -5.3], [-5.9, -1.6], [LOT.minX + 0.35, -5.5], [-5.95, -5.25], [2.15, -5.35], [7.05, -0.6], [6.95, 4.6], [6.85, 3.9], [5.2, -1.25], [3.35, -1.95],
];
/** Half the width of a standing person with the laptop under the arm (m). */
const BODY_R = 0.3;

const insideBox = (p: Vec2, x0: number, x1: number, z0: number, z1: number, margin: number): boolean =>
  p[0] > x0 - margin && p[0] < x1 + margin && p[1] > z0 - margin && p[1] < z1 + margin;

/** Whether `p` is inside something solid (a parked vehicle, the warung, a bench, the gerobak, a pole or a prop). */
export function solidAt(p: Vec2, margin = BODY_R): boolean {
  for (const c of CARS) if (insideBox(p, c.x - 1, c.x + 1, c.z - CAR_HALF_LENGTH[c.model], c.z + CAR_HALF_LENGTH[c.model], margin + 0.1)) return true;
  if (insideBox(p, COVERED_CAR.x - 1.05, COVERED_CAR.x + 1.05, COVERED_CAR.z - 2.45, COVERED_CAR.z + 2.45, margin + 0.1)) return true;
  for (const m of PARKED_SCOOTERS) if (insideBox(p, m.x - 0.4, m.x + 0.4, m.z - 0.95, m.z + 0.95, margin)) return true;
  if (insideBox(p, WARUNG.minX, WARUNG.maxX, WARUNG.minZ, WARUNG.maxZ, margin)) return true;
  for (const b of BENCHES) if (insideBox(p, b.x - 0.95, b.x + 0.95, b.z - 0.35, b.z + 0.35, margin)) return true;
  if (insideBox(p, GEROBAK.x - 1, GEROBAK.x + 1, GEROBAK.z - 0.55, GEROBAK.z + 0.55, margin)) return true;
  if (AWNING_POLES.some((pole) => dist(p, pole) < margin + 0.15)) return true;
  return PROPS_ON_GROUND.some((q) => dist(p, q) < margin + 0.3);
}

/**
 * Whether someone can stand at `p`: inside the lot, nothing solid there, not inside a seated person (hips, knees,
 * feet) and not blocking the stools under the awning.
 */
export function clearToStand(p: Vec2): boolean {
  if (!insideBox(p, LOT.minX + 0.4, LOT.maxX - 0.45, LOT.minZ + 0.45, LOT.maxZ - 0.5, 0)) return false;
  if (solidAt(p) || insideBox(p, WARUNG.awningX - 0.6, WARUNG.minX, WARUNG.minZ, WARUNG.maxZ, 0.1)) return false;
  return Object.values(SEAT_PLACES).every((seat) => {
    const hip: Vec2 = [seat.hip[0], seat.hip[2]];
    const feet: Vec2 = [seat.hip[0] + Math.sin(seat.yaw) * 0.55, seat.hip[2] + Math.cos(seat.yaw) * 0.55];
    return dist(p, hip) >= 0.85 && dist(p, feet) >= 0.7 && dist(p, seat.approach) >= 0.6;
  });
}

/** Standing people watch the middle of the lot. */
const WATCH_POINT: Vec2 = [-1, 0.8];
const watching = (point: Vec2, node: string) => ({ point, node, yaw: Math.atan2(WATCH_POINT[0] - point[0], WATCH_POINT[1] - point[1]) });

/**
 * Where people stand when no seat is free (sessions and subagent friends): each clear to stand (`clearToStand`), off
 * the walking lanes, 1.5 m or more apart, reached in a straight line from its graph node without walking through
 * anything solid (all checked in layout.test.ts).
 */
export const STANDING_SPOTS: { point: Vec2; yaw: number; node: string }[] = [
  watching([-5.4, 3.8], "gate"),
  watching([-3.0, 4.0], "frontW"),
  watching([0.2, 4.0], "frontM"),
  watching([1.8, 4.2], "frontE"),
  watching([-5.9, -3.0], "backW"),
  watching([-5.7, -4.5], "backW"),
  watching([-0.1, -1.4], "backE"),
  watching([0.4, -3.4], "stoolIn2"),
  watching([-2.8, -2.0], "backM"),
  watching([-1.6, -0.8], "backM"),
  watching([1.2, 0.0], "stoolIn4"),
  // By the warung's corner and in front of the graffiti.
  watching([3.0, -1.4], "warung"),
  watching([4.4, -0.6], "warung"),
  watching([6.4, 0.2], "warung"),
];

const ADJ = new Map<string, string[]>();
for (const [a, b] of EDGES) {
  ADJ.set(a, [...(ADJ.get(a) ?? []), b]);
  ADJ.set(b, [...(ADJ.get(b) ?? []), a]);
}

function nearestNode(p: Vec2): string {
  let best = "gate";
  let bestD = Infinity;
  for (const [id, q] of Object.entries(NODES)) {
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function shortestNodePath(from: string, to: string): string[] {
  const d = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size > 0) {
    let u = "";
    let du = Infinity;
    for (const n of open) {
      const v = d.get(n) ?? Infinity;
      if (v < du) {
        du = v;
        u = n;
      }
    }
    open.delete(u);
    if (u === to) break;
    for (const v of ADJ.get(u) ?? []) {
      const alt = du + dist(NODES[u]!, NODES[v]!);
      if (alt < (d.get(v) ?? Infinity)) {
        d.set(v, alt);
        prev.set(v, u);
        open.add(v);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]!);
    if (p === undefined) return [from, to];
    path.unshift(p);
  }
  return path;
}

/** Polyline from `from` to `to` through the waypoint graph; `fromNode`/`toNode` default to the nearest nodes. */
function pathLength(nodes: readonly string[]): number {
  let total = 0;
  for (let i = 1; i < nodes.length; i++) total += dist(NODES[nodes[i - 1]!]!, NODES[nodes[i]!]!);
  return total;
}

/**
 * Where a walk re-planned midway joins the graph: the nearest node, or one of its neighbours when that makes the trip
 * shorter, so someone halfway along an edge carries on instead of turning back to the node just passed.
 */
function entryNode(p: Vec2, toNode: string): string {
  const near = nearestNode(p);
  let best = near;
  let bestCost = dist(p, NODES[near]!) + pathLength(shortestNodePath(near, toNode));
  for (const n of ADJ.get(near) ?? []) {
    const cost = dist(p, NODES[n]!) + pathLength(shortestNodePath(n, toNode));
    if (cost < bestCost - 1e-6) {
      best = n;
      bestCost = cost;
    }
  }
  return best;
}

export function planPath(from: Vec2, to: Vec2, toNode?: string, fromNode?: string): Vec2[] {
  const b = toNode ?? nearestNode(to);
  const a = fromNode ?? entryNode(from, b);
  const pts: Vec2[] = [from, ...shortestNodePath(a, b).map((n) => NODES[n]!), to];
  const out: Vec2[] = [];
  for (const p of pts) if (out.length === 0 || dist(out[out.length - 1]!, p) > 0.05) out.push(p);
  return out;
}

export type StandingSpot = (typeof STANDING_SPOTS)[number];

export function standingSpotFor(hash: number): StandingSpot {
  return STANDING_SPOTS[hash % STANDING_SPOTS.length]!;
}

/** The standing spot nearest to `p`, as an index into STANDING_SPOTS. */
export function nearestStandingSpot(p: Vec2): number {
  let best = 0;
  for (let i = 1; i < STANDING_SPOTS.length; i++) if (dist(p, STANDING_SPOTS[i]!.point) < dist(p, STANDING_SPOTS[best]!.point)) best = i;
  return best;
}

/** Side step between people sharing a standing spot once every spot is taken (m). */
const CROWD_STEP = 0.75;
/** Closest two standing people get. */
const CROWD_GAP = 0.65;

/**
 * Standing places for seatless people, `ids` in arrival order: each takes its preferred spot (`prefer` gives an index)
 * or the next free one, so nobody stands inside someone else; once all spots are taken, newcomers line up beside the
 * preferred spot, on the first places that are clear to stand and clear of everyone already standing. Earlier arrivals
 * never move when someone new comes.
 */
export function assignStandingSpots(ids: readonly string[], prefer: (id: string) => number): Map<string, StandingSpot> {
  const out = new Map<string, StandingSpot>();
  const free = new Set(STANDING_SPOTS.keys());
  const placed: Vec2[] = [];
  for (const id of ids) {
    const preferred = ((prefer(id) % STANDING_SPOTS.length) + STANDING_SPOTS.length) % STANDING_SPOTS.length;
    let index = -1;
    for (let k = 0; k < STANDING_SPOTS.length && index < 0; k++) {
      const i = (preferred + k) % STANDING_SPOTS.length;
      if (free.has(i)) index = i;
    }
    if (index >= 0) {
      free.delete(index);
      const spot = STANDING_SPOTS[index]!;
      out.set(id, spot);
      placed.push(spot.point);
      continue;
    }
    // Every spot taken: line up beside the preferred one (alternating sides along the line its people face across,
    // then a row behind and in front), else beside the next spots; the first place clear of furniture and people wins.
    let spot = STANDING_SPOTS[preferred]!;
    let point: Vec2 = spot.point;
    search: for (let k = 0; k < STANDING_SPOTS.length; k++) {
      const s = STANDING_SPOTS[(preferred + k) % STANDING_SPOTS.length]!;
      const across: Vec2 = [Math.cos(s.yaw), -Math.sin(s.yaw)];
      const back: Vec2 = [-Math.sin(s.yaw), -Math.cos(s.yaw)];
      for (const row of [0, 1, -1]) {
        for (let n = row === 0 ? 1 : 0; n <= 4; n++) {
          const side = (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2) * CROWD_STEP;
          const p: Vec2 = [s.point[0] + across[0] * side + back[0] * row * CROWD_STEP, s.point[1] + across[1] * side + back[1] * row * CROWD_STEP];
          if (clearToStand(p) && placed.every((q) => dist(p, q) >= CROWD_GAP)) {
            spot = s;
            point = p;
            break search;
          }
        }
      }
    }
    out.set(id, { ...spot, point });
    placed.push(point);
  }
  return out;
}

export const SPAWN_POINT: Vec2 = NODES.street!;
export const DESPAWN_POINT: Vec2 = [FOOTPATH_X, 13.2];

/** Warung stools, nearest the counter first: a compacting person borrows the first one nobody calls home. */
export const WARUNG_STOOLS = ["stool-2", "stool-1", "stool-3", "stool-4"] as const;

/**
 * Hands each compacting person (`goers`, in the order they set off) a free warung stool, keeping earlier hand-outs in
 * `current`; a stool that becomes someone's home is taken back.
 */
export function assignWarungStools(goers: readonly string[], homes: ReadonlySet<string>, current: Map<string, string>): void {
  const going = new Set(goers);
  for (const [key, stool] of current) if (!going.has(key) || homes.has(stool)) current.delete(key);
  const taken = new Set(current.values());
  for (const key of goers) {
    if (current.has(key)) continue;
    const free = WARUNG_STOOLS.find((id) => !homes.has(id) && !taken.has(id));
    if (!free) break;
    current.set(key, free);
    taken.add(free);
  }
}
