import { describe, expect, test } from "bun:test";
import { COUNTER, SEAT_PLACES } from "../layout.ts";
import { Brain, type Clip, type Frame, type Home, type Target } from "./brain.ts";

const seat = SEAT_PLACES["bench-1a"]!;
const home: Home = { point: seat.approach, yaw: seat.yaw, node: seat.node, seat: { hip: seat.hip, style: seat.style } };
const WORK: Target = { kind: "seated", activity: "work", work: "bash" };
const stoolSeat = SEAT_PLACES["stool-2"]!;
const stool: Home = { point: stoolSeat.approach, yaw: stoolSeat.yaw, node: stoolSeat.node, seat: { hip: stoolSeat.hip, style: stoolSeat.style } };

function runFor(brain: Brain, seconds: number, onFrame?: (f: Frame) => void): { clips: Set<Clip>; last: Frame } {
  const clips = new Set<Clip>();
  let last!: Frame;
  for (let t = 0; t < seconds; t += 1 / 30) {
    last = brain.update(1 / 30, 0);
    clips.add(last.clip);
    onFrame?.(last);
  }
  return { clips, last };
}

function seatedBrain(target: Target = WORK): Brain {
  const b = new Brain({ seed: 42, home, atHome: true, target });
  b.setTarget(target, null, 0);
  runFor(b, 0.5);
  return b;
}

describe("Brain", () => {
  test("walks in from the street and sits down to work", () => {
    const b = new Brain({ seed: 1, home, atHome: false, target: WORK });
    b.setTarget(WORK, null, 0);
    const { clips, last } = runFor(b, 30);
    expect(clips.has("walk")).toBe(true);
    expect(clips.has("sitDown")).toBe(true);
    expect(b.state.posture).toBe("seated");
    expect(last).toMatchObject({ clip: "type", sit: 1, visible: true });
    expect(last.props.laptop).toBe("open");
    expect(Math.hypot(last.x - seat.approach[0], last.z - seat.approach[1])).toBeLessThan(0.01);
  });

  test("walking in while the session keeps changing state: never turns back, same route as a quiet arrival", () => {
    const walked = (flip: boolean) => {
      const b = new Brain({ seed: 1, home, atHome: false, target: WORK });
      b.setTarget(WORK, null, 0);
      let distance = 0;
      let prev: Frame | null = null;
      let t = 0;
      runFor(b, 30, (f) => {
        t += 1 / 30;
        // Thinking ↔ tool calls every 0.4 s, as the first seconds of a real session do.
        if (flip && Math.floor(t / 0.4) % 2 === 1) b.setTarget({ kind: "seated", activity: "work", work: "think" }, null, t);
        else if (flip) b.setTarget(WORK, null, t);
        if (prev?.visible && f.visible) distance += Math.hypot(f.x - prev.x, f.z - prev.z);
        prev = f;
      });
      return { distance, state: b.state.posture };
    };
    const quiet = walked(false);
    const busy = walked(true);
    expect(busy.state).toBe("seated");
    expect(busy.distance).toBeCloseTo(quiet.distance, 1);
  });

  test("starts seated on page load", () => {
    const b = seatedBrain();
    expect(b.state.posture).toBe("seated");
    expect(b.update(1 / 30, 0).clip).toBe("type");
  });

  test("needs korek: stands up with an unlit cigarette and a lighter bubble, pats pockets and looks around", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    const { clips, last } = runFor(b, 8);
    expect(b.state.posture).toBe("standing");
    expect(clips.has("standUp") && clips.has("patPockets") && clips.has("lookAround")).toBe(true);
    expect(last.props).toMatchObject({ cigarette: "unlit", bubble: "permission" });
  });

  test("approved: the lighter flame shows, the cigarette gets lit, sits back to work", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget(WORK, { kind: "approved", at: 2 }, 2);
    let flame = false;
    const { clips, last } = runFor(b, 8, (f) => (flame ||= f.props.flame));
    expect(flame).toBe(true);
    expect(clips.has("lightUp") && clips.has("drag") && clips.has("sitDown")).toBe(true);
    expect(last.props).toMatchObject({ cigarette: "lit", bubble: null });
    expect(last.clip).toBe("type");
  });

  test("denied: sighs, puts the cigarette back, sits down", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget(WORK, { kind: "denied", at: 2 }, 2);
    const { clips, last } = runFor(b, 8);
    expect(clips.has("sigh") && clips.has("pocketCig")).toBe(true);
    expect(clips.has("lightUp")).toBe(false);
    expect(last.props.cigarette).toBe("none");
    expect(b.state.posture).toBe("seated");
  });

  test("approved while still standing up: the bubble still clears, the cigarette gets lit, back to work", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    // The server batches events, so an answer can land inside the 1 s stand-up gesture.
    runFor(b, 0.5);
    b.setTarget(WORK, { kind: "approved", at: 2 }, 2);
    const { clips, last } = runFor(b, 12);
    expect(clips.has("standUp") && clips.has("lightUp") && clips.has("sitDown")).toBe(true);
    expect(last.props).toMatchObject({ bubble: null, cigarette: "lit" });
    expect(last.clip).toBe("type");
  });

  test("a need that comes and goes between two frames leaves no trace", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    b.setTarget(WORK, { kind: "approved", at: 2 }, 2);
    const { clips, last } = runFor(b, 6);
    expect(clips.has("standUp") || clips.has("lightUp")).toBe(false);
    expect(last.props.bubble).toBeNull();
    expect(last.clip).toBe("type");
  });

  test("input answered: no lighter, sits back down with the bubble gone", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "input" }, null, 1);
    runFor(b, 5);
    b.setTarget(WORK, { kind: "answered", at: 2 }, 2);
    const { clips, last } = runFor(b, 8);
    expect(clips.has("lightUp") || clips.has("drag")).toBe(false);
    expect(clips.has("sitDown")).toBe(true);
    expect(last.props).toMatchObject({ bubble: null });
    expect(b.state.posture).toBe("seated");
  });

  test("the turn fails while waiting: a sigh, not a light", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget({ kind: "seated", activity: "idle" }, { kind: "failure", at: 2 }, 2);
    let sat = false;
    let litBeforeSitting = false;
    const { clips } = runFor(b, 8, (f) => {
      sat ||= f.clip === "sitDown";
      if (!sat && f.clip === "lightUp") litBeforeSitting = true;
    });
    expect(clips.has("sigh") && clips.has("pocketCig")).toBe(true);
    // The idle smoke afterwards may light one; the exit itself must not.
    expect(litBeforeSitting).toBe(false);
    expect(b.state.posture).toBe("seated");
  });

  test("leaving while waiting for a light: no detour back to the seat", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget({ kind: "gone" }, { kind: "denied", at: 2 }, 2);
    const { clips } = runFor(b, 30);
    expect(clips.has("sigh")).toBe(true);
    expect(clips.has("sitDown")).toBe(false);
    expect(b.done).toBe(true);
  });

  test("compaction while waiting: walks to the warung without sitting down first", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget({ kind: "warung" }, { kind: "denied", at: 2 }, 2);
    let satBeforeBuying = false;
    let bought = false;
    runFor(b, 30, (f) => {
      bought ||= f.clip === "buy";
      if (!bought && f.clip === "sitDown") satBeforeBuying = true;
    });
    expect(bought).toBe(true);
    expect(satBeforeBuying).toBe(false);
  });

  test("re-seated while sitting: stands up and walks to the new seat instead of sliding over", () => {
    const b = seatedBrain();
    const hoodSeat = SEAT_PLACES["hood-1"]!;
    const hood: Home = { point: hoodSeat.approach, yaw: hoodSeat.yaw, node: hoodSeat.node, seat: { hip: hoodSeat.hip, style: hoodSeat.style } };
    b.setHome(hood);
    let stood = false;
    let liftedOnBench = false;
    const { clips, last } = runFor(b, 30, (f) => {
      stood ||= f.clip === "standUp";
      // Until on their feet, the body must keep the bench's height at the bench's spot.
      if (!stood && f.sit === 1 && f.seatY !== seat.hip[1]) liftedOnBench = true;
    });
    expect(liftedOnBench).toBe(false);
    expect(clips.has("standUp") && clips.has("walk") && clips.has("sitDown")).toBe(true);
    expect(Math.hypot(last.x - hoodSeat.approach[0], last.z - hoodSeat.approach[1])).toBeLessThan(0.01);
    expect(last).toMatchObject({ sit: 1, seatY: hoodSeat.hip[1], clip: "type" });
  });

  test("compaction, no warung stool free: buys kopi at the window, drinks it back on its own seat", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "warung" }, null, 1);
    let atWindow = false;
    const trip = runFor(b, 40, (f) => {
      if (f.clip === "buy") atWindow ||= Math.hypot(f.x - COUNTER.point[0], f.z - COUNTER.point[1]) < 0.05;
    });
    expect(atWindow).toBe(true);
    expect(trip.clips.has("sip")).toBe(true);
    expect(b.state.posture).toBe("seated");
    expect(trip.last.props).toMatchObject({ cup: true, laptop: "closed" });
    expect(Math.hypot(trip.last.x - seat.approach[0], trip.last.z - seat.approach[1])).toBeLessThan(0.01);
    b.setTarget(WORK, null, 2);
    const back = runFor(b, 8);
    expect(back.last.props).toMatchObject({ cup: false, laptop: "open" });
    expect(back.last.clip).toBe("type");
  });

  test("compaction with a free warung stool: drinks the kopi there, then walks home to work", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "warung" }, null, 1);
    b.setVisit(stool);
    const trip = runFor(b, 40);
    expect(trip.clips.has("buy") && trip.clips.has("sip")).toBe(true);
    expect(b.state.posture).toBe("seated");
    expect(trip.last).toMatchObject({ sit: 1, seatStyle: "stool", seatY: stoolSeat.hip[1] });
    expect(Math.hypot(trip.last.x - stool.point[0], trip.last.z - stool.point[1])).toBeLessThan(0.01);
    b.setTarget(WORK, null, 2);
    const back = runFor(b, 30);
    expect(back.clips.has("standUp") && back.clips.has("sitDown")).toBe(true);
    expect(back.last).toMatchObject({ clip: "type", seatStyle: "bench", sit: 1 });
    expect(Math.hypot(back.last.x - seat.approach[0], back.last.z - seat.approach[1])).toBeLessThan(0.01);
  });

  test("a warung stool taken back mid-break sends the drinker home with the cup", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "warung" }, null, 1);
    b.setVisit(stool);
    runFor(b, 40);
    b.setVisit(null);
    const moved = runFor(b, 30);
    expect(moved.clips.has("standUp")).toBe(true);
    expect(moved.last).toMatchObject({ seatStyle: "bench", sit: 1 });
    expect(moved.last.props.cup).toBe(true);
  });

  test("coffee break: the kopi in one hand, the cigarette in the other, never both in the lips", () => {
    const b = seatedBrain({ kind: "seated", activity: "work", work: "think" });
    runFor(b, 8);
    b.setTarget({ kind: "warung" }, null, 1);
    b.setVisit(stool);
    let sipWithKretekInLips = false;
    let carryingWithCigaretteInHand = false;
    let smokedWithCup = false;
    runFor(b, 60, (f) => {
      if (f.clip === "sip" && f.sit === 1) sipWithKretekInLips ||= f.props.cigarette === "mouth";
      // Standing with the kopi, the right hand has the laptop.
      if (f.props.cup && f.sit === 0) carryingWithCigaretteInHand ||= f.props.cigarette === "lit";
      if (f.clip === "smoke") smokedWithCup ||= f.props.cup && f.props.cigarette === "lit";
    });
    expect(smokedWithCup).toBe(true);
    expect(sipWithKretekInLips).toBe(false);
    b.setTarget(WORK, null, 2);
    const back = runFor(b, 30, (f) => {
      if (f.props.cup && f.sit === 0) carryingWithCigaretteInHand ||= f.props.cigarette === "lit";
    });
    expect(carryingWithCigaretteInHand).toBe(false);
    // The last sip at home empties the cup and parks the kretek in the lips for typing.
    expect(back.clips.has("sip")).toBe(true);
    expect(back.last).toMatchObject({ clip: "type", props: { cup: false, cigarette: "mouth" } });
  });

  test("a coffee break spent standing (lot full) ends with the cup finished", () => {
    const b = new Brain({ seed: 42, home: { ...home, seat: null }, atHome: true, target: WORK });
    b.setTarget(WORK, null, 0);
    b.setTarget({ kind: "warung" }, null, 1);
    const trip = runFor(b, 40);
    expect(trip.last.props.cup).toBe(true);
    b.setTarget(WORK, null, 2);
    const back = runFor(b, 10);
    expect(back.clips.has("sip")).toBe(true);
    expect(back.last.props.cup).toBe(false);
  });

  test("a tab hidden through a coffee break settles straight onto the warung stool with the cup", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "warung" }, null, 1);
    b.setVisit(stool);
    b.settle();
    const f = b.update(1 / 30, 0);
    expect(f).toMatchObject({ sit: 1, seatStyle: "stool" });
    expect(f.props.cup).toBe(true);
  });

  test("tool failure plays a frustrated gesture, then back to typing", () => {
    const b = seatedBrain();
    b.react("failure");
    const { clips, last } = runFor(b, 4);
    expect(clips.has("frustrated")).toBe(true);
    expect(last.clip).toBe("type");
  });

  test("a burst of tool failures plays one facepalm, not one per failure", () => {
    const b = seatedBrain();
    for (let i = 0; i < 5; i++) b.react("failure");
    let facepalms = 0;
    let prev: Clip | null = null;
    runFor(b, 16, (f) => {
      if (f.clip === "frustrated" && prev !== "frustrated") facepalms++;
      prev = f.clip;
    });
    expect(facepalms).toBe(1);
  });

  test("settling a hidden tab is not an arrival: no greeting round when the person next sits down", () => {
    const b = new Brain({ seed: 3, home, atHome: false, target: WORK });
    b.setTarget(WORK, null, 0);
    runFor(b, 2);
    expect(b.state.posture).toBe("standing");
    b.settle();
    expect(b.takeArrival()).toBe(false);
    b.setTarget({ kind: "needs", need: "permission" }, null, 3);
    runFor(b, 4);
    b.setTarget(WORK, { kind: "approved", at: 4 }, 4);
    let arrivals = 0;
    runFor(b, 10, () => (arrivals += b.takeArrival() ? 1 : 0));
    expect(arrivals).toBe(0);
    expect(b.state.posture).toBe("seated");
  });

  test("dozes with Zzz, wakes when work resumes", () => {
    const b = seatedBrain({ kind: "seated", activity: "doze" });
    expect(runFor(b, 1).last.props.zzz).toBe(true);
    b.setTarget(WORK, null, 1);
    const { last } = runFor(b, 1);
    expect(last.props.zzz).toBe(false);
    expect(last.clip).toBe("type");
  });

  test("idle: shuts the laptop, lights up and scrolls the phone, cigarette in hand; work brings the laptop back", () => {
    const b = seatedBrain({ kind: "seated", activity: "idle" });
    const { clips, last } = runFor(b, 20);
    expect(clips.has("closeLaptop") && clips.has("lightUp")).toBe(true);
    expect(last.clip).toBe("phone");
    expect(last.props).toMatchObject({ laptop: "closed", phone: true, cigarette: "lit" });
    b.setTarget(WORK, null, 21);
    const back = runFor(b, 2).last;
    expect(back.clip).toBe("type");
    expect(back.props).toMatchObject({ laptop: "open", phone: false, cigarette: "mouth" });
  });

  test("idle without a seat: phone in hand, cigarette in the lips (the other hand carries the laptop)", () => {
    const standing: Home = { point: [1.3, 3.6], yaw: -0.5, node: "frontE", seat: null };
    const b = new Brain({ seed: 9, home: standing, atHome: true, target: { kind: "seated", activity: "idle" } });
    b.setTarget({ kind: "seated", activity: "idle" }, null, 0);
    const { last } = runFor(b, 10);
    expect(last.clip).toBe("phone");
    expect(last.props).toMatchObject({ phone: true, cigarette: "mouth" });
  });

  test("dozing off shuts the laptop", () => {
    const b = seatedBrain({ kind: "seated", activity: "doze" });
    const { clips, last } = runFor(b, 6);
    expect(clips.has("closeLaptop")).toBe(true);
    expect(last).toMatchObject({ clip: "doze" });
    expect(last.props).toMatchObject({ laptop: "closed", zzz: true, phone: false });
  });

  test("leaving: closes the laptop, stands, walks off and is done", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "gone" }, null, 1);
    const { clips } = runFor(b, 40);
    expect(clips.has("closeLaptop") && clips.has("standUp") && clips.has("walk")).toBe(true);
    expect(b.done).toBe(true);
  });

  test("thinking: lights up, types with one hand and smokes with the other; real work moves the cigarette to the lips", () => {
    const b = seatedBrain({ kind: "seated", activity: "work", work: "think" });
    const { clips, last } = runFor(b, 6);
    expect(clips.has("lightUp") && clips.has("think")).toBe(true);
    expect(last.clip).toBe("think");
    expect(last.props.cigarette).toBe("lit");
    b.setTarget(WORK, null, 7);
    const after = runFor(b, 2).last;
    expect(after.clip).toBe("type");
    expect(after.props.cigarette).toBe("mouth");
    b.setTarget({ kind: "needs", need: "permission" }, null, 9);
    expect(runFor(b, 3).last.props.cigarette).toBe("unlit");
  });

  test("a status change while turning to the seat still ends seated on the seat, facing forward", () => {
    // A new session walks in; its status flips (prompt → thinking → bash) right as it turns to sit down.
    const b = new Brain({ seed: 3, home, atHome: false, target: WORK });
    b.setTarget(WORK, null, 0);
    let t = 0;
    while (b.state.step !== "turn" && t < 60) {
      b.update(1 / 30, 0);
      t += 1 / 30;
    }
    expect(b.state.step).toBe("turn");
    b.setTarget({ kind: "seated", activity: "work", work: "think" }, null, 1);
    const { last } = runFor(b, 10);
    expect(b.state.posture).toBe("seated");
    expect(last.yaw).toBeCloseTo(seat.yaw, 3);
    expect(Math.hypot(last.x - seat.approach[0], last.z - seat.approach[1])).toBeLessThan(0.01);
  });

  test("asked for permission on the way in: after the lighter it walks on to the seat instead of sitting mid-path", () => {
    const b = new Brain({ seed: 5, home, atHome: false, target: WORK });
    b.setTarget(WORK, null, 0);
    while (b.state.step !== "walk") b.update(1 / 30, 0);
    runFor(b, 2);
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 5);
    b.setTarget(WORK, { kind: "approved", at: 2 }, 2);
    const { last } = runFor(b, 40);
    expect(b.state.posture).toBe("seated");
    expect(last.yaw).toBeCloseTo(seat.yaw, 3);
    expect(Math.hypot(last.x - seat.approach[0], last.z - seat.approach[1])).toBeLessThan(0.01);
  });

  test("turn done: stretches with a check badge, then goes idle (laptop shut, phone)", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "seated", activity: "idle" }, null, 1);
    b.react("done");
    let badge = false;
    const { clips, last } = runFor(b, 10, (f) => (badge ||= f.props.done));
    expect(clips.has("stretch")).toBe(true);
    expect(badge).toBe(true);
    expect(last.props.done).toBe(false);
    expect(last).toMatchObject({ clip: "phone", props: { laptop: "closed", phone: true } });
  });

  test("turn done after a denied permission does not cut into the sigh", () => {
    const b = seatedBrain();
    b.setTarget({ kind: "needs", need: "permission" }, null, 1);
    runFor(b, 6);
    b.setTarget({ kind: "seated", activity: "idle" }, null, 2);
    b.react("done");
    const { clips } = runFor(b, 12);
    expect(clips.has("sigh")).toBe(true);
    expect(clips.has("stretch")).toBe(false);
  });

  test("walking in and sitting down reports the arrival once (to greet the neighbours); a wave plays seated", () => {
    const b = new Brain({ seed: 3, home, atHome: false, target: WORK });
    b.setTarget(WORK, null, 0);
    let arrivals = 0;
    runFor(b, 30, () => (arrivals += b.takeArrival() ? 1 : 0));
    expect(arrivals).toBe(1);
    b.react("wave");
    b.react("wave");
    let waves = 0;
    let prev: Clip | null = null;
    const { last } = runFor(b, 6, (f) => {
      if (f.clip === "wave" && prev !== "wave") waves++;
      prev = f.clip;
    });
    expect(waves).toBe(1);
    expect(last).toMatchObject({ clip: "type", sit: 1 });
    // A person already at home on page load never reports an arrival.
    const loaded = seatedBrain();
    runFor(loaded, 3, () => expect(loaded.takeArrival()).toBe(false));
  });

  test("idle neighbours chat with heads turned to each other, then go back to the phone", () => {
    const b = seatedBrain({ kind: "seated", activity: "idle" });
    runFor(b, 14);
    const right: [number, number] = [home.point[0] + 0.6, home.point[1]];
    b.setChat(right);
    const chatting = runFor(b, 3).last;
    expect(chatting.clip).toBe("chat");
    expect(chatting.props.phone).toBe(false);
    expect(Math.abs(chatting.look)).toBeGreaterThan(0.5);
    b.setChat(null);
    const after = runFor(b, 3).last;
    expect(after).toMatchObject({ clip: "phone", look: 0 });
  });

  test("a chat window opening while working changes nothing", () => {
    const b = seatedBrain();
    b.setChat([home.point[0] + 0.6, home.point[1]]);
    expect(runFor(b, 3).last.clip).toBe("type");
  });

  describe("habits", () => {
    const habitBrain = (habit: "vape" | "none", target: Target = WORK) => {
      const b = new Brain({ seed: 42, home, atHome: true, target, habit });
      b.setTarget(target, null, 0);
      runFor(b, 0.5);
      return b;
    };
    const IDLE: Target = { kind: "seated", activity: "idle" };
    const THINK: Target = { kind: "seated", activity: "work", work: "think" };

    test("a vaper never uses a lighter: thinks and idles with the vape in hand", () => {
      const b = habitBrain("vape");
      let lighter = false;
      b.setTarget(THINK, null, 1);
      const think = runFor(b, 4, (f) => (lighter ||= f.props.lighter || f.props.flame));
      expect(think.last).toMatchObject({ clip: "think", props: { cigarette: "lit" } });
      b.setTarget(IDLE, null, 2);
      const idle = runFor(b, 6, (f) => (lighter ||= f.props.lighter || f.props.flame));
      expect(idle.last).toMatchObject({ clip: "phone", props: { cigarette: "lit", phone: true } });
      expect(idle.clips.has("lightUp")).toBe(false);
      expect(lighter).toBe(false);
    });

    test("a vaper asked for permission holds the vape, and takes a pull when approved", () => {
      const b = habitBrain("vape");
      b.setTarget({ kind: "needs", need: "permission" }, null, 1);
      expect(runFor(b, 6).last.props).toMatchObject({ cigarette: "unlit", bubble: "permission" });
      b.setTarget(WORK, { kind: "approved", at: 2 }, 2);
      const { clips } = runFor(b, 8);
      expect(clips.has("drag")).toBe(true);
      expect(clips.has("lightUp")).toBe(false);
    });

    test("a vaper vapes between sips on a coffee break and puts it away to work", () => {
      const b = habitBrain("vape");
      b.setTarget({ kind: "warung" }, null, 1);
      b.setVisit(stool);
      let vapedWithCup = false;
      runFor(b, 60, (f) => (vapedWithCup ||= f.clip === "smoke" && f.props.cup && f.props.cigarette === "lit"));
      expect(vapedWithCup).toBe(true);
      b.setTarget(WORK, null, 2);
      expect(runFor(b, 30).last).toMatchObject({ clip: "type", props: { cup: false, cigarette: "mouth" } });
    });

    test("a non-smoker on a coffee break just drinks and sits", () => {
      const b = habitBrain("none");
      b.setTarget({ kind: "warung" }, null, 1);
      b.setVisit(stool);
      const trip = runFor(b, 60);
      expect(trip.clips.has("sip") && trip.clips.has("sitIdle")).toBe(true);
      expect(trip.clips.has("smoke")).toBe(false);
      expect(trip.last.props.cigarette).toBe("none");
    });

    test("a non-smoker never holds anything to smoke: types while thinking, sips kopi over the phone, waits empty-handed", () => {
      const b = habitBrain("none");
      let smoked = false;
      const watch = (f: Frame) => (smoked ||= f.props.cigarette !== "none" || f.props.lighter);
      b.setTarget(THINK, null, 1);
      expect(runFor(b, 3, watch).last.clip).toBe("type");
      b.setTarget(IDLE, null, 2);
      expect(runFor(b, 6, watch).last).toMatchObject({ clip: "phone", props: { phone: true, cup: true } });
      b.setTarget({ kind: "needs", need: "permission" }, null, 3);
      runFor(b, 6, watch);
      b.setTarget(WORK, { kind: "approved", at: 4 }, 4);
      const back = runFor(b, 8, watch);
      expect(back.clips.has("lightUp")).toBe(false);
      expect(back.last).toMatchObject({ clip: "type", props: { cup: false } });
      b.setTarget({ kind: "gone" }, null, 5);
      expect(runFor(b, 3, watch).clips.has("stubOut")).toBe(false);
      expect(smoked).toBe(false);
    });
  });
});
