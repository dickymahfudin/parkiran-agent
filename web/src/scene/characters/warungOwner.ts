// Pak Joko behind the warung counter: a small routine of his own (smoke, a sip, his phone, a look around), serving
// whoever comes to buy a kopi, and a nap on his stool late at night. Pure: drives the shared character via frames.
// What he smokes follows the viewer's habits setting: his kretek, a vape (same clip, the device in his fist), or nothing.
import { SIT_ROOT_BACK, STOOL_Y, type Vec2 } from "../layout.ts";
import { CROSSFADE_S, type Clip, type Frame, type PropState } from "./brain.ts";
import { SIT_S, STAND_S } from "./clips.ts";
import { rng, type Habit } from "./identity.ts";

/** Where he stands: behind the counter, facing the serving window (−X). */
export const OWNER_SPOT: Vec2 = [4.45, -3.95];
export const OWNER_YAW = -Math.PI / 2;
/** His stool right behind him, so sitting down needs no step: hips this far back from where his feet are. */
export const OWNER_STOOL: [number, number, number] = [OWNER_SPOT[0] + SIT_ROOT_BACK, STOOL_Y, OWNER_SPOT[1]];

export interface Activity {
  clip: Clip;
  seconds: [number, number];
  props?: Partial<PropState>;
}

const SMOKE: Activity = { clip: "smoke", seconds: [14, 22], props: { cigarette: "lit" } };
const SOBER: readonly Activity[] = [
  { clip: "sip", seconds: [4, 4], props: { cup: true } },
  { clip: "phone", seconds: [12, 24], props: { phone: true } },
  { clip: "lookAround", seconds: [5, 10] },
];
/** What he does when nobody is buying, picked at random; plain standing in between. A non-smoker skips the smoke. */
export const routineFor = (habit: Habit): readonly Activity[] => (habit === "none" ? SOBER : [SMOKE, ...SOBER]);
const IDLE_S: [number, number] = [6, 14];

const NO_PROPS: PropState = {
  laptop: "none",
  cigarette: "none",
  lighter: false,
  flame: false,
  cup: false,
  bubble: null,
  zzz: false,
  phone: false,
  done: false,
};

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
  private habit: Habit;

  constructor(seed: number, habit: Habit = "kretek") {
    this.random = rng(seed);
    this.habit = habit;
    this.left = this.span(IDLE_S);
  }

  /** The habits setting changed: a smoke under way ends at once when he no longer smokes. */
  setHabit(habit: Habit): void {
    if (habit === this.habit) return;
    this.habit = habit;
    if (habit === "none" && this.props.cigarette !== "none") this.play("standIdle", this.span(IDLE_S));
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
        const routine = routineFor(this.habit);
        const a = routine[Math.floor(this.random() * routine.length)]!;
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
