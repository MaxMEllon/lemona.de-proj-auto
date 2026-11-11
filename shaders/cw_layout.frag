#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// in0: the full picture (sky + glass), in1: the sky alone (finds the glass so it can spill over the paper)

layout(set = 0, binding = 1) uniform NodeParams {
    float framing;   // 0..1 = 1          0 = full frame .. 1 = paper with panels
    int   every;     // 1..32 = 8         beats per layout change
    float shift;     // 0..1 = 0.5        how far side panels crop apart
    float spill;     // 0..1 = 1          glass spilling over the paper
    float lines;     // 0..1 = 0.8        thin rules
    float grain;     // 0..0.3 = 0.07     film grain
    float desat;     // 0..1 = 0.3        desaturation
    vec4  paper;     // color = 0.94,0.95,0.96
    vec4  ink;       // color = 0.07,0.10,0.15
};

bool inside(vec2 uv, vec4 r) {
    return uv.x > r.x && uv.x < r.z && uv.y > r.y && uv.y < r.w;
}

vec3 pic(vec2 uv) { return texture(u_tex0, clamp(uv, 0.0, 1.0)).rgb; }

void main() {
    vec2 uv = v_uv;
    float seed = floor(u_beats / float(every));
    vec3 full = pic(uv);

    vec3 col = paper.rgb;
    bool in_panel = false;

    // side panels: shifted crops of the picture
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 h1 = hash22(vec2(seed * 1.7, fi * 7.1 + 1.0));
        vec2 h2 = hash22(vec2(fi * 3.3 + 2.0, seed + 11.0));
        vec2 size = mix(vec2(0.12, 0.2), vec2(0.5, 0.85), h2);
        vec2 lo = h1 * (1.0 - size);
        vec4 r = vec4(lo, lo + size);
        if (inside(uv, r)) {
            vec2 o = (hash22(vec2(fi * 13.0, seed + 3.0)) - 0.5) * shift * 0.5;
            float kind = hash21(vec2(seed + fi, 5.0));
            col = kind < 0.2 ? mix(ink.rgb, ink.rgb * 2.5, uv.y - r.y) : pic(uv + o);
            in_panel = true;
        }
    }

    // main panel
    vec2 mh = hash22(vec2(seed, 99.0)) - 0.5;
    vec4 mainr = vec4(0.22 + mh.x * 0.1, 0.1 + mh.y * 0.06, 0.78 + mh.x * 0.1, 0.92 + mh.y * 0.04);
    if (inside(uv, mainr)) { col = full; in_panel = true; }

    // the glass (where the picture differs from the plain sky) spills over everything
    float g = smoothstep(0.03, 0.14, length(full - texture(u_tex1, uv).rgb));
    col = mix(col, full, g * spill);

    // thin rules
    float px = 1.4 * u_scale / u_resolution.x;
    for (int j = 0; j < 6; j++) {
        float fj = float(j);
        vec2 h = hash22(vec2(seed + 3.0, fj * 5.7));
        float x = j < 2 ? (j == 0 ? mainr.x - 0.012 : mainr.z + 0.012) : h.x;
        float y0 = hash21(vec2(fj, seed + 7.0)) * 0.4;
        float y1 = y0 + 0.4 + h.y * 0.5;
        float on = step(abs(uv.x - x), px) * step(y0, uv.y) * step(uv.y, y1);
        vec3 lc = in_panel ? vec3(1.0) : ink.rgb;
        col = mix(col, lc, on * lines);
    }

    col = mix(full, col, framing);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(l) * vec3(0.95, 0.98, 1.04), desat);
    col += (hash21(uv * u_resolution + fract(u_time * 7.0) * 311.0) - 0.5) * grain;
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
