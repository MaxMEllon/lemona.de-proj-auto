#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Particle source: concentric dashed rings in palette colours, each turning
// its own way. Feed into a Particle COMP; the rings are what the particles
// return to between bursts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   rings;     // 1..10 = 5
    float spacing;   // 0.05..0.3 = 0.14
    float width;     // 0.002..0.05 = 0.012
    float dashes;    // 2..48 = 16
    float spin;      // 0..2 = 0.4
};

void main() {
    vec2 p = to_centered(v_uv);
    float r = length(p);
    float a = atan(p.y, p.x) / 6.2831853;
    vec3 col = vec3(0.0);
    for (int i = 0; i < 10; i++) {
        if (i >= rings) break;
        float fi = float(i);
        float rr = 0.15 + fi * spacing;
        float dir = mod(fi, 2.0) * 2.0 - 1.0;
        float dash = step(0.4, fract(a * (dashes + fi * 4.0) + dir * u_beats * spin * 0.25));
        float ring = smoothstep(width, 0.0, abs(r - rr)) * dash;
        col += ring * palette(fract(fi / float(rings) + u_beats * 0.02)) * 1.5;
    }
    col += smoothstep(0.05, 0.0, r);
    f_color = vec4(col, 1.0);
}
