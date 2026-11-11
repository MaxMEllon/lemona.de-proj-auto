#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Logo echo tunnel (mono): in0 is a logo, white on black, centred once
// (Image -> Transform with edge = black). The solid logo sits in the middle;
// outline copies of it stream outwards behind it, one new echo per beat,
// growing and fading like a tunnel. Kick (pad 1 / low hit) punches the logo
// and flashes the nearest echo, snare (pad 2 / mid hit) slices the logo
// sideways, hats (high hit) flicker scanlines over the echoes, accent
// (pad 4) inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   echoes;    // 1..16 = 4
    float spread;    // 0.1..2 = 0.9     scale step between echoes
    float outline;   // 0.5..8 = 1.2     echo outline width (px)
    float fade;      // 0..3 = 1.4       how fast echoes fade with distance
    float slice;     // 0..0.3 = 0.08    snare slice offset
    bool  invert;    // = false
};

float logo(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return step(0.5, monochrome(texture(u_tex0, uv).rgb).r);
}

// Sample the logo scaled by s around the frame centre.
vec2 scaled(vec2 uv, float s) { return (uv - 0.5) / s + 0.5; }

float edge_at(vec2 uv, float s, float w) {
    vec2 px = vec2(w / u_resolution.x, w / u_resolution.y) / s;
    vec2 q = scaled(uv, s);
    float c = logo(q);
    float e = abs(c - logo(q + vec2(px.x, 0.0))) + abs(c - logo(q - vec2(px.x, 0.0)))
            + abs(c - logo(q + vec2(0.0, px.y))) + abs(c - logo(q - vec2(0.0, px.y)));
    return clamp(e, 0.0, 1.0);
}

void main() {
    float kick = max(u_triggers.x, u_hits.y);
    float sn = max(u_triggers.y, u_hits.z);
    float hat = max(u_triggers.z, u_hits.w);
    float ph = fract(u_beats);
    float glide = smoothstep(0.0, 0.5, ph);

    // Echo tunnel: echo i is i + glide steps out; a new one is born each beat.
    float v = 0.0;
    float w = outline * u_scale;
    for (int i = 0; i < 16; i++) {
        if (i >= echoes) break;
        float k = float(i) + glide;
        float s = 1.0 + k * spread;
        float a = 0.6 * exp(-k * fade * 0.7) * smoothstep(0.0, 0.6, k);
        if (i == 0) a = max(a, kick);
        float e = edge_at(v_uv, s, w * (1.0 + k * 0.4));
        // Hats: scanlines flicker across the echoes.
        e *= 1.0 - hat * step(0.5, fract(v_uv.y * u_resolution.y / (4.0 * u_scale) + u_time * 30.0));
        v = max(v, e * a);
    }

    // Solid logo in the middle: kick punch, snare slices.
    vec2 uv = v_uv;
    float band = floor(uv.y * 24.0);
    uv.x += (hash21(vec2(band, mod(floor(u_beats * 4.0), 61.0))) - 0.5) * slice * 2.0 * sn
            * step(0.6, hash21(vec2(band, 7.0 + mod(floor(u_beats * 4.0), 61.0))));
    float sc = 1.0 + kick * 0.08;
    float core = logo(scaled(uv, sc));
    v = max(v, core);

    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(v), 1.0);
}
