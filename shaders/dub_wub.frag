#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Dubstep: a tunnel of thick squircle "speaker cones" crawling in at halftime,
// bent by a wobble LFO whose rate changes every bar (1/4, 1/8, 1/8 triplet,
// 1/16 — a bass "wub" pattern on the beat clock). The wobble fattens the
// rings, morphs them circle <-> square and chews their edges; the low band
// pushes it further. Beat 1: shockwave ring. Beat 3 (halftime snare): the
// frame punches out, slices tear sideways and it flashes. Some beats stutter
// (geometry repeats 1/16s). White on black, for a palette node after it.
// Pads / hits: t1 or low = shockwave, t2 or mid = snare hit, t3 = stutter,
// t4 = invert.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float wobble;   // 0..1 = 0.8       LFO depth
    float bass;     // 0..2 = 1         low band adds wobble
    int   rings;    // 3..16 = 9
    float weight;   // 0.1..1 = 0.45    ring thickness
    float snare;    // 0..1 = 0.8       beat-3 impact
    float stutter;  // 0..1 = 0.35      chance a beat stutters
    float grit;     // 0..1 = 0.4       teeth on the ring edges, grain
};

float hash1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float px = 2.0 / u_world_resolution.y;

    // ---- beat clock, with stutter: some beats loop their first 1/16
    float B = u_beats;
    float beat_i = floor(B);
    float stut = max(step(1.0 - stutter * 0.5, hash1(beat_i * 1.31)), step(0.5, u_triggers.z));
    float Bq = mix(B, beat_i + fract(fract(B) * 4.0) * 0.25, stut);
    float bar = floor(Bq / 4.0);
    float inbar = Bq - bar * 4.0;                       // 0..4

    // ---- wobble LFO: rate per bar, sharp attack and a rounder fall
    float rates[5] = float[5](2.0, 3.0, 4.0, 1.0, 6.0);
    float rate = rates[int(mod(bar * 3.0 + floor(hash1(bar) * 2.0), 5.0))];
    float lph = fract(Bq * rate);
    float lfo = pow(1.0 - lph, 2.2) * smoothstep(0.0, 0.04, lph);
    float wob = lfo * wobble * (0.75 + bass * u_bands.y);

    // ---- hits
    float kick = max(exp(-inbar * 7.0), max(u_hits.y, u_triggers.x));        // beat 1
    float since3 = inbar - 2.0;
    float sn = since3 >= 0.0 ? exp(-since3 * 5.0) : 0.0;                       // beat 3
    sn = max(sn, max(u_hits.z, u_triggers.y)) * snare;

    vec2 p = to_centered(w);
    // snare: punch out + slices torn sideways
    p *= 1.0 + 0.35 * sn;
    float slice = floor(p.y * 9.0 + hash1(floor(u_beats * 2.0)) * 9.0);
    p.x += (hash1(slice + beat_i) - 0.5) * 0.5 * sn * step(0.35, hash1(slice * 2.7 + beat_i));
    // the wub shoves the whole frame down and squashes it a little
    p.y += wob * 0.06;
    p *= vec2(1.0 + wob * 0.12, 1.0 - wob * 0.08);

    // ---- squircle tunnel crawling in at halftime
    float k = mix(2.0, 9.0, clamp(wob * 1.2, 0.0, 1.0));       // circle -> square
    vec2 a = abs(p);
    float rr = pow(pow(a.x, k) + pow(a.y, k), 1.0 / k);
    float ang = atan(p.y, p.x);
    // chewed edges: teeth around the ring, louder with the wobble
    vec2 dir = vec2(cos(ang), sin(ang));                     // seamless around the ring
    float teeth = (noise2(dir * 6.0 + vec2(Bq * 2.0, 0.0)) - 0.5) * grit * (0.15 + wob * 0.6);
    float depth = log(max(rr + teeth * rr, 1e-3));
    float crawl = Bq * 0.5 * 0.35;                              // halftime
    float n = float(rings);
    float x = (depth * 1.4 + crawl) * n / 4.0;
    float f = fract(x);
    float idx = floor(x);
    float th = weight * (0.55 + 0.8 * wob) * (0.7 + 0.3 * hash1(idx));
    float edge = fwidth(x) * 1.2;
    float ring = smoothstep(0.5 - th * 0.5 - edge, 0.5 - th * 0.5, f)
               * (1.0 - smoothstep(0.5 + th * 0.5, 0.5 + th * 0.5 + edge, f));
    // dark core and far fade
    ring *= smoothstep(0.06, 0.25, rr) * (0.35 + 0.65 * smoothstep(0.0, 1.4, rr));
    // every other ring: hollow outline only
    if (mod(idx, 3.0) < 1.0) {
        float ti = th * 0.5 - max(edge * 3.0, 0.04);
        float inner = smoothstep(0.5 - ti - edge, 0.5 - ti, f)
                    * (1.0 - smoothstep(0.5 + ti, 0.5 + ti + edge, f));
        ring = max(ring - inner, 0.0);
    }

    // ---- shockwave on the kick
    float sw = 1.0 - smoothstep(0.0, 0.012 + 0.03 * kick, abs(rr - (1.0 - kick) * 1.8));
    float v = max(ring, sw * kick);

    // ---- grain, scan bands
    v += (hash21(floor(p * u_world_resolution.y * 0.5) + floor(u_time * 24.0)) - 0.5) * 0.12 * grit;
    v *= 0.85 + 0.15 * step(0.5, fract(w.y * u_world_resolution.y * 0.25));
    // snare flash
    v = mix(v, 1.0 - v, step(0.6, sn) * step(since3, 0.06));
    if (u_triggers.w > 0.5) v = 1.0 - v;
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
