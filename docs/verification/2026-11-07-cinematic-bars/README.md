# Cinematic bars option — verification (7 November 2026)

Machine: Fedora-based Wayland desktop, AMD GPU (radv), 2560×1440 display.
Game: The Order: 1886, CUSA00035, APP_VER 01.02 (`/var/home/Pixel/Documents/PS4/CUSA00035`).
Capture: `spectacle -b -n` (grim cannot be used: KWin does not implement the
ext-screen-capture protocol). Input: ydotoold over `/dev/uinput` (the user has an
ACL entry for it); the shipped `ydotool click` subcommand segfaults on this build,
so clicks were sent to the daemon socket directly with the same wire protocol.

## What was tested

The launcher's Graphics page gained a **Cinematic bars** option (the former
"Framing" control, renamed and re-defaulted):

- `Enabled — cinematic bars` keeps the game's 2.40:1 letterbox (`aspect_ratio=original`).
- `Disabled — no bars (experimental)` removes the bars (`aspect_ratio=16:9`) by
  patching the aspect constant (2.4 → 16/9) at RVA 0x44ce86 of a derived prepared
  image; original game files are never modified. New installs default to disabled.
- Home chip shows `BARS: On/Off`.

## Results (row = ≥99 % near-black across the left 2000 px, excluding the FPS overlay)

| File | Setting | Top band | Bottom band |
| --- | --- | --- | --- |
| `baseline-35s.png` | original (before the change) | 186 px | 186 px |
| `nobars-50s.png` | 16:9 (bars disabled) | 0 px | 0 px |
| `bars-on-95s.png` | original (re-enabled from the UI) | 186 px | 186 px |
| `final-graphics.png` | Graphics page, "Disabled — no bars" selected | — | — |
| `home-chip.png` | Home strip showing `BARS: Off` | — | — |

At 2560×1440 the 2.40:1 scene is 2560×1068, so 186 px bands are exactly the
expected letterbox; with the bars disabled the scene fills all 1440 rows.

## Notes

- The first 16:9 launch ended in a GPU device-lost (exit 23) at ~35 s during
  shader compilation; the identical setup ran clean twice afterwards (title,
  menu and resumed gameplay at 60 FPS). The runtime's SRT recompiler errors
  appear in every boot log, bars on or off, so they are pre-existing noise,
  not aspect-related. One AMD driver hard-recovery flake remains possible.
- The aspect recipe still reports `experimental: true` and the warning text
  ships with the recipe; the launcher marks the choice "(experimental)".
- Worker/launcher binaries were rebuilt in place (PYZ const surgery with the
  worker's own bundled Python 3.12); `package-manifest.json` re-pinned to
  `3bef6f26…` (worker) and `34d5ba80…` (launcher). Originals kept in
  `/tmp/order1886-work/backup-*`.
- Non-English launcher UIs show this option's new English strings untranslated
  until the translation catalog gains them.
