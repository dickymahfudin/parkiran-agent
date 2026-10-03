// Per-character behaviour: turns the server's session state into a sequence of animation steps.
// Pure TypeScript (no three.js) so it can be unit tested and reused by both the placeholder and the rigged character.
import type { WorkKind } from "../../../../shared/src/tools.ts";
import { COUNTER, DESPAWN_POINT, SPAWN_POINT, WALK_SPEED, planPath, type SeatStyle, type Vec2 } from "../layout.ts";
import { rng } from "./identity.ts";

export type Clip =
  | "walk"
  | "standIdle"
  | "sitDown"
  | "standUp"
  | "sitIdle"
  | "type"
  | "think"
  | "smoke"
  | "sip"
  | "stretch"
  | "chat"
  | "frustrated"
  | "patPockets"
  | "lookAround"
  | "lightUp"
  | "drag"
  | "sigh"
  | "pocketCig"
  | "doze"
  | "buy"
  | "stubOut"
  | "closeLaptop"
  | "wave"
  | "phone"
  /** Walking behind a food cart, hands on its handles (street vendors). */
  | "push";

export type NeedKind = "permission" | "question" | "input";

export type Target =
  | { kind: "seated"; activity: "work"; work: WorkKind }
  | { kind: "seated"; activity: "idle" }
  | { kind: "seated"; activity: "doze" }
  | { kind: "needs"; need: NeedKind }
  | { kind: "warung" }
  | { kind: "gone" };

export interface Outcome {
  kind: "approved" | "answered" | "denied" | "failure";
  at: number;
}

export interface Home {
  point: Vec2;
  yaw: number;
  node: string;
  /** Null for a standing spot (no seat free). */
  seat: { hip: readonly [number, number, number]; style: SeatStyle } | null;
}

export interface PropState {
  laptop: "open" | "closed" | "none";
  /** "mouth": lit and parked in the lips while both hands work. */
  cigarette: "none" | "unlit" | "lit" | "mouth";
  lighter: boolean;
  flame: boolean;
  cup: boolean;
  bubble: NeedKind | null;
  zzz: boolean;
  /** Scrolling a phone (idle). */
  phone: boolean;
  /** Check badge over the head while stretching after a finished turn. */
  done: boolean;
}

export type Reaction = "failure" | "done" | "wave";

export interface Frame {
  visible: boolean;
  x: number;
  z: number;
  yaw: number;
  /** 0 standing … 1 seated. */
  sit: number;
  seatY: number;
  seatStyle: SeatStyle | null;
  clip: Clip;
  clipTime: number;
  prevClip: Clip | null;
  prevClipTime: number;
  /** Weight of `clip` against `prevClip` (crossfade). */
  blend: number;
  typingRate: number;
  walkSpeed: number;
  /** Head turn (rad, + towards +yaw) while chatting with a neighbour; 0 otherwise. */
  look: number;
  props: PropState;
}

type Posture = "offstage" | "standing" | "seated";

type Step =
  | { type: "walk"; path: Vec2[]; index: number }
  | { type: "turn"; yaw: number; duration: number }
  | { type: "clip"; clip: Clip; duration: number; loop: boolean; props?: Partial<PropState>; propsEnd?: Partial<PropState>; posture?: Posture }
  | { type: "spawn" }
  | { type: "vanish" };

export const CROSSFADE_S = 0.3;
// Calm loops end as soon as the target changes; gestures (sit, stand, light up, sigh...) always finish.
const INTERRUPTIBLE: ReadonlySet<Clip> = new Set([
  "sitIdle", "standIdle", "type", "think", "smoke", "sip", "stretch", "chat", "patPockets", "lookAround", "doze", "phone",
]);
const TYPING_RATE: Record<WorkKind, number> = { think: 0.8, read: 0.45, bash: 1.7, edit: 1.05, web: 0.6, agent: 0.4, other: 1 };
// Durations of the rigged sitDown / standUp / frustrated clips (clips.json).
const SIT_S = 1.29;
const THINK_S = 6.667;
/** A cigarette left in the lips while working burns down after this long. */
const MOUTH_CIGARETTE_S = 240;
const STAND_S = 1.04;
const FRUSTRATED_S = 2.42;
/** Length of the phone idle loop (clips.json). */
const PHONE_S = 12;
const STRETCH_S = 3.2;
const WAVE_S = 2.0;
const CHAT_S = 2.917;
/** Furthest the head turns towards a chatting neighbour. */
const LOOK_MAX = 1.0;

const sameTarget = (a: Target | null, b: Target): boolean => {
  if (a === null || a.kind !== b.kind) return false;
  if (a.kind === "seated" && b.kind === "seated") {
    if (a.activity !== b.activity) return false;
    // Thinking has its own clip; the other tool kinds only change the typing rate.
    return a.activity !== "work" || b.activity !== "work" || (a.work === "think") === (b.work === "think");
  }
  if (a.kind === "needs" && b.kind === "needs") return a.need === b.need;
  return true;
};

export interface BrainOptions {
  seed: number;
  home: Home;
  /** Start already at home (page load) instead of walking in from the street. */
  atHome: boolean;
  /** Initial target, used to pick the starting posture when `atHome`. */
  target: Target;
}

export class Brain {
  private readonly random: () => number;
  private home: Home;
  /** The seat sat on, or about to be: home, or a warung stool on a coffee break. */
  private perch: Home;
  /** Free warung stool to drink the coffee on (compaction), handed out by the scene. */
  private visit: Home | null = null;
  private posture: Posture;
  private x: number;
  private z: number;
  private yaw: number;
  private sit = 0;
  private step: Step | null = null;
  private stepTime = 0;
  private queue: Step[] = [];
  private target: Target | null = null;
  private targetChangedAt = 0;
  private lastOutcomeAt = 0;
  private clip: Clip = "standIdle";
  private clipTime = 0;
  private prevClip: Clip | null = null;
  private prevClipTime = 0;
  private blend = 1;
  private typingRate = 1;
  private readonly props: PropState = { laptop: "closed", cigarette: "none", lighter: false, flame: false, cup: false, bubble: null, zzz: false, phone: false, done: false };
  private pendingReactions: Step[] = [];
  /** Where the neighbour sits while the two of them chat (decided per pair by the scene), else null. */
  private chatWith: Vec2 | null = null;
  /** Walked in and not sat down at home yet; `arrived` reports the moment it does, once. */
  private arriving = false;
  private arrived = false;
  private mouthTime = 0;
  /** True once the character has walked off after leaving. */
  done = false;

  constructor(opts: BrainOptions) {
    this.random = rng(opts.seed ^ 0x9e3779b9);
    this.home = opts.home;
    this.perch = opts.home;
    if (opts.atHome && opts.target.kind !== "gone") {
      const seated = opts.home.seat !== null && opts.target.kind !== "needs" && opts.target.kind !== "warung";
      this.posture = seated ? "seated" : "standing";
      [this.x, this.z] = opts.home.point;
      this.yaw = opts.home.yaw;
      this.sit = seated ? 1 : 0;
      this.props.laptop = seated ? "open" : "closed";
      this.clip = seated ? "sitIdle" : "standIdle";
    } else {
      this.posture = "offstage";
      [this.x, this.z] = SPAWN_POINT;
      this.yaw = Math.PI;
    }
  }

  /** Jump straight to the target's resting state (after the tab was hidden for a long time). */
  settle(): void {
    const t = this.target;
    this.queue = [];
    this.step = null;
    this.pendingReactions = [];
    if (t === null) return;
    if (t.kind === "gone") {
      this.done = true;
      return;
    }
    // On a coffee break the cup has long been bought: sit with it on the warung stool, else at home.
    const place = t.kind === "warung" ? (this.visit ?? this.home) : this.home;
    const seated = place.seat !== null && (t.kind === "seated" || t.kind === "warung");
    this.perch = place;
    [this.x, this.z] = place.point;
    this.yaw = place.yaw;
    this.posture = seated ? "seated" : "standing";
    this.sit = seated ? 1 : 0;
    this.props.laptop = seated && t.kind === "seated" ? "open" : "closed";
    this.props.cup = t.kind === "warung";
    this.props.phone = false;
    this.props.lighter = false;
    this.props.flame = false;
    this.props.zzz = false;
    this.props.bubble = null;
    this.props.done = false;
    this.setClip(seated ? "sitIdle" : "standIdle");
    this.blend = 1;
  }

  setHome(home: Home): void {
    if (this.perch === this.home) this.perch = home;
    this.home = home;
  }

  /** The warung stool this person may drink their coffee on; a change re-plans a coffee break under way. */
  setVisit(place: Home | null): void {
    if (place === this.visit) return;
    this.visit = place;
    if (this.target?.kind === "warung" && this.props.cup) this.interrupt([]);
  }

  /** Chat with the neighbour sitting at `at` (both idle, their chat window open), or stop with null. */
  setChat(at: Vec2 | null): void {
    if ((at === null) === (this.chatWith === null)) {
      this.chatWith = at;
      return;
    }
    this.chatWith = at;
    if (this.target?.kind === "seated" && this.target.activity === "idle") this.interrupt([]);
  }

  /** True once, right after the person walked in and sat down at home (to greet the neighbours). */
  takeArrival(): boolean {
    const a = this.arrived;
    this.arrived = false;
    return a;
  }

  /** `outcome` is the session's last need outcome; it decides how a "needs" episode ends. */
  setTarget(target: Target, outcome: Outcome | null, now: number): void {
    if (target.kind === "seated" && target.activity === "work") this.typingRate = TYPING_RATE[target.work];
    if (sameTarget(this.target, target)) return;
    const previous = this.target;
    this.target = target;
    this.targetChangedAt = now;

    if (previous?.kind === "needs" && target.kind !== "needs" && this.posture === "standing") {
      const resolved = outcome && outcome.at > this.lastOutcomeAt ? outcome : null;
      if (resolved) this.lastOutcomeAt = resolved.at;
      this.interrupt(this.exitNeeds(resolved?.kind ?? "denied", previous.need));
      return;
    }
    this.interrupt([]);
  }

  /**
   * One-shot reaction that plays without changing the target: a facepalm on a failure, a wave at a neighbour, and a
   * stretch with a check badge when a turn is done (only seated at home: after a denied permission it would cut into
   * the sigh).
   */
  react(kind: Reaction): void {
    if (this.posture === "offstage" || this.target?.kind === "gone") return;
    const queued = (clip: Clip) => this.pendingReactions.some((s) => s.type === "clip" && s.clip === clip);
    if (kind === "failure") this.pendingReactions.push(this.clipStep("frustrated", FRUSTRATED_S));
    else if (kind === "wave") {
      if (!queued("wave")) this.pendingReactions.push(this.clipStep("wave", WAVE_S));
    } else if (this.posture === "seated" && this.perch === this.home && this.target?.kind === "seated" && !queued("stretch")) {
      this.pendingReactions.push(this.clipStep("stretch", STRETCH_S, { props: { done: true }, propsEnd: { done: false } }));
    }
  }

  private clipStep(clip: Clip, duration: number, extra: Partial<Extract<Step, { type: "clip" }>> = {}): Step {
    return { type: "clip", clip, duration, loop: false, ...extra };
  }

  private exitNeeds(outcome: Outcome["kind"], need: NeedKind): Step[] {
    const sitBack = this.sitBack();
    if (outcome === "denied") {
      return [
        this.clipStep("sigh", 1.6, { props: { bubble: null } }),
        this.clipStep("pocketCig", 1.1, { propsEnd: { cigarette: "none" } }),
        ...sitBack,
      ];
    }
    if (need === "question") return [this.clipStep("standIdle", 0.6, { props: { bubble: null } }), ...sitBack];
    return [
      this.clipStep("lightUp", 1.8, { props: { bubble: null, lighter: true, flame: true }, propsEnd: { lighter: false, flame: false, cigarette: "lit" } }),
      this.clipStep("drag", 1.5),
      ...sitBack,
    ];
  }

  /** Where a target sends someone on foot; null when it does not (they stop where they are). */
  private destinationFor(t: Target): Vec2 | null {
    if (t.kind === "seated") return this.home.point;
    if (t.kind === "warung") return this.props.cup ? (this.visit ?? this.home).point : COUNTER.point;
    return null;
  }

  /**
   * Replace the plan. Calm loops and walks end now (the new plan starts from here); gestures finish first. A walk that
   * still leads where the new target wants carries on: sessions change state many times while someone walks in, and
   * re-planning each time made them turn back to the last waypoint.
   */
  private interrupt(next: Step[]): void {
    this.queue = next;
    const s = this.step;
    if (s?.type === "walk" && next.length === 0 && this.target) {
      const end = s.path[s.path.length - 1]!;
      const dest = this.destinationFor(this.target);
      if (dest && Math.hypot(end[0] - dest[0], end[1] - dest[1]) < 0.05) return;
    }
    if (s && (s.type === "walk" || s.type === "turn" || (s.type === "clip" && INTERRUPTIBLE.has(s.clip)))) this.endStep();
  }

  private setClip(clip: Clip): void {
    if (clip === this.clip) return;
    this.prevClip = this.clip;
    this.prevClipTime = this.clipTime;
    this.clip = clip;
    this.clipTime = 0;
    this.blend = 0;
  }

  private endStep(): void {
    const s = this.step;
    if (s?.type === "clip") {
      if (s.propsEnd) Object.assign(this.props, s.propsEnd);
      if (s.posture) this.posture = s.posture;
      if (s.clip === "sitDown" && this.arriving && this.perch === this.home) {
        this.arriving = false;
        this.arrived = true;
      }
    }
    this.step = null;
  }

  private startStep(s: Step): void {
    this.step = s;
    this.stepTime = 0;
    switch (s.type) {
      case "spawn":
        [this.x, this.z] = SPAWN_POINT;
        this.posture = "standing";
        this.arriving = true;
        break;
      case "walk":
        this.setClip("walk");
        break;
      case "turn":
        this.setClip(this.posture === "seated" ? "sitIdle" : "standIdle");
        break;
      case "clip":
        if (s.props) Object.assign(this.props, s.props);
        this.setClip(s.clip);
        break;
      case "vanish":
        this.done = true;
        break;
    }
  }

  /** Leaving the seat or spot goes back out the way in (its own node), not via whatever node happens to be nearest. */
  private pathTo(to: Vec2, toNode: string): Vec2[] {
    const atPerch = Math.hypot(this.x - this.perch.point[0], this.z - this.perch.point[1]) < 0.2;
    return planPath([this.x, this.z], to, toNode, atPerch ? this.perch.node : undefined);
  }

  private goHome(): Step[] {
    const steps: Step[] = [{ type: "walk", path: this.pathTo(this.home.point, this.home.node), index: 1 }, { type: "turn", yaw: this.home.yaw, duration: 0.45 }];
    this.perch = this.home;
    if (this.home.seat) steps.push(this.clipStep("sitDown", SIT_S, { posture: "seated", propsEnd: { laptop: "open" } }));
    return steps;
  }

  /** Back onto the seat after standing up for something: walk back first if this happened on the way in. */
  private sitBack(): Step[] {
    if (!this.home.seat) return [];
    const fromHome = Math.hypot(this.x - this.home.point[0], this.z - this.home.point[1]);
    if (fromHome >= 0.2) return this.goHome();
    this.perch = this.home;
    return [...this.settleOn(this.home, fromHome), this.clipStep("sitDown", SIT_S, { props: { laptop: "closed" }, posture: "seated", propsEnd: { laptop: "open" } })];
  }

  /** The last few centimetres to a place's spot and the turn to face its way, whichever are still missing. */
  private settleOn(place: Home, from: number): Step[] {
    const steps: Step[] = [];
    if (from > 0.01) steps.push({ type: "walk", path: [[this.x, this.z], place.point], index: 1 });
    if (Math.abs(angleDiff(this.yaw, place.yaw)) > 0.02) steps.push({ type: "turn", yaw: place.yaw, duration: 0.45 });
    return steps;
  }

  private standUp(extra: Partial<PropState> = {}): Step {
    return this.clipStep("standUp", STAND_S, { props: { laptop: "closed", zzz: false, phone: false, ...extra }, posture: "standing" });
  }

  private lightIfNeeded(): Step[] {
    if (this.props.cigarette === "lit" || this.props.cigarette === "mouth") return [];
    return [this.clipStep("lightUp", 1.4, { props: { cigarette: "unlit", lighter: true, flame: true }, propsEnd: { lighter: false, flame: false, cigarette: "lit" } })];
  }

  /**
   * Idle (waiting for the user): shut the laptop, light up, then scroll the phone with a cigarette in the other hand.
   * Standing (lot full), the left hand carries the laptop, so the cigarette stays in the lips. When work comes back
   * the phone goes away and the cigarette moves to the lips, freeing both hands for the keyboard.
   */
  private idleActivity(): Step[] {
    const seated = this.posture === "seated";
    return [
      ...(seated && this.props.laptop === "open" ? [this.clipStep("closeLaptop", 1.0, { propsEnd: { laptop: "closed" } })] : []),
      ...this.lightIfNeeded(),
      this.clipStep("phone", PHONE_S, { loop: true, props: { phone: true, cigarette: seated ? "lit" : "mouth" }, propsEnd: { phone: false, cigarette: "mouth" } }),
    ];
  }

  /** Two idle neighbours talking: laptop shut, phone away, heads turned to each other (`look`). */
  private chatActivity(): Step[] {
    return [
      ...(this.props.laptop === "open" ? [this.clipStep("closeLaptop", 1.0, { propsEnd: { laptop: "closed" } })] : []),
      this.clipStep("chat", CHAT_S * 4, { loop: true, props: { phone: false } }),
    ];
  }

  /**
   * Compaction is a coffee break: with the cup bought, sit and drink it on a free warung stool, else back on one's own
   * seat (laptop shut), else standing at one's spot, until the session is back.
   */
  private coffeeBreak(): Step[] {
    const place = this.visit ?? this.home;
    if (this.posture === "seated") {
      if (this.perch !== place) return [this.standUp()];
      const shut = this.props.laptop === "open" ? [this.clipStep("closeLaptop", 1.0, { propsEnd: { laptop: "closed" } })] : [];
      return [...shut, this.clipStep("sip", 3.5), this.clipStep("sitIdle", 5)];
    }
    const from = Math.hypot(this.x - place.point[0], this.z - place.point[1]);
    if (from >= 0.2) return [{ type: "walk", path: this.pathTo(place.point, place.node), index: 1 }, { type: "turn", yaw: place.yaw, duration: 0.45 }];
    if (!place.seat) return [...this.settleOn(place, from), this.clipStep("sip", 3.5), this.clipStep("standIdle", 4)];
    this.perch = place;
    return [...this.settleOn(place, from), this.clipStep("sitDown", SIT_S, { posture: "seated" })];
  }

  private plan(): Step[] {
    const t = this.target;
    if (t === null) return [this.clipStep(this.posture === "seated" ? "sitIdle" : "standIdle", 1, { loop: true })];

    if (t.kind === "gone") {
      if (this.posture === "offstage") return [{ type: "vanish" }];
      const out: Step[] = [];
      if (this.posture === "seated") {
        if (this.props.cigarette !== "none") out.push(this.clipStep("stubOut", 1.2, { props: { cigarette: "lit" }, propsEnd: { cigarette: "none" } }));
        if (this.props.laptop === "open") out.push(this.clipStep("closeLaptop", 1.0, { propsEnd: { laptop: "closed" } }));
        out.push(this.standUp());
      }
      out.push({ type: "walk", path: this.pathTo(DESPAWN_POINT, "street"), index: 1 }, { type: "vanish" });
      return out;
    }

    if (this.posture === "offstage") return [{ type: "spawn" }, ...this.goHome()];

    if (t.kind === "warung") {
      if (this.props.cup) return this.coffeeBreak();
      if (this.posture === "seated") return [this.standUp()];
      const atCounter = Math.hypot(this.x - COUNTER.point[0], this.z - COUNTER.point[1]) < 0.2;
      if (!atCounter) return [{ type: "walk", path: this.pathTo(COUNTER.point, COUNTER.node), index: 1 }, { type: "turn", yaw: COUNTER.yaw, duration: 0.4 }];
      return [this.clipStep("buy", 3, { propsEnd: { cup: true } })];
    }

    if (t.kind === "needs") {
      if (this.posture === "seated") return [this.standUp({ cigarette: "unlit", bubble: t.need })];
      this.props.bubble = t.need;
      // Whatever was smoked before has gone out: this is the one that needs a light.
      this.props.cigarette = "unlit";
      return [this.clipStep("patPockets", 2.4), this.clipStep("lookAround", 2.8)];
    }

    // Seated targets. Off a borrowed warung stool first.
    if (this.posture === "seated" && this.perch !== this.home) return [this.standUp()];
    const fromHome = Math.hypot(this.x - this.home.point[0], this.z - this.home.point[1]);
    const atHome = fromHome < 0.2;
    if (this.posture === "standing" && this.home.seat) {
      if (!atHome) return this.goHome();
      // A status change can cut the walk or the turn short: finish both, or the person sits down facing sideways
      // in front of the seat instead of on it.
      this.perch = this.home;
      return [...this.settleOn(this.home, fromHome), this.clipStep("sitDown", SIT_S, { posture: "seated", propsEnd: { laptop: "open" } })];
    }
    if (this.posture === "standing" && !atHome) return this.goHome();
    if (!this.home.seat) {
      // Lot full: stands with the laptop under the arm.
      if (t.activity === "idle") return this.idleActivity();
      return [this.clipStep("standIdle", 4, { loop: true })];
    }

    if (t.activity === "doze") {
      const shut = this.props.laptop === "open" ? [this.clipStep("closeLaptop", 1.0, { propsEnd: { laptop: "closed" } })] : [];
      return [...shut, this.clipStep("doze", 4, { loop: true, props: { zzz: true, cigarette: "none", phone: false } })];
    }
    if (this.props.zzz) this.props.zzz = false;
    if (t.activity === "idle") {
      const activity = this.chatWith ? this.chatActivity() : this.idleActivity();
      return this.props.cup ? [this.clipStep("sip", 3.5, { propsEnd: { cup: false } }), ...activity] : activity;
    }
    // Work from here on: laptop open, both hands free.
    if (this.props.laptop !== "open") this.props.laptop = "open";
    if (this.props.cup) return [this.clipStep("sip", 3.5, { propsEnd: { cup: false } })];
    // Thinking: one hand on the keyboard, the other with a cigarette; when real work starts it moves to the lips.
    if (t.activity === "work" && t.work === "think") {
      return [...this.lightIfNeeded(), this.clipStep("think", THINK_S, { loop: true, props: { cigarette: "lit" }, propsEnd: { cigarette: "mouth" } })];
    }
    return [this.clipStep("type", 4, { loop: true })];
  }

  update(dt: number, now: number): Frame {
    void now;
    this.clipTime += dt;
    this.prevClipTime += dt;
    this.blend = Math.min(1, this.blend + dt / CROSSFADE_S);

    for (let guard = 0; guard < 8; guard++) {
      if (this.step === null) {
        if (this.pendingReactions.length > 0 && (this.posture === "seated" || this.posture === "standing")) {
          this.startStep(this.pendingReactions.shift()!);
        } else {
          if (this.queue.length === 0) this.queue = this.plan();
          const next = this.queue.shift();
          if (!next) break;
          this.startStep(next);
        }
      }
      const s = this.step;
      if (s === null || this.done) break;
      this.stepTime += dt;

      if (s.type === "walk") {
        let budget = WALK_SPEED * dt;
        while (budget > 0 && s.index < s.path.length) {
          const [tx, tz] = s.path[s.index]!;
          const dx = tx - this.x;
          const dz = tz - this.z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-4) {
            s.index++;
            continue;
          }
          const move = Math.min(budget, d);
          this.x += (dx / d) * move;
          this.z += (dz / d) * move;
          this.yaw = turnTowards(this.yaw, Math.atan2(dx, dz), dt * 6);
          budget -= move;
          if (move >= d) s.index++;
        }
        if (s.index >= s.path.length) this.endStep();
        else break;
      } else if (s.type === "turn") {
        this.yaw = turnTowards(this.yaw, s.yaw, dt * 5);
        if (this.stepTime >= s.duration) {
          this.yaw = s.yaw;
          this.endStep();
        } else break;
      } else if (s.type === "clip") {
        if (s.clip === "sitDown" || s.clip === "standUp") {
          // The clip moves the hips onto the seat; the feet (root) stay where they are.
          const k = Math.min(1, this.stepTime / s.duration);
          const e = k * k * (3 - 2 * k);
          this.sit = s.clip === "sitDown" ? e : 1 - e;
        }
        const finished = this.stepTime >= s.duration;
        // Target changes end calm steps in interrupt(); here only a pending reaction (tool failure) cuts in.
        const loopShouldEnd = (s.loop || INTERRUPTIBLE.has(s.clip)) && this.pendingReactions.length > 0;
        if ((finished && !s.loop) || loopShouldEnd) this.endStep();
        else if (finished && s.loop) {
          this.stepTime = 0;
          break;
        } else break;
      } else {
        this.endStep();
      }
    }
    this.mouthTime = this.props.cigarette === "mouth" ? this.mouthTime + dt : 0;
    if (this.mouthTime > MOUTH_CIGARETTE_S) this.props.cigarette = "none";
    if (this.posture === "seated") this.sit = 1;
    if (this.posture !== "seated" && !(this.step?.type === "clip" && (this.step.clip === "sitDown" || this.step.clip === "standUp"))) this.sit = 0;
    let look = 0;
    if (this.clip === "chat" && this.chatWith) {
      const toward = Math.atan2(this.chatWith[0] - this.x, this.chatWith[1] - this.z);
      look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, angleDiff(this.yaw, toward)));
    }

    return {
      visible: this.posture !== "offstage" && !this.done,
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      sit: this.sit,
      seatY: this.perch.seat?.hip[1] ?? 0,
      seatStyle: this.perch.seat?.style ?? null,
      clip: this.clip,
      clipTime: this.clipTime,
      prevClip: this.prevClip,
      prevClipTime: this.prevClipTime,
      blend: this.blend,
      typingRate: this.typingRate,
      walkSpeed: WALK_SPEED,
      look,
      props: { ...this.props },
    };
  }

  /** For tests and debugging. */
  get state(): { posture: Posture; step: string | null; target: Target | null; x: number; z: number } {
    const step = this.step === null ? null : this.step.type === "clip" ? this.step.clip : this.step.type;
    return { posture: this.posture, step, target: this.target, x: this.x, z: this.z };
  }

  get changedAt(): number {
    return this.targetChangedAt;
  }
}

/** Signed shortest turn from `current` to `target`, in (−π, π]. */
function angleDiff(current: number, target: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function turnTowards(current: number, target: number, maxStep: number): number {
  const diff = angleDiff(current, target);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
