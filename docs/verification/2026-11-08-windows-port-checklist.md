# Windows x86-64 port — manual test checklist (v0.2.18 candidate)

Pre-verified off Windows (Linux cross-build + wine, 2026-11-08): the runtime exe boots the
game to the title screen and renders it (2560×1440 screenshot captured through the F12
presenter), `HTILE:` expand lines fire, and **AMD FSR 4 v07 runs on the Windows binaries**
(provider DLL loaded, bundle discovered beside the exe, 18000+ reconstructed frames on
winevulkan/RADV). The items below are still the real gate — wine is not Windows.

Run on a physical Windows 10 (1903+) and Windows 11 machine, x86-64. Record pass/fail per
line with the GPU, driver version and OS build. The newest `-boot.log` from `user/order1886/logs`
after each section settles most disputes.

## 1. Package integrity (before first launch)

- [ ] `sha256sum -c order1886-win-x86_64-v0.2.18.zip.sha256` (or `Get-FileHash`) matches
- [ ] Zip extracts to a single root folder `The Order 1886/` containing both `.exe` entries,
      `bin/`, `docs/`, `notices/`, `LICENSE`, `QUICKSTART.txt`, `README-Order1886.txt`,
      `WINDOWS.md`, `CHANGES.md`, `README.md`, `package-manifest.json` (release docs are
      injected by `order1886-win-package.py --extra`; `music/` only if the maintainer
      staged it — see plan §6)
- [ ] `bin/` contains `order1886-runtime.exe`, `order1886_fsr3.dll`, `order1886_fsr4.dll`,
      `fsr4/` (with `LICENSE-FSR4-v07.txt`), `order1886-worker.exe` + `_internal/` (the
      Windows onedir is flattened into `bin/`, matching `pkgpath.Worker()`),
      `runtime-build.json`, and every non-system DLL the loader needs (libSDL3.dll etc.)
- [ ] No `user/` in the zip; no `.so` or `.sh` anywhere

## 2. First launch and game detection

- [ ] SmartScreen: "More info → Run anyway" path works; note exact wording seen
- [ ] `The Order 1886.exe` opens the launcher window (WebView2 present)
- [ ] Game & Content → pick folder containing `eboot.bin` → detected with correct title/CUSA
- [ ] Wrong folder (no `eboot.bin`) is refused with a clear message
- [ ] `user/order1886/` appears next to the launcher with `settings.json` after saving
- [ ] Launcher closes cleanly; state survives relaunch

## 3. Play path

- [ ] `Play The Order 1886.exe` boots the saved game folder without the window
- [ ] Borderless window opens at the configured size; alt-tab returns to it
- [ ] Title screen shows; ✕ (keyboard space or pad) advances to the menu
- [ ] CONTINUE loads the checkpoint; in-game menu (Options) opens
- [ ] Exit from the launcher stops the game without orphan processes (check Task Manager)

## 4. Graphics options

- [ ] Upscaling = **AMD FSR 4**: boot log line `Upscaler: AMD FSR 4 v07 INT8/DOT4 (source)
      replaces The Order's temporal resolve` — on a GPU lacking DOT4, expect the documented
      fallback line to FSR 3.1 instead; both are passes
- [ ] FSR 4 bundle missing (rename `bin/fsr4`): runtime reports it and falls back, no crash
- [ ] Render resolution 3840: log shows the native 4K size; frame rate drops but no artifacts
- [ ] **Sun shadow readback sync = Staging** (default): The Chase checkpoint — shadows and
      sun patches stable; `Readback sync:` registration lines present in the boot log
- [ ] Sun shadow sync = Synchronous drain / Off: both selectable, game still boots
- [ ] HTILE draw expand on: `HTILE: … marked uncompressed` lines present
- [ ] Cinematic bars: absent by default, toggle works
- [ ] Frame rate: 30 stable; 60 FPS experimental — record drops/QTE behaviour, not a gate

## 5. Gamepads and pad check

- [ ] Wired Xbox pad: opens at boot; `Order1886: pad check: 1 gamepad(s) ready, XInput slot(s): 0`
- [ ] Wireless Xbox (adapter or BT): same
- [ ] DualSense/DualShock: detected; button prompts follow the pad
- [ ] Hot-plug: unplug/replug mid-session re-detects without restart
- [ ] Steam running with Steam Input ON: pad-check prints the "cannot open it / quit Steam"
      advice line; quitting Steam makes the pad work
- [ ] No pad at all: keyboard space=✕, Enter=Options play through; pad check says so
- [ ] `ORDER1886_PAD_DIAG=0` (set in a cmd window before launching the exe) skips the check

## 6. Saves, resume, audio

- [ ] Save in-game, quit, relaunch, CONTINUE restores the checkpoint
- [ ] `user/order1886/saves` (or save_backup dir) populated; original game folder untouched
      (compare a few file hashes before/after the session)
- [ ] Audio plays; no crackle after 10 minutes
- [ ] Launcher music plays when `music/` present; volume slider persists

## 7. Long session and stress

- [ ] 30-minute continuous play (The Chase + Chapter I courtyard): no crash, no memory creep
      (Task Manager private bytes stable within a few %), no flicker regression
- [ ] 4K + FSR 4, 15 minutes: record average FPS and any driver timeout (TDR) events
- [ ] Window resize/minimize/restore cycle ×10 without corruption

## 8. Uninstall parity

- [ ] Deleting the extraction (after copying `user/order1886` out) leaves nothing behind;
      a fresh extraction with the copied `user` folder resumes settings and saves

## Reporting

Any failure: attach the newest `user/order1886/logs/*-boot.log`, the OS build, GPU + driver,
and the checklist line. Do not attach game files.
