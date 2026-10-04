# Roadmap: make the lot more alive

Status: **phases A, B and C built 2026-10-03** (branches `feat/quick-wins`, `feat/living-world`,
`feat/session-insights`); decisions at the end. Each item says what is wrong today (with evidence), what to
build, and how we know it is done. Items marked *not now* were left out by the user.

Source: a review of the live lot (3 real sessions, 20:50) and the code on `main` (157ef65).

**Summary:** the technical base and the visuals are strong. What is missing is the story: the moments that matter
are not visible on the characters, sessions are hard to tell apart, and when every session is working the lot
looks static.

## Phase A: quick wins

### A1. Turn done gets a visible reaction (done)

- **Today:** the `turnDone` cue only reaches the event feed (`web/src/hud/labels.ts:110`). On the character, a
  finished turn looks the same as any other switch to idle (close the laptop, phone).
- **Build:** on `turnDone` the person leans back with a `stretch`, a small check badge floats over the head for
  ~2.5 s, and a soft "ting" plays. The "ting" must sound different from the needs-you chime.
- **Done when:** a brain test covers the reaction order (stretch → idle activity), the badge clears by itself, and the
  sound is quieter than the chime and does not repeat.

### A2. Use the clips that already exist (done)

- **Today:** `chat`, `stretch`, `wave` and `smoke` are baked and mapped (`rig.ts`), but only the Gallery uses them.
  `Brain.hasNeighbour` is set from `Characters.tsx` and never read (`brain.ts:160`).
- **Build:** `wave` when a subagent friend arrives (from both the parent and the friend) or when a neighbour sits down.
  If both neighbours are idle, they sometimes `chat` (heads turned to each other), then go back to the phone.
  Phone + cigarette stays the default idle (the user's earlier decision).
- **Done when:** brain tests cover wave on arrival and chat only with an idle neighbour. Chat is seeded per pair, so
  the two sides start together.

### A3. Tell twin sessions apart (done)

- **Today:** two sessions of the same project and branch show the same name tag and the same list row (seen live:
  two "parkiran-agent · fix/crowding").
- **Build:** when two or more sessions share a project and branch, the later ones get a suffix `#2`, `#3` (by start
  time), on the name tag, the list row and the detail panel. A suffix never changes while its session lives, and a
  lone session has none.
- **Done when:** a labels test covers ordering by start time, stable suffixes when the first one leaves, and no
  suffix for a unique project + branch.

### A4. Readable tool names (done)

- **Today:** raw MCP names such as `mcp__Claude_Browser__javascript_tool` fill the list row and the detail panel
  (`Hud.tsx:52`, `Hud.tsx:100`).
- **Build:** `mcp__<server>__<tool>` → `<server> › <tool>` (underscores in the server name become spaces). Built-in
  tools stay as they are. The full raw name shows in the title tooltip.
- **Done when:** a labels test covers MCP, plugin-style (`mcp__plugin_x_y__tool`) and built-in names.

### A5. HUD panels hide what is behind them (done)

- **Today:** panels are `rgba(15,17,23,0.68)` without `backdrop-filter`, so name tags (z 16) show sharply through
  the session list and the detail panel.
- **Build:** frosted panels (`backdrop-filter: blur(14px) saturate(1.2)` with a more opaque fallback). Name tags whose
  screen box falls under a HUD panel fade out.
- **Done when:** in a screenshot with a tag behind each panel, no tag text can be read through a panel.
- **Root cause found:** the CSS already asked for a blur, but the build's minifier (lightningcss) dropped the standard
  `backdrop-filter` because it came before `-webkit-backdrop-filter`, so production Chrome had no blur at all. The
  order is fixed and guarded by `web/src/hud/styles.test.ts`.

### A6. Time-of-day mode (new request) (done)

- **Today:** the scene follows the local clock. A fixed time is available only with `?time=HH:MM` or the dev-only
  time input (`Hud.tsx:238`). The mechanism already exists (`timeOverride` → `sceneDate()`), and lamps, sky, moths,
  birds and crickets all follow it.
- **Build:** a time-of-day control in the toolbar: **Auto** (follows your clock, default) · **Pagi** 07:00 ·
  **Siang** 12:00 · **Sore** 17:30 · **Malam** 21:00. The choice is saved per browser (localStorage). The scene
  clock shows the chosen time, and its icon marks a fixed time. `?time=` still wins for screenshots. Switching
  eases the light over ~1.5 s instead of jumping.
- **Done when:** the choice survives a reload, Auto returns to the real clock, and screenshots of all four presets
  plus Auto look right.

## Phase B: a livelier world

### B1. Camera framing and a director mode (done)

- **Today:** in the overview a person is ~30 px tall. The lower half of the screen is empty asphalt, and two parked
  cars cover the benches. Cinematic is a slow drift (`CameraRig.tsx:262`).
- **Build:** a tighter default view on the benches and the warung. Cinematic becomes a director: it cuts to what is
  happening (needs you → close-up of that person, turn done → medium shot, compaction → follows them to the warung,
  arrivals → follows the walk), with a minimum hold time and back to the overview when nothing happens.
- **Done when:** no shot cuts more often than every 6 s, and a needs-you event always wins over the others. Shot
  choice is pure and unit tested.
- **Built:** default view `[-5.0, 6.2, 10.6] → [0, 0.9, -3.0]`, people about twice as tall, every bench clear of the
  session list (`before-framing-1730.jpg` / `final-framing-1730.jpg`). Director in `web/src/scene/director.ts`
  (`director.test.ts`); switching to Cinematic starts on the overview. `final-director-turn-done.jpg`

### B2. Pak Joko at the warung (done)

- **Today:** the sign says "PAK JOKO", but nobody serves.
- **Build:** a warung owner behind the serving window, using the same character with an apron or a peci. He brews a
  kopi when someone comes to buy (compaction), wipes glasses, watches a small TV, and dozes late at night. He stays
  behind the counter (no walking routes).
- **Done when:** the buy scene shows him handing over the cup, and he never blocks the window path.
- **Built:** `warungOwner.ts` (pure, tested) + `PakJoko.tsx`; white kaos, peci; naps on his own stool 23:00–04:30
  and gets up for a buyer. No TV (not needed for the story). From the default overview the warung's awning hides him;
  he shows in close and low shots. `final-pak-joko-serve.jpg`, `final-pak-joko-night.jpg`

### B3. Vehicles are sessions (*not now*)

- **Today:** the parked cars and scooters are decoration. People walk in from the street.
- **Build:** each session arrives on a motor (rider pose already exists), parks it in a motor row in the lot, walks
  to its seat, and rides away on `SessionEnd`. Parked motors carry the session's shirt colour as their body colour.
  A full lot means a busy day.
- **Done when:** motors never overlap cars, people or walking routes (layout tests), and a reaped session's motor
  leaves with it.

### B4. Traces of time (done)

- **Build:** an ashtray by each seat that fills with butts as the session ages, and empty kopi cups that stack after
  each compaction. Both are cleared when the session leaves.
- **Done when:** session age can be read from the scene without the HUD, and the props are instanced (no draw-call
  growth per butt).
- **Built:** one butt per 15 min (max 12), a glass per compaction (max 5, new `compactions` counter in the reducer),
  three instanced draws for the whole lot (`art/Traces.tsx`, `art/traces.ts`).

### B5. More character variety (done, reduced)

- **Today:** 3 bodies × 2 shirts × 3 legs × 3 hairs, plus a cap for 20 %. With 6+ people they look alike.
- **Build:** cheap bone-attached accessories: peci, glasses, ojol jacket, helmet resting on the bench, towel on the
  shoulder. One accessory per project, so sessions of the same repo look like one crew.
- **Done when:** a 10-person crowd screenshot shows no two people that look the same at overview distance.
- **Built:** the user asked for no cloth on the people, so the towel and the headband were dropped: every project
  wore either a black peci or glasses. Later the user chose per-session randomness instead: peci 10 %, glasses 30 %,
  nothing 60 % (`accessoryFor`, `Crew.tsx`). `final-crew-peci.jpg`, `final-crew-glasses.jpg`

### B6. Ambient events (food carts done; drizzle *not now*)

- **Build:** food carts pushed past on the street footpath in the evening and at night (bakso "ting-ting", nasi
  goreng "tek-tek"), with procedural sound. *Not now:* drizzle on some days (rain on the zinc roof, wet asphalt).
- **Done when:** a cart passes at most every ~10 min, only after dusk, never through traffic or walkers.
- **Built:** on the far pavement (x −11.9, clear of the far lane and the trunks, tested), 18:30–01:00, one seeded pass
  per 10-minute slot; the vendor uses a new `push` pose (walk + the Interact reach held still); procedural
  "ting-ting" / "tek-tek" panned by distance. `?cart=bakso|nasgor` in dev. `final-food-cart.jpg`

## Phase C: information and a reason to come back

### C1. Session timeline in the detail panel (done)

- **Build:** a strip of the last 60 min (thinking / working / waiting on you / idle), the tool mix (Read / Edit /
  Bash / Web / MCP), the number of permission asks, and the total time Claude waited for you.
- **Done when:** the server keeps a bounded per-session history (counters and state spans only, no tool inputs), and
  a reducer test covers it.
- **Built:** the reducer keeps `timeline` (state changes over about the last hour, at most 120), `toolMix` (by group,
  MCP on its own), `asks`, `waitedMs` and `workedMs`; the detail panel draws the strip with a labelled legend
  (`hud/insights.ts`, tested). Thinking and tool calls alternate every few seconds, so the strip shows both as
  "working". In memory only, like the rest of the server state. `final-detail-insights.jpg`

### C2. Daily recap "Tutup warung" (*not now*)

- **Build:** a recap card (on demand, and once after midnight): sessions, tool calls, korek asks, average wait for
  you, busiest project, longest session. The server persists only counters to `.parkiran/stats/YYYY-MM-DD.json`
  (mode 600), with 30 days kept.
- **Done when:** a server restart keeps today's numbers, files hold no names other than project names, and old files
  are pruned.

### C3. Milestones in the event feed (done)

- **Today:** the feed is empty during long working stretches.
- **Build:** low-key milestone entries: 100 / 250 / 500 tool calls, 1 h / 2 h of work, the second compaction.
- **Done when:** milestones fire once per session, and the "Needs you" filter hides them.
- **Built:** `milestone` cues from the reducer (tool calls 100/250/500/1000, compactions 2/4) and from `tick` (1/2/4 h
  of work; coffee runs do not count); feed lines like "100 tool calls", "2nd compaction, kopi lagi" with a flag.

## D. Docs cleanup (done on `docs/roadmap-architecture`)

| File | Status | Fix |
|---|---|---|
| `README.md` | Current (updated with the crowding fix) | Add `scripts/watch.ts` and `server:dev`; update per feature as they land |
| `PROGRESS.md` | Mostly current | Test count says 171 (now 224). The "no commits" working rule is outdated: work is committed on branches, never pushed. Link this roadmap |
| `docs/PLAN.md` → `docs/ARCHITECTURE.md` | Rewritten as the current truth | Was: §2 phase labels, EXPERIMENTS.md not listed. §4 lists an `arriving` phase that does not exist, and the friend/standing seat rule changed in 157ef65. §5 idle variety (smoke/sip/stretch/chat) was replaced by phone + cigarette. §9 is missing `phone`/`phoneStand`/`ride`. §10 parking meter was removed from the HUD. §12 risks are resolved |
| `docs/EXPERIMENTS.md` | Current (historical findings) | "Exports GLB + FBX for Mixamo" is outdated (no FBX, no Mixamo). "Still to verify" stays open |
| `CREDITS.md` | Current | Add new assets/sounds as they come in |

## Decisions (2026-10-03)

1. Time of day: **Auto + Pagi / Siang / Sore / Malam**; a preset freezes the clock at its time.
2. `docs/PLAN.md` is rewritten as `docs/ARCHITECTURE.md` (current truth only).
3. Twin sessions get a **`#2`, `#3` suffix** (no nicknames).
4. In scope: everything in phases A–C except **B3** (motors per session), **B6 drizzle** and **C2** (recap file).
   **A2 chat while idle is in**: the phone stays the default idle.
5. One branch per phase, each off the previous one, committed when verified, never pushed:
   `docs/roadmap-architecture` → `feat/quick-wins` (A) → `feat/living-world` (B) → `feat/session-insights` (C).
