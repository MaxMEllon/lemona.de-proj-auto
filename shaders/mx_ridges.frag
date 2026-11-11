#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: Joy Division-style ridgelines. Dozens of stacked white lines,
// each raised by noise and the FFT in the middle, front lines hiding the ones
// behind. The stack lurches one row towards you on every beat; kick (pad 1 /
// low hit) kicks the centre peaks up, accent (pad 4) inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   rows;      // 10..80 = 40
    float height;    // 0..1.5 = 0.9     peak height
    float span;      // 0.1..1.5 = 0.55  width of the raised middle
    float audio;     // 0..3 = 1.2       FFT influence
    float width;     // 0.5..6 = 1.6     line width (px)
    bool  invert;    // = false
};

float ridge(float x, float id) {
    float env = exp(-pow(x / span, 2.0) * 2.0);
    float hid = mod(id, 97.0);
    float n = noise2(vec2(x * 4.0, hid * 1.37)) * 0.75 + noise2(vec2(x * 11.0, hid * 3.1)) * 0.2;
    int bin = int(clamp(abs(x) / span * 30.0 + hash21(vec2(hid, 1.0)) * 8.0, 0.0, 63.0));
    float a = fft(bin) * audio;
    float kick = max(u_triggers.x, u_hits.y);
    return env * (n * (0.5 + a) + kick * 0.6 * hash21(vec2(hid, 2.0)) * exp(-pow(x / (span * 0.4), 2.0)));
}

void main() {
    vec2 p = to_centered(v_uv);
    float lurch = floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats));
    float px = width * u_scale * 2.0 / u_resolution.y;
    float n = float(rows);
    float top = 0.75, bottom = -0.85;
    float gap = (top - bottom) / n;

    float v = 0.0;
    // Back (top) to front (bottom): each row hides what is under its curve.
    for (int i = 0; i < 80; i++) {
        if (i >= rows) break;
        float fi = float(i) + fract(lurch);
        float base = top - fi * gap;
        float id = float(i) - floor(lurch);
        float depth = fi / n;                       // 0 far .. 1 near
        float y = base + ridge(p.x * (1.4 - depth * 0.4), id) * height * (0.4 + depth * 0.6);
        float fade = smoothstep(0.0, 0.08, depth) * smoothstep(1.02, 0.94, depth);
        if (p.y < y) v = 0.0;
        v = max(v, smoothstep(px, 0.0, abs(p.y - y)) * fade);
    }
    v = mix(v, 1.0 - v, invert ? 1.0 : 0.0);
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(v), 1.0);
}
