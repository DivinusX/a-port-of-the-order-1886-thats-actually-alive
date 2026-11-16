# Shader cache seeds — verification (16 November 2026)

Machine: CachyOS, RX 9070 XT (RADV), game CUSA00035 APP_VER 01.02, engine source
`The-Order-1886_pc` branch `aot-shader-cache` (= `bdd172d` + launcher Python only), port
`feat/aot-shader-cache`. Issue: #17 (AOT shader pre-compilation). Method: unit tests, live
import of a real 20,251-blob capture, headless boots inside `gamescope --backend headless`
with isolated state directories. No shipped game copy was modified.

## Why a first playthrough stutters, and what can honestly be pre-built

The runtime keys its pipeline cache by `shader_hash` — the value the game's own loader writes
into each program object (`OrbShdr` header, `regs_shader.h::BinaryInfo`, found by
`SearchBinaryInfo` from the program-code token `0xBEEB03FF`). Shaders are not stored as plain
PGOs in the extracted `_data` tree (the game streams and decompresses them), and a `VkPipeline`
is identified by more than code: the engine's `StageSpecialization` folds in the user-data
registers and the SHARP descriptor contents observed at the first draw, and permutation indices
are ordinals of discovery. A static scan of game files therefore cannot produce cache entries a
draw would reuse — it would compile permutations that miss and burn ordinals the game then
shifts.

What the engine can do — and does — is replay a complete recorded cache at boot
(`WarmUp`/`StartBackgroundWarmUp`, progress in the loading overlay). Every PC port that ships
"zero first-play hitches" (Horizon Zero Dawn among them) ships exactly this: a developer-captured
pipeline cache. This change gives the port the missing infrastructure for that model.

## What was wrong

1. **The pipeline cache escaped the package on Linux.** The launcher exports
   `ORDER1886_GPU_USER_DIR=<state>/gpu/native-ps4-v1` but never created it;
   `path_util.cpp::UserPaths` treats a missing directory as "not portable" and falls back to
   `~/.local/share/shadPS4`. The README promise ("Settings, caches, logs and saves live in
   `user/order1886`") and the launcher's own *Clear shader cache* action (which wipes
   `<state>/gpu/native-ps4-v1/cache/<TITLE_ID>`) both pointed at a folder that stayed empty.
   Verified: a scratch run with the directory present wrote its cache under the package; a
   default 20:57Z boot had written all 20,251 blobs under `~/.local/share`.
2. **Nothing could pre-fill a fresh install.** No import path, no bundle format, no capture
   export.

## The fix

`scripts/order1886_cache.py` (mirrored into the worker; called from `runtime_environment` in
the engine repo and from the launcher overlay for repacked workers):

- `ensure_cache_home` creates the cache home before launch (the fix above);
- `migrate_shared_caches` copies a pre-fix cache from `~/.local/share/shadPS4/cache/<title>`
  (XDG; `%APPDATA%` on Windows) into the package, once, never onto a cache with a
  `profile.bin`, sources kept;
- `export_shader_cache_seed` / `import_shader_cache_seeds`: a bundle at
  `<install>/shader-cache/<TITLE_ID>/` (`bundle.json` + `blobs/`, ABI-tagged, per-blob sha256)
  is staged, hash-verified, and renamed into an empty title cache atomically; it never touches
  an in-use cache and is refused wholesale on tamper or `shader_cache_abi` mismatch. Driver
  pipeline binaries (`*.bin` other than the profile) are not bundled; the captured
  `profile.bin` is, so a matching GPU/driver replays from the very first boot — and a
  mismatching one goes through the runtime's existing `CheckCacheProfile` rebuild, exactly as
  with no bundle at all.
- All of it runs before the runtime starts and cannot fail a launch.

## Evidence

- Unit tests: port `python3 -m unittest discover -s tests` → **32 OK** (7 new seed cases:
  round trip, in-use-cache protection, tamper refusal, ABI refusal, export profile/driver
  split, migration no-clobber, broken-bundle tolerance). Engine `tests.test_order1886_cache`
  → **20 OK** (6 new `SeedBundleTests`). The 4 failing engine codegen tests
  (`srt_codegen`, `uniform_guard`, `image_mode`) fail identically at the pristine base commit
  `bdd172d` (verified by stash) — pre-existing, environment-dependent, untouched.
- Real capture, end to end on this machine: `export_shader_cache_seed` bundled the live
  20,251-blob capture; a fresh state run imported it and the boot logged
  **`Pipeline warm-up: 6992 of 6994 pipelines in 0.72 s`** (the 2 rejects are the engine's own
  stale-generation guard, `Cached permutation 0 … conflicts with index 1, skipping preload`).
  The same build in an isolated empty cache logs 0 of 0 — the seed is what the boot replays.
- Package level (fill in from the release artifacts): fresh `HOME`, extracted package, bundle
  dropped at `shader-cache/`, headless boot → `imported 20251 blobs` in the launch log, cache
  home under `user/order1886`, warm-up count > 0, menu reached at 60 FPS.

## Known limits / decisions

- **No seed content ships in the official release assets yet.** A bundle is GPU code
  translated from the game's own shader programs — redistributing one is a call for the
  project owner, not an engineering one; the mechanism is drop-in whenever that decision is
  made, and players may share bundles among themselves as the community already does.
- Seeds replay on a device whose `Shader::Profile` matches the capture device; everyone else
  is on today's behaviour (one capture playthrough, then boot-time replay).
- AOT translation straight from game files remains impossible without gameplay state (above);
  if the community cache ecosystem matures, the bundle format and receipts are the seam.
