// Collapses every static, opaque mesh under a group into one mesh per material: hundreds of props and
// trims become a few draw calls (and a few shadow-pass calls). Objects marked `userData.dynamic` are left alone.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function canonical(src: THREE.BufferGeometry, matrix: THREE.Matrix4, withColor: boolean): THREE.BufferGeometry {
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const uv = src.getAttribute("uv");
  const col = src.getAttribute("color");
  const n = pos.count;
  const p = new Float32Array(n * 3);
  const nn = new Float32Array(n * 3);
  const u = new Float32Array(n * 2);
  const c = withColor ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    p.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    if (nor) nn.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3);
    if (uv) u.set([uv.getX(i), uv.getY(i)], i * 2);
    if (c) c.set(col ? [col.getX(i), col.getY(i), col.getZ(i)] : [1, 1, 1], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(u, 2));
  if (c) g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const index = src.getIndex();
  const idx = new Uint32Array(index ? index.count : n);
  for (let i = 0; i < idx.length; i++) idx[i] = index ? index.getX(i) : i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!nor) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
  }
  return g;
}

function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (!m.visible || Array.isArray(m.material) || m.morphTargetInfluences) return false;
  const mat = m.material as THREE.Material;
  return !mat.transparent && m.geometry.getAttribute("position") !== undefined;
}

function isDynamic(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return true;
  return false;
}

export function mergeStatic(root: THREE.Group): { meshes: THREE.Mesh[]; dispose(): void } {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; sources: THREE.Mesh[] }>();
  root.traverse((o) => {
    if (!mergeable(o) || isDynamic(o, root)) return;
    const material = o.material as THREE.Material;
    const key = `${material.uuid}/${o.castShadow}/${o.receiveShadow}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material, cast: o.castShadow, receive: o.receiveShadow, sources: [] }));
    b.sources.push(o);
  });
  const meshes: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();
  for (const b of buckets.values()) {
    if (b.sources.length < 2) continue;
    const withColor = (b.material as THREE.MeshStandardMaterial).vertexColors === true;
    const parts = b.sources.map((s) => canonical(s.geometry, m.multiplyMatrices(inv, s.matrixWorld), withColor));
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.name = `merged:${b.material.name || b.material.type}`;
    for (const s of b.sources) s.visible = false;
    mesh.userData.sources = b.sources;
    root.add(mesh);
    meshes.push(mesh);
  }
  return {
    meshes,
    dispose() {
      for (const mesh of meshes) {
        for (const s of mesh.userData.sources as THREE.Mesh[]) s.visible = true;
        root.remove(mesh);
        mesh.geometry.dispose();
      }
    },
  };
}

/** Wrap static scenery (inside its Suspense boundary, so the content is loaded when this mounts). */
export function StaticMerge({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null!);
  useLayoutEffect(() => {
    const merged = mergeStatic(ref.current);
    return () => merged.dispose();
  }, []);
  return <group ref={ref}>{children}</group>;
}
