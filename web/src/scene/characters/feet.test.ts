import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { loweredAnkle, placeSandal, reachLeg } from "./feet.ts";

/** Hip at 0.8 m, thigh forward, shin down: a seated leg lifted 0.3 m off the ground. */
function seatedLeg() {
  const root = new THREE.Group();
  const upLeg = new THREE.Bone();
  const leg = new THREE.Bone();
  const foot = new THREE.Bone();
  const toe = new THREE.Bone();
  root.add(upLeg);
  upLeg.add(leg);
  leg.add(foot);
  foot.add(toe);
  upLeg.position.set(0, 0.8, 0);
  leg.position.set(0, 0, 0.43);
  foot.position.set(0, -0.43, 0);
  toe.position.set(0, -0.06, 0.12);
  foot.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0));
  root.updateMatrixWorld(true);
  return { root, upLeg, leg, foot, toe };
}

describe("reachLeg", () => {
  test("puts the ankle on the target and keeps the foot's world rotation", () => {
    const { upLeg, leg, foot } = seatedLeg();
    const before = foot.getWorldQuaternion(new THREE.Quaternion());
    const target = new THREE.Vector3(0, 0.15, 0.45);
    reachLeg(upLeg, leg, foot, target);
    expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-4);
    expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(before)).toBeLessThan(1e-4);
    // Bones keep their lengths and the knee still bends forward.
    const knee = leg.getWorldPosition(new THREE.Vector3());
    expect(knee.distanceTo(new THREE.Vector3(0, 0.8, 0))).toBeCloseTo(0.43, 4);
    expect(knee.z).toBeGreaterThan(0.3);
  });

  test("stretches as far as it can towards an unreachable target", () => {
    const { upLeg, leg, foot } = seatedLeg();
    reachLeg(upLeg, leg, foot, new THREE.Vector3(0, -2, 0.3));
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    expect(ankle.distanceTo(new THREE.Vector3(0, 0.8, 0))).toBeCloseTo(0.86 * 0.999, 3);
  });
});

describe("placeSandal", () => {
  const anchor = { position: new THREE.Vector3(0, -0.07, 0.07), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };

  test("lies flat on the ground while the toes are down", () => {
    const { root, upLeg, leg, foot, toe } = seatedLeg();
    reachLeg(upLeg, leg, foot, new THREE.Vector3(0, 0.1, 0.4));
    const sole = new THREE.Group();
    foot.add(sole);
    root.updateMatrixWorld(true);
    placeSandal(sole, foot, toe, anchor, 0, 0.014);
    const pos = sole.getWorldPosition(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sole.getWorldQuaternion(new THREE.Quaternion()));
    expect(pos.y).toBeCloseTo(0.007, 4);
    expect(up.y).toBeCloseTo(1, 4);
  });

  test("follows the foot once it is in the air", () => {
    const { root, foot, toe } = seatedLeg();
    const sole = new THREE.Group();
    foot.add(sole);
    root.updateMatrixWorld(true);
    placeSandal(sole, foot, toe, anchor, 0, 0.014);
    expect(sole.position.distanceTo(anchor.position)).toBeLessThan(1e-4);
    expect(sole.quaternion.angleTo(anchor.quaternion)).toBeLessThan(1e-4);
  });
});

describe("loweredAnkle", () => {
  const hip = new THREE.Vector3(0.1, 0.75, -0.28);
  const fwd = new THREE.Vector3(0, 0, 1);

  test("keeps the clip's foot placement when the leg reaches anyway", () => {
    const ankle = new THREE.Vector3(0.12, 0.084, 0.11);
    const out = loweredAnkle(hip, ankle, 0.02, fwd, 0.86, new THREE.Vector3());
    expect(out.x).toBeCloseTo(0.12, 6);
    expect(out.y).toBeCloseTo(0.064, 6);
    expect(out.z).toBeCloseTo(0.11, 6);
  });

  test("pulls the foot back under a high seat so the leg reaches the ground", () => {
    const ankle = new THREE.Vector3(0.12, 0.334, 0.11);
    const out = loweredAnkle(hip, ankle, 0.27, fwd, 0.775, new THREE.Vector3());
    expect(out.y).toBeCloseTo(0.064, 6);
    expect(out.x).toBeCloseTo(0.12, 6);
    expect(out.distanceTo(hip)).toBeCloseTo(0.94 * 0.775, 4);
    expect(out.z).toBeLessThan(0.11);
  });
});
