//  SPDX-FileCopyrightText: Copyright 2024 shadPS4 Emulator Project
//  SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

#include "common/types.h"
#include "video_core/renderer_vulkan/vk_common.h"

namespace Vulkan {
class Frame;
}

namespace Vulkan::HostPasses {

class PostProcessingPass {
public:
    struct Settings {
        float gamma = 1.0f;
        u32 hdr = 0; ///< OrderHdr::OutputMode: 0 SDR, 1 game PQ, 2 HDR10, 3/4 SDR previews
        u32 srgb_input = 0;
        float paper_white = 200.0f; ///< nits for SDR white (modes 2-4)
        float peak = 1000.0f;       ///< nits for the brightest highlight (modes 2-4)
        u32 use_boost = 0;          ///< multiply by the boost image (modes 2-4)
    };

    void Create(vk::Device device, vk::Format surface_format);

    /// `boost` (R16F, ShaderReadOnlyOptimal) is read when settings.use_boost is set.
    void Render(vk::CommandBuffer cmdbuf, vk::ImageView input, vk::Extent2D input_size,
                Frame& output, Settings settings, vk::ImageView boost = {});

private:
    vk::UniquePipeline pipeline{};
    vk::UniquePipelineLayout pipeline_layout{};
    vk::UniqueDescriptorSetLayout desc_set_layout{};
    vk::UniqueSampler sampler{};
};

} // namespace Vulkan::HostPasses
