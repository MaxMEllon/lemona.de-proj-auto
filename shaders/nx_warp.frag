#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Neon: hyperspace warp. Streaks of light rush out from the centre in
// palette colours; the jump surges on every beat, kick (pad 1 / low hit)
// stretches the streaks, snare (pad 2 / mid hit) flashes a shock ring,
// accent (pad 4) whites out the core. Chain into Bloom.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1
    float streaks;   // 40..600 = 240    angular density
    float length_;   // 0.05..1 = 0.3    streak length
    float layers;    // 1..6 = 4
    float swirl;     // -1..1 = 0.15     spiral twist
};

void main() {
    vec2 p = to_centered(v_uv);
    float r = length(p);
    float a = atan(p.y, p.x) / 6.2831853 + 0.5;
    float surge = floor(u_beats) + smoothstep(0.0, 0.5, fract(u_beats));
    float kick = max(u_triggers.x, u_hits.y);

    vec3 col = vec3(0.0);
    for (int l = 0; l < 6; l++) {
        if (float(l) >= layers) break;
        float fl = float(l);
        float n = floor(streaks * (0.6 + fl * 0.3));
        float aa = a + swirl * log(r + 0.05) * 0.1 + fl * 0.137;
        float id = floor(aa * n);
        float fa = fract(aa * n);
        float h = hash21(vec2(mod(id, 251.0), fl));
        // Each streak travels outward in log-radius.
        float z = log(r + 1e-3) - (u_time * 0.3 + surge * 0.4) * speed * (0.5 + h) - h * 7.0;
        float seg = fract(z * 0.5);
        float len = length_ * (1.0 + kick * 2.0);
        float s = smoothstep(len, 0.0, seg) * smoothstep(0.0, 0.02, seg);
        float w = smoothstep(0.5, 0.0, abs(fa - 0.5)) ;
        w = pow(w, 6.0);
        float bright = s * w * step(0.55, h) * smoothstep(0.02, 0.25, r);
        col += palette(fract(h + fl * 0.2 + u_beats * 0.02)) * bright * (0.7 + r);
    }
    // Shock ring and core.
    float sn = max(u_triggers.y, u_hits.z);
    col += vec3(1.0) * smoothstep(0.015, 0.0, abs(r - (1.0 - sn) * 1.6)) * sn;
    col += palette(0.5) * exp(-r * 9.0) * (0.6 + u_beat) + vec3(1.0) * exp(-r * 4.0) * u_triggers.w;
    f_color = vec4(col, 1.0);
}
