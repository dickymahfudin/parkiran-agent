// The rigged MPFB character: one shared GLB, cloned per person, parts and colours picked from the session's look,
// clips driven frame by frame from the brain (deterministic, so hidden-tab catch-up and the gallery work).
import { Html } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CLIP_SEAT_Y } from "../layout.ts";
import { sound } from "../../audio/sound.ts";
import { Icon } from "../../hud/icons.tsx";
import { timeControl } from "../timeControl.ts";
import type { Frame, NeedKind } from "./brain.ts";
import { B, attach, buildRig, handFrame, useCharacterAsset } from "./characterAsset.ts";
import { DRAGS } from "./clips.ts";
import { disposeSkinned } from "./dispose.ts";
import { SOLE_AHEAD, loweredAnkle, placeSandal, reachLeg, type SandalAnchor } from "./feet.ts";
import { SANDAL_THICKNESS, Sandal } from "./Sandal.tsx";
import type { Look } from "./identity.ts";
import { closeFist, keepLevel, type Fist } from "./personIk.ts";
import { CAP, Cigarette, Cup, Lighter, MAT, PHONE_GRIP, Phone, VAPE_CURL, VAPE_REACH, Vape } from "./personProps.tsx";
import { BubbleIcon, type SmokeSource } from "./props.tsx";
import { CrewHead } from "./Crew.tsx";
import { characterRoots } from "./registry.ts";
import { rigPlay, rigTime, type CupHand, type RigPlay } from "./rig.ts";
import { sameTag, type TagInfo } from "./tags.ts";

/** Anything that yields a frame per tick: a live Brain, or a frozen frame in the state gallery. */
export interface Animator {
  update(dt: number, now: number): Frame;
  settle?(): void;
}

export type { TagInfo };

const CATCH_UP_STEP_S = 0.1;
const MAX_CATCH_UP_S = 60;
/** Seconds for the laptop lid to swing fully open or shut. */
const LID_S = 0.6;
const ik = {
  hip: new THREE.Vector3(),
  knee: new THREE.Vector3(),
  ankle: new THREE.Vector3(),
  target: new THREE.Vector3(),
  fwd: new THREE.Vector3(),
  filter: new THREE.Vector3(),
  lips: new THREE.Vector3(),
  tip: new THREE.Vector3(),
};

const SMOOTH = (k: number) => k * k * (3 - 2 * k);
/** Name tag height over the head bone (at the base of the skull): just clear of the hair, seated or standing. */
const TAG_ABOVE_HEAD = 0.34;
/** How fast the tag follows the head (1/s): steady through breathing and typing, quick to follow a sit-down. */
const TAG_FOLLOW = 5;

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

/** Session updates re-render the character list many times a second; a person only re-renders when its tag changes. */
export const Person = memo(
  PersonView,
  (a, b) =>
    a.brain === b.brain &&
    a.look === b.look &&
    a.friend === b.friend &&
    a.smoke === b.smoke &&
    a.steam === b.steam &&
    a.trackId === b.trackId &&
    sameTag(a.tag, b.tag),
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
  // The need bubble, the Zzz and the done badge are mounted only while shown: each Html costs a projection and style
  // writes a frame.
  const [overlay, setOverlay] = useState<{ bubble: NeedKind | null; zzz: boolean; done: boolean }>({ bubble: null, zzz: false, done: false });
  const shownOverlay = useRef(overlay);
  const tipMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a1a0a", emissive: "#ff5a1f", emissiveIntensity: 0 }), []);
  const ledMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0b2a33", emissive: "#3fe0ff", emissiveIntensity: 0 }), []);
  const vape = look.habit === "vape";
  // Only a kretek smoker ever shows a cigarette: a non-smoker has none to show whatever the frame says.
  const kretek = look.habit === "kretek";
  smoke.vape = vape;

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
    const cupL = new THREE.Group();
    const cupR = new THREE.Group();
    const carry = new THREE.Group();
    const carryR = new THREE.Group();
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
    // Phone upright in the palm: back on the palm and the flat fingers, screen facing out of it, long side along the
    // knuckle line, its bottom edge just above the pinky and the rest of it rising past the index finger. The `phone`
    // finger pose in make_animations.py is fitted to exactly this box and place: index to ring round the far edge, the
    // thumb on the screen, nothing inside the phone. Seated it is in the left hand (the right one smokes); standing in
    // the right (the left carries the laptop).
    // The knuckle line slants back towards the pinky; square to the fingers instead, so the phone stands upright when
    // the clip holds the fingers level.
    for (const [f, bone, phone] of [
      [l, "LeftHand", phoneL],
      [r, "RightHand", phoneR],
    ] as const) {
      const upright = new THREE.Vector3().crossVectors(f.palm, f.fingers).normalize();
      if (upright.dot(f.across) < 0) upright.negate();
      const at = f.hand.clone().addScaledVector(f.fingers, PHONE_GRIP.along).addScaledVector(f.palm, PHONE_GRIP.out).addScaledVector(upright, PHONE_GRIP.up);
      attach(rig, bone, phone, at, f.palm, upright);
    }
    // The kopi goes in the left hand, the right one being the smoking hand; only beside the phone (seated, left hand)
    // is it in the right. Upright along the knuckle line (thumb up), in front of the palm.
    for (const [f, bone, cup] of [
      [l, "LeftHand", cupL],
      [r, "RightHand", cupR],
    ] as const) {
      attach(rig, bone, cup, f.hand.clone().addScaledVector(f.fingers, 0.06).addScaledVector(f.palm, 0.05), f.across);
    }
    // The laptop is carried in the left hand, or in the right while the left one has the kopi.
    for (const [f, bone, laptop] of [
      [l, "LeftHand", carry],
      [r, "RightHand", carryR],
    ] as const) {
      attach(rig, bone, laptop, f.hand.clone().addScaledVector(f.fingers, 0.13).addScaledVector(f.palm, 0.02), f.across, f.palm);
    }
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
      const center = ankle
        .clone()
        .addScaledVector(fwd, SOLE_AHEAD)
        .setY(-SANDAL_THICKNESS / 2);
      attach(rig, `${side}Foot`, sole, center, fwd);
      const anchor: SandalAnchor = { position: sole.position.clone(), quaternion: sole.quaternion.clone(), scale: sole.scale.clone() };
      const chain = [bone(`${side}UpLeg`), bone(`${side}Leg`), bone(`${side}Foot`)] as const;
      return { side, sole, anchor, chain, clipPose: chain.map(() => new THREE.Quaternion()), toe: bone(`${side}ToeBase`) };
    });
    const cap = new THREE.Group();
    // The skull's centre sits 4 cm in front of the head bone (measured on the MPFB mesh): the crown is centred there.
    if (look.cap) attach(rig, "Head", cap, new THREE.Vector3(0, CAP.y, CAP.z), new THREE.Vector3(0, 0, 1));
    // Head accessory (peci or glasses, `accessoryFor`), on the skull centre like the cap.
    const crewHead = new THREE.Group();
    if (look.accessory) attach(rig, "Head", crewHead, new THREE.Vector3(0, CAP.y, CAP.z), new THREE.Vector3(0, 0, 1));
    // A vape sits upright in the right fist: in front of the palm just behind the knuckles, mouthpiece out of the top
    // on the index side. The fingers close round it at runtime (VAPE_CURL); near the lips the arm is pulled so its tip
    // lands where the cigarette's filter would (VAPE_REACH).
    const vapeGrip = new THREE.Group();
    const fistCentre = r.at("HandIndex1").add(r.at("HandPinky1")).multiplyScalar(0.5).addScaledVector(r.fingers, -0.015).addScaledVector(r.palm, 0.03);
    attach(rig, "RightHand", vapeGrip, fistCentre.addScaledVector(r.across, 0.044), r.palm, r.across);
    const palmSign = Math.sign(new THREE.Vector3().crossVectors(r.fingers, r.across).dot(r.palm)) || 1;
    const fist: Fist = {
      arm: bone("RightArm"),
      foreArm: bone("RightForeArm"),
      hand: bone("RightHand"),
      index1: bone("RightHandIndex1"),
      middle1: bone("RightHandMiddle1"),
      pinky1: bone("RightHandPinky1"),
      palmSign,
      curl: VAPE_CURL.flatMap(([finger, angles]) => angles.map((a, i) => [bone(`RightHand${finger}${i + 1}`), a] as const)),
    };
    const grip = { left: cupL.quaternion.clone(), right: cupR.quaternion.clone() };
    return {
      handCig,
      mouthCig,
      lighter,
      lighterR,
      phoneL,
      phoneR,
      cupL,
      cupR,
      grip,
      carry,
      carryR,
      feet,
      cap,
      crewHead,
      vapeGrip,
      fist,
      head: bone("Head"),
      neck: bone("Neck"),
    };
  }, [rig, asset.meta.mouth, look.cap, look.accessory]);

  const actions = useRef(new Map<string, THREE.AnimationAction>());
  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.object);
      actions.current.clear();
    },
    [mixer, rig],
  );
  useEffect(() => () => disposeSkinned(rig.object), [rig]);
  // Materials made here (not by R3F from JSX) are ours to free.
  useEffect(() => () => tipMat.dispose(), [tipMat]);
  useEffect(() => () => ledMat.dispose(), [ledMat]);
  useEffect(() => {
    if (!trackId) return;
    characterRoots.set(trackId, root.current);
    return () => void characterRoots.delete(trackId);
  }, [trackId]);
  const flameWasOn = useRef(false);
  const doneWasOn = useRef(false);
  const legIk = useRef(false);
  /** The vaper's closed fist: the clip pose of the curled fingers (and of the arm when pulled to the lips), kept to undo it next frame. */
  const fistPose = useRef<{ applied: boolean; saved: THREE.Quaternion[]; arm: THREE.Quaternion[] | null } | null>(null);
  /** Head turn towards a chatting neighbour, eased; the clip pose of neck and head is kept to undo it next frame. */
  const headTurn = useRef({ now: 0, applied: false, neck: new THREE.Quaternion(), head: new THREE.Quaternion() });
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
    const set = (clip: THREE.AnimationClip, name: string, at = t) => {
      const a = action(clip);
      // A stopped action (effect cleanup, e.g. StrictMode's remount) would leave the rest pose showing.
      if (!a.isScheduled()) a.play();
      a.enabled = true;
      a.setEffectiveWeight(weight);
      a.time = rigTime(name, at, asset.meta, typingRate);
      used.add(a);
    };
    if ("full" in play) {
      const clip = asset.clips.get(play.full);
      if (!clip) throw new Error(`clip ${play.full} missing from character.glb (stale asset? rerun the character build)`);
      set(clip, play.full);
    } else {
      set(asset.part(play.lower, "lower"), play.lower);
      set(asset.part(play.upper, "upper"), play.upper, play.upperAt ?? t);
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
    const cupHand: CupHand | null = !f.props.cup ? null : f.props.phone && seated ? "right" : "left";
    // The mixer only writes a bone when its sampled value changed, so last frame's leg IK must be undone first.
    if (legIk.current) {
      for (const leg of props.feet) leg.chain.forEach((b, i) => b.quaternion.copy(leg.clipPose[i]!));
      legIk.current = false;
    }
    const fp = (fistPose.current ??= { applied: false, saved: props.fist.curl.map(() => new THREE.Quaternion()), arm: null });
    if (fp.applied) {
      props.fist.curl.forEach(([b], i) => b.quaternion.copy(fp.saved[i]!));
      if (fp.arm) [props.fist.arm, props.fist.foreArm, props.fist.hand].forEach((b, i) => b.quaternion.copy(fp.arm![i]!));
      fp.applied = false;
      fp.arm = null;
    }
    const lk = headTurn.current;
    if (lk.applied) {
      props.neck.quaternion.copy(lk.neck);
      props.head.quaternion.copy(lk.head);
      lk.applied = false;
    }
    used.clear();
    const w = f.prevClip === null ? 1 : SMOOTH(f.blend);
    const play = rigPlay(f.clip, seated, cupHand);
    apply(play, f.clipTime, w, f.typingRate);
    if (f.prevClip !== null && w < 1) apply(rigPlay(f.prevClip, seated, cupHand), f.prevClipTime, 1 - w, f.typingRate);
    for (const a of actions.current.values()) if (!used.has(a)) a.enabled = false;
    mixer.update(0);
    lk.now += (f.look - lk.now) * (1 - Math.exp(-4 * dt));
    if (Math.abs(lk.now) > 1e-3) {
      lk.neck.copy(props.neck.quaternion);
      lk.head.copy(props.head.quaternion);
      props.neck.rotateY(lk.now * 0.4);
      props.head.rotateY(lk.now * 0.6);
      lk.applied = true;
    }
    root.current.updateMatrixWorld(true);
    if (vape && (f.props.cigarette === "lit" || f.props.cigarette === "unlit")) {
      // Near the lips, move the hand by the gap between the filter's spot (where the clip aims) and the pod's tip.
      props.handCig.getWorldPosition(ik.filter);
      props.mouthCig.getWorldPosition(ik.lips);
      const reach = 1 - THREE.MathUtils.smoothstep(ik.filter.distanceTo(ik.lips), VAPE_REACH.near, VAPE_REACH.far);
      if (reach > 0.01) {
        fp.arm = [props.fist.arm, props.fist.foreArm, props.fist.hand].map((b) => b.quaternion.clone());
        props.vapeGrip.getWorldPosition(ik.tip);
        props.fist.hand.getWorldPosition(ik.target).addScaledVector(ik.filter.sub(ik.tip), reach);
        reachLeg(props.fist.arm, props.fist.foreArm, props.fist.hand, ik.target);
      }
      closeFist(props.fist, fp.saved);
      fp.applied = true;
    }
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
    const carried = !onLap && p.laptop !== "none" && f.sit < 0.05 && f.clip !== "buy";
    props.carry.visible = carried && cupHand !== "left";
    props.carryR.visible = carried && cupHand === "left";
    const closing = f.clip === "closeLaptop" ? Math.min(1, f.clipTime / 0.75) : 0;
    // Talking with the hands (the mocap chat clip) would sweep through the screen, so the lid goes down while chatting.
    const lidTarget = p.laptop === "open" && f.clip !== "chat" ? 1 - closing : 0;
    const lidStep = Math.min(Math.abs(lidTarget - lidOpen.current), dt / LID_S);
    lidOpen.current += Math.sign(lidTarget - lidOpen.current) * lidStep;
    // Hinge on the far edge; the screen faces the person when open.
    lid.current.rotation.x = 1.85 * lidOpen.current;

    // A kretek burns (tip, smoke) in the hand or the lips; a vape is only ever in the hand, and "mouth" means put away.
    const lit = kretek && (p.cigarette === "lit" || p.cigarette === "mouth");
    const vaping = vape && p.cigarette === "lit";
    const inMouth = kretek && (p.cigarette === "unlit" || p.cigarette === "mouth" || f.clip === "lightUp");
    props.mouthCig.visible = kretek && p.cigarette !== "none" && inMouth;
    props.handCig.visible = kretek && p.cigarette !== "none" && !inMouth;
    props.vapeGrip.visible = vape && (p.cigarette === "lit" || p.cigarette === "unlit");
    let drawing = 0;
    let exhale = -1;
    const playing = "full" in play ? play.full : play.upper;
    const puffs = DRAGS[playing];
    if ((lit || vaping) && puffs) {
      const ct = rigTime(playing, f.clipTime, asset.meta, f.typingRate);
      const [d0, d1] = puffs.drag;
      const [e0, e1] = puffs.exhale;
      if (ct >= d0 && ct < d1) drawing = Math.sin((Math.PI * (ct - d0)) / (d1 - d0));
      else if (ct >= e0 && ct < e1) exhale = (ct - e0) / (e1 - e0);
    }
    tipMat.emissiveIntensity = lit || (f.clip === "lightUp" && p.flame) ? 1.2 + drawing * 3.5 : 0;
    ledMat.emissiveIntensity = vaping ? 0.3 + drawing * 3 : 0;
    props.lighter.visible = p.lighter && seated;
    props.lighterR.visible = p.lighter && !seated;
    props.phoneL.visible = p.phone && seated;
    props.phoneR.visible = p.phone && !seated;
    if (p.flame && !flameWasOn.current) sound.lighter();
    flameWasOn.current = p.flame;
    if (p.done && !doneWasOn.current) sound.done();
    doneWasOn.current = p.done;
    for (const fl of [flame.current, flameR.current]) {
      if (!fl) continue;
      fl.visible = p.flame;
      if (p.flame) fl.scale.setScalar(0.85 + Math.random() * 0.3);
    }
    props.cupL.visible = cupHand === "left";
    props.cupR.visible = cupHand === "right";
    const cup = cupHand === "left" ? props.cupL : cupHand === "right" ? props.cupR : null;
    if (cup) keepLevel(cup, props.grip[cupHand!], props.mouthCig.getWorldPosition(ik.lips));

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
    steam.active = cup !== null;
    if (cup) {
      cup.getWorldPosition(steam.world);
      steam.world.y += 0.06;
    }

    if (shownOverlay.current.bubble !== p.bubble || shownOverlay.current.zzz !== p.zzz || shownOverlay.current.done !== p.done) {
      shownOverlay.current = { bubble: p.bubble, zzz: p.zzz, done: p.done };
      setOverlay(shownOverlay.current);
    }
  });

  const sit = asset.meta.sitHips;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js group, not a DOM element; the HUD row is the keyboard path
    <group
      ref={root}
      scale={look.scale * (friend ? 0.97 : 1)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
    >
      <primitive object={rig.object} />
      {/* Props live inside the skeleton (bone children); portals render into them without reparenting. */}
      {kretek && createPortal(<Cigarette tip={tipHand} tipMat={tipMat} />, props.handCig)}
      {vape && createPortal(<Vape led={ledMat} />, props.vapeGrip)}
      {kretek && createPortal(<Cigarette tip={tipMouth} tipMat={tipMat} />, props.mouthCig)}
      {createPortal(<Lighter flame={flame} />, props.lighter)}
      {createPortal(<Lighter flame={flameR} />, props.lighterR)}
      {createPortal(<Phone seed={look.seed} />, props.phoneL)}
      {createPortal(<Phone seed={look.seed} />, props.phoneR)}
      {createPortal(<Cup />, props.cupL)}
      {createPortal(<Cup />, props.cupR)}
      {[props.carry, props.carryR].map((laptop, i) => (
        <Fragment key={i}>
          {createPortal(
            <mesh material={MAT.laptop} castShadow>
              <boxGeometry args={[0.23, 0.022, 0.33]} />
            </mesh>,
            laptop,
          )}
        </Fragment>
      ))}
      {props.feet.map(({ sole, side }) => (
        <Fragment key={side}>{createPortal(<Sandal side={side} color={look.sandals} />, sole)}</Fragment>
      ))}
      {look.cap &&
        createPortal(
          <>
            <mesh position={[0, CAP.lift, -0.006]} scale={CAP.crown} castShadow>
              <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={look.cap} roughness={0.85} />
            </mesh>
            {/* The brim at the forehead, above the eyes (and any glasses), only slightly tipped down. */}
            <mesh position={[0, CAP.lift + 0.002, CAP.crown[2] - 0.016]} rotation={[0.12, 0, 0]} scale={[0.95, 1, 0.95]}>
              <cylinderGeometry args={[0.07, 0.07, 0.006, 20, 1, false, -Math.PI / 2, Math.PI]} />
              <meshStandardMaterial color={look.cap} roughness={0.85} />
            </mesh>
          </>,
          props.cap,
        )}
      {look.accessory && createPortal(<CrewHead accessory={look.accessory} />, props.crewHead)}
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
              {(tag.text || tag.icon) && (
                <span className="name-tag-state" style={{ color: tag.color }}>
                  {tag.icon && <Icon name={tag.icon} />}
                  {tag.text}
                </span>
              )}
            </div>
          </Html>
        )}
        {overlay.bubble && (
          <Html position={[0.28, -0.08, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="bubble" data-kind={overlay.bubble} data-habit={look.habit} style={{ display: "flex" }}>
              <BubbleIcon />
            </div>
          </Html>
        )}
        {overlay.done && (
          <Html position={[0.26, -0.06, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="done-badge">
              <Icon name="done" />
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
