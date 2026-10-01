# Parkiran Agent

A small 3D parking lot beside a warung kopi, live in your browser. Every running Claude Code session (Claude Desktop
Code tab or the CLI) is a person who walks in from the street, sits down and works on a laptop. What they do mirrors
the real session: typing while tools run, standing up looking for a lighter when Claude needs your permission,
walking to the warung for coffee during compaction, dozing off when idle, and leaving when the session ends.

![Parkiran Agent at 17:30](docs/screenshots/final-1730.jpg)

```
Claude Code hooks ──stdin JSON──▶ relay (Bun) ──HTTP POST──▶ server (Bun, 127.0.0.1) ──WebSocket──▶ web (Vite + R3F)
```

Everything runs locally. The relay forwards only a few ids and names (see [Privacy](#privacy)); nothing leaves
your machine.

## Requirements

- macOS on Apple Silicon (tested), a WebGL2 browser (Chrome, Safari, Firefox).
- [Bun](https://bun.sh) 1.4 or newer.
- Claude Code: the Desktop app's Code tab or the `claude` CLI.
- Only to rebuild the character: Blender 5.2 (`bun run assets:character`).

## Setup

```bash
bun install                  # installs packages and extracts the 3D assets into web/public/assets
bun run install-hooks        # shows the exact ~/.claude/settings.json diff and asks before writing
bun run web:build            # builds the web app into web/dist
bun run server               # http://127.0.0.1:4747
```

Open <http://127.0.0.1:4747>. Running Claude sessions appear on their next hook event (send a prompt). Settings are
reloaded by Claude Code automatically; no restart needed.

`install-hooks` also creates `.env` with a random ingest token (mode 600). It adds one async hook per event, pointing
at `relay/src/index.ts` with the absolute path of your current `bun` binary. If you switch Bun versions (asdf,
Homebrew), run `bun run install-hooks` again.

### Development

```bash
bun run server               # API + WebSocket on 127.0.0.1:4747
bun run web                  # Vite dev server on http://127.0.0.1:4748 (hot reload)
bun run simulate -- --list   # scripted sessions, no Claude needed
bun run simulate -- --scenario=tour
bun test && bun run typecheck
```

Simulator scenarios: `working`, `approve`, `deny`, `question`, `failure`, `compact`, `subagent`, `idle`, `end`,
`six` (six busy sessions), `tour` (every state at once). Options: `--speed=2`, `--loop`, `--fresh`.

## Uninstall

```bash
bun run uninstall-hooks      # shows the diff, asks, removes only Parkiran's handlers
```

The file ends up byte for byte as it was before `install-hooks` (containers the installer created are removed too;
the manifest is in `.parkiran/hooks-install.json`). If the file is not in standard JSON formatting, install refuses
unless you pass `--allow-reformat`. Both scripts accept `--dry-run` and `--settings=<path>`.

## What you see

| Session | Character |
|---|---|
| Session starts | walks in from the street along the gang, straight to a bench, stool or car hood, opens the laptop |
| `thinking` | types with one hand, smokes with the other; when the tools start, the cigarette goes to the lips |
| Working (`reading`, `bash`, `editing`, `browsing`, `subagent`) | types; slower for reading, faster for Bash |
| Needs permission (`permission`) | stands up with an unlit cigarette, pats pockets, looks around; lighter bubble |
| Permission approved | gets a light, first drag, sits back down |
| Permission denied (inferred, Claude sends no event) | sighs, pockets the cigarette, sits back down |
| Question / input (`question`, `needs input`) | stands up with a "?" bubble |
| `idle` | shuts the laptop, lights a cigarette and scrolls the phone, with the odd drag |
| Tool or turn failure (`error`) | facepalm, then back to work |
| `compacting` | buys a kopi at the warung window, drinks it on a free warung stool (or back on its own seat), walks back when done |
| Subagent | a friend walks in and sits next to the parent (or on any free seat), leaves when done |
| Idle for 30 min (`dozing`) | laptop shut, dozes off, Zzz |
| Session ends (`leaving`) | stubs out the cigarette, closes the laptop, walks away |

When every seat is taken, newcomers and friends stand at their own spot (clear of the sitters, the cars and the
walking lanes, never inside each other) and sit down as soon as a seat frees up.

The scene follows your local clock: the sun and moon are computed from latitude/longitude, lamps and the warung light
up at dusk, moths circle the street lamp at night. Cars and ojek riders pass by, and a kucing oren naps around the lot.
The warung's side wall carries a spray-painted "NGOPI dulu!" piece with a kopi cup and its kretek, a korek gas and the
writer's "dism" tag (drawn in code, weathered into the plaster, with the cans left at its foot) under a tin-shade lamp that lights it at night; warm festoon bulbs hang from the awning
over the benches and red-white bunting runs along the back wall.

**Camera:** drag to orbit, scroll to zoom towards whatever is under the mouse, right up to a person's face (scrolling
back out returns to the overview), click a character to follow it. **Reset view** in the toolbar, the `R` key or a double-click on empty ground brings back the
default angle.

**Street:** cars and ojek share each lane single file and keep a safe gap to whoever is ahead.

**Performance:** the scene renders at most 60 fps (evenly paced on 120 Hz screens) and 30 fps while another window has the focus (watching on a second screen), drops resolution in three steps
(1.5 → 1.25 → 1) when frames run slow, and compiles every shader up front so props never stall a frame when they first
appear. About 570 draw calls and 650k triangles a frame with six people in the lot.

**Sound:** procedural, no audio files: distant traffic, engines of the cars and ojek going by (panned and louder as they
pass the camera), laptop keyboards while sessions work (louder when you zoom in), birds in the morning, crickets at
night, the lighter, and the chime.

**HUD:** the session list shows each character's shirt colour next to the project, a summary of how many sessions
need you, work or idle, and the tool and age of every session (click a row or a character for details; the camera
follows it, `Esc` lets go). Sessions waiting on you also appear as a banner at the top until they are handled; the event
feed has an "All / Needs you" filter. The toolbar has free / cinematic camera, reset view, compact mode for a second
monitor, sound, notifications and the scene clock (a clock override in dev mode). A loading screen covers the lot until
every part of the scene has arrived. States and events use stroke icons (Lucide), no emoji. Plain facts read in English; the warung jokes stay ("cari korek", "batal
ngerokok", "bawa kopi").

**Notifications:** when a session needs you, a chime plays (and repeats every 25 s); if the page is not focused you
also get a system notification such as "warung-app needs permission" with the branch. Clicking the character silences
it; it never changes the real session. Sound starts after your first click on the page (browser rule).

URL options: `?time=21:00` (fixed scene time), `?compact`, `?cinematic`, `?stats` (frame-rate meter).

## Configuration (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `PARKIRAN_TOKEN` | random | shared secret between relay and server (created by `install-hooks`) |
| `PARKIRAN_PORT` | `4747` | server port (127.0.0.1 only) |
| `PARKIRAN_WEB_PORT` | `4748` | Vite dev server port |
| `PARKIRAN_LAT`, `PARKIRAN_LON` | `-6.2`, `106.8` | your location for the sun (Jakarta) |
| `PARKIRAN_IDLE_MINUTES` | `30` | idle time before a character dozes off |
| `PARKIRAN_REAP_HOURS` | `12` | sessions without events disappear after this |
| `PARKIRAN_ALLOWED_ORIGINS` | – | extra WebSocket origins, comma separated |
| `PARKIRAN_STATIC_DIR` | `web/dist` | what the server serves at `/` |
| `PARKIRAN_GIT` | `git` on PATH | git binary, only used for reftable repositories |
| `PARKIRAN_RELAY_DEBUG`, `PARKIRAN_RELAY_RAW` | `0` | relay debug log / shape-only raw event log in `logs/` |

## Privacy

The relay builds each outgoing message from an allowlist: event name, session id, project name (git repository
name, or the folder name), branch, tool name, notification type, subagent id/type, tool-use id, a few closed enums
(session start source, end reason, compaction trigger, failure kind) and timestamps.

Never forwarded or stored: tool inputs and outputs, prompts, file contents, commands, messages, transcripts and full
paths. The server binds to 127.0.0.1, checks the token, the `Host` header and the WebSocket `Origin`, and makes no
outbound requests. Nothing reads Claude credentials, OAuth tokens or the Keychain. The optional raw debug log
records only the shape of events (keys, types, lengths), never values.

## Assets

The optimised models, textures, skies and the animated character are committed as one archive
(`assets/parkiran-assets.tar.gz`, checksums in `assets/parkiran-assets.json`) and extracted on `bun install`.
To rebuild them from their sources:

```bash
bun run assets               # Poly Haven models, textures and skies (downloads, then repacks the archive)
bun run assets:character     # MakeHuman/MPFB character + Quaternius/keyframed clips in Blender (BLENDER=/path)
```

Sources and licences: [CREDITS.md](CREDITS.md). Design notes: [docs/PLAN.md](docs/PLAN.md); progress and
decisions: [PROGRESS.md](PROGRESS.md).

## Layout

```
shared/   event schema + validators, session reducer, seats, sun position (used by server, simulator, tests)
relay/    hook entrypoint: stdin → allowlist → POST, ~14 ms per run, never blocks Claude (async hooks)
server/   Bun.serve: POST /ingest, WebSocket /ws, static web/dist
web/      Vite + React Three Fiber scene, HUD, audio, notifications
scripts/  install/uninstall hooks, simulator, asset pipeline, Blender scripts
assets/   asset archive (+ raw downloads and Blender output, gitignored)
```

## Troubleshooting

- **Nobody shows up:** check the HUD says *connected*; send a prompt in Claude (sessions appear on their next event);
  `PARKIRAN_RELAY_DEBUG=1` in `.env` writes relay errors to `logs/`.
- **"asset failed to load" in the HUD:** run `bun install` again (re-extracts the archive).
- **Hooks stopped after a Bun upgrade:** `bun run install-hooks` again (the hook pins the bun binary path).
- **No notifications:** allow notifications for 127.0.0.1 in the browser, then turn on the bell in the toolbar.

## License

MIT
