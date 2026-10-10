// Life around the lot that does not depend on sessions: passing cars, a sleeping cat, falling leaves.
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { lookFor, rng } from "../characters/identity.ts";
import { disposeSkinned } from "../characters/dispose.ts";
import { attach, buildRig, useCharacterAsset } from "../characters/characterAsset.ts";
import { envState } from "../env/envState.ts";
import { CAR_LENGTH } from "../layout.ts";
import { useApp } from "../../state/store.ts";
import { timeControl } from "../timeControl.ts";
import { AssetBoundary, canvasTexture } from "./assets.tsx";
import { StaticMerge } from "./StaticMerge.tsx";
import { idleVehicle, LANES, laneX, stepTraffic, tickSpawner, type Spawner, type Vehicle } from "./traffic.ts";
import { Car, MAT, Scooter } from "./Vehicles.tsx";

const SCOOTER_LENGTH = 1.95;
const TRAFFIC = [
  { color: "#20262e", model: "sedan", plate: "B 1934 PKR" },
  { color: "#e9e9e6", model: "hatch", plate: "B 7710 SJA" },
  { color: "#4f5b66", model: "sedan", plate: "F 2208 GH" },
] as const;

function poolTexture(): THREE.CanvasTexture {
  // Elliptical pool, brightest near the lamp, fading to nothing before the texture edge.
  return canvasTexture(128, 256, (ctx) => {
    ctx.setTransform(1, 0, 0, 2, 0, 0);
    const g = ctx.createRadialGradient(64, 22, 2, 64, 62, 60);
    g.addColorStop(0, "rgba(255,236,200,0.85)");
    g.addColorStop(0.45, "rgba(255,226,180,0.3)");
    g.addColorStop(1, "rgba(255,226,180,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** A few cars cruising past on the street at kampung speed, headlights on after dusk. */
function Traffic({ cars }: { cars: readonly Vehicle[] }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const pools = useRef<(THREE.Mesh | null)[]>([]);
  const lamps = useMemo(
    () =>
      TRAFFIC.map(() => ({
        lens: new THREE.MeshPhysicalMaterial({ color: "#d8dee2", roughness: 0.08, metalness: 0.4, clearcoat: 1, emissive: "#fff1d6", emissiveIntensity: 0 }),
        tail: (MAT.tail as THREE.MeshPhysicalMaterial).clone(),
      })),
    [],
  );
  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    [],
  );

  useFrame(() => {
    const night = envState.lighting.lamps;
    cars.forEach((m, i) => {
      const g = refs.current[i];
      const pool = pools.current[i];
      if (!g || !pool) return;
      g.visible = m.active;
      pool.visible = m.active && night > 0.05;
      if (!m.active) return;
      const lane = LANES[m.lane];
      g.position.set(lane.x, 0, m.z);
      g.rotation.y = lane.dir > 0 ? 0 : Math.PI;
      pool.position.set(lane.x, 0.02, m.z + lane.dir * 4.2);
      pool.rotation.set(-Math.PI / 2, 0, lane.dir > 0 ? Math.PI : 0);
      lamps[i]!.lens.emissiveIntensity = night * 6;
      lamps[i]!.tail.emissiveIntensity = 0.05 + night * 2.5;
      poolMat.opacity = night * 0.55;
    });
  });

  return (
    <group>
      {TRAFFIC.map((t, i) => (
        <group key={t.plate}>
          {/* The outer group drives; inside, the car's ~25 parts collapse into one draw per material. */}
          <group ref={(g) => void (refs.current[i] = g)} visible={false}>
            <StaticMerge>
              <Car x={0} z={0} yaw={0} {...t} lens={lamps[i]!.lens} tail={lamps[i]!.tail} />
            </StaticMerge>
          </group>
          <mesh ref={(m) => void (pools.current[i] = m)} material={poolMat} visible={false}>
            <planeGeometry args={[3.2, 6.5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const RIDERS = [
  { color: "#b8322b", plate: "B 4471 KZA", rider: "ojol-1", helmet: "#1f8a3a" },
  { color: "#1f1f22", plate: "B 6012 PQR", rider: "ojol-2", helmet: "#e9e9e6" },
] as const;
/** Rider hip joint (scooter space): far enough back that knees and toes clear the leg shield, feet on the floorboard (top 0.36). */
const SADDLE = new THREE.Vector3(0, 0.905, -0.09);

/** A kampung neighbour riding past: the shared character in the keyframed ride pose (hands on the grips). */
export function Rider({ id, helmet }: { id: string; helmet: string }) {
  const asset = useCharacterAsset();
  const look = useMemo(() => ({ ...lookFor(id), cap: null }), [id]);
  const rig = useMemo(() => {
    const r = buildRig(asset, look);
    // Helm bogo: an open half-shell with a short peak, sitting on the skull (centre 4 cm ahead of the head bone).
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: helmet, roughness: 0.25, clearcoat: 1 }),
    );
    shell.scale.set(1.02, 0.95, 1.1);
    shell.castShadow = true;
    const peak = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.006, 18, 1, false, -Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: "#1b1d20", roughness: 0.4 }),
    );
    peak.position.set(0, 0.004, 0.122 * 1.1 - 0.014);
    peak.rotation.x = 0.3;
    peak.scale.z = 0.8;
    const h = new THREE.Group();
    h.add(shell, peak);
    attach(r, "Head", h, new THREE.Vector3(0, 1.578, 0.04), new THREE.Vector3(0, 0, 1));
    return r;
  }, [asset, look, helmet]);
  const mixer = useMemo(() => new THREE.AnimationMixer(rig.object), [rig]);
  useEffect(() => () => disposeSkinned(rig.object), [rig]);
  const offset = useMemo(() => {
    const ride = asset.clips.get("ride");
    if (!ride) throw new Error("ride clip missing");
    mixer.clipAction(ride).play();
    mixer.update(0);
    rig.object.updateMatrixWorld(true);
    const hips = rig.bones.get("mixamorigHips");
    if (!hips) throw new Error("hips bone missing");
    return SADDLE.clone().sub(hips.getWorldPosition(new THREE.Vector3()));
  }, [asset, mixer, rig]);
  useFrame(() => {
    const ride = asset.clips.get("ride");
    if (ride) {
      const a = mixer.clipAction(ride);
      if (!a.isScheduled()) a.play();
    }
    mixer.update(Math.min(timeControl.frameDt, 0.1));
  });
  return <primitive object={rig.object} position={offset} />;
}

/** Motor bebek and matic scooters zipping past, kept to the kerb side of the lane. */
function ScooterTraffic({ scooters }: { scooters: readonly Vehicle[] }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const pools = useRef<(THREE.Mesh | null)[]>([]);
  const lamps = useMemo(
    () =>
      RIDERS.map(() => ({
        lens: new THREE.MeshPhysicalMaterial({ color: "#d8dee2", roughness: 0.08, metalness: 0.4, clearcoat: 1, emissive: "#fff1d6", emissiveIntensity: 0 }),
        tail: (MAT.tail as THREE.MeshPhysicalMaterial).clone(),
      })),
    [],
  );
  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    [],
  );

  useFrame(() => {
    const night = envState.lighting.lamps;
    poolMat.opacity = night * 0.4;
    scooters.forEach((m, i) => {
      const g = refs.current[i];
      const pool = pools.current[i];
      if (!g || !pool) return;
      g.visible = m.active;
      pool.visible = m.active && night > 0.05;
      if (!m.active) return;
      const lane = LANES[m.lane];
      const x = laneX(m.lane, "scooter");
      g.position.set(x, 0, m.z);
      g.rotation.y = lane.dir > 0 ? 0 : Math.PI;
      pool.position.set(x, 0.02, m.z + lane.dir * 3);
      pool.rotation.set(-Math.PI / 2, 0, lane.dir > 0 ? Math.PI : 0);
      lamps[i]!.lens.emissiveIntensity = night * 8;
      lamps[i]!.tail.emissiveIntensity = 0.05 + night * 2.5;
    });
  });

  return (
    <group>
      {RIDERS.map((r, i) => (
        <group key={r.plate}>
          <group ref={(g) => void (refs.current[i] = g)} visible={false}>
            <StaticMerge>
              <Scooter x={0} z={0} yaw={0} color={r.color} plate={r.plate} lens={lamps[i]!.lens} tail={lamps[i]!.tail} parked={false} />
            </StaticMerge>
            <Rider id={r.rider} helmet={r.helmet} />
          </group>
          <mesh ref={(m) => void (pools.current[i] = m)} material={poolMat} visible={false}>
            <planeGeometry args={[1.8, 4.5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function tabbyTexture(): THREE.CanvasTexture {
  const r = rng(808);
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = "#d58a3c";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#a85d22";
    for (let i = 0; i < 9; i++) {
      const x = i * 14 + r() * 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + 6, 32, x - 2, 64);
      ctx.lineTo(x + 5, 64);
      ctx.quadraticCurveTo(x + 12, 32, x + 6, 0);
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, 40, 0, 64);
    g.addColorStop(0, "rgba(245,225,195,0)");
    g.addColorStop(1, "rgba(245,225,195,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
  });
}

type V3 = readonly [number, number, number];

/** Nap spots; the box needs a hop. The sedan spot is under its belly, between the wheels. */
const CAT_SPOTS: { p: V3; yaw: number; via?: V3 }[] = [
  { p: [5.2, 0.345, -1.25], yaw: 0.9, via: [4.92, 0, -0.72] },
  { p: [2.95, 0, -0.5], yaw: 2.6 },
  { p: [1.35, 0, -4.3], yaw: -0.4 },
  { p: [-3.3, 0, 0.75], yaw: 1.2, via: [-2.3, 0, -1.15] },
];
const CAT_HUB: V3 = [0.9, 0, -1.4];
const CAT_SPEED = 0.55;
const HOP_S = 0.4;
const STRIDE_HZ = CAT_SPEED / 0.22;

/**
 * Kucing oren: naps (curled, breathing, an ear twitch), then gets up and wanders to another spot on the lot:
 * the cardboard box by the warung, the counter, the gerobak, or under the red sedan.
 */
function Cat() {
  const root = useRef<THREE.Group>(null!);
  const curled = useRef<THREE.Group>(null!);
  const standing = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Mesh>(null!);
  const head = useRef<THREE.Group>(null!);
  const ear = useRef<THREE.Mesh>(null!);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const walkTail = useRef<THREE.Group>(null!);
  const random = useMemo(() => rng(31337), []);
  const state = useRef({
    t: 0,
    spot: 0,
    sleepLeft: 20 + random() * 30,
    path: [] as THREE.Vector3[],
    seg: 0,
    hop: 0,
    yaw: CAT_SPOTS[0]!.yaw,
    pos: new THREE.Vector3(...CAT_SPOTS[0]!.p),
  });
  const fur = useMemo(() => new THREE.MeshStandardMaterial({ map: tabbyTexture(), roughness: 0.95 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a85d22", roughness: 0.95 }), []);
  const muzzle = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f1e2cc", roughness: 0.95 }), []);
  const curledTail = useMemo(() => {
    const pts = Array.from({ length: 9 }, (_, i) => {
      const a = -0.4 + (i / 8) * 2.4;
      return new THREE.Vector3(Math.cos(a) * 0.22, 0.03 + i * 0.002, Math.sin(a) * 0.15);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.022, 6);
  }, []);
  const upTail = useMemo(() => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.08, 0.06, 0), new THREE.Vector3(-0.12, 0.18, 0), new THREE.Vector3(-0.08, 0.28, 0)];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.018, 6);
  }, []);

  useFrame(() => {
    const st = state.current;
    const dt = Math.min(timeControl.frameDt, 0.5);
    st.t += dt;
    const walking = st.path.length > 0;
    if (!walking) {
      st.sleepLeft -= dt;
      if (st.sleepLeft <= 0) {
        let next = st.spot;
        while (next === st.spot) next = Math.floor(random() * CAT_SPOTS.length);
        const from = CAT_SPOTS[st.spot]!;
        const to = CAT_SPOTS[next]!;
        const pts: V3[] = [from.p];
        if (from.via) pts.push(from.via);
        pts.push(CAT_HUB);
        if (to.via) pts.push(to.via);
        pts.push(to.p);
        st.path = pts.map((q) => new THREE.Vector3(...q));
        st.seg = 0;
        st.hop = 0;
        st.spot = next;
      }
    } else {
      const a = st.path[st.seg]!;
      const b = st.path[st.seg + 1]!;
      const isHop = Math.abs(a.y - b.y) > 0.05;
      if (isHop) {
        st.hop = Math.min(1, st.hop + dt / HOP_S);
        st.pos.lerpVectors(a, b, st.hop);
        st.pos.y += Math.sin(st.hop * Math.PI) * 0.18;
      } else {
        const remaining = b.clone().sub(st.pos).setY(0);
        const d = remaining.length();
        const move = Math.min(d, CAT_SPEED * dt);
        if (d > 1e-4) st.pos.addScaledVector(remaining.normalize(), move);
        st.hop = d - move < 1e-3 ? 1 : 0;
      }
      const dir = b.clone().sub(a).setY(0);
      if (dir.lengthSq() > 1e-6) {
        const target = Math.atan2(-dir.z, dir.x);
        let diff = target - st.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        st.yaw += diff * Math.min(1, dt * 6);
      }
      if (st.hop >= 1) {
        st.pos.copy(b);
        st.seg++;
        st.hop = 0;
        if (st.seg >= st.path.length - 1) {
          st.path = [];
          st.sleepLeft = 45 + random() * 70;
          st.yaw = CAT_SPOTS[st.spot]!.yaw;
        }
      }
    }
    const isWalking = st.path.length > 0;
    root.current.position.copy(st.pos);
    root.current.rotation.y = st.yaw;
    curled.current.visible = !isWalking;
    standing.current.visible = isWalking;
    if (isWalking) {
      const phase = st.t * STRIDE_HZ * Math.PI * 2;
      legs.current.forEach((leg, i) => {
        if (leg) leg.rotation.z = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.55;
      });
      walkTail.current.rotation.x = Math.sin(st.t * 2.2) * 0.25;
    } else {
      const breathe = Math.sin(st.t * 1.6) * 0.035;
      body.current.scale.set(1.3 * (1 + breathe * 0.4), 0.55 * (1 + breathe), 0.85 * (1 + breathe * 0.4));
      const cycle = st.t % 23;
      head.current.rotation.x = cycle > 18 && cycle < 21 ? -Math.sin(((cycle - 18) / 3) * Math.PI) * 0.45 : 0;
      ear.current.rotation.z = st.t % 7 < 0.25 ? 0.5 : 0;
    }
  });

  const earPair = (y: number, mat: THREE.Material, first?: React.Ref<THREE.Mesh>) => (
    <>
      <mesh ref={first} position={[0.0, y, 0.04]} rotation={[0.35, 0, 0]} material={mat}>
        <coneGeometry args={[0.028, 0.065, 4]} />
      </mesh>
      <mesh position={[0.0, y, -0.04]} rotation={[-0.35, 0, 0]} material={mat}>
        <coneGeometry args={[0.028, 0.065, 4]} />
      </mesh>
    </>
  );

  return (
    <group ref={root} scale={1.1} name="cat">
      <group ref={curled}>
        <mesh ref={body} position={[0, 0.065, 0]} scale={[1.3, 0.55, 0.85]} material={fur} castShadow>
          <sphereGeometry args={[0.17, 20, 14]} />
        </mesh>
        <mesh geometry={curledTail} material={fur} castShadow />
        <group ref={head} position={[0.2, 0.075, 0.08]}>
          <mesh scale={[1.05, 0.85, 1]} material={fur} castShadow>
            <sphereGeometry args={[0.075, 16, 12]} />
          </mesh>
          <mesh position={[0.06, -0.015, 0]} scale={[0.6, 0.5, 0.7]} material={muzzle}>
            <sphereGeometry args={[0.045, 12, 8]} />
          </mesh>
          {earPair(0.07, dark, ear)}
        </group>
      </group>
      <group ref={standing} visible={false}>
        <mesh position={[0, 0.21, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.9]} material={fur} castShadow>
          <capsuleGeometry args={[0.075, 0.22, 6, 12]} />
        </mesh>
        <group position={[0.21, 0.29, 0]}>
          <mesh scale={[1.05, 0.9, 1]} material={fur} castShadow>
            <sphereGeometry args={[0.07, 14, 10]} />
          </mesh>
          <mesh position={[0.06, -0.015, 0]} scale={[0.6, 0.5, 0.7]} material={muzzle}>
            <sphereGeometry args={[0.042, 10, 8]} />
          </mesh>
          {earPair(0.065, dark)}
        </group>
        {[
          [0.12, 0.05],
          [0.12, -0.05],
          [-0.12, 0.05],
          [-0.12, -0.05],
        ].map(([x, z], i) => (
          <group key={i} ref={(g) => void (legs.current[i] = g)} position={[x!, 0.19, z!]}>
            <mesh position={[0, -0.095, 0]} material={i < 2 ? fur : dark} castShadow>
              <cylinderGeometry args={[0.017, 0.014, 0.19, 6]} />
            </mesh>
          </group>
        ))}
        <group ref={walkTail} position={[-0.17, 0.24, 0]}>
          <mesh geometry={upTail} material={fur} castShadow />
        </group>
      </group>
    </group>
  );
}

const LEAVES = 14;
const LEAF_AREA = { minX: -7, maxX: -1, minZ: -6.2, maxZ: -2.5, top: 6.5 } as const;

/** Leaves from the trees behind the wall drift down over the benches and lie a while before fading. */
function Leaves() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const random = useMemo(() => rng(99), []);
  const leaves = useMemo(
    () =>
      Array.from({ length: LEAVES }, () => ({
        p: new THREE.Vector3(
          LEAF_AREA.minX + random() * (LEAF_AREA.maxX - LEAF_AREA.minX),
          random() * LEAF_AREA.top,
          LEAF_AREA.minZ + random() * (LEAF_AREA.maxZ - LEAF_AREA.minZ),
        ),
        spin: random() * 6,
        rest: 0,
        phase: random() * 10,
      })),
    [random],
  );
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9a7a3a", roughness: 0.9, side: THREE.DoubleSide }), []);
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.045);
    shape.quadraticCurveTo(0.03, 0, 0, 0.045);
    shape.quadraticCurveTo(-0.03, 0, 0, -0.045);
    return new THREE.ShapeGeometry(shape, 4);
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const t = useRef(0);
  useFrame(() => {
    const dt = Math.min(timeControl.frameDt, 0.5);
    t.current += dt;
    leaves.forEach((l, i) => {
      if (l.p.y > 0.01) {
        l.p.y -= dt * 0.45;
        l.p.x += Math.sin(t.current * 1.3 + l.phase) * dt * 0.35;
        l.p.z += Math.cos(t.current * 0.9 + l.phase) * dt * 0.2;
        l.spin += dt * 2.5;
        if (l.p.y <= 0.01) {
          l.p.y = 0.006;
          l.rest = 25 + random() * 40;
        }
        e.set(Math.sin(l.spin) * 1.2, l.spin, Math.cos(l.spin * 0.7));
      } else {
        l.rest -= dt;
        e.set(-Math.PI / 2, l.phase, 0);
        if (l.rest <= 0) {
          l.p.set(LEAF_AREA.minX + random() * (LEAF_AREA.maxX - LEAF_AREA.minX), LEAF_AREA.top, LEAF_AREA.minZ + random() * (LEAF_AREA.maxZ - LEAF_AREA.minZ));
        }
      }
      q.setFromEuler(e);
      m.compose(l.p, q, one);
      mesh.current.setMatrixAt(i, m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, LEAVES]} castShadow frustumCulled={false} />;
}

/** Cars and scooters live in one simulation so they queue behind each other instead of driving through. */
function useStreetTraffic() {
  const road = useMemo(() => {
    const cars = TRAFFIC.map((t) => idleVehicle(CAR_LENGTH[t.model]));
    const scooters = RIDERS.map(() => idleVehicle(SCOOTER_LENGTH));
    const spawners: Spawner[] = [
      { pool: cars, random: rng(4242), next: 4, every: [7, 18], cruise: [6, 3.5] },
      { pool: scooters, random: rng(777), next: 2, every: [5, 12], cruise: [7, 4] },
    ];
    return { cars, scooters, all: [...cars, ...scooters], spawners };
  }, []);
  // Before the vehicles' own frame callbacks (priority 0) so they draw this frame's positions.
  useFrame(() => {
    const dt = Math.min(timeControl.frameDt, 0.5);
    for (const s of road.spawners) tickSpawner(s, road.all, dt);
    stepTraffic(road.all, dt);
  }, -1);
  return road;
}

export function Ambient() {
  const road = useStreetTraffic();
  // Traffic off (settings): no cars or ojek drawn. The street simulation keeps its few numbers ticking, so turning it
  // back on resumes mid-flow instead of with an empty road.
  const traffic = useApp((st) => st.settings.traffic);
  return (
    <group>
      {traffic && <Traffic cars={road.cars} />}
      {traffic && (
        <AssetBoundary name="riders">
          <Suspense fallback={null}>
            <ScooterTraffic scooters={road.scooters} />
          </Suspense>
        </AssetBoundary>
      )}
      <Cat />
      <Leaves />
    </group>
  );
}
