// Traces of time by each seat: a tin ashtray that fills with butts as the session ages, and an empty kopi glass for
// every compaction. Read the age of a session from the scene alone. Three instanced draws for the whole lot.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useApp } from "../../state/store.ts";
import { rng, hash32 } from "../characters/identity.ts";
import { MAX_BUTTS, MAX_CUPS, traceCounts, traceSpot } from "./traces.ts";

const MAX_SEATS = 16;
const REFRESH_MS = 2000;

const MAT = {
  tin: new THREE.MeshStandardMaterial({ color: "#8d9096", metalness: 0.7, roughness: 0.45 }),
  butt: new THREE.MeshStandardMaterial({ color: "#d9a35f", roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: "#d9e2e6", roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
};

export function Traces() {
  const trays = useRef<THREE.InstancedMesh>(null!);
  const butts = useRef<THREE.InstancedMesh>(null!);
  const cups = useRef<THREE.InstancedMesh>(null!);
  const last = useRef<{ at: number; sessions: unknown }>({ at: -Infinity, sessions: null });
  const m = useMemo(
    () => ({ mat: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) }),
    [],
  );

  useFrame(() => {
    const st = useApp.getState();
    const wall = performance.now();
    if (st.sessions === last.current.sessions && wall - last.current.at < REFRESH_MS) return;
    last.current = { at: wall, sessions: st.sessions };
    const now = serverNow();
    let tray = 0;
    let butt = 0;
    let cup = 0;
    for (const s of Object.values(st.sessions)) {
      const spot = s.seat ? traceSpot(s.seat) : null;
      if (!spot || tray >= MAX_SEATS) continue;
      const [x, y, z] = spot.at;
      const r = rng(hash32(s.id));
      m.mat.compose(m.p.set(x, y + 0.012, z), m.q.identity(), m.s.set(1, 1, 1));
      trays.current.setMatrixAt(tray++, m.mat);
      const { butts: nb, cups: nc } = traceCounts(s, now);
      for (let i = 0; i < nb; i++) {
        // Stubbed out in the tray, the odd one next to it.
        const out = i % 4 === 3;
        const a = r() * Math.PI * 2;
        const d = out ? 0.06 + r() * 0.05 : r() * 0.026;
        m.e.set(Math.PI / 2 + (r() - 0.5) * 0.5, 0, a);
        m.mat.compose(m.p.set(x + Math.cos(a) * d, y + (out ? 0.004 : 0.022), z + Math.sin(a) * d), m.q.setFromEuler(m.e), m.s.set(1, 1, 1));
        butts.current.setMatrixAt(butt++, m.mat);
      }
      for (let i = 0; i < nc; i++) {
        const k = 0.1 + i * 0.075;
        m.mat.compose(m.p.set(x + spot.along[0] * k, y + 0.035, z + spot.along[1] * k), m.q.identity(), m.s.set(1, 1, 1));
        cups.current.setMatrixAt(cup++, m.mat);
      }
    }
    for (const [mesh, n] of [
      [trays.current, tray],
      [butts.current, butt],
      [cups.current, cup],
    ] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });

  return (
    <group>
      <instancedMesh ref={trays} args={[undefined, MAT.tin, MAX_SEATS]} castShadow receiveShadow frustumCulled={false}>
        <cylinderGeometry args={[0.045, 0.038, 0.024, 16]} />
      </instancedMesh>
      <instancedMesh ref={butts} args={[undefined, MAT.butt, MAX_SEATS * MAX_BUTTS]} frustumCulled={false}>
        <cylinderGeometry args={[0.0042, 0.0042, 0.024, 6]} />
      </instancedMesh>
      <instancedMesh ref={cups} args={[undefined, MAT.glass, MAX_SEATS * MAX_CUPS]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.032, 0.026, 0.07, 14, 1, true]} />
      </instancedMesh>
    </group>
  );
}
