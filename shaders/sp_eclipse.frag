#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Lunar eclipse in a deep night sky: twinkling stars in three depths, a
// Milky Way band with dust lanes, and a full moon that Earth's shadow crosses —
// penumbra dimming, the umbra's edge with its turquoise fringe, then a copper
// "blood moon" at totality while the sky darkens and the stars come out.
// One eclipse per `period` seconds (or hold it at `scrub` with auto off).
// Free-running: no beat or audio links.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    bool  auto_run;   // = true           move the shadow by itself
    float period;     // 10..240 = 60     seconds per eclipse
    float scrub;      // 0..1 = 0.5       shadow position when auto is off (0.5 = totality)
    float moon_size;  // 0.1..0.6 = 0.28
    float moon_x;     // -1..1 = 0.3
    float moon_y;     // -1..1 = 0.2
    float stars;      // 0..2 = 1
    float milky;      // 0..1 = 0.6       Milky Way
    float glow;       // 0..2 = 1         halo around the moon
    float meteors;    // 0..1 = 0.35
};

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

// one layer of stars on a grid of `cells` per unit
float star_layer(vec2 p, float cells, float t, float seed) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + seed);
    if (h < 0.62) return 0.0;                         // empty cell
    vec2 off = (hash22(id + seed * 1.7) - 0.5) * 0.7;
    float d = length(f - off) / cells;                // distance in units of p
    float size = mix(0.7, 2.2, pow(hash21(id + seed + 9.1), 5.0));
    float tw = 0.6 + 0.4 * sin(t * (1.0 + 3.0 * h) + h * 40.0);
    float px = 2.0 / u_world_resolution.y;            // one pixel in units of p
    float x = d / (px * size);
    float bright = 0.25 + 2.4 * pow(hash21(id + seed + 4.4), 6.0);   // a few bright ones
    return (exp(-x * x * 0.9) + 0.05 * exp(-x * 0.6)) * tw * bright;
}

// moon surface albedo on the unit disk
float moon_albedo(vec2 q, vec3 n) {
    vec2 m = n.xy / (0.55 + 0.45 * n.z);              // spherical squeeze at the limb
    float maria = smoothstep(0.48, 0.62, fbm(m * 1.8 + vec2(3.1, 1.7), 4));
    float a = mix(0.95, 0.62, maria);
    a *= 0.9 + 0.1 * fbm(m * 9.0, 3);
    // craters: one per cell, rim bright, floor dark
    vec2 g = m * 5.0;
    vec2 id = floor(g);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 c = id + vec2(i, j);
        float h = hash21(c + 5.3);
        if (h < 0.45) continue;
        vec2 o = c + 0.5 + (hash22(c) - 0.5) * 0.6;
        float r = 0.12 + 0.2 * hash21(c + 1.9);
        float d = length(g - o) / r;
        a *= 1.0 - 0.18 * (1.0 - smoothstep(0.7, 1.0, d));
        a += 0.12 * exp(-pow((d - 1.0) * 6.0, 2.0));
    }
    // one bright ray crater
    vec2 tc = q - vec2(-0.25, -0.45);
    float tr = length(tc);
    float ang = atan(tc.y, tc.x);
    a += 0.25 * exp(-tr * 18.0) + 0.06 * exp(-tr * 3.0) * pow(abs(sin(ang * 7.0 + 1.3)), 12.0);
    return a;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float t = u_time;
    vec2 p = to_centered(w);
    float px = 2.0 / u_world_resolution.y;

    // ---------------- eclipse geometry
    vec2 mc = frame_offset(moon_x, moon_y);
    float Rm = moon_size;
    float Ru = Rm * 2.7, Rp = Rm * 4.6;              // umbra / penumbra radii
    float ph = auto_run ? fract(t / period) : scrub;
    // shadow centre's distance from the moon over the cycle: about 30 % total,
    // 35 % partial (umbra edge on the moon), the rest penumbra / clear
    float sgn = ph < 0.5 ? -1.0 : 1.0;
    float s = abs(ph * 2.0 - 1.0);
    float dd = s < 0.3 ? (Ru - Rm * 1.05) * smoothstep(0.0, 0.3, s) * (s / 0.3)
                       : mix(Ru - Rm * 1.05, Rp + Rm + 0.15, (s - 0.3) / 0.7);
    vec2 sc = mc + sgn * dd * normalize(vec2(1.0, 0.18));
    float dc = length(mc - sc);
    float total = smoothstep(Ru - Rm * 0.2, Ru - Rm * 1.1, dc);   // 1 = moon fully in umbra
    float partial = smoothstep(Ru + Rm, Ru - Rm, dc);             // how deep it is in at all

    // ---------------- sky
    vec2 sp = mat2(cos(t * 0.004), -sin(t * 0.004), sin(t * 0.004), cos(t * 0.004)) * p;
    vec3 col = mix(vec3(0.004, 0.008, 0.025), vec3(0.015, 0.03, 0.07), smoothstep(1.2, -1.0, p.y));
    // Milky Way: a soft band with dark dust lanes and dense faint stars
    vec2 bp = mat2(0.82, -0.57, 0.57, 0.82) * sp;
    float band = exp(-pow(bp.y / 0.38, 2.0));
    float cloud = fbm(bp * vec2(1.4, 3.5) + 4.0, 5);
    float dust = smoothstep(0.45, 0.7, fbm(bp * vec2(2.5, 7.0) + 11.0, 5));
    float mw = band * cloud * (1.0 - 0.8 * dust) * milky;
    col += mw * vec3(0.16, 0.15, 0.2) * 1.4;
    col += band * milky * vec3(0.05, 0.02, 0.07) * fbm(bp * 2.0 + 30.0, 3);   // faint violet
    // stars: brighter as the moon goes dark
    float boost = mix(0.45, 1.25, max(total, partial * 0.4)) * stars;   // moonlight washes them out
    float st = star_layer(sp, 9.0, t, 1.0) * 1.0
             + star_layer(sp, 22.0, t, 7.0) * 0.7
             + star_layer(sp, 55.0, t, 13.0) * (0.2 + 0.7 * band * milky);
    vec3 sc_col = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash21(floor(sp * 22.0)));
    col += st * boost * sc_col;

    // ---------------- meteors
    for (int k = 0; k < 2; k++) {
        float slot = floor(t / 6.0) + float(k) * 0.5;
        float hk = hash1(slot * 3.1 + float(k));
        if (hk > meteors) continue;
        float lt = fract(t / 6.0 + float(k) * 0.5) * 6.0 - hash1(slot + 7.0) * 4.0;   // its own start
        if (lt < 0.0 || lt > 0.9) continue;
        vec2 a = vec2(mix(-1.6, 1.2, hash1(slot + 1.0)), mix(0.3, 0.95, hash1(slot + 2.0)));
        vec2 dir = normalize(vec2(-0.8 - hash1(slot + 3.0), -0.45));
        vec2 head = a + dir * lt * 1.4;
        vec2 rel = p - head;
        float along = dot(rel, -dir);
        float across = abs(dot(rel, vec2(-dir.y, dir.x)));
        float tail = step(0.0, along) * exp(-along * 7.0) * exp(-across / (px * 1.2));
        col += tail * vec3(0.9, 0.95, 1.0) * sin(3.14159 * lt / 0.9);
    }

    // ---------------- moon
    vec2 q = (p - mc) / Rm;
    float r = length(q);
    // halo: white-blue when full, faint copper at totality
    vec3 halo_c = mix(vec3(0.55, 0.65, 0.9), vec3(0.6, 0.12, 0.04), total);
    float halo_amp = mix(1.0, 0.45, partial * 0.6 + total * 0.4);
    col += halo_c * glow * halo_amp * (0.35 * exp(-(r - 1.0) * 2.2) + 0.12 * exp(-(r - 1.0) * 0.6)) * step(1.0, r);
    if (r < 1.0 + px / Rm) {
        vec3 n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
        float alb = moon_albedo(q, n);
        float limb = 0.82 + 0.18 * n.z;
        // shadow at this point
        float d = length(p - sc);
        float soft = Rm * 0.06;
        float umbra = smoothstep(Ru + soft, Ru - soft, d);
        float pen = smoothstep(Rp, Ru, d);
        vec3 sun = vec3(1.0, 0.98, 0.94) * (1.0 - 0.65 * pen * pen);
        // inside the umbra: refracted sunset light, darker towards its centre
        float depth = clamp(d / Ru, 0.0, 1.0);
        vec3 copper = mix(vec3(0.32, 0.055, 0.02), vec3(0.9, 0.27, 0.08), depth * depth);
        // while the rest is still sunlit the umbra reads dark; it glows once total
        vec3 light = mix(sun, copper * mix(0.3, 1.0, total), umbra);
        // turquoise fringe just inside the umbra edge (ozone)
        light += vec3(0.05, 0.22, 0.28) * exp(-pow((d - Ru * 0.96) / (Rm * 0.09), 2.0)) * umbra;
        vec3 mcol = alb * limb * light;
        float edge = smoothstep(1.0 + px / Rm, 1.0 - px / Rm, r);
        col = mix(col, mcol, edge);
    }
    f_color = vec4(col, 1.0);
}
