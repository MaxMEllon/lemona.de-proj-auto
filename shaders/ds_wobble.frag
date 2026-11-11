#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Dubstep: a brick-walled growl waveform, fat and crushed into slanted blocks,
// breathing with a wobble whose rate changes every 2 beats. Half-time: kick on
// beat 1, snare on beat 3 slams the zoom, fires shards and tears the frame.
// Teeth bite in from top and bottom. Every `drop` bars the last bar is a build
// (wave pinched to a line, the shutter speeding up, jaws closing), then the drop.
// Black background, colors from the palette. Pad 1 / low hit = kick, pad 2 / mid
// hit = snare, on top of the clock's pattern.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   form;     // auto|wall|split|cone|stack = auto
    int   drop;     // 0..32 = 8         bars per build + drop (0 = never)
    float rate;     // 0.25..2 = 1       wobble speed
    float wobble;   // 0..1 = 1          wobble depth
    float crush;    // 0..1 = 0.85       waveform broken into blocks
    float shear;    // 0..1 = 0.5        slant of the blocks
    float jaws;     // 0..1 = 0.6        teeth
    float slam;     // 0..1 = 0.8        zoom and tearing on hits
    float split;    // 0..1 = 0.6        color fringes
    float low;      // 0..1 = 0.35       lowest palette position used
    float react;    // 0..1 = 1          pads and audio hits
};

const float TAU = 6.2831853;

float px, B, wob, kick, sn, impact, bld, envH, scrollT, barN;
int frm;

float H(float x) { return hash21(vec2(x, 3.7)); }
float pal(float t) { return mix(low, 1.0, clamp(t, 0.0, 1.0)); }

float waveHeight(float u) {
    float f = mix(2.0, 9.0, wob);
    float a = sin(u * f * 1.7 + scrollT);
    float w = abs(sin(u * f * 3.0 + 2.4 * a - scrollT * 1.3));
    w = mix(w, abs(sin(u * f * 11.0 + scrollT * 2.0)), 0.3 * wob);
    return envH * (0.25 + 0.75 * pow(w, 0.7));
}

vec3 growl(float u, float v, float scale) {
    // Slanted columns; a coarser crush on the slower wobbles.
    float dir = mod(barN, 2.0) * 2.0 - 1.0;
    u += v * shear * 1.2 * dir;
    float N = mix(60.0, mix(11.0, 5.0, H(floor(B / 2.0))), crush);
    float g = u * N;
    float ff = fract(g);
    float h = waveHeight((floor(g) + 0.5) / N) * scale;

    float a = abs(v);
    float body = 1.0 - smoothstep(-px, px, a - h);
    float t = a / max(h, 1e-3);

    // Ribs inside each block, black gaps between the blocks.
    float ribs = smoothstep(0.0, px * 2.0, fract(t * 4.0) / 4.0 * h - px * 2.0);
    float gap = crush > 0.02 ? step(0.05, ff) * step(ff, 0.95) : 1.0;
    float heat = (floor(pow(1.0 - t, 2.2) * 4.0) + 0.6) / 4.0 * (0.7 + 0.3 * wob) + 0.1 * kick;
    vec3 col = palette(pal(heat)) * ribs;

    // A hot rim along the top of each block.
    float rim = 1.0 - smoothstep(px * 4.0, px * 5.5, h - a);
    col = mix(col, palette(1.0), rim * body);
    return col * body * gap;
}

vec3 shards(vec2 p) {
    if (sn < 0.02) return vec3(0.0);
    float r = length(p);
    float a = atan(p.y, p.x) / TAU + 0.5;
    float seed = floor(B / 4.0);
    float seg = floor(a * 23.0 + H(seed) * 7.0);
    float on = step(0.55, H(seg + seed * 13.0));
    float reach = 0.25 + (1.0 - sn) * 2.2 + H(seg + 9.0) * 0.5;
    float front = smoothstep(reach - 0.14, reach - 0.14 + px * 2.0, r) * (1.0 - smoothstep(reach, reach + px * 2.0, r));
    return palette(pal(0.75)) * on * front;
}

vec3 hazard(vec2 p) {
    float s = (p.x + p.y) * 7.0 + floor(B) * 0.5;
    float l = 1.0 - smoothstep(0.03, 0.05, abs(fract(s) - 0.5));
    return palette(pal(0.1)) * l * (0.1 + 0.25 * kick);
}

vec3 teeth(vec2 p, vec3 under) {
    float T = jaws * (0.42 + 0.3 * wob) + kick * jaws * 0.12;
    T = mix(T, 1.02, pow(bld, 3.0));
    if (T < 0.005) return under;
    float side = p.y > 0.0 ? 0.0 : 0.5;
    float N = 1.5;
    float cellX = p.x * N + side;
    float tri = 1.0 - abs(fract(cellX) * 2.0 - 1.0);
    tri *= 0.55 + 0.45 * H(floor(cellX) + side * 40.0);
    float slope = 2.0 * N * T;
    float d = (abs(p.y) - (1.0 - T * tri)) / sqrt(1.0 + slope * slope);
    vec3 inside = vec3(0.0);
    vec3 c = mix(under, inside, smoothstep(-px, px, d));
    return mix(c, palette(pal(0.9)), 1.0 - smoothstep(px * 2.5, px * 4.0, abs(d)));
}

vec3 scene(vec2 p) {
    vec3 c = hazard(p) + shards(p);
    vec3 g;
    if (frm == 0) {
        g = growl(p.x, p.y, 1.0);
    } else if (frm == 1) {
        g = growl(p.y * 1.4 + 0.3, abs(p.x) - 0.0, 1.5);
    } else if (frm == 2) {
        float r = length(p);
        float u = abs(atan(p.y, p.x)) * 1.1;
        float core = 0.36 * (1.0 + 0.3 * kick);
        g = growl(u, r - core, 0.75);
        g *= smoothstep(core * 0.55, core * 0.55 + px * 2.0, r);
    } else {
        g = growl(p.x, abs(p.y) - 0.5, 0.55);
    }
    c = max(c, g);
    return teeth(p, c);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 p = to_centered(w);

    px = 2.0 / u_world_resolution.y;
    B = u_beats;
    barN = floor(B / 4.0);
    float pos4 = mod(B, 4.0);

    // Build and drop.
    float len = 4.0 * float(max(drop, 1));
    float pos = mod(B, len);
    bld = drop > 0 ? clamp((pos - (len - 4.0)) / 4.0, 0.0, 1.0) : 0.0;
    impact = drop > 0 ? exp(-pos * 3.0) : 0.0;
    float building = step(0.0001, bld);

    // The wobble: a new rate every 2 beats, with a gap before the 4 bars repeat.
    const float RATES[8] = float[8](1.0, 1.0, 2.0, 2.0, 1.0, 3.0, 4.0, 0.0);
    float slot = floor(B / 2.0);
    float r = RATES[int(mod(slot, 8.0))] * rate;
    float ph = fract((B - slot * 2.0) * r);
    float wv = r > 0.0 ? pow(0.5 + 0.5 * cos(TAU * ph), 1.3) : 0.04;
    wob = mix(0.6, wv, wobble);

    // Half-time drums from the clock, plus pads and hits.
    float ghost = mod(barN, 2.0) > 0.5 ? step(2.75, pos4) * exp(-(pos4 - 2.75) * 7.0) : 0.0;
    float ck = max(exp(-pos4 * 6.0), ghost) * (1.0 - building);
    float cs = step(2.0, pos4) * exp(-(pos4 - 2.0) * 3.5) * (1.0 - building);
    kick = max(ck, max(u_triggers.x, u_hits.y) * react);
    sn = max(cs, max(u_triggers.y, u_hits.z * 0.35) * react);

    envH = mix(0.2, 0.92, wob) * (1.0 + 0.2 * kick + 0.5 * impact);
    envH = mix(envH, 0.012, smoothstep(0.0, 0.75, bld));
    scrollT = B * 1.3 + wob * 2.0;

    frm = form > 0 ? form - 1 : int(float[8](0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 3.0, 2.0)[int(mod(floor(barN / 2.0), 8.0))]);
    if (bld > 0.0) frm = 0;

    // Slam, shake, tear.
    p /= 1.0 + slam * (0.1 * kick + 0.3 * sn * sn + 0.5 * impact * impact);
    p += (hash22(vec2(floor(u_time * 40.0))) - 0.5) * 0.05 * slam * max(kick, sn);
    float tear = step(0.45, max(sn, impact)) * slam;
    float band = floor(w.y * 16.0);
    p.x += (hash21(vec2(band, floor(B * 4.0))) - 0.5) * 0.7 * tear;

    float o = split * (0.001 + 0.0015 * wob + 0.012 * max(sn, max(kick * 0.3, impact)));
    vec3 col = vec3(scene(p + vec2(o, 0.0)).r, scene(p).g, scene(p - vec2(o, 0.0)).b);

    // The build's shutter speeds up: 8ths, 16ths, 32nds.
    if (bld > 0.0) {
        float s = bld < 0.5 ? 2.0 : (bld < 0.75 ? 4.0 : 8.0);
        col *= mix(1.0, step(0.5, fract(B * s)), smoothstep(0.0, 0.25, bld));
    }

    // The hits flash: the drop goes white, the snare to a palette negative.
    if (sn > 0.8) col = palette(1.0) * (1.0 - clamp(dot(col, vec3(0.4, 0.5, 0.3)) * 1.6, 0.0, 1.0));
    col = mix(col, vec3(1.0), step(0.6, impact) * (1.0 - building));

    f_color = vec4(col, 1.0);
}
