// When a food cart is pushed past on the far pavement (evenings and nights only): at most one per 10-minute slot,
// each slot seeded by its index so every viewer sees the same street. Pure, unit tested; drawn by FoodCart.tsx.
import { hash32, rng } from "../characters/identity.ts";
import { STREET, TREE_SPOTS } from "../layout.ts";

export type CartKind = "bakso" | "nasgor";

export const CART_SLOT_MS = 10 * 60_000;
/** A vendor pushing a loaded cart: a slow walk (m/s). */
export const CART_SPEED = 0.8;
/** Along the far pavement, clear of the far lane (scooters reach x −11.3) and of the tree trunks behind it. */
export const CART_PATH = { x: -11.9, z0: -26, z1: 26 } as const;
export const CART_HALF_WIDTH = 0.38;
export const CART_PASS_MS = ((CART_PATH.z1 - CART_PATH.z0) / CART_SPEED) * 1000;

export interface CartPass {
  kind: CartKind;
  /** +1 walks towards +z. */
  dir: 1 | -1;
  /** Wall-clock start (ms). */
  start: number;
}

/** The pass of the slot `now` falls in, if a cart is on its way right now. */
export function cartPassAt(now: number): CartPass | null {
  const slot = Math.floor(now / CART_SLOT_MS);
  const r = rng(hash32(`cart:${slot}`));
  const start = slot * CART_SLOT_MS + r() * (CART_SLOT_MS - CART_PASS_MS);
  const pass: CartPass = { kind: r() < 0.5 ? "bakso" : "nasgor", dir: r() < 0.5 ? 1 : -1, start };
  return now >= start && now < start + CART_PASS_MS ? pass : null;
}

/** Where the cart is along its pass (z), and how far the walk has got (s). */
export function cartAt(pass: CartPass, now: number): { z: number; walked: number } {
  const walked = Math.max(0, now - pass.start) / 1000;
  const along = Math.min(walked * CART_SPEED, CART_PATH.z1 - CART_PATH.z0);
  return { z: pass.dir === 1 ? CART_PATH.z0 + along : CART_PATH.z1 - along, walked };
}

/** Food carts come out after dusk and are gone by 01:00. */
export const isCartHour = (hour: number): boolean => hour >= 18.5 || hour < 1;

/** Trunks along the far pavement the cart must clear (m from the trunk centre). */
export const TRUNK_CLEARANCE = 0.25;
export const cartClear = (): boolean =>
  CART_PATH.x + CART_HALF_WIDTH <= STREET.minX &&
  TREE_SPOTS.every((t) => Math.abs(t.x - CART_PATH.x) - CART_HALF_WIDTH >= TRUNK_CLEARANCE || t.z < CART_PATH.z0 || t.z > CART_PATH.z1);
