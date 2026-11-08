# Sun shadows + wet-surface specular: draw-time HTILE expand — 2026-11-08 (v0.2.16)

## The bug

Outdoor Chapter I scenes lost the sun's shadows and the wet-stone specular, and the sun
patch flickered: consecutive presented frames flipped brightness by ~16 levels (0–255).
Reported upstream as [mateussmeneses/theorder1886-port#26](https://github.com/mateussmeneses/theorder1886-port/issues/26);
the RDNA4 retest ([comment 6700803190](https://github.com/mateussmeneses/theorder1886-port/issues/26#issuecomment-6700803190))
identified the decisive half: **the draw-time HTILE expand** (`7cf7979`, build/test follow-up
PR #112). The sibling JulioCacko lineage this package builds from carried only the sun
readback-sync half (PR #143) — and the v0.2.10 flicker fix disables that sync
(`ORDER1886_SUN_SYNC=0`) because its drain-on-readback design handed the shadow pass
half-updated depth. With the sync off and no expand, the EVSM sun-conversion compute
(shader 0x8ea0ef5b) reads the cascade maps' HTILE Zmask in its cleared state, gets a
constant moment texture, and the sun's shadow pass has nothing to project.

## The fix (port of 7cf7979 + PR #112)

`vk_rasterizer.cpp` `BeginRenderingFull`: when a pass writes depth and the pass clears
depth (or the surface was never expanded), fill the depth surface's HTILE Zmask range
with the uncompressed value (`0xf`) via `Runtime::FillBuffer`, once per address
(`uncompressed_htiles`). Range maths lives in `htile_expand.h::HtileUncompressedSize`
(one u32 per 8x8 tile, tile grid padded to whole 64-tile rows, x layers), covered by the
deterministic unit test `tests/test_htile_expand.cpp` (`htile-expand-test`, also asserts
the 1024x1024x2 cascade = 131072 bytes seen live in the boot log).

- On by default; `ORDER1886_HTILE_DRAW_EXPAND=0` restores the previous behaviour.
- Boot log evidence: `HTILE: 0x… marked uncompressed, 196608 bytes` x8 surfaces.
- The sun readback sync stays disabled (wrapper `ORDER1886_SUN_SYNC=0`) — the RDNA4
  retest found the expand decisive and the v0.2.10 flicker fix stays exactly as shipped.

## A/B evidence (RX 9070 XT / RADV, Chapter I "A Lady in Waiting", 30 FPS,
1920 render + FSR 4, effects off, same save, scripted walk/sprint/pan, F12 presented
frames, 0.45 s burst):

| build | brightness flips (14 frames) | ground dark-fraction | shadows / specular |
| --- | --- | --- | --- |
| v0.2.15 (no expand) | **3** (Δ up to 17.6) | 0.04–0.49, unstable | sun patch drops out on flip frames; flat NPC/prop shadows |
| v0.2.16 (expand) | **0** (Δ ≤ 0.6) | 0.061 stable | NPC + awning + balustrade + fountain shadows, sun patch on walls, wet-stone specular |

Images: `before-flicker.png` (broken burst frame, sun dropped, mean 42.8) vs
`after-shadows.png` (fixed, same checkpoint family, mean 50.4 with shadows and fountain
specular). FSR 4 stayed healthy in the fixed run (`fsr4 reconstructed 3600+ frames`,
0 validation/fatal lines).

## Files

- `gpu/shadps4/video_core/renderer_vulkan/htile_expand.h` (new)
- `gpu/shadps4/video_core/renderer_vulkan/vk_rasterizer.{h,cpp}` (expand + member)
- `tests/test_htile_expand.cpp` + `gpu/CMakeLists.txt` (htile-expand-test)
- Patch: `2026-11-08-sun-shadow-expand.patch` (vs upstream main 37482884c)
