// The shared rigged MPFB character asset (one GLB + clips.json), the per-person rig built from it (parts and colours
// picked from the look) and the bind-pose helpers that hang props off its bones.
import { useGLTF } from "@react-three/drei";
import { useLoader, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getKtx2Loader } from "../art/assets.tsx";
import type { Look } from "./identity.ts";
import type { ClipsJson } from "./rig.ts";

const GLB_URL = "/assets/character/character.glb";
const CLIPS_URL = "/assets/character/clips.json";
/** Mixamo bone names carry this prefix in the GLB. */
export const B = (name: string) => `mixamorig${name}`;
const LOWER = new Set(["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"].map(B));
// Reference skin of the MPFB texture; darker looks multiply it down towards sawo matang.
const BASE_SKIN = new THREE.Color("#e2b48c");

export interface CharacterAsset {
  scene: THREE.Group;
  meta: ClipsJson;
  clips: Map<string, THREE.AnimationClip>;
  part(name: string, half: "lower" | "upper"): THREE.AnimationClip;
}

export function useCharacterAsset(): CharacterAsset {
  const gl = useThree((s) => s.gl);
  const gltf = useGLTF(GLB_URL, false, true, (loader) => {
    loader.setKTX2Loader(getKtx2Loader(gl) as unknown as Parameters<typeof loader.setKTX2Loader>[0]);
  });
  const json = useLoader(THREE.FileLoader, CLIPS_URL) as string;
  return useMemo(() => {
    const meta = JSON.parse(json) as ClipsJson;
    const clips = new Map(gltf.animations.map((c) => [c.name, c]));
    const parts = new Map<string, THREE.AnimationClip>();
    const part = (name: string, half: "lower" | "upper") => {
      const key = `${name}/${half}`;
      let c = parts.get(key);
      if (!c) {
        const src = clips.get(name);
        if (!src) throw new Error(`clip ${name} missing from the character GLB`);
        const tracks = src.tracks.filter((t) => LOWER.has(t.name.split(".")[0]!) === (half === "lower"));
        c = new THREE.AnimationClip(key, src.duration, tracks);
        parts.set(key, c);
      }
      return c;
    };
    for (const name of Object.keys(meta.clips)) if (!clips.has(name)) throw new Error(`clip ${name} missing from the character GLB`);
    return { scene: gltf.scene, meta, clips, part };
  }, [gltf, json]);
}

const PARTS = {
  body: { shorts: "Body_Shorts", trunks: "Body_Trunks", pants: "Body_Pants" },
  legs: { shorts: "Shorts", trunks: "Trunks", pants: "Pants" },
  shirt: { tee: "Shirt_Tee", polo: "Shirt_Polo" },
} as const;

function tint(hex: string, gain: number): THREE.Color {
  const c = new THREE.Color(hex).multiplyScalar(gain);
  return c.setRGB(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b));
}

export interface Rig {
  object: THREE.Group;
  bones: Map<string, THREE.Bone>;
  /** Bone world matrix in the bind pose (character space). */
  bind(name: string): THREE.Matrix4;
}

export function buildRig(asset: CharacterAsset, look: Look): Rig {
  const object = cloneSkinned(asset.scene) as THREE.Group;
  const keep = new Set<string>([PARTS.body[look.legs], PARTS.legs[look.legs], PARTS.shirt[look.shirt], `Hair_${look.hair}`, "Eyes", "Eyebrows", "Eyelashes"]);
  const drop: THREE.Object3D[] = [];
  const bones = new Map<string, THREE.Bone>();
  let skeleton: THREE.Skeleton | null = null;
  object.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (!keep.has(mesh.name)) {
      drop.push(mesh);
      return;
    }
    skeleton ??= mesh.skeleton;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds come from the bind pose; seated and stretching poses leave them.
    mesh.frustumCulled = false;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.metalness = 0;
    if (mesh.name.startsWith("Body_")) {
      const c = new THREE.Color(look.skin);
      mat.color.setRGB(Math.min(1, c.r / BASE_SKIN.r), Math.min(1, c.g / BASE_SKIN.g), Math.min(1, c.b / BASE_SKIN.b));
      mat.roughness = 0.55;
    } else if (mesh.name.startsWith("Shirt_")) {
      mat.color.copy(tint(look.shirtColor, 1.25));
      mat.roughness = 0.92;
    } else if (mesh.name === PARTS.legs[look.legs]) {
      mat.color.copy(tint(look.legsColor, 1.25));
      mat.roughness = 0.9;
    } else if (mesh.name.startsWith("Hair_")) {
      mat.color.copy(tint(look.hairColor, 4));
    }
    mesh.material = mat;
  });
  for (const o of drop) o.removeFromParent();
  if (!skeleton) throw new Error("character GLB has no skinned body");
  // Bones still hold the exported rest pose here (no clip applied yet). The inverse bind matrices can't be used:
  // mesh quantisation folds the vertex dequantisation into them.
  object.updateMatrixWorld(true);
  const rest = new Map([...bones].map(([n, b]) => [n, b.matrixWorld.clone()]));
  const bind = (name: string) => {
    const m = rest.get(B(name));
    if (!m) throw new Error(`bone ${name} missing`);
    return m.clone();
  };
  return { object, bones, bind };
}

/** Adds `prop` under `bone` so that, in the bind pose, it sits at `pos` with its +Z along `axis` (character space). */
export function attach(rig: Rig, bone: string, prop: THREE.Object3D, pos: THREE.Vector3, axis: THREE.Vector3, up?: THREE.Vector3): void {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
  if (up) {
    // Roll around the axis so the prop's +Y points as close to `up` as possible.
    const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const wanted = up
      .clone()
      .sub(axis.clone().multiplyScalar(up.dot(axis)))
      .normalize();
    const roll = new THREE.Quaternion().setFromUnitVectors(curUp, wanted);
    q.premultiply(roll);
  }
  const world = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  const local = rig.bind(bone).invert().multiply(world);
  local.decompose(prop.position, prop.quaternion, prop.scale);
  const target = rig.bones.get(B(bone));
  if (!target) throw new Error(`bone ${bone} missing`);
  target.add(prop);
}

/** Bind-pose frame of one hand (character space): its position, finger and knuckle directions and the palm normal. */
export function handFrame(rig: Rig, side: "Left" | "Right") {
  const p = (n: string) => new THREE.Vector3().setFromMatrixPosition(rig.bind(`${side}${n}`));
  const hand = p("Hand");
  const fingers = p("HandMiddle1").sub(hand).normalize();
  const across = p("HandIndex1").sub(p("HandPinky1")).normalize();
  const palm = new THREE.Vector3().crossVectors(fingers, across).normalize();
  // Palms face the body in the bind (A) pose.
  if (palm.x * (side === "Left" ? -1 : 1) < 0) palm.negate();
  return { hand, fingers, across, palm, at: p };
}
