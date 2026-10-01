import type * as THREE from "three";

/**
 * Frees what a cloned character owns on the GPU: every skinned part has its own skeleton, whose bone texture three
 * never frees by itself, and its own material. Geometry and textures stay: they are shared with the loaded character.
 */
export function disposeSkinned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
}
