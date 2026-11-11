#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Black & white, hard-edged, driven by band hits (AUDIO / PERFORMANCE "hits"):
// low (kick) punches a disc and throws a ring outward, high (hats) flickers
// bars across the frame. Layers combine by XOR, so overlaps flip, never grey.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float size;      // 0.05..0.6 = 0.22   disc radius at rest
    float punch;     // 0..1 = 0.35        how much a kick grows the disc
    float ring;      // 0..0.1 = 0.025     thickness of the kick ring
    float bars;      // 4..64 = 24         rows for the hat bars
    float density;   // 0..1 = 0.5         share of rows a full hat lights
    bool  flip;      // = true             one-frame inverted flash on each kick
};

// 1 inside (d < 0), 0 outside, with a one-pixel edge so shapes stay solid.
float solid(float d) {
    float px = 2.0 / u_resolution.y;
    return 1.0 - clamp(d / px + 0.5, 0.0, 1.0);
}

void main() {
    vec2 p = to_centered(v_uv);
    float kick = u_hits.x + u_hits.y;
    float hat = u_hits.w;
    float r = length(p);

    // Low: the disc punches out with the kick and settles back.
    float disc = solid(r - size * (1.0 + punch * kick));
    // Low: a ring leaves the disc as the kick decays.
    float ring_r = size + (1.0 - kick) * 1.6;
    float wave = kick > 0.02 ? solid(abs(r - ring_r) - ring) : 0.0;
    // Idle: a thin ring broken into beat-rotating segments.
    float a = atan(p.y, p.x) / 6.2831853 + 0.5;
    float segs = step(0.5, fract(a * 8.0 + u_beats * 0.25));
    float idle = solid(abs(r - size * 1.6) - 0.004) * segs;

    // High: rows light at random, more of them the stronger the hat.
    float row = floor(v_uv.y * bars);
    float seed = floor(u_time * 24.0);
    float lit = step(1.0 - hat * density, hash21(vec2(row, seed)));
    float span = hash21(vec2(row, seed + 7.0));
    float x = v_uv.x - hash21(vec2(row, seed + 3.0)) * (1.0 - span);
    float bar = lit * step(0.0, x) * step(x, span) * step(0.35, fract(v_uv.y * bars));

    // XOR the layers: overlaps flip instead of blending.
    float v = abs(abs(abs(disc - wave) - idle) - bar);
    // A hit starts at exactly 1 and is below 0.9 within ~6 ms: one frame.
    if (flip && kick > 0.9) {
        v = 1.0 - v;
    }
    f_color = vec4(vec3(v), 1.0);
}
