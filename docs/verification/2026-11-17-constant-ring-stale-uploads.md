# World-prompt glyphs: stale constant-ring uploads — verification (17 November 2026)

Machine: CachyOS, RX 9070 XT (RADV), CUSA00035 APP_VER 01.02, engine
`aot-shader-cache` (local build, clang). Owner's install state and checkpoint save.

## Symptom (owner-reported)

Newspaper and photo interaction discs showed only the bright crescent — no button
symbol; the weapon disc sometimes showed a triangle instead of the trigger glyph,
sometimes correct. Same binary, same save: correct in one session, broken in the
next; broken for the whole session; loading the same checkpoint twice "fixed" it.

## Mechanism (instrumented, not inferred)

`Rasterizer::CollectRingBindings` stages each draw's flattened user-data table into
the 32 MB constant ring. When the ring tail was still in flight on the GPU,
`ConstantRing::Allocate` returned `nullopt` and `copy()` **silently skipped the
upload** — the descriptor slot kept the *previous* draw's ring offset. The prompt
shader then read the last-uploaded table: a different interactable's glyph index
(triangle for the trigger prompt) or a zeroed one (invisible symbol, crescent only).
Whether a widget was poisoned depended on ring pressure at packet-build time —
timing, hence per-session variance; the cached packet replayed the stale binding for
the rest of the session. Reloading the checkpoint re-built packets under different
pressure, which is why the second pass looked healthy.

Evidence: a log-only build counted 162 skips in one desk visit (`RINGSKIP` lines,
concentrated on the prompt sprite stages). Texture-aliasing was ruled out by the
same build: every refused alias pair was a legitimate layout difference (MSAA vs
single-sample, pow2 variants) — none on the sprite path. The SRT offset-fallback
cache poisoning fixed earlier this week was ruled out by the v11 replay refusal
staying effective (deterministic failure counts, no stale replay).

## Fix (engine commit `6db2288886`)

`ConstantRing::Allocate` no longer fails on a full tail: it resumes allocation at
the retired frontier — bytes the GPU has provably finished with. A skip now only
survives if the GPU is stalled across the entire ring (never observed).

## Verification

- Instrumented fixed build, owner's checkpoint, warm cache replay (313/705):
  `RINGSKIP` count **162 → 0** across the same route.
- Owner's own screenshots, first pass after load: newspaper disc glyph ✓, photo disc
  glyph ✓, weapon disc glyph ✓ — all animated.
- No behavior change for sessions that never hit the full ring (the common path is
  identical).

## Limits

- Windows/CI binaries carry the same C++ path; physical Windows untested.
- The one-frame fallback (skip only when the whole 32 MB ring is in flight) still
  leaves a theoretical stale binding under a GPU hang; such a session dies anyway.
