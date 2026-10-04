# Parkiran Agent: architecture

How the system works today. It replaces the Phase 0 plan (`docs/PLAN.md`; its history is in git). Evidence for the
Claude Code behaviour is in [EXPERIMENTS.md](EXPERIMENTS.md), the build log in [PROGRESS.md](../PROGRESS.md), and
what comes next in [ROADMAP.md](ROADMAP.md).

A browser scene of a parking lot beside a warung kopi. Every running Claude Code session is a person who walks in,
sits down with a laptop and mirrors the real session state, driven by Claude Code hooks.

```
Claude Code hooks ──stdin JSON──▶ relay (Bun) ──HTTP POST──▶ server (Bun, 127.0.0.1) ──WebSocket──▶ web (Vite + R3F)
```

## 1. Verified Claude Code facts

Source: official docs, fetched 2026-09-21:
[hooks reference](https://code.claude.com/docs/en/hooks), [hooks guide](https://code.claude.com/docs/en/hooks-guide),
[desktop](https://code.claude.com/docs/en/desktop), [statusline](https://code.claude.com/docs/en/statusline),
[settings](https://code.claude.com/docs/en/settings). They were checked against real Desktop sessions (Claude Code
`2.1.289`/`2.1.293`) in [EXPERIMENTS.md](EXPERIMENTS.md).

| Fact | What the docs say | How we use it |
|---|---|---|
| Desktop runs hooks | "Claude Code fires the same hook events wherever it runs: … the Desktop app". Desktop reads `~/.claude/settings.json`. | Install into `~/.claude/settings.json`. |
| Settings reload | Claude Code watches settings files and applies `hooks` edits to running sessions without restart. | No restart needed after install. |
| Settings format | `hooks.<Event>[]` → matcher group `{ matcher?, hooks: [handler] }`. Omitted / `"*"` matcher = match all. | One matcher-less group per event. |
| Async hooks | `"async": true` runs in the background, Claude continues immediately. `timeout` is not enforced for async. | All events async except `SessionEnd`. Relay prints nothing. |
| Exec form | `command` + `args` spawns the executable directly, no shell. | `command` = absolute bun path, `args` = [relay path, `--parkiran-relay`]. |
| SessionEnd | Hooks share a 1.5 s budget, raised by a per-hook `timeout`. | Sync with `timeout: 2` so the event leaves before the process exits. |
| Common input | `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, `hook_event_name`; `agent_id` + `agent_type` inside a subagent. | Only `session_id`, `hook_event_name`, `cwd`→project, `agent_*` are used. |
| Events | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` (**no** `tool_use_id`), `PermissionDenied` (auto mode only), `PostToolUse`, `PostToolUseFailure`, `Notification`, `SubagentStart`/`SubagentStop`, `Stop`, `StopFailure`, `PreCompact`/`PostCompact`, `Elicitation`/`ElicitationResult`. | All 17 subscribed. |
| Permission timing | `PermissionRequest` fires when a dialog is needed. In Desktop, `Notification` `permission_prompt` fires ~6 s later only if still unanswered. | `PermissionRequest` = the korek search starts; `permission_prompt` = escalate. |
| Manual deny | No event at all: no `PermissionDenied`, `PostToolUseFailure` or `Stop` (measured). | Denial is inferred (§4). |
| Idle | `Notification` `idle_prompt` fires ~60 s after Claude finished with no input. | Resolves a stuck need as denied. |
| Subagents | `SubagentStop` also fires for internal agents (prompt suggestions, `/btw`) with `agent_type` = "" and no matching start. Tool events inside a subagent carry `agent_id`. | A friend appears only for a known `SubagentStart`; subagent tools animate the friend. |
| Questions | `AskUserQuestion` and `ExitPlanMode` are tools (`PreToolUse`). | Those names = "needs you (question)". |
| Plan usage | Only the status line receives `rate_limits`; Desktop never runs the status line (measured). Hooks carry no usage. | No usage meter in the HUD (§9). |

## 2. Workspace layout (bun workspaces)

```
parkiran-agent/
├─ shared/     pure TS used by everything: event schema + validators, reducer, seats, tool kinds, sun, env parsing
├─ relay/      hook entrypoint: stdin → allowlist sanitiser → POST. ~14 ms per run
├─ server/     Bun.serve: POST /ingest (token) + WS /ws (Origin/Host checked), reorder buffer, in-memory state, static web
├─ web/        Vite + React + R3F + drei + postprocessing + zustand; scene/, hud/, audio/, state/
├─ scripts/    install-hooks, uninstall-hooks, simulate, watch, bench-relay, assets/ pipeline, blender/ character + clips
├─ assets/     parkiran-assets.tar.gz + checksums (committed); raw/ and generated/ (gitignored)
├─ docs/       ARCHITECTURE.md, EXPERIMENTS.md, ROADMAP.md, screenshots/
├─ .env        PARKIRAN_TOKEN / PORT / … created by install-hooks, mode 600, gitignored
└─ .parkiran/  install manifest + last dry-run diff, gitignored
```

The reducer and seat logic live in `shared/`, so the server (the source of truth), the simulator and the unit tests
run the exact same code. The relay imports only validators, so its cold start stays small.

## 3. Privacy

The relay builds the outgoing object from scratch (allowlist). It never deletes keys from the payload.

| Wire field | Source | Validation |
|---|---|---|
| `event` | `hook_event_name` | one of the 17 names |
| `sessionId` | `session_id` | `[A-Za-z0-9_-]{1,128}` |
| `project` | basename of the git root (main repo for linked worktrees), else basename of `cwd` | control/bidi chars stripped, ≤ 64 |
| `branch` | `.git/HEAD` read directly; `git symbolic-ref` (150 ms timeout) only for reftable repos | stripped, ≤ 100 |
| `toolName` | `tool_name` | `[A-Za-z0-9_.:-]{1,128}` |
| `toolUseId` | `tool_use_id` | id regex |
| `source` / `endReason` / `compactTrigger` / `stopError` / `isInterrupt` | SessionStart / SessionEnd / Pre+PostCompact / StopFailure / PostToolUseFailure only | closed enums / boolean |
| `notificationType` | `notification_type` (Notification only) | `[a-z][a-z0-9_]{0,63}` |
| `agentId` / `agentType` | `agent_id` / `agent_type` | id regex / `[A-Za-z0-9_.:-]{0,64}` |
| `ts` | relay process start (`performance.timeOrigin`) | number |

Never forwarded: `tool_input`, `tool_response`, `prompt`, `message`, `title`, `error`, `reason`, transcripts, any
path. Nothing reads credentials, OAuth tokens or the Keychain. The server re-validates with a strict schema that
rejects unknown keys. `relay/test/sanitize.test.ts` injects a marker into every non-allowlisted field of every event
type (nested keys too) and proves it never reaches the wire. Enum values are read only on the event where they are
enums, and unknown values are dropped.

Server hardening: bound to 127.0.0.1, constant-time token compare, 4 KB body limit, `Host` must be
`127.0.0.1|localhost:<port>` (DNS rebinding), WebSocket upgrade only from the web app's own origin (WebSockets are not
covered by CORS), no outbound network calls.

Raw-event debug mode (`PARKIRAN_RELAY_RAW=1`): a **shape** log in `logs/raw-events.jsonl` (keys, types, string
lengths, values only for enum/id fields). Free text never reaches the disk.

## 4. Session state (pure reducer, `shared/src/reducer.ts`)

Per session the server keeps: `phase` (`working | waiting | idle | compacting | leaving`), `work` (tool kind: `think
| read | bash | edit | web | agent | other`, `shared/src/tools.ts`), `need` (`permission | question | input`, tool,
since), the last `outcome` (`approved | answered | denied | failure`), a `dozing` flag, counters (tool calls, failures,
compactions, asks), the tool mix by group, the time it waited for the user and worked, a timeline of state changes
over about the last hour (≤ 120 entries), announced milestones, timestamps, open tools, subagents and a seat. Every change also emits **cues** (`arrived`, `needStarted`, `needResolved`, `turnDone`,
`failure`, `compactStarted`, `milestone`, …) that drive the event feed, the chime, one-shot animations and the
director. Milestones: tool calls 100/250/500/1000 and compactions 2/4 on events, 1/2/4 h of work from `tick`.

| Event | Transition |
|---|---|
| any event for an unknown session | create (seat allocated), so sessions reappear after a server restart |
| `SessionStart` | create / no-op if known (resume, compact) |
| `UserPromptSubmit` | `working(think)`; a pending need resolves as **denied**. Also fires for subagent hand-backs and background-task notifications |
| `PreToolUse` | `working(kind(tool))`; `AskUserQuestion`/`ExitPlanMode` → `waiting(question)`; a new `toolUseId` ≥ 500 ms after a pending permission whose tool never completed → **denied** |
| `PermissionRequest` | `waiting(permission, tool)`, paired with the latest unfinished `PreToolUse` of that tool |
| `PostToolUse` | the paired pending need → **approved/answered**, then `working` |
| `PostToolUseFailure` | outcome **failure**, stays `working` |
| `PermissionDenied` | outcome **denied** |
| `Notification` `permission_prompt` / `elicitation_*` / `agent_needs_input` | ensure `waiting` (+ reminder) |
| `Notification` `idle_prompt` | pending need → **denied**; else `idle` |
| `Stop` | pending need → **denied**; `idle` (cue `turnDone`) |
| `StopFailure` | outcome **failure**; `idle` |
| `SubagentStart` / `SubagentStop` | friend joins / leaves (known agent ids only); an unknown `SubagentStop` with `agentType: ""` is an internal agent: no friend, a pending need → **denied** |
| tool events with `agentId` | animate the friend; the parent is unchanged |
| `PreCompact` / `PostCompact` | `compacting` → back to the previous phase |
| `SessionEnd` | `leaving`; the seat frees after the exit walk |
| timer: idle ≥ `PARKIRAN_IDLE_MINUTES` (30) | `dozing` |
| timer: no events for `PARKIRAN_REAP_HOURS` (12) | reaped (walks away) |
| timer: a friend without events for 30 min | leaves (`SubagentStop` may never come) |

Async hooks can arrive out of order (measured: 1 inversion in 46, p95 delivery 33 ms, Pre→Post as low as 7 ms). The
server holds each event for 150 ms (`server/src/reorder.ts`) and applies them sorted by relay spawn time. State
changes older than the last applied one only update counters.

**Seats** (`shared/src/seats.ts`): benches first, then the warung stools, then the car hoods (10 seats). A subagent
friend takes the seat next to its parent, else any free seat. Whoever has no seat stands. When a seat frees up, a
standing session sits down.

## 5. Characters (client)

`web/src/scene/characters/`. The server state becomes a **target** per person (`Characters.tsx` `targetFor`):
`gone` (leaving), `warung` (compacting), `needs` (a pending need), `seated work` (working, with the tool kind),
`seated doze`, `seated idle`. `brain.ts` (pure, unit tested) turns the target into steps (walk along the waypoint
graph in `layout.ts`, turn, play a clip with props) and yields one frame per tick. The brain's clip time drives the
animation mixer directly, so hidden-tab catch-up, manual stepping and the frozen gallery are deterministic.

| State | Behaviour |
|---|---|
| arrive | spawns on the street footpath, walks the gang to its seat, sits, opens the laptop; waves with the seat neighbours (`takeArrival` → `greet`) |
| working | types (rate by tool kind: read 0.45 … bash 1.7); thinking = one hand types, the other smokes; tools = cigarette in the lips |
| needs permission | stands up with an unlit cigarette, pats pockets, looks around (lighter bubble). Approved: light, first drag, sit. Denied: sigh, pocket the cigarette, sit |
| question / input | stands with a "?" or hand bubble, sits back when answered |
| turn done | stretch with a check badge and a soft ting (seated at home only), then idle |
| idle | shuts the laptop, lights up, scrolls the phone with the odd drag (standing: phone in hand, cigarette in the lips); two idle neighbours chat 14 s out of every 80 s, heads turned to each other (`chatPairs`, `Frame.look`) |
| failure | `frustrated` facepalm, then back to work (one-shot reaction) |
| compacting | buys a kopi at the serving window, drinks it on a free warung stool (else on its own seat, else standing), walks back when done; the kopi is in the left hand, so the right one keeps the kretek or vape (seated, a smoker smokes between sips; standing, the right hand carries the laptop and a kretek goes to the lips), and the last sip at home empties the cup |
| dozing | laptop shut, dozes, Zzz |
| leaving | stubs out the cigarette, shuts the laptop, walks out to the street |

Without a seat, people get a standing spot (14 validated spots, in arrival order; a friend prefers the spot nearest
its parent). Gestures always finish; calm loops end as soon as the target changes. A walk that still leads where the
new target wants carries on (sessions change state many times while someone walks in).

**Look** (`identity.ts`): a hash of the session id picks the body, shirt style + print + colour, legs, hair, skin tone,
sandals, a cap (20 %) and a habit (`habitFor`: kretek 70 %, vape 25 %, none 5 %). The brain follows the habit: a vaper
never lights up (the pod sits upright in a fist closed at runtime, the arm pulled near the lips so its tip meets them;
the device stays in the hand, `"mouth"` means put away; pulls give thick white `Vape` clouds and an LED
glow), a non-smoker types while thinking, sips a kopi over the phone when idle, and waits empty-handed for a
permission (key bubble instead of the lighter). The session also picks a head accessory (`accessoryFor`: peci 10 %, glasses 30 %, none 60 %;
`Crew.tsx`); a cap never goes over a peci. The HUD row shows the same shirt colour.

**Pak Joko** (`warungOwner.ts`, `PakJoko.tsx`) stands behind the counter with a routine of his own (smoke, sip,
phone, look around), plays the Interact reach with a glass while anyone is in the `buy` step, and naps on his stool
23:00–04:30. **Street vendors** (`art/FoodCart.tsx`) use the same character in the `push` pose.

## 6. Character and animation pipeline

**Character:** MakeHuman/MPFB2 generated headlessly by `scripts/blender/make_character.py` with the MPFB built-in
`mixamo` rig (52 `mixamorig:*` bones; the name only describes the bone layout, Adobe Mixamo is not used). One GLB
holds every variant part; the app toggles visibility and tints materials:

| Slot | Parts | Notes |
|---|---|---|
| Body | `Body_Shorts`, `Body_Trunks`, `Body_Pants` | skin under clothes removed per leg garment (ray-cast coverage); tint = skin tone |
| Shirt | `Shirt_Tee` (kaos oblong), `Shirt_Polo` | grey textures → tint = kaos colour |
| Legs | `Shorts`, `Trunks`, `Pants` (cargo, tinted as jeans) | grey textures → tint |
| Hair | `Hair_short01`, `Hair_short02`, `Hair_short04` | alpha MASK |
| Extras (app) | sandal jepit (`Sandal.tsx`), cap, laptop, cigarette, lighter, cup, phone (`props.tsx`) | procedural, bone-attached |

**Clips:** `scripts/blender/make_animations.py` builds them into the same GLB. Locomotion and sitting come from the
Quaternius Universal Animation Library (CC0), retargeted by world-rotation deltas. The warung gestures are keyframed
as data (bone rotations + IK targets for the hands) with analytic two-bone IK baked in.

| Brain clip | Source |
|---|---|
| `walk`, `standIdle` | UAL `Walk_Loop`, `Idle_Loop` |
| `sitDown`, `standUp` | UAL `Sitting_Enter`, `Sitting_Exit` (`Sitting_Idle_Loop` is the base under seated gestures) |
| `chat`, `buy` | UAL `Sitting_Talking_Loop`, `Idle_Talking_Loop` |
| `sitIdle`, `type`, `think`, `smoke`, `drag`, `sip` / `sipStand` (left hand), `stretch`, `frustrated`, `patPockets`, `lookAround`, `lightUp`, `sigh`, `pocketCig`, `doze`, `stubOut`, `closeLaptop`, `wave`, `phone` / `phoneStand`, `ride` (scooter riders) | keyframed |
| `cupSit`, `cupSmoke`, `cupStand`, `phoneCup` | keyframed: the same moves with the kopi held upright (`rigPlay` swaps them in while a cup is held; walking keeps the legs and plays `cupStand` above them) |
| `push` | UAL `Walk_Loop` legs + the `Interact` reach held still (`RigPlay.upperAt`) |

Runtime: the lower body plays the posture clip and the upper body the gesture clip (`rig.ts`), so a gesture works
seated and standing; the halves cross-fade separately. The seated root is the feet position, and higher seats lift
it. Walk speed matches the clip's stride, so feet do not slide. The stretch (keyed seated) plays from the waist up
standing, the wave (keyed standing) from the waist up seated.

## 7. Scene

`web/src/scene/`. The lot is about 14 × 11 m (`layout.ts` `LOT`), between a street on the left, a back wall with
houses, a toren and trees behind it, and the warung on the right.

| Part | File |
|---|---|
| Asphalt, parking lines, kerbs | `art/Ground.tsx` |
| Back wall, houses, roofs, toren, posters | `art/Walls.tsx` |
| Street, footpath, poles, cables, street lamp, moths | `art/Street.tsx` |
| Warung (sign "PAK JOKO", serving window, awning, sachets, gallons, crates) | `art/Warung.tsx` |
| Benches, warung stools (kursi bakso), gerobak gorengan, plants, crates | `art/Furniture.tsx` |
| Parked cars (procedural lofts, `art/loft.ts`), covered car, scooters | `art/Vehicles.tsx` |
| Graffiti "NGOPI dulu!" drawn in code on the warung's side wall | `art/Graffiti.tsx` |
| Festoon bulbs, red-white bunting | `art/Festive.tsx` |
| Trees (`@dgreenheck/ez-tree`) | `art/Trees.tsx` |
| Passing cars and ojek (one street simulation, `art/traffic.ts`), the kucing oren, falling leaves | `art/Ambient.tsx` |
| Ashtrays, butts and empty glasses by each seat (`art/traces.ts`) | `art/Traces.tsx` |
| Bakso / nasi goreng carts on the far pavement after dusk (`art/foodCart.ts`) | `art/FoodCart.tsx` |
| Static meshes merged per material | `art/StaticMerge.tsx` |

**Day and night** (`env/`): the sun follows the scene clock and `PARKIRAN_LAT/LON` (NOAA algorithm,
`shared/src/sun.ts`). The sky blends two of four pure-sky HDRIs per time band (dawn, noon, golden, night). One
shadow-casting key light (sun or moon), lamps and the warung light up at dusk. Post: N8AO, bloom on HDR emissives only,
AgX tone mapping, vignette. The scene clock is the local clock unless a time of day is chosen in the toolbar (Pagi 07:00, Siang 12:00, Sore 17:30,
Malam 21:00; per browser), `?time=HH:MM` or the dev input (`sceneDate()` in `env/envState.ts`, `env/timeOfDay.ts`).
A new choice eases the sun the short way round the clock in 1.5 s. Lighting, sky, lamps, Pak Joko's nap, the food
carts and the ambience sound all read it.

**Camera** (`CameraRig.tsx`): default view framed on the benches and the warung, clamped orbit, eased zoom towards the
mouse (down to a face), click to follow a person, compact view for a second monitor. Cinematic is a director
(`director.ts`): needs you → close-up, failure / turn done / friend → medium shot, arrival / coffee run → follow, each
held ≥ 6 s; otherwise a drift over the lot with a visit to someone at work every 20 s.

**Sound** (`audio/sound.ts`): procedural WebAudio, no files: distant traffic, engines of passing vehicles (panned,
Doppler), laptop keys while sessions work, birds in the morning, crickets at night, the lighter, the turn-done ting,
the food carts' "ting-ting" / "tek-tek", and the needs-you chime.

**HUD** (`hud/`): session list (shirt colour, project with a `#2` for twins of one project + branch, branch, state chip,
readable tool name, calls, age; needs first, one line each from six sessions, height capped with the list scrolling,
foldable), summary chips that filter the list, a needs-you banner, detail panel, event feed with an "All / Needs you"
filter, toolbar (camera mode, reset view, compact, sound, notifications, time of day). The detail panel adds asks,
time waited for the user, the last hour as a labelled strip and the tool mix (`hud/insights.ts`). Panels are frosted
(`-webkit-backdrop-filter` must come before `backdrop-filter`, or the minifier drops the standard one). Labels are pure and tested (`labels.ts`); icons are Lucide.
Notifications: a chime every 25 s while a session needs you, plus a system notification when the page is not
focused.

## 8. Assets

The optimised models, textures, skies and the character are committed as one archive
(`assets/parkiran-assets.tar.gz`, sha256 per file in `assets/parkiran-assets.json`) and extracted into
`web/public/assets` on `bun install`. `bun run assets` rebuilds the Poly Haven part (download, gltf-transform dedup /
weld / simplify / meshopt, KTX2 via a WASM Basis encoder); `bun run assets:character` rebuilds the character and
clips in Blender. Sources and licences: [CREDITS.md](../CREDITS.md). Vehicles, the cat, the graffiti, stools,
sandals, smoke and most small props are procedural.

## 9. Plan usage

The only documented source of plan usage is the status line's `rate_limits`, and Desktop never runs the status line.
The server keeps a `UsageSource` interface (`server/src/usage.ts`) that reports N/A, so a status-line source can be
plugged in for CLI users. The HUD shows no meter.

## 10. Performance

Relay: p50 ~14 ms per hook, async, so Claude waits **0 ms** per tool call; only `SessionEnd` (sync) costs ~14 ms once.
Web, measured with six people: ~570 draw calls and ~650k triangles a frame. At most 60 fps, evenly paced; 30 fps while
another window has the focus. Resolution drops in three steps when frames run slow. Every shader compiles up front.
Rigs are disposed when a person leaves (no GPU leak under churn). Server: ~25 MB RSS, ~0 % CPU.

## 11. Open questions

- `PreCompact`/`PostCompact` and `SessionEnd` have not been observed live in Desktop yet (the docs are explicit).
- The real frame rate on the target MacBook has to be read with `?stats` in a visible tab.
