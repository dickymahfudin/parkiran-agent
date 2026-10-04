// Dev page (?gallery): every behaviour state frozen at its key moment, side by side, for visual review.
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Rider } from "./art/Ambient.tsx";
import { Car, Scooter } from "./art/Vehicles.tsx";
import type { Clip, Frame, PropState } from "./characters/brain.ts";
import { lookFor, type Habit } from "./characters/identity.ts";
import { Person, type Animator } from "./characters/Person.tsx";
import type { SmokeSource } from "./characters/props.tsx";
import { SmokeSystem } from "./characters/props.tsx";
import { CARS, HOOD_Z, SEAT_PLACES, SIT_ROOT_BACK } from "./layout.ts";
import { DebugHandle, SceneClock, cameraFromUrl } from "./SceneDebug.tsx";

interface Slot {
  label: string;
  clip: Clip;
  t: number;
  seated: boolean;
  props?: Partial<PropState>;
  typingRate?: number;
  friend?: boolean;
  /** An ojol rider on a moving scooter instead of a lot character. */
  ride?: boolean;
  /** Seat surface height (m); the clips are made for 0.45, car hoods are higher. */
  seatY?: number;
  /** Head turn towards a chatting neighbour (rad). */
  look?: number;
  /** Force what the person smokes (else the look's own). */
  habit?: Habit;
}

const SLOTS: Slot[] = [
  { label: "session start (jalan masuk)", clip: "walk", t: 0.35, seated: false, props: { laptop: "closed" } },
  { label: "bash", clip: "type", t: 0.2, seated: true, typingRate: 1.7 },
  { label: "reading", clip: "type", t: 1.6, seated: true, typingRate: 0.45 },
  { label: "thinking (rokok + ngetik)", clip: "think", t: 2.2, seated: true, props: { cigarette: "lit" } },
  { label: "cari korek", clip: "patPockets", t: 0.3, seated: false, props: { laptop: "closed", cigarette: "unlit", bubble: "permission" } },
  { label: "nengok-nengok", clip: "lookAround", t: 0.75, seated: false, props: { laptop: "closed", cigarette: "unlit", bubble: "permission" } },
  { label: "dikasih korek", clip: "lightUp", t: 0.9, seated: false, props: { laptop: "closed", cigarette: "unlit", lighter: true, flame: true } },
  { label: "isap pertama", clip: "drag", t: 0.75, seated: false, props: { laptop: "closed", cigarette: "lit" } },
  { label: "ditolak (sigh)", clip: "sigh", t: 0.8, seated: false, props: { laptop: "closed", cigarette: "unlit" } },
  { label: "santai: rokok", clip: "smoke", t: 0.9, seated: true, props: { cigarette: "lit" } },
  { label: "santai: ngopi", clip: "sip", t: 1.0, seated: true, props: { cup: true } },
  { label: "compact: seruput (kretek di tangan)", clip: "sip", t: 1.8, seated: true, habit: "kretek", props: { laptop: "closed", cup: true, cigarette: "lit" } },
  { label: "compact: kopi + kretek", clip: "smoke", t: 2.2, seated: true, habit: "kretek", props: { laptop: "closed", cup: true, cigarette: "lit" } },
  { label: "compact: kopi + vape", clip: "smoke", t: 2.2, seated: true, habit: "vape", props: { laptop: "closed", cup: true, cigarette: "lit" } },
  { label: "compact: kopi, santai", clip: "sitIdle", t: 1.6, seated: true, habit: "none", props: { laptop: "closed", cup: true } },
  { label: "compact: jalan bawa kopi", clip: "walk", t: 0.35, seated: false, habit: "kretek", props: { laptop: "closed", cup: true, cigarette: "mouth" } },
  { label: "compact: berdiri pegang kopi", clip: "standIdle", t: 1.0, seated: false, habit: "kretek", props: { laptop: "closed", cup: true, cigarette: "mouth" } },
  { label: "compact: seruput berdiri", clip: "sip", t: 1.8, seated: false, habit: "none", props: { laptop: "closed", cup: true } },
  { label: "non-smoker: HP + kopi", clip: "phone", t: 0.5, seated: true, habit: "none", props: { laptop: "closed", cup: true, phone: true } },
  { label: "non-smoker: HP + seruput", clip: "phone", t: 5.0, seated: true, habit: "none", props: { laptop: "closed", cup: true, phone: true } },
  { label: "santai: stretching", clip: "stretch", t: 1.6, seated: true },
  { label: "santai: ngobrol", clip: "chat", t: 0.6, seated: true, look: 0.9, props: { laptop: "closed", cigarette: "lit" } },
  { label: "turn done (stretch)", clip: "stretch", t: 1.4, seated: true, props: { done: true } },
  { label: "wave (duduk)", clip: "wave", t: 1.0, seated: true },
  { label: "gagal: kesel", clip: "frustrated", t: 1.1, seated: true },
  { label: "idle (duduk)", clip: "sitIdle", t: 2.5, seated: true },
  { label: "ketiduran", clip: "doze", t: 1, seated: true, props: { zzz: true } },
  { label: "beli kopi", clip: "buy", t: 0.75, seated: false, props: { laptop: "none" } },
  { label: "pamit: tutup laptop", clip: "closeLaptop", t: 0.6, seated: true },
  { label: "subagent", clip: "type", t: 0.9, seated: true, typingRate: 1, friend: true },
  { label: "ojol (ride)", clip: "standIdle", t: 0, seated: false, ride: true },
  { label: "duduk di kap mobil", clip: "type", t: 1.0, seated: true, seatY: SEAT_PLACES["hood-1"]!.hip[1] },
  { label: "idle: main HP", clip: "phone", t: 0.5, seated: true, props: { laptop: "closed", cigarette: "lit", phone: true } },
  { label: "idle: main HP (isap)", clip: "phone", t: 5.0, seated: true, props: { laptop: "closed", cigarette: "lit", phone: true } },
  { label: "idle berdiri: main HP", clip: "phone", t: 0.5, seated: false, props: { laptop: "closed", cigarette: "mouth", phone: true } },
];

const SPACING_X = 1.25;
const SPACING_Z = 2.1;
const BASE_PROPS: PropState = { laptop: "open", cigarette: "none", lighter: false, flame: false, cup: false, bubble: null, zzz: false, phone: false, done: false };

function frozen(slot: Slot, x: number, z: number): Animator {
  const frame: Frame = {
    visible: true,
    x,
    z,
    yaw: 0,
    sit: slot.seated ? 1 : 0,
    seatY: slot.seated ? (slot.seatY ?? 0.45) : 0,
    seatStyle: slot.seated ? (slot.seatY ? "hood" : "bench") : null,
    clip: slot.clip,
    clipTime: slot.t,
    prevClip: null,
    prevClipTime: 0,
    blend: 1,
    typingRate: slot.typingRate ?? 1,
    walkSpeed: 1.25,
    look: slot.look ?? 0,
    props: { ...BASE_PROPS, ...(slot.seated ? {} : { laptop: "closed" }), ...slot.props },
  };
  const live = new URLSearchParams(location.search).has("live");
  let t = slot.t;
  return { update: (dt) => (live ? { ...frame, clipTime: (t += dt) } : frame) };
}

export function Gallery() {
  const smoke = useMemo(() => new Map<string, SmokeSource>(), []);
  // ?gallery=3-8 shows a subset in one row (front camera); plain ?gallery shows a grid of everything.
  const range = /^(\d+)-(\d+)$/.exec(new URLSearchParams(location.search).get("gallery") ?? "");
  const slots = range ? SLOTS.slice(Number(range[1]), Number(range[2]) + 1) : SLOTS;
  const cols = range ? slots.length : Math.max(3, Math.round(Math.sqrt(slots.length * (innerWidth / innerHeight) * 1.6)));
  const rows = Math.ceil(slots.length / cols);
  const people = useMemo(
    () =>
      slots.map((slot, i) => {
        const x = ((i % cols) - (cols - 1) / 2) * SPACING_X;
        const z = (Math.floor(i / cols) - (rows - 1) / 2) * SPACING_Z;
        const src: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "smoke" };
        const steam: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "steam" };
        smoke.set(`${i}:s`, src);
        smoke.set(`${i}:t`, steam);
        const look = lookFor(`gallery-${i}`);
        return { slot, x, z, animator: frozen(slot, x, z), look: slot.habit ? { ...look, habit: slot.habit } : look, src, steam };
      }),
    [],
  );
  const width = cols * SPACING_X;
  const depth = rows * SPACING_Z;
  const vfov = range ? 30 : 38;
  const hfov = 2 * Math.atan(Math.tan(((vfov / 2) * Math.PI) / 180) * (innerWidth / innerHeight));
  const rowDistance = (width / 2 + 0.4) / Math.tan(hfov / 2);
  const cam = cameraFromUrl();
  return (
    <Canvas
      className="scene"
      shadows
      dpr={[1, 2]}
      camera={{ position: cam?.position ?? (range ? [0, 1.45, rowDistance] : [0, depth * 1.1 + 2, depth / 2 + width * 0.95 + 1.5]), fov: vfov }}
    >
      <SceneClock />
      <DebugHandle />
      <color attach="background" args={["#a9bccb"]} />
      <hemisphereLight args={["#e6eef6", "#4a443c", 1.0]} />
      <directionalLight position={[-4, 8, 6]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-bias={-0.0003} shadow-normalBias={0.02} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 4, depth + 4]} />
        <meshStandardMaterial color="#4a4b4e" roughness={0.95} />
      </mesh>
      <Suspense fallback={null}>
        {people.map(({ slot, x, z, animator, look, src, steam }) => (
          <group key={slot.label}>
            {slot.seated && slot.seatY !== undefined && range && (
              // The real car, placed against the hips exactly as in the lot (one row only: it reaches 4 m back).
              <Car {...CARS[0]} x={x} z={z - SIT_ROOT_BACK - (HOOD_Z - CARS[0].z)} />
            )}
            {slot.seated && !(slot.seatY !== undefined && range) && (
              <mesh position={[x, ((slot.seatY ?? 0.45) - 0.01) / 2, z - SIT_ROOT_BACK - 0.05]} castShadow receiveShadow>
                <boxGeometry args={[0.6, (slot.seatY ?? 0.45) - 0.01, 0.42]} />
                <meshStandardMaterial color="#8b5a2b" />
              </mesh>
            )}
            {slot.ride ? (
              <group position={[x, 0, z]}>
                <Scooter x={0} z={0} yaw={0} color="#b8322b" plate="B 4471 KZA" parked={false} />
                <Rider id="ojol-1" helmet="#1f8a3a" />
              </group>
            ) : (
              <Person brain={animator} look={look} tag={null} friend={!!slot.friend} smoke={src} steam={steam} />
            )}
            <Html position={[x, -0.05, z + 0.55]} center>
              <div className="gallery-label">{slot.label}</div>
            </Html>
          </group>
        ))}
      </Suspense>
      <SmokeSystem sources={smoke} />
      <OrbitControls target={cam?.target ?? (range ? [0, 0.85, 0] : [0, 0.5, 0])} />
    </Canvas>
  );
}
