import { PerformanceMonitor, Stats } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { Ambient } from "./art/Ambient.tsx";
import { AssetBoundary, Ready } from "./art/assets.tsx";
import { Festive } from "./art/Festive.tsx";
import { Furniture } from "./art/Furniture.tsx";
import { StaticMerge } from "./art/StaticMerge.tsx";
import { Street } from "./art/Street.tsx";
import { Trees } from "./art/Trees.tsx";
import { Vehicles } from "./art/Vehicles.tsx";
import { Ground } from "./art/Ground.tsx";
import { Walls } from "./art/Walls.tsx";
import { Warung } from "./art/Warung.tsx";
import { DayNight } from "./env/DayNight.tsx";
import { Post } from "./env/Post.tsx";
import { Sky } from "./env/Sky.tsx";
import { Characters } from "./characters/Characters.tsx";
import { sound } from "../audio/sound.ts";
import { useApp } from "../state/store.ts";
import { CameraRig } from "./CameraRig.tsx";
import { envState } from "./env/envState.ts";
import { DebugHandle, SceneClock, cameraFromUrl } from "./SceneDebug.tsx";

const DEFAULT_CAMERA = { position: [-4.2, 7.6, 15.8], target: [0.2, 0.6, -0.6] } as const satisfies { position: [number, number, number]; target: [number, number, number] };
const SHOW_STATS = new URLSearchParams(location.search).has("stats");
const COMPACT_DPR = 1;
/** Resolution steps; few and far apart, since every change reallocates the composer's buffers (a visible hitch). */
const DPR_STEPS = [1, 1.25, 1.5] as const;
/** At most 60 frames a second, a few ms of vsync jitter allowed: every vsync at 60 Hz, every other one at 120 Hz. */
const MIN_FRAME_S = 1 / 60 - 0.004;
/** While another window has the focus (the lot watched on a second screen), 30 is plenty and halves the work. */
const BACKGROUND_MIN_FRAME_S = 1 / 30 - 0.004;
/** The resolution monitor judges 2.5 s of frames; it sits out this long after the frame cap changes. */
const PACE_SETTLE_MS = 3000;
const NEUTRAL_BOUNDS: [number, number] = [0, Infinity];
const pace = { background: false, settledAt: 0 };
/** How often to look for meshes whose shaders have not been compiled yet. */
const WARMUP_CHECK_MS = 2000;

/** The default view's distance to the middle of the lot: the ambience is mixed for this, louder when zoomed in. */
const LOT_MIDDLE = new THREE.Vector3(0.2, 0.6, -0.6);
const DEFAULT_LISTEN_DISTANCE = new THREE.Vector3(...DEFAULT_CAMERA.position).distanceTo(LOT_MIDDLE);

/** Feeds the ambience mix a few times a second. */
function SoundDirector() {
  const acc = useRef(0);
  const camera = useThree((s) => s.camera);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const d = envState.date;
    // Everyone working at a laptop (subagent friends included) is typing; a session waiting on the user is not.
    let typists = 0;
    for (const s of Object.values(useApp.getState().sessions)) if (s.phase === "working" && !s.need) typists += 1 + Object.keys(s.subagents).length;
    const closeness = DEFAULT_LISTEN_DISTANCE / Math.max(2, camera.position.distanceTo(LOT_MIDDLE));
    sound.ambience(envState.lighting, d.getHours() + d.getMinutes() / 60, typists, closeness);
  });
  return null;
}

/**
 * Drives the render loop (the canvas runs frameloop="never"): a steady 60 fps paces evenly on 120 Hz screens, where an
 * unsteady 70–120 fps judders.
 */
function FrameLimiter() {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      const background = !document.hasFocus();
      if (background !== pace.background) {
        pace.background = background;
        pace.settledAt = performance.now() + PACE_SETTLE_MS;
      }
      const t = ms / 1000;
      if (t - last < (background ? BACKGROUND_MIN_FRAME_S : MIN_FRAME_S)) return;
      last = t;
      advance(t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance]);
  return null;
}

/** Fill rate dominates (AO + bloom + MSAA): resolution steps down before the frame rate does, without a React render. */
function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const level = useRef<number>(DPR_STEPS.length - 1);
  const to = (i: number) => {
    if (i === level.current) return;
    level.current = i;
    setDpr(DPR_STEPS[i]!);
  };
  return (
    <PerformanceMonitor
      factor={1}
      flipflops={4}
      // A capped frame rate is not a slow GPU: no verdict while capped or just after.
      bounds={() => (pace.background || performance.now() < pace.settledAt ? NEUTRAL_BOUNDS : [45, 58])}
      onChange={({ factor }) => to(Math.round(factor * (DPR_STEPS.length - 1)))}
      onFallback={() => to(0)}
    />
  );
}

/**
 * Compiles the shaders of everything in the scene, hidden props included (phone, cup, lighter flame...), whenever
 * new meshes show up, so a prop's first appearance does not stall a frame on shader compilation.
 */
function ShaderWarmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // Programs depend on the target: the scene is drawn into the composer's linear buffers, never straight to the
    // canvas, so compiling against the canvas would build variants that are never used.
    const target = new THREE.WebGLRenderTarget(1, 1);
    let meshes = 0;
    const check = () => {
      if (document.hidden) return;
      let n = 0;
      scene.traverse((o) => void ((o as THREE.Mesh).isMesh && n++));
      if (n === meshes) return;
      meshes = n;
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.visible) return;
        hidden.push(o);
        o.visible = true;
      });
      // compile() runs synchronously inside compileAsync; only the linking finishes in the background.
      const previous = gl.getRenderTarget();
      gl.setRenderTarget(target);
      void gl.compileAsync(scene, camera).catch((e: unknown) => console.error("shader warm-up failed", e));
      gl.setRenderTarget(previous);
      for (const o of hidden) o.visible = false;
    };
    const id = window.setInterval(check, WARMUP_CHECK_MS);
    return () => {
      window.clearInterval(id);
      target.dispose();
    };
  }, [gl, scene, camera]);
  return null;
}

export function Scene() {
  const cam = cameraFromUrl() ?? DEFAULT_CAMERA;
  const compact = useApp((s) => s.compact);
  return (
    <Canvas
      className="scene"
      shadows
      flat
      frameloop="never"
      dpr={compact ? COMPACT_DPR : DPR_STEPS[DPR_STEPS.length - 1]}
      camera={{ position: cam.position, fov: 36, near: 0.1, far: 120 }}
      // The composer renders off-screen with its own MSAA and depth: the canvas needs neither.
      gl={{ antialias: false, depth: false, stencil: false, powerPreference: "high-performance" }}
      onPointerMissed={(e) => {
        if (e.type === "dblclick") useApp.getState().resetView();
      }}
    >
      <FrameLimiter />
      <AdaptiveResolution />
      <ShaderWarmup />
      <SceneClock />
      <DebugHandle />
      <DayNight />
      <Suspense fallback={null}>
        <Sky />
        <Ready part="sky" />
      </Suspense>
      <AssetBoundary name="ground">
        <Suspense fallback={null}>
          <StaticMerge>
            <Ground />
          </StaticMerge>
          <Ready part="ground" />
        </Suspense>
      </AssetBoundary>
      <AssetBoundary name="walls">
        <Suspense fallback={null}>
          <StaticMerge>
            <Walls />
          </StaticMerge>
          <Ready part="walls" />
        </Suspense>
      </AssetBoundary>
      <AssetBoundary name="warung">
        <Suspense fallback={null}>
          <StaticMerge>
            <Warung />
          </StaticMerge>
          <Ready part="warung" />
        </Suspense>
      </AssetBoundary>
      <AssetBoundary name="furniture">
        <Suspense fallback={null}>
          <StaticMerge>
            <Furniture />
          </StaticMerge>
          <Ready part="furniture" />
        </Suspense>
      </AssetBoundary>
      <AssetBoundary name="vehicles">
        <Suspense fallback={null}>
          <StaticMerge>
            <Vehicles />
          </StaticMerge>
          <Ready part="vehicles" />
        </Suspense>
      </AssetBoundary>
      <StaticMerge>
        <Street />
      </StaticMerge>
      <StaticMerge>
        <Festive />
      </StaticMerge>
      <Trees />
      <Ambient />
      <AssetBoundary name="characters">
        <Suspense fallback={null}>
          <Characters />
          <Ready part="characters" />
        </Suspense>
      </AssetBoundary>
      <Post compact={compact} />
      <CameraRig position={cam.position} target={cam.target} />
      <SoundDirector />
      {SHOW_STATS && <Stats />}
    </Canvas>
  );
}
