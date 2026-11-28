// SPDX-FileCopyrightText: Copyright 2026 shadPS4 Emulator Project
// SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

#include "common/types.h"

namespace VideoCore {

/// Gates per-submission maintenance work to run at most once per GPU frame, with a submission
/// fallback when frame counters do not advance (loading screens, menus, or synthetic tests).
struct FrameCadence {
    u64 last_gpu_frame = 0;
    u32 submits_since_step = 0;

    bool Step(u64 gpu_frame, u32 fallback_submits = 128) noexcept {
        if (gpu_frame != last_gpu_frame) {
            last_gpu_frame = gpu_frame;
            submits_since_step = 0;
            return true;
        }
        if (fallback_submits > 0 && ++submits_since_step >= fallback_submits) {
            submits_since_step = 0;
            return true;
        }
        return false;
    }
};

} // namespace VideoCore
