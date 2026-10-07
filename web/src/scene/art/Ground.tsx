import { useMemo } from "react";
import * as THREE from "three";
import { rng } from "../characters/identity.ts";
import { CARS, LOT, STREET } from "../layout.ts";
import { canvasTexture, pbrMaterial, useModel, usePbr } from "./assets.tsx";

const LOT_W = LOT.maxX - LOT.minX;
const LOT_D = LOT.maxZ - LOT.minZ;
const STREET_LEN = 70;
/** Gang (alley) of paving blocks in front of the lot, with a selokan (gutter) between them. */
const ALLEY = { minX: -6.75, maxX: 16, minZ: 6.05, maxZ: 11.5 } as const;
const GUTTER_Z = LOT.maxZ + 0.22;

/** Worn road paint: white strip eaten away by noise (alpha-tested). */
function wornPaintTexture(seed: number, color: string): THREE.CanvasTexture {
  const r = rng(seed);
  return canvasTexture(64, 512, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 512);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 900; i++) {
      const x = r() * 64;
      const y = r() * 512;
      const rad = 1 + r() * (r() < 0.1 ? 10 : 3);
      ctx.globalAlpha = 0.4 + r() * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function stainTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return canvasTexture(256, 256, (ctx) => {
    // Drips and smears rather than one round blob, so it never reads as a floating shadow.
    for (let i = 0; i < 26; i++) {
      const x = 128 + (r() - 0.5) * 120;
      const y = 128 + (r() - 0.5) * 120;
      const rad = 8 + r() * 38;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI);
      ctx.scale(1, 0.35 + r() * 0.65);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, `rgba(12,10,8,${0.1 + r() * 0.16})`);
      g.addColorStop(1, "rgba(12,10,8,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    }
  });
}

/** Indonesian kerb paint: alternating black and white blocks. */
function kerbTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 32, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#e8e4da" : "#1c1c1c";
      ctx.fillRect(i * 32, 0, 32, 32);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function Lines() {
  const white = useMemo(() => wornPaintTexture(11, "#e9e5d6"), []);
  const yellow = useMemo(() => wornPaintTexture(17, "#e2b23a"), []);
  const mat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.35, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
  const whiteMat = useMemo(() => mat(white), [white]);
  const yellowMat = useMemo(() => mat(yellow), [yellow]);
  const stalls = [-5.5, -2.2, 1.0];
  return (
    <group>
      {stalls.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, 1.2]} material={whiteMat} receiveShadow>
          <planeGeometry args={[0.12, 4.8]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-2.2, 0.004, -1.25]} material={whiteMat} receiveShadow>
        <planeGeometry args={[0.12, 6.6]} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[(STREET.minX + STREET.maxX) / 2, 0.004, -30 + i * 5.5]} material={yellowMat} receiveShadow>
          <planeGeometry args={[0.13, 2.6]} />
        </mesh>
      ))}
    </group>
  );
}

function Stains() {
  const tex = useMemo(() => [stainTexture(3), stainTexture(9), stainTexture(21)], []);
  const mats = useMemo(
    () =>
      tex.map(
        (map) => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1 }),
      ),
    [tex],
  );
  const spots: [number, number, number, number][] = [
    [CARS[0].x, 1.6, 2.2, 0],
    [CARS[1].x + 0.2, 0.6, 1.8, 1],
    [-4.2, -2.6, 1.4, 2],
    [2.6, 2.2, 2.4, 1],
    [-0.4, 3.9, 1.2, 0],
    [STREET.minX + 2, -3, 2.0, 2],
  ];
  return (
    <group>
      {spots.map(([x, z, s, m], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, i * 1.3]} position={[x, 0.003, z]} material={mats[m]!} renderOrder={1}>
          <planeGeometry args={[s, s]} />
        </mesh>
      ))}
    </group>
  );
}

function Surroundings() {
  const base = usePbr("concrete_pavement", [64, 64]);
  const pavers = usePbr("concrete_pavers", [(ALLEY.maxX - ALLEY.minX) / 1.6, (ALLEY.maxZ - ALLEY.minZ) / 1.6]);
  const kerb = usePbr("brushed_concrete", [10, 0.2]);
  const baseMat = useMemo(() => pbrMaterial(base, { color: "#8f8a80" }), [base]);
  const paverMat = useMemo(() => pbrMaterial(pavers, { color: "#c4c0b8" }), [pavers]);
  const kerbMat = useMemo(() => pbrMaterial(kerb, { color: "#b3aea4" }), [kerb]);
  const water = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1b1a16", roughness: 0.12, metalness: 0.2 }), []);
  const gutterLen = ALLEY.maxX - ALLEY.minX;
  const gutterX = (ALLEY.minX + ALLEY.maxX) / 2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} material={baseMat} receiveShadow>
        <planeGeometry args={[160, 160]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ALLEY.minX + ALLEY.maxX) / 2, 0.004, (ALLEY.minZ + ALLEY.maxZ) / 2]} material={paverMat} receiveShadow>
        <planeGeometry args={[ALLEY.maxX - ALLEY.minX, ALLEY.maxZ - ALLEY.minZ]} />
      </mesh>
      {[GUTTER_Z - 0.2, GUTTER_Z + 0.2].map((z) => (
        <mesh key={z} position={[gutterX, 0.05, z]} material={kerbMat} castShadow receiveShadow>
          <boxGeometry args={[gutterLen, 0.1, 0.1]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gutterX, -0.02, GUTTER_Z]} material={water}>
        <planeGeometry args={[gutterLen, 0.3]} />
      </mesh>
      {/* Concrete slabs bridging the gutter */}
      {[-2.4, -1.85, 4.9, 5.45, 11.2].map((x) => (
        <mesh key={x} position={[x, 0.07, GUTTER_Z]} material={kerbMat} castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.06, 0.56]} />
        </mesh>
      ))}
    </group>
  );
}

export function Ground() {
  const asphalt = usePbr("asphalt_02", [LOT_W / 3.5, LOT_D / 3.5]);
  const road = usePbr("road_damaged", [(STREET.maxX - STREET.minX) / 4, STREET_LEN / 4]);
  const pavement = usePbr("concrete_pavement", [6 / 2.5, STREET_LEN / 2.5]);
  const kerbConcrete = usePbr("brushed_concrete", [8, 0.3]);
  const manhole = useModel("water_manhole_cover");
  const lotMat = useMemo(() => pbrMaterial(asphalt, { color: "#b9b4ab" }), [asphalt]);
  const roadMat = useMemo(() => pbrMaterial(road, { color: "#9a9893" }), [road]);
  const paveMat = useMemo(() => pbrMaterial(pavement), [pavement]);
  const kerbTopMat = useMemo(() => pbrMaterial(kerbConcrete, { color: "#bcb8ae" }), [kerbConcrete]);
  const kerbs = useMemo(
    () =>
      [
        { x: -6.62, z0: LOT.minZ, z1: 3.6 },
        { x: -6.62, z0: 5.4, z1: LOT.maxZ + 0.4 },
        { x: STREET.minX - 0.05, z0: -STREET_LEN / 2, z1: STREET_LEN / 2 },
      ].map((k) => {
        const tex = kerbTexture();
        // 8 blocks per texture, 0.5 m each.
        tex.repeat.set((k.z1 - k.z0) / 4, 1);
        const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
        return { ...k, materials: [side, side, kerbTopMat, kerbTopMat, kerbTopMat, kerbTopMat] };
      }),
    [kerbTopMat],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(LOT.minX + LOT.maxX) / 2, 0, (LOT.minZ + LOT.maxZ) / 2]} material={lotMat} receiveShadow>
        <planeGeometry args={[LOT_W, LOT_D]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(STREET.minX + STREET.maxX) / 2, -0.012, 0]} material={roadMat} receiveShadow>
        <planeGeometry args={[STREET.maxX - STREET.minX, STREET_LEN]} />
      </mesh>
      {/* Far pavement across the street */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[STREET.minX - 3, 0.13, 0]} material={paveMat} receiveShadow>
        <planeGeometry args={[6, STREET_LEN]} />
      </mesh>
      {/* Kerbs: lot side (with a driveway gap at the gate) and far side */}
      {kerbs.map(({ x, z0, z1, materials }) => (
        <mesh key={`${x}${z0}`} position={[x, 0.075, (z0 + z1) / 2]} material={materials} castShadow receiveShadow>
          <boxGeometry args={[0.22, 0.15, z1 - z0]} />
        </mesh>
      ))}
      <primitive object={manhole} position={[-8.6, -0.005, 1.8]} scale={1.1} />
      <Lines />
      <Stains />
      <Surroundings />
    </group>
  );
}
