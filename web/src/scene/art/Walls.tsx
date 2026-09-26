import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { rng } from "../characters/identity.ts";
import { envState } from "../env/envState.ts";
import { BACK_WALL_Z, HOUSE_DEPTH, HOUSE_Z, LOT } from "../layout.ts";
import { canvasTexture, pbrMaterial, usePbr } from "./assets.tsx";

const WALL_H = 2.6;
const WALL_Z = BACK_WALL_Z;
const WALL_W = LOT.maxX - LOT.minX + 0.4;

interface PosterSpec {
  w: number;
  h: number;
  paper: string;
  lines: { text: string; color: string; size: number; weight?: number }[];
}

// Classic street-wall ads; phone numbers are deliberately masked.
const POSTERS: PosterSpec[] = [
  { w: 0.42, h: 0.6, paper: "#f2d64b", lines: [{ text: "SEDOT", color: "#c4161c", size: 74, weight: 900 }, { text: "WC", color: "#c4161c", size: 96, weight: 900 }, { text: "24 JAM", color: "#1d1d1b", size: 40 }, { text: "0812-XXXX-XXXX", color: "#1d1d1b", size: 26 }] },
  { w: 0.4, h: 0.58, paper: "#f4f1e8", lines: [{ text: "KEJAR PAKET C", color: "#1f4fa3", size: 46, weight: 900 }, { text: "ijazah setara SMA", color: "#1f4fa3", size: 34, weight: 700 }, { text: "biar tenang kalau", color: "#333", size: 27 }, { text: "ditanya pas naik jabatan", color: "#333", size: 27 }, { text: "hub. 0857-XXXX", color: "#333", size: 24 }] },
  { w: 0.36, h: 0.5, paper: "#e9f0f7", lines: [{ text: "TERIMA", color: "#0b6b3a", size: 46, weight: 800 }, { text: "KOS PUTRA", color: "#0b6b3a", size: 40, weight: 800 }, { text: "AC • WIFI", color: "#222", size: 32 }] },
  { w: 0.5, h: 0.36, paper: "#ffffff", lines: [{ text: "DIJUAL", color: "#d11", size: 60, weight: 900 }, { text: "TANPA PERANTARA", color: "#222", size: 28 }] },
];

function posterTexture(p: PosterSpec, seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  const W = 256;
  const H = Math.round((W * p.h) / p.w);
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    let y = H * 0.18;
    const step = (H * 0.72) / p.lines.length;
    for (const l of p.lines) {
      ctx.fillStyle = l.color;
      ctx.font = `${l.weight ?? 600} ${Math.round((l.size * W) / 300)}px "Plus Jakarta Sans Variable", system-ui, sans-serif`;
      ctx.fillText(l.text, W / 2, y + step * 0.5, W * 0.92);
      y += step;
    }
    // Sun-faded, water-stained, torn corners.
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(150,130,100,${r() * 0.08})`;
      ctx.beginPath();
      ctx.arc(r() * W, r() * H, 10 + r() * 50, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 3; i++) {
      const cx = r() < 0.5 ? 0 : W;
      const cy = r() < 0.5 ? 0 : H;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (cx ? -1 : 1) * (10 + r() * 40), cy);
      ctx.lineTo(cx, cy + (cy ? -1 : 1) * (10 + r() * 40));
      ctx.fill();
    }
  });
}

/** Thin batik-ish curtain behind the glass, half drawn; lit from inside at night. */
function curtainTexture(seed: number, warm: boolean): THREE.CanvasTexture {
  const r = rng(seed);
  const hue = warm ? ["#e8b878", "#d9a35f", "#f0cf98"] : ["#cfe0f0", "#b9cde6", "#e6eef7"];
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = "#3a3026";
    ctx.fillRect(0, 0, 64, 64);
    const open = 14 + r() * 26;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, hue[0]!);
    g.addColorStop(1, hue[1]!);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = hue[2]!;
    for (let x = 0; x < 64; x += 4) ctx.fillRect(x, 0, 2, 64);
    ctx.fillStyle = "rgba(60,40,25,0.55)";
    ctx.fillRect(0, 0, 32 - open / 2, 64);
    ctx.fillRect(32 + open / 2, 0, 32, 64);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(31, 0, 2, 64);
    ctx.fillRect(0, 31, 64, 2);
  });
}

const frameMat = new THREE.MeshStandardMaterial({ color: "#5b4632", roughness: 0.7 });

function grimeTexture(): THREE.CanvasTexture {
  const r = rng(77);
  return canvasTexture(512, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, "rgba(40,32,24,0.55)");
    g.addColorStop(0.35, "rgba(40,32,24,0.18)");
    g.addColorStop(1, "rgba(40,32,24,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 60; i++) {
      const x = r() * 512;
      const len = 20 + r() * 70;
      ctx.fillStyle = `rgba(40,32,24,${0.04 + r() * 0.08})`;
      ctx.fillRect(x, 128 - len, 2 + r() * 5, len);
    }
  });
}

/** The ridge's height above the eaves. */
const ROOF_RISE = 1.1;
/** How far the tiles run past the eaves, along the slope. */
const EAVE_OVERHANG = 0.15;

/** Gable end and attic fill: the house's cross-section from the wall tops up to just under the tiles. */
function atticGeometry(width: number, roofDepth: number): THREE.ExtrudeGeometry {
  const half = HOUSE_DEPTH / 2;
  const atFace = ROOF_RISE * (1 - half / (roofDepth / 2)) - 0.02;
  const profile = new THREE.Shape([
    new THREE.Vector2(-half, 0),
    new THREE.Vector2(half, 0),
    new THREE.Vector2(half, atFace),
    new THREE.Vector2(0, ROOF_RISE - 0.02),
    new THREE.Vector2(-half, atFace),
  ]);
  const g = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false });
  // Profile in (z, y), extruded along x across the house.
  g.rotateY(Math.PI / 2);
  g.translate(-width / 2, 0, 0);
  return g;
}

/** `shadows: false` for set dressing east of the lot, which would otherwise shade the whole lot all morning. */
export function House({ x, z = HOUSE_Z, yaw = 0, width, height, color, roofDepth, seed, shadows = true }: { x: number; z?: number; yaw?: number; width: number; height: number; color: string; roofDepth: number; seed: number; shadows?: boolean }) {
  const tiles = usePbr("clay_roof_tiles", [width / 1.5, roofDepth / 1.5]);
  const plaster = usePbr("painted_plaster_wall", [width / 3, height / 3]);
  const wallMat = useMemo(() => pbrMaterial(plaster, { color }), [plaster, color]);
  const roofMat = useMemo(() => pbrMaterial(tiles, { color: "#c97b55", side: THREE.DoubleSide }), [tiles]);
  const attic = useMemo(() => atticGeometry(width, roofDepth), [width, roofDepth]);
  const windows = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: Math.max(1, Math.floor(width / 2.4)) }, (_, i) => ({
      x: -width / 2 + (i + 0.5) * (width / Math.max(1, Math.floor(width / 2.4))),
      lit: r() < 0.6,
      warm: r() < 0.7,
    }));
  }, [seed, width]);
  const glass = useMemo(
    () =>
      windows.map((w, i) => {
        const curtain = curtainTexture(seed * 7 + i, w.warm);
        return new THREE.MeshStandardMaterial({ color: "#1b232b", roughness: 0.12, metalness: 0.2, emissive: "#ffffff", emissiveMap: curtain, emissiveIntensity: 0 });
      }),
    [windows, seed],
  );
  useFrame(() => {
    const n = envState.lighting.lamps;
    glass.forEach((m, i) => (m.emissiveIntensity = windows[i]!.lit ? n * 0.9 : 0));
  });
  // Gable roof: each slope runs from the ridge (z 0) down and out past the eaves.
  const slope = Math.atan2(ROOF_RISE, roofDepth / 2);
  const run = Math.hypot(roofDepth / 2, ROOF_RISE) + EAVE_OVERHANG;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, height / 2, 0]} material={wallMat} castShadow={shadows} receiveShadow>
        <boxGeometry args={[width, height, HOUSE_DEPTH]} />
      </mesh>
      <mesh position={[0, height, 0]} geometry={attic} material={wallMat} castShadow={shadows} receiveShadow />
      {windows.map((w, i) => (
        <group key={i} position={[w.x, height * 0.62, HOUSE_DEPTH / 2]}>
          <mesh position={[0, 0, 0.012]} material={glass[i]!}>
            <planeGeometry args={[1.0, 1.1]} />
          </mesh>
          <mesh material={frameMat}>
            <boxGeometry args={[1.12, 1.22, 0.05]} />
          </mesh>
          <mesh position={[0, -0.64, 0.06]} material={frameMat} castShadow>
            <boxGeometry args={[1.2, 0.05, 0.14]} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[0, height + ROOF_RISE - (Math.sin(slope) * run) / 2, (side * Math.cos(slope) * run) / 2]}
          // A plane faces +z; tipped back to lie flat, then tilted down towards its own eave.
          rotation={[side * slope - Math.PI / 2, 0, 0]}
          material={roofMat}
          castShadow={shadows}
          receiveShadow
        >
          <planeGeometry args={[width + 0.5, run]} />
        </mesh>
      ))}
      {/* Ridge tiles over the seam. */}
      <mesh position={[0, height + ROOF_RISE + 0.02, 0]} rotation={[0, 0, Math.PI / 2]} material={roofMat} castShadow={shadows}>
        <cylinderGeometry args={[0.08, 0.08, width + 0.5, 10, 1, false, 0, Math.PI]} />
      </mesh>
    </group>
  );
}

const TOWER = { height: 4.8, half: 0.45, tankRadius: 0.55, tankHeight: 1.15 } as const;

/** A blue toren on a steel stand in the gap between the lot wall and the houses, clear of both and of the eaves. */
function WaterTower({ x, z }: { x: number; z: number }) {
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5b5f63", metalness: 0.6, roughness: 0.5 }), []);
  const plastic = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2f74c0", roughness: 0.45 }), []);
  const pvc = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.6 }), []);
  const { height: H, half, tankRadius: R, tankHeight: TH } = TOWER;
  const tankY = H + 0.04 + TH / 2;
  const top = tankY + TH / 2;
  const pipeX = half + 0.07;
  const tankWallX = Math.sqrt(R * R - half * half);
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]] as const;
  return (
    <group position={[x, 0, z]}>
      {corners.map(([dx, dz]) => (
        <mesh key={`${dx}${dz}`} position={[dx, H / 2, dz]} material={steel} castShadow>
          <boxGeometry args={[0.07, H, 0.07]} />
        </mesh>
      ))}
      {/* Ring beams on every face at two levels, and the platform. */}
      {[1.6, 3.2].flatMap((y) =>
        [0, 1].map((axis) =>
          [-half, half].map((o) => (
            <mesh key={`${y}${axis}${o}`} position={axis ? [o, y, 0] : [0, y, o]} material={steel} castShadow>
              <boxGeometry args={axis ? [0.05, 0.05, half * 2] : [half * 2, 0.05, 0.05]} />
            </mesh>
          )),
        ),
      )}
      <mesh position={[0, H, 0]} material={steel} castShadow>
        <boxGeometry args={[half * 2 + 0.15, 0.08, half * 2 + 0.15]} />
      </mesh>
      <mesh position={[0, tankY, 0]} material={plastic} castShadow>
        <cylinderGeometry args={[R, R, TH, 32]} />
      </mesh>
      {/* Moulded ribs round the tank. */}
      {[-0.32, 0, 0.32].map((dy) => (
        <mesh key={dy} position={[0, tankY + dy, 0]} rotation={[Math.PI / 2, 0, 0]} material={plastic}>
          <torusGeometry args={[R, 0.018, 6, 32]} />
        </mesh>
      ))}
      {/* Domed top sitting on the rim, with the manhole lid. */}
      <mesh position={[0, top, 0]} scale={[1, 0.32, 1]} material={plastic} castShadow>
        <sphereGeometry args={[R, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, top + R * 0.32 - 0.01, 0]} material={plastic}>
        <cylinderGeometry args={[0.17, 0.18, 0.06, 20]} />
      </mesh>
      {/* Feed pipe down the leg facing the lot, into the tank's foot. */}
      <mesh position={[pipeX, (H + 0.25) / 2, half]} material={pvc}>
        <cylinderGeometry args={[0.025, 0.025, H + 0.25, 8]} />
      </mesh>
      <mesh position={[(pipeX + tankWallX) / 2, H + 0.25, half]} rotation={[0, 0, Math.PI / 2]} material={pvc}>
        <cylinderGeometry args={[0.025, 0.025, pipeX - tankWallX + 0.03, 8]} />
      </mesh>
    </group>
  );
}

export function Walls() {
  const plaster = usePbr("painted_plaster_wall", [WALL_W / 2.6, WALL_H / 2.6]);
  const cap = usePbr("brushed_concrete", [WALL_W / 2, 0.15]);
  const wallMat = useMemo(() => pbrMaterial(plaster, { color: "#e7dcc6" }), [plaster]);
  const capMat = useMemo(() => pbrMaterial(cap, { color: "#b7b2a7" }), [cap]);
  const sideWallMat = useMemo(() => pbrMaterial(plaster, { color: "#d9cdb5" }), [plaster]);
  const grime = useMemo(() => {
    const t = grimeTexture();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }, []);
  const posters = useMemo(
    () => POSTERS.map((p, i) => ({ p, mat: new THREE.MeshStandardMaterial({ map: posterTexture(p, 31 + i), roughness: 0.85, transparent: true, alphaTest: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }) })),
    [],
  );
  // x, y, tilt. Clear of the gerobak (x 0…1.5, roof at 1.96 m) and above the heads of people on the benches.
  const posterSpots: [number, number, number][] = [[-5.2, 1.55, -0.03], [-2.25, 1.7, 0.04], [-1.82, 1.62, -0.06], [-0.45, 1.97, 0.02]];

  return (
    <group>
      <mesh position={[(LOT.minX + LOT.maxX) / 2, WALL_H / 2, WALL_Z]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[WALL_W, WALL_H, 0.22]} />
      </mesh>
      <mesh position={[(LOT.minX + LOT.maxX) / 2, WALL_H + 0.05, WALL_Z]} material={capMat} castShadow receiveShadow>
        <boxGeometry args={[WALL_W + 0.05, 0.1, 0.3]} />
      </mesh>
      <mesh position={[(LOT.minX + LOT.maxX) / 2, 0.42, WALL_Z + 0.115]} material={grime}>
        <planeGeometry args={[WALL_W, 0.84]} />
      </mesh>
      {posters.map(({ p, mat }, i) => (
        <mesh key={i} position={[posterSpots[i]![0], posterSpots[i]![1], WALL_Z + 0.115]} rotation={[0, 0, posterSpots[i]![2]]} material={mat}>
          <planeGeometry args={[p.w, p.h]} />
        </mesh>
      ))}
      <mesh position={[LOT.maxX + 0.12, 0.65, 1.95]} material={sideWallMat} castShadow receiveShadow>
        <boxGeometry args={[0.2, 1.3, 7.3]} />
      </mesh>
      {/* Its west end stops short of the street (x −6.8), clear of the passing ojek. */}
      <House x={-3.9} width={5.4} height={4.2} color="#c9d8b6" roofDepth={5} seed={1} />
      <House x={2.3} width={6.5} height={5.4} color="#e8c6a6" roofDepth={5} seed={2} />
      <WaterTower x={-1.9} z={WALL_Z - 1.15} />
      <House x={10.9} z={1.4} yaw={-Math.PI / 2} width={7.6} height={3.4} color="#d8d2b0" roofDepth={5} seed={3} shadows={false} />
      <House x={10.9} z={-6.8} yaw={-Math.PI / 2} width={6} height={4.6} color="#b9c8d6" roofDepth={5} seed={4} shadows={false} />
    </group>
  );
}
