import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { FOOTPATH_X, NODES, STANDING_SPOTS, STREET, STREET_POLES, solidAt, type Vec2 } from "../layout.ts";
import {
  CART_FOOTPRINT,
  CART_IN_MS,
  CART_PASS_MS,
  CART_ROUTE,
  CART_SLOT_MS,
  CART_STOP_MS,
  VENDOR_BEHIND,
  cartAt,
  cartPassAt,
  isCartHour,
  vendorAt,
  type CartPass,
} from "./foodCart.ts";

const PASS: CartPass = { kind: "bakso", start: 0 };
const BODY_R = 0.3;
const POLE_R = 0.14;
/** The lot-side kerbs (Ground.tsx: 0.22 wide at x −6.62, a gap for the driveway at the gate). */
const KERBS = [
  { x0: -6.73, x1: -6.51, z0: -5.7, z1: 3.6 },
  { x0: -6.73, x1: -6.51, z0: 5.4, z1: 6.0 },
];
/** The walkers' way into the lot past the stop. */
const GATE_SEGMENT: [Vec2, Vec2] = [NODES.gate!, NODES.westAisle!];
const AISLE_SEGMENT: [Vec2, Vec2] = [NODES.westAisle!, NODES.backW!];

const segDist = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const boxDist = (p: Vec2, k: (typeof KERBS)[number]): number => Math.hypot(Math.max(k.x0 - p[0], 0, p[0] - k.x1), Math.max(k.z0 - p[1], 0, p[1] - k.z1));
const insideBox = (p: Vec2, k: (typeof KERBS)[number]): boolean => p[0] > k.x0 && p[0] < k.x1 && p[1] > k.z0 && p[1] < k.z1;

/** The cart's footprint at `now`, as a grid of points 5 cm apart (outline and inside), and the vendor's feet. */
function footprint(pass: CartPass, now: number): { cart: Vec2[]; vendor: Vec2 } {
  const c = cartAt(pass, now);
  const { halfWidth, back, front } = CART_FOOTPRINT;
  const cart: Vec2[] = [];
  const nx = Math.ceil((2 * halfWidth) / 0.05);
  const nz = Math.ceil((back + front) / 0.05);
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = -halfWidth + (2 * halfWidth * i) / nx;
      const lz = -back + ((back + front) * j) / nz;
      cart.push([c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw), c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw)]);
    }
  }
  const v = vendorAt(pass, now);
  return { cart, vendor: [v.x, v.z] };
}

/** Smallest clearances (m) over `times`: negative is an overlap. */
function clearances(times: number[]) {
  const out = { poles: Infinity, kerb: Infinity, road: Infinity, spots: Infinity, gate: Infinity, aisle: Infinity, solid: true };
  for (const t of times) {
    const { cart, vendor } = footprint(PASS, t);
    const parts: [Vec2[], number][] = [
      [cart, 0],
      [[vendor], BODY_R],
    ];
    for (const [points, r] of parts) {
      for (const p of points) {
        for (const pole of STREET_POLES) out.poles = Math.min(out.poles, Math.hypot(p[0] - pole.x, p[1] - pole.z) - POLE_R - r);
        for (const k of KERBS) out.kerb = Math.min(out.kerb, insideBox(p, k) ? -1 : boxDist(p, k) - r);
        out.road = Math.min(out.road, p[0] - r - STREET.maxX);
        for (const s of STANDING_SPOTS) out.spots = Math.min(out.spots, Math.hypot(p[0] - s.point[0], p[1] - s.point[1]) - BODY_R - r);
        out.gate = Math.min(out.gate, segDist(p, ...GATE_SEGMENT) - BODY_R - r);
        out.aisle = Math.min(out.aisle, segDist(p, ...AISLE_SEGMENT) - BODY_R - r);
        // solidAt's own radii: props 0.3, poles of the awning 0.15, furniture and cars as boxes.
        if (solidAt(p, r)) out.solid = false;
      }
    }
  }
  return out;
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};

describe("food carts", () => {
  test("one pass per 5-minute slot at most, the same for everyone, inside its slot", () => {
    expect(CART_SLOT_MS).toBe(5 * 60_000);
    expect(CART_PASS_MS).toBeLessThan(CART_SLOT_MS);
    let busy = 0;
    const kinds = new Set<string>();
    const slots = 48;
    for (let t = 0; t < slots * CART_SLOT_MS; t += 1000) {
      const p = cartPassAt(t);
      if (!p) continue;
      busy += 1000;
      kinds.add(p.kind);
      expect(cartPassAt(t)).toEqual(p);
      const slot = Math.floor(t / CART_SLOT_MS);
      expect(Math.floor(p.start / CART_SLOT_MS)).toBe(slot);
      expect(p.start + CART_PASS_MS).toBeLessThanOrEqual((slot + 1) * CART_SLOT_MS);
    }
    expect(busy / slots).toBeCloseTo(CART_PASS_MS, -3);
    expect(kinds).toEqual(new Set(["bakso", "nasgor"]));
  });

  test("hours per mode: evenings from 17:00 to 01:00, all day, or never", () => {
    for (const [hour, evening] of [
      [16.99, false],
      [17, true],
      [19, true],
      [23.9, true],
      [0.5, true],
      [1, false],
      [12, false],
    ] as const) {
      expect(isCartHour(hour)).toBe(evening);
      expect(isCartHour(hour, "evening")).toBe(evening);
      expect(isCartHour(hour, "allDay")).toBe(true);
      expect(isCartHour(hour, "off")).toBe(false);
    }
  });

  test("walks in from the north, stops 45 s, backs out, turns round and walks back north", () => {
    const { x, zFar, zStop } = CART_ROUTE;
    expect(cartAt(PASS, 0)).toMatchObject({ x, z: zFar, yaw: Math.PI, phase: "in" });
    expect(cartAt(PASS, 10_000).z).toBeCloseTo(zFar - 8);
    expect(cartAt(PASS, CART_IN_MS - 1).phase).toBe("in");
    for (const t of [CART_IN_MS, CART_IN_MS + CART_STOP_MS / 2, CART_IN_MS + CART_STOP_MS - 1]) {
      expect(cartAt(PASS, t)).toMatchObject({ x, z: zStop, yaw: Math.PI, phase: "stop" });
    }
    expect(cartAt(PASS, CART_IN_MS + CART_STOP_MS + 1).phase).toBe("out");
    const end = cartAt(PASS, CART_PASS_MS);
    expect(end.x).toBeCloseTo(x);
    expect(end.z).toBeCloseTo(zFar);
    expect(Math.cos(end.yaw)).toBeCloseTo(1);
    // Never further south than the stop, and the walk is continuous (no jumps between phases).
    let prev = cartAt(PASS, 0);
    for (let t = 50; t <= CART_PASS_MS; t += 50) {
      const c = cartAt(PASS, t);
      expect(c.z).toBeGreaterThanOrEqual(zStop - 1e-9);
      expect(Math.hypot(c.x - prev.x, c.z - prev.z)).toBeLessThan(0.06);
      prev = c;
    }
  });

  test("the vendor pushes from behind the handles, and faces the lot while the cart stands", () => {
    const walking = vendorAt(PASS, 5000);
    const cart = cartAt(PASS, 5000);
    expect(walking.clip).toBe("push");
    expect(walking.yaw).toBe(cart.yaw);
    expect(Math.hypot(walking.x - cart.x, walking.z - cart.z)).toBeCloseTo(VENDOR_BEHIND);
    expect(walking.z).toBeGreaterThan(cart.z);
    const standing = vendorAt(PASS, CART_IN_MS + CART_STOP_MS / 2);
    expect(standing.clip).toBe("standIdle");
    expect(standing.yaw).toBeCloseTo(Math.PI / 2);
    // Back at the handles before setting off again.
    expect(vendorAt(PASS, CART_IN_MS + CART_STOP_MS - 1).yaw).toBeCloseTo(Math.PI, 2);
    const leaving = vendorAt(PASS, CART_PASS_MS - 1000);
    expect(leaving.clip).toBe("push");
    expect(leaving.z).toBeLessThan(cartAt(PASS, CART_PASS_MS - 1000).z);
    // The stride keeps going while walking (backing counts down), so the walk cycle never jumps.
    let prev = vendorAt(PASS, 0).stride;
    for (let t = 100; t <= CART_PASS_MS; t += 100) {
      const s = vendorAt(PASS, t).stride;
      expect(Math.abs(s - prev)).toBeLessThan(0.15);
      prev = s;
    }
  });

  test("on the near footpath, off the road", () => {
    expect(Math.abs(CART_ROUTE.x - FOOTPATH_X)).toBeLessThan(0.2);
    expect(CART_ROUTE.x - CART_FOOTPRINT.halfWidth).toBeGreaterThan(STREET.maxX);
  });

  test("clear of the poles, the kerb, the road, the standing spots and anything solid, all the way (every 0.1 m)", () => {
    // 100 ms steps: under 0.1 m for the cart (0.8 m/s) and for the vendor swinging round the axle.
    const c = clearances(range(0, CART_PASS_MS, 100));
    expect(c.solid).toBe(true);
    expect(c.poles).toBeGreaterThanOrEqual(0.05);
    expect(c.kerb).toBeGreaterThanOrEqual(0.015);
    expect(c.road).toBeGreaterThan(0);
    expect(c.spots).toBeGreaterThanOrEqual(0.015);
  });

  test("at the stop: clear of everything, and of the walkers' way in through the gate", () => {
    const c = clearances(range(CART_IN_MS, CART_IN_MS + CART_STOP_MS, 500));
    expect(c.solid).toBe(true);
    expect(c.kerb).toBeGreaterThanOrEqual(0.015);
    expect(c.spots).toBeGreaterThan(1);
    expect(c.gate).toBeGreaterThanOrEqual(0.05);
    // The west strip (kerb at −6.51, walkers' aisle at −5.5 with 0.3 m bodies) is 0.06 m narrower than the cart:
    // the cart's lot-side edge reaches 0.08 m into a passing walker's 0.3 m; the vendor himself stays clear.
    expect(c.aisle).toBeGreaterThan(-0.1);
    const vendor = vendorAt(PASS, CART_IN_MS + CART_STOP_MS / 2);
    expect(segDist([vendor.x, vendor.z], ...AISLE_SEGMENT) - 2 * BODY_R).toBeGreaterThanOrEqual(0);
  });

  test("the turn happens away from the walkers' way in through the gate", () => {
    const turn = range(CART_IN_MS + CART_STOP_MS, CART_PASS_MS, 100).filter((t) => {
      const c = cartAt(PASS, t);
      return Math.sin(c.yaw) < -1e-6;
    });
    expect(turn.length).toBeGreaterThan(10);
    expect(clearances(turn).gate).toBeGreaterThan(1);
  });

  test("the default camera sees the whole cart and the vendor at the stop (16:10 and 16:9)", () => {
    const t = CART_IN_MS + CART_STOP_MS / 2;
    const c = cartAt(PASS, t);
    const v = vendorAt(PASS, t);
    const { halfWidth, back, front } = CART_FOOTPRINT;
    const points: [number, number, number][] = [];
    for (const lx of [-halfWidth, halfWidth]) {
      for (const lz of [-back, front]) {
        for (const y of [0, 1.85]) points.push([c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw), y, c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw)]);
      }
    }
    points.push([v.x, 1.8, v.z]);
    for (const dx of [-0.15, 0.15]) for (const dz of [-0.15, 0.15]) points.push([v.x + dx, 0, v.z + dz]);
    for (const aspect of [16 / 10, 16 / 9]) {
      // As Scene.tsx sets it up: fov 36, the default position, looking at the default target.
      const camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 120);
      camera.position.set(-5.0, 6.2, 10.6);
      camera.lookAt(0, 0.9, -3.0);
      camera.updateMatrixWorld();
      const margin = Math.min(...points.map((p) => 1 - Math.max(...new THREE.Vector3(...p).project(camera).toArray().slice(0, 2).map(Math.abs))));
      expect(margin).toBeGreaterThanOrEqual(0.01);
    }
  });
});
