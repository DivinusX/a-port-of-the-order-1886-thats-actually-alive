// SPDX-FileCopyrightText: Copyright 2026 shadPS4 Emulator Project
// SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

#include <algorithm>
#include "common/types.h"

namespace VideoCore {

struct TextureCacheGcThresholds {
    u64 trigger{};
    u64 pressure{};
    u64 critical{};
};

struct TextureCacheGcPass {
    u64 ticks_to_destroy{};
    size_t max_deletions{};
};

/// Computes initial GC thresholds from the startup device-local budget.
inline TextureCacheGcThresholds ComputeStartupTextureCacheGcThresholds(s64 device_local_memory,
                                                                       s64 target_threshold,
                                                                       s64 default_pressure_floor,
                                                                       s64 default_critical_floor) {
    const s64 min_spacing_expected = device_local_memory - 1_GB;
    const s64 min_spacing_critical = device_local_memory - 512_MB;
    const s64 mem_threshold = std::min<s64>(device_local_memory, target_threshold);
    const s64 min_vacancy_expected = (6 * mem_threshold) / 10;
    const s64 min_vacancy_critical = (2 * mem_threshold) / 10;
    const s64 min_pressure_floor =
        std::clamp<s64>(device_local_memory / 4, 256_MB, default_pressure_floor);
    const s64 min_critical_floor =
        std::clamp<s64>(device_local_memory / 2, 512_MB, default_critical_floor);
    return {
        .trigger = static_cast<u64>(std::max<s64>(0, (device_local_memory - mem_threshold) / 2)),
        .pressure = static_cast<u64>(
            std::max<s64>(std::min(device_local_memory - min_vacancy_expected, min_spacing_expected),
                          min_pressure_floor)),
        .critical = static_cast<u64>(
            std::max<s64>(std::min(device_local_memory - min_vacancy_critical, min_spacing_critical),
                          min_critical_floor)),
    };
}

/// Refines GC thresholds against the driver's live heap budget. On discrete GPUs (especially 4 GB
/// cards, issue #73) tightening thresholds against live budget preserves headroom for driver
/// pipeline and shader allocations without disturbing large GPUs that have ample VRAM.
inline TextureCacheGcThresholds RefineTextureCacheGcThresholds(TextureCacheGcThresholds current,
                                                               u64 live_budget,
                                                               bool is_integrated,
                                                               u64 forced_budget) {
    if (forced_budget || is_integrated) {
        const u64 budget = forced_budget ? forced_budget : live_budget;
        if (budget != 0) {
            return {
                .trigger = budget / 10 * 7,
                .pressure = budget / 100 * 85,
                .critical = budget / 100 * 95,
            };
        }
        return current;
    }
    if (live_budget == 0) {
        return current;
    }
    // Keep ~10% of live VRAM free on discrete GPUs so driver pipeline compiles don't OOM.
    return {
        .trigger = std::min(current.trigger, live_budget * 70 / 100),
        .pressure = std::min(current.pressure, live_budget * 82 / 100),
        .critical = std::min(current.critical, live_budget * 90 / 100),
    };
}

/// Selects LRU age window and deletion cap for a GC pass. Age shrinks as pressure increases so
/// recently-streamed textures can still be evicted before VRAM is exhausted.
inline TextureCacheGcPass SelectTextureCacheGcPass(bool pressured, bool aggressive, u64 gc_tick) {
    const u64 min_age = aggressive ? 2 : pressured ? 8 : 16;
    const size_t max_deletions = aggressive ? 64 : pressured ? 24 : 10;
    return {
        .ticks_to_destroy = std::min(min_age, gc_tick),
        .max_deletions = max_deletions,
    };
}

} // namespace VideoCore
