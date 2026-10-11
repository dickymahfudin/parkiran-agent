# Phase 0.5 experiments (real Claude Desktop sessions)

Setup: hooks installed with `bun run install-hooks --with-statusline` on 2026-09-21, `PARKIRAN_RELAY_RAW=1` and
`PARKIRAN_RELAY_DEBUG=1` in `.env`, `scripts/experiment-listener.ts` on 127.0.0.1:4747 logging arrival times to
`logs/ingest-experiment.jsonl`. Subjects: this Claude Code Desktop session (auto mode) and one concurrent real
session of the user in another repo.

## Findings

| # | Question | Result |
|---|---|---|
| 1 | Do Desktop sessions fire hooks from `~/.claude/settings.json`? | Yes. Events started flowing seconds after install, mid-session, in both sessions (hot reload confirmed). |
| 2 | Payload shape vs docs | Matches. Common: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode` (`"auto"`), `effort.level`. Tool events carry `tool_use_id`; `PostToolUse` has `duration_ms`. |
| 3 | Delivery delay (relay spawn → server arrival) | n=46: p50 18 ms, p95 33 ms, max 41 ms. |
| 4 | Ordering | Async hooks do arrive out of order (1 inversion in 46; relay completion order in the raw log shows Post before Pre). Pre→Post spawn gap can be as small as 7 ms. → pair by `toolUseId`, reorder per session with a ~150 ms buffer sorted by spawn `ts`. |
| 5 | `PostToolUseFailure` | Fires for a failing Bash command with `is_interrupt: false` and an `error` string. |
| 6 | Subagent lifecycle | `PreToolUse(Agent)` → `SubagentStart{agent_id, agent_type}` → subagent tool events carrying `agent_id`/`agent_type` → `PreToolUse/PostToolUse(SubagentHandback)` → `SubagentStop` → `PostToolUse(Agent)`. `agent_id` is 17 hex chars. |
| 7 | `UserPromptSubmit` | Also fires when a subagent hands back (not typed by the human), right after `PostToolUse(Agent)`. The reducer must not treat every `UserPromptSubmit` as "user typed". |
| 8 | Project / branch | Another session reported its repository and branch from git; this repo (no git yet) → `parkiran-agent` / null. |
| 9 | statusLine in Desktop | Never called (no `logs/statusline-probe.jsonl` after many turns in two sessions). Parking meter = N/A. |
| 10 | Permission approve (Manual mode, 3 runs) | `PreToolUse{tool_use_id}` → `PermissionRequest` 80–140 ms later (no `tool_use_id`, `permission_mode: "default"`) → `PostToolUse{same tool_use_id}` 2–5 s later when the human clicks Allow. No `permission_prompt` notification because each answer came in < 6 s. |
| 11 | Permission **deny** (manual) | `PreToolUse` → `PermissionRequest` → **nothing**. No `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` or `Stop`: the turn is interrupted. Next signals seen: an internal `SubagentStop{agent_type: ""}` ~5 s later (prompt suggestion), then `UserPromptSubmit` when the human typed. |
| 12 | `Stop` | Fires at the end of every turn here, with `background_tasks`/`session_crons` arrays. |
| 13 | Internal agents | `SubagentStop` with `agent_type: ""` and an unknown `agent_id` appears after a turn ends (prompt suggestions), never preceded by `SubagentStart`. Must not spawn a friend character; it is a weak "turn ended" signal. |
| 14 | `UserPromptSubmit` sources | Human prompt, subagent hand-back, and background-task notifications all fire it. |

## Reducer rules derived from this

- Pair permission with the latest unresolved `PreToolUse` of the same tool in the session (`PermissionRequest` has no id).
- Approved: `PostToolUse`/`PostToolUseFailure` with that `toolUseId`.
- Denied: `PermissionDenied`; or, while pending, any of `Stop`, `StopFailure`, `UserPromptSubmit`, `Notification idle_prompt`, internal `SubagentStop{agentType: ""}`; or a `PreToolUse` with a new id ≥ 500 ms after the request while the requested id never completed (deny with feedback, Claude continued).
- Unknown `SubagentStop` ids are ignored.

## Still to verify (optional, low risk: docs are explicit)

- `PreCompact`/`PostCompact` and `SessionEnd` in Desktop (needs a throwaway session with `/compact`, then closing it).
- `Notification idle_prompt` / `permission_prompt` timing in Desktop.

## Character pipeline spike

- MPFB 2.0.17 installed into Blender 5.2.2 (`blender --command extension install-file -r user_default -e`), asset
  packs extracted with MPFB's own `AssetService.fix_and_extract_asset_pack_zip`.
- `scripts/blender/make_character.py` builds the character headlessly in ~20 s: MPFB `mixamo` rig (52
  `mixamorig:*` bones), clothes weighted by MPFB, three body variants with covered skin removed, grey tintable
  garment textures, alpha modes fixed (OPAQUE body/clothes, MASK hair/brows/lashes). Exports a GLB (the FBX export
  for Mixamo was dropped with Mixamo itself).
- First pick (`elvs_crude_t-shirt_male` + `cortu_jeans_shorts`) looked wrong (tight scoop-neck top, hot pants);
  replaced by `toigo_basic_tucked_t-shirt` (hem lengthened 8 cm so it reads as an untucked kaos oblong),
  `namuhekam_male_polo_shirt`, `elvs_male_swim_shorts1` (tie-dye texture replaced by plain fabric),
  `mindfront_male_swimming_trunks_01`, `cortu_cargo_pants`.
- Tee, polo and cargo pants have no `delete_verts`, so skin coverage is computed by ray casting along vertex
  normals (6 cm) and eroding one ring.
- Seated typing pose rendered in Blender (`scripts/blender/render_pose_test.py`): clothes follow thighs/torso/arms,
  no visible skin poke-through (the pose test was later superseded by Blender renders of every clip).
