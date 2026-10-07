// Feet on the ground, applied on top of the clip pose every frame (the mixer rewrites the bones before each call).
import * as THREE from "three";

const v = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  end: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  knee: new THREE.Vector3(),
  u: new THREE.Vector3(),
  w: new THREE.Vector3(),
  s: new THREE.Vector3(),
  fwd: new THREE.Vector3(),
};
const q = {
  delta: new THREE.Quaternion(),
  world: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  foot: new THREE.Quaternion(),
  flat: new THREE.Quaternion(),
  follow: new THREE.Quaternion(),
};
const m = { follow: new THREE.Matrix4(), want: new THREE.Matrix4(), inv: new THREE.Matrix4() };
const Z = new THREE.Vector3(0, 0, 1);

/** Turns `bone` in world space so the point `from` (one of its descendants) swings to `to` around `pivot`. */
function aim(bone: THREE.Object3D, pivot: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): void {
  const a = v.u.subVectors(from, pivot).normalize();
  const b = v.w.subVectors(to, pivot).normalize();
  q.delta.setFromUnitVectors(a, b);
  bone.getWorldQuaternion(q.world).premultiply(q.delta);
  if (!bone.parent) throw new Error("leg bone without a parent");
  bone.parent.getWorldQuaternion(q.parent);
  bone.quaternion.copy(q.parent.invert().multiply(q.world));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK for a leg: moves the ankle (`foot` head) to `target` (world), or as close as the leg reaches.
 * The knee keeps bending the way the clip bent it and the foot keeps its world rotation (sole stays as it was).
 */
export function reachLeg(upLeg: THREE.Object3D, leg: THREE.Object3D, foot: THREE.Object3D, target: THREE.Vector3): void {
  const hip = upLeg.getWorldPosition(v.a);
  const knee = leg.getWorldPosition(v.b);
  const ankle = foot.getWorldPosition(v.c);
  foot.getWorldQuaternion(q.foot);
  const thigh = hip.distanceTo(knee);
  const shin = knee.distanceTo(ankle);
  const dist = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(thigh - shin) + 1e-4, (thigh + shin) * 0.999);
  const dir = v.dir.subVectors(target, hip).normalize();
  const pole = v.pole.subVectors(knee, hip);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-10) return;
  pole.normalize();
  const cos = (thigh * thigh + dist * dist - shin * shin) / (2 * thigh * dist);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const kneeTo = v.knee
    .copy(hip)
    .addScaledVector(dir, cos * thigh)
    .addScaledVector(pole, sin * thigh);
  const end = v.end.copy(hip).addScaledVector(dir, dist);
  aim(upLeg, hip, knee, kneeTo);
  aim(leg, leg.getWorldPosition(v.b), foot.getWorldPosition(v.c), end);
  if (!foot.parent) throw new Error("foot bone without a parent");
  foot.parent.getWorldQuaternion(q.parent);
  foot.quaternion.copy(q.parent.invert().multiply(q.foot));
  foot.updateMatrixWorld(true);
}

/** Leg stretch for a lifted seat: a little short of straight so the knee still reads as bent. */
const EXTENSION = 0.94;

/**
 * Where the ankle goes when the seat is `drop` higher than the clip's: straight down by `drop`, and pulled back under the
 * hip only as far as the leg (`legLength` = thigh + shin) needs to reach it. `forward` is the horizontal facing (unit).
 */
export function loweredAnkle(
  hip: THREE.Vector3,
  ankle: THREE.Vector3,
  drop: number,
  forward: THREE.Vector3,
  legLength: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.copy(ankle);
  out.y -= drop;
  const dx = out.x - hip.x;
  const dz = out.z - hip.z;
  const ahead = dx * forward.x + dz * forward.z;
  const sideX = dx - forward.x * ahead;
  const sideZ = dz - forward.z * ahead;
  const down = hip.y - out.y;
  const room = (EXTENSION * legLength) ** 2 - down * down - sideX * sideX - sideZ * sideZ;
  const reach = Math.min(ahead, Math.sqrt(Math.max(0, room)));
  out.x = hip.x + sideX + forward.x * reach;
  out.z = hip.z + sideZ + forward.z * reach;
  return out;
}

export interface SandalAnchor {
  /** The sole's transform under the foot bone in the bind pose (follows the foot when it is off the ground). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

/** Sole centre ahead of the ankle, along the foot (m, before the character's scale). */
export const SOLE_AHEAD = 0.055;

/**
 * Flip-flop behaviour: while the toes are down, the sole lies flat on the ground under the foot (a raised heel lifts off
 * it); once the whole foot is in the air the sole hangs on the toe strap and follows the foot.
 */
export function placeSandal(sole: THREE.Object3D, foot: THREE.Object3D, toe: THREE.Object3D, anchor: SandalAnchor, groundY: number, thickness: number): void {
  foot.updateWorldMatrix(true, false);
  const ankle = foot.getWorldPosition(v.a);
  const toes = toe.getWorldPosition(v.b);
  m.follow.compose(anchor.position, anchor.quaternion, anchor.scale).premultiply(foot.matrixWorld);
  const followPos = v.c.setFromMatrixPosition(m.follow);
  m.follow.decompose(v.end, q.follow, v.s);
  const scale = v.s.x;
  const fwd = v.fwd.subVectors(toes, ankle).setY(0);
  if (fwd.lengthSq() < 1e-8) fwd.copy(Z).applyQuaternion(q.follow).setY(0);
  fwd.normalize();
  q.flat.setFromUnitVectors(Z, fwd);
  const flatPos = v.knee.set(ankle.x + fwd.x * SOLE_AHEAD * scale, groundY + (thickness / 2) * scale, ankle.z + fwd.z * SOLE_AHEAD * scale);
  // 0 = planted, 1 = in the air (toe joint height above the sole's top, m).
  const lift = THREE.MathUtils.smoothstep(toes.y - groundY - thickness * scale, 0.035 * scale, 0.09 * scale);
  const pos = flatPos.lerp(followPos, lift);
  const rot = q.flat.slerp(q.follow, lift);
  m.want.compose(pos, rot, v.s.setScalar(scale));
  m.inv.copy(foot.matrixWorld).invert();
  m.want.premultiply(m.inv).decompose(sole.position, sole.quaternion, sole.scale);
  sole.updateMatrixWorld(true);
}
