#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1          flight speed
    float twist;     // -2..2 = 0.7       spiral of the tendrils
    float thickness; // 0.02..0.4 = 0.1   sheet thickness
    float kick;      // 0..1 = 0.6        beat push / punch
    float glass;     // 0..1 = 0.6        see-through layering
    float grain;     // 0..0.3 = 0.07
    vec4  tint;      // color = 1,0.93,0
    int   quality;   // low|mid|high = mid
    int   color;     // tint|palette = palette
    float pal_pos;   // 0..1 = 0          where on the palette
    float spread;    // 0..1 = 0.25       palette range across shadows → highlights
    float cycle;     // 0..1 = 0          drift along the palette (per 16 beats)
};

float g_thick;
float g_tw;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
    p.xy = rot(p.z * g_tw * 0.35 + u_time * 0.07) * p.xy;
    float r = length(p.xy);
    // stretched along the flight axis so shapes streak towards the core
    vec3 q = vec3(p.xy * 2.4, p.z * 0.7);
    float g1 = dot(sin(q), cos(q.yzx));
    vec3 q2 = q * 1.7 + vec3(1.3, 0.7, u_time * 0.15);
    float g2 = dot(sin(q2), cos(q2.zxy));
    // membranes with holes
    float sheet = abs(g1 + 0.2 * g2) / 3.2 - g_thick * 0.7;
    // thin tendrils where two gyroids meet
    float tube = length(vec2(g1, g2)) / 3.6 - g_thick * 0.35;
    float d = smin(sheet, tube, 0.06);
    // open core so we always look down the vortex
    d = max(d, 0.22 - r);
    return d;
}

vec3 calc_normal(vec3 p) {
    const vec2 k = vec2(1.0, -1.0) * 0.0015;
    return normalize(k.xyy * map(p + k.xyy) + k.yyx * map(p + k.yyx) +
                     k.yxy * map(p + k.yxy) + k.xxx * map(p + k.xxx));
}

// studio-like environment: bright forward core, softboxes, streaks
float env(vec3 d) {
    float core  = pow(max(d.z, 0.0), 4.0) * 2.2;
    float ang   = atan(d.y, d.x);
    float boxes = smoothstep(0.55, 0.95, sin(ang * 3.0 + d.z * 3.0 + u_time * 0.3) * 0.5 + 0.5);
    float top   = smoothstep(0.1, 0.9, d.y) * 0.9;
    float side  = smoothstep(0.3, 0.95, -d.x) * 0.5;
    return core + boxes * 1.3 + top * 0.9 + side * 0.6;
}

float march(vec3 ro, vec3 rd, float tmin, float tmax, int steps, out vec3 hp) {
    float t = tmin;
    for (int i = 0; i < steps; i++) {
        vec3 p = ro + rd * t;
        float d = map(p);
        if (abs(d) < 0.003 * t) { hp = p; return t; }
        t += d * 0.7;
        if (t > tmax) break;
    }
    hp = ro + rd * t;
    return -1.0;
}

void main() {
    g_thick = thickness * (1.0 + kick * 0.6 * u_beat);
    g_tw = twist;

    vec2 uv = to_centered(v_uv);

    // flight: steady drift + a lunge on every beat
    float lunge = floor(u_beats) + smoothstep(0.0, 0.35, fract(u_beats));
    float z = u_time * speed * 0.6 + kick * lunge * 0.8;
    vec3 ro = vec3(0.12 * sin(u_time * 0.31), 0.1 * cos(u_time * 0.23), z);
    float fov = 1.25 - kick * 0.25 * u_beat;
    vec3 rd = normalize(vec3(uv * rot(u_time * 0.05 * speed), fov));

    vec3 L = normalize(vec3(-0.5, 0.8, 0.4));
    float lum = 0.0;
    float w = 1.0;
    float tmin = 0.0;
    vec3 cur = ro;
    float traveled = 0.0;

    // quality: primary steps / see-through steps / layers
    int steps0 = quality == 0 ? 40 : (quality == 1 ? 56 : 80);
    int steps1 = quality == 0 ? 0  : (quality == 1 ? 28 : 44);
    int layers = (quality == 0 || glass < 0.01) ? 1 : (quality == 1 ? 2 : 3);
    float tmax = quality == 2 ? 16.0 : 11.0;

    for (int layer = 0; layer < layers; layer++) {
        vec3 hp;
        float t = march(cur, rd, tmin, tmax - traveled, layer == 0 ? steps0 : steps1, hp);
        if (t < 0.0) break;
        traveled += t;
        vec3 n = calc_normal(hp);
        vec3 r = reflect(rd, n);
        float fres = pow(1.0 - abs(dot(n, -rd)), 3.0);
        float spec = pow(max(dot(r, L), 0.0), 60.0) * 3.0;
        float rim  = pow(1.0 - abs(dot(n, -rd)), 8.0) * 1.5;
        float diff = max(dot(n, L), 0.0) * 0.12;
        float s = env(r) * (0.3 + 1.0 * fres) + spec + rim + diff;
        s *= exp(-traveled * 0.11) * smoothstep(tmax, tmax * 0.6, traveled);           // depth falloff
        float a = (layer == layers - 1) ? 1.0 : mix(1.0, 0.35 + 0.6 * fres, glass);
        lum += w * a * s;
        w *= (1.0 - a);
        if (w < 0.03) break;
        cur = hp + rd * 0.02;                  // pass through the sheet
        tmin = g_thick * 2.0 + 0.02;
    }
    // vortex core glow behind everything
    float core = exp(-length(uv) * 3.0) * (0.9 + 0.5 * u_beat * kick);
    lum += w * core;

    // ---- tone: yellow monochrome, hot highlights go pale ----
    lum = lum / (1.0 + lum * 0.35);
    float pt = pal_pos + cycle * u_beats / 16.0;
    vec3 base = color == 1 ? palette(fract(pt + spread * clamp(lum, 0.0, 1.0))) : tint.rgb;
    vec3 shadow_c = color == 1 ? palette(fract(pt)) : tint.rgb;
    // keep the punch whatever the palette: brightest channel to 1
    base /= max(max(base.r, base.g), max(base.b, 0.05));
    shadow_c /= max(max(shadow_c.r, shadow_c.g), max(shadow_c.b, 0.05));
    vec3 col = base * pow(lum, 1.8) * 1.25;
    col = mix(col, mix(base, vec3(1.0), 0.8), smoothstep(0.75, 1.4, lum));
    // olive shadows
    col = mix(shadow_c * 0.07 * lum * 3.0, col, smoothstep(0.0, 0.35, lum));

    // radial speed streaks
    float ang = atan(uv.y, uv.x);
    float streak = hash21(vec2(floor(ang * 90.0), 0.0));
    col += base * 0.06 * step(0.93, streak) * smoothstep(0.2, 1.2, length(uv)) * (0.5 + u_beat);

    // vignette + grain
    col *= 1.0 - 0.45 * pow(length(v_uv - 0.5) * 1.35, 2.5);
    float n = hash21(v_uv * u_resolution + fract(u_time * 13.0) * 100.0) - 0.5;
    col += n * grain;

    f_color = vec4(max(col, 0.0), 1.0);
}
