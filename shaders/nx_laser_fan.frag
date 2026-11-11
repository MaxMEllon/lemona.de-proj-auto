#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Neon: a fan of laser beams from a point below the frame, sweeping on the
// beat clock. Hats (pad 3 / high hit) change the beam count, snare (pad 2 /
// mid hit) mirrors in a second fan from the top, kick (pad 1 / low hit)
// fattens the beams. Palette colours; chain into Bloom.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   beams;     // 3..32 = 12
    float spread;    // 10..180 = 90     fan angle (degrees)
    float sweep;     // 0..1 = 0.5       sweep amount
    float width;     // 0.5..12 = 2.5    beam width (px)
    float haze;      // 0..1 = 0.25      glow around beams
    bool  mirror;    // = false          always show the top fan
};

vec3 fan(vec2 p, vec2 o, float dir, float n, float seed) {
    vec2 d = p - o;
    float a = degrees(atan(d.x, d.y * dir));
    float sw = sin(u_beats * 3.14159 * 0.5 + seed) * sweep * spread * 0.4;
    float span = spread / max(n - 1.0, 1.0);
    float rel = (a - sw + spread * 0.5) / span;
    float idx = floor(rel + 0.5);
    float inside = step(0.0, idx) * step(idx, n - 1.0);
    float off = (rel - idx) * span; // degrees from beam centre
    float r = length(d);
    float pxdeg = degrees(atan(width * u_scale * 2.0 / u_resolution.y, max(r, 1e-3)));
    pxdeg *= 1.0 + max(u_triggers.x, u_hits.y) * 1.5;
    float core = exp(-pow(off / pxdeg, 2.0));
    float glow = exp(-abs(off) / (pxdeg * 6.0)) * haze;
    vec3 c = palette(fract(idx / n + u_beats * 0.0625 + seed));
    return c * (core * 1.5 + glow) * inside;
}

void main() {
    vec2 p = to_centered(v_uv);
    float hats = max(u_triggers.z, u_hits.w);
    float n = float(beams) * (1.0 + floor(mod(u_beats * 2.0, 3.0)) * 0.0) + floor(hats * 2.0) * 4.0;
    vec3 col = fan(p, vec2(0.0, -1.15), 1.0, n, 0.0);
    float top = max(mirror ? 1.0 : 0.0, max(u_triggers.y, u_hits.z));
    col += top * fan(p, vec2(0.0, 1.15), -1.0, n, 0.5);
    col *= 0.7 + 0.3 * u_beat;
    f_color = vec4(col, 1.0);
}
