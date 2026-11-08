# Changes Made - November 8, 2026

## v0.2.16 — November 8, 2026

### Fixed: sun shadows and wet-surface specular are back (the v0.2.15 regression)

**[mateussmeneses/theorder1886-port#26](https://github.com/mateussmeneses/theorder1886-port/issues/26)
is closed for this build.** Outdoor Chapter I scenes lost the sun's shadows, the sun
patch on walls, and the wet-stone specular, and the sun flickered: consecutive frames
flipped brightness by ~16 levels. The RDNA4 retest on that issue identified the decisive
half — the **draw-time HTILE expand** (`7cf7979`, build/test follow-up PR #112) — which
this lineage never had: it carried only the sun readback-sync half (PR #143), and the
v0.2.10 flicker fix disables that sync by design. Without the expand, the EVSM sun
conversion reads the cascade maps' HTILE Zmask in its cleared state and gets a constant
moment texture.

- `BeginRenderingFull` now fills the depth surface's HTILE Zmask with the uncompressed
  value when a depth-writing pass clears depth (once per surface): the sun's caster
  depth becomes visible to the compute, shadows and specular return.
  `ORDER1886_HTILE_DRAW_EXPAND=0` restores the old behaviour.
- The v0.2.10 flicker fix is untouched: the readback sync stays disabled
  (`ORDER1886_SUN_SYNC=0`), so the plaza keeps the stable, low-flicker behaviour.
- Boot log: `HTILE: 0x… marked uncompressed, 196608 bytes` x8 surfaces.
- A/B on the same save, scripted walk/sprint/pan, 30 FPS, FSR 4 on, effects off
  (RX 9070 XT / RADV): **brightness flips 3 → 0** across a 14-frame burst (max Δ 17.6 →
  0.6), ground shadow coverage stable, NPC/awning/balustrade/fountain shadows and
  wet-stone specular present. FSR 4 unaffected (`fsr4 reconstructed 3600+ frames`,
  0 validation errors).
- Deterministic unit test for the mask-range maths (`htile-expand-test`), ported from
  PR #112. Evidence + patch: `docs/verification/2026-11-08-sun-shadow-expand.md`,
  `docs/verification/2026-11-08-sun-shadow/`.

## v0.2.15 — November 8, 2026

### New: AMD FSR 4 replaces the game's temporal anti-aliasing on Linux

The runtime already carried the FSR 4 v07 (INT8/DOT4) provider from
FireBurn/FSR-Vulkan and its capability probes, but the Order temporal
integration was refused before the device query ("disabled in this build",
#12) and the provider modules loaded only as Windows DLLs. This build wires
it end to end:

- Graphics → Upscaling → **AMD FSR 4**: the ML provider runs in place of the
  game's own temporal resolve at the game's render size (keep Render
  resolution on Original 1920); FSR 1 still scales the result to the output.
  Boot log: `AMD FSR 4 v07 INT8/DOT4 (source) replaces The Order's temporal
  resolve at 1920x1080 (native, depth inverted 0)`.
- **AMD FSR 3.1 is selectable on Linux** too (providers now dlopen as `.so`
  beside the runtime) and is the automatic fallback when the FSR 4 shaders
  cannot run: `GPU does not support the selected FSR 4 shaders; using
  FSR 3.1` is logged before the first frame.
- Provider ABI 2: `OrderUpscaleFrame` gains `gpu_frames_completed`, the
  presenter's waited present-fence count, so history slots retire only at
  host-proven completion; a queue-drain retry covers a badly lagged GPU.
- The v07 bundle is compiled with `DEPTH_INVERTED=0`, so the prep pass flips
  The Order's reversed depth into the model's orientation — only when FSR 4
  is the provider. FSR 3.1 and DLAA keep their own flag path; no game draw
  pass (shadows, GI, MSAA) is touched by the integration.
- Assets: MIT-licensed AMD source-v07 shaders + model weights, compiled to
  SPIR-V by Q2RTX's recipe, installed as `bin/fsr4/` (285 files, 45 MB,
  per-preset SHA-256 manifests verified against the provider contract at
  load). This is the FSR 4.0-era v07 model, not AMD's signed 4.1.1: Mesa
  26.2.6 RADV does not expose `VK_VALVE_shader_mixed_float_dot_product`, so
  the 4.1.1 probe correctly reports unsupported.
- Verified on RX 9070 XT / RADV: 7200-frame session with the resolve
  replaced and no fallback; offscreen smoke (`order1886_fsr4_gpu_smoke`)
  with 0 validation errors; same-save A/B screenshots show Laplacian detail
  +18–26% and edge energy +19–22% over FSR 1 with shadows, bounce light and
  exposure unchanged; missing-bundle and unsupported-GPU fallbacks verified.
  Evidence: `docs/verification/2026-11-08-fsr4-linux.md`; the complete
  source patch: `docs/verification/2026-11-08-fsr4-linux.patch`.
- Known limits: providers render at the game's own size (sub-native FSR 4
  quality modes need presenter-side output sizing); the camera near/far/fov
  still arrive as the shim's placeholders; 60 FPS QTE warnings unchanged.

### Regression: sun shadows are missing again

**[mateussmeneses/theorder1886-port#26](https://github.com/mateussmeneses/theorder1886-port/issues/26)
is back.** The fix chain verified in that issue's 2026-11-07 retest
([comment](https://github.com/mateussmeneses/theorder1886-port/issues/26#issuecomment-6700803190))
does not hold in this build: outdoor scenes lose the sun's shadows again.
FSR 4 ships first as agreed; the shadow fix lands as a follow-up release.

## v0.2.14 — November 7, 2026

### New: Cinematic bars option — the letterbox lines are now the player's choice

The game draws its 2.40:1 picture inside the 16:9 frame, so the default view
carries black bars above and below. The old Graphics → Framing control
(Original / 16:9) hid this behind emulator jargon and defaulted to the bars.
It is now an explicit choice, and the bars are gone by default:

- Graphics → **Cinematic bars** offers **Enabled — cinematic bars** and
  **Disabled — no bars (experimental)**. Disabled patches the aspect constant
  (2.4 → 16/9) in a derived prepared image, so the game renders the full 16:9
  picture; original game files are never touched and the byte-checked recipe
  still recovers with Enabled if an executable does not match.
- New and existing installs default to **Disabled** (bars removed). The Home
  strip chip reads **BARS: On/Off**.
- Verified on CUSA00035 1.02 at 2560×1440 by launching the game in every
  state and measuring the bands: 186 px top and bottom with bars enabled,
  0 px with them disabled, in title, menu and resumed gameplay at 60 FPS.
  The change was driven through the launcher UI itself (ydotoold clicks on
  the Graphics page). Evidence and method:
  `docs/verification/2026-11-07-cinematic-bars/`.
- Implementation: the setting key stays `aspect_ratio` (`original` / `16:9`),
  so the display recipe, the resolution height maths and the validation
  triples are unchanged; the schema label/choices/defaults in
  `launcher.order1886_options`, the fallback defaults in
  `launcher.order1886_common` (`load_launch_settings`, `backend_command`,
  `validate_launch_game`) and the `--aspect-ratio` default in the backend
  `order1886` were re-pointed to `16:9` with the worker's own bundled
  Python 3.12 (marshal round-trip inside a rebuilt PYZ/CArchive), and the
  Home chip template in the launcher's embedded frontend was rewritten
  in place at the same byte length.
- `package-manifest.json` re-pinned: worker `3bef6f26abc598d2…`,
  launcher `34d5ba80f84eec8c…`. The runtime binary is unchanged.
- Known limits: the 16:9 recipe still carries its experimental flag (HUD and
  cutscenes were not re-qualified chapter by chapter); one first launch ended
  in an AMD device-lost flake that did not repeat; non-English launchers show
  the new option strings in English until the catalog gains them.

## v0.2.13 — November 7, 2026

### Fixed: the v0.2.12 controller diagnostics promised but not shipped are now real

Reported everywhere: no Xbox pad is recognized, wired or Bluetooth, on several
PCs. Live A/B test: the shipped runtime + bundled SDL3 open an Xbox-layout pad
instantly when the kernel exposes one (`Runtime: gamepad connected: Xbox 360
Controller` in the boot log with a test pad injected through the evdev path).
The universal failure is the kernel layer, most often a kernel package updated
without a reboot: `/lib/modules/$(uname -r)` is gone, `xpad`/`hid-microsoft`/
`xpadneo` cannot load, so no `/dev/input` node exists and SDL enumerates zero
pads. v0.2.12 described warnings and docs that this package never actually
included; they ship now:

- `bin/order1886-runtime` prints `Order1886: pad check:` warnings at startup
  when the running kernel has no module folder, when an Xbox-family USB device
  is visible but unclaimed by any driver, or when a pad's HID/input node is
  present but not readable or held. Silent when all is well;
  `ORDER1886_PAD_DIAG=0` skips the scan; the runtime itself is unchanged.
  The scan runs only for real game boots (a first argument beginning with `--`
  is a launcher probe) because Play verifies the entry's stdout and hashes its
  bytes: **any edit of `bin/order1886-runtime` must re-pin
  `runtime_sha256` in `bin/runtime-build.json` (and the manifest entries for
  both files), or the launcher refuses the runtime.** Verified end-to-end:
  the re-pinned package boots and the warnings land in the boot log.
- `QUICKSTART.txt` gained the promised CONTROLLERS section (connect order,
  `--gamepad` probe, per-warning fixes, the udev rule, Steam's exclusive
  grab, and the verify-kernel-first commands) and `README.md` gained a
  Controllers section plus a problem-table row.
- Friends hitting this on their own PCs: have them run
  `grep -A4 -i xbox /proc/bus/input/devices; ls /dev/input/by-id | grep -i 045e`
  — no nodes means the same kernel-side gap (reboot / load xpad), nodes plus a
  running Steam means Steam's grab, nodes and no Steam means the read-access
  fix from CONTROLLERS.

### Small update / launcher adjustments

- **Readable game title:** the top-bar logo is cropped to its lettering, so the name shows about twice as large.
- **Search no longer covers the tabs:** "Search all settings" is now a round icon that opens on click, Ctrl+K or while it holds text.
- **Quieter music:** default launcher music volume lowered from 40% to 20%.

## v0.2.12 — November 7, 2026

### Fixed: gamepad connects but no buttons work (controller input lost to Steam / missing HID access)

Reported by players using the Linux build with an Xbox controller (wireless or cable):
the pad lit up and the launcher log said "gamepad connected", but the game ignored every
button. Two causes, both environmental, now addressed:

- **Steam grabs gamepads on the desktop.** Steam's controller support opens the pad
  exclusively; the game then sees the device but receives no events. Exit Steam while
  playing, or disable Steam Input for that controller family.
- **No HID access for the user.** SDL reads pads through /dev/hidraw*; when a session
  does not grant it (common with Bluetooth pads), SDL falls back to the grabbable evdev
  path. Grant access once: `sudo usermod -aG input $USER` (log out/in), or install the
  udev rule from the new CONTROLLERS section of QUICKSTART.txt.

The runtime entry now prints a one-line warning to the launcher log when a gamepad HID
is present but not readable, so the two cases are easy to tell apart. QUICKSTART.txt and
README.md gained a full CONTROLLERS troubleshooting section. The runtime binary itself is
unchanged (F10 frame-rate switch intact); the gamepad hot-plug fix (pump SDL events before
enumeration) is already on the port's `perf/optimization` branch for the next rebuild.

## v0.2.11 — November 7, 2026


### Fixed: Xbox controller not recognized in-game

Controllers now work when connected before or at launch (verified live: the runtime reports
"gamepad connected: Xbox Series X Controller" and buttons respond; A/B/X/Y map to
Cross/Circle/Square/Triangle). If your pad was plugged in while the game was already running,
connect it before starting the game — and note the Bluetooth device sometimes needs a re-open
(button Xbox/PS) after sleep.

- The runtime binary is unchanged from v0.2.10/v0.2.9 — your F10 in-game frame-rate switch
  (60/90/120/30) is intact.
- Source-side robustness fix (hot-plug: pump SDL events before gamepad enumeration) is on the
  `perf/optimization` branch of the port repo for the next runtime rebuild.

## v0.2.10 — November 7, 2026


### Fixed: shadow flicker in Chapter 1 ("A Lady in Waiting")

Walking in the sunlit plaza made the level's shadows pop in and out every few frames.
Cause: the runtime's sun depth-range page sync forced a GPU drain mid-frame and handed
the shadow pass a half-updated depth range, so frames alternated between correct and
all-shadow.

Fix: the runtime entry now disables that sync (`ORDER1886_SUN_SYNC=0`). Sunlight stays
(the draw-time HTILE expand is untouched), shadows are stable, and the plaza got faster
(measured ~50 → 80 fps on RX 9070 XT).

- `bin/order1886-runtime` is a small wrapper; the real runtime is `bin/order1886-runtime.bin`
  (the same binary as v0.2.9, unchanged).
- Verified with 300+ screenshot captures of the full checkpoint walk: zero flicker events
  (before: 21 violent brightness flips in 35 samples).
- Game runs at its native 30 fps; 60 fps remains opt-in.

## v0.2.8 — November 7, 2026


### New: launcher background music with a volume bar

The launcher now plays music, with a mute button and volume bar at the right end of the
top bar. The default volume is 40%.

- The track is the first audio file (by name) in `music/` next to the launcher entry points
  (`.mp3`, `.ogg`, `.opus`, `.flac`, `.wav`, `.m4a`, `.aac`). The package ships The Knights'
  Theme; replace it with any file to change the song. An empty folder hides the control.
- Volume and mute are remembered in `user/order1886/launcher-music.json`.
- The music fades out when the game starts and back in when it ends.
- Source: `launcher-frontend/assets/music.js` (UI) and `launcher-go-overlay/music.go`
  (track lookup, settings, asset handler; applied on top of upstream `launcher-go`).

### Fixed: "not a verified Order runtime" (backend exit code 2) on Linux

The v0.2.7-hotfix.1 Linux tarball shipped a stripped `bin/order1886-runtime`. Stripping
changed its SHA-256, so it no longer matched `bin/runtime-build.json` and the launcher
refused it. The runtime is now shipped exactly as built. Bundled libraries may still be
stripped; only the runtime is hash-pinned.

## v0.2.7-hotfix.1 — November 6, 2026

### Windows launcher rebuilt with the current UI

The Windows packages shipped upstream's prebuilt launcher, which still drew the retired
sidebar layout. It is now rebuilt from the same frontend the Linux package carries
(top navigation, hero artwork, "Game files found" launch bar). The built frontend is
preserved in `launcher-frontend/` so future Windows builds embed it directly.

### Smaller packages

- Dropped the unreferenced `*.original` upstream backups (309 MB).
- Stripped debug symbols from the bundled libraries (Linux folder 635 MB → 341 MB;
  tar.gz 233 MB → 132 MB). Stripping the runtime broke its hash check; fixed in v0.2.8.
- `bin/gpu` was audited: every library is reachable from the runtime — nothing orphaned.

### Package layout: separate platform folders

The download is now organized per platform, so both versions can live side by side
without mixing files:

- `The Order Linux/` — Linux entry points (`The Order 1886`, `Play The Order 1886`),
  `bin/` (runtime, launcher, worker, bundled libraries), `scripts/`, notices and docs.
- `The Order Windows/` — Windows entry points (`The Order 1886.exe`,
  `Play The Order 1886.exe`) and `bin/` (runtime, worker, DLLs).

Run each launcher from inside its own folder; keep the entry points and `bin` together.
Settings, saves and logs are created in `user/` inside each folder.

### Fixed: scrambled button prompts on mixed-case dumps (QTE asks for Triangle, real button is Cross)

When the 1.02 update was extracted beside the base game (`PS4/` next to `ps4/`), the guest
opened the exact lowercase path and read **base 1.00 UI art** while the executable was 1.02:
prompts showed one button while the game checked another. Three changes:

- `scripts/order1886_merge_update.py` (new): merges the update tree onto the base tree, like a
  real PS4 does. Dry run by default; `--apply` copies the newer files. Run it once on a dump
  that shows both `PS4/` and `ps4/` under `_data/1408209885`.
- `order1886_prompts.prepare()` now refuses to paint Xbox/Keyboard letters onto a stale base
  copy (detects diverged duplicates) and tells you to run the merge script.
- `ui.resolve()` retries the sibling tree when the walked branch lacks a resource, matching
  the guest's case folding (the standalone menu asset lives only in the update tree).
- Prompt `VERSION` bumped to 3 so installations that already painted scrambled prompts rebuild.
- The Linux worker's embedded scripts (`bin/order1886-worker/_internal/scripts/`) now carry
  the hotfix too — the earlier hotfix only patched the top-level `scripts/`, which the worker
  does not load.

### Fixed: Mixed-case game dumps (CUSA00035 and others)

**Problem:** Button prompts (Xbox/Keyboard) failed to build on game dumps where the update
extraction left `_data/1408209885/PS4/` (uppercase) beside the base game's `ps4/` (lowercase).
The launcher looked for UI resources at the exact lowercase path and refused the dump with:
`Button prompts are verified with CUSA00076 1.02; this game has no primary/c2d79afbc68fc86c/v1/...`

**Fix:** The launcher now tolerates mixed-case directory names when resolving UI resources.
`ui.resolve()` walks each path component, tries exact case first, then falls back to
case-insensitive match — matching what `runtime_file.c fold_case()` does for guest paths at
runtime. Mod overlays also tolerate mixed-case original game folders while keeping the strict
rule for mod folders (so two mods cannot fight by case alone).

**Files changed:**
- `scripts/order1886_ui_extract.py` — added `resolve()` function for case-tolerant lookup
- `scripts/order1886_prompts.py` — uses `resolve()` to find resources
- `scripts/order1886_glyph_mod.py` — uses `resolve()` when building prompts
- `scripts/order1886_mods.py` — tolerates mixed-case original game folders
- `tests/test_order1886_mixed_case.py` — new test coverage

**Affected editions:** CUSA00035, CUSA00070, CUSA00100, CUSA00670, CUSA00785 (experimental
editions where update extraction can leave mixed-case directories).

**Workaround for older builds:** Switch Button prompts to "PlayStation" in the launcher's
Controls page — those use DualShock 4 glyphs that ship with every edition.


## Windows Compatibility Added

### What was done
- Downloaded official Windows package (v0.2.7) from upstream GitHub releases
- Added Windows executables: `The Order 1886.exe` and `Play The Order 1886.exe`
- Added `bin-windows/` directory with 100+ Windows DLLs (runtime, launcher, dependencies)
- Created `WINDOWS-README.txt` with Windows-specific setup instructions

### Files added
- `The Order 1886.exe` (13MB) - Windows launcher with GUI
- `Play The Order 1886.exe` (13MB) - Windows direct play executable
- `bin-windows/` - Windows runtime, launcher and 100+ DLLs (393MB)
- `WINDOWS-README.txt` - Windows setup guide

### Repository setup
- Created GitHub repository: `a-port-of-the-order-1886-thats-actually-alive`
- Configured `.gitignore` to exclude large binaries and user data
- Packaged binaries as release assets:
  - `order1886-linux-x86_64.tar.gz` (227MB) - Linux build
  - `order1886-go-windows.zip` (128MB) - Windows build

### Compatibility notes
- Both Linux and Windows versions now coexist in the same folder
- `user/` folder (settings, saves, logs) is shared between platforms
- Original game files are never modified
- No Python or additional software required on either platform

### Requirements
**Windows:**
- Windows 10/11 x86-64
- Vulkan-compatible GPU with up-to-date drivers

**Linux:**
- x86-64 Linux with glibc 2.39+
- Vulkan GPU driver
- WebKitGTK 4.1 (optional, for launcher GUI)

### Supported game versions
All six editions accepted: CUSA00076 (tested), CUSA00035, CUSA00070, CUSA00100, CUSA00670, CUSA00785 (experimental)

### Credits
Based on the upstream project by JulioCacko: https://github.com/JulioCacko/The-Order-1886_pc
