# SRT-fallback glyph poisoning — verification (17 November 2026)

Machine: CachyOS, RX 9070 XT (RADV), CUSA00035 APP_VER 01.02, engine
`The-Order-1886_pc@aot-shader-cache` (87c69aac, locally built: runtime SHA bcae0ca9…),
prepared image = v0.2.23 UI-band recipe (16:9, `ui_fix applied, 9 sites`). Method: two
headless boots inside `gamescope --backend headless` with scripted input
(`ORDER1886_PAD_FILE`) and frame dumps (`ORDER1886_FRAME_DUMP_TRIGGER`); the test cache was
a copy of the live pipeline cache (21,138 blobs, 6,904 metas, all format v10). The player's
own state was never written.

## The bug

Shaders whose extended-userdata (SRT) flattening fails are compiled with a fallback that
reads the game's canonical descriptor tables; the engine logs `SRT offset failure` per
unresolved offset. The fallback decision depends on live SSA shapes during compilation and
was **not** recorded anywhere in the persisted ShaderMeta. The cache therefore replayed such
pipelines with the layout the meta describes (flattened) while the stored binary performs
canonical reads — the glyph sprite binds the wrong descriptor and samples nothing:

- Symptom: the world interaction disc (newspaper, photo, lantern, QTE rings) renders without
  its button symbol; a bright crescent peeks at the disc edge. Subtitles/menus unaffected.
- Persistence: once poisoned, every launch replays the broken pipeline — "more and more
  missing" as the cache fills.
- Not related to cinematic bars, background warm-up, or the UI-band projection patch —
  all three theories were disproved by A/B on the same prepared image:
  cold cache = correct glyph, warm poisoned cache = broken glyph, in both aspect modes.
- Bisect proof: deleting exactly the 28 shaders that logged `SRT offset failure` (59 blobs)
  from the warm cache restored the glyph immediately (`7298 of 7328` replayed, 30 stale).

## The fix

`InfoPersistent::srt_offset_fallback` is set by `ReportOffsetFailure` during compilation and
travels in the serialized meta. `LoadShaderMeta` refuses flagged metas: those variants always
compile fresh — the path every working session used. `ShaderMetaVersion` 10 → 11 invalidates
every existing cache once, so poisoned entries cannot survive the update.

## Evidence

- **Run 1** (fixed runtime, all-v10 cache): `Pipeline warm-up: 0 of 7328` +
  `7328 stale pipelines` — the version bump rejects the old generation wholesale. Gameplay
  compiles live: 3,836 `SRT offset failure` reports across the visited scenes; fallback
  variants are saved flagged. Frame dump: Chapter 1 stairs renders correctly (rain,
  wet-stone specular, sun shadows).
- **Run 2** (same cache, now v11): `340 of 7485 replayed in 0.20 s` (unflagged entries
  restore fast), the flagged fallbacks are refused and recompile live again (identical
  3,836 report count — deterministic), and the stairs frame is pixel-identical to run 1.
  Unvisited scenes remain stale until first play, as before.
- **Owner's live session** (installed launcher, pruned cache): triangle glyph verified
  correct in photos, with bars off and on.

## Limits

- Flagged variants recompile on every boot — a small permanent cost (tens of shaders,
  hidden behind loading screens and the async compiler). Correctness first.
- Physical Windows untested (identical C++ path, CI-built).
