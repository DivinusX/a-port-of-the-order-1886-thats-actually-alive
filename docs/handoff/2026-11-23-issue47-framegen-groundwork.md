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

## Open decisions (owner) — RESOLVED this session

- HUD strategy: **chosen (b)** — FG the scene, re-blit guest HUD bounding rows from the
  real frame over the generated one (cheap; imperfect only where UI moves within a rect).
- Gating: **env + runtime.ini now; the F1 menu row lands WITH the presenter wiring**
  (no dead toggles shipped).
- Camera: **ship the 0.1/1000/0.7 sentinels first** (production DLSS already runs with
  them; they shape disocclusion fill, not correctness); targeted capture-probe follow-up
  for real near/far/FOV later.
- 30→60 needs vsync+FIFO; 60→120 re-tunes ORDER1886_FRAMES_AHEAD — measure live.

## FINAL GROUNDBRANCH STATE (18:41Z, CI-verified)

`feature/issue-47-framegen` @ `40f2933` on **The-Order-1886_pc (PUSHED — 6 commits:
provider scaffold `44fd60f`, CB capture `4990adb`, sanitizer allowlist `532b7fa`,
frame_generation setting `9d5918f`, FrameGeneration host module `168d47e`, packaging
`40f2933`)**. CI run **45237797732 SUCCESS** (real toolchain): runtime + fsr3/fsr4/fg
providers built, portable smoke green, package ships `bin/order1886_fg.so` hash-listed
in package-manifest.json. FG SDK hardware proof: 4/4 vendored framegen GPU smokes pass
on this RTX 5050 with the validation layer, 0 warnings, incl. the engine's exact
RGBA16F/RG16F/R32F format combo. Live-game proof of the capture path: 240 s clean
session, 32 759 CB records, 0 faults. No release branch was touched.

Remaining integration (do paired with the owner driving the game as the visual validator,
NOT blind): (1) `ReplaceTemporalResolve` records FG via the host module into a
display-size `fg_frame`, reusing `frame->ready_semaphore` for cross-scheduler ordering;
(2) `Presenter::Present` does the generated→real two-present pair via
ffx-vulkan::framegeneration-presenter-policy — NOTE the `completed_presentations`
watermark is `present_done`-fence-driven (one signal per `Present()` call), so a second
`swapchain.Present()` inside the same call does not double-count it (verified by reading
PrepareLastFrame/GetRenderFrame); (3) `Wanted()` includes frame_generation so the prep
pass decodes motion with no upscaler selected; (4) HUD-region copy rects; (5) F1 row +
order1886_options/common/runtime.ini + settings.json; (6) live measure 30→60 and 60→120,
watch exit-23/pacing.

## Deliberately NOT done

No presenter hot-path surgery pushed unvalidated; no release-branch touches; no
"verified in game" claims for FG output quality (the presenter loop is unwired by
design until an owner-attended session validates it).


## Session 3 (evening) — provider hardware-validated; presenter implementation notes

- **Provider live pipeline OK on the RTX 5050**: `order1886_fg.so` create + 3 frames of
  prepare/dispatch/submit/wait/retire all return 0 (test kept at /tmp/fgprov.cpp).
  Harness lessons that ARE SDK contract: dispatch **output** image must carry
  `SAMPLED|STORAGE` usage; a FAILED dispatch leaves `prepared=true` so the next prepare
  rejects — on any dispatch failure, stop feeding until a `reset_history=1` frame
  (presenter must implement this containment); zero camera basis vectors are accepted
  but set a real basis anyway (up/right/forward) for fill quality.
- Resolve groundwork landed (`Wanted()` gate + prep-only mode + SceneFrame snapshot +
  ConsumeSceneFrame, compiles+pushed).
- **Presenter plan (validated against the code, pending live iteration)**:
  1. Frame struct additions (vk_presenter.h:29): `fg_hdr` (RGBA16F, `STORAGE|SAMPLED|
     TRANSFER_SRC`, display size) + `fg_display` (swap format, `COLOR_ATTACHMENT|
     TRANSFER_{SRC,DST}|SAMPLED`) + views + `bool fg_valid`; allocate/free in
     RecreateFrame alongside frame->image.
  2. Record FG at the END of PrepareFrame (draw scheduler, BEFORE `ready_semaphore`
     capture ~line 750): ConsumeSceneFrame -> framegen.PresentFrame(cmdbuf, scene,
     fg_hdr, W,H, ++fg_seq, reset, CompletedPresentations()); then `Frame shadow = *frame`
     with image/image_view swapped to fg_display and `pp_pass.Render(cmdbuf, fg_hdr_view,
     {W,H}, shadow, pp_settings)` — pp leaves output GENERAL, same as frame->image
     (verified in pp_pass.cpp); set fg_valid=true. All draw-queue -> covered by the
     existing ready_semaphore signal.
  3. Second present AFTER the real one in Presenter::Present, BEFORE free_frame():
     gate = fg_valid && vsync(eFifo) && !is_hdr && pacing gap: steady-clock delta
     between Presents > 1.4 x (1e6/EmulatorSettings.GetVblankFrequency()) us — GetVblankFrequency
     is a cached static (60 default, 480 when ORDER1886_VBLANK_HZ=0). Then:
     swapchain.AcquireNextImage() (sequential double-cycle needs NO swapchain change —
     image_acquired/present_ready are per-slot, frame_index cycles); record on
     present_scheduler: barriers (fg_display GENERAL->TSO, swapB UNDEFINED->TDST,
     frame->image GENERAL->TSO), band blit fg_display->swapB using the SAME
     MakeImageBlitBand rect, then per-HUD-rect copy frame->image->swapB at
     band-mapped dst coords (compute scale/offset from the band VkImageBlit
     src/dstOffsets), transition swapB->PRESENT_SRC (+overlay render if visible, else
     UI flickers 30Hz), flush with AddWait(image_acquired)+AddSignal(present_ready[B])
     and NO present_done signal (keep fence semantics = one watermark per flip),
     swapchain.Present().
  4. Ordering proof: cycle B's read of fg_hdr/fg_display (draw-queue writes) is transitively
     ordered: cycle B submitted after cycle A on the SAME present queue; cycle A waited
     frame->ready_semaphore (draw). No new semaphore needed; fg_valid per-Frame reset.
  5. framegen lifecycle: Load() in ctor when setting on; Create lazily first use
     (max_render = scene size, display = extent); recreate + reset on extent change;
     Retire(CompletedPresentations()) each flip; on ANY provider status != OK after
     frame 2: fg_disabled=true until restart + one printf (containment).
  6. Verify without eyes-first: ORDER1886 env of the existing frame-dump trigger
     (ORDER1886_FRAME_DUMP_TRIGGER + DumpRaw, presenter.cpp ~586) — add an `fg` dump of
     fg_display; assert generated != neighbours != black, then owner judges.
  7. F1 row (do LAST): ps4_overlay.cpp rows — model on Upscaling (~1157): Choice
     {"Off","On"}, value from s.frame_generation, Apply writes
     Ps4Settings::frame_generation + StoreForNextLaunch-style persist, badge "Restart"
     (swapchain image count + context fixed at creation); launcher field in
     order1886_options.py (graphics page) + common.py values + settings.json key
     frame_generation -> env ORDER1886_FRAMEGEN=1 already plumbed via runtime.ini.
- HUD rect v0 (normalized [x0,y0,x1,y1], display space): center 0.46-0.54 x 0.46-0.54
  (reticle); 0.0-1.0 x 0.70-0.86 (subtitle/QTE band bottom of the 2.4 interface band);
  0.62-1.0 x 0.78-1.0 (weapon HUD); 0.0-0.30 x 0.10-0.26 (objective); 0.36-0.64 x
  0.06-0.20 (top prompts). All five + crosshair confirmed against issue screenshots later.
