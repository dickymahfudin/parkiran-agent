// Pak Joko behind the warung counter: a small routine of his own (smoke, a sip, his phone, a look around), serving
// whoever comes to buy a kopi, and a nap on his stool late at night. Pure: drives the shared character via frames.
import { SIT_ROOT_BACK, type Vec2 } from "../layout.ts";
import { CROSSFADE_S, type Clip, type Frame, type PropState } from "./brain.ts";
import { rng } from "./identity.ts";

/** Where he stands: behind the counter, facing the serving window (−X). */
export const OWNER_SPOT: Vec2 = [4.45, -3.95];
export const OWNER_YAW = -Math.PI / 2;
/** His stool right behind him, so sitting down needs no step: hips this far back from where his feet are. */
export const OWNER_STOOL: [number, number, number] = [OWNER_SPOT[0] + SIT_ROOT_BACK, 0.445, OWNER_SPOT[1]];

const SIT_S = 1.29;
const STAND_S = 1.04;

interface Activity {
  clip: Clip;
  seconds: [number, number];
  props?: Partial<PropState>;
}

/** What he does when nobody is buying, picked at random; plain standing in between. */
const ROUTINE: readonly Activity[] = [
  { clip: "smoke", seconds: [14, 22], props: { cigarette: "lit" } },
  { clip: "sip", seconds: [4, 4], props: { cup: true } },
  { clip: "phone", seconds: [12, 24], props: { phone: true } },
  { clip: "lookAround", seconds: [5, 10] },
];
const IDLE_S: [number, number] = [6, 14];

const NO_PROPS: PropState = { laptop: "none", cigarette: "none", lighter: false, flame: false, cup: false, bubble: null, zzz: false, phone: false, done: false };

type Mode = "routine" | "serve" | "night";

export class WarungOwner {
  private readonly random: () => number;
  private clip: Clip = "standIdle";
  private clipTime = 0;
  private prevClip: Clip | null = null;
  private prevClipTime = 0;
  private blend = 1;
  private left = 0;
  private sit = 0;
  /** Sitting down or getting up: seconds into it, or null. */
  private moving: { to: 0 | 1; t: number } | null = null;
  private mode: Mode = "routine";
  private serving = false;
  private night = false;
  private props: PropState = { ...NO_PROPS };

  constructor(seed: number) {
    this.random = rng(seed);
    this.left = this.span(IDLE_S);
  }

  /** Someone is buying at the window right now. */
  setServing(on: boolean): void {
    this.serving = on;
  }

  /** Late at night he naps on his stool (unless someone comes to buy). */
  setNight(on: boolean): void {
    this.night = on;
  }

  get activity(): { mode: Mode; clip: Clip; sit: number } {
    return { mode: this.mode, clip: this.clip, sit: this.sit };
  }

  private span([a, b]: [number, number]): number {
    return a + this.random() * (b - a);
  }

  private play(clip: Clip, seconds: number, props: Partial<PropState> = {}): void {
    if (clip !== this.clip) {
      this.prevClip = this.clip;
      this.prevClipTime = this.clipTime;
      this.clip = clip;
      this.clipTime = 0;
      this.blend = 0;
    }
    this.left = seconds;
    this.props = { ...NO_PROPS, ...props };
  }

  update(dt: number): Frame {
    this.clipTime += dt;
    this.prevClipTime += dt;
    this.blend = Math.min(1, this.blend + dt / CROSSFADE_S);
    this.left -= dt;

    const want: Mode = this.serving ? "serve" : this.night ? "night" : "routine";
    if (this.moving) {
      this.moving.t += dt;
      const k = Math.min(1, this.moving.t / (this.moving.to === 1 ? SIT_S : STAND_S));
      const e = k * k * (3 - 2 * k);
      this.sit = this.moving.to === 1 ? e : 1 - e;
      if (k >= 1) {
        this.moving = null;
        this.left = 0;
      }
    } else if (want === "night" && this.sit < 1) {
      this.mode = "night";
      this.moving = { to: 1, t: 0 };
      this.play("sitDown", SIT_S);
    } else if (want !== "night" && this.sit > 0) {
      this.mode = want;
      this.moving = { to: 0, t: 0 };
      this.play("standUp", STAND_S);
    } else if (want !== this.mode || this.left <= 0) {
      this.mode = want;
      if (want === "night") this.play("doze", 600, { zzz: true });
      else if (want === "serve") this.play("buy", 600, { cup: true });
      else if (this.clip !== "standIdle") this.play("standIdle", this.span(IDLE_S));
      else {
        const a = ROUTINE[Math.floor(this.random() * ROUTINE.length)]!;
        this.play(a.clip, this.span(a.seconds), a.props);
      }
    }

    return {
      visible: true,
      x: OWNER_SPOT[0],
      z: OWNER_SPOT[1],
      yaw: OWNER_YAW,
      sit: this.sit,
      seatY: OWNER_STOOL[1],
      seatStyle: "stool",
      clip: this.clip,
      clipTime: this.clipTime,
      prevClip: this.prevClip,
      prevClipTime: this.prevClipTime,
      blend: this.blend,
      typingRate: 1,
      walkSpeed: 0,
      look: 0,
      props: { ...this.props },
    };
  }
}

/** Late night by the scene clock: from 23:00 until 04:30. */
export const isOwnerNight = (hour: number): boolean => hour >= 23 || hour < 4.5;
