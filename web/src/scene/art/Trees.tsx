import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useApp } from "../../state/store.ts";
import { TREE_SPOTS } from "../layout.ts";
import { timeControl } from "../timeControl.ts";

type EzTree = THREE.Group & {
  options: { seed: number; leaves: { tint: number; count: number; size: number } };
  leavesMesh: THREE.Mesh;
  branchesMesh: THREE.Mesh;
  loadPreset(name: string): void;
  generate(): void;
  update(t: number): void;
};

/** ez-tree's Phong materials ignore the scene environment; swap in PBR so trees sit in the same light. */
function toStandard(tree: EzTree): void {
  // ez-tree also sets a roughnessMap on its Phong bark, which three's Phong never reads.
  const bark = tree.branchesMesh.material as THREE.MeshPhongMaterial & { roughnessMap?: THREE.Texture | null };
  tree.branchesMesh.material = new THREE.MeshStandardMaterial({
    color: bark.color,
    map: bark.map,
    normalMap: bark.normalMap,
    aoMap: bark.aoMap,
    roughnessMap: bark.roughnessMap,
    roughness: 0.95,
  });
  const leaves = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  const std = new THREE.MeshStandardMaterial({ color: leaves.color, map: leaves.map, side: THREE.DoubleSide, alphaTest: leaves.alphaTest, roughness: 0.75 });
  std.onBeforeCompile = (shader, renderer) => {
    leaves.onBeforeCompile(shader, renderer);
    std.userData.shader = shader;
  };
  tree.leavesMesh.material = std;
  tree.leavesMesh.receiveShadow = true;
}

export function Trees() {
  const group = useRef<THREE.Group>(null!);
  const trees = useRef<EzTree[]>([]);
  const time = useRef(0);

  useEffect(() => {
    let cancelled = false;
    import("@dgreenheck/ez-tree")
      .then(({ Tree }) => {
        if (cancelled) return;
        for (const s of TREE_SPOTS) {
          const tree = new Tree() as unknown as EzTree;
          tree.loadPreset(s.preset);
          tree.options.seed = s.seed;
          tree.options.leaves.tint = s.tint;
          // Fewer, larger leaf cards: same silhouette at this distance for about half the overdraw.
          tree.options.leaves.count = Math.round(tree.options.leaves.count * 0.6);
          tree.options.leaves.size *= 1.25;
          tree.generate();
          toStandard(tree);
          tree.leavesMesh.castShadow = s.shadow;
          const box = new THREE.Box3().setFromObject(tree);
          tree.scale.setScalar(s.height / Math.max(0.1, box.max.y - box.min.y));
          tree.position.set(s.x, 0, s.z);
          group.current.add(tree);
          trees.current.push(tree);
        }
      })
      .catch((err: unknown) => useApp.getState().reportAssetError(`trees: ${err instanceof Error ? err.message : String(err)}`));
    return () => {
      cancelled = true;
      for (const t of trees.current) group.current?.remove(t);
      trees.current = [];
    };
  }, []);

  useFrame(() => {
    time.current += timeControl.frameDt;
    for (const t of trees.current) t.update(time.current);
  });

  return <group ref={group} />;
}
