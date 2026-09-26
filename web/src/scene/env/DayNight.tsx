import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { envState, updateEnvState } from "./envState.ts";

const LOT_CENTER = new THREE.Vector3(0.5, 0, -0.5);
const KEY_DISTANCE = 30;
const SHADOW_EXTENT = 13;

/** Sun/moon key light with the only shadow map, plus fog; driven by the local clock (or ?time=). */
export function DayNight() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const light = useRef<THREE.DirectionalLight>(null!);
  const fog = useMemo(() => new THREE.FogExp2("#9fb0c0", 0.005), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    scene.fog = fog;
    light.current.target.position.copy(LOT_CENTER);
    scene.add(light.current.target);
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame(() => {
    const l = updateEnvState();
    const key = light.current;
    key.position.copy(LOT_CENTER).addScaledVector(envState.keyDir, KEY_DISTANCE);
    key.color.setRGB(...l.key.color);
    key.intensity = l.key.intensity;
    fog.color.copy(color.setRGB(...l.fogColor));
    fog.density = l.fogDensity;
    scene.environmentIntensity = l.skyIntensity;
    // Read by every ShaderMaterial, including the postprocessing AgX pass.
    gl.toneMappingExposure = l.exposure;
  });

  return (
    <directionalLight
      ref={light}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-SHADOW_EXTENT}
      shadow-camera-right={SHADOW_EXTENT}
      shadow-camera-top={SHADOW_EXTENT}
      shadow-camera-bottom={-SHADOW_EXTENT}
      shadow-camera-near={1}
      shadow-camera-far={70}
      shadow-bias={-0.0003}
      shadow-normalBias={0.02}
    />
  );
}
