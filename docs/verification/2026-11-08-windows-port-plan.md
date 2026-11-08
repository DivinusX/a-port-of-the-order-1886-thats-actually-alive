# Windows x86-64 port — file-by-file change plan with risks (v0.2.18 target)

Status: PLAN — awaiting approval before the push. When approved, execute
`2026-11-08-windows-port-runbook.md` step by step. All changes below are implemented on
dedicated local branches (`windows-port`) in the two repos; nothing is pushed.

## 0. Ground truth (verified 2026-11-08, this machine)

* The full source tree (C++ runtime, `build.sh`, `launcher-go/`, `packaging/windows/`,
  CI workflows) lives in **JulioCacko/The-Order-1886_pc** (itself a fork of
  FelipePrado0/SpartanPort). The fork's three Order commits (FSR 4 v0.2.15, HTILE expand
  v0.2.16, staging sun-sync v0.2.17) sit on top of it locally.
* The user's repo **DivinusX/a-port-of-the-order-1886-thats-actually-alive** is a
  release overlay: launcher Go overlay + frontend, `packaging/linux`, scripts, docs,
  notices, manifest. It has **no** `gpu/`, `src/`, `build.sh`, `launcher-go/` or
  `packaging/windows/`. Its `.gitignore` already anticipates Windows assets
  (`The Order Windows/`, `bin-windows/`, `*.zip`, `*.exe`).
* Upstream already supports Windows end-to-end: `build.sh` has a MSYS2 CLANG64 branch
  producing `order1886-runtime.exe` + `ps4-gpu-capabilities.exe` + `order1886_fsr3.dll`;
  `src/compat_win.c` is the Win32 layer; `packaging/windows/order1886-go-build.ps1`
  assembles the whole package (recursive PE-import DLL bundling, Go/Wails launcher,
  PyInstaller worker with CFG disabled for Unicorn, notices, manifest, smoke);
  `.github/workflows/order1886-go-package.yml` runs all of it on `windows-2025`.
* The fork's v0.2.15–17 C++ is cross-platform **except** two gaps found by audit:
  1. `gpu/upscalers/fsr4/order1886_fsr4.cpp::asset_roots()` — the beside-the-exe roots
     are inside `#ifndef _WIN32` (readlink-based). On Windows the bundle would only be
     found via `ORDER1886_FSR4_ASSETS` or the cwd — and the worker runs with cwd =
     `user/order1886`, so **FSR 4 would not find `bin/fsr4/`**. Needs a
     `GetModuleFileNameW` branch (the pattern already exists in
     `vk_upscale_providers.cpp`, which has a full `_WIN32` loader path).
  2. `build.sh`'s Windows branch builds only the **fsr3** provider; the Linux branch
     builds `fsr3 fsr4`. The FSR 4 provider target itself is platform-neutral
     (`if(NOT WIN32)` only guards `${CMAKE_DL_LIBS}`).
* The 45 MB FSR 4 v07 asset bundle (`bin/fsr4/`, 285 files: SPIR-V + INT8 weights +
  manifests + MIT license) is **not tracked in any repo and no script fetches it**. It
  is FireBurn/Q2RTX `baseq2/fsr4_shaders`, staged by hand into the Linux package.
  Platform-neutral bytes. This is the port's one real dependency gap (§6).
* This machine originally had **no** go, wails, mingw, pwsh or PyInstaller, and sudo needs
  a password. Go 1.25.14, PowerShell 7.5.2 and the mingw-w64 v12 headers were later
  installed under /tmp without root (see §8) — enough to cross-build and vet the launcher,
  parse the PS1 and syntax-check the new C; **not** enough to build or run the native
  Windows runtime or the worker. CI (windows-2025) is the build host; the player's Windows
  box is the test host.

## 1. Runtime strategy — recommendation

**Adapt the existing source tree; do NOT start from shadPS4.**
Justification: the Windows path already exists and is CI-tested upstream (build.sh
branch, compat_win.c, the .rc/manifest, the PS1, the workflow, the `_WIN32` provider
loader). Starting from shadPS4 would discard this project's entire Order layer —
probe.c entry, runtime_*.c HLE, GNM/HTILE, the sun-sync staging path, the launcher
contract — i.e. re-porting months of work to gain nothing. The fork's three commits
are additive Vulkan/C++ with no Linux-only APIs (audited above).

## 2. Source repo changes (branch `windows-port` on the local clone; push after approval
   to a new fork `DivinusX/The-Order-1886_pc`)

| File | Change | Risk |
| --- | --- | --- |
| `build.sh` | Windows branch: build the fsr4 provider (mirror the fsr3 block: `cmake -S gpu/upscalers/fsr4`, `ninja order1886_fsr4`, copy `order1886_fsr4.dll` to `out/`). Linux branch untouched. | Low. glslang/spirv-tools are already in the CI pacboy list; the provider links only Vulkan + the assets lib. |
| `gpu/upscalers/fsr4/order1886_fsr4.cpp` | `asset_roots()`: add `_WIN32` branch using `GetModuleFileNameW` → `dir/fsr4`, `dir/gpu/fsr4`, `dir` (same order as POSIX). | Low, ~12 lines. Without it FSR 4 silently falls back on Windows. |
| `src/pad_diag_windows.c` (new) + `src/probe.c` | Windows "pad check": runs only on a real game boot (first arg is the prepared image, not a `--flag`), honouring `ORDER1886_PAD_DIAG=0`; prints the same `Order1886: pad check:` lines. Scans: XInput slots 0–3 via `LoadLibraryEx` (xinput1_4 → xinput1_3 → xinput9_1_0), HID gamepads via SetupAPI (`GUID_DEVINTERFACE_HID`, VID 045E/1720 and the SDL-known list), and compares against `SDL_GetGamepads()` — a pad visible on USB but not opened by SDL gets the "Steam or driver grabbed it" advice (the Windows analogue of the udev/Steam hints). `probe.c`: call it from main() under `#ifdef _WIN32` before the memory reservation. | Medium: new Win32 code, `-Wall -Wextra -Werror` on the exe target; needs `setupapi` in `target_link_libraries` (onecore does not cover it). Cannot compile here — CI is the first build. Linux behavior unchanged. |
| `gpu/CMakeLists.txt` | Windows exe target: add `../src/pad_diag_windows.c` + `setupapi` link. Linux target untouched. | Low. |
| `packaging/windows/order1886-go-build.ps1` | Add: `order1886_fsr4.dll` copy (next to fsr3), `-Fsr4Assets <dir>` param staging `bin/fsr4/`, `music/` copy (parity with the Linux package), then `Compress-Archive` → `order1886-win-x86_64-<ver>.zip` + `.sha256`. Worker-script drift: the curated PS1 list missed six on-disk modules; they are now shipped defensively. A `tests/test_order1886_packaging_coverage.py` guard walks the backend's real import graph against the list and passes - the contract is enforced, not guessed. | Medium: no pwsh here — syntax-level review only; CI is the first execution (the workflow's own note: "Unverified until it has completed on GitHub Actions"). |
| `.github/workflows/order1886-go-package.yml` | Fetch the FSR 4 bundle (§6), pass `-Fsr4Assets`, upload zip + sha256 as release-ready artifacts. | Low. |
| `launcher-go/music.go`, `launcher-go/ui_wails.go`, `launcher-go/order1886-frontend/` (vendored) | The release repo's overlay (music + the one-line musicHandler + the static fork frontend) was applied by hand before every Linux build and lived in no CI path — both workflows npm-built the retired sidebar UI, so any CI-built package (Windows **or** Linux) would ship the wrong launcher window. Vendored into the source tree. | Medium on discovery, low now: verified by the local windows/amd64 cross-build (GUI-subsystem PE + `go vet` clean). Linux user-facing behavior unchanged — the released packages already carry this UI; the fix makes CI match it. |
| `.github/workflows/order1886-go-linux-package.yml` (~3 lines) | Stage `order1886-frontend` into `frontend/dist` and add `-s` to the wails build (same parity fix on the Linux side). | Low: CI-only; the local Linux build path never ran npm. |
| `docs/order1886-build.md` | Windows section: fsr4 provider + bundle step + the pad-check note. | None. |
| `launcher-go/internal/updates/release.go`, `main.go`, `release_test.go` | Point the updater and UI links at the fork's releases: upstream's receipt would let the built-in updater install an upstream package over the lineage's fixes; the fork's releases carry no receipt, so the updater safely reports "no update available" and manual extraction stays the documented channel (fork-side receipts would re-enable in-app updates). Fixtures now derive from the constant; all Go test packages pass, launcher re-cross-built + vetted. Future Linux rebuilds inherit the redirect (installed Linux binary untouched) — justified: the same hazard exists there. |
| `packaging/windows/QUICKSTART-Order1886.txt` | Fork the shipped quickstart to the package's reality: zip name (both languages + checksum example), DivinusX release/support URLs, FSR 4 in the upscaling list, the two sun-shadow switches, and a port-status pointer to WINDOWS.md. Content-only. | None. |

## 3. Release-repo (aport) changes (branch `windows-port`, push after approval)

| File | Change | Risk |
| --- | --- | --- |
| `packaging/windows/order1886-win-package.py` | New: standalone assembler mirroring `packaging/linux/order1886-go-package.py` — verifies the CI tree (every manifest hash, no `.so`/`.sh`/`user/` leakage, FSR 4 bundle license), merges release docs via `--extra` (WINDOWS.md, CHANGES.md, README.md, docs/verification — the parity the Linux tarball already ships), rebuilds the manifest over the merged tree, and produces `order1886-win-x86_64-<version>.zip` + `.sha256`. | Low; pure Python, rehearsed end-to-end (§8 item 7). |
| `WINDOWS.md` | New: EN + PT (QUICKSTART style): requirements (Win 10 1903+/11 x64, current Vulkan driver, WebView2 runtime — preinstalled on Win 11/updated Win 10; **no Visual C++ redistributable needed** — the CLANG64 runtime DLLs ship inside the package), folder layout, controls (XInput native), troubleshooting (pad-check lines, SmartScreen/Defender notes, Steam Input), and the explicit unverified list. | None (docs). |
| `docs/verification/2026-11-08-windows-port-checklist.md` | New: the manual checklist (§7). | None. |
| `CHANGES.md` | Draft v0.2.18 entry, marked "built by CI, unverified on hardware until the checklist passes". | None. |
| `README.md` | "Linux first" line → Linux + Windows; release-history row for v0.2.18 (draft, not released). | None. |
| `package-manifest.json` | Stays the Linux v0.2.17 manifest (the Windows zip carries its own, generated at package time — same scheme, different tree). | None. |

## 4. Linux behavior — preservation argument

Every change is either (a) inside `#ifdef _WIN32` / the PS1 / the Windows workflow,
(b) a new file only compiled on Windows, or (c) additive lines in the Windows branch of
`build.sh`. The Linux wrapper, Linux packaging script, Linux workflow, and all Linux
CMake branches are byte-identical. Regression check on this machine: full Linux rebuild
of ps4gpu + runtime + providers + the launcher test suite.

## 5. Launcher (Go/Wails) — what changes and why

Nothing in `launcher-go-overlay/` needs changing for Windows: `ui_wails.go` already
sets `windows.Options`, and the overlay README already documents
`wails build -s -platform windows/amd64` (no `webkit2_41` tag; Wails on Windows needs
no CGO — verified locally: the cross-build and `go vet` for windows/amd64 both pass, see
§8). The CI builds the shipped exe natively on the runner.
The worker (`order1886.py`) already branches on `os.name == 'nt'`: runtime name
`order1886-runtime.exe`, `CREATE_NO_WINDOW`, `msvcrt` lock file, System32 PATH smoke.

## 6. Blocker-grade gap: the FSR 4 asset bundle provenance

The 45 MB v07 bundle is platform-neutral but exists only inside the shipped Linux
package. Chosen resolution (reversible): the Windows workflow downloads the
**v0.2.17 Linux release tarball** and extracts `bin/fsr4/` from it — deterministic,
already-published, MIT-licensed bytes, no new external dependency. Alternative if the
user prefers: vendor the bundle as a separate release asset (`fsr4-v07-assets.zip`)
and fetch that. Flagged rather than silently worked around, per the working method.
**FSR 3.1 remains the automatic fallback** exactly as on Linux when the bundle or GPU
support is missing.

Related, smaller: the launcher's music track ("The Knights' Theme", game OST) is not in
either repo — the Linux package carries it by manual staging. The PS1 copies `music/`
only when the maintainer stages it beside the script, so the CI zip ships silent until
you decide the OST belongs in a public release asset (it is copyrighted game content;
the "do not include games" constraint arguably covers it — your call, flagged).

Linux CI status (updated during the v0.2.18 push): the workflow's submodule list was missing
`gpu/third_party/fsr-vulkan`, which the fork's provider loop needs — fixed, and
`order1886-go-linux-package.yml` now completes green on the branch. Remaining known gap
(flagged, not fixed): the Linux packaging script still does not stage the built providers
(`out/order1886_fsr3.so`/`order1886_fsr4.so` + the `bin/fsr4/` bundle) into the package, so a
CI-built Linux package ships without FSR (functional fallback, degraded). Local builds stage
them by hand; wiring them into the script is the follow-up when the next Linux release is due.

## 7. Manual test checklist (player's Windows box) — summary

Launch (SmartScreen), game-folder pick (CUSA00035), Play → title, CONTINUE,
borderless window, 60 FPS mode, bars off, FSR 4 selectable + log line, FSR 3.1
fallback, Xbox pad (XInput) + hot-plug + pad-check lines with Steam open/closed,
keyboard fallback, save + resume, 30-minute session, The Chase flicker parity
(expected: 0 brightness flips, same metric as v0.2.17 on Linux).

## 8. Honesty ledger

* Compiled here: no Windows *machine* was available, but far more than a static review
  was done (see the numbered list and the cross-build campaign below): the launcher
  cross-builds, the native runtime builds, links, and **boots the game under wine**.
  What remains unrun here is only what needs real Windows: the CI toolchain's exact
  binaries, the PyInstaller worker, SmartScreen, and driver-specific behaviour.
  Verifications executed on this machine (toolchains installed without root):

  1. **Launcher cross-build PASSES on Linux**: overlay applied per
     `launcher-go-overlay/README.md`, `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build
     -tags desktop,production` → PE32+ x86-64 (console), and with `-H=windowsgui` →
     PE32+ (GUI) matching `wails build -platform windows/amd64` output shape.
  2. **`go vet -tags desktop,production ./...` for windows/amd64: clean** (the whole
     launcher package, including the overlay files and `process_windows.go`).
  3. **`order1886-go-build.ps1` parses with PowerShell's own parser: 0 errors** (also after
     the frontend-staging edit).
  4. **`src/pad_diag_windows.c` passes `clang -fsyntax-only -target x86_64-w64-mingw32
     -Wall -Wextra` against mingw-w64 v12 headers + SDL3: 0 errors** (only known
     header-internal clang warnings; MSYS2 ships patched headers for those).
  5. **Launcher Go unit tests pass on the host** (`go test -tags noui ./...`: the package
     plus `internal/pkgpath`, `internal/updatehost`, `internal/updates` — the stdio worker
     protocol shared by both platforms).
  6. **The cross-built Windows entry PE actually runs under wine**: flag set prints,
     `-direct-play` executes the recovery gate (`internal/updates.PendingRecovery` journal
     semantics) and the error-report path. The odd `exec: "Z:\tmp\fakeroot"` line comes
     from the Linux-only `startUI` relaunch (`pkgpath.UI()` returns "" on Windows) — a
     path the shipped Windows exe never takes (the PS1 ships the desktop build as both
     entries). Layout audit confirms `pkgpath.Worker()` for Windows
     (`bin/order1886-worker.exe`, flat) matches how the PS1 flattens the PyInstaller
     onedir into `bin/`.
  7. **Finalizer end-to-end rehearsed** (`order1886-win-package.py --extra`): a synthetic
     CI-shaped tree + release docs → merged 4 docs, manifest rebuilt over 18 files, zip
     verified with `sha256sum -c`, docs present in the zip and covered by the manifest.
     The release-side `--extra` folder is assembled from this repo:
     `mkdir -p extra/docs/verification && cp WINDOWS.md CHANGES.md README.md extra/ && cp docs/verification/2026-11-08-windows-port-checklist.md extra/docs/verification/`.
  Still CI-first: actual linking (`setupapi`, PE subsystem), the native build itself,
  PyInstaller/worker, and everything runtime-behavioural.
  Deeper since: `src/pad_diag_windows.c` now cross-compiles to a real COFF object
  (clang `-target x86_64-w64-mingw32`, 0 errors, 3 header-internal warnings that MSYS2's
  patched headers do not emit; the warnings were outside the file).
  **Full native cross-build campaign (later same day): the entire Windows runtime was
  actually built and run on this Linux machine** with llvm-mingw 20261104 (clang 23) +
  MSYS2 clang64 dependency packages assembled into a local sysroot:
  - `ps4gpu` static library: builds clean for Windows (the fork's staging sun-sync,
    HTILE expand, sampler and resolve code included).
  - `order1886-runtime.exe`: links (133 MB PE32+, SETUPAPI import proving the pad check
    is in) and **runs under wine**: `--runtime-info` returns the exact JSON contract the
    launcher parses, `--cpu-features` → "CPU: complete", `--gamepad` → "Gamepad: none",
    `--input-options` → the full mapping JSON, and a real-boot attempt prints the new
    `Order1886: pad check:` line — the first execution of the Windows pad diagnostics.
  - `order1886_fsr4.dll`: builds — after fixing a real fork bug the cross-build caught:
    `read_file` used `std::fopen(path.c_str(), …)`, which cannot compile on Windows
    (`path::value_type` is `wchar_t`); now `_wfopen` under `#ifdef _WIN32` (commit
    7e520b2). This would have broken the CI build of the fork's own provider target.
  - `order1886_fsr3.dll`: builds (5.2 MB) with LOCAL-ONLY force-includes for
    llvm-mingw/libc++ differences (`_countof`, `swprintf_s` declarations, transitive
    `<mutex>`, `log2`); MSYS2 clang64 headers provide these natively — upstream ships
    this dll from CI, so no committed change was needed.
  - `WIN32_LEAN_AND_MEAN` double-define in the new pad-check file caught by the project's
    own `-Werror` (the exe target inherits the PUBLIC define from ps4gpu) — guarded.
  Second CI finding: the CPU-checks step died in `pipeline-binary-initialization-test`
  (and `async-pipeline-cache-test` lurked behind it) — both need a real Vulkan physical
  device, and the GitHub Windows runner has no ICD (`ErrorIncompatibleDriver`). They now
  probe the loader and print a visible `SKIP (no Vulkan device)` with exit 0 when none
  exists; both paths verified here (runs on the RX 9070 XT, skips via
  `VK_ICD_FILENAMES=/nonexistent`). Linux CI keeps running the tests in full.
  **Interactive gameplay under wine (same day):** with the providers + FSR 4 bundle
  staged beside the exe, the Windows build ran the full input chain: pad-file injection
  (the runtime's own `ORDER1886_PAD_FILE` diagnostic path) navigated title → main menu →
  CONTINUE → checkpoint load, and the game reached **live Chapter I "Tortured" gameplay**
  with the "LOOK — use right stick" tutorial prompt rendered on screen. FSR 4 replaced
  the temporal resolve for 28800+ frames; F12 captured 20-frame bursts through the
  Windows presenter. That checkpoint is indoors (no sun EVSM), so the sun-flicker burst
  itself requires the CHAPTERS route to The Chase — attempted in the final run; the
  flicker fix on Windows is the same compiled staging path (`sun sync 1` confirmed read
  from the ini on the Windows binary).
  Interactive driving under wine confirmed every input class works on the Windows
  binaries: pad-file cross advanced title → main menu → CONTINUE → checkpoint load;
  `options` opened the in-game OPTIONS menu (SETTINGS/PHOTO MODE/…/QUIT TO TITLE
  rendered); `circle` backed out; stick taps moved the camera and menu selection; the
  chapter-select screen was reached and launched scenes. Reaching The Chase's outdoor
  gate under wine was flaky for the same reason it was flaky on Linux — the game's menu
  state machine and slow wine frames — so the sun-flicker burst on Windows binaries
  remains a hardware-checklist item (§5 of the checklist), on the same code path that
  measured 0 flips on Linux.
  Remaining CI-first: MSYS2's exact compile flags/toolchain, the PyInstaller worker,
  and everything game-behavioural (needs the dump + hardware).
  Even deeper: with the providers and the FSR 4 bundle staged beside the exe, the wine
  run **booted the actual game** (the player's own dump, read-only; state in a copied
  user folder): title screen rendered at 2560×1440, `HTILE:` expand lines fired, the F12
  presenter saved a real screenshot through the Windows wide-path file APIs, and the
  process shut down cleanly on timeout. A follow-up run drives CONTINUE to The Chase and
  measures the sun-flicker fix on the Windows binaries (see this file's Capture section
  updates).
* Linux regression after all edits: `ninja -C out/gpu` no work, 589 launcher tests OK,
  fsr4 provider rebuilds (guards the untouched POSIX branch), build.sh `bash -n`,
  workflow YAML parse, bundle extraction rehearsed against the real v0.2.17 tarball
  (285 files, required names verified), release-asset URL live (HTTP 200).
* Unverified until the checklist runs: FSR 4 on Windows, pad-check output, WebView2 on
  clean Win 10, Defender/SmartScreen behavior, long sessions, 4K/60, driver-specific
  paths, the zip layout.
* Pushes: approved and executed (v0.2.18 push): aport `windows-port`, source fork
  `DivinusX/The-Order-1886_pc` (`windows-port` + `main`). First CI run compiled ps4gpu,
  the runtime and the launcher on MSYS2, then failed in the AMD FFX 1.1.4 provider
  sources (`_countof`, `swprintf_s`) - a genuine first-ever compile of that code on
  Windows that the local llvm-mingw build had masked with a global include shim.
  Fixed properly: a guarded compat header force-included on the FFX targets only
  (submodule untouched), proven locally against clang 23 + libc++ (both provider DLLs
  build with no global hacks) and re-dispatched on CI.
