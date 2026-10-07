import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CH, CW, SHOUT, WORD, blockShade, paintGraffiti, type Gradient2D, type Layer2D, type Painter2D } from "./graffiti.ts";

/** A 2D context that only remembers what was asked of it: enough to paint the piece without a canvas. */
function recorder(log: string[]): Painter2D {
  const gradient: Gradient2D = { addColorStop: () => {} };
  const note = (name: string) => () => void log.push(name);
  return {
    font: "",
    textAlign: "start",
    lineJoin: "miter",
    lineCap: "butt",
    lineWidth: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalCompositeOperation: "source-over",
    save: note("save"),
    restore: note("restore"),
    translate: note("translate"),
    rotate: note("rotate"),
    scale: note("scale"),
    transform: note("transform"),
    beginPath: note("beginPath"),
    closePath: note("closePath"),
    moveTo: note("moveTo"),
    lineTo: note("lineTo"),
    bezierCurveTo: note("bezierCurveTo"),
    quadraticCurveTo: note("quadraticCurveTo"),
    arc: note("arc"),
    ellipse: note("ellipse"),
    roundRect: note("roundRect"),
    fill: note("fill"),
    stroke: note("stroke"),
    fillRect: note("fillRect"),
    fillText: (text) => void log.push(`fillText:${text}`),
    strokeText: (text) => void log.push(`strokeText:${text}`),
    measureText: (text) => ({ width: text.length * 200 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    drawImage: (image) => void log.push(`drawImage:${(image as { name: string }).name}`),
  };
}

describe("graffiti painter", () => {
  test("paints the piece headless: every letter, the shout, and the layers composited back", () => {
    const log: string[] = [];
    const layers: string[][] = [];
    const newLayer = (): Layer2D => {
      const own: string[] = [];
      layers.push(own);
      return { ctx: recorder(own), image: { name: `layer${layers.length}` } };
    };
    expect(() => paintGraffiti(recorder(log), newLayer)).not.toThrow();
    for (const ch of WORD) {
      expect(log).toContain(`fillText:${ch}`);
      expect(log).toContain(`strokeText:${ch}`);
    }
    expect(log).toContain(`fillText:${SHOUT}`);
    // Four 3D blocks (letters, cup, cigarette, lighter), each a fill layer plus two bevel rims drawn into it.
    expect(layers.length).toBe(4 * 3);
    expect(log.filter((e) => e.startsWith("drawImage:")).length).toBe(4);
    expect(layers.flat().filter((e) => e.startsWith("drawImage:")).length).toBe(8);
    // Every save has its restore, so nothing leaks into what is painted next.
    expect(log.filter((e) => e === "save").length).toBe(log.filter((e) => e === "restore").length);
    // Weathering punches holes and then puts the context back to normal painting.
    expect(log.filter((e) => e === "fillRect").length).toBeGreaterThan(2600);
    expect(CW / CH).toBe(2);
  });

  test("block shades match what THREE.Color would paint", () => {
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      expect(blockShade(t)).toBe(new THREE.Color("#5d2c8f").lerp(new THREE.Color("#25103f"), t).getStyle());
    }
  });
});
