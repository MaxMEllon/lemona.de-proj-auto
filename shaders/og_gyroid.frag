#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Organic: drifting through a raymarched gyroid cave — smooth, endless
// tunnels of a minimal surface, lit with iridescent rim light and deep fog.
// Free-running (no beat, trigger or audio sync). Lower `quality` if the
// frame rate drops.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1         forward drift
    float density;   // 0.5..4 = 2.8     cave scale
    float thick;     // 0.02..0.6 = 0.06 wall thickness
    float iris;      // 0..2 = 1         iridescent rim
    float fog;       // 0..1 = 0.6
    int   quality;   // 32..128 = 80     march steps
    bool  mono;      // = false
};

float gyroid(vec3 p) {
    return dot(sin(p), cos(p.yzx));
}

float de(vec3 p) {
    float s = density;
    vec3 q = p * s;
    float g = abs(gyroid(q) + 0.15 * gyroid(q * 3.1 + 1.7)) / s - thick / s;
    return g * 0.6;
}

vec3 normal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(de(p + e.xyy) - de(p - e.xyy),
                          de(p + e.yxy) - de(p - e.yxy),
                          de(p + e.yyx) - de(p - e.yyx)));
}

void main() {
    vec2 p = to_centered(v_uv);
    float t = u_time * 0.25 * speed;

    // Camera follows a gently winding path through the cave.
    vec3 ro = vec3(sin(t * 0.31) * 0.6, cos(t * 0.23) * 0.6, t);
    vec3 ta = ro + vec3(sin(t * 0.31 + 0.6) * 0.4, cos(t * 0.23 + 0.6) * 0.4, 1.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(sin(t * 0.1) * 0.3, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(p.x * rt + p.y * up + 1.3 * fw);

    float d = 0.0, h = 1.0, steps = 0.0;
    for (int i = 0; i < 128; i++) {
        if (i >= quality) break;
        h = de(ro + rd * d);
        if (h < 0.0008 * d || d > 14.0) break;
        d += h;
        steps += 1.0;
    }

    vec3 col = vec3(0.0);
    vec3 fogc = palette(0.75) * 0.08;
    if (d < 14.0) {
        vec3 pos = ro + rd * d;
        vec3 n = normal(pos);
        float ao = 1.0 - steps / float(quality);
        float diff = clamp(dot(n, normalize(vec3(0.3, 0.8, -0.4))), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
        float bands = gyroid(pos * density * 2.0) * 0.5 + 0.5;
        vec3 base = palette(fract(bands * 0.35 + u_time * 0.01));
        vec3 sheen = palette(fract(dot(n, rd) * 0.8 + pos.z * 0.05 + 0.5));
        col = base * (0.15 + 0.6 * diff) * ao + sheen * rim * iris;
        // Cavity glow deep in the folds.
        col += palette(0.6) * pow(1.0 - ao, 3.0) * 0.4;
    }
    col = mix(fogc, col, exp(-d * fog * 0.35));
    col *= 1.0 - 0.35 * dot(p * 0.6, p * 0.6);   // vignette
    if (mono) col = vec3(monochrome(col));
    f_color = vec4(col, 1.0);
}
