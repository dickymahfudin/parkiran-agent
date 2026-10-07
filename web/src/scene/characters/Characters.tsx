import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PublicSession } from "../../../../shared/src/protocol.ts";
import { SEATS } from "../../../../shared/src/seats.ts";
import { MOOD_COLOR, sessionName, stateLabel } from "../../hud/labels.ts";
import { serverNow, useApp } from "../../state/store.ts";
import {
  SEAT_PLACES,
  WARUNG_STOOLS,
  assignStandingSpots,
  assignWarungStools,
  nearestStandingSpot,
  standingSpotFor,
  type StandingSpot,
  type Vec2,
} from "../layout.ts";
import { Brain, type Home, type Target } from "./brain.ts";
import { hash32, lookFor, type Look } from "./identity.ts";
import { PakJoko, warungCounter } from "./PakJoko.tsx";
import { Person, type TagInfo } from "./Person.tsx";
import { SmokeSystem, type SmokeSource } from "./props.tsx";

interface Entry {
  key: string;
  sessionId: string;
  agentId: string | null;
  brain: Brain;
  look: Look;
  homeKey: string;
  smoke: SmokeSource;
  steam: SmokeSource;
}

const NEIGHBOURS = new Map(SEATS.map((s) => [s.id, s.neighbours]));
/** Idle neighbours chat for `CHAT_WINDOW_S` out of every `CHAT_CYCLE_S`, each pair at its own offset. */
const CHAT_CYCLE_S = 80;
const CHAT_WINDOW_S = 14;
/** Both have to have been idle this long first (the phone comes out before the talk). */
const CHAT_AFTER_IDLE_MS = 15_000;
/** Chat windows open and close with the clock, so the cast is re-synced at least this often. */
const RESYNC_MS = 1000;

function placeOf(seatId: string): Home {
  const seat = SEAT_PLACES[seatId];
  if (!seat) throw new Error(`unknown seat ${seatId}`);
  return { point: seat.approach, yaw: seat.yaw, node: seat.node, seat: { hip: seat.hip, style: seat.style } };
}

const WARUNG_PLACES = new Map<string, Home>(WARUNG_STOOLS.map((id) => [id, placeOf(id)]));

export function targetFor(s: PublicSession): Target {
  if (s.phase === "leaving") return { kind: "gone" };
  if (s.phase === "compacting") return { kind: "warung" };
  if (s.need) return { kind: "needs", need: s.need.kind };
  if (s.phase === "working") return { kind: "seated", activity: "work", work: s.work };
  if (s.dozing) return { kind: "seated", activity: "doze" };
  return { kind: "seated", activity: "idle" };
}

function homeFromSeat(seatId: string | null, standing: StandingSpot): { home: Home; key: string } {
  if (seatId && SEAT_PLACES[seatId]) return { home: placeOf(seatId), key: seatId };
  const spot = standing;
  return { home: { point: spot.point, yaw: spot.yaw, node: spot.node, seat: null }, key: `stand-${spot.point.join(",")}` };
}

const hasSeat = (seat: string | null): seat is string => seat !== null && SEAT_PLACES[seat] !== undefined;

/**
 * Everyone without a seat (sessions and subagent friends) gets a standing spot, in arrival order so nobody moves when
 * someone new comes; a friend prefers the spot nearest its parent.
 */
function standingPlaces(sessions: readonly PublicSession[]): Map<string, StandingSpot> {
  const standers: { key: string; at: number; prefer: number }[] = [];
  for (const s of sessions) {
    const parentAt = hasSeat(s.seat) ? SEAT_PLACES[s.seat]!.approach : standingSpotFor(hash32(s.id)).point;
    if (!hasSeat(s.seat)) standers.push({ key: s.id, at: s.startedAt, prefer: hash32(s.id) });
    for (const sub of Object.values(s.subagents)) {
      if (!hasSeat(sub.seat)) standers.push({ key: friendKey(s.id, sub.id), at: sub.startedAt, prefer: nearestStandingSpot(parentAt) });
    }
  }
  standers.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  const prefer = new Map(standers.map((x) => [x.key, x.prefer]));
  return assignStandingSpots(
    standers.map((x) => x.key),
    (key) => prefer.get(key)!,
  );
}

const friendKey = (sessionId: string, agentId: string): string => `${sessionId}/${agentId}`;

function tagFor(s: PublicSession, now: number, twins: ReadonlyMap<string, number>): TagInfo {
  const label = stateLabel(s, now);
  return { title: sessionName(s, twins), subtitle: s.branch, color: MOOD_COLOR[label.mood], text: label.text, icon: label.icon };
}

const idleAt = (e: Entry, now: number): boolean => {
  const t = e.brain.state.target;
  return t?.kind === "seated" && t.activity === "idle" && e.brain.state.posture === "seated" && now - e.brain.changedAt >= CHAT_AFTER_IDLE_MS;
};

/**
 * Pairs of seated, idle neighbours whose chat window is open right now (seat order, each person in one pair at most).
 * The window is a pure function of the clock and the pair, so both sides start and stop together.
 */
function chatPairs(bySeat: ReadonlyMap<string, Entry>, now: number): Map<string, Vec2> {
  const talking = new Map<string, Vec2>();
  for (const seat of SEATS) {
    const a = bySeat.get(seat.id);
    if (!a || talking.has(a.key) || !idleAt(a, now)) continue;
    for (const n of seat.neighbours) {
      const b = bySeat.get(n);
      if (!b || talking.has(b.key) || !idleAt(b, now)) continue;
      const offset = hash32([a.key, b.key].sort().join("|")) % CHAT_CYCLE_S;
      if ((now / 1000 + offset) % CHAT_CYCLE_S >= CHAT_WINDOW_S) break;
      talking.set(a.key, SEAT_PLACES[n]!.approach);
      talking.set(b.key, SEAT_PLACES[seat.id]!.approach);
      break;
    }
  }
  return talking;
}

/** Someone just sat down next to others: they wave at each other. */
function greet(arrived: Entry, bySeat: ReadonlyMap<string, Entry>): void {
  const near = (NEIGHBOURS.get(arrived.homeKey) ?? [])
    .map((n) => bySeat.get(n))
    .filter((e): e is Entry => e !== undefined && e.brain.state.posture === "seated");
  if (near.length === 0) return;
  arrived.brain.react("wave");
  for (const e of near) e.brain.react("wave");
}

const DECLUTTER_EVERY = 3;
const SCREEN_POS = /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/;

/**
 * Name tags of neighbours overlap on screen; push the farther ones up so every tag stays readable. Reads no layout:
 * tag sizes come from a ResizeObserver and positions from the screen offset drei's Html writes on its wrapper, so this
 * never forces the browser to lay the page out mid-frame.
 */
function TagDeclutter() {
  const frame = useRef(0);
  const sizes = useMemo(() => new WeakMap<Element, { w: number; h: number }>(), []);
  const observer = useMemo(
    () =>
      new ResizeObserver((records) => {
        for (const r of records) {
          const box = r.borderBoxSize[0];
          if (box) sizes.set(r.target, { w: box.inlineSize, h: box.blockSize });
        }
      }),
    [sizes],
  );
  const watched = useMemo(() => new WeakSet<Element>(), []);
  useEffect(() => () => observer.disconnect(), [observer]);
  useFrame(() => {
    if (++frame.current % DECLUTTER_EVERY !== 0) return;
    const tags: { el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".name-tag")) {
      if (!watched.has(el)) {
        watched.add(el);
        observer.observe(el);
      }
      const size = sizes.get(el);
      // Html wrapper > centring div > tag.
      const wrapper = el.parentElement?.parentElement;
      const at = wrapper && wrapper.style.display !== "none" ? SCREEN_POS.exec(wrapper.style.transform) : null;
      if (!size || !at) continue;
      tags.push({ el, x: Number(at[1]) - size.w / 2, y: Number(at[2]) - size.h / 2, w: size.w, h: size.h });
    }
    // Lower on screen = nearer the camera: those keep their place.
    tags.sort((a, b) => b.y - a.y);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const t of tags) {
      let y = t.y;
      for (let moved = true, guard = 0; moved && guard < 12; guard++) {
        moved = false;
        for (const p of placed) {
          if (t.x < p.x + p.w && p.x < t.x + t.w && y < p.y + p.h + 2 && p.y < y + t.h + 2) {
            y = p.y - t.h - 3;
            moved = true;
          }
        }
      }
      placed.push({ x: t.x, y, w: t.w, h: t.h });
      const shift = Math.round(y - t.y);
      if (Number(t.el.dataset.shift ?? 0) !== shift) {
        t.el.dataset.shift = String(shift);
        t.el.style.translate = `0 ${shift}px`;
      }
    }
  });
  return null;
}

export function Characters() {
  const entries = useRef(new Map<string, Entry>());
  const [keys, setKeys] = useState<string[]>([]);
  const smokeSources = useMemo(() => new Map<string, SmokeSource>(), []);
  const owner = useMemo(() => {
    const smoke: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "smoke" };
    const steam: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "steam" };
    smokeSources.set("pak-joko:smoke", smoke);
    smokeSources.set("pak-joko:steam", steam);
    return { smoke, steam };
  }, [smokeSources]);
  const initialIds = useRef<Set<string> | null>(null);
  const lastCueSeq = useRef(0);
  const synced = useRef<{ sessions: unknown; cueSeq: number; at: number } | null>(null);
  const visits = useRef(new Map<string, string>());
  const sessions = useApp((st) => st.sessions);
  const twins = useApp((st) => st.twins);
  const select = useApp((st) => st.select);

  useFrame(() => {
    const st = useApp.getState();
    if (st.config === null) return;
    let changed = false;
    const arrivals: Entry[] = [];
    let buying = false;
    for (const [k, e] of entries.current) {
      if (e.brain.takeArrival()) arrivals.push(e);
      buying ||= e.brain.state.step === "buy";
      if (!e.brain.done) continue;
      entries.current.delete(k);
      smokeSources.delete(`${k}:smoke`);
      smokeSources.delete(`${k}:steam`);
      changed = true;
    }
    warungCounter.busy = buying;
    const seated = (): Map<string, Entry> => new Map([...entries.current.values()].filter((e) => SEAT_PLACES[e.homeKey]).map((e) => [e.homeKey, e]));
    if (arrivals.length > 0) {
      const bySeat = seated();
      for (const e of arrivals) greet(e, bySeat);
    }
    const wall = Date.now();
    // Targets only change with the sessions (and chat windows with the clock); otherwise everything below is skipped.
    if (!changed && synced.current?.sessions === st.sessions && synced.current.cueSeq === st.cueSeq && wall - synced.current.at < RESYNC_MS) return;
    synced.current = { sessions: st.sessions, cueSeq: st.cueSeq, at: wall };
    initialIds.current ??= new Set(Object.keys(st.sessions));
    const now = serverNow();
    const wanted = new Set<string>();

    const ensure = (key: string, sessionId: string, agentId: string | null, home: { home: Home; key: string }, target: Target): Entry => {
      let e = entries.current.get(key);
      if (!e) {
        const look = lookFor(agentId ?? sessionId);
        const atHome = initialIds.current!.has(sessionId) && (agentId === null || target.kind !== "gone");
        const smoke: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "smoke" };
        const steam: SmokeSource = { active: false, world: new THREE.Vector3(), kind: "steam" };
        e = {
          key,
          sessionId,
          agentId,
          look,
          homeKey: home.key,
          smoke,
          steam,
          brain: new Brain({ seed: look.seed, home: home.home, atHome, target, habit: look.habit }),
        };
        entries.current.set(key, e);
        smokeSources.set(`${key}:smoke`, smoke);
        smokeSources.set(`${key}:steam`, steam);
        changed = true;
      } else if (e.homeKey !== home.key) {
        e.homeKey = home.key;
        e.brain.setHome(home.home);
      }
      wanted.add(key);
      return e;
    };

    const standing = standingPlaces(Object.values(st.sessions));
    for (const s of Object.values(st.sessions)) {
      const home = homeFromSeat(s.seat, standing.get(s.id) ?? standingSpotFor(hash32(s.id)));
      ensure(s.id, s.id, null, home, targetFor(s)).brain.setTarget(targetFor(s), s.lastOutcome, now);
      for (const sub of Object.values(s.subagents)) {
        const key = friendKey(s.id, sub.id);
        const target: Target = s.phase === "leaving" ? { kind: "gone" } : { kind: "seated", activity: "work", work: sub.work };
        ensure(key, s.id, sub.id, homeFromSeat(sub.seat, standing.get(key) ?? standingSpotFor(hash32(sub.id))), target).brain.setTarget(target, null, now);
      }
    }

    const occupied = new Map<string, string>();
    for (const e of entries.current.values()) {
      if (!wanted.has(e.key)) e.brain.setTarget({ kind: "gone" }, null, now);
      else if (SEAT_PLACES[e.homeKey]) occupied.set(e.homeKey, e.key);
    }
    const talking = chatPairs(seated(), now);
    for (const e of entries.current.values()) e.brain.setChat(talking.get(e.key) ?? null);

    const goers = [...entries.current.values()]
      .filter((e) => wanted.has(e.key) && e.brain.state.target?.kind === "warung")
      .sort((a, b) => a.brain.changedAt - b.brain.changedAt || a.key.localeCompare(b.key))
      .map((e) => e.key);
    assignWarungStools(goers, new Set(occupied.keys()), visits.current);
    for (const e of entries.current.values()) {
      const stool = visits.current.get(e.key);
      e.brain.setVisit(stool ? (WARUNG_PLACES.get(stool) ?? null) : null);
    }

    const fresh = st.cueLog.filter((c) => c.seq > lastCueSeq.current).reverse();
    for (const c of fresh) {
      lastCueSeq.current = c.seq;
      if (c.cue.kind === "failure") entries.current.get(c.cue.sessionId)?.brain.react("failure");
      else if (c.cue.kind === "turnDone") entries.current.get(c.cue.sessionId)?.brain.react("done");
    }

    if (changed) setKeys([...entries.current.keys()]);
  }, -1);

  const now = serverNow();
  return (
    <>
      {keys.map((key) => {
        const e = entries.current.get(key);
        if (!e) return null;
        const s = sessions[e.sessionId];
        const sub = e.agentId && s ? s.subagents[e.agentId] : undefined;
        const tag: TagInfo | null = s
          ? e.agentId
            ? { title: sub?.type || "subagent", subtitle: null, color: "#c9d1d9", text: "helping", icon: null }
            : tagFor(s, now, twins)
          : null;
        return (
          <Person
            key={key}
            brain={e.brain}
            look={e.look}
            tag={tag}
            friend={e.agentId !== null}
            smoke={e.smoke}
            steam={e.steam}
            onSelect={() => select(e.sessionId)}
            trackId={e.agentId ? undefined : e.sessionId}
          />
        );
      })}
      <PakJoko smoke={owner.smoke} steam={owner.steam} />
      <SmokeSystem sources={smokeSources} />
      <TagDeclutter />
    </>
  );
}
