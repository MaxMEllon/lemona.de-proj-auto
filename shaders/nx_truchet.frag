#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Neon: a circuit of Truchet tiles (quarter-circle arcs) with pulses of
// light running along the tracks in palette colours. A share of the tiles
// flips on every beat, kick (pad 1 / low hit) floods the tracks with light,
// hats (pad 3 / high hit) spark random tiles, snare (pad 2 / mid hit)
// reverses the flow. Chain into Bloom.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float tiles;     // 3..30 = 7        tiles across the height
    float width;     // 0.01..0.2 = 0.05 track width (tile units)
    float flips;     // 0..1 = 0.15      share of tiles flipping per beat
    float speed;     // 0..4 = 1         pulse speed
    float pulses;    // 0.25..4 = 0.5    pulses per arc
};

void main() {
    vec2 p = to_centered(v_uv) * tiles * 0.5;
    p = rotate_deg(p, 8.0 * sin(u_beats * 0.098));
    vec2 id = floor(p);
    vec2 f = fract(p);
    vec2 hid = mod(id, 97.0);

    // Orientation: flips accumulate beat by beat.
    float b = mod(floor(u_beats), 61.0);
    float o = step(0.5, hash21(hid));
    o = mod(o + step(1.0 - flips, hash21(hid + b * 0.37)), 2.0);
    if (o > 0.5) f.x = 1.0 - f.x;

    // Two arcs, centred on opposite corners.
    float r1 = length(f), r2 = length(f - 1.0);
    float d1 = abs(r1 - 0.5), d2 = abs(r2 - 0.5);
    float d = min(d1, d2);
    vec2 q = d1 < d2 ? f : 1.0 - f;
    float along = atan(q.y, q.x) / 1.5707963;          // 0..1 along the arc
    float parity = mod(id.x + id.y + o, 2.0) * 2.0 - 1.0;   // keeps neighbours flowing together
    float sn = max(u_triggers.y, u_hits.z);
    float dir = parity * (sn > 0.5 ? -1.0 : 1.0);
    float flow = fract(along * pulses + dir * u_time * speed);

    float aa = fwidth(d) * 1.5;
    float track = smoothstep(width + aa, width, d);
    float core = smoothstep(width * 0.35 + aa, 0.0, d);
    float pulse = pow(flow, 1.6) * smoothstep(1.0, 0.94, flow);   // comet: long tail, bright head
    float kick = max(u_triggers.x, u_hits.y);

    vec3 c = palette(fract(hash21(hid + 3.0) * 0.4 + u_beats * 0.02));
    vec3 col = c * track * 0.12;
    col += c * core * (pulse * 1.6 + kick * 0.9);
    col += c * exp(-d / (width * 2.5)) * 0.15 * (pulse + kick);
    // Hat sparks at tile corners.
    float spark = step(0.92, hash21(hid + mod(floor(u_beats * 4.0), 61.0) * 1.3)) * max(u_hits.w, u_triggers.z);
    col += vec3(1.0) * spark * track * 1.5;
    f_color = vec4(col, 1.0);
}
