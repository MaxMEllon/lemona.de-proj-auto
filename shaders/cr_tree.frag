#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Crystal Tree (ported from a TouchDesigner GLSL TOP): raymarched fractal
// trees of glass growing up / down / left / right, repeating along z while
// the camera flies through. Each branch is a box, folded and rotated per
// generation and smooth-unioned; the material refracts in0 (or a built-in
// colourful "photo" when in0 is unconnected) through the measured thickness,
// with dispersion, Beer-Lambert tint, fresnel reflection and specular.
// Beat: the flight lurches forward on each beat (`push`), kick (pad 1 / low
// hit) flares the crystal edges, the photo colours switch every two bars,
// accent (pad 4) inverts. Lower `quality` if the frame rate drops.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    vec4  tint;      // color = 0.92,0.96,1   transmission tint
    int   levels;    // 1..9 = 7         tree generations
    float child;     // 0.4..0.95 = 0.78 child scale per generation
    float base;      // 0.2..3 = 1       trunk size
    float angle;     // 0..90 = 32       branch angle (degrees)
    float zstep;     // 0..1 = 0.22      z step toward the camera per generation
    float camdist;   // 0.5..8 = 3.2     camera distance
    float zoom;      // 0.2..3 = 1
    float opacity;   // 0..1 = 1
    float spec;      // 0..3 = 0.8       specular
    float ior;       // 1.02..2.5 = 1.45 index of refraction
    float disp;      // 0..0.2 = 0.03    dispersion
    float sat;       // 0..2 = 1         saturation
    float gain;      // 0..3 = 1.2       input gain
    float glow;      // 0..0.5 = 0.04    internal glow
    float sheen;     // 0..2 = 0.6       edge sheen
    float blend;     // 0..0.5 = 0.12    smooth-union blend
    float speed;     // 0..3 = 0.5       forward speed
    float period;    // 0..8 = 2.5       z repeat period (0 = no repeat)
    float farfade;   // 0.05..1 = 0.55   far fade start (share of the far distance)
    float nearfade;  // 0..2 = 0.35      near clip / fade
    float roll;      // -0.5..0.5 = 0.02 roll (turns per second)
    float drift;     // 0..2 = 0.3       environment drift
    float push;      // 0..1 = 0.3       forward lurch on each beat
    float bg;        // 0..1 = 0.15      background: the photo, dimmed
    int   quality;   // 40..200 = 120    march steps
};

#define PI       3.141592653589793
#define MAXLEVEL 9
#define FAR      12.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// ---- environment: in0, or a built-in colourful photo ------------
float g_section;
vec3 photo(vec2 uv) {
    if (texture(u_tex0, vec2(0.5)).a > 0.5) return texture(u_tex0, uv).rgb;
    // A bright, hard-edged stand-in for a photo: white / grey base, sharp
    // colour patches, thin dark lines and fine grain, so the refraction
    // reads as crisp crystal rather than soft blobs.
    vec2 q = uv * 5.0;
    float w = fbm(q * 0.8 + g_section * 3.7, 3);
    float n = fbm(q * 1.4 + w * 1.8, 4);
    float m = fbm(q * 2.3 - w * 2.5 + 7.1, 3);
    vec3 a, b;
    if (g_section < 0.5) { a = vec3(0.85, 0.27, 0.14); b = vec3(0.14, 0.16, 0.78); }
    else                 { a = vec3(0.82, 0.95, 0.18); b = vec3(0.36, 0.24, 0.80); }
    vec3 col = mix(vec3(0.62), vec3(0.97), smoothstep(0.35, 0.6, w));        // grey / white
    col = mix(col, a, step(0.66, n));                                         // sharp patches
    col = mix(col, b, step(0.7, m) * (1.0 - step(0.66, n)));
    col *= 1.0 - 0.75 * step(0.93, fract(n * 9.0 + m * 4.0));               // thin dark lines
    col *= 0.85 + 0.3 * noise2(q * 40.0);                                    // grain
    col = mix(col, vec3(0.05), step(0.78, fbm(q * 1.1 + 3.3, 2)) * 0.8);     // a few dark areas
    return col;
}

// polynomial smooth min; .x = blended distance, .y = blend factor
vec2 smin(float a, float b, float k) {
    k = max(k, 1e-4);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return vec2(mix(b, a, h) - k * h * (1.0 - h), h);
}

float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

vec2 mirrorUV(vec2 uv) { return abs(fract(uv * 0.5) * 2.0 - 1.0); }

// ---- one tree, growing along +Y --------------------------------
float dTree(vec3 p, out float lvl) {
    float ang = radians(angle);
    vec3 size = vec3(0.09, 0.62, 0.09) * max(base, 1e-3);
    float d = sdBox(p, size);
    lvl = 0.0;
    for (int i = 0; i < MAXLEVEL; ++i) {
        if (i >= levels) break;
        p.x  = abs(p.x);
        p.y -= size.y;
        p.xy = rot(ang) * p.xy;
        p.z -= zstep;
        size *= child;
        float db = sdBox(p, size);
        vec2 sm = smin(d, db, blend * size.y);
        d = sm.x;
        lvl = mix(float(i + 1), lvl, sm.y);
    }
    return d;
}

float treeDepth() { return float(clamp(levels, 1, MAXLEVEL)) * zstep; }
float repeatPeriod() { return max(period, treeDepth() * 1.25); }

// ---- four trees: up, down, left, right --------------------------
float map(vec3 p, out float lvl) {
    vec3 q = p;
    if (period > 1e-3) {
        float P = repeatPeriod();
        float c = treeDepth() * 0.5;
        q.z = mod(q.z - c + 0.5 * P, P) - 0.5 * P + c;
    }
    q.xy = abs(q.xy);
    float lv, lh;
    float dv = dTree(q, lv);
    float dh = dTree(vec3(q.y, q.x, q.z), lh);
    vec2 sm = smin(dv, dh, blend * 0.62 * max(base, 1e-3));
    lvl = mix(lh, lv, sm.y);
    return sm.x;
}

float mapD(vec3 p) { float l; return map(p, l); }

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(1.0, -1.0) * 0.0012;
    return normalize(e.xyy * mapD(p + e.xyy) + e.yyx * mapD(p + e.yyx) +
                     e.yxy * mapD(p + e.yxy) + e.xxx * mapD(p + e.xxx));
}

// symmetric environment lookup, mirrored like the geometry
vec2 crystalUV(vec3 pos, vec3 dir, float k) {
    vec2 e = abs(pos.xy) * 0.09 + abs(dir.xy) * k + abs(dir.z) * 0.12;
    return mirrorUV(e + 0.5 + u_time * drift * 0.05);
}

void main() {
    g_section = mod(floor(u_beats / 8.0), 2.0);
    float kick = max(u_triggers.x, u_hits.y);

    // TD's vUV has its origin bottom-left; v_uv is top-left.
    vec2 uv = (vec2(v_uv.x, 1.0 - v_uv.y) - 0.5) * 2.0;
    uv.x *= aspect();

    float lurch = floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats));
    float travel = u_time * speed + lurch * push * 0.5;
    if (period > 1e-3) travel = mod(travel, repeatPeriod());
    vec3 ro = vec3(0.0, 0.0, max(camdist, 0.5) - travel);
    vec3 rd = normalize(vec3(uv * max(zoom, 1e-3), -1.0));
    rd.xy = rot(u_time * roll * 2.0 * PI) * rd.xy;

    // ---- march ------------------------------------------------
    float tStart = max(nearfade, 0.0);
    float t = tStart, d = FAR;
    bool hit = false;
    for (int i = 0; i < 200; ++i) {
        if (i >= quality) break;
        d = mapD(ro + rd * t);
        if (d < 0.0009 * (1.0 + t)) { hit = true; break; }
        t += min(d * 0.62, repeatPeriod() * 0.45);
        if (t > FAR) break;
    }

    vec3 back = photo(v_uv) * bg;
    vec3 outc = back;
    if (hit) {
        vec3 pos = ro + rd * t;
        vec3 n = calcNormal(pos);
        float lvl; map(pos, lvl);
        float lvn = lvl / max(float(levels), 1.0);

        // ---- glass / rock crystal ---------------------------------
        float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
        float eta = max(ior, 1.02);
        vec3 rfl = reflect(rd, n);
        vec3 rin = refract(rd, n, 1.0 / eta);

        float thick = 0.0;
        vec3 exitP = pos, exitN = -n;
        if (dot(rin, rin) > 0.0) {
            vec3 ip = pos - n * 0.004;
            for (int i = 0; i < 40; ++i) {
                float dd = -mapD(ip + rin * thick);
                if (dd < 0.0015) break;
                thick += max(dd, 0.0025);
                if (thick > 2.5) break;
            }
            exitP = ip + rin * thick;
            exitN = -calcNormal(exitP);
        }
        vec3 routR = refract(rin, exitN, eta - disp);
        vec3 routG = refract(rin, exitN, eta);
        vec3 routB = refract(rin, exitN, eta + disp);
        if (dot(routG, routG) <= 0.0) routG = reflect(rin, exitN);
        if (dot(routR, routR) <= 0.0) routR = routG;
        if (dot(routB, routB) <= 0.0) routB = routG;

        vec3 refrCol = vec3(photo(crystalUV(exitP, routR, 0.45)).r,
                            photo(crystalUV(exitP, routG, 0.45)).g,
                            photo(crystalUV(exitP, routB, 0.45)).b);
        vec3 reflCol = photo(crystalUV(pos, rfl, 0.85));

        vec3 sigma = (1.0 - clamp(tint.rgb, 0.0, 1.0)) * 1.6;
        refrCol *= exp(-sigma * thick);

        vec3 col = mix(refrCol, reflCol * 1.25, clamp(fres, 0.0, 1.0));
        col += reflCol * fres * 0.45;
        col *= max(gain, 0.0);
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, sat);

        vec3 L = normalize(vec3(-0.4, 0.7, 0.6));
        float sp = pow(max(dot(rfl, L), 0.0), 72.0);
        float wrap = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
        col *= mix(0.62, 1.25, wrap);
        col += vec3(sp) * spec;
        col += tint.rgb * fres * sheen * (1.0 + kick * 2.0);
        col += tint.rgb * glow;
        col *= mix(0.65, 1.30, lvn);
        col = col / (1.0 + col * 0.34);

        float farF = 1.0 - smoothstep(FAR * max(farfade, 0.05), FAR * 0.96, t);
        float nearF = smoothstep(tStart, tStart + max(nearfade, 0.15), t);
        float alpha = clamp((0.55 + 0.45 * fres) * opacity * farF * nearF, 0.0, 1.0);
        col *= mix(0.35, 1.0, farF);
        // TD composited this premultiplied over its background; here the
        // output is opaque, so blend over the dimmed photo instead.
        outc = mix(back, col, alpha);
    }
    outc = clamp(outc, 0.0, 1.0);
    outc = mix(outc, 1.0 - outc, step(0.5, u_triggers.w));
    f_color = vec4(outc, 1.0);
}
