// The props a person holds, built once per kind and parented to the bones (Person.tsx): kretek, vape, lighter, phone
// and kopi, plus the materials and grip constants that place them.
import * as THREE from "three";

/** Cap crown: an ellipsoid hugging the cropped hair (head ±0.075 wide, 0.2 deep, crown at 1.66 m). */
/** Cap anchor (skull centre) and crown radii: the crown sits high enough to clear the ears and still covers the hair. */
export const CAP = { y: 1.588, z: 0.042, crown: [0.09, 0.078, 0.104] as [number, number, number], lift: 0.014 };

export const MAT = {
  paper: new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8 }),
  filter: new THREE.MeshStandardMaterial({ color: "#c98a3c", roughness: 0.7 }),
  lighter: new THREE.MeshStandardMaterial({ color: "#d23c2a", roughness: 0.4 }),
  flame: new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ff9a2a", emissiveIntensity: 4, transparent: true, opacity: 0.9 }),
  cup: new THREE.MeshStandardMaterial({ color: "#efe9dd", roughness: 0.35 }),
  coffee: new THREE.MeshStandardMaterial({ color: "#3b2416", roughness: 0.2 }),
  laptop: new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.5, roughness: 0.45 }),
  vape: new THREE.MeshStandardMaterial({ color: "#3a4352", metalness: 0.6, roughness: 0.35 }),
  vapeTip: new THREE.MeshStandardMaterial({ color: "#14161a", roughness: 0.5 }),
  screen: new THREE.MeshStandardMaterial({ color: "#0d1b2a", emissive: "#5ab4ff", emissiveIntensity: 0.55 }),
};

export function Cigarette({ tip, tipMat }: { tip: React.RefObject<THREE.Mesh | null>; tipMat: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} material={MAT.filter}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.024, 6]} />
      </mesh>
      <mesh position={[0, 0, 0.052]} rotation={[Math.PI / 2, 0, 0]} material={MAT.paper}>
        <cylinderGeometry args={[0.0045, 0.0045, 0.056, 6]} />
      </mesh>
      <mesh ref={tip} position={[0, 0, 0.082]} rotation={[Math.PI / 2, 0, 0]} material={tipMat}>
        <cylinderGeometry args={[0.005, 0.005, 0.006, 6]} />
      </mesh>
    </group>
  );
}

/**
 * A pod vape held upright in the fist, not between two fingers like a cigarette: the mouthpiece tip at the anchor (+Y
 * towards the index finger, the end the drags bring to the lips), the body down the inside of the curled fingers, an
 * LED near the bottom that lights up while it is drawn on.
 */
export function Vape({ led }: { led: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, -0.006, 0]} material={MAT.vapeTip}>
        <boxGeometry args={[0.012, 0.012, 0.008]} />
      </mesh>
      <mesh position={[0, -0.044, 0]} material={MAT.vape}>
        <boxGeometry args={[0.021, 0.064, 0.011]} />
      </mesh>
      <mesh position={[0, -0.066, 0.0057]} material={led}>
        <planeGeometry args={[0.006, 0.006]} />
      </mesh>
    </group>
  );
}

/** Extra bend per finger joint (rad, base to tip) closing the cigarette hand into a fist round a pod vape. */
export const VAPE_CURL: [string, readonly [number, number, number]][] = [
  ["Index", [0.7, 0.9, 0.5]],
  ["Middle", [0.7, 0.9, 0.5]],
  ["Ring", [0.5, 0.7, 0.4]],
  ["Pinky", [0.4, 0.6, 0.4]],
];
/** The fist's arm follows the cigarette's drags; within this distance of the lips it is pulled so the pod's tip, not the cigarette's filter, meets them. */
export const VAPE_REACH = { near: 0.03, far: 0.14 };

export function Lighter({ flame }: { flame: React.RefObject<THREE.Mesh | null> }) {
  return (
    <>
      <mesh material={MAT.lighter}>
        <boxGeometry args={[0.012, 0.055, 0.022]} />
      </mesh>
      <mesh ref={flame} position={[0, 0.045, 0]} material={MAT.flame}>
        <coneGeometry args={[0.008, 0.028, 8]} />
      </mesh>
    </>
  );
}

/** A scrolled feed: header, posts, a picture block (it lights the face a little at night). */
function phoneScreenTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 150;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, 72, 150);
  ctx.fillStyle = "#1f8a5a";
  ctx.fillRect(0, 0, 72, 16);
  for (let i = 0; i < 4; i++) {
    const y = 22 + i * 32;
    ctx.fillStyle = "#c9ccd2";
    ctx.beginPath();
    ctx.arc(10, y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(19, y + 2, 40, 4);
    ctx.fillRect(19, y + 9, 28, 3);
    ctx.fillStyle = i === 1 ? "#e3a66a" : "#dfe2e7";
    ctx.fillRect(4, y + 15, 64, i === 1 ? 14 : 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SCREEN = phoneScreenTexture();
const PHONE_SCREEN = new THREE.MeshStandardMaterial({ map: SCREEN, emissiveMap: SCREEN, emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.25 });
/** Phone cases, picked per person: light and bright ones read against a dark shirt from across the lot. */
const PHONE_CASES = ["#d9d4c7", "#3f6fb0", "#c0463a", "#e7b9c0", "#8fa67a", "#1b1d22", "#e0b043"].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
);

/** Phone centre from the wrist (m): along the fingers, out of the palm, and up the knuckle line towards the index. */
export const PHONE_GRIP = { along: 0.089, out: 0.024, up: 0.06 } as const;

/** Phone prop (a big one, 7.6 × 16 cm): +Z out of the screen, +Y along the long side. */
export function Phone({ seed }: { seed: number }) {
  return (
    <>
      <mesh material={PHONE_CASES[seed % PHONE_CASES.length]} castShadow>
        <boxGeometry args={[0.076, 0.16, 0.01]} />
      </mesh>
      <mesh position={[0, 0, 0.0051]} material={PHONE_SCREEN}>
        <planeGeometry args={[0.07, 0.152]} />
      </mesh>
    </>
  );
}

/** A glass of kopi: +Z up out of its mouth, centred where the hand grips it. */
export function Cup() {
  return (
    <>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT.cup}>
        <cylinderGeometry args={[0.034, 0.028, 0.08, 14]} />
      </mesh>
      <mesh position={[0, 0, 0.034]} rotation={[Math.PI / 2, 0, 0]} material={MAT.coffee}>
        <cylinderGeometry args={[0.031, 0.031, 0.006, 14]} />
      </mesh>
    </>
  );
}
