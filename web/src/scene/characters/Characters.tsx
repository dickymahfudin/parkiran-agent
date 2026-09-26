import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PublicSession } from "../../../../shared/src/protocol.ts";
import { SEATS } from "../../../../shared/src/seats.ts";
import type { Subagent } from "../../../../shared/src/session.ts";
import { MOOD_COLOR, stateLabel } from "../../hud/labels.ts";
import { serverNow, useApp } from "../../state/store.ts";
import { SEAT_PLACES, WARUNG_STOOLS, assignStandingSpots, assignWarungStools, standingSpotFor, type StandingSpot } from "../layout.ts";
import { Brain, type Home, type Target } from "./brain.ts";
import { hash32, lookFor, type Look } from "./identity.ts";
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

function friendHome(sub: Subagent, parent: Home): { home: Home; key: string } {
  if (sub.seat) return homeFromSeat(sub.seat, standingSpotFor(hash32(sub.id)));
  const side = (hash32(sub.id) & 1) === 0 ? 1 : -1;
  const point = [parent.point[0] + Math.cos(parent.yaw) * 0.8 * side, parent.point[1] - Math.sin(parent.yaw) * 0.8 * side] as const;
  return { home: { point, yaw: parent.yaw, node: parent.node, seat: null }, key: `beside-${point.join(",")}` };
}

function tagFor(s: PublicSession, now: number): TagInfo {
  const label = stateLabel(s, now);
  return { title: s.project ?? "?", subtitle: s.branch, color: MOOD_COLOR[label.mood], text: label.text };
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
  const initialIds = useRef<Set<string> | null>(null);
  const lastCueSeq = useRef(0);
  const synced = useRef<{ sessions: unknown; cueSeq: number } | null>(null);
  const visits = useRef(new Map<string, string>());
  const sessions = useApp((st) => st.sessions);
  const select = useApp((st) => st.select);

  useFrame(() => {
    const st = useApp.getState();
    if (st.config === null) return;
    let changed = false;
    for (const [k, e] of entries.current) {
      if (!e.brain.done) continue;
      entries.current.delete(k);
      smokeSources.delete(`${k}:smoke`);
      smokeSources.delete(`${k}:steam`);
      changed = true;
    }
    // Targets only change with the sessions; everything below is skipped on frames where nothing came in.
    if (!changed && synced.current?.sessions === st.sessions && synced.current.cueSeq === st.cueSeq) return;
    synced.current = { sessions: st.sessions, cueSeq: st.cueSeq };
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
        e = { key, sessionId, agentId, look, homeKey: home.key, smoke, steam, brain: new Brain({ seed: look.seed, home: home.home, atHome, target }) };
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

    const seatless = Object.values(st.sessions)
      .filter((s) => !s.seat || !SEAT_PLACES[s.seat])
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    const standing = assignStandingSpots(seatless.map((s) => s.id), hash32);
    for (const s of Object.values(st.sessions)) {
      const home = homeFromSeat(s.seat, standing.get(s.id) ?? standingSpotFor(hash32(s.id)));
      ensure(s.id, s.id, null, home, targetFor(s)).brain.setTarget(targetFor(s), s.lastOutcome, now);
      for (const sub of Object.values(s.subagents)) {
        const target: Target = s.phase === "leaving" ? { kind: "gone" } : { kind: "seated", activity: "work", work: sub.work };
        ensure(`${s.id}/${sub.id}`, s.id, sub.id, friendHome(sub, home.home), target).brain.setTarget(target, null, now);
      }
    }

    const occupied = new Map<string, string>();
    for (const e of entries.current.values()) {
      if (!wanted.has(e.key)) e.brain.setTarget({ kind: "gone" }, null, now);
      else if (SEAT_PLACES[e.homeKey]) occupied.set(e.homeKey, e.key);
    }
    for (const e of entries.current.values()) {
      const nb = NEIGHBOURS.get(e.homeKey) ?? [];
      e.brain.setNeighbour(nb.some((n) => occupied.has(n)));
    }

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
            ? { title: sub?.type || "subagent", subtitle: null, color: "#c9d1d9", text: "helping" }
            : tagFor(s, now)
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
      <SmokeSystem sources={smokeSources} />
      <TagDeclutter />
    </>
  );
}
