// HDRI sky: blends two pure-sky HDRIs per time band, rotated so each HDRI's sun sits where the computed
// sun (or moon) is, and feeds the same blend into a PMREM environment for image-based lighting.
// The HDRI sun is clamped out (the shadow-casting key light owns it) and the lower hemisphere is replaced by
// light bounced off the lot, so walls get ground fill instead of whatever was under the HDRI camera.
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type { SkyBand } from "./dayNight.ts";
import { envState } from "./envState.ts";

const HDRI: Record<SkyBand, string> = {
  morning: "/assets/hdri/kiara_1_dawn_1k.hdr",
  noon: "/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
  golden: "/assets/hdri/belfast_sunset_puresky_1k.hdr",
  night: "/assets/hdri/rogland_clear_night_1k.hdr",
};
const BANDS = Object.keys(HDRI) as SkyBand[];
const SKY_LAYER = 1;
const ENV_UPDATE_EVERY_S = 1.5;
// The very first capture can come out black (programs/textures not ready yet), so the first few repeat quickly.
const WARMUP_CAPTURES = 4;
const WARMUP_EVERY_S = 0.25;

const SUN_CLAMP = 6;
// Each HDRI was shot at its own exposure; rescale so its sky (sun clamped out) gives this horizontal irradiance / π.
// Noon sun 3.6 (≈1.15 here) against sky 0.42 is slightly punchier than the noon HDRI's own ≈2:1 sun/sky ratio.
const SKY_TARGET: Record<SkyBand, number> = { morning: 0.22, noon: 0.42, golden: 0.24, night: 0.1 };
const GROUND_ALBEDO: [number, number, number] = [0.17, 0.16, 0.15];
const LAMP_BOUNCE: [number, number, number] = [0.05, 0.035, 0.018];

interface HdriStats {
  /** Longitude (atan2(z, x) of the equirect direction) of the brightest texel in the upper hemisphere. */
  sunLon: number;
  /** Horizontal irradiance / π of the clamped upper hemisphere (three.js diffuse units). */
  skyIrradiance: number;
}

function hdriStats(tex: THREE.DataTexture): HdriStats {
  const { data, width, height } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]!) : data[i]!);
  const channels = data.length / (width * height);
  let best = -1;
  let bestU = 0.5;
  let irradiance = 0;
  for (let y = 0; y < height; y += 2) {
    const v = (y + 0.5) / height;
    // DataTexture rows run bottom → top when flipY is false.
    const lat = (tex.flipY ? 0.5 - v : v - 0.5) * Math.PI;
    if (lat <= 0) continue;
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const lum = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (lum > best) {
        best = lum;
        bestU = x / width;
      }
      irradiance += Math.min(lum, SUN_CLAMP) * Math.sin(lat) * Math.cos(lat);
    }
  }
  const texelSolidAngle = (2 * Math.PI * Math.PI) / ((width / 2) * (height / 2));
  return { sunLon: (bestU - 0.5) * Math.PI * 2, skyIrradiance: (irradiance * texelSolidAngle) / Math.PI };
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float mixT;
  uniform float rotA;
  uniform float rotB;
  uniform float intensity;
  uniform float scaleA;
  uniform float scaleB;
  uniform vec3 ground;
  varying vec3 vDir;
  vec2 equirect(vec3 d, float rot) {
    float c = cos(rot), s = sin(rot);
    d = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
    return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 a = texture2D(tA, equirect(d, rotA)).rgb;
    vec3 b = texture2D(tB, equirect(d, rotB)).rgb;
    vec3 sky = min(mix(min(a, vec3(${SUN_CLAMP.toFixed(1)})) * scaleA, min(b, vec3(${SUN_CLAMP.toFixed(1)})) * scaleB, mixT) * intensity, vec3(${SUN_CLAMP.toFixed(1)}));
    gl_FragColor = vec4(mix(sky, ground, 1.0 - smoothstep(-0.06, 0.02, d.y)), 1.0);
    #include <colorspace_fragment>
  }
`;

export function Sky() {
  const textures = useLoader(HDRLoader, BANDS.map((b) => HDRI[b])) as THREE.DataTexture[];
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const byBand = useMemo(() => {
    const out = {} as Record<SkyBand, { tex: THREE.DataTexture } & HdriStats>;
    BANDS.forEach((b, i) => {
      const tex = textures[i]!;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      out[b] = { tex, ...hdriStats(tex) };
    });
    return out;
  }, [textures]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tA: { value: byBand.noon.tex },
          tB: { value: byBand.noon.tex },
          mixT: { value: 0 },
          rotA: { value: 0 },
          rotB: { value: 0 },
          scaleA: { value: 1 },
          scaleB: { value: 1 },
          intensity: { value: 1 },
          ground: { value: new THREE.Color() },
        },
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [byBand],
  );

  const { cubeCamera, cubeTarget, pmrem } = useMemo(() => {
    const cubeTarget = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeTarget);
    cubeCamera.layers.set(SKY_LAYER);
    return { cubeCamera, cubeTarget, pmrem: new THREE.PMREMGenerator(gl) };
  }, [gl]);
  const envTarget = useRef<THREE.WebGLRenderTarget | null>(null);
  const lastEnv = useRef({ at: -Infinity, key: "", count: 0 });

  useEffect(() => {
    return () => {
      envTarget.current?.dispose();
      cubeTarget.dispose();
      pmrem.dispose();
    };
  }, [cubeTarget, pmrem]);

  useFrame((state) => {
    const l = envState.lighting;
    const u = material.uniforms;
    const keyLon = Math.atan2(envState.keyDir.z, envState.keyDir.x);
    u.tA!.value = byBand[l.sky.a].tex;
    u.tB!.value = byBand[l.sky.b].tex;
    u.mixT!.value = l.sky.t;
    u.rotA!.value = byBand[l.sky.a].sunLon - keyLon;
    u.rotB!.value = byBand[l.sky.b].sunLon - keyLon;
    u.scaleA!.value = SKY_TARGET[l.sky.a] / byBand[l.sky.a].skyIrradiance;
    u.scaleB!.value = SKY_TARGET[l.sky.b] / byBand[l.sky.b].skyIrradiance;
    u.intensity!.value = l.skyIntensity;
    const skyIrr = (SKY_TARGET[l.sky.a] * (1 - l.sky.t) + SKY_TARGET[l.sky.b] * l.sky.t) * l.skyIntensity;
    const direct = (l.key.intensity * Math.max(0, envState.keyDir.y)) / Math.PI;
    (u.ground!.value as THREE.Color).setRGB(
      ...(GROUND_ALBEDO.map((a, i) => a * (direct * l.key.color[i]! + skyIrr) + LAMP_BOUNCE[i]! * l.lamps) as [number, number, number]),
    );

    const key = `${l.sky.a}/${l.sky.b}/${l.sky.t.toFixed(2)}/${l.skyIntensity.toFixed(2)}/${keyLon.toFixed(2)}/${l.key.intensity.toFixed(2)}/${l.lamps.toFixed(2)}`;
    const t = state.clock.elapsedTime;
    const warming = lastEnv.current.count < WARMUP_CAPTURES;
    const due = t - lastEnv.current.at > (warming ? WARMUP_EVERY_S : ENV_UPDATE_EVERY_S);
    if ((warming || key !== lastEnv.current.key) && due) {
      lastEnv.current = { at: t, key, count: lastEnv.current.count + 1 };
      cubeCamera.update(gl, scene);
      const next = pmrem.fromCubemap(cubeTarget.texture);
      scene.environment = next.texture;
      envTarget.current?.dispose();
      envTarget.current = next;
    }
  });

  return (
    <mesh
      // Layer set before the first frame: the cube camera renders only this layer, and an empty first capture
      // would leave the environment black until the sun moves.
      ref={(m) => {
        if (m) m.layers.enable(SKY_LAYER);
      }}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
    >
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  );
}
