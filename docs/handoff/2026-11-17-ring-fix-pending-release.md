# Handoff: constant-ring stale-upload fix — pending owner release decision

Date: 2026-11-17. Engine commits: `6db2288886` (ring fix) + `045ebeac52` (launcher
root fix) on `aot-shader-cache` — pushed with owner authorization; CI builds and
v0.2.27 release in progress.

## What changed

- `gpu/shadps4/video_core/renderer_vulkan/vk_constant_ring.h` — `Allocate` resumes
  at the retired frontier when the ring tail is in flight, instead of returning
  `nullopt`.
- `gpu/shadps4/video_core/renderer_vulkan/vk_rasterizer.cpp` — comment only (the
  remaining skip path is now the GPU-stalled-across-the-whole-ring case).

## Why

Silent upload skips left world-prompt sprite descriptors bound to the previous
draw's table: invisible/wrong/frozen glyphs, per-session timing lottery, persistent
within a session. Full analysis + evidence:
`docs/verification/2026-11-17-constant-ring-stale-uploads.md`.

## State of the machine

- Instrumented diagnostics (ALIASDIAG / RINGSKIP / GLYPHDIAG) were removed before
  the commit; the committed tree is fix-only and builds clean with clang.
- Owner's install state untouched by instrumented runs (cache redirected to
  `/tmp/glyph/scratch-gpu`).
- v0.2.26 (SRT fallback fix) is released and installed; this ring fix is the next
  candidate (v0.2.27) once the owner approves.

## Shipped in v0.2.27

1. CI (Windows + Linux) building at `045ebeac52`.
2. v0.2.27 release with the before/after desk screenshots (crescent-only vs glyph).
3. `bin/order1886-launcher` (the WebKit-free UI entry, #114) no longer needs
   removal: `045ebeac52` makes it resolve the installation root from its `bin/`
   location via `package-manifest.json`, fixing "Order worker is missing".
