#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: op-art moiré. Concentric rings XOR'd with a field of parallel
// lines; their interference throws huge ghost shapes. The ring centre jumps
// to a new spot on every beat (gliding there), the lines turn the other way
// every bar, kick (pad 1 / low hit) tightens the ring pitch, accent (pad 4)
// inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float rings;     // 10..200 = 70     ring frequency
    float lines;     // 10..200 = 64     line frequency
    float turn;      // 0..40 = 8        line rotation per beat (degrees)
    float wander;    // 0..1 = 0.35      how far the centre jumps
    float glide;     // 0..1 = 0.3       fraction of a beat spent gliding
    bool  invert;    // = false
};

vec2 spot(float i) {
    float h = mod(i, 61.0);
    return (vec2(hash21(vec2(h, 0.3)), hash21(vec2(h, 7.1))) - 0.5) * 2.0 * wander * vec2(aspect(), 1.0);
}

float band(float x) {
    float w = fwidth(x);
    return smoothstep(-w, w, sin(x * 3.14159265) * 0.5) ;
}

void main() {
    vec2 p = to_centered(v_uv);
    float b = floor(u_beats);
    float k = smoothstep(0.0, max(glide, 0.01), fract(u_beats));
    vec2 c = mix(spot(b), spot(b + 1.0), k);

    float kick = max(u_triggers.x, u_hits.y);
    float rf = rings * (1.0 + kick * 0.25);
    float r = length(p - c) * rf * 0.5;
    float a = band(r);

    float bar = floor(u_beats / 4.0);
    float dir = mod(bar, 2.0) * 2.0 - 1.0;
    float ang = (b + k) * turn * dir;
    vec2 q = rotate_deg(p, ang);
    float l = band(q.x * lines * 0.5);

    float v = abs(a - l);   // XOR
    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(v), 1.0);
}
