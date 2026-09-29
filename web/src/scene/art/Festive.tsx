// Kampung decorations: warm festoon bulbs under the awning and over the benches, red-white bunting along the back wall.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { rng } from "../characters/identity.ts";
import { envState } from "../env/envState.ts";
import { AWNING_POLES, BACK_WALL_Z, WARUNG } from "../layout.ts";

type P3 = readonly [number, number, number];

interface Strand {
  from: P3;
  to: P3;
  /** Drop at the middle (m). */
  sag: number;
}

const WALL_FACE_Z = BACK_WALL_Z + 0.13;
const WALL_TOP = 2.6;
const BUNTING_Y = WALL_TOP + 0.38;

const LIGHT_STRANDS: Strand[] = [
  { from: [AWNING_POLES[0]![0] + 0.02, 2.06, AWNING_POLES[0]![1]], to: [AWNING_POLES[1]![0] + 0.02, 2.06, AWNING_POLES[1]![1]], sag: 0.14 },
  { from: [AWNING_POLES[1]![0], 2.08, AWNING_POLES[1]![1]], to: [-4.6, WALL_TOP + 0.05, WALL_FACE_Z], sag: 0.3 },
];
const BULB_SPACING = 0.42;

/** Bamboo posts on the wall top carrying the bunting line. */
const BUNTING_POSTS: P3[] = [
  [-6.15, BUNTING_Y, WALL_FACE_Z],
  [-1.45, BUNTING_Y, WALL_FACE_Z],
  [WARUNG.minX - 0.03, BUNTING_Y, WALL_FACE_Z],
];
const FLAG_SPACING = 0.3;
const FLAG_W = 0.2;
const FLAG_H = 0.26;
const FLAG_COLORS = ["#d7262e", "#f4f1ea"];

/** Point `t` (0…1) along a hanging line; a parabola is indistinguishable from a catenary at these sags. */
function along(s: Strand, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t - 4 * s.sag * t * (1 - t), s.from[2] + (s.to[2] - s.from[2]) * t);
  return out;
}

function strandLength(s: Strand): number {
  return Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]);
}

function cableGeometry(s: Strand, radius: number): THREE.TubeGeometry {
  const points = Array.from({ length: 25 }, (_, i) => along(s, i / 24));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, radius, 5, false);
}

const cableMat = new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.7 });

function FestoonLights() {
  const bulbs = useMemo(() => {
    const r = rng(17);
    const out: { p: THREE.Vector3; tint: number }[] = [];
    for (const s of LIGHT_STRANDS) {
      const n = Math.max(2, Math.round(strandLength(s) / BULB_SPACING));
      for (let i = 1; i < n; i++) out.push({ p: along(s, i / n).add(new THREE.Vector3(0, -0.055, 0)), tint: r() });
    }
    return out;
  }, []);
  const cables = useMemo(() => LIGHT_STRANDS.map((s) => cableGeometry(s, 0.006)), []);
  const bulbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#ffb65c", emissiveIntensity: 0, roughness: 0.3 }), []);
  const socketMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1e1f22", roughness: 0.6 }), []);
  const place = (mesh: THREE.InstancedMesh | null, dy: number, scale: THREE.Vector3, tinted: boolean) => {
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    bulbs.forEach((b, i) => {
      m.compose(b.p.clone().add(new THREE.Vector3(0, dy, 0)), new THREE.Quaternion(), scale);
      mesh.setMatrixAt(i, m);
      // Mostly warm white, the odd amber one: cheap strings never match.
      if (tinted) mesh.setColorAt(i, c.set(b.tint < 0.18 ? "#ffd08a" : "#ffffff"));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  useFrame((state) => {
    const lamps = envState.lighting.lamps;
    // A faint shimmer from the old wiring.
    bulbMat.emissiveIntensity = 0.12 + lamps * (4.2 + Math.sin(state.clock.elapsedTime * 23) * 0.15);
  });
  return (
    <group>
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cableMat} />
      ))}
      <instancedMesh ref={(m) => place(m, 0, new THREE.Vector3(1, 1.25, 1), true)} args={[undefined, bulbMat, bulbs.length]}>
        <sphereGeometry args={[0.032, 10, 8]} />
      </instancedMesh>
      <instancedMesh ref={(m) => place(m, 0.04, new THREE.Vector3(1, 1, 1), false)} args={[undefined, socketMat, bulbs.length]}>
        <cylinderGeometry args={[0.014, 0.016, 0.035, 8]} />
      </instancedMesh>
    </group>
  );
}

function flagGeometry(): THREE.BufferGeometry {
  // Hangs from its top edge at the origin, point down; bent slightly so it catches light like cloth.
  const g = new THREE.BufferGeometry();
  const w = FLAG_W / 2;
  g.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, -FLAG_H, 0.02, 0, 0, 0.015], 3));
  g.setIndex([0, 2, 3, 3, 2, 1]);
  g.computeVertexNormals();
  return g;
}

function Bunting() {
  const strands = useMemo<Strand[]>(() => BUNTING_POSTS.slice(1).map((to, i) => ({ from: BUNTING_POSTS[i]!, to, sag: 0.22 })), []);
  const flags = useMemo(() => {
    const out: { p: THREE.Vector3; yaw: number; phase: number }[] = [];
    let k = 0;
    for (const s of strands) {
      const n = Math.round(strandLength(s) / FLAG_SPACING);
      const yaw = -Math.atan2(s.to[2] - s.from[2], s.to[0] - s.from[0]);
      for (let i = 1; i < n; i++, k++) out.push({ p: along(s, i / n), yaw, phase: k * 0.7 });
    }
    return out;
  }, [strands]);
  const cables = useMemo(() => strands.map((s) => cableGeometry(s, 0.005)), [strands]);
  const geometry = useMemo(() => flagGeometry(), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide }), []);
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), one: new THREE.Vector3(1, 1, 1) }), []);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    mesh.current = m;
    const c = new THREE.Color();
    flags.forEach((_, i) => m.setColorAt(i, c.set(FLAG_COLORS[i % FLAG_COLORS.length]!)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const m = mesh.current;
    if (!m) return;
    flags.forEach((f, i) => {
      // Flutter about the line, in gusts.
      const gust = 0.5 + 0.5 * Math.sin(t * 0.35 + f.phase * 0.08);
      tmp.e.set(Math.sin(t * 2.6 + f.phase) * 0.28 * gust - 0.1, f.yaw, Math.sin(t * 1.7 + f.phase) * 0.05, "YXZ");
      tmp.q.setFromEuler(tmp.e);
      tmp.m.compose(f.p, tmp.q, tmp.one);
      m.setMatrixAt(i, tmp.m);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cableMat} />
      ))}
      {BUNTING_POSTS.map(([x, y, z]) => (
        <mesh key={x} position={[x, (y + WALL_TOP - 0.25) / 2, z - 0.02]} castShadow>
          <cylinderGeometry args={[0.022, 0.026, y - WALL_TOP + 0.3, 6]} />
          <meshStandardMaterial color="#b39a62" roughness={0.75} />
        </mesh>
      ))}
      <group userData={{ dynamic: true }}>
        <instancedMesh ref={setup} args={[geometry, material, flags.length]} castShadow />
      </group>
    </group>
  );
}

export function Festive() {
  return (
    <group>
      <FestoonLights />
      <Bunting />
    </group>
  );
}
