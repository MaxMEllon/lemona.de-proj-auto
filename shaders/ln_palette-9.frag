#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Colors a mono input with the show's palette: brightness picks the palette
// color (black stays dark, white takes the far end), or a gradient across the
// frame / rings tints the white lines. The offset can step along the palette.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   mode;     // luma|across|rings|bands = across  what picks the color
    float offset;   // 0..1 = 0              start along the palette
    float range;    // 0..1 = 0.75           how much of the palette is used
    float low;      // 0..1 = 0.4            lowest palette position used
    float cycle;    // 0..2 = 0.1            palette cycles per beat
    int   steps;    // 0..8 = 0              offset jumps per bar (0 = glide)
    float dark;     // 0..1 = 0              black level: palette color under the blacks
    float mix_mono; // 0..1 = 1              0 = input untouched, 1 = full color
    bool  flip;     // = false
};

void main() {
    vec2 w = world_uv(v_uv);
    vec3 src = sample_world(u_tex0, w).rgb;
    float l = dot(src, vec3(0.2126, 0.7152, 0.0722));

    vec2 p = to_centered(w);
    float t;
    if (mode == 0)      t = l;
    else if (mode == 1) t = 0.5 + p.x / aspect() * 0.5;
    else if (mode == 2) t = fract(length(p) * 0.6);
    else                t = (floor(w.y * 8.0) + 0.5) / 8.0;
    if (flip) t = 1.0 - t;

    float shift = steps > 0 ? floor(u_beats / 4.0 * float(steps)) / float(steps)
                            : u_beats * cycle;
    float pos = fract(offset + shift + t * range);

    // A palette position folded back and forth, so it never jumps at the wrap.
    // Kept above `low`, so lines never land on a palette's near-black colors.
    vec3 col = palette(mix(low, 1.0, 1.0 - abs(pos * 2.0 - 1.0)));
    vec3 under = palette(fract(offset + shift)) * dark * 0.35;
    vec3 tinted = mix(under, col, l);

    f_color = vec4(mix(src, tinted, mix_mono), 1.0);
}
