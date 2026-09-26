import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { canvasTexture } from "../art/assets.tsx";
import { rng } from "./identity.ts";
import { envState } from "../env/envState.ts";
import { timeControl } from "../timeControl.ts";

export interface SmokeSource {
  active: boolean;
  /** World position of the emitter (cigarette tip or cup rim). */
  world: THREE.Vector3;
  kind?: "smoke" | "steam";
  /** Smoke only: how much the tip gives off; low while it is drawn on (the smoke goes into the lungs). */
  strength?: number;
  /** Smoke blown out of the mouth after a drag: `t` runs 0…1 over the exhale. */
  exhale?: { active: boolean; t: number; mouth: THREE.Vector3; dir: THREE.Vector3 };
}

const MAX_PUFFS = 900;
const WISP_FRAMES = 4;

/** Particle kinds: a thin stream off the tip, a cloud blown out of the mouth, steam off a cup. */
const enum Kind {
  Tip = 0,
  Exhale = 1,
  Steam = 2,
}

interface Puff {
  alive: boolean;
  kind: Kind;
  age: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size0: number;
  size1: number;
  alpha: number;
  rot: number;
  spin: number;
  frame: number;
  seed: number;
}

/** Per kind: emission rate (/s), life (s), start and end size (m), peak opacity, rise speed it settles at (m/s). */
const KINDS = {
  [Kind.Tip]: { rate: 26, life: [2.4, 3.4], size0: [0.007, 0.012], size1: [0.09, 0.16], alpha: [0.2, 0.3], rise: 0.17 },
  [Kind.Exhale]: { rate: 34, life: [1.8, 2.6], size0: [0.025, 0.04], size1: [0.2, 0.32], alpha: [0.14, 0.2], rise: 0.07 },
  [Kind.Steam]: { rate: 9, life: [1.2, 1.7], size0: [0.01, 0.016], size1: [0.05, 0.08], alpha: [0.07, 0.11], rise: 0.22 },
} as const;

/**
 * Soft, streaky wisps (value-noise fbm under a round falloff), four variants side by side; the red channel is the
 * opacity.
 */
function wispAtlas(): THREE.CanvasTexture {
  const S = 96;
  const r = rng(9001);
  return canvasTexture(
    S * WISP_FRAMES,
    S,
    (ctx) => {
      const img = ctx.createImageData(S * WISP_FRAMES, S);
      for (let f = 0; f < WISP_FRAMES; f++) {
        const octaves = [4, 8, 16].map((n) => ({ n, v: Array.from({ length: (n + 1) * (n + 1) }, () => r()) }));
        const noise = (x: number, y: number) => {
          let sum = 0;
          let amp = 0.55;
          for (const { n, v } of octaves) {
            const gx = x * n;
            const gy = y * n;
            const ix = Math.min(n - 1, Math.floor(gx));
            const iy = Math.min(n - 1, Math.floor(gy));
            const fx = gx - ix;
            const fy = gy - iy;
            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);
            const at = (i: number, j: number) => v[j * (n + 1) + i]!;
            const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
            const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
            sum += (top + (bottom - top) * sy) * amp;
            amp *= 0.5;
          }
          return sum / 0.9625;
        };
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S;
            const w = (y + 0.5) / S;
            const d = Math.hypot(u - 0.5, w - 0.5) * 2;
            const falloff = Math.max(0, 1 - d) ** 1.6;
            const wisp = Math.max(0, noise(u, w) - 0.25) / 0.75;
            const a = Math.round(255 * Math.min(1, falloff * (0.25 + 1.1 * wisp ** 1.4)));
            const o = (y * S * WISP_FRAMES + f * S + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = a;
            img.data[o + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );
}

const VERTEX = /* glsl */ `
attribute vec4 iPosSize;
attribute vec4 iParams;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPosSize.xyz, 1.0);
  float c = cos(iParams.y);
  float s = sin(iParams.y);
  mv.xy += mat2(c, s, -s, c) * position.xy * iPosSize.w;
  gl_Position = projectionMatrix * mv;
  vUv = vec2((uv.x + iParams.z) / ${WISP_FRAMES.toFixed(1)}, uv.y);
  vAlpha = iParams.x;
  vKind = iParams.w;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 smokeColor;
uniform vec3 steamColor;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
void main() {
  float a = texture2D(map, vUv).r * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vKind > 1.5 ? steamColor : smokeColor, a);
}`;

const pick = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

/**
 * Every cigarette and cup in one draw: camera-facing wisps sorted back to front. Tip smoke leaves as a thin laminar
 * thread and breaks into curls as it rises; a drag dims it and the smoke comes back out of the mouth as a cloud
 * that is blown forward, slows and drifts up.
 */
export function SmokeSystem({ sources }: { sources: Map<string, SmokeSource> }) {
  const puffs = useMemo<Puff[]>(
    () =>
      Array.from({ length: MAX_PUFFS }, () => ({
        alive: false, kind: Kind.Tip, age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        size0: 0, size1: 0, alpha: 0, rot: 0, spin: 0, frame: 0, seed: 0,
      })),
    [],
  );
  const { mesh, posSize, params } = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    const posSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const params = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPosSize", posSize);
    geo.setAttribute("iParams", params);
    geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: wispAtlas() }, smokeColor: { value: new THREE.Color() }, steamColor: { value: new THREE.Color() } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, posSize, params };
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).uniforms.map!.value.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
    },
    [mesh],
  );
  const carry = useRef(new Map<string, number>());
  const order = useMemo(() => ({ alive: [] as number[], depth: new Float32Array(MAX_PUFFS) }), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const next = useRef(0);

  useFrame((state) => {
    const dt = Math.min(timeControl.frameDt, 0.1);
    const t = state.clock.elapsedTime;

    const spawn = (kind: Kind, at: THREE.Vector3, vx: number, vy: number, vz: number) => {
      for (let i = 0; i < MAX_PUFFS; i++) {
        const p = puffs[(next.current + i) % MAX_PUFFS]!;
        if (p.alive) continue;
        next.current = (next.current + i + 1) % MAX_PUFFS;
        const k = KINDS[kind];
        p.alive = true;
        p.kind = kind;
        p.age = 0;
        p.life = pick(k.life);
        p.pos.copy(at);
        p.vel.set(vx, vy, vz);
        p.size0 = pick(k.size0);
        p.size1 = pick(k.size1);
        p.alpha = pick(k.alpha);
        p.rot = Math.random() * Math.PI * 2;
        p.spin = (Math.random() - 0.5) * 0.8;
        p.frame = Math.floor(Math.random() * WISP_FRAMES);
        p.seed = Math.random() * 100;
        return;
      }
    };
    const emit = (id: string, rate: number, each: () => void) => {
      const acc = (carry.current.get(id) ?? 0) + dt * rate;
      const n = Math.floor(acc);
      carry.current.set(id, acc - n);
      for (let i = 0; i < n; i++) each();
    };

    for (const [id, src] of sources) {
      if (src.kind === "steam") {
        if (src.active) emit(id, KINDS[Kind.Steam].rate, () => spawn(Kind.Steam, src.world, 0, KINDS[Kind.Steam].rise, 0));
        continue;
      }
      if (src.active) {
        const rate = KINDS[Kind.Tip].rate * (src.strength ?? 1);
        emit(id, rate, () => spawn(Kind.Tip, src.world, (Math.random() - 0.5) * 0.01, KINDS[Kind.Tip].rise * 0.7, (Math.random() - 0.5) * 0.01));
      }
      const ex = src.exhale;
      if (ex?.active) {
        // Hardest at the start of the breath, trailing off.
        const push = 0.75 * (1 - ex.t) ** 1.5 + 0.08;
        emit(`${id}:exhale`, KINDS[Kind.Exhale].rate * (1 - ex.t * 0.6), () => {
          const spread = 0.12;
          spawn(
            Kind.Exhale,
            ex.mouth,
            ex.dir.x * push + (Math.random() - 0.5) * spread,
            ex.dir.y * push + 0.03 + (Math.random() - 0.5) * spread * 0.5,
            ex.dir.z * push + (Math.random() - 0.5) * spread,
          );
        });
      }
    }

    const l = envState.lighting;
    const day = (l.skyIntensity - 0.32) / 0.68;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    (u.smokeColor!.value as THREE.Color).setRGB(0.58, 0.6, 0.64).multiplyScalar(0.3 + 0.7 * day + 0.35 * l.lamps);
    (u.steamColor!.value as THREE.Color).setRGB(0.85, 0.86, 0.88).multiplyScalar(0.35 + 0.65 * day + 0.35 * l.lamps);

    state.camera.getWorldDirection(camDir);
    const cam = state.camera.position;
    const alive = order.alive;
    alive.length = 0;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = puffs[i]!;
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const k = p.age / p.life;
      const kind = KINDS[p.kind];
      // Buoyancy pulls the rise towards its settling speed; air drag eats the sideways push of a breath.
      p.vel.y += (kind.rise - p.vel.y) * 1.5 * dt;
      const drag = Math.exp(-(p.kind === Kind.Exhale ? 2.4 : 0.6) * dt);
      p.vel.x *= drag;
      p.vel.z *= drag;
      // Laminar near the source, curling further up: a swirl whose strength grows with age.
      const turb = (p.kind === Kind.Tip ? 0.5 : 0.25) * k * k;
      p.vel.x += Math.sin(t * 1.9 + p.pos.y * 13 + p.seed) * turb * dt;
      p.vel.z += Math.cos(t * 1.4 + p.pos.y * 11 + p.seed * 1.7) * turb * dt;
      // A faint breeze down the street.
      p.pos.x += (p.vel.x + 0.012) * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += (p.vel.z + 0.006) * dt;
      p.rot += p.spin * dt;
      order.depth[i] = (p.pos.x - cam.x) * camDir.x + (p.pos.y - cam.y) * camDir.y + (p.pos.z - cam.z) * camDir.z;
      alive.push(i);
    }
    // Back to front, so the soft edges blend over each other properly.
    alive.sort((a, b) => order.depth[b]! - order.depth[a]!);
    const count = alive.length;
    for (let n = 0; n < count; n++) {
      const p = puffs[alive[n]!]!;
      const k = p.age / p.life;
      const grow = 1 - (1 - k) ** 2.2;
      const fade = Math.min(1, k / 0.06) * (1 - k) ** 1.5;
      posSize.setXYZW(n, p.pos.x, p.pos.y, p.pos.z, p.size0 + (p.size1 - p.size0) * grow);
      params.setXYZW(n, p.alpha * fade, p.rot, p.frame, p.kind);
    }
    posSize.needsUpdate = true;
    params.needsUpdate = true;
    (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
  });

  return <primitive object={mesh} />;
}

export function BubbleIcon() {
  return (
    <>
      <svg className="bubble-lighter" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M12 2c1.6 2.2 2.6 3.7 2.6 5.1A2.6 2.6 0 0 1 12 9.8a2.6 2.6 0 0 1-2.6-2.7C9.4 5.7 10.4 4.2 12 2z" fill="#ff8a3d" />
        <rect x="8" y="11" width="8" height="11" rx="1.6" fill="#d23c2a" />
        <rect x="8" y="11" width="8" height="2.6" rx="0.8" fill="#9aa3ad" />
      </svg>
      <span className="bubble-q">?</span>
    </>
  );
}
