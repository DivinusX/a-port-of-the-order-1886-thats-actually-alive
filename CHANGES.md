# Changes Made - November 7, 2026

## v0.2.11 — November 7, 2026

### Fixed: Xbox controller not recognized when plugged in after the game starts

Gamepads connected while the game was already running stayed invisible: the pad read path
asked SDL for the device list without processing events first, and SDL only adds a new
controller during event pumping. The runtime now pumps before enumerating, so hot-plugged
Xbox (and any SDL gamepad) controllers are picked up within a frame. Controllers connected
before launch keep working as before; the button layout is unchanged (A/B/X/Y map to
Cross/Circle/Square/Triangle).

- The runtime binary in `bin/order1886-runtime.bin` was rebuilt with this fix.
- The flicker fix from v0.2.10 is unchanged (`bin/order1886-runtime` wrapper).

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
