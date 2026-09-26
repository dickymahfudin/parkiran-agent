// Smooth vehicle bodies: superellipse cross-sections lofted along Z, profiles from monotone cubic curves.
import * as THREE from "three";

export type Curve = (z: number) => number;

/** Monotone cubic (Fritsch–Carlson) through [z, value] control points; clamps outside the range. */
export function curve(points: readonly (readonly [number, number])[]): Curve {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - x));
  const m = xs.map((_, i) => (i === 0 ? d[0]! : i === n - 1 ? d[n - 2]! : d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (z) => {
    if (z <= xs[0]!) return ys[0]!;
    if (z >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (z > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (z - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

export interface LoftSpec {
  /** Station positions along Z (ascending). */
  zs: number[];
  bottom: Curve;
  top: Curve;
  halfWidth: Curve;
  /** Upper half narrows by this fraction at the very top (tumblehome). */
  taper?: number | Curve;
  /** Superellipse exponent: 2 = ellipse, higher = boxier. */
  exponent?: number;
  /** Points per cross-section. */
  around?: number;
  /** Close both ends with a fan. */
  caps?: boolean;
  /** Open patch over this angle range instead of a full ring (t = −π/2 bottom, 0 right side, π/2 top). */
  arc?: readonly [number, number];
  /** Push the surface outwards (patches on top of another loft). */
  inflate?: number;
  /** Optional per-vertex colour from (z, y, side angle). */
  color?: (z: number, y: number, angle: number, out: THREE.Color) => void;
}

const sp = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** (2 / e);

/** Sample points densely where any curve bends; `extra` adds fixed stations (arch edges, pillars). */
export function stations(from: number, to: number, step: number, extra: number[] = []): number[] {
  const out = new Set<number>();
  for (let z = from; z < to; z += step) out.add(Math.round(z * 1e4) / 1e4);
  out.add(to);
  for (const e of extra) if (e > from && e < to) out.add(e);
  return [...out].sort((a, b) => a - b);
}

export function loftGeometry(spec: LoftSpec): THREE.BufferGeometry {
  const around = spec.around ?? 28;
  const e = spec.exponent ?? 4;
  const [t0, t1] = spec.arc ?? [-Math.PI / 2, (Math.PI * 3) / 2];
  const grow = spec.inflate ?? 0;
  const taperOf = typeof spec.taper === "function" ? spec.taper : () => (spec.taper as number | undefined) ?? 0;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const c = new THREE.Color();
  const zMin = spec.zs[0]!;
  const zMax = spec.zs[spec.zs.length - 1]!;

  for (const z of spec.zs) {
    const y0 = spec.bottom(z);
    const y1 = spec.top(z);
    const hw = spec.halfWidth(z) + grow;
    const taper = taperOf(z);
    const yc = (y0 + y1) / 2;
    const hh = Math.max(1e-4, (y1 - y0) / 2 + grow);
    for (let i = 0; i <= around; i++) {
      const t = t0 + (i / around) * (t1 - t0);
      const sy = Math.sin(t);
      const x = hw * sp(Math.cos(t), e) * (1 - taper * Math.max(0, sy));
      const y = yc + hh * sp(sy, e);
      pos.push(x, y, z);
      uv.push((z - zMin) / (zMax - zMin), i / around);
      if (spec.color) {
        spec.color(z, y, t, c);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const ring = around + 1;
  for (let s = 0; s < spec.zs.length - 1; s++) {
    for (let i = 0; i < around; i++) {
      const a = s * ring + i;
      const b = a + ring;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (spec.caps && !spec.arc) {
    for (const [s, flip] of [[0, true], [spec.zs.length - 1, false]] as const) {
      const z = spec.zs[s]!;
      const center = pos.length / 3;
      pos.push(0, (spec.bottom(z) + spec.top(z)) / 2, z);
      uv.push(s === 0 ? 0 : 1, 0.5);
      if (spec.color) {
        spec.color(z, (spec.bottom(z) + spec.top(z)) / 2, 0, c);
        col.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < around; i++) {
        const a = s * ring + i;
        if (flip) index.push(center, a + 1, a);
        else index.push(center, a, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (spec.color) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A point on the loft surface (same parameterisation as loftGeometry) for pillars, trims and lights. */
export function loftPoint(spec: LoftSpec, z: number, angle: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const e = spec.exponent ?? 4;
  const taperOf = typeof spec.taper === "function" ? spec.taper : () => (spec.taper as number | undefined) ?? 0;
  const y0 = spec.bottom(z);
  const y1 = spec.top(z);
  const hw = spec.halfWidth(z) - inset;
  const yc = (y0 + y1) / 2;
  const hh = (y1 - y0) / 2 - inset;
  const sy = Math.sin(angle);
  return out.set(hw * sp(Math.cos(angle), e) * (1 - taperOf(z) * Math.max(0, sy)), yc + hh * sp(sy, e), z);
}
