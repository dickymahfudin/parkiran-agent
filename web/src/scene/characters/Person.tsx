// The rigged MPFB character: one shared GLB, cloned per person, parts and colours picked from the session's look,
// clips driven frame by frame from the brain (deterministic, so hidden-tab catch-up and the gallery work).
import { Html, useGLTF } from "@react-three/drei";
import { createPortal, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CLIP_SEAT_Y } from "../layout.ts";
import { sound } from "../../audio/sound.ts";
import { getKtx2Loader } from "../art/assets.tsx";
import { timeControl } from "../timeControl.ts";
import type { Frame, NeedKind } from "./brain.ts";
import { SOLE_AHEAD, loweredAnkle, placeSandal, reachLeg, type SandalAnchor } from "./feet.ts";
import { SANDAL_THICKNESS, Sandal } from "./Sandal.tsx";
import type { Look } from "./identity.ts";
import { BubbleIcon, type SmokeSource } from "./props.tsx";
import { characterRoots } from "./registry.ts";
import { rigPlay, rigTime, type ClipsJson, type RigPlay } from "./rig.ts";

/** Anything that yields a frame per tick: a live Brain, or a frozen frame in the state gallery. */
export interface Animator {
  update(dt: number, now: number): Frame;
  settle?(): void;
}

export interface TagInfo {
  title: string;
  subtitle: string | null;
  color: string;
  text: string;
}

const GLB_URL = "/assets/character/character.glb";
const CLIPS_URL = "/assets/character/clips.json";
const CATCH_UP_STEP_S = 0.1;
const MAX_CATCH_UP_S = 60;
const B = (name: string) => `mixamorig${name}`;
/** Seconds for the laptop lid to swing fully open or shut. */
const LID_S = 0.6;
const ik = { hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(), target: new THREE.Vector3(), fwd: new THREE.Vector3() };
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
    const wanted = up.clone().sub(axis.clone().multiplyScalar(up.dot(axis))).normalize();
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

function handFrame(rig: Rig, side: "Left" | "Right") {
  const p = (n: string) => new THREE.Vector3().setFromMatrixPosition(rig.bind(`${side}${n}`));
  const hand = p("Hand");
  const fingers = p("HandMiddle1").sub(hand).normalize();
  const across = p("HandIndex1").sub(p("HandPinky1")).normalize();
  const palm = new THREE.Vector3().crossVectors(fingers, across).normalize();
  // Palms face the body in the bind (A) pose.
  if (palm.x * (side === "Left" ? -1 : 1) < 0) palm.negate();
  return { hand, fingers, across, palm, at: p };
}

const SMOOTH = (k: number) => k * k * (3 - 2 * k);
/** Name tag height over the head bone (at the base of the skull): just clear of the hair, seated or standing. */
const TAG_ABOVE_HEAD = 0.34;
/** How fast the tag follows the head (1/s): steady through breathing and typing, quick to follow a sit-down. */
const TAG_FOLLOW = 5;

/**
 * Rig clips with a drag on the cigarette, in clip seconds (make_animations.py): while the hand is at the lips the tip
 * glows and gives off little smoke; once it leaves, the smoke comes back out of the mouth.
 */
const DRAGS: Record<string, { drag: readonly [number, number]; exhale: readonly [number, number] }> = {
  smoke: { drag: [1.75, 2.9], exhale: [2.95, 4.4] },
  smokeStand: { drag: [2.45, 3.6], exhale: [3.65, 5.1] },
  think: { drag: [1.95, 2.6], exhale: [2.65, 4.0] },
  drag: { drag: [0.05, 0.6], exhale: [0.65, 1.5] },
  phone: { drag: [4.55, 5.6], exhale: [5.7, 7.1] },
};
/** Cap crown: an ellipsoid hugging the cropped hair (head ±0.075 wide, 0.2 deep, crown at 1.66 m). */
const CAP = { y: 1.588, z: 0.042, crown: [0.088, 0.084, 0.11] as [number, number, number] };

const MAT = {
  paper: new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8 }),
  filter: new THREE.MeshStandardMaterial({ color: "#c98a3c", roughness: 0.7 }),
  lighter: new THREE.MeshStandardMaterial({ color: "#d23c2a", roughness: 0.4 }),
  flame: new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ff9a2a", emissiveIntensity: 4, transparent: true, opacity: 0.9 }),
  cup: new THREE.MeshStandardMaterial({ color: "#efe9dd", roughness: 0.35 }),
  coffee: new THREE.MeshStandardMaterial({ color: "#3b2416", roughness: 0.2 }),
  laptop: new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.5, roughness: 0.45 }),
  screen: new THREE.MeshStandardMaterial({ color: "#0d1b2a", emissive: "#5ab4ff", emissiveIntensity: 0.55 }),
};

function Cigarette({ tip, tipMat }: { tip: React.RefObject<THREE.Mesh | null>; tipMat: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} material={MAT.filter}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.024, 6]} />
      </mesh>
      <mesh position={[0, 0, 0.052]} rotation={[Math.PI / 2, 0, 0]} material={MAT.paper}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.056, 6]} />
      </mesh>
      <mesh ref={tip} position={[0, 0, 0.082]} rotation={[Math.PI / 2, 0, 0]} material={tipMat}>
        <cylinderGeometry args={[0.005, 0.005, 0.006, 6]} />
      </mesh>
    </group>
  );
}

function Lighter({ flame }: { flame: React.RefObject<THREE.Mesh | null> }) {
  return (
    <>
      <mesh material={MAT.lighter}>
        <boxGeometry args={[0.012, 0.055, 0.022]} />
      </mesh>
      <mesh ref={flame} position={[0, 0.045, 0]} material={MAT.flame}>
        <coneGeometry args={[0.008, 0.028, 8]} />
      </mesh>
    </>
  );
}


/** A scrolled feed: header, posts, a picture block (it lights the face a little at night). */
function phoneScreenTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 150;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, 72, 150);
  ctx.fillStyle = "#1f8a5a";
  ctx.fillRect(0, 0, 72, 16);
  for (let i = 0; i < 4; i++) {
    const y = 22 + i * 32;
    ctx.fillStyle = "#c9ccd2";
    ctx.beginPath();
    ctx.arc(10, y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(19, y + 2, 40, 4);
    ctx.fillRect(19, y + 9, 28, 3);
    ctx.fillStyle = i === 1 ? "#e3a66a" : "#dfe2e7";
    ctx.fillRect(4, y + 15, 64, i === 1 ? 14 : 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SCREEN = phoneScreenTexture();
const PHONE_SCREEN = new THREE.MeshStandardMaterial({ map: SCREEN, emissiveMap: SCREEN, emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.25 });
/** Phone cases, picked per person: light and bright ones read against a dark shirt from across the lot. */
const PHONE_CASES = ["#d9d4c7", "#3f6fb0", "#c0463a", "#e7b9c0", "#8fa67a", "#1b1d22", "#e0b043"].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
);

/** Phone prop (a big one, 7.6 × 16 cm): +Z out of the screen, +Y along the long side. */
function Phone({ seed }: { seed: number }) {
  return (
    <>
      <mesh material={PHONE_CASES[seed % PHONE_CASES.length]} castShadow>
        <boxGeometry args={[0.076, 0.16, 0.01]} />
      </mesh>
      <mesh position={[0, 0, 0.0051]} material={PHONE_SCREEN}>
        <planeGeometry args={[0.07, 0.152]} />
      </mesh>
    </>
  );
}

interface Props {
  brain: Animator;
  look: Look;
  tag: TagInfo | null;
  friend: boolean;
  smoke: SmokeSource;
  steam: SmokeSource;
  onSelect?: () => void;
  /** Session id under which the camera can find this character. */
  trackId?: string;
}

const sameTag = (a: TagInfo | null, b: TagInfo | null): boolean =>
  a === b || (a !== null && b !== null && a.title === b.title && a.subtitle === b.subtitle && a.color === b.color && a.text === b.text);

/** Session updates re-render the character list many times a second; a person only re-renders when its tag changes. */
export const Person = memo(
  PersonView,
  (a, b) => a.brain === b.brain && a.look === b.look && a.friend === b.friend && a.smoke === b.smoke && a.steam === b.steam && a.trackId === b.trackId && sameTag(a.tag, b.tag),
);

function PersonView({ brain, look, tag, friend, smoke, steam, onSelect, trackId }: Props) {
  const asset = useCharacterAsset();
  const rig = useMemo(() => buildRig(asset, look), [asset, look]);
  const mixer = useMemo(() => new THREE.AnimationMixer(rig.object), [rig]);
  const root = useRef<THREE.Group>(null!);
  const lap = useRef<THREE.Group>(null!);
  const overHead = useRef<THREE.Group>(null!);
  const tagAt = useMemo(() => ({ head: new THREE.Vector3(), placed: false }), []);
  const lid = useRef<THREE.Group>(null!);
  const tipMouth = useRef<THREE.Mesh>(null);
  const tipHand = useRef<THREE.Mesh>(null);
  const flame = useRef<THREE.Mesh>(null);
  const flameR = useRef<THREE.Mesh>(null);
  // The need bubble and the Zzz are mounted only while shown: each Html costs a projection and style writes a frame.
  const [overlay, setOverlay] = useState<{ bubble: NeedKind | null; zzz: boolean }>({ bubble: null, zzz: false });
  const shownOverlay = useRef(overlay);
  const tipMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a1a0a", emissive: "#ff5a1f", emissiveIntensity: 0 }), []);

  // Bone-held props, placed once in the bind pose.
  const props = useMemo(() => {
    const r = handFrame(rig, "Right");
    const l = handFrame(rig, "Left");
    const handCig = new THREE.Group();
    const mouthCig = new THREE.Group();
    const lighter = new THREE.Group();
    const lighterR = new THREE.Group();
    const phoneL = new THREE.Group();
    const phoneR = new THREE.Group();
    const cup = new THREE.Group();
    const carry = new THREE.Group();
    // Clamped between index and middle finger: the filter pokes 3 cm out of the palm side (at the lips during a drag, see
    // CIG_AT_MOUTH in make_animations.py), the lit end out of the back of the hand, angled towards the fingertips.
    const gap = r.at("HandIndex2").add(r.at("HandMiddle2")).multiplyScalar(0.5);
    const cigAxis = r.palm.clone().negate().addScaledVector(r.fingers, 0.45).normalize();
    attach(rig, "RightHand", handCig, gap.addScaledVector(r.palm, 0.03), cigAxis);
    const mouth = new THREE.Vector3(asset.meta.mouth[0], asset.meta.mouth[2], -asset.meta.mouth[1]);
    attach(rig, "Head", mouthCig, mouth.add(new THREE.Vector3(-0.018, -0.006, 0.004)), new THREE.Vector3(-0.2, -0.3, 1));
    attach(rig, "LeftHand", lighter, l.hand.clone().addScaledVector(l.fingers, 0.065).addScaledVector(l.palm, 0.022), l.palm, l.across);
    // Standing, the left hand carries the laptop, so the standing light-up clip uses the right hand.
    attach(rig, "RightHand", lighterR, r.hand.clone().addScaledVector(r.fingers, 0.065).addScaledVector(r.palm, 0.022), r.palm, r.across);
    // Phone upright in the palm: back on the palm, screen facing out of it, long side along the knuckle line (top by
    // the index finger), the fingers curled round its far edge. Seated it is in the left hand (the right one smokes);
    // standing in the right (the left carries the laptop).
    // The knuckle line slants back towards the pinky; square to the fingers instead, so the phone stands upright when
    // the clip holds the fingers level.
    for (const [f, bone, phone] of [[l, "LeftHand", phoneL], [r, "RightHand", phoneR]] as const) {
      const upright = new THREE.Vector3().crossVectors(f.palm, f.fingers).normalize();
      if (upright.dot(f.across) < 0) upright.negate();
      attach(rig, bone, phone, f.hand.clone().addScaledVector(f.fingers, 0.06).addScaledVector(f.palm, 0.024), f.palm, upright);
    }
    attach(rig, "RightHand", cup, r.hand.clone().addScaledVector(r.fingers, 0.06).addScaledVector(r.palm, 0.05), r.across);
    attach(rig, "LeftHand", carry, l.hand.clone().addScaledVector(l.fingers, 0.13).addScaledVector(l.palm, 0.02), l.across, l.palm);
    const bone = (name: string) => {
      const b = rig.bones.get(B(name));
      if (!b) throw new Error(`bone ${name} missing`);
      return b;
    };
    const feet = (["Left", "Right"] as const).map((side) => {
      const sole = new THREE.Group();
      const ankle = new THREE.Vector3().setFromMatrixPosition(rig.bind(`${side}Foot`));
      const toe = new THREE.Vector3().setFromMatrixPosition(rig.bind(`${side}ToeBase`));
      const fwd = toe.clone().sub(ankle).setY(0).normalize();
      // In the air the sole hangs right under the foot (the bind pose stands on y = 0).
      const center = ankle.clone().addScaledVector(fwd, SOLE_AHEAD).setY(-SANDAL_THICKNESS / 2);
      attach(rig, `${side}Foot`, sole, center, fwd);
      const anchor: SandalAnchor = { position: sole.position.clone(), quaternion: sole.quaternion.clone(), scale: sole.scale.clone() };
      const chain = [bone(`${side}UpLeg`), bone(`${side}Leg`), bone(`${side}Foot`)] as const;
      return { side, sole, anchor, chain, clipPose: chain.map(() => new THREE.Quaternion()), toe: bone(`${side}ToeBase`) };
    });
    const cap = new THREE.Group();
    // The skull's centre sits 4 cm in front of the head bone (measured on the MPFB mesh): the crown is centred there.
    if (look.cap) attach(rig, "Head", cap, new THREE.Vector3(0, CAP.y, CAP.z), new THREE.Vector3(0, 0, 1));
    return { handCig, mouthCig, lighter, lighterR, phoneL, phoneR, cup, carry, feet, cap, head: bone("Head") };
  }, [rig, asset.meta.mouth, look.cap]);

  const actions = useRef(new Map<string, THREE.AnimationAction>());
  useEffect(
    () => () => {
      mixer.stopAllAction();
      actions.current.clear();
    },
    [mixer],
  );
  useEffect(() => {
    if (!trackId) return;
    characterRoots.set(trackId, root.current);
    return () => void characterRoots.delete(trackId);
  }, [trackId]);
  const flameWasOn = useRef(false);
  const legIk = useRef(false);
  const lidOpen = useRef(1);

  const action = (clip: THREE.AnimationClip) => {
    let a = actions.current.get(clip.name);
    if (!a) {
      a = mixer.clipAction(clip);
      a.play();
      actions.current.set(clip.name, a);
    }
    return a;
  };
  const used = useMemo(() => new Set<THREE.AnimationAction>(), []);
  const apply = (play: RigPlay, t: number, weight: number, typingRate: number) => {
    const set = (clip: THREE.AnimationClip, name: string) => {
      const a = action(clip);
      // A stopped action (effect cleanup, e.g. StrictMode's remount) would leave the rest pose showing.
      if (!a.isScheduled()) a.play();
      a.enabled = true;
      a.setEffectiveWeight(weight);
      a.time = rigTime(name, t, asset.meta, typingRate);
      used.add(a);
    };
    if ("full" in play) {
      const clip = asset.clips.get(play.full);
      if (!clip) throw new Error(`clip ${play.full} missing from character.glb (stale asset? rerun the character build)`);
      set(clip, play.full);
    } else {
      set(asset.part(play.lower, "lower"), play.lower);
      set(asset.part(play.upper, "upper"), play.upper);
    }
  };

  useFrame((state) => {
    const dt = timeControl.frameDt;
    // rAF stops while the tab is hidden; catch up on return so characters match the live state.
    if (dt > MAX_CATCH_UP_S) brain.settle?.();
    let remaining = Math.min(dt, MAX_CATCH_UP_S);
    let f = brain.update(Math.min(remaining, CATCH_UP_STEP_S), state.clock.elapsedTime);
    for (remaining -= CATCH_UP_STEP_S; remaining > 0; remaining -= CATCH_UP_STEP_S) {
      f = brain.update(Math.min(remaining, CATCH_UP_STEP_S), state.clock.elapsedTime);
    }
    root.current.visible = f.visible;
    if (!f.visible) {
      smoke.active = false;
      steam.active = false;
      return;
    }
    const lift = Math.max(0, f.seatY - CLIP_SEAT_Y) * f.sit;
    // Everyone stands on their sandals.
    root.current.position.set(f.x, lift + SANDAL_THICKNESS * look.scale, f.z);
    root.current.rotation.y = f.yaw;

    const seated = f.sit > 0.5;
    // The mixer only writes a bone when its sampled value changed, so last frame's leg IK must be undone first.
    if (legIk.current) {
      for (const leg of props.feet) leg.chain.forEach((b, i) => b.quaternion.copy(leg.clipPose[i]!));
      legIk.current = false;
    }
    used.clear();
    const w = f.prevClip === null ? 1 : SMOOTH(f.blend);
    const play = rigPlay(f.clip, seated);
    apply(play, f.clipTime, w, f.typingRate);
    if (f.prevClip !== null && w < 1) apply(rigPlay(f.prevClip, seated), f.prevClipTime, 1 - w, f.typingRate);
    for (const a of actions.current.values()) if (!used.has(a)) a.enabled = false;
    mixer.update(0);
    root.current.updateMatrixWorld(true);
    // Seats higher than the clips' (car hoods): the whole body is lifted, so stretch the legs back down to the ground.
    if (lift > 0.005) {
      ik.fwd.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
      for (const leg of props.feet) {
        leg.chain.forEach((b, i) => leg.clipPose[i]!.copy(b.quaternion));
        const [upLeg, knee, foot] = leg.chain;
        upLeg.getWorldPosition(ik.hip);
        knee.getWorldPosition(ik.knee);
        foot.getWorldPosition(ik.ankle);
        const legLength = ik.hip.distanceTo(ik.knee) + ik.knee.distanceTo(ik.ankle);
        reachLeg(upLeg, knee, foot, loweredAnkle(ik.hip, ik.ankle, lift, ik.fwd, legLength, ik.target));
      }
      legIk.current = true;
    }
    for (const leg of props.feet) placeSandal(leg.sole, leg.chain[2], leg.toe, leg.anchor, 0, SANDAL_THICKNESS);

    // Tag, need bubble and Zzz ride over the head (root space), eased so they do not bob with every breath.
    props.head.getWorldPosition(tagAt.head);
    root.current.worldToLocal(tagAt.head);
    tagAt.head.y += TAG_ABOVE_HEAD;
    if (tagAt.placed) overHead.current.position.lerp(tagAt.head, 1 - Math.exp(-TAG_FOLLOW * dt));
    else overHead.current.position.copy(tagAt.head);
    tagAt.placed = true;

    const p = f.props;
    const onLap = f.sit > 0.95 && p.laptop !== "none";
    lap.current.visible = onLap;
    props.carry.visible = !onLap && p.laptop !== "none" && f.sit < 0.05 && f.clip !== "buy";
    const closing = f.clip === "closeLaptop" ? Math.min(1, f.clipTime / 0.75) : 0;
    // Talking with the hands (the mocap chat clip) would sweep through the screen, so the lid goes down while chatting.
    const lidTarget = p.laptop === "open" && f.clip !== "chat" ? 1 - closing : 0;
    const lidStep = Math.min(Math.abs(lidTarget - lidOpen.current), dt / LID_S);
    lidOpen.current += Math.sign(lidTarget - lidOpen.current) * lidStep;
    // Hinge on the far edge; the screen faces the person when open.
    lid.current.rotation.x = 1.85 * lidOpen.current;

    const lit = p.cigarette === "lit" || p.cigarette === "mouth";
    const inMouth = p.cigarette === "unlit" || p.cigarette === "mouth" || f.clip === "lightUp";
    props.mouthCig.visible = p.cigarette !== "none" && inMouth;
    props.handCig.visible = p.cigarette !== "none" && !inMouth;
    let drawing = 0;
    let exhale = -1;
    const playing = "full" in play ? play.full : play.upper;
    const puffs = DRAGS[playing];
    if (lit && puffs) {
      const ct = rigTime(playing, f.clipTime, asset.meta, f.typingRate);
      const [d0, d1] = puffs.drag;
      const [e0, e1] = puffs.exhale;
      if (ct >= d0 && ct < d1) drawing = Math.sin((Math.PI * (ct - d0)) / (d1 - d0));
      else if (ct >= e0 && ct < e1) exhale = (ct - e0) / (e1 - e0);
    }
    tipMat.emissiveIntensity = lit || (f.clip === "lightUp" && p.flame) ? 1.2 + drawing * 3.5 : 0;
    props.lighter.visible = p.lighter && seated;
    props.lighterR.visible = p.lighter && !seated;
    props.phoneL.visible = p.phone && seated;
    props.phoneR.visible = p.phone && !seated;
    if (p.flame && !flameWasOn.current) sound.lighter();
    flameWasOn.current = p.flame;
    for (const fl of [flame.current, flameR.current]) {
      if (!fl) continue;
      fl.visible = p.flame;
      if (p.flame) fl.scale.setScalar(0.85 + Math.random() * 0.3);
    }
    props.cup.visible = p.cup;

    smoke.active = lit;
    smoke.strength = 1 - 0.85 * drawing;
    const tip = (inMouth ? tipMouth : tipHand).current;
    if (lit && tip) tip.getWorldPosition(smoke.world);
    const ex = (smoke.exhale ??= { active: false, t: 0, mouth: new THREE.Vector3(), dir: new THREE.Vector3() });
    ex.active = exhale >= 0;
    if (ex.active) {
      ex.t = exhale;
      // Out of the lips (the mouth cigarette's anchor), along the face's forward direction, a little flattened.
      props.mouthCig.getWorldPosition(ex.mouth);
      props.head.getWorldPosition(ex.dir);
      ex.dir.subVectors(ex.mouth, ex.dir);
      ex.dir.y *= 0.5;
      ex.dir.normalize();
    }
    steam.active = p.cup;
    if (p.cup) {
      props.cup.getWorldPosition(steam.world);
      steam.world.y += 0.06;
    }

    if (shownOverlay.current.bubble !== p.bubble || shownOverlay.current.zzz !== p.zzz) {
      shownOverlay.current = { bubble: p.bubble, zzz: p.zzz };
      setOverlay(shownOverlay.current);
    }
  });

  const sit = asset.meta.sitHips;
  return (
    <group ref={root} scale={look.scale * (friend ? 0.97 : 1)} onClick={(e) => (e.stopPropagation(), onSelect?.())}>
      <primitive object={rig.object} />
      {/* Props live inside the skeleton (bone children); portals render into them without reparenting. */}
      {createPortal(<Cigarette tip={tipHand} tipMat={tipMat} />, props.handCig)}
      {createPortal(<Cigarette tip={tipMouth} tipMat={tipMat} />, props.mouthCig)}
      {createPortal(<Lighter flame={flame} />, props.lighter)}
      {createPortal(<Lighter flame={flameR} />, props.lighterR)}
      {createPortal(<Phone seed={look.seed} />, props.phoneL)}
      {createPortal(<Phone seed={look.seed} />, props.phoneR)}
      {createPortal(
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT.cup}>
            <cylinderGeometry args={[0.034, 0.028, 0.08, 14]} />
          </mesh>
          <mesh position={[0, 0, 0.034]} rotation={[Math.PI / 2, 0, 0]} material={MAT.coffee}>
            <cylinderGeometry args={[0.031, 0.031, 0.006, 14]} />
          </mesh>
        </>,
        props.cup,
      )}
      {createPortal(
        <mesh material={MAT.laptop} castShadow>
          <boxGeometry args={[0.23, 0.022, 0.33]} />
        </mesh>,
        props.carry,
      )}
      {props.feet.map(({ sole, side }) => (
        <Fragment key={side}>{createPortal(<Sandal side={side} color={look.sandals} />, sole)}</Fragment>
      ))}
      {look.cap &&
        createPortal(
          <>
            <mesh scale={CAP.crown} castShadow>
              <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={look.cap} roughness={0.85} />
            </mesh>
            <mesh position={[0, 0.002, CAP.crown[2] - 0.012]} rotation={[0.24, 0, 0]} scale={[1, 1, 0.9]}>
              <cylinderGeometry args={[0.07, 0.07, 0.006, 20, 1, false, -Math.PI / 2, Math.PI]} />
              <meshStandardMaterial color={look.cap} roughness={0.85} />
            </mesh>
          </>,
          props.cap,
        )}
      {/* Laptop on the thighs while seated (root space, from the seated hips). */}
      <group ref={lap} position={[0, sit[1] + 0.085, sit[2] + 0.36]}>
        <mesh material={MAT.laptop} castShadow>
          <boxGeometry args={[0.33, 0.018, 0.23]} />
        </mesh>
        <group ref={lid} position={[0, 0.01, 0.115]}>
          <mesh position={[0, 0, -0.115]} material={MAT.laptop} castShadow>
            <boxGeometry args={[0.33, 0.01, 0.23]} />
          </mesh>
          <mesh position={[0, -0.0065, -0.115]} rotation={[Math.PI / 2, 0, 0]} material={MAT.screen}>
            <planeGeometry args={[0.3, 0.2]} />
          </mesh>
        </group>
      </group>

      <group ref={overHead}>
        {tag && (
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div className="name-tag" style={{ borderColor: tag.color }}>
              <span className="name-tag-dot" style={{ background: tag.color }} />
              <span className="name-tag-title">{tag.title}</span>
              {tag.subtitle && <span className="name-tag-sub">{tag.subtitle}</span>}
              <span className="name-tag-state" style={{ color: tag.color }}>
                {tag.text}
              </span>
            </div>
          </Html>
        )}
        {overlay.bubble && (
          <Html position={[0.28, -0.08, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="bubble" data-kind={overlay.bubble} style={{ display: "flex" }}>
              <BubbleIcon />
            </div>
          </Html>
        )}
        {overlay.zzz && (
          <Html position={[0.15, -0.09, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="zzz">
              z<span>z</span>
              <span>Z</span>
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}
