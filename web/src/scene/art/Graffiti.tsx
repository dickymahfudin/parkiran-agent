// A spray-painted piece on the warung's side wall: bubble letters with a 3D block, bevel and drips, a coffee cup with a
// lit cigarette on its saucer, a korek gas character and the writer's tag, then weathered so the plaster shows through.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { rng } from "../characters/identity.ts";
import { envState } from "../env/envState.ts";
import { WARUNG } from "../layout.ts";
import { canvasTexture, useModel, type PbrSet } from "./assets.tsx";

const FONT = '"Plus Jakarta Sans Variable", system-ui, sans-serif';
const CW = 2048;
const CH = 1024;
/** Painted area on the wall (m); the canvas maps onto it 1:1 in aspect. */
const PIECE_W = 3.7;
const PIECE_H = 1.85;
const PIECE_X = (WARUNG.minX + WARUNG.maxX) / 2;
const PIECE_Y = 0.36 + PIECE_H / 2;
/** Plaster tiling of the wall it sits on (one tile per 2.5 m), so the paint follows the same bumps. */
const PLASTER_TILE_M = 2.5;

const WORD = "NGOPI";
const LETTER_SIZE = 380;
/** Stroke that inflates the glyphs into bubble letters. */
const BUBBLE = 50;
const OUTLINE = 26;
const BLOCK_STEPS = 16;
const BLOCK_STEP: [number, number] = [2.3, 2.6];

const INK = "#0d0b12";
const BLOCK_NEAR = "#5d2c8f";
const BLOCK_FAR = "#25103f";

interface Letter {
  ch: string;
  x: number;
  y: number;
  rot: number;
  w: number;
}

type Draw = (ctx: CanvasRenderingContext2D, grow: number) => void;

function layoutLetters(ctx: CanvasRenderingContext2D): Letter[] {
  ctx.font = `900 ${LETTER_SIZE}px ${FONT}`;
  const bounce = [10, -26, 18, -14, 4];
  const tilt = [-0.1, 0.06, -0.04, 0.08, -0.06];
  const overlap = -10;
  const widths = [...WORD].map((ch) => ctx.measureText(ch).width);
  let x = 1240 - (widths.reduce((a, b) => a + b, 0) + overlap * (WORD.length - 1)) / 2;
  return [...WORD].map((ch, i) => {
    const w = widths[i]!;
    const letter = { ch, x: x + w / 2, y: 690 + bounce[i]!, rot: tilt[i]!, w };
    x += w + overlap;
    return letter;
  });
}

/** Local point of a letter in canvas space. */
function onLetter(l: Letter, dx: number, dy: number): [number, number] {
  return [l.x + dx * Math.cos(l.rot) - dy * Math.sin(l.rot), l.y + dx * Math.sin(l.rot) + dy * Math.cos(l.rot)];
}

function letterShape(letters: Letter[], drips: { x: number; y: number; len: number; w: number }[]): Draw {
  return (ctx, grow) => {
    ctx.font = `900 ${LETTER_SIZE}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const l of letters) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.lineWidth = BUBBLE + grow;
      ctx.strokeText(l.ch, 0, 0);
      ctx.fillText(l.ch, 0, 0);
      ctx.restore();
    }
    for (const d of drips) {
      ctx.lineWidth = d.w + grow;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y + d.len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(d.x, d.y + d.len + d.w * 0.25, d.w * 0.85 + grow / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

/** Cup on a saucer with a handle; the character's silhouette. */
const CUP = { x: 330, top: 470, bottom: 790, half: 150 };
const cupShape: Draw = (ctx, grow) => {
  const { x, top, bottom, half } = CUP;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = grow;
  ctx.beginPath();
  ctx.moveTo(x - half, top);
  ctx.lineTo(x + half, top);
  ctx.bezierCurveTo(x + half, bottom - 90, x + half * 0.75, bottom, x, bottom);
  ctx.bezierCurveTo(x - half * 0.75, bottom, x - half, bottom - 90, x - half, top);
  ctx.closePath();
  ctx.fill();
  if (grow > 0) ctx.stroke();
  ctx.lineWidth = 38 + grow;
  ctx.beginPath();
  ctx.ellipse(x + half + 10, top + 120, 58, 66, 0, -Math.PI * 0.55, Math.PI * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, bottom + 12, half + 70 + grow / 2, 32 + grow / 2, 0, 0, Math.PI * 2);
  ctx.fill();
};

/** Paints `shape` with a 3D block `steps` deep, outline and the given fill; `detail` paints inside the fill only. */
function paintBlock(
  ctx: CanvasRenderingContext2D,
  shape: Draw,
  fill: string | CanvasGradient,
  detail?: (c: CanvasRenderingContext2D) => void,
  steps = BLOCK_STEPS,
): void {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = INK;
  for (let k = 0; k <= steps; k++) {
    ctx.save();
    ctx.translate(k * BLOCK_STEP[0], k * BLOCK_STEP[1]);
    shape(ctx, OUTLINE + 14);
    ctx.restore();
  }
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const c = new THREE.Color(BLOCK_NEAR).lerp(new THREE.Color(BLOCK_FAR), t).getStyle();
    ctx.fillStyle = ctx.strokeStyle = c;
    ctx.save();
    ctx.translate(k * BLOCK_STEP[0], k * BLOCK_STEP[1]);
    shape(ctx, OUTLINE - 4);
    ctx.restore();
  }
  ctx.fillStyle = ctx.strokeStyle = INK;
  shape(ctx, OUTLINE);
  ctx.restore();

  // The fill and everything inside it go on their own layer, so details stay inside the letters.
  const layer = document.createElement("canvas");
  layer.width = CW;
  layer.height = CH;
  const l = layer.getContext("2d")!;
  l.fillStyle = l.strokeStyle = "#fff";
  shape(l, 0);
  // Gradients follow the transform in effect when drawn: the shape rotates each letter, so fill in canvas space.
  l.globalCompositeOperation = "source-in";
  l.fillStyle = fill;
  l.fillRect(0, 0, CW, CH);
  l.globalCompositeOperation = "source-atop";
  detail?.(l);
  // Bevel: a dark inner rim bottom right, a bright one top left.
  for (const [color, dx, dy] of [
    ["rgba(70, 0, 40, 0.55)", -12, -14],
    ["rgba(255, 245, 220, 0.4)", 7, 8],
  ] as const) {
    const rim = document.createElement("canvas");
    rim.width = CW;
    rim.height = CH;
    const r = rim.getContext("2d")!;
    r.fillStyle = color;
    r.fillRect(0, 0, CW, CH);
    r.globalCompositeOperation = "destination-out";
    r.translate(dx, dy);
    r.fillStyle = r.strokeStyle = "#000";
    shape(r, 0);
    l.drawImage(rim, 0, 0);
  }
  ctx.drawImage(layer, 0, 0);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const d = i % 2 === 0 ? r : r * 0.22;
    ctx.lineTo(x + Math.sin(a) * d, y - Math.cos(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, r: () => number): void {
  // Sprayed fade: soft-edged blobs, darker in the middle so the warm letters pop.
  for (const [x, y, rad, rgb, a] of [
    [1050, 560, 900, "24, 22, 64", 0.85],
    [520, 520, 520, "64, 26, 104", 0.7],
    [1600, 470, 600, "22, 64, 110", 0.65],
    [1200, 760, 520, "90, 24, 92", 0.5],
  ] as const) {
    // Drawn in squashed space, so the fade reaches zero all round the ellipse.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.62);
    const g = ctx.createRadialGradient(0, 0, rad * 0.25, 0, 0, rad);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(0.55, `rgba(${rgb}, ${a * 0.75})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Cloud bank behind the letters' feet.
  ctx.fillStyle = INK;
  const puffs = Array.from({ length: 13 }, (_, i) => ({ x: 560 + i * 115 + r() * 30, y: 820 + r() * 40, rad: 70 + r() * 45 }));
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.rad + 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#e9f6ff";
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(120, 170, 220, 0.45)";
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(p.x + p.rad * 0.25, p.y + p.rad * 0.3, p.rad * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  // Bubbles and sparkles in the haze.
  for (let i = 0; i < 26; i++) {
    const x = 180 + r() * 1700;
    const y = 120 + r() * 300;
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`;
    ctx.lineWidth = 3 + r() * 4;
    ctx.beginPath();
    ctx.arc(x, y, 6 + r() * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCup(ctx: CanvasRenderingContext2D): void {
  const { x, top, bottom, half } = CUP;
  // Steam curls.
  for (const [dx, h] of [
    [-70, 150],
    [0, 200],
    [70, 140],
  ] as const) {
    const curl = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      c.moveTo(x + dx, top - 40);
      c.bezierCurveTo(x + dx - 50, top - 40 - h * 0.35, x + dx + 50, top - 40 - h * 0.65, x + dx, top - 40 - h);
      c.stroke();
    };
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 40;
    curl(ctx);
    ctx.strokeStyle = "#f4fbff";
    ctx.lineWidth = 18;
    curl(ctx);
  }
  const body = ctx.createLinearGradient(x - half, 0, x + half, 0);
  body.addColorStop(0, "#fffaf0");
  body.addColorStop(0.7, "#f3e6cf");
  body.addColorStop(1, "#d9c3a0");
  paintBlock(ctx, cupShape, body, (l) => {
    // Red band and the coffee showing at the rim.
    l.fillStyle = "#e2343b";
    l.fillRect(x - half - 80, top + 170, half * 2 + 160, 46);
    l.fillStyle = "#ffd23f";
    l.fillRect(x - half - 80, top + 170, half * 2 + 160, 8);
  });
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, top + 4, half + 2, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6b3418";
  ctx.beginPath();
  ctx.ellipse(x, top + 6, half - 14, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c98a4b";
  ctx.beginPath();
  ctx.ellipse(x - 30, top + 2, 46, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Face: big eyes with shine, rosy cheeks, a grin.
  for (const side of [-1, 1]) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x + side * 55, top + 95, 22, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x + side * 55 - 7, top + 84, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 110, 130, 0.55)";
    ctx.beginPath();
    ctx.ellipse(x + side * 100, top + 135, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, top + 118, 34, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

/** Kretek resting on the saucer rim, ember out to the left so its smoke rises clear of the coffee's steam. */
const CIG = { x: 284, y: 796, rot: -0.1, len: 330, thick: 50, filter: 100 };

function inCig(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  ctx.translate(CIG.x, CIG.y);
  ctx.rotate(CIG.rot);
  draw();
  ctx.restore();
}

const cigShape: Draw = (ctx, grow) =>
  inCig(ctx, () => {
    ctx.lineJoin = "round";
    ctx.lineWidth = grow;
    ctx.beginPath();
    ctx.roundRect(-CIG.len / 2, -CIG.thick / 2, CIG.len, CIG.thick, CIG.thick * 0.3);
    ctx.fill();
    if (grow > 0) ctx.stroke();
  });

/** The ember end in canvas space. */
function cigTip(): [number, number] {
  return [CIG.x - (CIG.len / 2) * Math.cos(CIG.rot), CIG.y - (CIG.len / 2) * Math.sin(CIG.rot)];
}

function drawCigarette(ctx: CanvasRenderingContext2D): void {
  const { len, thick, filter } = CIG;
  const left = -len / 2;
  const right = len / 2;
  paintBlock(
    ctx,
    cigShape,
    "#f7f3ea",
    (l) =>
      inCig(l, () => {
        // Cork filter with speckles and a gold ring, ash and a glowing ember at the tip, shade along the underside.
        l.fillStyle = "#d98b3a";
        l.fillRect(right - filter, -thick, filter, thick * 2);
        l.fillStyle = "rgba(120, 60, 20, 0.55)";
        const r = rng(5);
        for (let i = 0; i < 28; i++) {
          l.beginPath();
          l.arc(right - filter + r() * filter, (r() - 0.5) * thick, 2 + r() * 2.5, 0, Math.PI * 2);
          l.fill();
        }
        l.fillStyle = "#ffd23f";
        l.fillRect(right - filter - 8, -thick, 9, thick * 2);
        l.fillStyle = "#8d8781";
        l.fillRect(left, -thick, 34, thick * 2);
        const ember = l.createRadialGradient(left, 0, 2, left, 0, 30);
        ember.addColorStop(0, "#fff3a0");
        ember.addColorStop(0.45, "#ff7a1a");
        ember.addColorStop(1, "rgba(200, 30, 10, 0.95)");
        l.fillStyle = ember;
        l.fillRect(left, -thick, 18, thick * 2);
        l.fillStyle = "rgba(60, 40, 80, 0.2)";
        l.fillRect(left, thick * 0.18, len, thick);
      }),
    6,
  );
  const [tx, ty] = cigTip();
  const glow = ctx.createRadialGradient(tx, ty, 4, tx, ty, 80);
  glow.addColorStop(0, "rgba(255, 150, 50, 0.55)");
  glow.addColorStop(1, "rgba(255, 150, 50, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(tx - 80, ty - 80, 160, 160);
}

/** A sprayed ribbon of smoke from the ember that widens as it rises, ending in a puff and a smoke ring. */
function drawSmoke(ctx: CanvasRenderingContext2D): void {
  const [x0, y0] = cigTip();
  const segments: [number, number][][] = [
    [[x0, y0 - 10], [x0 - 75, y0 - 120], [x0 + 70, y0 - 215], [x0 - 5, y0 - 300]],
    [[x0 - 5, y0 - 300], [x0 - 70, y0 - 370], [x0 + 70, y0 - 400], [x0 + 30, y0 - 450]],
  ];
  const puffs: { x: number; y: number; r: number }[] = [];
  const n = 140;
  segments.forEach(([a, b, c, d], si) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
      const x = k[0] * a![0] + k[1] * b![0] + k[2] * c![0] + k[3] * d![0];
      const y = k[0] * a![1] + k[1] * b![1] + k[2] * c![1] + k[3] * d![1];
      puffs.push({ x, y, r: 14 + ((si + t) / segments.length) * 34 });
    }
  });
  const [ex, ey] = [x0 + 30, y0 - 450];
  puffs.push({ x: ex, y: ey - 22, r: 52 }, { x: ex - 42, y: ey + 8, r: 40 }, { x: ex + 42, y: ey + 4, r: 38 });
  for (const [color, grow, shift, scale] of [
    [INK, 11, 0, 1],
    ["#d5dbe4", 0, 0, 1],
    ["#f3f6fa", 0, -0.25, 0.5],
  ] as const) {
    ctx.fillStyle = color;
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(p.x + shift * p.r, p.y + shift * p.r, p.r * scale + grow, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineWidth = 22;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.ellipse(ex + 72, ey - 50, 26, 17, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#e5e9ef";
  ctx.stroke();
}

/** Korek gas character standing on the clouds at the right end, lit and winking. */
const LIGHTER = { x: 1912, top: 640, bottom: 850, half: 50, capTop: 594 };

const lighterShape: Draw = (ctx, grow) => {
  const { x, top, bottom, half, capTop } = LIGHTER;
  ctx.lineJoin = "round";
  ctx.lineWidth = grow;
  ctx.beginPath();
  ctx.roundRect(x - half, top, half * 2, bottom - top, 20);
  ctx.roundRect(x - half + 4, capTop, half * 2 - 8, top - capTop + 12, 6);
  ctx.fill();
  if (grow > 0) ctx.stroke();
};

function flame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - w, y - h * 0.25, x - w * 0.6, y - h * 0.7, x + w * 0.15, y - h);
  ctx.bezierCurveTo(x + w * 0.75, y - h * 0.65, x + w, y - h * 0.25, x, y);
  ctx.closePath();
}

function drawLighter(ctx: CanvasRenderingContext2D): void {
  const { x, top, bottom, half, capTop } = LIGHTER;
  const body = ctx.createLinearGradient(x - half, 0, x + half, 0);
  body.addColorStop(0, "#ff5fb2");
  body.addColorStop(1, "#c8186f");
  paintBlock(
    ctx,
    lighterShape,
    body,
    (l) => {
      // Gas showing through the tank, a steel hood with its vent slots, a shine down the side.
      l.fillStyle = "rgba(110, 0, 60, 0.35)";
      l.beginPath();
      l.moveTo(x - half, 770);
      for (let px = x - half; px <= x + half; px += 6) l.lineTo(px, 770 + Math.sin(px / 9) * 3);
      l.lineTo(x + half, bottom);
      l.lineTo(x - half, bottom);
      l.closePath();
      l.fill();
      l.fillStyle = "#c9ced6";
      l.fillRect(x - half, capTop - 10, half * 2, top - capTop + 14);
      l.fillStyle = "rgba(50, 54, 62, 0.75)";
      for (let i = -2; i <= 2; i++) l.fillRect(x + i * 13 - 2, capTop + 8, 5, 24);
      l.fillStyle = "rgba(255, 255, 255, 0.45)";
      l.fillRect(x - half + 11, top + 18, 10, 136);
    },
    8,
  );
  // Flint wheel and the flame.
  ctx.lineWidth = 9;
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#9aa1ab";
  ctx.beginPath();
  ctx.arc(x - half + 14, capTop - 8, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const glow = ctx.createRadialGradient(x + 8, capTop - 50, 6, x + 8, capTop - 50, 110);
  glow.addColorStop(0, "rgba(255, 190, 70, 0.5)");
  glow.addColorStop(1, "rgba(255, 190, 70, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 110, capTop - 160, 230, 230);
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  flame(ctx, x + 8, capTop - 8, 40, 120);
  ctx.stroke();
  ctx.fillStyle = "#ff7a1a";
  ctx.fill();
  flame(ctx, x + 8, capTop - 12, 26, 84);
  ctx.fillStyle = "#ffd23f";
  ctx.fill();
  flame(ctx, x + 8, capTop - 14, 12, 40);
  ctx.fillStyle = "#fffbe6";
  ctx.fill();
  // Face: a wink, one bright eye, a grin.
  const ey = top + 58;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(x - 16, ey + 6, 11, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x + 17, ey, 9, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + 14, ey - 5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(x, ey + 22, 15, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 210, 230, 0.6)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * 29, ey + 24, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The writer's tag "dism": a quick one-colour handstyle, slanted, a star for the i's dot, a swoosh underline. */
function drawSignature(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const strokes = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    // d: bowl, then a tall stem that curls over at the top and drips at the foot.
    c.moveTo(52, -50);
    c.bezierCurveTo(36, -72, -6, -62, -2, -28);
    c.bezierCurveTo(0, 4, 40, 6, 52, -20);
    c.moveTo(26, -150);
    c.quadraticCurveTo(56, -176, 56, -136);
    c.lineTo(54, -4);
    c.quadraticCurveTo(56, 10, 74, 2);
    c.moveTo(55, 4);
    c.lineTo(55, 34);
    // i
    c.moveTo(98, -58);
    c.lineTo(96, -4);
    c.quadraticCurveTo(98, 8, 114, 0);
    // s
    c.moveTo(170, -56);
    c.bezierCurveTo(148, -72, 120, -56, 136, -38);
    c.bezierCurveTo(148, -24, 176, -26, 166, -6);
    c.bezierCurveTo(158, 8, 128, 6, 120, -6);
    // m, its last leg running into the underline
    c.moveTo(192, 2);
    c.lineTo(194, -58);
    c.bezierCurveTo(198, -72, 226, -74, 226, -50);
    c.lineTo(224, 2);
    c.moveTo(226, -50);
    c.bezierCurveTo(230, -74, 260, -74, 260, -48);
    c.lineTo(258, -6);
    c.quadraticCurveTo(260, 10, 282, 4);
    c.moveTo(259, 6);
    c.lineTo(259, 26);
    // Swoosh with an arrowhead.
    c.moveTo(-24, 32);
    c.bezierCurveTo(80, 56, 250, 46, 322, -8);
    c.moveTo(296, -24);
    c.lineTo(324, -8);
    c.lineTo(302, 16);
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.3, 1, 0, 0);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [color, width, dx, dy] of [
    [BLOCK_NEAR, 34, 7, 8],
    [INK, 34, 0, 0],
    ["#ff2e88", 16, 0, 0],
    ["rgba(255, 255, 255, 0.6)", 4, -3, -3],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    strokes(ctx);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = INK;
  star(ctx, 100, -94, 30);
  ctx.fillStyle = "#ffd23f";
  star(ctx, 100, -94, 20);
  ctx.restore();
}

function drawLetters(ctx: CanvasRenderingContext2D): Letter[] {
  const letters = layoutLetters(ctx);
  const drips = [
    { l: 0, dx: -60, len: 120, w: 20 },
    { l: 1, dx: 40, len: 70, w: 16 },
    { l: 2, dx: -30, len: 150, w: 22 },
    { l: 3, dx: -70, len: 90, w: 18 },
    { l: 4, dx: 8, len: 130, w: 18 },
  ].map((d) => {
    const [x, y] = onLetter(letters[d.l]!, d.dx, -20);
    return { x, y, len: d.len, w: d.w };
  });
  const shape = letterShape(letters, drips);
  const top = 690 - LETTER_SIZE * 0.8;
  const fill = ctx.createLinearGradient(0, top, 0, 760);
  fill.addColorStop(0, "#ffd21f");
  fill.addColorStop(0.4, "#ff8a12");
  fill.addColorStop(0.75, "#ff3d4e");
  fill.addColorStop(1, "#f0167a");
  paintBlock(ctx, shape, fill, (l) => {
    // Split fill: a wavy cyan band, bubbles in the lower half, shine marks top left of each letter.
    l.fillStyle = "rgba(94, 240, 255, 0.9)";
    l.beginPath();
    l.moveTo(0, 560);
    for (let x = 0; x <= CW; x += 32) l.lineTo(x, 560 + Math.sin(x / 90) * 16);
    for (let x = CW; x >= 0; x -= 32) l.lineTo(x, 598 + Math.sin(x / 90 + 1.2) * 14);
    l.closePath();
    l.fill();
    l.strokeStyle = INK;
    l.lineWidth = 6;
    l.stroke();
    l.strokeStyle = "rgba(255, 255, 255, 0.55)";
    l.lineWidth = 5;
    const r = rng(77);
    for (let i = 0; i < 40; i++) {
      l.beginPath();
      l.arc(500 + r() * 1500, 640 + r() * 200, 6 + r() * 14, 0, Math.PI * 2);
      l.stroke();
    }
    l.fillStyle = "#ffffff";
    l.strokeStyle = "#ffffff";
    l.lineCap = "round";
    for (const letter of letters) {
      const [x, y] = onLetter(letter, -letter.w * 0.3, -LETTER_SIZE * 0.5);
      l.lineWidth = 12;
      l.beginPath();
      l.moveTo(x, y + 44);
      l.quadraticCurveTo(x, y, x + 16, y - 10);
      l.stroke();
      l.beginPath();
      l.arc(x + 1, y + 70, 7, 0, Math.PI * 2);
      l.fill();
    }
  });
  return letters;
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.22);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-70, 40);
    ctx.lineTo(-80, -30);
    ctx.lineTo(-35, 5);
    ctx.lineTo(0, -50);
    ctx.lineTo(35, 5);
    ctx.lineTo(80, -30);
    ctx.lineTo(70, 40);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 22;
  path();
  ctx.stroke();
  ctx.fillStyle = "#ffd23f";
  path();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  for (const [cx, cy] of [
    [-80, -30],
    [0, -50],
    [80, -30],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTags(ctx: CanvasRenderingContext2D, letters: Letter[]): void {
  const last = letters[letters.length - 1]!;
  ctx.save();
  ctx.translate(last.x + 40, 205);
  ctx.rotate(-0.16);
  ctx.font = `italic 900 150px ${FONT}`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 34;
  ctx.strokeText("dulu!", 0, 0);
  ctx.strokeStyle = "#ff2e88";
  ctx.lineWidth = 16;
  ctx.strokeText("dulu!", 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("dulu!", 0, 0);
  ctx.restore();

  drawSignature(ctx, 70, 200, 0.85);
  ctx.fillStyle = "#ffffff";
  for (const [x, y, s] of [
    [560, 250, 46],
    [1880, 420, 38],
    [1010, 170, 26],
  ] as const) {
    star(ctx, x, y, s);
  }
}

/** Old paint: flecks lost to the plaster, a sun-bleached haze over everything. */
function weather(ctx: CanvasRenderingContext2D, r: () => number): void {
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.6})`;
    const s = 1 + r() * 4;
    ctx.fillRect(r() * CW, r() * CH, s, s * (0.5 + r()));
  }
  for (let i = 0; i < 18; i++) {
    const x = r() * CW;
    const y = r() * CH;
    const rad = 40 + r() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(0,0,0,${0.12 + r() * 0.18})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.globalCompositeOperation = "source-over";
}

function graffitiTexture(): THREE.CanvasTexture {
  return canvasTexture(CW, CH, (ctx) => {
    const r = rng(2026);
    drawBackdrop(ctx, r);
    const letters = drawLetters(ctx);
    drawSmoke(ctx);
    drawCup(ctx);
    drawCigarette(ctx);
    drawLighter(ctx);
    drawCrown(ctx, letters[0]!.x - 40, 228);
    drawTags(ctx, letters);
    weather(ctx, r);
  });
}

/** A tin-shade bulb on a bracket above the piece, so it reads at night too. */
function WallLamp({ x, y, z }: { x: number; y: number; z: number }) {
  const light = useRef<THREE.SpotLight>(null!);
  const bulb = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#ffc98a", emissiveIntensity: 0 }), []);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.4, z - 0.25);
    return o;
  }, [x, z]);
  useFrame(() => {
    const lamps = envState.lighting.lamps;
    bulb.emissiveIntensity = 0.2 + lamps * 7;
    const on = lamps > 0.02;
    light.current.visible = on;
    light.current.intensity = lamps * 14;
  });
  return (
    <group>
      <primitive object={target} />
      <mesh position={[x, y + 0.1, z + 0.17]} castShadow>
        <boxGeometry args={[0.03, 0.03, 0.36]} />
        <meshStandardMaterial color="#3b3d40" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[x, y, z + 0.34]} castShadow>
        <coneGeometry args={[0.15, 0.12, 20, 1, true]} />
        <meshStandardMaterial color="#5d6a66" metalness={0.55} roughness={0.45} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[x, y - 0.06, z + 0.34]} material={bulb}>
        <sphereGeometry args={[0.04, 12, 10]} />
      </mesh>
      <spotLight ref={light} position={[x, y - 0.08, z + 0.36]} target={target} angle={1.05} penumbra={0.9} distance={5} decay={2} color="#ffc27a" intensity={0} visible={false} />
    </group>
  );
}

export function Graffiti({ plaster }: { plaster: PbrSet }) {
  const material = useMemo(() => {
    const normalMap = plaster.normalMap.clone();
    normalMap.repeat.set(PIECE_W / PLASTER_TILE_M, PIECE_H / PLASTER_TILE_M);
    normalMap.offset.set((PIECE_X - PIECE_W / 2 - WARUNG.minX) / PLASTER_TILE_M, (PIECE_Y - PIECE_H / 2) / PLASTER_TILE_M);
    normalMap.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map: graffitiTexture(),
      normalMap,
      roughness: 0.72,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }, [plaster.normalMap]);
  // The writer left their cans behind.
  const cans = useModel("spray_paint_bottles_02");
  const cans2 = useModel("spray_paint_bottles_02");
  const broom = useModel("plastic_broom");
  const wall = WARUNG.maxZ;
  return (
    <group>
      <primitive object={cans} position={[4.25, 0, wall + 0.16]} rotation={[0, 0.5, 0]} scale={1.1} />
      <primitive object={cans2} position={[6.35, 0, wall + 0.2]} rotation={[0, -0.9, 0]} scale={1.1} />
      {/* Leans into the wall (the model tilts towards −Z), clear of the cup. */}
      <primitive object={broom} position={[3.72, 0, wall + 0.29]} />
      <mesh position={[PIECE_X, PIECE_Y, wall + 0.004]} material={material} receiveShadow>
        <planeGeometry args={[PIECE_W, PIECE_H]} />
      </mesh>
      <WallLamp x={PIECE_X} y={2.62} z={wall} />
    </group>
  );
}
