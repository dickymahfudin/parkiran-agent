// Head accessories, picked per session (`accessoryFor`): a peci or glasses. Procedural, a few draws each, placed on the
// head anchor by Person. No cloth on the people, by design.
import * as THREE from "three";
import type { Accessory } from "./identity.ts";

/** Skull centre to the eyes, from the MPFB head (head anchor space: +Y up, +Z forward). */
const EYES = { y: -0.052, z: 0.1, apart: 0.031 };

const MAT = {
  velvet: new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.95 }),
  frame: new THREE.MeshStandardMaterial({ color: "#16181b", roughness: 0.35, metalness: 0.2 }),
  lens: new THREE.MeshStandardMaterial({ color: "#1c2630", roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.35 }),
};

/**
 * Black velvet peci, a little tilted back, hugging the head (the hair shows below it). Head anchor at the skull centre.
 * Its rim sits 12 mm above the anchor and its top must stay above the cropped hair, or the hair pokes through the
 * crown seen from above (0.062 m tall still did).
 */
function Peci() {
  return (
    <mesh position={[0, 0.048, -0.004]} rotation={[-0.12, 0, 0]} scale={[1, 1, 1.16]} material={MAT.velvet} castShadow>
      <cylinderGeometry args={[0.076, 0.081, 0.072, 28]} />
    </mesh>
  );
}

function Glasses() {
  return (
    <group position={[0, EYES.y, EYES.z]}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * EYES.apart, 0, 0]}>
          <mesh scale={[1.25, 0.85, 1]} material={MAT.frame}>
            <torusGeometry args={[0.019, 0.0028, 6, 20]} />
          </mesh>
          <mesh scale={[1.25, 0.85, 1]} material={MAT.lens}>
            <circleGeometry args={[0.019, 20]} />
          </mesh>
          {/* Temple arm back to the ear. */}
          <mesh position={[side * 0.024, 0.004, -0.05]} material={MAT.frame}>
            <boxGeometry args={[0.003, 0.004, 0.1]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.006, 0.002]} material={MAT.frame}>
        <boxGeometry args={[0.016, 0.003, 0.003]} />
      </mesh>
    </group>
  );
}

/** The accessory on the head anchor (skull centre). */
export function CrewHead({ accessory }: { accessory: Accessory }) {
  return accessory === "peci" ? <Peci /> : <Glasses />;
}
