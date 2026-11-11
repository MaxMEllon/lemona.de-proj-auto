#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Particle source: thin white Voronoi cell edges (a cracked-glass web),
// slowly drifting. Feed into a Particle COMP; this is the shape the
// particles return to after being blown away.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float scale;     // 1..20 = 5        cells across the height
    float width;     // 0.005..0.1 = 0.025 edge width
    float drift;     // 0..1 = 0.15
};

void main() {
    vec2 p = to_centered(v_uv) * scale * 0.5;
    vec2 id = floor(p), f = fract(p);
    float t = u_time * drift;
    float d1 = 9.0, d2 = 9.0;
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(x, y);
        vec2 c = o + 0.5 + 0.4 * sin(t + 6.2831 * hash22(mod(id + o, 97.0)));
        float d = length(c - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    float v = smoothstep(width, width * 0.4, d2 - d1);
    v *= smoothstep(1.15, 0.6, length(to_centered(v_uv) * vec2(0.6, 1.0)));
    f_color = vec4(vec3(v), 1.0);
}
