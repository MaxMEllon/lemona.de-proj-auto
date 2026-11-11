#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// Strips of the SYNTHETIC SENSE logo, driven by the step sequencer.
// in0: synthlogo_w.png from an Image node with fit = fit (letterboxed on black).
// Pads: 1 snaps the strips one step along (motion blurred, cascading),
//       2 re-rolls each strip's look (size: normal / double / giant, style: solid / inverted / outline),
//       3 stretches the letters (hit),
//       4 wipes in new words and re-cuts the strip widths.
// step1 / step2 / step4 take Counter nodes counting pads 1 / 2 / 4.

layout(set = 0, binding = 1) uniform NodeParams {
    float step1;    // 0..100000 = 0     pad 1 count: slide
    float step2;    // 0..100000 = 0     pad 2 count: looks
    float step4;    // 0..100000 = 0     pad 4 count: words + widths
    int   split;    // rows|columns = columns
    int   strips;   // 2..12 = 8         number of strips
    float fill;     // 0.3..1 = 0.86     text height within its strip
    float stride;   // 0..2 = 0.6        slide per step, in word widths
    float stagger;  // 0..1 = 0.4        cascade delay between strips
    float stretch;  // 0..4 = 1.5        pad 3: letters stretch out
    float gap;      // 0..2 = 0.3        space between repeats (text heights)
    float drift;    // -2..2 = 0         constant scroll
    float blur;     // 0..2 = 1          motion blur while sliding
    float variety;  // 0..1 = 0.7        how often strips go giant / double / outline
    float widths;   // 0..1 = 0          uneven strip widths (0 = six equal strips)
    float lines;    // 0..1 = 1          separators between strips
    vec4  fg;       // color = 1,1,1
    vec4  bg;       // color = 0,0,0
};

// word crops in the logo image (x0, y0, x1, y1): SYNTHETIC, SENSE, SENSE + bars
const vec4 CROP[3] = vec4[3](vec4(0.0, 0.0, 1.0, 0.5),
                             vec4(0.0, 0.5, 0.545, 1.0),
                             vec4(0.0, 0.5, 1.0, 1.0));
const float IMG_ASPECT = 2359.0 / 726.0;

// image uv -> texture uv for the letterboxed (fit) image
vec2 fit_uv(vec2 iuv) {
    float h = (u_resolution.x / IMG_ASPECT) / u_resolution.y;
    return vec2(iuv.x, 0.5 + (iuv.y - 0.5) * h);
}

float expo_out(float t) {
    t = clamp(t, 0.0, 1.0);
    return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

float weight(float i, float s) {
    return mix(1.0, 0.3 + 1.4 * hash21(vec2(i * 3.1, s + 0.5)), widths);
}

// The strip containing x (0..1 across the frame), widths gliding from step s0 to s1.
void strip_of(float x, float s0, float s1, float t, out float idx, out float lo, out float hi) {
    float w[12];
    float tot = 0.0;
    for (int i = 0; i < 12; i++) {
        if (i >= strips) break;
        w[i] = mix(weight(float(i), s0), weight(float(i), s1), t);
        tot += w[i];
    }
    float acc = 0.0;
    idx = float(strips - 1); lo = 0.0; hi = 1.0;
    for (int i = 0; i < 12; i++) {
        if (i >= strips) break;
        float wi = w[i] / tot;
        if (x < acc + wi || i == strips - 1) { idx = float(i); lo = acc; hi = acc + wi; return; }
        acc += wi;
    }
}

float ink_at(vec4 cr, float w, float period, float ta, float tb) {
    float lu = mod(ta, period) / w;
    if (tb < 0.0 || tb > 1.0 || lu > 1.0) return 0.0;
    vec4 t = texture(u_tex0, fit_uv(vec2(mix(cr.x, cr.z, lu), mix(cr.y, cr.w, tb))));
    return t.r * t.a;   // the logo's clear pixels are white with alpha 0
}

// One strip's picture. a: along (strip thicknesses), b: across (0..1), len: strip length.
vec3 strip_color(float idx, float a, float b, float len, float sw, float ss, float steps, float vel) {
    float dir = mod(idx, 2.0) == 0.0 ? 1.0 : -1.0;
    vec4 cr = CROP[int(mod(idx + sw, 3.0))];
    float w = (cr.z - cr.x) / (cr.w - cr.y) * IMG_ASPECT;
    float period = w + gap;

    // look of this strip, re-rolled by pad 2
    vec3 hl = vec3(hash21(vec2(idx, floor(ss) * 1.37 + 0.2)),
                   hash21(vec2(idx + 7.0, floor(ss) * 2.11)),
                   hash21(vec2(idx + 3.0, floor(ss) * 0.73 + 5.0)));
    bool rolled = ss > 0.5;
    float k = 1.0, big = 1.0;
    if (rolled && hl.x < variety * 0.25) big = 1.9;
    else if (rolled && hl.x < variety * 0.55) k = 2.0;
    bool inv = rolled && hl.y < 0.35;
    bool outline = rolled && !inv && hl.z < variety * 0.45;

    float line = min(floor(b * k), k - 1.0);
    float bb = b * k - line;
    float ldir = dir * (line > 0.5 ? -1.0 : 1.0);
    float ht = fill * big / k;                      // text height in strip thicknesses
    float tb = (bb - 0.5) / (fill * big) + 0.5;

    // pad 3: stretch along, around the middle
    float sx = 1.0 + stretch * pow(u_triggers.z, 2.0) * (0.5 + hash21(vec2(idx, 3.0)));
    float pos = (steps * stride * w + u_time * drift) * ldir + hash21(vec2(idx, line + 1.0)) * period;
    float mid = len * 0.5 / ht;
    float ta = (a / ht - mid) / sx + mid - pos;

    float ink;
    if (outline) {
        float e = 0.012;
        float c = ink_at(cr, w, period, ta, tb);
        float m = min(min(ink_at(cr, w, period, ta + e, tb), ink_at(cr, w, period, ta - e, tb)),
                      min(ink_at(cr, w, period, ta, tb + e * 3.0), ink_at(cr, w, period, ta, tb - e * 3.0)));
        ink = clamp((c - m) * 1.5, 0.0, 1.0);
    } else {
        // motion blur along the strip while it snaps
        float span = min(vel * stride * w, 0.5) * blur * ldir;
        float jit = hash21(gl_FragCoord.xy) / 8.0;   // dither the taps so the smear stays smooth
        ink = 0.0;
        for (int i = 0; i < 8; i++) ink += ink_at(cr, w, period, ta + span * ((float(i) + jit) / 8.0 - 0.5), tb);
        ink /= 8.0;
    }
    vec3 f = inv ? bg.rgb : fg.rgb;
    vec3 g = inv ? fg.rgb : bg.rgb;
    return mix(g, f, ink);
}

void main() {
    vec2 R = u_resolution;
    vec2 P = v_uv * R;
    bool cols = split == 1;
    float px = max(u_scale, 0.5);

    // pad 4: widths glide to a new cut
    float p4 = 1.0 - u_triggers.w;
    float e4 = step4 > 0.5 ? expo_out(p4) : 1.0;
    float idx, lo, hi;
    strip_of(cols ? v_uv.x : v_uv.y, step4 - 1.0, step4, e4, idx, lo, hi);
    float thpx = (hi - lo) * (cols ? R.x : R.y);
    float b = ((cols ? v_uv.x : v_uv.y) - lo) / (hi - lo);
    float len = (cols ? R.y : R.x) / thpx;
    float a = (cols ? R.y - P.y : P.x) / thpx;
    float dir = mod(idx, 2.0) == 0.0 ? 1.0 : -1.0;

    // pad 1: snap one step, strips cascading
    float sg = stagger * 0.75 / float(strips - 1);
    float p1 = clamp(((1.0 - u_triggers.x) - idx * sg) / (1.0 - float(strips - 1) * sg), 0.0, 1.0);
    float e1 = expo_out(p1);
    float steps = max(step1 - 1.0, 0.0) + (step1 > 0.5 ? e1 : 0.0);
    float vel = step1 > 0.5 ? (e1 - expo_out(p1 - 0.06)) * 3.0 : 0.0;

    // pad 4: a bar wipes the new words in
    float aa = dir > 0.0 ? a : len - a;
    float front = e4 * (len + 0.8) - 0.4;
    bool old = step4 > 0.5 && aa > front;
    vec3 col = strip_color(idx, a, b, len, old ? step4 - 1.0 : step4, step2, steps, vel);
    if (step4 > 0.5 && p4 < 0.999 && abs(aa - front) < 0.18) col = fg.rgb;

    // separators
    float d = min(b, 1.0 - b) * thpx;
    if (d < px && ((b < 0.5 && idx > 0.0) || (b > 0.5 && idx < float(strips - 1)))) col = mix(col, fg.rgb, lines);
    f_color = vec4(col, 1.0);
}
