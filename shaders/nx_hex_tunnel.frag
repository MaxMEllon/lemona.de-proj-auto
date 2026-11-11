#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Neon: a hexagonal tunnel of glowing rings in palette colours. The camera
// warps forward on every beat; snare (pad 2 / mid hit) lights every other
// ring, hats (high hit) sparkle the walls, accent (pad 4) twists the tunnel.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1         rings travelled per beat
    float sides;     // 3..12 = 6        polygon sides
    float width;     // 0.01..0.5 = 0.08 ring thickness
    float twist;     // -2..2 = 0.3      rotation along depth
    float glow;      // 0..2 = 0.8
};

float poly(vec2 p, float n) {
    float a = atan(p.y, p.x);
    float s = 6.2831853 / n;
    return length(p) * cos(mod(a + s * 0.5, s) - s * 0.5);
}

void main() {
    vec2 p = to_centered(v_uv);
    float warp = floor(u_beats) + smoothstep(0.0, 0.4, fract(u_beats));
    float tw = twist + u_triggers.w * 2.0;

    float d = poly(p, sides);
    float z = 0.3 / max(d, 1e-3);
    vec2 q = rotate_deg(p, z * tw * 20.0 + u_beats * 4.0);
    d = poly(q, sides);
    z = 0.3 / max(d, 1e-3);

    float zz = z + warp * speed;
    float ring = fract(zz);
    float id = floor(zz);
    float line = smoothstep(width, width * 0.3, abs(ring - 0.5));
    float alt = mix(1.0, mod(id, 2.0), max(u_triggers.y, u_hits.z));
    float fog = exp(-z * 0.12);

    vec3 c = palette(fract(id * 0.13 + u_beats * 0.03));
    vec3 col = c * line * alt * fog * 1.4;
    col += c * glow * 0.12 * exp(-abs(ring - 0.5) * 14.0) * fog;

    // Hat sparkle on the walls.
    float a = atan(q.y, q.x);
    float sp = step(0.985, hash21(vec2(floor(a * 30.0), floor(mod(zz * 8.0, 512.0)))));
    col += sp * max(u_hits.w, u_triggers.z) * fog * 2.0;

    col += vec3(1.0) * smoothstep(0.04, 0.0, d) * 0.5;
    f_color = vec4(col, 1.0);
}
