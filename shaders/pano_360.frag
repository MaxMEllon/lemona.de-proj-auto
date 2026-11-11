#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// A black & white wall for a 360° display: the left and right edges meet.
// Every band is periodic in x (one turn = the frame width), so the picture
// can rotate forever without a seam. in0: synthlogo_w.png (Image node, fit = fit).
// in1: an Audio FFT node in spectrogram mode; the centre band draws the real
// audio's amplitude from it, written round the ring by a moving head.

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // -0.2..0.2 = 0.01   constant rotation (turns per second)
    float snap;      // 0..180 = 45        degrees turned on each step
    int   every;     // 1..16 = 4          beats per step
    float parallax;  // 0..2 = 1           bands turn at different speeds
    float sweep;     // 0..1 = 1           inverting scanner going round
    float spectrum;  // 0..3 = 1.2         audio band gain
    float react;     // 0..2 = 1           flashes on hits
    float grain;     // 0..0.2 = 0.04
    float memory;    // 1..30 = 8           seconds per turn: set equal to the Audio FFT node's history
    int   inv_band;  // off|sub|low|mid|high = low   whole-frame invert on this band's hits
    float inv_hold;  // 0.05..0.95 = 0.5    hit level the invert holds above (higher = shorter flash)
    float sweep_audio; // 0..1 = 1          scanner width follows the low band
    float ceiling_db;  // -24..0 = -3        level (dB, after AUDIO gain) drawn at the band's full height: the true peak
    float in_floor_db; // -100..-10 = -54    = AUDIO floor
    vec4  fg;        // color = 1,1,1
    vec4  bg;        // color = 0,0,0
};

const float TAU = 6.2831853;

// ---- logo ---------------------------------------------------------------
const vec4 CROP[2] = vec4[2](vec4(0.0, 0.0, 1.0, 0.5),    // SYNTHETIC
                             vec4(0.0, 0.5, 1.0, 1.0));   // SENSE + bars
const float IMG_ASPECT = 2359.0 / 726.0;

float logo(int word, float lu, float tb) {
    if (lu < 0.0 || lu > 1.0 || tb < 0.0 || tb > 1.0) return 0.0;
    vec4 cr = CROP[word];
    vec2 iuv = vec2(mix(cr.x, cr.z, lu), mix(cr.y, cr.w, tb));
    float h = (u_resolution.x / IMG_ASPECT) / u_resolution.y;   // letterboxed (fit) image
    vec4 t = texture(u_tex0, vec2(iuv.x, 0.5 + (iuv.y - 0.5) * h));
    return t.r * t.a;   // the logo's clear pixels are white with alpha 0
}

// ---- 3x5 digits ---------------------------------------------------------
const int FONT[10] = int[10](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695);

float number3(vec2 P, float s, int v) {   // P: px from the label's top-left
    vec2 c = floor(P / s);
    if (c.x < 0.0 || c.y < 0.0 || c.y > 4.0 || c.x >= 12.0) return 0.0;
    int ci = int(c.x) / 4;
    int col = int(c.x) - ci * 4;
    if (col == 3) return 0.0;
    int p = ci == 0 ? 100 : (ci == 1 ? 10 : 1);
    int g = (v / p) % 10;
    return float((FONT[g] >> ((4 - int(c.y)) * 3 + (2 - col))) & 1);
}

float expo_out(float t) {
    t = clamp(t, 0.0, 1.0);
    return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

// wrap-safe distance between two positions on the ring (in turns)
float ring_d(float a, float b) { return abs(fract(a - b + 0.5) - 0.5); }

// ---- bands --------------------------------------------------------------
// u: 0..1 around the ring, yl: 0..1 down the band, H: band height px

float ruler(float u, float yl, float H, bool flip) {
    float px = u_resolution.x;            // px per turn
    float s = 2.0 * max(u_scale, 0.5);
    float yy = flip ? 1.0 - yl : yl;      // 0 at the band's outer edge
    float d = u * 360.0;
    float ink = 0.0;
    float dd = abs(fract(d + 0.5) - 0.5) / 360.0 * px;   // px to the nearest degree
    float len = mod(round(d), 15.0) == 0.0 ? 0.75 : (mod(round(d), 5.0) == 0.0 ? 0.45 : 0.22);
    if (dd < 0.6 * max(u_scale, 0.5) && yy < len) ink = 1.0;
    // labels every 15°
    float dl = round(d / 15.0) * 15.0;
    float du = (fract(u - dl / 360.0 + 0.5) - 0.5) * px;   // px right of that tick
    float ly = yy * H - (H * 0.75 - 6.0 * s);
    ink = max(ink, number3(vec2(du - 3.0 * s, flip ? 5.0 * s - ly : ly), s, int(mod(dl, 360.0))));
    return ink;
}

float ticker(float u, float yl, float H, int word, float n_hint) {
    float fill = 0.84;
    float th = H * fill;
    float wpx = th * IMG_ASPECT * (CROP[word].z - CROP[word].x) / (CROP[word].w - CROP[word].y);
    float n = max(1.0, floor(u_resolution.x / (wpx + th * 0.35)));   // whole repeats per turn
    float local = fract(u * n) * u_resolution.x / n;
    return logo(word, local / wpx, (yl - (1.0 - fill) * 0.5) / fill);
}

float barcode(float u, float yl) {
    float a = hash21(vec2(floor(u * 240.0), 7.0));
    float b = hash21(vec2(floor(u * 960.0), 3.0));
    float bars = step(0.55, a) * step(0.25, fract(u * 240.0)) + step(0.8, b);
    float edge = step(abs(yl - 0.5), 0.45);
    return clamp(bars, 0.0, 1.0) * edge;
}

// A spectrogram pixel (0..1 = AUDIO floor..0 dB) as a linear amplitude like a
// DAW waveform: ceiling_db at full height, -6 dB below it at half.
float db_height(float e) {
    if (e <= 0.0) return 0.0;
    float db = mix(in_floor_db, 0.0, e);
    return clamp(pow(10.0, (db - ceiling_db) / 20.0), 0.0, 1.0);
}

// Loudness `age` ago (0 = now .. 1 = oldest) from the spectrogram:
// x = peak across all bins, y = the low end (kicks and bass pump it).
vec2 loudness(float age) {
    float v = clamp(age, 0.5 / u_resolution.y, 1.0 - 0.5 / u_resolution.y);
    float pk = 0.0, lo = 0.0;
    for (int i = 0; i < 12; i++) {
        float x = (float(i) + 0.5) / 12.0;
        float e = texture(u_tex1, vec2(x * 0.85, v)).r;
        pk = max(pk, e);
        if (i < 4) lo += e * 0.25;
    }
    return vec2(db_height(pk), db_height(lo));
}

// The audio's amplitude round the ring: a head writes "now" as it goes round once
// every `memory` seconds; behind it the recorded waveform stays in place.
float wave_band(float u, float yl, float head) {
    float yc = abs(yl - 0.5) * 2.0;
    float axis = step(yc, 0.012);
    if (texture(u_tex1, vec2(0.5)).a < 0.5) {   // no spectrogram connected: plain spectrum
        float f = fract(u) * 128.0;
        float bi = floor(f);
        float v = clamp(fft(int(bi < 64.0 ? bi : 127.0 - bi)) * spectrum, 0.0, 1.0);
        return max(step(fract(f), 0.55) * step(yc, max(v, 0.015)), axis);
    }
    float age = fract(head - u);                 // turns since the head passed
    vec2 l = loudness(age);
    float peak = l.x * 0.95;
    float body = l.y * 0.95;
    float px = 1.0 / u_resolution.x;
    float hair = step(fract(u / (2.0 * px)), 0.5);   // peaks as hairlines, the body solid
    float ink = max(step(yc, body), step(yc, peak) * hair);
    // the head: a bright line with a notch
    float hd = abs(fract(u - head + 0.5) - 0.5) / px;
    if (hd < 1.0) ink = 1.0;
    if (hd < 6.0 && yc > 0.9) ink = 1.0;
    return max(ink, axis);
}

float dots(float u, float yl, float H) {
    float M = 192.0;
    float rows = 3.0;
    float ci = floor(u * M);
    float ri = floor(yl * rows);
    vec2 cell = vec2(fract(u * M), fract(yl * rows));
    vec2 asp = vec2(u_resolution.x / M, H / rows);
    float r = 0.5 * (0.5 + 0.5 * sin(TAU * ci / M * 6.0 - u_time * 2.0 + ri * 1.3));
    r *= 0.4 + 0.6 * u_level;
    vec2 d = (cell - 0.5) * asp;
    return step(length(d), r * min(asp.x, asp.y));
}

void main() {
    vec2 R = u_resolution;
    float y = v_uv.y;

    // rotation: a slow drift plus a snap every few beats
    float ph = fract(u_beats / float(every)) * float(every);
    float steps = floor(u_beats / float(every)) + expo_out(ph * 1.5);
    float rot = u_time * speed + steps * snap / 360.0;
    float pr = parallax;

    float ink = 0.0;
    float line_px = 1.0 / R.y;
    // band layout (top to bottom)
    if (y < 0.06) {
        ink = ruler(fract(v_uv.x + rot), y / 0.06, 0.06 * R.y, false);
    } else if (y >= 0.07 && y < 0.33) {
        ink = ticker(fract(v_uv.x + rot * (1.0 + 0.5 * pr)), (y - 0.07) / 0.26, 0.26 * R.y, 0, 1.0);
    } else if (y >= 0.345 && y < 0.405) {
        ink = barcode(fract(v_uv.x - rot * (1.0 + 1.5 * pr) - u_time * 0.02 * pr), (y - 0.345) / 0.06);
        ink = mix(ink, 1.0 - ink, step(0.5, u_hits.x * react));
    } else if (y >= 0.42 && y < 0.62) {
        ink = wave_band(fract(v_uv.x + rot * (1.0 - 0.5 * pr)), (y - 0.42) / 0.2, fract(u_time / memory));
    } else if (y >= 0.635 && y < 0.695) {
        ink = dots(fract(v_uv.x - rot * (1.0 + 0.8 * pr)), (y - 0.635) / 0.06, 0.06 * R.y);
    } else if (y >= 0.71 && y < 0.93) {
        // inverted band: black letters on white
        ink = 1.0 - ticker(fract(v_uv.x - rot * (1.0 + 0.5 * pr)), (y - 0.71) / 0.22, 0.22 * R.y, 1, 1.0);
    } else if (y >= 0.94) {
        ink = ruler(fract(v_uv.x + rot), (y - 0.94) / 0.06, 0.06 * R.y, true);
    }
    // hairlines between bands
    float edges[8] = float[8](0.065, 0.3375, 0.4125, 0.6275, 0.7025, 0.935, 0.0, 0.0);
    for (int i = 0; i < 6; i++) if (abs(y - edges[i]) < 0.5 * line_px * max(u_scale, 0.5)) ink = 1.0;

    // scanner going round once every 16 beats: an inverted window with a bright edge
    float sp = fract(u_beats / 16.0);
    float sd = ring_d(v_uv.x, sp) * R.x;
    float win = 0.05 * R.x;
    float sw = sweep * mix(1.0, 0.15 + 1.7 * u_bands.y + 1.2 * u_hits.y, sweep_audio);
    if (sw > 0.0) {
        if (sd < win * sw) ink = 1.0 - ink;
        if (abs(sd - win * sw) < 1.0 * max(u_scale, 0.5)) ink = 1.0;
    }

    // audio hits: whole-frame invert while the chosen band's hit is above inv_hold
    float hv = inv_band == 1 ? u_hits.x : inv_band == 2 ? u_hits.y : inv_band == 3 ? u_hits.z : inv_band == 4 ? u_hits.w : 0.0;
    float inv = step(inv_hold, hv * react);
    // pad 1: hard invert (manual override)
    inv = max(inv, step(0.5, u_triggers.x * react));
    ink = mix(ink, 1.0 - ink, inv);

    vec3 col = mix(bg.rgb, fg.rgb, ink);
    col += (hash21(gl_FragCoord.xy + fract(u_time * 7.0) * 311.0) - 0.5) * grain;
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
