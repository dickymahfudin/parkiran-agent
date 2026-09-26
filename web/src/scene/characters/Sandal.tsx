// Sandal jepit, Swallow style: a foot-shaped rubber sole (coloured underneath, white on top) and a Y strap from the toe
// post. Geometry is built once per foot and shared by everyone; only the colour differs.
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Sole thickness (m). Characters stand this much higher, so feet rest on their sandals instead of sinking in. */
export const SANDAL_THICKNESS = 0.014;

export type FootSide = "Left" | "Right";

/** Right sole outline (x towards the big toe, i.e. the body's middle; z towards the toes), around the sole origin. */
const OUTLINE: [number, number][] = [
  [0.0, -0.128],
  [0.029, -0.116],
  [0.034, -0.072],
  [0.027, -0.022],
  [0.039, 0.038],
  [0.044, 0.086],
  [0.033, 0.121],
  [0.012, 0.135],
  [-0.012, 0.13],
  [-0.031, 0.111],
  [-0.045, 0.062],
  [-0.041, 0.0],
  [-0.036, -0.062],
  [-0.031, -0.109],
];
/** Toe post between the big and the second toe, and the strap ends at the sides of the mid-foot. */
const POST: [number, number] = [0.016, 0.088];
const STRAP_MEDIAL: [number, number, number][] = [
  [0.016, 0.022, 0.088],
  [0.029, 0.04, 0.05],
  [0.037, 0.031, 0.014],
  [0.036, 0.007, -0.004],
];
const STRAP_LATERAL: [number, number, number][] = [
  [0.016, 0.022, 0.088],
  [-0.009, 0.043, 0.056],
  [-0.035, 0.035, 0.02],
  [-0.041, 0.007, 0.0],
];

interface SandalGeometry {
  /** Coloured rubber: the sole's underside, the Y strap and the toe post, as one mesh (one draw per sandal). */
  rubber: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
}

const cache = new Map<FootSide, SandalGeometry>();

function layer(shape: THREE.Shape, from: number, to: number): THREE.BufferGeometry {
  const bevel = 0.0012;
  const depth = to - from - 2 * bevel;
  // A spline outline is sampled curveSegments × its 14 points: 5 gives ~70 points round the sole, smooth at any zoom.
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 5 });
  // Shape plane XY → ground plane XZ (shape y becomes +z, the extrusion goes down), then lift into [from, to].
  g.rotateX(Math.PI / 2);
  g.translate(0, to - bevel, 0);
  g.computeVertexNormals();
  return g;
}

function build(side: FootSide): SandalGeometry {
  const sx = side === "Right" ? 1 : -1;
  const shape = new THREE.Shape();
  const pts = OUTLINE.map(([x, z]) => new THREE.Vector2(x * sx, z));
  shape.moveTo(pts[0]!.x, pts[0]!.y);
  shape.splineThru([...pts.slice(1), pts[0]!]);
  const half = SANDAL_THICKNESS / 2;
  const strap = [STRAP_MEDIAL, STRAP_LATERAL].map((points) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x * sx, y, z)));
    return new THREE.TubeGeometry(curve, 18, 0.0042, 6, false);
  });
  const post = new THREE.CylinderGeometry(0.0035, 0.004, 0.018, 8);
  post.translate(POST[0] * sx, half + 0.008, POST[1]);
  const parts = [layer(shape, -half, 0.0015), ...strap, post].map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    flat.clearGroups();
    return flat;
  });
  const rubber = mergeGeometries(parts, false);
  if (!rubber) throw new Error("sandal parts do not merge");
  return { rubber, top: layer(shape, 0.0015, half) };
}

function geometryFor(side: FootSide): SandalGeometry {
  let g = cache.get(side);
  if (!g) {
    g = build(side);
    cache.set(side, g);
  }
  return g;
}

const WHITE_TOP = new THREE.MeshStandardMaterial({ color: "#eeede6", roughness: 0.85 });

/** One sandal, origin at the middle of the sole (half its thickness above the ground when planted). */
export function Sandal({ side, color }: { side: FootSide; color: string }) {
  const g = geometryFor(side);
  const rubber = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), [color]);
  return (
    <>
      <mesh geometry={g.rubber} material={rubber} castShadow receiveShadow />
      <mesh geometry={g.top} material={WHITE_TOP} receiveShadow />
    </>
  );
}
