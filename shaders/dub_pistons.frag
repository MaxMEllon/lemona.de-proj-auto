#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Dubstep: a field of heavy pistons seen from above, slamming up and down with a
// wobble LFO whose rate changes every bar (1/4, 1/8, 1/8 triplet, 1/16). Each bar
// picks how the wub runs across the field: a diagonal sweep, rings from the
// centre, a checker seesaw or random cells. Beat 1: a shockwave lifts a ring of
// pistons. Beat 3 (halftime snare): everything slams up, the camera jolts, the
// frame tears into slices and flashes. Some beats stutter. White on black, for a
// palette node after it. Pads / hits: t1 or low = shockwave, t2 or mid = snare,
// t3 = stutter, t4 = invert.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float wobble;   // 0..1 = 0.85      LFO depth
    float bass;     // 0..2 = 1         low band adds wobble
    float height;   // 0.5..4 = 2.4     piston travel
    float gap;      // 0.02..0.4 = 0.12 space between pistons
    float snare;    // 0..1 = 0.8       beat-3 impact
    float stutter;  // 0..1 = 0.35      chance a beat stutters
    float tilt;     // 0..1 = 0.55      camera angle (0 = straight down)
    float grit;     // 0..1 = 0.35      grain and scan lines
};

const float TAU = 6.2831853;

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float hashc(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }

float g_Bq, g_wob, g_lph, g_rate, g_kick, g_kickAge, g_sn, g_hw;
int g_mode;
vec2 g_center;

float pistonHeight(vec2 c) {
    vec2 d = c + 0.5 - g_center;
    float pat;
    if (g_mode == 0) {          // diagonal sweep, one ridge per LFO cycle
        pat = 0.5 + 0.5 * cos((c.x + c.y) * 0.35 - g_lph * TAU);
    } else if (g_mode == 1) {   // rings running out of the centre
        pat = 0.5 + 0.5 * cos(length(d) * 0.7 - g_lph * TAU);
    } else if (g_mode == 2) {   // checker seesaw
        float ch = mod(c.x + c.y, 2.0);
        pat = ch < 1.0 ? g_wob : 1.0 - g_wob;
    } else {                    // random cells, re-rolled every LFO cycle
        pat = step(0.55, hashc(c + floor(g_Bq * g_rate) * 7.31));
    }
    float h = 0.12 + height * pat * mix(0.25, 1.0, g_wob) * (0.8 + 0.4 * hashc(c * 1.7));
    // kick shockwave: a ring of pistons punched up
    float r = length(d);
    float ring = exp(-pow((r - g_kickAge * 14.0) * 0.9, 2.0)) * g_kick;
    h += ring * height * 0.9;
    // snare: everything slams up
    h += g_sn * height * 0.6;
    return h;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Distance to the piston in p's own cell (and the floor), plus that cell's height.
float map(vec3 p, out float h, out vec2 cell) {
    cell = floor(p.xz);
    h = pistonHeight(cell);
    vec2 l = p.xz - cell - 0.5;
    float d = sdBox(vec3(l.x, p.y - h * 0.5, l.y), vec3(g_hw, h * 0.5, g_hw) - 0.02) - 0.02;
    return min(d, p.y);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    // ---- beat clock, with stutter: some beats loop their first 1/16
    float B = u_beats;
    float beat_i = floor(B);
    float stut = max(step(1.0 - stutter * 0.5, hash1(beat_i * 1.31)), step(0.5, u_triggers.z));
    float Bq = mix(B, beat_i + fract(fract(B) * 4.0) * 0.25, stut);
    float bar = floor(Bq / 4.0);
    float inbar = Bq - bar * 4.0;

    // ---- wobble LFO: rate per bar, sharp attack and a rounder fall
    float rates[5] = float[5](1.0, 2.0, 3.0, 4.0, 2.0);
    g_rate = rates[int(mod(bar * 3.0 + floor(hash1(bar) * 2.0), 5.0))];
    g_lph = fract(Bq * g_rate);
    float lfo = pow(1.0 - g_lph, 2.0) * smoothstep(0.0, 0.05, g_lph);
    g_wob = clamp(lfo * wobble * (0.75 + bass * u_bands.y), 0.0, 1.0);
    g_mode = int(mod(bar + floor(hash1(bar * 0.77) * 3.0), 4.0));
    g_Bq = Bq;
    g_hw = 0.5 - gap * 0.5;

    // ---- hits
    g_kickAge = inbar;
    g_kick = exp(-inbar * 2.5);
    float pad = max(u_hits.y, u_triggers.x);
    if (pad > g_kick) { g_kick = pad; g_kickAge = (1.0 - pad) * 0.6; }
    float since3 = inbar - 2.0;
    float sn = since3 >= 0.0 ? exp(-since3 * 5.0) : 0.0;
    g_sn = max(sn, max(u_hits.z, u_triggers.y)) * snare;

    // ---- screen: snare tears the frame into slices
    vec2 p = to_centered(w);
    float slice = floor(p.y * 9.0 + hash1(floor(u_beats * 2.0)) * 9.0);
    p.x += (hash1(slice + beat_i) - 0.5) * 0.4 * g_sn * step(0.4, hash1(slice * 2.7 + beat_i));

    // ---- camera: drifts forward at halftime, jolts on the snare
    float travel = Bq * 0.5;
    vec3 ta = vec3(sin(Bq * 0.05) * 3.0, 0.0, travel);
    g_center = ta.xz;
    float ang = Bq * 0.03;
    float dist = 11.0 - g_sn * 2.5 - g_wob * 0.6;
    float el = mix(1.45, 0.6, tilt);
    vec3 ro = ta + vec3(sin(ang) * cos(el), sin(el), -cos(ang) * cos(el)) * dist;
    ro.xz += (vec2(hash1(floor(u_time * 30.0)), hash1(floor(u_time * 30.0) + 5.0)) - 0.5) * 0.5 * g_sn;
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(fw * 1.6 + rt * p.x + up * p.y);

    // ---- march: never step past the current cell's walls
    float t = 0.0, h = 0.0;
    vec2 cell = vec2(0.0);
    bool hit = false;
    for (int i = 0; i < 160; i++) {
        vec3 q = ro + rd * t;
        float d = map(q, h, cell);
        if (d < 0.002 * t) { hit = true; break; }
        vec2 nb = vec2(rd.x > 0.0 ? cell.x + 1.0 : cell.x, rd.z > 0.0 ? cell.y + 1.0 : cell.y);
        vec2 tb = (nb - q.xz) / vec2(abs(rd.x) > 1e-5 ? rd.x : 1e-5, abs(rd.z) > 1e-5 ? rd.z : 1e-5);
        float tc = max(min(tb.x, tb.y), 0.0) + 0.01;
        t += min(d, tc);
        if (t > 60.0 || q.y > height * 3.0 + 4.0 && rd.y > 0.0) break;
    }

    float v = 0.0;
    if (hit) {
        vec3 q = ro + rd * t;
        vec2 l = q.xz - cell - 0.5;
        float edge = 0.0;
        if (q.y < 0.01) {
            // floor: dark, with seams
            float s = max(abs(l.x), abs(l.y));
            v = 0.04 + 0.05 * smoothstep(0.48, 0.5, s);
        } else if (q.y > h - 0.03) {
            // top face: bright, taller = brighter, rim line
            float s = max(abs(l.x), abs(l.y)) / g_hw;
            float hn = clamp(h / (height * 1.2), 0.0, 1.0);
            v = mix(0.1, 1.0, pow(hn, 1.3));
            float fw2 = fwidth(s) * 1.5 + 0.01;
            edge = smoothstep(0.86 - fw2, 0.86, s) * (1.0 - smoothstep(0.93, 0.93 + fw2, s));
            v = max(v * (1.0 - 0.6 * edge), edge);
        } else {
            // sides: lit from one side, banded like machined metal
            vec3 n = abs(l.x) > abs(l.y) ? vec3(sign(l.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(l.y));
            float lit = 0.12 + 0.35 * max(dot(n, normalize(vec3(0.6, 0.0, -0.8))), 0.0);
            float band = step(0.5, fract(q.y * 3.0));
            v = lit * (0.75 + 0.25 * band);
            // height ticks near the top
            v += 0.5 * smoothstep(0.18, 0.0, h - q.y) * step(0.5, fract(q.y * 12.0));
        }
        v *= exp(-max(t - 8.0, 0.0) * 0.07);
    }

    // ---- grain, scan lines, snare flash
    v += (hashc(floor(w * u_world_resolution.y * 0.5) + floor(u_time * 24.0)) - 0.5) * 0.12 * grit;
    v *= 1.0 - 0.25 * grit * step(0.5, fract(w.y * u_world_resolution.y * 0.25));
    v = mix(v, 1.0 - v, step(0.6, g_sn) * step(since3, 0.06) * step(0.0, since3));
    if (u_triggers.w > 0.5) v = 1.0 - v;
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
