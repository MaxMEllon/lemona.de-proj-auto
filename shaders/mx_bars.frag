#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: a barcode of random-width black/white bars. It lurches
// sideways on every beat and snaps 90° every bar; snare (pad 2 / mid hit)
// re-shuffles the code, hats (high hit) slice it with thin scan gaps.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float bars;      // 8..160 = 48      bars across
    float lurch;     // 0..1 = 0.8       how snappy each beat's move is
    float travel;    // 0..1 = 0.25      distance moved per beat (frame widths)
    float fill;      // 0..1 = 0.45      white fraction
    bool  rotate;    // = true           90° snap every bar
    bool  invert;    // = false
};

void main() {
    vec2 p = to_centered(v_uv);
    float bar = floor(u_beats / 4.0);
    if (rotate) p = rotate_deg(p, 90.0 * mod(bar, 2.0) + (mod(bar, 4.0) >= 2.0 ? 45.0 : 0.0));

    float b = floor(u_beats);
    float k = b + mix(fract(u_beats), smoothstep(0.0, 0.25, fract(u_beats)), lurch);
    float x = p.x + k * travel * 2.0 * (mod(bar, 2.0) * 2.0 - 1.0);

    float shuffle = mod(floor(u_beats * 2.0 + u_triggers.y * 3.0), 53.0);
    float u = x * bars * 0.5;
    float id = floor(u);
    // Random widths: merge neighbours by hashing pairs.
    float w = hash21(vec2(floor(id / 3.0), shuffle));
    float v = step(1.0 - fill, hash21(vec2(id, floor(shuffle / 2.0) + w)));

    // Hat slices.
    float hats = max(u_hits.w, u_triggers.z);
    float slice = step(0.9, fract(p.y * 40.0 + u_time * 3.0)) * hats;
    v *= 1.0 - slice;

    v += max(u_hits.y, u_triggers.x) * 0.15;
    if (invert) v = 1.0 - v;
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
