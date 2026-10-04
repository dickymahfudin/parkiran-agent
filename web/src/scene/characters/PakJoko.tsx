// Pak Joko, the warung owner, behind his counter (see warungOwner.ts), and the little stool he naps on.
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { envState } from "../env/envState.ts";
import { lookFor, type Look } from "./identity.ts";
import { Person } from "./Person.tsx";
import type { SmokeSource } from "./props.tsx";
import { OWNER_STOOL, WarungOwner, isOwnerNight } from "./warungOwner.ts";

/** Set each frame by the cast: someone is at the window buying a kopi. */
export const warungCounter = { busy: false };

const LOOK: Look = {
  ...lookFor("pak-joko"),
  shirt: "tee",
  shirtColor: "#e9e6df",
  print: "plain",
  legs: "pants",
  legsColor: "#3d3f44",
  hair: "short04",
  hairColor: "#2e2219",
  cap: null,
  accessory: "peci",
  habit: "kretek",
  scale: 1,
};

const wood = new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.85 });

function Stool() {
  const [x, y, z] = OWNER_STOOL;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, y - 0.02, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[0.3, 0.04, 0.3]} />
      </mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => (
        <mesh key={`${a}${b}`} position={[a * 0.12, (y - 0.04) / 2, b * 0.12]} material={wood} castShadow>
          <boxGeometry args={[0.035, y - 0.04, 0.035]} />
        </mesh>
      )))}
    </group>
  );
}

export function PakJoko({ smoke, steam }: { smoke: SmokeSource; steam: SmokeSource }) {
  const owner = useMemo(() => new WarungOwner(LOOK.seed), []);
  useFrame(() => {
    const d = envState.date;
    owner.setNight(isOwnerNight(d.getHours() + d.getMinutes() / 60));
    owner.setServing(warungCounter.busy);
  }, -1);
  const animator = useMemo(() => ({ update: (dt: number) => owner.update(dt) }), [owner]);
  return (
    <>
      <Stool />
      <Person brain={animator} look={LOOK} tag={null} friend={false} smoke={smoke} steam={steam} />
    </>
  );
}
