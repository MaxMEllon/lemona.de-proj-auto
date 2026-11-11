#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Techno, black & white: an endless corridor of square frames. The camera
// lurches forward one frame per beat; every bar the corridor snaps round by
// 45°. Kick (pad 1 / low hit) fills the frame being passed, snare (pad 2 /
// mid hit) lights the corner rails, hats (pad 3 / high hit) strobe slats in
// the walls, accent (pad 4) inverts the frame.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float lurch;     // 0..1 = 0.7       how much of each beat's move happens on the hit
    float line;      // 0.5..12 = 2.5    frame line width (px)
    float depth;     // 0.5..16 = 5       how far frames stay visible
    float twist;     // 0..90 = 45       rotation snap per bar (degrees)
    float slats;     // 0..1 = 0.6       hat slat density
    float grain;     // 0..0.3 = 0.06    film grain
    bool  invert;    // = false          white background
};

const float FOCAL = 1.0;

float px() { return u_scale * 1.0 / u_resolution.y * 2.0; }

void main() {
    vec2 p = to_centered(v_uv);

    float kick  = max(u_triggers.x, u_hits.y);
    float snare = max(u_triggers.y, u_hits.z);
    float hat   = max(u_triggers.z, u_hits.w);
    float acc   = u_triggers.w;

    // Kick zoom punch + slight shake.
    p /= 1.0 + 0.06 * pow(kick, 3.0);
    p += (hash22(vec2(floor(u_time * 30.0))) - 0.5) * 0.015 * pow(kick, 4.0);

    // Bar-synced rotation snap.
    float bars = u_beats / 4.0;
    float turn = floor(bars) + smoothstep(0.0, 0.12, fract(bars));
    p = rotate_deg(p, turn * twist);

    // Camera: mostly-stepped movement, one frame per beat.
    float b = u_beats;
    float ease = 1.0 - pow(1.0 - smoothstep(0.0, 0.35, fract(b)), 3.0);
    float cam = floor(b) + mix(fract(b), ease, lurch);

    // Square (Chebyshev) radius → depth of the frame wall at this pixel.
    float d = max(abs(p.x), abs(p.y));
    float z = FOCAL / max(d, 1e-4);          // depth in front of the camera
    float k = cam + z;                       // world frame coordinate
    float id = floor(k + 0.5);

    // Screen-space line width: dk/dpixel = z/d.
    float w = line * px() * z / d;
    float dist = abs(k - id);
    float fade = exp(-z / depth);
    float big = mod(id, 4.0) == 0.0 ? 2.2 : 1.0;
    float frame = (1.0 - smoothstep(0.5 * w * big, 0.5 * w * big + w * 0.5, dist)) * fade;

    // Corner rails (snare): the four diagonals.
    float diag = abs(abs(p.x) - abs(p.y));
    float rail = (1.0 - smoothstep(0.0, line * px() * 1.5, diag)) * fade * (0.15 + 0.85 * snare);

    // Hat slats: thin lines along the walls, random per 16th.
    float along = (abs(p.x) > abs(p.y) ? p.y : p.x) / d;   // -1..1 along the wall
    float s16 = floor(u_beats * 4.0);
    float sl = floor((along * 0.5 + 0.5) * 48.0);
    float lit = step(1.0 - slats * hat, hash21(vec2(sl, s16)));
    float slat = lit * step(0.6, fract((along * 0.5 + 0.5) * 48.0)) * fade
               * step(fract(k), 0.5) * step(z, depth * 2.0);

    // Kick: fill the frame band just ahead of the camera.
    float near = smoothstep(0.5, 0.45, abs(z - 1.6)) * step(0.5, fract(k + 0.5));
    float fill = near * pow(kick, 2.0);

    float v = max(max(frame, rail), max(slat, fill));

    // Center vanishing dot pulses with the beat.
    v = max(v, smoothstep(0.012, 0.008, d) * (0.4 + 0.6 * u_beat));

    v = clamp(v + (hash21(v_uv * u_resolution + fract(u_time) * 97.0) - 0.5) * grain, 0.0, 1.0);

    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, acc));
    f_color = vec4(vec3(v), 1.0);
}
