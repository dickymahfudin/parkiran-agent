// When a food cart calls at the lot (evenings by default): at most one pass per 5-minute slot, each slot seeded by its
// index so every viewer sees the same street. The vendor pushes the cart down the near footpath from the north (the
// way people walk in), through the gate's driveway gap, and stops in the lot's west strip, in the default camera's
// view. The strip is too narrow to turn a cart round (kerb on one side, the walkers' aisle, the parked car and the
// props on the other), so he backs out to the mouth of the gang north of the lot, swings the cart round on its
// wheels there and walks it back north. Pure, unit tested; drawn by FoodCart.tsx.
import { hash32, rng } from "../characters/identity.ts";

export type CartKind = "bakso" | "nasgor";
/** When carts come round (the settings panel's choice). */
export type CartMode = "off" | "evening" | "allDay";
export type CartPhase = "in" | "stop" | "out";

export const CART_SLOT_MS = 5 * 60_000;
/** A vendor pushing a loaded cart: a slow walk (m/s). */
export const CART_SPEED = 0.8;
/** Backing out of the lot, pulling the cart by its handles (m/s). */
export const CART_BACK_SPEED = 0.5;
export const CART_STOP_MS = 45_000;
/** The vendor turning on the spot between the handles and the lot. */
export const VENDOR_FACE_MS = 600;

/** Body length of the cart (m); FoodCart.tsx builds it from this. */
export const CART_LENGTH = 1.15;
/** Vendor's feet behind the cart's centre (m): hands on the handles. */
export const VENDOR_BEHIND = CART_LENGTH / 2 + 0.62;
/** The wheel axle, ahead of the cart's centre (m): the cart pivots about it when it turns round. */
export const CART_AXLE_AHEAD = 0.3;
/**
 * The cart's footprint around its centre (m), as FoodCart.tsx draws it: the wheels (x ±0.36, tyre 0.025) set the
 * width, the ends of the handles (0.775 behind the centre, 0.42 long, tilted 0.12 rad) the back, the roof the front.
 */
export const CART_FOOTPRINT = { halfWidth: 0.385, back: 0.983, front: 0.675 } as const;

/**
 * x: on the lot side of the footpath, 0.02 m clear of the lot-side kerb (x −6.73…−6.51) and of the standing spot by the
 * gate (−5.4, 3.8, r 0.3), 0.09 m clear of the street poles (x −6.72, r 0.14). zStop: north of the prop at (−5.9, −1.6),
 * south of the gate→westAisle walkers' segment, and in view of the default camera at 16:10 and 16:9 (foodCart.test.ts).
 * zTurn: where the axle stands while the cart swings round, in the gang's mouth, clear of the gutter's kerb (z 6.0).
 */
export const CART_ROUTE = { x: -6.105, zFar: 26, zStop: -0.55, zTurn: 7.8 } as const;

/** Cart centre (z) just before and just after the turn: facing −z the axle is south of the centre, facing +z north. */
const Z_TURN_IN = CART_ROUTE.zTurn + CART_AXLE_AHEAD;
const Z_TURN_OUT = CART_ROUTE.zTurn - CART_AXLE_AHEAD;
export const CART_IN_MS = ((CART_ROUTE.zFar - CART_ROUTE.zStop) / CART_SPEED) * 1000;
const BACK_MS = ((Z_TURN_IN - CART_ROUTE.zStop) / CART_BACK_SPEED) * 1000;
const OUT_MS = ((CART_ROUTE.zFar - Z_TURN_OUT) / CART_SPEED) * 1000;
/** How far the vendor's feet travel while the cart swings round (m): half a circle round the axle. */
const TURN_ARC = Math.PI * (VENDOR_BEHIND + CART_AXLE_AHEAD);
/** Swinging the cart round on its wheels at the mouth of the gang, the vendor walking at the cart's pace. */
export const CART_TURN_MS = (TURN_ARC / CART_SPEED) * 1000;
const T_STOP = CART_IN_MS;
const T_BACK = T_STOP + CART_STOP_MS;
const T_TURN = T_BACK + BACK_MS;
const T_OUT = T_TURN + CART_TURN_MS;
/** The whole pass: walk in, stop, back out, turn round, walk away. */
export const CART_PASS_MS = T_OUT + OUT_MS;

export interface CartPass {
  kind: CartKind;
  /** Wall-clock start (ms). */
  start: number;
}

/** The pass of the slot `now` falls in, if a cart is on its way right now. */
export function cartPassAt(now: number): CartPass | null {
  const slot = Math.floor(now / CART_SLOT_MS);
  const r = rng(hash32(`cart:${slot}`));
  const start = slot * CART_SLOT_MS + r() * (CART_SLOT_MS - CART_PASS_MS);
  const pass: CartPass = { kind: r() < 0.5 ? "bakso" : "nasgor", start };
  return now >= start && now < start + CART_PASS_MS ? pass : null;
}

export interface CartPose {
  x: number;
  z: number;
  /** Facing (yaw 0 faces +z): the walking direction on the way in and out; along the footpath (south) while stopped. */
  yaw: number;
  phase: CartPhase;
  /** Seconds since the pass started. */
  walked: number;
}

const ease = (u: number): number => u * u * (3 - 2 * u);
const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));

/** Where the cart is, which way it faces and what it is doing. */
export function cartAt(pass: CartPass, now: number): CartPose {
  const t = Math.max(0, Math.min(now - pass.start, CART_PASS_MS));
  const walked = t / 1000;
  const { x, zFar, zStop, zTurn } = CART_ROUTE;
  if (t < T_STOP) return { x, z: zFar - (t / 1000) * CART_SPEED, yaw: Math.PI, phase: "in", walked };
  if (t < T_BACK) return { x, z: zStop, yaw: Math.PI, phase: "stop", walked };
  if (t < T_TURN) return { x, z: zStop + ((t - T_BACK) / 1000) * CART_BACK_SPEED, yaw: Math.PI, phase: "out", walked };
  if (t < T_OUT) {
    // Round the axle from facing south to facing north, the handles (and the vendor) swinging out over the gang (+x).
    const yaw = Math.PI + (Math.PI * (t - T_TURN)) / CART_TURN_MS;
    return { x: x - CART_AXLE_AHEAD * Math.sin(yaw), z: zTurn - CART_AXLE_AHEAD * Math.cos(yaw), yaw, phase: "out", walked };
  }
  return { x, z: Z_TURN_OUT + ((t - T_OUT) / 1000) * CART_SPEED, yaw: 0, phase: "out", walked };
}

export interface VendorPose {
  x: number;
  z: number;
  yaw: number;
  clip: "push" | "standIdle";
  /** Signed distance the feet have walked (m, backwards counts down): drives the walk cycle. */
  stride: number;
  /** Seconds standing at the stop: drives the idle clip. */
  idle: number;
  /** 0…1 crossfade weight of `clip` against the other clip (1 = fully `clip`). */
  blend: number;
}

/** Turning on the spot to face the lot while the cart stands, and back to the handles before setting off. */
const FACE_LOT = Math.PI / 2;
const BLEND_MS = 300;

/** The vendor: behind the handles while the cart moves, turned to the lot (+x) while it stands. */
export function vendorAt(pass: CartPass, now: number): VendorPose {
  const cart = cartAt(pass, now);
  const t = Math.max(0, Math.min(now - pass.start, CART_PASS_MS));
  const x = cart.x - Math.sin(cart.yaw) * VENDOR_BEHIND;
  const z = cart.z - Math.cos(cart.yaw) * VENDOR_BEHIND;
  const inLength = CART_ROUTE.zFar - CART_ROUTE.zStop;
  const backLength = Z_TURN_IN - CART_ROUTE.zStop;
  if (t < T_STOP) return { x, z, yaw: cart.yaw, clip: "push", stride: (t / 1000) * CART_SPEED, idle: 0, blend: 1 };
  if (t < T_BACK) {
    const s = t - T_STOP;
    const left = T_BACK - t;
    const face = ease(clamp01(s / VENDOR_FACE_MS)) * ease(clamp01(left / VENDOR_FACE_MS));
    return { x, z, yaw: cart.yaw + (FACE_LOT - cart.yaw) * face, clip: "standIdle", stride: inLength, idle: s / 1000, blend: clamp01(s / BLEND_MS) };
  }
  const blend = clamp01((t - T_BACK) / BLEND_MS);
  if (t < T_TURN) return { x, z, yaw: cart.yaw, clip: "push", stride: inLength - ((t - T_BACK) / 1000) * CART_BACK_SPEED, idle: CART_STOP_MS / 1000, blend };
  const turned = inLength - backLength;
  if (t < T_OUT) {
    return { x, z, yaw: cart.yaw, clip: "push", stride: turned + ((t - T_TURN) / 1000) * CART_SPEED, idle: CART_STOP_MS / 1000, blend: 1 };
  }
  return { x, z, yaw: cart.yaw, clip: "push", stride: turned + TURN_ARC + ((t - T_OUT) / 1000) * CART_SPEED, idle: CART_STOP_MS / 1000, blend: 1 };
}

/** Evening carts come out at 17:00 and are gone by 01:00; "allDay" brings them round at any hour. */
export function isCartHour(hour: number, mode: CartMode = "evening"): boolean {
  if (mode === "off") return false;
  if (mode === "allDay") return true;
  return hour >= 17 || hour < 1;
}
