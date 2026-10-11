# Changelog

## 0.1.0 (2026-10-11)

First release.

- **The lot:** a 3D parking lot beside a warung kopi in the browser. Every Claude Code session (the desktop app's Code
  tab or the CLI) is a person who walks in, sits down with a laptop and mirrors the session: typing while tools run,
  standing up for a lighter when Claude needs your permission, a kopi run during compaction, a stretch when a turn is
  done, dozing when idle, walking away when the session ends. Subagents are friends who join them.
- **Living world:** Pak Joko at the counter, a bakso or nasi goreng cart every 5 minutes in the evening, cars and ojek,
  a kucing oren, the sun and moon for your location, a cinematic director camera, and a time-of-day menu.
- **HUD:** a session list built for a busy lot, a needs-you banner, an inspector with a grouped event feed and a session
  view (tool calls, running time, its last hour, tool mix, how often and how long it waited for you), keyboard
  shortcuts, a phone layout.
- **Notifications:** a chime and a system notification when a session needs you, quiet hours, per-sound switches.
- **Battery:** Saver by default (20 fps at most, light rendering, nothing in a hidden tab), Balanced and Smooth in the
  settings; audio sleeps between cues.
- **Privacy:** the hook relay forwards only an allowlist of ids and names (never prompts, tool inputs or outputs, file
  contents or paths); the server listens on 127.0.0.1 with a token, Host and Origin checks.
- **Tooling:** an installer and uninstaller for `~/.claude/settings.json` with backups and a byte-exact restore,
  `bun run doctor`, a simulator with scripted scenarios, and the asset pipeline (Poly Haven, MakeHuman, Quaternius,
  Blender).
