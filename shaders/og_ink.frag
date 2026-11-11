#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Organic: marbled ink. Three nested layers of domain-warped fractal noise,
// flowing slowly and freely (no beat, trigger or audio sync). Palette or
// mono.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 0.6
    float scale;     // 0.3..6 = 1.6
    float warp;      // 0..6 = 3
    float veins;     // 0..1 = 0.4       bright vein lines
    bool  mono;      // = false
    bool  invert;    // = false
};

void main() {
    vec2 p = to_centered(v_uv) * scale;
    float t = u_time * speed * 0.15;
    float w = warp;

    vec2 q = vec2(fbm(p + vec2(0.0, t), 5), fbm(p + vec2(5.2, 1.3 - t), 5));
    vec2 r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * 0.6, 5),
                  fbm(p + w * q + vec2(8.3, 2.8) - t * 0.4, 5));
    float f = fbm(p + w * r, 5);

    float sharp = veins;
    float vein = pow(1.0 - abs(fract(f * 6.0) - 0.5) * 2.0, mix(2.0, 40.0, clamp(sharp, 0.0, 1.0)));

    vec3 col = palette(fract(f * 1.2 + length(q) * 0.5 + u_time * 0.005));
    col *= smoothstep(0.1, 0.9, f * f * 2.0 + 0.2 * length(r));
    col += vein * sharp * palette(fract(f + 0.5));
    if (mono) col = vec3(monochrome(col));
    if (invert) col = 1.0 - col;
    f_color = vec4(col, 1.0);
}
