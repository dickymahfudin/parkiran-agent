# Roadmap

What could come next. Nothing here is scheduled; each item says why it matters and roughly how big it is
(S: an evening, M: a weekend). Ideas and pull requests are welcome.

| Item | Why | Size |
|---|---|---|
| State that survives a server restart | A restart, a crash or a reboot forgets every counter, the last-hour strip and the insights; idle sessions only come back on their next event. A debounced snapshot in `.parkiran/` (mode 600), loaded on start and reaped as usual, would keep them | M |
| Bake the trees into a GLB | The procedural tree library is a 4 MB chunk, almost all of it inlined textures for presets the lot never uses, and the ones it uses sit in GPU memory uncompressed. Generating the two trees once and shipping them through the existing KTX2 + meshopt pipeline drops both | M |
| Cap the drawn subagent friends | Every friend is a full skinned character with its own seat and tag; a fan-out of 20 or 30 agents fills the lot and costs CPU per frame. Draw about four per session and show "+N" on the parent's tag | S |
| Wake the frame loop at the render rate | On a 120 Hz screen the loop still wakes 120 times a second while Saver renders 20; waiting with a timer between frames below 60 fps would save more battery | S |
| Load the skies lazily | All four HDR skies (5.8 MB) load at start, but at most two blend at any time and a fixed time of day needs one | M |
| Restart the server on failure | A `launchd` agent with KeepAlive, installed and checked by `bun run doctor`, so the lot comes back after a crash or a reboot | M |
