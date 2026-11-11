#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Risograph press. in0 is three ink coverages (rs_sep): each is screened into
// dots at its own angle, laid down slightly out of register and overprinted.
// Kick (pad 1) knocks the drums out of register, snare (pad 2) blows the dots up.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   inks;     // palette|riso = riso       where the inks come from
    float pal_step; // 0..1 = 0.25    palette jump per bar (palette inks)
    int   stock;    // paper|night = paper       light paper, multiply / black, light inks
    float dots;     // 3..40 = 11     screen size in px
    float pop;      // 0..4 = 1.6     snare growing the dots
    float misreg;   // 0..30 = 5      px out of register at rest
    float jolt;     // 0..80 = 28     px out of register on a kick
    float speck;    // 0..1 = 0.12    unprinted specks in the ink
    vec4  paper;    // color = 0.95,0.93,0.87
    vec4  ink1;     // color = 0.05,0.18,0.62
    vec4  ink2;     // color = 1.0,0.17,0.45
    vec4  ink3;     // color = 1.0,0.82,0.05
};

// One plate: dots from the coverage. 1 where ink lands.
float plate(float cov, vec2 pix, float angle, float cell) {
    vec2 q = rotate_deg(pix, angle) / cell;
    float spot = 0.5 + 0.25 * (cos(q.x * 6.28318) + cos(q.y * 6.28318));
    float aa = 1.6 / cell;
    return smoothstep(-aa, aa, cov - spot) * step(0.012, cov);
}

void main() {
    vec2 w = world_uv(v_uv);
    vec2 px = u_scale / u_world_resolution;

    // Each drum wanders on its own; a kick throws them apart.
    float k = u_triggers.x * u_triggers.x;
    float tick = floor(u_beats);
    vec2 d1 = (hash22(vec2(tick, 1.0)) - 0.5) * 2.0 * (misreg * 0.4 + jolt * k) * px;
    vec2 d2 = (hash22(vec2(tick, 2.0)) - 0.5) * 2.0 * (misreg + jolt * k) * px;
    vec2 d3 = (hash22(vec2(tick, 3.0)) - 0.5) * 2.0 * (misreg + jolt * k) * px;

    float c1 = sample_world(u_tex0, w + d1).r;
    float c2 = sample_world(u_tex0, w + d2).g;
    float c3 = sample_world(u_tex0, w + d3).b;

    float cell = dots * (1.0 + pop * u_triggers.y * u_triggers.y) * u_scale;
    vec2 pix = w * u_world_resolution;
    float a1 = plate(c1, pix, 15.0, cell);
    float a2 = plate(c2, pix, 75.0, cell);
    float a3 = plate(c3, pix, 45.0, cell);

    // Ink starves in places, as on a real drum.
    vec2 gp = floor(pix / max(u_scale * 1.6, 1.0));
    float g = hash21(gp + 3.0);
    float blotch = fbm(w * vec2(aspect(), 1.0) * 6.0 + tick * 0.13, 3);
    float keep = 1.0 - step(g, speck * (0.04 + 0.42 * smoothstep(0.35, 0.8, blotch)));
    a1 *= keep;
    a2 *= 1.0 - step(hash21(gp + 11.0), speck * (0.04 + 0.42 * smoothstep(0.3, 0.75, 1.0 - blotch)));
    a3 *= 1.0 - step(hash21(gp + 23.0), speck * 0.1);

    vec3 i1 = ink1.rgb, i2 = ink2.rgb, i3 = ink3.rgb;
    if (inks == 0) {
        float s = floor(u_beats / 4.0) * pal_step;
        i1 = palette(fract(0.10 + s));
        i2 = palette(fract(0.50 + s));
        i3 = palette(fract(0.90 + s));
    }

    vec3 col;
    if (stock == 0) {
        // Overprint: each ink filters what's under it.
        col = paper.rgb * (0.975 + 0.05 * hash21(gp * 0.5 + 41.0));
        col *= mix(vec3(1.0), i3, a3);
        col *= mix(vec3(1.0), i2, a2);
        col *= mix(vec3(1.0), i1, a1);
    } else {
        // Night stock: inks glow over black.
        col = vec3(0.012);
        col = 1.0 - (1.0 - col) * (1.0 - i3 * a3);
        col = 1.0 - (1.0 - col) * (1.0 - i2 * a2);
        col = 1.0 - (1.0 - col) * (1.0 - i1 * a1);
    }

    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
