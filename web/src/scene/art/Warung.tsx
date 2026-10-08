import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { rng } from "../characters/identity.ts";
import { envState } from "../env/envState.ts";
import { AWNING_POLES, WARUNG } from "../layout.ts";
import { canvasTexture, pbrMaterial, useModel, usePbr } from "./assets.tsx";
import { Graffiti } from "./Graffiti.tsx";

// Warung box: x 3.4…7.5, z −5.7…−1.7, open front facing −X with the counter just inside.
const FRONT_X = WARUNG.minX;
const BACK_X = WARUNG.maxX;
const Z0 = WARUNG.minZ;
const Z1 = WARUNG.maxZ;
const DEPTH = Z1 - Z0;
const WIDTH = BACK_X - FRONT_X;
const H = 2.9;
const OPEN_Z0 = -5.25;
const OPEN_Z1 = -2.15;
const OPEN_H = 2.35;
const AWNING_Y_WALL = 2.62;
const AWNING_Y_EDGE = 2.12;

function signTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#f6e7b0");
    g.addColorStop(1, "#e9cf86");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = "#7a1f14";
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 1004, 236);
    ctx.textAlign = "center";
    ctx.font = '800 46px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.fillStyle = "#3b2a1a";
    ctx.fillText("WARUNG KOPI  •  BUKA 24 JAM", 512, 76);
    ctx.font = '900 132px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.fillStyle = "#7a1f14";
    ctx.fillText("PAK JOKO", 512, 205);
  });
}

function menuTexture(): THREE.CanvasTexture {
  const items = [
    ["KOPI HITAM", "5K"],
    ["KOPI SUSU", "7K"],
    ["TEH MANIS", "5K"],
    ["ES JERUK", "6K"],
    ["MIE REBUS", "10K"],
    ["GORENGAN", "1K"],
  ];
  return canvasTexture(256, 384, (ctx) => {
    ctx.fillStyle = "#1f2a24";
    ctx.fillRect(0, 0, 256, 384);
    ctx.strokeStyle = "#8a5a2b";
    ctx.lineWidth = 16;
    ctx.strokeRect(0, 0, 256, 384);
    ctx.fillStyle = "#f3efe2";
    ctx.font = '800 34px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("MENU", 128, 52);
    ctx.font = '600 23px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    items.forEach(([name, price], i) => {
      ctx.textAlign = "left";
      ctx.fillText(name!, 22, 100 + i * 46);
      ctx.textAlign = "right";
      ctx.fillStyle = "#f2c14e";
      ctx.fillText(price!, 234, 100 + i * 46);
      ctx.fillStyle = "#f3efe2";
    });
  });
}

/** Rows of single-serve coffee sachets as they hang in every warung (generic designs, no brands). */
function sachetTexture(): THREE.CanvasTexture {
  const designs = [
    ["#5a2a17", "#f2c14e", "KOPI"],
    ["#b8322b", "#ffffff", "MIX"],
    ["#e6b31e", "#5a2a17", "SUSU"],
    ["#2f6f3a", "#f3efe2", "JAHE"],
    ["#1f3f7a", "#f3efe2", "CAPPU"],
  ] as const;
  return canvasTexture(64, 512, (ctx) => {
    for (let i = 0; i < 8; i++) {
      const [bg, fg, label] = designs[i % designs.length]!;
      const y = i * 64;
      ctx.fillStyle = bg;
      ctx.fillRect(2, y + 2, 60, 60);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(2, y + 2, 60, 6);
      ctx.fillStyle = fg;
      ctx.font = '800 14px "Plus Jakarta Sans Variable", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(label, 32, y + 38);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(2, y + 58, 60, 4);
    }
  });
}

function neonTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 192, (ctx) => {
    ctx.clearRect(0, 0, 512, 192);
    ctx.font = '700 132px "Plus Jakarta Sans Variable", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 12;
    ctx.strokeText("KOPI", 256, 140);
  });
}

/** Blue tarp with sag and folds. */
function tarpGeometry(w: number, d: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, d, 24, 32);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / w + 0.5;
    const v = y / d + 0.5;
    const sag = Math.sin(v * Math.PI) * Math.sin(u * Math.PI) * 0.09;
    const folds = Math.sin(v * 22) * 0.012 + Math.sin(u * 9 + v * 3) * 0.008;
    pos.setZ(i, -sag + folds);
  }
  g.computeVertexNormals();
  // Lay it flat with its width along Z; the mesh then tilts it about Z so the wall side (+X) is higher.
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function Shelves() {
  const items = useMemo(() => {
    const r = rng(404);
    const palette = ["#c4161c", "#f2c14e", "#1f4fa3", "#2f8a4c", "#e07a2e", "#f3efe2", "#6b2a7a", "#d94f8a"];
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    for (let shelf = 0; shelf < 4; shelf++) {
      let z = Z0 + 0.35;
      while (z < Z1 - 0.35) {
        const w = 0.06 + r() * 0.14;
        const h = 0.1 + r() * 0.2;
        out.push({ p: [BACK_X - 0.32, 0.62 + shelf * 0.42 + h / 2, z + w / 2], s: [0.12 + r() * 0.1, h, w], c: palette[Math.floor(r() * palette.length)]! });
        z += w + 0.015;
      }
    }
    return out;
  }, []);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const mat = new THREE.Matrix4();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      mat.compose(new THREE.Vector3(...it.p), new THREE.Quaternion(), new THREE.Vector3(...it.s));
      m.setMatrixAt(i, mat);
      m.setColorAt(i, color.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[BACK_X - 0.32, 0.6 + i * 0.42, (Z0 + Z1) / 2]} receiveShadow>
          <boxGeometry args={[0.4, 0.025, DEPTH - 0.5]} />
          <meshStandardMaterial color="#7a5a3a" roughness={0.8} />
        </mesh>
      ))}
      <instancedMesh ref={setup} args={[undefined, undefined, items.length]}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.55} />
      </instancedMesh>
    </group>
  );
}

function Sachets() {
  const tex = useMemo(() => sachetTexture(), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.15, alphaTest: 0.5 }), [tex]);
  const strips = useMemo(() => {
    const r = rng(9);
    return Array.from({ length: 9 }, (_, i) => ({ z: OPEN_Z0 + 0.25 + i * 0.34, len: 0.9 + r() * 0.35, sway: r() * 6 }));
  }, []);
  const group = useRef<THREE.Group>(null!);
  useFrame((state) => {
    group.current.children.forEach((c, i) => (c.rotation.x = Math.sin(state.clock.elapsedTime * 1.3 + strips[i]!.sway) * 0.05));
  });
  return (
    <group ref={group} userData={{ dynamic: true }}>
      {strips.map((s, i) => (
        <group key={i} position={[FRONT_X - 0.12, OPEN_H - 0.02, s.z]}>
          <mesh position={[0, -s.len / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={mat}>
            <planeGeometry args={[0.09, s.len]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Warung() {
  const plaster = usePbr("blue_plaster_weathered", [WIDTH / 2.5, H / 2.5]);
  const shutter = usePbr("rusty_metal_shutter", [(OPEN_Z1 - OPEN_Z0) / 2, 0.35]);
  const roof = usePbr("corrugated_iron", [WIDTH / 1.2, DEPTH / 1.2]);
  const wood = usePbr("weathered_planks", [2, 1]);
  const wallMat = useMemo(() => pbrMaterial(plaster, { color: "#a9cfc6" }), [plaster]);
  const shutterMat = useMemo(() => pbrMaterial(shutter, { color: "#b9b6ae" }), [shutter]);
  const roofMat = useMemo(() => pbrMaterial(roof, { color: "#9da2a3", side: THREE.DoubleSide }), [roof]);
  const woodMat = useMemo(() => pbrMaterial(wood, { color: "#a07850" }), [wood]);
  const tarpMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a62b8", roughness: 0.62, side: THREE.DoubleSide }), []);
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.7 }), []);
  const menuMat = useMemo(() => new THREE.MeshStandardMaterial({ map: menuTexture(), roughness: 0.9 }), []);
  const neonMat = useMemo(() => {
    // One canvas for both maps (two identical textures were painted and uploaded before).
    const neon = neonTexture();
    return new THREE.MeshStandardMaterial({
      map: neon,
      transparent: true,
      emissive: "#ff3d7f",
      emissiveMap: neon,
      emissiveIntensity: 0,
      color: "#ff8fb4",
      depthWrite: false,
    });
  }, []);
  const bulbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#ffcf8a", emissiveIntensity: 0 }), []);
  const tubeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f4f8ff", emissive: "#e8f1ff", emissiveIntensity: 0 }), []);
  const fridgeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d9eef7", emissive: "#bfe6ff", emissiveIntensity: 0, transparent: true, opacity: 0.55, roughness: 0.1 }),
    [],
  );
  const glassMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#dfeff2", transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false }),
    [],
  );
  const tarpGeo = useMemo(() => tarpGeometry(DEPTH + 0.3, Math.hypot(FRONT_X - WARUNG.awningX + 0.3, AWNING_Y_WALL - AWNING_Y_EDGE)), []);

  // Under the warung roof and awning, in their shade already: these small things cast no shadow of their own.
  const thermos = useModel("plastic_thermos", { cast: false });
  // Cloned once: an inline clone in JSX made a new thermos on every render (a compact toggle left two on the counter).
  const thermos2 = useMemo(() => thermos.clone(), [thermos]);
  const crate1 = useModel("plastic_crate_01");
  const crate2 = useModel("plastic_crate_02");
  const gallon = useModel("plastic_bottle_gallon");
  const gallon2 = useModel("plastic_bottle_gallon");
  const lpg = useModel("small_lpg_tank");
  const trash = useModel("trashbag");
  const bulb1 = useModel("lightbulb_01", { cast: false });
  const bulb2 = useModel("lightbulb_01", { cast: false });
  const chair = useModel("plastic_monobloc_chair_01");

  const bulbLight = useRef<THREE.PointLight>(null!);
  const innerLight = useRef<THREE.PointLight>(null!);

  useFrame((state) => {
    const lamps = envState.lighting.lamps;
    const flicker = 0.94 + Math.sin(state.clock.elapsedTime * 37) * 0.03 + (Math.random() < 0.01 ? -0.3 : 0);
    bulbMat.emissiveIntensity = 0.3 + lamps * 6;
    tubeMat.emissiveIntensity = 0.4 + lamps * 4;
    neonMat.emissiveIntensity = lamps * 5 * flicker;
    fridgeMat.emissiveIntensity = 0.25 + lamps * 0.9;
    // Every dynamic light costs every lit pixel: by day they are off entirely (the neon glows via emissive + bloom).
    const on = lamps > 0.02;
    bulbLight.current.visible = on;
    innerLight.current.visible = on;
    bulbLight.current.intensity = lamps * 10;
    innerLight.current.intensity = lamps * 4;
  });

  const awningRun = FRONT_X - WARUNG.awningX;
  const awningAngle = Math.atan2(AWNING_Y_WALL - AWNING_Y_EDGE, awningRun);
  const midZ = (Z0 + Z1) / 2;

  return (
    <group>
      {/* Back and side walls */}
      <mesh position={[BACK_X - 0.1, H / 2, midZ]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.2, H, DEPTH]} />
      </mesh>
      {[Z0 + 0.1, Z1 - 0.1].map((z) => (
        <mesh key={z} position={[(FRONT_X + BACK_X) / 2, H / 2, z]} material={wallMat} castShadow receiveShadow>
          <boxGeometry args={[WIDTH, H, 0.2]} />
        </mesh>
      ))}
      {/* Front wall around the opening */}
      <mesh position={[FRONT_X + 0.1, H / 2, (Z0 + OPEN_Z0) / 2]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.2, H, OPEN_Z0 - Z0]} />
      </mesh>
      <mesh position={[FRONT_X + 0.1, H / 2, (OPEN_Z1 + Z1) / 2]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.2, H, Z1 - OPEN_Z1]} />
      </mesh>
      <mesh position={[FRONT_X + 0.1, (H + OPEN_H) / 2, (OPEN_Z0 + OPEN_Z1) / 2]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[0.2, H - OPEN_H, OPEN_Z1 - OPEN_Z0]} />
      </mesh>
      {/* Half-rolled shutter and its roll box */}
      <mesh position={[FRONT_X - 0.005, OPEN_H - 0.22, (OPEN_Z0 + OPEN_Z1) / 2]} rotation={[0, -Math.PI / 2, 0]} material={shutterMat} castShadow>
        <planeGeometry args={[OPEN_Z1 - OPEN_Z0, 0.44]} />
      </mesh>
      <mesh position={[FRONT_X - 0.12, OPEN_H + 0.12, (OPEN_Z0 + OPEN_Z1) / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.13, OPEN_Z1 - OPEN_Z0 + 0.1, 16]} />
        <meshStandardMaterial color="#6d6a63" metalness={0.5} roughness={0.6} />
      </mesh>
      {/* Floor and ceiling inside */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(FRONT_X + BACK_X) / 2, 0.01, midZ]} receiveShadow>
        <planeGeometry args={[WIDTH, DEPTH]} />
        <meshStandardMaterial color="#8c8577" roughness={0.9} />
      </mesh>
      {/* Seng roof */}
      <mesh position={[(FRONT_X + BACK_X) / 2, H + 0.22, midZ]} rotation={[0, 0, -0.1]} material={roofMat} castShadow receiveShadow>
        <boxGeometry args={[WIDTH + 0.5, 0.04, DEPTH + 0.5]} />
      </mesh>
      {/* Sign above the awning */}
      <mesh position={[FRONT_X - 0.02, 2.95, midZ]} rotation={[0, -Math.PI / 2, 0]} material={signMat} castShadow>
        <planeGeometry args={[2.9, 0.62]} />
      </mesh>
      {/* Counter: wooden base with a glass display case of jars */}
      <mesh position={[FRONT_X + 0.35, 0.48, (OPEN_Z0 + OPEN_Z1) / 2]} material={woodMat} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.96, OPEN_Z1 - OPEN_Z0 - 0.1]} />
      </mesh>
      <mesh position={[FRONT_X + 0.35, 1.16, -3.05]} material={glassMat}>
        <boxGeometry args={[0.46, 0.4, 1.3]} />
      </mesh>
      {[-3.5, -3.15, -2.8].map((z, i) => (
        <mesh key={z} position={[FRONT_X + 0.35, 1.13, z]}>
          <cylinderGeometry args={[0.08, 0.08, 0.3, 14]} />
          <meshStandardMaterial color={["#e3b45a", "#c9662f", "#e9dcc0"][i]} transparent opacity={0.9} roughness={0.3} />
        </mesh>
      ))}
      <primitive object={thermos} position={[FRONT_X + 0.38, 0.96, -4.35]} scale={1.4} />
      <primitive object={thermos2} position={[FRONT_X + 0.34, 0.96, -4.6]} rotation={[0, 1.2, 0]} scale={1.4} />
      {/* Menu board on the counter front, neon on the facade */}
      <mesh position={[FRONT_X - 0.04, 1.15, -4.62]} rotation={[0, -Math.PI / 2, 0]} material={menuMat}>
        <planeGeometry args={[0.46, 0.69]} />
      </mesh>
      <mesh position={[FRONT_X - 0.03, 1.95, Z1 - 0.38]} rotation={[0, -Math.PI / 2, 0]} material={neonMat}>
        <planeGeometry args={[0.85, 0.32]} />
      </mesh>
      <Shelves />
      {/* Drinks fridge */}
      <group position={[BACK_X - 0.55, 0, Z1 - 0.55]}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <boxGeometry args={[0.65, 1.9, 0.62]} />
          <meshStandardMaterial color="#c8202a" roughness={0.5} />
        </mesh>
        <mesh position={[-0.33, 0.95, 0]} material={fridgeMat}>
          <boxGeometry args={[0.02, 1.6, 0.54]} />
        </mesh>
      </group>
      {/* Lights: tube inside, two bare bulbs under the tarp */}
      <mesh position={[(FRONT_X + BACK_X) / 2, H - 0.12, midZ]} rotation={[Math.PI / 2, 0, 0]} material={tubeMat}>
        <cylinderGeometry args={[0.025, 0.025, 1.2, 8]} />
      </mesh>
      <pointLight ref={innerLight} position={[(FRONT_X + BACK_X) / 2, H - 0.3, midZ]} color="#eef4ff" distance={6} decay={2} intensity={0} visible={false} />
      {/* One light for both bulbs, between them. */}
      <pointLight ref={bulbLight} position={[2.55, 2.17, -3.55]} color="#ffc27a" distance={8} decay={2} intensity={0} visible={false} />
      {[
        [2.55, -4.6, bulb1],
        [2.55, -2.5, bulb2],
      ].map(([x, z, model], i) => (
        <group key={i} position={[x as number, 2.32, z as number]}>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 0.24, 4]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <primitive object={model as THREE.Group} rotation={[Math.PI, 0, 0]} scale={1.6} />
          <mesh position={[0, -0.09, 0]} material={bulbMat}>
            <sphereGeometry args={[0.045, 12, 10]} />
          </mesh>
        </group>
      ))}
      {/* Tarp awning on bamboo poles */}
      <mesh
        geometry={tarpGeo}
        material={tarpMat}
        position={[(FRONT_X + WARUNG.awningX) / 2 - 0.15, (AWNING_Y_WALL + AWNING_Y_EDGE) / 2, midZ]}
        rotation={[0, 0, awningAngle]}
        castShadow
        receiveShadow
      />
      {AWNING_POLES.map(([x, z]) => (
        <mesh key={z} position={[x, AWNING_Y_EDGE / 2, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.04, AWNING_Y_EDGE, 8]} />
          <meshStandardMaterial color="#b39a62" roughness={0.7} />
        </mesh>
      ))}
      <Sachets />
      <Graffiti plaster={plaster} />
      {/* Clutter */}
      <primitive object={crate1} position={[3.05, 0, -5.45]} rotation={[0, 0.2, 0]} />
      <primitive object={crate2} position={[3.05, 0.31, -5.45]} rotation={[0, -0.1, 0]} />
      <primitive object={gallon} position={[2.95, 0, -1.25]} scale={1.8} />
      <primitive object={gallon2} position={[3.18, 0, -1.4]} scale={1.8} rotation={[0, 1, 0]} />
      <primitive object={lpg} position={[3.15, 0, -4.95]} scale={0.75} />
      <primitive object={trash} position={[7.0, 0, -1.1]} scale={0.9} />
      <primitive object={chair} position={[1.15, 0, -5.2]} rotation={[0, 0.9, 0]} />
    </group>
  );
}
