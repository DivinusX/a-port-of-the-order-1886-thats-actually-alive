// SPDX-FileCopyrightText: Copyright 2024 shadPS4 Emulator Project
// SPDX-License-Identifier: GPL-2.0-or-later

#version 450

layout (location = 0) in vec2 uv;
layout (location = 0) out vec4 color;

layout (binding = 0) uniform sampler2D texSampler;
// HDR boost (#66, vk_order_hdr.h): how much brighter each pixel may be than in SDR.
layout (binding = 1) uniform sampler2D boostSampler;

layout (push_constant) uniform settings {
    float gamma;
    uint hdr;        // 0 SDR, 1 game-supplied PQ, 2 HDR10 (#66), 3 HDR preview on SDR, 4 false colour
    bool srgb_input;
    float paper_white; // nits for SDR white (modes 2-4)
    float peak;        // nits for the brightest highlight (modes 2-4)
    bool use_boost;
} pp;

const float cutoff = 0.0031308, a = 1.055, b = 0.055, d = 12.92;
vec3 gamma(vec3 rgb) {
    return mix(
        a * pow(rgb, vec3(1.0 / (2.4 + 1.0 - pp.gamma))) - b,
        d * rgb / pp.gamma,
        lessThan(rgb, vec3(cutoff))
    );
}

// Exact inverse of gamma() at unit gamma, for buffers that are sRGB encoded but must be sampled
// through a UNORM view because Vulkan has no sRGB variant of the 10-bit format.
vec3 degamma(vec3 rgb) {
    return mix(
        pow(max(rgb + b, 0.0) / a, vec3(2.4)),
        rgb / d,
        lessThan(rgb, vec3(d * cutoff))
    );
}

// BT.709 primaries to BT.2020 (columns).
const mat3 rec709_to_rec2020 = mat3(
    0.6274, 0.0691, 0.0164,
    0.3293, 0.9195, 0.0880,
    0.0433, 0.0114, 0.8956);

// SMPTE ST 2084 (PQ) from absolute nits.
vec3 pq(vec3 nits) {
    const float m1 = 0.1593017578125, m2 = 78.84375;
    const float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
    const vec3 y = pow(clamp(nits / 10000.0, 0.0, 1.0), vec3(m1));
    return pow((c1 + c2 * y) / (1.0 + c3 * y), vec3(m2));
}

void main() {
    vec4 color_linear = texture(texSampler, uv);
    if (pp.hdr == 1u) {
        color = color_linear;
        return;
    }
    if (pp.srgb_input) color_linear.rgb = degamma(color_linear.rgb);
    if (pp.hdr < 2u) {
        color = vec4(gamma(color_linear.rgb), color_linear.a);
        return;
    }
    // #66: the SDR frame (linear, 1 = SDR white) times the boost.
    const float boost = pp.use_boost ? max(texture(boostSampler, uv).r, 1.0) : 1.0;
    const vec3 sdr = max(color_linear.rgb, vec3(0.0));
    const vec3 hdr = sdr * boost;
    const float range = max(pp.peak / pp.paper_white, 1.0);
    if (pp.hdr == 2u) {
        const vec3 nits = min(rec709_to_rec2020 * hdr * pp.paper_white, vec3(pp.peak));
        color = vec4(pq(max(nits, vec3(0.0))), 1.0);
    } else if (pp.hdr == 3u) {
        // Extended Reinhard with white at the peak: the whole HDR range in SDR.
        const vec3 shown = hdr * (1.0 + hdr / (range * range)) / (1.0 + hdr);
        color = vec4(gamma(clamp(shown, 0.0, 1.0)), 1.0);
    } else {
        // Boosted pixels tinted magenta, stronger the closer they get to the peak.
        const float t = boost > 1.001 ? clamp((boost - 1.0) / max(range - 1.0, 1e-3), 0.0, 1.0) : 0.0;
        const vec3 shown = mix(clamp(sdr, 0.0, 1.0), vec3(1.0, 0.0, 1.0), t > 0.0 ? 0.25 + 0.6 * t : 0.0);
        color = vec4(gamma(shown), 1.0);
    }
}
