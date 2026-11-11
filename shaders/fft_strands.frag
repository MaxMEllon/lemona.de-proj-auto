#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// The spectrum as pixels, bent into curves. in0 is a spectrum image (Audio FFT
// in spectrum mode: every column a bin's strength, stretched top to bottom);
// without it the 64 engine bins are used. The image is cut into `lines` thin
// vertical lines, each keeping its column's value as is (brightness and
// width, no threshold), and the lines are then warped: mirrored into petals
// or wrapped around the centre. The values also push the lines sideways along
// their length (`wobble`), so the sound shows as the strands' shape too.

layout(set = 0, binding = 1) uniform NodeParams {
    int   mode;     // straight|petal|polar = petal
    vec4  tint;     // color = 0.15,1,0.3
    int   lines;    // 1..64 = 6            number of strands
    float lo;       // 0..1 = 0.02          first bin used (fraction of the spectrum)
    float hi;       // 0..1 = 0.6           last bin used
    float gain;     // 0..4 = 1.6
    float base;     // 0..1 = 0.15          brightness kept in silence
    float width;    // 0.5..16 = 3          line width (px) at full value
    float glow;     // 0..2 = 0.6
    float zoom;     // 0.25..4 = 1
    float bend;     // -4..4 = 1.6          petal / polar curvature
    int   segments; // 2..16 = 4            polar mode symmetry
    float wobble;   // 0..0.5 = 0.08        values push the strands sideways
    float rotate;   // -180..180 = 0
    float spin;     // -2..2 = 0.05         turns per beat / 4
    float scroll;   // -2..2 = 0.1          strands drifting outward (per beat)
    float punch;    // 0..1 = 0.3           kick zoom
    float whiten;   // 0..1 = 0.5           loud strands go white
};

const float TAU = 6.2831853;

// The spectrum value at t (0..1 across lo..hi), straight from the pixels.
float spec(float t) {
    float x = mix(lo, hi, clamp(t, 0.0, 1.0));
    vec4 s = texture(u_tex0, vec2(x, 0.5));
    float v = s.a > 0.0 ? s.r : fft(int(clamp(x * 64.0, 0.0, 63.0)));
    return clamp(v * gain, 0.0, 1.0);
}

void main() {
    vec2 p = to_centered(v_uv);
    p /= zoom * (1.0 + punch * 0.15 * u_beat);
    p = rotate_deg(p, rotate + spin * u_beats * 90.0);

    // xs: across the strands (0..1 spans them), al: along a strand (0..1).
    float xs, al;
    if (mode == 0) {
        xs = v_uv.x;
        al = v_uv.y;
    } else if (mode == 1) {
        // Mirrored into four quadrants; the lines curve away from the axes
        // like the edges of petals.
        vec2 q = abs(p);
        xs = q.x - bend * 0.35 * q.y * q.y + 0.15 * bend * q.y;
        xs = abs(xs) * 0.6;
        al = q.y;
    } else {
        float r = length(p);
        float a = atan(p.y, p.x);
        float n = float(segments);
        float f = abs(fract(a / TAU * n) - 0.5) * 2.0;   // 0 mid-wedge, 1 edge
        xs = r * (1.0 + bend * 0.25 * (f * f - 0.33));
        xs *= 0.7;
        al = f;
    }

    // Strands sway with the spectrum read along their length.
    // (a triangle wave, so the lookup turns back instead of jumping, and three
    // taps to soften single-bin spikes)
    float t = abs(fract(al * 0.35 + 0.05) * 2.0 - 1.0);
    float sw = (spec(t - 0.01) + spec(t) + spec(t + 0.01)) / 3.0;
    xs += wobble * (sw - 0.4);

    float nl = float(lines);
    float s = xs * nl - scroll * u_beats;
    float id = mod(floor(s), nl);
    float f = fract(s) - 0.5;

    // Each strand's own column, read as is.
    float v = spec((id + 0.5) / nl);
    float bright = base + (1.0 - base) * v;

    float px = abs(f) / max(fwidth(s), 1e-5);   // distance in pixels
    float w = max(width * u_scale * (0.25 + 0.75 * v), 0.5);
    float core = 1.0 - smoothstep(w * 0.5 - 0.75, w * 0.5 + 0.75, px);
    float halo = glow * exp(-px / (10.0 * u_scale * (0.3 + v))) * v;

    vec3 col = mix(tint.rgb, vec3(1.0), whiten * v * v);
    f_color = vec4(col * (core * bright + halo), 1.0);
}
