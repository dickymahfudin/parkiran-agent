import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BENCHES, LOT, SEAT_PLACES } from "../layout.ts";
import { canvasTexture, pbrMaterial, useModel, usePbr } from "./assets.tsx";

// The Poly Haven pew seats at 0.63 m; squashed to a kampung bench height (≈0.47 m) the sitting clips expect.
const BENCH_SCALE: [number, number, number] = [1.35, 0.75, 1];

function Bench({ x, z }: { x: number; z: number }) {
  const bench = useModel("painted_wooden_bench");
  const pack = useModel("cigarette_pack", { cast: false });
  return (
    <group position={[x, 0, z]}>
      <primitive object={bench} scale={BENCH_SCALE} />
      {x < -2 && <primitive object={pack} position={[0.68, 0.49, 0.05]} rotation={[-Math.PI / 2, 0, 0.4]} />}
    </group>
  );
}

/** Lathe profile points (radius, height). */
const lathe = (pts: [number, number][], segments: number, phiStart = 0, phiLength = Math.PI * 2) =>
  new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );

/**
 * The ubiquitous low plastic stool (kursi bakso): a round seat with a rolled edge on a short band, and four splayed
 * legs with arched gaps between them. Lathe normals are kept as built: averaging them across the seat edge made the
 * rim shine like a lit border.
 */
function stoolGeometry(): THREE.BufferGeometry {
  const seat = lathe(
    [
      [0, 0.45],
      [0.124, 0.45],
      [0.141, 0.4475],
      [0.151, 0.4415],
      [0.156, 0.432],
      [0.158, 0.372],
      [0.153, 0.368],
      [0.147, 0.371],
      [0.142, 0.43],
      [0, 0.43],
    ],
    40,
  );
  const leg: [number, number][] = [
    [0.158, 0.374],
    [0.181, 0.19],
    [0.2, 0.014],
    [0.203, 0],
    [0.19, 0],
    [0.17, 0.19],
    [0.146, 0.374],
  ];
  const legs = [0, 1, 2, 3].map((k) => lathe(leg, 8, (k * Math.PI) / 2 + Math.PI / 4 - 0.48, 0.96));
  const g = mergeGeometries([seat, ...legs], false);
  if (!g) throw new Error("stool geometry did not merge");
  return g;
}

/** The finger hole in the seat, as a dark oval just above it. */
function stoolHoleGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(0.022, 20);
  g.rotateX(-Math.PI / 2);
  g.scale(1.9, 1, 1);
  g.translate(0, 0.4505, 0);
  return g;
}

function Stools() {
  const geo = useMemo(stoolGeometry, []);
  const hole = useMemo(stoolHoleGeometry, []);
  const colors = ["#c0392b", "#2c5aa8", "#c0392b", "#2e8a52"];
  // Matte moulded plastic: no clearcoat, so edges never flare under the bloom.
  const mats = useMemo(() => colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, side: THREE.DoubleSide })), []);
  const holeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.9 }), []);
  const stools = Object.values(SEAT_PLACES).filter((s) => s.style === "stool");
  return (
    <group>
      {stools.map((s, i) => (
        <group key={s.id} position={[s.hip[0], 0, s.hip[2]]} rotation={[0, i * 0.7, 0]}>
          <mesh geometry={geo} material={mats[i % mats.length]!} castShadow receiveShadow />
          <mesh geometry={hole} material={holeMat} />
        </group>
      ))}
      {/* A spare stack by the warung wall */}
      {[0, 1, 2].map((i) => (
        <group key={i} position={[3.0, i * 0.075, -2.0]} rotation={[0, i * 0.3, 0]}>
          <mesh geometry={geo} material={mats[1]!} castShadow receiveShadow />
          {i === 2 && <mesh geometry={hole} material={holeMat} />}
        </group>
      ))}
    </group>
  );
}

function Gerobak() {
  const wood = usePbr("weathered_planks", [1.5, 1]);
  const woodMat = useMemo(() => pbrMaterial(wood, { color: "#c9a26a" }), [wood]);
  const label = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: canvasTexture(512, 128, (ctx) => {
          ctx.fillStyle = "#f4e6c4";
          ctx.fillRect(0, 0, 512, 128);
          ctx.fillStyle = "#a11f16";
          ctx.font = '900 76px "Plus Jakarta Sans Variable", system-ui, sans-serif';
          ctx.textAlign = "center";
          ctx.fillText("GORENGAN", 256, 92);
        }),
        roughness: 0.8,
      }),
    [],
  );
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#e8f2f4", transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5d6063", metalness: 0.7, roughness: 0.45 }), []);
  const tire = useMemo(() => new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.9 }), []);
  return (
    <group position={[0.75, 0, -5.05]}>
      <mesh position={[0, 0.72, 0]} material={woodMat} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.55, 0.62]} />
      </mesh>
      <mesh position={[0, 0.72, 0.315]} material={label}>
        <planeGeometry args={[1.1, 0.27]} />
      </mesh>
      <mesh position={[0, 1.22, 0]} material={glass}>
        <boxGeometry args={[1.36, 0.45, 0.58]} />
      </mesh>
      {[[-0.68, -0.29], [0.68, -0.29], [-0.68, 0.29], [0.68, 0.29]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x!, 1.45, z!]} material={metal} castShadow>
          <boxGeometry args={[0.025, 0.95, 0.025]} />
        </mesh>
      ))}
      <mesh position={[0, 1.94, 0]} material={metal} castShadow>
        <boxGeometry args={[1.5, 0.03, 0.75]} />
      </mesh>
      {/* Gorengan on trays */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-0.55 + (i % 7) * 0.18, 1.04, i < 7 ? -0.12 : 0.1]} rotation={[0, i, 0]} scale={[1, 0.55, 0.8]} castShadow>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color={i % 3 === 0 ? "#b8752e" : "#d39445"} roughness={0.7} />
        </mesh>
      ))}
      {[-0.52, 0.52].map((x) => (
        <group key={x} position={[x, 0.33, 0.36]}>
          <mesh rotation={[0, 0, 0]} material={tire} castShadow>
            <torusGeometry args={[0.3, 0.028, 8, 28]} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} rotation={[0, 0, (i * Math.PI) / 8]} material={metal}>
              <boxGeometry args={[0.6, 0.006, 0.006]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0.95, 0.85, 0]} rotation={[0, 0, Math.PI / 2]} material={metal} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.55, 8]} />
      </mesh>
    </group>
  );
}

function Props() {
  const plant = useModel("potted_plant_04");
  const plant2 = useModel("potted_plant_04");
  const plant3 = useModel("potted_plant_04");
  const planter = useModel("planter_box_01");
  const tyre = useModel("old_tyre");
  const tyre2 = useModel("old_tyre");
  const box = useModel("cardboard_box_01");
  const crate = useModel("wooden_crate_01");
  const utility = useModel("utility_box_01");
  const lpg = useModel("small_lpg_tank");
  return (
    <group>
      <primitive object={plant} position={[-5.95, 0, -5.25]} scale={3.2} rotation={[0, 0.6, 0]} />
      <primitive object={plant2} position={[2.15, 0, -5.35]} scale={2.6} />
      <primitive object={plant3} position={[7.05, 0, -0.6]} scale={3.0} rotation={[0, 2, 0]} />
      <primitive object={planter} position={[-2.25, 0, -5.3]} scale={0.9} />
      <primitive object={tyre} position={[6.95, 0.3, 4.6]} rotation={[0, 0, 1.45]} />
      <primitive object={tyre2} position={[6.85, 0.09, 3.9]} rotation={[Math.PI / 2, 0, 0.3]} />
      <primitive object={box} position={[5.2, 0, -1.25]} rotation={[0, 0.3, 0]} />
      <primitive object={crate} position={[-5.9, 0, -1.6]} rotation={[0, 1.4, 0]} />
      <primitive object={utility} position={[LOT.minX + 0.35, 0.6, -5.5]} />
      <primitive object={lpg} position={[3.35, 0, -1.95]} scale={0.75} rotation={[0, 2, 0]} />
    </group>
  );
}

export function Furniture() {
  return (
    <group>
      {BENCHES.map((b) => (
        <Bench key={b.x} x={b.x} z={b.z} />
      ))}
      <Stools />
      <Gerobak />
      <Props />
    </group>
  );
}
