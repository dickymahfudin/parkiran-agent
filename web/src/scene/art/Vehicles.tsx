import { useMemo } from "react";
import * as THREE from "three";
import { CARS, COVERED_CAR, PARKED_SCOOTERS } from "../layout.ts";
import { canvasTexture, useModel } from "./assets.tsx";
import { curve, loftGeometry, loftPoint, stations, type LoftSpec } from "./loft.ts";

type Pt = readonly [number, number];

interface CarModel {
  half: number;
  wheelZ: readonly [number, number];
  wheelR: number;
  /** Wheel centre distance from the car's centre line. */
  track: number;
  top: Pt[];
  base: Pt[];
  width: Pt[];
  cabin: { from: number; to: number; top: Pt[]; width: Pt[]; taper: number };
  roof: readonly [number, number];
  cPillar: readonly [number, number];
  bPillar: number;
  shutLines: number[];
  headlight: { z: number; y: number; x: number };
  taillight: { z: number; y: number; x: number };
  rearPlateY: number;
}

// Silhouettes of the two most common kinds of car in a kampung parking lot: a compact sedan and a city hatch.
const MODELS: Record<"sedan" | "hatch", CarModel> = {
  sedan: {
    half: 2.225,
    wheelZ: [1.36, -1.3],
    wheelR: 0.31,
    track: 0.75,
    top: [[-2.225, 0.5], [-2.17, 0.78], [-2.05, 0.95], [-1.85, 1.0], [-1.3, 1.01], [0.55, 0.99], [1.2, 0.88], [1.9, 0.79], [2.12, 0.72], [2.225, 0.5]],
    base: [[-2.225, 0.38], [-2.0, 0.29], [-1.75, 0.21], [1.8, 0.21], [2.02, 0.27], [2.225, 0.36]],
    width: [[-2.225, 0.64], [-2.15, 0.79], [-1.95, 0.855], [-1.2, 0.875], [1.2, 0.875], [1.9, 0.85], [2.12, 0.77], [2.225, 0.6]],
    cabin: {
      from: -1.42,
      to: 0.6,
      top: [[-1.42, 0.97], [-1.15, 1.2], [-0.8, 1.39], [-0.5, 1.45], [0.0, 1.46], [0.2, 1.42], [0.6, 0.96]],
      width: [[-1.42, 0.72], [-0.9, 0.78], [0.2, 0.79], [0.6, 0.74]],
      taper: 0.22,
    },
    roof: [-0.74, 0.24],
    cPillar: [-1.42, -0.98],
    bPillar: -0.3,
    shutLines: [0.52, -0.3, -1.06],
    headlight: { z: 2.06, y: 0.7, x: 0.6 },
    taillight: { z: -2.16, y: 0.86, x: 0.63 },
    rearPlateY: 0.62,
  },
  hatch: {
    half: 1.9,
    wheelZ: [1.18, -1.22],
    wheelR: 0.3,
    track: 0.71,
    top: [[-1.9, 0.6], [-1.86, 0.86], [-1.78, 0.97], [-1.6, 1.0], [0.42, 0.98], [0.95, 0.88], [1.55, 0.79], [1.78, 0.73], [1.9, 0.52]],
    base: [[-1.9, 0.4], [-1.72, 0.3], [-1.5, 0.21], [1.5, 0.21], [1.7, 0.27], [1.9, 0.36]],
    width: [[-1.9, 0.66], [-1.82, 0.78], [-1.6, 0.83], [1.2, 0.835], [1.62, 0.81], [1.8, 0.74], [1.9, 0.58]],
    cabin: {
      from: -1.84,
      to: 0.5,
      top: [[-1.84, 0.96], [-1.8, 1.25], [-1.7, 1.42], [-1.4, 1.48], [0.0, 1.5], [0.15, 1.46], [0.5, 0.96]],
      width: [[-1.84, 0.7], [-1.5, 0.76], [0.15, 0.77], [0.5, 0.72]],
      taper: 0.2,
    },
    roof: [-1.64, 0.18],
    cPillar: [-1.84, -1.34],
    bPillar: -0.38,
    shutLines: [0.42, -0.38, -1.2],
    headlight: { z: 1.74, y: 0.72, x: 0.58 },
    taillight: { z: -1.86, y: 0.9, x: 0.62 },
    rearPlateY: 0.6,
  },
};

const ARCH_GAP = 0.06;
const ROCKER_Y = 0.235;

function carSpecs(m: CarModel) {
  const top = curve(m.top);
  const baseLine = curve(m.base);
  const archR = m.wheelR + ARCH_GAP;
  const bottom = (z: number) => {
    let y = baseLine(z);
    for (const wz of m.wheelZ) {
      const dz = z - wz;
      if (Math.abs(dz) < archR) y = Math.max(y, m.wheelR + Math.sqrt(archR * archR - dz * dz));
    }
    return y;
  };
  const extra: number[] = [];
  for (const wz of m.wheelZ) {
    for (let k = -archR; k <= archR; k += 0.025) extra.push(wz + k);
    extra.push(wz - archR - 0.002, wz + archR + 0.002, wz - archR + 0.001, wz + archR - 0.001);
  }
  for (const s of m.shutLines) extra.push(s - 0.007, s - 0.0035, s, s + 0.0035, s + 0.007);
  const isShut = (z: number) => m.shutLines.some((s) => Math.abs(z - s) < 0.004);

  const body: LoftSpec = {
    zs: stations(-m.half, m.half, 0.05, extra),
    bottom,
    top,
    halfWidth: curve(m.width),
    taper: 0.1,
    exponent: 5,
    around: 36,
    caps: true,
    color: (z, y, t, out) => {
      const side = Math.abs(Math.cos(t)) > 0.5 && Math.sin(t) < 0.8;
      let v = 1;
      if (y < ROCKER_Y) v = 0.1;
      else if (side && isShut(z) && y > 0.32 && y < top(z) - 0.05 && z > m.cabin.from - 0.1) v = 0.18;
      out.setRGB(v, v, v);
    },
  };
  const cabinTop = curve(m.cabin.top);
  const cabin: LoftSpec = {
    zs: stations(m.cabin.from, m.cabin.to, 0.04),
    bottom: (z) => top(z) - 0.05,
    top: (z) => Math.max(top(z) - 0.04, cabinTop(z)),
    halfWidth: curve(m.cabin.width),
    taper: m.cabin.taper,
    exponent: 7,
    around: 36,
    caps: true,
  };
  const patch = (from: number, to: number, arc: readonly [number, number]): LoftSpec => ({ ...cabin, zs: stations(from, to, 0.04), arc, inflate: 0.006, caps: false, around: 14 });
  const q = Math.PI / 4;
  return {
    body,
    cabin,
    roof: patch(m.roof[0], m.roof[1], [q - 0.12, Math.PI - q + 0.12]),
    pillars: [
      patch(m.cPillar[0], m.cPillar[1], [-0.15, q + 0.1]),
      patch(m.cPillar[0], m.cPillar[1], [Math.PI - q - 0.1, Math.PI + 0.15]),
    ],
    bPillars: [
      patch(m.bPillar - 0.045, m.bPillar + 0.045, [-0.15, q + 0.05]),
      patch(m.bPillar - 0.045, m.bPillar + 0.045, [Math.PI - q - 0.05, Math.PI + 0.15]),
    ],
  };
}

function aPillarCurve(cabin: LoftSpec, from: number, to: number, side: 1 | -1): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const angle = side > 0 ? Math.PI / 4 : (Math.PI * 3) / 4;
  for (let i = 0; i <= 8; i++) pts.push(loftPoint(cabin, from + ((to - from) * i) / 8, angle, -0.004));
  return new THREE.CatmullRomCurve3(pts);
}

function plateTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(512, 112, (ctx) => {
    ctx.fillStyle = "#f2f2ee";
    ctx.fillRect(0, 0, 512, 112);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 100);
    ctx.fillStyle = "#111";
    ctx.font = '800 66px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 74);
    ctx.font = '700 18px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.fillText("08 • 29", 256, 100);
  });
}

function rimTexture(spokes: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#151617";
    ctx.fillRect(0, 0, 256, 256);
    ctx.translate(128, 128);
    ctx.fillStyle = "#b9bdc1";
    ctx.beginPath();
    ctx.arc(0, 0, 124, 0, Math.PI * 2);
    ctx.arc(0, 0, 108, 0, Math.PI * 2, true);
    ctx.fill();
    for (let i = 0; i < spokes; i++) {
      ctx.save();
      ctx.rotate((i / spokes) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(-9, 20);
      ctx.lineTo(-17, 112);
      ctx.lineTo(17, 112);
      ctx.lineTo(9, 20);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6d7176";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
  });
}

const tireProfile = (r: number, w: number) =>
  [[0.68, -0.48], [0.87, -0.5], [0.97, -0.44], [1, -0.3], [1, 0.3], [0.97, 0.44], [0.87, 0.5], [0.68, 0.48]].map(([a, b]) => new THREE.Vector2(a! * r, b! * w));

function useWheelParts(r: number, width: number, spokes: number) {
  return useMemo(() => {
    const tire = new THREE.LatheGeometry(tireProfile(r, width), 36);
    tire.rotateZ(Math.PI / 2);
    const face = new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.012, 32);
    face.rotateZ(Math.PI / 2);
    const barrel = new THREE.CylinderGeometry(r * 0.66, r * 0.66, width * 0.9, 24, 1, true);
    barrel.rotateZ(Math.PI / 2);
    const faceMat = new THREE.MeshStandardMaterial({ map: rimTexture(spokes), metalness: 0.75, roughness: 0.32 });
    return { tire, face, barrel, faceMat };
  }, [r, width, spokes]);
}

export const MAT = {
  tire: new THREE.MeshStandardMaterial({ color: "#121212", roughness: 0.92 }),
  trim: new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: "#0a0a0b", roughness: 0.9 }),
  glass: new THREE.MeshPhysicalMaterial({ color: "#0b1015", roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
  lens: new THREE.MeshPhysicalMaterial({ color: "#d8dee2", roughness: 0.08, metalness: 0.55, clearcoat: 1 }),
  tail: new THREE.MeshPhysicalMaterial({ color: "#7a0b0d", roughness: 0.12, clearcoat: 1, emissive: "#ff1a10", emissiveIntensity: 0.05 }),
  chrome: new THREE.MeshStandardMaterial({ color: "#dfe3e7", metalness: 1, roughness: 0.18 }),
  barrel: new THREE.MeshStandardMaterial({ color: "#3a3c3f", metalness: 0.6, roughness: 0.5 }),
};

export function paintMaterial(color: string, metallic: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, metalness: metallic, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, vertexColors: true });
}

interface CarProps {
  x: number;
  z: number;
  yaw: number;
  color: string;
  model: keyof typeof MODELS;
  plate: string;
  groupRef?: React.Ref<THREE.Group>;
  /** Per-car lamp materials when the lights can switch on (traffic). */
  lens?: THREE.Material;
  tail?: THREE.Material;
}

export function Car({ x, z, yaw, color, model, plate, groupRef, lens = MAT.lens, tail = MAT.tail }: CarProps) {
  const m = MODELS[model];
  const parts = useMemo(() => {
    const s = carSpecs(m);
    const paint = paintMaterial(color, color === "#b9bec4" ? 0.75 : 0.35);
    const solid = new THREE.MeshPhysicalMaterial({ color, metalness: paint.metalness, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.45 });
    return {
      body: loftGeometry(s.body),
      cabin: loftGeometry(s.cabin),
      roof: loftGeometry(s.roof),
      pillars: s.pillars.map(loftGeometry),
      bPillars: s.bPillars.map(loftGeometry),
      aPillars: ([1, -1] as const).map((side) => new THREE.TubeGeometry(aPillarCurve(s.cabin, m.roof[1] - 0.04, m.cabin.to - 0.02, side), 10, 0.034, 6)),
      paint,
      solid,
      plateMat,
    };
  }, [m, color, plate]);
  const wheel = useWheelParts(m.wheelR, 0.2, 5);
  const { headlight: hl, taillight: tl } = m;

  return (
    <group ref={groupRef} position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={parts.body} material={parts.paint} castShadow receiveShadow />
      <mesh geometry={parts.cabin} material={MAT.glass} castShadow />
      <mesh geometry={parts.roof} material={parts.solid} castShadow receiveShadow />
      {parts.pillars.map((g, i) => (
        <mesh key={i} geometry={g} material={parts.solid} castShadow />
      ))}
      {parts.bPillars.map((g, i) => (
        <mesh key={i} geometry={g} material={MAT.trim} />
      ))}
      {parts.aPillars.map((g, i) => (
        <mesh key={i} geometry={g} material={parts.solid} castShadow />
      ))}
      <mesh position={[0, 0.26, 0]} material={MAT.dark}>
        <boxGeometry args={[1.5, 0.12, m.half * 2 - 0.5]} />
      </mesh>
      {/* Grille, lamps, plates, mirrors, handles */}
      <mesh position={[0, 0.5, m.half - 0.035]} material={MAT.trim}>
        <boxGeometry args={[0.78, 0.13, 0.06]} />
      </mesh>
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[hl.x * side, hl.y, hl.z]} rotation={[0.35, side * 0.5, 0]} scale={[0.2, 0.055, 0.1]} material={lens}>
            <sphereGeometry args={[1, 18, 10]} />
          </mesh>
          <mesh position={[tl.x * side, tl.y, tl.z]} rotation={[-0.2, -side * 0.45, 0]} scale={[0.17, 0.06, 0.07]} material={tail}>
            <sphereGeometry args={[1, 16, 8]} />
          </mesh>
          <group position={[side * (m.cabin.width[m.cabin.width.length - 1]![1] + 0.12), m.top[5]![1] + 0.03, m.cabin.to - 0.12]}>
            <mesh scale={[0.1, 0.06, 0.05]} material={parts.solid} castShadow>
              <sphereGeometry args={[1, 12, 8]} />
            </mesh>
          </group>
          {[m.shutLines[0]! - 0.32, m.shutLines[1]! - 0.32].map((hz) => (
            <mesh key={hz} position={[side * (curve(m.width)(hz) + 0.004), 0.9, hz]} material={MAT.trim}>
              <boxGeometry args={[0.012, 0.025, 0.13]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.4, m.half + 0.004]} material={parts.plateMat}>
        <planeGeometry args={[0.46, 0.1]} />
      </mesh>
      <mesh position={[0, m.rearPlateY, -m.half - 0.004]} rotation={[0, Math.PI, 0]} material={parts.plateMat}>
        <planeGeometry args={[0.46, 0.1]} />
      </mesh>
      {m.wheelZ.flatMap((wz) =>
        ([1, -1] as const).map((side) => (
          <group key={`${wz}${side}`} position={[side * m.track, m.wheelR, wz]}>
            <mesh geometry={wheel.tire} material={MAT.tire} castShadow />
            <mesh geometry={wheel.barrel} material={MAT.barrel} />
            <mesh geometry={wheel.face} material={wheel.faceMat} position={[side * 0.075, 0, 0]} rotation={[0, side > 0 ? 0 : Math.PI, 0]} />
          </group>
        )),
      )}
    </group>
  );
}

/** Honda-Beat-style matic scooter, parked on its side stand. */
export function Scooter({ x, z, yaw, color, plate, lens = MAT.lens, tail = MAT.tail, parked = true }: { x: number; z: number; yaw: number; color: string; plate: string; lens?: THREE.Material; tail?: THREE.Material; parked?: boolean }) {
  const parts = useMemo(() => {
    const paint = paintMaterial(color, 0.35);
    const solid = new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
    const white = () => (_z: number, _y: number, _t: number, out: THREE.Color) => void out.setRGB(1, 1, 1);
    const rear = loftGeometry({
      zs: stations(-0.82, 0.08, 0.03),
      bottom: curve([[-0.82, 0.5], [-0.6, 0.36], [-0.3, 0.3], [0.08, 0.28]]),
      top: curve([[-0.82, 0.6], [-0.7, 0.66], [-0.3, 0.7], [0.0, 0.68], [0.08, 0.6]]),
      halfWidth: curve([[-0.82, 0.06], [-0.7, 0.12], [-0.3, 0.165], [0.08, 0.15]]),
      exponent: 3.2,
      caps: true,
      color: white(),
    });
    const floor = loftGeometry({
      zs: stations(-0.02, 0.44, 0.04),
      bottom: () => 0.25,
      top: () => 0.36,
      halfWidth: curve([[-0.02, 0.14], [0.2, 0.16], [0.44, 0.17]]),
      exponent: 6,
      caps: true,
      color: (_z, y, _t, out) => void out.setRGB(...((y > 0.35 ? [0.12, 0.12, 0.12] : [1, 1, 1]) as [number, number, number])),
    });
    const front = loftGeometry({
      zs: stations(0.36, 0.7, 0.025),
      bottom: curve([[0.36, 0.3], [0.5, 0.32], [0.7, 0.58]]),
      top: curve([[0.36, 0.6], [0.43, 0.9], [0.55, 0.99], [0.7, 0.9]]),
      halfWidth: curve([[0.36, 0.17], [0.5, 0.205], [0.7, 0.11]]),
      exponent: 3.5,
      caps: true,
      color: white(),
    });
    const seat = loftGeometry({
      zs: stations(-0.72, 0.02, 0.03),
      bottom: () => 0.66,
      top: curve([[-0.72, 0.71], [-0.62, 0.79], [-0.25, 0.8], [-0.05, 0.82], [0.02, 0.74]]),
      halfWidth: curve([[-0.72, 0.07], [-0.55, 0.13], [-0.1, 0.145], [0.02, 0.12]]),
      exponent: 3,
      caps: true,
    });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.45 });
    const seatMat = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.55 });
    return { paint, solid, rear, floor, front, seat, plateMat, seatMat };
  }, [color, plate]);
  const wheel = useWheelParts(0.235, 0.1, 5);

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* Parked: leans onto the side stand, which is on the left (+x) like on real Indonesian scooters. */}
      <group rotation={[0, 0, parked ? -0.12 : 0]} position={[parked ? -0.03 : 0, 0, 0]}>
        <mesh geometry={parts.rear} material={parts.paint} castShadow receiveShadow />
        <mesh geometry={parts.floor} material={parts.paint} castShadow receiveShadow />
        <mesh geometry={parts.front} material={parts.paint} castShadow receiveShadow />
        <mesh geometry={parts.seat} material={parts.seatMat} castShadow receiveShadow />
        {/* Handlebar with headlight cowl, grips and mirrors */}
        <mesh position={[0, 1.04, 0.6]} rotation={[0.25, 0, Math.PI / 2]} scale={[1, 1, 1.2]} material={parts.solid} castShadow>
          <capsuleGeometry args={[0.065, 0.32, 6, 12]} />
        </mesh>
        <mesh position={[0, 1.03, 0.71]} rotation={[0.3, 0, 0]} scale={[0.09, 0.045, 0.03]} material={lens}>
          <sphereGeometry args={[1, 14, 8]} />
        </mesh>
        {[1, -1].map((s) => (
          <group key={s}>
            <mesh position={[s * 0.33, 1.03, 0.56]} rotation={[0, 0, Math.PI / 2]} material={MAT.trim}>
              <cylinderGeometry args={[0.019, 0.019, 0.13, 10]} />
            </mesh>
            <mesh position={[s * 0.2, 1.17, 0.55]} rotation={[0, 0, -s * 0.35]} material={MAT.trim}>
              <cylinderGeometry args={[0.006, 0.006, 0.2, 6]} />
            </mesh>
            <mesh position={[s * 0.24, 1.27, 0.55]} scale={[0.055, 0.04, 0.012]} material={MAT.trim}>
              <sphereGeometry args={[1, 10, 6]} />
            </mesh>
            <mesh position={[s * 0.065, 0.45, 0.68]} rotation={[-0.32, 0, 0]} material={MAT.chrome}>
              <cylinderGeometry args={[0.022, 0.022, 0.5, 8]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.24, 0.66]} rotation={[0, Math.PI / 2, 0]} material={parts.solid} castShadow>
          <torusGeometry args={[0.27, 0.035, 6, 18, Math.PI * 0.7]} />
        </mesh>
        {/* Engine / CVT case, muffler, tail light, plate */}
        <mesh position={[-0.11, 0.27, -0.32]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.55]} material={MAT.barrel} castShadow>
          <capsuleGeometry args={[0.07, 0.45, 6, 10]} />
        </mesh>
        <mesh position={[0.15, 0.3, -0.52]} rotation={[Math.PI / 2 - 0.15, 0, 0]} material={MAT.trim} castShadow>
          <capsuleGeometry args={[0.055, 0.32, 6, 10]} />
        </mesh>
        <mesh position={[0, 0.62, -0.83]} scale={[0.09, 0.03, 0.03]} material={tail}>
          <sphereGeometry args={[1, 12, 8]} />
        </mesh>
        <mesh position={[0, 0.47, -0.86]} rotation={[0.15, Math.PI, 0]} scale={0.55} material={parts.plateMat}>
          <planeGeometry args={[0.46, 0.1]} />
        </mesh>
        {[0.66, -0.58].map((wz) => (
          <group key={wz} position={[0, 0.235, wz]}>
            <mesh geometry={wheel.tire} material={MAT.tire} castShadow />
            <mesh geometry={wheel.barrel} material={MAT.barrel} />
            {[1, -1].map((s) => (
              <mesh key={s} geometry={wheel.face} material={wheel.faceMat} position={[s * 0.04, 0, 0]} rotation={[0, s > 0 ? 0 : Math.PI, 0]} />
            ))}
          </group>
        ))}
      </group>
      {parked && (
        <mesh position={[0.12, 0.13, -0.1]} rotation={[0.2, 0, 0.5]} material={MAT.trim}>
          <cylinderGeometry args={[0.012, 0.012, 0.3, 6]} />
        </mesh>
      )}
    </group>
  );
}

// Between the hatchback and the covered car (off every walking path); ~0.8 m wide each including the parked lean.
const SCOOTERS = [
  { ...PARKED_SCOOTERS[0], color: "#1d3f86", plate: "B 3317 UQL" },
  { ...PARKED_SCOOTERS[1], color: "#e7e8e9", plate: "B 6650 FBR" },
] as const;

export function Vehicles() {
  const covered = useModel("covered_car");
  return (
    <group>
      {CARS.map((c) => (
        <Car key={c.x} {...c} />
      ))}
      <primitive object={covered} position={[COVERED_CAR.x, 0, COVERED_CAR.z]} rotation={[0, COVERED_CAR.yaw, 0]} />
      {SCOOTERS.map((s) => (
        <Scooter key={s.plate} {...s} />
      ))}
    </group>
  );
}
