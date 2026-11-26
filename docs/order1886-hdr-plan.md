# HDR10 output (#66): design

Status: shipped in v0.2.59 (`vk_order_hdr.{h,cpp}`, `order_hdr_gain.comp`,
`order_hdr_compose.comp`, `post_process.frag`). Evidence: a frame capture and shader dump from
Chapter I gameplay, v0.2.56 runtime, RTX 5050.

What changed from the plan below while it was built and tested:

- The knee (`hdr_knee`, "Highlight start") defaults to 80% of SDR white: at 55% lit skin in
  close-ups was boosted; at 80% a gameplay frame boosts about 0.1% of pixels (the sun glare).
- The snapshot copies the display buffer with its own barriers and restores the tracked layout,
  into one R8G8B8A8 image recreated only on a size change. Calling `runtime.Transit` from the draw
  recording thread, and recreating the image every frame because the display buffer is seen both
  as R8G8B8A8Unorm and as R8G8B8A8Srgb, made shadows flicker and vertices explode (bisected with
  `ORDER1886_HDR_SKIP`).
- The settings are runtime.ini keys (`hdr`, `hdr_paper_white`, `hdr_peak`, `hdr_knee`) shown in the
  launcher and in F1 > Graphics > HDR; paper white, peak and knee apply live.

## What the frame does today

| Pass | Shader | Work | Target |
| --- | --- | --- | --- |
| #125 | ps `0x4403da37` | **Tonemap and grade** (below) | `…c28000` R8G8B8A8 sRGB 1920×800 |
| #126 | ps `0x2b1826e7` | FXAA (luma comes from #125's alpha) | `…0f8000` A2B10G10R10 1920×800 |
| #128 | ps `0xa41511a2` | Letterbox, centred (`floor((screen − scene) / 2)`), plus a brightness curve | display buffer R8G8B8A8 sRGB 1920×1080 |
| later | Scaleform | HUD, subtitles, prompts drawn into the display buffer | same |

`…0f8000` is also read by two compute passes early in the next frame (#25, #26), so it must keep
its SDR meaning.

### The tonemap shader (ps `0x4403da37`), in order

1. Vignette and a depth-dependent factor; chromatic aberration (three offset samples of the
   RGBA16F scene).
2. Exposure: `exp2(exposure texture − vignette EV)` (R32F 1×1 at `…cc0000`).
3. Filmic curve, Hable form, with live constants A=4, B=5, C=0.074, D=13, E=0.01·D, F=0.3·D,
   white W=6, blended with linear by constant 207 (1 = fully filmic):
   `f(x) = (x(Ax+CB)+DE) / (x(Ax+B)+DF) − E/F`, output `f(x) / f(W)`.
   Anything brighter than 6× is compressed into the top of the 8-bit range: this is the range
   HDR gives back.
4. Bloom (B10G11R11 960×400), tonemapped separately and added with weight constant 219.
5. Lens texture and lens flare (constants 266–268), film grain (280–285).
6. `saturate`, colour grading (saturation 252–258; lift/gamma/levels 328–339), `saturate`.
7. Linear RGB to the sRGB target; alpha = perceptual luma for FXAA.

## Approach: a gain map, applied at presentation

The game's frame stays exactly as it is (every guest image keeps its format, so no game logic,
readback or next-frame pass can see a difference). HDR is added at presentation.

1. **Gain pass** (new compute shader, run right after draw `0x4403da37`): from the same bound
   scene colour, exposure and constants, compute each pixel's pre-tonemap luminance `L` and
   write `gain = F_hdr(L) / F_sdr(L)` to a host R16F image at scene size.
   `F_sdr` is the game's curve above. `F_hdr` equals it up to a knee and then rolls off to
   `peak / paper_white` instead of 1. Below the knee the gain is exactly 1, so small
   differences between this pass and the game's shader cannot shift colours: only highlights
   the game was compressing get brighter.
2. **Scene snapshot** (right after the letterbox draw `0xa41511a2`): copy the display buffer to a
   host image. Anything that differs from it at present time was drawn later: HUD, subtitles,
   prompts.
3. **Compose** (new pass in the presenter, at display resolution, before FSR 1):
   `g' = 1 + (gain(letterboxed uv) − 1) · (1 − hud)`, where `hud` comes from the difference
   between the final display buffer and the snapshot. Letterbox bars and HUD get `g' = 1`.
4. **Encode** (`post_process.frag`, HDR branch): `linear · g' · paper_white`, Rec.709 to Rec.2020,
   then PQ. The swapchain switches to `A2B10G10R10 / HDR10_ST2084`. The shadPS4 HDR swapchain
   path already exists; today it only turns on when a PS4 game asks for HDR, and The Order never
   asks.

Known limits of this approach:

- Bloom halos and lens flare stay at SDR brightness (they are added after the curve).
- Semi-transparent HUD over a bright highlight shows the highlight at SDR brightness under it.
- Highlights are recovered from the scene's luminance, so their colour is the game's SDR colour
  scaled up, not re-graded.

## Settings

- Off by default. A launcher and F1 option **HDR** (Off/On), applied at next launch, shown only
  when Windows reports an HDR-capable display (the surface offers HDR10).
- Paper white (default 200 nits) and peak brightness (default 1000 nits).
- Reuses `ORDER1886_HDR` (`EmulatorSettings::IsHdrAllowed`) to allow the HDR swapchain.

## Verification without an HDR display

The maintainer has no HDR display, so on this machine the HDR10 swapchain is never offered.

- `ORDER1886_HDR_DUMP=<dir>`: write the composed linear HDR frame (before PQ) as a 16-bit float
  file, plus the gain map and HUD mask, on a trigger. Read back as numbers: peak value,
  share of pixels above SDR white, gain exactly 1 below the knee, bars and HUD at 1.
- `ORDER1886_HDR_FORCE=1`: run the gain and compose passes on an SDR swapchain, encoding with a
  simple HDR-to-SDR preview, so the passes run in real gameplay here.
- Unit checks for the curve: `F_hdr == F_sdr` below the knee, monotonic, reaches the peak.
- First real HDR test: the reporter (Wontell), with a test build and a short checklist.

## Work, in order

1. Gain pass: hook on ps `0x4403da37` (same pattern as `vk_order_resolve.cpp` for the resolve
   dispatch), compute shader, host image.
2. Snapshot on ps `0xa41511a2`.
3. Compose and encode in the presenter; force the HDR swapchain when HDR is on and supported.
4. Dump and force switches; read back a gameplay frame.
5. Launcher and F1 settings; docs.
6. Test build for the reporter.
