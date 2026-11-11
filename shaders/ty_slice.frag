#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Kinetic type: in0 is a line of text or a logo, white on black, centred
// (a Text node, or an Image through a Transform with edge = black — edge =
// repeat tiles it and fills every gap).
// It is repeated in horizontal rows that scroll in alternating directions
// and lurch on every beat; snare (pad 2 / mid hit) shears each row into
// slices, kick (pad 1 / low hit) stretches the rows tall, every bar the row
// count changes, accent (pad 4) inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   rows;      // 1..12 = 3
    float band;      // 0.02..0.5 = 0.085 half height of the text line in in0 (uv)
    float fill;      // 0.2..1 = 0.45    text height as a share of its row (the rest stays black)
    float spacing;   // 0.2..3 = 1.6     repeat width along a row (frame widths); wider than the text in in0 leaves gaps
    float travel;    // 0..1 = 0.125     scroll per beat (text widths)
    float shear;     // 0..0.5 = 0.12    snare slice offset
    bool  bar_rows;  // = true           row count changes every bar
    bool  invert;    // = false
};

void main() {
    float bar = floor(u_beats / 4.0);
    float n = float(rows);
    if (bar_rows) n = max(1.0, n + floor(hash21(vec2(mod(bar, 61.0), 4.0)) * 3.0) - 1.0);
    float kick = max(u_triggers.x, u_hits.y);
    float sn = max(u_triggers.y, u_hits.z);

    float ry = v_uv.y * n;
    float rid = floor(ry);
    float ly = fract(ry);
    // Kick: rows stretch (sample a thinner part of the text line).
    ly = 0.5 + (ly - 0.5) / (fill * (1.0 + kick * 0.4));
    float inside = step(abs(ly - 0.5), 0.5);

    float dir = mod(rid, 2.0) * 2.0 - 1.0;
    float lurch = floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats));
    float x = v_uv.x + dir * lurch * travel * (1.0 + mod(rid, 3.0) * 0.5);

    // Snare: slices inside each row jump sideways.
    float sid = floor(ly * 6.0);
    x += (hash21(vec2(rid * 7.0 + sid, mod(floor(u_beats * 4.0), 61.0))) - 0.5) * shear * 2.0 * sn;

    float sx = (fract(x / spacing) - 0.5) * spacing + 0.5;   // text in the middle of each repeat
    vec2 suv = vec2(sx, 0.5 + (ly - 0.5) * band * 2.0);
    float v = monochrome(texture(u_tex0, suv).rgb).r;
    v = step(0.5, v) * inside * step(0.0, sx) * step(sx, 1.0);

    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(v), 1.0);
}
