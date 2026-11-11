#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Botanica: white orbit rings (tilted circles, mirrored left-right), dashed
// arcs and a tracking HUD that boxes some of bt_sky's birds with their
// "x: #### y: ####" coordinates. Over in0. Free-running unless `react`.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;       // 0..4 = 1
    int   rings;       // 0..4 = 3          rings per side
    float ring_width;  // 0.5..30 = 9       px, at the thick side
    float ring_alpha;  // 0..1 = 0.85
    int   tracks;      // 0..30 = 14        tracked birds
    float hud_alpha;   // 0..1 = 0.9
    float dash;        // 0..1 = 0.6        dashed arcs
    float react;       // 0..1 = 0          beat push (0 = free-running)
};

// same as bt_sky.frag
vec2 bird_pos(float i, float t) {
    float h1 = hash21(vec2(i, 1.7)), h2 = hash21(vec2(i, 9.3)), h3 = hash21(vec2(i, 4.1));
    vec2 c = vec2(0.5 + 0.25 * sin(t * 0.05), 0.38 + 0.1 * sin(t * 0.083 + 1.0));
    vec2 off = (vec2(h1, h2) - 0.5) * vec2(1.3, 0.75);
    off *= 0.8 + 0.3 * sin(t * 0.13 + h3 * 6.2832);
    off += 0.03 * vec2(sin(t * 0.7 + i * 1.3), cos(t * 0.9 + i * 0.7));
    vec2 p = c + off;
    p.x = fract(p.x + t * 0.012 * (0.7 + h3 * 0.6));
    return p;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// 3x5 glyphs, bit (row * 3 + col), row 0 at the top: 0-9, x, y, ':'
int glyph(int c) {
    const int G[13] = int[13](31599, 29850, 29671, 31207, 18925, 31183, 31695,
                              18727, 31727, 31215, 2728, 14760, 1040);
    return c < 0 ? 0 : G[c];
}

int digit(float v, int j) { return int(mod(floor(v / pow(10.0, float(3 - j))), 10.0)); }

// "x: XXXX y: YYYY", local in glyph pixels from the top-left of the text
float label(vec2 g, float X, float Y) {
    if (g.x < 0.0 || g.y < 0.0 || g.y >= 5.0 || g.x >= 60.0) return 0.0;
    int k = int(g.x / 4.0);
    int col = int(g.x) - k * 4;
    if (col >= 3) return 0.0;
    int c = -1;
    if (k == 0) c = 10; else if (k == 1) c = 12;
    else if (k >= 3 && k <= 6) c = digit(X, k - 3);
    else if (k == 8) c = 11; else if (k == 9) c = 12;
    else if (k >= 11 && k <= 14) c = digit(Y, k - 11);
    int row = int(g.y);
    return float((glyph(c) >> (row * 3 + col)) & 1);
}

// orbit ring: circle of radius r tilted by `tilt` (squashes y), turned by `ang`;
// thicker on the side facing us
float ring(vec2 p, float r, float tilt, float ang, float w, float px) {
    p = rot(ang) * p;
    vec2 ab = vec2(r, max(r * abs(cos(tilt)), 0.002));
    vec2 q = p / ab;
    float k = length(q);
    float d = abs(k - 1.0) / length(q / ab) * k;     // ≈ distance to the ellipse
    float side = 0.5 + 0.5 * sin(atan(q.y, q.x)) * sign(cos(tilt));
    float hw = mix(0.25, 1.0, side * side) * w;
    return 1.0 - smoothstep(hw - px, hw + px, d);
}

float box(vec2 d, float h, float lw) {
    vec2 a = abs(d);
    float outline = abs(max(a.x, a.y) - h);
    return 1.0 - smoothstep(lw * 0.5, lw * 0.5 + 0.8, outline);
}

void main() {
    vec3 src = texture(u_tex0, v_uv).rgb;
    float t = u_time;
    float T = t * speed * 0.2
            + react * (floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats))) * 0.2;
    vec2 p = to_centered(v_uv);
    float px = 2.0 / u_resolution.y;      // one pixel in centred units
    float w = ring_width * u_scale * px;

    // orbit rings, mirrored left-right
    vec2 m = vec2(abs(p.x), p.y);
    float rg = 0.0;
    for (int i = 0; i < 4; i++) {
        if (i >= rings) break;
        float fi = float(i);
        vec2 c = vec2(1.08, 0.0);
        float r = 0.62 + fi * 0.06;
        float tilt = T * (0.6 + fi * 0.23) + fi * 1.9;
        float ang = 0.35 + fi * 0.95 + T * 0.15 * (fi - 1.0);
        rg = max(rg, ring(m - c, r, tilt, ang, w * (1.0 - fi * 0.15), px * u_scale));
    }
    // small pair at the centre
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        rg = max(rg, ring(m - vec2(0.17, 0.0), 0.13, T * 1.1 + fi * 1.4,
                          fi * 1.6 + 0.4, w * 0.6, px * u_scale));
    }
    vec3 col = mix(src, vec3(1.0), rg * ring_alpha);

    // dashed arcs
    float hud = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 q = rot(0.2 * sin(T * 0.3 + fi) + fi * 0.7) * (p - vec2(0.0, -0.1 + fi * 0.1));
        vec2 ab = vec2(1.75 - fi * 0.35, 0.92 - fi * 0.18);
        vec2 e = q / ab;
        float k = length(e);
        float d = abs(k - 1.0) / length(e / ab) * k;
        float a = atan(e.y, e.x) / 6.2832;
        float on = step(0.5, fract(a * (90.0 + fi * 30.0) + t * 0.05 * (fi + 1.0)));
        float span = step(0.35 + fi * 0.15, fract(a + T * 0.05 + fi * 0.37));   // arcs, not full loops
        hud = max(hud, (1.0 - smoothstep(0.6 * px, 1.5 * px, d)) * on * span * dash);
    }

    // tracking boxes + coordinates
    vec2 P = v_uv * u_resolution;
    float s = u_scale;
    for (int k = 0; k < 30; k++) {
        if (k >= tracks) break;
        float i = float(k * 5 + 2);               // a spread of bt_sky's birds
        float win = floor(t * 0.2 + hash21(vec2(i, 3.3)) * 7.0);
        if (hash21(vec2(i, win)) < 0.3) continue;   // tracks come and go
        vec2 bp = bird_pos(i, t);
        vec2 d = P - bp * u_resolution;
        if (abs(d.x) > 200.0 * s || abs(d.y) > 20.0 * s) continue;
        float h = 9.0 * s;
        hud = max(hud, box(d, h, 1.2 * s));
        // small corner tick
        vec2 tk = d - vec2(h, -h);
        hud = max(hud, step(abs(tk.x), 2.0 * s) * step(abs(tk.y), 2.0 * s));
        // coordinates as if on a 2560-wide frame
        float gs = 2.5 * s;                       // glyph pixel size
        vec2 g = (d - vec2(h + 6.0 * s, -h)) / gs;
        hud = max(hud, label(g, floor(bp.x * 2560.0), floor(bp.y * 1440.0)));
    }

    // frame lines
    float fl = (1.0 - smoothstep(0.5, 1.2, abs(P.y - u_resolution.y * 0.74) / s)) * step(P.x, u_resolution.x * 0.45);
    fl = max(fl, (1.0 - smoothstep(0.5, 1.2, abs(P.y - 2.0 * s) / s)) * step(u_resolution.x * 0.55, P.x));
    hud = max(hud, fl * 0.7);

    col = mix(col, vec3(1.0), clamp(hud, 0.0, 1.0) * hud_alpha);
    f_color = vec4(col, 1.0);
}
