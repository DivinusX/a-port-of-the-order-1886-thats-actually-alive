# Windows x86-64 port — file-by-file change plan with risks (v0.2.18 target)

Status: PLAN — awaiting approval before the push. All changes below are implemented on
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
* This machine has **no** go, wails, mingw, pwsh or PyInstaller, and sudo needs a
  password: no Windows binary can be compiled or run here. CI (windows-2025) is the
  build host; the player's Windows box is the test host.

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
| `packaging/windows/order1886-go-build.ps1` | Add: `order1886_fsr4.dll` copy (next to fsr3), `-Fsr4Assets <dir>` param staging `bin/fsr4/`, `music/` copy (parity with the Linux package), then `Compress-Archive` → `order1886-win-x86_64-<ver>.zip` + `.sha256`. | Medium: no pwsh here — syntax-level review only; CI is the first execution (the workflow's own note: "Unverified until it has completed on GitHub Actions"). |
| `.github/workflows/order1886-go-package.yml` | Fetch the FSR 4 bundle (§6), pass `-Fsr4Assets`, upload zip + sha256 as release-ready artifacts. Linux workflow (`order1886-go-linux-package.yml`) untouched — separate jobs, separate runners, cannot break Linux. | Low. |
| `docs/order1886-build.md` | Windows section: fsr4 provider + bundle step + the pad-check note. | None. |

## 3. Release-repo (aport) changes (branch `windows-port`, push after approval)

| File | Change | Risk |
| --- | --- | --- |
| `packaging/windows/order1886-win-package.py` | New: standalone assembler mirroring `packaging/linux/order1886-go-package.py` — takes staged artifacts, builds `The Order 1886/` layout, writes `package-manifest.json` with the same schema (product/launcher/status/built_utc/runtime_sha256/runtime_build/update_abi/source_revision/source_dirty/files[]) and produces zip + `.sha256`. Lets the package be assembled from CI artifacts without re-running the PS1. | Low; pure Python, runs on Linux for staging logic, on Windows for real bytes. |
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
no CGO). The PS1 builds it natively on the CI runner (this machine has no Go). The
worker (`order1886.py`) already branches on `os.name == 'nt'`: runtime name
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

## 7. Manual test checklist (player's Windows box) — summary

Launch (SmartScreen), game-folder pick (CUSA00035), Play → title, CONTINUE,
borderless window, 60 FPS mode, bars off, FSR 4 selectable + log line, FSR 3.1
fallback, Xbox pad (XInput) + hot-plug + pad-check lines with Steam open/closed,
keyboard fallback, save + resume, 30-minute session, The Chase flicker parity
(expected: 0 brightness flips, same metric as v0.2.17 on Linux).

## 8. Honesty ledger

* Compiled here: nothing Windows. Linux rebuild + test suite only.
* First real execution of every Windows change: the `windows-2025` CI job (this is also
  how upstream ships — the PS1 has never run on this machine either).
* Unverified until the checklist runs: FSR 4 on Windows, pad-check output, WebView2 on
  clean Win 10, Defender/SmartScreen behavior, long sessions, 4K/60, driver-specific
  paths, the zip layout.
* Pushes: none. Awaiting approval; the source repo also needs a `DivinusX` fork first.
