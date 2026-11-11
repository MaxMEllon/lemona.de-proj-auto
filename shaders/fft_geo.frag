#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// The spectrum, turned back into shapes: nested closed curves around the
// centre, each one a circle bent by a few harmonics of `symmetry`. The
// harmonics' strengths are FFT bins, picked out of order (bin numbers
// scrambled per curve), so no bar or frequency axis is left: the sound only
// shows as the curves swelling into stars, petals and knots. Alternate bands
// between the curves are filled.

layout(set = 0, binding = 1) uniform NodeParams {
    vec4  ink;       // color = 1,1,1
    int   symmetry;  // 2..16 = 6          n-fold symmetry
    int   layers;    // 1..12 = 8          nested curves
    float inner;     // 0..1 = 0.1         radius of the first curve
    float spread;    // 0.03..0.3 = 0.11   gap between curves
    float amount;    // 0..4 = 1.6         how far the sound bends the curves
    float roundness; // 0..1 = 0.2         0 = polygons, 1 = circles
    float sharp;     // 0..1 = 0.7         harmonics as zigzags instead of waves
    float width;     // 0.5..12 = 2.5      line width (px)
    float glow;      // 0..2 = 0.4
    float fill;      // 0..1 = 0.35        alternate bands filled
    float checker;   // 0..1 = 1           bands also alternate around the circle
    float spokes;    // 0..1 = 0.6         radial lines
    float spin;      // -2..2 = 0.15       curves turning, alternately
    float twist;     // -1..1 = 0.5        each curve turned from the last (in segments)
    float punch;     // 0..1 = 0.4         kick zoom
    float drift;     // 0..1 = 0.35        curves keep moving in silence
    float hue;       // 0..1 = 0           ink → show palette per curve
    bool  invert;    // = false
};

const int HARMONICS = 4;
const float TAU = 6.2831853;

// bin pair for harmonic j of curve l: scrambled so neighbouring curves and
// harmonics never read neighbouring frequencies
float energy(int l, int j) {
    int b = (l * 11 + j * 23 + 5) % 56 + 2;
    return 0.5 * (fft(b) + fft(b + 1));
}

float wave(float x) {
    return mix(cos(x), 4.0 * abs(fract(x / TAU) - 0.5) - 1.0, sharp);
}

// radius of curve l at angle a, relative to its base radius
float curve(int l, float a, float n, float coef[HARMONICS]) {
    float seg = TAU / n;
    float q = mod(a, seg) - seg * 0.5;
    float r = mix(cos(seg * 0.5) / cos(q), 1.0, roundness);
    for (int j = 1; j <= HARMONICS; j++)
        r += coef[j - 1] * wave(float(j) * n * a + float(j * l) * 0.7);
    return r;
}

void main() {
    float px = 2.0 / u_resolution.y;
    vec2 p = to_centered(v_uv) / (1.0 + punch * u_hits.y * 0.15);
    float rho = length(p);
    float th = atan(p.y, p.x);
    float t = u_time;
    float n = float(symmetry);
    float seg = TAU / n;
    float w = width * px * 0.5;

    vec3 col = vec3(0.0);
    float glw = 0.0;
    float inside = 0.0;
    float rmax = 0.0;
    for (int l = 0; l < layers; l++) {
        float fl = float(l);
        float dir = (l % 2 == 0) ? 1.0 : -1.0;
        float a0 = th - (t * spin * 0.3 * dir + fl * twist * seg);
        float R = inner + spread * (fl + 1.0);

        float coef[HARMONICS];
        float total = 0.0;
        for (int j = 1; j <= HARMONICS; j++) {
            float fj = float(j);
            coef[j - 1] = amount * 0.14 * energy(l, j) / fj
                        + drift * 0.035 * sin(t * (0.21 + 0.13 * fj) + fl * 1.7 + fj);
            total += abs(coef[j - 1]);
        }
        float k = total > 0.6 ? 0.6 / total : 1.0;   // never pass through the centre
        for (int j = 0; j < HARMONICS; j++) coef[j] *= k;

        const float E = 0.002;
        float r = R * curve(l, a0, n, coef);
        float dr = R * (curve(l, a0 + E, n, coef) - curve(l, a0 - E, n, coef)) / (2.0 * E);
        rmax = max(rmax, r);

        // distance to the curve, corrected for its slope
        float d = abs(rho - r) / sqrt(1.0 + dr * dr / max(rho * rho, 1e-4));
        vec3 ink_l = mix(ink.rgb, palette(fl / max(float(layers), 1.0)), hue);
        float line = clamp((w - d) / px + 0.5, 0.0, 1.0);
        col = mix(col, ink_l, line);
        glw += exp(-d / (px * 14.0)) * 0.25 * (0.5 + energy(l, 1));
        inside += step(rho, r);
    }

    // spokes: one per segment, inside the curves
    float as = th - t * spin * 0.3;
    float sd = abs(mod(as + seg * 0.5, seg) - seg * 0.5) * rho;
    float spoke = clamp((w * 0.6 - sd) / px + 0.5, 0.0, 1.0) * step(0.5, inside) * step(inner, rho);
    col = max(col, ink.rgb * spoke * spokes);

    // alternate bands between curves, and around the circle with `checker`
    float sector = floor(as / (seg * 0.5));
    float par = mod(inside + sector * step(0.5, checker), 2.0);
    float band = par * step(0.5, inside);
    vec3 fc = mix(ink.rgb, palette(fract(inside / max(float(layers), 1.0))), hue);
    col = max(col, fc * band * fill * mix(1.0, 0.6 + 0.4 * mod(sector, 2.0), checker));
    col += mix(ink.rgb, palette(0.5), hue) * glw * glow;
    col = clamp(col, 0.0, 1.0);
    if (invert) col = 1.0 - col;
    f_color = vec4(col, 1.0);
}
