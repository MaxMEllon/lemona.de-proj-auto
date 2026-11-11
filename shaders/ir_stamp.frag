#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Turns ir_press into the final picture, in black, white and one red, and only those.
// Adds hazard stripes, a stencilled unit number (in1: the Text node), sparks and
// film grain. Kick (pad 1): sparks and a white hit. Snare (pad 2): the frame goes
// red. Hats (pad 3): ticks. Accent (pad 4): a block of the frame flips to negative.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   every;    // 1..32 = 8        beats per layout
    float contrast; // 0.5..3 = 1.2     harder blacks
    float flood;    // 0..1 = 0.75      how far the snare turns the frame red
    float hit;      // 0..1 = 0.3       white hit on the kick
    float negative; // 0..1 = 1         accent flipping a block
    float hazard;   // 0..1 = 1         hazard stripes
    float type_ink; // 0..1 = 1         the stencilled number
    float sparks;   // 0..2 = 1
    float grain;    // 0..0.3 = 0.06
    vec4  red;      // color = 0.95,0.03,0.04
};

void main() {
    vec2 w = world_uv(v_uv);
    float asp = aspect();
    float seed = floor(u_beats / float(every));
    float kick = u_triggers.x;
    float snare = u_triggers.y;
    float hats = u_triggers.z;
    float accent = u_triggers.w;

    // Tearing on the kick: a few rows jump sideways.
    float row = floor(w.y * 24.0);
    float tear = step(0.82, hash21(vec2(row, floor(u_beats * 8.0)))) * kick * kick;
    vec2 sw = w + vec2((hash21(vec2(row, seed)) - 0.5) * 0.09 * tear, 0.0);
    vec3 f = sample_world(u_tex0, sw).rgb;

    float l = pow(clamp(f.r + f.b, 0.0, 1.0), contrast) + f.b * 0.5;
    float r = clamp(pow(clamp(f.g, 0.0, 1.0), 1.15), 0.0, 1.0);

    // Hazard bands: top and bottom, or down the sides, by layout.
    float hk = hash21(vec2(seed, 7.0));
    float dirn = hash21(vec2(seed, 9.0)) > 0.5 ? 1.0 : -1.0;
    float thick = 0.055 + 0.03 * snare * snare;
    float bx = (hk > 0.5 ? min(w.y, 1.0 - w.y) : min(w.x, 1.0 - w.x) * asp);
    float show = hk > 0.18 ? 1.0 : 0.0;
    if (bx < thick && show > 0.5 && hazard > 0.01) {
        float stripe = step(0.5, fract((w.x * asp + w.y * dirn) * 9.0 + floor(u_beats * 2.0) * 0.25 * dirn));
        bool red_band = mod(floor(u_beats / 4.0), 2.0) < 0.5;
        l = mix(l, red_band ? 0.0 : stripe * 0.95, hazard);
        r = mix(r, red_band ? stripe : 0.0, hazard);
    }

    // The number: stencilled (bridges cut through it) on a red plate or bare.
    float pat = hash21(vec2(seed, 11.0));
    vec2 tcen = vec2(0.32 + 0.36 * hash21(vec2(seed, 13.0)), 0.22 + 0.56 * hash21(vec2(seed, 15.0)));
    vec2 tuv = w - tcen + 0.5;
    float t = sample_world(u_tex1, tuv).r * type_ink;
    t *= step(0.005, abs(w.y - tcen.y));
    // On for the first three beats of four: blinks like a sign.
    t *= step(fract(u_beats / 4.0), 0.78);
    vec2 pd = abs(w - tcen) * vec2(asp, 1.0);
    float plate = step(max(pd.x - 0.5, pd.y - 0.11), 0.0) * step(pat, 0.3) * step(0.01, type_ink);
    plate *= step(fract(u_beats / 4.0), 0.78);
    if (plate > 0.5) { l = 0.0; r = 1.0 - t; }
    else             { l = max(l, t); r *= 1.0 - t; }

    // Ticks along the edge, walking on 16ths, lit by the hats.
    float tick_x = floor(w.x * 64.0);
    float cur = mod(floor(u_beats * 4.0), 64.0);
    if (w.y > 0.965 && w.y < 0.985 && fract(w.x * 64.0) < 0.35) {
        float on = tick_x == cur ? 1.0 : 0.16 + 0.6 * hats * step(0.65, hash21(vec2(tick_x, floor(u_beats * 4.0))));
        l = max(l, on);
    }

    // Sparks thrown up by the kick, falling back.
    float age = 1.0 - kick;
    if (kick > 0.02 && sparks > 0.0) {
        vec2 g = vec2(w.x * asp * 34.0, w.y * 1.0);
        float cx = floor(g.x);
        float h1 = hash21(vec2(cx, floor(u_beats) + 1.0));
        if (h1 > 0.82) {
            float h2 = hash21(vec2(cx, 37.0));
            float y = 0.98 - (0.15 + 0.8 * h2) * sin(age * 3.14159 * 0.8) + 0.25 * age * age;
            float len = 0.012 + 0.05 * (1.0 - age);
            float dy = abs(w.y - y);
            float dx = abs(fract(g.x) - 0.5);
            float s = smoothstep(len, 0.0, dy) * smoothstep(0.12, 0.03, dx) * kick * sparks;
            if (h2 > 0.55) l += s * 1.5; else r += s * 1.5;
        }
    }

    // Hits: the light slams up, the blacks stay black.
    l *= 1.0 + pow(kick, 3.0) * hit * 4.0;

    // Snare: only the red is left.
    float sn = snare * snare * flood;
    r = max(r * (1.0 - sn), (l + r * 0.5 + 0.12) * sn);
    l *= 1.0 - sn;

    // Accent: a block of the frame flips to negative.
    if (accent > 0.15 && negative > 0.01) {
        vec2 hb = hash22(vec2(floor(u_beats), 19.0));
        vec2 c = hb;
        vec2 bs = vec2(0.14 + 0.3 * hb.y, 0.12 + 0.35 * hb.x);
        if (abs(w.x - c.x) < bs.x && abs(w.y - c.y) < bs.y)
            l = mix(l, 1.0 - clamp(l + r, 0.0, 1.0), negative);
    }

    // Film: grain on the signal and a gate that isn't quite still.
    float gr = hash21(v_uv * u_resolution + fract(u_time) * 73.0) - 0.5;
    l += gr * grain * (0.3 + l);
    r += gr * grain * (0.2 + r);
    float vg = 1.0 - 0.55 * smoothstep(0.1, 0.55, dot(w - 0.5, w - 0.5));
    l *= vg;
    r *= vg;

    // Red pushes the white out, so the two never mix into pink.
    l *= 1.0 - smoothstep(0.02, 0.35, r);
    vec3 col = vec3(clamp(l, 0.0, 1.0)) + red.rgb * clamp(r, 0.0, 1.0);
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
