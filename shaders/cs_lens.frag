#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// The lens: color fringes that grow on the kick, a vignette, a soft highlight
// shoulder, and dither so the dark gas gradients don't band.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float fringe;  // 0..0.05 = 0.006  color fringes at rest
    float kicked;  // 0..0.05 = 0.018  more fringes on a kick (pad 1)
    float vignette; // 0..1 = 0.55
    float exposure; // 0..3 = 1.1
};

void main() {
    vec2 w = world_uv(v_uv);
    vec2 dir = w - 0.5;
    float r2 = dot(dir, dir);
    float k = u_triggers.x * u_triggers.x;

    float ca = (fringe + kicked * k) * (0.3 + 2.0 * r2);
    vec3 col = vec3(sample_world(u_tex0, w + dir * ca).r,
                    sample_world(u_tex0, w).g,
                    sample_world(u_tex0, w - dir * ca).b);

    col *= exposure;
    col *= 1.0 - vignette * smoothstep(0.08, 0.6, r2);

    // Soft shoulder so the highlights roll off instead of clipping.
    col = 1.0 - exp(-col * 1.25);

    col += (hash21(v_uv * u_resolution + fract(u_time) * 91.0) - 0.5) / 128.0;
    f_color = vec4(col, 1.0);
}
