# Handoff: issue #17 shader-cache seeds — shipped as v0.2.24 — 16/17 Nov 2026 (omp session)

Audience: the next agent (Claude or otherwise). This supersedes
`2026-11-16-stale-guard-fix.md` for state; that report's rules and findings stand.

## Release state (all pushed/authorized by owner for this issue)

- **Release `v0.2.24`** is live with 4 assets (linux tar.gz, win zip, both + .sha256):
  https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/releases/tag/v0.2.24
- Port `main` = `dacda46` (merge of PR #20; includes the v0.2.23-era stale-guard fix `79ae430`
  finally pushed alongside). Engine `DivinusX/The-Order-1886_pc` branch `aot-shader-cache`
  @ `7beccba` (3 commits on `bdd172d`: feature, CLI refactor, INSTALL_ROOT fix).
  **`windows-port-v0.2.22` was NOT merged/force-pushed** — next CI-built release should
  branch off `aot-shader-cache` or cherry-pick it (this release used its own branch — the
  packages are built from `7beccba`, CI-verified).
- **Issue #17: answered with a full write-up and CLOSED.** #15/#14/#18 remain open; untouched.

## What #17 shipped, in one paragraph

True file-static AOT is impossible in this engine (proof in
`docs/verification/2026-11-16-shader-cache-seeds.md`): the extracted dump has no PGOs
(they stream decompressed) and pipeline permutations depend on register/descriptor state
only draws reveal; guessing permutations would poison the ordinal `(pgm_hash, perm_idx)`
key space. So the HZD model ships instead: the runtime already replays recorded pipelines
at boot; #17 makes that trustworthy (**cache now really lives in
`user/order1886/gpu/native-ps4-v1/` on Linux — before, it silently fell back to
`~/.local/share/shadPS4` because nothing created the folder; old caches are adopted
copy-once on first launch**) and shareable (**seed bundles**: `scripts/order1886_cache.py
--export/--import`, `<install>/shader-cache/<TITLE>/` auto-imported before first play,
per-blob SHA-256 verified, staged-atomic, never touches an in-use cache, refused on ABI
mismatch; the engine's `Shader::Profile` gate still rebuilds on foreign devices).
**Deliberately NOT bundled**: the maintainer's own capture — seed blobs are game-derived
GPU code; the project ships none. The built asset is on this machine at
`/tmp/aot-scan/order1886-shadercache-CUSA00035-v0.2.24.tar.gz` (196 MB,
`f17c15e2…cf17`) if the owner ever decides to distribute it.

## Evidence already produced

- Port suite 32/32 (7 new); engine `tests.test_order1886_cache` 20/20 (6 new); the 4 engine
  codegen failures pre-exist at `bdd172d` (verified by stash) — environment-dependent, not ours.
- Full-package E2E from a **fresh HOME**: `Play The Order 1886` →
  `shader cache seed: imported 20251 blobs` → `Pipeline warm-up: 6992 of 6994 pipelines`
  (104 s cold driver build behind the loading overlay, 0.72 s thereafter) → frames presented.
  Logs: `/tmp/aot-scan/e2e/The Order 1886/user/order1886/logs/20261116T235029.347964Z-boot.log`.
- Installed launcher on this machine updated to v0.2.24 in place (backup
  `~/Documents/PS4/order1886-backup-v0.2.23-185650`); integrity verified 484/484 manifest
  files; live migration test was running at hand-off time — see next section before assuming.

## Gotchas for the next agent

- Worker module duality: the frozen worker imports `order1886.*`/`scripts.*` from the PYZ
  but bare `order1886_*` modules from `_internal/scripts/` **on disk** — that's why v0.2.23
  could hot-patch `order1886_display.py`. My hook lives in PYZ `order1886` (runtime_environment),
  so it needs the CI-built worker; the overlay in the port repo additionally covers
  repacked legacy workers. Don't hot-patch scripts and expect the launch hook to appear.
- `INSTALL_ROOT` inside the worker is the **package root** (set by `frozen_installation_root`,
  `launcher/order1886_worker.py:570`) — `state.parent.parent` only coincides when state lives
  in the default place.
- Migration copies up to ~1 GB once; on slow media the first launch after updating gains a
  few seconds — that's by design (source folder kept).
- Seed bundles: `bundle.json` keys `shader_cache_abi`/`files{}` — changing the ABI string in
  `order1886.py` (`SHADER_CACHE_ABI`) invalidates all bundles, by design.
- The Windows v0.2.24 zip was finalized with Python `zipfile` (no system zip installed):
  exec bits are meaningless there, entries verified by sha, but nobody has run it on Windows
  yet (same as v0.2.23).

## Suggested next work

1. ~~Verify the installed-launcher migration test~~ **VERIFIED ~19:00 local, Nov 16:** first launch of
   the updated install logged `Pipeline warm-up: 6994 of 6994 pipelines in 0.56 s`, the
   package now holds its own 813 MB cache (`user/order1886/gpu/native-ps4-v1`), and the XDG
   source is intact (copy-once by design). A future cleanup could delete the XDG copy at the
   owner's discretion — nothing reads it anymore.
2. #15 (mouse focus on Esc/F1) — the small one; reproducible headless with PAD_FILE.
3. #14 (file-check/update failure) — worth retesting against v0.2.24; note the manifest is
   now ~2× entries vs v0.2.19-era Windows trees.
4. Consider merging engine `aot-shader-cache` into `windows-port*` branch line at the next
   engine change to avoid branch drift.
5. `launcher-frontend` still has no source (GPL gap, flagged since the review).
