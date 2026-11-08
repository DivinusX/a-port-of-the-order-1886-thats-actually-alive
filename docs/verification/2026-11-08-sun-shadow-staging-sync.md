# The Chase sun-shadow flicker: staging readback sync — 2026-11-08 (v0.2.17)

## The bug (user video, 2026-11-08 06:30)

`Video_2026-11-08_06-30-57.mp4` (2560x1440, 60fps, 2117 frames, Chapter II "Pursue the
Lycan" = The Chase): the sun's shadows and the sunlight on buildings/trees/foliage drop
out on every other frame. Frame-by-frame brightness series: mean 60.8, stdev 6.9,
**413 flips (|Δ|>6) of 2116 consecutive pairs, 401 of them alternating**, max |Δ| 16.1.
The upper-right quadrant (the sun-lit brick facade) flips 412 times — the flicker is the
sun, not the camera.

## Why v0.2.16 still flickered here

v0.2.16 shipped the draw-time HTILE expand (the decisive half for Chapter I) but kept the
v0.2.10 wrapper's `ORDER1886_SUN_SYNC=0`, which disables the sun-range registration
entirely. In The Chase the sun's EVSM ranges are rewritten every frame and the guest CPU
reads them back; with no sync the deferred-readback path serves them a frame stale, so
the cascade data alternates between fresh and stale — the perfect 2-frame period.

The RDNA4 retest on [mateussmeneses/theorder1886-port#26](https://github.com/mateussmeneses/theorder1886-port/issues/26#issuecomment-6700803190)
says the same thing from the other side: "Sun readback sync only: gameplay stays flat;
with the HTILE draw-expand as well: gameplay shadows return... the HTILE expand is the
decisive half; sun-sync alone is not enough." The Chase needs **both** halves; Chapter I
only needed the expand.

## The fix (port of 7cf7979's buffer_cache half)

Staging sun-sync, replacing the old drain design's role:

- `BufferCache::RecordSunCopies()` — at the sun EVSM copy dispatch (pgm 0x7b1b18c9,
  hooked in `DispatchRecord` after the binding pass that registers the ranges), the
  registered ranges are copied GPU→host-visible staging (`HostCached`, deferred) as one
  batch tagged with the scheduler tick. Recording happens outside `synchronized_mutex`.
- `BufferCache::DeliverSunCopies()` — a CPU write fault on a registered page takes the
  newest GPU-completed batch (`scheduler.IsFree(tick)`) into guest backing and returns:
  no `scheduler.Finish()` mid-frame drain (the v0.2.9 flicker source), no stale frame
  (the v0.2.16 source). Only before the first completed batch does a fault fall through
  to the normal path.
- Modes: `sun_sync` runtime.ini key / ORDER1886_SUN_SYNC env / new Graphics option:
  **1 staging (default)**, 2 legacy drain, 0 off. The wrapper no longer exports
  `ORDER1886_SUN_SYNC=0`; it is versioned at `packaging/linux/order1886-runtime-wrapper.sh`.
- `htile_expand` (from v0.2.16) became a live setting + Graphics option too; both keys
  round-trip through the runtime's own `Save()`.

## Also fixed in this pass (sibling audit)

- Sampler cache key vs custom border color (upstream e1ceeabe8): `GetSampler` hashed only
  the S# bytes while the custom RGBA comes from a mutable guest table — reusing an S# with
  a different table entry kept the previous color. The effective color is now snapshotted
  and folded into the key. Shadow-map edge clamps sample through custom borders.
- Launcher test suite: the UI catalog pins every shown string; the two new options'
  strings were added to `UI_KEYS` (310→335), the translated-count formula now accounts
  for keys translated through the base Tk table (`Performance` is English in pt/fr/it),
  and the worker runtime-discovery test uses the platform's runtime name. 589 tests OK.

## Verification

### The load deadlock found and fixed during capture

The first staging build hung The Chase's level load. The env-gated fault trace
(`ORDER1886_TRACE=1`) pinned it: a CPU **write** fault on a registered sun page with no
completed batch yet (shadow-system init) fell through to the synchronous drain - and the
drain's `scheduler.Finish()` ran on the GPU command thread *under the Liverpool lock*,
waiting a tick that `DrawRec` could only close by taking that same lock. chase15's trace
tail: `sun-nobatch -> pre-wait -> dl finish` -> silence, all threads idle.

Two rules fix it: a CPU write never needs GPU bytes (deliver the batch if one completed,
take the stale backing otherwise, drop the GPU-dirty bits, return); and the queue is
bounded to four in-flight snapshots (~8 MB) so a stalled GPU cannot grow staging memory
without limit. Read faults with no batch still take the drain - by the time the game
samples the EVSMs a batch exists, so it is rare, and it is the correct wait.

### Capture

The Chase checkpoint, RX 9070 XT / RADV, 30 FPS, FSR 4 on, effects off, staging sync on.
The game ran 9000+ resolve frames (5 minutes) with 8276 sun-page faults **all served from
completed batches** (`sun-delivered`), 2 `sun-nobatch` faults total (first frames of load),
zero drains, zero validation errors, 8 HTILE expand lines, 3 sun registrations.

- Movement-tutorial gate (camera locked, the video's exact framing): 20 consecutive F12
  frames, brightness 47.2-49.1, max consecutive delta 0.21, **0 flips** - the video showed
  a bimodal 36<->54 swing (385 flips over 1200 frames).
- Courtyard standing burst (directive "Pursue the Lycan" on screen): 20 frames, 47.7-49.9
  after the first settle frame, **0 flips**.
- Shadows and specular present throughout: lamppost/cart/bench/bicycle shadows on the
  cobble, sun patch on the brick facade, wet-stone specular.
- Frames: `docs/verification/2026-11-08-sun-shadow-staging/` (gate frame 1/20, walk scene).

### Chapter I regression

Chapter Selection -> Prologue "Once a Knight" -> "No Way Out" loads and runs on the same
staging build (3600+ resolve frames, burst captured through the fade-in and the scripted
action: brightness ramps smoothly with the camera, no 2-frame oscillation). That scene is
night/interior - it registers no sun ranges, so the sun path is inert there by design. The
sunlit Chapter I plaza keeps the v0.2.16 evidence (draw-time HTILE expand, unchanged in
this build); the staging fault path it would now use is the same one proven over 8276
faults in The Chase above.
