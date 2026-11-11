#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Neon: glowing ribbons snaking across the frame, each a sum of sines in a
// palette colour. They lurch on the beat, the mid band widens their swing,
// kick (pad 1 / low hit) brightens them, snare (pad 2) splits each in two.
// Seamless left-right for 360° displays: x is an angle and every sine uses
// a whole number of turns across the width. For trails, chain into Feedback
// with zoom 1 / rotate 0 / x 0 (y drift is fine) — zoom, rotation and blurs
// like Bloom don't wrap and would show the seam.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   count;     // 1..12 = 6
    float speed;     // 0..4 = 1
    float amp;       // 0..1 = 0.35      swing
    float width;     // 0.5..10 = 2      core width (px)
    float glow;      // 0..2 = 1
};

void main() {
    vec2 p = to_centered(v_uv);
    float th = v_uv.x * 6.2831853;   // 0..2pi across the width: wraps exactly
    float t = u_time * speed * 0.6 + (floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats))) * 0.4;
    float px = width * u_scale * 2.0 / u_resolution.y * (1.0 + max(u_triggers.x, u_hits.y));
    float split = max(u_triggers.y, u_hits.z) * 0.08;
    vec3 col = vec3(0.0);
    for (int i = 0; i < 12; i++) {
        if (i >= count) break;
        float fi = float(i);
        float a = amp * (1.0 + u_bands.z * 1.5);
        float k1 = float(1 + i % 3);
        float k2 = float(3 + (i * 2) % 4);
        float y = a * sin(th * k1 + t * (1.0 + fi * 0.21) + fi * 1.7)
                + a * 0.5 * sin(th * k2 - t * 1.3 + fi)
                + (fi - float(count - 1) * 0.5) * 0.08;
        for (int s = -1; s <= 1; s += 2) {
            float d = abs(p.y - y - float(s) * split);
            float core = exp(-pow(d / px, 2.0));
            float halo = exp(-d / (px * 8.0)) * glow * 0.35;
            col += palette(fract(fi / float(count) + u_beats * 0.02)) * (core + halo) * 0.6;
        }
    }
    col *= 0.8 + 0.6 * max(u_triggers.x, u_hits.y);
    f_color = vec4(col, 1.0);
}
