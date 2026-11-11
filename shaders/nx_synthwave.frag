#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Neon: retro horizon. A wireframe floor grid rushes towards the camera,
// one line per beat; a striped sun sits on the horizon and swells with the
// low band; kick (pad 1 / low hit) flashes the grid, accent (pad 4) drops
// the sun's stripes. Palette colours; chain into Bloom.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float horizon;   // -0.6..0.6 = -0.05 horizon height
    float lines;     // 0.5..8 = 2       grid lines per beat of travel
    float width;     // 0.5..6 = 1.5     line width (px)
    float sun;       // 0..1.2 = 0.45    sun radius
    float curve;     // 0..1 = 0.3       floor curvature
};

void main() {
    vec2 p = to_centered(v_uv);
    float kick = max(u_triggers.x, u_hits.y);
    vec3 col = vec3(0.0);

    // Sky gradient.
    float h = p.y - horizon;
    col += palette(0.85) * 0.12 * exp(-abs(h) * 4.0) * step(0.0, h);

    // Sun.
    vec2 sp = p - vec2(0.0, horizon + sun * 0.55);
    float r = sun * (1.0 + 0.08 * u_bands.y);
    float disc = smoothstep(r, r - 0.006, length(sp));
    float band = sp.y / r; // -1..1
    float stripes = step(0.0, sin((band * 10.0 + u_beats * 0.5) * 3.14159) + band * 2.0 + 1.2);
    stripes = mix(stripes, 1.0, step(0.5, u_triggers.w));
    disc *= (sp.y > -0.0 ? 1.0 : stripes) * step(horizon, p.y);
    col += disc * mix(palette(0.15), palette(0.5), clamp(band * 0.5 + 0.5, 0.0, 1.0)) * 1.3;
    col += palette(0.2) * 0.25 * exp(-length(sp) * 2.0) * step(horizon, p.y);

    // Floor grid.
    if (h < 0.0) {
        float z = 0.4 / (-h);
        float x = p.x * z * (1.0 + curve * h * h);
        float travel = u_beats * lines;
        float px = width * u_scale * 2.0 / u_resolution.y;
        float dz = fwidth(z * lines);
        float gz = abs(fract(z * lines + travel) - 0.5);
        float gx = abs(fract(x * 2.0) - 0.5);
        float lz = smoothstep(dz * 1.5 + px * z, 0.0, 0.5 - gz);
        float lx = smoothstep(fwidth(x * 2.0) * 1.5 + px * z * 0.5, 0.0, 0.5 - gx);
        float grid = max(lz, lx);
        float fade = exp(-z * 0.08);
        col += grid * fade * palette(fract(0.6 + z * 0.01)) * (1.0 + kick * 1.5);
        col += palette(0.7) * 0.015 * fade;
    }
    f_color = vec4(col, 1.0);
}
