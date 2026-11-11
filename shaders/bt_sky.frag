#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

// Botanica: dusk sky with tree silhouettes along the bottom, foliage in the
// top corners and a drifting flock of birds. Free-running (u_time only).
// bt_hud tracks the same birds: the bird loop below must match its bird_pos().

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   birds;     // 0..160 = 90
    float bird_size; // 2..30 = 9        wing span, px
    float trees;     // 0..2 = 1         tree line height
    float branches;  // 0..1 = 0.8       foliage in the top corners
    float clouds;    // 0..1 = 0.3
    vec4  sky_top;   // color = 0.56,0.62,0.86
    vec4  sky_low;   // color = 0.98,0.74,0.66
};

float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main() {
    float t = u_time;
    vec2 uv = v_uv;
    vec2 px = uv * u_resolution;

    // sky
    vec3 mid = vec3(0.80, 0.80, 0.92);
    vec3 col = mix(sky_top.rgb, mid, smoothstep(0.0, 0.55, uv.y));
    col = mix(col, sky_low.rgb, smoothstep(0.45, 0.98, uv.y));
    float cl = fbm(uv * vec2(3.0, 9.0) + vec2(t * 0.01, 0.0), 5);
    col = mix(col, col * 1.08 + 0.03, clouds * smoothstep(0.45, 0.8, cl));

    // birds: bird_pos() inlined, with the flock-wide terms hoisted out of the loop
    float bird = 0.0;
    vec2 fc = vec2(0.5 + 0.25 * sin(t * 0.05), 0.38 + 0.1 * sin(t * 0.083 + 1.0));
    float reach = bird_size * u_scale * 1.4 * 1.5;   // largest bird's box
    for (int k = 0; k < 160; k++) {
        if (k >= birds) break;
        float i = float(k);
        float h1 = hash21(vec2(i, 1.7)), h2 = hash21(vec2(i, 9.3)), h3 = hash21(vec2(i, 4.1));
        vec2 off = (vec2(h1, h2) - 0.5) * vec2(1.3, 0.75);
        off *= 0.8 + 0.3 * sin(t * 0.13 + h3 * 6.2832);
        off += 0.03 * vec2(sin(t * 0.7 + i * 1.3), cos(t * 0.9 + i * 0.7));
        vec2 bp = fc + off;
        bp.x = fract(bp.x + t * 0.012 * (0.7 + h3 * 0.6));
        vec2 d = px - bp * u_resolution;
        if (abs(d.x) > reach || abs(d.y) > reach) continue;
        float sz = bird_size * u_scale * (0.5 + hash21(vec2(i, 2.9)) * 0.9);
        float flap = sin(t * (7.0 + hash21(vec2(i, 5.5)) * 4.0) + i * 2.1);
        vec2 w = vec2(sz * 0.5, -sz * 0.35 * flap);
        float dd = min(seg(d, vec2(0.0), vec2(-w.x, w.y)), seg(d, vec2(0.0), w));
        bird = max(bird, 1.0 - smoothstep(0.5 * u_scale, 1.6 * u_scale, dd - sz * 0.04));
    }
    col = mix(col, vec3(0.08, 0.08, 0.11), bird * 0.9);

    // tree line along the bottom
    float yb = 1.0 - trees * (0.07 + 0.10 * fbm(vec2(uv.x * 4.0, 1.0), 3)
                              + 0.04 * fbm(vec2(uv.x * 25.0, 2.0), 3));
    float leaf = fbm(uv * vec2(70.0, 45.0) + vec2(sin(t * 0.4) * 0.3, 0.0), 3) - 0.5;
    float tree = smoothstep(-0.004, 0.004, uv.y - yb - leaf * 0.03 * trees);
    // distant row, lighter
    float yb2 = yb - 0.025 * trees - 0.03 * fbm(vec2(uv.x * 9.0, 7.0), 3);
    float tree2 = smoothstep(-0.004, 0.004, uv.y - yb2 - leaf * 0.02 * trees) * step(0.001, trees);
    vec3 dark = vec3(0.06, 0.06, 0.09);
    col = mix(col, mix(col, dark, 0.55), tree2);
    col = mix(col, dark, tree);

    // foliage reaching in from the top corners, swaying
    vec2 sw = vec2(sin(t * 0.35) * 0.01, cos(t * 0.27) * 0.006);
    float cornerL = smoothstep(0.6, 0.0, length((uv + sw) * vec2(1.6, 2.4)));
    float cornerR = smoothstep(0.5, 0.0, length((vec2(1.0 - uv.x, uv.y) - sw) * vec2(1.8, 2.6)));
    float corner = max(cornerL, cornerR * 0.8) * branches;
    float f = fbm((uv + sw) * vec2(26.0, 18.0), 4)
            + 0.3 * (fbm((uv + sw) * vec2(150.0, 110.0), 3) - 0.5);
    float fol = smoothstep(0.02, -0.02, (1.0 - corner * 0.75) - f - 0.2);
    col = mix(col, dark, fol * step(0.01, corner));

    f_color = vec4(col, 1.0);
}
