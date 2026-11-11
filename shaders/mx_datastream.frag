#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: data streams. Columns of tiny 3x5 glyphs and barcodes falling
// at their own speeds, rewritten on every 16th note, inside a thin HUD frame.
// Kick (pad 1 / low hit) drops every column a step at once, snare (pad 2 /
// mid hit) sweeps a scan line down the frame, accent (pad 4) inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float cols;      // 8..120 = 48      columns across the width
    float speed;     // 0..4 = 1
    float trail;     // 0.05..1 = 0.35   trail length (frame heights)
    float bars;      // 0..1 = 0.25      fraction of barcode columns
    float frame;     // 0..1 = 1         HUD frame brightness
    bool  invert;    // = false
};

float glyph(vec2 f, vec2 cell, float seed) {
    // 3x5 bitmap inside a 4x6 cell (1 px gap).
    vec2 g = floor(f * vec2(4.0, 6.0));
    if (g.x > 2.0 || g.y > 4.0) return 0.0;
    return step(0.45, hash21(cell * 1.7 + g * 0.31 + seed));
}

void main() {
    vec2 uv = v_uv;
    float aspectR = u_resolution.x / u_resolution.y;
    float ncol = floor(cols);
    float cx = uv.x * ncol;
    float cid = floor(cx);
    float fx = fract(cx);
    float rowsN = ncol / aspectR * 1.5;          // glyph cells are 2:3

    float h1 = hash21(vec2(cid, 4.2));
    float h2 = hash21(vec2(cid, 9.7));
    float kick = max(u_triggers.x, u_hits.y);
    float fall = mod(u_time * speed * (0.15 + h1 * 0.5) + h2 * 10.0 + kick * 0.04, 100.0);

    float y = uv.y - fall;                        // falling down the screen (uv y grows downward)
    float cy = y * rowsN;
    float rid = floor(cy);
    float fy = fract(cy);

    // Head of the stream and its fading trail.
    float headPos = fract(fall * 0.7 + h2);
    float dist = fract(headPos - uv.y + 1.0);     // 0 at head, grows upwards
    float tr = 1.0 - smoothstep(0.0, trail, dist);
    float head = smoothstep(0.03, 0.0, dist);

    float step16 = mod(floor(u_beats * 4.0), 61.0);
    float change = step(0.6, hash21(vec2(cid, rid) * 0.37 + step16));
    float seed = mod(rid, 97.0) + change * step16 * 0.13;

    float v;
    if (h1 < bars) {
        // Barcode column.
        float bx = floor(fx * 8.0);
        v = step(0.5, hash21(vec2(bx + cid * 8.0, mod(floor(u_beats * 2.0), 53.0)))) * 0.8;
        v *= tr * 0.8 + 0.1;
    } else {
        v = glyph(vec2(fx, fy), vec2(cid, mod(rid, 97.0)), seed);
        v *= tr * 0.85 + head * 1.0 + 0.05;
    }

    // HUD frame: border, corner ticks, centre cross.
    vec2 p = to_centered(uv);
    float px = 1.5 * u_scale * 2.0 / u_resolution.y;
    vec2 e = vec2(aspect() - 0.06, 0.94);
    vec2 d = abs(p) - e;
    float border = smoothstep(px, 0.0, abs(max(d.x, d.y))) * step(max(d.x, d.y), px * 2.0);
    float corner = step(e.x - 0.12, abs(p.x)) * step(e.y - 0.12, abs(p.y));
    float hud = border * (0.35 + 0.65 * corner);
    hud = max(hud, smoothstep(px, 0.0, abs(p.y)) * step(abs(p.x), 0.03));
    hud = max(hud, smoothstep(px, 0.0, abs(p.x)) * step(abs(p.y), 0.03));
    v = max(v * step(max(d.x, d.y), 0.0), hud * frame);

    // Snare scan line sweeping down.
    float sn = max(u_triggers.y, u_hits.z);
    float sy = 1.0 - sn;                          // 0 at hit .. 1
    v = max(v, smoothstep(0.004, 0.0, abs(uv.y - sy)) * sn);
    v += smoothstep(0.08, 0.0, uv.y - sy) * step(uv.y, sy) * sn * 0.15;

    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
