# Handoff: #47 frame generation — verified groundwork, execution plan — 23 Nov 2026 (omp session)

Audience: next agent / the owner's own FG branch. Issue:
https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/issues/47
Approach chosen by owner: proper FSR3 FG (option B), both 30→60 and 60→120, env gate
SUPERSEDED by owner interjection: **the F1 in-game menu gets a Frame Generation row**.
Nothing below is pushed: the owner said (in #59) they were already implementing frame
generation locally — reconcile branch/API naming with that WIP before pushing anything.

## Verified in this session (all claims checked by execution, not reading)

1. **The FG dependency is vendored, pinned and complete.** `gpu/third_party/fsr-vulkan`
   (FireBurn/FSR-Vulkan @ `c64f093`) contains the FSR 3.1.6 frame-generation host
   (`src/ffx_vk_fsr3_3_1_6_framegen.cpp`), embedded SPIR-V
   (`generated/ffx-2.3.0/vk/fsr3framegeneration-q2-v1`), a WSI-neutral presenter-policy
   lib (`ffx-vulkan::framegeneration-presenter-policy`) and a shared reset-decision lib
   (`ffx-vulkan::temporal-lifecycle`). Built here: **37/37 CPU tests pass** (incl.
   `ffx_vk_fsr3_framegen_generated_hashes`); the five `*framegen_api_smoke` GPU tests
   self-skip (exit 77) — they require `VK_LAYER_KHRONOS_validation`, absent on this box.
2. **FG must be its own dlopen'd provider module.** Vendored CMakeLists.txt:515-517 (verified):
   the 3.1.6 FG backend "cannot be linked beside" the 3.1.5 upscaler without duplicate
   private symbols. The provider model already fits: `vk_upscale_providers.cpp:40-47`
   table + RTLD_LOCAL dlopen (`:81-115`).
3. **FG provider scaffold builds and holds its contract.** `gpu/upscalers/fg/`
   (`order1886_fg.cpp`, CMakeLists) + `gpu/shim/order1886_framegen.h` (new ABI v1:
   create/memory_usage/record_prepare/record_dispatch/retire/destroy — mirrors
   `ffxVkFsr3_3_1_6FrameGeneration*`; `retire(completed_frame_id)` maps to the ABI-2
   `gpu_frames_completed` present watermark the upscalers already use).
   Built `order1886_fg.so` (766 KB) here; dlopen + CPU contract test passes (null-arg
   refusals, abi handshake, inert destroy). CMake gotcha solved: FG targets are not
   -fPIC by default — the scaffold sets POSITION_INDEPENDENT_CODE per target.
   Files are inert to existing builds (build.sh only loops fsr3/fsr4; nothing includes
   the new header). Local commit(s) live on `feature/issue-47-framegen` in
   `~/work-engine/The-Order-1886_pc` (NOT pushed — see above).
4. **The seam.** `Presenter::Present` (`vk_presenter.cpp:912-1097`): acquire → blit
   `frame->image` (final, HUD-included, display-size) → optional overlay → submit →
   `swapchain.Present()` — the only game-frame `vkQueuePresentKHR`. Pacing lives in
   `PresentThread` (`driver.cpp:675-831`), cap via `ORDER1886_FPS_LIMIT`; vsync→eFifo
   (`vk_swapchain.cpp:210-217`). A second present self-paces to the next vblank;
   use the vendored policy helpers for present-mode choice, image count
   (`ffxVkFrameGenerationRequiredImageCount`), two-acquire pairing and
   present-plan (`ffxVkFrameGenerationBuildPresentPlan`), + the
   `TransitionNeedsQuiescence` rule when toggling FG mid-session.
   KNOWN LANDMINE: `PrepareFrame`'s `ORDER1886_FRAMES_AHEAD` wait counts
   `CompletedPresentations()` — double-presenting doubles that count; decide explicitly
   whether FG presents count as submits (they must, or the guest queue deepens).
5. **Inputs at prepare time** (`vk_order_resolve.cpp:366-596`): scene color RGBA16F
   (targets[0]), decoded motion RG16F prev−current pixels scale 1.0 (targets[1]),
   depth R32F reversed-detected via depth_func (targets[2]) — all at render res,
   **only when a temporal provider is selected** (`Wanted()`, :210) → FG-on-upscaler-off
   needs the gate widened. HUD: baked into the guest flip image AFTER resolve; the
   provider ABI is scene-only by design (order1886_upscale.h:1-2). FG output therefore
   interpolates the **scene**; presenting it needs the HUD re-composited — no HUD mask
   exists. Owner decision needed (see Open items).

## Execution plan (on the owner's rig — full build works there)

1. Reconcile with the owner's in-progress FG branch first (name collision risk).
2. Deps: `pacman -S cmake boost robin-map zydis ozz-animation vulkan-validation-layers`;
   run the five skipped `ffx_vk_fsr3_3_1_6_framegen_*_api_smoke` on the RX 9070 XT →
   proves the SDK FG path runs on RADV before any engine code changes.
3. Camera RE (the real blocker; `vk_order_resolve.cpp:541-544` admits placeholders):
   - Instrument once: in `Rasterizer::DispatchRecord`/`SetConstantData` (vk_rasterizer.cpp)
     dump vertex-stage CB slices (hash the dispatch like 0x92311aca does for resolve) for
     one office walk + one chase sequence.
   - Scan slices for row-major perspective matrices (`m32=-1, m33=0, m00>0, m11>0`):
     `fovY = 2·atan(1/m11)`, `aspect = m11/m00`, `near = m34/(m33-1)`, `far = m34/(m33+1)`
     (reversed-depth convention already handled). The Order's world units: The Chase
     distances vs `viewSpaceToMeters` — validate by reprojecting targets[2] depth through
     the found matrix and diffing against targets[1] motion (a correct camera makes
     static-world motion ≈ camera-only reprojection residual).
   - Persist found constants; wire real values into OrderUpscaleFrame + FG prepare.
4. Engine wiring: register `fg` in the providers table + `Upscaler`/framegen enum +
   `ORDER1886_FRAMEGEN=1` env + runtime.ini key (ps4_settings Set/Save pattern,
   cf. presentation_filter :96-97); swapchain image-count via policy helper; two-present
   plan in Presenter::Present; retire watermark hookup; Wanted() gate widened for FG;
   reset on scene-change seams (reuse ffx-vulkan::temporal-lifecycle so upscaler+FG agree).
5. **F1 menu row (owner priority):** ps4_overlay.cpp — model on the "Sharpening"
   Off/Quality/Performance Choice pattern (~line 1200): labels `{"Off","On"}`, live apply
   + `StoreForNextLaunch` where FIFO/image-count changes need a swapchain recreate
   (badge "Restart"); badge + note mirroring Upscaling (:1157-1200). Settings.json key
   `frame_generation` + launcher field (order1886_options.py, graphics page).
6. Packaging: build.sh provider loop add `fg` (both platforms); go-package.py +
   go-build.ps1 ship `order1886_fg.so/.dll`; CHANGES/README; release as experimental
   preview behind the F1 row (default Off — artifact/latency risk, especially menus).

## Open decisions (owner)

- HUD: (a) accept AFMF-style smearing by FG-ing the composited display image, or
  (b) FG the scene (targets[0]) and re-blit the guest HUD's bounding rows from the real
  frame over the generated one (cheap, imperfect), or (c) full HUD-mask work (needs the
  guest's HUD draw pass recognised — biggest win, most RE).
- 30→60 with vsync 60 Hz means one present per vblank slot; at 60→120 the guest queue
  and ORDER1886_FRAMES_AHEAD budget need re-tuning.
- Latency stance: FG adds ~1 frame; the game is twitch-light (QTEs are timing-window,
  not aim) but state it in release notes.

## Deliberately NOT done

No push of anything #47-related; no release-branch touches; no fake "verified in game"
claims (this box cannot even build the runtime: no cmake/boost/robin-map/zydis/sudo).
