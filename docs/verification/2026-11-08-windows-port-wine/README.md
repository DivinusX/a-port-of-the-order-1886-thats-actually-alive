# The Windows binaries running under wine (2026-11-08)

Frames captured with F12 through the runtime's own Windows presenter, from
`order1886-runtime.exe` cross-built on Linux (llvm-mingw + MSYS2 clang64 packages)
and booted under wine against the player's own dump (read-only).

- `chapter1-gameplay.png` — live Chapter I "Tortured" checkpoint: character, cell
  bars, the "LOOK — use right stick" tutorial prompt. Reached by pad-file input
  injection (title → main menu → CONTINUE → load).
- `pause-menu.png` — the in-game OPTIONS menu opened via the injected `options`
  button, with the game world behind it.

AMD FSR 4 v07 replaced the game's temporal resolve for 28800+ reconstructed frames
across these sessions (`Upscaler: fsr4 reconstructed …` in the session logs);
`HTILE:` expand lines fired; `sun sync 1, htile expand 1` was read from
`runtime.ini` by the Windows binary. wine is not Windows — these prove the build
and the input/render pipeline, not the final hardware behaviour.
