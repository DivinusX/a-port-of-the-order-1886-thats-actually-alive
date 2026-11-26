// SPDX-License-Identifier: GPL-2.0-or-later
// See vk_order_hdr.h and docs/order1886-hdr-plan.md.

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <optional>
#include <string>

#include "core/emulator_settings.h"
#include "video_core/host_shaders/order_hdr_compose_comp.h"
#include "video_core/host_shaders/order_hdr_gain_comp.h"
#include "video_core/renderer_vulkan/vk_instance.h"
#include "video_core/renderer_vulkan/vk_order_hdr.h"
#include "video_core/renderer_vulkan/vk_platform.h"
#include "video_core/renderer_vulkan/vk_rasterizer.h"
#include "video_core/renderer_vulkan/vk_runtime.h"
#include "video_core/renderer_vulkan/vk_scheduler.h"
#include "video_core/renderer_vulkan/vk_shader_util.h"
#include "video_core/texture_cache/texture_cache.h"

// After vk_common.h (via the headers above): it enables the beta extensions vulkan.hpp expects
// before anything includes vulkan.h.
#include <vk_mem_alloc.h>

namespace Vulkan::OrderHdr {

namespace {

float EnvFloat(const char* name, float fallback, float lo, float hi) {
    const char* v = std::getenv(name);
    if (!v || !*v) {
        return fallback;
    }
    char* end = nullptr;
    const float value = std::strtof(v, &end);
    if (end == v || !std::isfinite(value)) {
        return fallback;
    }
    return std::clamp(value, lo, hi);
}

struct Config {
    bool wanted;
    float paper_white;
    float peak;
    float knee;
    int preview;
    const char* dump_trigger;
};

const Config& Cfg() {
    static const Config config = [] {
        Config c{};
        c.wanted = EmulatorSettings.IsHdrAllowed();
        c.paper_white = EnvFloat("ORDER1886_HDR_PAPER_WHITE", 200.0f, 80.0f, 500.0f);
        c.peak = std::max(EnvFloat("ORDER1886_HDR_PEAK", 1000.0f, 200.0f, 10000.0f), c.paper_white);
        c.knee = EnvFloat("ORDER1886_HDR_KNEE", 0.55f, 0.2f, 0.95f);
        c.preview = int(EmulatorSettingsImpl::Number("ORDER1886_HDR_PREVIEW", 0));
        c.dump_trigger = std::getenv("ORDER1886_HDR_DUMP_TRIGGER");
        return c;
    }();
    return config;
}

/// -1 until the swapchain reports, then 0 (no HDR10) or 1 (HDR10 offered).
std::atomic<int> surface_hdr10{-1};

float Float(std::span<const u32> flatbuf, size_t index) {
    float value;
    std::memcpy(&value, &flatbuf[index], sizeof(value));
    return value;
}

/// The game's filmic curve (ps 0x4403da37), with E = 0.01 and F = 0.3 scaled by D as the shader
/// does, blended with linear.
struct Curve {
    float blend, A, B, C, D, white_scale;

    float Hable(float x) const {
        const float num = x * (A * x + C * B) + D * 0.01f;
        const float den = x * (A * x + B) + D * 0.3f;
        return num / den - 0.01f / 0.3f;
    }
    float Sdr(float x) const {
        return x + blend * (Hable(x) * white_scale - x);
    }
};

/// Push constants of order_hdr_gain.comp.
struct GainPush {
    u32 width, height;
    float exposure_const;
    u32 exposure_from_tex;
    float aspect;
    float vignette_power, vignette_scale, vignette_bias;
    float blend, A, B, C, D, white_scale;
    float knee_x, knee_y, knee_slope, peak;
};

/// Push constants of order_hdr_compose.comp.
struct ComposePush {
    u32 display_width, display_height;
    s32 offset_x, offset_y;
    u32 scene_width, scene_height;
};

struct Pass {
    vk::UniqueDescriptorSetLayout set_layout;
    vk::UniquePipelineLayout layout;
    vk::UniquePipeline pipeline;

    /// `sampled` sampled images (bindings 0..sampled-1), then one storage image.
    void Create(vk::Device device, std::span<const u32> code, u32 sampled, u32 push_size) {
        std::array<vk::DescriptorSetLayoutBinding, 4> bindings{};
        const u32 count = sampled + 1;
        for (u32 i = 0; i < count; ++i) {
            bindings[i] = {.binding = i,
                           .descriptorType = i < sampled ? vk::DescriptorType::eSampledImage
                                                         : vk::DescriptorType::eStorageImage,
                           .descriptorCount = 1,
                           .stageFlags = vk::ShaderStageFlagBits::eCompute};
        }
        set_layout = Check(device.createDescriptorSetLayoutUnique({
            .flags = vk::DescriptorSetLayoutCreateFlagBits::ePushDescriptorKHR,
            .bindingCount = count,
            .pBindings = bindings.data(),
        }));
        const vk::PushConstantRange range{vk::ShaderStageFlagBits::eCompute, 0, push_size};
        layout = Check(device.createPipelineLayoutUnique({
            .setLayoutCount = 1,
            .pSetLayouts = &*set_layout,
            .pushConstantRangeCount = 1,
            .pPushConstantRanges = &range,
        }));
        const auto module = CompileSPV(code, device);
        pipeline = Check(device.createComputePipelineUnique(
            {}, vk::ComputePipelineCreateInfo{
                    .stage = {.stage = vk::ShaderStageFlagBits::eCompute,
                              .module = module,
                              .pName = "main"},
                    .layout = *layout,
                }));
        device.destroyShaderModule(module);
    }
};

/// A host image this feature owns.
struct OwnImage {
    std::optional<VideoCore::UniqueImage> image;
    vk::UniqueImageView view;
    vk::Format format{};
    vk::Format view_format{};
    u32 width = 0, height = 0;

    bool Matches(vk::Format f, u32 w, u32 h) const {
        return image && format == f && width == w && height == h;
    }

    void Create(const Instance& instance, vk::Format f, u32 w, u32 h, vk::ImageUsageFlags usage,
                bool mutable_format) {
        const vk::Device device = instance.GetDevice();
        view.reset();
        image.emplace(device, instance.GetAllocator());
        image->Create(vk::ImageCreateInfo{
            .flags = mutable_format ? vk::ImageCreateFlagBits::eMutableFormat
                                    : vk::ImageCreateFlags{},
            .imageType = vk::ImageType::e2D,
            .format = f,
            .extent = {w, h, 1},
            .mipLevels = 1,
            .arrayLayers = 1,
            .samples = vk::SampleCountFlagBits::e1,
            .usage = usage,
            .initialLayout = vk::ImageLayout::eUndefined,
        });
        format = f;
        width = w;
        height = h;
        SetView(device, f);
    }

    void SetView(vk::Device device, vk::Format f) {
        view = Check(device.createImageViewUnique({
            .image = *image,
            .viewType = vk::ImageViewType::e2D,
            .format = f,
            .subresourceRange = {vk::ImageAspectFlagBits::eColor, 0, 1, 0, 1},
        }));
        view_format = f;
    }
};

struct State {
    bool ready = false;
    vk::Device device{};
    Pass gain_pass, compose_pass;
    OwnImage gain, snapshot, boost;
    bool gain_fresh = false;
    bool snapshot_fresh = false;
    VAddr snapshot_address = 0;
    u64 gain_frames = 0, composed = 0;
    u32 skips_logged = 0;
    bool knee_logged = false;

    void Create(const Instance& instance) {
        device = instance.GetDevice();
        gain_pass.Create(device, ORDER_HDR_GAIN_COMP, 2, sizeof(GainPush));
        compose_pass.Create(device, ORDER_HDR_COMPOSE_COMP, 3, sizeof(ComposePush));
        ready = true;
    }

    void Skip(const char* why) {
        if (skips_logged < 8) {
            ++skips_logged;
            std::printf("HDR: no gain map for this frame (%s)\n", why);
            std::fflush(stdout);
        }
    }
};

State& S() {
    static State state;
    return state;
}

vk::ImageMemoryBarrier2 Barrier(vk::Image image, vk::ImageLayout from, vk::ImageLayout to,
                                vk::PipelineStageFlags2 src_stage, vk::AccessFlags2 src_access,
                                vk::PipelineStageFlags2 dst_stage, vk::AccessFlags2 dst_access) {
    return vk::ImageMemoryBarrier2{
        .srcStageMask = src_stage,
        .srcAccessMask = src_access,
        .dstStageMask = dst_stage,
        .dstAccessMask = dst_access,
        .oldLayout = from,
        .newLayout = to,
        .image = image,
        .subresourceRange = {vk::ImageAspectFlagBits::eColor, 0, 1, 0, 1},
    };
}

vk::ImageView ViewOf(VideoCore::Image& image) {
    VideoCore::ImageViewInfo info{};
    info.format = image.info.pixel_format;
    return *image.FindView(info).image_view;
}

/// Raw copy of a host image (ShaderReadOnlyOptimal) written once the GPU is done; the image is
/// back in ShaderReadOnlyOptimal for `dst_stage` afterwards.
void DumpImage(const Instance& instance, Scheduler& scheduler, vk::CommandBuffer cmdbuf,
               vk::Image image, u32 w, u32 h, u32 bytes_per_pixel, vk::PipelineStageFlags2 dst_stage,
               const std::string& path) {
    const VkBufferCreateInfo buffer_ci{.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                                       .size = VkDeviceSize(w) * h * bytes_per_pixel,
                                       .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT};
    const VmaAllocationCreateInfo alloc_ci{
        .flags = VMA_ALLOCATION_CREATE_MAPPED_BIT | VMA_ALLOCATION_CREATE_HOST_ACCESS_RANDOM_BIT,
        .usage = VMA_MEMORY_USAGE_AUTO_PREFER_HOST};
    VkBuffer buffer{};
    VmaAllocation allocation{};
    VmaAllocationInfo info{};
    if (vmaCreateBuffer(instance.GetAllocator(), &buffer_ci, &alloc_ci, &buffer, &allocation,
                        &info) != VK_SUCCESS) {
        return;
    }
    const auto ro = vk::ImageLayout::eShaderReadOnlyOptimal;
    const auto src = vk::ImageLayout::eTransferSrcOptimal;
    const auto transfer = vk::PipelineStageFlagBits2::eTransfer;
    const auto to_copy = Barrier(image, ro, src, vk::PipelineStageFlagBits2::eAllCommands,
                                 vk::AccessFlagBits2::eMemoryWrite, transfer,
                                 vk::AccessFlagBits2::eTransferRead);
    cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &to_copy});
    cmdbuf.copyImageToBuffer(image, src, buffer,
                             vk::BufferImageCopy{.imageSubresource = {vk::ImageAspectFlagBits::eColor, 0, 0, 1},
                                                 .imageExtent = {w, h, 1}});
    const auto back = Barrier(image, src, ro, transfer, vk::AccessFlagBits2::eTransferRead,
                              dst_stage, vk::AccessFlagBits2::eShaderRead);
    cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &back});
    scheduler.DeferPriorityOperation([allocator = instance.GetAllocator(), buffer, allocation, info,
                                      size = buffer_ci.size, path] {
        vmaInvalidateAllocation(allocator, allocation, 0, VK_WHOLE_SIZE);
        if (FILE* f = std::fopen(path.c_str(), "wb")) {
            std::fwrite(info.pMappedData, 1, size, f);
            std::fclose(f);
            std::printf("HDR: wrote %s\n", path.c_str());
            std::fflush(stdout);
        }
        vmaDestroyBuffer(allocator, buffer, allocation);
    });
}

} // namespace

bool Wanted() {
    return Cfg().wanted;
}

void ConfigureSurface(bool hdr10_offered) {
    int expected = -1;
    if (!surface_hdr10.compare_exchange_strong(expected, hdr10_offered ? 1 : 0)) {
        return;
    }
    const auto& c = Cfg();
    if (c.wanted && hdr10_offered) {
        std::printf("HDR: HDR10 output on (paper white %.0f nits, peak %.0f nits, knee %.2f)\n",
                    c.paper_white, c.peak, c.knee);
    } else if (c.wanted) {
        std::printf("HDR: asked for, but this display does not offer HDR10 (turn on \"Use HDR\" in "
                    "the Windows display settings); output stays SDR%s\n",
                    c.preview ? ", HDR preview on" : "");
    } else if (c.preview) {
        std::printf("HDR: preview %d on an SDR display (paper white %.0f nits, peak %.0f nits)\n",
                    c.preview, c.paper_white, c.peak);
    }
    std::fflush(stdout);
}

bool Hdr10() {
    return Cfg().wanted && surface_hdr10.load(std::memory_order_relaxed) == 1;
}

bool Active() {
    return Hdr10() || Cfg().preview > 0;
}

u32 Output() {
    if (Hdr10()) {
        return OutputHdr10;
    }
    switch (Cfg().preview) {
    case 1:
        return OutputPreview;
    case 2:
        return OutputFalseColor;
    default:
        return OutputSdr;
    }
}

float PaperWhite() {
    return Cfg().paper_white;
}

float Peak() {
    return Cfg().peak;
}

void OnTonemapDraw(Rasterizer& rasterizer, std::span<const VideoCore::ImageId> images,
                   VideoCore::ImageId target, std::span<const u32> flatbuf) {
    if (!Active() || !target) {
        return;
    }
    auto& runtime = rasterizer.GetRuntime();
    auto& texture_cache = rasterizer.GetTextureCache();
    auto& scheduler = runtime.GetScheduler();
    const auto& instance = runtime.GetInstance();
    auto& st = S();
    if (!st.ready) {
        st.Create(instance);
    }

    const auto& target_image = texture_cache.GetImage(target);
    const u32 w = target_image.info.size.width, h = target_image.info.size.height;
    VideoCore::ImageId scene_id{}, exposure_id{};
    for (const auto id : images) {
        if (!id || id == target) {
            continue;
        }
        const auto& image = texture_cache.GetImage(id);
        const auto format = image.info.pixel_format;
        if (format == vk::Format::eR32Sfloat && image.info.size.width == 1 &&
            image.info.size.height == 1) {
            exposure_id = id;
        } else if (format == vk::Format::eR16G16B16A16Sfloat && image.info.num_samples == 1 &&
                   image.info.size.width == w && image.info.size.height == h) {
            scene_id = id;
        }
    }
    if (!scene_id || !exposure_id) {
        return st.Skip("tonemap inputs not recognised");
    }
    if (flatbuf.size() < 77) {
        return st.Skip("tonemap constants missing");
    }

    // Flat indices of the shader's constants (its ReadConst flags; docs/order1886-hdr-plan.md).
    Curve curve{.blend = Float(flatbuf, 33),
                .A = Float(flatbuf, 34),
                .B = Float(flatbuf, 35),
                .C = Float(flatbuf, 36),
                .D = Float(flatbuf, 37),
                .white_scale = 1.0f};
    const float white = Float(flatbuf, 38);
    const float hable_white = curve.Hable(white);
    if (!(hable_white > 1e-4f) || !std::isfinite(hable_white) || !(curve.D > 0.0f)) {
        return st.Skip("tonemap curve constants out of range");
    }
    curve.white_scale = 1.0f / hable_white;

    // The knee: where the SDR curve reaches Cfg().knee (it rises monotonically).
    const auto& c = Cfg();
    const float peak = c.peak / c.paper_white;
    float lo = 1e-4f, hi = 64.0f;
    float knee_x = 1e9f, knee_y = 1.0f, knee_slope = 0.0f;
    if (curve.Sdr(hi) > c.knee && curve.Sdr(lo) < c.knee) {
        for (int i = 0; i < 40; ++i) {
            const float mid = 0.5f * (lo + hi);
            (curve.Sdr(mid) < c.knee ? lo : hi) = mid;
        }
        knee_x = 0.5f * (lo + hi);
        knee_y = curve.Sdr(knee_x);
        const float step = std::max(knee_x * 1e-3f, 1e-5f);
        knee_slope = (curve.Sdr(knee_x + step) - curve.Sdr(knee_x - step)) / (2.0f * step);
    }
    if (!st.knee_logged) {
        st.knee_logged = true;
        std::printf("HDR: gain map from tonemap %#llx at %ux%u (curve A %g B %g C %g D %g W %g "
                    "blend %g; knee at exposed %.3f = SDR %.3f, slope %.3f; peak %.2fx)\n",
                    static_cast<unsigned long long>(TonemapPsHash), w, h, curve.A, curve.B,
                    curve.C, curve.D, white, curve.blend, knee_x, knee_y, knee_slope, peak);
        std::fflush(stdout);
    }

    if (!st.gain.Matches(vk::Format::eR16Sfloat, w, h)) {
        scheduler.Finish(); // the previous gain map may still be in use
        st.gain.Create(instance, vk::Format::eR16Sfloat, w, h,
                       vk::ImageUsageFlagBits::eStorage | vk::ImageUsageFlagBits::eSampled |
                           vk::ImageUsageFlagBits::eTransferSrc,
                       false);
    }

    auto& scene = texture_cache.GetImage(scene_id);
    auto& exposure = texture_cache.GetImage(exposure_id);
    scheduler.EndRendering();
    runtime.Transit(&scene, vk::ImageLayout::eShaderReadOnlyOptimal,
                    vk::PipelineStageFlagBits2::eComputeShader, vk::AccessFlagBits2::eShaderRead);
    runtime.Transit(&exposure, vk::ImageLayout::eShaderReadOnlyOptimal,
                    vk::PipelineStageFlagBits2::eComputeShader, vk::AccessFlagBits2::eShaderRead);
    runtime.FlushBarriers();

    const GainPush push{
        .width = w,
        .height = h,
        .exposure_const = Float(flatbuf, 39),
        .exposure_from_tex = Float(flatbuf, 40) != 0.0f ? 1u : 0u,
        .aspect = Float(flatbuf, 76) != 0.0f ? Float(flatbuf, 75) / Float(flatbuf, 76)
                                             : float(h) / float(std::max(w, 1u)),
        .vignette_power = Float(flatbuf, 54),
        .vignette_scale = Float(flatbuf, 55),
        .vignette_bias = Float(flatbuf, 41),
        .blend = curve.blend,
        .A = curve.A,
        .B = curve.B,
        .C = curve.C,
        .D = curve.D,
        .white_scale = curve.white_scale,
        .knee_x = knee_x,
        .knee_y = knee_y,
        .knee_slope = knee_slope,
        .peak = peak,
    };
    const vk::ImageView scene_in = ViewOf(scene), exposure_in = ViewOf(exposure);
    const vk::Image gain_image = *st.gain.image;
    const vk::ImageView gain_view = *st.gain.view;
    const vk::Pipeline pipeline = *st.gain_pass.pipeline;
    const vk::PipelineLayout layout = *st.gain_pass.layout;
    scheduler.Record([=](vk::CommandBuffer cmdbuf) {
        const auto compute = vk::PipelineStageFlagBits2::eComputeShader;
        const auto rw = vk::AccessFlagBits2::eShaderRead | vk::AccessFlagBits2::eShaderWrite;
        const auto start = Barrier(gain_image, vk::ImageLayout::eUndefined,
                                   vk::ImageLayout::eGeneral,
                                   vk::PipelineStageFlagBits2::eAllCommands, rw, compute, rw);
        cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &start});
        const std::array<vk::DescriptorImageInfo, 3> infos{{
            {{}, scene_in, vk::ImageLayout::eShaderReadOnlyOptimal},
            {{}, exposure_in, vk::ImageLayout::eShaderReadOnlyOptimal},
            {{}, gain_view, vk::ImageLayout::eGeneral},
        }};
        std::array<vk::WriteDescriptorSet, 3> writes{};
        for (u32 i = 0; i < writes.size(); ++i) {
            writes[i] = {.dstBinding = i,
                         .descriptorCount = 1,
                         .descriptorType = i < 2 ? vk::DescriptorType::eSampledImage
                                                 : vk::DescriptorType::eStorageImage,
                         .pImageInfo = &infos[i]};
        }
        cmdbuf.bindPipeline(vk::PipelineBindPoint::eCompute, pipeline);
        cmdbuf.pushDescriptorSetKHR(vk::PipelineBindPoint::eCompute, layout, 0, writes);
        cmdbuf.pushConstants(layout, vk::ShaderStageFlagBits::eCompute, 0, sizeof(push), &push);
        cmdbuf.dispatch((push.width + 7) / 8, (push.height + 7) / 8, 1);
        const auto done = Barrier(gain_image, vk::ImageLayout::eGeneral,
                                  vk::ImageLayout::eShaderReadOnlyOptimal, compute,
                                  vk::AccessFlagBits2::eShaderWrite, compute,
                                  vk::AccessFlagBits2::eShaderRead);
        cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &done});
    });
    st.gain_fresh = true;
    ++st.gain_frames;
}

void OnLetterboxDraw(Rasterizer& rasterizer, VideoCore::ImageId display, VAddr address) {
    if (!Active() || !display) {
        return;
    }
    auto& runtime = rasterizer.GetRuntime();
    auto& texture_cache = rasterizer.GetTextureCache();
    auto& scheduler = runtime.GetScheduler();
    const auto& instance = runtime.GetInstance();
    auto& st = S();
    if (!st.ready) {
        st.Create(instance);
    }
    auto& image = texture_cache.GetImage(display);
    const u32 w = image.info.size.width, h = image.info.size.height;
    const vk::Format format = image.info.pixel_format;
    if (!(image.usage_flags & vk::ImageUsageFlagBits::eTransferSrc)) {
        return st.Skip("display buffer cannot be copied");
    }
    if (!st.snapshot.Matches(format, w, h)) {
        scheduler.Finish(); // the previous snapshot may still be in use
        st.snapshot.Create(instance, format, w, h,
                           vk::ImageUsageFlagBits::eTransferDst | vk::ImageUsageFlagBits::eSampled |
                               vk::ImageUsageFlagBits::eTransferSrc,
                           true);
    }
    scheduler.EndRendering();
    runtime.Transit(&image, vk::ImageLayout::eTransferSrcOptimal,
                    vk::PipelineStageFlagBits2::eTransfer, vk::AccessFlagBits2::eTransferRead);
    runtime.FlushBarriers();
    const vk::Image source = image.GetImage();
    const vk::Image snapshot = *st.snapshot.image;
    scheduler.Record([=](vk::CommandBuffer cmdbuf) {
        const auto transfer = vk::PipelineStageFlagBits2::eTransfer;
        const auto start = Barrier(snapshot, vk::ImageLayout::eUndefined,
                                   vk::ImageLayout::eTransferDstOptimal,
                                   vk::PipelineStageFlagBits2::eAllCommands,
                                   vk::AccessFlagBits2::eShaderRead, transfer,
                                   vk::AccessFlagBits2::eTransferWrite);
        cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &start});
        const vk::ImageCopy region{
            .srcSubresource = {vk::ImageAspectFlagBits::eColor, 0, 0, 1},
            .dstSubresource = {vk::ImageAspectFlagBits::eColor, 0, 0, 1},
            .extent = {w, h, 1},
        };
        cmdbuf.copyImage(source, vk::ImageLayout::eTransferSrcOptimal, snapshot,
                         vk::ImageLayout::eTransferDstOptimal, region);
        const auto done = Barrier(snapshot, vk::ImageLayout::eTransferDstOptimal,
                                  vk::ImageLayout::eShaderReadOnlyOptimal, transfer,
                                  vk::AccessFlagBits2::eTransferWrite,
                                  vk::PipelineStageFlagBits2::eComputeShader,
                                  vk::AccessFlagBits2::eShaderRead);
        cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &done});
    });
    st.snapshot_fresh = true;
    st.snapshot_address = address;
}

vk::ImageView Compose(Rasterizer& rasterizer, vk::CommandBuffer cmdbuf, VAddr address,
                      VideoCore::Image& display, vk::ImageView display_view,
                      vk::Format view_format) {
    auto& st = S();
    if (!Active() || !st.ready) {
        return {};
    }
    const bool fresh = st.gain_fresh && st.snapshot_fresh && st.snapshot_address == address;
    st.gain_fresh = false;
    st.snapshot_fresh = false;
    const u32 dw = display.info.size.width, dh = display.info.size.height;
    if (!fresh || !st.gain.image || !st.snapshot.image || st.snapshot.width != dw ||
        st.snapshot.height != dh) {
        return {}; // menus, movies, loading screens: SDR at paper white
    }
    auto& runtime = rasterizer.GetRuntime();
    const auto& instance = runtime.GetInstance();
    auto& scheduler = runtime.GetScheduler();
    if (st.snapshot.view_format != view_format) {
        st.snapshot.SetView(st.device, view_format);
    }
    if (!st.boost.Matches(vk::Format::eR16Sfloat, dw, dh)) {
        // Rare (display buffer size change): the previous boost image may still be read.
        (void)st.device.waitIdle();
        st.boost.Create(instance, vk::Format::eR16Sfloat, dw, dh,
                        vk::ImageUsageFlagBits::eStorage | vk::ImageUsageFlagBits::eSampled |
                            vk::ImageUsageFlagBits::eTransferSrc,
                        false);
    }

    const ComposePush push{
        .display_width = dw,
        .display_height = dh,
        .offset_x = s32(std::floor((float(dw) - float(st.gain.width)) * 0.5f)),
        .offset_y = s32(std::floor((float(dh) - float(st.gain.height)) * 0.5f)),
        .scene_width = st.gain.width,
        .scene_height = st.gain.height,
    };
    const auto compute = vk::PipelineStageFlagBits2::eComputeShader;
    const auto rw = vk::AccessFlagBits2::eShaderRead | vk::AccessFlagBits2::eShaderWrite;
    const vk::MemoryBarrier2 inputs{.srcStageMask = vk::PipelineStageFlagBits2::eAllCommands,
                                    .srcAccessMask = vk::AccessFlagBits2::eMemoryWrite,
                                    .dstStageMask = compute,
                                    .dstAccessMask = vk::AccessFlagBits2::eShaderRead};
    const auto start = Barrier(*st.boost.image, vk::ImageLayout::eUndefined,
                               vk::ImageLayout::eGeneral, vk::PipelineStageFlagBits2::eAllCommands,
                               rw, compute, rw);
    cmdbuf.pipelineBarrier2({.memoryBarrierCount = 1,
                             .pMemoryBarriers = &inputs,
                             .imageMemoryBarrierCount = 1,
                             .pImageMemoryBarriers = &start});
    const std::array<vk::DescriptorImageInfo, 4> infos{{
        {{}, display_view, vk::ImageLayout::eShaderReadOnlyOptimal},
        {{}, *st.snapshot.view, vk::ImageLayout::eShaderReadOnlyOptimal},
        {{}, *st.gain.view, vk::ImageLayout::eShaderReadOnlyOptimal},
        {{}, *st.boost.view, vk::ImageLayout::eGeneral},
    }};
    std::array<vk::WriteDescriptorSet, 4> writes{};
    for (u32 i = 0; i < writes.size(); ++i) {
        writes[i] = {.dstBinding = i,
                     .descriptorCount = 1,
                     .descriptorType = i < 3 ? vk::DescriptorType::eSampledImage
                                             : vk::DescriptorType::eStorageImage,
                     .pImageInfo = &infos[i]};
    }
    cmdbuf.bindPipeline(vk::PipelineBindPoint::eCompute, *st.compose_pass.pipeline);
    cmdbuf.pushDescriptorSetKHR(vk::PipelineBindPoint::eCompute, *st.compose_pass.layout, 0,
                                writes);
    cmdbuf.pushConstants(*st.compose_pass.layout, vk::ShaderStageFlagBits::eCompute, 0,
                         sizeof(push), &push);
    cmdbuf.dispatch((dw + 7) / 8, (dh + 7) / 8, 1);
    const auto fragment = vk::PipelineStageFlagBits2::eFragmentShader;
    const auto done = Barrier(*st.boost.image, vk::ImageLayout::eGeneral,
                              vk::ImageLayout::eShaderReadOnlyOptimal, compute,
                              vk::AccessFlagBits2::eShaderWrite, fragment,
                              vk::AccessFlagBits2::eShaderRead);
    cmdbuf.pipelineBarrier2({.imageMemoryBarrierCount = 1, .pImageMemoryBarriers = &done});

    const u64 count = ++st.composed;
    if (count == 1 || count % 3600 == 0) {
        std::printf("HDR: %llu frames composed (display %ux%u, scene %ux%u at %d,%d; %llu gain "
                    "maps)\n",
                    static_cast<unsigned long long>(count), dw, dh, st.gain.width, st.gain.height,
                    push.offset_x, push.offset_y, static_cast<unsigned long long>(st.gain_frames));
        std::fflush(stdout);
    }

    const auto& c = Cfg();
    if (c.dump_trigger && std::remove(c.dump_trigger) == 0) {
        static int index = 0;
        const char* dir_env = std::getenv("ORDER1886_DUMP_DIR");
        std::filesystem::path dir = dir_env && *dir_env
                                        ? std::filesystem::path(dir_env)
                                        : std::filesystem::path(c.dump_trigger).parent_path();
        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        const auto name = [&](const char* what, u32 w, u32 h, const char* ext) {
            char file[96];
            std::snprintf(file, sizeof(file), "hdr_%03d_%s_%ux%u.%s", index, what, w, h, ext);
            return (dir / file).string();
        };
        DumpImage(instance, scheduler, cmdbuf, *st.boost.image, dw, dh, 2, fragment,
                  name("boost", dw, dh, "r16f"));
        DumpImage(instance, scheduler, cmdbuf, *st.gain.image, st.gain.width, st.gain.height, 2,
                  compute, name("gain", st.gain.width, st.gain.height, "r16f"));
        DumpImage(instance, scheduler, cmdbuf, *st.snapshot.image, dw, dh, 4, compute,
                  name("snapshot", dw, dh, "rgba8"));
        ++index;
    }
    return *st.boost.view;
}

} // namespace Vulkan::OrderHdr
