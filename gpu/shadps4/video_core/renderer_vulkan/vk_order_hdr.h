// SPDX-License-Identifier: GPL-2.0-or-later
// HDR10 output for The Order: 1886 (#66, docs/order1886-hdr-plan.md).
//
// The game's frame is left exactly as it is. Three host-only steps add HDR at presentation:
//  1. after the tonemap draw (ps 0x4403da37) a gain map: how much brighter each scene pixel may be
//     shown, recovered from the scene colour before the game's filmic curve compressed it;
//  2. after the letterbox draw (ps 0xa41511a2) a snapshot of the display buffer, so that what is
//     drawn later (HUD, subtitles, prompts) can be told apart from the scene;
//  3. at presentation a boost image at display size: gain inside the scene, 1 on the HUD and bars.
// post_process.frag multiplies the SDR frame by the boost and encodes it as HDR10 (PQ, Rec.2020).
//
// Switches (environment, read once):
//   ORDER1886_HDR=1               HDR10 output when the display offers it (also allows the
//                                 HDR swapchain at all, EmulatorSettings::IsHdrAllowed)
//   ORDER1886_HDR_PAPER_WHITE=200 nits for SDR white (HUD, menus, the scene below the knee)
//   ORDER1886_HDR_PEAK=1000       nits for the brightest highlight
//   ORDER1886_HDR_KNEE=0.55       SDR level where highlights start to get brighter than in SDR
//   ORDER1886_HDR_PREVIEW=1|2     run the passes on an SDR display: 1 compresses the HDR range
//                                 into SDR, 2 tints boosted pixels (for checking without an HDR
//                                 display); ignored while HDR10 output is on
//   ORDER1886_HDR_DUMP_TRIGGER=<file>  when the file exists it is removed and the next composed
//                                 frame's gain map, snapshot and boost are written as raw pixels
//                                 to ORDER1886_DUMP_DIR (default: next to the trigger file)
#pragma once

#include <span>

#include "common/types.h"
#include "video_core/renderer_vulkan/vk_common.h"
#include "video_core/texture_cache/types.h"

namespace VideoCore {
class Image;
}

namespace Vulkan {

class Rasterizer;

namespace OrderHdr {

constexpr u64 TonemapPsHash = 0x4403da37;
constexpr u64 LetterboxPsHash = 0xa41511a2;

/// post_process.frag's `hdr` values.
enum OutputMode : u32 {
    OutputSdr = 0,
    OutputGamePq = 1,   ///< the game supplies PQ itself (shadPS4's own HDR path)
    OutputHdr10 = 2,    ///< this feature, HDR10 swapchain
    OutputPreview = 3,  ///< this feature on an SDR swapchain: the HDR range compressed into SDR
    OutputFalseColor = 4, ///< this feature on an SDR swapchain: boosted pixels tinted
};

/// ORDER1886_HDR=1.
[[nodiscard]] bool Wanted();
/// Called once by the swapchain: whether the surface offers HDR10 (A2B10G10R10, ST2084). Pins
/// the swapchain to HDR10 for the whole session when HDR is wanted and offered.
void ConfigureSurface(bool hdr10_offered);
/// HDR10 output for this session (wanted and offered).
[[nodiscard]] bool Hdr10();
/// The passes run (HDR10 output, or a preview on an SDR swapchain).
[[nodiscard]] bool Active();
/// post_process.frag mode for this session's frames (OutputSdr when inactive).
[[nodiscard]] u32 Output();
[[nodiscard]] float PaperWhite();
[[nodiscard]] float Peak();

/// After the tonemap draw is recorded. `images` are the draw's bound images, `target` its colour
/// target, `flatbuf` the pixel shader's flattened user data.
void OnTonemapDraw(Rasterizer& rasterizer, std::span<const VideoCore::ImageId> images,
                   VideoCore::ImageId target, std::span<const u32> flatbuf);
/// After the letterbox draw into a display buffer is recorded.
void OnLetterboxDraw(Rasterizer& rasterizer, VideoCore::ImageId display, VAddr address);

/// At presentation of the display buffer at `address`, before FSR 1. `display_view` samples it as
/// linear colour (an sRGB view) and has `view_format`; the image is in ShaderReadOnlyOptimal.
/// Returns the boost image's view (R16F, display size, ShaderReadOnlyOptimal for the fragment
/// stage) when this frame has a fresh gain map and snapshot, else a null view (boost 1).
vk::ImageView Compose(Rasterizer& rasterizer, vk::CommandBuffer cmdbuf, VAddr address,
                      VideoCore::Image& display, vk::ImageView display_view,
                      vk::Format view_format);

} // namespace OrderHdr
} // namespace Vulkan
