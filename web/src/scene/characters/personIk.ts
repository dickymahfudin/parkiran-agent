// Runtime pose fixes on top of the clips, pure three.js: the vaper's closed fist and a kopi kept level in the hand.
import * as THREE from "three";

/** The bones of the right hand that close round a pod vape, with the clip pose they are curled from. */
export interface Fist {
  arm: THREE.Bone;
  foreArm: THREE.Bone;
  hand: THREE.Bone;
  index1: THREE.Bone;
  middle1: THREE.Bone;
  pinky1: THREE.Bone;
  /** +1 or −1: which side of fingers × across the palm is on. */
  palmSign: number;
  /** Finger joints and the extra bend (rad) each gets. */
  curl: readonly (readonly [THREE.Bone, number])[];
}

const fistTmp = {
  hand: new THREE.Vector3(),
  index: new THREE.Vector3(),
  middle: new THREE.Vector3(),
  pinky: new THREE.Vector3(),
  fingers: new THREE.Vector3(),
  across: new THREE.Vector3(),
  palm: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  parent: new THREE.Quaternion(),
  world: new THREE.Quaternion(),
  turn: new THREE.Quaternion(),
};

/**
 * Curls the right hand's fingers towards the palm (about the hand's current knuckle axis), on top of the clip pose,
 * which is saved first so the next frame can put it back. World matrices must be current.
 */
export function closeFist(fist: Fist, saved: THREE.Quaternion[]): void {
  const t = fistTmp;
  fist.hand.getWorldPosition(t.hand);
  t.fingers.subVectors(fist.middle1.getWorldPosition(t.middle), t.hand).normalize();
  t.across.subVectors(fist.index1.getWorldPosition(t.index), fist.pinky1.getWorldPosition(t.pinky)).normalize();
  t.palm.crossVectors(t.fingers, t.across).normalize().multiplyScalar(fist.palmSign);
  // Turning `fingers` about fingers × palm moves it towards the palm.
  t.axis.crossVectors(t.fingers, t.palm).normalize();
  fist.curl.forEach(([bone, angle], i) => {
    saved[i]!.copy(bone.quaternion);
    bone.parent!.getWorldQuaternion(t.parent);
    bone.getWorldQuaternion(t.world);
    t.world.premultiply(t.turn.setFromAxisAngle(t.axis, angle));
    bone.quaternion.copy(t.parent.invert().multiply(t.world));
    bone.updateMatrixWorld(true);
  });
}

const level = {
  at: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  world: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  full: new THREE.Quaternion(),
  fix: new THREE.Quaternion(),
};
const UP = new THREE.Vector3(0, 1, 0);
const NO_TURN = new THREE.Quaternion();
/** A kopi stays level in the hand, or it would spill: only this close to the lips (m) may it tip with the drinking hand. */
const CUP_TIP = { near: 0.1, far: 0.2 };

/**
 * Turns a hand-held cup (its local rotation reset to `grip` first) so it stands upright in the world, easing into the
 * hand's own tilt as it nears the lips (the sip clips tip it to drink). World matrices must be current.
 */
export function keepLevel(cup: THREE.Object3D, grip: THREE.Quaternion, lips: THREE.Vector3): void {
  cup.quaternion.copy(grip);
  cup.updateWorldMatrix(true, false);
  cup.getWorldPosition(level.at);
  const upright = THREE.MathUtils.smoothstep(level.at.distanceTo(lips), CUP_TIP.near, CUP_TIP.far);
  if (upright <= 0) return;
  cup.getWorldQuaternion(level.world);
  level.axis.set(0, 0, 1).applyQuaternion(level.world);
  level.full.setFromUnitVectors(level.axis, UP);
  level.fix.slerpQuaternions(NO_TURN, level.full, upright);
  cup.parent!.getWorldQuaternion(level.parent);
  cup.quaternion.copy(level.parent.invert().multiply(level.world.premultiply(level.fix)));
  cup.updateWorldMatrix(false, false);
}
