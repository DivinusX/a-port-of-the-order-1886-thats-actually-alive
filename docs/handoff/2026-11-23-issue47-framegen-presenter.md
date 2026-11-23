# Issue #47 - frame generation presented live (2026-11-23, session 2)

Engine repo: `The-Order-1886_pc`, branch `feature/issue-47-framegen`, 8 commits
(`e484868..d769dc9`), **not pushed** - this environment has no GitHub
credentials (`gh` logged out). Push from an authenticated shell:

```
cd ~/work-engine/The-Order-1886_pc && git push -u origin feature/issue-47-framegen
```

## What works now (verified on the RTX 5050 rig, real game, grim screenshots)

- FG on (`ORDER1886_FRAMEGEN=1` or the F1 menu row + restart): provider arms,
  the resolve publishes the scene, the SDK interpolates, and generated frames
  are presented as a second swapchain present per game frame - 3000+ generated
  presents in a 170 s session, zero faults.
- Composite: the SDK feed is the game's composited LDR band (cropped with the
  letterbox fit), so generated frames sit on the real ones' transfer curve.
  A two-texture pp shader (`framegen_fallback.frag`) shows the game's own
  frame wherever the interpolator left exact zeros (UI text, prompts) - the
  old fixed-rectangle re-blit and its black boxes are gone.
- Baseline (FG off) with all of this compiled in: fully inert, clean shutdown.
- Verified visually clean at: title screen, main menu (CONTINUE/SETTINGS/...),
  cinematic fade content.

## Bugs this session killed (each had a signature worth remembering)

1. `ConsumeSceneFrame` defined inside the anonymous namespace -> internal
   linkage -> undefined symbol at dlopen. Move to `namespace Vulkan`.
2. Barrier array of 3 declared as count 4 -> driver read a garbage VkImage ->
   segfault in libnvidia-glcore inside FramegenRecord.
3. Cinematics resolve at 1920x800 (2.4:1 band); the scene==output size gate
   silently disabled FG. Now: band-composite into frame space (FitImage).
4. Generated frames 4x too bright: HDR pre-tonemap feed vs the game's tonemap.
   Fixed by feeding the composited LDR band in an RGBA16F container (FSR3
   demands float scene colour; UNORM->SFLOAT conversion blits are legal, the
   10-bit swap format is UNORM class).
5. Black rectangles exactly at the HUD rect positions, clean in every
   draw-queue dump: the present queue raced the draw queue's HUD writes
   (the binary acquired semaphore was already consumed - wait on the frame's
   draw timeline instead), and the chained COLOR->GENERAL->TDST transition of
   one image inside a single pipelineBarrier2 call desynced NVIDIA's layout
   tracking. Both fixed; then the rect approach itself was replaced by the
   fallback shader.
6. Dump counter inside the burst window never reached a non-zero FROM value;
   per-frame stage dumps (4 blocking readbacks/frame) crawled the session to
   40 records and lost the device during a submit.

## Owner-attended checklist (what this rig cannot do)

- [ ] **Gamepad gameplay**: wtype keyboard never reaches the game (it takes
      pad only; `--user` dir has no saves). Needs a real CONTINUE run to see
      motion-interpolated gameplay (30->60), QTEs, and the watermark.
- [ ] **F1 menu row**: compiles and is in the menu build; window focus under
      wtype prevented the screenshot. Open F1, confirm the Frame generation
      row (Off/On + Restart badge) and that toggling persists to
      runtime.ini `frame_generation=`.
- [ ] **Latency/feel**: generated presents add one interpolated frame per
      game frame; check input feel in QTE windows (issue #43 territory).
- [ ] **exit-23 regression**: paced exit path with FG on (two-present loop
      interacts with the flip pacing).
- [ ] **60->120**: 60 fps mode + 120 Hz display; the pacing gate requires
      gap > 1.4x vblank, so a 60 fps game on 120 Hz qualifies; verify present
      counters double.

## Diagnostics left in the tree

- `ORDER1886_FG_DUMP=1` + `ORDER1886_DUMP_DIR` + `ORDER1886_FG_DUMP_FROM=N`:
  24-frame burst of `fgframe`/`realframe` full-size dumps + `swapgen` samples
  (every 400th generated present). Dumps stall the queue - keep bursts short.
- `FGstep` trace lines (staging/ctxcreate/feed/predispatch/banddone/hudcopied)
  under the same env flag.
- Known dump quirk: DumpRaw assumes 4 bytes/px; RGBA16F stage files were
  truncated (analysis worked around it; stage dumps now removed).
