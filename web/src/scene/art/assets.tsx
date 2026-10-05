import { useGLTF } from "@react-three/drei";
import { useLoader, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { isScenePart, useApp, type ScenePart } from "../../state/store.ts";

const BASIS_PATH = "/basis/";
let ktx2Loader: KTX2Loader | null = null;

export function getKtx2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  ktx2Loader ??= new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl);
  return ktx2Loader;
}

/** GLB from scripts/assets/build.ts (meshopt geometry + KTX2 textures), cloned per use with shadows on. */
const plainGlass = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Any transmissive material makes three render every opaque object a second time each frame (into the refraction
 * buffer); two tiny bulb envelopes doubled the whole scene. Glass becomes plain see-through instead.
 */
function withoutTransmission(material: THREE.Material): THREE.Material {
  const m = material as THREE.MeshPhysicalMaterial;
  if (!m.isMeshPhysicalMaterial || m.transmission <= 0) return material;
  let glass = plainGlass.get(material);
  if (!glass) {
    glass = new THREE.MeshStandardMaterial({ color: m.color, roughness: Math.min(m.roughness, 0.1), metalness: 0, transparent: true, opacity: 0.25, depthWrite: false });
    plainGlass.set(material, glass);
  }
  return glass;
}

export function useModel(id: string, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Group {
  const gl = useThree((s) => s.gl);
  const gltf = useGLTF(`/assets/models/${id}.glb`, false, true, (loader) => {
    // drei's GLTFLoader comes from three-stdlib; three's KTX2Loader matches the r186 transcoder we ship.
    loader.setKTX2Loader(getKtx2Loader(gl) as unknown as Parameters<typeof loader.setKTX2Loader>[0]);
  });
  return useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = opts.cast ?? true;
        mesh.receiveShadow = opts.receive ?? true;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(withoutTransmission) : withoutTransmission(mesh.material);
      }
    });
    return clone;
  }, [gltf.scene, opts.cast, opts.receive]);
}

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture;
}

/** Diffuse + GL normal + ARM (R: AO, G: roughness, B: metalness), tiled `repeat` times. */
export function usePbr(id: string, repeat: [number, number] = [1, 1]): PbrSet {
  const gl = useThree((s) => s.gl);
  const [diff, nor, arm] = useLoader(
    KTX2Loader,
    [`/assets/textures/${id}/diff.ktx2`, `/assets/textures/${id}/nor.ktx2`, `/assets/textures/${id}/arm.ktx2`],
    (loader) => void loader.setTranscoderPath(BASIS_PATH).detectSupport(gl),
  );
  return useMemo(() => {
    const prep = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      c.anisotropy = 8;
      c.needsUpdate = true;
      return c;
    };
    return { map: prep(diff!, true), normalMap: prep(nor!, false), arm: prep(arm!, false) };
  }, [diff, nor, arm, repeat[0], repeat[1]]);
}

export function pbrMaterial(set: PbrSet, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.arm,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    ...extra,
  });
}

/** Surfaces asset failures in the HUD instead of silently dropping part of the scene. */
/**
 * Keeps one failing part (a missing model, a texture that will not decode) from unmounting the whole scene: the part
 * disappears, the HUD shows the error. A `name` that is a loading part also counts as arrived, so the loading screen
 * lifts.
 */
export class AssetBoundary extends Component<{ name: ScenePart | string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    useApp.getState().reportAssetError(`${this.props.name}: ${error instanceof Error ? error.message : String(error)}`);
    if (isScenePart(this.props.name)) useApp.getState().markReady(this.props.name);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Rendered inside a part's Suspense boundary: mounting means the part's assets have arrived. */
export function Ready({ part }: { part: ScenePart }) {
  useEffect(() => useApp.getState().markReady(part), [part]);
  return null;
}

/** Seeded canvas texture helper for procedural decals, posters and prints. */
export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}
