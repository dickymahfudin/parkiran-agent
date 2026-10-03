import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";
import { useApp } from "../state/store.ts";
import { beginFrame, timeControl } from "./timeControl.ts";

declare global {
  interface Window {
    __parkiran?: {
      render(width?: number, height?: number): void;
      manual(on: boolean): void;
      step(seconds: number): void;
      /** Puts the camera at `position` looking at `target` (the orbit pivot), like `?cam=` without a reload. */
      view(position: [number, number, number], target: [number, number, number]): void;
      store: typeof useApp;
      scene: THREE.Scene;
      camera: THREE.Camera;
      gl: THREE.WebGLRenderer;
    };
  }
}

/** Publishes the frame time before any other frame callback runs. */
export function SceneClock() {
  useFrame((_, dt) => beginFrame(dt), -2);
  return null;
}

/** Dev aid: lets automated screenshots force frames and step time while the page is hidden (rAF paused). */
export function DebugHandle() {
  const advance = useThree((s) => s.advance);
  const setSize = useThree((s) => s.setSize);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const render = (width = window.innerWidth, height = window.innerHeight) => {
      // ResizeObserver does not fire while the page is hidden; a fixed size gives landscape shots in a narrow pane.
      setSize(width, height);
      // Seconds, like the frame limiter's timestamps (frameloop="never" takes the clock from them).
      advance(performance.now() / 1000);
    };
    window.__parkiran = {
      render,
      manual: (on) => void (timeControl.manual = on),
      step: (seconds) => {
        timeControl.pending += seconds;
        render();
      },
      view: (position, target) => {
        camera.position.set(...position);
        controls?.target.set(...target);
        controls?.update();
        render();
      },
      store: useApp,
      scene,
      camera,
      gl,
    };
    return () => void delete window.__parkiran;
  }, [advance, setSize, scene, camera, gl, controls]);
  return null;
}

/** Debug/screenshot aid: ?cam=px,py,pz,tx,ty,tz */
export function cameraFromUrl(): { position: [number, number, number]; target: [number, number, number] } | null {
  const raw = new URLSearchParams(location.search).get("cam")?.split(",").map(Number);
  if (raw?.length === 6 && raw.every(Number.isFinite)) {
    return { position: [raw[0]!, raw[1]!, raw[2]!], target: [raw[3]!, raw[4]!, raw[5]!] };
  }
  return null;
}
