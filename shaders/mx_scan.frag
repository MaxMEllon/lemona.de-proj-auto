#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: flying through a box of horizontal scan lines (floor, ceiling
// and walls). The camera surges on each beat; snare (pad 2 / mid hit) flashes
// the far end, hats (high hit) jitter the lines, accent (pad 4) flips to
// white walls. Chain into Feedback for streaks.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1.2       forward speed (in beats)
    float density;   // 1..40 = 10       lines per unit depth
    float width;     // 0.02..0.5 = 0.18 line thickness
    float fog;       // 0..1 = 0.35
    float roll;      // -45..45 = 0      camera roll
};

void main() {
    vec2 p = to_centered(v_uv);
    p = rotate_deg(p, roll + sin(u_beats * 0.392) * 6.0);
    p += (vec2(hash21(vec2(u_time, 1.0)), hash21(vec2(u_time, 2.0))) - 0.5) * 0.02 * u_hits.w;

    // Distance to the box walls (square tunnel), z = depth.
    float d = max(abs(p.x) / aspect(), abs(p.y));
    float z = 0.35 / max(d, 1e-3);

    float surge = floor(u_beats) + smoothstep(0.0, 0.35, fract(u_beats));
    float zz = z + surge * speed;
    float line = smoothstep(width, 0.0, abs(fract(zz * density * 0.4) - 0.5) * 2.0 - (1.0 - width));
    line = step(1.0 - width, fract(zz * density * 0.4));

    float shade = exp(-z * fog * 0.6);
    float v = line * shade;

    // Bright end of the tunnel.
    float core = smoothstep(0.08, 0.0, d) * (0.3 + max(u_triggers.y, u_hits.z));
    v += core;

    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
