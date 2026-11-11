#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Industrial: red / white / black machine graphics in shapes and lines, moving
// stop-go on the beat clock. Four scenes, cut every `bars` bars (or held):
//   press    — a red ram slams a workpiece on every beat, guide rails + scale
//   gear     — two meshing gears ratchet one tooth per 8th, hazard band
//   conveyor — lanes of blocks jerk along each beat, a red scanner sweeps the bar
//   hazard   — striped chevrons step across, crosshair target, red bar flash
// Over them: frame, corner brackets, a 16-step and a 4-beat counter.
// Kick (low hit / pad 1) shakes the frame by `punch`; pad 4 inverts a frame.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   scene;   // auto|press|gear|conveyor|hazard = auto
    int   bars;    // 1..16 = 4         bars per scene (auto)
    float punch;   // 0..1 = 0.5        kick shake
    float lines;   // 0..1 = 1          technical lines / counters
    float stroke;  // 1..8 = 2.5        line width, px
    vec4  red;     // color = 0.92,0.04,0.05
    bool  invert;  // = false           white ground, black lines
};

float PX;          // one pixel in centred units
float B;           // beats
vec3  FG, BG, RD;

const float TAU = 6.2831853;

float hash(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2  rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float fill(float d) { return 1.0 - smoothstep(-PX, PX, d); }
float line(float d, float w) {
    float h = w * PX * 0.5;
    return 1.0 - smoothstep(h - PX * 0.7, h + PX * 0.7, abs(d));
}
float sd_box(vec2 p, vec2 b) {
    vec2 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float sd_seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float ease3(float f) { f = clamp(f, 0.0, 1.0); return 1.0 - pow(1.0 - f, 3.0); }
// stop-go: moves during the first `move` of each unit, then holds
float mech(float x, float move) { return floor(x) + ease3(fract(x) / move); }
// diagonal stripes, 1 on the stripe
float stripes(vec2 p, float freq, float scroll) {
    float v = (p.x + p.y) * freq + scroll;
    float d = abs(fract(v) - 0.5) - 0.25;
    float fw = fwidth(v);
    return 1.0 - smoothstep(-fw, fw, d);
}

// ---------------------------------------------------------------- press
vec3 scene_press(vec2 p, vec3 col) {
    float ph = fract(B);
    // rises slowly through the beat, drops in the last 15 %
    float up = ph < 0.85 ? smoothstep(0.0, 0.85, ph) : 1.0 - pow((ph - 0.85) / 0.15, 2.0);
    float impact = exp(-ph * 10.0);
    float base = -0.42;                                   // top of the workpiece
    float wh = 0.11 * (1.0 - 0.45 * impact);              // squashed on the hit
    float hy = mix(base + wh * 2.0, 0.5, up);             // bottom of the ram

    // anvil + workpiece
    col = mix(col, FG, line(sd_box(p - vec2(0.0, -0.78), vec2(0.95, 0.22)), stroke));
    col = mix(col, FG, fill(sd_box(p - vec2(0.0, base + wh), vec2(0.62 + 0.08 * impact, wh))));
    // ram, rods
    col = mix(col, RD, fill(sd_box(p - vec2(0.0, hy + 0.25), vec2(0.7, 0.25))));
    col = mix(col, BG, fill(sd_box(p - vec2(0.0, hy + 0.25), vec2(0.6, 0.012))));
    for (int i = -1; i <= 1; i += 2) {
        float x = float(i) * 0.38;
        col = mix(col, FG, fill(sd_box(p - vec2(x, (hy + 1.6) * 0.5), vec2(0.035, (1.1 - hy) * 0.5))));
    }
    // columns with hazard feet
    for (int i = -1; i <= 1; i += 2) {
        vec2 q = p - vec2(float(i) * 1.12, 0.0);
        float col_d = sd_box(q, vec2(0.07, 1.2));
        col = mix(col, FG, line(col_d, stroke));
        float foot = fill(sd_box(q - vec2(0.0, -0.75), vec2(0.07, 0.25)));
        col = mix(col, mix(BG, RD, stripes(q, 9.0, 0.0)), foot);
    }
    // scale on the right with a marker on the ram
    vec2 s = p - vec2(1.35, 0.0);
    float tick = step(abs(s.y), 0.9) * step(0.0, s.x) *
                 step(s.x, mix(0.03, 0.07, step(fract(s.y * 5.0 + 0.5), 0.1)));
    float tk = abs(fract(s.y * 20.0 + 0.5) - 0.5) / 20.0;
    col = mix(col, FG, lines * max(line(s.x, stroke * 0.6) * step(abs(s.y), 0.9),
                                   tick * (1.0 - smoothstep(0.0, PX * 1.2, tk))));
    float mk = sd_seg(s, vec2(-0.06, hy), vec2(0.0, hy));
    col = mix(col, RD, fill(mk - 0.02));
    // flash line on contact
    col = mix(col, FG, impact * line(p.y - (base + wh * 2.0), stroke * 3.0) * step(abs(p.x), 1.0));
    return col;
}

// ---------------------------------------------------------------- gear
float gear_d(vec2 q, float R, float N, float h) {
    float a = atan(q.y, q.x);
    float t = abs(fract(a / TAU * N) - 0.5) * 2.0;        // 0 at a tooth's centre
    float tooth = 1.0 - smoothstep(0.4, 0.6, t);
    return length(q) - (R + h * tooth);
}

vec3 scene_gear(vec2 p, vec3 col) {
    vec2 c1 = vec2(-0.5, 0.08);
    float N1 = 16.0, R1 = 0.6, H = 0.07;
    float a1 = mech(mod(B * 2.0, N1), 0.3) * TAU / N1;   // wrapped: exact, precise
    vec2 dir = normalize(vec2(1.0, -0.35));
    float R2 = 0.36, N2 = 10.0;
    vec2 c2 = c1 + dir * (R1 + R2 + H);
    float a2 = -a1 * N1 / N2 + TAU / N2 * 0.5 + atan(dir.y, dir.x) * (1.0 + N1 / N2);

    // crosshairs through the centres
    float ch = max(line(p.y - c1.y, stroke * 0.5), line(p.x - c1.x, stroke * 0.5));
    ch = max(ch, line(p.x - c2.x, stroke * 0.5) * step(p.y, c2.y));
    col = mix(col, FG, ch * 0.45 * lines);

    // big gear: white outline, red web with black holes, white hub
    vec2 q = rot(-a1) * (p - c1);
    float g = gear_d(q, R1, N1, H);
    col = mix(col, BG, fill(g));
    col = mix(col, FG, line(g, stroke * 1.4));
    float web = length(q) - R1 * 0.82;
    float holes = 1e9;
    for (int i = 0; i < 6; i++) {
        vec2 hc = rot(TAU * float(i) / 6.0) * vec2(R1 * 0.5, 0.0);
        holes = min(holes, length(q - hc) - R1 * 0.13);
    }
    col = mix(col, RD, fill(max(web, -holes)));
    col = mix(col, FG, fill(length(q) - R1 * 0.12));
    col = mix(col, BG, fill(sd_box(q, vec2(R1 * 0.1, R1 * 0.025))));
    // small gear: solid white, black hub
    vec2 q2 = rot(-a2) * (p - c2);
    float g2 = gear_d(q2, R2, N2, H);
    col = mix(col, FG, fill(g2));
    col = mix(col, BG, fill(length(q2) - R2 * 0.3));
    col = mix(col, RD, fill(length(q2) - R2 * 0.12));
    // rotation marks around the big gear
    float ring = length(p - c1) - (R1 + 0.17);
    float ang = atan(p.y - c1.y, p.x - c1.x);
    float dash = step(0.5, fract(ang / TAU * 48.0));
    col = mix(col, FG, line(ring, stroke * 0.6) * dash * lines);

    // hazard band
    float band = step(p.y, -0.8);
    col = mix(col, mix(BG, RD, stripes(p, 4.5, mech(mod(B, 64.0), 0.25) * 0.5)), band);
    col = mix(col, FG, line(p.y + 0.8, stroke));
    return col;
}

// ---------------------------------------------------------------- conveyor
vec3 scene_conveyor(vec2 p, vec3 col) {
    float Lh = 0.34;
    float y0 = -0.85;
    float li = floor((p.y - y0) / Lh);
    float sx = mix(-aspect(), aspect(), fract(B / 4.0));   // scanner
    if (li >= 0.0 && li < 5.0) {
        float ly = (p.y - y0) - (li + 0.5) * Lh;
        float dir = mod(li, 2.0) < 0.5 ? 1.0 : -1.0;
        float rate = 1.0 + mod(li, 3.0) * 0.5;
        float cw = 0.42;
        float off = mech(mod(B * rate, 512.0), 0.3) * cw;   // wrapped for float precision
        float x = p.x + dir * off;
        float ci = floor(x / cw);
        float lx = x - (ci + 0.5) * cw;
        float hc = mod(ci, 97.0);
        float h = hash2(vec2(li, hc));
        float h2 = hash2(vec2(hc, li + 7.0));
        vec2 bs = vec2(0.06 + 0.11 * h2, Lh * (0.18 + 0.12 * h));
        float d = sd_box(vec2(lx, ly + Lh * 0.5 - bs.y - 0.03), bs);
        bool scanned = abs(p.x - sx) < 0.35 && abs(lx) < cw * 0.5;
        vec3 bc = h < 0.2 ? RD : FG;
        if (scanned && abs((ci + 0.5) * cw - dir * off - sx) < 0.2) bc = RD;
        if (h < 0.75) col = mix(col, bc, fill(d));
        else if (h < 0.9) col = mix(col, FG, line(d, stroke));
        // belt + rollers
        float belt = ly + Lh * 0.5 - 0.02;
        col = mix(col, FG, line(belt, stroke));
        float rx = fract(x / 0.07) * 0.07 - 0.035;
        col = mix(col, FG, line(length(vec2(rx, ly + Lh * 0.5 - 0.045)) - 0.012, stroke * 0.6) * lines);
    }
    // scanner
    col = mix(col, RD, line(p.x - sx, stroke * 2.0));
    col = mix(col, RD, 0.25 * exp(-abs(p.x - sx) * 30.0));
    return col;
}

// ---------------------------------------------------------------- hazard
vec3 scene_hazard(vec2 p, vec3 col) {
    // sparse hatch behind
    float hv = (p.x - p.y) * 10.0;
    float fw = fwidth(hv);
    col = mix(col, FG, 0.22 * lines * smoothstep(-fw, fw, abs(fract(hv) - 0.5) - 0.45));
    // crosshair target on the right
    vec2 t = p - vec2(1.05, 0.25);
    float tg = max(line(length(t) - 0.42, stroke), line(length(t) - 0.2, stroke * 0.7));
    tg = max(tg, line(t.x, stroke * 0.7) * step(length(t), 0.55));
    tg = max(tg, line(t.y, stroke * 0.7) * step(length(t), 0.55));
    col = mix(col, FG, tg);
    col = mix(col, RD, fill(length(t) - 0.06 * (1.0 + u_beat)));
    // chevrons stepping right, wrapping
    float shift = mech(mod(B, 256.0), 0.2) * 0.45;
    float span = 2.0 * aspect() + 0.9;
    float m = 0.0, edge = 0.0;
    for (int k = 0; k < 5; k++) {
        float x = mod(p.x - shift + float(k) * span / 5.0, span) - span * 0.5;
        vec2 q = vec2(x, p.y + 0.1);
        float d = sd_seg(vec2(q.x, abs(q.y)), vec2(-0.22, 0.5), vec2(0.18, 0.0)) - 0.11;
        m = max(m, fill(d));
        edge = max(edge, line(d, stroke));
    }
    col = mix(col, mix(BG, RD, stripes(p, 7.0, -mod(B, 64.0) * 0.25)), m);
    col = mix(col, FG, edge);
    // full red frame flash on the last beat of the bar
    float last = step(3.0, mod(floor(B), 4.0)) * exp(-fract(B) * 6.0);
    col = mix(col, RD, last * (1.0 - fill(sd_box(p, vec2(aspect() - 0.06, 0.94)))));
    return col;
}

// ---------------------------------------------------------------- overlay
vec3 overlay(vec2 p, vec3 col) {
    vec2 P = (p * vec2(1.0, -1.0) + vec2(aspect(), 1.0)) / PX;   // px from top-left
    vec2 R = vec2(2.0 * aspect(), 2.0) / PX;
    float s = u_scale;
    float m = 30.0 * s;
    // frame + corner brackets
    float fr = sd_box(P - R * 0.5, R * 0.5 - m) * PX;
    col = mix(col, FG, line(fr, stroke * 0.5) * 0.5);
    vec2 c = abs(P - R * 0.5) - (R * 0.5 - m);
    float br = max(step(-60.0 * s, c.x) * step(abs(c.y), 2.5 * s), step(-60.0 * s, c.y) * step(abs(c.x), 2.5 * s));
    col = mix(col, FG, br * step(c.x, 2.5 * s) * step(c.y, 2.5 * s));
    // 16 steps, top-left
    float st = floor(fract(B / 4.0) * 16.0);
    vec2 o = P - vec2(m + 24.0 * s, m + 24.0 * s);
    float cell = 16.0 * s;
    float i = floor(o.x / cell);
    if (i >= 0.0 && i < 16.0 && o.y >= 0.0 && o.y < 10.0 * s) {
        vec2 l = vec2(o.x - i * cell, o.y);
        bool in_box = l.x < 10.0 * s;
        bool edge = l.x < 1.5 * s || l.x > 8.5 * s || l.y < 1.5 * s || l.y > 8.5 * s;
        if (in_box && i == st) col = RD;
        else if (in_box && edge) col = mix(col, FG, mod(i, 4.0) < 0.5 ? 1.0 : 0.6);
    }
    // 4 beats, bottom-right
    float bt = mod(floor(B), 4.0);
    vec2 q = P - vec2(R.x - m - 24.0 * s - 4.0 * 34.0 * s, R.y - m - 24.0 * s - 22.0 * s);
    float j = floor(q.x / (34.0 * s));
    if (j >= 0.0 && j < 4.0 && q.y >= 0.0 && q.y < 22.0 * s && q.x - j * 34.0 * s < 26.0 * s)
        col = j <= bt ? (j == bt ? RD : FG) : col;
    return col;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    PX = 2.0 / u_world_resolution.y;
    B = u_beats;
    BG = invert ? vec3(0.94) : vec3(0.015);
    FG = invert ? vec3(0.015) : vec3(0.94);
    RD = red.rgb;

    vec2 p = to_centered(w);
    float kick = punch * max(u_hits.y, u_triggers.x);
    p += (vec2(hash(floor(u_time * 40.0)), hash(floor(u_time * 40.0) + 3.0)) - 0.5) * 0.06 * kick;

    float span = float(bars) * 4.0;
    int sc = scene == 0 ? int(mod(floor(B / span), 4.0)) : scene - 1;
    vec3 col = BG;
    if (sc == 0) col = scene_press(p, col);
    else if (sc == 1) col = scene_gear(p, col);
    else if (sc == 2) col = scene_conveyor(p, col);
    else col = scene_hazard(p, col);
    if (lines > 0.0) col = mix(col, overlay(p, col), lines);

    // cut flash at a scene change, pad 4 inverts
    float cut = scene == 0 ? step(fract(B / span) * span, 0.12) : 0.0;
    if (cut > 0.5 || u_triggers.w > 0.5) col = vec3(1.0) - col + (RD - (vec3(1.0) - RD)) * step(0.5, col.r - col.g);
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
