// Camera modes: clamped free orbit, the cinematic director (cuts to what is happening, drifts over the lot in between),
// focus on the selected character, fixed compact view.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { serverNow, useApp } from "../state/store.ts";
import { characterRoots } from "./characters/registry.ts";
import { START, direct, type DirectorState, type Framing } from "./director.ts";
import { timeControl } from "./timeControl.ts";

type Vec3 = readonly [number, number, number];

/** What the cinematic drift circles: the benches and the warung front. */
const LOT_CENTER = new THREE.Vector3(0.2, 0.8, -2.6);
const UP = new THREE.Vector3(0, 1, 0);
const COMPACT = { position: new THREE.Vector3(-3.4, 9.6, 13.2), target: new THREE.Vector3(0.4, 0.3, -1.0) };
const MIN_AZIMUTH = -1.1;
const MAX_AZIMUTH = 0.9;
/** Closer than this (m, camera to pivot) the view only shows nearby things, so any orbit angle is fine. */
const CLOSE_RADIUS = 7;
/** How near the wheel can bring the camera to the point it zooms towards (m): face to face with a character. */
const MIN_DISTANCE = 0.35;
/** Low orbits near the ground must not dip the camera under the asphalt (m). */
const MIN_CAMERA_Y = 0.25;
/** Zooming out of a close-up moves at least as if the pivot were this deep (the zoom is a ratio of that depth). */
const ZOOM_OUT_MIN_PIVOT = 2.5;
/** A character's body for picking what the mouse points at: spheres on these bones (radius, m). */
const BODY_PARTS: [RegExp, number][] = [
  [/Head$/, 0.14],
  [/Spine2$/, 0.2],
  [/Hips$/, 0.2],
];
/** Visible, with every ancestor visible (what the renderer draws). */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Raycasting the scenery is the costly part of a wheel step; trackpads fire dozens per second. */
const PICK_EVERY_MS = 120;
/** The scenery list for picking is rebuilt now and then (props come and go as assets load). */
const SCENERY_REFRESH_MS = 5000;
const FOCUS_DISTANCE = 3.6;
const FOCUS_HEIGHT = 1.0;
/** Seen from the front and a little to the side, at eye-ish height: under awnings, above car roofs. */
const FOCUS_SIDE = 0.45;
const FOCUS_LIFT = 0.9;

/** Director shots: distance from the person, height over the focus point, and how far round from their front. */
const FRAMING: Record<Framing, { distance: number; lift: number; front: number }> = {
  close: { distance: 2.3, lift: 0.45, front: 0.7 },
  medium: { distance: 4.2, lift: 1.3, front: 0.55 },
  follow: { distance: 7.5, lift: 3.0, front: 0 },
};

/** Zoom per wheel pixel (log scale): a mouse notch (~100 px) is about 9 %, a slow two-finger swipe a gentle glide. */
const ZOOM_PER_PIXEL = 0.0009;
/** Trackpad pinches arrive as small wheel deltas with ctrlKey set. */
const PINCH_GAIN = 2.5;
/** One event never counts for more than this (fast flicks and momentum spikes). */
const MAX_WHEEL_PIXELS = 120;
/** How fast queued zoom is played out (1/s): smooth, yet it still follows the fingers. */
const ZOOM_EASE = 12;
const MAX_ZOOM_DISTANCE = 30;

/** Exponential ease that does not depend on frame rate. */
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function CameraRig({ position, target }: { position: Vec3; target: Vec3 }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const mode = useApp((s) => s.cameraMode);
  const compact = useApp((s) => s.compact);
  const drift = useRef(0);
  const tmp = useRef({
    focus: new THREE.Vector3(),
    step: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    side: new THREE.Vector3(),
  });
  const director = useRef<DirectorState>(START);
  const directing = useRef(false);
  const zoomedFor = useRef<string | null>(null);
  const returning = useRef(false);
  const wasFocused = useRef(false);
  const home = useRef({ position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) });
  const lastReset = useRef(useApp.getState().viewResets);
  /** Zoom still to play out (log of the distance ratio, < 0 = in) and the point it heads for or backs away from. */
  const zoom = useRef({ pending: 0, anchor: new THREE.Vector3(), view: new THREE.Vector3(), toAnchor: new THREE.Vector3() });

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const center = new THREE.Vector3();
    const hit = new THREE.Vector3();
    const sphere = new THREE.Sphere();
    const bodies = new WeakMap<THREE.Object3D, [THREE.Object3D, number][]>();
    const bodyOf = (root: THREE.Object3D) => {
      let parts = bodies.get(root);
      if (!parts) {
        const found: [THREE.Object3D, number][] = [];
        root.traverse((o) => {
          const part = BODY_PARTS.find(([name]) => (o as THREE.Bone).isBone && name.test(o.name));
          if (part) found.push([o, part[1]]);
        });
        parts = found;
        // Bones appear once the character asset has loaded; cache only a complete body.
        if (found.length === BODY_PARTS.length) bodies.set(root, found);
      }
      return parts;
    };
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let scenery: THREE.Object3D[] = [];
    let sceneryAt = -Infinity;
    let pickedAt = -Infinity;
    const sceneryHit = new THREE.Vector3();
    let hasSceneryHit = false;

    /** Distance along the mouse ray (left in `raycaster`) to the first person, piece of scenery or ground. */
    const pick = (e: WheelEvent): number => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      let best = raycaster.ray.intersectPlane(ground, hit) ? raycaster.ray.origin.distanceTo(hit) : Infinity;
      // People as a few spheres on their bones: raycasting skinned bodies would pose every vertex on the CPU.
      for (const root of characterRoots.values()) {
        if (!root.visible) continue;
        for (const [bone, radius] of bodyOf(root)) {
          sphere.set(bone.getWorldPosition(center), radius);
          // From inside a sphere the ray only meets its far side: that part is already behind the camera.
          if (sphere.containsPoint(raycaster.ray.origin)) continue;
          if (raycaster.ray.intersectSphere(sphere, hit)) best = Math.min(best, raycaster.ray.origin.distanceTo(hit));
        }
      }
      const now = performance.now();
      if (now - pickedAt < PICK_EVERY_MS) {
        // Between scenery raycasts, reuse the last hit while the mouse still points at it.
        if (hasSceneryHit && raycaster.ray.distanceToPoint(sceneryHit) < 0.3) best = Math.min(best, raycaster.ray.origin.distanceTo(sceneryHit));
        return best;
      }
      pickedAt = now;
      if (now - sceneryAt > SCENERY_REFRESH_MS) {
        sceneryAt = now;
        scenery = [];
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
          // The raycaster tests layers, not visibility: StaticMerge keeps hundreds of merged sources hidden in the graph.
          if (!shown(m)) return;
          // Leaves, decals and glass: costly to test and nothing anyone zooms into.
          const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
          if (mat && (mat.transparent || mat.alphaTest > 0)) return;
          scenery.push(m);
        });
      }
      hasSceneryHit = false;
      for (const h of raycaster.intersectObjects(scenery, false)) {
        if (!h.object.visible || h.distance < 0.05) continue;
        hasSceneryHit = true;
        sceneryHit.copy(h.point);
        best = Math.min(best, h.distance);
        break;
      }
      return best;
    };

    // Our own wheel zoom (OrbitControls' is off): queued and eased, so slow two-finger swipes glide instead of jumping.
    const onWheel = (e: WheelEvent) => {
      const c = controls.current;
      const st = useApp.getState();
      if (!c || st.compact || st.cameraMode !== "orbit") return;
      // Also keeps a trackpad pinch (ctrl + wheel) from zooming the whole page.
      e.preventDefault();
      const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1) * (e.ctrlKey ? PINCH_GAIN : 1);
      const step = THREE.MathUtils.clamp(pixels, -MAX_WHEEL_PIXELS, MAX_WHEEL_PIXELS) * ZOOM_PER_PIXEL;
      const z = zoom.current;
      if (z.pending !== 0 && Math.sign(step) !== Math.sign(z.pending)) z.pending = 0;
      z.pending += step;
      if (st.selectedId && characterRoots.get(st.selectedId)?.visible) {
        z.anchor.copy(c.target);
        return;
      }
      // In: head for whatever the mouse points at, right up to a face. Out: back away along the same ray, as if from
      // a point at least a few metres deep, so a close-up does not crawl out. The view direction never changes.
      const reach = pick(e);
      const depth = step < 0 ? reach : Math.max(camera.position.distanceTo(c.target), ZOOM_OUT_MIN_PIVOT);
      if (Number.isFinite(depth)) raycaster.ray.at(depth, z.anchor);
      else z.pending = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R" || e.key === "Home") useApp.getState().resetView();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [gl, camera, scene]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(timeControl.frameDt, 0.1);
    const { focus, step, desired, q, side } = tmp.current;
    const st = useApp.getState();
    if (st.viewResets !== lastReset.current) {
      lastReset.current = st.viewResets;
      returning.current = true;
    }
    const selected = st.selectedId ? characterRoots.get(st.selectedId) : undefined;
    if (st.cameraMode !== "cinematic") directing.current = false;
    // The lot overview is clamped to the street side; around a character or zoomed in close, any angle is fine.
    const close = camera.position.distanceTo(c.target) < CLOSE_RADIUS;
    const free = (Boolean(selected?.visible) || returning.current || close) && !st.compact;
    if (free) {
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
    } else {
      // Zooming back out from a close-up at an angle the overview does not allow: swing round smoothly, never snap.
      const theta = c.getAzimuthalAngle();
      const swing = (THREE.MathUtils.clamp(theta, MIN_AZIMUTH, MAX_AZIMUTH) - theta) * ease(2.5, dt);
      if (Math.abs(swing) > 1e-5) camera.position.sub(c.target).applyAxisAngle(UP, swing).add(c.target);
      c.minAzimuthAngle = Math.min(MIN_AZIMUTH, theta + swing);
      c.maxAzimuthAngle = Math.max(MAX_AZIMUTH, theta + swing);
    }

    const z = zoom.current;
    if (Math.abs(z.pending) > 1e-5 && !st.compact && st.cameraMode === "orbit" && !returning.current) {
      const apply = z.pending * ease(ZOOM_EASE, dt);
      z.pending -= apply;
      const d = z.toAnchor.subVectors(z.anchor, camera.position).length();
      if (d > 1e-4) {
        const next = THREE.MathUtils.clamp(d * Math.exp(apply), MIN_DISTANCE, MAX_ZOOM_DISTANCE);
        if (next === MIN_DISTANCE || next === MAX_ZOOM_DISTANCE) z.pending = 0;
        camera.position.addScaledVector(z.toAnchor, (d - next) / d);
        if (!selected?.visible) {
          // The orbit pivot moves to the depth of what was zoomed to, straight ahead, so the angle stays.
          camera.getWorldDirection(z.view);
          c.target.copy(camera.position).addScaledVector(z.view, Math.max(next, MIN_DISTANCE));
          if (apply > 0) {
            // Zooming out also slides back towards the overview, so the default framing returns.
            const homeDistance = home.current.position.distanceTo(home.current.target);
            const pull = THREE.MathUtils.smoothstep(camera.position.distanceTo(c.target), homeDistance * 0.3, homeDistance);
            step.subVectors(home.current.target, c.target).multiplyScalar(pull * ease(6, dt));
            c.target.add(step);
            camera.position.add(step);
          }
        }
      }
    }

    if (st.compact) {
      returning.current = false;
      wasFocused.current = false;
      camera.position.lerp(COMPACT.position, ease(3, dt));
      c.target.lerp(COMPACT.target, ease(3, dt));
    } else if (selected?.visible) {
      // Track the character: move target and camera together, and dolly in once per selection.
      wasFocused.current = true;
      returning.current = false;
      selected.getWorldPosition(focus);
      focus.y += FOCUS_HEIGHT;
      step.subVectors(focus, c.target).multiplyScalar(ease(3, dt));
      c.target.add(step);
      camera.position.add(step);
      if (zoomedFor.current !== st.selectedId) {
        selected.getWorldQuaternion(q);
        desired.set(Math.sin(FOCUS_SIDE), 0, Math.cos(FOCUS_SIDE)).applyQuaternion(q).setY(0).normalize();
        desired.multiplyScalar(FOCUS_DISTANCE).add(focus);
        desired.y = focus.y + FOCUS_LIFT;
        camera.position.lerp(desired, ease(2.5, dt));
        if (camera.position.distanceTo(desired) < 0.15) zoomedFor.current = st.selectedId;
      }
    } else if (returning.current || (wasFocused.current && st.cameraMode === "orbit")) {
      // Back to the overview after closing a character's details.
      zoomedFor.current = null;
      wasFocused.current = false;
      returning.current = true;
      camera.position.lerp(home.current.position, ease(2.5, dt));
      c.target.lerp(home.current.target, ease(2.5, dt));
      if (camera.position.distanceTo(home.current.position) < 0.02 && c.target.distanceTo(home.current.target) < 0.02) returning.current = false;
    } else if (st.cameraMode === "cinematic") {
      zoomedFor.current = null;
      wasFocused.current = false;
      const now = serverNow();
      // Switching to cinematic starts on the overview, with events that happened before left alone.
      if (!directing.current) director.current = { ...START, since: now, seenSeq: st.cueLog[0]?.seq ?? 0 };
      directing.current = true;
      director.current = direct(director.current, st.sessions, st.cueLog, now, (id) => characterRoots.get(id)?.visible === true);
      const shot = director.current.shot;
      const who = shot.kind === "person" ? characterRoots.get(shot.sessionId) : undefined;
      if (shot.kind === "person" && who?.visible) {
        // Somewhere between the person's front and the overview's side of the lot: always in the open, never behind a
        // wall; a walker is followed from the overview's side so the shot does not swing round with every turn.
        const f = FRAMING[shot.framing];
        who.getWorldPosition(focus);
        focus.y += FOCUS_HEIGHT;
        who.getWorldQuaternion(q);
        side.set(0, 0, 1).applyQuaternion(q).setY(0).normalize();
        desired.subVectors(home.current.position, focus).setY(0).normalize();
        side.lerp(desired, 1 - f.front).normalize();
        desired.copy(focus).addScaledVector(side, f.distance);
        desired.y = focus.y + f.lift;
        c.target.lerp(focus, ease(2.2, dt));
        camera.position.lerp(desired, ease(1.3, dt));
        c.update();
        return;
      }
      drift.current += dt;
      const t = drift.current;
      const az = -0.25 + Math.sin(t * 0.035) * 0.55;
      const radius = 13 + Math.sin(t * 0.027) * 1.8;
      desired.set(LOT_CENTER.x + Math.sin(az) * radius, 5.8 + Math.sin(t * 0.043) * 1.0, LOT_CENTER.z + Math.cos(az) * radius);
      camera.position.lerp(desired, ease(0.6, dt));
      c.target.lerp(LOT_CENTER, ease(0.6, dt));
    } else {
      zoomedFor.current = null;
    }
    c.update();
    if (camera.position.y < MIN_CAMERA_Y) camera.position.y = MIN_CAMERA_Y;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={target as [number, number, number]}
      enabled={!compact && mode === "orbit"}
      enableDamping
      // Half the default: a drag across the small canvas otherwise swings the view round faster than the hand moves.
      rotateSpeed={0.5}
      panSpeed={0.7}
      // Wheel and pinch zoom are ours (eased, towards the mouse); OrbitControls only orbits and pans.
      enableZoom={false}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_ZOOM_DISTANCE}
      minPolarAngle={0.35}
      // Down to just above eye level, so a close-up can look a seated person in the face.
      maxPolarAngle={1.5}
      maxAzimuthAngle={MAX_AZIMUTH}
      minAzimuthAngle={MIN_AZIMUTH}
    />
  );
}
