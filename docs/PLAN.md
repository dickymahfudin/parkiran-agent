# Parkiran Agent: plan (Phase 0)

A browser scene of a parking lot beside a warung kopi. Every running Claude Code session is a person on a
bench with a laptop; their behaviour mirrors the real session state, driven by Claude Code hooks.

```
Claude Code hooks ──stdin JSON──▶ relay (Bun) ──HTTP POST──▶ server (Bun, 127.0.0.1) ──WebSocket──▶ web (Vite + R3F)
```

## 1. Verified Claude Code facts

Source: official docs, fetched 2026-09-21:
[hooks reference](https://code.claude.com/docs/en/hooks), [hooks guide](https://code.claude.com/docs/en/hooks-guide),
[desktop](https://code.claude.com/docs/en/desktop), [statusline](https://code.claude.com/docs/en/statusline),
[settings](https://code.claude.com/docs/en/settings). Claude Desktop on this Mac bundles Claude Code `2.1.289` and
`2.1.293` (`~/Library/Application Support/Claude/claude-code/`).

| Fact | What the docs say | How we use it |
|---|---|---|
| Desktop runs hooks | "Claude Code fires the same hook events wherever it runs: … the Desktop app". Desktop reads `~/.claude/settings.json` (hooks section of desktop docs). | Install into `~/.claude/settings.json`. |
| Settings reload | Claude Code watches settings files and applies `hooks` edits to running sessions without restart. | No restart needed after install. |
| Settings format | `hooks.<Event>[]` → matcher group `{ matcher?, hooks: [handler] }`. Omitted / `"*"` matcher = match all. Events without matcher support ignore it. | One matcher-less group per event. |
| Async hooks | Command handler `"async": true` runs in the background, Claude continues immediately. `timeout` is not enforced for async. Output (if any) is delivered next turn. | All events async except `SessionEnd`. Relay prints nothing. |
| Exec form | `command` + `args` spawns the executable directly, no shell. | `command` = absolute bun path, `args` = [relay path, `--parkiran-relay`]. |
| SessionEnd | Hooks share a 1.5 s budget, raised by a per-hook `timeout`. | Sync with `timeout: 2` so the event leaves before the process exits. |
| Common input | `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, `hook_event_name`; `agent_id` + `agent_type` when inside a subagent. | Only `session_id`, `hook_event_name`, `cwd`→basename, `agent_*` are used. |
| Event names | `SessionStart` (source: startup/resume/clear/compact/fork), `SessionEnd` (reason), `UserPromptSubmit` (`prompt`), `PreToolUse` (`tool_name`, `tool_input`, `tool_use_id`), `PermissionRequest` (`tool_name`, `tool_input`, **no** `tool_use_id`), `PermissionDenied` (**auto mode only**, `reason`), `PostToolUse` (`tool_response`, `duration_ms`), `PostToolUseFailure` (`error`, `is_interrupt`), `Notification` (`notification_type`, `message`, `title`), `SubagentStart`/`SubagentStop` (`agent_id`, `agent_type`), `Stop`, `StopFailure` (`error` enum), `PreCompact`/`PostCompact` (`trigger`), `Elicitation`/`ElicitationResult`. | All 17 subscribed. |
| Permission timing | `PermissionRequest` fires the moment a permission dialog is needed. In Desktop (Agent SDK `canUseTool` host) `Notification` `permission_prompt` fires ~6 s later only if still unanswered (v2.1.233+). | `PermissionRequest` = korek search starts; `permission_prompt` = escalate. |
| Manual deny | `PermissionDenied` does **not** fire when you deny a dialog manually, and `PostToolUseFailure` doesn't fire for permission denials. `Stop` doesn't fire on user interrupt. | Denial is inferred (see §4). Must be confirmed with a real session at 🛑 A. |
| Idle | `Notification` `idle_prompt` fires ~60 s after Claude finished responding with no input. | Resolves a stuck "needs korek" as denied. |
| Subagents | `SubagentStop` also fires for internal agents (prompt suggestions, `/btw`) with `agent_type` = "" and no matching start. Tool events inside a subagent carry `agent_id`. | Friend only appears for a known `SubagentStart`; subagent tool events animate the friend, not the parent. |
| Questions | `AskUserQuestion` and `ExitPlanMode` are tools (`PreToolUse`). | `PreToolUse` with those names = "needs me (input)". |
| Plan usage | Status line stdin has `rate_limits.five_hour/seven_day.{used_percentage,resets_at}` (Pro/Max, after first response). Desktop docs list no status line, and the experiment confirmed Desktop never calls it. Hook payloads carry no usage. | Parking meter = `N/A` behind a `UsageSource` interface (see §10). |

## 2. Workspace layout (bun workspaces)

```
parkiran-agent/
├─ shared/     pure TS shared by everything: event schema + validators, (Phase 1) reducer, seats, identity hash
├─ relay/      hook entrypoint: stdin → allowlist sanitiser → POST. No deps, ~14 ms per run
├─ server/     (Phase 1) Bun.serve: POST /ingest (token) + WS /ws (Origin/Host checked), in-memory state
├─ web/        (Phase 2+) Vite + React + R3F + drei + postprocessing + zustand
├─ scripts/    install-hooks, uninstall-hooks, bench-relay, (Phase 1) simulate, (Phase 3) asset pipeline
├─ assets/     raw/ (CC0 downloads, gitignored), generated/ (Blender output, gitignored); optimised GLB/KTX2 go to web/public/assets
├─ docs/       PLAN.md, screenshots/
├─ .env        PARKIRAN_TOKEN / PORT / GIT (+ debug flags), created by install-hooks, mode 600, gitignored
└─ .parkiran/  install manifest (which containers the installer created) + last dry-run diff, gitignored
```

Why: the reducer and seat logic live in `shared/` so the server (source of truth), the simulator and unit tests use
the exact same code; the relay imports only validators so its cold start stays tiny.

## 3. Privacy

Relay builds the outgoing object from scratch (allowlist), never by deleting keys from the payload:

| Wire field | Source | Validation |
|---|---|---|
| `event` | `hook_event_name` | one of the 17 names |
| `sessionId` | `session_id` | `[A-Za-z0-9_-]{1,128}` |
| `project` | basename of git root (main repo for linked worktrees) else basename of `cwd` | control/bidi chars stripped, ≤ 64 |
| `branch` | `.git/HEAD` read directly; `git symbolic-ref` (150 ms timeout) only for reftable repos | stripped, ≤ 100 |
| `toolName` | `tool_name` | `[A-Za-z0-9_.:-]{1,128}` |
| `toolUseId` | `tool_use_id` | id regex (approved at 🛑 A) |
| `source` / `endReason` / `compactTrigger` / `stopError` / `isInterrupt` | SessionStart / SessionEnd / Pre+PostCompact / StopFailure / PostToolUseFailure only | closed enums / boolean (approved at 🛑 A) |
| `notificationType` | `notification_type` (Notification only) | `[a-z][a-z0-9_]{0,63}` |
| `agentId` / `agentType` | `agent_id` / `agent_type` | id regex / `[A-Za-z0-9_.:-]{0,64}` |
| `ts` | relay process start (`performance.timeOrigin`) | number |

Never forwarded: `tool_input`, `tool_response`, `prompt`, `message`, `title`, `error`, `reason`, transcripts, any path.
No credential, OAuth token or Keychain access anywhere. The server re-validates with a strict schema that rejects
unknown keys. Tests: `relay/test/sanitize.test.ts` injects a marker into every non-allowlisted field of every event
type (and into nested keys) and proves it never reaches the wire.

The id/enum additions (`toolUseId`, `source`, `endReason`, `compactTrigger`, `stopError`, `isInterrupt`) were
approved at 🛑 A. Enum values are read only on the event where they are enums (the same raw key carries free text
elsewhere, e.g. `PermissionDenied.reason`, `PostToolUseFailure.error`) and unknown values are dropped.

Server hardening (Phase 1): bound to 127.0.0.1, constant-time token compare, 4 KB body limit, `Host` header must be
`127.0.0.1|localhost:<port>` (DNS rebinding), WebSocket upgrade only from the web app's own origin (WebSockets are
not covered by CORS, so this stops other sites from reading project names), no outbound network calls.

Raw-event debug mode (`PARKIRAN_RELAY_RAW=1` in `.env`): appends a **shape** log to `logs/raw-events.jsonl`: keys,
types, string lengths, and values only for enum/id fields. Free text never hits the disk.

## 4. Session state machine (Phase 1, pure reducer in `shared/`)

Server keeps per session: `phase` (`arriving | working | waiting | idle | compacting | leaving`), `work` (tool kind:
read / bash / edit / web / agent / think / other), `need` (`permission | question | input`, tool, since), last
`outcome` (`approved | denied | answered | failure`), counters, timestamps, subagents, seat.

| Event | Transition |
|---|---|
| any event for an unknown session | create (seat allocated) – sessions reappear after a server restart |
| `SessionStart` | create / no-op if known (resume, compact) |
| `UserPromptSubmit` | `working(think)`; a pending need resolves as **denied**. Also fires for subagent hand-backs and background-task notifications, not only human prompts |
| `PreToolUse` | `working(kind(tool))`; `AskUserQuestion`/`ExitPlanMode` → `waiting(question)`; a new `toolUseId` ≥ 500 ms after a pending permission whose tool never completed → **denied** (deny with feedback, Claude continued) |
| `PermissionRequest` | `waiting(permission, tool)`, paired with the latest unfinished `PreToolUse` of that tool (the request has no id) |
| `PostToolUse` | pending need for the paired `toolUseId` → outcome **approved/answered** (lighter scene), then `working` |
| `PostToolUseFailure` | outcome **failure** (frustrated), stays `working` |
| `PermissionDenied` | outcome **denied** |
| `Notification permission_prompt` / `elicitation_*` / `agent_needs_input` | ensure `waiting` (+ escalate notification) |
| `Notification idle_prompt` | pending need → **denied**; else `idle` |
| `Stop` | pending need → **denied**; `idle` |
| `StopFailure` | outcome **failure**; `idle` |
| `SubagentStart` / `SubagentStop` | friend joins / leaves (only known agent ids) |
| `SubagentStop` with unknown id and `agentType: ""` | internal agent (prompt suggestion): no friend; pending need → **denied** (turn ended) |
| tool events with `agentId` | animate the friend; parent unchanged |
| `PreCompact` / `PostCompact` | `compacting` (walk to warung, buy kopi) → previous phase |
| `SessionEnd` | `leaving`; seat freed after the exit animation |
| timer: idle > `PARKIRAN_IDLE_MINUTES` (30) | `dozing` flag |
| timer: no events for 12 h | reaped (walks away) |

Async hooks can arrive out of order (measured: 1 inversion in 46, delivery p95 33 ms, Pre→Post gap as low as 7 ms).
The server holds each session's events for ~150 ms and applies them sorted by relay spawn time; state changes older
than the last applied one only update counters. Manual permission denial produces **no event at all** (measured),
hence the inference rules above.

Seats: benches first, then plastic stools at the warung, then car hoods. Each seat lists neighbours so a subagent
friend sits next to the parent (or stands beside them when full).

## 5. Character behaviour (client)

The client only animates transitions it receives. A per-session seeded RNG (hash of `session_id`) drives idle
variety (smoke / sip kopi / stretch / chat with neighbour) with randomised durations so characters never sync.
Typing intensity by tool kind: read = slow scroll, bash = fast, edit = steady. Walks follow a waypoint graph; walk
speed is derived from the clip's root-motion stride so feet do not slide.

## 6. Scene & art direction

Compact lot (≈ 14 × 10 m) framed by a plastered wall with a rolling shutter (warung), tarp awning, hanging sachet
strips, gerobak, 2–3 parked cars, 2 motor bebek, benches, monobloc chairs, street lamp with tangled cables, plants,
manhole, oil stains. One shadow-casting light (sun or moon) + baked/SSAO contact shadows; lamps are emissive +
a few non-shadow point lights. Day–night: sun position from local time + lat/lon (default −6.2, 106.8, NOAA
algorithm), sky = blend of pure-sky HDRIs per time band rendered into one PMREM environment, plus procedural sun
disk; AgX tone mapping, subtle bloom, N8AO, light night fog. Debug override `?time=HH:MM`.

## 7. Asset shortlist (all verified via public APIs, direct downloads, no login)

**Poly Haven (CC0)**, via `api.polyhaven.com`:
- Seating/props: `plastic_monobloc_chair_01`, `painted_wooden_bench`, `wooden_picnic_table`, `metal_stool_01-03`,
  `painted_wooden_stool`, `plastic_crate_01/02/03`, `plastic_thermos`, `plastic_bottle_gallon`, `cigarette_pack`,
  `small_lpg_tank`, `wooden_crate_01`, `cardboard_box_01`, `metal_trash_can`, `trashbag`, `old_tyre`.
- Street: `street_lamp_01`/`02`, `modular_electric_cables`, `utility_box_01`, `power_box_01`, `water_manhole_cover`,
  `covered_car` (a car under a cover – very parkiran), `CoffeeCart_01` (gerobak reference / fallback).
- Lights/plants: `hanging_industrial_lamp`, `lightbulb_01`, `potted_plant_04`, `planter_box_01`.
- Textures: `asphalt_02` / `worn_asphalt` / `road_damaged`, `concrete_pavement` / `brushed_concrete` (curbs),
  `plastered_wall_0x` / `painted_plaster_wall` / `blue_plaster_weathered`, `rusty_metal_shutter`,
  `corrugated_iron` / `rusty_corrugated_iron`, `clay_roof_tiles`, `weathered_planks`, `concrete_block_wall`.
- HDRIs (pure skies, 1k–2k): morning `kiara_1_dawn` / `spruit_sunrise`, noon `kloofendal_48d_partly_cloudy_puresky`,
  golden `belfast_sunset_puresky` / `kloppenheim_06_puresky`, night `rogland_clear_night` / `satara_night_no_lamps`.

**ambientCG (CC0)**, `ambientcg.com/api/v2` direct zips (`/get?file=<id>_1K-JPG.zip`): `Asphalt031`/`Asphalt033`,
`Road007`, `Fabric0xx` (tarp), painted metal, decals for oil stains (ids fixed in Phase 3).

**Vehicles** (built): no CC0 semi-realistic Indonesian vehicles exist as direct downloads (Quaternius cars are
low-poly toys), so the sedan, the city hatch and the matic scooters are procedural lofts (`web/src/scene/art/loft.ts`,
`Vehicles.tsx`) with clearcoat paint, tinted glass, plates and alloy rims; Poly Haven `covered_car` as is.

**Procedural**: benches if needed, parking lines (decal shader), awning, cables (catenary tubes), stools, sachet
strips (instanced, canvas-printed), gerobak, laptop, cup + steam, cigarette, lighter, flip-flops, moths, smoke.

**Cat** (built): procedural kucing oren that naps (curled, breathing) and wanders between the box by the warung,
the counter, the gerobak and under the sedan.

**Trees** (built): `@dgreenheck/ez-tree` (MIT, textures bundled in the package), materials swapped to PBR.

**Audio**: procedural WebAudio (lighter "cetek" + flame, notification chime, time-of-day ambience) – no licences.

**Font**: Plus Jakarta Sans (OFL, by an Indonesian foundry) bundled locally via `@fontsource-variable` – no CDN calls.

**Distribution** (user's choice): the optimised assets are committed as one archive (`assets/parkiran-assets.tar.gz`,
checksums in `assets/parkiran-assets.json`) and extracted into `web/public/assets` by the root `postinstall`.

**Optimisation**: gltf-transform (dedup, weld, simplify, meshopt) + KTX2 via a WASM Basis encoder (KTX-Software is
not in Homebrew); WebP fallback.

Every asset gets a row in `CREDITS.md` (source URL + licence) when downloaded.

## 8. Character path: kaos oblong + celana + sandal jepit (decided, built)

Chosen: **(b) MakeHuman/MPFB2**, generated headlessly by `scripts/blender/make_character.py` with the MPFB built-in
**`mixamo` rig** (52 `mixamorig:*` bones, MPFB weights, clothes weighted by MPFB; the name only describes the
bone layout, Adobe Mixamo is not used), plus **procedural sandal jepit**
attached to the foot/toe bones in the web app. Result: `docs/screenshots/character-preview.png`; every clip: `clips-blender-seated.jpg`,
`clips-blender-standing.jpg`.

One GLB holds every variant part; the app toggles visibility and tints materials per session (hash of `session_id`):

| Slot | Parts | Notes |
|---|---|---|
| Body | `Body_Shorts`, `Body_Trunks`, `Body_Pants` | skin under clothes removed per leg garment (ray-cast coverage, eroded 1 ring); tint = skin tone |
| Shirt | `Shirt_Tee` (kaos oblong, hem lengthened 8 cm), `Shirt_Polo` | grey textures → tint = kaos colour; print = decal later |
| Legs | `Shorts` (knee-length kolor), `Trunks` (mid-thigh), `Pants` (cargo, tinted as jeans) | grey textures → tint |
| Hair | `Hair_short01`, `Hair_short02`, `Hair_short04` | alpha MASK; tint black / dark brown |
| Face | `Eyes`, `Eyebrows`, `Eyelashes` | shared |
| Extras (app) | sandal jepit, optional cap | procedural, bone-attached |

Height 1.66 m, ~11k verts per visible body + ~1–3k per garment/hair. `assets/generated/character/character.glb`
(31 MB raw; textures will be resized/compressed in the asset pipeline).

## 9. Animation source (decided: Blender only, no Mixamo, no login)

Blender is the workshop; the motion data comes from two local sources, both processed headlessly by
`scripts/blender/make_animations.py` into the same GLB as the character:

1. **Quaternius Universal Animation Library, Standard** (CC0, 45 clips, direct zip from OpenGameArt, no login).
   Retargeted onto the MPFB rig: both rests are aligned per bone (direction match), then every frame copies the
   source's world-space rotation delta; hips height is scaled by leg length. Used for locomotion and sitting.
2. **Keyframed in Blender by script** for the warung gestures Quaternius does not have. Poses are written as data
   (bone rotations + IK targets for hands: mouth, keyboard, thighs, pockets), IK is baked, constraints removed.

| Brain clip | Source |
|---|---|
| `walk`, `standIdle` | UAL `Walk_Loop`, `Idle_Loop` |
| `sitDown`, `standUp` | UAL `Sitting_Enter`, `Sitting_Exit` (`Sitting_Idle_Loop` is the base under every seated gesture) |
| `chat`, `buy` | UAL `Sitting_Talking_Loop`, `Idle_Talking_Loop` |
| `sitIdle`, `type`, `think`, `smoke`, `drag`, `sip`, `stretch`, `frustrated`, `patPockets`, `lookAround`, `lightUp`, `sigh`, `pocketCig`, `doze`, `stubOut`, `closeLaptop`, `wave`, `ride` (scooter riders) + standing variants | keyframed |

Runtime (web): the lower body (hips + legs) plays the posture clip and the upper body plays the gesture clip, so a
gesture works seated and standing; clips cross-fade separately per half. The brain's `clipTime` drives action time
directly (deterministic, works with the hidden-tab catch-up). Seat style adjusts the legs (hood = dangling legs),
the head turns towards the neighbour while chatting, props (laptop, cigarette, lighter, cup) hang on bone sockets.
Walk speed is matched to the clip's measured stride so feet do not slide.

## 10. Parking meter (plan usage)

Only documented source: status line stdin `rate_limits` (Pro/Max). It needs no token, but the Phase 0.5 experiment
showed Claude Desktop never invokes `statusLine` (`docs/EXPERIMENTS.md` #9). Hook payloads carry no usage, and the
OAuth usage endpoint would need your token (forbidden). So plan usage stays behind a `UsageSource` interface (a
`StatusLineUsageSource` can be plugged in if you ever use the CLI), and meanwhile the meter shows a parking fee computed
from the sessions themselves: Rp 2.000 for the first hour, Rp 1.000 per extra started hour, per session. The temporary `statusLine` entry is
removed again before Phase 1 (re-run `install-hooks` without `--with-statusline`).

## 11. Relay latency (measured, `bun run bench:relay`, M2)

Per invocation, spawn → exit, 40 runs: server down p50 13.3 ms / p95 14.3 ms; server up p50 14.1 ms / p95 19.5 ms.
Claude does not wait for async hooks, so the added blocking latency is **0 ms** per tool call; only `SessionEnd`
(sync) costs ≈ 14 ms once. A bundled relay was not faster, so the source runs directly.

## 12. Risks / open questions

- Manual permission denial has no event: inferred from the next `Stop`/`UserPromptSubmit`/`idle_prompt`. Verify live.
- Desktop session lifetime: `SessionEnd` may be rare (tabs stay open) → doze + 12 h reaper.
- Retargeting quality (UAL rest vs MPFB rest) must be checked on renders before the web uses it.
- No CC0 motor bebek → procedural; quality bar must still be met.
- Bun path is pinned to `~/.asdf/installs/bun/1.4.0/bin/bun`; re-run `install-hooks` after changing bun versions.
