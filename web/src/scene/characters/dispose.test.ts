import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { disposeSkinned } from "./dispose.ts";

function skinnedPart(material: THREE.Material, shared: THREE.BufferGeometry): THREE.SkinnedMesh {
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0]!.add(bones[1]!);
  const mesh = new THREE.SkinnedMesh(shared, material);
  mesh.add(bones[0]!);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.skeleton.computeBoneTexture();
  return mesh;
}

describe("disposing a character", () => {
  test("frees every part's bone texture and material, keeps the shared geometry", () => {
    const geometry = new THREE.BufferGeometry();
    let geometryFreed = false;
    geometry.addEventListener("dispose", () => (geometryFreed = true));
    const root = new THREE.Group();
    const freed: string[] = [];
    for (const name of ["body", "shirt"]) {
      const material = new THREE.MeshStandardMaterial();
      material.addEventListener("dispose", () => freed.push(`${name} material`));
      const part = skinnedPart(material, geometry);
      part.skeleton.boneTexture!.addEventListener("dispose", () => freed.push(`${name} bones`));
      root.add(part);
    }
    disposeSkinned(root);
    expect(freed.sort()).toEqual(["body bones", "body material", "shirt bones", "shirt material"]);
    expect(geometryFreed).toBe(false);
  });
});
