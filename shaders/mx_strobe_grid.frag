#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: a grid of square tiles. A new random set of tiles lights on
// every 16th note and fades within it; the lit fraction follows the level.
// Kick (pad 1 / low hit) flashes the whole grid, accent (pad 4) inverts it,
// every bar the grid size changes.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float cells;     // 4..48 = 16       tiles across the height
    float density;   // 0..1 = 0.35      fraction of tiles lit per 16th
    float gap;       // 0..0.45 = 0.08   gap between tiles
    float decay;     // 0.5..20 = 2.5       how fast a tile fades within its 16th
    bool  bar_jump;  // = true           new grid size every bar
    bool  invert;    // = false
};

void main() {
    vec2 p = to_centered(v_uv);
    float bar = floor(u_beats / 4.0);
    float n = cells * (bar_jump ? (0.5 + floor(hash21(vec2(bar, 3.1)) * 4.0) * 0.5) : 1.0);
    vec2 g = p * n * 0.5;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;

    float sixteenth = u_beats * 4.0;
    float step16 = floor(sixteenth);
    float t16 = fract(sixteenth);

    float lit = step(1.0 - clamp(density + u_level * 0.4, 0.0, 1.0), hash21(id + mod(step16, 61.0) * 7.31));
    float env = exp(-t16 * decay);
    float tile = step(max(abs(f.x), abs(f.y)), 0.5 - gap);

    float kick = max(u_triggers.x, u_hits.y);
    float v = tile * clamp(lit * env + kick * 0.6, 0.0, 1.0);
    // Faint scaffold so the grid stays readable between hits.
    v = max(v, tile * 0.04);

    float inv = (invert ? 1.0 : 0.0);
    inv = abs(inv - step(0.5, u_triggers.w));
    v = mix(v, 1.0 - v, inv);
    f_color = vec4(vec3(v), 1.0);
}
