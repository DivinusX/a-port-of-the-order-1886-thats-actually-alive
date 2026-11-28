// SPDX-FileCopyrightText: Copyright 2026 shadPS4 Emulator Project
// SPDX-License-Identifier: GPL-2.0-or-later

#include <cassert>
#include <cstdio>

#include "video_core/texture_cache/texture_cache_budget.h"

int main() {
    using namespace VideoCore;

    constexpr s64 DEFAULT_PRESSURE = 1_GB + 512_MB;
    constexpr s64 DEFAULT_CRITICAL = 3_GB;
    constexpr s64 TARGET = 8_GB;

    // 1. 4 GB discrete GPU (RX 580 4GB): ~3.5 GiB startup budget, ~3.4 GiB live budget.
    const auto rx580_startup = ComputeStartupTextureCacheGcThresholds(
        3500_MB, TARGET, DEFAULT_PRESSURE, DEFAULT_CRITICAL);
    const auto rx580_live = RefineTextureCacheGcThresholds(rx580_startup, 3400_MB, false, 0);
    assert(rx580_live.trigger <= 3400_MB * 70 / 100);
    assert(rx580_live.pressure <= 3400_MB * 82 / 100);
    assert(rx580_live.critical <= 3400_MB * 90 / 100);
    // Leaves >= 340 MiB headroom below live budget for driver pipeline compilations.
    assert(3400_MB - rx580_live.critical >= 340_MB);

    // 2. If another app drops live budget to 2.8 GiB, discrete GPU thresholds tighten dynamically,
    //    and recover when live budget returns to 3.8 GiB (because startup baseline is preserved).
    const auto squeezed = RefineTextureCacheGcThresholds(rx580_startup, 2800_MB, false, 0);
    assert(squeezed.critical == 2800_MB * 90 / 100);
    const auto recovered = RefineTextureCacheGcThresholds(rx580_startup, 3800_MB, false, 0);
    assert(recovered.critical == rx580_startup.critical);

    // 3. Large discrete GPU (16 GB): normal startup thresholds are unaffected when VRAM is ample.
    const auto gpu16g_startup = ComputeStartupTextureCacheGcThresholds(
        14_GB, TARGET, DEFAULT_PRESSURE, DEFAULT_CRITICAL);
    const auto gpu16g_live = RefineTextureCacheGcThresholds(gpu16g_startup, 15_GB, false, 0);
    assert(gpu16g_live.trigger == gpu16g_startup.trigger);
    assert(gpu16g_live.pressure == gpu16g_startup.pressure);
    assert(gpu16g_live.critical == gpu16g_startup.critical);

    // 4. Integrated GPU and forced budget preserve 70% / 85% / 95% policy.
    const auto igpu = RefineTextureCacheGcThresholds(rx580_startup, 6_GB, true, 0);
    assert(igpu.trigger == 6_GB / 10 * 7);
    assert(igpu.pressure == 6_GB / 100 * 85);
    assert(igpu.critical == 6_GB / 100 * 95);

    const auto forced = RefineTextureCacheGcThresholds(gpu16g_startup, 15_GB, false, 3600_MB);
    assert(forced.trigger == 3600_MB / 10 * 7);
    assert(forced.pressure == 3600_MB / 100 * 85);
    assert(forced.critical == 3600_MB / 100 * 95);

    // 5. GC pass age window shrinks (never grows) as pressure rises.
    const auto normal = SelectTextureCacheGcPass(false, false, 500);
    const auto pressured = SelectTextureCacheGcPass(true, false, 500);
    const auto critical = SelectTextureCacheGcPass(true, true, 500);
    assert(normal.ticks_to_destroy > pressured.ticks_to_destroy);
    assert(pressured.ticks_to_destroy > critical.ticks_to_destroy);
    assert(critical.ticks_to_destroy == 2);
    assert(critical.max_deletions > pressured.max_deletions);
    assert(pressured.max_deletions > normal.max_deletions);

    // Clamps safely when gc_tick is tiny.
    const auto early = SelectTextureCacheGcPass(false, false, 1);
    assert(early.ticks_to_destroy == 1);

    std::puts("texture-cache-budget-test: OK");
    return 0;
}
