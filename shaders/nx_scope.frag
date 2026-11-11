#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Neon: XY oscilloscope. Glowing Lissajous figures traced by two sine
// oscillators whose ratio changes every bar; the phase rolls with the beat
// clock, the level opens the figure, kick (pad 1 / low hit) adds a burst of
// harmonics, snare (pad 2 / mid hit) doubles the trace. Chain into Feedback.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float size;      // 0.2..1 = 0.75
    float width;     // 0.5..8 = 2       trace width (px)
    float glow;      // 0..2 = 1
    float roll;      // 0..2 = 0.5       phase roll per beat
    int   refine;    // 0..4 = 2         Newton steps per candidate (accuracy)
};

// Curve state shared by the helpers below.
float g_fa, g_fb, g_ph, g_kick;
vec2  g_scale;   // per-axis size of the figure

vec2 curve(float s) {
    float x = sin(s * g_fa + g_ph) + g_kick * 0.25 * sin(s * g_fa * 5.0);
    float y = sin(s * g_fb) + g_kick * 0.25 * sin(s * g_fb * 7.0 + g_ph);
    return vec2(x, y) * g_scale;
}

vec2 curve_d(float s) {
    float x = g_fa * cos(s * g_fa + g_ph) + g_kick * 1.25 * g_fa * cos(s * g_fa * 5.0);
    float y = g_fb * cos(s * g_fb) + g_kick * 1.75 * g_fb * cos(s * g_fb * 7.0 + g_ph);
    return vec2(x, y) * g_scale;
}

// Distance from p to the curve near parameter s: a few Gauss-Newton steps
// towards the closest point, then the exact distance there.
float refine_dist(vec2 p, float s) {
    for (int i = 0; i < 4; i++) {
        if (i >= refine) break;
        vec2 c = curve(s), dc = curve_d(s);
        s -= dot(c - p, dc) / max(dot(dc, dc), 1e-6);
    }
    return length(curve(s) - p);
}

// Distance from p to the whole Lissajous figure. Instead of testing hundreds
// of segments, solve where the (harmonic-free) curve crosses p's x and p's y
// — at most 2*fa + 2*fb parameters — and refine each of those.
float scope_dist(vec2 p) {
    const float TAU = 6.2831853;
    float d = 1e9;
    float u = asin(clamp(p.x / g_scale.x, -1.0, 1.0));
    for (int k = 0; k < 8; k++) {
        if (float(k) >= g_fa) break;
        float o = TAU * float(k) - g_ph;
        d = min(d, refine_dist(p, (u + o) / g_fa));
        d = min(d, refine_dist(p, (3.14159265 - u + o) / g_fa));
    }
    float v = asin(clamp(p.y / g_scale.y, -1.0, 1.0));
    for (int k = 0; k < 8; k++) {
        if (float(k) >= g_fb) break;
        float o = TAU * float(k);
        d = min(d, refine_dist(p, (v + o) / g_fb));
        d = min(d, refine_dist(p, (3.14159265 - v + o) / g_fb));
    }
    return d;
}

void main() {
    vec2 p = to_centered(v_uv);
    float bar = mod(floor(u_beats / 4.0), 6.0);
    vec2 ratios[6] = vec2[6](vec2(3, 2), vec2(5, 4), vec2(3, 4), vec2(5, 6), vec2(7, 4), vec2(2, 1));
    vec2 r = ratios[int(bar)];
    float dbl = max(u_triggers.y, u_hits.z);
    float px = width * u_scale * 2.0 / u_resolution.y;

    g_fa = r.x; g_fb = r.y;
    g_ph = mod(u_beats * roll * 1.5708, 6.2831853);
    g_kick = max(u_triggers.x, u_hits.y);
    vec2 sc = vec2(aspect() * 0.75, 1.0) * size * (0.85 + u_level * 0.3);

    g_scale = sc;
    float d = scope_dist(p);
    float d2 = 1e9;
    if (dbl > 0.02) {
        g_scale = sc * 0.6;
        d2 = scope_dist(p);
    }
    vec3 c1 = palette(fract(bar / 6.0 + 0.1));
    vec3 col = c1 * (smoothstep(px, 0.0, d) * 1.4 + exp(-d / (px * 10.0)) * glow * 0.3);
    col += palette(fract(bar / 6.0 + 0.5)) * dbl * (smoothstep(px, 0.0, d2) + exp(-d2 / (px * 10.0)) * glow * 0.2);
    // Faint graticule.
    vec2 g = abs(fract(p * 5.0) - 0.5);
    col += vec3(0.04) * step(0.48, max(g.x, g.y));
    f_color = vec4(col, 1.0);
}
