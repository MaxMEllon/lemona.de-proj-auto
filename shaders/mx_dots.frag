#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: a halftone field of round dots. Their size follows a
// travelling interference wave, the low band swells them, kick (pad 1)
// sends a ring out from the centre, every bar the wave turns.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float dots;      // 10..120 = 42     dots across the height
    float speed;     // 0..4 = 1
    float swell;     // 0..2 = 0.8       low band growth
    float warp;      // 0..3 = 1         wave complexity
    bool  invert;    // = false
};

void main() {
    vec2 p = to_centered(v_uv);
    float bar = floor(u_beats / 4.0);
    vec2 q = rotate_deg(p, bar * 30.0);

    vec2 g = p * dots * 0.5;
    vec2 id = floor(g) + 0.5;
    vec2 f = fract(g) - 0.5;
    vec2 c = id / (dots * 0.5);
    vec2 cq = rotate_deg(c, bar * 30.0);

    float t = u_time * speed;
    float w = sin(cq.x * 3.0 + t) * cos(cq.y * 2.0 * warp - t * 0.7)
            + 0.5 * sin(length(c) * 6.0 * warp - t * 1.3);
    float size = 0.5 + 0.25 * w;

    // Kick ring travelling outwards over the beat.
    float kick = max(u_triggers.x, u_hits.y);
    float ring = exp(-pow((length(c) - u_phase * 2.2) * 6.0, 2.0)) * (0.4 + kick);
    size += ring * 0.5 + u_bands.y * swell * 0.4;
    size = clamp(size, 0.0, 1.2) * 0.5;

    float px = 1.5 * dots / u_resolution.y;
    float v = smoothstep(size + px, size - px, length(f));
    if (invert) v = 1.0 - v;
    f_color = vec4(vec3(v), 1.0);
}
