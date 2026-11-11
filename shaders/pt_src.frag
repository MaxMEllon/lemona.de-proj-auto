#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float logo;      // 0..3 = 1.8      logo brightness (in0)
    float ring;      // 0..1 = 0.8      beat ring brightness
    float radius;    // 0.2..1.5 = 0.75 ring radius (frame units)
    float width;     // 0.002..0.05 = 0.012 ring line width
    float hue_speed; // 0..1 = 0.15     palette drift
};

void main() {
    vec2 p = to_centered(v_uv);
    float t = u_time * hue_speed;

    // Logo, coloured by a palette sweep across the frame.
    float l = texture(u_tex0, v_uv).r;
    vec3 col = l * logo * palette(fract(v_uv.x * 0.6 + t));

    // Two rings: one breathing on the beat, one expanding outwards each beat.
    float r = length(p);
    float a = atan(p.y, p.x);
    float dash = step(0.35, fract(a * 12.0 / 6.2831853 + u_beats * 0.25));
    float r1 = radius * (1.0 + 0.06 * u_beat);
    float r2 = radius * (1.0 + 0.6 * u_phase);
    float w = width;
    float ring1 = smoothstep(w, 0.0, abs(r - r1)) * dash;
    float ring2 = smoothstep(w * 0.6, 0.0, abs(r - r2)) * (1.0 - u_phase);
    col += ring * (ring1 + ring2) * palette(fract(a / 6.2831853 + t + 0.5));

    f_color = vec4(col, 1.0);
}
