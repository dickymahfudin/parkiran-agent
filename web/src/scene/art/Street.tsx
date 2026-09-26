import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { envState } from "../env/envState.ts";
import { timeControl } from "../timeControl.ts";
import { rng } from "../characters/identity.ts";
import { HOUSE_FRONT_Z, STREET_POLES } from "../layout.ts";
import { canvasTexture } from "./assets.tsx";

const POLE_H = 8.6;
const POLES = STREET_POLES;
/** Lamps hang off the poles: the back one reaches over the benches, the front one over the gate and the gang. */
const LAMPS = [
  { pole: 0, armY: 6.9, reach: 1.9, yaw: 0.35, intensity: 55, moths: true },
  { pole: 1, armY: 6.7, reach: 1.6, yaw: -0.25, intensity: 40, moths: false },
] as const;
const MOTHS = 14;

const concrete = new THREE.MeshStandardMaterial({ color: "#a7a39b", roughness: 0.92 });
const steel = new THREE.MeshStandardMaterial({ color: "#8d9296", metalness: 0.75, roughness: 0.45 });
const cable = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.7 });
const porcelain = new THREE.MeshStandardMaterial({ color: "#d9d6cf", roughness: 0.35 });

function sagCurve(a: THREE.Vector3, b: THREE.Vector3, sag: number, segments = 16): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function parkingSign(): THREE.CanvasTexture {
  return canvasTexture(256, 320, (ctx) => {
    ctx.fillStyle = "#f4f4f0";
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = "#1f4fa3";
    ctx.fillRect(12, 12, 232, 232);
    ctx.fillStyle = "#fff";
    ctx.font = '900 190px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("P", 128, 200);
    ctx.fillStyle = "#1d1d1d";
    ctx.font = '800 34px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.fillText("MOTOR • MOBIL", 128, 296);
  });
}

function Pole({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, POLE_H / 2, 0]} material={concrete} castShadow receiveShadow>
        <cylinderGeometry args={[0.085, 0.14, POLE_H, 12]} />
      </mesh>
      <mesh position={[0, POLE_H - 0.35, 0]} material={steel} castShadow>
        <boxGeometry args={[0.08, 0.08, 1.6]} />
      </mesh>
      {[-0.7, 0, 0.7].map((dz) => (
        <mesh key={dz} position={[0, POLE_H - 0.25, dz]} material={porcelain}>
          <cylinderGeometry args={[0.035, 0.05, 0.13, 8]} />
        </mesh>
      ))}
      {/* Slack coil of telecom cable that every kampung pole seems to carry */}
      <mesh position={[0.17, 5.3, 0]} rotation={[0, 0, 0.15]} material={cable} castShadow>
        <torusGeometry args={[0.24, 0.025, 6, 20]} />
      </mesh>
      <mesh position={[0.15, 5.0, 0]} material={steel}>
        <boxGeometry args={[0.16, 0.26, 0.12]} />
      </mesh>
    </group>
  );
}

function Wires() {
  const geos = useMemo(() => {
    const out: THREE.TubeGeometry[] = [];
    const top = (i: number, dz: number, dy = 0) => new THREE.Vector3(POLES[i]!.x, POLE_H - 0.18 + dy, POLES[i]!.z + dz);
    const order = [3, 0, 1, 2];
    for (let k = 0; k < order.length - 1; k++) {
      const a = order[k]!;
      const b = order[k + 1]!;
      for (const dz of [-0.7, 0, 0.7]) out.push(new THREE.TubeGeometry(sagCurve(top(a, dz), top(b, dz), 0.55), 24, 0.011, 4));
      for (const [y, sag] of [[5.3, 0.8], [5.15, 1.05], [5.0, 0.7]] as const) {
        const p = (i: number) => new THREE.Vector3(POLES[i]!.x + 0.12, y, POLES[i]!.z);
        out.push(new THREE.TubeGeometry(sagCurve(p(a), p(b), sag), 24, 0.013, 4));
      }
    }
    // Service drops from the back pole to the warung roof and the houses behind the wall.
    const back = new THREE.Vector3(POLES[0].x + 0.1, 5.6, POLES[0].z);
    for (const [to, sag] of [
      [new THREE.Vector3(3.5, 3.25, -5.55), 0.9],
      [new THREE.Vector3(3.6, 3.15, -5.5), 1.1],
      [new THREE.Vector3(-3.9, 3.9, HOUSE_FRONT_Z + 0.02), 0.45],
      [new THREE.Vector3(1.5, 4.9, HOUSE_FRONT_Z + 0.02), 0.6],
    ] as const) {
      out.push(new THREE.TubeGeometry(sagCurve(back, to, sag), 28, 0.012, 4));
    }
    return out;
  }, []);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={cable} castShadow />
      ))}
    </group>
  );
}

function Lamp({ lamp: LAMP }: { lamp: (typeof LAMPS)[number] }) {
  const pole = POLES[LAMP.pole];
  const spot = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => void (spot.current.target = target), [target]);
  const lens = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff4e0", emissive: "#ffd9a0", emissiveIntensity: 0 }), []);
  const arm = useMemo(() => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, LAMP.armY - 0.6, 0), new THREE.Vector3(0.1, LAMP.armY + 0.35, 0), new THREE.Vector3(LAMP.reach, LAMP.armY + 0.25, 0));
    return new THREE.TubeGeometry(c, 16, 0.035, 8);
  }, [LAMP.armY, LAMP.reach]);
  useFrame(() => {
    const n = envState.lighting.lamps;
    lens.emissiveIntensity = 0.2 + n * 7;
    spot.current.intensity = n * LAMP.intensity;
    spot.current.visible = n > 0.01;
  });
  return (
    <group position={[pole.x, 0, pole.z]} rotation={[0, LAMP.yaw, 0]}>
      <mesh geometry={arm} material={steel} castShadow />
      <group position={[LAMP.reach + 0.18, LAMP.armY + 0.22, 0]}>
        <mesh scale={[0.32, 0.075, 0.15]} material={steel} castShadow>
          <sphereGeometry args={[1, 18, 10]} />
        </mesh>
        <mesh position={[0.02, -0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.25, 0.1, 1]} material={lens}>
          <circleGeometry args={[1, 18]} />
        </mesh>
        <spotLight ref={spot} color="#ffd6a0" angle={1.05} penumbra={0.75} distance={22} decay={2} position={[0, -0.08, 0]} />
        <primitive object={target} position={[0.4, -LAMP.armY, 0.9]} />
      </group>
      {LAMP.moths && <Moths y={LAMP.armY + 0.05} x={LAMP.reach + 0.18} />}
    </group>
  );
}

/** A few moths circling the lamp head at night. */
function Moths({ x, y }: { x: number; y: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const seeds = useMemo(() => {
    const r = rng(77);
    return Array.from({ length: MOTHS }, () => ({ r: 0.25 + r() * 0.55, speed: 1.5 + r() * 2.5, phase: r() * 10, tilt: r() * 2 - 1, bob: r() * 3 }));
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const t = useRef(0);
  useFrame(() => {
    t.current += timeControl.frameDt;
    const n = envState.lighting.lamps;
    mesh.current.visible = n > 0.3;
    if (!mesh.current.visible) return;
    seeds.forEach((sd, i) => {
      const a = t.current * sd.speed + sd.phase;
      const jitter = Math.sin(t.current * 13 + sd.phase * 7) * 0.05;
      p.set(x + Math.cos(a) * sd.r + jitter, y - 0.2 + Math.sin(a * 0.7 + sd.bob) * 0.18 * sd.tilt, Math.sin(a) * sd.r);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a);
      s.setScalar(Math.abs(Math.sin(t.current * 40 + i)) * 0.5 + 0.6);
      m.compose(p, q, s);
      mesh.current.setMatrixAt(i, m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MOTHS]} frustumCulled={false}>
      <planeGeometry args={[0.025, 0.018]} />
      <meshStandardMaterial color="#e9e2d0" emissive="#ffe2b0" emissiveIntensity={1.5} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

export function Street() {
  const sign = useMemo(() => new THREE.MeshStandardMaterial({ map: parkingSign(), roughness: 0.5 }), []);
  return (
    <group>
      {POLES.map((p) => (
        <Pole key={p.z} {...p} />
      ))}
      <Wires />
      {LAMPS.map((l) => (
        <Lamp key={l.pole} lamp={l} />
      ))}
      {/* Parking sign on the front pole, facing the street */}
      <group position={[POLES[1].x - 0.16, 2.5, POLES[1].z]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh material={sign} castShadow>
          <planeGeometry args={[0.42, 0.52]} />
        </mesh>
        <mesh position={[0, 0, 0.012]} rotation={[0, Math.PI, 0]} material={steel}>
          <planeGeometry args={[0.42, 0.52]} />
        </mesh>
      </group>
    </group>
  );
}
