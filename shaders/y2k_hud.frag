#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// in0: the picture to put the HUD over

layout(set = 0, binding = 1) uniform NodeParams {
    float hud;         // 0..1 = 0.85       HUD overlay amount
    int   every;       // 1..16 = 2         beats per re-target of the boxes
    float aberration;  // 0..1 = 0.35       color fringes at the edges
    float vignette;    // 0..1 = 0.3
    float grain;       // 0..0.3 = 0.06
    vec4  ink;         // color = 1,1,1
    vec4  accent;      // color = 0.92,0.16,0.36
    vec4  navy;        // color = 0.08,0.07,0.26
};

// 3x5 bitmap glyphs: 0-9, x, y
const int FONT[12] = int[12](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695, 2728, 23246);

float glyph(int g, int col, int row) {
    return float((FONT[g] >> ((4 - row) * 3 + (2 - col))) & 1);
}

int digit_of(int v, int place) {   // place 0 = hundreds .. 2 = ones
    int p = place == 0 ? 100 : (place == 1 ? 10 : 1);
    return (v / p) % 10;
}

// "x 123 y 456"
float label(vec2 P, vec2 org, float s, int a, int b) {
    vec2 c = floor((P - org) / s);
    if (c.x < 0.0 || c.y < 0.0 || c.y > 4.0 || c.x >= 44.0) return 0.0;
    int ci = int(c.x) / 4;
    int col = int(c.x) - ci * 4;
    if (col == 3) return 0.0;
    int g = -1;
    if (ci == 0) g = 10;
    else if (ci == 6) g = 11;
    else if (ci >= 2 && ci <= 4) g = digit_of(a, ci - 2);
    else if (ci >= 8 && ci <= 10) g = digit_of(b, ci - 8);
    return g < 0 ? 0.0 : glyph(g, col, int(c.y));
}

float number(vec2 P, vec2 org, float s, int v) {
    vec2 c = floor((P - org) / s);
    if (c.x < 0.0 || c.y < 0.0 || c.y > 4.0 || c.x >= 12.0) return 0.0;
    int ci = int(c.x) / 4;
    int col = int(c.x) - ci * 4;
    return col == 3 ? 0.0 : glyph(digit_of(v, ci), col, int(c.y));
}

float outline(vec2 P, vec2 lo, vec2 hi, float w) {
    vec2 d = min(P - lo, hi - P);
    return (d.x >= 0.0 && d.y >= 0.0 && min(d.x, d.y) < w) ? 1.0 : 0.0;
}

float xmark(vec2 P, vec2 c, float r, float w) {
    vec2 d = abs(P - c);
    return (max(d.x, d.y) < r && abs(d.x - d.y) < w) ? 1.0 : 0.0;
}

float seg(vec2 P, vec2 a, vec2 b, float w, out float t) {
    vec2 ab = b - a;
    t = clamp(dot(P - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(P - a - ab * t) < w ? 1.0 : 0.0;
}

void main() {
    vec2 R = u_resolution;
    vec2 P = v_uv * R;
    float px = max(u_scale, 0.5);
    float s = 2.0 * px;

    // picture with edge fringes and vignette
    vec2 dc = v_uv - 0.5;
    vec2 off = dc * length(dc) * aberration * 0.03;
    vec3 col = vec3(texture(u_tex0, v_uv + off).r, texture(u_tex0, v_uv).g, texture(u_tex0, v_uv - off).b);
    col *= 1.0 - vignette * smoothstep(0.35, 0.9, length(dc * vec2(1.0, 0.85)) * 1.25);

    float seed = floor(u_beats / float(every));
    float ph = fract(u_beats / float(every));
    float m = 0.0, acc = 0.0, dia = 0.0;
    vec3 dia_col = navy.rgb;

    // tracking boxes with coordinates, re-targeted every few beats
    float grow = smoothstep(0.0, 0.1, ph);
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = (0.08 + 0.84 * hash22(vec2(seed, fi * 3.1))) * R;
        float size = mix(24.0, 150.0, hash21(vec2(fi, seed + 1.3))) * px;
        vec2 half_ = vec2(size * 0.5 * mix(1.5, 1.0, grow));
        m += outline(P, c - half_, c + half_, px) * grow;
        m += label(P, c - half_ - vec2(0.0, 7.0 * s), s, int(c.x / R.x * 999.0), int(c.y / R.y * 999.0)) * 0.85;
        if (hash21(vec2(fi, seed + 4.0)) < 0.5) acc += xmark(P, c, 3.5 * px, 0.8 * px);
    }
    // large thin frames
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        vec2 lo = hash22(vec2(fi + 20.0, floor(seed / 4.0))) * R * 0.5;
        vec2 hi = lo + R * mix(vec2(0.2), vec2(0.45), hash22(vec2(fi, 31.0 + floor(seed / 4.0))));
        m += outline(P, lo, hi, px) * 0.35;
    }
    // crosshairs and scattered x marks
    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        vec2 c = hash22(vec2(fi * 5.3, 77.0 + floor(seed / 2.0))) * R;
        if (i < 5) {
            vec2 d = abs(P - c);
            m += ((d.x < 0.6 * px && d.y < 7.0 * px) || (d.y < 0.6 * px && d.x < 7.0 * px)) ? 0.8 : 0.0;
        } else {
            acc += xmark(P, c, 3.0 * px, 0.7 * px);
        }
    }
    // diamonds blinking on the beat (upper right)
    for (int i = 0; i < 9; i++) {
        float fi = float(i);
        vec2 h = hash22(vec2(fi * 2.7, 13.0));
        vec2 c = R * vec2(mix(0.72, 0.97, h.x), mix(0.01, 0.2, h.y));
        float sz = mix(5.0, 10.0, hash21(vec2(fi, 3.0))) * px;
        bool on = hash21(vec2(fi, floor(u_beats))) > 0.3;
        if (on && abs(P.x - c.x) + abs(P.y - c.y) < sz) {
            dia = 1.0;
            dia_col = hash21(vec2(fi, 8.0)) < 0.35 ? accent.rgb : navy.rgb;
        }
    }
    // ruler on the right edge, scrolling
    float x0 = R.x - 34.0 * px;
    float step_ = 16.0 * px;
    float scroll = u_time * 18.0 * px;
    if (abs(P.x - x0) < 0.6 * px) m += 0.8;
    float ty = P.y + scroll;
    float idx = floor(ty / step_);
    float len = mod(idx, 5.0) == 0.0 ? 12.0 * px : 5.0 * px;
    if (ty - idx * step_ < px && P.x > x0 && P.x < x0 + len) m += 0.8;
    float i10 = floor((ty + 2.5 * s) / (step_ * 10.0));
    vec2 norg = vec2(x0 - 30.0 * px, i10 * step_ * 10.0 - scroll - 2.5 * s);
    m += number(P, norg, s, int(mod(i10 * 37.0 + 200.0, 1000.0))) * 0.8;
    // dashed guides
    float t;
    vec2 a = vec2(0.0, R.y * 0.05);
    vec2 b = vec2(R.x * 0.45, R.y * 0.55);
    if (seg(P, a, b, 0.6 * px, t) > 0.0 && fract(t * length(b - a) / (12.0 * px)) < 0.5) m += 0.6;
    vec2 cc = R * vec2(0.3, 0.45);
    float rad = R.y * 0.33;
    float ang = atan(P.y - cc.y, P.x - cc.x);
    if (abs(length(P - cc) - rad) < 0.6 * px && fract(ang * rad / (10.0 * px) + u_time * 0.5) < 0.5) m += 0.45;

    m *= 0.75 + 0.25 * u_beat;
    col = mix(col, ink.rgb, clamp(m, 0.0, 1.0) * hud);
    col = mix(col, accent.rgb, clamp(acc, 0.0, 1.0) * hud);
    col = mix(col, dia_col, dia * hud);

    col += (hash21(P + fract(u_time * 7.0) * 311.0) - 0.5) * grain;
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
