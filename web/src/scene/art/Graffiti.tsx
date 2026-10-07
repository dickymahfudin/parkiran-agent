// A spray-painted piece on the warung's side wall (painted by graffiti.ts) and the tin-shade lamp that lights it at night.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { envState } from "../env/envState.ts";
import { WARUNG } from "../layout.ts";
import { canvasTexture, useModel, type PbrSet } from "./assets.tsx";
import { CH, CW, PIECE_H, PIECE_W, PIECE_X, PIECE_Y, PLASTER_TILE_M, paintGraffiti, type Layer2D } from "./graffiti.ts";

/** An offscreen canvas the size of the piece, for the painter's layers. */
function canvasLayer(): Layer2D {
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { ctx, image: canvas };
}

function graffitiTexture(): THREE.CanvasTexture {
  return canvasTexture(CW, CH, (ctx) => paintGraffiti(ctx, canvasLayer));
}

/** A tin-shade bulb on a bracket above the piece, so it reads at night too. */
function WallLamp({ x, y, z }: { x: number; y: number; z: number }) {
  const light = useRef<THREE.SpotLight>(null!);
  const bulb = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#ffc98a", emissiveIntensity: 0 }), []);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.4, z - 0.25);
    return o;
  }, [x, z]);
  useFrame(() => {
    const lamps = envState.lighting.lamps;
    bulb.emissiveIntensity = 0.2 + lamps * 7;
    const on = lamps > 0.02;
    light.current.visible = on;
    light.current.intensity = lamps * 14;
  });
  return (
    <group>
      <primitive object={target} />
      <mesh position={[x, y + 0.1, z + 0.17]} castShadow>
        <boxGeometry args={[0.03, 0.03, 0.36]} />
        <meshStandardMaterial color="#3b3d40" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[x, y, z + 0.34]} castShadow>
        <coneGeometry args={[0.15, 0.12, 20, 1, true]} />
        <meshStandardMaterial color="#5d6a66" metalness={0.55} roughness={0.45} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[x, y - 0.06, z + 0.34]} material={bulb}>
        <sphereGeometry args={[0.04, 12, 10]} />
      </mesh>
      <spotLight
        ref={light}
        position={[x, y - 0.08, z + 0.36]}
        target={target}
        angle={1.05}
        penumbra={0.9}
        distance={5}
        decay={2}
        color="#ffc27a"
        intensity={0}
        visible={false}
      />
    </group>
  );
}

export function Graffiti({ plaster }: { plaster: PbrSet }) {
  const material = useMemo(() => {
    const normalMap = plaster.normalMap.clone();
    normalMap.repeat.set(PIECE_W / PLASTER_TILE_M, PIECE_H / PLASTER_TILE_M);
    normalMap.offset.set((PIECE_X - PIECE_W / 2 - WARUNG.minX) / PLASTER_TILE_M, (PIECE_Y - PIECE_H / 2) / PLASTER_TILE_M);
    normalMap.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map: graffitiTexture(),
      normalMap,
      roughness: 0.72,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }, [plaster.normalMap]);
  // The writer left their cans behind.
  const cans = useModel("spray_paint_bottles_02");
  const cans2 = useModel("spray_paint_bottles_02");
  const broom = useModel("plastic_broom");
  const wall = WARUNG.maxZ;
  return (
    <group>
      <primitive object={cans} position={[4.25, 0, wall + 0.16]} rotation={[0, 0.5, 0]} scale={1.1} />
      <primitive object={cans2} position={[6.35, 0, wall + 0.2]} rotation={[0, -0.9, 0]} scale={1.1} />
      {/* Leans into the wall (the model tilts towards −Z), clear of the cup. */}
      <primitive object={broom} position={[3.72, 0, wall + 0.29]} />
      <mesh position={[PIECE_X, PIECE_Y, wall + 0.004]} material={material} receiveShadow>
        <planeGeometry args={[PIECE_W, PIECE_H]} />
      </mesh>
      <WallLamp x={PIECE_X} y={2.62} z={wall} />
    </group>
  );
}
