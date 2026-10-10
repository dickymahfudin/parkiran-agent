import { PerformanceMonitor, Stats } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { Ambient } from "./art/Ambient.tsx";
import { AssetBoundary, Ready } from "./art/assets.tsx";
import { Festive } from "./art/Festive.tsx";
import { FoodCart } from "./art/FoodCart.tsx";
import { Furniture } from "./art/Furniture.tsx";
import { StaticMerge } from "./art/StaticMerge.tsx";
import { Street } from "./art/Street.tsx";
import { Traces } from "./art/Traces.tsx";
import { Trees } from "./art/Trees.tsx";
import { Vehicles } from "./art/Vehicles.tsx";
import { Ground } from "./art/Ground.tsx";
import { Walls } from "./art/Walls.tsx";
import { Warung } from "./art/Warung.tsx";
import { DayNight } from "./env/DayNight.tsx";
import { Post } from "./env/Post.tsx";
import { Sky } from "./env/Sky.tsx";
import { Characters } from "./characters/Characters.tsx";
import { serverNow, useApp } from "../state/store.ts";
import { CameraRig } from "./CameraRig.tsx";
import { ACTIVE_FPS, isLite, isQuietLot, minFrameSeconds, targetFps } from "./pace.ts";
import { DebugHandle, SceneClock, cameraFromUrl } from "./SceneDebug.tsx";

// Framed on the benches, the gerobak and the warung (where the people are), clear of the session list at the top left.
const DEFAULT_CAMERA = { position: [-5.0, 6.2, 10.6], target: [0.0, 0.9, -3.0] } as const satisfies {
  position: [number, number, number];
  target: [number, number, number];
};
const SHOW_STATS = new URLSearchParams(location.search).has("stats");
const COMPACT_DPR = 1;
/** Resolution steps; few and far apart, since every change reallocates the composer's buffers (a visible hitch). */
const DPR_STEPS = [1, 1.25, 1.5] as const;
/** The resolution monitor judges 2.5 s of frames; it sits out this long after the frame cap changes. */
const PACE_SETTLE_MS = 3000;
const NEUTRAL_BOUNDS: [number, number] = [0, Infinity];
/** How often the quiet-lot check runs (it walks the sessions). */
const QUIET_CHECK_MS = 250;
/** Frame cap in force; below 60 the resolution monitor gives no verdict (a capped frame rate is not a slow GPU). */
const pace = { fps: ACTIVE_FPS, settledAt: 0 };
/** How often to look for meshes whose shaders have not been compiled yet. */
const WARMUP_CHECK_MS = 2000;

/**
 * Drives the render loop (the canvas runs frameloop="never"). 60 fps while the view moves (you drag, scroll, click or
 * type, or the camera follows someone), paced evenly on 120 Hz screens where an unsteady 70–120 fps judders; 30 while
 * you watch sessions work from a still camera; 20 when the lot is quiet; 15 with another window in front; a hidden tab
 * gets no frames at all. Unfocused for a few seconds, it also renders light.
 */
function FrameLimiter() {
  const advance = useThree((s) => s.advance);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    let quiet = false;
    let quietAt = -Infinity;
    let inputAt = performance.now();
    let unfocusedSince: number | null = null;
    const seen = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    const touched = () => {
      inputAt = performance.now();
    };
    const inputs = ["pointerdown", "pointermove", "wheel", "keydown"] as const;
    for (const ev of inputs) window.addEventListener(ev, touched, { passive: true });
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      const focused = document.hasFocus();
      unfocusedSince = focused ? null : (unfocusedSince ?? ms);
      if (camera.position.distanceToSquared(seen.pos) > 1e-8 || 1 - Math.abs(camera.quaternion.dot(seen.quat)) > 1e-9) {
        seen.pos.copy(camera.position);
        seen.quat.copy(camera.quaternion);
        inputAt = ms;
      }
      if (ms - quietAt > QUIET_CHECK_MS) {
        quietAt = ms;
        const st = useApp.getState();
        quiet = isQuietLot(Object.values(st.sessions), st.selectedId, serverNow());
      }
      const st = useApp.getState();
      const fps = targetFps({ focused, quiet, cinematic: st.cameraMode === "cinematic", stillForMs: ms - inputAt });
      if (fps !== pace.fps) {
        pace.fps = fps;
        pace.settledAt = performance.now() + PACE_SETTLE_MS;
      }
      const lite = isLite(focused, unfocusedSince === null ? 0 : ms - unfocusedSince);
      if (lite !== st.powerSave) st.setPowerSave(lite);
      const t = ms / 1000;
      if (t - last < minFrameSeconds(fps)) return;
      last = t;
      advance(t);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const ev of inputs) window.removeEventListener(ev, touched);
    };
  }, [advance, camera]);
  return null;
}

/** Fill rate dominates (AO + bloom + MSAA): resolution steps down before the frame rate does, without a React render. */
function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const compact = useApp((s) => s.compact);
  const powerSave = useApp((s) => s.powerSave);
  const level = useRef<number>(DPR_STEPS.length - 1);
  // Compact mode (a second monitor) and power saving (window in the background) cap the resolution whatever the
  // monitor's verdict is.
  const apply = (i: number) => setDpr(compact || powerSave ? Math.min(COMPACT_DPR, DPR_STEPS[i]!) : DPR_STEPS[i]!);
  useEffect(() => apply(level.current), [compact, powerSave]);
  const to = (i: number) => {
    if (i === level.current) return;
    level.current = i;
    apply(i);
  };
  return (
    <PerformanceMonitor
      factor={1}
      flipflops={4}
      // A capped frame rate is not a slow GPU: no verdict while capped or just after.
      bounds={() => (pace.fps < ACTIVE_FPS || performance.now() < pace.settledAt ? NEUTRAL_BOUNDS : [45, 58])}
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
  const powerSave = useApp((s) => s.powerSave);
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
      <AssetBoundary name="sky">
        <Suspense fallback={null}>
          <Sky />
          <Ready part="sky" />
        </Suspense>
      </AssetBoundary>
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
      <Traces />
      <AssetBoundary name="characters">
        <Suspense fallback={null}>
          <Characters />
          <FoodCart />
          <Ready part="characters" />
        </Suspense>
      </AssetBoundary>
      <Post compact={compact} lite={powerSave} />
      <CameraRig position={cam.position} target={cam.target} />
      {SHOW_STATS && <Stats />}
    </Canvas>
  );
}
