// A bakso or nasi goreng cart calling at the lot (schedule and route in foodCart.ts): procedural gerobak with a glass
// case, a tin roof and a petromax lamp, its vendor pushing it and turning to the lot while it stands, and the vendor's
// call ("ting-ting" on a bowl, "tek-tek" on the wok) panned and faded with the distance to the camera.
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { sound } from "../../audio/sound.ts";
import { useApp } from "../../state/store.ts";
import { envState } from "../env/envState.ts";
import { lookFor } from "../characters/identity.ts";
import type { Frame } from "../characters/brain.ts";
import { Person } from "../characters/Person.tsx";
import type { SmokeSource } from "../characters/props.tsx";
import { WALK_SPEED } from "../layout.ts";
import { canvasTexture } from "./assets.tsx";
import {
  CART_AXLE_AHEAD,
  CART_IN_MS,
  CART_LENGTH,
  CART_PASS_MS,
  CART_SPEED,
  cartAt,
  cartPassAt,
  isCartHour,
  vendorAt,
  type CartKind,
  type CartPass,
} from "./foodCart.ts";

const LENGTH = CART_LENGTH;
/** Distance (m) at which the call has dropped to half its loudness. */
const CALL_HALF_DISTANCE = 9;

const SIGN: Record<CartKind, { text: string; paint: string; ink: string }> = {
  bakso: { text: "BAKSO", paint: "#2f6fb5", ink: "#fff6d8" },
  nasgor: { text: "NASI GORENG", paint: "#b8322b", ink: "#ffe08a" },
};

/** `?cart=bakso|nasgor` (dev): one cart right now, a few steps from its stop, whatever the time or the setting. */
const FORCED = import.meta.env.DEV ? new URLSearchParams(location.search).get("cart") : null;
const forcedPass: CartPass | null = FORCED === "bakso" || FORCED === "nasgor" ? { kind: FORCED, start: Date.now() - (CART_IN_MS - 4000) } : null;

const MAT = {
  wood: new THREE.MeshStandardMaterial({ color: "#7a5434", roughness: 0.8 }),
  tin: new THREE.MeshStandardMaterial({ color: "#a9aeb3", metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: "#dfe9ee", roughness: 0.05, transparent: true, opacity: 0.28 }),
  steel: new THREE.MeshStandardMaterial({ color: "#c9ced3", metalness: 0.85, roughness: 0.3 }),
  tyre: new THREE.MeshStandardMaterial({ color: "#1b1b1b", roughness: 0.9 }),
  wok: new THREE.MeshStandardMaterial({ color: "#2b2b2d", metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }),
  lamp: new THREE.MeshStandardMaterial({ color: "#fff1c8", emissive: "#ffcf7a", emissiveIntensity: 0 }),
};

function signMaterial(kind: CartKind): THREE.MeshStandardMaterial {
  const s = SIGN[kind];
  const map = canvasTexture(512, 192, (ctx) => {
    ctx.fillStyle = s.paint;
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = s.ink;
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, 484, 164);
    ctx.fillStyle = s.ink;
    ctx.font = `800 ${kind === "bakso" ? 104 : 72}px "Plus Jakarta Sans Variable", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.text, 256, 102);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7 });
}

function Cart({ kind, lamp }: { kind: CartKind; lamp: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  const sign = useMemo(() => signMaterial(kind), [kind]);
  const lampMat = useMemo(() => MAT.lamp.clone(), []);
  lamp.current = lampMat;
  return (
    <group>
      {/* Body on a low frame, sign on both long sides. */}
      <mesh position={[0, 0.72, 0]} material={MAT.wood} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.72, LENGTH]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.302, 0.74, 0]} rotation={[0, side * (Math.PI / 2), 0]} material={sign}>
          <planeGeometry args={[LENGTH - 0.08, 0.42]} />
        </mesh>
      ))}
      {/* Glass case, tin roof on four posts, the petromax hanging under it. */}
      <mesh position={[0, 1.27, -0.12]} material={MAT.glass}>
        <boxGeometry args={[0.56, 0.38, 0.8]} />
      </mesh>
      {[-1, 1].flatMap((a) =>
        [-1, 1].map((b) => (
          <mesh key={`${a}${b}`} position={[a * 0.27, 1.45, b * 0.53]} material={MAT.steel}>
            <cylinderGeometry args={[0.012, 0.012, 0.75, 6]} />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.84, 0]} rotation={[0.05, 0, 0]} material={MAT.tin} castShadow>
        <boxGeometry args={[0.72, 0.015, LENGTH + 0.2]} />
      </mesh>
      <mesh position={[0, 1.66, 0.2]} material={lampMat}>
        <sphereGeometry args={[0.055, 12, 8]} />
      </mesh>
      {/* What it sells: a steaming bakso pot or a wok on its stove, at the front end. */}
      {kind === "bakso" ? (
        <mesh position={[0, 1.24, 0.38]} material={MAT.steel} castShadow>
          <cylinderGeometry args={[0.15, 0.14, 0.32, 18]} />
        </mesh>
      ) : (
        <mesh position={[0, 1.13, 0.36]} rotation={[Math.PI, 0, 0]} material={MAT.wok} castShadow>
          <sphereGeometry args={[0.2, 16, 6, 0, Math.PI * 2, 0, 0.9]} />
        </mesh>
      )}
      {/* Two bicycle wheels at the front, a leg at the back, handles for the vendor. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.36, 0.3, CART_AXLE_AHEAD]} rotation={[0, Math.PI / 2, 0]} material={MAT.tyre} castShadow>
          <torusGeometry args={[0.28, 0.025, 8, 28]} />
        </mesh>
      ))}
      <mesh position={[0, 0.3, CART_AXLE_AHEAD]} rotation={[0, 0, Math.PI / 2]} material={MAT.steel}>
        <cylinderGeometry args={[0.012, 0.012, 0.76, 6]} />
      </mesh>
      <mesh position={[0, 0.18, -0.48]} material={MAT.steel}>
        <cylinderGeometry args={[0.018, 0.018, 0.36, 6]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.24, 0.92, -LENGTH / 2 - 0.2]} rotation={[Math.PI / 2 - 0.12, 0, 0]} material={MAT.steel}>
          <cylinderGeometry args={[0.014, 0.014, 0.42, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/** The vendor: the shared character behind the cart, hands forward on its handles, turned to the lot while it stands. */
function vendorAnimator(state: { pass: CartPass | null; now: number }) {
  const props = { laptop: "none", cigarette: "none", lighter: false, flame: false, cup: false, bubble: null, zzz: false, phone: false, done: false } as const;
  return {
    update: (): Frame => {
      const pass = state.pass;
      const v = pass ? vendorAt(pass, state.now) : null;
      // The walk clip's stride is made for WALK_SPEED: played by the distance walked, so the feet do not slide.
      const walkTime = (v?.stride ?? 0) / WALK_SPEED;
      const idleTime = v?.idle ?? 0;
      const standing = v?.clip === "standIdle";
      return {
        visible: v !== null,
        x: v?.x ?? 0,
        z: v?.z ?? 0,
        yaw: v?.yaw ?? 0,
        sit: 0,
        seatY: 0,
        seatStyle: null,
        clip: v?.clip ?? "push",
        clipTime: standing ? idleTime : walkTime,
        prevClip: v && v.blend < 1 ? (standing ? "push" : "standIdle") : null,
        prevClipTime: standing ? walkTime : idleTime,
        blend: v?.blend ?? 1,
        typingRate: 1,
        walkSpeed: standing ? 0 : CART_SPEED,
        look: 0,
        props: { ...props },
      };
    },
  };
}

const quiet: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "smoke" };
const quietSteam: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "steam" };

export function FoodCart() {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null!);
  const lamp = useRef<THREE.MeshStandardMaterial | null>(null);
  const state = useMemo(() => ({ pass: null as CartPass | null, now: 0, nextCall: 0 }), []);
  const vendor = useMemo(() => vendorAnimator(state), [state]);
  const tmp = useMemo(() => ({ rel: new THREE.Vector3(), right: new THREE.Vector3() }), []);
  const look = useMemo(() => ({ ...lookFor("pedagang-keliling"), cap: "#1d1f22", accessory: null, habit: "none" as const }), []);

  useFrame(() => {
    const now = Date.now();
    const d = envState.date;
    const hour = d.getHours() + d.getMinutes() / 60;
    // Off / evenings / all day, from the settings panel (read per frame: no re-render needed when it changes).
    const mode = useApp.getState().settings.cart;
    const pass = forcedPass && now < forcedPass.start + CART_PASS_MS ? forcedPass : isCartHour(hour, mode) ? cartPassAt(now) : null;
    state.pass = pass;
    state.now = now;
    group.current.visible = pass !== null;
    if (!pass) return;
    const { x, z, yaw } = cartAt(pass, now);
    group.current.position.set(x, 0, z);
    group.current.rotation.y = yaw;
    if (lamp.current) lamp.current.emissiveIntensity = 2.5 * envState.lighting.night;
    if (now >= state.nextCall) {
      state.nextCall = now + 2600 + Math.random() * 1200;
      const rel = tmp.rel.set(x - camera.position.x, 1 - camera.position.y, z - camera.position.z);
      const dist = Math.max(rel.length(), 0.5);
      const right = tmp.right.setFromMatrixColumn(camera.matrixWorld, 0);
      sound.cartCall(pass.kind, 1 / (1 + (dist / CALL_HALF_DISTANCE) ** 2), Math.max(-1, Math.min(1, (rel.dot(right) / dist) * 1.3)));
    }
  });

  return (
    <>
      <group ref={group} visible={false}>
        <CartSwitch lamp={lamp} state={state} />
      </group>
      <Person brain={vendor} look={look} tag={null} friend={false} smoke={quiet} steam={quietSteam} />
    </>
  );
}

/** Both carts are built once; the one on its round shows. */
function CartSwitch({ lamp, state }: { lamp: React.RefObject<THREE.MeshStandardMaterial | null>; state: { pass: CartPass | null } }) {
  const bakso = useRef<THREE.Group>(null!);
  const nasgor = useRef<THREE.Group>(null!);
  const lampBakso = useRef<THREE.MeshStandardMaterial | null>(null);
  const lampNasgor = useRef<THREE.MeshStandardMaterial | null>(null);
  useFrame(() => {
    const kind = state.pass?.kind ?? "bakso";
    bakso.current.visible = kind === "bakso";
    nasgor.current.visible = kind === "nasgor";
    lamp.current = kind === "bakso" ? lampBakso.current : lampNasgor.current;
  }, -1);
  return (
    <>
      <group ref={bakso}>
        <Cart kind="bakso" lamp={lampBakso} />
      </group>
      <group ref={nasgor} visible={false}>
        <Cart kind="nasgor" lamp={lampNasgor} />
      </group>
    </>
  );
}
